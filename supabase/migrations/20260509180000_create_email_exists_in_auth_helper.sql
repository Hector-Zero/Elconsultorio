-- ============================================================================
-- 20260509180000_create_email_exists_in_auth_helper.sql
--
-- Creates email_exists_in_auth(p_email) SECURITY DEFINER helper for the
-- invite-professional Edge Function's collision pre-check. Replaces a
-- raw GoTrue admin REST query that turned out to ignore the email filter
-- on this project's GoTrue version (returned all users for any query,
-- causing every invite to false-409).
--
-- The helper queries auth.users directly via SECURITY DEFINER. Locked to
-- service_role only since the Edge Function uses the service-role client
-- for the collision check.
--
-- Sequence: pro claim flow commit 2 of 3 (companion to the Edge Function
-- itself in supabase/functions/invite-professional/).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.email_exists_in_auth(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users WHERE email = lower(p_email)
  );
$$;

REVOKE ALL ON FUNCTION public.email_exists_in_auth(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_exists_in_auth(text) TO service_role;

COMMENT ON FUNCTION public.email_exists_in_auth(text) IS
  'Returns true if email already exists in auth.users. SECURITY DEFINER '
  'because auth.users is privileged. Used by invite-professional Edge '
  'Function for the email collision pre-check (replaces the unreliable '
  'GoTrue admin email filter on this project version).';
