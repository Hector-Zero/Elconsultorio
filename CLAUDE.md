# Elconsultorio — Project Context for Claude Code

Multi-tenant SaaS for Chilean psychology centers. A Telegram bot
(Make.com → Anthropic Claude → Supabase) handles patient inquiries and books
appointments atomically.

## Quick start for a new session

For complete project context, read these files:

- @.claude-context/01_architecture.md — system overview, stack, decisions
- @.claude-context/02_database_schema.md — current schema (auto-generated)
- @.claude-context/03_database_functions.md — RPC definitions (auto-generated)
- @.claude-context/04_system_prompt.md — current Sonnet system prompt
- @.claude-context/08_known_gaps.md — deferred items and known issues
- @.claude-context/09_session_log.md — what changed when

For specific deep-dives:

- Edge Function source: supabase/functions/create-booking/index.ts
- Mirror in context: @.claude-context/07_edge_function.ts (snapshot)
- Make.com blueprint: @.claude-context/06_make_blueprint.json (snapshot, read-only reference)
- Haiku extraction prompt: @.claude-context/05_haiku_prompt.md

## Key facts

- **Supabase project:** `abusflxqblaewrffdlje`
- **Test client:** "Empresa 1" — `client_id = 6e03ed81-8c3b-47e7-82f9-3f6767de70ce`
- **Auth user:** `edbd4287-29ef-420d-aa27-314162692428` (`hector.zero.ia@proton.me`)
- **Test professionals:**
  - "Profesional 1" — `b43184e8-77b9-48b3-a54d-5a44e481b0d6`
  - "Profesional 2" — `90f2da07-ae7c-415c-9082-15c5d5a991b6`
- **agents_config row:** `2f4a42f1-ad95-4f5d-8a34-0c2e8d9f8dcc`
- **Timezone:** Chile, hardcoded `-04:00` (no DST handling — Chile dropped DST 2023)
- **Edge Function URL:** `https://abusflxqblaewrffdlje.supabase.co/functions/v1/create-booking`
- **Edge Function auth:** Use the **NEW Secret API Key** (`sb_secret_...` prefix), NOT the legacy service_role JWT. The env var is `SUPABASE_SERVICE_ROLE_KEY` but on newer projects it auto-populates with `sb_secret_`. Header must be `Authorization: Bearer sb_secret_...` (capital B).

## Conventions

### Migrations
- All migrations: `supabase/migrations/YYYYMMDDHHMMSS_descriptive_name.sql`
- Apply via `supabase db push` OR Supabase Dashboard SQL Editor
- After applying any migration, run `./scripts/update-context.sh` to refresh the auto-generated context files

### When the system prompt changes
- Source of truth: `agents_config.system_prompt` row in Supabase
- Snapshot: copy current value into `.claude-context/04_system_prompt.md`
- Don't edit the snapshot directly — always copy from DB after applying changes

### When Make.com flow changes
- Re-export blueprint: Make.com → scenario → ⋯ menu → Export Blueprint
- Save to `.claude-context/06_make_blueprint.json`

### When Haiku prompt changes
- Source of truth: Make.com modules 8 (Branch 1) and 19 (Branch 2)
- Snapshot: copy into `.claude-context/05_haiku_prompt.md`

### When code changes
- Edge Function: edited in `supabase/functions/create-booking/index.ts`, snapshot in `07_edge_function.ts` updates via `./scripts/update-context.sh edge`
- React SPA changes: standard git workflow

## UX policies

- Bot dialogue mentions only **professional names**, not specialties, bio, education, or photos. Detail belongs on the public profile page.
- Bot **does NOT modify, reschedule, or cancel** existing bookings (gap — see `08_known_gaps.md`).
- Bot uses formal "usted" treatment, never "tú".
- Bot never produces emojis in confirmation messages.

## Stack summary

- **Frontend:** React + Vite SPA (`src/`)
- **Backend:** Supabase (Postgres + Edge Functions in Deno + Auth)
- **Bot orchestration:** Make.com scenario "Master Agent"
- **AI:** Claude Sonnet 4.5 (main), Claude Haiku 4.5 (data extraction), GPT-4o (fallback when Sonnet overloaded)
- **Telegram:** webhook → Make.com
- **Payments:** Mercado Pago (Phase 3, not yet integrated)
