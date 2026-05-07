-- ============================================================================
-- 20260507120100_correct_clients_professionals_hardening.sql
--
-- Correction to migration 20260507120000_clients_professionals_auth_hardening_additive.sql.
-- Two changes applied to the production database after the original migration ran:
--
-- 1. get_public_centro_info function widened to include three additional
--    display-layer keys (brand_name, avatar_url, modules) that pro-mode
--    users need for the sidebar. With the narrower whitelist, pros could
--    not render their sidebar after the SPA migration to admin-only post-
--    login reads.
--
-- 2. Replaced clients_authenticated_read_own (TO authenticated, USING
--    id = my_client_id()) with clients_admin_read_own (admin-only).
--    Hector's permission model: admins read full clients row including
--    sensitive config keys; pros consume only the bootstrap-function
--    subset. The original "any authenticated user reads full row" policy
--    was broader than intended and would have leaked centro feature
--    toggles (gap 46) to pro-mode users.
--
-- Coordinates with gaps 50, 51, 46.
-- ============================================================================

DROP FUNCTION public.get_public_centro_info(text);

CREATE FUNCTION public.get_public_centro_info(p_slug text)
RETURNS TABLE (
  id              uuid,
  slug            text,
  name            text,
  theme_id        text,
  modo_empresa    text,
  empresa_nombre  text,
  brand_name      text,
  avatar_url      text,
  modules         jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public', 'pg_catalog'
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
$function$;

COMMENT ON FUNCTION public.get_public_centro_info(text) IS
  'Returns safe-public subset of clients row for SPA bootstrap (anon) and pro-mode display (authenticated non-admin). Whitelist documented in migration 20260507120000. Coordinates with gaps 50, 46.';

GRANT EXECUTE ON FUNCTION public.get_public_centro_info(text) TO anon, authenticated;

DROP POLICY clients_authenticated_read_own ON public.clients;

CREATE POLICY clients_admin_read_own
ON public.clients
FOR SELECT
TO authenticated
USING (id = my_client_id() AND is_admin_of_client(id));

-- End migration.
