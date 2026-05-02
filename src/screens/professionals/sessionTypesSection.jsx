import React from 'react'
import { T } from '../shared.jsx'

const textInput = {
  padding: '8px 10px', borderRadius: 6,
  border: `1px solid ${T.line}`, background: T.bg,
  fontSize: 12.5, color: T.ink, outline: 'none',
  fontFamily: T.mono, boxSizing: 'border-box', width: '100%',
}

function fmtCLP(n) {
  if (n == null || n === '') return '—'
  return '$' + Number(n).toLocaleString('es-CL')
}

export default function SessionTypesSection({ catalog, value, onChange, onNavigateToSettings, disabled }) {
  const offered = value ?? {}
  const list    = catalog ?? []

  if (list.length === 0) {
    return (
      <div style={{
        padding: 22, background: T.bgSunk, border: `1px dashed ${T.line}`, borderRadius: 10,
        display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start',
      }}>
        <div style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.5 }}>
          No hay servicios definidos. Crea servicios en{' '}
          <button
            onClick={onNavigateToSettings}
            style={{
              background: 'transparent', border: 'none', padding: 0,
              color: T.primary, fontFamily: T.sans, fontSize: 13,
              cursor: 'pointer', textDecoration: 'underline',
            }}
          >Ajustes → Servicios y Sesiones</button>.
        </div>
      </div>
    )
  }

  function toggle(stId) {
    const cur = offered[stId] ?? { active: false, custom_price_amount: null }
    onChange({ ...offered, [stId]: { ...cur, active: !cur.active } })
  }
  function setCustomPrice(stId, raw) {
    const cur = offered[stId] ?? { active: true, custom_price_amount: null }
    const next = raw === '' ? null : Number(raw)
    onChange({ ...offered, [stId]: { ...cur, custom_price_amount: Number.isNaN(next) ? null : next } })
  }

  return (
    <div style={{ background: T.bgRaised, border: `1px solid ${T.line}`, borderRadius: 10, overflow: 'hidden' }}>
      {list.map((st, idx) => {
        const row     = offered[st.id] ?? { active: false, custom_price_amount: null }
        const on      = !!row.active
        const last    = idx === list.length - 1
        return (
          <div key={st.id} style={{
            padding: '12px 16px',
            display: 'grid', gridTemplateColumns: '40px 1fr 160px', gap: 12, alignItems: 'center',
            borderBottom: last ? 'none' : `1px solid ${T.lineSoft}`,
          }}>
            <Toggle value={on} onChange={() => toggle(st.id)} disabled={disabled} />
            <div>
              <div style={{ fontSize: 13, color: T.ink, fontWeight: 500 }}>{st.name}</div>
              <div style={{ fontSize: 11.5, color: T.inkMuted, marginTop: 2 }}>
                Default: {fmtCLP(st.price_amount)} {st.price_currency ?? 'CLP'}
              </div>
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              opacity: on ? 1 : 0.4, pointerEvents: on ? 'auto' : 'none',
            }}>
              <span style={{ color: T.inkMuted, fontSize: 11 }}>$</span>
              <input
                type="number"
                min="0"
                value={row.custom_price_amount ?? ''}
                onChange={e => setCustomPrice(st.id, e.target.value)}
                placeholder="Precio personalizado"
                disabled={disabled || !on}
                style={textInput}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Toggle({ value, onChange, disabled }) {
  return (
    <div onClick={() => !disabled && onChange(!value)} style={{
      width: 34, height: 20, borderRadius: 999,
      cursor: disabled ? 'not-allowed' : 'pointer',
      background: value ? T.primary : T.line,
      position: 'relative', transition: 'background .15s',
      opacity: disabled ? 0.5 : 1,
    }}>
      <div style={{
        position: 'absolute', top: 2, left: value ? 16 : 2,
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,.2)', transition: 'left .15s',
      }} />
    </div>
  )
}
