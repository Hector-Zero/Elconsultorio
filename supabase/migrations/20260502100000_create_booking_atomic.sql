-- 20260502T1000_create_booking_atomic.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Atomic booking RPC for the bot. Called from the create-booking Edge
-- Function with the service role key. Wraps Steps A–E from the Phase 2
-- spec in a single transaction so the advisory lock + slot check + inserts
-- can't race two simultaneous bot conversations into a double-booked slot.
--
-- Returns a single jsonb with either:
--   { "success": true,
--     "appointment_id": uuid,
--     "patient_id":     uuid,
--     "payment_link":   null,
--     "datetime_santiago": "YYYY-MM-DD HH:MM",
--     "professional_name": text }
--   { "success": false, "error": "<key>", "message": "<human-readable>" }
--
-- Don't run this migration without reviewing the column lists below
-- against the actual schema first — appointments / patients /
-- patient_assignments / leads must all have the columns this function
-- writes to. The function is NOT applied automatically; the Edge
-- Function will fail with `function ... does not exist` until you run
-- this file in the Supabase SQL editor (or `supabase db push`).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_booking_atomic(
  p_client_id        uuid,
  p_professional_id  uuid,
  p_datetime         timestamptz,
  p_session_type_id  uuid,
  p_duration         int,
  p_type             text,
  p_chat_id          text,
  p_patient_data     jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_full_name      text;
  v_rut            text;
  v_email          text;
  v_phone          text;
  v_address        text;

  v_lock_key       int;
  v_lock_ok        boolean;

  v_existing_id           uuid;
  v_idempotent_appt_id    uuid;
  v_idempotent_patient_id uuid;
  v_patient_id            uuid;
  v_assignment_id         uuid;
  v_lead_id               uuid;
  v_appt_id               uuid;
  v_pro_name              text;
BEGIN
  -- ── Validation ────────────────────────────────────────────────────────────
  v_full_name := NULLIF(btrim(p_patient_data->>'full_name'), '');
  v_rut       := NULLIF(btrim(p_patient_data->>'rut'),       '');
  v_email     := NULLIF(btrim(p_patient_data->>'email'),     '');
  v_phone     := NULLIF(btrim(p_patient_data->>'phone'),     '');
  v_address   := NULLIF(btrim(p_patient_data->>'address'),   '');

  IF v_full_name IS NULL THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'validation',
      'message', 'patient_data.full_name requerido'
    );
  END IF;
  IF p_client_id IS NULL OR p_professional_id IS NULL OR p_datetime IS NULL THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'validation',
      'message', 'client_id, professional_id y datetime son requeridos'
    );
  END IF;

  -- Resolve the lead linked to this chat_id once — used for both the
  -- idempotency check below and the lead update in step E. Null if no
  -- lead exists yet (e.g. a chat that never produced a lead row).
  IF p_chat_id IS NOT NULL AND p_chat_id <> '' THEN
    SELECT id INTO v_lead_id
      FROM leads
     WHERE client_id = p_client_id
       AND chat_id   = p_chat_id
     LIMIT 1;
  END IF;

  -- ── Idempotency: same chat_id + same slot already booked = same booking ──
  -- Make.com retries on transient errors. Without this guard, a successful
  -- first call followed by a network-blip retry returns 409 slot_taken (the
  -- bot's own previous booking blocks its retry). Match on
  -- (client, professional, datetime, lead_id-from-chat, active status). When
  -- v_lead_id is null we deliberately skip — a chat without a lead row has
  -- no key to dedupe on, and the slot-locked / slot-taken paths still cover
  -- concurrent collisions correctly.
  IF v_lead_id IS NOT NULL THEN
    SELECT a.id, a.patient_id
      INTO v_idempotent_appt_id, v_idempotent_patient_id
      FROM appointments a
     WHERE a.client_id       = p_client_id
       AND a.professional_id = p_professional_id
       AND a.datetime        = p_datetime
       AND a.lead_id         = v_lead_id
       AND a.status IN ('pending_payment', 'confirmed')
     LIMIT 1;

    IF v_idempotent_appt_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success',           true,
        'appointment_id',    v_idempotent_appt_id,
        'patient_id',        v_idempotent_patient_id,
        'payment_link',      NULL,
        'datetime_santiago', to_char(p_datetime AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD HH24:MI'),
        'professional_name', (SELECT full_name FROM professionals WHERE id = p_professional_id),
        'idempotent',        true
      );
    END IF;
  END IF;

  -- ── STEP A: advisory lock + slot check ───────────────────────────────────
  -- Hash the (professional, datetime) pair to a single int. The lock is
  -- transaction-scoped, so it auto-releases on commit/rollback.
  v_lock_key := hashtext(p_professional_id::text || '|' || p_datetime::text);
  v_lock_ok  := pg_try_advisory_xact_lock(v_lock_key);

  IF NOT v_lock_ok THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'slot_locked',
      'message', 'Slot is being booked by another request'
    );
  END IF;

  SELECT id
    INTO v_existing_id
    FROM appointments
   WHERE professional_id = p_professional_id
     AND datetime        = p_datetime
     AND status IN ('pending_payment', 'confirmed')
   LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'slot_taken',
      'message', 'El horario ya fue reservado por otro paciente'
    );
  END IF;

  -- ── STEP B: upsert patient ───────────────────────────────────────────────
  -- Match by RUT first, then email — both scoped to client_id. We never
  -- match across both fields with OR + LIMIT because that can collapse two
  -- distinct people who happen to share an email (e.g. a household).
  IF v_rut IS NOT NULL THEN
    SELECT id INTO v_patient_id
      FROM patients
     WHERE client_id = p_client_id
       AND rut       = v_rut
     LIMIT 1;
  END IF;
  IF v_patient_id IS NULL AND v_email IS NOT NULL THEN
    SELECT id INTO v_patient_id
      FROM patients
     WHERE client_id = p_client_id
       AND email     = v_email
     LIMIT 1;
  END IF;

  IF v_patient_id IS NULL THEN
    INSERT INTO patients (client_id, full_name, rut, email, phone, address, status)
    VALUES (p_client_id, v_full_name, v_rut, v_email, v_phone, v_address, 'active')
    RETURNING id INTO v_patient_id;
  END IF;

  -- ── STEP C: ensure patient_assignments row ───────────────────────────────
  SELECT id INTO v_assignment_id
    FROM patient_assignments
   WHERE client_id       = p_client_id
     AND patient_id      = v_patient_id
     AND professional_id = p_professional_id
     AND status          = 'active'
   LIMIT 1;

  IF v_assignment_id IS NULL THEN
    INSERT INTO patient_assignments (client_id, patient_id, professional_id, status, admin_can_view_notes)
    VALUES (p_client_id, v_patient_id, p_professional_id, 'active', true);
  END IF;

  -- ── STEP D: insert appointment ───────────────────────────────────────────
  -- v_lead_id was resolved up top (idempotency check) and is reused here.
  INSERT INTO appointments (
    client_id, professional_id, patient_id, lead_id,
    datetime, duration, type, status, session_type_id, notes, payment_link
  )
  VALUES (
    p_client_id, p_professional_id, v_patient_id, v_lead_id,
    p_datetime, COALESCE(p_duration, 60), COALESCE(p_type, 'presencial'),
    'pending_payment', p_session_type_id, NULL, NULL
  )
  RETURNING id INTO v_appt_id;

  -- ── STEP E: mark lead as qualified ───────────────────────────────────────
  IF v_lead_id IS NOT NULL THEN
    UPDATE leads
       SET phase          = 'qualified',
           qualified_lead = true,
           last_updated   = now()
     WHERE id = v_lead_id;
  END IF;

  -- ── Response ─────────────────────────────────────────────────────────────
  SELECT full_name INTO v_pro_name
    FROM professionals
   WHERE id = p_professional_id;

  RETURN jsonb_build_object(
    'success',           true,
    'appointment_id',    v_appt_id,
    'patient_id',        v_patient_id,
    'payment_link',      NULL,
    'datetime_santiago', to_char(p_datetime AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD HH24:MI'),
    'professional_name', v_pro_name
  );
END;
$$;

COMMENT ON FUNCTION public.create_booking_atomic(uuid, uuid, timestamptz, uuid, int, text, text, jsonb) IS
  'Atomic bot booking. Used by the create-booking Edge Function. Wraps the slot lock, '
  'patient upsert, assignment, appointment insert, and lead update in a single '
  'transaction. Returns a structured jsonb result; the Edge Function maps that to '
  'HTTP status codes.';
