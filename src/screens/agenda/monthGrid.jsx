import React from 'react'
import { T } from '../shared.jsx'
import { TZ, DOW_SHORT, addDays, isSameDay, startOfDay, startOfWeek, daysInMonth, nowChile, statusStyle, hexAlpha, initialsFromName, apptDisplayName, toDateInput } from './_shared.jsx'

export default function MonthGrid({ monthStart, eventsByDate, proById, multi, onSelectAppt, onSelectDay, onCreate }) {
  const firstCell  = startOfWeek(monthStart)
  const totalCells = Math.ceil((((monthStart.getDay() + 6) % 7) + daysInMonth(monthStart)) / 7) * 7
  const cells = Array.from({ length: totalCells }, (_, i) => addDays(firstCell, i))
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
        background: T.bg, border: `1px solid ${T.line}`, borderTopLeftRadius: 12, borderTopRightRadius: 12,
      }}>
        {DOW_SHORT.map(d => (
          <div key={d} style={{
            padding: '10px 8px', textAlign: 'center', fontSize: 10.5, color: T.inkMuted,
            letterSpacing: 0.5, textTransform: 'uppercase', borderLeft: `1px solid ${T.lineSoft}`,
          }}>{d}</div>
        ))}
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
        background: T.bgRaised,
        border: `1px solid ${T.line}`, borderTop: 'none',
        borderBottomLeftRadius: 12, borderBottomRightRadius: 12,
      }}>
        {cells.map((d, i) => {
          const today    = isSameDay(d, nowChile())
          const inMonth  = d.getMonth() === monthStart.getMonth()
          const isPast   = d < startOfDay(nowChile())
          const dayEvts  = eventsByDate[toDateInput(d)] ?? []
          return (
            <div
              key={i}
              onClick={() => {
                if (isPast) return
                if (multi) onSelectDay(startOfDay(d))
                else if (dayEvts.length) onSelectDay(startOfDay(d))
                else onCreate(d)
              }}
              style={{
                minHeight: 92,
                padding: 6,
                borderTop:  i >= 7 ? `1px solid ${T.lineSoft}` : 'none',
                borderLeft: i % 7 ? `1px solid ${T.lineSoft}` : 'none',
                background: today ? T.primarySoft : isPast ? T.bgSunk : (inMonth ? T.bgRaised : T.bg),
                opacity:    isPast ? 0.5 : (inMonth ? 1 : 0.55),
                cursor:     isPast ? 'not-allowed' : 'pointer',
                display: 'flex', flexDirection: 'column', gap: 3,
              }}
            >
              <div style={{
                fontFamily: T.serif, fontSize: 14,
                color: today ? T.primary : T.ink, lineHeight: 1,
              }}>{d.getDate()}</div>
              {dayEvts.slice(0, 3).map(ev => {
                const s = statusStyle(ev.status)
                const pro = proById?.[ev.professional_id]
                const usePro = !!(multi && pro)
                const bg = usePro ? hexAlpha(pro.color, 0.18) : s.bg
                const fg = usePro ? pro.color : s.fg
                const border = usePro ? pro.color : s.border
                const dt = new Date(new Date(ev.datetime).toLocaleString('en-US', { timeZone: TZ }))
                const time = `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`
                const display = apptDisplayName(ev)
                const label = usePro
                  ? `${time} ${pro.initials || initialsFromName(pro.full_name)}`
                  : `${time} ${display}`
                const tooltip = usePro
                  ? `${display} · ${time} · ${pro.full_name}`
                  : `${display} · ${time}`
                const struck = ev.status === 'cancelled'
                return (
                  <div
                    key={ev.id}
                    title={tooltip}
                    onClick={(e) => { e.stopPropagation(); onSelectAppt?.(ev) }}
                    style={{
                      fontSize: 10.5, padding: '2px 5px', borderRadius: 3,
                      background: bg, color: fg,
                      borderLeft: `2px ${s.dashed ? 'dashed' : 'solid'} ${border}`,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      fontWeight: usePro ? 600 : 400,
                      cursor: 'pointer',
                      textDecoration: struck ? 'line-through' : 'none',
                      opacity: ev.status === 'completed' ? 0.6 : 1,
                    }}
                  >
                    {label}
                  </div>
                )
              })}
              {dayEvts.length > 3 && (
                <div style={{ fontSize: 10, color: T.inkMuted }}>+{dayEvts.length - 3} más</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
