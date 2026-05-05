import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import { T, Icon, Sidebar, TopBar, btn } from './shared.jsx'
import { statusOf, leadDisplayName, COL_DEFS } from './leads/_shared.jsx'
import LeadsList   from './leads/leadsList.jsx'
import DetailPanel from './leads/detailPanel.jsx'

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

          <LeadsList
            listRef={listRef}
            filter={filter} setFilter={setFilter}
            counts={counts}
            query={query} setQuery={setQuery}
            pickerRef={pickerRef} pickerOpen={pickerOpen} setPickerOpen={setPickerOpen}
            activeCols={activeCols} toggleCol={toggleCol}
            gridTemplate={gridTemplate}
            sortBy={sortBy} handleSort={handleSort}
            startProspectoResize={startProspectoResize} startColResize={startColResize}
            loading={loading} fetchError={fetchError}
            filtered={filtered} selected={selected} setSelectedId={setSelectedId}
            panelCollapsed={panelCollapsed} setPanelCollapsed={setPanelCollapsed}
          />

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
