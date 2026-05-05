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
