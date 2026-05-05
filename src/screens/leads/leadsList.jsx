import React from 'react'
import { T, Icon, btn } from '../shared.jsx'
import { statusOf, nameOf, phoneOf, leadDisplayName, excerpt, LeadAvatar, COL_DEFS, StatusPill, timeAgo } from './_shared.jsx'

export default function LeadsList({
  listRef,
  filter, setFilter, counts,
  query, setQuery,
  pickerRef, pickerOpen, setPickerOpen,
  activeCols, toggleCol,
  gridTemplate, sortBy, handleSort,
  startProspectoResize, startColResize,
  loading, fetchError,
  filtered, selected, setSelectedId,
  panelCollapsed, setPanelCollapsed,
}) {
  return (
    <div ref={listRef} style={{ display: 'flex', flexDirection: 'column', borderRight: `1px solid ${T.line}`, minWidth: 0, overflow: 'hidden' }}>

      {/* tab + search bar */}
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.line}`, display: 'flex', alignItems: 'center', gap: 20 }}>
        {[
          { id: 'todos',       label: 'Todos',       c: counts.todos },
          { id: 'potenciales', label: 'Potenciales', c: counts.potenciales },
          { id: 'confirmados', label: 'Confirmados', c: counts.confirmados },
        ].map(t => {
          const on = filter === t.id
          return (
            <div key={t.id} className="lead-tab" onClick={() => setFilter(t.id)} style={{
              display: 'flex', alignItems: 'center', gap: 7,
              fontSize: 13, fontWeight: on ? 500 : 400,
              color: on ? T.ink : T.inkMuted,
              paddingBottom: 12, marginBottom: -13,
              borderBottom: on ? `2px solid ${T.primary}` : '2px solid transparent',
            }}>
              {t.label}
              <span style={{ fontFamily: T.mono, fontSize: 10.5, padding: '1px 6px', borderRadius: 4, background: on ? T.primarySoft : T.bgSunk, color: on ? T.primary : T.inkMuted }}>{t.c}</span>
            </div>
          )
        })}

        <div style={{ flex: 1 }} />

        {/* search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: T.bgSunk, border: `1px solid ${T.lineSoft}`, width: 200 }}>
          <Icon name="search" size={13} stroke={T.inkMuted} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar…"
            style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 12.5, flex: 1, color: T.ink, fontFamily: T.sans }} />
        </div>

        {/* column picker */}
        <div ref={pickerRef} style={{ position: 'relative' }}>
          <button onClick={() => setPickerOpen(v => !v)} style={{ ...btn('ghost'), gap: 5, paddingRight: 10 }}>
            <Icon name="filter" size={13} />
            Columnas
            <span style={{ fontFamily: T.mono, fontSize: 10, padding: '1px 5px', borderRadius: 3, background: T.bgSunk, color: T.inkMuted }}>{activeCols.length}/5</span>
          </button>

          {pickerOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0,
              background: T.bgRaised, border: `1px solid ${T.line}`,
              borderRadius: 10, boxShadow: '0 8px 24px rgba(20,18,14,0.12)',
              padding: 4, minWidth: 200, zIndex: 30,
            }}>
              <div style={{ padding: '8px 12px 4px', fontSize: 10.5, color: T.inkMuted, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                Columnas visibles ({activeCols.length}/5)
              </div>
              {Object.entries(COL_DEFS).map(([id, def]) => {
                const idx     = activeCols.indexOf(id)
                const checked = idx !== -1
                const maxed   = !checked && activeCols.length >= 5
                return (
                  <div key={id} onClick={() => !maxed && toggleCol(id)} style={{
                    display: 'flex', alignItems: 'center', gap: 9,
                    padding: '7px 12px', borderRadius: 6,
                    cursor: maxed ? 'not-allowed' : 'pointer',
                    opacity: maxed ? 0.4 : 1,
                  }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                      border: `1.5px solid ${checked ? T.primary : T.line}`,
                      background: checked ? T.primary : 'transparent',
                      color: checked ? T.primaryText : 'transparent',
                      display: 'grid', placeItems: 'center',
                      fontFamily: T.mono, fontSize: 11, fontWeight: 600, lineHeight: 1,
                    }}>
                      {checked ? idx + 1 : ''}
                    </div>
                    <span style={{ fontSize: 12.5, color: maxed ? T.inkFaint : T.inkSoft }}>{def.label}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* column headers */}
      <div style={{
        padding: '0 24px', display: 'grid',
        gridTemplateColumns: gridTemplate,
        gap: 12, alignItems: 'center',
        minHeight: 36,
        fontSize: 10.5, color: T.inkMuted, letterSpacing: 0.5, textTransform: 'uppercase',
        borderBottom: `1px solid ${T.lineSoft}`, background: T.bg,
      }}>
        <div data-col-cell style={{ position: 'relative', minWidth: 0 }}>
          Prospecto
          {activeCols.length > 0 && (
            <ResizeHandle onMouseDown={startProspectoResize} />
          )}
        </div>
        {activeCols.map((colId, i) => {
          const def    = COL_DEFS[colId]
          const active = sortBy.col === colId
          const canSort = !!def.sortKey
          const isLast  = i === activeCols.length - 1
          return (
            <div key={colId} data-col-cell className={canSort ? 'col-hdr' : ''} onClick={() => handleSort(colId)}
              style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4, color: active ? T.inkSoft : T.inkMuted, minWidth: 0 }}>
              {def.label}
              {canSort && (
                <span style={{ fontSize: 10, color: active ? T.primary : T.inkFaint, lineHeight: 1 }}>
                  {active ? (sortBy.dir === 'asc' ? '↑' : '↓') : '↕'}
                </span>
              )}
              {!isLast && <ResizeHandle onMouseDown={(e) => startColResize(i, e)} />}
            </div>
          )
        })}
      </div>

      {/* rows */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: T.inkMuted, fontFamily: T.serif, fontStyle: 'italic' }}>
            Cargando leads…
          </div>
        )}

        {!loading && fetchError && (
          <div style={{ margin: '24px', padding: '14px 16px', borderRadius: 10, background: T.dangerSoft, border: `1px solid ${T.danger}22` }}>
            <div style={{ fontSize: 11, color: T.danger, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>Error</div>
            <div style={{ fontFamily: T.mono, fontSize: 12, color: T.danger }}>{fetchError}</div>
          </div>
        )}

        {!loading && !fetchError && filtered.length === 0 && (
          <div style={{ padding: '40px 24px', textAlign: 'center', color: T.inkMuted, fontSize: 13 }}>
            {query ? 'Sin resultados.' : 'No hay leads en este estado.'}
          </div>
        )}

        {filtered.map(lead => {
          const sel     = lead.chat_id === selected?.chat_id
          const hasNew  = (lead.unread ?? 0) > 0
          const dispName = leadDisplayName(lead)
          return (
            <div
              key={lead.chat_id}
              className={'lead-row' + (sel ? ' sel' : '')}
              onClick={() => {
                setSelectedId(lead.chat_id)
                if (panelCollapsed) setPanelCollapsed(false)
              }}
              style={{
                padding: '11px 24px',
                display: 'grid', gridTemplateColumns: gridTemplate,
                gap: 12, alignItems: 'center',
                borderBottom: `1px solid ${T.lineSoft}`,
                cursor: 'pointer', fontSize: 13, minWidth: 0,
              }}
            >
              {/* Prospecto — always first */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, overflow: 'hidden' }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <LeadAvatar lead={lead} size={34} />
                  {hasNew && (
                    <span style={{
                      position: 'absolute', top: -2, right: -2,
                      width: 9, height: 9, borderRadius: '50%',
                      background: T.accent, border: `2px solid ${T.bg}`,
                      animation: 'leadpulse 1.5s ease-in-out infinite',
                    }} />
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {dispName}
                  </div>
                  {nameOf(lead) && phoneOf(lead) && (
                    <div style={{ fontSize: 11, color: T.inkMuted, fontFamily: T.mono, marginTop: 1 }}>
                      {phoneOf(lead)}
                    </div>
                  )}
                </div>
              </div>

              {/* dynamic columns */}
              {activeCols.map(colId => (
                <div key={colId} style={{ minWidth: 0, overflow: 'hidden' }}>
                  {renderCell(colId, lead)}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function renderCell(colId, lead) {
  const hasUnread = (lead.unread ?? 0) > 0
  switch (colId) {
    case 'resumen':
      return (
        <span style={{ fontSize: 12, color: T.inkMuted, fontStyle: lead.conversation_context ? 'italic' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', minWidth: 0 }}>
          {excerpt(lead.conversation_context)}
        </span>
      )
    case 'fase':
      return <span style={{ fontSize: 12.5, color: T.inkSoft }}>{lead.phase ?? '—'}</span>
    case 'mensajes':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: T.inkSoft }}>
          <Icon name="chat" size={12} stroke={T.inkMuted} />
          <span style={{ fontFamily: T.mono }}>{lead.message_count ?? 0}</span>
          {hasUnread && (
            <span style={{ fontSize: 10, fontFamily: T.mono, fontWeight: 600, padding: '1px 5px', borderRadius: 4, background: T.accent, color: T.primaryText }}>
              +{lead.unread}
            </span>
          )}
        </div>
      )
    case 'estado':
      return <StatusPill status={statusOf(lead)} size="sm" />
    case 'ultima':
      return (
        <span style={{ fontSize: 11, color: T.inkMuted, fontFamily: T.mono }}>
          {lead.last_updated ? timeAgo(lead.last_updated).replace('hace ', '') : '—'}
        </span>
      )
    case 'telefono':
      return <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.inkSoft }}>{phoneOf(lead) || '—'}</span>
    case 'calidad':
      return (
        <span style={{
          padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 500,
          background: lead.qualified_lead ? T.confirmadoSoft : T.bgSunk,
          color:      lead.qualified_lead ? T.confirmado      : T.inkMuted,
        }}>
          {lead.qualified_lead ? 'Calificado' : 'Sin calificar'}
        </span>
      )
    default: return null
  }
}

// ── Resize handle ────────────────────────────────────────────────────

function ResizeHandle({ onMouseDown }) {
  return (
    <div
      onMouseDown={onMouseDown}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute', top: 0, right: -6, bottom: 0,
        width: 12, cursor: 'col-resize', zIndex: 2,
        display: 'flex', justifyContent: 'center', alignItems: 'center',
      }}
    >
      <div style={{ width: 1, height: '60%', background: T.lineSoft }} />
    </div>
  )
}
