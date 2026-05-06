-- =============================================================================
-- 20260506000200_baseline_grants.sql
-- =============================================================================
-- Baseline capture of table-level grants and function-level EXECUTE grants
-- in the public schema, from production state as of 2026-05-06. GRANT
-- statements are naturally idempotent (additive; re-running produces no
-- duplicates), so no REVOKE prefixes are used.
--
-- This migration represents a faithful snapshot of what is currently live
-- in the Supabase database — no behavior changes.
--
-- Section A covers all 20 grantable objects in the public schema: 18 base
-- tables + 2 views (admin_clients_summary, v_client_health). All receive
-- the same 7-privilege × 3-role grant set. Confirmed uniform via the
-- safety check during item 40 discovery: zero exceptions.
--
-- Section B covers 8 functions:
--   - 4 RLS helpers (my_client_id, my_professional_id, is_admin_of_client,
--     is_super_admin)
--   - set_updated_at trigger function
--   - handle_new_user signup trigger
--   - 2 RPC functions (create_booking_atomic, get_bot_context)
-- The 2 RPC functions are captured here because their grants were
-- authored via the Dashboard separately from their creating migrations
-- (20260502100000 and 20260501230000 + four updates) — same undocumented-
-- grants pattern that motivated item 40 in the first place.
--
-- Companion migration 20260506000000 captures helper functions and the
-- handle_new_user trigger; companion 20260506000100 captures RLS policies.
--
-- Note: the wide table grants are deliberate Supabase practice — RLS is
-- the actual gate; grants are uniformly permissive and policies narrow.
-- See 08_known_gaps.md item 40.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Section A: Table and view grants
-- -----------------------------------------------------------------------------
-- 18 base tables + 2 views (alphabetical). Identical 7-priv × 3-role grant
-- set across all 20 objects per Query 5 safety check.

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON
  public.admin_clients_summary,
  public.agents_config,
  public.appointments,
  public.clients,
  public.clinical_notes,
  public.conversions,
  public.email_logs,
  public.invoices,
  public.leads,
  public.patient_assignments,
  public.patients,
  public.professional_documents,
  public.professional_schedules,
  public.professional_session_types,
  public.professionals,
  public.session_types,
  public.super_admins,
  public.usage_log,
  public.users,
  public.v_client_health
TO anon, authenticated, service_role;


-- -----------------------------------------------------------------------------
-- Section B: Function EXECUTE grants
-- -----------------------------------------------------------------------------
-- 8 functions: 4 RLS helpers + set_updated_at + handle_new_user (defined
-- in baseline migration 20260506000000) plus create_booking_atomic and
-- get_bot_context (defined in 20260502100000 and 20260501230000 + four
-- updates). Argument types use the canonical form returned by
-- pg_get_functiondef ("timestamp with time zone", not "timestamptz").

GRANT EXECUTE ON FUNCTION
  public.create_booking_atomic(uuid, uuid, timestamp with time zone, uuid, integer, text, text, jsonb),
  public.get_bot_context(uuid, text),
  public.handle_new_user(),
  public.is_admin_of_client(uuid),
  public.is_super_admin(),
  public.my_client_id(),
  public.my_professional_id(),
  public.set_updated_at()
TO anon, authenticated, service_role;
