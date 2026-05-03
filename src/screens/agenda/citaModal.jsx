import React, { useState, useEffect, useMemo, useRef } from 'react'
import { T, Icon, btn, ConfirmModal } from '../shared.jsx'
import { supabase } from '../../lib/supabase.js'

// ── Constants ────────────────────────────────────────────────────────────────

export const APPT_STATUS = [
  { value: 'pending_payment', label: 'Pago pendiente' },
  { value: 'confirmed',       label: 'Confirmada' },
  { value: 'completed',       label: 'Terminada' },
  { value: 'cancelled',       label: 'Cancelada' },
  { value: 'no_show',         label: 'No asistió' },
]

const APPT_TYPES = [
  { value: 'presencial', label: 'Presencial' },
  { value: 'online',     label: 'Online' },
]

const DURATIONS = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hora' },
]

// 0=Sun..6=Sat, matching Postgres / professional_schedules.day_of_week.
const DAY_LABELS_LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const DOW_KEYS        = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

// 30-min granularity is the booking floor — drop the seconds. Fallback grid
// covers the working day for off-schedule overrides.
const FALLBACK_TIMES = (() => {
  const out = []
  for (let h = 6; h <= 22; h++) {
    out.push(`${String(h).padStart(2, '0')}:00`)
    if (h < 22) out.push(`${String(h).padStart(2, '0')}:30`)
  }
  return out
})()

function hhmm(t) {
  const m = String(t ?? '').match(/^(\d{2}:\d{2})/)
  return m ? m[1] : ''
}

// Build the dropdown options from a pro's availability ranges for a given day.
// Returns [] when the day has no ranges — caller falls back to FALLBACK_TIMES.
function timesFromRanges(ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) return []
  const slots = new Set()
  for (const r of ranges) {
    const s = hhmm(r.start), e = hhmm(r.end)
    if (!s || !e) continue
    const [sh, sm] = s.split(':').map(Number)
    const [eh, em] = e.split(':').map(Number)
    let mins = sh * 60 + sm
    const endMin = eh * 60 + em
    while (mins < endMin) {
      const h  = Math.floor(mins / 60)
      const mm = mins % 60
      if (mm === 0 || mm === 30) {
        slots.add(`${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`)
      }
      mins += 30
    }
  }
  return Array.from(slots).sort()
}

// ── Styles ───────────────────────────────────────────────────────────────────

const inputStyle = {
  padding: '10px 12px', borderRadius: 8,
  border: `1px solid ${T.line}`, background: T.bg,
  fontSize: 13, color: T.ink, width: '100%', outline: 'none',
  fontFamily: T.sans, boxSizing: 'border-box',
}
const monoInput = { ...inputStyle, fontFamily: T.mono }

// ── Helpers ──────────────────────────────────────────────────────────────────

function toDateInputStr(d) {
  const yyyy = d.getFullYear()
  const mm   = String(d.getMonth() + 1).padStart(2, '0')
  const dd   = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function toTimeInputStr(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const TZ = 'America/Santiago'

// Treat (dateStr, timeStr) as Santiago wall-clock and return the corresponding
// UTC ISO string. Santiago is UTC-4 year-round per project policy (no DST
// observed); appending the literal "-04:00" lets the JS Date parser produce
// the correct instant directly.
//
// PRIOR BUG: an Intl-based offset computation that round-tripped through
// `toLocaleString` returned 0 minutes when the browser's local timezone
// happened to be Santiago, so a 09:00 pick was stored as 09:00 UTC instead
// of 13:00 UTC. Hardcoding the offset removes that dependency on the
// browser's TZ.
function chileISO(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00-04:00`).toISOString()
}

// Render-side helper: convert a stored UTC ISO into a JS Date whose
// .getHours()/.getDate() reflect Santiago wall-clock. Browser-TZ-independent
// because the second `new Date(...)` parses a string whose numeric components
// are the Santiago wall-clock — getHours() then echoes those numbers.
function toChileDate(iso) {
  return new Date(new Date(iso).toLocaleString('en-US', { timeZone: TZ }))
}

function fmtCLP(n) {
  if (n == null || n === '') return ''
  return '$' + Number(n).toLocaleString('es-CL')
}

// Initial state from either a slot (create) or an appointment (edit).
function initialState({ slot, appt }) {
  if (appt) {
    const d = toChileDate(appt.datetime)
    return {
      isEdit:        true,
      date:          toDateInputStr(d),
      time:          toTimeInputStr(d),
      duration:      appt.duration ?? 60,
      proId:         appt.professional_id ?? '',
      sessionTypeId: appt.session_type_id ?? '',
      type:          appt.type ?? 'presencial',
      status:        appt.status ?? 'pending_payment',
      notes:         appt.notes ?? '',
      paymentLink:   appt.payment_link ?? '',
      patientId:     appt.patient_id ?? '',
      patientMode:   'existing',
    }
  }
  const baseDate = slot?.date ?? new Date()
  const baseHour = slot?.hour != null ? String(slot.hour).padStart(2, '0') : '10'
  return {
    isEdit:        false,
    date:          toDateInputStr(baseDate),
    time:          `${baseHour}:00`,
    duration:      60,
    proId:         slot?.proId ?? '',
    sessionTypeId: '',
    type:          'presencial',
    status:        'pending_payment',
    notes:         '',
    paymentLink:   '',
    patientId:     '',
    patientMode:   'existing',
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export default function CitaModal({
  slot, appt, pros, patients, sessionTypes, clientId,
  onClose, onSaved, onDeleted, onViewPatient,
}) {
  const init = useMemo(() => initialState({ slot, appt }), [slot?.date, slot?.hour, appt?.id])

  const [date,          setDate]          = useState(init.date)
  const [time,          setTime]          = useState(init.time)
  const [duration,      setDuration]      = useState(init.duration)
  const [proId,         setProId]         = useState(init.proId || pros?.[0]?.id || '')
  const [sessionTypeId, setSessionTypeId] = useState(init.sessionTypeId)
  const [type,          setType]          = useState(init.type)
  const [status,        setStatus]        = useState(init.status)
  const [notes,         setNotes]         = useState(init.notes)
  const [paymentLink,   setPaymentLink]   = useState(init.paymentLink)
  const [patientMode,   setPatientMode]   = useState(init.patientMode)
  const [patientId,     setPatientId]     = useState(init.patientId)
  const [patientSearch, setPatientSearch] = useState('')
  const [searchOpen,    setSearchOpen]    = useState(false)

  // Inline new-patient form
  const [newPt, setNewPt] = useState({ full_name: '', rut: '', phone: '', email: '', address: '' })

  // Sticky once a patient is INSERTed in this modal session, so a second
  // Save click after a downstream failure doesn't insert another patient row.
  const [createdPatientId, setCreatedPatientId] = useState(null)

  const [saving,           setSaving]           = useState(false)
  const [deleting,         setDeleting]         = useState(false)
  const [confirmDel,       setConfirmDel]       = useState(false)
  const [err,              setErr]              = useState(null)
  const [pendingProceed,   setPendingProceed]   = useState(null) // function | null — for confirm-and-proceed warnings

  const isEdit       = init.isEdit
  const selectedPro  = pros.find(p => p.id === proId)
  const patientById  = useMemo(() => Object.fromEntries((patients ?? []).map(p => [p.id, p])), [patients])
  const selectedPat  = patientById[patientId]

  // Derive the time-picker options from the picked pro + date. Empty ranges
  // (off-schedule day) fall through to FALLBACK_TIMES so the user has a
  // sensible grid to pick from while the off-schedule warning intercepts save.
  const timeOptions = useMemo(() => {
    if (!selectedPro || !date) return FALLBACK_TIMES
    const dow    = new Date(`${date}T00:00:00`).getDay()
    const ranges = selectedPro?.availability?.[DOW_KEYS[dow]]
    const opts   = timesFromRanges(ranges)
    return opts.length ? opts : FALLBACK_TIMES
  }, [selectedPro, date])

  // Filter patients for the search dropdown.
  const filteredPatients = useMemo(() => {
    const q = patientSearch.trim().toLowerCase()
    const list = patients ?? []
    if (!q) return list.slice(0, 8)
    return list.filter(p =>
      (p.full_name ?? '').toLowerCase().includes(q) ||
      (p.rut ?? '').toLowerCase().includes(q) ||
      (p.email ?? '').toLowerCase().includes(q)
    ).slice(0, 8)
  }, [patients, patientSearch])

  const searchRef = useRef(null)
  useEffect(() => {
    if (!searchOpen) return
    function handler(e) {
      if (!searchRef.current?.contains(e.target)) setSearchOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [searchOpen])

  function pickPatient(p) {
    setPatientId(p.id)
    setPatientSearch(p.full_name ?? '')
    setSearchOpen(false)
  }
  function clearPatient() {
    setPatientId('')
    setPatientSearch('')
    setSearchOpen(false)
  }

  // ── validation ────────────────────────────────────────────────────────────
  function basicValidate() {
    if (patientMode === 'existing' && !patientId)              return 'Selecciona un paciente'
    if (patientMode === 'new'      && !newPt.full_name.trim()) return 'Ingresa el nombre del nuevo paciente'
    if (!date)                                                  return 'Fecha requerida'
    if (!time)                                                  return 'Hora requerida'
    if (pros?.length > 0 && !proId)                             return 'Selecciona un profesional'
    return null
  }

  // ── conflict check ────────────────────────────────────────────────────────
  async function checkConflict(datetimeIso) {
    let q = supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('professional_id', proId)
      .eq('datetime', datetimeIso)
      .neq('status', 'cancelled')
    if (isEdit && appt?.id) q = q.neq('id', appt.id)
    const res = await q
    if (res.error) throw new Error(`No se pudo verificar conflicto: ${res.error.message}`)
    return (res.count ?? 0) > 0
  }

  // ── core save ─────────────────────────────────────────────────────────────
  // Save flow:
  //   1. Validate; bail with inline error if anything is missing.
  //   2. Past-date / off-schedule warnings — surface a confirm modal,
  //      keep `saving` true so the Save button stays disabled while the
  //      user is deciding. Cancel resets `saving`.
  //   3. Conflict check (same pro + same datetime, excluding cancelled +
  //      excluding self in edit).
  //   4. Patient INSERT — only if patientMode === 'new' AND we haven't
  //      already created one in this modal session. We sticky the new id
  //      in `createdPatientId` so a second click after a later failure
  //      doesn't double-insert the patient.
  //   5. Appointment INSERT/UPDATE.
  //   6. Hand off to onSaved (parent re-fetches the calendar window).
  async function performSave({ acknowledgePast = false, acknowledgeOffSchedule = false } = {}) {
    setErr(null)

    const v = basicValidate()
    if (v) { setErr(v); setSaving(false); return }

    setSaving(true)

    const datetimeIso = chileISO(date, time)
    const dt          = new Date(datetimeIso)
    const isPast      = dt < new Date()

    // Off-schedule check uses the pre-hydrated availability from the parent —
    // same source of truth as the time-picker options. No extra round-trip.
    let offSchedule = false
    if (selectedPro?.id && !acknowledgeOffSchedule) {
      const dow    = dt.getDay()
      const ranges = selectedPro?.availability?.[DOW_KEYS[dow]] ?? []
      offSchedule  = ranges.length === 0
    }

    // Stack warnings — past first, then off-schedule, then proceed. Each
    // confirmation re-enters this function with the corresponding flag.
    if (isPast && !acknowledgePast) {
      setPendingProceed(() => () => performSave({ acknowledgePast: true, acknowledgeOffSchedule }))
      setErr({ type: 'warn-past' })
      return // keep `saving` true so the Save button stays disabled
    }
    if (offSchedule) {
      setPendingProceed(() => () => performSave({ acknowledgePast, acknowledgeOffSchedule: true }))
      setErr({ type: 'warn-off-schedule', day: DAY_LABELS_LONG[dt.getDay()] })
      return
    }

    // 3. Conflict check.
    let conflict
    try { conflict = await checkConflict(datetimeIso) }
    catch (e) { setSaving(false); setErr(e.message); return }
    if (conflict) {
      setSaving(false)
      setErr('Ya existe una cita en ese horario para este profesional')
      return
    }

    // 4. Patient — reuse a sticky id if we already inserted one this session.
    let usePatientId = patientId
    let createdPatient = null
    if (patientMode === 'new') {
      if (createdPatientId) {
        usePatientId = createdPatientId
      } else {
        const insertPt = {
          client_id:  clientId,
          full_name:  newPt.full_name.trim(),
          rut:        newPt.rut.trim()     || null,
          phone:      newPt.phone.trim()   || null,
          email:      newPt.email.trim()   || null,
          address:    newPt.address.trim() || null,
          status:     'active',
        }
        const { data: pt, error: pErr } = await supabase
          .from('patients')
          .insert(insertPt)
          .select('id, full_name, phone, email, rut, address')
          .single()
        if (pErr) {
          setSaving(false)
          setErr(`No se pudo crear paciente: ${pErr.message}`)
          return
        }
        usePatientId   = pt.id
        createdPatient = pt
        setCreatedPatientId(pt.id) // sticky — survives later failures
      }
    }

    // 5. Appointment.
    const appointmentRow = {
      client_id:       clientId,
      patient_id:      usePatientId || null,
      professional_id: proId || null,
      datetime:        datetimeIso,
      duration:        Number(duration) || 60,
      session_type_id: sessionTypeId || null,
      type,
      // Status is only writable in edit mode; on create, force pending_payment.
      status:          isEdit ? status : 'pending_payment',
      notes:           notes?.trim() || null,
      // payment_link is only exposed in edit mode (UI hides the input on create).
      payment_link:    isEdit ? (paymentLink?.trim() || null) : null,
    }

    let saved
    try {
      if (isEdit) {
        const { data, error } = await supabase
          .from('appointments')
          .update(appointmentRow)
          .eq('id', appt.id)
          .select(SAVED_SELECT)
          .single()
        if (error) throw error
        saved = data
      } else {
        const { data, error } = await supabase
          .from('appointments')
          .insert(appointmentRow)
          .select(SAVED_SELECT)
          .single()
        if (error) throw error
        saved = data
      }
    } catch (e) {
      setSaving(false)
      setErr(`No se pudo ${isEdit ? 'guardar' : 'crear'} la cita: ${e.message}`)
      return
    }

    setSaving(false)
    onSaved?.(saved, { createdPatient })
  }

  async function performDelete() {
    if (!isEdit || !appt?.id) return
    setConfirmDel(false)
    setDeleting(true)
    setErr(null)
    const { error } = await supabase.from('appointments').delete().eq('id', appt.id)
    setDeleting(false)
    if (error) { setErr(`No se pudo eliminar: ${error.message}`); return }
    onDeleted?.(appt.id)
  }

  // Sanitize close (don't close mid-save)
  const safeClose = () => { if (!saving && !deleting) onClose?.() }

  return (
    <>
      <div onClick={safeClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(20,18,14,0.45)',
        display: 'grid', placeItems: 'center', zIndex: 60, padding: 16,
      }}>
        <div onClick={e => e.stopPropagation()} style={{
          width: '100%', maxWidth: 560, maxHeight: '90vh',
          background: T.bgRaised, borderRadius: 14,
          boxShadow: '0 24px 60px rgba(20,18,14,0.28)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          fontFamily: T.sans,
        }}>
          {/* Header */}
          <div style={{
            padding: '18px 22px 14px', borderBottom: `1px solid ${T.lineSoft}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ fontFamily: T.serif, fontSize: 22, color: T.ink, lineHeight: 1 }}>
              {isEdit ? 'Editar cita' : 'Nueva cita'}
            </div>
            <button
              onClick={safeClose}
              disabled={saving || deleting}
              aria-label="Cerrar"
              style={{
                background: 'transparent', border: 'none', cursor: (saving || deleting) ? 'not-allowed' : 'pointer',
                color: T.inkMuted, fontSize: 22, lineHeight: 1, padding: 4,
              }}
            >×</button>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflow: 'auto', padding: '18px 22px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Patient picker */}
            <div>
              <Label>Paciente *</Label>
              <div style={{
                display: 'flex', gap: 6, marginBottom: 8,
                background: T.bgSunk, borderRadius: 8, padding: 2, border: `1px solid ${T.line}`,
              }}>
                {[['existing', 'Buscar paciente'], ['new', '+ Crear nuevo']].map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setPatientMode(k)} style={{
                    flex: 1, border: 'none', background: patientMode === k ? T.bgRaised : 'transparent',
                    color: patientMode === k ? T.ink : T.inkMuted,
                    padding: '7px 10px', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  }}>{label}</button>
                ))}
              </div>

              {patientMode === 'existing' ? (
                <div ref={searchRef} style={{ position: 'relative' }}>
                  <input
                    value={patientSearch || (selectedPat?.full_name ?? '')}
                    onChange={e => { setPatientSearch(e.target.value); setSearchOpen(true); if (selectedPat) setPatientId('') }}
                    onFocus={() => setSearchOpen(true)}
                    placeholder="Buscar por nombre, RUT o email…"
                    style={inputStyle}
                  />
                  {selectedPat && !searchOpen && (
                    <button
                      onClick={clearPatient}
                      title="Cambiar paciente"
                      style={{
                        position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        color: T.inkMuted, padding: 6,
                      }}
                    ><Icon name="x" size={13} stroke={T.inkMuted} /></button>
                  )}
                  {searchOpen && (
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                      background: T.bgRaised, border: `1px solid ${T.line}`, borderRadius: 8,
                      boxShadow: '0 8px 24px rgba(20,18,14,0.16)', maxHeight: 240, overflow: 'auto', zIndex: 10,
                    }}>
                      {filteredPatients.length === 0 ? (
                        <div style={{ padding: '10px 12px', fontSize: 12.5, color: T.inkMuted, fontStyle: 'italic' }}>
                          Sin resultados. Cambia a "Crear nuevo" para agregar.
                        </div>
                      ) : filteredPatients.map(p => (
                        <div
                          key={p.id}
                          onClick={() => pickPatient(p)}
                          style={{
                            padding: '8px 12px', fontSize: 12.5, cursor: 'pointer',
                            borderBottom: `1px solid ${T.lineSoft}`,
                            background: p.id === patientId ? T.bgSunk : 'transparent',
                          }}
                        >
                          <div style={{ color: T.ink, fontWeight: 500 }}>{p.full_name}</div>
                          <div style={{ fontSize: 11, color: T.inkMuted, marginTop: 2 }}>
                            {[p.rut, p.email, p.phone].filter(Boolean).join(' · ') || '—'}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{
                  padding: 12, borderRadius: 8, background: T.bgSunk, border: `1px solid ${T.line}`,
                  display: 'flex', flexDirection: 'column', gap: 10,
                }}>
                  <div>
                    <Label>Nombre completo *</Label>
                    <input
                      value={newPt.full_name}
                      onChange={e => setNewPt(p => ({ ...p, full_name: e.target.value }))}
                      placeholder="Ej: María Pérez"
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <Label>RUT</Label>
                      <input value={newPt.rut} onChange={e => setNewPt(p => ({ ...p, rut: e.target.value }))} placeholder="12.345.678-9" style={monoInput} />
                    </div>
                    <div>
                      <Label>Teléfono</Label>
                      <input value={newPt.phone} onChange={e => setNewPt(p => ({ ...p, phone: e.target.value }))} placeholder="+56 9 …" style={monoInput} />
                    </div>
                  </div>
                  <div>
                    <Label>Email</Label>
                    <input type="email" value={newPt.email} onChange={e => setNewPt(p => ({ ...p, email: e.target.value }))} placeholder="correo@ejemplo.cl" style={inputStyle} />
                  </div>
                  <div>
                    <Label>Dirección</Label>
                    <input value={newPt.address} onChange={e => setNewPt(p => ({ ...p, address: e.target.value }))} placeholder="Av. … 1234, Comuna" style={inputStyle} />
                  </div>
                </div>
              )}
            </div>

            {/* Professional + session type */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <Label>Profesional *</Label>
                <select value={proId} onChange={e => setProId(e.target.value)} style={inputStyle}>
                  <option value="">— selecciona —</option>
                  {(pros ?? []).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </div>
              <div>
                <Label>Tipo de servicio</Label>
                <select value={sessionTypeId} onChange={e => setSessionTypeId(e.target.value)} style={inputStyle}>
                  <option value="">— sin especificar —</option>
                  {(sessionTypes ?? []).map(st => (
                    <option key={st.id} value={st.id}>
                      {st.name}{st.price_amount != null ? ` — ${fmtCLP(st.price_amount)}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Date / time / duration */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 130px', gap: 10 }}>
              <div>
                <Label>Fecha *</Label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <Label>Hora *</Label>
                <select
                  value={time}
                  onChange={e => setTime(e.target.value)}
                  style={monoInput}
                >
                  {/* Always include the current value, even if it falls outside
                      the pro's schedule grid — otherwise editing a legacy row
                      would silently snap to a different time on first render. */}
                  {!timeOptions.includes(time) && time && (
                    <option value={time}>{time}</option>
                  )}
                  {timeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <Label>Duración</Label>
                <select value={duration} onChange={e => setDuration(+e.target.value)} style={inputStyle}>
                  {DURATIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
            </div>

            {/* Modalidad + (edit only) Estado */}
            <div style={{ display: 'grid', gridTemplateColumns: isEdit ? '1fr 1fr' : '1fr', gap: 10 }}>
              <div>
                <Label>Modalidad</Label>
                <div style={{
                  display: 'flex', gap: 4,
                  background: T.bgSunk, borderRadius: 8, padding: 2, border: `1px solid ${T.line}`,
                }}>
                  {APPT_TYPES.map(t => (
                    <button key={t.value} type="button" onClick={() => setType(t.value)} style={{
                      flex: 1, border: 'none', background: type === t.value ? T.bgRaised : 'transparent',
                      color: type === t.value ? T.ink : T.inkMuted,
                      padding: '8px 10px', borderRadius: 6, fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
                    }}>{t.label}</button>
                  ))}
                </div>
              </div>
              {isEdit && (
                <div>
                  <Label>Estado</Label>
                  <select value={status} onChange={e => setStatus(e.target.value)} style={inputStyle}>
                    {APPT_STATUS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* payment_link — edit-mode only */}
            {isEdit && (
              <div>
                <Label>Link de pago</Label>
                <input
                  value={paymentLink}
                  onChange={e => setPaymentLink(e.target.value)}
                  placeholder="https://www.flow.cl/btn.php?token=…"
                  style={monoInput}
                />
              </div>
            )}

            {/* Notes */}
            <div>
              <Label>Notas</Label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                placeholder="Observaciones internas — no visibles para el paciente."
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
              />
            </div>

            {/* Errors / warnings */}
            {typeof err === 'string' && (
              <div style={{
                padding: '8px 12px', borderRadius: 6, fontSize: 12,
                background: T.dangerSoft ?? T.bgSunk, color: T.danger ?? T.ink, border: `1px solid ${T.danger}`,
              }}>{err}</div>
            )}
          </div>

          {/* Footer */}
          <div style={{
            padding: '14px 22px', borderTop: `1px solid ${T.lineSoft}`, background: T.bg,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            {isEdit ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => setConfirmDel(true)}
                  disabled={saving || deleting}
                  style={{
                    ...btn('ghost'),
                    color: T.danger, borderColor: T.danger,
                    cursor: (saving || deleting) ? 'not-allowed' : 'pointer',
                  }}
                >Eliminar</button>
                {appt?.patient_id && onViewPatient && (
                  <button
                    onClick={() => { onViewPatient(appt.patient_id); }}
                    disabled={saving || deleting}
                    style={btn('soft')}
                  >Ver ficha del paciente</button>
                )}
              </div>
            ) : <div />}
            <div style={{ flex: 1 }} />
            <button onClick={safeClose} style={btn('ghost')} disabled={saving || deleting}>Cancelar</button>
            <button
              onClick={() => performSave()}
              style={btn('primary')}
              disabled={saving || deleting}
            >
              {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear cita'}
            </button>
          </div>
        </div>
      </div>

      {/* Past-date warning */}
      {err?.type === 'warn-past' && pendingProceed && (
        <ConfirmModal
          title="Esta fecha ya pasó"
          description="Estás creando o editando una cita en el pasado. ¿Continuar de todos modos? Útil para registrar sesiones realizadas."
          confirmLabel="Sí, continuar"
          variant="default"
          onCancel={() => { setErr(null); setPendingProceed(null); setSaving(false) }}
          onConfirm={() => { const fn = pendingProceed; setErr(null); setPendingProceed(null); fn() }}
        />
      )}
      {/* Off-schedule warning */}
      {err?.type === 'warn-off-schedule' && pendingProceed && (
        <ConfirmModal
          title="Día fuera de la agenda habitual"
          description={`Este profesional no atiende los ${err.day}. ¿Crear la cita igualmente?`}
          confirmLabel="Sí, agendar"
          variant="default"
          onCancel={() => { setErr(null); setPendingProceed(null); setSaving(false) }}
          onConfirm={() => { const fn = pendingProceed; setErr(null); setPendingProceed(null); fn() }}
        />
      )}

      {/* Delete confirmation */}
      {confirmDel && (
        <ConfirmModal
          title="¿Eliminar esta cita?"
          description="Esta acción es permanente y no se puede deshacer."
          confirmLabel="Eliminar"
          variant="danger"
          onCancel={() => setConfirmDel(false)}
          onConfirm={performDelete}
        />
      )}
    </>
  )
}

// Pull joined fields back so the parent renders the new row instantly.
const SAVED_SELECT = `
  id, lead_id, patient_id, professional_id, datetime, duration, status, notes,
  type, session_type_id, payment_link,
  patients(id, full_name, phone, email, rut),
  session_types(id, name, price_amount, price_currency),
  leads(id, name, phone, chat_id, conversation_context)
`.replace(/\s+/g, ' ').trim()

function Label({ children }) {
  return (
    <div style={{
      fontSize: 11, color: T.inkMuted, marginBottom: 6,
      letterSpacing: 0.4, textTransform: 'uppercase',
    }}>{children}</div>
  )
}
