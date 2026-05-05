import React, { useState, useEffect, useContext } from 'react'
import { T, Icon, Sidebar, TopBar, btn, ConfirmModal, MAX_PROS } from './shared.jsx'
import { ClientCtx } from '../lib/ClientCtx.js'
import { supabase } from '../lib/supabase.js'
import ProCard             from './professionals/proCard.jsx'
import ProfessionalEditor  from './professionals/professionalEditor.jsx'

// ───── Screen ─────
export default function ProfessionalsScreen({ onNavigate }) {
  const { clientId } = useContext(ClientCtx)
  const [pros, setPros]               = useState([])
  const [scheduleDays, setScheduleDays] = useState({}) // { proId: Set<day_of_week> }
  const [loading, setLoading]         = useState(true)
  const [editing, setEditing]         = useState(null) // null | 'new' | pro
  const [confirmDel, setConfirmDel]   = useState(null)
  const [toast, setToast]             = useState(null)

  async function fetchPros() {
    setLoading(true)
    // active=false rows are kept around for things like vacation / leave or
    // pros that have been manually deactivated; they shouldn't clutter the
    // working list. Real deletions are hard DELETEs guarded by a pre-check
    // (see startDelete + performDelete below).
    const { data, error } = await supabase
      .from('professionals')
      .select('id, full_name, email, color, photo_url, avatar_url, active, public_profile')
      .eq('client_id', clientId)
      .eq('active', true)
      .order('created_at', { ascending: true })
    if (error) {
      setToast({ kind: 'err', msg: 'Error al cargar profesionales' })
      setLoading(false)
      return
    }
    setPros(data ?? [])

    const ids = (data ?? []).map(p => p.id)
    if (ids.length) {
      const { data: scheds } = await supabase
        .from('professional_schedules')
        .select('professional_id, day_of_week')
        .in('professional_id', ids)
        .eq('active', true)
      const map = {}
      for (const s of scheds ?? []) {
        if (!map[s.professional_id]) map[s.professional_id] = new Set()
        map[s.professional_id].add(s.day_of_week)
      }
      setScheduleDays(map)
    } else {
      setScheduleDays({})
    }
    setLoading(false)
  }

  useEffect(() => {
    if (!clientId) return
    fetchPros()
  }, [clientId])

  function flashToast(t, ms = 2500) {
    setToast(t)
    setTimeout(() => setToast(null), ms)
  }

  // Click X → run pre-check first. If the pro has any appointments or active
  // patient assignments, surface a blocker modal explaining what to do. The
  // appointments FK already enforces this at the DB level — we just want a
  // friendly message instead of a Postgres error.
  async function startDelete(p) {
    const [a, pa] = await Promise.all([
      supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('professional_id', p.id),
      supabase
        .from('patient_assignments')
        .select('id', { count: 'exact', head: true })
        .eq('professional_id', p.id)
        .eq('status', 'active'),
    ])
    if (a.error || pa.error) {
      flashToast({ kind: 'err', msg: `Error al verificar dependencias: ${(a.error ?? pa.error).message}` }, 3500)
      return
    }
    const apptCount = a.count ?? 0
    const patCount  = pa.count ?? 0
    if (apptCount > 0 || patCount > 0) {
      setConfirmDel({ pro: p, blocker: { appointments: apptCount, patients: patCount } })
    } else {
      setConfirmDel({ pro: p })
    }
  }

  async function performDelete(p) {
    setConfirmDel(null)
    // 1. Storage cleanup. We list the pro's folder in each bucket and remove
    //    every file, BEFORE the DB delete — so a storage failure aborts the
    //    delete cleanly instead of leaving orphaned blobs. Storage remove is
    //    idempotent so a second click after a partial failure works.
    for (const bucket of ['professional-photos', 'professional-documents']) {
      const { data: files, error: listErr } = await supabase.storage.from(bucket).list(p.id, { limit: 1000 })
      if (listErr) {
        flashToast({ kind: 'err', msg: `Error listando archivos (${bucket}): ${listErr.message}` }, 3500)
        return
      }
      if (files?.length) {
        const paths = files.map(f => `${p.id}/${f.name}`)
        const { error: rmErr } = await supabase.storage.from(bucket).remove(paths)
        if (rmErr) {
          flashToast({ kind: 'err', msg: `Error borrando archivos (${bucket}): ${rmErr.message}` }, 3500)
          return
        }
      }
    }
    // 2. DB delete. professional_schedules / professional_session_types /
    //    professional_documents cascade. patient_assignments.professional_id
    //    is set to NULL by the FK rule (notes preserved).
    const { error } = await supabase.from('professionals').delete().eq('id', p.id)
    if (error) {
      flashToast({ kind: 'err', msg: `Error al eliminar: ${error.message}` }, 3500)
      return
    }
    setPros(list => list.filter(x => x.id !== p.id))
    flashToast({ kind: 'ok', msg: '✓ Profesional eliminado' })
  }

  const limitReached = pros.length >= MAX_PROS

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', background: T.bg, fontFamily: T.sans, color: T.ink }}>
      <Sidebar active="professionals" onNavigate={onNavigate} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopBar
          title="Profesionales"
          subtitle={loading ? 'Cargando…' : `${pros.length} profesional${pros.length === 1 ? '' : 'es'} en el equipo`}
          right={
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{
                fontSize: 11, color: T.inkMuted, fontFamily: T.mono,
                padding: '4px 10px', borderRadius: 999, background: T.bgSunk, border: `1px solid ${T.lineSoft}`,
              }}>{pros.length}/{MAX_PROS}</span>
              <button
                style={{ ...btn('primary'), opacity: limitReached ? 0.5 : 1, cursor: limitReached ? 'not-allowed' : 'pointer' }}
                onClick={() => !limitReached && setEditing('new')}
                disabled={limitReached}
                title={limitReached ? 'Límite alcanzado' : 'Agregar profesional'}
              >
                <Icon name="plus" size={13} stroke={T.primaryText} />
                Agregar profesional
              </button>
            </div>
          }
        />

        <div style={{ flex: 1, overflow: 'auto', padding: '24px 24px 40px' }}>
          {loading ? (
            <div style={{ padding: 40, color: T.inkMuted, fontStyle: 'italic', fontFamily: T.serif, textAlign: 'center' }}>
              Cargando…
            </div>
          ) : pros.length === 0 ? (
            <div style={{
              padding: 60, textAlign: 'center',
              background: T.bgRaised, border: `1px solid ${T.line}`, borderRadius: 14, maxWidth: 520, margin: '40px auto',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
            }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: T.primarySoft, color: T.primary, display: 'grid', placeItems: 'center',
              }}>
                <Icon name="user" size={26} stroke={T.primary} />
              </div>
              <div style={{ fontSize: 15, color: T.ink, fontFamily: T.serif, fontStyle: 'italic' }}>
                Aún no hay profesionales en el equipo
              </div>
              <button style={btn('primary')} onClick={() => setEditing('new')}>
                <Icon name="plus" size={13} stroke={T.primaryText} /> Agregar primero
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 880 }}>
              {pros.map(p => (
                <ProCard
                  key={p.id}
                  pro={p}
                  workingDays={scheduleDays[p.id]}
                  onClick={() => setEditing(p)}
                  onDelete={() => startDelete(p)}
                />
              ))}
            </div>
          )}
        </div>

        {toast && (
          <div style={{
            position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
            padding: '10px 18px', borderRadius: 8, fontSize: 13, zIndex: 80,
            background: toast.kind === 'err' ? T.danger : T.primary, color: '#fff',
            boxShadow: '0 8px 24px rgba(20,18,14,0.25)',
          }}>{toast.msg}</div>
        )}
      </div>

      {editing && (
        <ProfessionalEditor
          clientId={clientId}
          initialPro={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onChanged={() => { fetchPros() }}
          onNavigateToSettings={() => { setEditing(null); onNavigate?.('settings') }}
          flashToast={flashToast}
        />
      )}

      {confirmDel && confirmDel.blocker && (
        <ConfirmModal
          title="No se puede eliminar"
          description={renderBlockerBody(confirmDel.pro, confirmDel.blocker)}
          confirmLabel="Entendido"
          cancelLabel={null}
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => setConfirmDel(null)}
        />
      )}

      {confirmDel && !confirmDel.blocker && (
        <ConfirmModal
          title="¿Eliminar profesional?"
          description={`${confirmDel.pro.full_name}. Esta acción es permanente y no se puede deshacer.`}
          confirmLabel="Eliminar"
          variant="danger"
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => performDelete(confirmDel.pro)}
        />
      )}
    </div>
  )
}

// ───── Tiny shared bits ─────
function renderBlockerBody(pro, blocker) {
  const parts = []
  if (blocker.appointments > 0) parts.push(`${blocker.appointments} cita${blocker.appointments === 1 ? '' : 's'} agendada${blocker.appointments === 1 ? '' : 's'}`)
  if (blocker.patients > 0)     parts.push(`${blocker.patients} paciente${blocker.patients === 1 ? '' : 's'} asignado${blocker.patients === 1 ? '' : 's'}`)
  return (
    <>
      <div>
        <strong>{pro.full_name}</strong> tiene {parts.join(' y ')}. Antes de eliminar este profesional debes:
      </div>
      <ul style={{ marginTop: 10, marginBottom: 0, paddingLeft: 22, lineHeight: 1.6 }}>
        {blocker.appointments > 0 && <li>Reasignar o cancelar todas sus citas en la Agenda</li>}
        {blocker.patients > 0     && <li>Reasignar sus pacientes a otro profesional</li>}
      </ul>
    </>
  )
}
