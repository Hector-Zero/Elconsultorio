import React from 'react'
import { T, avatarTint, avatarInk } from '../shared.jsx'

// ── Helpers ──────────────────────────────────────────────────────────

export const statusOf = (l) => {
  if (l.status === 'potencial' || l.status === 'confirmado') return l.status
  return l.qualified_lead ? 'confirmado' : 'potencial'
}

export const nameOf = (lead) =>
  (lead.name ?? lead.prospect_name ?? '').trim()

export const phoneOf = (lead) =>
  lead.prospect_phone ?? lead.phone ?? lead.whatsapp ?? ''

export const leadDisplayName = (lead) =>
  nameOf(lead) || phoneOf(lead) || 'Sin nombre'

export const leadInitials = (lead) => {
  const n = nameOf(lead)
  if (n) return n.split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase()
  const digits = phoneOf(lead).replace(/\D/g, '')
  return digits.slice(-4) || '?'
}

export const excerpt = (text, max = 80) => {
  if (!text) return '—'
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text
}

// ── Column registry ──────────────────────────────────────────────────

export const COL_DEFS = {
  resumen:  { label: 'Resumen',       sortKey: null },
  fase:     { label: 'Fase',          sortKey: 'phase' },
  mensajes: { label: 'Mensajes',      sortKey: 'message_count' },
  estado:   { label: 'Estado',        sortKey: 'status' },
  ultima:   { label: 'Última activ.', sortKey: 'last_updated' },
  telefono: { label: 'Teléfono',      sortKey: null },
  calidad:  { label: 'Calidad',       sortKey: 'qualified_lead' },
}

// ── Lead avatar with name/phone fallback ─────────────────────────────

export function LeadAvatar({ lead, size = 36 }) {
  const key     = nameOf(lead) || phoneOf(lead) || ''
  const display = leadInitials(lead)
  const fs      = display.length > 2 ? size * 0.27 : size * 0.38
  return (
    <div style={{
      width: size, height: size, borderRadius: size / 2,
      background: avatarTint(key), color: avatarInk(key),
      display: 'grid', placeItems: 'center',
      fontSize: fs, fontWeight: 600, fontFamily: T.sans,
      flexShrink: 0, letterSpacing: 0.5,
    }}>{display}</div>
  )
}

// ── Date helper ──────────────────────────────────────────────────────

export const timeAgo = (iso) => {
  const d = new Date(iso)
  const now = new Date()
  const mins = Math.round((now - d) / 60000)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `hace ${mins} min`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `hace ${hrs} h`
  return `hace ${Math.round(hrs / 24)} d`
}

// ── Status config + pill ─────────────────────────────────────────────

const STATUS = {
  potencial:  { label: 'Potencial',  color: T.potencial,  soft: T.potencialSoft,  desc: 'Conversando con el bot' },
  confirmado: { label: 'Confirmado', color: T.confirmado, soft: T.confirmadoSoft, desc: 'Cita agendada' },
}

export const StatusPill = ({ status, size = 'md' }) => {
  const s = STATUS[status]
  if (!s) return null
  const sz = size === 'sm'
    ? { fs: 10.5, py: 2, px: 7, dot: 5 }
    : { fs: 11,   py: 3, px: 8, dot: 6 }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: `${sz.py}px ${sz.px}px`,
      borderRadius: 999,
      background: s.soft, color: s.color,
      fontSize: sz.fs, fontWeight: 500, letterSpacing: 0.1, whiteSpace: 'nowrap',
    }}>
      <span style={{ width: sz.dot, height: sz.dot, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
      {s.label}
    </span>
  )
}
