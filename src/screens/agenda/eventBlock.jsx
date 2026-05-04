import React from 'react'
import { T } from '../shared.jsx'
import { TZ, STATUS_LABELS, statusStyle, hexAlpha, initialsFromName, apptDisplayName, apptServiceShort } from './_shared.jsx'

export default function EventBlock({ ev, pro, multi, onClick }) {
  const s = statusStyle(ev.status)
  const usePro = !!(multi && pro)
  const bg     = usePro ? hexAlpha(pro.color, 0.18) : s.bg
  const border = usePro ? pro.color : s.border
  const fg     = usePro ? pro.color : s.fg
  const name   = apptDisplayName(ev)
  const display = usePro ? (pro.initials || initialsFromName(pro.full_name)) : name
  const service = apptServiceShort(ev)
  const dt = new Date(new Date(ev.datetime).toLocaleString('en-US', { timeZone: TZ }))
  const time = `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`
  const tooltip = `${name} · ${time}${service ? ` · ${service}` : ''}${pro ? ` · ${pro.full_name}` : ''} · ${STATUS_LABELS[ev.status] ?? ev.status}`
  const struck    = ev.status === 'cancelled'
  const completed = ev.status === 'completed'
  return (
    <div style={{ position: 'relative', height: '100%' }} title={tooltip}>
      <div
        onClick={(e) => { e.stopPropagation(); onClick?.() }}
        style={{
          height: '100%', padding: '6px 8px', borderRadius: 6,
          background: bg,
          borderLeft: `3px ${s.dashed ? 'dashed' : 'solid'} ${border}`,
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          cursor: 'pointer',
          opacity: completed ? 0.55 : 1,
          textDecoration: struck ? 'line-through' : 'none',
        }}
      >
        <div style={{ fontSize: 11.5, fontWeight: 600, color: fg, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {display}
        </div>
        <div style={{ fontSize: 10, color: s.fg, opacity: 0.85, display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span>{ev.duration ?? 50}m</span>
          {service && <><span>·</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{service}</span></>}
        </div>
      </div>

      {/* Status overlays — small badges in the corner */}
      {ev.status === 'pending_payment' && (
        <span title="Pago pendiente" style={{
          position: 'absolute', top: 2, right: 2,
          fontSize: 9, fontWeight: 700, lineHeight: 1,
          padding: '2px 4px', borderRadius: 3,
          background: T.accent, color: '#fff',
        }}>$</span>
      )}
      {ev.status === 'no_show' && (
        <span title="No asistió" style={{
          position: 'absolute', top: 2, right: 2,
          fontSize: 9, fontWeight: 700, lineHeight: 1,
          padding: '2px 5px', borderRadius: 3,
          background: T.danger, color: '#fff',
        }}>!</span>
      )}
    </div>
  )
}
