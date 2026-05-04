import React, { useState, useEffect, useContext } from 'react'
import { T, Icon, btn } from '../shared.jsx'
import { ClientCtx } from '../../lib/ClientCtx.js'
import { supabase } from '../../lib/supabase.js'
import { mergeClientConfig, fetchClientConfig } from '../../lib/clientConfig.js'
import { SettingsHeader, FieldRow, textInput, formatRut } from './_shared.jsx'
import EmpresaWizard from './empresaWizard.jsx'

// ───── Empresa — modo empresa wizard + active form ─────
export default function EmpresaSettings({ onActivated, onNavigate }) {
  const { clientId, config, setConfig } = useContext(ClientCtx)
  const [wizard, setWizard] = useState(false)
  const [banner, setBanner] = useState(null) // { proName }
  // Fetch fresh config on mount so the CTA-vs-active decision uses DB truth,
  // not a stale context snapshot. Sync the result back into context so other
  // tabs see it too.
  const [freshConfig, setFreshConfig] = useState(config)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (!clientId) return
    let alive = true
    fetchClientConfig(clientId).then(({ config: fresh, error }) => {
      console.log('[EmpresaSettings] fresh fetch:', {
        error,
        modo_empresa: fresh?.modo_empresa,
        empresa_nombre: fresh?.empresa?.nombre,
        empresa_keys: fresh?.empresa ? Object.keys(fresh.empresa) : null,
        full_fresh: fresh,
      })
      if (!alive) return
      setFreshConfig(fresh)
      if (fresh) setConfig(fresh) // keep context in sync
      setLoaded(true)
    })
    return () => { alive = false }
  }, [clientId])

  if (!loaded) return (
    <div style={{ padding: 40, color: T.inkMuted, fontStyle: 'italic', fontFamily: T.serif }}>cargando…</div>
  )

  // Decision uses ONLY the freshly fetched Supabase value, never ClientCtx.
  const empresaMode = !!freshConfig?.modo_empresa
  console.log('[EmpresaSettings] render decision:', { empresaMode, willShowActiveForm: empresaMode })
  if (empresaMode) {
    return <EmpresaActiveForm banner={banner} onNavigate={onNavigate} />
  }
  if (wizard) {
    return (
      <EmpresaWizard
        onCancel={() => setWizard(false)}
        onActivated={(proName) => {
          setWizard(false)
          setBanner({ proName })
          onActivated?.()
        }}
      />
    )
  }
  return (
    <div style={{ padding: '60px 32px', maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
      <div style={{
        width: 72, height: 72, borderRadius: '50%',
        background: T.primarySoft, color: T.primary,
        display: 'grid', placeItems: 'center', margin: '0 auto 22px',
      }}>
        <Icon name="users" size={32} stroke={T.primary} />
      </div>
      <div style={{ fontFamily: T.serif, fontSize: 30, color: T.ink, lineHeight: 1.1 }}>
        ¿Tienes un equipo?
      </div>
      <div style={{ fontSize: 14, color: T.inkMuted, marginTop: 14, lineHeight: 1.55, maxWidth: 480, margin: '14px auto 0' }}>
        Activa el modo empresa para gestionar múltiples profesionales bajo un mismo centro o clínica.
      </div>
      <div style={{ marginTop: 28 }}>
        <button style={btn('primary')} onClick={() => setWizard(true)}>
          Activar modo empresa
        </button>
      </div>
    </div>
  )
}

function EmpresaActiveForm({ banner, onNavigate }) {
  const { clientId, config, setConfig } = useContext(ClientCtx)
  const [nombre, setNombre]       = useState(config?.empresa?.nombre ?? '')
  const [rut, setRut]             = useState(config?.empresa?.rut ?? '')
  const [direccion, setDireccion] = useState(config?.empresa?.direccion ?? '')
  const [telefono, setTelefono]   = useState(config?.empresa?.telefono ?? '')
  const [email, setEmail]         = useState(config?.empresa?.email ?? '')
  const [logoUrl, setLogoUrl]     = useState(config?.empresa?.logo_url ?? '')
  const [pendingFile, setPendingFile] = useState(null)
  const [saving, setSaving]       = useState(false)
  const [toast, setToast]         = useState(null)
  const fileRef = React.useRef(null)

  // Fetch fresh on mount so we don't render with a stale empresa snapshot.
  useEffect(() => {
    if (!clientId) return
    let alive = true
    fetchClientConfig(clientId).then(({ config: fresh }) => {
      if (!alive) return
      const e = fresh?.empresa ?? {}
      setNombre(e.nombre ?? ''); setRut(e.rut ?? ''); setDireccion(e.direccion ?? '')
      setTelefono(e.telefono ?? ''); setEmail(e.email ?? ''); setLogoUrl(e.logo_url ?? '')
      if (fresh) setConfig(fresh)
    })
    return () => { alive = false }
  }, [clientId])

  function pickLogo(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setPendingFile(f)
    setLogoUrl(URL.createObjectURL(f))
  }

  async function handleSave() {
    setSaving(true)
    let nextLogoUrl = logoUrl ?? ''
    if (pendingFile) {
      const ext  = (pendingFile.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${clientId}/logo.${ext}`
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, pendingFile, { upsert: true, contentType: pendingFile.type })
      if (!upErr) {
        const { data } = supabase.storage.from('avatars').getPublicUrl(path)
        nextLogoUrl = `${data.publicUrl}?t=${Date.now()}` // cache-bust
      }
    }
    // Read-modify-write merge against fresh DB state — preserves any field
    // another tab may have written (logo_url from the wizard, etc.).
    const { error, config: next } = await mergeClientConfig(clientId, fresh => ({
      ...fresh,
      empresa: {
        ...(fresh.empresa ?? {}),
        nombre: nombre.trim(), rut: rut.trim(), direccion: direccion.trim(),
        telefono: telefono.trim(), email: email.trim(), logo_url: nextLogoUrl,
      },
    }))
    setSaving(false)
    if (error) { setToast({ kind: 'err', msg: 'Error al guardar' }); return }
    setConfig(next)
    setLogoUrl(nextLogoUrl); setPendingFile(null)
    setToast({ kind: 'ok', msg: '✓ Guardado' })
    setTimeout(() => setToast(null), 2200)
  }

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 780 }}>
      <SettingsHeader title="Empresa" subtitle="Datos del centro o clínica" />

      {banner && (
        <div style={{
          marginBottom: 22, padding: '14px 16px', borderRadius: 10,
          background: T.primarySoft, color: T.primary, border: `1px solid ${T.primary}`,
          fontSize: 13, lineHeight: 1.5,
        }}>
          ✓ Modo empresa activado. Recuerda completar la información de <strong>{banner.proName}</strong> en Profesionales.
        </div>
      )}

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', marginBottom: 28 }}>
        <div onClick={() => fileRef.current?.click()} title="Cambiar logo" style={{
          width: 88, height: 88, borderRadius: 14,
          background: logoUrl ? T.bgSunk : T.primarySoft, color: T.primary,
          display: 'grid', placeItems: 'center', cursor: 'pointer', overflow: 'hidden',
          border: `1px solid ${T.line}`,
        }}>
          {logoUrl
            ? <img src={logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <Icon name="home" size={32} stroke={T.primary} />}
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={pickLogo} />
        <div style={{ flex: 1, paddingTop: 6 }}>
          <div style={{ fontSize: 13, color: T.inkSoft, marginBottom: 10 }}>Logo del centro</div>
          <button style={btn('ghost')} onClick={() => fileRef.current?.click()}>
            <Icon name="download" size={13} /> Subir logo
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <FieldRow label="Nombre del centro">
          <input value={nombre} onChange={e => setNombre(e.target.value)} style={textInput} />
        </FieldRow>
        <FieldRow label="RUT del centro">
          <input value={rut}
            onChange={e => setRut(e.target.value)}
            onBlur={() => setRut(r => formatRut(r))}
            placeholder="76.123.456-7"
            style={{ ...textInput, fontFamily: T.mono }} />
        </FieldRow>
        <FieldRow label="Teléfono">
          <input value={telefono} onChange={e => setTelefono(e.target.value)} style={{ ...textInput, fontFamily: T.mono }} />
        </FieldRow>
        <FieldRow label="Email de contacto">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={textInput} />
        </FieldRow>
      </div>
      <FieldRow label="Dirección">
        <input value={direccion} onChange={e => setDireccion(e.target.value)} style={textInput} />
      </FieldRow>

      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
        {toast?.kind === 'ok'  && <span style={{ fontSize: 12, color: T.confirmado }}>{toast.msg}</span>}
        {toast?.kind === 'err' && <span style={{ fontSize: 12, color: T.danger }}>{toast.msg}</span>}
        <button style={btn('primary')} onClick={handleSave} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <button style={btn('ghost')} onClick={() => onNavigate?.('professionals')}>
          Ir a Profesionales →
        </button>
      </div>
    </div>
  )
}
