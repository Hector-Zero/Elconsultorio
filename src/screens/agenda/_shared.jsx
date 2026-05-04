import React from 'react'
import { T } from '../shared.jsx'
import { APPT_STATUS } from './citaModal.jsx'

// ── Constants ─────────────────────────────────────────────────────────

// 5-status enum, matches the appointments.status column. Imported
// shape from citaModal so both screens stay in sync.
export const STATUS_LABELS = Object.fromEntries(APPT_STATUS.map(s => [s.value, s.label]))

export const DOW_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

// Postgres day_of_week → JS-style dowKey used in this screen ('monday', etc).
// 0 = Sunday … 6 = Saturday matches both Postgres EXTRACT(DOW) and the
// professional_schedules.day_of_week convention.
export const DOW_KEY_BY_NUM = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

export const MONTHS    = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export const HOURS     = ['09','10','11','12','13','14','15','16','17','18','19']

// ── Date helpers ──────────────────────────────────────────────────────

export function startOfWeek(d) {
  const date = new Date(d)
  date.setHours(0, 0, 0, 0)
  const day = date.getDay()                 // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day     // shift to Monday
  date.setDate(date.getDate() + diff)
  return date
}
export function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r }
export function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate()
}
export function isoWeek(d) {
  const t = new Date(d.valueOf())
  const dn = (d.getDay() + 6) % 7
  t.setDate(t.getDate() - dn + 3)
  const firstThu = t.valueOf()
  t.setMonth(0, 1)
  if (t.getDay() !== 4) t.setMonth(0, 1 + ((4 - t.getDay()) + 7) % 7)
  return 1 + Math.ceil((firstThu - t) / 604800000)
}
export function fmtRange(start) {
  const end = addDays(start, 6)
  const wk  = isoWeek(start)
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()} – ${end.getDate()} de ${MONTHS[start.getMonth()]} · Semana ${wk}`
  }
  return `${start.getDate()} ${MONTHS[start.getMonth()].slice(0,3)} – ${end.getDate()} ${MONTHS[end.getMonth()].slice(0,3)} · Semana ${wk}`
}
const DOW_LONG = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
export function fmtDay(d)   { return `${DOW_LONG[d.getDay()]} ${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}` }
export function fmtMonth(d) { return `${MONTHS[d.getMonth()]} ${d.getFullYear()}` }
export function startOfDay(d)   { const r = new Date(d); r.setHours(0,0,0,0); return r }
export function startOfMonth(d) { const r = new Date(d.getFullYear(), d.getMonth(), 1); r.setHours(0,0,0,0); return r }
export function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1) }
export function daysInMonth(d)  { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() }
export function toDateInput(d) {
  const yyyy = d.getFullYear()
  const mm   = String(d.getMonth() + 1).padStart(2, '0')
  const dd   = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// ── Chile timezone helpers ────────────────────────────────────────────
export const TZ = 'America/Santiago'

// Returns a Date whose .getHours()/.getDate() reflect Santiago wall-clock time.
// The save-side ISO conversion lives in citaModal.jsx (chileISO) — this file
// is read-only with respect to datetimes.
export function nowChile() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TZ }))
}

// ── Status style ──────────────────────────────────────────────────────

export function statusStyle(s) {
  switch (s) {
    case 'confirmed':       return { bg: T.primarySoft,              fg: T.primary,                       border: T.primary,                       dashed: false }
    case 'pending_payment': return { bg: T.accentSoft,               fg: T.accent,                        border: T.accent,                        dashed: true  }
    case 'completed':       return { bg: T.bgSunk,                   fg: T.inkMuted,                      border: T.inkMuted,                      dashed: false }
    case 'cancelled':       return { bg: T.dangerSoft ?? T.bgSunk,   fg: T.danger ?? T.inkMuted,          border: T.danger ?? T.inkMuted,          dashed: false }
    case 'no_show':         return { bg: T.dangerSoft ?? T.bgSunk,   fg: T.danger ?? T.inkMuted,          border: T.danger ?? T.inkMuted,          dashed: false }
    default:                return { bg: T.bgSunk,                   fg: T.inkMuted,                      border: T.inkMuted,                      dashed: false }
  }
}

// Display name resolver — prefer patients.full_name, fall back to legacy
// leads.name for older rows that still reference lead_id.
export function apptDisplayName(a) {
  return (a.patients?.full_name?.trim())
      || (a.leads?.name?.trim())
      || a.leads?.phone
      || a.leads?.chat_id
      || '— sin nombre —'
}

// Short label for the session type (first 2 words capitalized).
export function apptServiceShort(a) {
  const n = a.session_types?.name
  if (!n) return ''
  return n
}

// ── Summary + Legend (unchanged visuals) ──────────────────────────────

export function Summary({ k, v, sub, accent, muted }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: T.inkMuted, letterSpacing: 0.5, textTransform: 'uppercase' }}>{k}</div>
      <div style={{ fontFamily: T.serif, fontSize: 26, lineHeight: 1, marginTop: 3, color: accent ? T.accent : muted ? T.inkMuted : T.ink }}>{v}</div>
      <div style={{ fontSize: 11, color: T.inkMuted, marginTop: 2 }}>{sub}</div>
    </div>
  )
}

export function Legend({ color, label, dashed, outline }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        width: 14, height: 10, borderRadius: 3,
        background: outline ? T.bgRaised : color,
        border: outline ? `1px ${dashed ? 'dashed' : 'solid'} ${T.line}` : dashed ? `2px dashed ${color}` : 'none',
      }} />
      {label}
    </span>
  )
}

export const selectStyle = {
  padding: '10px 12px', borderRadius: 8,
  border: `1px solid ${T.line}`, background: T.bg,
  fontSize: 13, color: T.ink, width: '100%', outline: 'none',
  fontFamily: T.sans, boxSizing: 'border-box',
}

// ── Multi-professional helpers ────────────────────────────────────────

export function initialsFromName(name) {
  return (name ?? '').trim().split(/\s+/).slice(0, 2).map(s => s[0] ?? '').join('').toUpperCase() || '?'
}

export function hexAlpha(hex, a) {
  const h = hex?.replace('#', '') ?? '000000'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}
