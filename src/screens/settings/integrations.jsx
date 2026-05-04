import React, { useContext } from 'react'
import { T, btn } from '../shared.jsx'
import { ClientCtx } from '../../lib/ClientCtx.js'
import { SettingsHeader } from './_shared.jsx'

// ───── Integrations ─────
export default function IntegrationsSettings() {
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
