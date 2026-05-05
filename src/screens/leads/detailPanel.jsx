import React from 'react'
import { T, Icon, btn, StatusPill, SectionLabel, timeAgo } from '../shared.jsx'
import { leadDisplayName, phoneOf, LeadAvatar } from './_shared.jsx'

// ── Detail panel ─────────────────────────────────────────────────────

export default function DetailPanel({ lead, status, botPaused, onToggleBot }) {
  return (
    <div style={{ background: T.bgRaised, display: 'flex', flexDirection: 'column', overflow: 'auto', minHeight: 0, fontFamily: T.sans, position: 'relative' }}>
      <div style={{ padding: '24px 24px 20px', borderBottom: `1px solid ${T.lineSoft}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <LeadAvatar lead={lead} size={52} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: T.serif, fontSize: 22, color: T.ink, lineHeight: 1.15, letterSpacing: -0.2 }}>
              {leadDisplayName(lead)}
            </div>
            <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, fontFamily: T.mono, fontSize: 12, color: T.inkMuted }}>
              {phoneOf(lead)}
              {lead.last_updated && <>
                <span style={{ width: 3, height: 3, borderRadius: '50%', background: T.inkFaint }} />
                {timeAgo(lead.last_updated)}
              </>}
            </div>
            <div style={{ marginTop: 10 }}><StatusPill status={status} /></div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 18 }}>
          <button style={btn('soft')}><Icon name="wa" size={14} stroke={T.primary} /> Responder</button>
          <button style={btn('soft')}><Icon name="calendar" size={14} stroke={T.primary} /> Agendar</button>
          <button style={btn('soft')}><Icon name="user" size={14} stroke={T.primary} /> Crear ficha</button>
        </div>
      </div>

      {/* bot toggle */}
      <div style={{
        margin: '16px 24px 0', padding: '12px 14px', borderRadius: 10,
        background: botPaused ? T.accentSoft : T.primarySoft,
        border: `1px solid ${botPaused ? '#e8d4c6' : '#d4e0d4'}`,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: botPaused ? T.accent : T.primary, display: 'grid', placeItems: 'center', color: T.primaryText }}>
          <Icon name={botPaused ? 'pause' : 'sparkle'} size={15} stroke={T.primaryText} fill={botPaused ? T.primaryText : 'none'} />
        </div>
        <div style={{ flex: 1, lineHeight: 1.3 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: T.ink }}>{botPaused ? 'Bot pausado' : 'Bot respondiendo'}</div>
          <div style={{ fontSize: 11, color: T.inkMuted, marginTop: 1 }}>{botPaused ? 'Tú estás atendiendo esta conversación' : 'Respuestas automáticas en WhatsApp'}</div>
        </div>
        <button onClick={onToggleBot} style={{
          border: `1px solid ${botPaused ? T.accent : T.primary}`,
          background: 'transparent', color: botPaused ? T.accent : T.primary,
          padding: '6px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 500, cursor: 'pointer', fontFamily: T.sans,
        }}>
          {botPaused ? 'Reactivar' : 'Pausar'}
        </button>
      </div>

      {/* conversation context */}
      {lead.conversation_context && (
        <div style={{ padding: '18px 24px 6px' }}>
          <SectionLabel icon="sparkle" label="Resumen del bot" />
          <div style={{
            padding: '14px 16px', borderRadius: 10,
            background: T.bgRaised, border: `1px solid ${T.lineSoft}`,
            fontSize: 13, color: T.ink, lineHeight: 1.55,
            fontStyle: 'italic', fontFamily: T.serif,
          }}>
            {lead.conversation_context}
          </div>
        </div>
      )}

      {/* details grid */}
      <div style={{ padding: '18px 24px 6px' }}>
        <SectionLabel icon="file" label="Detalles" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, border: `1px solid ${T.lineSoft}`, borderRadius: 10, overflow: 'hidden' }}>
          <Cell k="Fase"     v={lead.phase ?? '—'} />
          <Cell k="Mensajes" v={<span style={{ fontFamily: T.mono }}>{lead.message_count ?? 0}</span>} />
          <Cell k="Chat ID"  v={<span style={{ fontFamily: T.mono, fontSize: 11.5 }}>{lead.chat_id}</span>} />
          <Cell k="Calidad"  v={lead.qualified_lead ? 'Calificado' : 'Sin calificar'} />
          {lead.appointment && (
            <Cell k="Cita" v={`${lead.appointment.date} · ${lead.appointment.time}`} span={2} />
          )}
        </div>
      </div>

      {lead.tags?.length > 0 && (
        <div style={{ padding: '18px 24px 6px' }}>
          <SectionLabel icon="filter" label="Etiquetas" />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {lead.tags.map(t => (
              <span key={t} style={{ padding: '4px 10px', borderRadius: 999, background: T.bgSunk, color: T.inkSoft, fontSize: 11.5, border: `1px solid ${T.lineSoft}` }}>{t}</span>
            ))}
          </div>
        </div>
      )}

      <div style={{ flex: 1 }} />

      <div style={{ padding: '14px 24px', borderTop: `1px solid ${T.lineSoft}`, background: T.bg, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
        <button style={{ ...btn('ghostSm'), color: T.inkMuted }}>Marcar como descartado</button>
        <button style={btn('primary')}>Convertir a paciente <Icon name="arrow" size={12} stroke="#fff" /></button>
      </div>
    </div>
  )
}

function Cell({ k, v, span = 1 }) {
  return (
    <div style={{
      padding: '11px 14px',
      gridColumn: span === 2 ? '1 / -1' : 'auto',
      borderBottom: `1px solid ${T.lineSoft}`,
      borderRight: span === 2 ? 'none' : `1px solid ${T.lineSoft}`,
    }}>
      <div style={{ fontSize: 10.5, color: T.inkMuted, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 3 }}>{k}</div>
      <div style={{ fontSize: 13, color: T.ink }}>{v}</div>
    </div>
  )
}
