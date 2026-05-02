import React, { useState, useEffect, useContext } from 'react'
import { T, Icon, Sidebar, TopBar, btn, ConfirmModal, SectionLabel } from './shared.jsx'
import { ClientCtx } from '../lib/ClientCtx.js'
import { supabase } from '../lib/supabase.js'
import PhotoBioSection      from './professionals/photoBioSection.jsx'
import ScheduleSection, { DAYS, newRange } from './professionals/scheduleSection.jsx'
import SessionTypesSection  from './professionals/sessionTypesSection.jsx'
import DocumentsSection     from './professionals/documentsSection.jsx'

const PRO_COLORS = ['#2f4a3a', '#0077b6', '#7c5cbf', '#d4688a', '#e07a3a', '#9a4a3f']
const MAX_PROS = 5

function initialsOf(name) {
  return (name ?? '').trim().split(/\s+/).slice(0, 2).map(s => s[0] ?? '').join('').toUpperCase() || '?'
}

const textInput = {
  padding: '10px 12px', borderRadius: 8,
  border: `1px solid ${T.line}`, background: T.bg,
  fontSize: 13, color: T.ink, width: '100%', outline: 'none',
  fontFamily: T.sans, boxSizing: 'border-box',
}

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
    const { data, error } = await supabase
      .from('professionals')
      .select('id, full_name, email, color, photo_url, avatar_url, active, public_profile')
      .eq('client_id', clientId)
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

  async function performDelete(p) {
    setConfirmDel(null)
    const { error } = await supabase.from('professionals').delete().eq('id', p.id)
    if (error) { flashToast({ kind: 'err', msg: `Error al eliminar: ${error.message}` }, 3500); return }
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
                  onDelete={() => setConfirmDel(p)}
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
          title={`¿Eliminar a ${confirmDel.full_name}?`}
          description="Sus citas no se borran pero quedarán sin profesional asignado."
          confirmLabel="Eliminar"
          variant="danger"
          onCancel={() => setConfirmDel(null)}
          onConfirm={() => performDelete(confirmDel)}
        />
      )}
    </div>
  )
}

// ───── Card in the list ─────
function ProCard({ pro, workingDays, onClick, onDelete }) {
  const photo = pro.photo_url || pro.avatar_url
  const days  = workingDays
    ? DAYS.filter(d => workingDays.has(d.value)).map(d => d.short)
    : []
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '14px 16px', borderRadius: 12,
        background: T.bgRaised, border: `1px solid ${T.line}`,
        cursor: 'pointer', transition: 'border-color 120ms',
      }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: '50%',
        background: photo ? T.bgSunk : (pro.color || T.primary), color: '#fff',
        display: 'grid', placeItems: 'center',
        fontSize: 16, fontWeight: 600, fontFamily: T.sans,
        overflow: 'hidden', flexShrink: 0, border: `1px solid ${T.line}`,
      }}>
        {photo
          ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : initialsOf(pro.full_name)}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, color: T.ink, fontWeight: 500 }}>{pro.full_name || '— sin nombre —'}</span>
          <span title={pro.active ? 'Activo' : 'Inactivo'} style={{
            width: 8, height: 8, borderRadius: '50%',
            background: pro.active ? T.confirmado : T.inkFaint,
            boxShadow: pro.active ? `0 0 0 3px ${T.confirmadoSoft}` : 'none',
            flexShrink: 0,
          }} />
        </div>
        <div style={{ fontSize: 11.5, color: T.inkMuted, marginTop: 3 }}>
          {pro.email || '— sin email —'}
        </div>
        <div style={{ fontSize: 11, color: T.inkMuted, marginTop: 3, fontFamily: T.mono }}>
          {days.length ? days.join(' · ') : 'Sin horario configurado'}
        </div>
      </div>

      <button
        onClick={e => { e.stopPropagation(); onDelete?.() }}
        title="Eliminar"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: T.inkMuted, padding: 6, borderRadius: 6,
        }}
      ><Icon name="x" size={14} stroke={T.inkMuted} /></button>
    </div>
  )
}

// ───── Editor modal ─────
function ProfessionalEditor({ clientId, initialPro, onClose, onChanged, onNavigateToSettings, flashToast }) {
  // Track the "current" pro so a freshly-created professional flips the modal
  // into edit mode (unlocking photo + document uploads).
  const [pro, setPro] = useState(initialPro)

  const [basic, setBasic] = useState({
    full_name: initialPro?.full_name ?? '',
    email:     initialPro?.email     ?? '',
    color:     initialPro?.color     ?? PRO_COLORS[0],
    active:    initialPro ? !!initialPro.active : true,
  })

  const [profile, setProfile] = useState({
    photo_url:        initialPro?.photo_url ?? '',
    bio:              initialPro?.bio ?? '',
    specialties:      Array.isArray(initialPro?.specialties) ? initialPro.specialties : [],
    education:        initialPro?.education ?? '',
    years_experience: initialPro?.years_experience ?? null,
    public_profile:   initialPro?.public_profile ?? true,
  })

  // Schedule + offered are loaded async after we know the pro id.
  const [schedule, setSchedule]               = useState([])
  const [scheduleOriginal, setScheduleOriginal] = useState([])
  const [catalog, setCatalog]                 = useState([])
  const [offered, setOffered]                 = useState({})
  const [offeredOriginal, setOfferedOriginal] = useState({})
  const [loadingExtra, setLoadingExtra]       = useState(true)

  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  // Load full pro fields (bio/specialties/etc were not selected in the list query).
  useEffect(() => {
    if (!pro?.id) return
    let alive = true
    supabase
      .from('professionals')
      .select('full_name, email, color, active, photo_url, bio, specialties, education, years_experience, public_profile')
      .eq('id', pro.id)
      .single()
      .then(({ data }) => {
        if (!alive || !data) return
        setBasic(b => ({
          ...b,
          full_name: data.full_name ?? b.full_name,
          email:     data.email     ?? b.email,
          color:     data.color     ?? b.color,
          active:    data.active != null ? !!data.active : b.active,
        }))
        setProfile(p => ({
          ...p,
          photo_url:        data.photo_url ?? '',
          bio:              data.bio ?? '',
          specialties:      Array.isArray(data.specialties) ? data.specialties : [],
          education:        data.education ?? '',
          years_experience: data.years_experience ?? null,
          public_profile:   data.public_profile ?? true,
        }))
      })
    return () => { alive = false }
  }, [pro?.id])

  // Load schedule + offered + catalog whenever the editor opens or the pro id flips
  // from null → freshly-created.
  useEffect(() => {
    let alive = true
    async function load() {
      setLoadingExtra(true)
      // Always fetch the catalog of session_types for this client.
      const cat = await supabase
        .from('session_types')
        .select('id, name, price_amount, price_currency, display_order')
        .eq('client_id', clientId)
        .eq('active', true)
        .order('display_order', { ascending: true })
        .order('created_at',    { ascending: true })

      let scheds = []
      let off    = []
      if (pro?.id) {
        const r1 = await supabase
          .from('professional_schedules')
          .select('id, day_of_week, start_time, end_time, active')
          .eq('professional_id', pro.id)
          .eq('active', true)
        scheds = r1.data ?? []
        const r2 = await supabase
          .from('professional_session_types')
          .select('session_type_id, custom_price_amount, active')
          .eq('professional_id', pro.id)
          .eq('active', true)
        off = r2.data ?? []
      }
      if (!alive) return

      setCatalog(cat.data ?? [])
      const schedRows = scheds.map(s => ({
        _key: `db_${s.id}`,
        id:   s.id,
        day_of_week: s.day_of_week,
        start_time:  s.start_time,
        end_time:    s.end_time,
      }))
      setSchedule(schedRows)
      setScheduleOriginal(schedRows.map(r => ({ ...r })))

      const offMap = {}
      for (const o of off) {
        offMap[o.session_type_id] = { active: !!o.active, custom_price_amount: o.custom_price_amount }
      }
      setOffered(offMap)
      setOfferedOriginal(JSON.parse(JSON.stringify(offMap)))

      setLoadingExtra(false)
    }
    load()
    return () => { alive = false }
  }, [pro?.id, clientId])

  // ── validation ──
  function validate() {
    const name = (basic.full_name ?? '').trim()
    if (name.length < 2) return 'Nombre requerido (mínimo 2 caracteres)'
    const email = (basic.email ?? '').trim()
    if (!email) return 'Email requerido'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Email inválido'
    for (const r of schedule) {
      if (!r.start_time || !r.end_time) return 'Cada tramo necesita hora de inicio y fin'
      if (r.start_time >= r.end_time) return 'En cada tramo, la hora final debe ser mayor que la inicial'
    }
    return null
  }

  async function syncSchedules(profId) {
    // Diff against scheduleOriginal: insert (no id), update (id with diff), delete (in original but not current).
    const currentIds = new Set(schedule.filter(r => r.id).map(r => r.id))
    const toDelete = scheduleOriginal.filter(o => !currentIds.has(o.id)).map(o => o.id)
    const toInsert = schedule.filter(r => !r.id).map(r => ({
      professional_id: profId,
      day_of_week:     r.day_of_week,
      start_time:      r.start_time,
      end_time:        r.end_time,
      active:          true,
    }))
    const toUpdate = schedule.filter(r => r.id).filter(r => {
      const orig = scheduleOriginal.find(o => o.id === r.id)
      if (!orig) return false
      return orig.day_of_week !== r.day_of_week
          || orig.start_time  !== r.start_time
          || orig.end_time    !== r.end_time
    })

    if (toDelete.length) {
      const { error } = await supabase.from('professional_schedules').delete().in('id', toDelete)
      if (error) throw new Error(`Agenda · eliminar: ${error.message}`)
    }
    for (const r of toUpdate) {
      const { error } = await supabase.from('professional_schedules')
        .update({ day_of_week: r.day_of_week, start_time: r.start_time, end_time: r.end_time })
        .eq('id', r.id)
      if (error) throw new Error(`Agenda · actualizar: ${error.message}`)
    }
    if (toInsert.length) {
      const { error } = await supabase.from('professional_schedules').insert(toInsert)
      if (error) throw new Error(`Agenda · insertar: ${error.message}`)
    }
  }

  async function syncOffered(profId) {
    const allKeys = new Set([...Object.keys(offered), ...Object.keys(offeredOriginal)])
    const toDelete = []
    const toInsert = []
    const toUpdate = []
    for (const k of allKeys) {
      const cur  = offered[k]
      const orig = offeredOriginal[k]
      const curActive  = !!cur?.active
      const origActive = !!orig?.active
      if (origActive && !curActive)     toDelete.push(k)
      else if (!origActive && curActive) toInsert.push({
        professional_id:    profId,
        session_type_id:    k,
        custom_price_amount: cur.custom_price_amount ?? null,
        active:             true,
      })
      else if (curActive && origActive) {
        if ((cur.custom_price_amount ?? null) !== (orig.custom_price_amount ?? null)) {
          toUpdate.push({ k, custom_price_amount: cur.custom_price_amount ?? null })
        }
      }
    }
    if (toDelete.length) {
      const { error } = await supabase
        .from('professional_session_types')
        .delete()
        .eq('professional_id', profId)
        .in('session_type_id', toDelete)
      if (error) throw new Error(`Servicios · eliminar: ${error.message}`)
    }
    if (toInsert.length) {
      const { error } = await supabase.from('professional_session_types').insert(toInsert)
      if (error) throw new Error(`Servicios · insertar: ${error.message}`)
    }
    for (const u of toUpdate) {
      const { error } = await supabase
        .from('professional_session_types')
        .update({ custom_price_amount: u.custom_price_amount })
        .eq('professional_id', profId)
        .eq('session_type_id', u.k)
      if (error) throw new Error(`Servicios · actualizar: ${error.message}`)
    }
  }

  async function handleSave() {
    const err = validate()
    if (err) { setError(err); return }
    setError(null)
    setSaving(true)

    try {
      const proRow = {
        client_id:        clientId,
        full_name:        basic.full_name.trim(),
        initials:         initialsOf(basic.full_name),
        email:            basic.email.trim(),
        color:            basic.color,
        active:           !!basic.active,
        photo_url:        profile.photo_url || null,
        bio:              profile.bio || null,
        specialties:      Array.isArray(profile.specialties) ? profile.specialties : [],
        education:        profile.education || null,
        years_experience: profile.years_experience ?? null,
        public_profile:   !!profile.public_profile,
      }

      let saved
      if (pro?.id) {
        const { data, error } = await supabase
          .from('professionals')
          .update(proRow)
          .eq('id', pro.id)
          .select()
          .single()
        if (error) throw new Error(`Datos · ${error.message}`)
        saved = data
      } else {
        const { data, error } = await supabase
          .from('professionals')
          .insert(proRow)
          .select()
          .single()
        if (error) throw new Error(`Datos · ${error.message}`)
        saved = data
      }

      await syncSchedules(saved.id)
      await syncOffered(saved.id)

      // Refresh originals so subsequent saves diff cleanly.
      setScheduleOriginal(schedule.map(r => ({ ...r, id: r.id })))
      setOfferedOriginal(JSON.parse(JSON.stringify(offered)))

      const wasNew = !pro
      setPro(saved)
      onChanged?.()
      setSaving(false)

      if (wasNew) {
        flashToast?.({ kind: 'ok', msg: '✓ Profesional creado. Ahora puedes subir foto y documentos.' }, 3500)
        // Stay open in edit mode so the user can upload photo/docs.
      } else {
        flashToast?.({ kind: 'ok', msg: '✓ Guardado' })
        onClose()
      }
    } catch (e) {
      setSaving(false)
      setError(e.message ?? 'Error al guardar')
    }
  }

  return (
    <div onClick={() => !saving && onClose()} style={{
      position: 'fixed', inset: 0, background: 'rgba(20,18,14,0.45)',
      display: 'grid', placeItems: 'center', zIndex: 60, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 720, maxHeight: '90vh',
        background: T.bgRaised, borderRadius: 14,
        boxShadow: '0 24px 60px rgba(20,18,14,0.28)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        fontFamily: T.sans,
      }}>
        <div style={{
          padding: '18px 22px 14px', borderBottom: `1px solid ${T.lineSoft}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontFamily: T.serif, fontSize: 22, color: T.ink, lineHeight: 1 }}>
            {pro ? 'Editar profesional' : 'Nuevo profesional'}
          </div>
          <button
            onClick={() => !saving && onClose()}
            disabled={saving}
            aria-label="Cerrar"
            style={{
              background: 'transparent', border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
              color: T.inkMuted, fontSize: 22, lineHeight: 1, padding: 4,
            }}
          >×</button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '20px 22px 24px' }}>
          {/* SECTION 1 — DATOS BÁSICOS */}
          <SectionLabel icon="user" label="Datos básicos" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 12 }}>
            <div>
              <FieldLabel>Nombre completo *</FieldLabel>
              <input
                value={basic.full_name}
                onChange={e => setBasic(b => ({ ...b, full_name: e.target.value }))}
                placeholder="Dra. Paz Correa"
                style={textInput}
              />
            </div>
            <div>
              <FieldLabel>Email *</FieldLabel>
              <input
                type="email"
                value={basic.email}
                onChange={e => setBasic(b => ({ ...b, email: e.target.value }))}
                placeholder="paz@centro.cl"
                style={textInput}
              />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <FieldLabel>Color</FieldLabel>
              <div style={{ display: 'flex', gap: 8 }}>
                {PRO_COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setBasic(b => ({ ...b, color: c }))} style={{
                    width: 28, height: 28, borderRadius: '50%', cursor: 'pointer',
                    background: c,
                    border: basic.color === c ? `3px solid ${T.ink}` : `1px solid ${T.line}`,
                  }} />
                ))}
              </div>
            </div>
            <div>
              <FieldLabel>Activo</FieldLabel>
              <Toggle value={basic.active} onChange={v => setBasic(b => ({ ...b, active: v }))} />
            </div>
          </div>

          <SectionDivider />

          {/* SECTION 2 — PERFIL PÚBLICO */}
          <SectionLabel icon="user" label="Perfil público" />
          <PhotoBioSection
            value={profile}
            onChange={setProfile}
            professionalId={pro?.id}
            displayName={basic.full_name}
            color={basic.color}
            disabled={saving}
          />

          <SectionDivider />

          {/* SECTION 3 — AGENDA */}
          <SectionLabel icon="calendar" label="Días y horarios de atención" />
          {loadingExtra ? (
            <div style={{ padding: 14, color: T.inkMuted, fontSize: 12.5, fontStyle: 'italic' }}>Cargando agenda…</div>
          ) : (
            <ScheduleSection value={schedule} onChange={setSchedule} />
          )}

          <SectionDivider />

          {/* SECTION 4 — SERVICIOS OFRECIDOS */}
          <SectionLabel icon="briefcase" label="Servicios que ofrece" />
          {loadingExtra ? (
            <div style={{ padding: 14, color: T.inkMuted, fontSize: 12.5, fontStyle: 'italic' }}>Cargando servicios…</div>
          ) : (
            <SessionTypesSection
              catalog={catalog}
              value={offered}
              onChange={setOffered}
              onNavigateToSettings={onNavigateToSettings}
              disabled={saving}
            />
          )}

          <SectionDivider />

          {/* SECTION 5 — DOCUMENTOS */}
          <SectionLabel icon="file" label="Documentos y certificados" />
          <DocumentsSection professionalId={pro?.id} disabled={saving} />
        </div>

        <div style={{
          padding: '14px 22px', borderTop: `1px solid ${T.lineSoft}`, background: T.bg,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          {error && <div style={{ flex: 1, fontSize: 12, color: T.danger, lineHeight: 1.4 }}>{error}</div>}
          {!error && <div style={{ flex: 1 }} />}
          <button onClick={onClose} style={btn('ghost')} disabled={saving}>Cancelar</button>
          <button onClick={handleSave} style={btn('primary')} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ───── Tiny shared bits ─────
function FieldLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, color: T.inkMuted, marginBottom: 6,
      letterSpacing: 0.4, textTransform: 'uppercase',
    }}>{children}</div>
  )
}

function SectionDivider() {
  return <div style={{ height: 1, background: T.lineSoft, margin: '20px 0' }} />
}

function Toggle({ value, onChange }) {
  return (
    <div onClick={() => onChange(!value)} style={{
      width: 38, height: 22, borderRadius: 999, cursor: 'pointer',
      background: value ? T.primary : T.line,
      position: 'relative', transition: 'background .15s',
    }}>
      <div style={{
        position: 'absolute', top: 2, left: value ? 18 : 2,
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,.2)', transition: 'left .15s',
      }} />
    </div>
  )
}
