import React, { useState, useEffect, useContext, useMemo, useRef } from 'react'
import { T, Icon, Sidebar, Avatar, TopBar, btn, SectionLabel, avatarTint, avatarInk } from './shared.jsx'
import { ClientCtx } from '../lib/ClientCtx.js'
import { supabase } from '../lib/supabase.js'

const TZ = 'America/Santiago'
const MONTHS = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
const fmtShortDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: TZ }))
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`
}
const fmtLongDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: TZ }))
  return `${String(d.getDate()).padStart(2,'0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
const todayISO = () => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }))
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

export default function PatientsScreen({ onNavigate, param }) {
  const { clientId, professional } = useContext(ClientCtx)
  const isPro = !!professional
  const [selectedId, setSelectedId] = useState(null)
  const [query, setQuery]           = useState('')
  const [leads, setLeads]           = useState([])
  const [patients, setPatients]     = useState([])
  const [appts, setAppts]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)

  // Initial load + auto-create missing patient rows + assignments
  useEffect(() => {
    if (!clientId) return
    let alive = true
    setLoading(true)

    Promise.all([
      supabase.from('leads')
        .select('id, chat_id, name, phone, qualified_lead, last_updated, created_at')
        .eq('client_id', clientId)
        .eq('qualified_lead', true)
        .order('last_updated', { ascending: false }),
      supabase.from('patients')
        .select('*')
        .eq('client_id', clientId),
      (() => {
        let q = supabase.from('appointments')
          .select('id, lead_id, professional_id, datetime, duration, status, notes')
          .eq('client_id', clientId)
          .order('datetime', { ascending: true })
        if (isPro) q = q.eq('professional_id', professional.id)
        return q
      })(),
    ]).then(async ([lr, pr, ar]) => {
      if (!alive) return
      const errMsg = lr.error?.message ?? pr.error?.message ?? ar.error?.message
      if (errMsg) { setError(errMsg); setLoading(false); return }

      const ls   = lr.data ?? []
      let   pts  = pr.data ?? []
      const ap   = ar.data ?? []

      // In professional mode, restrict patients to those with at least one appt
      // assigned to this pro (RLS will also enforce this, but the filter avoids
      // showing rows that would be empty after RLS)
      if (isPro) {
        const proLeadIds = new Set(ap.map(a => a.lead_id))
        pts = pts.filter(p => proLeadIds.has(p.lead_id))
      }

      const have = new Set(pts.map(p => p.lead_id))
      const apptByLead = ap.reduce((m,a) => ((m[a.lead_id] ??= []).push(a), m), {})

      // Auto-create patient rows for qualified leads with ≥1 appointment but no patient row.
      // Also assign the patient's first treating professional from their first appointment.
      const toCreate = ls
        .filter(l => !have.has(l.id) && (apptByLead[l.id]?.length ?? 0) >= 1)
        .map(l => {
          const firstAppt = apptByLead[l.id][0]
          return {
            client_id:       clientId,
            lead_id:         l.id,
            professional_id: firstAppt?.professional_id ?? null,
            full_name:       l.name ?? 'Sin nombre',
            phone:           l.phone ?? '',
            since:           todayISO(),
            status:          'active',
            total_sessions:  0,
            balance:         0,
          }
        })

      if (toCreate.length) {
        const { data: created, error: insErr } = await supabase
          .from('patients').insert(toCreate).select('*')
        if (insErr) {
          setError(insErr.message)
        } else if (created) {
          // For each new patient, create an active assignment
          const assignmentsToCreate = created
            .filter(p => p.professional_id)
            .map(p => ({
              patient_id:      p.id,
              professional_id: p.professional_id,
              client_id:       p.client_id,
              status:          'active',
              admin_can_view_notes: true,
            }))
          if (assignmentsToCreate.length) {
            const { error: aErr } = await supabase
              .from('patient_assignments')
              .insert(assignmentsToCreate)
            if (aErr) setError(aErr.message)
          }
          pts = pts.concat(created)
        }
      }

      setLeads(ls)
      setPatients(pts)
      setAppts(ap)
      // Honor a deep-link from another screen (e.g. agenda → "Ver ficha del
      // paciente" → #patients/<id>). Falls back to the previous selection,
      // then to the first patient.
      const wanted = param && pts.some(p => p.id === param) ? param : null
      setSelectedId(prev => wanted ?? prev ?? pts[0]?.id ?? null)
      setLoading(false)
    })

    return () => { alive = false }
  }, [clientId, isPro, professional?.id])

  // If `param` changes after the initial load (e.g. user clicks Ver ficha
  // for a different patient while already on this screen), re-select.
  useEffect(() => {
    if (!param) return
    if (patients.some(p => p.id === param)) setSelectedId(param)
  }, [param, patients])

  const apptsByLead = useMemo(() => {
    const m = {}
    appts.forEach(a => { (m[a.lead_id] ??= []).push(a) })
    return m
  }, [appts])
  const leadById = useMemo(() => Object.fromEntries(leads.map(l => [l.id, l])), [leads])

  const enriched = useMemo(() => patients.map(p => {
    const list  = apptsByLead[p.lead_id] ?? []
    const past  = list.filter(a => new Date(a.datetime) <= new Date())
    const next  = list.find(a => new Date(a.datetime) > new Date())
    const since = p.since ?? list[0]?.datetime ?? null
    const lead  = leadById[p.lead_id]
    return { ...p, _lead: lead, _appts: list, _past: past, _next: next, _since: since }
  }), [patients, apptsByLead, leadById])

  const q = query.trim().toLowerCase()
  const filtered = !q ? enriched : enriched.filter(p =>
    (p.full_name ?? '').toLowerCase().includes(q) || (p.phone ?? '').toLowerCase().includes(q)
  )

  const patient = enriched.find(p => p.id === selectedId)

  async function updatePatient(patch) {
    if (!patient) return
    const { error: e } = await supabase.from('patients').update(patch).eq('id', patient.id)
    if (e) { setError(e.message); return }
    setPatients(prev => prev.map(p => p.id === patient.id ? { ...p, ...patch } : p))
    if (patient._lead && (patch.full_name !== undefined || patch.phone !== undefined)) {
      const leadPatch = {}
      if (patch.full_name !== undefined) leadPatch.name  = patch.full_name
      if (patch.phone     !== undefined) leadPatch.phone = patch.phone
      const { error: le } = await supabase.from('leads').update(leadPatch).eq('id', patient._lead.id)
      if (le) setError(le.message)
      else setLeads(prev => prev.map(l => l.id === patient._lead.id ? { ...l, ...leadPatch } : l))
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', background: T.bg, fontFamily: T.sans, color: T.ink }}>
      <Sidebar active="patients" onNavigate={onNavigate} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopBar
          title="Pacientes"
          subtitle={loading ? 'Cargando…' : `${enriched.length} pacientes activos`}
          right={
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={btn('ghost')}><Icon name="download" size={13} /> Exportar</button>
              <button style={btn('primary')}><Icon name="plus" size={14} stroke="#fff" /> Nuevo paciente</button>
            </div>
          }
        />

        {error && (
          <div style={{ margin: '14px 24px 0', padding: '12px 14px', borderRadius: 10, background: T.dangerSoft ?? T.bgSunk, border: `1px solid ${T.line}`, fontSize: 12, color: T.danger ?? T.ink }}>{error}</div>
        )}

        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 420px', minHeight: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', borderRight: `1px solid ${T.line}`, minWidth: 0 }}>
            <div style={{ padding: '12px 24px', borderBottom: `1px solid ${T.line}`, display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', borderRadius: 8,
                background: T.bgSunk, border: `1px solid ${T.lineSoft}`, flex: 1, maxWidth: 300,
              }}>
                <Icon name="search" size={13} stroke={T.inkMuted} />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar por nombre o teléfono…" style={{
                  border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 12.5, flex: 1, color: T.ink, fontFamily: T.sans,
                }} />
              </div>
              <div style={{ flex: 1 }} />
              <button style={btn('ghost')}><Icon name="filter" size={13} /> Filtrar</button>
            </div>

            <div style={{
              padding: '10px 24px', display: 'grid',
              gridTemplateColumns: '1.6fr 110px 100px 110px 80px',
              gap: 12, alignItems: 'center',
              fontSize: 10.5, color: T.inkMuted, letterSpacing: 0.5, textTransform: 'uppercase',
              borderBottom: `1px solid ${T.lineSoft}`,
            }}>
              <div>Paciente</div><div>Sesiones</div><div>Última</div><div>Próxima</div><div />
            </div>

            <div style={{ flex: 1, overflow: 'auto' }}>
              {!loading && filtered.length === 0 && (
                <div style={{ padding: 32, textAlign: 'center', color: T.inkMuted, fontFamily: T.serif, fontStyle: 'italic' }}>
                  Sin pacientes calificados todavía.
                </div>
              )}
              {filtered.map(p => {
                const sel = p.id === selectedId
                return (
                  <div key={p.id} onClick={() => setSelectedId(p.id)} style={{
                    padding: '13px 24px', display: 'grid',
                    gridTemplateColumns: '1.6fr 110px 100px 110px 80px',
                    gap: 12, alignItems: 'center',
                    borderBottom: `1px solid ${T.lineSoft}`,
                    cursor: 'pointer', fontSize: 13,
                    background: sel ? T.bgRaised : 'transparent',
                    boxShadow: sel ? `inset 3px 0 0 ${T.primary}` : 'none',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Avatar name={p.full_name ?? '—'} size={34} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 500, color: T.ink }}>{p.full_name ?? 'Sin nombre'}</div>
                        <div style={{ fontSize: 11.5, color: T.inkMuted, fontFamily: T.mono, marginTop: 1 }}>{p.phone || '—'}</div>
                      </div>
                    </div>
                    <div style={{ fontFamily: T.mono, color: T.inkSoft }}>{p.total_sessions ?? p._past.length}</div>
                    <div style={{ fontFamily: T.mono, fontSize: 12, color: T.inkSoft }}>
                      {p._past[p._past.length - 1] ? fmtShortDate(p._past[p._past.length - 1].datetime) : <span style={{ color: T.inkFaint }}>—</span>}
                    </div>
                    <div style={{ fontFamily: T.mono, fontSize: 12, color: T.inkSoft }}>
                      {p._next ? fmtShortDate(p._next.datetime) : <span style={{ color: T.inkFaint }}>—</span>}
                    </div>
                    <div
                      style={{ textAlign: 'right', color: T.inkMuted, cursor: 'pointer' }}
                      onClick={(e) => { e.stopPropagation(); onNavigate?.('files/' + p.lead_id) }}
                    ><Icon name="chevronR" size={14} /></div>
                  </div>
                )
              })}
            </div>
          </div>

          {patient && <PatientQuickPanel p={patient} onNavigate={onNavigate} updatePatient={updatePatient} />}
        </div>
      </div>
    </div>
  )
}

function InlineField({ label, value, mono, placeholder, onSave }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value ?? '')
  useEffect(() => { setV(value ?? '') }, [value])
  return (
    <div>
      <div style={{ fontSize: 10.5, color: T.inkMuted, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      {editing ? (
        <input
          autoFocus value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => { setEditing(false); if (v !== (value ?? '')) onSave(v) }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setV(value ?? ''); setEditing(false) } }}
          style={{
            width: '100%', padding: '4px 6px', borderRadius: 5,
            border: `1px solid ${T.primary}`, outline: 'none',
            fontSize: 13, color: T.ink, fontFamily: mono ? T.mono : T.sans,
            background: T.bg,
          }}
        />
      ) : (
        <div onClick={() => setEditing(true)} style={{
          fontSize: 13, color: value ? T.ink : T.inkFaint, fontFamily: mono ? T.mono : T.sans,
          cursor: 'text', padding: '4px 6px', borderRadius: 5,
          border: `1px solid transparent`,
        }}
          onMouseEnter={(e) => e.currentTarget.style.background = T.bgSunk}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          {value || placeholder || '—'}
        </div>
      )}
    </div>
  )
}

function Spinner({ size = 12 }) {
  return (
    <>
      <style>{`@keyframes elc-spin { to { transform: rotate(360deg) } }`}</style>
      <span style={{
        display: 'inline-block', width: size, height: size,
        border: '1.5px solid currentColor', borderTopColor: 'transparent',
        borderRadius: '50%', opacity: 0.55,
        animation: 'elc-spin 0.7s linear infinite',
      }} />
    </>
  )
}

function Collapsible({ icon, label, defaultOpen = true, headerAction, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ marginBottom: 4 }}>
      <div onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
        <SectionLabel icon={icon} label={label} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {headerAction && <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex' }}>{headerAction}</span>}
          <Icon name={open ? 'chevronD' : 'chevronR'} size={12} stroke={T.inkMuted} />
        </div>
      </div>
      {open && <div style={{ marginTop: 6 }}>{children}</div>}
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
        fontSize: 12, color: T.inkSoft, marginTop: 4, lineHeight: 1.5,
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

const sessionsHash = (notes) => {
  if (!notes.length) return ''
  const last = notes[notes.length - 1]
  return `${notes.length}:${last?.session_date ?? ''}`
}

async function generateSummary(notes) {
  const text = notes.map(s => s.notes).filter(Boolean).join('\n\n')
  const prompt = `Eres un asistente clínico. Resume en un párrafo breve y coherente el progreso terapéutico del paciente basándote en estas notas de sesión. No menciones números de sesión ni fechas. Escribe en tercera persona, tono clínico y conciso. Máximo 100 palabras: ${text}`

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const r = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    }
  )
  if (!r.ok) throw new Error(`API ${r.status}`)
  const j = await r.json()
  return j.content?.[0]?.text?.trim() ?? ''
}

function PatientQuickPanel({ p, onNavigate, updatePatient }) {
  // Active assignment for this patient
  const [assignment, setAssignment] = useState(null)
  // Clinical notes (sessions) belonging to that assignment
  const [sessions, setSessions]     = useState([])
  const [loadingClin, setLoadingClin] = useState(true)
  const [clinError, setClinError]   = useState(null)

  // Load active assignment + clinical notes when selected patient changes
  useEffect(() => {
    let alive = true
    setLoadingClin(true)
    setClinError(null)
    setAssignment(null)
    setSessions([])

    ;(async () => {
      // 1. Find active assignment for this patient
      const { data: aData, error: aErr } = await supabase
        .from('patient_assignments')
        .select('*')
        .eq('patient_id', p.id)
        .eq('status', 'active')
        .maybeSingle()

      if (!alive) return
      if (aErr) { setClinError(aErr.message); setLoadingClin(false); return }
      if (!aData) {
        // No active assignment — RLS may have blocked, or none exists
        setLoadingClin(false)
        return
      }
      setAssignment(aData)

      // 2. Load clinical notes for that assignment
      const { data: nData, error: nErr } = await supabase
        .from('clinical_notes')
        .select('*')
        .eq('assignment_id', aData.id)
        .order('session_date', { ascending: true })

      if (!alive) return
      if (nErr) { setClinError(nErr.message); setLoadingClin(false); return }
      setSessions(nData ?? [])
      setLoadingClin(false)
    })()

    return () => { alive = false }
  }, [p.id])

  const recent   = [...sessions].slice(-3).reverse()
  const upcoming = (p._appts ?? []).filter(a => new Date(a.datetime) > new Date())

  const earliestSession = sessions
    .map(s => s?.session_date)
    .filter(Boolean)
    .sort()[0]
  const sinceDate = earliestSession ?? p.since ?? p.created_at ?? null

  const hash = sessionsHash(sessions)
  const stored = (assignment?.ai_summary ?? '').trim()
  const storedHash = assignment?.ai_summary_hash ?? ''
  const cacheValid = stored && storedHash === hash

  const [summary, setSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [summaryError, setSummaryError] = useState(null)

  useEffect(() => {
    setSummaryError(null)
    if (!assignment || sessions.length === 0) { setSummary(null); return }
    if (cacheValid) { setSummary(stored); return }

    let alive = true
    setSummaryLoading(true)
    generateSummary(sessions)
      .then(async text => {
        if (!alive) return
        setSummary(text)
        // Save to patient_assignments
        const { error: upErr } = await supabase
          .from('patient_assignments')
          .update({ ai_summary: text, ai_summary_hash: hash, updated_at: new Date().toISOString() })
          .eq('id', assignment.id)
        if (upErr && alive) setSummaryError(upErr.message)
      })
      .catch(e => { if (alive) setSummaryError(e.message) })
      .finally(() => { if (alive) setSummaryLoading(false) })
    return () => { alive = false }
  }, [p.id, assignment?.id, hash])

  return (
    <div style={{ background: T.bgRaised, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      <div style={{ padding: '24px', borderBottom: `1px solid ${T.lineSoft}` }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <Avatar name={p.full_name ?? '—'} size={56} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <InlineField label="Nombre" value={p.full_name} onSave={(v) => updatePatient({ full_name: v })} />
            <div style={{ height: 6 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <InlineField label="Teléfono" value={p.phone}  mono onSave={(v) => updatePatient({ phone: v })} />
              <InlineField label="RUT"      value={p.rut}    mono onSave={(v) => updatePatient({ rut: v })} />
            </div>
            <div style={{ height: 6 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <InlineField label="Email"     value={p.email}     onSave={(v) => updatePatient({ email: v })} />
              <InlineField label="Previsión" value={p.insurance} onSave={(v) => updatePatient({ insurance: v })} />
            </div>
            <div style={{ fontSize: 11.5, color: T.inkMuted, marginTop: 10 }}>Paciente desde {fmtLongDate(sinceDate)}</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 16 }}>
          <button style={btn('soft')} onClick={() => onNavigate?.('files/' + p.lead_id)}><Icon name="file" size={13} stroke={T.primary} /> Ver ficha</button>
          <button style={btn('soft')} onClick={() => onNavigate?.('calendar')}><Icon name="calendar" size={13} stroke={T.primary} /> Agendar</button>
          <button style={btn('soft')} onClick={() => onNavigate?.('billing/' + p.lead_id)}><Icon name="card" size={13} stroke={T.primary} /> Cobrar</button>
        </div>
      </div>

      <div style={{ padding: '18px 24px' }}>
        {clinError && (
          <div style={{ fontSize: 11.5, color: T.danger ?? T.ink, marginBottom: 8 }}>
            {clinError}
          </div>
        )}

        <Collapsible icon="file" label="Resumen" defaultOpen>
          <div style={{
            background: avatarTint(p.full_name ?? '—'),
            color: avatarInk(p.full_name ?? '—'),
            borderRadius: 12, padding: '12px 14px',
            fontSize: 12, lineHeight: 1.5,
            fontStyle: summary && !summaryLoading ? 'normal' : 'italic',
            display: 'flex', alignItems: 'center', gap: 8, minHeight: 20,
          }}>
            {loadingClin
              ? <><Spinner /> Cargando…</>
              : !assignment
                ? 'Sin profesional asignado para este paciente.'
                : sessions.length === 0
                  ? 'Sin sesiones registradas aún.'
                  : summaryLoading
                    ? <><Spinner /> Generando resumen…</>
                    : summaryError
                      ? `Error: ${summaryError}`
                      : (summary || stored || '—')}
          </div>
        </Collapsible>

        <Collapsible icon="calendar" label="Próximas sesiones" defaultOpen={false}>
          {upcoming.length === 0 && (
            <div style={{ fontSize: 12, color: T.inkMuted, fontStyle: 'italic', padding: '6px 0' }}>Sin sesiones programadas.</div>
          )}
          {upcoming.map((a) => (
            <div key={a.id} style={{ padding: '10px 12px', borderRadius: 10, marginBottom: 6, background: T.primarySoft, border: `1px solid ${T.line}` }}>
              <div style={{ fontSize: 12.5, color: T.primary, fontWeight: 500 }}>{fmtLongDate(a.datetime)}</div>
              <div style={{ fontSize: 11.5, color: T.inkMuted, marginTop: 3 }}>{a.duration ?? 50} min · {a.status}</div>
            </div>
          ))}
        </Collapsible>

        <Collapsible icon="clock" label="Últimas sesiones (ficha)" defaultOpen={false}>
          {recent.length === 0 && (
            <div style={{ fontSize: 12, color: T.inkMuted, fontStyle: 'italic', padding: '6px 0' }}>Sin sesiones registradas.</div>
          )}
          {recent.map((s) => (
            <div key={s.id} style={{ padding: '12px 14px', borderRadius: 10, marginBottom: 8, background: T.bgSunk, border: `1px solid ${T.lineSoft}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>Sesión</div>
                <div style={{ fontFamily: T.mono, fontSize: 11, color: T.inkMuted }}>{fmtShortDate(s.session_date)}</div>
              </div>
              <ExpandableNotes text={s.notes} lines={2} />
            </div>
          ))}
        </Collapsible>
      </div>
    </div>
  )
}