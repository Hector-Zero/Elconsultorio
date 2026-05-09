-- ============================================================================
-- 20260509140000_fix_rls_recursion_on_professional_profiles_employments.sql
--
-- RLS infinite recursion bug surfaced in dev test of commit 2a (gap 66
-- SPA migration). Postgres error 42P17 on professional_profiles relation.
--
-- Root cause: cross-table policies on professional_profiles and
-- professional_employments contain inline subqueries that reference each
-- other. Because PostgreSQL evaluates all permissive policies as OR'd,
-- triggering ANY policy on either table triggers the cross-referencing
-- ones, creating a query loop that Postgres detects and aborts.
--
-- The recursion path:
--   query professional_profiles -> profiles_admin_read fires ->
--   subquery into professional_employments -> employments_self_read
--   fires -> subquery into professional_profiles -> profiles_admin_read
--   fires again -> infinite recursion
--
-- Fix: replace the inline subqueries with SECURITY DEFINER helper
-- functions. SECURITY DEFINER functions run as the function owner, which
-- in Supabase has BYPASSRLS; their internal queries don't trigger RLS
-- on the queried tables. This breaks the cycle.
--
-- Three new helpers:
--   - my_profile_id() - returns the auth user's profile id
--   - is_admin_for_active_employment(p_profile_id) - admin over active
--     employment of this profile
--   - is_admin_for_any_employment(p_profile_id) - admin over any
--     employment (active or inactive) of this profile
--
-- Five policies recreated using the helpers:
--   - employments_self_read: subquery -> my_profile_id()
--   - profiles_admin_read: subquery -> is_admin_for_active_employment()
--   - profiles_admin_delete: subquery -> is_admin_for_any_employment()
--   - profiles_admin_update_unclaimed: subquery x 2 -> is_admin_for_any_employment()
--
-- profiles_admin_insert is unchanged: its WITH CHECK queries the users
-- table directly, no cross-reference to professional_*.
--
-- Sequence: hotfix between Phase F (6dbd4a2) and SPA commit 2a.
-- ============================================================================

-- Helpers

CREATE OR REPLACE FUNCTION public.my_profile_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id FROM public.professional_profiles WHERE user_id = auth.uid() LIMIT 1
$function$;

GRANT EXECUTE ON FUNCTION public.my_profile_id() TO authenticated, service_role;

COMMENT ON FUNCTION public.my_profile_id() IS
  'Returns the professional_profiles.id for the auth user, or NULL if no '
  'profile exists. SECURITY DEFINER to bypass RLS on professional_profiles, '
  'breaking the cycle that would otherwise occur when professional_profiles '
  'policies reference professional_employments policies that reference '
  'professional_profiles. Used by employments_self_read.';


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
      AND is_admin_of_client(client_id)
  )
$function$;

GRANT EXECUTE ON FUNCTION public.is_admin_for_active_employment(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.is_admin_for_active_employment(uuid) IS
  'Returns true if the auth user is admin of any centro where this profile '
  'has an active employment. SECURITY DEFINER to bypass RLS on '
  'professional_employments. Used by profiles_admin_read.';


CREATE OR REPLACE FUNCTION public.is_admin_for_any_employment(p_profile_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.professional_employments
    WHERE profile_id = p_profile_id
      AND is_admin_of_client(client_id)
  )
$function$;

GRANT EXECUTE ON FUNCTION public.is_admin_for_any_employment(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.is_admin_for_any_employment(uuid) IS
  'Returns true if the auth user is admin of any centro where this profile '
  'has any employment (active or inactive). SECURITY DEFINER. Used by '
  'profiles_admin_delete and profiles_admin_update_unclaimed.';


-- Policy recreations

-- employments_self_read

DROP POLICY IF EXISTS employments_self_read ON public.professional_employments;

CREATE POLICY employments_self_read ON public.professional_employments
  FOR SELECT TO authenticated
  USING (profile_id = my_profile_id());


-- profiles_admin_read

DROP POLICY IF EXISTS profiles_admin_read ON public.professional_profiles;

CREATE POLICY profiles_admin_read ON public.professional_profiles
  FOR SELECT TO authenticated
  USING (is_admin_for_active_employment(id));


-- profiles_admin_delete

DROP POLICY IF EXISTS profiles_admin_delete ON public.professional_profiles;

CREATE POLICY profiles_admin_delete ON public.professional_profiles
  FOR DELETE TO authenticated
  USING (is_admin_for_any_employment(id));


-- profiles_admin_update_unclaimed

DROP POLICY IF EXISTS profiles_admin_update_unclaimed ON public.professional_profiles;

CREATE POLICY profiles_admin_update_unclaimed ON public.professional_profiles
  FOR UPDATE TO authenticated
  USING (user_id IS NULL AND is_admin_for_any_employment(id))
  WITH CHECK (user_id IS NULL AND is_admin_for_any_employment(id));
