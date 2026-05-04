import React, { useState, useEffect, useContext } from 'react'
import { T, Icon, btn, SectionLabel } from '../shared.jsx'
import { ClientCtx } from '../../lib/ClientCtx.js'
import { supabase } from '../../lib/supabase.js'
import { mergeClientConfig } from '../../lib/clientConfig.js'
import { SettingsHeader, FieldRow, Toggle, textInput } from './_shared.jsx'

// ───── Bot config — wired to agents_config + clients.config ─────
export default function BotConfig() {
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
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')

      const r = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 500,
            system: systemPrompt || undefined,
            messages: next,
          }),
        }
      )
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
