import React from 'react'
import { T, Icon, initials } from '../shared.jsx'
import { DAYS } from './scheduleSection.jsx'

// ───── Card in the list ─────
export default function ProCard({ pro, workingDays, onClick, onDelete }) {
  const photo = pro.photo_url || pro.avatar_url
  const days  = workingDays
    ? DAYS.filter(d => workingDays.has(d.value)).map(d => d.short)
    : []
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '14px 16px', borderRadius: 12,
        background: T.bgRaised, border: `1px solid ${T.line}`,
        cursor: 'pointer', transition: 'border-color 120ms',
      }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: '50%',
        background: photo ? T.bgSunk : (pro.color || T.primary), color: '#fff',
        display: 'grid', placeItems: 'center',
        fontSize: 16, fontWeight: 600, fontFamily: T.sans,
        overflow: 'hidden', flexShrink: 0, border: `1px solid ${T.line}`,
      }}>
        {photo
          ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : initials(pro.full_name)}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, color: T.ink, fontWeight: 500 }}>{pro.full_name || '— sin nombre —'}</span>
          <span title={pro.active ? 'Activo' : 'Inactivo'} style={{
            width: 8, height: 8, borderRadius: '50%',
            background: pro.active ? T.confirmado : T.inkFaint,
            boxShadow: pro.active ? `0 0 0 3px ${T.confirmadoSoft}` : 'none',
            flexShrink: 0,
          }} />
        </div>
        <div style={{ fontSize: 11.5, color: T.inkMuted, marginTop: 3 }}>
          {pro.email || '— sin email —'}
        </div>
        <div style={{ fontSize: 11, color: T.inkMuted, marginTop: 3, fontFamily: T.mono }}>
          {days.length ? days.join(' · ') : 'Sin horario configurado'}
        </div>
      </div>

      <button
        onClick={e => { e.stopPropagation(); onDelete?.() }}
        title="Eliminar"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: T.inkMuted, padding: 6, borderRadius: 6,
        }}
      ><Icon name="x" size={14} stroke={T.inkMuted} /></button>
    </div>
  )
}
