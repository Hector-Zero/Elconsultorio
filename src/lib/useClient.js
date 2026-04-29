import { useState, useEffect } from 'react'
import { supabase } from './supabase'

function resolveSlug() {
  const host = window.location.hostname
  // Use dev slug for localhost, ngrok, and any non-production host
  const isProd = host.endsWith('.elconsultorio.cl')
  if (!isProd) {
    return import.meta.env.VITE_DEV_CLIENT_SLUG ?? 'consultorio'
  }
  // production: cliente.elconsultorio.cl → "cliente"
  return host.split('.')[0]
}

// Returns { clientId, config, loading, error, setConfig }
export function useClient() {
  const [state, setState] = useState({ clientId: null, config: null, loading: true, error: null })

  useEffect(() => {
    const slug = resolveSlug()

    supabase
      .from('clients')
      .select('id, config')
      .eq('slug', slug)
      .single()
      .then(({ data, error }) => {
        if (error) {
          setState({ clientId: null, config: null, loading: false, error })
          return
        }
        setState({ clientId: data.id, config: data.config, loading: false, error: null })
      })
  }, [])

  const setConfig = (next) => setState(s => ({ ...s, config: typeof next === 'function' ? next(s.config) : next }))
  return { ...state, setConfig }
}
