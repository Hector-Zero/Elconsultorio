-- 20260501T2300_update_get_bot_context.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Update get_bot_context() to expose:
--   • session_types        (NEW)      — client's service catalog
--   • profesionales        (ENHANCED) — adds bio / specialties / education /
--                                       years_experience / photo_url, plus
--                                       services_offered (with effective
--                                       price) and schedule. Filtered to
--                                       public_profile = true.
--   • centro               (kept)
--   • slots_disponibles    (kept)
--   • lead                 (kept)
--   • facturas_pendientes  (kept)
--
-- The previous get_bot_context() definition is not in this repo's migration
-- history (this is the first migration committed under supabase/migrations/).
-- For the CARRY-OVER blocks (centro / slots_disponibles / lead /
-- facturas_pendientes), the bodies below are reasonable defaults derived
-- from the application code, but they may differ from the previous live
-- function. **REVIEW these blocks against the prior definition and adjust
-- before applying to production.** Each carry-over block is fenced with a
-- ⚠ marker for easy diffing.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_bot_context(
  p_client_id uuid,
  p_chat_id   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_centro              jsonb;
  v_session_types       jsonb;
  v_profesionales       jsonb;
  v_slots_disponibles   jsonb;
  v_lead                jsonb;
  v_facturas_pendientes jsonb;
BEGIN
  ----------------------------------------------------------------------------
  -- ⚠ centro — CARRY-OVER. Pulls from clients.config.empresa (where
  -- settings.jsx writes the centro fields) plus three top-level config
  -- jsonb keys for Phase-2 policies. If the prior function read from
  -- columns instead, swap this back.
  ----------------------------------------------------------------------------
  SELECT jsonb_build_object(
    'nombre',          c.config->'empresa'->>'nombre',
    'direccion',       c.config->'empresa'->>'direccion',
    'telefono',        c.config->'empresa'->>'telefono',
    'email',           c.config->'empresa'->>'email',
    'policies',        c.config->'policies',
    'business_hours',  c.config->'business_hours',
    'payment_methods', c.config->'payment_methods'
  )
  INTO v_centro
  FROM clients c
  WHERE c.id = p_client_id;

  ----------------------------------------------------------------------------
  -- session_types — NEW. Active services for the client, ordered by the
  -- catalog's display_order (created_at as tiebreaker).
  ----------------------------------------------------------------------------
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'name',           st.name,
        'price_amount',   st.price_amount,
        'price_currency', st.price_currency
      )
      ORDER BY st.display_order NULLS LAST, st.created_at
    ),
    '[]'::jsonb
  )
  INTO v_session_types
  FROM session_types st
  WHERE st.client_id = p_client_id
    AND st.active    = true;

  ----------------------------------------------------------------------------
  -- profesionales — ENHANCED. Public-profile pros only. Each row includes
  -- the new public-profile fields plus services_offered (effective price =
  -- COALESCE(custom_price_amount, default price)) and the per-day schedule
  -- as an array of { day_of_week, start_time, end_time } where times are
  -- formatted as 'HH:MM' strings.
  ----------------------------------------------------------------------------
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'name',             p.full_name,
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
          WHERE pst.professional_id = p.id
            AND pst.active          = true
            AND st.active           = true
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
          WHERE ps.professional_id = p.id
            AND ps.active          = true
        ), '[]'::jsonb)
      )
      ORDER BY p.created_at
    ),
    '[]'::jsonb
  )
  INTO v_profesionales
  FROM professionals p
  WHERE p.client_id      = p_client_id
    AND p.active         = true
    AND p.public_profile = true;

  ----------------------------------------------------------------------------
  -- ⚠ slots_disponibles — CARRY-OVER, NOT REPRODUCIBLE FROM SOURCE.
  -- The prior get_bot_context() had a slot-suggestion computation that
  -- isn't in this repo. The empty array below keeps the migration valid
  -- but WILL break the bot's slot-suggestion behavior if applied as-is.
  -- **Paste the prior body here before applying.**
  ----------------------------------------------------------------------------
  v_slots_disponibles := '[]'::jsonb;

  ----------------------------------------------------------------------------
  -- ⚠ lead — CARRY-OVER. Reasonable default based on app-side reads of the
  -- leads table (chat_id, prospect_name, prospect_phone, conversation_context).
  -- The prior function may have joined a separate messages/history table; if
  -- so, swap the history field for that join.
  ----------------------------------------------------------------------------
  SELECT jsonb_build_object(
    'name',                 l.prospect_name,
    'phone',                l.prospect_phone,
    'conversation_context', l.conversation_context,
    'history',              COALESCE(l.history, '[]'::jsonb)
  )
  INTO v_lead
  FROM leads l
  WHERE l.client_id = p_client_id
    AND l.chat_id   = p_chat_id
  ORDER BY l.last_updated DESC NULLS LAST
  LIMIT 1;

  ----------------------------------------------------------------------------
  -- ⚠ facturas_pendientes — CARRY-OVER, NOT REPRODUCIBLE FROM SOURCE.
  -- Stubbed as empty array. **Paste the prior body before applying.**
  ----------------------------------------------------------------------------
  v_facturas_pendientes := '[]'::jsonb;

  ----------------------------------------------------------------------------
  -- assemble
  ----------------------------------------------------------------------------
  RETURN jsonb_build_object(
    'centro',              COALESCE(v_centro,        '{}'::jsonb),
    'session_types',       v_session_types,
    'profesionales',       v_profesionales,
    'slots_disponibles',   v_slots_disponibles,
    'lead',                COALESCE(v_lead,          'null'::jsonb),
    'facturas_pendientes', v_facturas_pendientes
  );
END;
$$;

COMMENT ON FUNCTION public.get_bot_context(uuid, text) IS
  'Bot context payload. Adds session_types, public-profile fields per '
  'professional, services_offered (with effective custom price), and per-pro '
  'schedules. carry-over blocks (slots_disponibles, lead, facturas_pendientes) '
  'must be reconciled with the prior function definition before applying.';
