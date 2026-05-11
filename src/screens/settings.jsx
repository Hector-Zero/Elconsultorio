import React, { useState, useEffect, useRef, useContext } from 'react'
import { T, Icon, Sidebar, TopBar } from './shared.jsx'
import { ClientCtx } from '../lib/ClientCtx.js'
import { DirtyGuardCtx } from '../lib/DirtyGuardContext.jsx'
import { fetchClientConfig } from '../lib/clientConfig.js'
import BotConfig from './settings/botConfig.jsx'
import ProfileSettings from './settings/profile.jsx'
import EmpresaSettings from './settings/empresa.jsx'
import AppearanceSettings from './settings/appearance.jsx'
import TemplateSettings from './settings/templates.jsx'
import IntegrationsSettings from './settings/integrations.jsx'
import PlanSettings from './settings/plan.jsx'
import ServiciosSesionesSettings from './settings/serviciosSesiones.jsx'

export default function SettingsScreen({ onNavigate }) {
  const { professional, config, clientId, setConfig } = useContext(ClientCtx)
  const isPro = !!professional
  // Independent on-mount fetch so sidebar (Perfil hidden in empresa mode) and
  // section-order decisions reflect DB truth, not a stale ClientCtx snapshot.
  const [freshConfig, setFreshConfig] = useState(config)
  useEffect(() => {
    if (!clientId) return
    let alive = true
    fetchClientConfig(clientId).then(({ config: fresh }) => {
      if (!alive || !fresh) return
      console.log('[SettingsScreen] fresh config from Supabase:', { modo_empresa: fresh.modo_empresa, has_empresa: !!fresh.empresa, empresa_nombre: fresh.empresa?.nombre })
      setFreshConfig(fresh)
      setConfig?.(fresh)
    })
    return () => { alive = false }
  }, [clientId])
  const empresaMode = !!freshConfig?.modo_empresa

  const allSections = [
    { id: 'profile',       label: 'Perfil profesional',   icon: 'user' },
    { id: 'empresa',       label: 'Empresa',              icon: 'home' },
    { id: 'bot',           label: 'Bot de WhatsApp',      icon: 'sparkle', badge: 'Claude Sonnet 4.6' },
    { id: 'templates',     label: 'Plantillas email',     icon: 'mail' },
    { id: 'appearance',    label: 'Apariencia',           icon: 'sparkle' },
    { id: 'session-types', label: 'Servicios y Sesiones', icon: 'briefcase' },
    { id: 'integrations',  label: 'Integraciones',        icon: 'plug' },
    { id: 'billing',       label: 'Plan & facturación',   icon: 'card' },
  ]
  let sectionOrder
  if (isPro) {
    sectionOrder = ['profile', 'appearance']
  } else if (empresaMode) {
    sectionOrder = ['empresa', 'bot', 'templates', 'appearance', 'session-types', 'integrations', 'billing']
  } else {
    sectionOrder = ['profile', 'empresa', 'bot', 'templates', 'appearance', 'session-types', 'integrations', 'billing']
  }
  const sections = sectionOrder.map(id => allSections.find(s => s.id === id)).filter(Boolean)

  const defaultSection = isPro ? 'profile' : (empresaMode ? 'empresa' : 'profile')
  const [section, setSection] = useState(defaultSection)
  const [profileDirty, setProfileDirty] = useState(false)

  // Bridge the existing profileDirty signal into the central guard until
  // commit 2 refactors profile.jsx to call useDirtyForm directly. The
  // dirty getter must read live state, so we mirror profileDirty and
  // section through refs and register a stable closure once.
  const guard = useContext(DirtyGuardCtx)
  const dirtyStateRef = useRef({ dirty: false, section })
  dirtyStateRef.current = { dirty: profileDirty, section }
  useEffect(() => {
    if (!guard) return
    guard.register('settings/profile', () => {
      const { dirty, section: s } = dirtyStateRef.current
      return dirty && s === 'profile'
    })
    return () => guard.unregister('settings/profile')
  }, [guard])

  useEffect(() => {
    if (!sections.find(s => s.id === section)) setSection(sections[0]?.id ?? 'profile')
  }, [empresaMode, isPro])

  useEffect(() => {
    try {
      if (sessionStorage.getItem('onb_scroll_perfil') === '1') {
        sessionStorage.removeItem('onb_scroll_perfil')
        if (sections.find(s => s.id === 'profile')) setSection('profile')
      }
    } catch {}
  }, [])

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', background: T.bg, fontFamily: T.sans, color: T.ink }}>
      <Sidebar active="settings" onNavigate={onNavigate} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopBar title="Ajustes" subtitle="Configura tu consulta, el bot y las integraciones" />

        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '240px 1fr', minHeight: 0 }}>
          <nav style={{ padding: '18px 14px', borderRight: `1px solid ${T.line}`, display: 'flex', flexDirection: 'column', gap: 2, background: T.bg }}>
            {sections.map(s => {
              const on = section === s.id
              return (
                <div key={s.id} onClick={() => guard?.confirm(() => setSection(s.id))} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 10px', borderRadius: 8,
                  background: on ? T.bgRaised : 'transparent',
                  border: on ? `1px solid ${T.lineSoft}` : `1px solid transparent`,
                  color: on ? T.ink : T.inkSoft,
                  fontSize: 13, fontWeight: on ? 500 : 400, cursor: 'pointer',
                }}>
                  <Icon name={s.icon === 'plug' ? 'cog' : s.icon} size={15} stroke={on ? T.primary : T.inkSoft} />
                  <span style={{ flex: 1 }}>{s.label}</span>
                  {s.badge && (
                    <span style={{ fontSize: 9.5, fontFamily: T.mono, padding: '2px 6px', borderRadius: 4, background: T.accentSoft, color: T.accent }}>{s.badge}</span>
                  )}
                </div>
              )
            })}
          </nav>

          <div style={{ overflow: 'auto' }}>
            {section === 'bot'           && <BotConfig />}
            {section === 'profile'       && <ProfileSettings onDirtyChange={setProfileDirty} />}
            {section === 'empresa'       && <EmpresaSettings onActivated={() => setSection('empresa')} onNavigate={onNavigate} />}
            {section === 'templates'     && <TemplateSettings />}
            {section === 'appearance'    && <AppearanceSettings />}
            {section === 'session-types' && <ServiciosSesionesSettings />}
            {section === 'integrations'  && <IntegrationsSettings />}
            {section === 'billing'       && <PlanSettings />}
          </div>
        </div>
      </div>
    </div>
  )
}
