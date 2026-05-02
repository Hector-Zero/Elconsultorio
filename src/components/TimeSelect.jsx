import React from 'react'
import { T } from '../screens/shared.jsx'

// Two side-by-side dropdowns: hour (00–23) and minute (00, 15, 30, 45).
// 24-hour, two-digit, zero-padded. Matches the dashboard aesthetic so the
// schedule editor renders consistently across browsers (no native time
// picker AM/PM clipping).
const HOURS   = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = ['00', '15', '30', '45']

function splitHHMM(value) {
  const m = String(value ?? '').match(/^(\d{2}):(\d{2})/)
  if (!m) return ['09', '00']
  let mm = m[2]
  // Snap free-form minutes (e.g. legacy "09:07") to the nearest 15-minute
  // bucket so the dropdown still reflects the saved value.
  if (!MINUTES.includes(mm)) {
    const n = parseInt(mm, 10) || 0
    const nearest = MINUTES
      .map(x => ({ x, d: Math.abs(parseInt(x, 10) - n) }))
      .sort((a, b) => a.d - b.d)[0].x
    mm = nearest
  }
  return [m[1], mm]
}

const selectStyle = {
  appearance:    'none',
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  padding:       '6px 24px 6px 10px',
  borderRadius:  6,
  border:        `1px solid ${T.line}`,
  background:    T.bg,
  fontSize:      13,
  color:         T.ink,
  fontFamily:    T.mono,
  outline:       'none',
  cursor:        'pointer',
  // Custom caret SVG (subtle dark-on-light triangle).
  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'><path d='M2 4l3 3 3-3' fill='none' stroke='%238a8f86' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/></svg>")`,
  backgroundRepeat:   'no-repeat',
  backgroundPosition: 'right 8px center',
  backgroundSize:     '10px 10px',
}

export default function TimeSelect({ value, onChange, disabled }) {
  const [hh, mm] = splitHHMM(value)

  function setHH(next) { onChange(`${next}:${mm}`) }
  function setMM(next) { onChange(`${hh}:${next}`) }

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      opacity: disabled ? 0.5 : 1,
    }}>
      <select
        value={hh}
        onChange={e => setHH(e.target.value)}
        disabled={disabled}
        aria-label="Hora"
        style={selectStyle}
      >
        {HOURS.map(h => <option key={h} value={h}>{h}</option>)}
      </select>
      <span style={{ color: T.inkMuted, fontFamily: T.mono, fontSize: 13 }}>:</span>
      <select
        value={mm}
        onChange={e => setMM(e.target.value)}
        disabled={disabled}
        aria-label="Minutos"
        style={selectStyle}
      >
        {MINUTES.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
    </div>
  )
}
