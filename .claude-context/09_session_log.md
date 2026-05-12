# Session Log

Append-only log of significant work sessions. Most recent at top.

---

## 2026-05-12 — dirty-state guard arc, per-pro themes arc, loading screen polish

Three major arcs landed in this session, plus several smaller cleanups.
23 commits total.

### Arc 1: Dirty-state guard infrastructure (4 commits)

Central `useDirtyForm` hook + `DirtyGuardContext` provider that
intercepts navigation when any registered form has unsaved
changes. Soft-blocks SPA-internal nav via custom Spanish confirm
modal ("Tienes cambios sin guardar — ¿Quieres salir sin guardar
los cambios?"). Browser refresh / close-tab triggers the native
beforeunload prompt. Browser back/forward deferred (see gap 73).

Wired into:
- 5 settings editors (profile [refactor], empresa, botConfig,
  serviciosSesiones, empresaWizard). Templates/Integrations/Plan
  deferred until they have real save flows (gap 70).
- Apariencia (with the additional local-preview rework — clicking
  a theme card now updates only local state, applyTheme runs only
  on save).
- Modal editors: ProfessionalEditor + CitaModal (close paths
  routed through guard.confirm — backdrop, X, Cancelar all
  prompt before discard).

Commits: `a504355` (infra), `c082d2f` (settings editors),
`b7e0671` (Apariencia local-preview), `f229b5a` (modal editors).

### Arc 2: Per-pro dashboard themes (3 phases + follow-ups)

Pros can now save a personal dashboard theme that overrides the
centro theme for their own logged-in view. Patient-facing
surfaces remain locked to the centro theme via documented
convention (gap 69).

Migration (applied earlier): `20260511190000_add_theme_id_to_professional_profiles.sql`

- **Phase 1** (`2351eaa`): resolver helper +
  `flattenEmployment.theme_id` passthrough + App.jsx mount-time
  wiring through the resolver.
- **Phase 2** (`e4a5e0c`): Apariencia mode-aware read/write —
  pros save to `professional_profiles.theme_id`, admins save to
  `clients.config.theme_id`.
- **Follow-up cluster**:
  - `b5e22e2`: refreshProfessional + dirty-snapshot race fix in
    ProfessionalEditor (two parallel async loads were writing
    snapshot with stale closure values for each other's fields).
  - `fdc619f`: removed the refreshProfessional call to avoid
    GuardedShell remount (which loses settings.section state).
  - `e2efcdc`: introduced `proThemeSaveTick` — App.jsx-level no-op
    state bump that drives an App.jsx re-render after pro save,
    cascading fresh T values to Sidebar/TopBar without remount.
- **Phase 3** (`0c5e5d4`): convention lock — JSDoc on resolver +
  gap 69 entry codifying that patient-facing surfaces must read
  `clients.config.theme_id` directly.

Key architectural decision (Reading A): centro theme is the public
brand seen by patients, period. Pro themes are internal-dashboard
only. The pro override never propagates to patient-facing surfaces.

### Arc 3: Loading screen polish (5 commits + 1 diagnostic + 1 cleanup)

Hard refresh now renders the saved theme from the very first paint
instead of flashing default Verde Salud. Includes a shared
`<Loader>` component (themed ψ font-cycling animation, 1.5s swap,
3 system font stacks) replacing every "Cargando..." in the SPA.

- `8139ac9`: pre-mount localStorage cache + inline `<script>` in
  `index.html` that synchronously sets `:root` CSS vars before
  React mounts. Sync source-of-truth duplication of the THEMES
  color map (and an inline `softenHex` mirror) — documented as
  intentional since module imports aren't available pre-mount.
- `bd41ac1`: themed Loader component (14 visual loaders replaced;
  2 TopBar subtitle text strings preserved).
- `090e3c3` → `ce0dd92` → `991f727`: gate refinement to fix
  pro-mode boot flash. Three iterations because the underlying
  bug (pro-context effect's `setProfessional(null)` premature
  early-return) was disguised by the symptom (theme effect firing
  with `professional !== undefined` but `bootstrap.loading=false`).
- `5779aab`: diagnostic instrumentation that traced the bug to
  its root cause.
- `eb16c85`: cleanup of diagnostic logs + Apariencia mount-time
  preselect flash fix (initializer now reads `professional.theme_id`
  from context instead of waiting for async fetch).

Subliminal brand watermark: the ψ is only visible to centro users
(admins, pros), never to patients (bot is text-only, no patient
dashboard exists). Acceptable B2B brand reinforcement.

### Smaller landings

- `90a3c7d`: pro self-edit persistence bug — the bug that opened
  this session. The `canWriteProfile` gate at ProfessionalEditor
  was excluding self-mode writes from `professional_profiles`
  because it inverted the `profileLocked` semantic.
- `9bec13e` → `27c26cf`: per-pro services UI removal, then
  restoration as toggle-only (Empresa mode only). Per-row pricing
  was correctly identified as catalog-management territory; the
  toggle is the right UX for "this pro offers this service."
- `3abecf9`: Profesionales sidebar item hidden in Single mode
  (single-pro centros don't need a multi-pro editor surface).
- `fdefdd0`: removed duplicate `Tipos de sesión` section from
  settings/profile.jsx — it had drifted from the canonical
  Servicios y Sesiones screen.
- `9ab7d0f`: removed Ultra Pro and Océano themes from the
  catalog. THEMES count down to 4 (rosa-palo, lavanda-pro,
  verde-salud, carbon).

### Strategic discussions documented elsewhere

Chilean DTE invoicing landscape (BaseAPI / SimpleAPI / Bsale /
OpenFactura / Skedu analysis) and a full architecture plan for
payments + DTE emission was discussed but not started. Estimated
4-6 weeks of focused work. Deferred until current product polish
completes. See gap 76.

### Decisions locked

- **Reading A on patient-facing themes**: centro theme always wins
  publicly, pro themes stay internal. Codified in
  `resolveActiveThemeId.js` JSDoc + gap 69.
- **localStorage cache uses single key** `'last_theme_id'` (shared
  across users on the same browser — acceptable for B2B
  personal-device usage; the worst case is "previous user's
  theme renders during the first ~200ms of loading screen,"
  which corrects itself once auth + bootstrap resolve).
- **System fonts only in Loader** — no Google Fonts download,
  no network dependency for the loading state.
- **1.5s font-cycle interval** in Loader (slower than the
  prototype's 1.1s — feels less frantic during sub-1s loads).
- **No wordmark or text on Loader** — pure ψ.

### Pause point for next session

The product surface that's currently polished:
- Pro self-edit works end-to-end (initial bug fixed).
- Dirty-state guard protects all major editors.
- Per-pro themes work, with patient-facing surfaces locked to
  centro.
- Loading screen renders correctly themed from first paint.

Recommended next arc (in rough priority):
1. **Bot polish session** (existing item 1 cluster + gap 74 —
   get_bot_context implicit-active fallback for per-pro services).
2. **Centro subscription + DTE emission arc** (gap 76, biggest
   remaining piece for Vitalis launch readiness).
3. **Pro mode UX cluster** (gaps 59-64, deferred since item 41).

---

## 2026-05-08 / 2026-05-09 — gap 66 schema cutover + RPC + RLS hotfix + SPA migration

Six commits + four migrations + one Edge Function deploy. Gap 66
(professionals data model refactor) is now SPA-complete; only
Make.com blueprint update remains, deferred to launch readiness.

### Commits shipped

  - `7890b00` feat(rls): split public.professionals into profiles + employments (gap 66)
  - `6dbd4a2` feat(rpc): rewrite get_bot_context and create_booking_atomic for split (gap 66 phase F)
  - `1f688af` fix(rls): break professional_profiles/employments recursion (gap 66 hotfix)
  - `600d54b` feat(spa): migrate agenda read paths to split schema (gap 66 commit 2a)
  - `243a351` feat(spa): migrate write paths and admin list to split schema (gap 66 commit 2b)
  - `6e27517` feat(spa): migrate patients screen to split schema (gap 66 commit 2c)

### Migrations applied

  - `20260509120000_split_professionals_to_profiles_and_employments.sql` —
    schema cutover. Drops `public.professionals`. Creates
    `professional_profiles` (pro-owned identity, `user_id` UNIQUE) and
    `professional_employments` (centro-owned operational state). Renames
    FK columns on 5 dependent tables (`employment_id`); 1 dependent table
    uses `profile_id` (`professional_documents`, since CVs travel with the
    person). Recreates 13 public-schema RLS policies and 4 storage
    policies under the new shape. Defers 3 anon-read policies to gap 51's
    `get_public_professionals` SECURITY DEFINER (deferred).
  - `20260509130000_rewrite_rpc_functions_for_split.sql` —
    Phase F. Rewrites `get_bot_context` (read-only, full join through
    employments + profiles in 3 places) and `create_booking_atomic`
    (parameter rename `p_professional_id` → `p_employment_id`, full
    body rewrite, atomic two-table effect preserved).
  - `20260509140000_fix_rls_recursion_on_professional_profiles_employments.sql` —
    RLS hotfix. The two new tables had cross-referencing policies that
    triggered Postgres 42P17 "infinite recursion." Replaced inline
    subqueries in 4 policies with three new SECURITY DEFINER helpers
    (`my_profile_id`, `is_admin_for_active_employment`,
    `is_admin_for_any_employment`).
  - `20260509150000_create_professional_at_centro.sql` —
    Atomic two-table INSERT RPC for new pro creation. Used by 3 SPA
    create-pro paths. Locked to authenticated + service_role; explicit
    REVOKE from anon to counter Supabase's default-privilege grant.

### Edge Function deploy

  - `create-booking` Edge Function rewritten + deployed via
    `supabase functions deploy create-booking --no-verify-jwt`.
    `resolveProfessional` renamed to `resolveEmployment`, returns
    employment_id from a `!inner` join through `professional_profiles`.
    Body parameter `professional_id` → `employment_id`. RPC call
    parameter `p_employment_id`.

### Outstanding for gap 66

  - Make.com blueprint update (rename `p_professional_id` → `p_employment_id`
    in the HTTP module body of `06_make_blueprint.json`). Deferred to
    launch readiness per Hector's call: end-to-end bot integration test
    happens at launch, not earlier. After this update, gap 66 is fully
    closed.

### Design decisions locked this session

  1. Clean slate cutover (no historical data preserved on the
     dropped tables). Test data nukeable.
  2. FK columns: 5 use `employment_id` (centro-scoped operational),
     1 uses `profile_id` (pro-owned identity — `professional_documents`
     because CVs travel with the person across centros).
  3. Honest renames everywhere. No "save-the-bot" compromises;
     parameters renamed even though Make.com blueprint becomes
     temporarily broken. Future-perfect over present-lazy.
  4. Vestigial columns dropped: `role`, `avatar_url`, `initials`,
     `availability` (jsonb cache). SPA queries `professional_schedules`
     directly for one source of truth.
  5. Coordinated Phase F: RPC rewrites + Edge Function update in same
     commit, since they share parameter shape.
  6. Strict isolation in RLS: pros see only their own profile via
     `profiles_self_all` + `employments_self_read`. Admin/super-admin
     see profiles of pros employed at their centro via
     `profiles_admin_read` + `employments_admin_all`. No cross-pro
     visibility within a centro via direct table queries; future
     public profile page goes through a SECURITY DEFINER function
     (deferred to gap 51's remaining work).
  7. Storage uploads use profile_id-keyed paths
     (`<bucket>/<profile_id>/<filename>`). Photos and CVs are pro-owned
     and travel with the person. Documents bucket admin policy is
     unconditional (admin can manage docs at their centro regardless
     of `user_id`); photos lock with `profileLocked = pro.user_id !== null`
     since photo URL writes are RLS-gated by the profile claim.
  8. Delete-pro-at-centro semantically becomes "Quitar del centro"
     (delete employment only). Profile, photos, documents preserved.
     Schedules and session_types CASCADE with the employment;
     appointments and patient_assignments and patients SET NULL on
     employment_id (history preserved, employment-mode RLS sees them
     as orphan).
  9. Admin write rules: admin can write to a profile until `user_id`
     is set (RLS policy `profiles_admin_update_unclaimed` enforces this
     at the data layer; SPA also gates the UI with a `profileLocked`
     boolean). Admin always controls the employment.
  10. New-pro creation uses an atomic SECURITY DEFINER RPC rather than
      two SPA-side INSERTs, eliminating the orphan-profile failure mode.

### Lessons learned (documented in `migration-conventions.md`)

  - **Schema-spanning recon must query `pg_policy` directly across
    schemas.** Two failed apply attempts on the cutover migration
    (storage policies in `storage.objects` not visible in original
    recon). The grep-migrations approach missed them; querying
    `pg_policy` would have caught them.
  - **Cross-table RLS policies need SECURITY DEFINER helpers, not
    inline subqueries.** Postgres evaluates all permissive policies
    as OR'd, so cross-references trigger 42P17 recursion.
  - **`REVOKE FROM anon` is required for admin-only RPCs.** Supabase's
    project default-privileges directly grants anon EXECUTE on every
    function; `REVOKE FROM PUBLIC` is insufficient.
  - **"if you need more information to be sure, tell me, do not infer
    only if sure proceed"** (Hector's mandate). Front-load empirical
    verification when the cost of being wrong is rolling back. Saved
    several apply-fail loops once adopted as default discipline.
  - **The audit-and-verify cycle has compound payoff.** First failed
    apply taught us about storage policies. Second failed apply
    surfaced column-name mismatches (`clinical_notes.assignment_id`
    not `patient_id`; `patient_assignments.status` text not boolean).
    The third attempt — done after a comprehensive audit query
    sweeping all affected tables/policies/columns/constraints — applied
    cleanly first try.

### Browser-specific behaviors observed during testing

  - **Brave Shields blocks programmatic file-input clicks** (the
    hidden `<input type="file">` + ref + `.click()` pattern). Photo
    upload failed in Brave but worked in Chrome. Documented for
    end-user constraint awareness once Vitalis ships; Brave users
    must disable Shields for the SPA URL.

### Verification queries used (preserved for future sessions)

Reusable diagnostic queries that surfaced bugs this session:

```sql
-- All RLS policies on a set of tables, with full USING/WITH CHECK bodies
SELECT c.relname, pol.polname, ...
FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
WHERE c.relname IN (...);
```

```sql
-- All FK ON DELETE behavior across affected tables
SELECT con.conname, pg_get_constraintdef(con.oid)
FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
WHERE c.relname IN (...) AND con.contype = 'f';
```

```sql
-- Function privilege check (anon/auth/service_role)
SELECT p.proname,
  has_function_privilege('anon', p.oid, 'EXECUTE'),
  has_function_privilege('authenticated', p.oid, 'EXECUTE'),
  has_function_privilege('service_role', p.oid, 'EXECUTE')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = '<name>';
```

```sql
-- Cross-schema policy sweep (catches storage-schema policies)
SELECT n.nspname, c.relname, pol.polname, pg_get_expr(pol.polqual, pol.polrelid)
FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE pg_get_expr(pol.polqual, pol.polrelid) LIKE '%<keyword>%';
```

### Pause point for next session

Next steps for gap 66 closure:
  1. Re-seed test data via the SPA. prof3@test.cl needs a profile +
     active employment for pro-mode end-to-end testing. (Either via
     the SPA's "Agregar profesional" + a manual UPDATE setting
     user_id, or via direct Dashboard INSERTs.)
  2. End-to-end smoke test: prof3 logs in, sees their own profile,
     gets pro-mode appointment view, can add a clinical note.
  3. Make.com blueprint update at launch readiness — rename
     `p_professional_id` to `p_employment_id` in the HTTP module body.
  4. Final gap-66 closure entry.

### See also

  - `migration-conventions.md` — RLS recursion pattern + REVOKE FROM
    anon pattern documented from this session's lessons.
  - Gap 66 commit list above; canonical migrations are in
    `supabase/migrations/2026050*.sql`.
  - Edge Function: `supabase/functions/create-booking/index.ts` —
    post-cutover state.

---

## 2026-05-08 — Gaps 55/56 closure: deadline-driven default-ACL alignment

Five-phase session closing the two HIGH-priority RLS gaps remaining
after items 50/51. Reconnaissance surfaced a Supabase platform deadline
(October 30, 2026) that reframed gap 55's fix path; the session shipped
both gaps' resolution plus the project's first dedicated convention doc.

### Items resolved

- ✅ Gap 55 (default ACL configuration not captured in migrations):
  resolved by pre-applying Supabase's October 30 revoke ourselves rather
  than capturing the deprecated current state. Project ACL state now
  matches what the platform will produce on October 30; fresh
  environments provisioned today produce identical state.

- ✅ Gap 56 (RPC migrations lacking explicit GRANT EXECUTE): resolved
  by amending 5 historical migrations to include grants alongside
  function definitions, plus establishing the convention in a new
  `.claude-context/migration-conventions.md` doc.

### Five-phase commit sequence

| # | Hash | Phase | Purpose |
|---|---|---|---|
| 1 | (no commit) | Recon | Inventoried 9 RPC functions, queried production pg_default_acl, read Supabase docs to confirm defaults are platform-supplied with October 30 deprecation date |
| 2 | `fc8ba47` | Audit + amend | Added GRANT EXECUTE statements to 5 historical RPC migrations; standardized service_role inclusion across all function grants |
| 3 | `c662fa1` | Deadline alignment | Pre-applied Supabase's planned ALTER DEFAULT PRIVILEGES REVOKE on tables and sequences |
| 4 | (this commit) | Convention doc | Created `.claude-context/migration-conventions.md` documenting GRANT requirements for future migrations |
| 5 | (this commit) | Wrap-up | Gap closures, session log, auth model cross-refs |

### Architectural decisions locked in

1. **Mirror the platform announcement exactly.** Phase 3's revoke
   migration covers tables + sequences only (not functions),
   postgres role only (not supabase_admin), public schema only.
   Going beyond Supabase's stated scope would be overreach without
   benefit — function defaults are independently rescued by
   PostgreSQL's PUBLIC EXECUTE default that we don't (and can't
   reasonably) revoke.

2. **Convention over centralization for grants going forward.** The
   `baseline_grants.sql` precedent (item 40 commit D) was a one-time
   sweep capturing pre-existing function grants in a single file.
   Going forward, each function-defining migration includes its own
   grants — the migration is self-contained. The convention doc
   captures this. The `baseline_grants.sql` file remains in place as
   harmless redundancy; removing it would be churn for no benefit.

3. **Per-file type-alias consistency over codebase-wide normalization.**
   `int`/`integer` and `timestamptz`/`timestamp with time zone` are
   PostgreSQL aliases that resolve to the same OID. GRANT statements
   should match the form used in the file's own CREATE FUNCTION
   declaration. Reading any single migration top-to-bottom should
   show coherent style.

4. **Trigger functions get the standard grant for consistency.**
   `set_updated_at` and `handle_new_user` are trigger-only and
   technically don't need EXECUTE grants from anon/authenticated/
   service_role. Granting them anyway matches the existing
   `baseline_grants.sql` precedent and avoids per-function judgment
   calls about who can invoke what. Harmless redundancy preferred
   over selective grants.

### Discoveries during the session

1. **The October 30, 2026 platform deadline.** Surfaced during Phase 1
   recon when reading Supabase's docs and changelog. Reframed gap 55's
   fix path entirely — original intent was to "capture current
   defaults," but capturing a state that's about to be revoked would
   document deprecated behavior. New approach: run the revoke ourselves,
   ahead of the platform.

2. **Function defaults are NOT in Supabase's October 30 revoke.** The
   announcement covers only tables and sequences. Functions retain
   auto-applied defaults plus PostgreSQL's PUBLIC EXECUTE built-in.
   This means function-grant discipline cannot rely on platform
   revocation; it depends entirely on the convention doc and per-
   migration discipline.

3. **CREATE OR REPLACE FUNCTION preserves grants.** PostgreSQL doesn't
   reset privileges when a function is replaced. Discovered while
   planning Phase 2 — initially worried that `get_bot_context`'s
   four update migrations would each need their own GRANT statement.
   Verified the original creation migration's grant persists across
   replacements.

4. **REVOKE without matching GRANT is a silent no-op.** Documented in
   PostgreSQL's ALTER DEFAULT PRIVILEGES docs. This made Phase 3
   safer than initially feared — even if our revoke statements
   slightly mismatched the platform's auto-applied defaults, the
   unmatched portions would no-op rather than error.

5. **`get_public_centro_info` grant inconsistency.** Recon caught that
   the function (added in items 50/51 session) was granted to
   anon+authenticated only, while every other function in the codebase
   grants to all three roles including service_role. Added service_role
   to the grant during Phase 2 amend for consistency. service_role
   bypasses RLS but still needs EXECUTE permissions to call functions
   from edge-function or platform contexts.

### New gaps logged

None. The session closed two HIGH-priority gaps without surfacing new
ones. The convention doc captures all forward-looking discipline.

### Files changed

- 5 RPC migrations amended (Phase 2): get_bot_context, create_booking_atomic,
  baseline_helper_functions, two clients/professionals hardening migrations.
- 1 new migration created (Phase 3): align_with_future_default_acl.sql.
- 1 new convention doc created (Phase 4): migration-conventions.md.
- 3 context docs updated (Phase 5): 08_known_gaps.md, 09_session_log.md,
  10_auth_model.md.

### Strategic position update

Gaps 55 and 56 closed. The HIGH-priority open list in `08_known_gaps.md`
is now empty. All RLS exposure and migration-completeness gaps that
surfaced during item 40's baseline are resolved.

Remaining work follows your stated priority path: gap 66 (professionals
data model refactor) → gap 67 (admin-owner clinical authority helper) →
public profile page. None are launch-blocking; all are architectural
cleanups before adding the public-facing surface.

### Recommended next sessions

1. **Gap 66 (professionals data model refactor)** — biggest standalone
   architectural session. Splits `public.professionals` into
   `professional_profiles` (pro-owned) and `professional_employments`
   (centro-owned). Resolves gaps 65 and 57, completes the deferred
   half of gap 51. ~item-40-shaped scope.

2. **Gap 67 (admin-owner vs admin-receptionist)** — smaller, depends on
   gap 66's data model. Implements the
   `is_admin_with_clinical_authority(p_client_id)` helper that
   gap 46's centro feature toggles need to be production-correct.

3. **Public profile page** — the original motivating goal. Build on
   top of gap 66's split. Includes a new SECURITY DEFINER function
   `get_public_professionals(p_slug)` that completes gap 51's deferred
   work.

4. **Polish phase** — items 59-64 pro-mode UX cluster, gap 63 (Apariencia
   save bug), gap 68 (effect-dep hygiene). After the architectural
   foundation is solid.

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
