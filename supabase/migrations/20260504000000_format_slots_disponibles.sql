-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: format slots_disponibles as readable Spanish text grouped by professional
-- ─────────────────────────────────────────────────────────────────────────────
-- The previous version returned slots_disponibles as a JSON array of objects
-- (one entry per (professional, slot) pair). Make.com flattened this into
-- a long JSON-like string when injecting into Sonnet's context, which made
-- it hard for Sonnet to scan and to validate that a chosen slot is actually
-- available for the chosen professional.
--
-- This version returns slots_disponibles as a single pre-formatted Spanish
-- text block, e.g.:
--
--   === Profesional 1 ===
--   Lunes 04/05: 09:00, 10:00, 11:00, 12:00, 13:00, 14:00, 15:00, 16:00, 17:00, 18:00
--   Martes 05/05: 09:00, 10:00, ..., 17:00, 18:00
--   ...
--
--   === Profesional 2 ===
--   Lunes 04/05: 09:00, 10:00, 11:00, ...
--   ...
--
-- All other fields (centro, session_types, profesionales, lead, facturas_pendientes)
-- are unchanged. The signature, return type (jsonb), and security model are
-- unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_bot_context(p_client_id uuid, p_chat_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  result jsonb;
  v_lead jsonb;
  v_now_santiago timestamp;
  v_slots_text text;
BEGIN
  v_now_santiago := now() AT TIME ZONE 'America/Santiago';

  SELECT row_to_json(l)::jsonb INTO v_lead
  FROM leads l
  WHERE client_id = p_client_id AND chat_id = p_chat_id
  LIMIT 1;

  -- ── Build slots_disponibles as formatted Spanish text ────────────────────
  -- Steps:
  --   1. Generate all theoretical slots (per professional, per day, per hour)
  --      based on professional_schedules over the next 7 days.
  --   2. Exclude slots that are already booked (status IN ('pending_payment','confirmed')).
  --   3. Group the remaining slots by professional and by day.
  --   4. Format as readable Spanish text with day names translated.
  WITH days AS (
    SELECT generate_series(
      date_trunc('day', v_now_santiago),
      date_trunc('day', v_now_santiago) + interval '7 days',
      interval '1 day'
    )::date as dia
  ),
  pro_day_ranges AS (
    SELECT
      p.id AS prof_id,
      p.full_name AS profesional,
      p.created_at AS prof_created_at,
      d.dia,
      ps.start_time,
      ps.end_time
    FROM professionals p
    CROSS JOIN days d
    JOIN professional_schedules ps ON ps.professional_id = p.id
    WHERE p.client_id = p_client_id
      AND p.active = true
      AND p.public_profile = true
      AND ps.active = true
      AND ps.day_of_week = extract(dow from d.dia)::int
  ),
  time_slots AS (
    SELECT
      pdr.prof_id,
      pdr.profesional,
      pdr.prof_created_at,
      pdr.dia,
      pdr.dia + (slot_hour || ' hours')::interval as slot_naive
    FROM pro_day_ranges pdr
    CROSS JOIN generate_series(
      extract(hour from pdr.start_time)::int,
      extract(hour from pdr.end_time)::int - 1
    ) as slot_hour
    WHERE pdr.dia + (slot_hour || ' hours')::interval > v_now_santiago
  ),
  booked AS (
    SELECT a.datetime, a.professional_id
    FROM appointments a
    WHERE a.client_id = p_client_id
      AND a.datetime >= now()
      AND a.datetime <= now() + interval '7 days'
      AND a.status IN ('pending_payment', 'confirmed')
  ),
  available_slots AS (
    SELECT
      ts.prof_id,
      ts.profesional,
      ts.prof_created_at,
      ts.dia,
      to_char(ts.slot_naive, 'HH24:MI') AS hora,
      ts.slot_naive
    FROM time_slots ts
    WHERE NOT EXISTS (
      SELECT 1 FROM booked b
      WHERE b.professional_id = ts.prof_id
        AND b.datetime >= ts.slot_naive AT TIME ZONE 'America/Santiago'
        AND b.datetime <  (ts.slot_naive AT TIME ZONE 'America/Santiago') + interval '1 hour'
    )
  ),
  -- Aggregate hours per (professional, day) and translate day name to Spanish
  per_day AS (
    SELECT
      profesional,
      prof_created_at,
      dia,
      -- Spanish day name with date dd/mm; e.g. "Martes 05/05"
      CASE extract(dow from dia)::int
        WHEN 0 THEN 'Domingo'
        WHEN 1 THEN 'Lunes'
        WHEN 2 THEN 'Martes'
        WHEN 3 THEN 'Miércoles'
        WHEN 4 THEN 'Jueves'
        WHEN 5 THEN 'Viernes'
        WHEN 6 THEN 'Sábado'
      END || ' ' || to_char(dia, 'DD/MM') AS dia_label,
      string_agg(hora, ', ' ORDER BY slot_naive) AS horas_csv,
      MIN(slot_naive) AS first_slot
    FROM available_slots
    GROUP BY profesional, prof_created_at, dia
  ),
  -- Build one block per professional, with their days listed under
  per_pro AS (
    SELECT
      profesional,
      prof_created_at,
      string_agg(
        dia_label || ': ' || horas_csv,
        E'\n'
        ORDER BY first_slot
      ) AS dias_text
    FROM per_day
    GROUP BY profesional, prof_created_at
  )
  SELECT string_agg(
    '=== ' || profesional || ' ===' || E'\n' || dias_text,
    E'\n\n'
    ORDER BY prof_created_at
  ) INTO v_slots_text
  FROM per_pro;

  -- If no slots at all (no schedules, no professionals, etc.), use a clear
  -- placeholder so Sonnet doesn't see an empty section.
  IF v_slots_text IS NULL OR v_slots_text = '' THEN
    v_slots_text := 'Sin horarios disponibles en los próximos 7 días.';
  END IF;

  -- ── Build final result ───────────────────────────────────────────────────
  SELECT jsonb_build_object(
    'centro', (
      SELECT jsonb_build_object(
        'nombre',          c.config->'empresa'->>'nombre',
        'direccion',       c.config->'empresa'->>'direccion',
        'telefono',        c.config->'empresa'->>'telefono',
        'email',           c.config->'empresa'->>'email',
        'rut',             c.config->'empresa'->>'rut',
        'modo_empresa',    c.config->>'modo_empresa'
      )
      FROM clients c WHERE c.id = p_client_id
    ),
    'session_types', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'name',           st.name,
          'price_amount',   st.price_amount,
          'price_currency', st.price_currency
        )
        ORDER BY st.display_order NULLS LAST, st.created_at
      )
      FROM session_types st
      WHERE st.client_id = p_client_id AND st.active = true
    ), '[]'::jsonb),
    'profesionales', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'nombre',           p.full_name,
          'email',            p.email,
          'color',            p.color,
          'bio',              p.bio,
          'specialties',      to_jsonb(COALESCE(p.specialties, ARRAY[]::text[])),
          'education',        p.education,
          'years_experience', p.years_experience,
          'photo_url',        p.photo_url,
          'services_offered', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'name',           st.name,
                'price_amount',   COALESCE(pst.custom_price_amount, st.price_amount),
                'price_currency', st.price_currency
              )
              ORDER BY st.display_order NULLS LAST, st.created_at
            )
            FROM professional_session_types pst
            JOIN session_types st ON st.id = pst.session_type_id
            WHERE pst.professional_id = p.id AND pst.active = true AND st.active = true
          ), '[]'::jsonb),
          'schedule', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'day_of_week', ps.day_of_week,
                'start_time',  to_char(ps.start_time, 'HH24:MI'),
                'end_time',    to_char(ps.end_time,   'HH24:MI')
              )
              ORDER BY ps.day_of_week, ps.start_time
            )
            FROM professional_schedules ps
            WHERE ps.professional_id = p.id AND ps.active = true
          ), '[]'::jsonb)
        )
        ORDER BY p.created_at
      )
      FROM professionals p
      WHERE p.client_id = p_client_id
        AND p.active = true
        AND p.public_profile = true
    ),
    -- slots_disponibles is now a pre-formatted text string, not an array.
    'slots_disponibles', to_jsonb(v_slots_text),
    'lead', v_lead,
    'facturas_pendientes', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'monto',       i.amount,
          'descripcion', i.description,
          'fecha',       to_char(i.issued_at, 'DD/MM/YYYY')
        )
      )
      FROM invoices i
      WHERE i.client_id = p_client_id
        AND i.lead_id = (v_lead->>'id')::uuid
        AND i.status = 'pendiente'
    )
  ) INTO result;

  RETURN result;
END;
$function$;
