# Session Log

Append-only log of significant work sessions. Most recent at top.

---

## 2026-05-05 — Phase A complete: split the giants (6/6)

**Outcome:** Six largest source files split into focused modules. Public
contracts preserved across all splits. No logic changes — strictly mechanical
moves with bug observations tracked separately. Four deferred hook-extraction
items now form a coherent Phase B starting cluster. Three real bugs surfaced
through end-to-end smoke testing.

### Splits completed

| # | Commit | File | Before → After |
|---|---|---|---|
| 1 | ef36fd4 | settings.jsx | 1,663 → 136 (shell) + 9 sub-files |
| 2 | ef403c7 | agenda.jsx | 1,202 → 517 (shell) + 7 sub-files |
| 3 | 9c9d414 | citaModal.jsx | 854 → 586 (orchestrator) + 2 sub-files |
| 4 | 59e0eb2 | professionals.jsx | 771 → 258 (shell) + 2 sub-files |
| 5 | 5e13503 | leads.jsx | 757 → 341 (shell) + 3 sub-files |
| 6 | 18fd7db | patients.jsx | 576 → 260 (shell) + 2 sub-files |

Total: 6 shells + 25 sub-files. `files.jsx` (495 lines) deferred to Phase B
after structural review — flat shape, splitting it would produce minimal
cognitive-load reduction relative to its size.

### Protocol established

Each split followed: read file → propose split plan → review → mechanical
execute → verify (build + transform + import distribution + external caller
search) → smoke test → commit. The mechanical-only constraint held across
all six splits — no logic was modified, no variables renamed, no comments
touched, no while-I'm-here cleanup. Real bugs and dead code were always
flagged in "Observed during refactor (not fixed)" rather than fixed in the
same commit. This produced reviewable diffs and clean rollback points
throughout.

### Conventions established within `src/screens/`

- `<screen>.jsx` shell stays at the original path; sub-files live in
  `src/screens/<screen>/`
- `_shared.jsx` (underscore prefix) for folder-internal primitives, used
  only when 2+ consumers exist within the folder; single-consumer helpers
  stay with their consumer
- `lowercaseCamelCase.jsx` for component files
- One file per component cluster, not per component, when components share
  state or are conceptually coupled
- Subfolder + `index.jsx` (e.g., `agenda/citaModal/index.jsx`) reserved
  for the largest extracted units that have their own internal structure;
  re-export public symbols from the index to preserve encapsulation

### Phase B hook-extraction cluster

Four deferred items in `08_known_gaps.md` (items 14-17) all surfaced from
the same constraint: shell files where mechanical extraction would have
required a state-management refactor (hook + state ownership change),
which violates the mechanical-only rule.

- **Item 14 — `useAgendaData()`** for `agenda.jsx` (~500-line shell, single
  data-loading effect with realtime sub combining 5 fetches)
- **Item 15 — `useCitaForm()`** for `agenda/citaModal/index.jsx` (~575-line
  orchestrator dominated by 175-line save pipeline + 17-prop PatientPicker
  interface)
- **Item 16 — `useProfessionalEditor()`** for
  `professionals/professionalEditor.jsx` (~470 lines, ~144-line save
  pipeline with insert/update/delete diffs for schedules and offered
  session_types)
- **Item 17 — `useLeadsList()` / `useResizableColumns()`** for
  `leads/leadsList.jsx` (22-prop interface, ResizeObserver + ratio
  normalization + neighbor-pair resize logic)

These form a natural starting point for Phase B.

### Bugs surfaced through smoke testing

End-to-end test on the patients screen (Camila Reyes test data with 3
clinical_notes for AI summary verification) surfaced three real bugs,
none of them refactor-related:

- **Item 19** — Patients list panel not scrollable when content overflows
  viewport (LOW priority, CSS audit)
- **Item 20** — Schema vs application drift on `patients.status`: schema
  default `'activo'` but all rows use `'active'`; screen filters on
  `'active'` (MEDIUM priority, requires migration)
- **Item 21** — `files.jsx` Ficha clínica panel does not display
  clinical_notes despite the patients QuickPanel displaying the same
  notes correctly. Different query paths between the two screens
  (MEDIUM priority, can land alongside Phase B `files.jsx` split)

### Pre-existing dead code surfaced (not fixed during splits)

Tracked across multiple "Observed during refactor" reports, all carried
forward for batched cleanup PR after Phase A:

- `DEFAULT_SESSION_TYPES` unused in `settings/profile.jsx`
- `config` prop unused on `PerfilDisponibilidad`
- `selectStyle` constant unused in `agenda/_shared.jsx`
- `ProChip` component unused in `agenda/proSelector.jsx`
- `endH` local variable unused in `agenda/hoursGrid.jsx`
- `apptServiceShort` comment-vs-code drift in `agenda/_shared.jsx`
- `lead.unread`, `lead.appointment`, `lead.tags` fields rendered but not
  in schema (in leads sub-files)
- Stub buttons without `onClick` in leads/DetailPanel and patients
  (Responder, Agendar, Crear ficha, Marcar como descartado, Convertir
  a paciente, Exportar, Nuevo paciente, Filtrar)
- Legacy `patients.professional_id` writes at lines 71, 88, 91 in
  patients shell — tracked in `08_known_gaps.md` item 4

### Public contract verification

Every split confirmed: the only callers of each split file are unchanged
imports in `src/App.jsx`. Default exports preserved. Named re-exports
where required (e.g., `APPT_STATUS` from `agenda/citaModal/index.jsx`).
Pre-existing files in partially-split folders (e.g., the 4 section files
in `professionals/`) confirmed byte-for-byte unchanged via `git diff`.

### Phase A status

Complete. Six core targets done, `files.jsx` deferred to Phase B with
explicit reasoning. The mechanical-only protocol held throughout and
will transfer to subsequent phases.

### Next session focus

1. **`shared.jsx` (664 lines)** — deliberate planning round. App-wide
   imports across the codebase; consumer inventory and explicit
   import-path migration plan required before any moves. Treated as
   Phase A target #7 (bonus deliberate split) rather than slotted into
   the regular queue.
2. After shared.jsx: Phase B planning (UX consistency layer, hook
   extractions, dirty-state guard system).

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
