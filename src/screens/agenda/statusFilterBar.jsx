import React from 'react'
import { T } from '../shared.jsx'
import { APPT_STATUS } from './citaModal'
import { statusStyle } from './_shared.jsx'

export default function StatusFilterBar({ statusFilter, onToggle, showCancelled, onToggleCancelled }) {
  return (
    <div style={{
      padding: '10px 24px', borderBottom: `1px solid ${T.line}`, background: T.bg,
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    }}>
      <div style={{
        fontSize: 10.5, color: T.inkMuted, letterSpacing: 0.5, textTransform: 'uppercase',
        marginRight: 4,
      }}>Estados</div>
      {APPT_STATUS.filter(s => s.value !== 'cancelled').map(s => {
        const on = statusFilter.has(s.value)
        const sty = statusStyle(s.value)
        return (
          <button
            key={s.value}
            onClick={() => onToggle(s.value)}
            style={{
              border: `1px ${sty.dashed ? 'dashed' : 'solid'} ${on ? sty.border : T.line}`,
              background: on ? sty.bg : 'transparent',
              color: on ? sty.fg : T.inkMuted,
              padding: '4px 10px', borderRadius: 999,
              fontSize: 11.5, fontWeight: 500, fontFamily: T.sans,
              cursor: 'pointer',
            }}
          >{s.label}</button>
        )
      })}

      <div style={{ flex: 1 }} />

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.inkSoft, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={showCancelled}
          onChange={onToggleCancelled}
          style={{ accentColor: T.primary }}
        />
        Mostrar canceladas
      </label>
    </div>
  )
}
