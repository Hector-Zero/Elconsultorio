import React, { useState, useEffect, useContext } from 'react'
import { T, Icon, Sidebar, TopBar, btn, SectionLabel, avatarTint, avatarInk, applyTheme, TimePicker, ConfirmModal } from './shared.jsx'
import { ClientCtx } from '../lib/ClientCtx.js'
import { supabase } from '../lib/supabase.js'
import { mergeClientConfig, fetchClientConfig } from '../lib/clientConfig.js'
import { THEMES, DEFAULT_THEME_ID, getTheme } from '../config/themes.js'

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
  const [agendaNeedsSetup, setAgendaNeedsSetup] = useState(false)

  // In empresa mode, flag the Agenda tab when any pro still has the
  // default availability (i.e. they've never customized it).
  useEffect(() => {
    if (!empresaMode || !clientId) { setAgendaNeedsSetup(false); return }
    let alive = true
    supabase.from('professionals')
      .select('availability').eq('client_id', clientId).eq('active', true)
      .then(({ data }) => {
        if (!alive) return
        const defaultJson = JSON.stringify(DEFAULT_AVAILABILITY)
        const anyDefault = (data ?? []).some(p => JSON.stringify(p.availability ?? {}) === defaultJson)
        setAgendaNeedsSetup(anyDefault)
      })
    return () => { alive = false }
  }, [empresaMode, clientId, config])

  const allSections = [
    { id: 'profile',      label: 'Perfil profesional', icon: 'user' },
    { id: 'empresa',      label: 'Empresa',            icon: 'home' },
    { id: 'bot',          label: 'Bot de WhatsApp',    icon: 'sparkle', badge: 'Claude Sonnet 4.6' },
    { id: 'templates',    label: 'Plantillas email',   icon: 'mail' },
    { id: 'appearance',   label: 'Apariencia',         icon: 'sparkle' },
    { id: 'agenda',       label: 'Agenda',             icon: 'calendar' },
    { id: 'integrations', label: 'Integraciones',      icon: 'plug' },
    { id: 'billing',      label: 'Plan & facturación', icon: 'card' },
  ]
  let sectionOrder
  if (isPro) {
    sectionOrder = ['profile', 'appearance']
  } else if (empresaMode) {
    sectionOrder = ['empresa', 'bot', 'templates', 'appearance', 'agenda', 'integrations', 'billing']
  } else {
    sectionOrder = ['profile', 'empresa', 'bot', 'templates', 'appearance', 'integrations', 'billing']
  }
  const sections = sectionOrder.map(id => allSections.find(s => s.id === id)).filter(Boolean)

  const defaultSection = isPro ? 'profile' : (empresaMode ? 'empresa' : 'profile')
  const [section, setSection] = useState(defaultSection)
  const [profileDirty, setProfileDirty] = useState(false)
  const [pendingNav, setPendingNav]     = useState(null) // () => void

  function tryNav(action) {
    if (profileDirty && section === 'profile') { setPendingNav(() => action); return }
    action()
  }

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
      <Sidebar active="settings" onNavigate={(id) => tryNav(() => onNavigate(id))} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopBar title="Ajustes" subtitle="Configura tu consulta, el bot y las integraciones" />

        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '240px 1fr', minHeight: 0 }}>
          <nav style={{ padding: '18px 14px', borderRight: `1px solid ${T.line}`, display: 'flex', flexDirection: 'column', gap: 2, background: T.bg }}>
            {sections.map(s => {
              const on = section === s.id
              return (
                <div key={s.id} onClick={() => tryNav(() => setSection(s.id))} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 10px', borderRadius: 8,
                  background: on ? T.bgRaised : 'transparent',
                  border: on ? `1px solid ${T.lineSoft}` : `1px solid transparent`,
                  color: on ? T.ink : T.inkSoft,
                  fontSize: 13, fontWeight: on ? 500 : 400, cursor: 'pointer',
                }}>
                  <Icon name={s.icon === 'plug' ? 'cog' : s.icon} size={15} stroke={on ? T.primary : T.inkSoft} />
                  <span style={{ flex: 1 }}>{s.label}</span>
                  {s.id === 'agenda' && agendaNeedsSetup && (
                    <span title="Falta configurar disponibilidad" style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: T.warn, boxShadow: `0 0 0 3px ${T.warnSoft}`,
                    }} />
                  )}
                  {s.badge && (
                    <span style={{ fontSize: 9.5, fontFamily: T.mono, padding: '2px 6px', borderRadius: 4, background: T.accentSoft, color: T.accent }}>{s.badge}</span>
                  )}
                </div>
              )
            })}
          </nav>

          <div style={{ overflow: 'auto' }}>
            {section === 'bot'          && <BotConfig />}
            {section === 'profile'      && <ProfileSettings onDirtyChange={setProfileDirty} />}
            {section === 'empresa'      && <EmpresaSettings onActivated={() => setSection('empresa')} onGoToAgendaSection={() => setSection('agenda')} />}
            {section === 'templates'    && <TemplateSettings />}
            {section === 'appearance'   && <AppearanceSettings />}
            {section === 'agenda'       && <AgendaSettings />}
            {section === 'integrations' && <IntegrationsSettings />}
            {section === 'billing'      && <PlanSettings />}
          </div>
        </div>
      </div>
      {pendingNav && (
        <ConfirmModal
          title="Tienes cambios sin guardar"
          description="¿Quieres salir sin guardar los cambios?"
          confirmLabel="Salir sin guardar"
          cancelLabel="Seguir editando"
          variant="danger"
          onConfirm={() => {
            const fn = pendingNav
            setProfileDirty(false)
            setPendingNav(null)
            fn()
          }}
          onCancel={() => setPendingNav(null)}
        />
      )}
    </div>
  )
}

// ───── Bot config — wired to agents_config + clients.config ─────
function BotConfig() {
  const { clientId, config } = useContext(ClientCtx)

  const [loading, setLoading]           = useState(true)
  const [saving, setSaving]             = useState(false)
  const [saveStatus, setSaveStatus]     = useState(null) // 'ok' | 'error'
  const [fetchError, setFetchError]     = useState(null)

  // System prompt is admin-only — exposed via admin panel, not client dashboard.
  // Kept in state so we round-trip the existing DB value on save and feed it to BotPreview.
  const [systemPrompt, setSystemPrompt]         = useState('')
  const [messageLimit, setMessageLimit]         = useState(20)
  // closing_question is also admin-only for now — preserved on save, not shown to clients.
  const [closingQuestion, setClosingQuestion]   = useState('')
  const [agentName, setAgentName]               = useState('')
  const [active, setActive]                     = useState(true)

  const SELECT_COLS = 'agent_name, system_prompt, closing_question, message_limit, active'

  function applyData(data) {
    setSystemPrompt(data.system_prompt ?? '')
    setMessageLimit(data.message_limit ?? config?.message_limit ?? 20)
    setClosingQuestion(data.closing_question ?? '')
    setAgentName(data.agent_name ?? '')
    setActive(data.active ?? true)
  }

  useEffect(() => {
    if (!clientId) return
    supabase
      .from('agents_config')
      .select(SELECT_COLS)
      .eq('client_id', clientId)
      .single()
      .then(({ data, error }) => {
        if (error) { setFetchError(error.message); setLoading(false); return }
        applyData(data)
        setLoading(false)
      })
  }, [clientId])

  async function handleSave() {
    setSaving(true)
    setSaveStatus(null)
    const [{ error: agErr }, { error: clErr }] = await Promise.all([
      supabase
        .from('agents_config')
        .update({
          agent_name: agentName,
          system_prompt: systemPrompt,
          message_limit: messageLimit,
          closing_question: closingQuestion,
          active,
        })
        .eq('client_id', clientId),
      // Merge bot fields against fresh DB state — avoid clobbering other tabs.
      mergeClientConfig(clientId, { bot_name: agentName, message_limit: messageLimit }),
    ])
    setSaving(false)
    if (agErr || clErr) { setSaveStatus('error'); return }
    setSaveStatus('ok')
    setTimeout(() => setSaveStatus(null), 2500)
  }

  if (loading) return (
    <div style={{ padding: 40, color: T.inkMuted, fontStyle: 'italic', fontFamily: T.serif }}>cargando…</div>
  )

  if (fetchError) return (
    <div style={{ padding: 40, color: T.error, fontSize: 13 }}>
      Error al cargar configuración: {fetchError}
    </div>
  )

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 860 }}>
      <SettingsHeader
        title="Bot de WhatsApp"
        subtitle="Configura cómo responde el asistente virtual"
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '6px 12px', borderRadius: 999,
              background: T.confirmadoSoft, color: T.confirmado,
              fontSize: 11.5, fontWeight: 500,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: T.confirmado }} />
              Activo · Claude Sonnet 4.6
            </div>
          </div>
        }
      />

      <FieldRow label="Nombre del agente" hint="Cómo se presenta el bot al prospecto.">
        <input value={agentName} onChange={e => setAgentName(e.target.value)}
          placeholder="Ej: Asistente Ana" style={textInput} />
        <div style={{ marginTop: 8, fontSize: 12, color: T.inkMuted, fontStyle: 'italic' }}>
          La personalidad y comportamiento del bot es configurada por el administrador del sistema.
        </div>
      </FieldRow>

      <FieldRow label="Número de WhatsApp Business" hint="Configurado vía Make.com → WhatsApp Cloud API">
        <div style={{ ...textInput, display: 'flex', alignItems: 'center', gap: 10, color: T.inkSoft, background: T.bgSunk }}>
          <Icon name="wa" size={14} stroke={T.primary} />
          <span style={{ fontFamily: T.mono, fontSize: 13 }}>
            {config?.whatsapp_number ?? config?.whatsapp_number_id ?? '— sin conectar —'}
          </span>
          <div style={{ flex: 1 }} />
          {config?.whatsapp_number_id
            ? <span style={{ fontSize: 11, color: T.confirmado }}>✓ Conectado</span>
            : <span style={{ fontSize: 11, color: T.inkMuted }}>No conectado</span>}
        </div>
      </FieldRow>

      <FieldRow
        label="Límite de mensajes por conversación"
        hint="El bot dejará de responder tras este número. Recibirás una notificación para tomar la conversación."
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <input
            type="range" min="5" max="50" value={messageLimit}
            onChange={e => setMessageLimit(+e.target.value)}
            style={{ flex: 1, accentColor: T.primary }}
          />
          <div style={{ fontFamily: T.mono, fontSize: 14, color: T.ink, minWidth: 28, textAlign: 'right' }}>
            {messageLimit}
          </div>
        </div>
      </FieldRow>

      <FieldRow label="Bot activo" hint="Si lo desactivas, el bot dejará de responder mensajes en WhatsApp." inline>
        <Toggle value={active} onChange={setActive} />
      </FieldRow>

      <div style={{ marginTop: 28, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
        {saveStatus === 'ok' && (
          <span style={{ fontSize: 12, color: T.confirmado }}>✓ Guardado</span>
        )}
        {saveStatus === 'error' && (
          <span style={{ fontSize: 12, color: T.error }}>Error al guardar</span>
        )}
        <button style={btn('primary')} onClick={handleSave} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>

      <BotPreview systemPrompt={systemPrompt} agentName={agentName} />
    </div>
  )
}

function BotPreview({ systemPrompt, agentName }) {
  const [messages, setMessages] = useState([])
  const [input, setInput]       = useState('')
  const [sending, setSending]   = useState(false)
  const [error, setError]       = useState(null)

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    setError(null)
    const next = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setInput('')
    setSending(true)
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          system: systemPrompt || undefined,
          messages: next,
        }),
      })
      if (!r.ok) throw new Error(`API ${r.status}`)
      const j = await r.json()
      const reply = j.content?.[0]?.text?.trim() ?? ''
      setMessages(m => [...m, { role: 'assistant', content: reply }])
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ marginTop: 32, background: T.bgRaised, border: `1px solid ${T.line}`, borderRadius: 12, padding: 20 }}>
      <SectionLabel icon="sparkle" label="Probar bot en vivo" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16, background: T.bgSunk, borderRadius: 10, border: `1px solid ${T.lineSoft}`, minHeight: 140, maxHeight: 360, overflow: 'auto' }}>
        {messages.length === 0 && (
          <div style={{ fontSize: 12, color: T.inkMuted, fontStyle: 'italic', textAlign: 'center', padding: '20px 0' }}>
            Escribe un mensaje para probar a {agentName || 'el bot'}.
          </div>
        )}
        {messages.map((m, i) => (
          <ChatBubble key={i} who={m.role === 'user' ? 'prospect' : 'bot'} msg={m.content} />
        ))}
        {sending && <ChatBubble who="bot" msg="…" />}
      </div>
      {error && <div style={{ fontSize: 11, color: T.danger, marginTop: 6 }}>Error: {error}</div>}
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Escribe un mensaje de prueba…"
          disabled={sending}
          style={{ ...textInput, flex: 1 }}
        />
        <button style={btn('primary')} onClick={send} disabled={sending || !input.trim()}>
          <Icon name="send" size={13} stroke={T.primaryText} />
        </button>
      </div>
    </div>
  )
}

// ───── Profile — wired to clients.config (primary_color, resend_from, avatar_url, session_types) ─────
const DEFAULT_SESSION_TYPES = [
  { name: 'Sesión individual', duration_minutes: 50, value_clp: 45000 },
]

function formatRut(raw) {
  if (!raw) return ''
  const cleaned = raw.replace(/[.\-\s]/g, '').toUpperCase()
  if (cleaned.length < 2) return cleaned
  const body = cleaned.slice(0, -1)
  const dv   = cleaned.slice(-1)
  const withDots = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${withDots}-${dv}`
}

function ProfileSettings({ onDirtyChange }) {
  const { clientId, config, setConfig, refreshFirstPro } = useContext(ClientCtx)
  const empresaMode = !!config?.modo_empresa

  const [name,         setName]         = useState(config?.profile_name    ?? '')
  const [title,        setTitle]        = useState(config?.profile_title   ?? '')
  const [rut,          setRut]          = useState(config?.profile_rut     ?? '')
  const [sss,          setSss]          = useState(config?.profile_sss     ?? '')
  const [phone,        setPhone]        = useState(config?.profile_phone   ?? '')
  const [address,      setAddress]      = useState(config?.profile_address ?? '')
  const [resendFrom,   setResendFrom]   = useState(config?.resend_from     ?? '')
  const [avatarUrl,    setAvatarUrl]    = useState(config?.avatar_url      ?? '')
  const [sessionTypes, setSessionTypes] = useState(config?.session_types?.length ? config.session_types : [])
  const [availability, setAvailability] = useState(null) // null = not loaded
  const [initialAvailability, setInitialAvailability] = useState(null)
  const [saving,       setSaving]       = useState(false)
  const [saveStatus,   setSaveStatus]   = useState(null)
  const [uploading,    setUploading]    = useState(false)
  const fileInputRef = React.useRef(null)

  // Fetch fresh on mount so all fields reflect DB truth, regardless of context.
  useEffect(() => {
    if (!clientId) return
    let alive = true
    fetchClientConfig(clientId).then(({ config: fresh }) => {
      if (!alive || !fresh) return
      setName(fresh.profile_name       ?? '')
      setTitle(fresh.profile_title     ?? '')
      setRut(fresh.profile_rut         ?? '')
      setSss(fresh.profile_sss         ?? '')
      setPhone(fresh.profile_phone     ?? '')
      setAddress(fresh.profile_address ?? '')
      setResendFrom(fresh.resend_from  ?? '')
      setAvatarUrl(fresh.avatar_url    ?? '')
      setSessionTypes(fresh.session_types?.length ? fresh.session_types : [])
      setConfig(fresh)
    })
    return () => { alive = false }
  }, [clientId])

  // Also keep state in sync if context changes (e.g. another tab updated it).
  useEffect(() => {
    setName(config?.profile_name       ?? '')
    setTitle(config?.profile_title     ?? '')
    setRut(config?.profile_rut         ?? '')
    setSss(config?.profile_sss         ?? '')
    setPhone(config?.profile_phone     ?? '')
    setAddress(config?.profile_address ?? '')
    setResendFrom(config?.resend_from  ?? '')
    setAvatarUrl(config?.avatar_url    ?? '')
    setSessionTypes(config?.session_types?.length ? config.session_types : [])
  }, [config])

  // Dirty detection — compare each field to the persisted config snapshot.
  const dirty = React.useMemo(() => {
    if (name        !== (config?.profile_name    ?? '')) return true
    if (title       !== (config?.profile_title   ?? '')) return true
    if (rut         !== (config?.profile_rut     ?? '')) return true
    if (sss         !== (config?.profile_sss     ?? '')) return true
    if (phone       !== (config?.profile_phone   ?? '')) return true
    if (address     !== (config?.profile_address ?? '')) return true
    if (resendFrom  !== (config?.resend_from     ?? '')) return true
    if (avatarUrl   !== (config?.avatar_url      ?? '')) return true
    if (JSON.stringify(sessionTypes) !== JSON.stringify(config?.session_types ?? [])) return true
    if (initialAvailability && JSON.stringify(availability) !== JSON.stringify(initialAvailability)) return true
    return false
  }, [name, title, rut, sss, phone, address, resendFrom, avatarUrl, sessionTypes, availability, initialAvailability, config])

  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])

  async function handleAvatarPick(e) {
    const file = e.target.files?.[0]
    if (!file || !clientId) return
    setUploading(true)
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `${clientId}/avatar.${ext}`
    const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type })
    if (upErr) { setUploading(false); setSaveStatus('error'); return }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    const url = `${data.publicUrl}?t=${Date.now()}` // cache-bust on every upload
    // Merge against fresh DB state so this avatar update doesn't clobber
    // other fields recently saved by Empresa/Apariencia/etc.
    const { error: dbErr, config: nextConfig } = await mergeClientConfig(clientId, { avatar_url: url })
    setUploading(false)
    if (dbErr) { setSaveStatus('error'); return }
    setAvatarUrl(url)        // immediate local update — profile section
    setConfig(nextConfig)    // immediate context update — sidebar avatar
  }

  function updateRow(i, patch) {
    setSessionTypes(rows => rows.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  }
  function removeRow(i) {
    setSessionTypes(rows => rows.filter((_, idx) => idx !== i))
  }
  function addRow() {
    setSessionTypes(rows => [...rows, { name: '', duration_minutes: 60, value_clp: 0 }])
  }

  async function handleSave() {
    setSaving(true)
    setSaveStatus(null) // clear any prior error so retries reset
    const cleanTypes = sessionTypes
      .filter(s => (s.name ?? '').trim())
      .map(s => ({
        name: s.name.trim(),
        duration_minutes: Number(s.duration_minutes) || 60,
        value_clp: Number(s.value_clp) || 0,
      }))
    const trimmedName = name.trim()
    const nextConfig = {
      ...(config ?? {}),
      profile_name:    trimmedName,
      profile_title:   title.trim(),
      profile_rut:     rut.trim(),
      profile_sss:     sss.trim(),
      profile_phone:   phone.trim(),
      profile_address: address.trim(),
      resend_from:     resendFrom,
      session_types:   cleanTypes,
    }
    // Merge profile fields against fresh DB state so we never wipe empresa/theme
    // saved from other tabs.
    console.log('[profile-save] BEFORE mergeClientConfig', { clientId, profileFields: Object.keys(nextConfig).filter(k => k.startsWith('profile_') || ['session_types','resend_from'].includes(k)) })
    const { error: clientErr, config: mergedConfig } = await mergeClientConfig(clientId, fresh => ({
      ...fresh,
      profile_name:    trimmedName,
      profile_title:   title.trim(),
      profile_rut:     rut.trim(),
      profile_sss:     sss.trim(),
      profile_phone:   phone.trim(),
      profile_address: address.trim(),
      resend_from:     resendFrom,
      session_types:   cleanTypes,
    }))
    console.log('[profile-save] AFTER mergeClientConfig', { error: clientErr })
    if (clientErr) { setSaving(false); setSaveStatus('error'); return }
    // Side-effect: mirror display name to clients.name so it appears in lists.
    if (trimmedName) {
      await supabase.from('clients').update({ name: trimmedName }).eq('id', clientId)
    }
    setConfig(mergedConfig)

    // Mirror profile fields + availability to the (possibly missing) first professional row.
    console.log('[profile-save] BEFORE professionals.select', { clientId })
    const { data: pros, error: selErr } = await supabase.from('professionals')
      .select('id, email').eq('client_id', clientId).eq('active', true).order('created_at').limit(1)
    console.log('[profile-save] AFTER professionals.select', { rows: pros?.length ?? 0, error: selErr })
    if (selErr) { setSaving(false); setSaveStatus('error'); return }

    const existing = pros?.[0]
    const proPatch = {}
    if (trimmedName) {
      proPatch.full_name = trimmedName
      proPatch.initials  = initialsOf(trimmedName)
      proPatch.email     = resendFrom || existing?.email || ''
    }
    if (availability) proPatch.availability = availability

    if (existing) {
      // Row exists → UPDATE
      if (Object.keys(proPatch).length) {
        console.log('[profile-save] BEFORE professionals.update', { id: existing.id, proPatch })
        const { error: updErr } = await supabase.from('professionals').update(proPatch).eq('id', existing.id)
        console.log('[profile-save] AFTER professionals.update', { error: updErr })
        if (updErr) { setSaving(false); setSaveStatus('error'); return }
      }
    } else {
      // No row → INSERT seed (this is what makes the table have its first row)
      const seed = {
        client_id:    clientId,
        full_name:    proPatch.full_name || trimmedName || '',
        initials:     proPatch.initials  || initialsOf(trimmedName || ''),
        email:        proPatch.email     || resendFrom || '',
        color:        PRO_COLORS[0],
        active:       true,
        availability: availability || DEFAULT_AVAILABILITY,
      }
      console.log('[profile-save] BEFORE professionals.insert', { seed })
      const { data: ins, error: insErr } = await supabase.from('professionals').insert(seed).select().single()
      console.log('[profile-save] AFTER professionals.insert', { id: ins?.id, error: insErr })
      if (insErr) { setSaving(false); setSaveStatus('error'); return }
      if (ins?.id) {
        // Adopt any orphan appointments so the calendar is consistent.
        console.log('[profile-save] BEFORE appointments.update (adopt orphans)', { proId: ins.id })
        const { error: adoptErr } = await supabase.from('appointments')
          .update({ professional_id: ins.id })
          .eq('client_id', clientId)
          .is('professional_id', null)
        console.log('[profile-save] AFTER appointments.update', { error: adoptErr })
      }
    }

    refreshFirstPro?.() // always run — banner clears immediately on first save too
    if (availability) setInitialAvailability(availability)
    setSaving(false)
    setSaveStatus('ok')
    setTimeout(() => setSaveStatus(null), 2500)
  }


  const displayName = name || ''

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 780 }}>
      <SettingsHeader title="Perfil profesional" subtitle="Información que verán tus pacientes y que el bot mencionará" />

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', marginBottom: 28 }}>
        <div
          onClick={() => fileInputRef.current?.click()}
          title="Cambiar foto de perfil"
          style={{
            width: 88, height: 88, borderRadius: '50%',
            background: avatarUrl ? T.bgSunk : (displayName ? avatarTint(displayName) : T.bgSunk),
            color: displayName ? avatarInk(displayName) : T.inkMuted,
            display: 'grid', placeItems: 'center',
            fontFamily: T.sans, fontSize: 30, fontWeight: 600,
            cursor: 'pointer', overflow: 'hidden',
            border: avatarUrl ? 'none' : `1px dashed ${T.line}`,
          }}
        >
          {avatarUrl
            ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : (displayName
                ? displayName.split(' ').slice(0, 2).map(s => s[0]).join('').toUpperCase()
                : <Icon name="user" size={32} stroke={T.inkMuted} />)}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleAvatarPick}
        />
        <div style={{ flex: 1, paddingTop: 6 }}>
          <div style={{ fontSize: 13, color: T.inkSoft, marginBottom: 10 }}>Foto de perfil</div>
          <button style={btn('ghost')} onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            <Icon name="download" size={13} /> {uploading ? 'Subiendo…' : 'Subir nueva foto'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <FieldRow label="Nombre completo">
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="Ej: Dra. Ana González" style={textInput} />
        </FieldRow>
        <FieldRow label="Título profesional">
          <input value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Ej: Psicóloga clínica" style={textInput} />
        </FieldRow>
        <FieldRow label="RUT">
          <input value={rut}
            onChange={e => setRut(e.target.value)}
            onBlur={() => setRut(r => formatRut(r))}
            placeholder="Ej: 12.345.678-9" style={{ ...textInput, fontFamily: T.mono }} />
        </FieldRow>
        <FieldRow label="N° registro SSS">
          <input value={sss} onChange={e => setSss(e.target.value)}
            placeholder="Ej: 23.459" style={{ ...textInput, fontFamily: T.mono }} />
        </FieldRow>
        <FieldRow label="Email del remitente" hint="Resend usará este email como remitente.">
          <input value={resendFrom} onChange={e => setResendFrom(e.target.value)}
            placeholder="Ej: agenda@miconsultorio.cl" style={textInput} />
        </FieldRow>
        <FieldRow label="Teléfono">
          <input value={phone} onChange={e => setPhone(e.target.value)}
            placeholder="Ej: +56 9 8765 4321" style={{ ...textInput, fontFamily: T.mono }} />
        </FieldRow>
      </div>

      <FieldRow label="Dirección de consulta">
        <input value={address} onChange={e => setAddress(e.target.value)}
          placeholder="Ej: Av. Providencia 1234, Oficina 502" style={textInput} />
      </FieldRow>

      <FieldRow label="Tipos de sesión" hint="Define los tipos de sesión que ofreces y su valor.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sessionTypes.map((s, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 150px 32px', gap: 8, alignItems: 'center' }}>
              <input
                value={s.name ?? ''}
                onChange={e => updateRow(i, { name: e.target.value })}
                placeholder="Nombre (ej. Sesión individual)"
                style={textInput}
              />
              <div style={{ ...textInput, display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number"
                  value={s.duration_minutes ?? ''}
                  onChange={e => updateRow(i, { duration_minutes: e.target.value })}
                  style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: T.mono, width: '100%' }}
                />
                <span style={{ color: T.inkMuted, fontSize: 11 }}>min</span>
              </div>
              <div style={{ ...textInput, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: T.inkMuted }}>$</span>
                <input
                  type="number"
                  value={s.value_clp ?? ''}
                  onChange={e => updateRow(i, { value_clp: e.target.value })}
                  placeholder="45000"
                  style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: T.mono, width: '100%' }}
                />
                <span style={{ color: T.inkMuted, fontSize: 11 }}>CLP</span>
              </div>
              <button
                onClick={() => removeRow(i)}
                title="Eliminar"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: T.inkMuted, padding: 4 }}
              ><Icon name="x" size={14} stroke={T.inkMuted} /></button>
            </div>
          ))}
          <button
            onClick={addRow}
            style={{ ...btn('ghost'), alignSelf: 'flex-start', marginTop: 4 }}
          ><Icon name="plus" size={13} /> Agregar tipo de sesión</button>
        </div>
      </FieldRow>

      {!empresaMode && (
        <PerfilDisponibilidad
          clientId={clientId}
          config={config}
          availability={availability}
          onAvailabilityLoaded={(av) => { setAvailability(av); setInitialAvailability(av) }}
          onAvailabilityChange={setAvailability}
        />
      )}

      <div style={{ marginTop: 24, display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
        {saveStatus === 'ok'    && <span style={{ fontSize: 12, color: T.confirmado }}>✓ Guardado</span>}
        {saveStatus === 'error' && <span style={{ fontSize: 12, color: T.error }}>Error al guardar</span>}
        <button style={btn('ghost')} disabled={saving}>Cancelar</button>
        <button style={btn('primary')} onClick={handleSave} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  )
}

function PerfilDisponibilidad({ clientId, config, availability, onAvailabilityLoaded, onAvailabilityChange }) {
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) return
    let alive = true
    ;(async () => {
      let row = null
      try {
        console.log('[disponibilidad] BEFORE professionals.select', { clientId })
        const { data, error } = await supabase
          .from('professionals')
          .select('*')
          .eq('client_id', clientId)
          .eq('active', true)
          .order('created_at')
          .limit(1)
        console.log('[disponibilidad] AFTER professionals.select', { rows: data?.length ?? 0, error })
        if (!alive) return
        row = data?.[0] || null
        // Don't auto-seed here — empty table is fine; show the default form and let
        // handleSave() create the row on first save. This keeps the UI responsive
        // even if RLS blocks inserts from this read-side effect.
      } catch (e) {
        console.error('[disponibilidad] fetch failed', e)
      } finally {
        if (alive) {
          // Always populate parent + clear spinner, even on error or empty table.
          onAvailabilityLoaded?.(row?.availability ?? DEFAULT_AVAILABILITY)
          setLoading(false)
        }
      }
    })()
    return () => { alive = false }
  }, [clientId])

  function setDay(key, patch) {
    onAvailabilityChange?.({ ...availability, [key]: { ...availability[key], ...patch } })
  }

  return (
    <div style={{ marginTop: 28, paddingTop: 22, borderTop: `1px solid ${T.lineSoft}` }}>
      <SectionLabel icon="calendar" label="Disponibilidad semanal" />
      {loading || !availability ? (
        <div style={{ padding: 16, color: T.inkMuted, fontStyle: 'italic', fontSize: 13 }}>cargando…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {DAYS.map(([key, label]) => {
            const d = availability[key] ?? { start: '09:00', end: '18:00', available: false }
            return (
              <div key={key} style={{
                display: 'grid', gridTemplateColumns: '110px 60px 1fr 1fr', gap: 10,
                alignItems: 'center', padding: '6px 0',
              }}>
                <div style={{ fontSize: 12.5, color: T.ink }}>{label}</div>
                <SmallToggle value={d.available} onChange={(v) => setDay(key, { available: v })} />
                <div style={{ opacity: d.available ? 1 : 0.4, pointerEvents: d.available ? 'auto' : 'none' }}>
                  <TimePicker value={d.start} onChange={(v) => setDay(key, { start: v })} hourRange={[6, 14]} />
                </div>
                <div style={{ opacity: d.available ? 1 : 0.4, pointerEvents: d.available ? 'auto' : 'none' }}>
                  <TimePicker value={d.end} onChange={(v) => setDay(key, { end: v })} hourRange={[12, 23]} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ───── Empresa — modo empresa wizard + active form ─────
function EmpresaSettings({ onActivated, onGoToAgendaSection }) {
  const { clientId, config, setConfig } = useContext(ClientCtx)
  const [wizard, setWizard] = useState(false)
  const [banner, setBanner] = useState(null) // { proName }
  // Fetch fresh config on mount so the CTA-vs-active decision uses DB truth,
  // not a stale context snapshot. Sync the result back into context so other
  // tabs see it too.
  const [freshConfig, setFreshConfig] = useState(config)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (!clientId) return
    let alive = true
    fetchClientConfig(clientId).then(({ config: fresh, error }) => {
      console.log('[EmpresaSettings] fresh fetch:', {
        error,
        modo_empresa: fresh?.modo_empresa,
        empresa_nombre: fresh?.empresa?.nombre,
        empresa_keys: fresh?.empresa ? Object.keys(fresh.empresa) : null,
        full_fresh: fresh,
      })
      if (!alive) return
      setFreshConfig(fresh)
      if (fresh) setConfig(fresh) // keep context in sync
      setLoaded(true)
    })
    return () => { alive = false }
  }, [clientId])

  if (!loaded) return (
    <div style={{ padding: 40, color: T.inkMuted, fontStyle: 'italic', fontFamily: T.serif }}>cargando…</div>
  )

  // Decision uses ONLY the freshly fetched Supabase value, never ClientCtx.
  const empresaMode = !!freshConfig?.modo_empresa
  console.log('[EmpresaSettings] render decision:', { empresaMode, willShowActiveForm: empresaMode })
  if (empresaMode) {
    return <EmpresaActiveForm banner={banner} onGoToAgendaSection={onGoToAgendaSection} />
  }
  if (wizard) {
    return (
      <EmpresaWizard
        onCancel={() => setWizard(false)}
        onActivated={(proName) => {
          setWizard(false)
          setBanner({ proName })
          onActivated?.()
        }}
      />
    )
  }
  return (
    <div style={{ padding: '60px 32px', maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
      <div style={{
        width: 72, height: 72, borderRadius: '50%',
        background: T.primarySoft, color: T.primary,
        display: 'grid', placeItems: 'center', margin: '0 auto 22px',
      }}>
        <Icon name="users" size={32} stroke={T.primary} />
      </div>
      <div style={{ fontFamily: T.serif, fontSize: 30, color: T.ink, lineHeight: 1.1 }}>
        ¿Tienes un equipo?
      </div>
      <div style={{ fontSize: 14, color: T.inkMuted, marginTop: 14, lineHeight: 1.55, maxWidth: 480, margin: '14px auto 0' }}>
        Activa el modo empresa para gestionar múltiples profesionales bajo un mismo centro o clínica.
      </div>
      <div style={{ marginTop: 28 }}>
        <button style={btn('primary')} onClick={() => setWizard(true)}>
          Activar modo empresa
        </button>
      </div>
    </div>
  )
}

function EmpresaActiveForm({ banner, onGoToAgendaSection }) {
  const { clientId, config, setConfig } = useContext(ClientCtx)
  const [nombre, setNombre]       = useState(config?.empresa?.nombre ?? '')
  const [rut, setRut]             = useState(config?.empresa?.rut ?? '')
  const [direccion, setDireccion] = useState(config?.empresa?.direccion ?? '')
  const [telefono, setTelefono]   = useState(config?.empresa?.telefono ?? '')
  const [email, setEmail]         = useState(config?.empresa?.email ?? '')
  const [logoUrl, setLogoUrl]     = useState(config?.empresa?.logo_url ?? '')
  const [pendingFile, setPendingFile] = useState(null)
  const [saving, setSaving]       = useState(false)
  const [toast, setToast]         = useState(null)
  const fileRef = React.useRef(null)

  // Fetch fresh on mount so we don't render with a stale empresa snapshot.
  useEffect(() => {
    if (!clientId) return
    let alive = true
    fetchClientConfig(clientId).then(({ config: fresh }) => {
      if (!alive) return
      const e = fresh?.empresa ?? {}
      setNombre(e.nombre ?? ''); setRut(e.rut ?? ''); setDireccion(e.direccion ?? '')
      setTelefono(e.telefono ?? ''); setEmail(e.email ?? ''); setLogoUrl(e.logo_url ?? '')
      if (fresh) setConfig(fresh)
    })
    return () => { alive = false }
  }, [clientId])

  function pickLogo(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setPendingFile(f)
    setLogoUrl(URL.createObjectURL(f))
  }

  async function handleSave() {
    setSaving(true)
    let nextLogoUrl = logoUrl ?? ''
    if (pendingFile) {
      const ext  = (pendingFile.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${clientId}/logo.${ext}`
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, pendingFile, { upsert: true, contentType: pendingFile.type })
      if (!upErr) {
        const { data } = supabase.storage.from('avatars').getPublicUrl(path)
        nextLogoUrl = `${data.publicUrl}?t=${Date.now()}` // cache-bust
      }
    }
    // Read-modify-write merge against fresh DB state — preserves any field
    // another tab may have written (logo_url from the wizard, etc.).
    const { error, config: next } = await mergeClientConfig(clientId, fresh => ({
      ...fresh,
      empresa: {
        ...(fresh.empresa ?? {}),
        nombre: nombre.trim(), rut: rut.trim(), direccion: direccion.trim(),
        telefono: telefono.trim(), email: email.trim(), logo_url: nextLogoUrl,
      },
    }))
    setSaving(false)
    if (error) { setToast({ kind: 'err', msg: 'Error al guardar' }); return }
    setConfig(next)
    setLogoUrl(nextLogoUrl); setPendingFile(null)
    setToast({ kind: 'ok', msg: '✓ Guardado' })
    setTimeout(() => setToast(null), 2200)
  }

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 780 }}>
      <SettingsHeader title="Empresa" subtitle="Datos del centro o clínica" />

      {banner && (
        <div style={{
          marginBottom: 22, padding: '14px 16px', borderRadius: 10,
          background: T.primarySoft, color: T.primary, border: `1px solid ${T.primary}`,
          fontSize: 13, lineHeight: 1.5,
        }}>
          ✓ Modo empresa activado. Recuerda completar la agenda de <strong>{banner.proName}</strong> en Ajustes → Agenda.
        </div>
      )}

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', marginBottom: 28 }}>
        <div onClick={() => fileRef.current?.click()} title="Cambiar logo" style={{
          width: 88, height: 88, borderRadius: 14,
          background: logoUrl ? T.bgSunk : T.primarySoft, color: T.primary,
          display: 'grid', placeItems: 'center', cursor: 'pointer', overflow: 'hidden',
          border: `1px solid ${T.line}`,
        }}>
          {logoUrl
            ? <img src={logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <Icon name="home" size={32} stroke={T.primary} />}
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={pickLogo} />
        <div style={{ flex: 1, paddingTop: 6 }}>
          <div style={{ fontSize: 13, color: T.inkSoft, marginBottom: 10 }}>Logo del centro</div>
          <button style={btn('ghost')} onClick={() => fileRef.current?.click()}>
            <Icon name="download" size={13} /> Subir logo
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <FieldRow label="Nombre del centro">
          <input value={nombre} onChange={e => setNombre(e.target.value)} style={textInput} />
        </FieldRow>
        <FieldRow label="RUT del centro">
          <input value={rut}
            onChange={e => setRut(e.target.value)}
            onBlur={() => setRut(r => formatRut(r))}
            placeholder="76.123.456-7"
            style={{ ...textInput, fontFamily: T.mono }} />
        </FieldRow>
        <FieldRow label="Teléfono">
          <input value={telefono} onChange={e => setTelefono(e.target.value)} style={{ ...textInput, fontFamily: T.mono }} />
        </FieldRow>
        <FieldRow label="Email de contacto">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={textInput} />
        </FieldRow>
      </div>
      <FieldRow label="Dirección">
        <input value={direccion} onChange={e => setDireccion(e.target.value)} style={textInput} />
      </FieldRow>

      <div style={{ marginTop: 18, padding: 12, background: T.bgSunk, borderRadius: 8, fontSize: 12, color: T.inkMuted, lineHeight: 1.5 }}>
        Para gestionar profesionales ve a <strong>Ajustes → Agenda</strong>.
      </div>

      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
        {toast?.kind === 'ok'  && <span style={{ fontSize: 12, color: T.confirmado }}>{toast.msg}</span>}
        {toast?.kind === 'err' && <span style={{ fontSize: 12, color: T.danger }}>{toast.msg}</span>}
        <button style={btn('primary')} onClick={handleSave} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>

      <div style={{
        marginTop: 28, padding: '14px 16px',
        background: T.bgRaised, border: `1px solid ${T.line}`,
        borderRadius: 10, display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div style={{ flex: 1, fontSize: 13, color: T.inkSoft, lineHeight: 1.5 }}>
          ¿Ya configuraste las agendas de tus profesionales?
        </div>
        <button style={btn('ghost')} onClick={() => onGoToAgendaSection?.()}>
          Ir a Agenda →
        </button>
      </div>
    </div>
  )
}

function EmpresaWizard({ onCancel, onActivated }) {
  const { clientId, config, setConfig } = useContext(ClientCtx)
  const [step, setStep] = useState(1)

  // step 1
  const [nombre, setNombre]       = useState('')
  const [rut, setRut]             = useState('')
  const [direccion, setDireccion] = useState('')
  const [telefono, setTelefono]   = useState('')
  const [emailC, setEmailC]       = useState('')
  const [logoFile, setLogoFile]   = useState(null)
  const [logoPreview, setLogoPreview] = useState('')
  const logoRef = React.useRef(null)

  // step 2 — prefill from Perfil profesional if already saved
  const [proName, setProName]     = useState(config?.profile_name ?? '')
  const [proEmail, setProEmail]   = useState('')
  const [proColor, setProColor]   = useState(PRO_COLORS[0])
  const [availability, setAvailability] = useState(DEFAULT_AVAILABILITY)

  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)

  function pickLogo(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setLogoFile(f); setLogoPreview(URL.createObjectURL(f))
  }
  function setDay(key, patch) {
    setAvailability(av => ({ ...av, [key]: { ...av[key], ...patch } }))
  }

  async function activate() {
    if (!proName.trim()) { setErr('Nombre del profesional requerido'); return }
    if (!proEmail.trim()) { setErr('Email del profesional requerido'); return }
    setSaving(true); setErr(null)

    let logoUrl = ''
    if (logoFile) {
      const ext  = (logoFile.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${clientId}/logo.${ext}`
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, logoFile, { upsert: true, contentType: logoFile.type })
      if (!upErr) {
        const { data } = supabase.storage.from('avatars').getPublicUrl(path)
        logoUrl = `${data.publicUrl}?t=${Date.now()}` // cache-bust
      }
    }

    const { data: pro, error: proErr } = await supabase
      .from('professionals')
      .insert({
        client_id: clientId,
        full_name: proName.trim(),
        initials:  initialsOf(proName),
        email:     proEmail.trim(),
        color:     proColor,
        availability,
      })
      .select()
      .single()
    if (proErr) { setSaving(false); setErr(proErr.message); return }

    // Migrate any orphaned appointments to this first professional
    await supabase.from('appointments')
      .update({ professional_id: pro.id })
      .eq('client_id', clientId)
      .is('professional_id', null)

    const { error: cErr, config: nextConfig } = await mergeClientConfig(clientId, fresh => ({
      ...fresh,
      modo_empresa: true,
      empresa: {
        ...(fresh.empresa ?? {}),
        nombre: nombre.trim(), rut: rut.trim(), direccion: direccion.trim(),
        telefono: telefono.trim(), email: emailC.trim(), logo_url: logoUrl,
      },
    }))
    setSaving(false)
    if (cErr) { setErr(cErr.message); return }
    setConfig(nextConfig)
    onActivated(pro.full_name)
  }

  const canNext1 = !!nombre.trim()

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 720 }}>
      <SettingsHeader
        title={step === 1 ? 'Datos del centro' : 'Crear primer profesional'}
        subtitle={`Paso ${step} de 2 · Activar modo empresa`}
      />

      {step === 1 ? (
        <>
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', marginBottom: 22 }}>
            <div onClick={() => logoRef.current?.click()} style={{
              width: 80, height: 80, borderRadius: 14,
              background: logoPreview ? T.bgSunk : T.primarySoft, color: T.primary,
              display: 'grid', placeItems: 'center', cursor: 'pointer', overflow: 'hidden',
              border: `1px solid ${T.line}`,
            }}>
              {logoPreview
                ? <img src={logoPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <Icon name="home" size={28} stroke={T.primary} />}
            </div>
            <input ref={logoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={pickLogo} />
            <div style={{ paddingTop: 8 }}>
              <div style={{ fontSize: 12, color: T.inkSoft, marginBottom: 6 }}>Logo del centro</div>
              <button style={btn('ghost')} onClick={() => logoRef.current?.click()}>
                <Icon name="download" size={13} /> Subir logo
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field2 label="Nombre del centro *">
              <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Centro psicológico …" style={textInput} />
            </Field2>
            <Field2 label="RUT del centro">
              <input value={rut}
                onChange={e => setRut(e.target.value)}
                onBlur={() => setRut(r => formatRut(r))}
                placeholder="76.123.456-7"
                style={{ ...textInput, fontFamily: T.mono }} />
            </Field2>
            <Field2 label="Teléfono">
              <input value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="+56 …" style={{ ...textInput, fontFamily: T.mono }} />
            </Field2>
            <Field2 label="Email de contacto">
              <input type="email" value={emailC} onChange={e => setEmailC(e.target.value)} placeholder="contacto@centro.cl" style={textInput} />
            </Field2>
          </div>
          <div style={{ marginTop: 14 }}>
            <Field2 label="Dirección">
              <input value={direccion} onChange={e => setDireccion(e.target.value)} placeholder="Av. …, Santiago" style={textInput} />
            </Field2>
          </div>

          <div style={{ marginTop: 28, display: 'flex', justifyContent: 'space-between' }}>
            <button style={btn('ghost')} onClick={onCancel}>Cancelar</button>
            <button
              style={{ ...btn('primary'), opacity: canNext1 ? 1 : 0.5, cursor: canNext1 ? 'pointer' : 'not-allowed' }}
              disabled={!canNext1}
              onClick={() => setStep(2)}
            >Siguiente</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ marginBottom: 18, padding: 12, background: T.primarySoft, color: T.primary, borderRadius: 8, fontSize: 13, lineHeight: 1.5 }}>
            Antes de activar el modo empresa debes registrar al menos un profesional.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field2 label="Nombre completo *">
              <input value={proName} onChange={e => setProName(e.target.value)} placeholder="Dra. Paz Correa" style={textInput} />
            </Field2>
            <Field2 label="Email *">
              <input type="email" value={proEmail} onChange={e => setProEmail(e.target.value)} placeholder="paz@centro.cl" style={textInput} />
            </Field2>
          </div>

          <div style={{ marginTop: 14 }}>
            <Field2 label="Color">
              <div style={{ display: 'flex', gap: 8 }}>
                {PRO_COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setProColor(c)} style={{
                    width: 30, height: 30, borderRadius: '50%', cursor: 'pointer',
                    background: c, border: proColor === c ? `3px solid ${T.ink}` : `1px solid ${T.line}`,
                  }} />
                ))}
              </div>
            </Field2>
          </div>

          <div style={{ marginTop: 18 }}>
            <SectionLabel icon="calendar" label="Disponibilidad semanal" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {DAYS.map(([key, label]) => {
                const d = availability[key] ?? { start: '09:00', end: '18:00', available: false }
                return (
                  <div key={key} style={{
                    display: 'grid', gridTemplateColumns: '90px 60px 1fr 1fr', gap: 10,
                    alignItems: 'center', padding: '6px 0',
                  }}>
                    <div style={{ fontSize: 12.5, color: T.ink }}>{label}</div>
                    <SmallToggle value={d.available} onChange={(v) => setDay(key, { available: v })} />
                    <div style={{ opacity: d.available ? 1 : 0.4, pointerEvents: d.available ? 'auto' : 'none' }}>
                      <TimePicker value={d.start} onChange={(v) => setDay(key, { start: v })} hourRange={[6, 14]} />
                    </div>
                    <div style={{ opacity: d.available ? 1 : 0.4, pointerEvents: d.available ? 'auto' : 'none' }}>
                      <TimePicker value={d.end} onChange={(v) => setDay(key, { end: v })} hourRange={[12, 23]} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {err && <div style={{ marginTop: 12, fontSize: 12, color: T.danger }}>{err}</div>}

          <div style={{ marginTop: 28, display: 'flex', justifyContent: 'space-between' }}>
            <button style={btn('ghost')} onClick={() => setStep(1)} disabled={saving}>← Atrás</button>
            <button style={btn('primary')} onClick={activate} disabled={saving}>
              {saving ? 'Activando…' : 'Activar modo empresa'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ───── Appearance — themes ─────
function AppearanceSettings() {
  const { clientId, config, setConfig } = useContext(ClientCtx)

  const [themeId, setThemeId] = useState(config?.theme_id ?? DEFAULT_THEME_ID)
  const [saving, setSaving]   = useState(false)
  const [toast, setToast]     = useState(null)

  // On-mount fetch: ONLY apply a theme if one is explicitly saved in Supabase.
  // If theme_id is missing/null/undefined, do nothing — leave whatever theme
  // is currently rendered (including a click the user just made). This avoids
  // the "snap back to default" race entirely with no need for an interaction ref.
  useEffect(() => {
    if (!clientId) return
    let alive = true
    fetchClientConfig(clientId).then(({ config: fresh, error }) => {
      console.log('[Apariencia mount] fetch result:', { error, theme_id: fresh?.theme_id, config_keys: fresh ? Object.keys(fresh) : null })
      if (!alive) return
      if (fresh) setConfig(fresh) // keep context in sync (other tabs care about other fields)
      if (fresh?.theme_id) {
        setThemeId(fresh.theme_id)
        applyTheme(getTheme(fresh.theme_id))
      }
      // else: no saved theme — do not call applyTheme, do not call setThemeId.
    })
    return () => { alive = false }
  }, [clientId])

  function pickTheme(id) {
    setThemeId(id)
    applyTheme(getTheme(id))
  }

  async function save() {
    setSaving(true)
    console.log('[Apariencia save] BEFORE mergeClientConfig', { clientId, themeId })
    const { error, config: next } = await mergeClientConfig(clientId, { theme_id: themeId })
    console.log('[Apariencia save] AFTER mergeClientConfig', { error, theme_id_in_next: next?.theme_id })
    if (error) { setSaving(false); setToast({ kind: 'err', msg: 'Error al guardar' }); return }
    // Verify the write actually landed in Supabase by re-reading.
    const { config: verify, error: vErr } = await fetchClientConfig(clientId)
    console.log('[Apariencia save] VERIFY re-fetch from Supabase', { error: vErr, theme_id: verify?.theme_id, persisted: verify?.theme_id === themeId })
    setSaving(false)
    setConfig(next)
    setToast({ kind: 'ok', msg: '✓ Apariencia guardada' })
    setTimeout(() => setToast(null), 2500)
  }

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 880 }}>
      <SettingsHeader title="Apariencia" subtitle="Elige el tema visual de tu plataforma" />

      <div style={{ marginTop: 4, marginBottom: 18 }}>
        <SectionLabel icon="sparkle" label="Tema de la plataforma" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {THEMES.map(t => {
          const selected = t.id === themeId
          return (
            <div
              key={t.id}
              onClick={() => pickTheme(t.id)}
              style={{
                cursor: 'pointer',
                borderRadius: 12,
                border: `2px solid ${selected ? T.primary : T.line}`,
                background: T.bgRaised,
                padding: 14,
                display: 'flex', flexDirection: 'column', gap: 10,
                transition: 'border-color 120ms',
              }}
            >
              <ThemePreview theme={t} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{t.name}</div>
                  <div style={{ fontSize: 11.5, color: T.inkMuted, marginTop: 2 }}>{t.description}</div>
                </div>
                {selected && (
                  <div style={{
                    width: 20, height: 20, borderRadius: '50%',
                    background: T.primary, color: T.primaryText,
                    display: 'grid', placeItems: 'center', flexShrink: 0,
                  }}><Icon name="check" size={12} stroke={T.primaryText} /></div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
        {toast?.kind === 'ok'  && <span style={{ fontSize: 12, color: T.confirmado }}>{toast.msg}</span>}
        {toast?.kind === 'err' && <span style={{ fontSize: 12, color: T.danger }}>{toast.msg}</span>}
        <button style={btn('primary')} onClick={save} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar apariencia'}
        </button>
      </div>
    </div>
  )
}

function ThemePreview({ theme }) {
  const c = theme.colors
  const accent = c.primary
  return (
    <div style={{
      height: 84, borderRadius: 8, overflow: 'hidden',
      border: `1px solid ${c.border}`,
      display: 'grid', gridTemplateColumns: '32px 1fr',
    }}>
      <div style={{ background: c.sidebar, display: 'flex', flexDirection: 'column', gap: 4, padding: 6 }}>
        <div style={{ height: 6, borderRadius: 2, background: c.sidebarText, opacity: 0.85 }} />
        <div style={{ height: 4, borderRadius: 2, background: c.sidebarText, opacity: 0.5 }} />
        <div style={{ height: 4, borderRadius: 2, background: c.sidebarText, opacity: 0.5 }} />
      </div>
      <div style={{ background: c.background, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ height: 18, borderRadius: 4, background: c.surface, border: `1px solid ${c.border}` }} />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ height: 14, flex: 1, borderRadius: 4, background: c.surface, border: `1px solid ${c.border}` }} />
          <div style={{ width: 22, height: 14, borderRadius: 4, background: accent }} />
        </div>
        <div style={{ height: 6, width: 38, borderRadius: 3, background: accent, opacity: 0.7 }} />
      </div>
    </div>
  )
}

// ───── Agenda — professionals + agenda hours ─────
const DEFAULT_AVAILABILITY = {
  monday:    { start: '09:00', end: '18:00', available: true },
  tuesday:   { start: '09:00', end: '18:00', available: true },
  wednesday: { start: '09:00', end: '18:00', available: true },
  thursday:  { start: '09:00', end: '18:00', available: true },
  friday:    { start: '09:00', end: '18:00', available: true },
  saturday:  { start: '09:00', end: '13:00', available: false },
  sunday:    { start: '09:00', end: '13:00', available: false },
}
const DAYS = [
  ['monday', 'Lunes'], ['tuesday', 'Martes'], ['wednesday', 'Miércoles'],
  ['thursday', 'Jueves'], ['friday', 'Viernes'], ['saturday', 'Sábado'], ['sunday', 'Domingo'],
]
const PRO_COLORS = ['#2f4a3a', '#0077b6', '#7c5cbf', '#d4688a', '#e07a3a', '#9a4a3f']
const MAX_PROS = 5

function initialsOf(name) {
  return (name ?? '').trim().split(/\s+/).slice(0, 2).map(s => s[0] ?? '').join('').toUpperCase() || '?'
}

function AgendaSettings() {
  const { clientId, config, setConfig } = useContext(ClientCtx)
  const [pros, setPros]       = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // null | 'new' | proObj
  const [toast, setToast]     = useState(null)
  const [confirmDel, setConfirmDel] = useState(null) // pro to delete

  const settings = config?.agenda_settings ?? { day_start: '08:00', day_end: '20:00', default_duration: 50 }
  const [dayStart, setDayStart]               = useState(settings.day_start)
  const [dayEnd, setDayEnd]                   = useState(settings.day_end)
  const [defaultDuration, setDefaultDuration] = useState(settings.default_duration)
  const [savingHours, setSavingHours]         = useState(false)

  // Independent fresh fetch on mount: professionals list + agenda_settings.
  // This makes Ajustes → Agenda always reflect DB truth, regardless of any
  // stale ClientCtx snapshot.
  useEffect(() => {
    if (!clientId) return
    let alive = true
    Promise.all([
      supabase.from('professionals').select('*').eq('client_id', clientId).order('created_at'),
      fetchClientConfig(clientId),
    ]).then(([{ data: prosData }, { config: fresh }]) => {
      if (!alive) return
      setPros(prosData ?? [])
      setLoading(false)
      const s = fresh?.agenda_settings
      if (s) {
        setDayStart(s.day_start ?? '08:00')
        setDayEnd(s.day_end ?? '20:00')
        setDefaultDuration(s.default_duration ?? 50)
      }
      if (fresh) setConfig(fresh)
    })
    return () => { alive = false }
  }, [clientId])

  useEffect(() => {
    const s = config?.agenda_settings
    if (!s) return
    setDayStart(s.day_start ?? '08:00')
    setDayEnd(s.day_end ?? '20:00')
    setDefaultDuration(s.default_duration ?? 50)
  }, [config])

  async function performDelete(p) {
    setConfirmDel(null)
    const { error } = await supabase.from('professionals').delete().eq('id', p.id)
    if (error) { setToast({ kind: 'err', msg: 'Error al eliminar' }); return }
    setPros(list => list.filter(x => x.id !== p.id))
  }

  async function handleSavedPro(saved, isFirst) {
    setPros(list => {
      const idx = list.findIndex(x => x.id === saved.id)
      if (idx >= 0) { const next = [...list]; next[idx] = saved; return next }
      return [...list, saved]
    })
    if (isFirst) {
      // Migrate orphaned appointments to this default professional
      await supabase.from('appointments')
        .update({ professional_id: saved.id })
        .eq('client_id', clientId)
        .is('professional_id', null)
    }
    setEditing(null)
    setToast({ kind: 'ok', msg: '✓ Guardado' })
    setTimeout(() => setToast(null), 2200)
  }

  async function saveHours() {
    setSavingHours(true)
    const { error, config: nextConfig } = await mergeClientConfig(clientId, {
      agenda_settings: { day_start: dayStart, day_end: dayEnd, default_duration: Number(defaultDuration) },
    })
    setSavingHours(false)
    if (error) { setToast({ kind: 'err', msg: 'Error al guardar' }); return }
    setConfig(nextConfig)
    setToast({ kind: 'ok', msg: '✓ Guardado' })
    setTimeout(() => setToast(null), 2200)
  }

  const limitReached = pros.length >= MAX_PROS

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 880 }}>
      <SettingsHeader title="Agenda" subtitle="Profesionales y configuración general de la agenda" />

      <div style={{ marginTop: 4, marginBottom: 14 }}>
        <SectionLabel icon="user" label={`Profesionales (${pros.length}/${MAX_PROS})`} />
      </div>

      {loading ? (
        <div style={{ padding: 24, color: T.inkMuted, fontStyle: 'italic' }}>cargando…</div>
      ) : (
        <div style={{ background: T.bgRaised, border: `1px solid ${T.line}`, borderRadius: 12, overflow: 'hidden' }}>
          {pros.length === 0 && (
            <div style={{ padding: 20, fontSize: 13, color: T.inkMuted, textAlign: 'center' }}>
              No hay profesionales. Agrega el primero para asignar tus citas existentes.
            </div>
          )}
          {pros.map((p, idx) => (
            <div key={p.id} style={{
              padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14,
              borderBottom: idx < pros.length - 1 ? `1px solid ${T.lineSoft}` : 'none',
            }}>
              <ProAvatar pro={p} size={36} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: T.ink, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {p.full_name}
                  <span title={p.color} style={{ width: 10, height: 10, borderRadius: '50%', background: p.color, border: `1px solid ${T.line}` }} />
                </div>
                <div style={{ fontSize: 11.5, color: T.inkMuted, marginTop: 2 }}>
                  {p.email ?? '— sin email —'} · {availabilitySummary(p.availability)}
                </div>
              </div>
              <button style={btn('ghostSm')} onClick={() => setEditing(p)}>
                <Icon name="edit" size={13} stroke={T.inkSoft} />
              </button>
              <button style={btn('ghostSm')} onClick={() => setConfirmDel(p)} title="Eliminar">
                <Icon name="x" size={13} stroke={T.inkSoft} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <button
          style={{ ...btn('ghost'), opacity: limitReached ? 0.5 : 1, cursor: limitReached ? 'not-allowed' : 'pointer' }}
          onClick={() => !limitReached && setEditing('new')}
          disabled={limitReached}
          title={limitReached ? 'Límite alcanzado' : ''}
        >
          <Icon name="plus" size={13} /> {limitReached ? 'Límite alcanzado' : 'Agregar profesional'}
        </button>
      </div>

      <div style={{ marginTop: 32, marginBottom: 14 }}>
        <SectionLabel icon="cog" label="Configuración general de agenda" />
      </div>

      <div style={{ background: T.bgRaised, border: `1px solid ${T.line}`, borderRadius: 12, padding: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          <div>
            <div style={{ fontSize: 11, color: T.inkMuted, marginBottom: 6, letterSpacing: 0.4, textTransform: 'uppercase' }}>Inicio del día</div>
            <TimePicker value={dayStart} onChange={setDayStart} hourRange={[6, 12]} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: T.inkMuted, marginBottom: 6, letterSpacing: 0.4, textTransform: 'uppercase' }}>Fin del día</div>
            <TimePicker value={dayEnd} onChange={setDayEnd} hourRange={[14, 23]} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: T.inkMuted, marginBottom: 6, letterSpacing: 0.4, textTransform: 'uppercase' }}>Duración por defecto</div>
            <select value={defaultDuration} onChange={e => setDefaultDuration(+e.target.value)} style={textInput}>
              <option value={30}>30 min</option>
              <option value={50}>50 min</option>
              <option value={60}>60 min</option>
            </select>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
        {toast?.kind === 'ok'  && <span style={{ fontSize: 12, color: T.confirmado }}>{toast.msg}</span>}
        {toast?.kind === 'err' && <span style={{ fontSize: 12, color: T.danger }}>{toast.msg}</span>}
        <button style={btn('primary')} onClick={saveHours} disabled={savingHours}>
          {savingHours ? 'Guardando…' : 'Guardar configuración'}
        </button>
      </div>

      {editing && (
        <ProfessionalEditor
          clientId={clientId}
          pro={editing === 'new' ? null : editing}
          isFirst={editing === 'new' && pros.length === 0}
          onClose={() => setEditing(null)}
          onSaved={handleSavedPro}
          defaultName={editing === 'new' ? (config?.bot_name ?? '') : ''}
        />
      )}

      {confirmDel && (
        <ConfirmModal
          title={`¿Eliminar a ${confirmDel.full_name}?`}
          description="Sus citas no se borran pero quedarán sin profesional asignado."
          confirmLabel="Eliminar"
          variant="danger"
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => performDelete(confirmDel)}
        />
      )}
    </div>
  )
}

function ProAvatar({ pro, size = 32 }) {
  const inits = pro.initials || initialsOf(pro.full_name)
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: pro.avatar_url ? T.bgSunk : pro.color,
      color: '#fff', display: 'grid', placeItems: 'center',
      fontFamily: T.sans, fontSize: size * 0.4, fontWeight: 600,
      overflow: 'hidden', border: `1px solid ${T.line}`,
    }}>
      {pro.avatar_url
        ? <img src={pro.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : inits}
    </div>
  )
}

function availabilitySummary(av) {
  if (!av) return 'sin horario'
  const days = DAYS.filter(([k]) => av[k]?.available)
  if (!days.length) return 'sin disponibilidad'
  const labels = days.map(([_, l]) => l.slice(0, 3)).join(', ')
  return labels
}

function ProfessionalEditor({ clientId, pro, isFirst, defaultName, onClose, onSaved }) {
  const [name, setName]     = useState(pro?.full_name ?? defaultName ?? '')
  const [email, setEmail]   = useState(pro?.email ?? '')
  const [color, setColor]   = useState(pro?.color ?? PRO_COLORS[0])
  const [avatarUrl, setAvatarUrl] = useState(pro?.avatar_url ?? '')
  const [pendingFile, setPendingFile] = useState(null)
  const [availability, setAvailability] = useState(pro?.availability ?? DEFAULT_AVAILABILITY)
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)
  const fileRef = React.useRef(null)

  function pickFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setPendingFile(f)
    setAvatarUrl(URL.createObjectURL(f))
  }

  function setDay(key, patch) {
    setAvailability(av => ({ ...av, [key]: { ...av[key], ...patch } }))
  }

  async function uploadAvatar(proId) {
    if (!pendingFile) return null
    const ext = (pendingFile.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `professionals/${proId}.${ext}`
    const { error: upErr } = await supabase.storage.from('avatars').upload(path, pendingFile, { upsert: true, contentType: pendingFile.type })
    if (upErr) return null
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    return `${data.publicUrl}?v=${Date.now()}`
  }

  async function save() {
    if (!name.trim()) { setErr('Nombre requerido'); return }
    if (!email.trim()) { setErr('Email requerido'); return }
    setSaving(true); setErr(null)

    const base = {
      client_id: clientId,
      full_name: name.trim(),
      initials:  initialsOf(name),
      email:     email.trim(),
      color,
      availability,
    }

    let row
    if (pro?.id) {
      const { data, error } = await supabase.from('professionals').update(base).eq('id', pro.id).select().single()
      if (error) { setSaving(false); setErr(error.message); return }
      row = data
    } else {
      const { data, error } = await supabase.from('professionals').insert(base).select().single()
      if (error) { setSaving(false); setErr(error.message); return }
      row = data
    }

    if (pendingFile) {
      const url = await uploadAvatar(row.id)
      if (url) {
        const { data } = await supabase.from('professionals').update({ avatar_url: url }).eq('id', row.id).select().single()
        if (data) row = data
      }
    }

    setSaving(false)
    onSaved(row, isFirst)
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(20,18,14,0.4)',
      display: 'grid', placeItems: 'center', zIndex: 50,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 560, maxHeight: '90vh', overflow: 'auto',
        background: T.bgRaised, borderRadius: 14,
        boxShadow: '0 24px 60px rgba(20,18,14,0.25)',
      }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${T.lineSoft}` }}>
          <div style={{ fontFamily: T.serif, fontSize: 22, color: T.ink }}>
            {pro ? 'Editar profesional' : 'Nuevo profesional'}
          </div>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div onClick={() => fileRef.current?.click()} style={{
              width: 64, height: 64, borderRadius: '50%', cursor: 'pointer',
              background: avatarUrl ? T.bgSunk : color, color: '#fff',
              display: 'grid', placeItems: 'center', fontWeight: 600, fontSize: 22,
              overflow: 'hidden', border: `1px solid ${T.line}`,
            }}>
              {avatarUrl
                ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : initialsOf(name)}
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={pickFile} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: T.inkSoft, marginBottom: 6 }}>Foto de perfil</div>
              <button style={btn('ghost')} onClick={() => fileRef.current?.click()}>
                <Icon name="download" size={13} /> Subir foto
              </button>
            </div>
          </div>

          <Field2 label="Nombre completo">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Dra. Paz Correa" style={textInput} />
          </Field2>
          <Field2 label="Email">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="paz@consultorio.cl" style={textInput} />
          </Field2>

          <Field2 label="Color">
            <div style={{ display: 'flex', gap: 8 }}>
              {PRO_COLORS.map(c => (
                <button key={c} type="button" onClick={() => setColor(c)} style={{
                  width: 30, height: 30, borderRadius: '50%', cursor: 'pointer',
                  background: c, border: color === c ? `3px solid ${T.ink}` : `1px solid ${T.line}`,
                }} />
              ))}
            </div>
          </Field2>

          <div>
            <SectionLabel icon="calendar" label="Disponibilidad semanal" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {DAYS.map(([key, label]) => {
                const d = availability[key] ?? { start: '09:00', end: '18:00', available: false }
                return (
                  <div key={key} style={{
                    display: 'grid', gridTemplateColumns: '90px 60px 1fr 1fr', gap: 10,
                    alignItems: 'center', padding: '6px 0',
                  }}>
                    <div style={{ fontSize: 12.5, color: T.ink }}>{label}</div>
                    <SmallToggle value={d.available} onChange={(v) => setDay(key, { available: v })} />
                    <div style={{ opacity: d.available ? 1 : 0.4, pointerEvents: d.available ? 'auto' : 'none' }}>
                      <TimePicker value={d.start} onChange={(v) => setDay(key, { start: v })} hourRange={[6, 14]} />
                    </div>
                    <div style={{ opacity: d.available ? 1 : 0.4, pointerEvents: d.available ? 'auto' : 'none' }}>
                      <TimePicker value={d.end} onChange={(v) => setDay(key, { end: v })} hourRange={[12, 23]} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {err && <div style={{ fontSize: 12, color: T.danger ?? '#c33' }}>{err}</div>}
        </div>

        <div style={{ padding: '14px 24px', borderTop: `1px solid ${T.lineSoft}`, background: T.bg, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={btn('ghost')} disabled={saving}>Cancelar</button>
          <button onClick={save} style={btn('primary')} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field2({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: T.inkMuted, marginBottom: 6, letterSpacing: 0.4, textTransform: 'uppercase' }}>{label}</div>
      {children}
    </div>
  )
}

function SmallToggle({ value, onChange }) {
  return (
    <div onClick={() => onChange(!value)} style={{
      width: 34, height: 20, borderRadius: 999, cursor: 'pointer',
      background: value ? T.primary : T.line, position: 'relative', transition: 'background .15s',
    }}>
      <div style={{
        position: 'absolute', top: 2, left: value ? 16 : 2,
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,.2)', transition: 'left .15s',
      }} />
    </div>
  )
}

// ───── Templates ─────
function TemplateSettings() {
  const [active, setActive] = useState('confirm')
  const templates = [
    { id: 'confirm',  label: 'Confirmación de cita',  icon: 'check', when: 'Al confirmar una cita' },
    { id: 'reminder', label: 'Recordatorio 24h',      icon: 'bell',  when: '24 horas antes de la sesión' },
    { id: 'missed',   label: 'Sesión no asistida',    icon: 'x',     when: 'Si el paciente no asiste' },
    { id: 'invoice',  label: 'Boleta emitida',        icon: 'card',  when: 'Al emitir una boleta' },
    { id: 'followup', label: 'Seguimiento post-alta', icon: 'chat',  when: '30 días después de la última sesión' },
  ]
  const content = {
    confirm: {
      subject: 'Tu cita con Dra. Paz Correa está confirmada',
      body: `Hola {{nombre_paciente}},\n\nTu cita ha sido confirmada:\n\n  Fecha: {{fecha}}\n  Hora: {{hora}}\n  Modalidad: {{modalidad}}\n\n{{enlace_sesion_online_si_aplica}}\n\nSi necesitas reagendar, responde a este correo o escríbeme por WhatsApp.\n\nUn abrazo,\nDra. Paz Correa`,
    },
  }
  const t = content[active] ?? content.confirm

  return (
    <div style={{ padding: '24px 32px 40px', display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20 }}>
      <div>
        <SettingsHeader title="Plantillas" subtitle="Emails enviados por Resend" compact />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 16 }}>
          {templates.map(tpl => {
            const on = tpl.id === active
            return (
              <div key={tpl.id} onClick={() => setActive(tpl.id)} style={{
                padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                background: on ? T.bgRaised : 'transparent',
                border: `1px solid ${on ? T.lineSoft : 'transparent'}`,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <Icon name={tpl.icon} size={14} stroke={on ? T.primary : T.inkMuted} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, color: T.ink, fontWeight: on ? 500 : 400 }}>{tpl.label}</div>
                  <div style={{ fontSize: 10.5, color: T.inkMuted, marginTop: 1 }}>{tpl.when}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ background: T.bgRaised, border: `1px solid ${T.line}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.lineSoft}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10.5, color: T.inkMuted, letterSpacing: 0.5, textTransform: 'uppercase' }}>Asunto</div>
            <input defaultValue={t.subject} style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 14, color: T.ink, width: '100%', marginTop: 2, fontFamily: T.sans }} />
          </div>
          <button style={btn('ghost')}>Previsualizar</button>
        </div>
        <textarea defaultValue={t.body} rows={14} style={{
          width: '100%', border: 'none', outline: 'none',
          padding: 18, fontFamily: T.sans, fontSize: 13.5, color: T.ink,
          lineHeight: 1.6, background: T.bgRaised, resize: 'none', boxSizing: 'border-box',
        }} />
        <div style={{ padding: 14, borderTop: `1px solid ${T.lineSoft}`, background: T.bgSunk, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, fontSize: 11, color: T.inkMuted, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <span style={{ marginRight: 4 }}>Variables disponibles:</span>
            {['{{nombre_paciente}}','{{fecha}}','{{hora}}','{{modalidad}}','{{enlace_sesion_online_si_aplica}}'].map(v => (
              <code key={v} style={{ fontFamily: T.mono, fontSize: 10.5, padding: '2px 6px', background: T.bgRaised, borderRadius: 4, border: `1px solid ${T.lineSoft}`, color: T.inkSoft }}>{v}</code>
            ))}
          </div>
          <button style={btn('ghost')}>Enviar prueba</button>
          <button style={btn('primary')}>Guardar</button>
        </div>
      </div>
    </div>
  )
}

// ───── Integrations ─────
function IntegrationsSettings() {
  const { config } = useContext(ClientCtx)
  const waConnected     = !!config?.whatsapp_number_id
  const resendConnected = !!config?.resend_from

  const integrations = [
    { k: 'wa',     name: 'WhatsApp Cloud API',  via: waConnected ? (config.whatsapp_number ?? config.whatsapp_number_id) : 'Make.com', status: waConnected ? 'conectado' : 'desconectado', desc: 'Canal principal del bot' },
    { k: 'claude', name: 'Anthropic Claude',    via: 'Sonnet 4.6',    status: 'conectado',    desc: 'Modelo que califica leads' },
    { k: 'resend', name: 'Resend',              via: resendConnected ? config.resend_from : 'Email', status: resendConnected ? 'conectado' : 'desconectado', desc: 'Confirmaciones y recordatorios' },
    { k: 'mp',     name: 'Mercado Pago',        via: 'Checkout API',  status: 'conectado',    desc: 'Cobros electrónicos' },
    { k: 'bsale',  name: 'bsale',               via: 'API',           status: 'conectado',    desc: 'Boletas electrónicas SII' },
    { k: 'gcal',   name: 'Google Calendar',     via: '',              status: 'desconectado', desc: 'Sincroniza agenda externa' },
  ]
  const statusStyles = {
    conectado:    { bg: T.confirmadoSoft, fg: T.confirmado, label: '✓ Conectado' },
    migrando:     { bg: T.warnSoft,       fg: T.warn,       label: '↻ Migrando…' },
    desconectado: { bg: T.bgSunk,         fg: T.inkMuted,   label: 'No conectado' },
  }

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 860 }}>
      <SettingsHeader title="Integraciones" subtitle="Servicios conectados a tu consulta" />
      <div style={{ background: T.bgRaised, border: `1px solid ${T.line}`, borderRadius: 12, overflow: 'hidden' }}>
        {integrations.map((item, idx) => {
          const s = statusStyles[item.status]
          return (
            <div key={item.k} style={{
              padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16,
              borderBottom: idx < integrations.length - 1 ? `1px solid ${T.lineSoft}` : 'none',
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 8,
                background: T.bgSunk, border: `1px solid ${T.lineSoft}`,
                display: 'grid', placeItems: 'center',
                fontFamily: T.serif, fontSize: 16, color: T.primary,
              }}>{item.name[0]}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13.5, color: T.ink, fontWeight: 500 }}>{item.name}</span>
                  {item.via && <span style={{ fontSize: 11, color: T.inkMuted, fontFamily: T.mono }}>· {item.via}</span>}
                </div>
                <div style={{ fontSize: 11.5, color: T.inkMuted, marginTop: 2 }}>{item.desc}</div>
              </div>
              <span style={{ padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 500, background: s.bg, color: s.fg }}>{s.label}</span>
              <button style={{ ...btn('ghostSm'), fontSize: 11.5 }}>
                {item.status === 'desconectado' ? 'Conectar' : 'Configurar'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ───── Plan — read-only, from clients.plan ─────
const PLAN_DETAILS = {
  individual: { label: 'Consulta Individual', price: '$29.990', desc: 'Hasta 100 pacientes activos · Bot ilimitado · Integraciones completas' },
  consulta:   { label: 'Consulta Individual', price: '$29.990', desc: 'Hasta 100 pacientes activos · Bot ilimitado · Integraciones completas' },
  team:       { label: 'Equipo',              price: '$59.990', desc: 'Hasta 5 profesionales · Pacientes ilimitados · Integraciones completas' },
  trial:      { label: 'Prueba gratis',       price: 'Gratis',  desc: '14 días · Hasta 30 pacientes · Bot limitado a 200 conversaciones/mes' },
}

function PlanSettings() {
  const { clientId } = useContext(ClientCtx)
  const [planKey, setPlanKey] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) return
    supabase.from('clients').select('plan').eq('id', clientId).single()
      .then(({ data }) => {
        setPlanKey(data?.plan ?? 'individual')
        setLoading(false)
      })
  }, [clientId])

  const plan = PLAN_DETAILS[planKey] ?? PLAN_DETAILS.individual

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 780 }}>
      <SettingsHeader title="Plan & facturación" subtitle="Tu plan de Consultorio" />
      <div style={{ background: T.primary, color: T.primaryText, borderRadius: 14, padding: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 11, opacity: 0.8, letterSpacing: 0.5, textTransform: 'uppercase' }}>Plan actual</div>
          <div style={{ fontFamily: T.serif, fontSize: 32, lineHeight: 1, marginTop: 6 }}>
            {loading ? '…' : plan.label}
          </div>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 8 }}>{plan.desc}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: T.serif, fontSize: 36, lineHeight: 1 }}>{plan.price}</div>
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>/mes</div>
        </div>
      </div>
      <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <UsageCard k="Pacientes activos"          v="7"   of="100" />
        <UsageCard k="Conversaciones bot (mes)"   v="247" of="∞" />
        <UsageCard k="Emails enviados (mes)"      v="184" of="2.000" />
      </div>
      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 12, color: T.inkMuted }}>
          Método de pago: <span style={{ fontFamily: T.mono, color: T.inkSoft }}>•••• 4729</span> · Mercado Pago
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btn('ghost')}>Ver facturas</button>
          <button style={btn('ghost')}>Cambiar plan</button>
        </div>
      </div>
    </div>
  )
}

// ───── Shared settings primitives ─────
function SettingsHeader({ title, subtitle, right, compact }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      marginBottom: compact ? 8 : 24, paddingBottom: compact ? 0 : 16,
      borderBottom: compact ? 'none' : `1px solid ${T.lineSoft}`,
    }}>
      <div>
        <div style={{ fontFamily: T.serif, fontSize: compact ? 20 : 22, color: T.ink, lineHeight: 1 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: T.inkMuted, marginTop: 6 }}>{subtitle}</div>
      </div>
      {right}
    </div>
  )
}

function FieldRow({ label, hint, children, inline }) {
  return (
    <div style={{
      display: inline ? 'flex' : 'block',
      alignItems: inline ? 'center' : 'stretch',
      justifyContent: inline ? 'space-between' : 'flex-start',
      gap: inline ? 20 : 0,
      padding: '16px 0',
      borderBottom: `1px solid ${T.lineSoft}`,
    }}>
      <div style={{ marginBottom: inline ? 0 : 8, flex: inline ? 1 : 'initial' }}>
        <div style={{ fontSize: 12.5, color: T.ink, fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: 11.5, color: T.inkMuted, marginTop: 3, lineHeight: 1.45, maxWidth: 540 }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

function Toggle({ value, onChange }) {
  return (
    <div onClick={() => onChange(!value)} style={{
      width: 38, height: 22, borderRadius: 999, cursor: 'pointer',
      background: value ? T.primary : T.line,
      position: 'relative', transition: 'background .15s',
    }}>
      <div style={{
        position: 'absolute', top: 2, left: value ? 18 : 2,
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,.2)', transition: 'left .15s',
      }} />
    </div>
  )
}

function ChatBubble({ who, msg }) {
  return (
    <div style={{
      padding: '8px 12px', borderRadius: 12,
      maxWidth: '92%', fontSize: 12.5, lineHeight: 1.45,
      background: who === 'bot' ? T.primarySoft : T.bgRaised,
      color: who === 'bot' ? T.primary : T.ink,
      border: `1px solid ${who === 'bot' ? '#d4e0d4' : T.lineSoft}`,
      alignSelf: who === 'bot' ? 'flex-start' : 'flex-end',
      justifySelf: who === 'bot' ? 'start' : 'end',
      whiteSpace: 'pre-wrap',
    }}>{msg}</div>
  )
}

function UsageCard({ k, v, of: max }) {
  const pct = max === '∞' ? 100 : Math.min(100, Math.round((+v / +max.replace('.', '')) * 100))
  return (
    <div style={{ background: T.bgRaised, border: `1px solid ${T.line}`, borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 10.5, color: T.inkMuted, letterSpacing: 0.5, textTransform: 'uppercase' }}>{k}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
        <span style={{ fontFamily: T.serif, fontSize: 24, color: T.ink }}>{v}</span>
        <span style={{ fontSize: 12, color: T.inkMuted, fontFamily: T.mono }}>/ {max}</span>
      </div>
      <div style={{ marginTop: 8, height: 4, background: T.bgSunk, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: pct + '%', height: '100%', background: T.primary }} />
      </div>
    </div>
  )
}

const textInput = {
  padding: '10px 12px', borderRadius: 8,
  border: `1px solid ${T.line}`, background: T.bg,
  fontSize: 13, color: T.ink, width: '100%', outline: 'none',
  fontFamily: T.sans, boxSizing: 'border-box',
}
