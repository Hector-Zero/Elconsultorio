import React, { useState, useEffect, useContext } from 'react'
import { T, Icon, Sidebar, TopBar, btn, ConfirmModal } from './shared.jsx'
import { ClientCtx } from '../lib/ClientCtx.js'
import { supabase } from '../lib/supabase.js'
import CitaModal from './agenda/citaModal.jsx'
import {
  STATUS_LABELS, DOW_KEY_BY_NUM, HOURS, TZ,
  addDays, addMonths, daysInMonth, fmtDay, fmtMonth, fmtRange,
  isSameDay, nowChile, startOfDay, startOfMonth, toDateInput,
  Summary, Legend,
} from './agenda/_shared.jsx'
import HoursGrid from './agenda/hoursGrid.jsx'
import MonthGrid from './agenda/monthGrid.jsx'
import MultiDayGrid from './agenda/multiDayGrid.jsx'
import StatusFilterBar from './agenda/statusFilterBar.jsx'
import { SoloProBadge, ProSelector } from './agenda/proSelector.jsx'

// Single source of truth for the appointment row select — keeps the
// initial fetch, realtime refresh, and post-save refresh on the same
// joined shape (LEFT joins by default per PostgREST, so missing
// patients / session_types / leads do not hide the row).
const APPT_SELECT = `
  id, lead_id, patient_id, professional_id, datetime, duration, status, notes,
  type, session_type_id, payment_link,
  patients(id, full_name, phone, email, rut),
  session_types(id, name, price_amount, price_currency),
  leads(id, name, phone, chat_id, conversation_context)
`.replace(/\s+/g, ' ').trim()

// Build { [proId]: { [dowKey]: [{ start, end }, ...] } } from raw rows of
// professional_schedules. Multiple ranges per day (split shifts) are preserved.
function buildAvailabilityMap(scheduleRows) {
  const out = {}
  for (const r of scheduleRows ?? []) {
    const proId = r.professional_id
    const key   = DOW_KEY_BY_NUM[r.day_of_week]
    if (!proId || !key) continue
    out[proId] ??= {}
    out[proId][key] ??= []
    out[proId][key].push({ start: r.start_time, end: r.end_time })
  }
  return out
}

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
  // modal shape:
  //   null                       — closed
  //   { slot: { date, hour, proId? } } — create
  //   { appt: <appt row> }       — edit existing
  const [modal, setModal]   = useState(null)

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

  const [appts, setAppts]                 = useState([])
  const [pros, setPros]                   = useState([])
  const [patientsCatalog, setPatientsCatalog]       = useState([])
  const [sessionTypesCatalog, setSessionTypesCatalog] = useState([])
  const [showIncomplete, setShowIncomplete] = useState(false)
  const [selectedProIds, setSelectedProIds] = useState(null) // null = all
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState(null)
  // Filter state — multi-select status chips + "Mostrar canceladas" toggle.
  // Default: all statuses except cancelled visible. Toggle reveals cancelled.
  const [statusFilter, setStatusFilter]   = useState(() => new Set(['pending_payment', 'confirmed', 'completed', 'no_show']))
  const [showCancelled, setShowCancelled] = useState(false)

  useEffect(() => {
    if (!clientId) return
    let alive = true
    async function load() {
      // 1. Determine base professionals.
      let basePros = []
      if (isPro) {
        basePros = professional ? [professional] : []
      } else {
        const { data } = await supabase
          .from('professionals')
          .select('*')
          .eq('client_id', clientId)
          .eq('active', true)
          .order('created_at')
        basePros = data ?? []
      }

      // 2. Hydrate availability from professional_schedules. We deliberately
      //    overwrite the legacy professionals.availability JSON column so the
      //    calendar reads only from the new schedules table. The legacy column
      //    is left in the DB as a backup, but never read here.
      if (basePros.length) {
        const ids = basePros.map(p => p.id).filter(Boolean)
        if (ids.length) {
          const { data: scheds } = await supabase
            .from('professional_schedules')
            .select('professional_id, day_of_week, start_time, end_time')
            .in('professional_id', ids)
            .eq('active', true)
          const map = buildAvailabilityMap(scheds ?? [])
          basePros = basePros.map(p => ({ ...p, availability: map[p.id] ?? {} }))
        }
      }

      if (!alive) return
      setPros(basePros)
      if (isPro && basePros.length) {
        setSelectedProIds(new Set([basePros[0].id]))
      } else if (!isPro && empresaMode && basePros.length > 0) {
        // empresa mode: default to first professional, never "Todos"
        setSelectedProIds(new Set([basePros[0].id]))
      }
    }
    load()
    return () => { alive = false }
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


  // Toast for transient confirmations after a save.
  const [toast, setToast] = useState(null)
  function flashToast(t, ms = 2500) {
    setToast(t)
    setTimeout(() => setToast(null), ms)
  }

  // Re-fetchable view of the visible window, so the modal can drive a
  // refresh after a successful save without each path re-implementing the
  // query. Stays in sync with the rangeStart/rangeEnd/clientId/isPro deps.
  async function refreshAppts() {
    if (!clientId) return
    let q = supabase
      .from('appointments')
      .select(APPT_SELECT)
      .gte('datetime', rangeStart.toISOString())
      .lt('datetime',  rangeEnd.toISOString())
      .order('datetime', { ascending: true })
    if (isPro) q = q.eq('professional_id', professional.id)
    const { data, error: e } = await q
    if (e) { setError(e.message); return }
    setAppts(data ?? [])
  }

  // Fetch appointments (filtered by client_id via RLS) + catalog data
  useEffect(() => {
    if (!clientId) return
    let alive = true
    setLoading(true)

    const apptQuery = () => {
      let q = supabase
        .from('appointments')
        .select(APPT_SELECT)
        .gte('datetime', rangeStart.toISOString())
        .lt('datetime',  rangeEnd.toISOString())
        .order('datetime', { ascending: true })
      if (isPro) q = q.eq('professional_id', professional.id)
      return q
    }

    Promise.all([
      apptQuery(),
      // Catalog fetches for the cita modal — kept here so they refresh on
      // client switch but don't re-run with each pagination of the calendar.
      supabase
        .from('patients')
        .select('id, full_name, phone, email, rut, address')
        .eq('client_id', clientId)
        .order('full_name', { ascending: true }),
      supabase
        .from('session_types')
        .select('id, name, price_amount, price_currency, display_order')
        .eq('client_id', clientId)
        .eq('active', true)
        .order('display_order', { ascending: true })
        .order('created_at',    { ascending: true }),
    ]).then(([apptRes, ptRes, stRes]) => {
      if (!alive) return
      const errMsg = apptRes.error?.message ?? ptRes.error?.message ?? stRes.error?.message ?? null
      setError(errMsg)
      setAppts(apptRes.data ?? [])
      setPatientsCatalog(ptRes.data ?? [])
      setSessionTypesCatalog(stRes.data ?? [])
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
  // and by the toolbar's status / cancelled filters.
  const visibleAppts = (pros.length === 0
    ? appts
    : appts.filter(a => a.professional_id ? activeProIds.has(a.professional_id) : selectedProIds === null)
  ).filter(a => {
    if (a.status === 'cancelled') return showCancelled
    return statusFilter.has(a.status) || !STATUS_LABELS[a.status] // unknown status falls through
  })

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
    confirmed:       visibleAppts.filter(a => a.status === 'confirmed').length,
    pendingPayment:  visibleAppts.filter(a => a.status === 'pending_payment').length,
    free:            Math.max(0, HOURS.length * numDays - visibleAppts.length),
  }
  const countsSub = view === 'day' ? 'hoy' : view === 'week' ? 'esta semana' : 'este mes'

  function toggleStatusFilter(s) {
    setStatusFilter(curr => {
      const next = new Set(curr)
      if (next.has(s)) next.delete(s); else next.add(s)
      return next
    })
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
                      setModal({ slot: { date: nowChile(), hour: '10' } })
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
          <Summary k="Confirmadas"        v={counts.confirmed}      sub={countsSub} />
          <Summary k="Pago pendiente"     v={counts.pendingPayment} sub="esperando pago" accent />
          <Summary k="Bloques libres"     v={counts.free}           sub={`de ${HOURS.length * numDays} bloques`} muted />
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 11.5, color: T.inkMuted, display: 'flex', alignItems: 'center', gap: 14 }}>
            <Legend color={T.primary} label="Confirmada" />
            <Legend color={T.accent}  label="Pago pendiente" dashed />
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

        <StatusFilterBar
          statusFilter={statusFilter}
          onToggle={toggleStatusFilter}
          showCancelled={showCancelled}
          onToggleCancelled={() => setShowCancelled(v => !v)}
        />

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
              onSelectAppt={(ev) => setModal({ appt: ev })}
              onSelectDay={(d) => { setAnchor(d); setView('day') }}
              onCreate={(d) => setModal({ slot: { date: d, hour: '10' } })}
            />
          ) : view === 'day' && multi ? (
            <MultiDayGrid
              day={rangeStart}
              pros={pros.filter(p => activeProIds.has(p.id))}
              appts={visibleAppts}
              onSelectAppt={(ev) => setModal({ appt: ev })}
              onCreate={(date, hour, proId) => setModal({ slot: { date, hour, proId } })}
              now={now}
              isToday={isSameDay(rangeStart, now)}
            />
          ) : (
            <HoursGrid
              days={view === 'day' ? [rangeStart] : Array.from({ length: 7 }, (_, i) => addDays(rangeStart, i))}
              eventsByCell={eventsByCell}
              proById={proById}
              multi={multi}
              onSelectAppt={(ev) => setModal({ appt: ev })}
              onCreate={(date, hour) => setModal({ slot: { date, hour } })}
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
        <CitaModal
          slot={modal.slot}
          appt={modal.appt}
          pros={pros}
          patients={patientsCatalog}
          sessionTypes={sessionTypesCatalog}
          clientId={clientId}
          onClose={() => setModal(null)}
          onSaved={(saved, meta) => {
            const wasEdit = !!modal.appt
            setModal(null)
            // Fold a freshly-created patient into the catalog so the next
            // "Buscar paciente" prompt finds them immediately.
            if (meta?.createdPatient) {
              setPatientsCatalog(prev => prev.some(p => p.id === meta.createdPatient.id) ? prev : [...prev, meta.createdPatient])
            }
            // Authoritative refresh — replaces the optimistic update so
            // edge cases (out-of-range datetime, joined columns mid-flight)
            // can't leave the grid empty while the count is non-zero.
            refreshAppts()
            // Toast degrades when the patient_assignments insert silently
            // failed (we still saved the appointment, but the pro's patient
            // list won't include this patient until the link is fixed).
            const baseMsg = wasEdit ? '✓ Cita actualizada' : '✓ Cita creada'
            const msg = meta?.assignmentFailed
              ? `${baseMsg}, pero asignación de paciente falló`
              : baseMsg
            flashToast({ kind: meta?.assignmentFailed ? 'err' : 'ok', msg }, meta?.assignmentFailed ? 4500 : 2500)
          }}
          onDeleted={() => {
            setModal(null)
            refreshAppts()
            flashToast({ kind: 'ok', msg: '✓ Cita eliminada' })
          }}
          onViewPatient={(patientId) => {
            setModal(null)
            // Lands on the ficha clínica (files.jsx) for that specific
            // patient. files.jsx interprets the param as a patient.id.
            onNavigate?.('files/' + patientId)
          }}
        />
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          padding: '10px 18px', borderRadius: 8, fontSize: 13, zIndex: 80,
          background: toast.kind === 'err' ? T.danger : T.primary, color: '#fff',
          boxShadow: '0 8px 24px rgba(20,18,14,0.25)',
        }}>{toast.msg}</div>
      )}
    </div>
  )
}
