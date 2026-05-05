import React from 'react'
import { T } from '../../shared.jsx'

// ── Constants ────────────────────────────────────────────────────────────────

export const APPT_STATUS = [
  { value: 'pending_payment', label: 'Pago pendiente' },
  { value: 'confirmed',       label: 'Confirmada' },
  { value: 'completed',       label: 'Terminada' },
  { value: 'cancelled',       label: 'Cancelada' },
  { value: 'no_show',         label: 'No asistió' },
]

export const APPT_TYPES = [
  { value: 'presencial', label: 'Presencial' },
  { value: 'online',     label: 'Online' },
]

export const DURATIONS = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hora' },
]

// 0=Sun..6=Sat, matching Postgres / professional_schedules.day_of_week.
export const DAY_LABELS_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
export const DOW_KEYS        = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

// 30-min granularity is the booking floor — drop the seconds. Fallback grid
// covers the working day for off-schedule overrides.
export const FALLBACK_TIMES = (() => {
  const out = []
  for (let h = 6; h <= 22; h++) {
    out.push(`${String(h).padStart(2, '0')}:00`)
    if (h < 22) out.push(`${String(h).padStart(2, '0')}:30`)
  }
  return out
})()

function hhmm(t) {
  const m = String(t ?? '').match(/^(\d{2}:\d{2})/)
  return m ? m[1] : ''
}

// Build the dropdown options from a pro's availability ranges for a given day.
// Returns [] when the day has no ranges — caller falls back to FALLBACK_TIMES.
export function timesFromRanges(ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) return []
  const slots = new Set()
  for (const r of ranges) {
    const s = hhmm(r.start), e = hhmm(r.end)
    if (!s || !e) continue
    const [sh, sm] = s.split(':').map(Number)
    const [eh, em] = e.split(':').map(Number)
    let mins = sh * 60 + sm
    const endMin = eh * 60 + em
    while (mins < endMin) {
      const h  = Math.floor(mins / 60)
      const mm = mins % 60
      if (mm === 0 || mm === 30) {
        slots.add(`${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`)
      }
      mins += 30
    }
  }
  return Array.from(slots).sort()
}

// ── Styles ───────────────────────────────────────────────────────────────────

export const inputStyle = {
  padding: '10px 12px', borderRadius: 8,
  border: `1px solid ${T.line}`, background: T.bg,
  fontSize: 13, color: T.ink, width: '100%', outline: 'none',
  fontFamily: T.sans, boxSizing: 'border-box',
}
export const monoInput = { ...inputStyle, fontFamily: T.mono }

// ── Helpers ──────────────────────────────────────────────────────────────────

function toDateInputStr(d) {
  const yyyy = d.getFullYear()
  const mm   = String(d.getMonth() + 1).padStart(2, '0')
  const dd   = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function toTimeInputStr(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const TZ = 'America/Santiago'

// Treat (dateStr, timeStr) as Santiago wall-clock and return the corresponding
// UTC ISO string. Santiago is UTC-4 year-round per project policy (no DST
// observed); appending the literal "-04:00" lets the JS Date parser produce
// the correct instant directly.
//
// PRIOR BUG: an Intl-based offset computation that round-tripped through
// `toLocaleString` returned 0 minutes when the browser's local timezone
// happened to be Santiago, so a 09:00 pick was stored as 09:00 UTC instead
// of 13:00 UTC. Hardcoding the offset removes that dependency on the
// browser's TZ.
export function chileISO(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00-04:00`).toISOString()
}

// Render-side helper: convert a stored UTC ISO into a JS Date whose
// .getHours()/.getDate() reflect Santiago wall-clock. Browser-TZ-independent
// because the second `new Date(...)` parses a string whose numeric components
// are the Santiago wall-clock — getHours() then echoes those numbers.
function toChileDate(iso) {
  return new Date(new Date(iso).toLocaleString('en-US', { timeZone: TZ }))
}

export function fmtCLP(n) {
  if (n == null || n === '') return ''
  return '$' + Number(n).toLocaleString('es-CL')
}

// Initial state from either a slot (create) or an appointment (edit).
export function initialState({ slot, appt }) {
  if (appt) {
    const d = toChileDate(appt.datetime)
    return {
      isEdit:        true,
      date:          toDateInputStr(d),
      time:          toTimeInputStr(d),
      duration:      appt.duration ?? 60,
      proId:         appt.professional_id ?? '',
      sessionTypeId: appt.session_type_id ?? '',
      type:          appt.type ?? 'presencial',
      status:        appt.status ?? 'pending_payment',
      notes:         appt.notes ?? '',
      paymentLink:   appt.payment_link ?? '',
      patientId:     appt.patient_id ?? '',
      patientMode:   'existing',
    }
  }
  const baseDate = slot?.date ?? new Date()
  const baseHour = slot?.hour != null ? String(slot.hour).padStart(2, '0') : '10'
  return {
    isEdit:        false,
    date:          toDateInputStr(baseDate),
    time:          `${baseHour}:00`,
    duration:      60,
    proId:         slot?.proId ?? '',
    sessionTypeId: '',
    type:          'presencial',
    status:        'pending_payment',
    notes:         '',
    paymentLink:   '',
    patientId:     '',
    patientMode:   'existing',
  }
}

// Pull joined fields back so the parent renders the new row instantly.
export const SAVED_SELECT = `
  id, lead_id, patient_id, professional_id, datetime, duration, status, notes,
  type, session_type_id, payment_link,
  patients(id, full_name, phone, email, rut),
  session_types(id, name, price_amount, price_currency),
  leads(id, name, phone, chat_id, conversation_context)
`.replace(/\s+/g, ' ').trim()

export function Label({ children }) {
  return (
    <div style={{
      fontSize: 11, color: T.inkMuted, marginBottom: 6,
      letterSpacing: 0.4, textTransform: 'uppercase',
    }}>{children}</div>
  )
}
