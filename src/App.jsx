import React, { useState, useEffect, useContext, useCallback, Component } from 'react'
import { supabase } from './lib/supabase.js'
import { ClientCtx } from './lib/ClientCtx.js'
import { useClientBootstrap } from './lib/useClientBootstrap.js'
import { useClientConfig } from './lib/useClientConfig.js'
import { ClientConfigCtx } from './lib/ClientConfigCtx.js'
import { DirtyGuardProvider, DirtyGuardCtx } from './lib/DirtyGuardContext.jsx'
import { flattenEmployment } from './lib/flattenEmployment.js'
import { resolveActiveThemeId } from './lib/resolveActiveThemeId.js'
import { T, applyTheme, AssistantFAB } from './screens/shared.jsx'
import { getTheme } from './config/themes.js'
import Login from './Login.jsx'
import ClaimModal from './ClaimModal.jsx'
import LeadsScreen         from './screens/leads.jsx'
import AgendaScreen        from './screens/agenda.jsx'
import PatientsScreen      from './screens/patients.jsx'
import ProfessionalsScreen from './screens/professionals.jsx'
import FilesScreen         from './screens/files.jsx'
import BillingScreen       from './screens/billing.jsx'
import SettingsScreen      from './screens/settings.jsx'

class ErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(e) { return { error: e } }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div style={{ padding: 40, fontFamily: 'monospace', background: '#faf8f4', minHeight: '100vh' }}>
        <div style={{ color: '#9a4a3f', fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
          ⚠ Render error — {error.message}
        </div>
        <pre style={{ fontSize: 11, color: '#4a524c', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
          {error.stack}
        </pre>
      </div>
    )
  }
}

const SCREENS = {
  leads:         LeadsScreen,
  calendar:      AgendaScreen,
  patients:      PatientsScreen,
  professionals: ProfessionalsScreen,
  files:         FilesScreen,
  billing:       BillingScreen,
  settings:      SettingsScreen,
}

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || 'leads')
  useEffect(() => {
    const fn = () => setHash(window.location.hash.slice(1) || 'leads')
    window.addEventListener('hashchange', fn)
    return () => window.removeEventListener('hashchange', fn)
  }, [])
  return [hash, (id) => { window.location.hash = id }]
}

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = still loading
  const bootstrap = useClientBootstrap()
  const configFetch = useClientConfig({ session, clientId: bootstrap.clientId })
  const [hash, navigate] = useHash()
  const [themeVersion, setThemeVersion] = useState(0)
  const [professional, setProfessional] = useState(undefined) // undefined = loading, null = admin mode
  const [firstPro, setFirstPro] = useState(null)
  const [proRefresh, setProRefresh] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user?.id || !bootstrap.clientId) { setProfessional(null); return }
    setProfessional(undefined)
    supabase
      .from('professional_employments')
      .select(`
        id, client_id, color, email, active, public_profile,
        professional_profiles!inner(id, user_id, full_name, photo_url, theme_id)
      `)
      .eq('client_id', bootstrap.clientId)
      .eq('active', true)
      .eq('professional_profiles.user_id', session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) console.warn('[App] employment lookup failed', error)
        setProfessional(flattenEmployment(data))
      })
  }, [session?.user?.id, bootstrap.clientId])

  useEffect(() => {
    const activeThemeId = resolveActiveThemeId({
      proThemeId:    professional?.theme_id,
      centroThemeId: bootstrap.themeId,
      isPro:         !!professional,
    })
    applyTheme(getTheme(activeThemeId))
    setThemeVersion(v => v + 1)
  }, [bootstrap.themeId, professional])

  // ONBOARDING STEP 1: Profile must be completed before the app is fully functional.
  // The bot system prompt, email notifications, certificates, and agenda all depend
  // on the professional's name, email, and other details being set.
  useEffect(() => {
    if (!bootstrap.clientId) { setFirstPro(null); return }
    supabase
      .from('professional_employments')
      .select(`
        id,
        professional_profiles!inner(full_name)
      `)
      .eq('client_id', bootstrap.clientId)
      .eq('active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        setFirstPro(data ? { full_name: data.professional_profiles?.full_name ?? null } : null)
      })
  }, [bootstrap.clientId, proRefresh])

  if (session === undefined || bootstrap.loading || (session && professional === undefined)) {
    return (
      <div style={{ height: '100vh', display: 'grid', placeItems: 'center', background: T.bgSunk }}>
        <div style={{ fontFamily: T.serif, fontSize: 22, color: T.inkMuted, fontStyle: 'italic' }}>cargando…</div>
      </div>
    )
  }

  if (!session) return <Login />

  // Pro claim flow: if user has invite_pending metadata, force them
  // through the password-set modal before they can use the SPA.
  if (session?.user?.user_metadata?.invite_pending === true) {
    return <ClaimModal session={session} />
  }

  const isPro = !!professional

  // Pro mode: screen-render permission. Wider than Sidebar's proAllowed list
  // because 'files' is a URL-only screen (no nav entry) reached via "Ver
  // ficha" buttons in patient and quickPanel UIs. Billing intentionally
  // excluded — billing/cobrar is admin/receptionist territory.
  const allowed = isPro
    ? ['calendar', 'patients', 'settings', 'files']
    : Object.keys(SCREENS)
  const [base, param] = hash.split('/')
  const safeBase = allowed.includes(base) ? base : (isPro ? 'calendar' : 'leads')
  const Screen = SCREENS[safeBase] ?? (isPro ? AgendaScreen : LeadsScreen)

  return (
    <ErrorBoundary>
      <ClientCtx.Provider value={{
        clientId: bootstrap.clientId,
        session,
        professional,
        firstPro,
        // Empresa mode: complete once empresa.nombre is filled (professionals can be added later).
        // Single mode:  complete only when a professional row with non-empty full_name exists.
        profileIncomplete: bootstrap.modoEmpresa
          ? !(bootstrap.empresaNombre?.trim())
          : (!firstPro || !(firstPro.full_name?.trim())),
        refreshFirstPro: () => setProRefresh(v => v + 1),
      }}>
        <ClientConfigCtx.Provider value={{
          config:    configFetch.config,
          setConfig: configFetch.setConfig,
          loading:   configFetch.loading,
          error:     configFetch.error,
        }}>
          <DirtyGuardProvider>
            <GuardedShell
              themeVersion={themeVersion}
              Screen={Screen}
              param={param}
              rawNavigate={navigate}
            />
          </DirtyGuardProvider>
        </ClientConfigCtx.Provider>
      </ClientCtx.Provider>
    </ErrorBoundary>
  )
}

// Inner shell so the wrapped navigate can consume DirtyGuardCtx. Any
// navigation request runs through guard.confirm: if a registered form
// is dirty, the central confirm modal intercepts; otherwise the hash
// is updated immediately.
function GuardedShell({ themeVersion, Screen, param, rawNavigate }) {
  const guard = useContext(DirtyGuardCtx)
  const navigate = useCallback((id) => {
    guard.confirm(() => rawNavigate(id))
  }, [guard, rawNavigate])
  return (
    <div key={themeVersion} style={{ height: '100vh', display: 'flex', overflow: 'hidden' }}>
      <Screen onNavigate={navigate} param={param} />
      <AssistantFAB />
    </div>
  )
}
