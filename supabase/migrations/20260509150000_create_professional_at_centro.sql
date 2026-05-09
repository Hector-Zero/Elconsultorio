-- ============================================================================
-- 20260509150000_create_professional_at_centro.sql
--
-- Atomic two-table INSERT for creating a new professional at a centro.
-- Wraps the professional_profiles + professional_employments INSERTs that
-- otherwise have to happen sequentially from the SPA, with manual rollback
-- handling on partial failure. SECURITY DEFINER ensures the two writes
-- happen in a single transaction.
--
-- Used by:
--   - src/screens/professionals/professionalEditor.jsx (admin "Nuevo
--     profesional" flow)
--   - src/screens/settings/empresaWizard.jsx (first-pro creation during
--     empresa-mode activation)
--   - src/screens/settings/profile.jsx (Single-mode auto-mirror to
--     professionals when admin saves their first profile)
--
-- Authorization: caller must be admin of the target centro, or super_admin.
-- The function manually enforces this since SECURITY DEFINER bypasses RLS.
--
-- Sequence: Phase 2b of gap 66 work, post-2a SPA agenda migration.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_professional_at_centro(
  p_client_id  uuid,
  p_full_name  text,
  p_email      text,
  p_color      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_profile_id    uuid;
  v_employment_id uuid;
BEGIN
  -- Validation
  IF p_client_id IS NULL OR p_full_name IS NULL OR btrim(p_full_name) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'validation',
      'message', 'client_id and full_name are required'
    );
  END IF;

  -- Authorization: caller must be admin of this centro or super_admin.
  -- SECURITY DEFINER bypasses RLS but we manually enforce admin scope.
  IF NOT is_admin_of_client(p_client_id) AND NOT is_super_admin() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'forbidden',
      'message', 'caller is not admin of this centro'
    );
  END IF;

  -- Both INSERTs run in a single implicit transaction (plpgsql functions
  -- are transactional by default). If the second INSERT fails, the first
  -- rolls back automatically — no orphan profiles.
  --
  -- Insert profile (pro-owned identity). user_id stays NULL until the
  -- pro signs up and claims the account.
  INSERT INTO public.professional_profiles (full_name)
  VALUES (btrim(p_full_name))
  RETURNING id INTO v_profile_id;

  -- Insert employment (centro-owned operational state). Active and
  -- public_profile default to true via the table definition.
  INSERT INTO public.professional_employments (profile_id, client_id, email, color)
  VALUES (
    v_profile_id,
    p_client_id,
    NULLIF(btrim(p_email), ''),
    COALESCE(NULLIF(btrim(p_color), ''), '#2f4a3a')
  )
  RETURNING id INTO v_employment_id;

  RETURN jsonb_build_object(
    'success',       true,
    'profile_id',    v_profile_id,
    'employment_id', v_employment_id
  );
END;
$$;

-- Supabase's default privileges automatically grant anon, authenticated,
-- and service_role EXECUTE on every new function in the public schema.
-- For functions that should be admin-only (like this one), explicitly
-- REVOKE from anon. The PUBLIC role doesn't actually receive a grant
-- under Supabase's defaults (the grants go directly to the three roles),
-- but REVOKE from PUBLIC is harmless belt-and-braces. Match principle of
-- least privilege.

REVOKE EXECUTE ON FUNCTION public.create_professional_at_centro(uuid, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_professional_at_centro(uuid, text, text, text) FROM anon;

GRANT EXECUTE ON FUNCTION public.create_professional_at_centro(uuid, text, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.create_professional_at_centro(uuid, text, text, text) IS
  'Atomic two-table INSERT for creating a new professional at a centro. '
  'Inserts a professional_profiles row (pro-owned identity, user_id starts '
  'NULL) and a professional_employments row (centro-owned relationship) in '
  'a single transaction. Caller must be admin of the centro or super_admin. '
  'Returns {success, profile_id, employment_id} on success or '
  '{success: false, error, message} on validation/authorization failure.';
