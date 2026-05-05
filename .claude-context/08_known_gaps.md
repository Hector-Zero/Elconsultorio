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

---

## PHASE 3 — Major future work

### 17. Mercado Pago payment integration

Wire payment links into the booking confirmation. After Sonnet's "...le
compartiré el link de pago...", actually generate and send a Mercado Pago link
keyed to that appointment. Confirm payment via webhook → mark appointment
`status='confirmed'`.

### 18. Onboard Centro Vitalis as first paying client

Provide branding, configure professionals/services/schedules, train staff on
dashboard, set up Telegram bot.

### 19. Build dashboards in order of priority

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
