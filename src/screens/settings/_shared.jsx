import React from 'react'
import { T } from '../shared.jsx'

// ───── Legacy availability shape ─────
// Used by ProfileSettings + PerfilDisponibilidad + EmpresaWizard to write the
// professionals.availability JSON column. The Profesionales screen and the
// agenda calendar both read from professional_schedules now; this column is
// kept as a backup write target only.
export const DEFAULT_AVAILABILITY = {
  monday:    { start: '09:00', end: '18:00', available: true },
  tuesday:   { start: '09:00', end: '18:00', available: true },
  wednesday: { start: '09:00', end: '18:00', available: true },
  thursday:  { start: '09:00', end: '18:00', available: true },
  friday:    { start: '09:00', end: '18:00', available: true },
  saturday:  { start: '09:00', end: '13:00', available: false },
  sunday:    { start: '09:00', end: '13:00', available: false },
}
export const DAYS = [
  ['monday', 'Lunes'], ['tuesday', 'Martes'], ['wednesday', 'Miércoles'],
  ['thursday', 'Jueves'], ['friday', 'Viernes'], ['saturday', 'Sábado'], ['sunday', 'Domingo'],
]

export function formatRut(raw) {
  if (!raw) return ''
  const cleaned = raw.replace(/[.\-\s]/g, '').toUpperCase()
  if (cleaned.length < 2) return cleaned
  const body = cleaned.slice(0, -1)
  const dv   = cleaned.slice(-1)
  const withDots = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${withDots}-${dv}`
}

export function Field2({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: T.inkMuted, marginBottom: 6, letterSpacing: 0.4, textTransform: 'uppercase' }}>{label}</div>
      {children}
    </div>
  )
}

export function SmallToggle({ value, onChange }) {
  return (
    <div onClick={() => onChange(!value)} style={{
      width: 34, height: 20, borderRadius: 999, cursor: 'pointer',
      background: value ? T.primary : T.line, position: 'relative', transition: 'background .15s',
    }}>
      <div style={{
        position: 'absolute', top: 2, left: value ? 16 : 2,
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,.2)', transition: 'left .15s',
      }} />
    </div>
  )
}

export function SettingsHeader({ title, subtitle, right, compact }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      marginBottom: compact ? 8 : 24, paddingBottom: compact ? 0 : 16,
      borderBottom: compact ? 'none' : `1px solid ${T.lineSoft}`,
    }}>
      <div>
        <div style={{ fontFamily: T.serif, fontSize: compact ? 20 : 22, color: T.ink, lineHeight: 1 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: T.inkMuted, marginTop: 6 }}>{subtitle}</div>
      </div>
      {right}
    </div>
  )
}

export function FieldRow({ label, hint, children, inline }) {
  return (
    <div style={{
      display: inline ? 'flex' : 'block',
      alignItems: inline ? 'center' : 'stretch',
      justifyContent: inline ? 'space-between' : 'flex-start',
      gap: inline ? 20 : 0,
      padding: '16px 0',
      borderBottom: `1px solid ${T.lineSoft}`,
    }}>
      <div style={{ marginBottom: inline ? 0 : 8, flex: inline ? 1 : 'initial' }}>
        <div style={{ fontSize: 12.5, color: T.ink, fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: 11.5, color: T.inkMuted, marginTop: 3, lineHeight: 1.45, maxWidth: 540 }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

export function Toggle({ value, onChange }) {
  return (
    <div onClick={() => onChange(!value)} style={{
      width: 38, height: 22, borderRadius: 999, cursor: 'pointer',
      background: value ? T.primary : T.line,
      position: 'relative', transition: 'background .15s',
    }}>
      <div style={{
        position: 'absolute', top: 2, left: value ? 18 : 2,
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,.2)', transition: 'left .15s',
      }} />
    </div>
  )
}

export const textInput = {
  padding: '10px 12px', borderRadius: 8,
  border: `1px solid ${T.line}`, background: T.bg,
  fontSize: 13, color: T.ink, width: '100%', outline: 'none',
  fontFamily: T.sans, boxSizing: 'border-box',
}
