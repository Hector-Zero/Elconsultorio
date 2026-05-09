-- ============================================================================
-- 20260509160000_add_clients_pro_read_own_policy.sql
--
-- RLS hotfix for pro-mode bootstrap. Post-gap-66, a logged-in pro can hit
-- the clients table during SPA bootstrap (e.g., useClientConfig fetching
-- the full clients row), but the existing policies on clients are
-- admin-only:
--
--   - clients_admin_read_own  (FOR SELECT, requires is_admin_of_client)
--   - clients_admin_update    (FOR UPDATE, admin)
--   - clients_super_admin_all (FOR ALL, super admin)
--
-- Result: pro-mode user gets zero rows back from
-- `clients?id=eq.<centro>`, and PostgREST's `.single()` then surfaces
-- 406 Not Acceptable. The bootstrap stalls.
--
-- Fix: add `clients_pro_read_own`, granting SELECT to authenticated
-- users who have an active employment at the client. Admin path remains
-- clients_admin_read_own (unchanged).
--
-- Sequence: post-gap-66 follow-up (after commits 7890b00, 6dbd4a2,
-- 1f688af, 600d54b, 243a351, 6e27517, and the wrap-up doc commit).
-- Coordinates with gap 66; not a launch blocker, just a missed RLS
-- surface that pro-mode dev test surfaced.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS clients_pro_read_own ON public.clients;

CREATE POLICY clients_pro_read_own ON public.clients
  FOR SELECT
  TO authenticated
  USING (
    id = my_client_id()
    AND EXISTS (
      SELECT 1
      FROM public.professional_employments e
      JOIN public.professional_profiles p ON p.id = e.profile_id
      WHERE e.client_id = clients.id
        AND p.user_id   = auth.uid()
        AND e.active    = true
    )
  );

COMMENT ON POLICY clients_pro_read_own ON public.clients IS
  'Lets a pro at this centro read their employer''s clients row '
  '(config, etc.) for SPA bootstrap. Admin path remains '
  'clients_admin_read_own.';

COMMIT;
