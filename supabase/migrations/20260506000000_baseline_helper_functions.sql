-- =============================================================================
-- 20260506000000_baseline_helper_functions.sql
-- =============================================================================
-- Baseline capture of RLS helper functions and updated_at trigger function
-- from production state as of 2026-05-06. Idempotent via CREATE OR REPLACE
-- FUNCTION. This migration represents a faithful snapshot of what is
-- currently live in the Supabase database — no behavior changes.
--
-- Companion migrations capture RLS policies (commit C) and table grants
-- (commit D).
--
-- Tracked in 08_known_gaps.md item 40.
-- Known caveats captured AS-IS, deferred:
--   - my_client_id and handle_new_user lack explicit SET search_path
--     (item 54)
-- =============================================================================


-- Returns the auth user's centro from the public.users mapping.
-- Used by RLS policies that scope rows to a single client.
CREATE OR REPLACE FUNCTION public.my_client_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select client_id from public.users where id = auth.uid()
$function$;


-- Returns the active professional row id linked to the auth user, or NULL.
-- Used by RLS policies that scope rows to a treating professional.
CREATE OR REPLACE FUNCTION public.my_professional_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id from public.professionals
  where user_id = auth.uid() and active = true
  limit 1
$function$;


-- Returns true if the auth user is an active admin of the given client.
-- Used by admin-scope RLS policies on most public tables.
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
$function$;


-- Returns true if the auth user is a global super admin (per super_admins
-- table). Used by cross-tenant RLS policies on operational tables.
CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists(
    select 1 from public.super_admins where user_id = auth.uid()
  )
$function$;


-- Trigger function for BEFORE UPDATE: bumps updated_at to now() on each
-- update. Attached to: agents_config, clients, patients, session_types.
-- (clinical_notes and patient_assignments are missing this trigger — see
-- gap item 53; addressed in commit E.)
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;


-- Trigger function for AFTER INSERT on auth.users: provisions the matching
-- public.users row when raw_user_meta_data carries a client_id. This is the
-- onboarding glue between Supabase Auth and the app's tenancy model.
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
$function$;


-- Trigger on auth.users wiring handle_new_user. Drop-and-recreate so the
-- migration is idempotent if run against an environment where the trigger
-- already exists.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();
