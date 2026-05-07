import { useState, useEffect } from 'react'
import { supabase } from './supabase.js'

// Returns { config, setConfig, loading, error }
//
// Post-login fetch of the full clients row. Returns the centro's full
// config jsonb, including sensitive keys (empresa contact info, feature
// toggles, integration settings) — appropriate because the caller is
// authenticated and the new clients_admin_read_own policy scopes to the
// caller's own centro.
//
// Pre-login (no session) or for non-admin authenticated users (e.g., pros)
// the underlying fetch returns no row; this hook reports config = null.
// Pro-mode UIs should consume display-layer fields from useClientBootstrap
// instead.
export function useClientConfig({ session, clientId } = {}) {
  const [state, setState] = useState({
    config: null, loading: false, error: null,
  })

  useEffect(() => {
    if (!session?.user?.id || !clientId) {
      setState({ config: null, loading: false, error: null })
      return
    }
    setState(s => ({ ...s, loading: true }))
    supabase
      .from('clients')
      .select('config')
      .eq('id', clientId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          setState({ config: null, loading: false, error })
          return
        }
        setState({ config: data?.config ?? null, loading: false, error: null })
      })
  }, [session?.user?.id, clientId])

  const setConfig = (next) =>
    setState(s => ({
      ...s,
      config: typeof next === 'function' ? next(s.config) : next,
    }))

  return { ...state, setConfig }
}
