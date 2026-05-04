import React, { useState } from 'react'
import { T, Icon, btn } from '../shared.jsx'
import { SettingsHeader } from './_shared.jsx'

// ───── Templates ─────
export default function TemplateSettings() {
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
