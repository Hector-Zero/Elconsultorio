import React, { useState, useEffect, useRef } from 'react'
import { T } from '../shared.jsx'
import { DOW_SHORT, HOURS, isSameDay, startOfDay, nowChile } from './_shared.jsx'
import EventBlock from './eventBlock.jsx'
import { ProAvatarSm } from './proSelector.jsx'

export default function HoursGrid({ days, eventsByCell, proById, multi, singlePro, onSelectAppt, onCreate, onSelectDay, showNowLine, isToday, now, viewedDay }) {
  const n = days.length
  const headerRef = useRef(null)
  const [headerH, setHeaderH] = useState(0)
  useEffect(() => {
    if (headerRef.current) setHeaderH(headerRef.current.getBoundingClientRect().height)
  }, [n])
  const startH = parseInt(HOURS[0], 10)
  const endH   = parseInt(HOURS[HOURS.length - 1], 10) + 1
  const totalGridH = HOURS.length * 56
  const isPastDay   = viewedDay && viewedDay < startOfDay(nowChile())
  const isFutureDay = viewedDay && !isToday && !isPastDay
  let nowOff = 0
  if (showNowLine) {
    if (isPastDay)         nowOff = totalGridH - 1
    else if (isFutureDay)  nowOff = 0
    else if (isToday && now) {
      const h = now.getHours() + now.getMinutes() / 60
      nowOff = Math.max(0, Math.min(totalGridH - 1, (h - startH) * 56))
    }
  }
  const showLine = !!showNowLine
  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
    <div style={{
      display: 'grid',
      gridTemplateColumns: `60px repeat(${n}, 1fr)`,
      background: T.bgRaised,
      border: `1px solid ${T.line}`,
      borderRadius: 12, marginTop: 16, overflow: 'visible',
    }}>
      <div ref={headerRef} style={{ borderBottom: `1px solid ${T.line}`, background: T.bg }} />
      {days.map((d, i) => {
        const today = isSameDay(d, nowChile())
        const dowIdx = (d.getDay() + 6) % 7
        return (
          <div key={i} style={{
            padding: '12px 10px',
            borderBottom: `1px solid ${T.line}`,
            borderLeft: `1px solid ${T.lineSoft}`,
            background: today ? T.primarySoft : T.bg,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 10.5, color: today ? T.primary : T.inkMuted, letterSpacing: 0.5, textTransform: 'uppercase' }}>{DOW_SHORT[dowIdx]}</div>
            <div style={{ fontFamily: T.serif, fontSize: 22, color: today ? T.primary : T.ink, marginTop: 2, lineHeight: 1 }}>{d.getDate()}</div>
            {singlePro && n === 1 && (
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <ProAvatarSm pro={singlePro} />
                <span style={{ fontSize: 11, color: T.inkSoft }}>{singlePro.full_name}</span>
              </div>
            )}
          </div>
        )
      })}

      {HOURS.map(h => (
        <React.Fragment key={h}>
          <div style={{
            padding: '0 10px', height: 56,
            borderBottom: `1px solid ${T.lineSoft}`,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
            paddingTop: 4, fontSize: 10.5, color: T.inkMuted, fontFamily: T.mono,
          }}>{h}:00</div>
          {days.map((dayDate, di) => {
            const cellKey = n === 1 ? `0-${h}` : `${(dayDate.getDay() + 6) % 7}-${h}`
            const ev      = (eventsByCell[cellKey] ?? [])[0]
            const nowSantiago = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago' }))
            const today   = isSameDay(dayDate, nowSantiago)
            const slotDt  = new Date(dayDate); slotDt.setHours(parseInt(h,10), 0, 0, 0)
            const isPast  = slotDt < nowSantiago
            return (
              <div
                key={di + h}
                onClick={() => {
                  if (ev || isPast) return
                  if (onSelectDay) onSelectDay(startOfDay(dayDate))
                  else onCreate(dayDate, h)
                }}
                style={{
                  height: 56,
                  borderBottom: `1px solid ${T.lineSoft}`,
                  borderLeft:   `1px solid ${T.lineSoft}`,
                  background: ev ? (today ? '#fcfbf7' : T.bgRaised) : isPast ? T.bgSunk : (today ? '#fcfbf7' : T.bgRaised),
                  opacity:    isPast && !ev ? 0.55 : 1,
                  cursor: ev ? 'default' : isPast ? 'not-allowed' : 'pointer',
                  position: 'relative', padding: 4,
                }}
              >
                {ev && (
                  <EventBlock
                    ev={ev}
                    pro={proById?.[ev.professional_id]}
                    multi={multi}
                    onClick={() => onSelectAppt?.(ev)}
                  />
                )}
              </div>
            )
          })}
        </React.Fragment>
      ))}
    </div>
    {showLine && headerH > 0 && (
      <div style={{
        position: 'absolute',
        top: 16 + headerH + nowOff,
        left: 60, right: 0,
        height: 0, borderTop: '1px solid #d6453a',
        pointerEvents: 'none', zIndex: 5,
      }}>
        <div style={{
          position: 'absolute', left: -3, top: -2.5,
          width: 5, height: 5, borderRadius: '50%', background: '#d6453a',
        }} />
      </div>
    )}
    </div>
  )
}
