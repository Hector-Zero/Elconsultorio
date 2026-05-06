import React, { useState, useEffect, useContext, useMemo } from 'react'
import { T, Icon, Sidebar, Avatar, TopBar, btn } from './shared.jsx'
import { ClientCtx } from '../lib/ClientCtx.js'
import { supabase } from '../lib/supabase.js'
import { fmtShortDate, todayISO } from './patients/_shared.jsx'
import PatientQuickPanel from './patients/quickPanel.jsx'

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
          <div style={{ display: 'flex', flexDirection: 'column', borderRight: `1px solid ${T.line}`, minWidth: 0, overflow: 'hidden' }}>
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
                      onClick={(e) => { e.stopPropagation(); onNavigate?.('files/' + p.id) }}
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
