# Session Log

Append-only log of significant work sessions. Most recent at top.

---

## 2026-05-04 — Phase 2 Booking Integration COMPLETE + Living Context Docs Setup

**Major outcome:** Booking flow is fully wired end-to-end on both Make.com
branches (Sonnet primary + GPT-4o fallback). Booking succeeds atomically.
Failure paths handled gracefully with `bot_error` flagging.

### Database changes applied

- Added `leads.pending_booking_data` (jsonb) + GIN index — accumulates patient data across turns
- Added `leads.bot_error` (bool) + `leads.bot_error_message` (text) + partial index
- Updated `get_bot_context` RPC to return:
  - `slots_disponibles` as pre-formatted Spanish text grouped by professional, with day names translated, booked slots excluded
  - `profesionales_text` as compact Spanish text (name + services with prices, no specialties/bio/education/photo)
  - `session_types_text` as compact Spanish text
  - The original full arrays are kept for downstream use (dashboard, public URL)

### Edge Function changes

- `create-booking/index.ts` now uses substring `ilike '%name%'` matching for both `resolveProfessional()` and `resolveSessionType()`. Means "individual" matches "Consulta individual", "pareja" matches "Consulta de pareja".
- SQL LIKE wildcards (`\`, `%`, `_`) escaped in user input.
- Returns 400 on 0 matches or 2+ matches.
- Auth check: `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}` (which on this project is the new `sb_secret_` key, not legacy JWT).
- Status mapping: validation→400, slot_taken/slot_locked→409, rpc_error→500.

### Make.com flow changes

- **Both branches now mirror each other.** Branch 1 (GPT-4o fallback) was missing the booking integration entirely; now it has a full clone of Branch 2's structure.
- **Removed `ready_to_book` field from Haiku.** Replaced with deterministic Make.com filter (7 `Exists` conditions on `pending_booking_data.*` joined with AND). Saves ~250 tokens per Haiku call AND removes a model reliability dependency.
- **Added `bot_error` flagging** on failure routes of both branches. PATCH module sets `bot_error = true`, `bot_error_message = <Spanish description from Make.com switch on Edge Function error code>`, AND clears `pending_booking_data` to `{}` in same call.
- **Added `pending_booking_data` clearing** on success routes of both branches.

### System prompt changes

- Section 9 strengthened with:
  - REGLA A — Profesional must be patient-chosen, never assumed
  - REGLA A2 — Día must be patient-chosen (asking "a las 4" alone triggers "¿Para cuál día?")
  - REGLA A3 — Same logic for any missing element (servicio, profesional, día, hora) — never infer
  - REGLA B — Horario must be in disponibility list (per-professional)
  - REGLA C — Changes during flow trigger revalidation
- Section 10 — Confirmation pattern unchanged: "Estupendo, su cita queda reservada para el [día] [fecha] a las [hora] con [profesional]..."
- Section 13 (NUNCA HACE) — Added rule against mentioning specialties/bio/education/photo in dialogue (UX policy: details belong on public profile).

### Bugs found and fixed during session

1. UDT 351119 trailing spaces in `pending_booking_data` field names on module 48's body
2. Module 60 (Branch 1 Edge Fn) was missing the ready_to_book filter
3. Module 54's filter had duplicate `patient_email` Exists, missing `patient_address`
4. Modules 15 and 62 had broken formula `7.choices[].message.content` (empty array index, fixed to `7.choices[1].message.content`)
5. Failure-route Telegram pointing to wrong bot connection
6. Auth keychain had legacy JWT not `sb_secret_` key, AND lowercase "bearer" — fixed both
7. Edge Function 400 on "individual" — fixed via substring matching
8. Sonnet drifting on confirmation message wording — fixed by Make.com filter approach
9. Sonnet assuming professional when not specified — fixed via REGLA A
10. Sonnet assuming day when only hour given — fixed via REGLA A2
11. Slots_disponibles JSON dump unreadable for Sonnet — fixed via per-professional text format in RPC
12. After failure, every subsequent message re-triggered "Disculpe..." because `pending_booking_data` persisted — fixed via clear PATCH on both routes

### Known gaps identified this session

- ⚠️ **Bot can accidentally reschedule (double booking).** Identified via test where patient asked to change a slot mid-conversation; bot created a new appointment leaving the original active. Mitigation deferred — see `08_known_gaps.md` item 1.

### Living context docs system created

- New `.claude-context/` folder at project root
- `CLAUDE.md` router file at project root for Claude Code auto-loading
- `scripts/update-context.sh` regenerates schema, functions, and edge function snapshots
- Initial files: 00_README, 01_architecture, 08_known_gaps, 09_session_log
- Pending: 02_database_schema (auto-gen via script), 03_database_functions (auto-gen via script), 04_system_prompt (manual copy from agents_config), 05_haiku_prompt (manual copy from Make.com), 06_make_blueprint.json (manual export from Make.com), 07_edge_function.ts (auto-copy via script)

### Next session focus

In rough priority order:
1. Add "no reschedule" guard rail to system prompt (deferred but high priority)
2. Make.com email-on-error notifications (30 sec)
3. Onboard Centro Vitalis preparation
4. Phase 3 Mercado Pago integration planning
5. Build professional dashboard

---

<!-- Older sessions go below this marker -->
