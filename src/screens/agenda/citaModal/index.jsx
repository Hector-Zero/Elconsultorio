import React, { useState, useEffect, useMemo, useRef } from 'react'
import { T, Icon, btn, ConfirmModal } from '../../shared.jsx'
import { supabase } from '../../../lib/supabase.js'
import {
  APPT_STATUS, APPT_TYPES, DURATIONS, DAY_LABELS_LONG, DOW_KEYS,
  FALLBACK_TIMES, timesFromRanges,
  inputStyle, monoInput,
  chileISO, fmtCLP,
  initialState, SAVED_SELECT, Label,
} from './_shared.jsx'
import PatientPicker from './patientPicker.jsx'

export { APPT_STATUS } from './_shared.jsx'

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
    // In edit mode the patient picker is hidden (read-only display) — the
    // patient_id stays whatever the row already has, including null for
    // legacy lead-only appointments.
    if (!isEdit) {
      if (patientMode === 'existing' && !patientId)              return 'Selecciona un paciente'
      if (patientMode === 'new'      && !newPt.full_name.trim()) return 'Ingresa el nombre del nuevo paciente'
    }
    if (!date)                                                    return 'Fecha requerida'
    if (!time)                                                    return 'Hora requerida'
    if (pros?.length > 0 && !proId)                               return 'Selecciona un profesional'
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

    // 4b. Ensure an active patient_assignments row exists for this
    // (patient, professional) pair — only on create. Edit mode never
    // touches assignments. We *don't* abort on failure: the
    // appointment insert proceeds and we surface a softer warning in
    // the success toast so the admin can fix it manually if needed.
    // Pattern matches patients.jsx's lead-derived auto-assignment
    // insert: { patient_id, professional_id, client_id, status:'active',
    // admin_can_view_notes:true }.
    let assignmentFailed = false
    if (!isEdit && usePatientId && proId) {
      try {
        if (patientMode === 'new') {
          // Brand-new patient → no prior assignment can exist.
          const { error: aErr } = await supabase
            .from('patient_assignments')
            .insert({
              patient_id:           usePatientId,
              professional_id:      proId,
              client_id:            clientId,
              status:               'active',
              admin_can_view_notes: true,
            })
          if (aErr) throw aErr
        } else {
          // Existing patient → only insert if no active assignment for
          // this (patient, professional) pair already exists.
          const { count, error: chkErr } = await supabase
            .from('patient_assignments')
            .select('id', { count: 'exact', head: true })
            .eq('client_id',       clientId)
            .eq('patient_id',      usePatientId)
            .eq('professional_id', proId)
            .eq('status',          'active')
          if (chkErr) throw chkErr
          if ((count ?? 0) === 0) {
            const { error: aErr } = await supabase
              .from('patient_assignments')
              .insert({
                patient_id:           usePatientId,
                professional_id:      proId,
                client_id:            clientId,
                status:               'active',
                admin_can_view_notes: true,
              })
            if (aErr) throw aErr
          }
        }
      } catch (e) {
        assignmentFailed = true
        // eslint-disable-next-line no-console
        console.warn('[citaModal] No se pudo crear/verificar patient_assignments — la cita se guardará igualmente.', e)
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
    onSaved?.(saved, { createdPatient, assignmentFailed })
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
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          }}>
            <div style={{ fontFamily: T.serif, fontSize: 22, color: T.ink, lineHeight: 1 }}>
              {isEdit ? 'Editar cita' : 'Nueva cita'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {isEdit && appt?.patient_id && onViewPatient && (
                <button
                  onClick={() => { onViewPatient(appt.patient_id) }}
                  disabled={saving || deleting}
                  aria-label="Ver ficha del paciente"
                  title="Ver ficha del paciente"
                  style={{
                    width: 30, height: 30, display: 'grid', placeItems: 'center',
                    background: 'transparent', border: 'none',
                    cursor: (saving || deleting) ? 'not-allowed' : 'pointer',
                    color: T.inkMuted, padding: 0, borderRadius: 6,
                  }}
                ><Icon name="file" size={16} stroke={T.inkMuted} /></button>
              )}
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
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflow: 'auto', padding: '18px 22px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Patient — editable picker on create, read-only display on edit. */}
            <PatientPicker
              isEdit={isEdit}
              appt={appt}
              selectedPat={selectedPat}
              patientId={patientId}
              setPatientId={setPatientId}
              patientMode={patientMode}
              setPatientMode={setPatientMode}
              patientSearch={patientSearch}
              setPatientSearch={setPatientSearch}
              searchOpen={searchOpen}
              setSearchOpen={setSearchOpen}
              newPt={newPt}
              setNewPt={setNewPt}
              filteredPatients={filteredPatients}
              pickPatient={pickPatient}
              clearPatient={clearPatient}
              searchRef={searchRef}
            />

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
              <button
                onClick={() => setConfirmDel(true)}
                disabled={saving || deleting}
                style={{
                  ...btn('ghost'),
                  color: T.danger, borderColor: T.danger,
                  cursor: (saving || deleting) ? 'not-allowed' : 'pointer',
                }}
              >Eliminar</button>
            ) : <div />}
            <div style={{ flex: 1 }} />
            {/* Cancelar is only in create mode — edit mode closes via × or backdrop. */}
            {!isEdit && (
              <button onClick={safeClose} style={btn('ghost')} disabled={saving || deleting}>Cancelar</button>
            )}
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
