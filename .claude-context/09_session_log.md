# Session Log

Append-only log of significant work sessions. Most recent at top.

---

## 2026-05-07 — Items 50/51 RLS hardening + β architecture cutover

Six-commit closure of the two RLS exposure gaps that surfaced during
item 40's baseline discovery, plus a coordinated SPA architectural
migration (β cutover) replacing the conflated `useClient` /
`ClientCtx.config` path with separate bootstrap and full-config hooks.

### Items resolved

- ✅ Gap 50 (`clients_public_lookup` exposes clients.config to anon):
  resolved. Replaced with `get_public_centro_info(p_slug)` SECURITY
  DEFINER function exposing only the safe-public display whitelist
  (id, slug, name, theme_id, modo_empresa, empresa_nombre, brand_name,
  avatar_url, modules), plus admin-only `clients_admin_read_own`
  policy for full config jsonb. Old policy dropped.

- ✅ Gap 51 (`professionals_public_read_active` exposes email +
  user_id to anon): partially resolved. Anon exposure closed via
  `professionals_authenticated_read_active` (authenticated, scoped
  to caller's client_id). The eventual `get_public_professionals(
  p_slug)` for the public profile page is deferred to gap 66's
  data-model session, since the whitelist depends on the planned
  `professional_profiles` vs `professional_employments` split.

### Six-commit β cutover sequence

| # | Hash | Purpose |
|---|---|---|
| 1 | `ced25c4` | Parallel auth-hardening infrastructure: SECURITY DEFINER function, new policies, new SPA hooks (`useClientBootstrap`, `useClientConfig`), new `ClientConfigCtx` |
| 2 | `1e08cc0` | Sidebar reads display keys from `useClientBootstrap` |
| 3 | `1ce2322` | App.jsx self-migration (theme effect, profileIncomplete derivation, loading gate) |
| 4 | `590bfed` | Settings (×6) + agenda.jsx consumer migration |
| 5 | `6a04e64` | Drop legacy anon policies; delete useClient.js; close gaps 50/51 |

### Architectural decisions locked in

1. **Two-stage SPA config hydration.** Pre-login, `useClientBootstrap`
   fetches the safe-public subset via the SECURITY DEFINER function.
   Post-login (admin only), `useClientConfig` fetches the full clients
   row via the admin-only policy. Pros consume only the bootstrap
   subset; their `useClientConfig` fetch returns null (handled
   gracefully via `.maybeSingle()`). This formalizes the read-only
   anon path vs the read-write admin path that the previous single-
   stage `useClient` had conflated.

2. **`config.features` (gap 46 toggles) stays admin-only.** The
   bootstrap whitelist explicitly excludes the `features` jsonb
   subkey. Superadmin-controlled centro toggles (e.g.,
   `admin_can_view_clinical_notes`) never leak to anon visitors or
   to pro-mode authenticated users. Keeps gap 46's threat model
   intact.

3. **`public_profile` is centro-owned, not pro-owned.** Per Hector
   2026-05-07: the centro decides which professionals are featured
   on the eventual public profile page after offline agreement
   between centro and professional. This influences gap 66's table-
   split design — `public_profile` belongs in
   `professional_employments`, not `professional_profiles`.

4. **Admin role is not monolithic.** Centro admins split into admin-
   owners (licensed psychologists, clinical authority per Ley
   20.584) and admin-receptionists (operations only, no clinical
   sight). The data model implicitly distinguishes them via the
   professionals/professional_profiles `user_id` link. New gap 67
   captures this — implementation is `is_admin_with_clinical_authority(
   p_client_id)` helper combining admin role + professional link +
   centro toggle.

5. **Effect-driven duplicate fetches are tolerable in the cutover
   window.** Three independent `useClientBootstrap` calls (App.jsx,
   Sidebar, agenda.jsx) and `useClientConfig`'s double-fire on login
   are aesthetic concerns, not bugs. Captured as gap 68 for a future
   effect-dep hygiene pass.

### New gaps logged

- **Gap 66** — Professionals data model refactor (MEDIUM priority).
  Split `public.professionals` into `professional_profiles` (pro-
  owned, presentation) and `professional_employments` (centro-
  owned, operational). Resolves gap 65, refines gap 57, completes
  deferred half of gap 51. Tackle as one focused session.

- **Gap 67** — Admin-owner vs admin-receptionist clinical authority
  (MEDIUM priority). Refines gap 46. Requires gap 66's data model
  for clean implementation.

- **Gap 68** — SPA effect-dep hygiene (LOW priority). Both
  multiplexing patterns from this session (`useClientBootstrap` ×3
  per page, `useClientConfig` ×2 per login) are aesthetic; tackle
  in a focused pass when needed.

### Discoveries during the session

1. **Sidebar's reliance on `clients_public_lookup`** wasn't
   immediately obvious. The pre-existing policy was the *only* read
   path for `clients.config` for any role in the SPA — pros'
   sidebar (modules, brand_name, avatar_url) depended on it.
   Dropping it without first migrating Sidebar to bootstrap would
   have broken pro-mode UI. Surfaced during commit 5 planning.

2. **`useClientConfig` for pros returns PGRST116** (PostgREST
   "Cannot coerce result to single JSON object" — zero rows).
   Hook handles correctly via `.maybeSingle()`. Visible as red-X
   in network panel; not a SPA crash. Verified in commit 6 smoke
   test.

3. **Theme effect race condition under β migration.** Original
   draft of commit 4 left `if (!config) return` guard inside the
   theme effect that depended on `bootstrap.themeId`. If bootstrap
   resolved first, guard rejected (config still null), theme bailed,
   and a later config-resolution wouldn't re-fire the effect since
   `[bootstrap.themeId]` hadn't changed. Result would have been
   silent default-theme fallback on some page loads. Code flagged
   pre-commit; guard removed in EDIT 6 of commit 4 (since
   `getTheme(null)` safely returns the default).

4. **`config.modo_empresa` reads in agenda.jsx must come from
   bootstrap, not config.** agenda.jsx renders for both admin and
   pro modes. Reading `modo_empresa` from `useClientConfig` would
   make pros silently see "single mode" (since their fetch returns
   null), but `modo_empresa` is centro state — same regardless of
   role. Bootstrap's anon-callable function returns the same value
   for any caller. This decision shaped commit 5's split: 6
   settings files use `useClientConfig` (admin-only), agenda.jsx
   uses `useClientBootstrap` (any role).

### Migration files captured

- `20260507120000_clients_professionals_auth_hardening_additive.sql`
  — initial parallel infrastructure (function, two new policies).
  Captured AS originally drafted, including the corrections that
  followed.
- `20260507120100_correct_clients_professionals_hardening.sql`
  — corrections applied after the first migration ran (function
  whitelist widened to include brand_name, avatar_url, modules;
  `clients_authenticated_read_own` replaced with admin-only
  `clients_admin_read_own`).
- `20260507130000_drop_legacy_anon_policies.sql`
  — final drops closing the cutover.

The two-file capture for the same logical migration (one initial,
one correction) is unusual but honest — the production DB went
through both states. Future fresh-environment runs apply both files
in sequence.

### Strategic position update

Items 50 and 51 were the highest-priority RLS exposure items
remaining after the items 40/41/42 closure on 2026-05-06/07. With
both resolved (50 fully, 51 the anon half), the SPA's auth surface
is now hardened against the anon-enumeration attack vectors gap 50
flagged. Centro feature toggles (gap 46) when implemented will not
leak to non-admin users.

Vitalis launch readiness: still bounded by Phase 3 work (Mercado
Pago integration, Vitalis-specific onboarding, super-admin
dashboard for toggle management), not by RLS. Gap 66 (data model
refactor) and gap 67 (admin-owner distinction) are valuable
architectural cleanups but not launch blockers — the current
single-table model works, and the absence of the admin-owner
distinction means the gap-46 toggle just hasn't shipped yet.

### Recommended next sessions

1. **Gap 66 (data model refactor)** — biggest standalone win.
   Resolves multiple smaller gaps (57, 65), enables clean
   implementation of gaps 51 (deferred half), 67. One focused
   session, ~item-40 scope.

2. **Gap 46 + gap 67 jointly** — implement centro feature toggles
   alongside the admin-owner clinical-authority helper. Both
   touch the auth model and `notes_admin_with_consent` policy.

3. **Items 59-64 pro-mode UX cluster** — deferred since item 41.
   Cleaner once gap 60 (pro-mode Ajustes content) has a clear
   target after gap 66's data split.

4. **Gap 68 effect-dep hygiene** — defer until performance
   audits or unrelated effect-dep cleanup pulls it into scope.

---

## 2026-05-05 → 2026-05-07 — Tier 1 closure + architectural alignment

Continued the dashboard-first strategic refocus from earlier 2026-05-05
session. Closed all four Tier 1 items.

### Items resolved

- Item 20 ✅ (commit 96ebd94 + 2750405): patients.status default
  flipped from 'activo' to 'active'. Diagnostic revealed the original
  "filter mismatch" hypothesis was wrong — patients screen has no
  status filter; the field is dormant at the application layer.
  Cosmetic migration was cheap insurance.
- Item 19 ✅ (commit e929ffb): list panel scroll fixed by adding
  overflow:hidden at patients.jsx:186, matching leads.jsx +
  leadsList.jsx precedent for the same two-panel layout.
- Item 18 ✅ (commit ad081ee): files/<patient_id> URL contract
  enforced. Single broken call site (patients.jsx:247 chevron
  passing lead_id) corrected; silent first-patient fallback in
  files.jsx removed in favor of proper empty-state. Original gap
  entry framing was overstated — only one call site was actually
  broken; the "masking fallback" hypothesis didn't match what the
  code did.
- Item 21 ✅ (commits 866bbe7 + bba8fc4, scoped to display fix):
  files.jsx clinical_notes display path replaced (was reading
  non-existent patients.clinical_notes JSON column; now queries
  clinical_notes table via patient_assignments). Field name aligned
  (s.date → s.session_date). Non-persistable type/duration_minutes
  fields removed from SessionModal/SessionRow. Write paths present
  in code but RLS-blocked for admin users — correct schema
  enforcement of treating-professional clinical authorship.

### Other commits

- 8f8d3c4: bumped item 36 (update-context.sh script breakage) to
  HIGH priority — the script wipes the schema doc before
  regeneration, so a failed run leaves docs empty. Destructive
  failure mode warrants HIGH.
- 9378ed1: items 38 + 39 added during item 18 work (billing/...
  lead_id inconsistency, "Crear ficha" stub button cleanup).
- ad081ee: item 18 fix.
- bba8fc4: Exportar PDF dead button removal (separate commit per
  Path A two-commit sequence).
- 5a14337: item 21 marked resolved in 08_known_gaps.md.
- 7c389a4: items 40-49 batch covering RLS-as-code, professional
  auth provisioning, auth model docs, summary in ficha, sort
  toggle, richer modal, feature toggles architecture, certificado
  as planned feature, smart defaults, notes layout.

### Architectural decisions locked in

1. **Centro feature toggles via clients.config.features JSON.**
   Superadmin-controlled (platform operator), centro-consumed
   (cannot change in own dashboard). Defaults restrictive. RLS
   reads from this JSON. First toggle to implement:
   admin_can_view_clinical_notes (read-only admin access for
   centros where the platform operator has determined eligibility
   per Chilean Ley 20.584 on clinical authorship).

2. **Clinical notes write authority is professionals-only by
   schema design.** Admins never write. The toggle (#1) allows
   admins read access where appropriate; never write.
   Receptionists never read or write.

3. **Auth model is 90% in place, not a new project.** Discovery
   revealed App.jsx already detects pro vs admin mode via
   professionals.user_id linkage; pro-mode nav restriction already
   exists. What's missing: a test professional account +
   documentation + RLS captured in migrations. Item 21's write
   path is testable as soon as item 41 (test pro provisioning)
   lands.

4. **RLS policies and helper functions are not version-controlled.**
   They live only in the live Supabase database. This is the
   foundation issue — the auth model is currently unreproducible
   across environments. Item 40 addresses this and should precede
   other RLS work.

### Strategic positioning

Closer to Vitalis launch than the earlier 2026-05-05 framing
suggested. Not "build new dashboards over weeks" — more like
"verify existing pro-mode path with test account + capture RLS in
migrations + document the auth model + flip the admin-view toggle
for Vitalis." Probably 3-5 focused sessions away from launch-ready.

### Recommended next sessions

1. Item 40: RLS-as-code housekeeping (foundation; pull current
   policies + helper functions into version-controlled migrations)
2. Item 41: Provision test professional auth account; verify Item
   21 write path end-to-end
3. Item 42: Document auth/role model in .claude-context/
4. Item 46 (admin_can_view_clinical_notes toggle): Implement via
   clients.config.features and update RLS to read from it
5. Resume Tier 2: duration architecture, closing_question removal,
   patient duplication

### Notes from this session worth preserving

- Original gap entry framings were repeatedly overstated relative
  to actual code state. The discipline of "discovery → diagnosis
  → plan → apply" caught this each time and kept fixes
  appropriately scoped.
- Diagnostics need to ask "what's the intended permission model?"
  before assuming "policy missing." The clinical_notes RLS error
  initially looked like an oversight; it was actually deliberate
  role separation.
- The schema enforces a more sophisticated multi-role model than
  the dashboard UX assumes. This mismatch will keep surfacing
  until the dashboard's auth model catches up. Items 40-42 begin
  closing that gap.

### Item 40 complete (2026-05-06)

RLS-as-code housekeeping landed in five commits + two
doc-resolution commits.

Discovery phase: 6-query SQL pack run via Supabase Dashboard SQL
editor (supabase db dump and update-context.sh both blocked by
infrastructure issues, both tracked separately as items 36 and a
new docker-dependency observation). Found 18 public tables, 49
RLS policies, 6 functions, uniform 7×3 grant pattern across 20
objects (18 tables + 2 views).

Migration sequence:

- A (fcaeaa4): docs(gaps) for 5 surprises
- B (14f39e3): baseline helper functions + handle_new_user trigger
- C (760b0f7): 49 RLS policies across 18 tables (522 lines)
- D (4bb7a65): table + function grants on 20 objects + 8 functions
- E (f2f996f): two missing updated_at triggers (resolves gap 53)

Plus 2 doc commits (93392b6 to mark items 40 and 53 resolved;
dfdecd1 to add 3 more new gap entries 56, 57, 58 covering RPC
migration grant conventions, patients_professional_active_assignment
scope, users_admin_write DELETE permissions). Gap 55
(716cd70) — default ACL not captured in migrations — surfaced
mid-sequence.

Discoveries during the work:

1. Supabase's default ACLs grant EXECUTE on public functions to
   {postgres, anon, authenticated, service_role} automatically —
   meaning many "missing" function grants weren't ever
   Dashboard-authored, just default-applied. Tracked as new gap
   entry 55: default ACL configuration not captured in
   migrations.
2. PostgreSQL's built-in PUBLIC default grants EXECUTE on every
   new function unless explicitly REVOKEd. Production has this
   for all 8 functions in scope.
3. The auth model is more sophisticated than initially
   documented: super_admins table exists, users.role
   distinguishes 'admin'/'owner'/'professional',
   professionals.user_id wires auth users to professional
   records, and the dashboard already implements pro-mode
   detection. No new auth infrastructure is needed — what's
   missing is documentation (item 42) and a test professional
   account (item 41).

The auth/security model is now version-controlled and
reproducible. Future environments can recreate production state
from migrations alone, modulo the default ACL configuration
which still depends on Supabase's project setup defaults.

### Recommended next sessions (updated)

1. Item 41: Provision test professional auth account; verify
   Item 21 write path end-to-end (small task)
2. Item 42: Document auth/role model in .claude-context/
   (companion to item 40)
3. Items 50, 51 jointly: tighten clients_public_lookup and
   professionals_public_read_active exposure via SECURITY
   DEFINER function pattern (RLS hardening pass)
4. Item 46 + 55 (default ACL): centro feature toggles via
   clients.config.features + capture default ACL state
5. Tier 2 work: duration architecture (now properly designed as
   Option 1), closing_question removal, patient duplication

### Strategic position

Tier 1 fully closed. Item 40 (the largest single architectural
item discussed in pre-launch planning) closed. Vitalis launch
readiness is now bounded by items 41-42 (small tasks) plus
optional hardening of items 50-54. Realistic launch-readiness
from current state: 2-4 focused sessions.

### Item 41 + 21 closure (2026-05-07)

Item 41 closed: test professional auth account provisioned for
Profesional 3 (prof3@test.cl / Pro3Test2026!, auth user
e4ff8c48-ca93-4422-8701-9d229b660c66). Linkage: auth.users →
public.users (via manual INSERT since handle_new_user trigger
only fires AFTER INSERT and we set raw_user_meta_data after
creation) → professionals (via UPDATE professionals.user_id).

Item 21 fully closed: clinical_notes write path verified
end-to-end. Pro 3 successfully saved a clinical note for Camila
Reyes (b95b58cf-...). RLS policy notes_treating_professional_all
permits the write because pa.professional_id matches
my_professional_id() and pa.status = 'active'.

Routing fix mid-session (commit 0684d84): App.jsx pro-mode
allowed screens list was conflated with Sidebar's nav-visibility
list. Fixed by separating concerns — files added to allowed
screens for ficha access, billing remained excluded as
admin-only. Cobrar buttons hidden in QuickPanel and files.jsx
when isPro. The two lists (App.jsx allowed vs shared.jsx
proAllowed) now correctly serve different purposes.

Six new gap entries (59-64) catalogued from smoke test
findings — all pro mode UX gaps, see meta framing in
08_known_gaps.md for the bundling context.

### Strategic position update

Pro mode is now functionally usable: a real professional could
log in, see their patients, view fichas, write clinical notes,
book appointments for existing patients. Items 59-64 are UX
polish, not blockers. Items 50, 51 (RLS exposure hardening)
remain optional. Item 42 (auth model documentation) is the one
remaining HIGH priority before launch readiness.

Realistic launch readiness: 1-2 focused sessions for item 42
plus optional UX polish from gap batch 59-64.

### Item 42 closure (2026-05-07)

Item 42 closed: auth and role model documented at
.claude-context/10_auth_model.md (870 lines, nine sections
covering overview, tables, helper functions, RLS patterns, mode
detection, provisioning runbook, role conventions, planned
feature toggles, cross-references). Synthesizes findings from
items 40 + 41.

The doc surfaced one new gap (item 65: professionals.user_id
lacks UNIQUE constraint) — captured but not addressed; needs a
design decision about whether one auth user can legitimately
link to multiple professional rows (multi-centro work scenario).

### Strategic position update — launch readiness

All HIGH priority items resolved. Remaining gaps are MEDIUM/LOW
priority polish: items 50, 51 (RLS exposure hardening), 52, 57,
58 (FOR ALL policy splits), items 59-64 (pro mode UX cluster
from item 41 smoke test), items 54, 55, 56, 65 (DB-level
conventions and constraints).

Vitalis launch readiness: foundationally complete. The system
can be launched in manual mode (bot off) immediately. Pro mode
is functionally usable. RLS-as-code in version control. Auth
model documented. Future hardening passes optional.

Recommended next session: zero or one focused topics depending
on energy. Options ordered by impact:

1. Items 50 + 51 jointly: tighten clients_public_lookup and
   professionals_public_read_active via SECURITY DEFINER lookup
   functions. RLS hardening pass.
2. Items 59-64 batch: pro mode UX polish session. Each entry is
   small individually; bundling them into one focused session
   works well.
3. Tier 2 architecture: duration-on-session-types refactor,
   closing_question removal, patient duplication detection.

---

## 2026-05-05 — Bot diagnostic session + strategic refocus

Spent the session investigating GPT-4o fallback failures and Sonnet
prompt regressions. Key findings:

- GPT-4o branch was missing centro context in module 7's system block.
  Mapper rewrite drafted, ready to apply but deferred.
- Haiku's session_type extraction was capturing patient phrasing
  ("terapia de pareja") instead of normalizing to centro's official
  service names ("Consulta de pareja"). Caused validation failures.
- System prompt rewrite drafted with REGLA DE APERTURA, 7-element
  checklist in section 9, REGLA D no-reschedule rule. Applied but
  multiple regressions surfaced: Sonnet bolding professional names,
  age question misfiring, conversation state lost mid-flow.
- Patient duplication bug found: dashboard auto-create logic in
  patients.jsx + Edge Function INSERT both write patient rows
  without deduplication.
- usage_log not capturing token counts (cache analytics unusable).

Decision at end of session: defer all bot work to a future dedicated
session. The bot, prompts, Make.com flow, and Edge Function are too
entangled to fix piecemeal between dashboard work. Strategic shift
to dashboard-first: get Vitalis using Elconsultorio in manual mode
(bot off), then return to bot as a Phase 2 add-on.

Next priority: items 20 → 19 → 18 → 21 (patient flow integrity).
Then Tier 2 cleanup. Bot polish session is Tier 5.

No commits this session. Documentation updates only.

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
