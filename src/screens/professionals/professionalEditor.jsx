import React, { useState, useEffect } from 'react'
import { T, btn, SectionLabel, initials, PRO_COLORS } from '../shared.jsx'
import { supabase } from '../../lib/supabase.js'
import { flattenEmployment } from '../../lib/flattenEmployment.js'
import PhotoBioSection      from './photoBioSection.jsx'
import ScheduleSection      from './scheduleSection.jsx'
import SessionTypesSection  from './sessionTypesSection.jsx'
import DocumentsSection     from './documentsSection.jsx'

const textInput = {
  padding: '10px 12px', borderRadius: 8,
  border: `1px solid ${T.line}`, background: T.bg,
  fontSize: 13, color: T.ink, width: '100%', outline: 'none',
  fontFamily: T.sans, boxSizing: 'border-box',
}

// ───── Editor modal ─────
export default function ProfessionalEditor({ clientId, initialPro, onClose, onChanged, onNavigateToSettings, flashToast, mode }) {
  // mode === 'self': rendered as a pro's own self-edit view (e.g., from
  // settings/profile.jsx for empresa-mode pros). Skips the modal
  // backdrop, hides close X + Cancelar button, retitles the header.
  // Default (mode unset): admin-modal behavior with backdrop click-to-close.
  const isSelfMode = mode === 'self'
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

  // Lock identity fields when the profile is claimed by SOMEONE ELSE.
  // The claimant editing their own profile (mode === 'self') should
  // never be locked — RLS profiles_self_all permits self-writes
  // regardless of user_id state. The lock targets admins editing
  // pros they don't own.
  const profileLocked = !isSelfMode && pro?.user_id != null

  // Load full pro fields (bio/specialties/etc were not selected in the list query).
  // Joins employment → profile and flattens to the canonical SPA shape.
  useEffect(() => {
    if (!pro?.id) return
    let alive = true
    supabase
      .from('professional_employments')
      .select(`
        id, client_id, color, email, active, public_profile,
        professional_profiles!inner(
          id, user_id, full_name, photo_url, bio, specialties,
          education, years_experience, public_summary,
          public_credentials, public_documents
        )
      `)
      .eq('id', pro.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return
        if (error) { console.warn('[professionalEditor] load failed', error); return }
        const flat = flattenEmployment(data)
        if (!flat) return
        setPro(flat)
        setBasic(b => ({
          ...b,
          full_name: flat.full_name ?? b.full_name,
          email:     flat.email     ?? b.email,
          color:     flat.color     ?? b.color,
          active:    flat.active != null ? !!flat.active : b.active,
        }))
        setProfile(p => ({
          ...p,
          photo_url:        flat.photo_url ?? '',
          bio:              flat.bio ?? '',
          specialties:      Array.isArray(flat.specialties) ? flat.specialties : [],
          education:        flat.education ?? '',
          years_experience: flat.years_experience ?? null,
          public_profile:   flat.public_profile ?? true,
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
          .eq('employment_id', pro.id)
          .eq('active', true)
        scheds = r1.data ?? []
        const r2 = await supabase
          .from('professional_session_types')
          .select('session_type_id, custom_price_amount, active')
          .eq('employment_id', pro.id)
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

  // The editor uses its own row-id-stable diff rather than the shared
  // src/lib/syncSchedules.js helper. The library is composite-key-stable
  // (day_of_week|start|end), which churns row ids when slot times change.
  // The editor's grid UX exposes per-row edits and benefits from id
  // preservation; the shared helper is fine for create flows where no
  // existing rows need preserving.
  async function syncEditorSchedules(employmentId) {
    // Diff against scheduleOriginal: insert (no id), update (id with diff), delete (in original but not current).
    const currentIds = new Set(schedule.filter(r => r.id).map(r => r.id))
    const toDelete = scheduleOriginal.filter(o => !currentIds.has(o.id)).map(o => o.id)
    const toInsert = schedule.filter(r => !r.id).map(r => ({
      employment_id: employmentId,
      day_of_week:   r.day_of_week,
      start_time:    r.start_time,
      end_time:      r.end_time,
      active:        true,
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

  async function syncOffered(employmentId) {
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
        employment_id:       employmentId,
        session_type_id:     k,
        custom_price_amount: cur.custom_price_amount ?? null,
        active:              true,
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
        .eq('employment_id', employmentId)
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
        .eq('employment_id', employmentId)
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
      let employmentId = pro?.id
      let profileId    = pro?.profile_id

      if (employmentId) {
        // Existing pro — partitioned UPDATEs.
        const employmentPatch = {
          email:          basic.email.trim() || null,
          color:          basic.color,
          active:         !!basic.active,
          public_profile: !!profile.public_profile,
        }
        const { error: empErr } = await supabase
          .from('professional_employments')
          .update(employmentPatch)
          .eq('id', employmentId)
        if (empErr) throw new Error(`Empleo · ${empErr.message}`)

        // Profile UPDATE only if unclaimed (RLS gate also enforces this).
        if (pro?.user_id == null) {
          const profilePatch = {
            full_name:        basic.full_name.trim(),
            photo_url:        profile.photo_url || null,
            bio:              profile.bio || null,
            specialties:      Array.isArray(profile.specialties) ? profile.specialties : [],
            education:        profile.education || null,
            years_experience: profile.years_experience ?? null,
          }
          const { error: profErr } = await supabase
            .from('professional_profiles')
            .update(profilePatch)
            .eq('id', profileId)
          if (profErr) {
            throw new Error(`Perfil · ${profErr.message}. Posiblemente el profesional ya reclamó su cuenta.`)
          }
        }
      } else {
        // New pro — RPC creates profile + employment atomically, then
        // UPDATE adds the optional fields the form has captured.
        const { data: rpcResult, error: rpcErr } = await supabase.rpc(
          'create_professional_at_centro',
          {
            p_client_id: clientId,
            p_full_name: basic.full_name.trim(),
            p_email:     basic.email.trim(),
            p_color:     basic.color,
          }
        )
        if (rpcErr) throw new Error(`Datos · ${rpcErr.message}`)
        if (!rpcResult?.success) {
          throw new Error(`Datos · ${rpcResult?.message ?? 'No se pudo crear el profesional'}`)
        }
        employmentId = rpcResult.employment_id
        profileId    = rpcResult.profile_id

        // Apply the rest of the form to the freshly created rows.
        const { error: empErr } = await supabase
          .from('professional_employments')
          .update({
            active:         !!basic.active,
            public_profile: !!profile.public_profile,
          })
          .eq('id', employmentId)
        if (empErr) throw new Error(`Empleo · ${empErr.message}`)

        const { error: profErr } = await supabase
          .from('professional_profiles')
          .update({
            photo_url:        profile.photo_url || null,
            bio:              profile.bio || null,
            specialties:      Array.isArray(profile.specialties) ? profile.specialties : [],
            education:        profile.education || null,
            years_experience: profile.years_experience ?? null,
          })
          .eq('id', profileId)
        if (profErr) throw new Error(`Perfil · ${profErr.message}`)
      }

      await syncEditorSchedules(employmentId)
      await syncOffered(employmentId)

      // Refresh originals so subsequent saves diff cleanly.
      setScheduleOriginal(schedule.map(r => ({ ...r, id: r.id })))
      setOfferedOriginal(JSON.parse(JSON.stringify(offered)))

      const wasNew = !pro
      // Update the local pro shape so the rest of the modal session sees
      // the new ids + form values.
      //
      // TODO: this synthesis assumes no server-side triggers modify the
      // updated rows. If triggers are added that mutate profile or
      // employment fields on UPDATE, replace this synthesis with a re-SELECT
      // through flattenEmployment to pick up the post-trigger values.
      setPro({
        id:             employmentId,
        profile_id:     profileId,
        user_id:        pro?.user_id ?? null,
        client_id:      clientId,
        full_name:      basic.full_name.trim(),
        email:          basic.email.trim() || null,
        color:          basic.color,
        active:         !!basic.active,
        public_profile: !!profile.public_profile,
        photo_url:      profile.photo_url || null,
        bio:            profile.bio || null,
        specialties:    Array.isArray(profile.specialties) ? profile.specialties : [],
        education:      profile.education || null,
        years_experience: profile.years_experience ?? null,
      })
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

  // Outer wrapper: modal backdrop (default) vs inline panel (self mode).
  const Wrapper = ({ children }) => isSelfMode ? (
    <div style={{
      width: '100%', maxWidth: 720, margin: '0 auto', padding: '24px 16px 40px',
      fontFamily: T.sans,
    }}>
      <div style={{
        background: T.bgRaised, borderRadius: 14, border: `1px solid ${T.line}`,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>{children}</div>
    </div>
  ) : (
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
      }}>{children}</div>
    </div>
  )

  return (
    <Wrapper>
      <>
        <div style={{
          padding: '18px 22px 14px', borderBottom: `1px solid ${T.lineSoft}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontFamily: T.serif, fontSize: 22, color: T.ink, lineHeight: 1 }}>
            {isSelfMode ? 'Mi perfil' : (pro ? 'Editar profesional' : 'Nuevo profesional')}
          </div>
          {!isSelfMode && (
            <button
              onClick={() => !saving && onClose()}
              disabled={saving}
              aria-label="Cerrar"
              style={{
                background: 'transparent', border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
                color: T.inkMuted, fontSize: 22, lineHeight: 1, padding: 4,
              }}
            >×</button>
          )}
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
                disabled={profileLocked}
                style={{ ...textInput, opacity: profileLocked ? 0.55 : 1 }}
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
          {profileLocked && (
            <div style={{
              fontSize: 12, color: T.warn ?? T.danger,
              padding: '8px 12px', marginBottom: 8,
              background: T.dangerSoft ?? T.bgSunk,
              border: `1px solid ${T.lineSoft}`, borderRadius: 8,
            }}>
              Este profesional ya reclamó su perfil — solo el dueño puede editar
              identidad. Puedes seguir editando email, color y estado.
            </div>
          )}
          {/* PhotoBioSection: photo lives on professional_profiles which is
              RLS-gated by user_id IS NULL for admin writes. Lock matches RLS. */}
          <PhotoBioSection
            value={profile}
            onChange={setProfile}
            profileId={pro?.profile_id}
            displayName={basic.full_name}
            color={basic.color}
            disabled={saving || profileLocked}
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
          {/* DocumentsSection: documents are admin-manageable regardless of
              user_id (the pd_admin_all policy doesn't gate on user_id IS NULL).
              Don't apply profileLocked here. */}
          <DocumentsSection profileId={pro?.profile_id} disabled={saving} />
        </div>

        <div style={{
          padding: '14px 22px', borderTop: `1px solid ${T.lineSoft}`, background: T.bg,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          {error && <div style={{ flex: 1, fontSize: 12, color: T.danger, lineHeight: 1.4 }}>{error}</div>}
          {!error && <div style={{ flex: 1 }} />}
          {!isSelfMode && (
            <button onClick={onClose} style={btn('ghost')} disabled={saving}>Cancelar</button>
          )}
          <button onClick={handleSave} style={btn('primary')} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </>
    </Wrapper>
  )
}

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
