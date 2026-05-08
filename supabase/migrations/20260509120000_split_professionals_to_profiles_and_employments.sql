-- ============================================================================
-- 20260509120000_split_professionals_to_profiles_and_employments.sql
--
-- Gap 66: split public.professionals into two tables along the pro-owned vs
-- centro-owned boundary.
--
--   - professional_profiles (pro-owned, one row per person):
--     identity, presentation, credentials. Writable by the pro themselves;
--     admin can write only while the row is unclaimed (user_id IS NULL).
--
--   - professional_employments (centro-owned, one row per pro per centro):
--     operational state at a specific centro. Writable by the centro's admins.
--     Replaces the implicit one-row-per-pro-per-centro pattern with an
--     explicit junction table that supports multi-centro pros (gap 65 case B).
--
-- Strict isolation: pros see only their own profile. Admin and super-admin
-- see all profiles for pros employed at their centro. No cross-centro reads
-- via direct table queries; the future public profile page will go through
-- a SECURITY DEFINER function (deferred to gap 51's remaining work).
--
-- Also resolves:
--   - Gap 65 (professionals.user_id no UNIQUE) — UNIQUE on
--     professional_profiles.user_id by design.
--   - Refines gap 57 (patients_professional_active_assignment FOR ALL) by
--     making the permission boundary structural rather than policy-only.
--   - Closes the deferred half of gap 51 enabling get_public_professionals
--     in a future session (data model now ready; function still TBD).
--
-- Vestigial columns dropped during the split (not ported to either side):
--   - role (zero readers anywhere; default 'professional' on every row).
--   - avatar_url (no SPA write path; agenda/proSelector.jsx switched to
--     photo_url in the SPA migration commits).
--   - initials (auto-derivable from full_name; SPA helpers compute on read).
--   - availability (denormalized cache of professional_schedules; SPA
--     migration drops the cache and queries the canonical source).
--
-- Path β coordinated cutover: this migration tears down the old structure
-- AND establishes the new structure in one transaction. The SPA after this
-- migration applies will be broken (querying tables/columns that no longer
-- exist) until commits 2a, 2b, 2c land. Make.com bot integration is
-- intentionally deferred to end-of-arc.
--
-- Pre-apply audit (2026-05-09): the first apply attempt against production
-- failed twice — once on missing storage policy drops (storage.objects has
-- six policies referencing public.professionals via folder UUID joins; not
-- visible in original recon), and once on schema mismatches (clinical_notes
-- has assignment_id not patient_id; patient_assignments has status text not
-- active boolean). A subsequent comprehensive audit also surfaced:
--   - professional_session_types had composite PK (professional_id,
--     session_type_id) which the column drop invalidated; recreated
--     as (employment_id, session_type_id) in Phase B.3.
--   - professional_schedules had UNIQUE constraint
--     (professional_id, day_of_week, start_time); recreated as
--     (employment_id, day_of_week, start_time) in Phase B.3.
--   - session_types_professional_read original was wider than my draft
--     (read all session_types at the centro, not just session_types
--     this pro offers); E.8 widened to match.
--   - notes_treating_professional_all has divergent USING vs WITH CHECK
--     clauses (USING any-status, WITH CHECK active-only); E.2 preserves
--     the divergence.
-- All identified issues addressed before second apply attempt.
--
-- Sequence: Commit 1 of 5 in gap 66 work.
-- Next: 2a (SPA agenda + App.jsx), 2b (SPA settings + editor), 2c (SPA
-- admin list + display), wrap-up docs.
-- ============================================================================

BEGIN;

-- ============================================================================
-- PHASE A: Tear down old structure
-- ============================================================================

-- A.0 — Truncate dependent tables that will receive NOT NULL employment_id
--
-- The professional_documents, professional_schedules, and professional_session_types
-- tables receive a NOT NULL employment_id column in Phase B.3. ADD COLUMN
-- ... NOT NULL on a populated table without a DEFAULT fails because existing
-- rows can't satisfy the constraint. Truncating these three tables produces
-- empty tables that accept the NOT NULL column cleanly.
--
-- Per Hector's mandate ("all data can be erased"): truncation is acceptable.
-- Test data for these three tables will be re-seeded after the migration
-- applies and Phase 2a/2b/2c SPA commits land.
--
-- Other tables (appointments, patient_assignments, patients) take nullable
-- employment_id and tolerate existing rows; their pro-link will be NULL
-- after the migration and re-linked manually as part of test re-seeding.

TRUNCATE public.professional_documents, public.professional_schedules, public.professional_session_types;

-- A.1 — Drop policies on dependent tables that reference my_professional_id() OR the professionals table directly

DROP POLICY IF EXISTS appointments_professional_own ON public.appointments;
DROP POLICY IF EXISTS notes_treating_professional_all ON public.clinical_notes;
DROP POLICY IF EXISTS assignments_professional_read ON public.patient_assignments;
DROP POLICY IF EXISTS assignments_professional_update ON public.patient_assignments;
DROP POLICY IF EXISTS patients_professional_active_assignment ON public.patients;
DROP POLICY IF EXISTS pd_professional_own ON public.professional_documents;
DROP POLICY IF EXISTS ps_professional_own ON public.professional_schedules;
DROP POLICY IF EXISTS pst_professional_own ON public.professional_session_types;
DROP POLICY IF EXISTS session_types_professional_read ON public.session_types;
DROP POLICY IF EXISTS pd_admin_all ON public.professional_documents;
DROP POLICY IF EXISTS ps_admin_all ON public.professional_schedules;
DROP POLICY IF EXISTS pst_admin_all ON public.professional_session_types;
DROP POLICY IF EXISTS pd_public_read_displayed ON public.professional_documents;

-- Storage policies on storage.objects that reference professionals or
-- my_professional_id() (discovered after first apply attempt failed):

DROP POLICY IF EXISTS professional_documents_admin_all ON storage.objects;
DROP POLICY IF EXISTS professional_documents_own ON storage.objects;
DROP POLICY IF EXISTS professional_documents_public_read ON storage.objects;
DROP POLICY IF EXISTS professional_photos_admin_all ON storage.objects;
DROP POLICY IF EXISTS professional_photos_own ON storage.objects;
DROP POLICY IF EXISTS professional_photos_public_read ON storage.objects;

-- A.2 — Drop policies on professionals itself

DROP POLICY IF EXISTS professionals_admin_all ON public.professionals;
DROP POLICY IF EXISTS professionals_authenticated_read_active ON public.professionals;
DROP POLICY IF EXISTS professionals_self_update ON public.professionals;
DROP POLICY IF EXISTS professionals_super_admin_read ON public.professionals;

-- A.3 — Drop FK constraints + columns on dependent tables

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_professional_id_fkey,
  DROP COLUMN IF EXISTS professional_id;

ALTER TABLE public.patient_assignments
  DROP CONSTRAINT IF EXISTS patient_assignments_professional_id_fkey,
  DROP COLUMN IF EXISTS professional_id;

ALTER TABLE public.patients
  DROP CONSTRAINT IF EXISTS patients_professional_id_fkey,
  DROP COLUMN IF EXISTS professional_id;

ALTER TABLE public.professional_documents
  DROP CONSTRAINT IF EXISTS professional_documents_professional_id_fkey,
  DROP COLUMN IF EXISTS professional_id;

ALTER TABLE public.professional_schedules
  DROP CONSTRAINT IF EXISTS professional_schedules_professional_id_fkey,
  DROP COLUMN IF EXISTS professional_id;

ALTER TABLE public.professional_session_types
  DROP CONSTRAINT IF EXISTS professional_session_types_professional_id_fkey,
  DROP COLUMN IF EXISTS professional_id;

-- A.4 — Drop the professionals table

DROP TABLE IF EXISTS public.professionals CASCADE;

-- A.5 — Drop my_professional_id()

DROP FUNCTION IF EXISTS public.my_professional_id();

-- ============================================================================
-- PHASE B: Build new structure
-- ============================================================================

-- B.1 — professional_profiles (pro-owned)

CREATE TABLE public.professional_profiles (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name          text NOT NULL,
  photo_url          text,
  bio                text,
  specialties        text[] DEFAULT '{}',
  education          text,
  years_experience   integer,
  public_summary     text,
  public_credentials text,
  public_documents   jsonb,
  created_at         timestamptz DEFAULT now() NOT NULL,
  updated_at         timestamptz DEFAULT now() NOT NULL
);

CREATE TRIGGER set_updated_at_professional_profiles
  BEFORE UPDATE ON public.professional_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- B.2 — professional_employments (centro-owned)

CREATE TABLE public.professional_employments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id     uuid NOT NULL REFERENCES public.professional_profiles(id) ON DELETE CASCADE,
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  email          text,
  color          text DEFAULT '#2f4a3a',
  active         boolean DEFAULT true,
  public_profile boolean DEFAULT true,
  created_at     timestamptz DEFAULT now() NOT NULL,
  updated_at     timestamptz DEFAULT now() NOT NULL,
  UNIQUE (profile_id, client_id)
);

CREATE TRIGGER set_updated_at_professional_employments
  BEFORE UPDATE ON public.professional_employments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- B.3 — Add employment_id columns to dependent tables
--
-- ON DELETE behavior matches the pre-split FK behavior captured in recon:
--   - appointments, patient_assignments, patients: SET NULL (the assignment
--     persists with no professional rather than cascading deletes outward).
--   - professional_documents, professional_schedules, professional_session_types:
--     CASCADE (these are owned by the employment; if the employment goes,
--     so do they).

ALTER TABLE public.appointments
  ADD COLUMN employment_id uuid REFERENCES public.professional_employments(id) ON DELETE SET NULL;

ALTER TABLE public.patient_assignments
  ADD COLUMN employment_id uuid REFERENCES public.professional_employments(id) ON DELETE SET NULL;

ALTER TABLE public.patients
  ADD COLUMN employment_id uuid REFERENCES public.professional_employments(id) ON DELETE SET NULL;

-- professional_documents is pro-owned, not centro-owned: a pro's CV and
-- credentials travel with the person across centros. The FK references
-- professional_profiles, not professional_employments. The other 5
-- dependent tables (appointments, patient_assignments, patients,
-- professional_schedules, professional_session_types) are centro-scoped
-- and use employment_id.
ALTER TABLE public.professional_documents
  ADD COLUMN profile_id uuid NOT NULL REFERENCES public.professional_profiles(id) ON DELETE CASCADE;

-- professional_schedules had UNIQUE constraint schedule_unique_slot
-- on (professional_id, day_of_week, start_time). Recreating as
-- (employment_id, day_of_week, start_time) after the column swap.
ALTER TABLE public.professional_schedules
  ADD COLUMN employment_id uuid NOT NULL REFERENCES public.professional_employments(id) ON DELETE CASCADE;

ALTER TABLE public.professional_schedules
  ADD CONSTRAINT schedule_unique_slot UNIQUE (employment_id, day_of_week, start_time);

-- professional_session_types had composite PK (professional_id, session_type_id).
-- Recreating as (employment_id, session_type_id) after the column swap.
ALTER TABLE public.professional_session_types
  ADD COLUMN employment_id uuid NOT NULL REFERENCES public.professional_employments(id) ON DELETE CASCADE;

ALTER TABLE public.professional_session_types
  ADD PRIMARY KEY (employment_id, session_type_id);

-- B.4 — my_employment_id() helper
--
-- Returns the active employment id for the auth user at their current centro.
-- Joins through professional_profiles.user_id (now UNIQUE per gap 65 closure).
-- LIMIT 1 because a pro could have multiple active employments across centros,
-- but my_client_id() narrows to the current centro context.

CREATE OR REPLACE FUNCTION public.my_employment_id()
  RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT e.id
  FROM public.professional_employments e
  JOIN public.professional_profiles p ON p.id = e.profile_id
  WHERE p.user_id = auth.uid()
    AND e.client_id = my_client_id()
    AND e.active = true
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.my_employment_id()
  TO anon, authenticated, service_role;

-- B.5 — is_admin_with_clinical_authority(p_client_id) helper (gap 67)
--
-- Returns true iff (a) the auth user is admin of the given centro, AND
-- (b) the auth user has a professional_profiles row (i.e., is also a
-- licensed pro with clinical authority per Ley 20.584).
--
-- Gap 67 will wire this helper to notes_admin_with_consent policy when
-- gap 46 ships the admin_can_view_clinical_notes centro toggle. For now,
-- the helper exists and is callable but no policy uses it yet.

CREATE OR REPLACE FUNCTION public.is_admin_with_clinical_authority(p_client_id uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT
    is_admin_of_client(p_client_id)
    AND EXISTS (
      SELECT 1 FROM public.professional_profiles
      WHERE user_id = auth.uid()
    )
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_with_clinical_authority(uuid)
  TO anon, authenticated, service_role;

-- ============================================================================
-- PHASE C: Grants on new tables
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.professional_profiles
  TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.professional_employments
  TO anon, authenticated, service_role;

-- ============================================================================
-- PHASE D: RLS policies on new tables (strict isolation)
-- ============================================================================

ALTER TABLE public.professional_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_employments ENABLE ROW LEVEL SECURITY;

-- D.1 — professional_profiles policies
--
-- Strict isolation: pros see only their own profile. Admin and super-admin
-- see all profiles for pros employed at their centro. No cross-centro
-- reads via direct queries; future public profile page goes through a
-- SECURITY DEFINER function.

-- Pro reads/writes their own profile.
CREATE POLICY profiles_self_all ON public.professional_profiles
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Admin reads profiles of pros employed at their centro.
CREATE POLICY profiles_admin_read ON public.professional_profiles
  FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT profile_id FROM public.professional_employments
      WHERE is_admin_of_client(client_id) AND active = true
    )
  );

-- Admin INSERT a profile during onboarding.
CREATE POLICY profiles_admin_insert ON public.professional_profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin' AND active = true
    )
  );

-- Admin UPDATE only on unclaimed profiles (user_id IS NULL) of pros at their centro.
-- Once a pro claims their account, only profiles_self_all applies for writes.
CREATE POLICY profiles_admin_update_unclaimed ON public.professional_profiles
  FOR UPDATE TO authenticated
  USING (
    user_id IS NULL
    AND id IN (
      SELECT profile_id FROM public.professional_employments
      WHERE is_admin_of_client(client_id)
    )
  )
  WITH CHECK (
    user_id IS NULL
    AND id IN (
      SELECT profile_id FROM public.professional_employments
      WHERE is_admin_of_client(client_id)
    )
  );

-- Admin DELETE profiles of pros at their centro (offboarding).
CREATE POLICY profiles_admin_delete ON public.professional_profiles
  FOR DELETE TO authenticated
  USING (
    id IN (
      SELECT profile_id FROM public.professional_employments
      WHERE is_admin_of_client(client_id)
    )
  );

-- Super-admin all access.
CREATE POLICY profiles_super_admin_all ON public.professional_profiles
  FOR ALL TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- D.2 — professional_employments policies

-- Admin all-access for employments at their centro.
CREATE POLICY employments_admin_all ON public.professional_employments
  FOR ALL TO authenticated
  USING (is_admin_of_client(client_id))
  WITH CHECK (is_admin_of_client(client_id));

-- Authenticated users read active employments at their centro.
-- Used by SPA agenda's "list of pros at this centro" — operational fields
-- only, no profile-level identity data leaks here.
CREATE POLICY employments_authenticated_read_active ON public.professional_employments
  FOR SELECT TO authenticated
  USING (active = true AND client_id = my_client_id());

-- Pros read their own employments (across any centros they work at).
-- Used by my_employment_id() helper resolution.
CREATE POLICY employments_self_read ON public.professional_employments
  FOR SELECT TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM public.professional_profiles
      WHERE user_id = auth.uid()
    )
  );

-- Super-admin all.
CREATE POLICY employments_super_admin_all ON public.professional_employments
  FOR ALL TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- ============================================================================
-- PHASE E: Recreate policies on dependent tables
-- ============================================================================

-- E.1 — appointments

CREATE POLICY appointments_professional_own ON public.appointments
  FOR ALL TO authenticated
  USING (employment_id = my_employment_id())
  WITH CHECK (employment_id = my_employment_id());

-- E.2 — clinical_notes

CREATE POLICY notes_treating_professional_all ON public.clinical_notes
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patient_assignments pa
      WHERE pa.id = clinical_notes.assignment_id
        AND pa.employment_id = my_employment_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.patient_assignments pa
      WHERE pa.id = clinical_notes.assignment_id
        AND pa.employment_id = my_employment_id()
        AND pa.status = 'active'
    )
  );

-- E.3 — patient_assignments

CREATE POLICY assignments_professional_read ON public.patient_assignments
  FOR SELECT TO authenticated
  USING (employment_id = my_employment_id());

CREATE POLICY assignments_professional_update ON public.patient_assignments
  FOR UPDATE TO authenticated
  USING (employment_id = my_employment_id() AND status = 'active')
  WITH CHECK (employment_id = my_employment_id() AND status = 'active');

-- E.4 — patients (gap 57 still applies — broad FOR ALL retained for now)

CREATE POLICY patients_professional_active_assignment ON public.patients
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.patient_assignments pa
      WHERE pa.patient_id = patients.id
        AND pa.employment_id = my_employment_id()
        AND pa.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.patient_assignments pa
      WHERE pa.patient_id = patients.id
        AND pa.employment_id = my_employment_id()
        AND pa.status = 'active'
    )
  );

-- E.5 — professional_documents

CREATE POLICY pd_professional_own ON public.professional_documents
  FOR ALL TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM public.professional_profiles WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    profile_id IN (
      SELECT id FROM public.professional_profiles WHERE user_id = auth.uid()
    )
  );

-- E.6 — professional_schedules

CREATE POLICY ps_professional_own ON public.professional_schedules
  FOR ALL TO authenticated
  USING (employment_id = my_employment_id())
  WITH CHECK (employment_id = my_employment_id());

-- E.7 — professional_session_types

CREATE POLICY pst_professional_own ON public.professional_session_types
  FOR ALL TO authenticated
  USING (employment_id = my_employment_id())
  WITH CHECK (employment_id = my_employment_id());

-- E.7b — professional_documents admin (recreated from pd_admin_all)

CREATE POLICY pd_admin_all ON public.professional_documents
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.professional_employments e
      WHERE e.profile_id = professional_documents.profile_id
        AND is_admin_of_client(e.client_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.professional_employments e
      WHERE e.profile_id = professional_documents.profile_id
        AND is_admin_of_client(e.client_id)
    )
  );

-- E.7c — professional_schedules admin (recreated from ps_admin_all)

CREATE POLICY ps_admin_all ON public.professional_schedules
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.professional_employments e
      WHERE e.id = professional_schedules.employment_id
        AND is_admin_of_client(e.client_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.professional_employments e
      WHERE e.id = professional_schedules.employment_id
        AND is_admin_of_client(e.client_id)
    )
  );

-- E.7d — professional_session_types admin (recreated from pst_admin_all)

CREATE POLICY pst_admin_all ON public.professional_session_types
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.professional_employments e
      WHERE e.id = professional_session_types.employment_id
        AND is_admin_of_client(e.client_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.professional_employments e
      WHERE e.id = professional_session_types.employment_id
        AND is_admin_of_client(e.client_id)
    )
  );

-- E.8 — session_types

CREATE POLICY session_types_professional_read ON public.session_types
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.professional_employments e
      WHERE e.id = my_employment_id()
        AND e.client_id = session_types.client_id
    )
  );

-- ============================================================================
-- E.9 — Storage policies on storage.objects (recreated)
--
-- Both professional-photos and professional-documents buckets store files
-- under folder structure <bucket>/<profile_id>/filename. Photos and CVs
-- are pro-owned identity assets that travel with the person across centros.
--
-- Two policies per bucket: own (pro manages their own files) + admin_all
-- (centro admin manages files of pros employed at their centro). The
-- public-read policies (professional_photos_public_read,
-- professional_documents_public_read) are deferred to gap 51's deferred
-- public profile work; anon access will go through get_public_professionals
-- SECURITY DEFINER instead of direct table policies.
-- ============================================================================

-- E.9a — Photos bucket: pro manages own folder

CREATE POLICY professional_photos_own ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'professional-photos'
    AND (storage.foldername(name))[1] = (
      SELECT id::text FROM public.professional_profiles WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'professional-photos'
    AND (storage.foldername(name))[1] = (
      SELECT id::text FROM public.professional_profiles WHERE user_id = auth.uid()
    )
  );

-- E.9b — Photos bucket: admin manages files for pros at their centro

CREATE POLICY professional_photos_admin_all ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'professional-photos'
    AND EXISTS (
      SELECT 1 FROM public.professional_employments e
      WHERE e.profile_id::text = (storage.foldername(objects.name))[1]
        AND is_admin_of_client(e.client_id)
    )
  )
  WITH CHECK (
    bucket_id = 'professional-photos'
    AND EXISTS (
      SELECT 1 FROM public.professional_employments e
      WHERE e.profile_id::text = (storage.foldername(objects.name))[1]
        AND is_admin_of_client(e.client_id)
    )
  );

-- E.9c — Documents bucket: pro manages own folder

CREATE POLICY professional_documents_own ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'professional-documents'
    AND (storage.foldername(name))[1] = (
      SELECT id::text FROM public.professional_profiles WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'professional-documents'
    AND (storage.foldername(name))[1] = (
      SELECT id::text FROM public.professional_profiles WHERE user_id = auth.uid()
    )
  );

-- E.9d — Documents bucket: admin manages files for pros at their centro

CREATE POLICY professional_documents_admin_all ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'professional-documents'
    AND EXISTS (
      SELECT 1 FROM public.professional_employments e
      WHERE e.profile_id::text = (storage.foldername(objects.name))[1]
        AND is_admin_of_client(e.client_id)
    )
  )
  WITH CHECK (
    bucket_id = 'professional-documents'
    AND EXISTS (
      SELECT 1 FROM public.professional_employments e
      WHERE e.profile_id::text = (storage.foldername(objects.name))[1]
        AND is_admin_of_client(e.client_id)
    )
  );

-- ============================================================================
-- PHASE F: RPC function rewrites — DEFERRED
-- ============================================================================
--
-- get_bot_context and create_booking_atomic both reference the dropped
-- public.professionals table. After this migration applies WITHOUT Phase F,
-- both functions will error on next call ("relation does not exist").
--
-- Phase F lives in a follow-up Code session: open the existing function
-- bodies, translate the JOINs and references to use professional_profiles
-- and professional_employments, replace the placeholders here. The bot
-- integration stays broken until Phase F + Make.com blueprint update at
-- the very end of the gap 66 arc.
--
-- For now: this migration leaves these functions referencing the dropped
-- table. They are runtime-broken until Phase F migration ships.
--
-- TODO Phase F: rewrite get_bot_context.
-- TODO Phase F: rewrite create_booking_atomic with p_employment_id parameter.
-- TODO Phase F (or future gap 51 work): pd_public_read_displayed not recreated.
--   Anon access to public_documents will go through get_public_professionals
--   SECURITY DEFINER function, not a direct table policy.
-- TODO Phase F (or future gap 51 work): professional_photos_public_read and
--   professional_documents_public_read storage policies are NOT recreated.
--   Anon access to public photos and documents goes through
--   get_public_professionals SECURITY DEFINER function (when it ships),
--   not direct storage policies.
--
-- ============================================================================

COMMIT;
