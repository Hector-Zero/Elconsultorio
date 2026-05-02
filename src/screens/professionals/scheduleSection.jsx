import React from 'react'
import { T, Icon } from '../shared.jsx'
import TimeSelect from '../../components/TimeSelect.jsx'

// Postgres convention: 0 = Sunday, 1 = Monday … 6 = Saturday.
// We display Mon → Sun (Chilean week), but persist with these values.
export const DAYS = [
  { value: 1, label: 'Lunes',     short: 'Lun' },
  { value: 2, label: 'Martes',    short: 'Mar' },
  { value: 3, label: 'Miércoles', short: 'Mié' },
  { value: 4, label: 'Jueves',    short: 'Jue' },
  { value: 5, label: 'Viernes',   short: 'Vie' },
  { value: 6, label: 'Sábado',    short: 'Sáb' },
  { value: 0, label: 'Domingo',   short: 'Dom' },
]

let _keySeq = 0
function nextKey() { return `r${++_keySeq}_${Date.now()}` }

export function newRange(day_of_week) {
  return { _key: nextKey(), day_of_week, start_time: '09:00', end_time: '13:00' }
}

export default function ScheduleSection({ value, onChange }) {
  const ranges = value ?? []

  function addRange(day) {
    onChange([...ranges, newRange(day)])
  }
  function updateRange(key, patch) {
    onChange(ranges.map(r => r._key === key ? { ...r, ...patch } : r))
  }
  function removeRange(key) {
    onChange(ranges.filter(r => r._key !== key))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {DAYS.map(day => {
        const dayRanges = ranges.filter(r => r.day_of_week === day.value)
        return (
          <div key={day.value} style={{
            display: 'grid', gridTemplateColumns: '90px 1fr', gap: 14,
            alignItems: 'flex-start', padding: '10px 0',
            borderBottom: `1px solid ${T.lineSoft}`,
          }}>
            <div style={{ fontSize: 13, color: T.ink, paddingTop: 6 }}>{day.label}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {dayRanges.length === 0 && (
                <div style={{ fontSize: 12.5, color: T.inkFaint, fontStyle: 'italic', padding: '4px 0' }}>
                  No atiende
                </div>
              )}
              {dayRanges.map(r => (
                <div key={r._key} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <TimeSelect
                    value={r.start_time}
                    onChange={v => updateRange(r._key, { start_time: v })}
                  />
                  <span style={{ color: T.inkMuted, fontSize: 12 }}>a</span>
                  <TimeSelect
                    value={r.end_time}
                    onChange={v => updateRange(r._key, { end_time: v })}
                  />
                  <button
                    onClick={() => removeRange(r._key)}
                    title="Eliminar tramo"
                    style={{
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: T.inkMuted, padding: 4, marginLeft: 2,
                    }}
                  ><Icon name="x" size={13} stroke={T.inkMuted} /></button>
                </div>
              ))}
              <button
                onClick={() => addRange(day.value)}
                style={{
                  alignSelf: 'flex-start',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: T.primary, fontSize: 12, padding: '4px 0',
                  fontFamily: T.sans, display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                <Icon name="plus" size={11} stroke={T.primary} />
                Agregar tramo
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
