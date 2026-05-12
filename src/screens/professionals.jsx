import React, { useState, useEffect, useContext } from 'react'
import { T, Icon, Sidebar, TopBar, btn, ConfirmModal, MAX_PROS } from './shared.jsx'
import { ClientCtx } from '../lib/ClientCtx.js'
import { supabase } from '../lib/supabase.js'
import { flattenEmployment } from '../lib/flattenEmployment.js'
import ProCard             from './professionals/proCard.jsx'
import ProfessionalEditor  from './professionals/professionalEditor.jsx'
import Loader              from '../components/Loader.jsx'

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
      .from('professional_employments')
      .select(`
        id, client_id, color, email, active, public_profile,
        professional_profiles!inner(id, user_id, full_name, photo_url)
      `)
      .eq('client_id', clientId)
      .eq('active', true)
      .order('created_at', { ascending: true })
    if (error) {
      setToast({ kind: 'err', msg: 'Error al cargar profesionales' })
      setLoading(false)
      return
    }
    const flatPros = (data ?? []).map(flattenEmployment)
    setPros(flatPros)

    const ids = flatPros.map(p => p.id)
    if (ids.length) {
      const { data: scheds } = await supabase
        .from('professional_schedules')
        .select('employment_id, day_of_week')
        .in('employment_id', ids)
        .eq('active', true)
      const map = {}
      for (const s of scheds ?? []) {
        if (!map[s.employment_id]) map[s.employment_id] = new Set()
        map[s.employment_id].add(s.day_of_week)
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

  // Click X → run pre-check first. If the employment has active patient
  // assignments OR future non-cancelled appointments, block the action and
  // explain what to reassign. FKs SET NULL employment_id on delete, so
  // we'd lose the link silently without this guard.
  //
  // Past appointments are deliberately allowed: deletion is fine for a pro
  // who's leaving the centro and has only historical citas. The block only
  // catches obligations that still need handling.
  async function startDelete(p) {
    const nowIso = new Date().toISOString()
    const [paRes, apRes] = await Promise.all([
      supabase
        .from('patient_assignments')
        .select('*', { count: 'exact', head: true })
        .eq('employment_id', p.id)
        .eq('status', 'active'),
      supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('employment_id', p.id)
        .gt('datetime', nowIso)
        .in('status', ['pending_payment', 'confirmed']),
    ])
    if (paRes.error || apRes.error) {
      flashToast({
        kind: 'err',
        msg: `Error al verificar dependencias: ${(paRes.error ?? apRes.error).message}`,
      }, 3500)
      return
    }
    const activeAssigCount = paRes.count ?? 0
    const futureApptCount  = apRes.count ?? 0

    if (activeAssigCount > 0 || futureApptCount > 0) {
      const patPart  = activeAssigCount > 0
        ? `${activeAssigCount} paciente${activeAssigCount === 1 ? '' : 's'} activo${activeAssigCount === 1 ? '' : 's'}`
        : null
      const apptPart = futureApptCount > 0
        ? `${futureApptCount} cita${futureApptCount === 1 ? '' : 's'} próxima${futureApptCount === 1 ? '' : 's'}`
        : null
      const counts = [patPart, apptPart].filter(Boolean).join(' y ')
      const action = activeAssigCount > 0 && futureApptCount > 0
        ? 'Reasigna o cancela esos vínculos'
        : activeAssigCount > 0
          ? 'Reasigna esos pacientes'
          : 'Cancela o reasigna esas citas'
      flashToast({
        kind: 'err',
        msg: `No se puede quitar a ${p.full_name} del centro: tiene ${counts}. ${action} antes de quitarla del centro.`,
      }, 5500)
      return
    }

    setConfirmDel({ pro: p })
  }

  async function performDelete(p) {
    setConfirmDel(null)
    // Delete the employment only. Profile + photos + documents are pro-owned
    // and follow the person across centros — they survive the centro link
    // breaking. professional_schedules and professional_session_types CASCADE
    // with the employment. appointments and patient_assignments SET NULL on
    // employment_id (history preserved).
    const { error } = await supabase
      .from('professional_employments')
      .delete()
      .eq('id', p.id)
    if (error) {
      flashToast({ kind: 'err', msg: `Error al quitar del centro: ${error.message}` }, 3500)
      return
    }
    setPros(list => list.filter(x => x.id !== p.id))
    flashToast({ kind: 'ok', msg: '✓ Profesional quitado del centro' })
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
            <Loader size="inline" />
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

      {confirmDel && (
        <ConfirmModal
          title="¿Quitar del centro?"
          description={`${confirmDel.pro.full_name} dejará de aparecer en este centro. Su perfil personal (foto, biografía, certificados) se conserva.`}
          confirmLabel="Quitar"
          variant="danger"
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => performDelete(confirmDel.pro)}
        />
      )}
    </div>
  )
}
