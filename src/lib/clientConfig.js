import { supabase } from './supabase'

/**
 * Read-modify-write merge of clients.config.
 * Re-fetches the freshest config before applying the patch so saves from
 * different tabs/sections never clobber each other.
 *
 * @param {string} clientId
 * @param {object | (fresh:object) => object} patch
 *   Either a flat object to spread onto the fresh config, or a function that
 *   receives the fresh config and returns the next config (for nested merges
 *   like { empresa: { ...fresh.empresa, ...changes } }).
 * @returns {{ error: any, config: object | null }}
 */
export async function mergeClientConfig(clientId, patch) {
  if (!clientId) return { error: new Error('clientId required'), config: null }

  const { data: row, error: getErr } = await supabase
    .from('clients')
    .select('config')
    .eq('id', clientId)
    .single()
  console.log('[mergeClientConfig] READ response', { clientId, getErr, fresh_config: row?.config })
  if (getErr) return { error: getErr, config: null }

  const fresh = row?.config ?? {}
  const next  = typeof patch === 'function' ? patch(fresh) : { ...fresh, ...patch }

  // .select() forces PostgREST to return the affected rows — when RLS silently
  // blocks the UPDATE, error is null but data is an empty array. That's the
  // smoking gun we need to detect (the previous code just discarded `data`).
  const updateRes = await supabase
    .from('clients')
    .update({ config: next })
    .eq('id', clientId)
    .select()
  console.log('[mergeClientConfig] UPDATE raw response', {
    error:        updateRes.error,
    status:       updateRes.status,
    statusText:   updateRes.statusText,
    rows_affected: updateRes.data?.length ?? 0,
    returned_config: updateRes.data?.[0]?.config,
  })
  if (updateRes.error) return { error: updateRes.error, config: null }
  if (!updateRes.data || updateRes.data.length === 0) {
    // Zero rows affected with no error → RLS denied the write silently.
    return {
      error: new Error('UPDATE affected 0 rows — likely an RLS policy blocking the write for this role. Check the clients table UPDATE policy in Supabase.'),
      config: null,
    }
  }

  // Trust the row Postgres returned — it reflects what's actually persisted
  // (including any triggers/defaults applied on the server side).
  return { error: null, config: updateRes.data[0].config ?? next }
}

/**
 * Fetches the latest clients.config for a clientId. Use inside settings tabs
 * to ensure local state reflects DB truth, independently of any cached context.
 */
export async function fetchClientConfig(clientId) {
  if (!clientId) return { error: new Error('clientId required'), config: null }
  const { data, error } = await supabase
    .from('clients')
    .select('config')
    .eq('id', clientId)
    .single()
  return { error, config: data?.config ?? {} }
}
