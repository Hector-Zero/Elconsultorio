-- ============================================================================
-- 20260508120000_align_with_future_default_acl.sql
--
-- Pre-applies Supabase's October 30, 2026 default-ACL revoke ourselves so the
-- project state matches what the platform will produce on that date. After
-- this migration runs:
--
--   1. New tables created in `public` (without explicit GRANT statements)
--      will be inaccessible via the Data API for anon, authenticated, and
--      service_role. This is the intended behavior — gap 56's convention
--      requires explicit GRANT statements on all new objects.
--
--   2. New sequences created in `public` (without explicit GRANT statements)
--      will not be readable/usable via the Data API for the same three roles.
--
--   3. Functions are NOT addressed here. Per Supabase's announcement
--      (https://supabase.com/changelog/45329), the October 30 platform
--      migration does not revoke function EXECUTE defaults. Additionally,
--      PostgreSQL's built-in PUBLIC EXECUTE default on new functions
--      remains in effect regardless of role-specific default privileges.
--      Function-grant discipline is enforced by the Phase 4 migration
--      conventions doc, not by this ACL change.
--
--   4. supabase_admin's parallel default privileges are NOT touched. They
--      are platform infrastructure; the project's migrations run as
--      `postgres`, not `supabase_admin`, so the postgres-owned defaults
--      cover all migration-created objects.
--
-- Closes gap 55 by aligning the project's ACL state with the future
-- platform default rather than capturing the deprecated current default.
-- A fresh environment provisioned today, on May 30, or after October 30
-- will all produce identical state from this migration's application.
--
-- Idempotency: ALTER DEFAULT PRIVILEGES REVOKE is a silent no-op when no
-- matching GRANT exists (per Postgres docs). Running this migration on
-- a project where Supabase has already applied their October 30 revoke
-- is safe — no error, no state change.
--
-- Verification: after this migration applies, re-querying
-- `pg_default_acl` for owner=postgres in schema=public will show:
--   - tables: privileges reduced from `arwdDxtm` to `Dxtm` (TRUNCATE,
--     REFERENCES, TRIGGER, MAINTAIN remain — these are DDL-adjacent
--     and don't affect Data API exposure).
--   - sequences: privileges reduced from `rwU` to `w` (UPDATE remains;
--     SELECT and USAGE — the actually-load-bearing privileges for
--     sequence access — are revoked).
--   - functions: unchanged (`X` for all three roles, plus EXECUTE TO
--     PUBLIC from Postgres built-in defaults).
--
-- Resolves: gap 55 (default ACL not migration-captured).
-- Coordinated with: gap 56 (Phase 2 amends, commit fc8ba47), which
-- ensured all existing RPC functions have explicit grants before
-- this migration's revocation could leave them dependent on defaults.
-- ============================================================================

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES
  FROM anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES
  FROM anon, authenticated, service_role;

-- End migration.
