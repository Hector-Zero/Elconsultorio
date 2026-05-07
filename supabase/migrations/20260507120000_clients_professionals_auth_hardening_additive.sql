-- ============================================================================
-- 20260507120000_clients_professionals_auth_hardening_additive.sql
--
-- Phase 1 of items 50 + 51 hardening (RLS exposure of clients.config and
-- professionals.* to anon callers). Adds the new infrastructure in parallel
-- to the existing over-permissive policies, which remain in place until the
-- SPA is migrated to consume the new paths. Old policies will be dropped in
-- a follow-up migration after SPA migration is verified end-to-end.
--
-- This migration is purely additive: no DROPs, no behavior changes for
-- existing callers. Safe to roll back via simple object drops.
--
-- NOTE (2026-05-07): this file represents the first attempt at the migration.
-- Two corrections were applied immediately afterward via
-- 20260507120100_correct_clients_professionals_hardening.sql:
-- (a) function whitelist widened to include brand_name, avatar_url, modules;
-- (b) clients_authenticated_read_own replaced with admin-only
--     clients_admin_read_own. Both corrections were applied via the Supabase
--     Dashboard before the SPA migration; the production database reflects
--     the corrected state. Read both files together for the full picture.
--
-- Companion items: gaps 50, 51, 46 (clients.config.features whitelist).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. SECURITY DEFINER function: get_public_centro_info(p_slug text)
-- ----------------------------------------------------------------------------
-- Returns the safe-public subset of clients fields for anon callers
-- (SPA bootstrap before login, eventual public profile page).
--
-- Whitelist derived from grep of src/ for pre-login config reads:
--   - id, slug, name (clients table direct columns)
--   - theme_id, modo_empresa, empresa.nombre (clients.config jsonb keys)
--
-- Sensitive keys explicitly NOT exposed:
--   - clients.plan, clients.admin_can_write_clinical_notes (table cols)
--   - config.empresa.{rut, email, telefono, direccion, logo_url}
--   - config.modules (operational, hints at plan tier)
--   - config.features (gap 46 — superadmin-controlled toggles, sensitive)
--   - config.profile_*, config.whatsapp_*, config.resend_from, etc.
--
-- Filter: clients.active = true (inactive centros invisible).
--
-- Returns flat columns (not jsonb) so the function signature is stable
-- and easily extended. Caller reshapes if needed.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_public_centro_info(p_slug text)
RETURNS TABLE (
  id              uuid,
  slug            text,
  name            text,
  theme_id        text,
  modo_empresa    text,
  empresa_nombre  text
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
    c.config -> 'empresa' ->> 'nombre'       AS empresa_nombre
  FROM public.clients c
  WHERE c.slug = p_slug
    AND c.active = true
  LIMIT 1
$function$;

COMMENT ON FUNCTION public.get_public_centro_info(text) IS
  'Returns safe-public subset of clients row for anon SPA bootstrap. '
  'Whitelist documented in migration 20260507120000. Coordinates with gaps 50, 46.';

GRANT EXECUTE ON FUNCTION public.get_public_centro_info(text) TO anon, authenticated;


-- ----------------------------------------------------------------------------
-- 2. New RLS policy: clients_authenticated_read_own
-- ----------------------------------------------------------------------------
-- Authenticated users can SELECT their own client row (the centro they
-- belong to per public.users.client_id). Returns the full row including
-- sensitive config keys — appropriate because the caller is authenticated
-- and scoped to their own tenancy.
--
-- This policy is what supports useClientConfig() post-login refetch in the
-- new SPA architecture. Currently runs alongside clients_public_lookup
-- (which still grants anon+auth read of all rows); after SPA migration
-- is complete, clients_public_lookup will be dropped, leaving this as the
-- only read path for authenticated callers (plus clients_super_admin_all
-- which already exists).
--
-- Pattern: section 4 pattern 1 (admin-scoped via my_client_id), but
-- generalized to any authenticated user of the centro, not just admins.
-- Justification: every authenticated user of a centro legitimately needs
-- to read their own centro's config (Sidebar, settings, agenda all
-- consume it). Restricting further to admins would break pro-mode UX.
-- ----------------------------------------------------------------------------

CREATE POLICY clients_authenticated_read_own
ON public.clients
FOR SELECT
TO authenticated
USING (id = my_client_id());


-- ----------------------------------------------------------------------------
-- 3. New RLS policy: professionals_authenticated_read_active
-- ----------------------------------------------------------------------------
-- Authenticated users can SELECT active professional rows scoped to their
-- own client_id. Replaces the old professionals_public_read_active policy
-- which exposed active professionals to anon+auth without client scoping.
--
-- Behavioral changes from the old policy:
--   1. Drops anon. Public profile page (gap 51) is deferred to a future
--      session when the page is actually built. New SECURITY DEFINER
--      function get_public_professionals(p_slug text) will be added then.
--   2. Adds client_id scoping. The old policy let any authenticated user
--      read every active professional across all centros. The new policy
--      restricts to the caller's own centro. Defensible improvement: cross-
--      tenant professional enumeration was unintentional, not used.
--
-- Like the clients case, this runs alongside the old policy until commit 6
-- drops it. During the parallel period, the OR logic of multiple permissive
-- SELECT policies means authenticated callers see rows that match either
-- policy — i.e., all active professionals (old policy still active). After
-- the drop, only same-centro active professionals remain visible to
-- authenticated non-admins.
--
-- Existing professionals_admin_all and professionals_super_admin_read are
-- unchanged and continue to grant broader access to admins and super-admins
-- respectively.
-- ----------------------------------------------------------------------------

CREATE POLICY professionals_authenticated_read_active
ON public.professionals
FOR SELECT
TO authenticated
USING (active = true AND client_id = my_client_id());


-- ============================================================================
-- End migration.
-- ============================================================================
