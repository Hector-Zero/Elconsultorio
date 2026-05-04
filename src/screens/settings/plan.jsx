import React, { useState, useEffect, useContext } from 'react'
import { T, btn } from '../shared.jsx'
import { ClientCtx } from '../../lib/ClientCtx.js'
import { supabase } from '../../lib/supabase.js'
import { SettingsHeader } from './_shared.jsx'

// ───── Plan — read-only, from clients.plan ─────
const PLAN_DETAILS = {
  individual: { label: 'Consulta Individual', price: '$29.990', desc: 'Hasta 100 pacientes activos · Bot ilimitado · Integraciones completas' },
  consulta:   { label: 'Consulta Individual', price: '$29.990', desc: 'Hasta 100 pacientes activos · Bot ilimitado · Integraciones completas' },
  team:       { label: 'Equipo',              price: '$59.990', desc: 'Hasta 5 profesionales · Pacientes ilimitados · Integraciones completas' },
  trial:      { label: 'Prueba gratis',       price: 'Gratis',  desc: '14 días · Hasta 30 pacientes · Bot limitado a 200 conversaciones/mes' },
}

export default function PlanSettings() {
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
