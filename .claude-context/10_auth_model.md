# Auth and Role Model

> Tracks the auth chain from Supabase Auth through tenancy mapping to
> role-specific privileges. Captures what was discovered and locked-in
> across items 40 (RLS-as-code) and 41 (test pro provisioning) on
> 2026-05-06 → 2026-05-07.

## 1. Overview

Every permission decision in this codebase passes through three coupled
systems: **Supabase Auth** (`auth.users`) holds credentials; **`public.users`**
maps each auth user to a client (centro) plus a role; **`public.professionals`**
or **`public.super_admins`** grants role-specific privileges. RLS reads from
these via four helper functions; the React app reads from `professional_profiles.user_id`
(via the joined query in App.jsx) to determine pro vs admin mode. The two paths must agree on which
centro the logged-in user belongs to — if the URL slug resolves to client A
but the user's `users.client_id` is client B, queries silently return empty.

```
                  ┌─────────────────────────────────────┐
                  │  auth.users (Supabase-managed)      │
                  │  - id (uuid, PK)                    │
                  │  - email                            │
                  │  - raw_user_meta_data (jsonb)       │
                  │  - encrypted_password               │
                  └────────────┬────────────────────────┘
                               │ AFTER INSERT trigger:
                               │   handle_new_user()
                               │   reads raw_user_meta_data->>'client_id'
                               ▼
                  ┌─────────────────────────────────────┐
                  │  public.users (tenancy mapping)     │
                  │  - id (uuid, FK → auth.users.id)    │
                  │  - client_id (uuid, FK → clients)   │
                  │  - role (text: admin/owner/...)     │
                  │  - active (bool)                    │
                  └─────┬───────────────┬───────────────┘
                        │               │
        ┌───────────────┘               └───────────────┐
        ▼                                               ▼
┌──────────────────────┐               ┌──────────────────────────┐
│ public.professionals │               │ public.super_admins      │
│ (clinical staff)     │               │ (global allowlist)       │
│ - id (uuid, PK)      │               │ - user_id (uuid, PK)     │
│ - client_id          │               │ - email                  │
│ - user_id (nullable) │               └──────────────────────────┘
│ - full_name          │
│ - active             │               ┌──────────────────────────┐
└──────────────────────┘               │ public.clients (centros) │
                                       │ - id (uuid, PK)          │
                                       │ - slug (URL subdomain)   │
                                       │ - config (jsonb)         │
                                       └──────────────────────────┘

  RLS helpers read these tables:
    my_client_id()         → public.users         [auth.uid() → client_id]
    my_professional_id()   → public.professionals [auth.uid() → id, active]
    is_admin_of_client(c)  → public.users         [auth.uid()+role='admin']
    is_super_admin()       → public.super_admins  [auth.uid() exists?]

  React app reads:
    useClient.js  →  public.clients (by hostname slug) → ClientCtx.clientId
    App.jsx       →  public.professionals (by clientId + auth.uid())
                                                       → ClientCtx.professional
```

## 2. Tables involved

### 2.1 `auth.users` (Supabase-managed)

Owned by Supabase Auth — never write directly from migrations or app code.
The fields this codebase reads are `id`, `email`, and `raw_user_meta_data`.

The login flow is the standard Supabase pattern:
`supabase.auth.signInWithPassword({ email, password })` returns a session; the
session's `user.id` is the uuid that everything else keys on. See
[src/Login.jsx](src/Login.jsx).

`raw_user_meta_data` is a jsonb blob; we use two keys:
- `client_id`: required for `handle_new_user` to provision a `public.users`
  row. If missing at INSERT time, the auth user exists but has no tenancy
  mapping (silently locked out).
- `role`: optional; defaults to `'owner'` if absent. See section 7 for what
  each role means.

### 2.2 `public.users` (tenancy mapping)

One row per auth user that has a client_id. Created automatically by the
`handle_new_user` trigger; can also be inserted manually via service_role
(item 41 took the manual path because `raw_user_meta_data` was set after
auth user creation, missing the trigger window — see section 6).

Auth-relevant columns:
- `id` (uuid, PK) — matches `auth.users.id`
- `client_id` (uuid, NOT NULL) — the centro
- `role` (text, default `'owner'`) — see section 7
- `email` (text, NOT NULL) — cached at insert; not auto-synced if
  `auth.users.email` changes later
- `full_name` (text, nullable) — NOT set by `handle_new_user`; populated
  manually if needed
- `active` (bool, default true) — `is_admin_of_client` requires this true

No `updated_at` column on this table, so no `set_updated_at` trigger is
needed.

### 2.3 `public.professional_profiles` + `public.professional_employments` (clinical staff)

Post-gap-66 (2026-05-09), the professional identity model splits across
two tables. The pre-cutover `public.professionals` table is dropped.

- **`professional_profiles`** (pro-owned identity, one row per person):
  - `id` (uuid, PK)
  - `user_id` (uuid, UNIQUE, FK `auth.users(id)` ON DELETE SET NULL,
    nullable until claim)
  - `full_name`, `photo_url`, `bio`, `specialties` (text[]),
    `education`, `years_experience`, `public_summary`,
    `public_credentials`, `public_documents` (jsonb)
  - `created_at`, `updated_at`

- **`professional_employments`** (centro-owned operational state,
  one row per pro per centro):
  - `id` (uuid, PK)
  - `profile_id` (uuid, FK `professional_profiles` ON DELETE CASCADE)
  - `client_id` (uuid, FK `clients` ON DELETE CASCADE)
  - `email`, `color`, `active` (default true), `public_profile`
    (default true)
  - `created_at`, `updated_at`
  - UNIQUE `(profile_id, client_id)` — a pro has one employment
    per centro

The split lets a single person work at multiple centros (one profile,
multiple employments) and lets centros manage operational state
without touching identity.

#### Identity claim flow

1. Admin creates a profile + employment via
   `create_professional_at_centro()` RPC. Profile starts with
   `user_id = NULL` (unclaimed).
2. Pro signs up via Supabase Auth, creating an `auth.users` row.
3. Some claim flow (out of scope for gap 66) sets
   `professional_profiles.user_id = auth.users.id`.
4. Once claimed, only the pro can write identity fields (gated by
   RLS policy `profiles_admin_update_unclaimed` which requires
   `user_id IS NULL` for admin writes).

Future work: build the claim flow itself. Currently the SPA assumes
some out-of-band process sets `user_id` (probably a one-time bootstrap
or magic-link verification — TBD).

#### RLS visibility

- Pro reads their own profile via `profiles_self_all`
  (`user_id = auth.uid()`).
- Pro reads their own employment via `employments_self_read`
  (joins through `my_profile_id()` SECURITY DEFINER helper).
- Centro admin reads profiles of pros employed at their centro via
  `profiles_admin_read` (joins through
  `is_admin_for_active_employment()` helper).
- Centro admin reads all employments at their centro via
  `employments_admin_all` (`is_admin_of_client(client_id)`).
- Authenticated users at a centro read active employments at that
  centro via `employments_authenticated_read_active` (broad — for
  the agenda's pro picker).
- Anon access deferred to a future `get_public_professionals`
  SECURITY DEFINER function (gap 51 remaining work).

#### Helper functions added by the gap 66 work

- `my_profile_id()` — auth user's profile id, SECURITY DEFINER.
- `my_employment_id()` — auth user's employment id at their current
  centro. Joins through profiles via UNIQUE `user_id`, narrowed by
  `my_client_id()`.
- `is_admin_for_active_employment(p_profile_id)` — admin over an
  active employment of this profile.
- `is_admin_for_any_employment(p_profile_id)` — same, any
  employment status.
- `is_admin_with_clinical_authority(p_client_id)` — admin + has
  a profile (gap 67 helper, full wire-up pending).

The pre-cutover `my_professional_id()` helper is removed; section 3.2
below reflects the post-cutover state.

#### Storage paths

Files in `professional-photos` and `professional-documents` buckets
use `<bucket>/<profile_id>/<filename>` folder structure. Photos and
CVs are pro-owned identity assets that travel with the person across
centros. Storage RLS policies join through `professional_employments`
to determine admin scope.

#### Dependent table FK columns

- `appointments.employment_id` — centro-scoped, ON DELETE SET NULL
- `patient_assignments.employment_id` — centro-scoped, ON DELETE SET NULL
- `patients.employment_id` — centro-scoped, ON DELETE SET NULL
- `professional_schedules.employment_id` — centro-scoped, ON DELETE CASCADE
- `professional_session_types.employment_id` — centro-scoped, ON DELETE CASCADE
- `professional_documents.profile_id` — pro-owned, ON DELETE CASCADE

See also:
- Schema: [`02_database_schema.md`](02_database_schema.md)
- Functions: [`03_database_functions.md`](03_database_functions.md)
- Migration history: [`09_session_log.md`](09_session_log.md) (2026-05-08/2026-05-09 entry)

### 2.4 `public.super_admins` (global allowlist)

Two columns: `user_id` (PK, references `auth.users.id` implicitly) and
`email` (cached, NOT NULL). One row per platform-level operator.

RLS on this table is read-only via `super_admins_read` policy — only
existing super admins can see the list. INSERT/UPDATE/DELETE require
`service_role` (intentional lockdown — adding a super admin is a
deliberate platform-operator action, not a UI-driven flow).

The `email` column is a denormalized cache — not enforced to match
`auth.users.email` if that changes. Operationally, we treat the auth
record as source of truth.

## 3. Helper functions

All four helpers below are defined in
[supabase/migrations/20260506000000_baseline_helper_functions.sql](supabase/migrations/20260506000000_baseline_helper_functions.sql).
They're `SECURITY DEFINER` so they bypass RLS when reading their backing
tables (otherwise the policy that calls `is_admin_of_client` would
itself need permission to read `public.users`).

### 3.1 `my_client_id()`

```sql
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
-- (no explicit search_path — see gap 54)
```

Reads `public.users` where `id = auth.uid()`, returns `client_id`. Returns
`NULL` for unauthenticated callers or when no `users` row exists for the
auth user (fails closed — RLS expressions evaluate to false).

Consumed by: `clients_admin_update`, `users_admin_read`, `users_admin_write`,
`notes_admin_with_consent`. Anywhere policies need to scope a row to "my
centro."

### 3.2 Helper functions for professional identity

Post-gap-66, three SECURITY DEFINER helpers replace the dropped
`my_professional_id()`. All run with `BYPASSRLS` semantics on their
internal queries (the function owner has the privilege), enabling
cross-table policy references without recursion.

- **`my_profile_id()`** returns `professional_profiles.id` for the
  auth user, or NULL if no profile exists. Used by `employments_self_read`
  to identify the caller's profile without triggering recursive RLS
  on professional_profiles. Source query:

  ```sql
  SELECT id FROM public.professional_profiles
   WHERE user_id = auth.uid() LIMIT 1
  ```

- **`my_employment_id()`** returns the active employment id for the
  auth user at their current centro. Joins through profiles via UNIQUE
  user_id and narrows by `my_client_id()`. Source query:

  ```sql
  SELECT e.id FROM public.professional_employments e
  JOIN public.professional_profiles p ON p.id = e.profile_id
   WHERE p.user_id = auth.uid()
     AND e.client_id = my_client_id()
     AND e.active = true
   LIMIT 1
  ```

- **`is_admin_for_active_employment(p_profile_id)`** returns true if
  the auth user is admin of any centro where this profile has an
  active employment. Used by `profiles_admin_read`:

  ```sql
  SELECT EXISTS (
    SELECT 1 FROM public.professional_employments
     WHERE profile_id = p_profile_id
       AND active = true
       AND is_admin_of_client(client_id))
  ```

- **`is_admin_for_any_employment(p_profile_id)`** — same shape, no
  `active` filter. Used by `profiles_admin_delete` and
  `profiles_admin_update_unclaimed`.

- **`is_admin_with_clinical_authority(p_client_id)`** (gap 67
  helper, full wire-up pending) — returns true if the auth user
  is both admin of the centro AND has a profile (i.e., is also a
  pro themselves, eligible for clinical-authority overrides):

  ```sql
  SELECT is_admin_of_client(p_client_id)
     AND EXISTS (
       SELECT 1 FROM public.professional_profiles
        WHERE user_id = auth.uid())
  ```

### 3.3 `is_admin_of_client(p_client_id uuid)`

```sql
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
```

Reads `public.users`, returns true iff a row exists where:
`id = auth.uid()` AND `client_id = p_client_id` AND `role = 'admin'` AND
`active = true`.

Consumed by: every `*_admin_*` policy across 14 tables — the most-used
helper in the codebase. Note: a user with `role = 'owner'` is **not**
admin per this function. See section 7 for why both values exist.

### 3.4 `is_super_admin()`

```sql
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
```

Returns `EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid())`.
Used by ~17 policies as a cross-tenant override (super admins can read
across all centros). Note: `clinical_notes` has no super-admin override —
deliberate, per Ley 20.584's strict authorship rules.

### 3.5 `set_updated_at()` (trigger function)

```sql
RETURNS trigger LANGUAGE plpgsql
```

Pure data hygiene: `BEFORE UPDATE` on a row, sets `new.updated_at = now()`.
Not security-sensitive; not `SECURITY DEFINER`. Attached to six tables
post-commit-E (item 40 sequence): `agents_config`, `clients`, `patients`,
`session_types`, `clinical_notes`, `patient_assignments`.

### 3.6 `handle_new_user()` (trigger function on auth.users)

```sql
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
-- (no explicit search_path — see gap 54)
```

Wired as `AFTER INSERT ON auth.users` via the `on_auth_user_created`
trigger. Logic:

```sql
IF (new.raw_user_meta_data->>'client_id') IS NOT NULL THEN
  INSERT INTO public.users (id, client_id, email, role)
  VALUES (
    new.id,
    (new.raw_user_meta_data->>'client_id')::uuid,
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'owner')
  );
END IF;
```

Four gotchas to know about:

1. **Fires only AFTER INSERT.** Setting `raw_user_meta_data` *after*
   creating the auth user (e.g., editing in the Dashboard post-creation)
   does not retroactively fire the trigger. Item 41 hit this — manual
   `INSERT INTO public.users` is the workaround. See section 6's
   provisioning runbook.
2. **No-ops silently if `client_id` is absent.** The auth user is created
   but has no `public.users` row, so `my_client_id()` returns NULL and
   every RLS check fails closed. The user can authenticate but can't
   read or write anything.
3. **No `search_path` set** (gap 54) — same theoretical schema-shadowing
   risk as `my_client_id()`.
4. **Doesn't populate `full_name`.** Only `id`, `client_id`, `email`,
   `role` are set. `users.full_name` stays NULL after trigger fires —
   populate manually if needed for display.

### 3.7 `get_public_centro_info(p_slug text)`

```sql
RETURNS TABLE (id uuid, slug text, name text, theme_id text,
               modo_empresa text, empresa_nombre text,
               brand_name text, avatar_url text, modules jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
```

Resolves a centro slug to its safe-public display subset for the SPA
bootstrap path (anon callers and pro-mode authenticated users that the
admin-only policies don't cover). Reads from `public.clients`, returns
only the whitelisted display keys plus the centro id and slug.

Defined in
[20260507120000_clients_professionals_auth_hardening_additive.sql](supabase/migrations/20260507120000_clients_professionals_auth_hardening_additive.sql)
with the corrected return shape in
[20260507120100_correct_clients_professionals_hardening.sql](supabase/migrations/20260507120100_correct_clients_professionals_hardening.sql).

Granted EXECUTE to both `anon` and `authenticated`. Excludes
`config.features` (gap 46 superadmin toggles), `config.empresa.{rut,
email, telefono, direccion, logo_url}`, `config.profile_*`,
`config.whatsapp_*`, `config.resend_from`, and other operational
keys. The full clients row is reachable only via
`clients_admin_read_own` for admins or `clients_super_admin_all`
for super-admins.

Consumed by `src/lib/useClientBootstrap.js`. See section 5.1 for the
SPA-side data flow.

## 4. RLS pattern in policies

Every policy on every public-schema table follows one of four shapes.
Knowing these makes new-policy authoring mechanical: pick the shape that
matches the table's role-scope, plug in the column name, done.

### Pattern 1 — Admin-scoped (`is_admin_of_client(client_id)`)

The single most common pattern, used wherever the table has a `client_id`
column and admin permissions follow tenancy boundaries.

Canonical example: `agents_config_admin_all`

```sql
USING (is_admin_of_client(client_id))
WITH CHECK (is_admin_of_client(client_id));
```

Reads as: "the row's client matches my admin scope." If the user is an
admin of a different client, the EXISTS check inside the helper returns
false and the row is invisible.

Tables using this pattern: `agents_config`, `appointments`, `conversions`,
`email_logs` (read-only), `invoices`, `leads`, `patient_assignments`,
`patients`, `professionals`, `session_types`, `usage_log` (read-only),
`users`. Plus an indirect form via EXISTS-subquery for tables that don't
carry `client_id` directly: `professional_documents`, `professional_schedules`,
`professional_session_types` (each reaches client_id through `professionals`).

The 2026-05-07 RLS hardening session (items 50/51) added two policies
to this pattern's footprint: `clients_admin_read_own` (SELECT for
admins of the centro) and `professionals_authenticated_read_active`
(SELECT for any authenticated user of the centro, scoped to active
professionals). Both replaced over-permissive anon policies
(`clients_public_lookup` and `professionals_public_read_active`) that
were dropped in
[20260507130000_drop_legacy_anon_policies.sql](supabase/migrations/20260507130000_drop_legacy_anon_policies.sql).
The replacement strategy used the SECURITY DEFINER function pattern
(see section 3.7) for the anon path that previously relied on the
permissive policies.

### Pattern 2 — Pro-scoped reads via employment

When a policy needs to gate access to a row owned by a specific pro
at a centro, use `my_employment_id()` directly:

```sql
USING (employment_id = my_employment_id())
```

Examples:
- `appointments_professional_own`
- `assignments_professional_read` / `_update`
- `patients_professional_active_assignment` (via `patient_assignments`
  join)
- `notes_treating_professional_all` (via `patient_assignments` join)
- `professional_schedules` / `_session_types` admin + own policies

Pre-cutover this used `my_professional_id()` against the dropped
`public.professionals` table. Post-cutover, `employment_id` is the
canonical scope and `my_employment_id()` resolves it via the
profiles + employments join.

When the gate is on the profile (identity) side rather than the
employment side, use `my_profile_id()`. Currently only
`employments_self_read` and `professional_documents` policies use
this — the latter via `profile_id = ...` filtering.

### Pattern 3 — Super-admin override (`is_super_admin()`)

Cross-tenant access for platform-level operators. Almost always SELECT-only.

Canonical example: `appointments_super_admin_read`

```sql
USING (is_super_admin());
```

Reads as: "I'm a platform operator, show me everything." No client/role
filter — super admins see across all centros.

Notable absence: `clinical_notes` has **no** super-admin override. Per
Ley 20.584's clinical-authorship rules, even platform operators can't
read clinical notes via RLS. Service-role queries would still bypass
RLS, but those are deliberate operational acts (e.g., legal-compliance
data export).

### Pattern 4 — EXISTS-through-assignment

For tables that don't carry `professional_id` directly but are clinically
gated via `patient_assignments`. The pattern joins through `patient_assignments`
to check whether a treating-professional or admin-with-consent relationship
exists.

Canonical example: `notes_treating_professional_all`

```sql
USING (EXISTS (
  SELECT 1 FROM patient_assignments pa
  WHERE pa.id = clinical_notes.assignment_id
    AND pa.professional_id = my_professional_id()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM patient_assignments pa
  WHERE pa.id = clinical_notes.assignment_id
    AND pa.professional_id = my_professional_id()
    AND pa.status = 'active'::text
));
```

Note the **deliberate asymmetry**: USING (read) allows ANY assignment —
including past/ended ones, so a professional retains read access to
notes from former patients. WITH CHECK (write) requires `pa.status =
'active'` — a professional can only write notes for currently-active
treatment relationships. This is the Ley 20.584 enforcement.

Tables using this pattern: `clinical_notes` (the canonical case),
`patients_professional_active_assignment` (FOR ALL access if active
assignment exists — see gap 57). The clinically-gated-through-relationship
pattern.

## 5. Mode detection (application-side)

The React app determines whether the logged-in user is in pro mode or
admin mode through a two-step lookup. The DB tells the truth (via RLS)
either way, but the UI needs to know up-front to render the right
sidebar items, the right screen permissions, and the right per-screen
chrome.

### Step 1 — URL slug → `clientId` (two-stage hydration)

[src/lib/useClientBootstrap.js](src/lib/useClientBootstrap.js) reads
`window.location.hostname`, extracts a slug (or falls back to
`VITE_DEV_CLIENT_SLUG` for local dev), and calls the SECURITY DEFINER
function `get_public_centro_info(p_slug)` (see section 3.7). The
function returns a narrow display subset: `id`, `slug`, `name`,
`theme_id`, `modo_empresa`, `empresa_nombre`, `brand_name`,
`avatar_url`, `modules`. The SPA's bootstrap context
(`ClientCtx.clientId`, theme application, sidebar branding) all flow
from this single fetch.

This step is **independent of authentication** — anonymous visitors
also need `clientId` to render the eventual public profile page
(cliente.elconsultorio.cl) and consume the same display keys. The
SECURITY DEFINER function bypasses RLS to expose the whitelist
regardless of caller role.

Pre-cutover (before 2026-05-07), this step read `public.clients`
directly via the now-dropped `clients_public_lookup` policy, exposing
the full row to anon callers — see resolved gap 50 in
[08_known_gaps.md](.claude-context/08_known_gaps.md).

Post-login, [src/lib/useClientConfig.js](src/lib/useClientConfig.js)
fires a separate fetch for the full `clients.config` jsonb via the
admin-only `clients_admin_read_own` policy. Admins receive the full
row including sensitive keys (empresa contact info, integration
secrets, gap-46 feature toggles) and write back via `setConfig` plus
`mergeClientConfig`. Pros' `useClientConfig` fetch returns no rows
(PostgREST signals PGRST116; the hook handles via `.maybeSingle()`
and reports `config: null`). Pro-mode UI consumes only the bootstrap
display subset; the empty post-login fetch is gap-60 territory until
a pro-specific Ajustes view is designed.

The two stages run in parallel on page load: bootstrap fires
immediately (anon-callable, no session needed), and the post-login
fetch fires when both `session` and `bootstrap.clientId` resolve.
App.jsx's loading gate waits on both `bootstrap.loading` and the
session/professional resolution before rendering.

### Step 2 — `(clientId, auth.uid())` → `professional`

[src/App.jsx:70-80](src/App.jsx) runs once the session and `clientId`
are both available:

```js
supabase.from('professionals')
  .select('*')
  .eq('client_id', clientId)
  .eq('user_id', session.user.id)
  .eq('active', true)
  .maybeSingle()
  .then(({ data }) => setProfessional(data ?? null))
```

If a row comes back, `ClientCtx.professional` is non-null and the user
is in pro mode. If not, admin mode. This single boolean (`isPro =
!!professional`) gates everything UI-side.

### The slug-mismatch gotcha (re-stated)

The two steps read from independent sources: URL → clients table, JWT →
users + professionals tables. Nothing enforces that they agree.

If a user with `users.client_id = B` visits `clientA.elconsultorio.cl`:
- `useClient.js` resolves clientId to client A
- `professional` lookup runs as `(A, my-uid)` and returns null (the user
  has no professional record under client A)
- App falls into admin mode (`isPro = false`)
- But RLS scopes every query via `my_client_id()` which returns B
- All admin queries scoped to client A return empty (rows belong to B,
  which the policy excludes)
- User sees a blank dashboard with no error

Detection in the wild is fast — empty patient list, empty agenda — but
the silent-empty failure mode is operationally fragile. No fix tracked
yet; document defensively here so future-you knows to check this first
when "the dashboard is empty for [user]" is the symptom.

### The two-lists architectural pattern

There are two pro-mode lists in the codebase, and they serve different
concerns:

| File | Variable | Concern | Current value (pro mode) |
|---|---|---|---|
| [src/App.jsx:115-120](src/App.jsx) | `allowed` | Screen-render permission | `['calendar', 'patients', 'settings', 'files']` |
| [src/screens/shared.jsx:209](src/screens/shared.jsx) | `proAllowed` | Sidebar nav visibility | `['calendar', 'patients', 'settings']` |

`allowed` controls which hash routes can render their screen.
`proAllowed` controls which sidebar items are visible. They are not the
same: `files` is screen-permitted (reachable via "Ver ficha" buttons
that set the URL hash) but not sidebar-visible (clinical fichas have no
nav entry, even for admins — `ALL_ITEMS` doesn't include `files`).

Item 41's smoke test surfaced this: the original `allowed` list was
`['calendar', 'patients', 'settings']` (same as `proAllowed`), so URL
navigation to `#files/<patient_id>` fell back to `calendar`. The fix in
commit `0684d84` separated the lists, adding `files` to `allowed` while
leaving `proAllowed` untouched. `billing` was deliberately *not* added
to either — billing is admin/receptionist territory, and the same
commit hides "Cobrar" buttons in pro mode for the same reason.

The architectural lesson: **screen-render permission and nav visibility
are distinct concerns**. Don't conflate the lists, even when their
contents happen to match. Future additions of URL-only screens (e.g.,
patient print views, certificate generation flows) belong in `allowed`
without touching `proAllowed`.

## 6. Provisioning runbook

How to provision a new auth user that ends up correctly wired as either
an admin or a professional.

The *worked example* below uses the values from item 41's Pro 3
provisioning:

| Variable | Value |
|---|---|
| Vitalis `client_id` | `6e03ed81-8c3b-47e7-82f9-3f6767de70ce` |
| Pro 3 `professionals.id` | `e9a69860-d0f1-4a91-a75e-bccd17b3ec95` |
| New auth user `id` | `e4ff8c48-ca93-4422-8701-9d229b660c66` |
| New auth user `email` | `prof3@test.cl` |
| `role` for users.role | `professional` (any value other than `admin` works) |

Substitute values for production. Two scenarios — the **ideal path**
(set metadata at creation time, trigger does the work) and the
**workaround** (when metadata wasn't set at creation, manual recovery).

### Scenario A — Ideal path (recommended)

When you can set `raw_user_meta_data` at the moment of auth user
creation, the `handle_new_user` trigger does the public.users insert
for free.

1. **Supabase Dashboard → Authentication → Users → Add user → Create
   new user.**
2. Set:
   - Email: `prof3@test.cl`
   - Password: a strong password (or "Auto Confirm User" if available)
3. **In the same form, set "User Metadata" (raw_user_meta_data):**
   ```json
   {
     "client_id": "6e03ed81-8c3b-47e7-82f9-3f6767de70ce",
     "role": "professional"
   }
   ```

   > **Note:** as of 2026-05-06, the Supabase Dashboard's "Add user"
   > form may not expose the User Metadata field directly. If so, fall
   > through to Scenario B. The Auth Admin API supports user_metadata
   > at creation cleanly (`auth.admin.createUser({ email, password,
   > user_metadata: {...} })`), which is the recommended approach for
   > programmatic provisioning.
4. Submit. The `on_auth_user_created` trigger fires, `handle_new_user`
   reads the metadata, and inserts a `public.users` row with the
   matching `client_id` and `role`.
5. **Wire the auth user to the professional record** (in the SQL
   editor):
   ```sql
   UPDATE public.professionals
   SET    user_id = 'e4ff8c48-ca93-4422-8701-9d229b660c66'
   WHERE  id = 'e9a69860-d0f1-4a91-a75e-bccd17b3ec95';
   ```
6. Verify (see the verification query block at the end of this section).

For an **admin** user instead of a professional, change `role` in
metadata to `'admin'` and skip step 5 (admins don't need a
`professionals` link).

### Scenario B — Workaround (metadata set after creation)

This is the path item 41 took when the auth user was created first
without metadata, and metadata was added afterward via the Dashboard's
edit-user form. The trigger won't retroactively fire for an INSERT
that's already happened.

1. **Dashboard creation** (or Auth API), no metadata set initially.
2. **Set metadata via the Dashboard's edit-user form** (or `auth.admin
   .updateUser`). This step does NOT fire the trigger; it only updates
   the metadata column on the existing auth user.
3. **Manually insert the public.users row** in the SQL editor:
   ```sql
   INSERT INTO public.users (id, client_id, email, role)
   VALUES (
     'e4ff8c48-ca93-4422-8701-9d229b660c66',
     '6e03ed81-8c3b-47e7-82f9-3f6767de70ce',
     'prof3@test.cl',
     'professional'
   );
   ```
4. **Wire the auth user to the professional record:**
   ```sql
   UPDATE public.professionals
   SET    user_id = 'e4ff8c48-ca93-4422-8701-9d229b660c66'
   WHERE  id = 'e9a69860-d0f1-4a91-a75e-bccd17b3ec95';
   ```
5. Verify.

### Verification query (both scenarios)

After provisioning, this single query confirms the full chain is wired
correctly. Run in the Supabase SQL editor:

```sql
-- Verify the auth.users row has a corresponding professional profile.
SELECT au.id, au.email, pp.id AS profile_id, pp.full_name,
       e.id AS employment_id, e.client_id
FROM auth.users au
LEFT JOIN public.professional_profiles    pp ON pp.user_id    = au.id
LEFT JOIN public.professional_employments e  ON e.profile_id  = pp.id
WHERE au.email = 'prof3@test.cl';
```

Note: post-gap-66 this query can return 0+ rows per email — multiple
if the pro has employments at multiple centros. To narrow to a
specific centro, add `AND e.client_id = '<client_id>'`.

Expected output for a correctly-provisioned **professional**: one row
per (profile, employment) pair. The `profile_id` is non-null (auth
user has claimed a profile); the `employment_id` is non-null
(employment exists at the centro).

For a correctly-provisioned **admin**: zero rows from this query
(admins do not get a `professional_profiles` link). To verify admin
state, query `public.users` directly:
`SELECT role, client_id FROM public.users WHERE id = au.id`.

If the row is missing entirely → step 1 (auth user creation) didn't
happen.
If `profile_id` is NULL but a row was expected → step 5
(`UPDATE professional_profiles.user_id`) was skipped or hit the
wrong row — note that `user_id` is now UNIQUE on
`professional_profiles` per gap 66, so cross-pro misassignment via
this path is structurally prevented.
If `employment_id` is NULL → the profile exists but no employment
row was created at the centro; admin should run "Agregar profesional"
or use `create_professional_at_centro()` RPC.
If `users_active` is false → the user is provisioned but soft-disabled;
`is_admin_of_client()` will return false until reactivated.

### Browser smoke test

Final confirmation, run in a browser:

1. Open `https://<centro-slug>.elconsultorio.cl` (or `localhost:5173`
   for local dev with `VITE_DEV_CLIENT_SLUG=<centro-slug>`).
2. Sign in with the new auth user's email and password.
3. **Expected**: lands on the correct default screen
   (`agenda` for pros, `leads` for admins) with the sidebar showing
   the correct nav items.
4. For pros: Pacientes screen lists only patients with active
   assignments to that professional. Click "Ver ficha" on one →
   ficha clínica renders → "Nueva sesión" → Guardar → INSERT
   succeeds (treating-professional write path).

   Requires the test patient to already have an active
   `patient_assignments` row pointing at this professional. Patients
   without such an assignment won't appear in the pro's list, and
   clinical_notes writes against their fichas would fail RLS check
   (the `notes_treating_professional_all` WITH CHECK requires
   `pa.status = 'active'` for the linked assignment).
5. For admins: full nav visible, all client-scoped tables readable
   and writable.

## 7. Roles in `public.users.role`

The `role` column on `public.users` is `text NOT NULL DEFAULT 'owner'`
with no CHECK constraint and no enum type backing it. Three values are
in use across the codebase and in current data: `'admin'`, `'owner'`,
and `'professional'`. Each is described below by what it grants in RLS
(the load-bearing semantics), what it hints at for UX (the convention),
and what it explicitly does NOT control.

This is a **soft gap**: the lack of constraint means a typo or a future
caller could write any string into the column, and RLS would
silently treat unknown values as not-admin. Worth a future hardening
pass to add a CHECK constraint enumerating these three values; not big
enough to track as a standalone gap entry today.

### `'admin'`

**RLS:** `is_admin_of_client(client_id)` returns true for users with this
role (plus `active = true` and matching `client_id`). Unlocks every
`*_admin_*` policy across 14 tables — the broadest permission scope
available short of `is_super_admin()`.

**UX hint:** Convention is admin mode in App.jsx. But App.jsx doesn't
read `role` at all; it determines pro vs admin by checking whether a
`professional_profiles` row links to the auth user (via
`professional_profiles.user_id = auth.uid()`, joined to a
`professional_employments` row at the current centro). So a user
with `role = 'admin'` and a `professional_profiles.user_id` link
would show the pro-mode UX while having full admin RLS — a confusing
dual state. Provisioning discipline: admins do not get a
`professional_profiles.user_id` link. See section 6.

**Does NOT control:** pro-mode detection (independent of role),
super-admin status (separate `super_admins` table), any non-RLS
authorization (App.jsx route guards read `professional`, not `role`).

### `'owner'`

**RLS:** `is_admin_of_client()` returns FALSE for this role — `'owner' !=
'admin'`. So admin policies do not apply. Functionally, an `'owner'`
has the same RLS scope as `'professional'` or any other non-admin
value: their tenancy mapping exists (so `my_client_id()` works) but
admin-scoped tables are invisible to them.

**UX hint:** None directly enforced. The default value from the
`handle_new_user` trigger when no role is specified in
`raw_user_meta_data`. Likely a legacy choice from before the role
distinction was meaningful; in current data, several existing users
carry this value without practical consequence because their RLS access
is functionally indistinguishable from `'professional'`.

**Does NOT control:** anything load-bearing today. No policy reads
`role = 'owner'` specifically. Treat as "tenancy mapping exists but no
elevated permissions" — equivalent to a public-mode user inside a
specific centro.

### `'professional'`

**RLS:** Same as `'owner'` from the policy perspective — `is_admin_of_client()`
returns FALSE. The professional's actual permissions come from their
`professional_profiles` row (matched on `user_id`) plus the linked
`professional_employments` row at the centro, and the pro-scoped
policies in pattern 2 / pattern 4 (section 4), not from this role
value.

**UX hint:** Convention is "this auth user is a treating professional."
Should be paired with a `professional_profiles.user_id` link plus an
active `professional_employments` row pointing at the centro. App.jsx's
pro-mode detection runs independently of this `role` value, so even
setting `role = 'professional'` without the profile + employment link
would not put the user in pro mode. The role value is mostly a label
for human readability.

**Does NOT control:** pro-mode detection (still based on the
`professional_profiles.user_id` linkage + an active employment at the
current centro), any RLS policy directly (no policy reads
`role = 'professional'`).

### Consistent provisioning matrix

| Intended user kind | `users.role` | `professional_profiles.user_id` + active employment | Result |
|---|---|---|---|
| Admin | `'admin'` | none | Admin UX + admin RLS |
| Treating professional | `'professional'` | profile linked + employment with `active = true` | Pro UX + pro RLS |
| Misconfigured (admin with pro link) | `'admin'` | profile linked | Pro UX + admin RLS — avoid |
| Misconfigured (pro role no link) | `'professional'` | none | Admin UX + no admin RLS — locked out |

The two axes — `role` on `public.users` and `user_id` on
`professional_profiles` (plus an active `professional_employments`
row) — are independent and must be aligned manually during
provisioning.

## 8. Centro feature toggles (planned)

> **Status: planned, not implemented.** This section documents an
> architectural decision locked-in during the 2026-05-05 session
> ([gap 46](.claude-context/08_known_gaps.md)). No toggles currently
> exist in production; no policies currently read from this path. Future
> sessions will implement.

### The model

Centro-level feature flags will live in `clients.config.features`
(jsonb) — an object whose keys are toggle names and values are
booleans. The pattern is:

- **Superadmin-controlled.** Only platform operators can flip toggles.
  Centros consume the decisions; they cannot change their own toggles
  in their dashboard.
- **Centro-consumed.** RLS policies and feature gates read from the
  jsonb to decide permissions or feature availability for that centro's
  users.
- **Restrictive defaults.** Missing key or `false` means the feature is
  off. Centros must be explicitly granted access.

Until a superadmin dashboard exists (Phase 3 work), toggles are flipped
via direct SQL `UPDATE` on `clients.config`.

### Why this section belongs in the auth doc

Permission decisions in the codebase currently use two axes:

1. **Tenancy** — `my_client_id()` / `client_id` matching
2. **Role** — `is_admin_of_client()` / `my_professional_id()` /
   `is_super_admin()`

Centro feature toggles will become the third axis. A future policy
might read: *"this admin can view clinical notes if their centro has
been granted the `admin_can_view_clinical_notes` feature."* That
decision combines tenancy (centro id), role (admin), and feature
toggle (granted or not).

This is auth surface, not arbitrary configuration. Documenting the
pattern here keeps the auth model coherent across implementation
phases.

### First toggle: `admin_can_view_clinical_notes`

The current `notes_admin_with_consent` policy uses a per-assignment flag
(`patient_assignments.admin_can_view_notes`):

```sql
USING (EXISTS (
  SELECT 1 FROM patient_assignments pa
  WHERE pa.id = clinical_notes.assignment_id
    AND pa.client_id = my_client_id()
    AND pa.admin_can_view_notes = true
    AND is_admin_of_client(pa.client_id)
));
```

The planned migration replaces the `pa.admin_can_view_notes = true`
predicate with a centro-level toggle:

```sql
-- Future form (illustrative, not deployed):
USING (EXISTS (
  SELECT 1 FROM patient_assignments pa
  JOIN public.clients c ON c.id = pa.client_id
  WHERE pa.id = clinical_notes.assignment_id
    AND pa.client_id = my_client_id()
    AND (c.config -> 'features' ->> 'admin_can_view_clinical_notes')::boolean = true
    AND is_admin_of_client(pa.client_id)
));
```

This shifts the decision from per-assignment (admin must individually
flag each patient) to per-centro (the platform operator decides which
centros qualify, e.g., centros where the admin is also a licensed
professional, or where consent flows are appropriately handled per
Ley 20.584). Granular control becomes administrative; bulk grant
becomes operational.

### Implementation order (when this lands)

1. Document the `clients.config.features` jsonb schema (no migration
   needed — the `config` column already exists). The doc becomes the
   contract: which keys exist, what they mean, what off vs on
   produces.
2. Update RLS policies that should read toggles (starting with
   `notes_admin_with_consent`).
3. Eventually build the superadmin dashboard UI to flip toggles
   visually instead of by SQL.

Coordinates with resolved [gap 50](.claude-context/08_known_gaps.md)
(clients.config exposure to anon, closed 2026-05-07): the bootstrap
subset returned by `get_public_centro_info(p_slug)` (section 3.7)
explicitly excludes `config.features`, so toggle values never leak to
anon visitors or to pro-mode authenticated users. Admin-only
`clients_admin_read_own` is the single read path for the full
`clients.config` jsonb; admins of an admin-grant centro see toggle
values, all other roles do not.

Coordinates also with [gap 67](.claude-context/08_known_gaps.md) (admin-
owner vs admin-receptionist clinical authority distinction). The
planned `is_admin_with_clinical_authority(p_client_id)` helper combines
admin role + professional link + this section's centro toggle. Without
gap 67's helper, the gap-46 toggle is too coarse — once a centro grants
admin clinical access, all admins (including receptionists) inherit it.
Tackle gap 67 in the same session as gap 46's first toggle implementation.

## 9. Cross-references and out-of-scope notes

### 9.1 Cross-references

**Migration files** (the source of truth for the live schema):

- [20260506000000_baseline_helper_functions.sql](supabase/migrations/20260506000000_baseline_helper_functions.sql)
  — the four RLS helpers + `set_updated_at` + `handle_new_user` +
  `on_auth_user_created` trigger
- [20260506000100_baseline_rls_policies.sql](supabase/migrations/20260506000100_baseline_rls_policies.sql)
  — all 49 RLS policies across 18 tables
- [20260506000200_baseline_grants.sql](supabase/migrations/20260506000200_baseline_grants.sql)
  — table grants on 20 objects + function EXECUTE on 8 functions
- [20260506000300_add_missing_updated_at_triggers.sql](supabase/migrations/20260506000300_add_missing_updated_at_triggers.sql)
  — adds `set_clinical_notes_updated_at` and `set_patient_assignments_updated_at`
- [20260507120000_clients_professionals_auth_hardening_additive.sql](supabase/migrations/20260507120000_clients_professionals_auth_hardening_additive.sql)
  — items 50/51 phase 1: `get_public_centro_info` SECURITY DEFINER
  function, `clients_authenticated_read_own` (later corrected),
  `professionals_authenticated_read_active`
- [20260507120100_correct_clients_professionals_hardening.sql](supabase/migrations/20260507120100_correct_clients_professionals_hardening.sql)
  — corrections to the function whitelist (added brand_name,
  avatar_url, modules) and the clients policy (renamed/scoped to
  admin-only via `clients_admin_read_own`)
- [20260507130000_drop_legacy_anon_policies.sql](supabase/migrations/20260507130000_drop_legacy_anon_policies.sql)
  — drops `clients_public_lookup` and `professionals_public_read_active`,
  closing items 50/51
- [20260508120000_align_with_future_default_acl.sql](supabase/migrations/20260508120000_align_with_future_default_acl.sql)
  — pre-applies Supabase's October 30, 2026 ALTER DEFAULT PRIVILEGES
  REVOKE on tables and sequences in public schema. Project ACL state
  now matches the post-deadline platform default. Gap 55 closure.
- Plus 5 historical RPC migrations amended in commit fc8ba47 to add
  explicit GRANT EXECUTE statements (gap 56 closure): 20260501230000,
  20260502100000, 20260506000000, 20260507120000, 20260507120100.

**Related context docs:**

- [01_architecture.md](.claude-context/01_architecture.md) — system
  overview, stack summary, multi-tenant model
- [02_database_schema.md](.claude-context/02_database_schema.md) —
  full schema dump including all auth-adjacent tables (`users`,
  `professionals`, `super_admins`, `clients`, `clinical_notes`,
  `patient_assignments`)
- [03_database_functions.md](.claude-context/03_database_functions.md)
  — full function inventory; the four RLS helpers + `handle_new_user`
  + `set_updated_at` are duplicated there with full bodies

**Gap entries touching auth** (in `08_known_gaps.md`):

- ✅ Resolved: 40 (RLS-as-code baseline), 41 (test pro provisioning),
  42 (auth model doc), 50 (clients_public_lookup, closed 2026-05-07),
  51 (professionals_public_read_active, anon half closed 2026-05-07;
  deferred public function rolled into gap 66), 53 (missing updated_at
  triggers), 21 (write path verified during 41), 55 (default ACL not
  migration-captured, closed 2026-05-08 via deadline-aligned revoke),
  56 (RPC migrations lacking GRANT EXECUTE, closed 2026-05-08 via
  audit-and-amend plus convention doc)
- HIGH priority open: (none)
- MEDIUM priority open: 46 (centro feature toggles, planned), 52
  (appointments_professional_own DELETE), 57
  (patients_professional_active_assignment FOR ALL), 58
  (users_admin_write allows DELETE), 59-63 (pro mode UX cluster), 66
  (professionals data model refactor), 67 (admin-owner clinical
  authority distinction)
- LOW priority open: 54 (`my_client_id` and `handle_new_user` lack
  `search_path`), 64 (BOT ACTIVO sidebar block visible to pros), 65
  (gap 65 RESOLVED in commit 7890b00 — professional_profiles.user_id is UNIQUE per the new schema), 68 (SPA
  effect-dep hygiene)
- Forward-looking: 46 + 67 jointly (centro feature toggles +
  clinical-authority helper); gap 66 prerequisite for public profile
  page

**Session log entries** with architectural decisions:

- [09_session_log.md](.claude-context/09_session_log.md) entry
  `2026-05-05 → 2026-05-07 — Tier 1 closure + architectural alignment`
  — covers items 40, 41, 42 as a continuous arc; documents the
  feature-toggles decision; locks in the pro-mode-routing
  two-lists pattern lesson (commit `0684d84`)
- [09_session_log.md](.claude-context/09_session_log.md) entry
  `2026-05-07 — Items 50/51 RLS hardening + β architecture cutover`
  — covers the six-commit β cutover, captures architectural
  decisions about two-stage SPA hydration, locks in
  `config.features` admin-only invariant, surfaces gaps 66/67/68,
  documents the data-vs-presentation split that informs gap 66
- [09_session_log.md](.claude-context/09_session_log.md) entry
  `2026-05-08 — Gaps 55/56 closure: deadline-driven default-ACL alignment`
  — five-phase closure of the two HIGH-priority gaps remaining after
  items 50/51, including pre-applied Supabase October 30 default-ACL
  revoke and the new migration-conventions.md doc establishing
  GRANT requirements going forward.

### 9.2 Out-of-scope notes

Topics deliberately **not** covered here, and where to look instead:

- **`clients.config.modules`** — undocumented field referenced by
  Sidebar. See [gap 27](.claude-context/08_known_gaps.md) for
  status. Not auth-related; controls module-level nav visibility per
  centro, separate concern from role/tenancy.

- **Bot / Make.com auth path** — the Telegram bot authenticates
  separately from the dashboard, via Make.com keychains hitting the
  Supabase REST and Edge Function endpoints with service-role
  credentials. That auth surface lives in the Make.com workflow
  configuration and the booking Edge Function, not in the user-side
  auth model. See [01_architecture.md](.claude-context/01_architecture.md)
  for the bot orchestration overview.

- **RPC endpoint auth patterns** — `create_booking_atomic` and
  `get_bot_context` have their own EXECUTE grant story (captured in
  [gap 56](.claude-context/08_known_gaps.md)). When more RPC endpoints
  exist and the pattern stabilizes, a separate `rpc_endpoints.md` doc
  may be warranted. Today, RPC auth is covered by the SECURITY DEFINER
  defaults plus default ACLs (gap 55).

- **Operational auth concerns** — password reset, email verification,
  magic link flows, MFA: all Supabase-managed. See Supabase docs
  ([supabase.com/docs/guides/auth](https://supabase.com/docs/guides/auth)).
  Our codebase uses only `signInWithPassword`; everything else is
  off-the-shelf.

- **Frontend session refresh mechanics** — `supabase-js` handles JWT
  refresh, session persistence in localStorage, and reactive auth
  state via `onAuthStateChange`. Not specific to our auth model;
  consult the supabase-js docs if behavior needs tuning.
