# Database Functions (RPCs)

> Auto-generated. Run `./scripts/update-context.sh functions` to refresh.
> Last updated: 2026-05-04 16:12:37 -04
> Manual update 2026-05-07: get_public_centro_info added by hand
> (script auth blocked per gap 36; next successful regen will
> overwrite formatting but preserve the function set).
> Manual update 2026-05-09: post-gap-66 changes summarized in
> per-function notes. The SQL bodies for `create_booking_atomic` and
> `get_bot_context` are now elided in this doc — only the post-cutover
> signatures + pointer comments remain. Canonical bodies live in
> `supabase/migrations/20260509130000_rewrite_rpc_functions_for_split.sql`.
> `my_professional_id` is dropped and replaced by `my_profile_id` +
> `my_employment_id` (see new entries below). New RPC
> `create_professional_at_centro` documented at the bottom.

## create_booking_atomic

> **Post-gap-66 note (2026-05-09):** parameter `p_professional_id` is
> renamed to `p_employment_id`. Function now INSERTs into
> `appointments` + `patient_assignments` + `patients` with
> `employment_id`. New-patient creation also writes
> `patients.employment_id` (the column was vestigial pre-cutover and
> not populated; post-cutover it's operationally meaningful for
> pro-mode RLS visibility filtering). Pro name lookup refactored to
> a single SELECT at function top (joins `professional_employments`
> → `professional_profiles`), reused in both response paths.
> Canonical body in
> `supabase/migrations/20260509130000_rewrite_rpc_functions_for_split.sql`.

```sql
CREATE OR REPLACE FUNCTION public.create_booking_atomic(p_client_id uuid, p_employment_id uuid, p_datetime timestamp with time zone, p_session_type_id uuid, p_duration integer, p_type text, p_chat_id text, p_patient_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_catalog
AS $function$
  -- Full body lives in supabase/migrations/20260509130000_rewrite_rpc_functions_for_split.sql
  -- (canonical post-gap-66 implementation). The DROP + CREATE pattern
  -- in that migration handles the parameter signature change
  -- (p_professional_id → p_employment_id). Pre-cutover history is in
  -- 20260502100000_create_booking_atomic.sql. SECURITY DEFINER, SET
  -- search_path, and GRANT EXECUTE clauses preserved; body fully
  -- rewritten for the split schema.
$function$;
```

## get_bot_context

> **Post-gap-66 note (2026-05-09):** function now reads through
> `professional_employments` joined to `professional_profiles` in
> three places (profesionales_text CTE, slots_disponibles CTE, and
> the main jsonb_agg). Identity fields (full_name, bio, specialties,
> etc.) come from the joined profile; operational fields (email,
> color, active, public_profile) come from the employment. Filters
> apply to the employment row. Sort order changed from
> `professionals.created_at` to `professional_profiles.created_at`.
> Output JSON shape unchanged — same keys, same nesting, Make.com
> and bot prompt consumers see identical structure. Canonical body
> in `supabase/migrations/20260509130000_rewrite_rpc_functions_for_split.sql`.

```sql
CREATE OR REPLACE FUNCTION public.get_bot_context(p_client_id uuid, p_chat_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_catalog
AS $function$
  -- Full body lives in supabase/migrations/20260509130000_rewrite_rpc_functions_for_split.sql
  -- (canonical post-gap-66 implementation). Pre-cutover history is in
  -- 20260501230000_update_get_bot_context.sql + the format-related
  -- amendments. The function's signature, return type, GRANT EXECUTE,
  -- and SECURITY DEFINER + SET search_path clauses are all preserved
  -- across the cutover; only the body changed (joins through
  -- professional_employments + professional_profiles instead of
  -- public.professionals).
$function$;
```

## get_public_centro_info

```sql
CREATE OR REPLACE FUNCTION public.get_public_centro_info(p_slug text)
 RETURNS TABLE(id uuid, slug text, name text, theme_id text, modo_empresa text, empresa_nombre text, brand_name text, avatar_url text, modules jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT
    c.id,
    c.slug,
    c.name,
    c.config ->> 'theme_id'                  AS theme_id,
    c.config ->> 'modo_empresa'              AS modo_empresa,
    c.config -> 'empresa' ->> 'nombre'       AS empresa_nombre,
    c.config ->> 'brand_name'                AS brand_name,
    c.config ->> 'avatar_url'                AS avatar_url,
    c.config -> 'modules'                    AS modules
  FROM public.clients c
  WHERE c.slug = p_slug
    AND c.active = true
  LIMIT 1
$function$
```

Resolves a centro slug to its safe-public display subset for the SPA
bootstrap path (anon callers and pro-mode authenticated users that the
admin-only `clients_admin_read_own` policy doesn't cover). SECURITY
DEFINER bypasses RLS to expose the whitelisted columns regardless of
caller role; EXECUTE granted to `anon` and `authenticated`.

Defined in
[20260507120000_clients_professionals_auth_hardening_additive.sql](../supabase/migrations/20260507120000_clients_professionals_auth_hardening_additive.sql)
with the corrected return shape applied via
[20260507120100_correct_clients_professionals_hardening.sql](../supabase/migrations/20260507120100_correct_clients_professionals_hardening.sql)
(initial whitelist was narrower; brand_name, avatar_url, and modules
added in the correction so pro-mode sidebars render correctly).

Whitelist deliberately excludes `config.features` (gap 46 superadmin
toggles), `config.empresa.{rut, email, telefono, direccion, logo_url}`,
`config.profile_*`, `config.whatsapp_*`, `config.resend_from`, and
other operational keys. The full clients row is reachable only via
`clients_admin_read_own` for admins or `clients_super_admin_all` for
super-admins. See `.claude-context/10_auth_model.md` section 3.7 and
section 5.1 for the SPA-side data flow.

## handle_new_user

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  -- only insert if client_id is provided in metadata
  if (new.raw_user_meta_data->>'client_id') is not null then
    insert into public.users (id, client_id, email, role)
    values (
      new.id,
      (new.raw_user_meta_data->>'client_id')::uuid,
      new.email,
      coalesce(new.raw_user_meta_data->>'role', 'owner')
    );
  end if;
  return new;
end;
$function$

```

## is_admin_of_client

```sql
CREATE OR REPLACE FUNCTION public.is_admin_of_client(p_client_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists(
    select 1 from public.users 
    where id = auth.uid() 
      and client_id = p_client_id 
      and role = 'admin'
      and active = true
  )
$function$

```

## is_super_admin

```sql
CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists(
    select 1 from public.super_admins where user_id = auth.uid()
  )
$function$

```

## my_client_id

```sql
CREATE OR REPLACE FUNCTION public.my_client_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select client_id from public.users where id = auth.uid()
$function$

```

## my_employment_id

> Post-gap-66 (2026-05-09). Replaces the dropped `my_professional_id()`.
> Returns the active employment id for the auth user at their current
> centro, or NULL if none. Joins through `professional_profiles` via
> UNIQUE `user_id` and narrows by `my_client_id()`. Defined in the
> gap 66 schema cutover migration
> `supabase/migrations/20260509120000_split_professionals_to_profiles_and_employments.sql`.

```sql
CREATE OR REPLACE FUNCTION public.my_employment_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT e.id FROM public.professional_employments e
  JOIN public.professional_profiles p ON p.id = e.profile_id
   WHERE p.user_id = auth.uid()
     AND e.client_id = my_client_id()
     AND e.active = true
   LIMIT 1
$function$
```

## my_profile_id

> Post-gap-66 (2026-05-09). Returns the auth user's profile id, or
> NULL if no profile exists. SECURITY DEFINER bypasses RLS on
> `professional_profiles`, breaking the cycle that would otherwise
> occur when cross-table policies reference each other. Used by
> `employments_self_read`. Defined in the gap 66 RLS hotfix migration
> `supabase/migrations/20260509140000_fix_rls_recursion_on_professional_profiles_employments.sql`.

```sql
CREATE OR REPLACE FUNCTION public.my_profile_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id FROM public.professional_profiles
   WHERE user_id = auth.uid() LIMIT 1
$function$
```

## is_admin_for_active_employment

> Post-gap-66 (2026-05-09). Returns true if the auth user is admin of
> any centro where this profile has an active employment. Used by
> `profiles_admin_read`. Defined in the RLS hotfix migration.

```sql
CREATE OR REPLACE FUNCTION public.is_admin_for_active_employment(p_profile_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.professional_employments
     WHERE profile_id = p_profile_id
       AND active = true
       AND is_admin_of_client(client_id))
$function$
```

## is_admin_for_any_employment

> Post-gap-66 (2026-05-09). Same shape as `is_admin_for_active_employment`,
> no `active` filter. Used by `profiles_admin_delete` and
> `profiles_admin_update_unclaimed`. Defined in the RLS hotfix migration.

```sql
CREATE OR REPLACE FUNCTION public.is_admin_for_any_employment(p_profile_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.professional_employments
     WHERE profile_id = p_profile_id
       AND is_admin_of_client(client_id))
$function$
```

## is_admin_with_clinical_authority

> Post-gap-66 (2026-05-09). Gap 67 helper. Returns true if the auth
> user is both admin of the centro AND has a profile (i.e., is also a
> pro themselves, eligible for clinical-authority overrides). Created
> in the gap 66 schema cutover but full wire-up to clinical_notes
> policies pending — depends on gap 46's centro feature toggle.

```sql
CREATE OR REPLACE FUNCTION public.is_admin_with_clinical_authority(p_client_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT is_admin_of_client(p_client_id)
     AND EXISTS (
       SELECT 1 FROM public.professional_profiles
        WHERE user_id = auth.uid())
$function$
```

## create_professional_at_centro

> Post-gap-66 (2026-05-09). Atomic two-table INSERT for new pro
> creation. Wraps `professional_profiles` + `professional_employments`
> INSERTs in a single transaction. Used by 3 SPA create-pro paths:
> `professionalEditor.jsx` (admin "Nuevo profesional"),
> `empresaWizard.jsx` (first-pro creation), and `profile.jsx`
> (Single-mode auto-mirror). Auth: caller must be admin of the
> target centro or super_admin (manually enforced; SECURITY DEFINER
> bypasses RLS). Locked to `authenticated` + `service_role` with
> explicit `REVOKE FROM anon`. Returns
> `{success: true, profile_id, employment_id}` on success or
> `{success: false, error, message}` on validation/authorization
> failure. Defined in
> `supabase/migrations/20260509150000_create_professional_at_centro.sql`.

```sql
CREATE OR REPLACE FUNCTION public.create_professional_at_centro(
  p_client_id uuid, p_full_name text, p_email text, p_color text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_catalog
AS $function$
  -- (full body in the migration file)
$function$
```

## set_updated_at

```sql
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$

```
