// Edge Function: invite-professional
// ─────────────────────────────────────────────────────────────────────────────
// Admin-triggered creation + invite for a new professional at a centro.
//
// Caller: the SPA's "Agregar profesional" flow, run by an authenticated
// admin user. The admin's JWT is forwarded in the Authorization header.
//
// Two Supabase clients used internally:
//   - userClient (anon key + caller JWT): for the create_professional_at_centro
//     RPC. The RPC is SECURITY DEFINER but internally calls
//     is_admin_of_client(client_id), so auth.uid() must resolve to the
//     admin's user id. Using the caller's JWT achieves that.
//   - admin (service_role key): for the GoTrue admin email-collision
//     pre-check, the auth.admin.inviteUserByEmail call, and the rollback
//     DELETEs on invite failure.
//
// Flow:
//   1. CORS / OPTIONS / method check.
//   2. Validate body: client_id, full_name, email, color (color optional).
//   3. Email-collision pre-check: GoTrue admin endpoint
//      `GET /auth/v1/admin/users?email=...` returns { users: [...] }.
//      Non-empty → 409 collision before any DB writes.
//   4. Call create_professional_at_centro RPC via userClient. RPC validates
//      admin identity internally; on failure, surface its structured error
//      (forbidden → 403, validation → 400).
//   5. Send invite via auth.admin.inviteUserByEmail with metadata
//      { client_id, profile_id, role: 'professional', invite_pending: true,
//      full_name }. The handle_new_user trigger reads client_id +
//      profile_id and provisions public.users + links
//      professional_profiles.user_id atomically when the invitee accepts.
//   6. On invite failure: rollback by DELETE'ing employment then profile
//      (service_role bypasses RLS). Auth.users row was never created since
//      invite never sent successfully.
//
// Auth: caller must pass a user JWT in Authorization. Deploy WITHOUT
// `--no-verify-jwt` so the platform pre-validates the user JWT before
// the function runs (cheaper failure for unauthenticated callers).
//
//   `supabase functions deploy invite-professional`
//
// Environment:
//   - SUPABASE_URL (auto)
//   - SUPABASE_ANON_KEY (auto)
//   - SUPABASE_SERVICE_ROLE_KEY (auto; sb_secret_ on newer projects)
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

// Dev-only redirect URL. Hardcoded for now; rotate this when the
// production SPA URL is provisioned (gap 50/51 era).
// Supabase Auth will append #access_token=...&type=invite to this
// URL when the magic link is clicked. The SPA's onAuthStateChange
// picks up the resulting session and reads invite_pending metadata
// to gate the claim modal at first login.
const INVITE_REDIRECT_URL = 'http://localhost:5173/'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ success: false, error: 'method_not_allowed' }, 405)
  }

  // ── Auth ────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse({ success: false, error: 'unauthorized' }, 401)
  }
  const userToken = authHeader.slice('Bearer '.length)

  // ── Parse + validate body ───────────────────────────────────────────────
  let body: any
  try {
    body = await req.json()
  } catch {
    return fail('Invalid JSON body')
  }
  if (!body || typeof body !== 'object') {
    return fail('Body must be a JSON object')
  }

  const { client_id, full_name, email, color } = body

  if (!client_id || typeof client_id !== 'string') {
    return fail('client_id required')
  }
  if (!full_name || typeof full_name !== 'string' || !full_name.trim()) {
    return fail('full_name required')
  }
  if (
    !email ||
    typeof email !== 'string' ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return fail('valid email required')
  }
  // color is optional; the RPC has its own COALESCE → '#2f4a3a' default.
  const colorClean = typeof color === 'string' ? color.trim() : ''

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey    = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${userToken}` } },
  })

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const emailNorm = email.trim().toLowerCase()

  // ── 1. Email collision pre-check ────────────────────────────────────────
  // The GoTrue admin REST email filter (`?email=...`) is not honored on
  // this project's version — it returns all users regardless of filter.
  // We use a SECURITY DEFINER helper `email_exists_in_auth(p_email)`
  // instead, which queries auth.users directly and returns boolean.
  console.log('[invite-professional] collision pre-check', { email: emailNorm })
  const { data: emailExists, error: collisionErr } = await admin.rpc(
    'email_exists_in_auth',
    { p_email: emailNorm }
  )
  if (collisionErr) {
    console.error('[invite-professional] collision check rpc error', collisionErr)
    return jsonResponse(
      { success: false, error: 'admin_api_error', message: collisionErr.message },
      500
    )
  }
  if (emailExists) {
    console.warn('[invite-professional] email collision', { email: emailNorm })
    return jsonResponse(
      { success: false, error: 'email_collision', message: 'Ya existe un usuario con ese email' },
      409
    )
  }

  // ── 2. Create profile + employment (RPC, via caller's JWT) ──────────────
  // The RPC is SECURITY DEFINER but internally calls
  // is_admin_of_client(p_client_id), which reads auth.uid(). Using
  // userClient (caller's JWT) makes auth.uid() resolve to the admin.
  console.log('[invite-professional] calling create_professional_at_centro', {
    client_id, full_name: full_name.trim(),
  })
  const { data: rpcResult, error: rpcErr } = await userClient.rpc(
    'create_professional_at_centro',
    {
      p_client_id: client_id,
      p_full_name: full_name.trim(),
      p_email:     emailNorm,
      p_color:     colorClean,
    }
  )
  if (rpcErr) {
    console.error('[invite-professional] rpc transport error', rpcErr)
    return jsonResponse(
      { success: false, error: 'rpc_error', message: rpcErr.message },
      500
    )
  }
  if (!rpcResult?.success) {
    // The RPC returns its own structured {success:false, error, message}.
    // Map common errors to HTTP status: forbidden → 403, validation → 400.
    const status = rpcResult?.error === 'forbidden' ? 403 : 400
    console.warn('[invite-professional] rpc returned failure', { status, rpcResult })
    return jsonResponse(rpcResult, status)
  }
  const profileId    = rpcResult.profile_id
  const employmentId = rpcResult.employment_id

  // ── 3. Send invite via Supabase Auth admin API ──────────────────────────
  // Metadata is read by the handle_new_user trigger on auth.users INSERT:
  //   - client_id  → public.users tenancy mapping row
  //   - profile_id → professional_profiles.user_id linkage (the claim)
  //   - role       → 'professional' so handle_new_user inserts public.users
  //                  with role='professional' instead of the default 'owner'.
  //   - invite_pending → SPA reads via session.user.user_metadata to gate
  //                       the claim modal at first login.
  //   - full_name  → display fallback in the claim modal before the SPA
  //                  joins through to professional_profiles.
  console.log('[invite-professional] sending invite', { email: emailNorm, profileId })
  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
    emailNorm,
    {
      data: {
        client_id,
        profile_id:     profileId,
        role:           'professional',
        invite_pending: true,
        full_name:      full_name.trim(),
      },
      redirectTo: INVITE_REDIRECT_URL,
    }
  )
  if (inviteErr) {
    // ── 3a. Rollback ──────────────────────────────────────────────────────
    // Invite failed (rate limit, SMTP outage, etc.). The pre-check already
    // ruled out email collision, so this is a transient or config error.
    // DELETE the employment + profile so a retry doesn't compound — the
    // admin will see the error and try again, which would otherwise hit
    // a UNIQUE(profile_id, client_id) violation on the second RPC call.
    console.error('[invite-professional] invite failed, rolling back', inviteErr)
    const { error: empDelErr } = await admin
      .from('professional_employments')
      .delete()
      .eq('id', employmentId)
    if (empDelErr) {
      console.error('[invite-professional] rollback employment delete failed', empDelErr)
    }
    const { error: profDelErr } = await admin
      .from('professional_profiles')
      .delete()
      .eq('id', profileId)
    if (profDelErr) {
      console.error('[invite-professional] rollback profile delete failed', profDelErr)
    }
    return jsonResponse(
      {
        success: false,
        error:   'invite_failed',
        message: inviteErr.message,
      },
      500
    )
  }

  console.log('[invite-professional] success', { profileId, employmentId })
  return jsonResponse(
    {
      success:       true,
      profile_id:    profileId,
      employment_id: employmentId,
    },
    200
  )
})
