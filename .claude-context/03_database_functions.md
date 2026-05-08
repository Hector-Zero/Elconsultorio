# Database Functions (RPCs)

> Auto-generated. Run `./scripts/update-context.sh functions` to refresh.
> Last updated: 2026-05-04 16:12:37 -04
> Manual update 2026-05-07: get_public_centro_info added by hand
> (script auth blocked per gap 36; next successful regen will
> overwrite formatting but preserve the function set).

## create_booking_atomic

```sql
CREATE OR REPLACE FUNCTION public.create_booking_atomic(p_client_id uuid, p_professional_id uuid, p_datetime timestamp with time zone, p_session_type_id uuid, p_duration integer, p_type text, p_chat_id text, p_patient_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
  -- Validation
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

  -- Resolve lead linked to this chat_id (used by idempotency + step E)
  IF p_chat_id IS NOT NULL AND p_chat_id <> '' THEN
    SELECT id INTO v_lead_id
      FROM leads
     WHERE client_id = p_client_id
       AND chat_id   = p_chat_id
     LIMIT 1;
  END IF;

  -- Idempotency: same chat + same slot already booked = same booking
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

  -- STEP A: advisory lock + slot check
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

  -- STEP B: upsert patient (RUT first, then email; both scoped to client_id)
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

  -- STEP C: ensure patient_assignments row
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

  -- STEP D: insert appointment
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

  -- STEP E: mark lead as qualified
  IF v_lead_id IS NOT NULL THEN
    UPDATE leads
       SET phase          = 'qualified',
           qualified_lead = true,
           last_updated   = now()
     WHERE id = v_lead_id;
  END IF;

  -- Response
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
$function$

```

## get_bot_context

```sql
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
  v_profesionales_text text;
  v_session_types_text text;
BEGIN
  v_now_santiago := now() AT TIME ZONE 'America/Santiago';

  SELECT row_to_json(l)::jsonb INTO v_lead
  FROM leads l
  WHERE client_id = p_client_id AND chat_id = p_chat_id
  LIMIT 1;

  -- ── Build session_types_text as compact Spanish text ─────────────────────
  SELECT string_agg(
    '- ' || st.name || ': $' || to_char(st.price_amount, 'FM999G999G999') || ' ' || st.price_currency,
    E'\n'
    ORDER BY st.display_order NULLS LAST, st.created_at
  ) INTO v_session_types_text
  FROM session_types st
  WHERE st.client_id = p_client_id AND st.active = true;

  IF v_session_types_text IS NULL OR v_session_types_text = '' THEN
    v_session_types_text := 'Sin servicios configurados.';
  END IF;

  -- ── Build profesionales_text as compact Spanish text ─────────────────────
  -- Only name + services + price. NO specialties, bio, education, photo.
  -- (Those belong on the public profile page.)
  WITH pro_services AS (
    SELECT
      p.id AS prof_id,
      p.full_name AS profesional,
      p.created_at AS prof_created_at,
      string_agg(
        '  - ' || st.name || ': $' || to_char(COALESCE(pst.custom_price_amount, st.price_amount), 'FM999G999G999') || ' ' || st.price_currency,
        E'\n'
        ORDER BY st.display_order NULLS LAST, st.created_at
      ) AS services_text
    FROM professionals p
    LEFT JOIN professional_session_types pst
      ON pst.professional_id = p.id AND pst.active = true
    LEFT JOIN session_types st
      ON st.id = pst.session_type_id AND st.active = true
    WHERE p.client_id = p_client_id
      AND p.active = true
      AND p.public_profile = true
    GROUP BY p.id, p.full_name, p.created_at
  )
  SELECT string_agg(
    '=== ' || profesional || ' ===' || E'\n' ||
    'Servicios:' || E'\n' ||
    COALESCE(services_text, '  (sin servicios configurados)'),
    E'\n\n'
    ORDER BY prof_created_at
  ) INTO v_profesionales_text
  FROM pro_services;

  IF v_profesionales_text IS NULL OR v_profesionales_text = '' THEN
    v_profesionales_text := 'Sin profesionales activos.';
  END IF;

  -- ── Build slots_disponibles as formatted Spanish text ────────────────────
  -- (unchanged)
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
  per_day AS (
    SELECT
      profesional,
      prof_created_at,
      dia,
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
    'session_types_text', to_jsonb(v_session_types_text),
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
    'profesionales_text', to_jsonb(v_profesionales_text),
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
$function$

```

## get_public_centro_info

```sql
CREATE OR REPLACE FUNCTION public.get_public_centro_info(p_slug text)
 RETURNS TABLE(id uuid, slug text, name text, theme_id text, modo_empresa text, empresa_nombre text, brand_name text, avatar_url text, modules jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT
    c.id,
    c.slug,
    c.name,
    c.config ->> 'theme_id'                  AS theme_id,
    c.config ->> 'modo_empresa'              AS modo_empresa,
    c.config -> 'empresa' ->> 'nombre'       AS empresa_nombre,
    c.config ->> 'brand_name'                AS brand_name,
    c.config ->> 'avatar_url'                AS avatar_url,
    c.config -> 'modules'                    AS modules
  FROM public.clients c
  WHERE c.slug = p_slug
    AND c.active = true
  LIMIT 1
$function$
```

Resolves a centro slug to its safe-public display subset for the SPA
bootstrap path (anon callers and pro-mode authenticated users that the
admin-only `clients_admin_read_own` policy doesn't cover). SECURITY
DEFINER bypasses RLS to expose the whitelisted columns regardless of
caller role; EXECUTE granted to `anon` and `authenticated`.

Defined in
[20260507120000_clients_professionals_auth_hardening_additive.sql](../supabase/migrations/20260507120000_clients_professionals_auth_hardening_additive.sql)
with the corrected return shape applied via
[20260507120100_correct_clients_professionals_hardening.sql](../supabase/migrations/20260507120100_correct_clients_professionals_hardening.sql)
(initial whitelist was narrower; brand_name, avatar_url, and modules
added in the correction so pro-mode sidebars render correctly).

Whitelist deliberately excludes `config.features` (gap 46 superadmin
toggles), `config.empresa.{rut, email, telefono, direccion, logo_url}`,
`config.profile_*`, `config.whatsapp_*`, `config.resend_from`, and
other operational keys. The full clients row is reachable only via
`clients_admin_read_own` for admins or `clients_super_admin_all` for
super-admins. See `.claude-context/10_auth_model.md` section 3.7 and
section 5.1 for the SPA-side data flow.

## handle_new_user

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  -- only insert if client_id is provided in metadata
  if (new.raw_user_meta_data->>'client_id') is not null then
    insert into public.users (id, client_id, email, role)
    values (
      new.id,
      (new.raw_user_meta_data->>'client_id')::uuid,
      new.email,
      coalesce(new.raw_user_meta_data->>'role', 'owner')
    );
  end if;
  return new;
end;
$function$

```

## is_admin_of_client

```sql
CREATE OR REPLACE FUNCTION public.is_admin_of_client(p_client_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists(
    select 1 from public.users 
    where id = auth.uid() 
      and client_id = p_client_id 
      and role = 'admin'
      and active = true
  )
$function$

```

## is_super_admin

```sql
CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists(
    select 1 from public.super_admins where user_id = auth.uid()
  )
$function$

```

## my_client_id

```sql
CREATE OR REPLACE FUNCTION public.my_client_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select client_id from public.users where id = auth.uid()
$function$

```

## my_professional_id

```sql
CREATE OR REPLACE FUNCTION public.my_professional_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id from public.professionals
  where user_id = auth.uid() and active = true
  limit 1
$function$

```

## set_updated_at

```sql
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$

```
