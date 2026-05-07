# Known Gaps & Deferred Items

Tracked in priority order. Update as items are added, resolved, or re-prioritized.

---

## ⚠️ HIGH PRIORITY — Must do before Vitalis goes live

### 1. Bot can accidentally reschedule (double booking) **[PHASE B / DEFERRED]**

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

**Status update 2026-05-05:** Major rewrite drafted and partially applied
during 2026-05-05 session. Prompt save behavior, prompt cache invalidation,
and Make.com flow integration all proved more entangled than expected.
Multiple test conversations revealed the prompt+flow stack needs to be
treated as a single architectural unit, not as separate prompt edits.
Re-scoped: deferred to a future dedicated session that addresses bot
holistically alongside system prompt, Haiku prompt, Make.com flow, and
Edge Function. Current production prompt is still functional for ~80% of
booking flows; the failure modes are tracked in items below.

### 31. Bot says "queda reservada" without booking actually firing (2026-05-05) **[PHASE B / DEFERRED]**

The conversational bot layer says "Estupendo, su cita queda reservada..."
based on its own perception of conversation completeness. The Make.com
ready_to_book filter is a separate gate that determines whether the
Edge Function actually runs. When they disagree (e.g., when Haiku saves
a malformed `patient_email`), the filter rejects the booking but the
patient sees a confirmation message anyway.

Architectural fix: the success-route Telegram modules should send a
templated success message AFTER the Edge Function returns 200, not
relay the bot's own text. The bot should generate intent-only language
("Procesando su reserva...") and the system generates the actual
"queda reservada" message.

Defer until dedicated bot polish session. Do not fix piecemeal.

### 32. Haiku Markdown autolink stripping rule not effective (2026-05-05) **[PHASE B / DEFERRED]**

The `patient_email` rule in module 8 and module 19 was updated to
strip Markdown autolink syntax like `[user@example.cl](mailto:user@example.cl)`.
Two test conversations after the update still produced
`[maria@masha.cl](mailto:maria@masha.cl)` in `pending_booking_data.patient_email`.
Either the rule did not save in Make.com, or Haiku is interpreting
the autolink as a valid email-like string and ignoring the strip
instruction.

Defer until dedicated bot polish session. Verify rule is actually
saved by reading module 8 and module 19 prompt content directly.

### 33. Bot conversation state lost mid-flow when age question fires (2026-05-05) **[PHASE B / DEFERRED]**

When the bot triggers the Section 8 paso 4 age question (intended for
infanto-juvenil bookings only), the conversation loses track of the
agreed slot/professional and re-shows the entire availability list,
forcing the patient to pick again. Two things compound: (1) the age
question fires for adult bookings (paso 4 not properly gated to minor
indication), (2) after the age answer, the bot has no clear "next step"
rule and defaults to re-listing availability.

Defer until dedicated bot polish session.

### 34. Patient row duplication on booking flow (2026-05-05)

The `create-booking` Edge Function creates `patients` rows without
deduplication on `(client_id, lead_id)` or `(client_id, rut)`. Combined
with `patients.jsx` auto-create logic that creates lead-linked rows
when the dashboard loads, this produces duplicate patient rows for the
same person.

Two fixes needed:
1. Edge Function should set `lead_id` on patient INSERT and dedupe
2. Dashboard auto-create should dedupe on `(client_id, lead_id)` AND
   `(client_id, full_name)` before inserting

Tier 2 dashboard work — addressable independently from bot.

### 35. usage_log not capturing token counts (2026-05-05) **[PHASE B / DEFERRED]**

`input_tokens`, `output_tokens`, `cache_read_tokens`, and
`cache_creation_tokens` all return null for recent Anthropic API calls
in `usage_log`. Either the writer is not extracting fields from the
API response correctly, or Make.com is not passing them through.

Cache analytics unusable until fixed. Defer until bot polish session.

### 36. update-context.sh schema destroys docs on auth failure (2026-05-05)

⚠️ **Destructive failure mode.** The script wipes `02_database_schema.md`
BEFORE attempting regeneration, so a failed run leaves the doc empty
until `git restore` recovers it. Anyone running this in the auth-failure
window destroys context docs without warning.

`./scripts/update-context.sh schema` currently fails with:

```
psql: error: connection to server at "aws-1-us-east-1.pooler.supabase.com"
(18.213.155.45), port 5432 failed: FATAL: password authentication failed
for user "postgres"
```

The script can't refresh `02_database_schema.md` from the live database.
Schema doc updates currently require manual editing, which doesn't scale
and risks doc drift.

Investigation needed:
- Patch the destructive-before-validate pattern: the script should
  verify it can connect + query BEFORE truncating the existing doc
- Check the script's connection string source (env file, hardcoded, etc.)
- Verify whether Supabase rotated the database password recently
- Confirm whether the script's connection method (direct postgres user
  on pooler:5432) is still supported or if it should use a different
  pooler connection string
- Fix the script to use credentials that work, or refactor to use the
  Supabase API instead of direct psql

Blocks future schema migrations from refreshing docs cleanly AND
risks silent doc destruction by anyone unaware of the auth issue.
Address before any further schema work.

### 40. Capture all RLS policies and helper functions as version-controlled migrations (2026-05-05)

✅ Resolved 2026-05-06 across five commits (fcaeaa4, 14f39e3,
760b0f7, 4bb7a65, f2f996f). The auth/security model is now
version-controlled and reproducible. Captured: 6 functions (5 RLS
helpers + set_updated_at), the handle_new_user trigger on
auth.users, 49 RLS policies across 18 public-schema tables
(idempotent via DROP POLICY IF EXISTS / CREATE POLICY), table
grants on 20 objects (18 tables + 2 views), function EXECUTE
grants on 8 functions. Plus added two missing BEFORE UPDATE
triggers on clinical_notes and patient_assignments (resolves
item 53).

Discovery surfaced new gap entries 50-54 (clients_public_lookup
exposure, professionals_public_read_active exposure,
appointments_professional_own DELETE permissions, missing
updated_at triggers, search_path missing on two functions). Plus
subsequent items 55+ from the baseline discovery:
patients_professional_active_assignment FOR ALL, default ACL not
migration-captured, RPC function migrations don't include
explicit grants, users_admin_write FOR ALL allows DELETE.

Faithful capture preserved current production behavior; no
regressions. Authoring discipline (Decisions 2 and 3) kept the
baseline migrations exactly that — baselines, not improvements.
Style normalization and concern-fixing deferred to focused passes
per gap entry.

### 41. Provision test professional auth account for end-to-end pro-mode testing (2026-05-05)

✅ Resolved 2026-05-07. Pro 3 auth account provisioned via
Supabase Dashboard (raw_user_meta_data with client_id +
role='professional'); handle_new_user trigger auto-created the
public.users row; professionals.user_id updated to wire the auth
user to the existing Profesional 3 record.

Smoke test surfaced a routing regression — pro-mode allowed-
screens list at App.jsx:116 was conflated with Sidebar's nav-
visibility list, blocking URL navigation to files/billing.
Fixed in commit 0684d84: pro-mode allowed list now extends to
include 'files' (clinical, pros need it) but NOT 'billing'
(operational, admin/receptionist territory). The same commit
hides "Cobrar" buttons in QuickPanel + files.jsx from pro mode
to prevent UI dead-ends pointing at the now-blocked billing
screen.

Item 21 write-path verified end-to-end: Pro 3 created a clinical
note on Camila Reyes via the Ficha clínica's "Nueva sesión"
modal. INSERT succeeded against clinical_notes, RLS allowed the
write per notes_treating_professional_all WITH CHECK (active
assignment confirmed). total_sessions counter bumped correctly.

Pro mode UX gaps surfaced during the smoke test are tracked
separately as items 59-64 (collectively a "pro mode UX pass"
deferred concern).

Pre-launch validation status: Vitalis's psychologists can use
the system end-to-end at the foundational layer (auth, RLS, nav
restriction, screen routing, clinical authorship). UX polish
remaining is in the 59-64 batch.

### 42. Document the auth/role model in .claude-context/ (2026-05-05)

The auth/role model is implemented across multiple disconnected
places (useClient.js for slug→client_id resolution, App.jsx for
professional detection, RLS helper functions for DB-side
enforcement) but not documented anywhere in .claude-context/.
Surfaced during item 21 diagnostics — Code had to discover the
model by grep across the codebase rather than reading
documentation.

Fix scope: add a new section to 01_architecture.md (or a
dedicated 04_auth_model.md) documenting:

- How client_id resolution works (URL slug → clients.id via
  useClient.js)
- How professional vs admin mode is determined (App.jsx checking
  professionals.user_id)
- How RLS enforces permissions (helper functions reading users +
  professionals tables)
- The two-system gotcha: URL slug must match users.client_id or
  queries silently return nothing
- The handle_new_user trigger behavior on auth user creation
- The 3-screen pro nav restriction in App.jsx:113-119

Couple this with item 40 (RLS-as-code) so the docs and the
migrations cover the same ground.

### 50. clients_public_lookup exposes clients.config to anon (2026-05-06)

The `clients_public_lookup` policy on the `clients` table grants
`SELECT` to `{anon, authenticated}` with `using_expr = true` —
every row of `clients`, every column, is publicly readable.

Surfaced during item 40 baseline RLS discovery (2026-05-06). The
slug-resolution flow in src/lib/useClient.js needs anon read
access to bootstrap the SPA before login (resolves subdomain →
clients.id), which is why the policy exists. But it also exposes
the full clients.config jsonb of every centro, including
config.empresa.{nombre, direccion, telefono, email, rut},
config.modo_empresa, config.theme_id, and the future
config.features toggles (item 46) and config.modules field
(item 27).

Risk: anyone iterating subdomain slugs can dump every centro's
contact info, business RUT, and feature gates. For a healthcare
product this is a non-trivial surface. Once item 46 lands, RLS
will read config.features to determine permissions — exposing
those toggles tells an attacker which centros have which
features enabled. For privacy-sensitive toggles like
admin_can_view_clinical_notes, this enables targeted attacks:
identify centros where admin compromise grants clinical data
access.

Fix scope: tighten the policy to expose only the columns the SPA
actually needs to bootstrap. Likely: id, slug, name,
config->'theme_id', config->'empresa'->'nombre' (for the login
page header). The rest (config.features, config.modules,
contact details) should require authentication. Implementation
options:

- A view exposing only safe columns, with the policy applied to
  the view and base table locked to authenticated
- Column-level grants (Postgres supports per-column SELECT) plus
  a policy filtering jsonb keys
- A SECURITY DEFINER function get_client_bootstrap(slug text)
  that returns only the safe subset, called by the SPA before
  login

Recommended approach: SECURITY DEFINER function pattern, matching
existing helper functions in this codebase. get_client_bootstrap
(slug text) returns a composite or JSON with only the
public-safe columns. The pattern is reusable — same approach
works for item 51 and any future public-readable endpoints. The
view and column-level grants approaches are alternatives but
introduce different trade-offs (views: more maintenance per
column added; column grants: tricky to combine with RLS).

Coordinate with item 46 (features toggles) since both touch
clients.config — the bootstrap function's safe-subset definition
needs to evolve in lockstep with what config keys exist.

### 51. professionals_public_read_active exposes email + user_id to anon (2026-05-06)

The `professionals_public_read_active` policy grants `SELECT` to
`{anon, authenticated}` for any row where `active = true`. This
supports the public-facing centro page (eventual
cliente.elconsultorio.cl) displaying professional bios, photos,
specialties, etc.

Surfaced during item 40 baseline RLS discovery (2026-05-06). The
policy returns ALL columns of every active professional, which
includes:

- email — professionals' personal contact email
- user_id — uuid fingerprint of the auth.users row, enabling
  enumeration of which auth users are professionals
- availability jsonb — detailed weekly schedule including
  unbooked hours
- created_at, color, etc. — operational metadata not relevant to
  the public profile

The public profile genuinely needs full_name, initials, bio,
specialties, photo_url, years_experience, public_summary,
public_credentials, public_documents.

Risk: scraping public centro pages collects emails of every
licensed psychologist using the platform. user_id enumeration
creates a small recon surface for any future auth-related
attacks.

Fix scope: same options as item 50 — view, column-level grants,
or SECURITY DEFINER function returning the public-safe subset.

Recommended approach: SECURITY DEFINER function pattern, matching
existing helper functions in this codebase. get_public_professionals
(client_slug text) returns the public-profile subset of active
professionals for a centro. The pattern is reusable — same
approach works for item 50 and any future public-readable
endpoints. The view and column-level grants approaches are
alternatives but introduce different trade-offs (views: more
maintenance per column added; column grants: tricky to combine
with RLS).

Should be tackled in the same RLS hardening pass as item 50.

### 55. Default ACL configuration not captured in migrations (2026-05-06)

Surfaced during item 40 commit D verification. The public schema has
configured default ACLs (visible via pg_default_acl) that grant
{postgres, anon, authenticated, service_role} default permissions on
new tables, sequences, and functions. PostgreSQL's built-in default
also grants EXECUTE TO PUBLIC on new functions.

These default ACLs are NOT in any migration. If a fresh environment
is set up without the same defaults configured, the migrations would
create the schema objects but the runtime behavior would differ —
for example, functions created without TO PUBLIC might fail
permission checks for some Supabase auth flows.

The current pg_default_acl state for owner=postgres in the public
schema:

- Tables (r): postgres + anon + authenticated + service_role get
  arwdDxtm
- Functions (f): postgres + anon + authenticated + service_role get
  X (EXECUTE)
- Sequences (S): postgres + anon + authenticated + service_role get
  rwU

Plus an identical-shaped set for owner=supabase_admin.

Side note on commit D framing: D's commit message described the 8
function grants as "Dashboard-authored separately from creating
migrations." That framing is slightly wrong — those grants would
have been auto-applied via these default ACLs even without
Dashboard intervention. D's behavior is correct (the explicit
GRANT statements are harmless re-statements of what defaults
produce), only the message's mental model was off. Not worth
amending; tracking the underlying issue here.

Fix path: capture the ALTER DEFAULT PRIVILEGES statements that
produced these ACLs as a baseline migration. Investigation needed
to determine whether Supabase's project setup applies these
defaults automatically (in which case the migration documents what
the platform provides), or whether they were configured for this
specific project (in which case the migration restores them on a
fresh setup).

Coordinate with item 40's broader RLS-as-code work — defaults are
foundational infrastructure that everything else assumes.

Don't address now. Track for future hardening pass.

### 56. RPC function migrations don't include explicit GRANT EXECUTE statements (2026-05-06)

Surfaced during item 40 commit D drafting. Both
create_booking_atomic and get_bot_context migrations create their
respective functions but don't include explicit GRANT EXECUTE
statements. Production has the right grants because Supabase's
default ACLs apply automatically (anon/authenticated/service_role
get EXECUTE on new public functions) plus PostgreSQL's built-in
PUBLIC default. But this means future RPC function migrations
could ship without explicit grants and still "work" in
production, hiding the dependency on default ACLs.

Coordinated with item 55 (default ACL not captured): if defaults
ever change, every function in the codebase that relies on them
silently fails permission checks.

Fix path: establish a migration template/convention for new RPC
functions that includes explicit GRANT EXECUTE statements
alongside CREATE OR REPLACE FUNCTION. Audit existing RPC
migrations and add the missing grants to make them robust against
default ACL changes. Document in .claude-context/01_architecture.md
or a new migration-conventions.md.

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

✅ Resolved 2026-05-05 (commit ad081ee). The actual fix turned out to be
much smaller than the original gap entry suggested. Diagnostic findings
from the discovery session:

- Only one call site was actually broken: `patients.jsx:247` list-row
  chevron, passing `p.lead_id` instead of `p.id`
- "Ver ficha" button (`quickPanel.jsx:241`) was already correct
- "Cobrar" button goes to `billing/...`, not `files/...` — separate
  route contract, not item 18 scope
- A previously-unflagged 4th call site (`agenda.jsx:502`) was already
  correct
- The "masking fallback" in `files.jsx` that the original gap entry
  hypothesized didn't exist — what existed was a silent first-patient
  fallback that masked the bug differently than expected

Fix: changed `patients.jsx:247` to pass `p.id`, and removed the silent
first-patient fallback in `files.jsx` in favor of a proper empty-state
message. The `files/<patient_id>` contract is now explicit.

Two related items remain tracked separately:
- `billing/...` uses `lead_id` across both call sites — covered by item 38
- "Crear ficha" stub button in `leads/detailPanel.jsx` — covered by
  item 39 (and item 37 lead lifecycle scope)

### 20. Schema/application drift on patients.status (2026-05-05)

✅ Resolved 2026-05-05. Schema default flipped from 'activo' to 'active'
to match application convention. All 16 existing rows already had
status='active' so no backfill needed. The original "filter mismatch"
hypothesis turned out to be wrong — the patients screen has no status
filter; the field is dormant at the application layer. Drift was
cosmetic but the migration was cheap insurance against future UI
surfaces that might read this field.

### 21. Files screen does not display clinical_notes (2026-05-05)

✅ Resolved 2026-05-05 (commits 866bbe7 and bba8fc4). Original gap
entry described "files.jsx Ficha clínica panel does not display
clinical_notes despite QuickPanel showing same notes correctly."
Diagnostic revealed deeper architecture: files.jsx was treating
patients.clinical_notes as a JSON column (it doesn't exist) instead
of querying clinical_notes table joined via patient_assignments.

Display fix replicated QuickPanel's working pattern:
patient_assignments active assignment → clinical_notes by
assignment_id. Field name aligned (s.date → s.session_date).
Non-persisted type/duration_minutes fields removed from
SessionModal/SessionRow rather than left as fallback-only UI.

Pre-existing 1-row drift on Camila Reyes (test seed artifact)
self-corrects on next mutation.

Item 21 closes scoped to DISPLAY FIX ONLY. The write paths
(INSERT/UPDATE in addSession and updateSessionNotes) are present
in the code but are correctly RLS-blocked for admin users — this
is the schema deliberately enforcing that only treating
professionals write clinical notes (per Chilean Ley 20.584 on
clinical record authorship). Verifying the write path requires
a professional auth account, which is tracked as a separate item.

Hook extraction to dedupe QuickPanel + files.jsx fetch logic
deferred to Phase B (item 14-17 cluster).

**2026-05-07 addendum:** Write path also verified end-to-end as
part of item 41 closure. Pro 3 created a clinical note on Camila
Reyes via the "Nueva sesión" modal; INSERT succeeded against
clinical_notes per notes_treating_professional_all WITH CHECK
(active assignment confirmed); total_sessions counter bumped.
Both display and write paths now confirmed working.

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

### 37. Lead lifecycle — separate leads from patients architecturally (2026-05-05)

The leads screen currently mixes two distinct concerns: active prospect
management (people the bot is talking to who haven't booked yet) and
historical record-keeping (people who already converted). This produces
UX confusion — confirmed-and-booked leads still appear in the active
list with action buttons that overlap the auto-conversion logic.

Decision (2026-05-05): leads and patients are completely separate
entities. Once a patient row + appointment exist for a lead, that lead
is automatically archived. Archival trigger is appointment creation —
the unambiguous signal that the lead has converted. Payment is a
downstream concern that doesn't invalidate the conversion.

The leads screen becomes:

- Active list: only leads still in conversation with the bot, no
  appointment yet
- Archived list: leads that converted, kept for metrics + outbound
  retargeting + historical reporting
- No "Crear ficha" or "Convertir a paciente" buttons. Conversion is
  automatic, driven by booking success (specifically, appointment
  creation)

Optional enhancement (also deferred): when a lead converts, allow the
bot or system to write a "pre-session comment" to the new patient's
ficha — a short summary of the patient's stated reason for treatment,
captured during the lead conversation. This would carry context from
the lead phase into the clinical phase without conflating the entities.

Schema implications:

- Leads table needs a terminal lifecycle state ("converted" or
  "archived") OR a foreign key relationship to patients (e.g.,
  `leads.converted_patient_id`)
- Booking-success flow (Make.com or Edge Function) needs to set this
  state when an appointment is created for a lead
- Leads screen filter logic needs to exclude archived leads from
  default view
- The patients table may need an `originating_lead_id` link for the
  metrics view

This is a Phase 2 / bot polish session task. Touches the leads screen,
the booking flow, the schema, and possibly the patient ficha (for the
pre-session comment). Plan it as one architectural session, not
piecemeal.

### 38. billing/... routes use lead_id while files/... uses patient_id (2026-05-05)

Two call sites navigate to `billing/...`:
- `src/screens/patients/quickPanel.jsx:243` — "Cobrar" button passes
  `p.lead_id`
- `src/screens/files.jsx:271` — passes `patient.lead_id`

The two call sites are internally consistent with each other but
inconsistent with the `files/...` contract (which now uses
`patient_id` post item 18). The billing screen's URL parameter
parsing currently expects `lead_id`.

Decision needed: should `billing/...` migrate to `patient_id` for
consistency, or stay on `lead_id`? Arguments either direction:

- For `patient_id`: matches `files/...` contract, clinical resources
  keyed by patient identity. Patient may have multiple invoices
  spanning multiple leads if rebooked from new lead conversation.
- For `lead_id`: invoices are often generated from the booking flow
  which is naturally lead-scoped. The current code may rely on
  lead-keyed lookups for unpaid-invoice surfacing.

Surfaced 2026-05-05 during item 18 work. Tackle as a focused
normalization task once billing flows are otherwise stable.

### 39. Stub "Crear ficha" button in leads/detailPanel.jsx (2026-05-05)

Single match in `src/screens/leads/detailPanel.jsx:31` — a button
labeled "Crear ficha" with no `onClick` handler. Does nothing when
clicked.

Per item 37 (lead lifecycle separation), the conversion from lead to
patient is now intended to be automatic when an appointment is
created, not manually triggered from the leads screen. This stub
button should be removed entirely as part of item 37's scope, or
earlier if a leads-screen pass happens before the bot polish session.

Already partially flagged in Phase A "Observed during refactor (not
fixed)" notes.

### 43. AI summary card not displayed in ficha clínica + caching strategy (2026-05-05)

The QuickPanel on the patients screen displays an AI-generated
summary of the patient's clinical history. The full ficha clínica
on files.jsx does not show this summary, even though it's the
more clinical-context-rich view where the summary would be more
useful.

Caching consideration (per Hector 2026-05-05): the summary is
currently cached after first load and only invalidated when a
clinical note is added or updated. When the shared summary
component is built, the cache should be shared between QuickPanel
and files.jsx — if either screen updates a note, both screens see
the refreshed summary. Don't build per-screen caches.

Fix path: extract the summary rendering and fetch logic from
QuickPanel into a shared component or hook (likely
useClinicalSummary or ClinicalSummaryCard) with shared cache.
Render in both QuickPanel and files.jsx. Coordinate with item
14-17 hook extraction work in Phase B since the clinical_notes
fetch is already a candidate for extraction.

### 44. Ficha clínica session sort order toggle (2026-05-05)

The Historial de sesiones in files.jsx sorts sessions in a fixed
order (currently old to new based on session_date ascending). Add
a toggle to let the user reverse the order — useful for
psychologists who want to see the most recent session first when
reviewing a patient.

Small UX feature. Single comparator flip controlled by a useState
toggle. Track for whenever a ficha-screen polish pass happens.

### 45. Nueva sesión modal too sparse — needs richer field set (2026-05-05)

Item 21's fix (Option A) removed the unfillable type and
duration_minutes fields from SessionModal because the schema
didn't persist them. The result is a modal with only Fecha and
Notas, which is too spartan for real clinical use. A psychologist
logging a session typically wants to record:

- Fecha and Hora (when the session happened)
- Tipo de sesión (was this Consulta individual? Pareja? Familiar?)
- Profesional (which psychologist conducted it)
- Notas (the clinical content)
- Optional: pre-fill defaults from the patient's most common past
  pattern

This is a design decision, not a simple field addition. Three
possible models:

- Model A: "Nueva sesión" creates clinical_notes for an existing
  past appointment. Modal becomes an appointment selector + notes
  textarea. All other fields auto-fill from the appointment row.
- Model B: "Nueva sesión" creates a free-form clinical record
  without an appointment. Modal needs full field set including
  type/professional/duration. Requires schema additions to
  clinical_notes (or denormalized fields).
- Model C: Hybrid — pre-fill from past appointment if user picks
  one, allow manual entry otherwise.

Decision needs to be made deliberately. Coordinate with the
duration architecture work since the modal will need to read
service-level duration once that lands.

### 46. Centro-level feature toggles via clients.config.features JSON (2026-05-05)

Architectural decision (2026-05-05): centro-level features
(admin_can_view_clinical_notes, bot_telegram_enabled,
bot_intraweb_enabled, etc.) are stored in clients.config.features
as a JSON object. Toggles are SUPERADMIN-CONTROLLED — centros
consume the decisions but cannot change them in their own
dashboard. RLS policies and feature gates read from this JSON.

Defaults are restrictive (off). Features are explicitly granted
by the platform operator, never auto-enabled.

First toggle to implement: admin_can_view_clinical_notes
(READ-ONLY admin access to clinical notes for centros where the
platform operator has determined the centro qualifies — e.g.,
admin is also a licensed professional, or centro has appropriate
consent flows). Update notes_admin_with_consent policy to read
from this toggle instead of per-patient consent flags.

Until the superadmin dashboard UI exists (Phase 3), toggles are
flipped via direct SQL UPDATEs on clients.config.

Implementation order:
1. Define the features JSON schema in clients.config (just
   documentation; no migration needed since clients.config
   already exists)
2. Update RLS policies that need to read toggles
3. Eventually build the superadmin dashboard UI to manage them
   visually

This depends on item 40 (RLS-as-code) being done first so the
new policies are properly version-controlled.

### 47. Certificado de atención feature implementation (2026-05-05)

The "Certificado de atención" button at files.jsx:248 is a stub
with no onClick handler. Per Hector 2026-05-05, this is a
placeholder for a planned feature: instant generation of an
attendance certificate from patient information. Not currently
implemented but explicitly intended for future work.

Distinct from the now-removed "Exportar PDF" button (which was
unplanned dead UI). This stub stays as a UI placeholder for the
planned feature.

Fix path: implement the certificate generation flow. Likely
involves:

- A template document with placeholders (patient name, RUT,
  sessions attended, professional, dates, etc.)
- A PDF generation library (jsPDF, pdf-lib, or server-side via
  Edge Function)
- Form to capture optional fields the certificate may need
  (purpose, recipient, etc.)
- Download or email the generated PDF

Track as a planned-not-implemented feature, not a stub-cleanup
target.

### 48. Smart defaults in Nueva sesión modal (2026-05-05)

When a psychologist clicks "Nueva sesión" for an existing patient,
the modal should pre-fill:

- Fecha: today's date (already done)
- Tipo de sesión: the patient's most common past session type
- Profesional: the active assignment's professional
- Hora: current time rounded to nearest valid slot

Reduces typing burden for the common case (logging a session with
the same professional/type as before). Can fall back to empty if
the patient has no past sessions.

Depends on item 45 (richer modal) being designed first.

### 49. Notes layout organization in ficha clínica (2026-05-05)

Per Hector 2026-05-05 smoke testing observation: the Historial de
sesiones notes display in files.jsx is "not well organized as the
ficha." Specific concerns not yet identified — likely visual
hierarchy, spacing, alignment, or grouping issues.

Track for a future ficha-screen polish pass. Specific issues to be
enumerated when that pass is scheduled. Coordinate with item 43
(summary integration) and item 44 (sort toggle) since they're all
ficha-screen UI work.

### 52. appointments_professional_own allows DELETE; should be soft-delete pattern (2026-05-06)

The `appointments_professional_own` policy is `FOR ALL`, meaning
treating professionals can SELECT, INSERT, UPDATE, AND DELETE
their own appointments via the SPA.

Surfaced during item 40 baseline RLS discovery (2026-05-06).
DELETE creates orphan billing/clinical records and loses audit
trail:

- invoices.lead_id (and patient_id) survive but the appointment
  context for them is gone
- conversions.lead_id references the lead which still has the
  appointment-flow history but no appointment row
- clinical_notes.assignment_id survives via patient_assignments,
  but no appointment record of when the session was scheduled
- Audit trail for cancellations, no-shows, billing disputes is
  lost

Best-practice pattern: appointments are soft-deleted via
`status = 'cancelled'`. The application already treats 'cancelled'
as the soft-delete marker — agenda's status filters, the
citaModal status dropdown, eventBlock/monthGrid render paths,
and create_booking_atomic's slot-conflict query (which filters
`status IN ('pending_payment', 'confirmed')` — already excludes
cancelled rows from re-booking blocks) all assume this
convention. But the appointments.status column is free-form text
with no CHECK constraint or enum — the convention is enforced by
application code, not by the schema.

Fix scope: split appointments_professional_own into two
policies — SELECT + UPDATE for treating professionals (no INSERT,
no DELETE), and INSERT scoped to the booking flow / admin only.
Update agenda's cita-deletion UX to issue a status update
instead of a DELETE.

Schema-level hardening (optional, in same pass): add a CHECK
constraint enumerating the valid status values
('pending_payment', 'confirmed', 'completed', 'cancelled',
'no_show'). This formalizes what's currently a code convention
and prevents drift if a future caller writes an unexpected
value. Not strictly required for the policy fix to work — the
soft-delete behavior already works at the application + RPC
layer — but would close the schema/application drift.

Worth a deliberate decision before tackling — the SPA's current
deletion UX (agenda's citaModal) sends a DELETE on cancel, and
the change ripples through the realtime subscription pipeline in
agenda.jsx.

### 53. Missing set_updated_at triggers on clinical_notes and patient_assignments (2026-05-06)

✅ Resolved 2026-05-06 (commit f2f996f). Both BEFORE UPDATE
triggers added — set_clinical_notes_updated_at and
set_patient_assignments_updated_at, both firing
public.set_updated_at(). Behavioral test confirmed: updated_at on
clinical_notes row 58aeea00-cfa6-4bb7-9a76-314794595642 moved
from 2026-05-05 01:24:04 to 2026-05-06 22:41:26 after a no-op
update.

### 57. patients_professional_active_assignment is FOR ALL — allows professionals to modify patient identity fields (2026-05-06)

The patients_professional_active_assignment policy is FOR ALL,
allowing treating professionals to UPDATE patient identity fields
(full_name, rut, email, phone, address, etc.) for any patient
with an active assignment with them. This is similar in shape to
gap 52 (appointments_professional_own DELETE).

The clinical scope of a treating professional arguably shouldn't
include modifying patient identity records — that's
admin/receptionist territory. Identity changes (RUT correction,
email update, address change) should typically be admin-managed.
Professionals need read access for clinical context and possibly
UPDATE on clinical-relevant fields (medication, diagnosis,
notes), but full identity modification is broader than the role
requires.

Surfaced during item 40 commit C chunk 2 review (2026-05-06).

Fix path: split the policy into separate concerns — SELECT for
read access plus UPDATE limited to clinical fields (medication,
diagnosis, notes-related columns). Identity fields stay
admin-only. Coordinate with the broader admin/professional
permission boundary work; this is similar in shape to the centro
feature toggle pattern (item 46).

### 58. users_admin_write is FOR ALL — admins can DELETE user rows (2026-05-06)

The users_admin_write policy is FOR ALL, allowing admins to
INSERT/UPDATE/DELETE rows in public.users. DELETE is included.
This:

- Doesn't delete the auth.users row (separate table managed by
  Supabase Auth)
- Does break the linkage between auth.users and public.users
- Means the user can still authenticate but my_client_id()
  returns null after deletion, effectively locking them out

This may be intended behavior (admins can offboard users without
going to the Auth admin UI). But if so, it should be documented;
if not, the policy should be split into INSERT/UPDATE only.

Surfaced during item 40 commit C chunk 3 review (2026-05-06).

Fix path: decide whether DELETE should be allowed. If yes,
document in 01_architecture.md or create a "soft offboarding"
pattern that also handles the auth.users side. If no, split
policy into FOR INSERT and FOR UPDATE separately.

---

### Pro mode UX cluster (items 59-64)

The following six entries (59-64) all surfaced during item 41's
Pro 3 smoke test on 2026-05-06. They share a root cause: pro
mode UX hasn't received a deliberate design pass. Pro mode
currently works at the foundational level (auth, RLS, nav
restriction, screen routing), but the surfaces that DO render in
pro mode show admin-view UI without pro-specific adaptation. May
be bundled in a future "pro mode UX pass" focused session.

Items 59-63 are MEDIUM priority; item 64 is LOW priority and
sits in the LOW section below.

---

### 59. Sidebar shows email instead of professional full_name in pro mode (2026-05-06)

When logged in as a professional, the sidebar header shows the
auth user's email (e.g., PROF3@TEST.CL) instead of the
professional's display name (e.g., "Profesional 3"). Cosmetic
but obvious — first thing a real professional notices.

Fix path: in shared.jsx Sidebar component, when ctx.professional
is non-null, render professional.full_name instead of
session.user.email. The data is already in ClientCtx (App.jsx
loads the professionals row when session + clientId are present).

Surfaced during item 41 smoke test.

### 60. Ajustes screen empty for professionals (2026-05-06)

When Pro 3 clicks Ajustes, the screen renders without useful
content. The current settings view is designed for admins
(centro config, billing settings, professional management). Pro
mode needs a different view — likely the professional's own
profile (full_name, email, photo, schedule, public_profile flag,
document uploads). Currently empty rather than tailored.

Needs design decision: read-only profile, editable profile, or
skip Ajustes entirely for pros (in which case 'settings' should
be removed from Sidebar's proAllowed list and from App.jsx's pro
allowed-screens list).

Surfaced during item 41 smoke test.

### 61. Profesional selector unnecessary in Nueva cita when in pro mode (2026-05-06)

The Nueva cita modal shows a "PROFESIONAL" select dropdown. In
pro mode, the only valid value is the logged-in professional
themselves — the selector adds friction without function. Should
be hidden, OR pre-filled-and-disabled showing the pro's name.

Fix path: in agenda.jsx / citaModal.jsx, conditionally render the
selector based on isPro. Pre-fill professional_id with
my_professional_id() value (already available via ClientCtx).

Surfaced during item 41 smoke test.

### 62. Cannot create new patients from pro mode (intentional, but UX needs adjustment) (2026-05-06)

Two intertwined concerns:

1. "Nuevo paciente" button at patients.jsx:176 has no onClick
   handler (pre-existing stub flagged in Phase A retro but not
   previously tracked).
2. Even if functional, pro mode shouldn't expose
   patient-creation. patients_professional_active_assignment WITH
   CHECK requires a pre-existing patient_assignments row —
   chicken-and-egg makes pro INSERT fail anyway. Patient creation
   is admin/receptionist territory per Chilean clinical norms.

Fix path: implement patient creation for admin mode (item 39
territory), AND hide "Nuevo paciente" button in pro mode. Pro
mode users only book appointments for EXISTING patients (search
by name/RUT/email, not create). This was confirmed as the right
architectural direction during 2026-05-06 conversation.

Surfaced during item 41 smoke test on the Nueva cita modal RLS
error: "No se pudo crear paciente: new row violates row-level
security policy for table 'patients'."

### 63. Apariencia in Ajustes doesn't save changes (2026-05-06)

Theme/appearance settings in Ajustes don't persist after change.
Could be:

- Write-permission RLS issue (pro mode lacks UPDATE on whatever
  table backs the settings)
- Save handler bug (no actual write call wired up)
- State management issue (local state updates but no persistence
  call)

Diagnostic needed before fix path. Worth checking what storage
backs apariencia (clients.config? public.users.preferences?
localStorage only?).

Surfaced during item 41 smoke test.

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

### 14. Extract data hook from agenda.jsx shell (2026-05-04) **[PHASE B / DEFERRED]**

`src/screens/agenda.jsx` shell is ~500 lines after Phase A split. Most of
that is JSX layout plus a single data-loading useEffect that combines:
professional fetching, schedule hydration, appointment query, patient
+ session-type catalogs, and a realtime subscription.

Future work: extract `useAgendaData()` hook to encapsulate the effect,
trim shell toward ~300. Non-mechanical, deferred until Phase B or later.

### 15. Extract save/form hook from citaModal (2026-05-04) **[PHASE B / DEFERRED]**

`src/screens/agenda/citaModal/index.jsx` shell is ~575 lines after Phase A
split. The bulk is `performSave` (~175 lines: validation, past/off-schedule
warnings, conflict check, patient INSERT with sticky-id dedup, patient_
assignments INSERT, appointment INSERT/UPDATE, error mapping) plus a
17-prop `PatientPicker` interface that signals state ownership wants
restructuring.

Future work: extract `useCitaForm()` hook to encapsulate save/delete
pipelines and form state, collapse the PatientPicker prop interface to
a single `form` object. Non-mechanical, deferred until Phase B or later.

### 16. Extract editor save hook from professionals (2026-05-04) **[PHASE B / DEFERRED]**

`src/screens/professionals/professionalEditor.jsx` orchestrator is ~470
lines after Phase A split, dominated by `syncSchedules` (insert/update/
delete diff for schedules) + `syncOffered` (insert/update/delete diff
for session_types) + `handleSave` (~144 lines combined).

Future work: `useProfessionalEditor()` hook to encapsulate the save
pipeline + state diffing. Non-mechanical, deferred until Phase B or later.

### 17. Extract leads list + state hook (2026-05-04) **[PHASE B / DEFERRED]**

`src/screens/leads.jsx` shell is ~330 lines and `leads/leadsList.jsx`
takes ~22 props after Phase A split. The list panel needs `useLeadsList()`
(or split as `useLeadsState()` + `useResizableColumns()`) to encapsulate
state + column geometry (ResizeObserver, ratio normalization, neighbor-pair
resize, sort/filter pipeline).

Future work: extract hook(s) to collapse the prop interface and isolate
the resize logic for reuse. Non-mechanical, deferred until Phase B or
later.

### 19. Patients screen list panel is not scrollable (2026-05-05)

✅ Resolved 2026-05-05 (commit e929ffb). List panel column at patients.jsx:186
was missing `overflow: 'hidden'` — the single declaration that establishes
a clipping context for grid items, letting the inner flex:1 + overflow:auto
rows wrapper scroll within bounded height. Matches the leads.jsx +
leadsList.jsx precedent for the same two-panel layout. Likely a
transcription oversight from the Phase A patients.jsx shell construction.

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

### 54. SECURITY DEFINER functions missing explicit search_path (2026-05-06)

Three of the five auth helper functions explicitly set
`search_path TO 'public'`: is_admin_of_client, is_super_admin,
my_professional_id. Two do not: my_client_id, handle_new_user.

Surfaced during item 40 baseline RLS discovery (2026-05-06).
SECURITY DEFINER functions without an explicit search_path are
vulnerable to schema-shadowing attacks — if a malicious user can
create objects in a schema that's earlier in the resolved
search_path, they can hijack table references inside the
function. The standard hardening is `SET search_path = 'public',
'pg_catalog'` (matching the convention used by
create_booking_atomic).

Risk: low in practice. The attack requires CREATE privilege in
some schema visible to the function's call path, and Supabase's
default role grants don't enable that. But it's a well-known
PostgreSQL footgun and the inconsistency suggests these two
functions were authored before the convention was adopted.

Fix scope: add `SET search_path = 'public', 'pg_catalog'` to
my_client_id and handle_new_user. Two-line fix per function.
Captured AS-IS in the item 40 baseline; tighten in a follow-up.

### 64. BOT ACTIVO sidebar block visible in pro mode (2026-05-06)

The "BOT ACTIVO — Responde en WhatsApp y califica leads
automáticamente" block at the bottom of the sidebar shows in pro
mode. Bot configuration is admin/operations territory;
professionals have no relationship to bot management. Should be
hidden when isPro, similar to the Cobrar button treatment in
item 41 (commit 0684d84).

Fix path: in shared.jsx Sidebar, wrap the BOT ACTIVO block in
`{!isPro && (...)}`.

Part of the items 59-64 pro mode UX cluster (see meta framing
in MEDIUM section). Surfaced during item 41 smoke test.

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

---

## RECOMMENDED ORDER OF EXECUTION

Tier 1 (next): items 20, 19, 18, 21
Tier 2: appointments.duration default, drop closing_question column, patient dedup (Edge Function + dashboard)
Tier 3: dead code cleanup PR, then Phase B hook extraction (14-17)
Tier 4: Phase 3 features (28-30)
Tier 5: bot polish session — addressed holistically as architectural work, not piecemeal
