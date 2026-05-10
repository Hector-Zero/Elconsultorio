import React from 'react'
import { T } from '../shared.jsx'

function fmtCLP(n) {
  if (n == null || n === '') return '—'
  return '$' + Number(n).toLocaleString('es-CL')
}

// Per-employment session-types toggle. Each row in the centro's catalog
// (public.session_types) renders with an on/off toggle controlling
// whether this employment offers it. No custom-price input — the
// catalog price applies to all pros at the centro.
//
// Props:
//   - catalog: session_types[] for this client
//   - value:   { [session_type_id]: true } map of currently-offered ids
//   - onChange(nextValue): receives the updated map
//   - onNavigateToSettings(): empty-state CTA target (Servicios y Sesiones)
//   - disabled: boolean

export default function SessionTypesSection({ catalog, value, onChange, onNavigateToSettings, disabled }) {
  const offered = value ?? {}
  const list    = catalog ?? []

  if (list.length === 0) {
    return (
      <div style={{
        padding: 22, background: T.bgSunk, border: `1px dashed ${T.line}`, borderRadius: 10,
      }}>
        <button
          onClick={onNavigateToSettings}
          disabled={disabled}
          style={{
            background: 'transparent', border: 'none', padding: 0,
            color: T.primary, fontFamily: T.sans, fontSize: 13,
            cursor: disabled ? 'not-allowed' : 'pointer',
            textAlign: 'left', lineHeight: 1.5,
          }}
        >
          Aún no has definido tipos de sesión en este centro.
          Configúralos en Servicios y Sesiones →
        </button>
      </div>
    )
  }

  function toggle(stId) {
    const next = { ...offered }
    if (next[stId]) delete next[stId]
    else            next[stId] = true
    onChange(next)
  }

  return (
    <div style={{ background: T.bgRaised, border: `1px solid ${T.line}`, borderRadius: 10, overflow: 'hidden' }}>
      {list.map((st, idx) => {
        const on   = !!offered[st.id]
        const last = idx === list.length - 1
        return (
          <div key={st.id} style={{
            padding: '12px 16px',
            display: 'grid', gridTemplateColumns: '40px 1fr', gap: 12, alignItems: 'center',
            borderBottom: last ? 'none' : `1px solid ${T.lineSoft}`,
          }}>
            <Toggle value={on} onChange={() => toggle(st.id)} disabled={disabled} />
            <div>
              <div style={{ fontSize: 13, color: T.ink, fontWeight: 500 }}>{st.name}</div>
              <div style={{ fontSize: 11.5, color: T.inkMuted, marginTop: 2 }}>
                {fmtCLP(st.price_amount)} {st.price_currency ?? 'CLP'}
              </div>
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
