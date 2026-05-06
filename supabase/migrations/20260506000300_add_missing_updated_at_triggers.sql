-- =============================================================================
-- 20260506000300_add_missing_updated_at_triggers.sql
-- =============================================================================
-- Adds the two BEFORE UPDATE triggers that should have been on
-- clinical_notes and patient_assignments since their respective table
-- creation. Both tables have updated_at columns with DEFAULT now() but
-- no trigger to bump updated_at on UPDATE — caught during item 40
-- baseline RLS discovery (2026-05-06) and tracked as gap item 53.
--
-- Unlike companion migrations 20260506000000 / 100 / 200 which were
-- faithful production snapshots, THIS migration represents an
-- intentional behavior change: post-application, updates to
-- clinical_notes or patient_assignments rows will refresh updated_at
-- to now(). Other tables with updated_at columns (agents_config,
-- clients, patients, session_types) already have this trigger; the two
-- listed here were missed at table creation time.
--
-- Idempotent via DROP TRIGGER IF EXISTS / CREATE TRIGGER. Reuses the
-- public.set_updated_at() function defined in 20260506000000.
--
-- Resolves gap 53.
-- =============================================================================


-- Bump updated_at on clinical_notes UPDATE.
DROP TRIGGER IF EXISTS set_clinical_notes_updated_at ON public.clinical_notes;
CREATE TRIGGER set_clinical_notes_updated_at
  BEFORE UPDATE ON public.clinical_notes
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();


-- Bump updated_at on patient_assignments UPDATE.
DROP TRIGGER IF EXISTS set_patient_assignments_updated_at ON public.patient_assignments;
CREATE TRIGGER set_patient_assignments_updated_at
  BEFORE UPDATE ON public.patient_assignments
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
