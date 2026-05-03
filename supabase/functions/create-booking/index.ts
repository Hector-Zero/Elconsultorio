// Edge Function: create-booking
// ─────────────────────────────────────────────────────────────────────────────
// Atomic bot-driven appointment creation. The Telegram bot (via Make.com)
// POSTs here once the user has agreed to a slot and provided patient details.
// All DB work — slot lock, patient upsert, assignment, appointment insert,
// lead update — runs inside a single Postgres transaction via the
// `create_booking_atomic` RPC defined in
// supabase/migrations/20260502T1000_create_booking_atomic.sql.
//
// Auth: bearer must equal the project service role key. Make.com sets
// `Authorization: Bearer <SERVICE_ROLE_KEY>`. Deploy with
//   `supabase functions deploy create-booking --no-verify-jwt`
// so the platform doesn't pre-validate as user JWT.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
function fail(message: string, status = 400) {
  return jsonResponse({ success: false, error: 'validation', message }, status)
}

// Map RPC's structured `error` keys to HTTP status codes.
const STATUS_BY_ERR: Record<string, number> = {
  validation:  400,
  slot_taken:  409,
  slot_locked: 409,
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'method_not_allowed' }, 405)
  }

  // ── Auth ────────────────────────────────────────────────────────────────
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return jsonResponse({ success: false, error: 'unauthorized' }, 401)
  }

  // ── Parse + validate body ───────────────────────────────────────────────
  let body: any
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON body')
  }
  if (!body || typeof body !== 'object') return fail('Body must be a JSON object')

  const {
    client_id,
    chat_id,
    professional_id,
    datetime,
    session_type_id,
    duration_minutes,
    type,
    patient_data,
  } = body

  if (!client_id       || typeof client_id       !== 'string') return fail('client_id required')
  if (!chat_id         || typeof chat_id         !== 'string') return fail('chat_id required')
  if (!professional_id || typeof professional_id !== 'string') return fail('professional_id required')
  if (!datetime        || typeof datetime        !== 'string') return fail('datetime required')
  if (typeof duration_minutes !== 'number' || duration_minutes <= 0) {
    return fail('duration_minutes required (positive number)')
  }
  if (!patient_data || typeof patient_data !== 'object') {
    return fail('patient_data required (object)')
  }
  if (!patient_data.full_name || typeof patient_data.full_name !== 'string' || !patient_data.full_name.trim()) {
    return fail('patient_data.full_name required')
  }

  // datetime must parse cleanly. The RPC re-parses as timestamptz, so we
  // pass the user-supplied string through as-is — but reject obviously
  // bad input here so we surface a 400 instead of a 500 from Postgres.
  const parsed = new Date(datetime)
  if (Number.isNaN(parsed.getTime())) {
    return fail('datetime must be a valid ISO 8601 string with offset')
  }

  // ── Call RPC ────────────────────────────────────────────────────────────
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  console.log('[create-booking] calling create_booking_atomic', {
    client_id, professional_id, datetime, chat_id,
  })

  const { data, error } = await admin.rpc('create_booking_atomic', {
    p_client_id:       client_id,
    p_professional_id: professional_id,
    p_datetime:        datetime,            // pass through; Postgres parses with offset
    p_session_type_id: session_type_id ?? null,
    p_duration:        duration_minutes,
    p_type:            type ?? 'presencial',
    p_chat_id:         chat_id,
    p_patient_data:    patient_data,
  })

  if (error) {
    // Postgres- or PostgREST-level failure (function not found, syntax error,
    // permissions). Distinct from the RPC's own structured failures below.
    console.error('[create-booking] rpc error', error)
    return jsonResponse(
      { success: false, error: 'rpc_error', message: error.message },
      500
    )
  }

  // The RPC returns its own jsonb {success, error?, message?, ...}.
  if (!data || data.success !== true) {
    const status = STATUS_BY_ERR[data?.error ?? ''] ?? 500
    console.warn('[create-booking] rpc returned failure', { status, data })
    return jsonResponse(data ?? { success: false, error: 'unknown' }, status)
  }

  console.log('[create-booking] success', {
    appointment_id: data.appointment_id,
    patient_id:     data.patient_id,
  })
  return jsonResponse(data, 200)
})
