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
  if (getErr) return { error: getErr, config: null }

  const fresh = row?.config ?? {}
  const next  = typeof patch === 'function' ? patch(fresh) : { ...fresh, ...patch }

  const { error: updErr } = await supabase
    .from('clients')
    .update({ config: next })
    .eq('id', clientId)
  if (updErr) return { error: updErr, config: null }

  return { error: null, config: next }
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
