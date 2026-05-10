import React, { useState, useEffect, useContext } from 'react'
import { T, Icon, btn, SectionLabel, avatarTint, avatarInk, initials, PRO_COLORS } from '../shared.jsx'
import { ClientCtx } from '../../lib/ClientCtx.js'
import { ClientConfigCtx } from '../../lib/ClientConfigCtx.js'
import { supabase } from '../../lib/supabase.js'
import { mergeClientConfig, fetchClientConfig } from '../../lib/clientConfig.js'
import { flattenEmployment } from '../../lib/flattenEmployment.js'
import { syncSchedules } from '../../lib/syncSchedules.js'
import ProfessionalEditor from '../professionals/professionalEditor.jsx'
import { DAYS, DEFAULT_AVAILABILITY, SmallToggle, SettingsHeader, FieldRow, textInput, formatRut, TimePicker } from './_shared.jsx'

// ───── Profile — wired to clients.config (primary_color, resend_from, avatar_url) ─────
export default function ProfileSettings({ onDirtyChange }) {
  const { clientId, professional, refreshFirstPro } = useContext(ClientCtx)
  const { config, setConfig } = useContext(ClientConfigCtx)
  const empresaMode = !!config?.modo_empresa
  const isPro = !!professional

  const [name,         setName]         = useState(config?.profile_name    ?? '')
  const [title,        setTitle]        = useState(config?.profile_title   ?? '')
  const [rut,          setRut]          = useState(config?.profile_rut     ?? '')
  const [sss,          setSss]          = useState(config?.profile_sss     ?? '')
  const [phone,        setPhone]        = useState(config?.profile_phone   ?? '')
  const [address,      setAddress]      = useState(config?.profile_address ?? '')
  const [resendFrom,   setResendFrom]   = useState(config?.resend_from     ?? '')
  const [avatarUrl,    setAvatarUrl]    = useState(config?.avatar_url      ?? '')
  const [availability, setAvailability] = useState(null) // null = not loaded
  const [initialAvailability, setInitialAvailability] = useState(null)
  const [saving,       setSaving]       = useState(false)
  const [saveStatus,   setSaveStatus]   = useState(null)
  const [uploading,    setUploading]    = useState(false)
  const fileInputRef = React.useRef(null)

  // Fetch fresh on mount so all fields reflect DB truth, regardless of context.
  useEffect(() => {
    if (!clientId) return
    let alive = true
    fetchClientConfig(clientId).then(({ config: fresh }) => {
      if (!alive || !fresh) return
      setName(fresh.profile_name       ?? '')
      setTitle(fresh.profile_title     ?? '')
      setRut(fresh.profile_rut         ?? '')
      setSss(fresh.profile_sss         ?? '')
      setPhone(fresh.profile_phone     ?? '')
      setAddress(fresh.profile_address ?? '')
      setResendFrom(fresh.resend_from  ?? '')
      setAvatarUrl(fresh.avatar_url    ?? '')
      setConfig(fresh)
    })
    return () => { alive = false }
  }, [clientId])

  // Also keep state in sync if context changes (e.g. another tab updated it).
  useEffect(() => {
    setName(config?.profile_name       ?? '')
    setTitle(config?.profile_title     ?? '')
    setRut(config?.profile_rut         ?? '')
    setSss(config?.profile_sss         ?? '')
    setPhone(config?.profile_phone     ?? '')
    setAddress(config?.profile_address ?? '')
    setResendFrom(config?.resend_from  ?? '')
    setAvatarUrl(config?.avatar_url    ?? '')
  }, [config])

  // Dirty detection — compare each field to the persisted config snapshot.
  const dirty = React.useMemo(() => {
    if (name        !== (config?.profile_name    ?? '')) return true
    if (title       !== (config?.profile_title   ?? '')) return true
    if (rut         !== (config?.profile_rut     ?? '')) return true
    if (sss         !== (config?.profile_sss     ?? '')) return true
    if (phone       !== (config?.profile_phone   ?? '')) return true
    if (address     !== (config?.profile_address ?? '')) return true
    if (resendFrom  !== (config?.resend_from     ?? '')) return true
    if (avatarUrl   !== (config?.avatar_url      ?? '')) return true
    if (initialAvailability && JSON.stringify(availability) !== JSON.stringify(initialAvailability)) return true
    return false
  }, [name, title, rut, sss, phone, address, resendFrom, avatarUrl, availability, initialAvailability, config])

  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])

  async function handleAvatarPick(e) {
    const file = e.target.files?.[0]
    if (!file || !clientId) return
    setUploading(true)
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `${clientId}/avatar.${ext}`
    const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type })
    if (upErr) { setUploading(false); setSaveStatus('error'); return }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    const url = `${data.publicUrl}?t=${Date.now()}` // cache-bust on every upload
    // Merge against fresh DB state so this avatar update doesn't clobber
    // other fields recently saved by Empresa/Apariencia/etc.
    const { error: dbErr, config: nextConfig } = await mergeClientConfig(clientId, { avatar_url: url })
    setUploading(false)
    if (dbErr) { setSaveStatus('error'); return }
    setAvatarUrl(url)        // immediate local update — profile section
    setConfig(nextConfig)    // immediate context update — sidebar avatar
  }

  async function handleSave() {
    setSaving(true)
    setSaveStatus(null) // clear any prior error so retries reset
    const trimmedName = name.trim()
    // Merge profile fields against fresh DB state so we never wipe empresa/theme
    // saved from other tabs.
    console.log('[profile-save] BEFORE mergeClientConfig', { clientId })
    const { error: clientErr, config: mergedConfig } = await mergeClientConfig(clientId, fresh => ({
      ...fresh,
      profile_name:    trimmedName,
      profile_title:   title.trim(),
      profile_rut:     rut.trim(),
      profile_sss:     sss.trim(),
      profile_phone:   phone.trim(),
      profile_address: address.trim(),
      resend_from:     resendFrom,
    }))
    console.log('[profile-save] AFTER mergeClientConfig', { error: clientErr })
    if (clientErr) { setSaving(false); setSaveStatus('error'); return }
    // Side-effect: mirror display name to clients.name so it appears in lists.
    if (trimmedName) {
      await supabase.from('clients').update({ name: trimmedName }).eq('id', clientId)
    }
    setConfig(mergedConfig)

    // Single-mode auto-mirror: ensure a professional_employments row
    // exists for this admin's centro, with their identity data.
    const { data: empRow } = await supabase
      .from('professional_employments')
      .select(`
        id, client_id, color, email, active,
        professional_profiles!inner(id, user_id, full_name)
      `)
      .eq('client_id', clientId)
      .eq('active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    const existing = flattenEmployment(empRow)

    let employmentId
    let profileId

    if (existing) {
      employmentId = existing.id
      profileId = existing.profile_id

      // UPDATE profile (full_name) only if unclaimed.
      if (existing.user_id === null && trimmedName !== existing.full_name) {
        const { error: profErr } = await supabase
          .from('professional_profiles')
          .update({ full_name: trimmedName })
          .eq('id', profileId)
        if (profErr) {
          console.warn('[profile.jsx] profile update failed', profErr)
        }
      }

      // UPDATE employment (email) — always allowed for centro admin.
      const empPatch = {}
      if (resendFrom !== existing.email) empPatch.email = resendFrom || null
      if (Object.keys(empPatch).length > 0) {
        const { error: empErr } = await supabase
          .from('professional_employments')
          .update(empPatch)
          .eq('id', employmentId)
        if (empErr) {
          console.warn('[profile.jsx] employment update failed', empErr)
        }
      }
    } else {
      // First-time creation: use the RPC for atomic two-table INSERT.
      const { data: rpcResult, error: rpcErr } = await supabase.rpc(
        'create_professional_at_centro',
        {
          p_client_id: clientId,
          p_full_name: trimmedName,
          p_email:     resendFrom || '',
          p_color:     PRO_COLORS[0],
        }
      )
      if (rpcErr || !rpcResult?.success) {
        console.warn('[profile.jsx] create_professional_at_centro failed', rpcErr ?? rpcResult)
        setSaving(false); setSaveStatus('error'); return
      }
      employmentId = rpcResult.employment_id
      profileId    = rpcResult.profile_id
    }

    // Sync schedules to the employment.
    if (availability) {
      const { data: schedRows } = await supabase
        .from('professional_schedules')
        .select('id, day_of_week, start_time, end_time')
        .eq('employment_id', employmentId)

      const { error: schedErr } = await syncSchedules(
        supabase,
        employmentId,
        availability,
        schedRows ?? []
      )
      if (schedErr) {
        console.warn('[profile.jsx] schedule sync failed', schedErr)
      }
    }

    // Adopt orphan appointments (employment_id IS NULL) as belonging to
    // the admin's employment.
    await supabase
      .from('appointments')
      .update({ employment_id: employmentId })
      .eq('client_id', clientId)
      .is('employment_id', null)

    refreshFirstPro?.() // always run — banner clears immediately on first save too
    if (availability) setInitialAvailability(availability)
    setSaving(false)
    setSaveStatus('ok')
    setTimeout(() => setSaveStatus(null), 2500)
  }


  const displayName = name || ''

  // Pro-mode in empresa centros: this screen's centro-admin fields
  // (RUT, SSS, Email del remitente, Teléfono, Dirección) don't apply
  // to a treating pro. Render the canonical pro-self-edit view instead.
  if (isPro && empresaMode) {
    return (
      <ProfessionalEditor
        clientId={clientId}
        initialPro={professional}
        mode="self"
        onClose={() => {}}
        onChanged={() => { refreshFirstPro?.() }}
      />
    )
  }

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 780 }}>
      <SettingsHeader title="Perfil profesional" subtitle="Información que verán tus pacientes y que el bot mencionará" />

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', marginBottom: 28 }}>
        <div
          onClick={() => fileInputRef.current?.click()}
          title="Cambiar foto de perfil"
          style={{
            width: 88, height: 88, borderRadius: '50%',
            background: avatarUrl ? T.bgSunk : (displayName ? avatarTint(displayName) : T.bgSunk),
            color: displayName ? avatarInk(displayName) : T.inkMuted,
            display: 'grid', placeItems: 'center',
            fontFamily: T.sans, fontSize: 30, fontWeight: 600,
            cursor: 'pointer', overflow: 'hidden',
            border: avatarUrl ? 'none' : `1px dashed ${T.line}`,
          }}
        >
          {avatarUrl
            ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : (displayName
                ? displayName.split(' ').slice(0, 2).map(s => s[0]).join('').toUpperCase()
                : <Icon name="user" size={32} stroke={T.inkMuted} />)}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleAvatarPick}
        />
        <div style={{ flex: 1, paddingTop: 6 }}>
          <div style={{ fontSize: 13, color: T.inkSoft, marginBottom: 10 }}>Foto de perfil</div>
          <button style={btn('ghost')} onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            <Icon name="download" size={13} /> {uploading ? 'Subiendo…' : 'Subir nueva foto'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <FieldRow label="Nombre completo">
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="Ej: Dra. Ana González" style={textInput} />
        </FieldRow>
        <FieldRow label="Título profesional">
          <input value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Ej: Psicóloga clínica" style={textInput} />
        </FieldRow>
        <FieldRow label="RUT">
          <input value={rut}
            onChange={e => setRut(e.target.value)}
            onBlur={() => setRut(r => formatRut(r))}
            placeholder="Ej: 12.345.678-9" style={{ ...textInput, fontFamily: T.mono }} />
        </FieldRow>
        <FieldRow label="N° registro SSS">
          <input value={sss} onChange={e => setSss(e.target.value)}
            placeholder="Ej: 23.459" style={{ ...textInput, fontFamily: T.mono }} />
        </FieldRow>
        <FieldRow label="Email del remitente" hint="Resend usará este email como remitente.">
          <input value={resendFrom} onChange={e => setResendFrom(e.target.value)}
            placeholder="Ej: agenda@miconsultorio.cl" style={textInput} />
        </FieldRow>
        <FieldRow label="Teléfono">
          <input value={phone} onChange={e => setPhone(e.target.value)}
            placeholder="Ej: +56 9 8765 4321" style={{ ...textInput, fontFamily: T.mono }} />
        </FieldRow>
      </div>

      <FieldRow label="Dirección de consulta">
        <input value={address} onChange={e => setAddress(e.target.value)}
          placeholder="Ej: Av. Providencia 1234, Oficina 502" style={textInput} />
      </FieldRow>

      {!empresaMode && (
        <PerfilDisponibilidad
          clientId={clientId}
          config={config}
          availability={availability}
          onAvailabilityLoaded={(av) => { setAvailability(av); setInitialAvailability(av) }}
          onAvailabilityChange={setAvailability}
        />
      )}

      <div style={{ marginTop: 24, display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
        {saveStatus === 'ok'    && <span style={{ fontSize: 12, color: T.confirmado }}>✓ Guardado</span>}
        {saveStatus === 'error' && <span style={{ fontSize: 12, color: T.error }}>Error al guardar</span>}
        <button style={btn('ghost')} disabled={saving}>Cancelar</button>
        <button style={btn('primary')} onClick={handleSave} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  )
}

function PerfilDisponibilidad({ clientId, config, availability, onAvailabilityLoaded, onAvailabilityChange }) {
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) return
    let alive = true
    ;(async () => {
      let av = DEFAULT_AVAILABILITY
      try {
        const { data: empRow2 } = await supabase
          .from('professional_employments')
          .select('id, professional_profiles!inner(id, user_id, full_name)')
          .eq('client_id', clientId)
          .eq('active', true)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (empRow2?.id) {
          const { data: schedRows2 } = await supabase
            .from('professional_schedules')
            .select('day_of_week, start_time, end_time')
            .eq('employment_id', empRow2.id)
            .eq('active', true)

          // Build the legacy single-range-per-day shape from rows, so the
          // existing UI can bind to it. Multi-range schedules surface as
          // the first matching row per day.
          const dowKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
          const next = {}
          for (const key of Object.keys(DEFAULT_AVAILABILITY)) {
            const idx = dowKeys.indexOf(key)
            const r = (schedRows2 ?? []).find(s => s.day_of_week === idx)
            if (r) {
              next[key] = {
                start:     String(r.start_time).slice(0, 5),
                end:       String(r.end_time).slice(0, 5),
                available: true,
              }
            } else {
              next[key] = { ...DEFAULT_AVAILABILITY[key], available: false }
            }
          }
          av = next
        }
      } catch (e) {
        console.error('[disponibilidad] fetch failed', e)
      } finally {
        if (alive) {
          onAvailabilityLoaded?.(av)
          setLoading(false)
        }
      }
    })()
    return () => { alive = false }
  }, [clientId])

  function setDay(key, patch) {
    onAvailabilityChange?.({ ...availability, [key]: { ...availability[key], ...patch } })
  }

  return (
    <div style={{ marginTop: 28, paddingTop: 22, borderTop: `1px solid ${T.lineSoft}` }}>
      <SectionLabel icon="calendar" label="Disponibilidad semanal" />
      {loading || !availability ? (
        <div style={{ padding: 16, color: T.inkMuted, fontStyle: 'italic', fontSize: 13 }}>cargando…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {DAYS.map(([key, label]) => {
            const d = availability[key] ?? { start: '09:00', end: '18:00', available: false }
            return (
              <div key={key} style={{
                display: 'grid', gridTemplateColumns: '110px 60px 1fr 1fr', gap: 10,
                alignItems: 'center', padding: '6px 0',
              }}>
                <div style={{ fontSize: 12.5, color: T.ink }}>{label}</div>
                <SmallToggle value={d.available} onChange={(v) => setDay(key, { available: v })} />
                <div style={{ opacity: d.available ? 1 : 0.4, pointerEvents: d.available ? 'auto' : 'none' }}>
                  <TimePicker value={d.start} onChange={(v) => setDay(key, { start: v })} hourRange={[6, 14]} />
                </div>
                <div style={{ opacity: d.available ? 1 : 0.4, pointerEvents: d.available ? 'auto' : 'none' }}>
                  <TimePicker value={d.end} onChange={(v) => setDay(key, { end: v })} hourRange={[12, 23]} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
