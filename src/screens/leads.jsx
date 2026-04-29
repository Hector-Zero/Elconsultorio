import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import { T, Icon, Sidebar, StatusPill, TopBar, btn, SectionLabel, timeAgo, avatarTint, avatarInk } from './shared.jsx'

// ── Helpers ──────────────────────────────────────────────────────────

const statusOf = (l) => {
  if (l.status === 'potencial' || l.status === 'confirmado') return l.status
  return l.qualified_lead ? 'confirmado' : 'potencial'
}

const nameOf = (lead) =>
  (lead.name ?? lead.prospect_name ?? '').trim()

const phoneOf = (lead) =>
  lead.prospect_phone ?? lead.phone ?? lead.whatsapp ?? ''

const leadDisplayName = (lead) =>
  nameOf(lead) || phoneOf(lead) || 'Sin nombre'

const leadInitials = (lead) => {
  const n = nameOf(lead)
  if (n) return n.split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase()
  const digits = phoneOf(lead).replace(/\D/g, '')
  return digits.slice(-4) || '?'
}

const excerpt = (text, max = 80) => {
  if (!text) return '—'
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text
}

// ── Column registry ──────────────────────────────────────────────────

const COL_DEFS = {
  resumen:  { label: 'Resumen',       sortKey: null },
  fase:     { label: 'Fase',          sortKey: 'phase' },
  mensajes: { label: 'Mensajes',      sortKey: 'message_count' },
  estado:   { label: 'Estado',        sortKey: 'status' },
  ultima:   { label: 'Última activ.', sortKey: 'last_updated' },
  telefono: { label: 'Teléfono',      sortKey: null },
  calidad:  { label: 'Calidad',       sortKey: 'qualified_lead' },
}

const PROSPECTO_W   = 220   // fixed Prospecto column width (px), resizable
const COL_MIN_W     = 60

const STORAGE_KEY  = 'elc_leads_cols_v2'
const DEFAULT_COLS = ['mensajes', 'estado', 'ultima']

// ── Screen ───────────────────────────────────────────────────────────

export default function LeadsScreen({ onNavigate }) {
  const [leads, setLeads]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [fetchError, setFetchError] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [filter, setFilter]         = useState('todos')
  const [query, setQuery]           = useState('')
  // Per-lead bot pause flag is read from leads.bot_paused.
  // Make.com webhook MUST check this column before responding — if true, skip the AI reply.
  // (Global on/off lives in agents_config.active.)
  async function toggleLeadBot(lead) {
    const next = !lead.bot_paused
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, bot_paused: next } : l))
    const { error } = await supabase.from('leads').update({ bot_paused: next }).eq('id', lead.id)
    if (error) {
      // revert on failure
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, bot_paused: !next } : l))
      console.error('toggleLeadBot:', error.message)
    }
  }
  const [sortBy, setSortBy]         = useState({ col: 'ultima', dir: 'desc' })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const pickerRef                   = useRef(null)

  const [activeCols, setActiveCols] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
      if (Array.isArray(saved) && saved.length > 0) {
        return saved.filter(id => COL_DEFS[id])
      }
    } catch {}
    return DEFAULT_COLS
  })

  // resizable column geometry — ratios sum to 1 across activeCols
  const [prospectoW, setProspectoW] = useState(PROSPECTO_W)
  const [colRatios, setColRatios]   = useState({})
  const [listWidth, setListWidth]   = useState(0)
  const listRef                     = useRef(null)

  // observe list panel width
  useEffect(() => {
    if (!listRef.current) return
    const ro = new ResizeObserver(([entry]) => setListWidth(entry.contentRect.width))
    ro.observe(listRef.current)
    return () => ro.disconnect()
  }, [])

  // re-init ratios when activeCols changes (preserve existing where possible)
  useEffect(() => {
    setColRatios(prev => {
      const n = activeCols.length
      if (n === 0) return {}
      const next = {}
      let sum = 0
      activeCols.forEach(id => {
        next[id] = prev[id] ?? (1 / n)
        sum += next[id]
      })
      if (sum > 0) activeCols.forEach(id => { next[id] = next[id] / sum })
      return next
    })
  }, [activeCols])

  // persist column selection
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(activeCols))
  }, [activeCols])

  // close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return
    const h = (e) => { if (!pickerRef.current?.contains(e.target)) setPickerOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [pickerOpen])

  // fetch + realtime
  useEffect(() => {
    let alive = true

    supabase
      .from('leads')
      .select('*')
      .order('last_updated', { ascending: false })
      .then(({ data, error }) => {
        if (!alive) return
        if (error) setFetchError(error.message)
        const rows = data ?? []
        setLeads(rows)
        setLoading(false)
        setSelectedId(cur => cur ?? rows[0]?.chat_id ?? null)
      })

    const channel = supabase
      .channel('leads-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, (payload) => {
        if (!alive) return
        setLeads(prev => {
          if (payload.eventType === 'INSERT') return [payload.new, ...prev]
          if (payload.eventType === 'UPDATE') {
            return prev
              .map(l => l.chat_id === payload.new.chat_id ? payload.new : l)
              .sort((a, b) => new Date(b.last_updated) - new Date(a.last_updated))
          }
          if (payload.eventType === 'DELETE') return prev.filter(l => l.chat_id !== payload.old.chat_id)
          return prev
        })
      })
      .subscribe()

    return () => { alive = false; supabase.removeChannel(channel) }
  }, [])

  // sort + filter
  const sorted = [...leads].sort((a, b) => {
    const { col, dir } = sortBy
    const key = COL_DEFS[col]?.sortKey
    if (!key) return 0
    const mult = dir === 'asc' ? 1 : -1
    let va = key === 'status'       ? statusOf(a)
           : key === 'last_updated' ? new Date(a.last_updated || 0)
           : (a[key] ?? '')
    let vb = key === 'status'       ? statusOf(b)
           : key === 'last_updated' ? new Date(b.last_updated || 0)
           : (b[key] ?? '')
    return va < vb ? -mult : va > vb ? mult : 0
  })

  const filtered = sorted.filter(l => {
    if (filter === 'confirmados' && !l.qualified_lead) return false
    if (filter === 'potenciales' &&  l.qualified_lead) return false
    if (query && !leadDisplayName(l).toLowerCase().includes(query.toLowerCase())) return false
    return true
  })

  const selected = leads.find(l => l.chat_id === selectedId) ?? filtered[0] ?? null

  const counts = {
    todos:       leads.length,
    potenciales: leads.filter(l => !l.qualified_lead).length,
    confirmados: leads.filter(l =>  l.qualified_lead).length,
  }

  const toggleCol = (id) =>
    setActiveCols(prev =>
      prev.includes(id)
        ? prev.filter(c => c !== id)
        : prev.length < 5 ? [...prev, id] : prev
    )

  const handleSort = (colId) => {
    if (!COL_DEFS[colId]?.sortKey) return
    setSortBy(prev => ({
      col: colId,
      dir: prev.col === colId && prev.dir === 'asc' ? 'desc' : 'asc',
    }))
  }

  // ── Layout geometry ──
  const HORIZ_PADDING = 48   // 24 left + 24 right
  const GAP           = 12   // grid gap between cells
  const dynAvailable  = Math.max(
    COL_MIN_W * Math.max(activeCols.length, 1),
    listWidth - HORIZ_PADDING - prospectoW - GAP * activeCols.length
  )
  const widthOf = (id) => {
    const r = colRatios[id] ?? (1 / Math.max(activeCols.length, 1))
    return Math.max(COL_MIN_W, Math.round(r * dynAvailable))
  }
  const gridTemplate = [
    `${prospectoW}px`,
    ...activeCols.map(id => `${widthOf(id)}px`),
  ].join(' ')

  // attach drag listeners + cursor styling
  const beginDrag = (onMove) => {
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // resize between dynamic col i and i+1 — only neighbors transfer width
  const startColResize = (i, e) => {
    e.preventDefault(); e.stopPropagation()
    const idA = activeCols[i]
    const idB = activeCols[i + 1]
    if (!idB) return
    const startX = e.clientX
    const startA = widthOf(idA)
    const startB = widthOf(idB)
    const total  = startA + startB
    beginDrag((ev) => {
      const dx   = ev.clientX - startX
      const newA = Math.max(COL_MIN_W, Math.min(total - COL_MIN_W, startA + dx))
      const newB = total - newA
      setColRatios(prev => {
        const next = { ...prev }
        next[idA] = newA / dynAvailable
        next[idB] = newB / dynAvailable
        const s = activeCols.reduce((acc, id) => acc + (next[id] ?? 0), 0)
        if (s > 0) activeCols.forEach(id => { next[id] = next[id] / s })
        return next
      })
    })
  }

  // resize prospecto column — clamped so all dyn cols still fit at min
  const startProspectoResize = (e) => {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX
    const startW = prospectoW
    const minDyn = COL_MIN_W * activeCols.length
    const maxProspecto = Math.max(
      COL_MIN_W,
      listWidth - HORIZ_PADDING - GAP * activeCols.length - minDyn
    )
    beginDrag((ev) => {
      const dx = ev.clientX - startX
      setProspectoW(Math.max(COL_MIN_W, Math.min(maxProspecto, startW + dx)))
    })
  }

  const renderCell = (colId, lead) => {
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

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', background: T.bg, fontFamily: T.sans, color: T.ink }}>
      <Sidebar active="leads" onNavigate={onNavigate} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopBar
          title="Leads"
          subtitle="Prospectos capturados por el bot de WhatsApp"
          right={
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 10px', borderRadius: 999,
                background: T.primarySoft, color: T.primary, fontSize: 11.5, fontWeight: 500,
              }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: T.primary, boxShadow: `0 0 0 3px ${T.primary}22`, animation: 'leadpulse 2s ease-in-out infinite' }} />
                Bot conectado
              </div>
              <button style={btn('ghost')}><Icon name="bell" size={14} /></button>
              <button style={btn('primary')}><Icon name="plus" size={14} stroke="#fff" /> Nuevo</button>
            </div>
          }
        />

        <style>{`
          @keyframes leadpulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.4 } }
          .lead-row:hover { background: ${T.bgSunk} !important; }
          .lead-row.sel   { background: ${T.bgRaised} !important; box-shadow: inset 3px 0 0 ${T.primary}; }
          .lead-tab       { cursor: pointer; }
          .col-hdr        { cursor: pointer; user-select: none; }
          .col-hdr:hover  { color: ${T.inkSoft} !important; }
        `}</style>

        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: panelCollapsed ? '1fr' : '1fr 440px', minHeight: 0, position: 'relative' }}>

          {/* ── list panel ───────────────────────────────────────── */}
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

          {/* ── detail panel ─────────────────────────────────────── */}
          {!panelCollapsed && selected && (
            <DetailPanel
              lead={selected}
              status={statusOf(selected)}
              botPaused={!!selected.bot_paused}
              onToggleBot={() => toggleLeadBot(selected)}
            />
          )}

          {/* seam toggle — vertically centered on the right edge of the leads list */}
          {selected && (
            <button
              onClick={() => setPanelCollapsed(c => !c)}
              title={panelCollapsed ? 'Expandir panel' : 'Colapsar panel'}
              style={{
                position: 'absolute',
                top: '50%',
                right: panelCollapsed ? 0 : 440,
                transform: panelCollapsed
                  ? 'translate(0, -50%)'
                  : 'translate(50%, -50%)',
                zIndex: 25,
                width: 22, height: 56,
                borderTopLeftRadius:    panelCollapsed ? 8 : 6,
                borderBottomLeftRadius: panelCollapsed ? 8 : 6,
                borderTopRightRadius:    panelCollapsed ? 0 : 6,
                borderBottomRightRadius: panelCollapsed ? 0 : 6,
                background: T.bgRaised,
                border: `1px solid ${T.line}`,
                borderRight: panelCollapsed ? 'none' : `1px solid ${T.line}`,
                display: 'grid', placeItems: 'center', cursor: 'pointer',
                color: T.inkSoft, fontFamily: T.sans, fontSize: 14, lineHeight: 1,
                boxShadow: '0 2px 8px rgba(20,18,14,0.08)',
              }}
            >
              {panelCollapsed ? '‹' : '›'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
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

// ── Lead avatar with name/phone fallback ─────────────────────────────

function LeadAvatar({ lead, size = 36 }) {
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

// ── Detail panel ─────────────────────────────────────────────────────

function DetailPanel({ lead, status, botPaused, onToggleBot }) {
  return (
    <div style={{ background: T.bgRaised, display: 'flex', flexDirection: 'column', overflow: 'auto', minHeight: 0, fontFamily: T.sans, position: 'relative' }}>
      <div style={{ padding: '24px 24px 20px', borderBottom: `1px solid ${T.lineSoft}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <LeadAvatar lead={lead} size={52} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: T.serif, fontSize: 22, color: T.ink, lineHeight: 1.15, letterSpacing: -0.2 }}>
              {leadDisplayName(lead)}
            </div>
            <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, fontFamily: T.mono, fontSize: 12, color: T.inkMuted }}>
              {phoneOf(lead)}
              {lead.last_updated && <>
                <span style={{ width: 3, height: 3, borderRadius: '50%', background: T.inkFaint }} />
                {timeAgo(lead.last_updated)}
              </>}
            </div>
            <div style={{ marginTop: 10 }}><StatusPill status={status} /></div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 18 }}>
          <button style={btn('soft')}><Icon name="wa" size={14} stroke={T.primary} /> Responder</button>
          <button style={btn('soft')}><Icon name="calendar" size={14} stroke={T.primary} /> Agendar</button>
          <button style={btn('soft')}><Icon name="user" size={14} stroke={T.primary} /> Crear ficha</button>
        </div>
      </div>

      {/* bot toggle */}
      <div style={{
        margin: '16px 24px 0', padding: '12px 14px', borderRadius: 10,
        background: botPaused ? T.accentSoft : T.primarySoft,
        border: `1px solid ${botPaused ? '#e8d4c6' : '#d4e0d4'}`,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: botPaused ? T.accent : T.primary, display: 'grid', placeItems: 'center', color: T.primaryText }}>
          <Icon name={botPaused ? 'pause' : 'sparkle'} size={15} stroke={T.primaryText} fill={botPaused ? T.primaryText : 'none'} />
        </div>
        <div style={{ flex: 1, lineHeight: 1.3 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: T.ink }}>{botPaused ? 'Bot pausado' : 'Bot respondiendo'}</div>
          <div style={{ fontSize: 11, color: T.inkMuted, marginTop: 1 }}>{botPaused ? 'Tú estás atendiendo esta conversación' : 'Respuestas automáticas en WhatsApp'}</div>
        </div>
        <button onClick={onToggleBot} style={{
          border: `1px solid ${botPaused ? T.accent : T.primary}`,
          background: 'transparent', color: botPaused ? T.accent : T.primary,
          padding: '6px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 500, cursor: 'pointer', fontFamily: T.sans,
        }}>
          {botPaused ? 'Reactivar' : 'Pausar'}
        </button>
      </div>

      {/* conversation context */}
      {lead.conversation_context && (
        <div style={{ padding: '18px 24px 6px' }}>
          <SectionLabel icon="sparkle" label="Resumen del bot" />
          <div style={{
            padding: '14px 16px', borderRadius: 10,
            background: T.bgRaised, border: `1px solid ${T.lineSoft}`,
            fontSize: 13, color: T.ink, lineHeight: 1.55,
            fontStyle: 'italic', fontFamily: T.serif,
          }}>
            {lead.conversation_context}
          </div>
        </div>
      )}

      {/* details grid */}
      <div style={{ padding: '18px 24px 6px' }}>
        <SectionLabel icon="file" label="Detalles" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, border: `1px solid ${T.lineSoft}`, borderRadius: 10, overflow: 'hidden' }}>
          <Cell k="Fase"     v={lead.phase ?? '—'} />
          <Cell k="Mensajes" v={<span style={{ fontFamily: T.mono }}>{lead.message_count ?? 0}</span>} />
          <Cell k="Chat ID"  v={<span style={{ fontFamily: T.mono, fontSize: 11.5 }}>{lead.chat_id}</span>} />
          <Cell k="Calidad"  v={lead.qualified_lead ? 'Calificado' : 'Sin calificar'} />
          {lead.appointment && (
            <Cell k="Cita" v={`${lead.appointment.date} · ${lead.appointment.time}`} span={2} />
          )}
        </div>
      </div>

      {lead.tags?.length > 0 && (
        <div style={{ padding: '18px 24px 6px' }}>
          <SectionLabel icon="filter" label="Etiquetas" />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {lead.tags.map(t => (
              <span key={t} style={{ padding: '4px 10px', borderRadius: 999, background: T.bgSunk, color: T.inkSoft, fontSize: 11.5, border: `1px solid ${T.lineSoft}` }}>{t}</span>
            ))}
          </div>
        </div>
      )}

      <div style={{ flex: 1 }} />

      <div style={{ padding: '14px 24px', borderTop: `1px solid ${T.lineSoft}`, background: T.bg, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
        <button style={{ ...btn('ghostSm'), color: T.inkMuted }}>Marcar como descartado</button>
        <button style={btn('primary')}>Convertir a paciente <Icon name="arrow" size={12} stroke="#fff" /></button>
      </div>
    </div>
  )
}

function Cell({ k, v, span = 1 }) {
  return (
    <div style={{
      padding: '11px 14px',
      gridColumn: span === 2 ? '1 / -1' : 'auto',
      borderBottom: `1px solid ${T.lineSoft}`,
      borderRight: span === 2 ? 'none' : `1px solid ${T.lineSoft}`,
    }}>
      <div style={{ fontSize: 10.5, color: T.inkMuted, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 3 }}>{k}</div>
      <div style={{ fontSize: 13, color: T.ink }}>{v}</div>
    </div>
  )
}
