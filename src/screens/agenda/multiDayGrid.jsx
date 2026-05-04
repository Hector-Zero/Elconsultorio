import React from 'react'
import { T } from '../shared.jsx'
import { TZ, HOURS, isSameDay, nowChile } from './_shared.jsx'
import EventBlock from './eventBlock.jsx'
import { ProAvatarSm } from './proSelector.jsx'

// Multi-column day view: one column per professional
export default function MultiDayGrid({ day, pros, appts, onSelectAppt, onCreate, now, isToday }) {
  const dowKey = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'][(day.getDay() + 6) % 7]
  const apptByPro = {}
  appts.forEach(a => {
    if (!a.professional_id) return
    const dt = new Date(new Date(a.datetime).toLocaleString('en-US', { timeZone: TZ }))
    if (!isSameDay(dt, day)) return
    const hour = String(dt.getHours()).padStart(2, '0')
    const k = `${a.professional_id}-${hour}`
    ;(apptByPro[k] ??= []).push(a)
  })
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: `60px repeat(${pros.length}, 1fr)`,
      background: T.bgRaised, border: `1px solid ${T.line}`,
      borderRadius: 12, marginTop: 16, overflow: 'visible',
    }}>
      <div style={{ borderBottom: `1px solid ${T.line}`, background: T.bg }} />
      {pros.map(p => (
        <div key={p.id} style={{
          padding: '12px 10px', textAlign: 'center',
          borderBottom: `1px solid ${T.line}`, borderLeft: `1px solid ${T.lineSoft}`,
          background: T.bg,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <ProAvatarSm pro={p} size={22} />
            <span style={{ fontSize: 12.5, color: T.ink, fontWeight: 500 }}>{p.full_name}</span>
          </div>
          <div style={{ marginTop: 4, height: 3, borderRadius: 2, background: p.color }} />
        </div>
      ))}

      {HOURS.map(h => (
        <React.Fragment key={h}>
          <div style={{
            padding: '0 10px', height: 56,
            borderBottom: `1px solid ${T.lineSoft}`,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
            paddingTop: 4, fontSize: 10.5, color: T.inkMuted, fontFamily: T.mono,
          }}>{h}:00</div>
          {pros.map(p => {
            const ev = (apptByPro[`${p.id}-${h}`] ?? [])[0]
            const ranges = p.availability?.[dowKey]
            const hr = parseInt(h, 10)
            // A cell at hour `hr` is available if any schedule range covers it.
            // Hour granularity (matches the legacy semantics): hr is in if
            // hr >= floor(start) and hr < floor(end).
            const inAvail = Array.isArray(ranges) && ranges.some(r => {
              const startH = parseInt((r.start ?? '00:00').split(':')[0], 10)
              const endH   = parseInt((r.end   ?? '23:59').split(':')[0], 10)
              return hr >= startH && hr < endH
            })
            const slotDt = new Date(day); slotDt.setHours(hr, 0, 0, 0)
            const isPast = slotDt < nowChile()
            const blocked = !inAvail || isPast
            return (
              <div
                key={p.id + h}
                onClick={() => !ev && !blocked && onCreate(day, h, p.id)}
                style={{
                  height: 56,
                  borderBottom: `1px solid ${T.lineSoft}`,
                  borderLeft:   `1px solid ${T.lineSoft}`,
                  background: !inAvail ? T.bgSunk : (isPast ? T.bgSunk : T.bgRaised),
                  opacity: blocked && !ev ? 0.45 : 1,
                  cursor: ev ? 'default' : blocked ? 'not-allowed' : 'pointer',
                  position: 'relative', padding: 4,
                }}
              >
                {ev && (
                  <EventBlock
                    ev={ev}
                    pro={p}
                    multi={false}
                    onClick={() => onSelectAppt?.(ev)}
                  />
                )}
              </div>
            )
          })}
        </React.Fragment>
      ))}
    </div>
  )
}
