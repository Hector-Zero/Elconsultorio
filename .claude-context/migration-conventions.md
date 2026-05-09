# Migration conventions

> Conventions for SQL migrations in `supabase/migrations/`. Read before writing a new migration.

## Why this exists

Supabase auto-applied default privileges (anon, authenticated, service_role granted SIUD on new public-schema tables and EXECUTE on new functions) until [the breaking-change announcement](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically). This project pre-applied the platform's October 30, 2026 revoke ourselves in `20260508120000_align_with_future_default_acl.sql` (commit `c662fa1`), so we can no longer rely on platform defaults to make new objects reachable via the Data API.

After the project's own revoke migration: a new table or function migration without explicit GRANT statements creates an unreachable object. The convention below makes grants part of every migration that creates a public-schema object.

## The conventions

### Tables

Every CREATE TABLE in `public` schema needs explicit GRANT statements. Pattern:

```sql
CREATE TABLE public.example (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ...
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.example
  TO anon, authenticated, service_role;
```

Standard role list is `anon, authenticated, service_role`. RLS policies determine *what rows* each role sees; the GRANT determines whether the role can issue the SQL verb at all. Both layers are required.

If a table should be inaccessible to anon (e.g., admin-only), still GRANT to anon — the RLS policies will filter rows to zero. Skipping the GRANT silently breaks PostgREST queries with permission errors that look like RLS errors.

### Functions

Every CREATE OR REPLACE FUNCTION in `public` schema (defined by your migration as the first creation) needs explicit GRANT EXECUTE. Pattern:

```sql
CREATE OR REPLACE FUNCTION public.example_fn(p_arg uuid)
RETURNS ... LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$ ... $$;

GRANT EXECUTE ON FUNCTION public.example_fn(uuid)
  TO anon, authenticated, service_role;
```

#### CREATE OR REPLACE doesn't reset grants

If you're *updating* an existing function (its first CREATE was in an earlier migration), the GRANT only needs to live in the original creation migration. Subsequent CREATE OR REPLACE migrations can omit it — grants persist across replacement.

Example: `get_bot_context` was created in `20260501230000_update_get_bot_context.sql` with its grant (after Phase 2 amend). Three subsequent update migrations (`20260504000000`, `20260504010000`, `20260504020000`) modified the function body without re-stating the grant. Production retained the grant.

#### Type aliases — match the file's CREATE statement

`int` and `integer` are aliases. So are `timestamptz` and `timestamp with time zone`. Both resolve to the same function OID at lookup time. When writing the GRANT, match the form used in the file's own CREATE OR REPLACE FUNCTION declaration. This keeps each file internally consistent. Cross-file normalization is not a goal.

#### Trigger functions still get the standard grant

`set_updated_at` and `handle_new_user` are trigger-only — never invoked directly by clients. They still get the standard `GRANT EXECUTE ... TO anon, authenticated, service_role` per the `baseline_grants.sql` precedent. Harmless redundancy is preferred over per-function judgment about who can invoke what. If you're certain a function should be locked-down (e.g., a privileged operation only callable as `postgres`), document the narrowed grant in a comment.

### Sequences

Sequences created implicitly by `SERIAL`/`BIGSERIAL` columns or via `CREATE SEQUENCE` need explicit GRANT for any role that should be able to use them:

```sql
GRANT USAGE, SELECT ON SEQUENCE public.example_id_seq
  TO anon, authenticated, service_role;
```

Most tables in this project use `uuid PRIMARY KEY DEFAULT gen_random_uuid()` rather than serial integers, so explicit sequence grants are rare. But if a future migration uses a serial column, the sequence GRANT is required.

## What NOT to do

- **Don't `ALTER DEFAULT PRIVILEGES` in migrations.** That's platform-level configuration. The project's only intentional ALTER DEFAULT PRIVILEGES is `20260508120000_align_with_future_default_acl.sql`, which mirrors Supabase's October 30 change. Future migrations should not touch defaults.
- **Don't grant to `supabase_admin`-owned defaults.** Platform infrastructure boundary.
- **Don't grant to `PUBLIC`.** Always use the explicit role list (`anon, authenticated, service_role`). PUBLIC is broader than the platform's three-role model and creates surprising attack surface.
- **Don't skip a GRANT thinking "RLS will protect it."** RLS gates row visibility; GRANT gates SQL verb access. PostgREST errors at the GRANT layer return permission errors that look like bugs in the SPA.

## File structure

Migration filename pattern: `YYYYMMDDHHMMSS_descriptive_name.sql` where the timestamp is the local time of authoring (UTC also acceptable; consistency within a session matters more than absolute timezone choice).

Every migration starts with a header comment block:

```sql
-- ============================================================================
-- 20260508120000_descriptive_name.sql
--
-- Brief explanation of what this migration does and why.
-- Resolves: gap N if applicable.
-- Coordinated with: other gaps/commits if applicable.
-- ============================================================================
```

Migrations should be idempotent where reasonable (e.g., `CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS`). When idempotency conflicts with intent (e.g., a migration that explicitly fails if the prior state is unexpected), favor explicit-failure with a clear error message.

## When the convention is violated

The feedback loop is:
1. Migration runs cleanly in dev (and in prod, since prod has the existing default ACL revoked).
2. PostgREST returns 401/403 errors when SPA tries to query the new object.
3. Errors look like RLS issues but are actually GRANT issues.

If you see "permission denied for table X" or "permission denied for function Y" in PostgREST responses, check `information_schema.role_table_grants` or `information_schema.role_routine_grants` for the role in question. If the GRANT is missing, the migration violated this convention.

## RLS recursion in cross-referencing policies

When two tables have RLS policies that subquery each other (table A's
policy contains a subquery on table B; table B's policy contains a
subquery on table A), Postgres aborts with error 42P17 "infinite
recursion detected in policy." This happens because Postgres evaluates
all permissive policies on each table as OR'd together, so triggering
any policy on either table cascades through the cross-referencing
ones.

Fix: replace the inline subqueries with SECURITY DEFINER helper
functions. SECURITY DEFINER functions run as the function owner
(which has BYPASSRLS in Supabase); their internal queries don't
trigger RLS on the queried tables, breaking the cycle.

Pattern (from the gap 66 work):
  - `my_profile_id()` returns the auth user's profile id; replaces
    the inline `SELECT id FROM professional_profiles WHERE user_id = auth.uid()`
    that lived in `employments_self_read`.
  - `is_admin_for_active_employment(p_profile_id)` returns boolean;
    replaces `id IN (SELECT profile_id FROM professional_employments
    WHERE is_admin_of_client(client_id) AND active = true)` in
    `profiles_admin_read`.
  - `is_admin_for_any_employment(p_profile_id)` — same shape, no
    active filter; for delete and update_unclaimed policies.

The helpers MUST be `SECURITY DEFINER` + `STABLE` + `SET search_path = 'public'`.
The combination is what enables RLS bypass on the inner queries.

Canonical example:
[`20260509140000_fix_rls_recursion_on_professional_profiles_employments.sql`](../supabase/migrations/20260509140000_fix_rls_recursion_on_professional_profiles_employments.sql).

When designing new RLS policies that need to reference another table
with its own policies, default to a SECURITY DEFINER helper from the
start rather than an inline subquery. Avoids the recursion class of
bug entirely.

## REVOKE FROM anon for admin-only RPCs

Supabase's project default privileges automatically grant EXECUTE to
`anon`, `authenticated`, and `service_role` on every new function in the
public schema. Without explicit REVOKE, an admin-only RPC would be
callable by anon users (it would still return its forbidden error,
but exposing the function shape to anon is unnecessary).

For functions that should NOT be reachable by anon, the migration
must explicitly REVOKE:

```sql
REVOKE EXECUTE ON FUNCTION public.<function>(<args>) FROM anon;
```

The `REVOKE FROM PUBLIC` line is also useful as a defense-in-depth
statement of intent ("this function is not for the public role"),
even though Supabase's default-privileges don't actually grant via
PUBLIC.

Order in the migration: `CREATE OR REPLACE FUNCTION` first, then
`REVOKE FROM PUBLIC`, then `REVOKE FROM anon`, then `GRANT` to the
specific roles that should have it (typically `authenticated` +
`service_role`).

Verify with:

```sql
SELECT
  p.proname,
  has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = '<function>';
```

Expected: `anon_can_execute = false`, `auth_can_execute = true`.

Examples of admin-only functions following this pattern:
- `create_professional_at_centro` (gap 66)

Functions that should remain anon-callable (do NOT REVOKE):
- `get_public_centro_info` (anon bootstrap)
- `get_bot_context` (Edge Function uses anon key by default)
- `create_booking_atomic` (Edge Function bearer-gates the caller; not
  strictly anon-required but historically un-revoked)

Note on `create_booking_atomic` specifically: the create-booking Edge
Function authenticates the caller via a bearer token check (the
`sb_secret_` service_role key from Make.com's HTTP module) before
invoking the RPC. The RPC itself doesn't strictly need anon EXECUTE
since the Edge Function gates everything. The current state is "left
un-revoked because the Edge Function gate is sufficient and removing
anon access offers minimal additional security." A future security
pass may revoke it; the convention here is purely descriptive of the
current project state, not prescriptive.

## Cross-references

- [`08_known_gaps.md`](.claude-context/08_known_gaps.md): gap 55 (default ACLs not migration-captured, resolved 2026-05-08), gap 56 (RPC migrations lacking GRANT EXECUTE, resolved 2026-05-08).
- [`09_session_log.md`](.claude-context/09_session_log.md): 2026-05-08 entry covering Phase 1-5 of gaps 55/56 work.
- [`10_auth_model.md`](.claude-context/10_auth_model.md) section 9.1: migration-file inventory.
- Establishing commits: `fc8ba47` (Phase 2 amends), `c662fa1` (Phase 3 deadline alignment).
- [Supabase changelog: Tables not exposed to Data and GraphQL API automatically](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).
- [PostgreSQL: ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html).
- Gap 66 RLS hotfix migration: [`20260509140000_fix_rls_recursion_on_professional_profiles_employments.sql`](../supabase/migrations/20260509140000_fix_rls_recursion_on_professional_profiles_employments.sql) (commit `1f688af`).
- Gap 66 RPC migration: [`20260509150000_create_professional_at_centro.sql`](../supabase/migrations/20260509150000_create_professional_at_centro.sql) (commit `243a351`).
