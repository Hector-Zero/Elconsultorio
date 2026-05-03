import React, { useState, useEffect, useContext, useRef } from 'react'
import { T, Icon, Sidebar, Avatar, TopBar, btn, CLP } from './shared.jsx'
import { ClientCtx } from '../lib/ClientCtx.js'
import { supabase } from '../lib/supabase.js'

const TZ = 'America/Santiago'
const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
const DOW    = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']

const todayISO = () => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }))
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
const fmtLongDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: TZ }))
  return `${String(d.getDate()).padStart(2,'0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
const fmtNextCard = (iso) => {
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: TZ }))
  return {
    dow: DOW[d.getDay()],
    day: d.getDate(),
    rest: `${MONTHS[d.getMonth()]} · ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`,
  }
}

export default function FilesScreen({ onNavigate, param }) {
  const { clientId } = useContext(ClientCtx)
  const [patient, setPatient] = useState(null)
  const [next, setNext]       = useState(null)
  const [apptCount, setApptCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [saving, setSaving]   = useState(false)
  const [showSession, setShowSession] = useState(false)

  useEffect(() => {
    if (!clientId) return
    let alive = true
    setLoading(true); setError(null)

    async function load() {
      // `param` is now a patient.id (UUID). Reject the literal 'null' /
      // 'undefined' strings that can leak through when a caller passes
      // `'files/' + p.lead_id` for a manually-created patient whose
      // lead_id is null — the prior version forwarded that to .eq() and
      // Postgres tried to cast 'null' to uuid, surfacing as
      // "invalid input syntax for type uuid: null".
      const patientId = (param && param !== 'null' && param !== 'undefined') ? param : null

      let pat = null
      if (patientId) {
        const { data, error: pErr } = await supabase
          .from('patients').select('*')
          .eq('client_id', clientId).eq('id', patientId).maybeSingle()
        if (pErr) { setError(pErr.message); setLoading(false); return }
        if (!alive) return
        pat = data
      } else {
        // Fall back: first patient for this client (preserves prior behavior
        // of "open the ficha screen with no param" landing on a sensible default).
        const { data } = await supabase
          .from('patients').select('*').eq('client_id', clientId)
          .order('created_at', { ascending: true }).limit(1).maybeSingle()
        if (!alive) return
        pat = data
      }
      if (!pat) {
        setError('Paciente no encontrado. Selecciona un paciente desde la lista de Pacientes.')
        setLoading(false)
        return
      }
      setPatient(pat)

      // Appointments — match by patient_id (the new schema). Legacy rows
      // that only have lead_id are pulled in too when the patient still
      // carries a lead_id, via an OR clause.
      let apptQ = supabase
        .from('appointments').select('id, datetime, duration, status, lead_id, patient_id')
        .eq('client_id', clientId)
        .order('datetime', { ascending: true })
      apptQ = pat.lead_id
        ? apptQ.or(`patient_id.eq.${pat.id},lead_id.eq.${pat.lead_id}`)
        : apptQ.eq('patient_id', pat.id)
      const { data: ap } = await apptQ
      if (!alive) return
      const all = ap ?? []
      setApptCount(all.filter(a => a.status === 'confirmed' || a.status === 'completed').length)
      setNext(all.find(a => new Date(a.datetime) > new Date()) ?? null)
      setLoading(false)
    }
    load()
    return () => { alive = false }
  }, [clientId, param])

  function update(patch) { setPatient(p => ({ ...p, ...patch })) }

  async function save() {
    if (!patient) return
    setSaving(true)
    const { error: e } = await supabase.from('patients').update({
      full_name:     patient.full_name,
      rut:           patient.rut,
      phone:         patient.phone,
      email:         patient.email,
      insurance:     patient.insurance,
      diagnosis:     patient.diagnosis,
      medication:    patient.medication,
      session_value: patient.session_value,
    }).eq('id', patient.id)
    setSaving(false)
    if (e) setError(e.message)
  }

  async function addSession(entry) {
    if (!patient) return
    const next = [...(patient.clinical_notes ?? []), entry]
    const { error: e } = await supabase
      .from('patients')
      .update({ clinical_notes: next, total_sessions: next.length })
      .eq('id', patient.id)
    if (e) { setError(e.message); return }
    setPatient(p => ({ ...p, clinical_notes: next, total_sessions: next.length }))
    setShowSession(false)
  }

  async function updateSessionNotes(sessionRef, newNotes) {
    if (!patient) return
    const arr = patient.clinical_notes ?? []
    const next = arr.map(s => s === sessionRef ? { ...s, notes: newNotes } : s)
    const { error: e } = await supabase
      .from('patients')
      .update({ clinical_notes: next })
      .eq('id', patient.id)
    if (e) { setError(e.message); return }
    setPatient(p => ({ ...p, clinical_notes: next }))
  }

  if (loading) {
    return (
      <div style={{ display:'flex', height:'100%', width:'100%', background:T.bg, fontFamily:T.sans }}>
        <Sidebar active="files" onNavigate={onNavigate} />
        <div style={{ flex:1, display:'grid', placeItems:'center', color:T.inkMuted, fontFamily:T.serif, fontStyle:'italic' }}>cargando ficha…</div>
      </div>
    )
  }

  if (!patient) {
    return (
      <div style={{ display:'flex', height:'100%', width:'100%', background:T.bg, fontFamily:T.sans }}>
        <Sidebar active="files" onNavigate={onNavigate} />
        <div style={{ flex:1, display:'flex', flexDirection:'column' }}>
          <TopBar title="Ficha clínica" subtitle="Sin paciente seleccionado" />
          <div style={{ padding: 32, color: T.inkMuted }}>
            {error || 'Selecciona un paciente desde la lista de Pacientes.'}
            <div style={{ marginTop: 14 }}>
              <button style={btn('primary')} onClick={() => onNavigate?.('patients')}>Ir a Pacientes</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const sessions = Array.isArray(patient.clinical_notes) ? patient.clinical_notes : []
  const sortedSessions = [...sessions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', background: T.bg, fontFamily: T.sans, color: T.ink }}>
      <Sidebar active="files" onNavigate={onNavigate} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'auto' }}>
        <TopBar
          title="Ficha clínica"
          subtitle={<span style={{ fontFamily: T.mono }}>Pacientes · {patient.full_name}</span>}
          right={
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={btn('ghost')}><Icon name="download" size={13} /> Exportar PDF</button>
              <button style={btn('ghost')}><Icon name="file" size={13} /> Certificado de atención</button>
              <button style={btn('primary')} onClick={save} disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar cambios'}
              </button>
              <button style={btn('primary')} onClick={() => setShowSession(true)}>
                <Icon name="plus" size={14} stroke="#fff" /> Nueva sesión
              </button>
            </div>
          }
        />

        {error && (
          <div style={{ margin: '14px 24px 0', padding: '12px 14px', borderRadius: 10, background: T.dangerSoft ?? T.bgSunk, border: `1px solid ${T.line}`, fontSize: 12, color: T.danger ?? T.ink }}>{error}</div>
        )}

        <div style={{ padding: '24px', display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ background: T.bgRaised, border: `1px solid ${T.line}`, borderRadius: 12, padding: 24, display: 'flex', gap: 18, alignItems: 'center' }}>
              <Avatar name={patient.full_name} size={72} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: T.serif, fontSize: 28, color: T.ink, lineHeight: 1 }}>{patient.full_name}</div>
                <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12, color: T.inkMuted, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: T.mono }}>{patient.rut || '—'}</span>
                  <span>·</span>
                  <span style={{ fontFamily: T.mono }}>{patient.phone || '—'}</span>
                  <span>·</span>
                  <span>Paciente desde {fmtLongDate(patient.since)}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <Stat v={apptCount} k="Sesiones" />
                <Stat v={CLP(patient.session_value ?? 0)} k="Valor" />
              </div>
            </div>

            <Card title="Datos clínicos" icon="file">
              <Grid2>
                <FormField label="Nombre completo"   value={patient.full_name ?? ''}  onChange={(v) => update({ full_name: v })} />
                <FormField label="RUT"               value={patient.rut ?? ''}        onChange={(v) => update({ rut: v })} mono />
                <FormField label="Teléfono"          value={patient.phone ?? ''}      onChange={(v) => update({ phone: v })} mono />
                <FormField label="Email"             value={patient.email ?? ''}      onChange={(v) => update({ email: v })} type="email" />
                <FormField label="Previsión"         value={patient.insurance ?? ''}  onChange={(v) => update({ insurance: v })} />
                <FormField label="Diagnóstico"       value={patient.diagnosis ?? ''}  onChange={(v) => update({ diagnosis: v })} />
                <FormField label="Medicación"        value={patient.medication ?? ''} onChange={(v) => update({ medication: v })} />
                <FormField label="Valor sesión (CLP)" value={patient.session_value ?? ''} onChange={(v) => update({ session_value: v === '' ? null : Number(v) })} type="number" mono />
              </Grid2>
            </Card>

            <Card title="Historial de sesiones" icon="clock">
              {sortedSessions.length === 0 && (
                <div style={{ padding: 14, color: T.inkMuted, fontStyle: 'italic', fontSize: 12.5 }}>Sin sesiones registradas. Usa "Nueva sesión" para agregar la primera.</div>
              )}
              {sortedSessions.map((s, i) => (
                <SessionRow key={i} s={s} i={i} onSave={(notes) => updateSessionNotes(s, notes)} />
              ))}
            </Card>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <Card title="Próxima cita" icon="calendar">
              {next ? (() => { const f = fmtNextCard(next.datetime); return (
                <>
                  <div style={{ textAlign: 'center', padding: '12px 0' }}>
                    <div style={{ fontSize: 10.5, color: T.inkMuted, letterSpacing: 0.5, textTransform: 'uppercase' }}>{f.dow}</div>
                    <div style={{ fontFamily: T.serif, fontSize: 42, color: T.primary, lineHeight: 1, marginTop: 4 }}>{f.day}</div>
                    <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 4 }}>{f.rest}</div>
                    <div style={{ fontSize: 11, color: T.inkMuted, marginTop: 2 }}>{next.duration ?? 50} min · {next.status}</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 10 }}>
                    <button style={{ ...btn('soft'), fontSize: 11.5 }} onClick={() => onNavigate?.('calendar')}>Ver agenda</button>
                  </div>
                </>
              )})() : (
                <div style={{ padding: '14px 0', textAlign: 'center', color: T.inkMuted, fontSize: 12.5 }}>
                  Sin próxima cita.
                  <div style={{ marginTop: 10 }}>
                    <button style={btn('soft')} onClick={() => onNavigate?.('calendar')}>Agendar</button>
                  </div>
                </div>
              )}
            </Card>

            <Card title="Estado de pagos" icon="dollar">
              <div style={{ textAlign: 'center', padding: '8px 0' }}>
                <div style={{ fontFamily: T.serif, fontSize: 32, color: (patient.balance ?? 0) > 0 ? T.danger : T.confirmado, lineHeight: 1 }}>{CLP(patient.balance ?? 0)}</div>
                <div style={{ fontSize: 11, color: T.inkMuted, marginTop: 4 }}>Saldo pendiente</div>
              </div>
              <div style={{ borderTop: `1px solid ${T.lineSoft}`, marginTop: 10, paddingTop: 10, fontSize: 12, color: T.inkSoft, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Row k="Sesiones totales" v={apptCount} mono />
                <Row k="Valor sesión" v={CLP(patient.session_value ?? 0)} mono />
              </div>
              <div style={{ marginTop: 12 }}>
                <button style={btn('soft')} onClick={() => onNavigate?.('billing/' + patient.lead_id)}>Cobrar</button>
              </div>
            </Card>

            {patient.tags?.length > 0 && (
              <Card title="Etiquetas" icon="filter">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {patient.tags.map(t => (
                    <span key={t} style={{ padding: '3px 9px', borderRadius: 999, background: T.bgSunk, fontSize: 11, color: T.inkSoft, border: `1px solid ${T.lineSoft}` }}>{t}</span>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>

      {showSession && (
        <SessionModal onClose={() => setShowSession(false)} onSave={addSession} />
      )}
    </div>
  )
}

function SessionModal({ onClose, onSave }) {
  const [date, setDate]         = useState(todayISO())
  const [type, setType]         = useState('presencial')
  const [duration, setDuration] = useState(50)
  const [notes, setNotes]       = useState('')
  const [err, setErr]           = useState(null)

  function submit() {
    if (!notes.trim()) { setErr('Agrega notas de la sesión'); return }
    onSave({ date, type, duration_minutes: Number(duration), notes: notes.trim() })
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(20,18,14,0.35)',
      display: 'grid', placeItems: 'center', zIndex: 50,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 520, background: T.bgRaised, borderRadius: 14,
        boxShadow: '0 24px 60px rgba(20,18,14,0.25)', overflow: 'hidden',
      }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${T.lineSoft}` }}>
          <div style={{ fontFamily: T.serif, fontSize: 22, color: T.ink }}>Nueva sesión</div>
          <div style={{ fontSize: 12, color: T.inkMuted, marginTop: 4 }}>Registra una sesión clínica en la ficha del paciente.</div>
        </div>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <FormField label="Fecha"    value={date}     onChange={setDate} type="date" />
            <FormField label="Tipo"     value={type}     onChange={setType} as="select" options={[['presencial','Presencial'],['online','Online']]} />
            <FormField label="Duración" value={duration} onChange={setDuration} type="number" />
          </div>
          <FormField label="Notas" value={notes} onChange={setNotes} as="textarea" rows={6} />
          {err && <div style={{ fontSize: 12, color: T.danger ?? '#c33' }}>{err}</div>}
        </div>
        <div style={{ padding: '14px 24px', borderTop: `1px solid ${T.lineSoft}`, background: T.bg, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button style={btn('ghost')} onClick={onClose}>Cancelar</button>
          <button style={btn('primary')} onClick={submit}>Guardar sesión</button>
        </div>
      </div>
    </div>
  )
}

function Card({ title, icon, right, children }) {
  return (
    <div style={{ background: T.bgRaised, border: `1px solid ${T.line}`, borderRadius: 12, padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500, color: T.ink }}>
          {icon && <Icon name={icon} size={13} stroke={T.primary} />}
          {title}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

function Grid2({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 24px' }}>{children}</div>
}

function FormField({ label, value, onChange, mono, type = 'text', as, options, rows }) {
  const baseStyle = {
    width: '100%', padding: '8px 10px', borderRadius: 7,
    border: `1px solid ${T.line}`, background: T.bg, outline: 'none',
    fontSize: 13, color: T.ink, fontFamily: mono ? T.mono : T.sans,
    boxSizing: 'border-box',
  }
  return (
    <div>
      <div style={{ fontSize: 10.5, color: T.inkMuted, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 5 }}>{label}</div>
      {as === 'select' ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} style={baseStyle}>
          {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      ) : as === 'textarea' ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows ?? 4} style={{ ...baseStyle, resize: 'vertical' }} />
      ) : (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} style={baseStyle} />
      )}
    </div>
  )
}

function Row({ k, v, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: T.inkMuted }}>{k}</span>
      <span style={{ fontFamily: mono ? T.mono : T.sans, color: T.ink }}>{v}</span>
    </div>
  )
}

function SessionRow({ s, i, onSave }) {
  const [hover, setHover] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(s.notes ?? '')
  const [saving, setSaving] = useState(false)
  useEffect(() => { setDraft(s.notes ?? '') }, [s.notes])

  async function commit() {
    setSaving(true)
    await onSave(draft)
    setSaving(false)
    setEditing(false)
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ padding: '14px 0', borderTop: i ? `1px solid ${T.lineSoft}` : 'none' }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
        <div style={{ fontFamily: T.serif, fontSize: 20, color: T.primary, width: 40, textAlign: 'right' }}>{i + 1}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: T.ink, fontWeight: 500 }}>{fmtLongDate(s.date)}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, color: T.inkMuted, fontFamily: T.mono }}>
                {(s.type ?? 'sesión')} · {s.duration_minutes ?? 50}m
              </span>
              {!editing && (
                <button
                  onClick={() => setEditing(true)}
                  title="Editar notas"
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    padding: 4, borderRadius: 4, opacity: hover ? 1 : 0,
                    transition: 'opacity 120ms', color: T.inkMuted,
                  }}
                ><Icon name="edit" size={13} stroke={T.inkMuted} /></button>
              )}
            </div>
          </div>
          {editing ? (
            <div style={{ marginTop: 6 }}>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={5}
                style={{
                  width: '100%', padding: '8px 10px', borderRadius: 8,
                  border: `1px solid ${T.primary}`, outline: 'none',
                  fontSize: 12.5, lineHeight: 1.55, color: T.ink,
                  fontFamily: T.sans, resize: 'vertical', background: T.bg,
                }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                <button
                  style={btn('ghost')}
                  onClick={() => { setDraft(s.notes ?? ''); setEditing(false) }}
                  disabled={saving}
                >Cancelar</button>
                <button style={btn('primary')} onClick={commit} disabled={saving}>
                  {saving ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </div>
          ) : (
            <ExpandableNotes text={s.notes} lines={2} />
          )}
        </div>
      </div>
    </div>
  )
}

function ExpandableNotes({ text, lines = 2 }) {
  const ref = useRef(null)
  const [overflow, setOverflow] = useState(false)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (!ref.current) return
    setOverflow(ref.current.scrollHeight > ref.current.clientHeight + 1)
  }, [text])
  if (!text) return null
  return (
    <div>
      <div ref={ref} style={{
        fontSize: 12.5, color: T.inkSoft, marginTop: 6, lineHeight: 1.55, whiteSpace: 'pre-wrap',
        ...(expanded ? {} : { display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
      }}>{text}</div>
      {(overflow || expanded) && (
        <div onClick={(e) => { e.stopPropagation(); setExpanded(x => !x) }} style={{
          marginTop: 4, fontSize: 11, color: T.primary, cursor: 'pointer', fontWeight: 500,
        }}>{expanded ? 'ver menos' : 'ver más'}</div>
      )}
    </div>
  )
}

function Stat({ v, k }) {
  return (
    <div style={{ textAlign: 'center', padding: '0 14px', borderLeft: `1px solid ${T.lineSoft}` }}>
      <div style={{ fontFamily: T.serif, fontSize: 24, color: T.primary, lineHeight: 1 }}>{v}</div>
      <div style={{ fontSize: 10.5, color: T.inkMuted, marginTop: 4, letterSpacing: 0.4, textTransform: 'uppercase' }}>{k}</div>
    </div>
  )
}
