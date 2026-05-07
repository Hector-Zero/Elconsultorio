-- ============================================================================
-- 20260507130000_drop_legacy_anon_policies.sql
--
-- Closes the irreversible cut-over of items 50/51 RLS hardening session.
-- Drops the two over-permissive anon policies that gap 50 and gap 51 were
-- filed against. After this migration runs:
--
--   - Anon callers can no longer SELECT * from clients via clients_public_lookup
--     (USING true → dropped). They access centro display data only via the
--     SECURITY DEFINER function get_public_centro_info(p_slug) which returns
--     a narrow whitelist (id, slug, name, theme_id, modo_empresa,
--     empresa_nombre, brand_name, avatar_url, modules).
--
--   - Authenticated non-admins (e.g., pros) can no longer SELECT clients.config
--     either, because the only remaining SELECT policy on clients for non-
--     super-admins is clients_admin_read_own which is admin-scoped. Pros
--     who try to read clients via .from('clients').select(...) get zero rows
--     (PGRST116 from PostgREST when using .single()/.maybeSingle()).
--
--   - Anon callers can no longer SELECT * from professionals via
--     professionals_public_read_active (USING active=true → dropped).
--     The eventual public profile page (gap 51) will use a future
--     SECURITY DEFINER function get_public_professionals(p_slug). Tracked
--     as a deferred follow-up gap.
--
--   - Authenticated users (admin or pro) continue to read professionals
--     scoped to their own client_id via professionals_authenticated_read_active
--     (added in 20260507120000).
--
-- This migration is reversible only by recreating the old policies, which
-- would re-introduce the leaks. The intended state is "old policies gone."
-- ============================================================================

DROP POLICY clients_public_lookup ON public.clients;

DROP POLICY professionals_public_read_active ON public.professionals;

-- End migration.
