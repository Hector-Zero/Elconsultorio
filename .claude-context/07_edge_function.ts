// Edge Function: create-booking
// ─────────────────────────────────────────────────────────────────────────────
// Atomic bot-driven appointment creation. The Telegram bot (via Make.com)
// POSTs here once the user has agreed to a slot and provided patient details.
// All DB work — slot lock, patient upsert, assignment, appointment insert,
// lead update — runs inside a single Postgres transaction via the
// `create_booking_atomic` RPC defined in
// supabase/migrations/20260502T1000_create_booking_atomic.sql.
//
// Auth: bearer must equal the project secret API key (sb_secret_...) which
// is auto-populated into SUPABASE_SERVICE_ROLE_KEY for the Edge Function.
// Make.com sets `Authorization: Bearer <key>`. Deploy with
//   `supabase functions deploy create-booking --no-verify-jwt`
// so the platform doesn't pre-validate as user JWT.
//
// Name-fallback resolution: callers may provide either an ID or a name for
// professional and session_type. If only a name is given, this function
// looks it up scoped to client_id (active=true) using a case-insensitive
// substring match — so "individual" matches "Consulta individual", "pareja"
// matches "Consulta de pareja", etc. Ambiguous matches (2+) surface as a
// 400 so the caller can re-ask.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

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

// ─────────────────────────────────────────────────────────────────────────────
// Name-fallback resolvers — substring (fuzzy) matching
// ─────────────────────────────────────────────────────────────────────────────
// Returns { id } on unique substring match, { error } on miss/ambiguity.
// `ilike` with %wildcards% = case-insensitive substring match. So "individual"
// matches "Consulta individual" but resolves only when exactly one row matches.

type ResolveResult = { id: string } | { error: string }

async function resolveProfessional(
  admin: SupabaseClient,
  client_id: string,
  name: string,
): Promise<ResolveResult> {
  const trimmed = name.trim()
  if (!trimmed) return { error: 'professional_name is empty' }

  // Escape SQL LIKE wildcards (\, %, _) in the user-supplied name so they
  // don't act as pattern characters. Then wrap with %...% for substring match.
  const escaped = trimmed.replace(/[\\%_]/g, (c) => `\\${c}`)
  const pattern = `%${escaped}%`

  const { data, error } = await admin
    .from('professionals')
    .select('id, full_name')
    .eq('client_id', client_id)
    .eq('active', true)
    .ilike('full_name', pattern)
    .limit(2)

  if (error) return { error: `professional lookup failed: ${error.message}` }
  if (!data || data.length === 0) {
    return { error: `no professional matches "${trimmed}"` }
  }
  if (data.length > 1) {
    return { error: `multiple professionals match "${trimmed}"` }
  }
  return { id: data[0].id }
}

async function resolveSessionType(
  admin: SupabaseClient,
  client_id: string,
  name: string,
): Promise<ResolveResult> {
  const trimmed = name.trim()
  if (!trimmed) return { error: 'session_type_name is empty' }

  const escaped = trimmed.replace(/[\\%_]/g, (c) => `\\${c}`)
  const pattern = `%${escaped}%`

  const { data, error } = await admin
    .from('session_types')
    .select('id, name')
    .eq('client_id', client_id)
    .eq('active', true)
    .ilike('name', pattern)
    .limit(2)

  if (error) return { error: `session_type lookup failed: ${error.message}` }
  if (!data || data.length === 0) {
    return { error: `no session_type matches "${trimmed}"` }
  }
  if (data.length > 1) {
    return { error: `multiple session_types match "${trimmed}"` }
  }
  return { id: data[0].id }
}

// ─────────────────────────────────────────────────────────────────────────────

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
    professional_name,
    datetime,
    session_type_id,
    session_type_name,
    duration_minutes,
    type,
    patient_data,
  } = body

  if (!client_id || typeof client_id !== 'string') return fail('client_id required')
  if (!chat_id   || typeof chat_id   !== 'string') return fail('chat_id required')

  // Either professional_id or professional_name must be present.
  const hasProId   = typeof professional_id   === 'string' && professional_id.length   > 0
  const hasProName = typeof professional_name === 'string' && professional_name.length > 0
  if (!hasProId && !hasProName) {
    return fail('professional_id or professional_name required')
  }

  if (!datetime || typeof datetime !== 'string') return fail('datetime required')
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

  // ── Resolve names → IDs if needed ───────────────────────────────────────
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let resolvedProId: string
  if (hasProId) {
    resolvedProId = professional_id
    console.log('[create-booking] professional_id provided directly')
  } else {
    const result = await resolveProfessional(admin, client_id, professional_name)
    if ('error' in result) {
      console.warn('[create-booking] professional resolution failed', result.error)
      return fail(result.error)
    }
    resolvedProId = result.id
    console.log('[create-booking] resolved professional_name to id', {
      name: professional_name, id: resolvedProId,
    })
  }

  let resolvedSessionId: string | null = null
  const hasSessionId   = typeof session_type_id   === 'string' && session_type_id.length   > 0
  const hasSessionName = typeof session_type_name === 'string' && session_type_name.length > 0
  if (hasSessionId) {
    resolvedSessionId = session_type_id
  } else if (hasSessionName) {
    const result = await resolveSessionType(admin, client_id, session_type_name)
    if ('error' in result) {
      console.warn('[create-booking] session_type resolution failed', result.error)
      return fail(result.error)
    }
    resolvedSessionId = result.id
    console.log('[create-booking] resolved session_type_name to id', {
      name: session_type_name, id: resolvedSessionId,
    })
  }
  // session_type_id stays null if neither id nor name was given (RPC accepts null).

  // ── Call RPC ────────────────────────────────────────────────────────────
  console.log('[create-booking] calling create_booking_atomic', {
    client_id, professional_id: resolvedProId, datetime, chat_id,
  })

  const { data, error } = await admin.rpc('create_booking_atomic', {
    p_client_id:       client_id,
    p_professional_id: resolvedProId,
    p_datetime:        datetime,            // pass through; Postgres parses with offset
    p_session_type_id: resolvedSessionId,
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