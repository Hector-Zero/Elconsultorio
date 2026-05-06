-- =============================================================================
-- 20260506000100_baseline_rls_policies.sql
-- =============================================================================
-- Baseline capture of RLS policies on all public schema tables, from
-- production state as of 2026-05-06. Idempotent via DROP POLICY IF EXISTS
-- + CREATE POLICY per policy. This migration represents a faithful
-- snapshot of what is currently live in the Supabase database — no
-- behavior changes.
--
-- All policies are PERMISSIVE (no RESTRICTIVE policies exist in the
-- current schema). Tables ordered alphabetically.
--
-- Companion migration 20260506000000 captures helper functions and the
-- handle_new_user trigger; companion 20260506000200 captures table and
-- function grants.
--
-- Tracked in 08_known_gaps.md item 40. Surprises captured AS-IS,
-- deferred to focused passes:
--   - clients_public_lookup exposes clients.config to anon (item 50)
--   - professionals_public_read_active exposes email + user_id (item 51)
--   - appointments_professional_own allows DELETE; should be soft-delete
--     (item 52)
--   - Mixed TO authenticated / TO public role-target style across tables
--     (Decision 2 explicitly chose not to normalize)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- agents_config — per-client bot configuration (system prompt, model limits)
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS agents_config_admin_all ON public.agents_config;
CREATE POLICY agents_config_admin_all ON public.agents_config
  FOR ALL
  TO authenticated
  USING (is_admin_of_client(client_id))
  WITH CHECK (is_admin_of_client(client_id));

DROP POLICY IF EXISTS agents_config_super_admin_read ON public.agents_config;
CREATE POLICY agents_config_super_admin_read ON public.agents_config
  FOR SELECT
  TO authenticated
  USING (is_super_admin());


-- -----------------------------------------------------------------------------
-- appointments — booked sessions, scoped to admin (whole centro) or treating
-- professional. Note: professional_own is FOR ALL incl. DELETE — see gap 52.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS appointments_admin_all ON public.appointments;
CREATE POLICY appointments_admin_all ON public.appointments
  FOR ALL
  TO authenticated
  USING (is_admin_of_client(client_id))
  WITH CHECK (is_admin_of_client(client_id));

DROP POLICY IF EXISTS appointments_professional_own ON public.appointments;
CREATE POLICY appointments_professional_own ON public.appointments
  FOR ALL
  TO authenticated
  USING (professional_id = my_professional_id())
  WITH CHECK (professional_id = my_professional_id());

DROP POLICY IF EXISTS appointments_super_admin_read ON public.appointments;
CREATE POLICY appointments_super_admin_read ON public.appointments
  FOR SELECT
  TO authenticated
  USING (is_super_admin());


-- -----------------------------------------------------------------------------
-- clients — multi-tenant centro registry. public_lookup is permissive on
-- {anon, authenticated} for slug→clientId bootstrap (see gap 50).
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS clients_admin_update ON public.clients;
CREATE POLICY clients_admin_update ON public.clients
  FOR UPDATE
  TO authenticated
  USING ((id = my_client_id()) AND is_admin_of_client(id))
  WITH CHECK ((id = my_client_id()) AND is_admin_of_client(id));

DROP POLICY IF EXISTS clients_public_lookup ON public.clients;
CREATE POLICY clients_public_lookup ON public.clients
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS clients_super_admin_all ON public.clients;
CREATE POLICY clients_super_admin_all ON public.clients
  FOR ALL
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());


-- -----------------------------------------------------------------------------
-- clinical_notes — per Ley 20.584, treating professionals only write; admins
-- read only when admin_can_view_notes flag is set on the assignment.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS notes_admin_with_consent ON public.clinical_notes;
CREATE POLICY notes_admin_with_consent ON public.clinical_notes
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM patient_assignments pa
    WHERE pa.id = clinical_notes.assignment_id
      AND pa.client_id = my_client_id()
      AND pa.admin_can_view_notes = true
      AND is_admin_of_client(pa.client_id)
  ));

DROP POLICY IF EXISTS notes_treating_professional_all ON public.clinical_notes;
CREATE POLICY notes_treating_professional_all ON public.clinical_notes
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM patient_assignments pa
    WHERE pa.id = clinical_notes.assignment_id
      AND pa.professional_id = my_professional_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM patient_assignments pa
    WHERE pa.id = clinical_notes.assignment_id
      AND pa.professional_id = my_professional_id()
      AND pa.status = 'active'::text
  ));


-- -----------------------------------------------------------------------------
-- conversions — lead→paying-customer conversion records (revenue analytics)
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS conversions_admin_all ON public.conversions;
CREATE POLICY conversions_admin_all ON public.conversions
  FOR ALL
  TO authenticated
  USING (is_admin_of_client(client_id))
  WITH CHECK (is_admin_of_client(client_id));

DROP POLICY IF EXISTS conversions_super_admin_read ON public.conversions;
CREATE POLICY conversions_super_admin_read ON public.conversions
  FOR SELECT
  TO authenticated
  USING (is_super_admin());


-- -----------------------------------------------------------------------------
-- email_logs — outbound email audit trail (Resend); read-only for admins.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS email_logs_admin_read ON public.email_logs;
CREATE POLICY email_logs_admin_read ON public.email_logs
  FOR SELECT
  TO authenticated
  USING (is_admin_of_client(client_id));

DROP POLICY IF EXISTS email_logs_super_admin_read ON public.email_logs;
CREATE POLICY email_logs_super_admin_read ON public.email_logs
  FOR SELECT
  TO authenticated
  USING (is_super_admin());


-- -----------------------------------------------------------------------------
-- invoices — billing records (Bsale + Mercado Pago integration)
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS invoices_admin_all ON public.invoices;
CREATE POLICY invoices_admin_all ON public.invoices
  FOR ALL
  TO authenticated
  USING (is_admin_of_client(client_id))
  WITH CHECK (is_admin_of_client(client_id));

DROP POLICY IF EXISTS invoices_super_admin_read ON public.invoices;
CREATE POLICY invoices_super_admin_read ON public.invoices
  FOR SELECT
  TO authenticated
  USING (is_super_admin());


-- -----------------------------------------------------------------------------
-- leads — Telegram conversation prospects (pre-conversion)
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS leads_admin_all ON public.leads;
CREATE POLICY leads_admin_all ON public.leads
  FOR ALL
  TO authenticated
  USING (is_admin_of_client(client_id))
  WITH CHECK (is_admin_of_client(client_id));

DROP POLICY IF EXISTS leads_super_admin_read ON public.leads;
CREATE POLICY leads_super_admin_read ON public.leads
  FOR SELECT
  TO authenticated
  USING (is_super_admin());


-- -----------------------------------------------------------------------------
-- patient_assignments — patient↔professional treatment relationship; gates
-- clinical_notes access. Admin can change admin_can_view_notes flag.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS assignments_admin_all ON public.patient_assignments;
CREATE POLICY assignments_admin_all ON public.patient_assignments
  FOR ALL
  TO authenticated
  USING (is_admin_of_client(client_id))
  WITH CHECK (is_admin_of_client(client_id));

DROP POLICY IF EXISTS assignments_professional_read ON public.patient_assignments;
CREATE POLICY assignments_professional_read ON public.patient_assignments
  FOR SELECT
  TO authenticated
  USING (professional_id = my_professional_id());

DROP POLICY IF EXISTS assignments_professional_update ON public.patient_assignments;
CREATE POLICY assignments_professional_update ON public.patient_assignments
  FOR UPDATE
  TO authenticated
  USING ((professional_id = my_professional_id()) AND (status = 'active'::text))
  WITH CHECK ((professional_id = my_professional_id()) AND (status = 'active'::text));

DROP POLICY IF EXISTS assignments_super_admin_read ON public.patient_assignments;
CREATE POLICY assignments_super_admin_read ON public.patient_assignments
  FOR SELECT
  TO authenticated
  USING (is_super_admin());


-- -----------------------------------------------------------------------------
-- patients — clinical patient records. Treating-professional access scoped
-- via active patient_assignments row.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS patients_admin_all ON public.patients;
CREATE POLICY patients_admin_all ON public.patients
  FOR ALL
  TO authenticated
  USING (is_admin_of_client(client_id))
  WITH CHECK (is_admin_of_client(client_id));

DROP POLICY IF EXISTS patients_professional_active_assignment ON public.patients;
CREATE POLICY patients_professional_active_assignment ON public.patients
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM patient_assignments pa
    WHERE pa.patient_id = patients.id
      AND pa.professional_id = my_professional_id()
      AND pa.status = 'active'::text
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM patient_assignments pa
    WHERE pa.patient_id = patients.id
      AND pa.professional_id = my_professional_id()
      AND pa.status = 'active'::text
  ));

DROP POLICY IF EXISTS patients_super_admin_read ON public.patients;
CREATE POLICY patients_super_admin_read ON public.patients
  FOR SELECT
  TO authenticated
  USING (is_super_admin());


-- -----------------------------------------------------------------------------
-- professional_documents — diplomas, certificates, professional credentials.
-- Public read for display_on_profile + active + public_profile rows.
-- All policies TO public (Decision 2: capture style as-is).
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS pd_admin_all ON public.professional_documents;
CREATE POLICY pd_admin_all ON public.professional_documents
  FOR ALL
  TO public
  USING (EXISTS (
    SELECT 1
    FROM professionals p
    WHERE p.id = professional_documents.professional_id
      AND is_admin_of_client(p.client_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM professionals p
    WHERE p.id = professional_documents.professional_id
      AND is_admin_of_client(p.client_id)
  ));

DROP POLICY IF EXISTS pd_professional_own ON public.professional_documents;
CREATE POLICY pd_professional_own ON public.professional_documents
  FOR ALL
  TO public
  USING (professional_id = my_professional_id())
  WITH CHECK (professional_id = my_professional_id());

DROP POLICY IF EXISTS pd_public_read_displayed ON public.professional_documents;
CREATE POLICY pd_public_read_displayed ON public.professional_documents
  FOR SELECT
  TO public
  USING ((display_on_profile = true) AND (EXISTS (
    SELECT 1
    FROM professionals p
    WHERE p.id = professional_documents.professional_id
      AND p.public_profile = true
      AND p.active = true
  )));

DROP POLICY IF EXISTS pd_super_admin_all ON public.professional_documents;
CREATE POLICY pd_super_admin_all ON public.professional_documents
  FOR ALL
  TO public
  USING (is_super_admin())
  WITH CHECK (is_super_admin());


-- -----------------------------------------------------------------------------
-- professional_schedules — weekly availability per professional.
-- All policies TO public (Decision 2: capture style as-is).
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS ps_admin_all ON public.professional_schedules;
CREATE POLICY ps_admin_all ON public.professional_schedules
  FOR ALL
  TO public
  USING (EXISTS (
    SELECT 1
    FROM professionals p
    WHERE p.id = professional_schedules.professional_id
      AND is_admin_of_client(p.client_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM professionals p
    WHERE p.id = professional_schedules.professional_id
      AND is_admin_of_client(p.client_id)
  ));

DROP POLICY IF EXISTS ps_professional_own ON public.professional_schedules;
CREATE POLICY ps_professional_own ON public.professional_schedules
  FOR ALL
  TO public
  USING (professional_id = my_professional_id())
  WITH CHECK (professional_id = my_professional_id());

DROP POLICY IF EXISTS ps_super_admin_all ON public.professional_schedules;
CREATE POLICY ps_super_admin_all ON public.professional_schedules
  FOR ALL
  TO public
  USING (is_super_admin())
  WITH CHECK (is_super_admin());


-- -----------------------------------------------------------------------------
-- professional_session_types — per-professional service catalog (custom prices).
-- All policies TO public (Decision 2: capture style as-is).
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS pst_admin_all ON public.professional_session_types;
CREATE POLICY pst_admin_all ON public.professional_session_types
  FOR ALL
  TO public
  USING (EXISTS (
    SELECT 1
    FROM professionals p
    WHERE p.id = professional_session_types.professional_id
      AND is_admin_of_client(p.client_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM professionals p
    WHERE p.id = professional_session_types.professional_id
      AND is_admin_of_client(p.client_id)
  ));

DROP POLICY IF EXISTS pst_professional_own ON public.professional_session_types;
CREATE POLICY pst_professional_own ON public.professional_session_types
  FOR ALL
  TO public
  USING (professional_id = my_professional_id())
  WITH CHECK (professional_id = my_professional_id());

DROP POLICY IF EXISTS pst_super_admin_all ON public.professional_session_types;
CREATE POLICY pst_super_admin_all ON public.professional_session_types
  FOR ALL
  TO public
  USING (is_super_admin())
  WITH CHECK (is_super_admin());


-- -----------------------------------------------------------------------------
-- professionals — staff registry. public_read_active exposes ALL columns of
-- active rows to {anon, authenticated} including email + user_id (see gap 51).
-- self_update lets the linked auth user edit their own row directly.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS professionals_admin_all ON public.professionals;
CREATE POLICY professionals_admin_all ON public.professionals
  FOR ALL
  TO authenticated
  USING (is_admin_of_client(client_id))
  WITH CHECK (is_admin_of_client(client_id));

DROP POLICY IF EXISTS professionals_public_read_active ON public.professionals;
CREATE POLICY professionals_public_read_active ON public.professionals
  FOR SELECT
  TO anon, authenticated
  USING (active = true);

DROP POLICY IF EXISTS professionals_self_update ON public.professionals;
CREATE POLICY professionals_self_update ON public.professionals
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS professionals_super_admin_read ON public.professionals;
CREATE POLICY professionals_super_admin_read ON public.professionals
  FOR SELECT
  TO authenticated
  USING (is_super_admin());


-- -----------------------------------------------------------------------------
-- session_types — per-client service catalog (Consulta individual, etc.).
-- All policies TO public (Decision 2: capture style as-is).
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS session_types_admin_all ON public.session_types;
CREATE POLICY session_types_admin_all ON public.session_types
  FOR ALL
  TO public
  USING (is_admin_of_client(client_id))
  WITH CHECK (is_admin_of_client(client_id));

DROP POLICY IF EXISTS session_types_professional_read ON public.session_types;
CREATE POLICY session_types_professional_read ON public.session_types
  FOR SELECT
  TO public
  USING (EXISTS (
    SELECT 1
    FROM professionals p
    WHERE p.id = my_professional_id()
      AND p.client_id = session_types.client_id
  ));

DROP POLICY IF EXISTS session_types_super_admin_all ON public.session_types;
CREATE POLICY session_types_super_admin_all ON public.session_types
  FOR ALL
  TO public
  USING (is_super_admin())
  WITH CHECK (is_super_admin());


-- -----------------------------------------------------------------------------
-- super_admins — global super-admin allowlist. Read-only via RLS; INSERT/
-- UPDATE/DELETE require service_role (intentional lockdown).
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS super_admins_read ON public.super_admins;
CREATE POLICY super_admins_read ON public.super_admins
  FOR SELECT
  TO authenticated
  USING (is_super_admin());


-- -----------------------------------------------------------------------------
-- usage_log — bot AI token usage for cost tracking. Read-only for admins.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS usage_log_admin_read ON public.usage_log;
CREATE POLICY usage_log_admin_read ON public.usage_log
  FOR SELECT
  TO authenticated
  USING (is_admin_of_client(client_id));

DROP POLICY IF EXISTS usage_log_super_admin_read ON public.usage_log;
CREATE POLICY usage_log_super_admin_read ON public.usage_log
  FOR SELECT
  TO authenticated
  USING (is_super_admin());


-- -----------------------------------------------------------------------------
-- users — auth-user-to-client tenancy mapping. Self-read, admin-read+write
-- within centro, super-admin read across all centros. INSERT happens via
-- handle_new_user trigger (SECURITY DEFINER), bypassing RLS.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS users_admin_read ON public.users;
CREATE POLICY users_admin_read ON public.users
  FOR SELECT
  TO authenticated
  USING ((client_id = my_client_id()) AND is_admin_of_client(client_id));

DROP POLICY IF EXISTS users_admin_write ON public.users;
CREATE POLICY users_admin_write ON public.users
  FOR ALL
  TO authenticated
  USING ((client_id = my_client_id()) AND is_admin_of_client(client_id))
  WITH CHECK ((client_id = my_client_id()) AND is_admin_of_client(client_id));

DROP POLICY IF EXISTS users_self_read ON public.users;
CREATE POLICY users_self_read ON public.users
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS users_super_admin_read ON public.users;
CREATE POLICY users_super_admin_read ON public.users
  FOR SELECT
  TO authenticated
  USING (is_super_admin());
