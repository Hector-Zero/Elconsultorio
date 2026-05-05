import React, { useState, useContext } from 'react'
import { T, Icon, btn, SectionLabel, initials, PRO_COLORS } from '../shared.jsx'
import { ClientCtx } from '../../lib/ClientCtx.js'
import { supabase } from '../../lib/supabase.js'
import { mergeClientConfig } from '../../lib/clientConfig.js'
import { DAYS, DEFAULT_AVAILABILITY, Field2, SmallToggle, SettingsHeader, textInput, formatRut, TimePicker } from './_shared.jsx'

export default function EmpresaWizard({ onCancel, onActivated }) {
  const { clientId, config, setConfig } = useContext(ClientCtx)
  const [step, setStep] = useState(1)

  // step 1
  const [nombre, setNombre]       = useState('')
  const [rut, setRut]             = useState('')
  const [direccion, setDireccion] = useState('')
  const [telefono, setTelefono]   = useState('')
  const [emailC, setEmailC]       = useState('')
  const [logoFile, setLogoFile]   = useState(null)
  const [logoPreview, setLogoPreview] = useState('')
  const logoRef = React.useRef(null)

  // step 2 — prefill from Perfil profesional if already saved
  const [proName, setProName]     = useState(config?.profile_name ?? '')
  const [proEmail, setProEmail]   = useState('')
  const [proColor, setProColor]   = useState(PRO_COLORS[0])
  const [availability, setAvailability] = useState(DEFAULT_AVAILABILITY)

  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)

  function pickLogo(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setLogoFile(f); setLogoPreview(URL.createObjectURL(f))
  }
  function setDay(key, patch) {
    setAvailability(av => ({ ...av, [key]: { ...av[key], ...patch } }))
  }

  async function activate() {
    if (!proName.trim()) { setErr('Nombre del profesional requerido'); return }
    if (!proEmail.trim()) { setErr('Email del profesional requerido'); return }
    setSaving(true); setErr(null)

    let logoUrl = ''
    if (logoFile) {
      const ext  = (logoFile.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${clientId}/logo.${ext}`
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, logoFile, { upsert: true, contentType: logoFile.type })
      if (!upErr) {
        const { data } = supabase.storage.from('avatars').getPublicUrl(path)
        logoUrl = `${data.publicUrl}?t=${Date.now()}` // cache-bust
      }
    }

    const { data: pro, error: proErr } = await supabase
      .from('professionals')
      .insert({
        client_id: clientId,
        full_name: proName.trim(),
        initials:  initials(proName),
        email:     proEmail.trim(),
        color:     proColor,
        availability,
      })
      .select()
      .single()
    if (proErr) { setSaving(false); setErr(proErr.message); return }

    // Migrate any orphaned appointments to this first professional
    await supabase.from('appointments')
      .update({ professional_id: pro.id })
      .eq('client_id', clientId)
      .is('professional_id', null)

    const { error: cErr, config: nextConfig } = await mergeClientConfig(clientId, fresh => ({
      ...fresh,
      modo_empresa: true,
      empresa: {
        ...(fresh.empresa ?? {}),
        nombre: nombre.trim(), rut: rut.trim(), direccion: direccion.trim(),
        telefono: telefono.trim(), email: emailC.trim(), logo_url: logoUrl,
      },
    }))
    setSaving(false)
    if (cErr) { setErr(cErr.message); return }
    setConfig(nextConfig)
    onActivated(pro.full_name)
  }

  const canNext1 = !!nombre.trim()

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 720 }}>
      <SettingsHeader
        title={step === 1 ? 'Datos del centro' : 'Crear primer profesional'}
        subtitle={`Paso ${step} de 2 · Activar modo empresa`}
      />

      {step === 1 ? (
        <>
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', marginBottom: 22 }}>
            <div onClick={() => logoRef.current?.click()} style={{
              width: 80, height: 80, borderRadius: 14,
              background: logoPreview ? T.bgSunk : T.primarySoft, color: T.primary,
              display: 'grid', placeItems: 'center', cursor: 'pointer', overflow: 'hidden',
              border: `1px solid ${T.line}`,
            }}>
              {logoPreview
                ? <img src={logoPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <Icon name="home" size={28} stroke={T.primary} />}
            </div>
            <input ref={logoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={pickLogo} />
            <div style={{ paddingTop: 8 }}>
              <div style={{ fontSize: 12, color: T.inkSoft, marginBottom: 6 }}>Logo del centro</div>
              <button style={btn('ghost')} onClick={() => logoRef.current?.click()}>
                <Icon name="download" size={13} /> Subir logo
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field2 label="Nombre del centro *">
              <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Centro psicológico …" style={textInput} />
            </Field2>
            <Field2 label="RUT del centro">
              <input value={rut}
                onChange={e => setRut(e.target.value)}
                onBlur={() => setRut(r => formatRut(r))}
                placeholder="76.123.456-7"
                style={{ ...textInput, fontFamily: T.mono }} />
            </Field2>
            <Field2 label="Teléfono">
              <input value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="+56 …" style={{ ...textInput, fontFamily: T.mono }} />
            </Field2>
            <Field2 label="Email de contacto">
              <input type="email" value={emailC} onChange={e => setEmailC(e.target.value)} placeholder="contacto@centro.cl" style={textInput} />
            </Field2>
          </div>
          <div style={{ marginTop: 14 }}>
            <Field2 label="Dirección">
              <input value={direccion} onChange={e => setDireccion(e.target.value)} placeholder="Av. …, Santiago" style={textInput} />
            </Field2>
          </div>

          <div style={{ marginTop: 28, display: 'flex', justifyContent: 'space-between' }}>
            <button style={btn('ghost')} onClick={onCancel}>Cancelar</button>
            <button
              style={{ ...btn('primary'), opacity: canNext1 ? 1 : 0.5, cursor: canNext1 ? 'pointer' : 'not-allowed' }}
              disabled={!canNext1}
              onClick={() => setStep(2)}
            >Siguiente</button>
          </div>
        </>
      ) : (
        <>
          <div style={{ marginBottom: 18, padding: 12, background: T.primarySoft, color: T.primary, borderRadius: 8, fontSize: 13, lineHeight: 1.5 }}>
            Antes de activar el modo empresa debes registrar al menos un profesional.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field2 label="Nombre completo *">
              <input value={proName} onChange={e => setProName(e.target.value)} placeholder="Dra. Paz Correa" style={textInput} />
            </Field2>
            <Field2 label="Email *">
              <input type="email" value={proEmail} onChange={e => setProEmail(e.target.value)} placeholder="paz@centro.cl" style={textInput} />
            </Field2>
          </div>

          <div style={{ marginTop: 14 }}>
            <Field2 label="Color">
              <div style={{ display: 'flex', gap: 8 }}>
                {PRO_COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setProColor(c)} style={{
                    width: 30, height: 30, borderRadius: '50%', cursor: 'pointer',
                    background: c, border: proColor === c ? `3px solid ${T.ink}` : `1px solid ${T.line}`,
                  }} />
                ))}
              </div>
            </Field2>
          </div>

          <div style={{ marginTop: 18 }}>
            <SectionLabel icon="calendar" label="Disponibilidad semanal" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {DAYS.map(([key, label]) => {
                const d = availability[key] ?? { start: '09:00', end: '18:00', available: false }
                return (
                  <div key={key} style={{
                    display: 'grid', gridTemplateColumns: '90px 60px 1fr 1fr', gap: 10,
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
          </div>

          {err && <div style={{ marginTop: 12, fontSize: 12, color: T.danger }}>{err}</div>}

          <div style={{ marginTop: 28, display: 'flex', justifyContent: 'space-between' }}>
            <button style={btn('ghost')} onClick={() => setStep(1)} disabled={saving}>← Atrás</button>
            <button style={btn('primary')} onClick={activate} disabled={saving}>
              {saving ? 'Activando…' : 'Activar modo empresa'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
