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
these via four helper functions; the React app reads from `professionals.user_id`
directly to determine pro vs admin mode. The two paths must agree on which
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

### 2.3 `public.professionals` (clinical staff)

Clinical staff registry. A professional row can exist independently of
any auth user — `user_id` is nullable, used for pre-provisioning a
professional record (full_name, schedule, public profile) before the
person has a login.

Auth-relevant columns:
- `id` (uuid, PK) — what `my_professional_id()` returns
- `client_id` (uuid, NOT NULL) — the centro
- `user_id` (uuid, nullable) — links to `auth.users.id` when the
  professional has a login
- `active` (bool, default true) — gates `my_professional_id()` and
  several public-read policies

A single `auth.users.id` could in principle be linked to multiple
professional rows because there's **no UNIQUE constraint on
`professionals.user_id`**. `my_professional_id()` defends against this
with `LIMIT 1` — picking arbitrarily if such a state exists. Worth a
gap entry if this ever becomes a real concern; in practice we provision
one auth user per professional.

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

### 3.2 `my_professional_id()`

```sql
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
```

Reads `public.professionals` where `user_id = auth.uid() AND active = true`,
returns the `id` (or NULL) of the first match. The `LIMIT 1` is a
defensive choice — see section 2.3.

Consumed by 8 distinct policies across 7 tables: `appointments_professional_own`,
`assignments_professional_read`, `assignments_professional_update`,
`notes_treating_professional_all`, `patients_professional_active_assignment`,
`pd_professional_own`, `ps_professional_own`, `pst_professional_own`,
`session_types_professional_read`. The pro-mode authorization workhorse.

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

### Pattern 2 — Pro-scoped (`my_professional_id()`)

For tables that carry a `professional_id` column directly. The treating
professional has full or limited access to their own rows.

Canonical example: `appointments_professional_own`

```sql
USING (professional_id = my_professional_id())
WITH CHECK (professional_id = my_professional_id());
```

Reads as: "I own this row as a professional." Returns NULL for non-pros,
which the `=` then evaluates to NULL → row invisible.

Tables using this pattern: `appointments` (FOR ALL — see gap 52),
`patient_assignments` (split into SELECT + UPDATE-only-if-active),
`professional_documents`, `professional_schedules`,
`professional_session_types`. The own-resource pattern.

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

### Step 1 — URL slug → `clientId`

[src/lib/useClient.js](src/lib/useClient.js) reads `window.location.hostname`,
extracts a slug (or falls back to `VITE_DEV_CLIENT_SLUG` for local dev),
and queries `public.clients` by slug to get the centro's `id` and
`config`. The result populates `ClientCtx.clientId` for every
downstream consumer.

This step is **independent of authentication** — anonymous visitors
also need `clientId` to render the public profile (eventual
`cliente.elconsultorio.cl`). The `clients_public_lookup` policy
(`USING (true)` for `{anon, authenticated}`) supports this — and
exposes more than it should; see gap 50.

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
SELECT
  au.email                AS auth_email,
  au.id                   AS auth_user_id,
  u.client_id             AS users_client_id,
  u.role                  AS users_role,
  u.active                AS users_active,
  p.id                    AS professional_id,
  p.full_name             AS professional_name,
  p.active                AS professional_active
FROM auth.users au
LEFT JOIN public.users         u ON u.id      = au.id
LEFT JOIN public.professionals p ON p.user_id = au.id
WHERE au.email = 'prof3@test.cl';
```

Expected output for a correctly-provisioned **professional**: one row,
all columns non-null, both `active` flags true, `users_role` is
non-`'admin'`.

For a correctly-provisioned **admin**: one row, `users_*` columns
populated, `professional_*` columns NULL (no professionals link
needed), `users_role = 'admin'`.

If the row is missing entirely → step 1 (auth user creation) didn't
happen.
If `users_*` columns are NULL → trigger didn't fire (Scenario A failure
mode) or manual INSERT was skipped (Scenario B failure mode).
If `professional_*` columns are NULL but a row was expected → step 5
(`UPDATE professionals.user_id`) was skipped or hit the wrong row.
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
`professionals` row links to the auth user. So a user with `role =
'admin'` and a `professionals.user_id` link would show the pro-mode UX
while having full admin RLS — a confusing dual state. Provisioning
discipline: admins do not get a `professionals.user_id` link. See
section 6.

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
`professionals` row (matched on `user_id`) and the pro-scoped policies
in pattern 2 / pattern 4 (section 4), not from this role value.

**UX hint:** Convention is "this auth user is a treating professional."
Should be paired with a `professionals.user_id` link pointing at the
matching staff record. App.jsx's pro-mode detection runs independently
of this value, so even setting `role = 'professional'` without the
professionals link would not put the user in pro mode. The role value
is mostly a label for human readability.

**Does NOT control:** pro-mode detection (still based on the
`professionals.user_id` linkage), any RLS policy directly (no policy
reads `role = 'professional'`).

### Consistent provisioning matrix

| Intended user kind | `users.role` | `professionals.user_id` link | Result |
|---|---|---|---|
| Admin | `'admin'` | none | Admin UX + admin RLS |
| Treating professional | `'professional'` | set, with `active = true` | Pro UX + pro RLS |
| Misconfigured (admin with pro link) | `'admin'` | set | Pro UX + admin RLS — avoid |
| Misconfigured (pro role no link) | `'professional'` | none | Admin UX + no admin RLS — locked out |

The two axes — `role` and `professionals.user_id` link — are independent
and must be aligned manually during provisioning.

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

Coordinates with [gap 50](.claude-context/08_known_gaps.md) (clients.config
exposure) — the bootstrap-safe subset of `config` exposed to anon must
NOT include `features`, since toggle values are themselves sensitive
information (knowing which centros have which features enabled is recon
data for targeted attacks).

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
  53 (missing updated_at triggers), 21 (write path verified during 41)
- HIGH priority open: 42 (this doc — closes when this lands), 50
  (clients_public_lookup exposure), 51 (professionals_public_read_active
  exposure), 55 (default ACL not migration-captured), 56 (RPC migrations
  lack explicit GRANT EXECUTE)
- MEDIUM priority open: 52 (appointments_professional_own DELETE), 57
  (patients_professional_active_assignment FOR ALL), 58 (users_admin_write
  allows DELETE), 59-63 (pro mode UX cluster from item 41 smoke test)
- LOW priority open: 54 (`my_client_id` and `handle_new_user` lack
  `search_path`), 64 (BOT ACTIVO sidebar block visible to pros)
- Forward-looking: 46 (centro feature toggles — see section 8)

**Session log entries** with architectural decisions:

- [09_session_log.md](.claude-context/09_session_log.md) entry
  `2026-05-05 → 2026-05-07 — Tier 1 closure + architectural alignment`
  — covers items 40, 41, 42 as a continuous arc; documents the
  feature-toggles decision; locks in the pro-mode-routing
  two-lists pattern lesson (commit `0684d84`)

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
