import React, { useState, useEffect, useRef } from 'react'
import { T, Icon, Avatar, btn, SectionLabel, avatarTint, avatarInk } from '../shared.jsx'
import { supabase } from '../../lib/supabase.js'
import { fmtShortDate, fmtLongDate } from './_shared.jsx'

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

export default function PatientQuickPanel({ p, onNavigate, updatePatient }) {
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
          <button style={btn('soft')} onClick={() => onNavigate?.('files/' + p.id)}><Icon name="file" size={13} stroke={T.primary} /> Ver ficha</button>
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
