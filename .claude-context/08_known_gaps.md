# Known Gaps & Deferred Items

Tracked in priority order. Update as items are added, resolved, or re-prioritized.

---

## ⚠️ HIGH PRIORITY — Must do before Vitalis goes live

### 1. Bot can accidentally reschedule (double booking)

**Problem:** When a patient asks to change an existing booking, the bot may create a NEW booking for the new slot while leaving the original active. Patient thinks they rescheduled; reality is they have two appointments. The bot has even verbally confirmed "queda confirmado el cambio" without firing any DB action in some cases.

**Reproduction:** Book a slot. In the same conversation, ask to change to a different slot/professional. The bot will respond as if it changed the booking. Check `appointments` table — both original and "new" entries exist.

**Mitigation (planned):** Add a hard rule to system prompt Section 13:

```
NUNCA modificar, cambiar ni cancelar una cita ya reservada. Si el paciente
solicita cambiar día/hora/profesional de una cita existente, responder:

"Comprendo. Para cambiar o cancelar su cita ya reservada, le pido por favor
contactar directamente al centro al [teléfono]. Yo no tengo la capacidad de
modificar reservas existentes en este momento."

Esto aplica a TODA solicitud de cambio: día, hora, profesional, o cancelación.
La única acción permitida es crear una NUEVA reserva (cita adicional) si el
paciente lo confirma explícitamente.
```

**Deferred reason:** Identified late in 2026-05-04 session, decided to defer
along with other low-volume-risk items.

**Long-term fix:** Build a `cancel_booking` Edge Function. Extend the bot to
detect reschedule intent explicitly via Haiku and orchestrate cancel + book.

---

## MEDIUM PRIORITY — Quality of life / robustness

### 2. Make.com email-on-error notifications

**Why:** Right now if the scenario fails (e.g., Supabase 500), no one knows
unless they check Make.com run history. An email alert on error makes outages
visible.

**How:** Make.com → scenario → Settings → Scenario settings → Notifications
→ Enable "Send notification when scenario fails." ~30 seconds.

### 3. Stress test the booking flow

**Why:** All testing has been single-user, sequential. Real conditions might
expose race conditions in the advisory lock or unexpected cache invalidation.

**How:** Simulate 5 concurrent bookings from different `chat_id`s targeting
the same slot. Expect 1 success + 4 conflicts (409 slot_taken) with clean
"Disculpe..." messages on the four failures.

### 4. Drop legacy `patients.professional_id` column

**Why:** Patients are now linked to professionals via `appointments` (each
appointment ties a patient to a professional for that session). The
`patients.professional_id` field is unused but still exists.

**How:** Migration:
```sql
ALTER TABLE patients DROP COLUMN professional_id;
```
Verify no code references it first (`grep -r "professional_id" src/`).

### 5. Fix or feature-flag broken dashboard `ai-chat` Edge Function

**Why:** There's an old `ai-chat` Edge Function from before the Make.com
booking flow. It still hallucinates because it predates the structured booking
approach. The dashboard might call it or surface it somewhere.

**How:** Audit dashboard code for usage. Either:
- Delete the function and remove dashboard references, OR
- Update it to match the current architecture (call `get_bot_context` + Sonnet
  identically to Make.com path).

### 18. Inconsistent ID routing for "Ver ficha" vs "Cobrar" buttons (2026-05-04)

In `src/screens/patients/quickPanel.jsx` (post-split):
- "Ver ficha" button → navigates to `files/<patient.id>`
- "Cobrar" button → navigates to `billing/<lead_id>`

In `src/screens/patients.jsx` shell (post-split):
- List-row chevron → navigates to `files/<lead_id>` (inconsistent with quickPanel's "Ver ficha")

`files.jsx` interprets its param as a UUID and falls back to first-patient-
of-client when lookup fails, which masks the bug. Whether the two routes
land on the same patient is non-deterministic depending on which ID lookup
hits first.

Fix: standardize on one ID type for the files route, update all three call
sites consistently. Verify against `files.jsx` param handling.

### 20. Schema/application drift on patients.status (2026-05-05)

`patients.status` is documented in `02_database_schema.md` as
`DEFAULT 'activo'` but every existing patient row uses `status='active'`
(English). Application code writes `'active'`; the schema default is
never used. The patients screen filters on `status='active'` somewhere
(header count "X pacientes activos" matches the active-count exactly).

Surfaced 2026-05-05 when test data seeded with the schema-documented value
`'activo'` was silently filtered out of the list view despite the row
being present in the database response. Hard to diagnose without devtools
inspection.

Audit: grep for `'active'` and `'activo'` in `src/`, settle on one value
(English, given existing data), update schema default to match in a
migration, backfill any drift.

### 21. Files screen does not display clinical_notes (2026-05-05)

In `src/screens/files.jsx`, the "Historial de sesiones" panel shows
"Sin sesiones registradas" even when `clinical_notes` rows exist for
the patient's active assignment. The QuickPanel on the patients screen
displays the same notes correctly (queries `clinical_notes` by
`assignment_id`).

Likely cause: `files.jsx` queries clinical_notes via a different path
(possibly by `patient_id`, which doesn't exist on the table per schema)
or via an assignment lookup that's failing/missing.

Surfaced 2026-05-05 with Camila Reyes test data — same patient renders
3 notes correctly in the patients QuickPanel and zero notes in the
files screen Ficha clínica. files.jsx split is already deferred from
Phase A to Phase B; this fix can land alongside that refactor or as
a standalone bugfix before then.

### 26. Three overlapping status taxonomies (2026-05-05)

The codebase has three independent status taxonomies that don't agree:

1. `appointments.status` — `pending_payment` / `confirmed` / `completed`
   / `cancelled` / `no_show` (per Phase 2 booking flow)
2. `leads.qualified_lead` — boolean (per bot qualification logic)
3. `STATUS` dict in `leads/_shared.jsx` — `potencial` / `confirmado`,
   used only by `StatusPill` to render leads via a `statusOf(lead)`
   helper that derives from a third source

`StatusPill` displays the third taxonomy (`potencial`/`confirmado`)
even though the underlying lead row exposes neither field directly.
The mapping happens implicitly in `leads/_shared.jsx`'s `statusOf`.

Fix: consolidate to one source of truth for lead status. Likely either
extend `qualified_lead` boolean into a proper enum on the leads table,
or formalize the `statusOf` mapping with documentation. Should be
resolved before Vitalis goes live to avoid confusing the centro staff
who'll see the dashboard.

---

## LOW PRIORITY — Polish & nice-to-haves

### 6. `useUnsavedChanges` hook for dashboards

When editing professional schedules / agents_config / etc., warn user before
navigating away with unsaved edits.

### 7. Mobile-responsive dashboard

Current SPA is desktop-only. Tailwind responsive classes need to be applied
across the dashboard pages.

### 8. Drag-handle reorder for session_types

Right now `display_order` is set numerically. Patient-facing experience would
benefit from a drag-and-drop reorder UI in the dashboard.

### 9. `schedule_overrides` table for vacation / one-off blocks

Currently `professional_schedules` only handles weekly recurrence. To block
a vacation week or open up a special Saturday, we need overrides.

### 10. RLS policy audit

We have RLS on most tables but no systematic verification. Audit each policy,
test with a non-admin auth user, document expected access.

### 11. Sentry integration

Frontend errors and Edge Function errors are invisible right now. Sentry
(or similar) for both layers.

### 12. Vercel deploy + DNS

SPA needs a production deployment. Buy `elconsultorio.com` (or similar),
deploy SPA to Vercel, set up DNS.

### 13. Dead code surfaced during settings.jsx split (2026-05-04)

- `DEFAULT_SESSION_TYPES` constant in `src/screens/settings/profile.jsx`
  is defined but never referenced
- `config` prop on `PerfilDisponibilidad` is passed but never read

Both pre-date the refactor; flagging for cleanup pass.

### 14. Extract data hook from agenda.jsx shell (2026-05-04)

`src/screens/agenda.jsx` shell is ~500 lines after Phase A split. Most of
that is JSX layout plus a single data-loading useEffect that combines:
professional fetching, schedule hydration, appointment query, patient
+ session-type catalogs, and a realtime subscription.

Future work: extract `useAgendaData()` hook to encapsulate the effect,
trim shell toward ~300. Non-mechanical, deferred until Phase B or later.

### 15. Extract save/form hook from citaModal (2026-05-04)

`src/screens/agenda/citaModal/index.jsx` shell is ~575 lines after Phase A
split. The bulk is `performSave` (~175 lines: validation, past/off-schedule
warnings, conflict check, patient INSERT with sticky-id dedup, patient_
assignments INSERT, appointment INSERT/UPDATE, error mapping) plus a
17-prop `PatientPicker` interface that signals state ownership wants
restructuring.

Future work: extract `useCitaForm()` hook to encapsulate save/delete
pipelines and form state, collapse the PatientPicker prop interface to
a single `form` object. Non-mechanical, deferred until Phase B or later.

### 16. Extract editor save hook from professionals (2026-05-04)

`src/screens/professionals/professionalEditor.jsx` orchestrator is ~470
lines after Phase A split, dominated by `syncSchedules` (insert/update/
delete diff for schedules) + `syncOffered` (insert/update/delete diff
for session_types) + `handleSave` (~144 lines combined).

Future work: `useProfessionalEditor()` hook to encapsulate the save
pipeline + state diffing. Non-mechanical, deferred until Phase B or later.

### 17. Extract leads list + state hook (2026-05-04)

`src/screens/leads.jsx` shell is ~330 lines and `leads/leadsList.jsx`
takes ~22 props after Phase A split. The list panel needs `useLeadsList()`
(or split as `useLeadsState()` + `useResizableColumns()`) to encapsulate
state + column geometry (ResizeObserver, ratio normalization, neighbor-pair
resize, sort/filter pipeline).

Future work: extract hook(s) to collapse the prop interface and isolate
the resize logic for reuse. Non-mechanical, deferred until Phase B or
later.

### 19. Patients screen list panel is not scrollable (2026-05-05)

In `src/screens/patients.jsx` (post-Phase-A split), the patient list panel
(left side of 2-column grid) does not scroll when content overflows the
viewport. Surfaced 2026-05-05 with 13+ patients on a 13" screen — rows
beyond the fold are inaccessible without using the search box.

Fix: audit the 2-column grid wrapper; ensure list panel has `min-height: 0`
and `overflow: auto` on the right element. Pattern-match against QuickPanel
which already scrolls correctly.

### 25. STATUS dict color-snapshot fragility (2026-05-05)

`STATUS` (now in `src/screens/leads/_shared.jsx` after Phase A target #7
demotion) is initialized at module-load time with snapshot references
to `T.potencial`/`T.potencialSoft`/etc. After `applyTheme` mutates `T`,
those keys aren't currently overwritten — so STATUS happens to render
correct colors by accident, not by design. If a future theme adds
`potencial`/`confirmado` color overrides, STATUS will render with stale
colors.

Fix: either compute STATUS dynamically (function call instead of dict
literal) or have applyTheme rebuild STATUS after mutating T. Low priority
until a theme actually overrides those keys.

### 27. Sidebar reads undocumented clients.config.modules (2026-05-05)

`Sidebar` in `src/screens/shared.jsx` reads `ctx?.config?.modules` to
filter which sidebar items are visible (module-based access control).
This `modules` field on `clients.config` (jsonb) is not documented in
`02_database_schema.md` or anywhere in `.claude-context/`.

Fix: document the expected shape and allowed values of
`clients.config.modules`. If the field is unused/legacy, remove the
filter from Sidebar.

---

## PHASE 3 — Major future work

### 28. Mercado Pago payment integration

Wire payment links into the booking confirmation. After Sonnet's "...le
compartiré el link de pago...", actually generate and send a Mercado Pago link
keyed to that appointment. Confirm payment via webhook → mark appointment
`status='confirmed'`.

### 29. Onboard Centro Vitalis as first paying client

Provide branding, configure professionals/services/schedules, train staff on
dashboard, set up Telegram bot.

### 30. Build dashboards in order of priority

a. Professional dashboard — view their own appointments, mark notes
b. Public URL — patient-facing centro page with professional bios, booking link
c. Super admin dashboard — full multi-tenant management

---

## Tracking convention

When an item moves status, update this file:
- ✅ Completed: keep entry, add date completed at top
- 🔄 In progress: add `[in progress, 2026-05-XX]`
- ❌ Cancelled: keep entry, mark cancelled with reason

When new items emerge, add them in the appropriate priority section.
