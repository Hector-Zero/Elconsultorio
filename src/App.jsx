import React, { useState, useEffect, Component } from 'react'
import { supabase } from './lib/supabase.js'
import { useClient } from './lib/useClient.js'
import { ClientCtx } from './lib/ClientCtx.js'
import { T, applyTheme, AssistantFAB } from './screens/shared.jsx'
import { getTheme } from './config/themes.js'
import Login from './Login.jsx'
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
  const { clientId, config, loading: clientLoading, setConfig } = useClient()
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
    if (!session?.user?.id || !clientId) { setProfessional(null); return }
    setProfessional(undefined)
    supabase.from('professionals')
      .select('*')
      .eq('client_id', clientId)
      .eq('user_id', session.user.id)
      .eq('active', true)
      .maybeSingle()
      .then(({ data }) => setProfessional(data ?? null))
  }, [session?.user?.id, clientId])

  useEffect(() => {
    if (!config) return
    const theme = getTheme(config.theme_id)
    applyTheme(theme)
    setThemeVersion(v => v + 1)
  }, [config?.theme_id])

  // ONBOARDING STEP 1: Profile must be completed before the app is fully functional.
  // The bot system prompt, email notifications, certificates, and agenda all depend
  // on the professional's name, email, and other details being set.
  useEffect(() => {
    if (!clientId) { setFirstPro(null); return }
    supabase.from('professionals')
      .select('*')
      .eq('client_id', clientId)
      .eq('active', true)
      .order('created_at')
      .limit(1)
      .then(({ data }) => setFirstPro(data?.[0] ?? null))
  }, [clientId, proRefresh])

  if (session === undefined || clientLoading || (session && professional === undefined)) {
    return (
      <div style={{ height: '100vh', display: 'grid', placeItems: 'center', background: T.bgSunk }}>
        <div style={{ fontFamily: T.serif, fontSize: 22, color: T.inkMuted, fontStyle: 'italic' }}>cargando…</div>
      </div>
    )
  }

  if (!session) return <Login />

  const isPro = !!professional

  // Pro mode: only agenda/patients/settings allowed
  const allowed = isPro ? ['calendar', 'patients', 'settings'] : Object.keys(SCREENS)
  const [base, param] = hash.split('/')
  const safeBase = allowed.includes(base) ? base : (isPro ? 'calendar' : 'leads')
  const Screen = SCREENS[safeBase] ?? (isPro ? AgendaScreen : LeadsScreen)

  return (
    <ErrorBoundary>
      <ClientCtx.Provider value={{
        clientId, config, session, setConfig, professional, firstPro,
        // Empresa mode: complete once empresa.nombre is filled (professionals can be added later).
        // Single mode:  complete only when a professional row with non-empty full_name exists.
        profileIncomplete: config?.modo_empresa
          ? !(config?.empresa?.nombre?.trim())
          : (!firstPro || !(firstPro.full_name?.trim())),
        refreshFirstPro: () => setProRefresh(v => v + 1),
      }}>
        <div key={themeVersion} style={{ height: '100vh', display: 'flex', overflow: 'hidden' }}>
          <Screen onNavigate={navigate} param={param} />
          <AssistantFAB />
        </div>
      </ClientCtx.Provider>
    </ErrorBoundary>
  )
}
