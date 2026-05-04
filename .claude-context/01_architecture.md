# Architecture

## Overview

Elconsultorio is a multi-tenant SaaS for Chilean psychology centers. Patients
contact the center via Telegram, an AI-powered bot qualifies their inquiry and,
when appropriate, books an appointment atomically — collecting patient data,
checking real-time availability, and writing the appointment to the database.

The first paying client target is **Centro Vitalis** (Rakson Duarte, Antonio
Bellet 193, Providencia, Santiago).

## Component map

```
┌─────────────┐
│  Telegram   │  patient sends message
└──────┬──────┘
       │ webhook
       ▼
┌─────────────────────────────────┐
│  Make.com — "Master Agent"      │
│  ┌──────────────────────────┐   │
│  │ Module 32: get lead/ctx  │   │  fetches lead row + bot context
│  │ Module 50: get_bot_ctx   │   │  fetches centro/profesionales/slots
│  │ Module 46: Sonnet 4.5    │   │  generates patient-facing reply
│  │ ─ if Sonnet overloaded ─ │   │
│  │ Module 7:  GPT-4o (fb)   │   │  fallback path
│  │ ─────────────────────── │   │
│  │ Module 19/8: Haiku 4.5   │   │  extracts pending_booking_data
│  │ Module 40/48: upsert lead│   │  saves agent reply + extracted data
│  │ Module 53/58: filter     │   │  if all 7 booking fields present
│  │ Module 54/60: Edge Fn    │   │  → POST /create-booking
│  │ Module 56/62: success    │   │  → send Sonnet reply to patient
│  │ Module 57/63: failure    │   │  → "Disculpe..." + flag bot_error
│  └──────────────────────────┘   │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  Supabase                       │
│  ┌─────────────────────────┐    │
│  │ Edge Function:          │    │  validates payload
│  │   create-booking        │    │  resolves names → IDs
│  │                         │    │  calls RPC
│  └────────────┬────────────┘    │
│               ▼                  │
│  ┌─────────────────────────┐    │
│  │ RPC: create_booking_    │    │  atomic + idempotent
│  │      atomic             │    │  conflict detection (advisory lock)
│  │                         │    │  upserts patient + appointment
│  └─────────────────────────┘    │
│                                  │
│  Tables: leads, patients,       │
│  appointments, professionals,   │
│  professional_schedules,        │
│  session_types, agents_config,  │
│  professional_session_types,    │
│  invoices, schedule_overrides   │
└──────────────────────────────────┘
```

## Stack

| Layer | Tech | Notes |
|---|---|---|
| Frontend | React + Vite | Located in `src/`, eventually 3 dashboards (super_admin, professional, public) |
| Backend | Supabase (Postgres + Edge Functions in Deno) | Project ID `abusflxqblaewrffdlje` |
| Auth | Supabase Auth | Multi-tenant via `client_id` |
| Bot orchestration | Make.com scenario | Webhook-triggered |
| AI — main | Claude Sonnet 4.5 | Generates patient-facing replies |
| AI — extraction | Claude Haiku 4.5 | Extracts structured `pending_booking_data` JSON from conversation |
| AI — fallback | OpenAI GPT-4o | When Sonnet returns 529 overloaded |
| Telegram | Bot API | "TheMaster" bot, webhook to Make.com |
| Payments | Mercado Pago | Phase 3, not integrated yet |

## The booking flow (Branch 2 — Sonnet primary)

1. Patient sends Telegram message → webhook → Make.com
2. Module 32 fetches lead row from Supabase `leads` table (or creates one)
3. Module 50 calls `get_bot_context` RPC → returns centro info, profesionales (with prices), formatted available slots, lead context, pending invoices
4. Module 46 calls Sonnet 4.5 with system prompt (from `agents_config`) + centro context + conversation history → generates next message to patient
5. Module 49 logs token usage to `usage_log` (cost tracking)
6. Module 19 calls Haiku 4.5 with extraction prompt → returns structured JSON updating `pending_booking_data` (fields: agreed_session_type, agreed_professional_name, agreed_datetime, patient_full_name, patient_rut, patient_email, patient_address)
7. Module 40 PATCHes `leads` row: agent reply, conversation history, pending_booking_data merged
8. **Router 53 — Filter:** if all 7 `pending_booking_data` fields are populated, route to "ready_to_book" path. Otherwise default route.
9. **If ready_to_book:** Module 54 POSTs to `create-booking` Edge Function
10. **Router 55** branches on Edge Function response:
    - **Success (200):** Module 56 sends Sonnet's "Estupendo, su cita queda reservada..." to patient via Telegram. Then PATCH lead to clear `pending_booking_data` to `{}`.
    - **Failure (4xx/5xx):** Module 57 sends "Disculpe, tuve un inconveniente..." to patient. Then PATCH lead to set `bot_error = true`, `bot_error_message = <Spanish description>`, and clear `pending_booking_data` to `{}`.
11. **If NOT ready_to_book:** Module 25 simply sends Sonnet's generated reply to patient via Telegram

## The booking flow (Branch 1 — GPT-4o fallback)

Identical structure but mirrored module IDs:
- Module 7 (GPT-4o, conditional on Sonnet 529)
- Module 8 (Haiku)
- Module 48 (upsert lead)
- Router 58 with same filter
- Module 60 (Edge Fn)
- Router 61
- Module 62 (success Telegram + clear PATCH)
- Module 63 (failure Telegram + bot_error PATCH)
- Module 15 (default Telegram for not-ready cases)

## Key architectural decisions

### Why Make.com instead of writing custom orchestration

- Faster to iterate — non-engineers can edit prompts/flow
- Built-in retries, error handling, run history
- Acceptable for low-volume use (under 100k operations/month per pricing tier)
- Tradeoff: harder to version control, debugging requires Make.com UI

### Why two LLMs (Sonnet + Haiku) instead of one

- Sonnet generates natural patient-facing replies (slow, expensive but high quality)
- Haiku does structured extraction in parallel (fast, cheap, deterministic JSON output)
- Splitting roles means each model is used where it's strongest
- Token budget: Sonnet ~7700 input tokens (with prompt caching), Haiku ~4500 input tokens

### Why GPT-4o as fallback

- Sonnet sometimes returns 529 "overloaded"
- GPT-4o is comparable quality, different provider, decoupled failure modes
- Make.com has automatic conditional routing on HTTP status

### Why a deterministic Make.com filter instead of asking Haiku for `ready_to_book` boolean

- Earlier version asked Haiku to return a boolean field. Haiku occasionally got it wrong (returned true when fields were missing, or false when complete).
- Replaced with a Make.com filter: 7 `Exists` conditions on each `pending_booking_data.*` field, joined with AND. Fully deterministic.
- Saves ~250 tokens per Haiku call AND removes a model reliability dependency.

### Why pre-format slots/profesionales/session_types as Spanish text in the RPC

- Originally `slots_disponibles` was returned as a JSON array of objects. Make.com flattened it into the system prompt as a long, hard-to-parse blob.
- Sonnet drifted on slot validation — couldn't reliably check if a chosen slot was actually in the available list.
- Solution: `get_bot_context` now returns `slots_disponibles`, `profesionales_text`, and `session_types_text` as pre-formatted Spanish text strings, grouped by professional.
- Savings: ~570 tokens per Sonnet call. Bot reliability for slot validation is now near-perfect.

### Why two Make.com keychains for Supabase

- Keychain 155579 ("SupaBase HTTP"): sends `apikey` header → for PostgREST (`/rest/v1/...`)
- Keychain 156920 ("Supabase Bearer"): sends `Authorization: Bearer sb_secret_...` → for Edge Functions (`/functions/v1/...`)
- Edge Functions auth differently from PostgREST. Different headers, different keys.
- Critical gotcha: the Edge Function env var is named `SUPABASE_SERVICE_ROLE_KEY`, but on newer Supabase projects this is auto-populated with the **NEW Secret API Key** (`sb_secret_` prefix), NOT the legacy service_role JWT. Using the legacy JWT returns 401.

### Why the bot doesn't reschedule existing bookings

- Currently NOT implemented. The bot can be tricked into creating a NEW booking when a patient asks to "change" an existing one — leaving the original active and creating a duplicate.
- Mitigation: a hard rule in the system prompt instructs the bot to decline reschedule requests and direct patients to call the centro directly. (Pending — see `08_known_gaps.md`.)
- Future: a `cancel_booking` Edge Function + structured intent detection.

## Idempotency strategy in `create_booking_atomic`

The RPC uses an advisory lock keyed on `(client_id, professional_id, datetime)` to prevent race conditions on the same slot. If a `chat_id` already has an active appointment for the SAME slot, the RPC returns the existing booking instead of creating a duplicate (idempotent retry behavior). However, a different slot (different professional or different datetime) is treated as a fresh booking — which is what allowed the "accidental reschedule" double-booking case.

## Files of interest

| Path | Role |
|---|---|
| `supabase/migrations/*.sql` | Schema and RPC definitions |
| `supabase/functions/create-booking/index.ts` | Booking Edge Function |
| `src/` | React SPA (dashboards, public pages) |
| `.claude-context/` | This documentation system |
| `scripts/update-context.sh` | Auto-regenerate context docs |

## Cost profile (per 100 conversations of ~10 turns each)

Rough estimate, with prompt caching active:

- Sonnet 4.5 input (cached): ~$0.30
- Sonnet 4.5 output: ~$1.50
- Haiku 4.5 input: ~$0.05
- Haiku 4.5 output: ~$0.25
- Make.com operations: ~10 ops per turn × 10 turns × 100 convos = 10,000 ops (well within free tier)
- Supabase reads/writes: negligible at this scale
- Telegram: free

Roughly **$2 per 100 conversations**, or 2 cents per conversation. Well within target margins for $50-100/mo SaaS pricing.
