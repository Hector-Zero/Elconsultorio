import { useState, useEffect } from 'react'
import { supabase } from './supabase.js'

function resolveSlug() {
  const host = window.location.hostname
  const isProd = host.endsWith('.elconsultorio.cl')
  if (!isProd) {
    return import.meta.env.VITE_DEV_CLIENT_SLUG ?? 'consultorio'
  }
  return host.split('.')[0]
}

// Returns { clientId, slug, name, themeId, modoEmpresa, empresaNombre,
//          brandName, avatarUrl, modules, loading, error }
//
// Calls public.get_public_centro_info(slug) — the safe-public subset of
// the clients row. Works for both anon (pre-login) and authenticated callers.
// Source of truth for display-layer keys regardless of session state.
export function useClientBootstrap() {
  const [state, setState] = useState({
    clientId: null, slug: null, name: null,
    themeId: null, modoEmpresa: null, empresaNombre: null,
    brandName: null, avatarUrl: null, modules: null,
    loading: true, error: null,
  })

  useEffect(() => {
    const slug = resolveSlug()
    supabase
      .rpc('get_public_centro_info', { p_slug: slug })
      .single()
      .then(({ data, error }) => {
        if (error) {
          setState(s => ({ ...s, loading: false, error }))
          return
        }
        setState({
          clientId:      data.id,
          slug:          data.slug,
          name:          data.name,
          themeId:       data.theme_id,
          modoEmpresa:   data.modo_empresa,
          empresaNombre: data.empresa_nombre,
          brandName:     data.brand_name,
          avatarUrl:     data.avatar_url,
          modules:       data.modules,
          loading:       false,
          error:         null,
        })
      })
  }, [])

  return state
}
