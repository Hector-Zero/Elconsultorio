import React, { useState, useEffect, useRef, useContext } from 'react'
import { T, Icon, Sidebar, TopBar, btn, TimePicker, ConfirmModal } from './shared.jsx'
import { ClientCtx } from '../lib/ClientCtx.js'
import { supabase } from '../lib/supabase.js'

// ── Constants ─────────────────────────────────────────────────────────

const STATUS_LABELS = {
  pending:   'Pendiente',
  confirmed: 'Confirmada',
  completed: 'Terminada',
  cancelled: 'Cancelada',
}

const DOW_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MONTHS    = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const HOURS     = ['09','10','11','12','13','14','15','16','17','18','19']

// ── Date helpers ──────────────────────────────────────────────────────

function startOfWeek(d) {
  const date = new Date(d)
  date.setHours(0, 0, 0, 0)
  const day = date.getDay()                 // 0=Sun … 6=Sat
  const diff = day === 0 ? -6 : 1 - day     // shift to Monday
  date.setDate(date.getDate() + diff)
  return date
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r }
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate()
}
function isoWeek(d) {
  const t = new Date(d.valueOf())
  const dn = (d.getDay() + 6) % 7
  t.setDate(t.getDate() - dn + 3)
  const firstThu = t.valueOf()
  t.setMonth(0, 1)
  if (t.getDay() !== 4) t.setMonth(0, 1 + ((4 - t.getDay()) + 7) % 7)
  return 1 + Math.ceil((firstThu - t) / 604800000)
}
function fmtRange(start) {
  const end = addDays(start, 6)
  const wk  = isoWeek(start)
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()} – ${end.getDate()} de ${MONTHS[start.getMonth()]} · Semana ${wk}`
  }
  return `${start.getDate()} ${MONTHS[start.getMonth()].slice(0,3)} – ${end.getDate()} ${MONTHS[end.getMonth()].slice(0,3)} · Semana ${wk}`
}
const DOW_LONG = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
function fmtDay(d)   { return `${DOW_LONG[d.getDay()]} ${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}` }
function fmtMonth(d) { return `${MONTHS[d.getMonth()]} ${d.getFullYear()}` }
function startOfDay(d)   { const r = new Date(d); r.setHours(0,0,0,0); return r }
function startOfMonth(d) { const r = new Date(d.getFullYear(), d.getMonth(), 1); r.setHours(0,0,0,0); return r }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1) }
function daysInMonth(d)  { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() }
function toDateInput(d) {
  const yyyy = d.getFullYear()
  const mm   = String(d.getMonth() + 1).padStart(2, '0')
  const dd   = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// ── Chile timezone helpers ────────────────────────────────────────────
const TZ = 'America/Santiago'

// Returns a Date whose .getHours()/.getDate() reflect Santiago wall-clock time
function nowChile() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TZ }))
}
// Santiago UTC offset (minutes) at a given instant — handles DST
function chileOffsetMin(at = new Date()) {
  const local = new Date(at.toLocaleString('en-US', { timeZone: TZ }))
  return Math.round((local.getTime() - at.getTime()) / 60000)
}
// Build a UTC ISO string from a date+time entered as Chile wall-clock
function chileISO(dateStr, timeStr) {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const [h, mi]    = timeStr.split(':').map(Number)
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi))
  const off   = chileOffsetMin(guess)
  return new Date(guess.getTime() - off * 60000).toISOString()
}

// ── Status style ──────────────────────────────────────────────────────

function statusStyle(s) {
  switch (s) {
    case 'confirmed': return { bg: T.primarySoft,         fg: T.primary,                       border: T.primary }
    case 'pending':   return { bg: T.accentSoft,          fg: T.accent,                        border: T.accent }
    case 'completed': return { bg: T.bgSunk,              fg: T.inkMuted,                      border: T.inkMuted }
    case 'cancelled': return { bg: T.dangerSoft ?? T.bgSunk, fg: T.danger ?? T.error ?? T.inkMuted, border: T.danger ?? T.error ?? T.inkMuted }
    default:          return { bg: T.bgSunk,              fg: T.inkMuted,                      border: T.inkMuted }
  }
}

// ── Lead display name (shared with leads.jsx) ─────────────────────────

const leadName = (l) =>
  ((l?.name ?? '').trim()) ||
  (l?.phone ?? l?.chat_id ?? '—')

// ── Screen ────────────────────────────────────────────────────────────

const VIEW_KEY = 'elc_agenda_view'

export default function AgendaScreen({ onNavigate }) {
  const { clientId, config, professional, profileIncomplete } = useContext(ClientCtx)
  const isPro = !!professional
  const empresaMode = !!config?.modo_empresa
  const [view, setView] = useState(() => {
    const v = typeof localStorage !== 'undefined' && localStorage.getItem(VIEW_KEY)
    return v === 'day' || v === 'month' ? v : 'week'
  })
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view) } catch {} }, [view])
  const [anchor, setAnchor] = useState(() => startOfDay(nowChile()))
  const [modal, setModal]   = useState(null)
  const [statusOpenId, setStatusOpenId] = useState(null)

  // range derived from view
  const rangeStart =
    view === 'day'   ? startOfDay(anchor) :
    view === 'week'  ? startOfDay(anchor) :
                       startOfMonth(anchor)
  const rangeEnd =
    view === 'day'   ? addDays(rangeStart, 1) :
    view === 'week'  ? addDays(rangeStart, 7) :
                       addMonths(rangeStart, 1)
  const subtitle =
    view === 'day'   ? fmtDay(rangeStart) :
    view === 'week'  ? fmtRange(rangeStart) :
                       fmtMonth(rangeStart)
  const stepPrev = () => setAnchor(a =>
    view === 'day' ? addDays(a, -1) : view === 'week' ? addDays(a, -7) : addMonths(a, -1))
  const stepNext = () => setAnchor(a =>
    view === 'day' ? addDays(a, 1)  : view === 'week' ? addDays(a, 7)  : addMonths(a, 1))
  const today      = startOfDay(nowChile())
  const limitBack  = startOfMonth(addMonths(today, -3))
  const limitFwd   = addMonths(startOfMonth(today), 7)   // exclusive upper bound = +6 months
  const nextAnchor = view === 'day' ? addDays(anchor, 1)  : view === 'week' ? addDays(anchor, 7)  : addMonths(anchor, 1)
  const prevAnchor = view === 'day' ? addDays(anchor, -1) : view === 'week' ? addDays(anchor, -7) : addMonths(anchor, -1)
  const navPrevDisabled = prevAnchor < limitBack
  const navNextDisabled = nextAnchor >= limitFwd

  const [appts, setAppts]   = useState([])
  const [leads, setLeads]   = useState([])
  const [pros, setPros]     = useState([])
  const [showIncomplete, setShowIncomplete] = useState(false)
  const [selectedProIds, setSelectedProIds] = useState(null) // null = all
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    if (!clientId) return
    if (isPro) {
      // In professional mode, the only "professional" visible is the user themselves.
      setPros([professional])
      setSelectedProIds(new Set([professional.id]))
      return
    }
    supabase.from('professionals').select('*').eq('client_id', clientId).eq('active', true).order('created_at')
      .then(({ data }) => {
        const list = data ?? []
        setPros(list)
        if (empresaMode && list.length > 0) {
          // empresa mode: default to first professional, never "Todos"
          setSelectedProIds(new Set([list[0].id]))
        }
      })
  }, [clientId, isPro, professional?.id, empresaMode])

  const proById = React.useMemo(() => Object.fromEntries(pros.map(p => [p.id, p])), [pros])
  const activeProIds = selectedProIds ?? new Set(pros.map(p => p.id))
  const multi = pros.length > 1 && activeProIds.size > 1

  function toggleProId(id) {
    setSelectedProIds(curr => {
      const set = new Set(curr ?? pros.map(p => p.id))
      if (set.has(id)) {
        if (set.size === 1) return set // floor: at least one chip must stay selected
        set.delete(id)
      } else set.add(id)
      if (set.size === pros.length) return null
      return set
    })
  }
  const [now, setNow]       = useState(() => nowChile())
  useEffect(() => {
    const id = setInterval(() => setNow(nowChile()), 60_000)
    return () => clearInterval(id)
  }, [])

  // close status dropdown on outside click
  useEffect(() => {
    if (!statusOpenId) return
    const h = (e) => {
      if (!e.target.closest?.('[data-status-pop]')) setStatusOpenId(null)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [statusOpenId])

  // Fetch appointments + leads (filtered by client_id via RLS)
  useEffect(() => {
    if (!clientId) return
    let alive = true
    setLoading(true)

    const apptSelect = 'id, lead_id, professional_id, datetime, duration, status, notes, leads(id, name, phone, chat_id, conversation_context)'

    const apptQuery = () => {
      let q = supabase
        .from('appointments')
        .select(apptSelect)
        .gte('datetime', rangeStart.toISOString())
        .lt('datetime',  rangeEnd.toISOString())
        .order('datetime', { ascending: true })
      if (isPro) q = q.eq('professional_id', professional.id)
      return q
    }

    Promise.all([
      apptQuery(),
      supabase
        .from('leads')
        .select('id, chat_id, name, phone, conversation_context')
        .eq('client_id', clientId)
        .order('last_updated', { ascending: false })
        .limit(200),
    ]).then(([apptRes, leadsRes]) => {
      if (!alive) return
      const errMsg = apptRes.error?.message ?? leadsRes.error?.message ?? null
      setError(errMsg)
      setAppts(apptRes.data ?? [])
      setLeads(leadsRes.data ?? [])
      setLoading(false)
    })

    const ch = supabase
      .channel('appts-rt-' + rangeStart.toISOString())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => {
        apptQuery().then(({ data }) => alive && setAppts(data ?? []))
      })
      .subscribe()

    return () => { alive = false; supabase.removeChannel(ch) }
  }, [clientId, isPro, professional?.id, rangeStart.getTime(), rangeEnd.getTime()])

  // Filter by selected professionals (orphans without professional_id always shown when "all")
  const visibleAppts = pros.length === 0
    ? appts
    : appts.filter(a => a.professional_id ? activeProIds.has(a.professional_id) : selectedProIds === null)

  // index appointments by (dayIdx, hour) for week/day grids; by yyyy-mm-dd for month
  const eventsByCell = {}
  const eventsByDate = {}
  visibleAppts.forEach(a => {
    const d    = new Date(new Date(a.datetime).toLocaleString('en-US', { timeZone: TZ }))
    const day  = view === 'day' ? 0 : (d.getDay() + 6) % 7
    const hour = String(d.getHours()).padStart(2, '0')
    ;(eventsByCell[`${day}-${hour}`] ??= []).push(a)
    const k = toDateInput(d)
    ;(eventsByDate[k] ??= []).push(a)
  })

  const numDays = view === 'day' ? 1 : view === 'week' ? 7 : daysInMonth(rangeStart)
  const counts  = {
    confirmed: visibleAppts.filter(a => a.status === 'confirmed').length,
    pending:   visibleAppts.filter(a => a.status === 'pending').length,
    free:      Math.max(0, HOURS.length * numDays - visibleAppts.length),
  }
  const countsSub = view === 'day' ? 'hoy' : view === 'week' ? 'esta semana' : 'este mes'

  async function changeStatus(id, status) {
    setStatusOpenId(null)
    const { error } = await supabase.from('appointments').update({ status }).eq('id', id)
    if (!error) setAppts(prev => prev.map(a => a.id === id ? { ...a, status } : a))
  }

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', background: T.bg, fontFamily: T.sans, color: T.ink }}>
      <Sidebar active="calendar" onNavigate={onNavigate} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopBar
          title="Agenda"
          subtitle={subtitle}
          right={
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ display: 'flex', background: T.bgSunk, borderRadius: 8, border: `1px solid ${T.line}`, padding: 2 }}>
                {['day', 'week', 'month'].map(v => (
                  <button key={v} onClick={() => { setView(v); setAnchor(startOfDay(nowChile())) }} style={{
                    border: 'none', background: view === v ? T.bgRaised : 'transparent',
                    color: view === v ? T.ink : T.inkMuted,
                    padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                    boxShadow: view === v ? '0 1px 2px rgba(0,0,0,.05)' : 'none',
                  }}>{v === 'day' ? 'Día' : v === 'week' ? 'Semana' : 'Mes'}</button>
                ))}
              </div>
              <button style={{ ...btn('ghost'), opacity: navPrevDisabled ? 0.4 : 1, cursor: navPrevDisabled ? 'not-allowed' : 'pointer' }} disabled={navPrevDisabled} onClick={stepPrev}><Icon name="chevronL" size={13} /></button>
              <button style={{ ...btn('ghost'), opacity: navNextDisabled ? 0.4 : 1, cursor: navNextDisabled ? 'not-allowed' : 'pointer' }} disabled={navNextDisabled} onClick={stepNext}><Icon name="chevronR" size={13} /></button>
              {(() => {
                const noPros = pros.length === 0
                // Empresa mode: only profileIncomplete blocks. Empty pros is allowed —
                // the modal shows an inline prompt to add one in Ajustes.
                // Single mode: both profileIncomplete and noPros block.
                const blocked = profileIncomplete || (!empresaMode && noPros)
                const tip = profileIncomplete
                  ? 'Completa tu perfil profesional primero'
                  : (!empresaMode && noPros ? 'Agrega un profesional en Ajustes → Agenda para crear citas' : '')
                return (
                  <button
                    style={{ ...btn('primary'), opacity: blocked ? 0.5 : 1, cursor: blocked ? 'not-allowed' : 'pointer' }}
                    disabled={blocked}
                    title={tip}
                    onClick={() => {
                      if (blocked) return
                      setModal({ date: nowChile(), hour: '10' })
                    }}
                  >
                    <Icon name="plus" size={14} stroke="#fff" /> Nueva cita
                  </button>
                )
              })()}
            </div>
          }
        />

        <div style={{ display: 'flex', gap: 24, padding: '14px 24px', borderBottom: `1px solid ${T.line}`, background: T.bg, alignItems: 'center' }}>
          <Summary k="Citas confirmadas"  v={counts.confirmed} sub={countsSub} />
          <Summary k="Pendientes"         v={counts.pending}   sub="esperando confirmación" accent />
          <Summary k="Bloques libres"     v={counts.free}      sub={`de ${HOURS.length * numDays} bloques`} muted />
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 11.5, color: T.inkMuted, display: 'flex', alignItems: 'center', gap: 14 }}>
            <Legend color={T.primary} label="Confirmada" />
            <Legend color={T.accent}  label="Pendiente" dashed />
            <Legend color={T.bgSunk}  label="Bloque libre" outline />
          </div>
        </div>

        {pros.length > 1 && (
          <div style={{ padding: '12px 24px', borderBottom: `1px solid ${T.line}`, background: T.bg }}>
            <ProSelector
              pros={pros}
              activeProIds={activeProIds}
              allSelected={selectedProIds === null}
              onToggle={toggleProId}
              onSelectAll={() => setSelectedProIds(null)}
            />
          </div>
        )}

        {/* Render only when a real pro row exists with a non-empty full_name.
            Never fall back to agents_config.bot_name / agent_name. */}
        {!empresaMode && pros.length === 1 && (pros[0].full_name?.trim() ?? '') !== '' && (
          <SoloProBadge pro={pros[0]} />
        )}

        {error && (
          <div style={{ margin: '14px 24px 0', padding: '12px 14px', borderRadius: 10, background: T.dangerSoft ?? T.bgSunk, border: `1px solid ${T.line}`, fontSize: 12, color: T.danger ?? T.error ?? T.ink }}>
            {error}
          </div>
        )}

        <div style={{ flex: 1, overflow: 'auto', padding: '0 24px 24px', position: 'relative' }}>
          {profileIncomplete && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 10,
              background: 'rgba(250,248,244,0.85)',
              display: 'grid', placeItems: 'center', padding: 24,
            }}>
              <div style={{
                maxWidth: 380, textAlign: 'center', background: T.bgRaised,
                border: `1px solid ${T.line}`, borderRadius: 12,
                padding: '22px 24px', boxShadow: '0 12px 30px rgba(20,18,14,0.08)',
                fontFamily: T.sans,
              }}>
                <div style={{ fontFamily: T.serif, fontSize: 18, color: T.ink, marginBottom: 8 }}>
                  Perfil incompleto
                </div>
                <div style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.5, marginBottom: 14 }}>
                  Configura tu perfil profesional para comenzar a usar la agenda.
                </div>
                <a href="#settings" style={{
                  ...btn('primary'), textDecoration: 'none',
                  display: 'inline-flex', padding: '8px 14px',
                }}>Ir a Ajustes →</a>
              </div>
            </div>
          )}
          {view === 'month' ? (
            <MonthGrid
              monthStart={rangeStart}
              eventsByDate={eventsByDate}
              proById={proById}
              multi={multi}
              statusOpenId={statusOpenId}
              setStatusOpenId={setStatusOpenId}
              changeStatus={changeStatus}
              onSelectDay={(d) => { setAnchor(d); setView('day') }}
              onCreate={(d) => setModal({ date: d, hour: '10' })}
            />
          ) : view === 'day' && multi ? (
            <MultiDayGrid
              day={rangeStart}
              pros={pros.filter(p => activeProIds.has(p.id))}
              appts={visibleAppts}
              statusOpenId={statusOpenId}
              setStatusOpenId={setStatusOpenId}
              changeStatus={changeStatus}
              onCreate={(date, hour, proId) => setModal({ date, hour, proId })}
              now={now}
              isToday={isSameDay(rangeStart, now)}
            />
          ) : (
            <HoursGrid
              days={view === 'day' ? [rangeStart] : Array.from({ length: 7 }, (_, i) => addDays(rangeStart, i))}
              eventsByCell={eventsByCell}
              proById={proById}
              multi={multi}
              statusOpenId={statusOpenId}
              setStatusOpenId={setStatusOpenId}
              changeStatus={changeStatus}
              onCreate={(date, hour) => setModal({ date, hour })}
              onSelectDay={view === 'week' && multi ? (d) => { setAnchor(d); setView('day') } : null}
              showNowLine={view === 'day'}
              isToday={isSameDay(rangeStart, now)}
              viewedDay={view === 'day' ? rangeStart : null}
              now={now}
              singlePro={view === 'day' && pros.length >= 1 && activeProIds.size === 1
                ? pros.find(p => activeProIds.has(p.id))
                : null}
            />
          )}

          {loading && (
            <div style={{ padding: '24px 0', textAlign: 'center', color: T.inkMuted, fontFamily: T.serif, fontStyle: 'italic' }}>
              Cargando agenda…
            </div>
          )}
        </div>
      </div>

      {showIncomplete && (
        <ConfirmModal
          title="Perfil incompleto"
          description="Completa tu perfil profesional antes de agendar citas. Ve a Ajustes → Perfil profesional."
          confirmLabel="Ir a Ajustes"
          cancelLabel={null}
          onCancel={() => {}}
          onConfirm={() => { setShowIncomplete(false); window.location.hash = 'settings' }}
        />
      )}
      {modal && (
        <BookingModal
          slot={modal}
          leads={leads}
          pros={pros}
          clientId={clientId}
          onClose={() => setModal(null)}
          onSaved={(appt) => {
            setAppts(prev => [...prev, appt])
            setModal(null)
          }}
        />
      )}
    </div>
  )
}

// ── Hours grid (day + week) ───────────────────────────────────────────

function HoursGrid({ days, eventsByCell, proById, multi, singlePro, statusOpenId, setStatusOpenId, changeStatus, onCreate, onSelectDay, showNowLine, isToday, now, viewedDay }) {
  const n = days.length
  const headerRef = useRef(null)
  const [headerH, setHeaderH] = useState(0)
  useEffect(() => {
    if (headerRef.current) setHeaderH(headerRef.current.getBoundingClientRect().height)
  }, [n])
  const startH = parseInt(HOURS[0], 10)
  const endH   = parseInt(HOURS[HOURS.length - 1], 10) + 1
  const totalGridH = HOURS.length * 56
  const isPastDay   = viewedDay && viewedDay < startOfDay(nowChile())
  const isFutureDay = viewedDay && !isToday && !isPastDay
  let nowOff = 0
  if (showNowLine) {
    if (isPastDay)         nowOff = totalGridH - 1
    else if (isFutureDay)  nowOff = 0
    else if (isToday && now) {
      const h = now.getHours() + now.getMinutes() / 60
      nowOff = Math.max(0, Math.min(totalGridH - 1, (h - startH) * 56))
    }
  }
  const showLine = !!showNowLine
  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
    <div style={{
      display: 'grid',
      gridTemplateColumns: `60px repeat(${n}, 1fr)`,
      background: T.bgRaised,
      border: `1px solid ${T.line}`,
      borderRadius: 12, marginTop: 16, overflow: 'visible',
    }}>
      <div ref={headerRef} style={{ borderBottom: `1px solid ${T.line}`, background: T.bg }} />
      {days.map((d, i) => {
        const today = isSameDay(d, nowChile())
        const dowIdx = (d.getDay() + 6) % 7
        return (
          <div key={i} style={{
            padding: '12px 10px',
            borderBottom: `1px solid ${T.line}`,
            borderLeft: `1px solid ${T.lineSoft}`,
            background: today ? T.primarySoft : T.bg,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 10.5, color: today ? T.primary : T.inkMuted, letterSpacing: 0.5, textTransform: 'uppercase' }}>{DOW_SHORT[dowIdx]}</div>
            <div style={{ fontFamily: T.serif, fontSize: 22, color: today ? T.primary : T.ink, marginTop: 2, lineHeight: 1 }}>{d.getDate()}</div>
            {singlePro && n === 1 && (
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <ProAvatarSm pro={singlePro} />
                <span style={{ fontSize: 11, color: T.inkSoft }}>{singlePro.full_name}</span>
              </div>
            )}
          </div>
        )
      })}

      {HOURS.map(h => (
        <React.Fragment key={h}>
          <div style={{
            padding: '0 10px', height: 56,
            borderBottom: `1px solid ${T.lineSoft}`,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
            paddingTop: 4, fontSize: 10.5, color: T.inkMuted, fontFamily: T.mono,
          }}>{h}:00</div>
          {days.map((dayDate, di) => {
            const cellKey = n === 1 ? `0-${h}` : `${(dayDate.getDay() + 6) % 7}-${h}`
            const ev      = (eventsByCell[cellKey] ?? [])[0]
            const nowSantiago = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago' }))
            const today   = isSameDay(dayDate, nowSantiago)
            const slotDt  = new Date(dayDate); slotDt.setHours(parseInt(h,10), 0, 0, 0)
            const isPast  = slotDt < nowSantiago
            return (
              <div
                key={di + h}
                onClick={() => {
                  if (ev || isPast) return
                  if (onSelectDay) onSelectDay(startOfDay(dayDate))
                  else onCreate(dayDate, h)
                }}
                style={{
                  height: 56,
                  borderBottom: `1px solid ${T.lineSoft}`,
                  borderLeft:   `1px solid ${T.lineSoft}`,
                  background: ev ? (today ? '#fcfbf7' : T.bgRaised) : isPast ? T.bgSunk : (today ? '#fcfbf7' : T.bgRaised),
                  opacity:    isPast && !ev ? 0.55 : 1,
                  cursor: ev ? 'default' : isPast ? 'not-allowed' : 'pointer',
                  position: 'relative', padding: 4,
                }}
              >
                {ev && (
                  <EventBlock
                    ev={ev}
                    name={leadName(ev.leads)}
                    pro={proById?.[ev.professional_id]}
                    multi={multi}
                    open={statusOpenId === ev.id}
                    onClick={() => setStatusOpenId(o => o === ev.id ? null : ev.id)}
                    onChangeStatus={(s) => changeStatus(ev.id, s)}
                  />
                )}
              </div>
            )
          })}
        </React.Fragment>
      ))}
    </div>
    {showLine && headerH > 0 && (
      <div style={{
        position: 'absolute',
        top: 16 + headerH + nowOff,
        left: 60, right: 0,
        height: 0, borderTop: '1px solid #d6453a',
        pointerEvents: 'none', zIndex: 5,
      }}>
        <div style={{
          position: 'absolute', left: -3, top: -2.5,
          width: 5, height: 5, borderRadius: '50%', background: '#d6453a',
        }} />
      </div>
    )}
    </div>
  )
}

// ── Month grid ────────────────────────────────────────────────────────

function MonthGrid({ monthStart, eventsByDate, proById, multi, statusOpenId, setStatusOpenId, changeStatus, onSelectDay, onCreate }) {
  const firstCell  = startOfWeek(monthStart)
  const totalCells = Math.ceil((((monthStart.getDay() + 6) % 7) + daysInMonth(monthStart)) / 7) * 7
  const cells = Array.from({ length: totalCells }, (_, i) => addDays(firstCell, i))
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
        background: T.bg, border: `1px solid ${T.line}`, borderTopLeftRadius: 12, borderTopRightRadius: 12,
      }}>
        {DOW_SHORT.map(d => (
          <div key={d} style={{
            padding: '10px 8px', textAlign: 'center', fontSize: 10.5, color: T.inkMuted,
            letterSpacing: 0.5, textTransform: 'uppercase', borderLeft: `1px solid ${T.lineSoft}`,
          }}>{d}</div>
        ))}
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
        background: T.bgRaised,
        border: `1px solid ${T.line}`, borderTop: 'none',
        borderBottomLeftRadius: 12, borderBottomRightRadius: 12,
      }}>
        {cells.map((d, i) => {
          const today    = isSameDay(d, nowChile())
          const inMonth  = d.getMonth() === monthStart.getMonth()
          const isPast   = d < startOfDay(nowChile())
          const dayEvts  = eventsByDate[toDateInput(d)] ?? []
          return (
            <div
              key={i}
              onClick={() => {
                if (isPast) return
                if (multi) onSelectDay(startOfDay(d))
                else if (dayEvts.length) onSelectDay(startOfDay(d))
                else onCreate(d)
              }}
              style={{
                minHeight: 92,
                padding: 6,
                borderTop:  i >= 7 ? `1px solid ${T.lineSoft}` : 'none',
                borderLeft: i % 7 ? `1px solid ${T.lineSoft}` : 'none',
                background: today ? T.primarySoft : isPast ? T.bgSunk : (inMonth ? T.bgRaised : T.bg),
                opacity:    isPast ? 0.5 : (inMonth ? 1 : 0.55),
                cursor:     isPast ? 'not-allowed' : 'pointer',
                display: 'flex', flexDirection: 'column', gap: 3,
              }}
            >
              <div style={{
                fontFamily: T.serif, fontSize: 14,
                color: today ? T.primary : T.ink, lineHeight: 1,
              }}>{d.getDate()}</div>
              {dayEvts.slice(0, 3).map(ev => {
                const s = statusStyle(ev.status)
                const pro = proById?.[ev.professional_id]
                const usePro = !!(multi && pro)
                const bg = usePro ? hexAlpha(pro.color, 0.18) : s.bg
                const fg = usePro ? pro.color : s.fg
                const border = usePro ? pro.color : s.border
                const dt = new Date(new Date(ev.datetime).toLocaleString('en-US', { timeZone: TZ }))
                const time = `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`
                const label = usePro
                  ? `${time} ${pro.initials || initialsFromName(pro.full_name)}`
                  : `${time} ${leadName(ev.leads)}`
                const tooltip = usePro
                  ? `${leadName(ev.leads)} · ${time} · ${pro.full_name}`
                  : `${leadName(ev.leads)} · ${time}`
                const isOpen = statusOpenId === ev.id
                return (
                  <div
                    key={ev.id}
                    data-status-pop
                    title={tooltip}
                    onClick={(e) => {
                      e.stopPropagation()
                      setStatusOpenId?.(o => o === ev.id ? null : ev.id)
                    }}
                    style={{
                      position: 'relative',
                      fontSize: 10.5, padding: '2px 5px', borderRadius: 3,
                      background: bg, color: fg,
                      borderLeft: `2px solid ${border}`,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      fontWeight: usePro ? 600 : 400,
                      cursor: 'pointer',
                    }}
                  >
                    {label}
                    {isOpen && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          position: 'absolute', top: '100%', left: 0, marginTop: 4,
                          background: T.bgRaised, border: `1px solid ${T.line}`, borderRadius: 8,
                          boxShadow: '0 8px 24px rgba(20,18,14,0.12)', padding: 4, zIndex: 30, minWidth: 150,
                          color: T.ink, fontWeight: 400, textOverflow: 'clip', whiteSpace: 'normal',
                        }}
                      >
                        <div style={{ padding: '6px 10px 4px', fontSize: 10, color: T.inkMuted, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                          Cambiar estado
                        </div>
                        {Object.entries(STATUS_LABELS).map(([k, lab]) => (
                          <div
                            key={k}
                            onClick={() => changeStatus?.(ev.id, k)}
                            style={{
                              padding: '7px 10px', fontSize: 12.5, color: T.inkSoft, cursor: 'pointer', borderRadius: 4,
                              background: ev.status === k ? T.bgSunk : 'transparent',
                              fontWeight: ev.status === k ? 500 : 400,
                            }}
                          >
                            {lab}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
              {dayEvts.length > 3 && (
                <div style={{ fontSize: 10, color: T.inkMuted }}>+{dayEvts.length - 3} más</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Event block + status dropdown ─────────────────────────────────────

function EventBlock({ ev, name, pro, multi, open, onClick, onChangeStatus }) {
  const s = statusStyle(ev.status)
  const usePro = !!(multi && pro)
  const bg     = usePro ? hexAlpha(pro.color, 0.18) : s.bg
  const border = usePro ? pro.color : s.border
  const fg     = usePro ? pro.color : s.fg
  const display = usePro ? (pro.initials || initialsFromName(pro.full_name)) : name
  const dt = new Date(new Date(ev.datetime).toLocaleString('en-US', { timeZone: TZ }))
  const time = `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`
  const tooltip = usePro ? `${name} · ${time} · ${pro.full_name}` : ''
  return (
    <div data-status-pop style={{ position: 'relative', height: '100%' }} title={tooltip}>
      <div
        onClick={(e) => { e.stopPropagation(); onClick() }}
        style={{
          height: '100%', padding: '6px 8px', borderRadius: 6,
          background: bg,
          borderLeft: `3px solid ${border}`,
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          cursor: 'pointer',
        }}
      >
        <div style={{ fontSize: 11.5, fontWeight: 600, color: fg, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {display}
        </div>
        <div style={{ fontSize: 10, color: s.fg, opacity: 0.85, display: 'flex', alignItems: 'center', gap: 5 }}>
          <span>{ev.duration ?? 50} min</span>
          <span>·</span>
          <span>{STATUS_LABELS[ev.status] ?? ev.status}</span>
        </div>
      </div>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0,
            background: T.bgRaised, border: `1px solid ${T.line}`, borderRadius: 8,
            boxShadow: '0 8px 24px rgba(20,18,14,0.12)', padding: 4, zIndex: 30, minWidth: 150,
          }}
        >
          <div style={{ padding: '6px 10px 4px', fontSize: 10, color: T.inkMuted, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Cambiar estado
          </div>
          {Object.entries(STATUS_LABELS).map(([k, label]) => (
            <div
              key={k}
              onClick={() => onChangeStatus(k)}
              style={{
                padding: '7px 10px', fontSize: 12.5, color: T.inkSoft, cursor: 'pointer', borderRadius: 4,
                background: ev.status === k ? T.bgSunk : 'transparent',
                fontWeight: ev.status === k ? 500 : 400,
              }}
            >
              {label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Summary + Legend (unchanged visuals) ──────────────────────────────

function Summary({ k, v, sub, accent, muted }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: T.inkMuted, letterSpacing: 0.5, textTransform: 'uppercase' }}>{k}</div>
      <div style={{ fontFamily: T.serif, fontSize: 26, lineHeight: 1, marginTop: 3, color: accent ? T.accent : muted ? T.inkMuted : T.ink }}>{v}</div>
      <div style={{ fontSize: 11, color: T.inkMuted, marginTop: 2 }}>{sub}</div>
    </div>
  )
}

function Legend({ color, label, dashed, outline }) {
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

const selectStyle = {
  padding: '10px 12px', borderRadius: 8,
  border: `1px solid ${T.line}`, background: T.bg,
  fontSize: 13, color: T.ink, width: '100%', outline: 'none',
  fontFamily: T.sans, boxSizing: 'border-box',
}

// ── Multi-professional helpers ────────────────────────────────────────

function initialsFromName(name) {
  return (name ?? '').trim().split(/\s+/).slice(0, 2).map(s => s[0] ?? '').join('').toUpperCase() || '?'
}

function hexAlpha(hex, a) {
  const h = hex?.replace('#', '') ?? '000000'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

function SoloProBadge({ pro }) {
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

function ProAvatarSm({ pro, size = 22 }) {
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

function ProSelector({ pros, activeProIds, allSelected, onToggle, onSelectAll }) {
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

function ProChip({ pro, color, label, selected, onClick }) {
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

// Multi-column day view: one column per professional
function MultiDayGrid({ day, pros, appts, statusOpenId, setStatusOpenId, changeStatus, onCreate, now, isToday }) {
  const dowKey = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'][(day.getDay() + 6) % 7]
  const apptByPro = {}
  appts.forEach(a => {
    if (!a.professional_id) return
    const dt = new Date(new Date(a.datetime).toLocaleString('en-US', { timeZone: TZ }))
    if (!isSameDay(dt, day)) return
    const hour = String(dt.getHours()).padStart(2, '0')
    const k = `${a.professional_id}-${hour}`
    ;(apptByPro[k] ??= []).push(a)
  })
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: `60px repeat(${pros.length}, 1fr)`,
      background: T.bgRaised, border: `1px solid ${T.line}`,
      borderRadius: 12, marginTop: 16, overflow: 'visible',
    }}>
      <div style={{ borderBottom: `1px solid ${T.line}`, background: T.bg }} />
      {pros.map(p => (
        <div key={p.id} style={{
          padding: '12px 10px', textAlign: 'center',
          borderBottom: `1px solid ${T.line}`, borderLeft: `1px solid ${T.lineSoft}`,
          background: T.bg,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <ProAvatarSm pro={p} size={22} />
            <span style={{ fontSize: 12.5, color: T.ink, fontWeight: 500 }}>{p.full_name}</span>
          </div>
          <div style={{ marginTop: 4, height: 3, borderRadius: 2, background: p.color }} />
        </div>
      ))}

      {HOURS.map(h => (
        <React.Fragment key={h}>
          <div style={{
            padding: '0 10px', height: 56,
            borderBottom: `1px solid ${T.lineSoft}`,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
            paddingTop: 4, fontSize: 10.5, color: T.inkMuted, fontFamily: T.mono,
          }}>{h}:00</div>
          {pros.map(p => {
            const ev = (apptByPro[`${p.id}-${h}`] ?? [])[0]
            const av = p.availability?.[dowKey]
            const hr = parseInt(h, 10)
            const inAvail = av?.available
              && hr >= parseInt((av.start ?? '00:00').split(':')[0], 10)
              && hr <  parseInt((av.end   ?? '23:59').split(':')[0], 10)
            const slotDt = new Date(day); slotDt.setHours(hr, 0, 0, 0)
            const isPast = slotDt < nowChile()
            const blocked = !inAvail || isPast
            return (
              <div
                key={p.id + h}
                onClick={() => !ev && !blocked && onCreate(day, h, p.id)}
                style={{
                  height: 56,
                  borderBottom: `1px solid ${T.lineSoft}`,
                  borderLeft:   `1px solid ${T.lineSoft}`,
                  background: !inAvail ? T.bgSunk : (isPast ? T.bgSunk : T.bgRaised),
                  opacity: blocked && !ev ? 0.45 : 1,
                  cursor: ev ? 'default' : blocked ? 'not-allowed' : 'pointer',
                  position: 'relative', padding: 4,
                }}
              >
                {ev && (
                  <EventBlock
                    ev={ev}
                    name={leadName(ev.leads)}
                    pro={p}
                    multi={false}
                    open={statusOpenId === ev.id}
                    onClick={() => setStatusOpenId(o => o === ev.id ? null : ev.id)}
                    onChangeStatus={(s) => changeStatus(ev.id, s)}
                  />
                )}
              </div>
            )
          })}
        </React.Fragment>
      ))}
    </div>
  )
}

// ── Booking modal (creates appointment) ───────────────────────────────

function BookingModal({ slot, leads, pros, clientId, onClose, onSaved }) {
  const [mode, setMode]         = useState('existing')   // 'existing' | 'new'
  const [leadId, setLeadId]     = useState('')
  const [newName, setNewName]   = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [date, setDate]         = useState(toDateInput(slot.date ?? nowChile()))
  const [time, setTime]         = useState(`${slot.hour ?? '10'}:00`)
  const [duration, setDuration] = useState(50)
  const [notes, setNotes]       = useState('')
  const [proId, setProId]       = useState(slot.proId ?? (pros?.[0]?.id ?? ''))
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState(null)

  const cutoff   = new Date(nowChile().getTime() + 12 * 60 * 60 * 1000)
  const minDate  = toDateInput(cutoff)
  const minTime  = date === minDate
    ? `${String(cutoff.getHours()).padStart(2,'0')}:${String(cutoff.getMinutes()).padStart(2,'0')}`
    : undefined

  async function save() {
    const picked = new Date(`${date}T${time}:00`)
    if (picked < cutoff) { setErr('Las citas deben agendarse con al menos 12 horas de anticipación'); return }
    if (mode === 'existing' && !leadId) { setErr('Selecciona un lead'); return }
    if (mode === 'new' && !newName.trim()) { setErr('Ingresa un nombre'); return }
    if (mode === 'new' && !newPhone.trim()) { setErr('Ingresa un teléfono'); return }
    if (pros && pros.length > 0 && !proId) { setErr('Selecciona un profesional'); return }

    setSaving(true); setErr(null)
    const datetime = chileISO(date, time)

    let usedLeadId = leadId
    let leadObj    = leads.find(l => l.id === leadId) ?? null

    if (mode === 'new') {
      const syntheticChatId = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const { data: ld, error: lerr } = await supabase
        .from('leads')
        .insert({
          client_id:      clientId,
          chat_id:        syntheticChatId,
          name:           newName.trim(),
          phone:          newPhone.trim(),
          email:          newEmail.trim() || null,
          phase:          'confirmed',
          quality:        'calificado',
          qualified_lead: true,
        })
        .select('id, chat_id, name, phone, conversation_context')
        .single()
      if (lerr) { setSaving(false); setErr(lerr.message); return }
      usedLeadId = ld.id
      leadObj    = ld
    }

    const { data, error } = await supabase
      .from('appointments')
      .insert({
        client_id:       clientId,
        lead_id:         usedLeadId,
        professional_id: proId || null,
        datetime,
        duration,
        status:          'pending',
        notes:           notes || null,
      })
      .select('id, lead_id, professional_id, datetime, duration, status, notes')
      .single()
    setSaving(false)
    if (error) { setErr(error.message); return }
    onSaved({ ...data, leads: leadObj })
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(20,18,14,0.35)',
      display: 'grid', placeItems: 'center', zIndex: 50,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 480, background: T.bgRaised, borderRadius: 14,
        boxShadow: '0 24px 60px rgba(20,18,14,0.25)', overflow: 'hidden',
      }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${T.lineSoft}` }}>
          <div style={{ fontFamily: T.serif, fontSize: 22, color: T.ink }}>Nueva cita</div>
          <div style={{ fontSize: 12, color: T.inkMuted, marginTop: 4 }}>
            Crea una cita manualmente para un lead capturado por el bot.
          </div>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', background: T.bgSunk, borderRadius: 8, border: `1px solid ${T.line}`, padding: 2 }}>
            {[['existing', 'Lead existente'], ['new', 'Persona nueva']].map(([k, label]) => (
              <button key={k} type="button" onClick={() => setMode(k)} style={{
                flex: 1, border: 'none', background: mode === k ? T.bgRaised : 'transparent',
                color: mode === k ? T.ink : T.inkMuted,
                padding: '7px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                boxShadow: mode === k ? '0 1px 2px rgba(0,0,0,.05)' : 'none',
              }}>{label}</button>
            ))}
          </div>

          {pros && pros.length > 1 && (
            <Field label="Profesional">
              <select value={proId} onChange={e => setProId(e.target.value)} style={selectStyle}>
                <option value="">— selecciona —</option>
                {pros.map(p => (
                  <option key={p.id} value={p.id}>{p.full_name}</option>
                ))}
              </select>
            </Field>
          )}

          {pros && pros.length === 0 && (
            <div style={{
              padding: '10px 12px', borderRadius: 8,
              background: T.bgSunk, border: `1px solid ${T.line}`,
              fontSize: 12, color: T.inkMuted, lineHeight: 1.5,
            }}>
              Agrega un profesional en Ajustes → Agenda para asignar esta cita.
            </div>
          )}

          {mode === 'existing' ? (
            <Field label="Lead">
              <select value={leadId} onChange={e => setLeadId(e.target.value)} style={selectStyle}>
                <option value="">— selecciona un lead —</option>
                {leads.map(l => (
                  <option key={l.id ?? l.chat_id} value={l.id}>{leadName(l)}</option>
                ))}
              </select>
            </Field>
          ) : (
            <>
              <Field label="Nombre">
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nombre completo" style={selectStyle} />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Teléfono">
                  <input value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="+56 9 …" style={selectStyle} />
                </Field>
                <Field label="Email (opcional)">
                  <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="correo@ejemplo.cl" style={selectStyle} />
                </Field>
              </div>
            </>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="Fecha">
              <input type="date" value={date} min={minDate} onChange={e => setDate(e.target.value)} style={selectStyle} />
            </Field>
            <Field label="Hora">
              <TimePicker value={time} minTime={minTime} onChange={setTime} />
            </Field>
            <Field label="Duración">
              <select value={duration} onChange={e => setDuration(+e.target.value)} style={selectStyle}>
                <option value={30}>30 min</option>
                <option value={60}>60 min</option>
              </select>
            </Field>
          </div>

          <Field label="Notas (privadas)">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Opcional…" style={{ ...selectStyle, height: 70, resize: 'none', fontFamily: T.sans }} />
          </Field>

          {err && <div style={{ fontSize: 12, color: T.danger ?? T.error ?? '#c33' }}>{err}</div>}
        </div>

        <div style={{ padding: '14px 24px', borderTop: `1px solid ${T.lineSoft}`, background: T.bg, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={btn('ghost')} disabled={saving}>Cancelar</button>
          <button onClick={save}    style={btn('primary')} disabled={saving}>
            {saving ? 'Guardando…' : 'Agendar cita'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: T.inkMuted, marginBottom: 6, letterSpacing: 0.4, textTransform: 'uppercase' }}>{label}</div>
      {children}
    </div>
  )
}

