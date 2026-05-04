import React, { useState, useEffect, useRef } from 'react'
import { T, Icon } from '../shared.jsx'
import { hexAlpha, initialsFromName } from './_shared.jsx'

export function SoloProBadge({ pro }) {
  const inits = pro.initials || initialsFromName(pro.full_name)
  return (
    <div style={{ padding: '12px 24px', borderBottom: `1px solid ${T.line}`, background: T.bg, display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', overflow: 'hidden',
        background: pro.avatar_url ? T.bgSunk : (pro.color || T.primary),
        color: '#fff', display: 'grid', placeItems: 'center',
        fontSize: 11, fontWeight: 600, border: `1px solid ${T.line}`, flexShrink: 0,
      }}>
        {pro.avatar_url
          ? <img src={pro.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : inits}
      </div>
      <span style={{ fontSize: 12.5, color: T.inkSoft, fontFamily: T.sans }}>{pro.full_name}</span>
    </div>
  )
}

export function ProAvatarSm({ pro, size = 22 }) {
  const inits = pro.initials || initialsFromName(pro.full_name)
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: pro.avatar_url ? T.bgSunk : pro.color,
      color: '#fff', display: 'grid', placeItems: 'center',
      fontSize: size * 0.42, fontWeight: 600, overflow: 'hidden',
      border: `1px solid ${T.line}`,
    }}>
      {pro.avatar_url
        ? <img src={pro.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : inits}
    </div>
  )
}

export function ProSelector({ pros, activeProIds, allSelected, onToggle, onSelectAll }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const h = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  const count = activeProIds.size
  const label = allSelected
    ? `Mostrando: todos los profesionales (${pros.length})`
    : `Mostrando: ${count} ${count === 1 ? 'profesional' : 'profesionales'}`
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
          border: `1px solid ${T.line}`, background: T.bgRaised,
          color: T.ink, fontSize: 12.5, fontWeight: 500, fontFamily: T.sans,
        }}
      >
        <span>{label}</span>
        <Icon name="chevronD" size={12} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 40,
          minWidth: 260, background: T.bgRaised, border: `1px solid ${T.line}`,
          borderRadius: 10, boxShadow: '0 12px 30px rgba(20,18,14,0.12)', padding: 6,
        }}>
          <div
            onClick={onSelectAll}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
              background: allSelected ? T.bgSunk : 'transparent',
            }}
          >
            <input type="checkbox" checked={allSelected} readOnly style={{ accentColor: T.primary }} />
            <span style={{ fontSize: 12.5, color: T.ink, fontWeight: 500 }}>Seleccionar todos</span>
          </div>
          <div style={{ height: 1, background: T.lineSoft, margin: '4px 6px' }} />
          {pros.map(p => {
            const checked = activeProIds.has(p.id)
            const onlyOne = checked && activeProIds.size === 1
            return (
              <div
                key={p.id}
                onClick={() => { if (!onlyOne) onToggle(p.id) }}
                title={onlyOne ? 'Debe quedar al menos un profesional seleccionado' : ''}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 10px', borderRadius: 6,
                  cursor: onlyOne ? 'not-allowed' : 'pointer',
                  opacity: onlyOne ? 0.6 : 1,
                  background: checked ? hexAlpha(p.color, 0.10) : 'transparent',
                }}
              >
                <input type="checkbox" checked={checked} readOnly style={{ accentColor: p.color }} />
                <ProAvatarSm pro={p} size={20} />
                <span style={{ fontSize: 12.5, color: T.ink }}>{p.full_name || '(sin nombre)'}</span>
                <span style={{ marginLeft: 'auto', width: 10, height: 10, borderRadius: '50%', background: p.color }} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function ProChip({ pro, color, label, selected, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      padding: '6px 10px', borderRadius: 999, cursor: 'pointer',
      border: `1px solid ${selected ? (color ?? T.primary) : T.line}`,
      background: selected ? (color ? hexAlpha(color, 0.14) : T.primarySoft) : T.bgRaised,
      color: selected ? (color ?? T.primary) : T.inkSoft,
      fontSize: 12, fontWeight: 500, fontFamily: T.sans,
    }}>
      {pro
        ? <ProAvatarSm pro={pro} size={18} />
        : <span style={{ width: 8, height: 8, borderRadius: '50%', background: selected ? T.primary : T.line }} />}
      {label}
    </button>
  )
}
