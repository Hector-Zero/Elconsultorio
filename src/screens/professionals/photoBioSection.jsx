import React, { useState, useRef } from 'react'
import { T, Icon, btn, initials as nameInitials } from '../shared.jsx'
import { supabase } from '../../lib/supabase.js'

const textInput = {
  padding: '10px 12px', borderRadius: 8,
  border: `1px solid ${T.line}`, background: T.bg,
  fontSize: 13, color: T.ink, width: '100%', outline: 'none',
  fontFamily: T.sans, boxSizing: 'border-box',
}

const PHOTO_BUCKET = 'professional-photos'
const PHOTO_MAX_BYTES = 5 * 1024 * 1024
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function safeName(name) {
  return (name ?? 'file').replace(/[^a-z0-9.\-_]/gi, '_').slice(0, 120)
}

export default function PhotoBioSection({ value, onChange, professionalId, displayName, color, disabled }) {
  const v = value ?? {}
  const [hovering, setHovering]   = useState(false)
  const [dragOver, setDragOver]   = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError]         = useState(null)
  const [chip, setChip]           = useState('')
  const fileRef = useRef(null)

  const photoUrl = v.photo_url ?? ''

  function patch(p) { onChange({ ...v, ...p }) }

  async function uploadFile(file) {
    if (!file) return
    setError(null)
    if (!PHOTO_TYPES.includes(file.type)) {
      setError('Formato no permitido (JPG, PNG o WebP)')
      return
    }
    if (file.size > PHOTO_MAX_BYTES) {
      setError('La foto excede 5 MB')
      return
    }
    if (!professionalId) {
      setError('Guarda primero el profesional para subir foto')
      return
    }
    setUploading(true)
    const path = `${professionalId}/${Date.now()}_${safeName(file.name)}`
    const { error: upErr } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, file, { upsert: false, contentType: file.type })
    if (upErr) {
      setUploading(false)
      setError(`Error al subir: ${upErr.message}`)
      return
    }
    const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path)
    const url = `${data.publicUrl}?t=${Date.now()}`
    setUploading(false)
    patch({ photo_url: url, _photo_path: path })
  }

  async function removePhoto() {
    if (!photoUrl) return
    setError(null)
    // Try to delete the underlying object if we know its path. Otherwise just
    // null the URL — orphan blob is preferable to a dangling reference.
    const path = v._photo_path
    if (path) {
      await supabase.storage.from(PHOTO_BUCKET).remove([path])
    }
    patch({ photo_url: '', _photo_path: null })
  }

  function pickFile(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    uploadFile(f)
  }

  function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer?.files?.[0]
    uploadFile(f)
  }

  function addChip() {
    const t = chip.trim()
    if (!t) return
    const list = Array.isArray(v.specialties) ? v.specialties : []
    if (list.includes(t)) { setChip(''); return }
    patch({ specialties: [...list, t] })
    setChip('')
  }
  function removeChip(idx) {
    const list = Array.isArray(v.specialties) ? v.specialties : []
    patch({ specialties: list.filter((_, i) => i !== idx) })
  }

  const inits = nameInitials(displayName)
  const ringColor = color || T.primary
  const photoSize = 96
  const blockingMessage = !professionalId ? 'Guarda primero el profesional para subir foto' : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
        <div
          onClick={() => !disabled && !blockingMessage && fileRef.current?.click()}
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
          onDragOver={e => { e.preventDefault(); if (!disabled && !blockingMessage) setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={blockingMessage ? undefined : onDrop}
          title={blockingMessage ?? 'Cambiar foto'}
          style={{
            position: 'relative',
            width: photoSize, height: photoSize, borderRadius: '50%',
            background: photoUrl ? T.bgSunk : ringColor,
            color: '#fff',
            display: 'grid', placeItems: 'center',
            fontFamily: T.sans, fontSize: 32, fontWeight: 600,
            cursor: disabled || blockingMessage ? 'not-allowed' : 'pointer',
            overflow: 'hidden',
            border: dragOver ? `2px dashed ${T.primary}` : `1px solid ${T.line}`,
            opacity: disabled ? 0.5 : 1,
            flexShrink: 0,
          }}
        >
          {photoUrl
            ? <img src={photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : inits}
          {(hovering && !disabled && !blockingMessage) && (
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              background: 'rgba(20,18,14,0.55)', color: '#fff',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 4, fontSize: 11, fontWeight: 500, letterSpacing: 0.3,
            }}>
              <Icon name="download" size={18} stroke="#fff" />
              {uploading ? 'Subiendo…' : 'Cambiar foto'}
            </div>
          )}
        </div>
        <input ref={fileRef} type="file" accept={PHOTO_TYPES.join(',')} style={{ display: 'none' }} onChange={pickFile} />
        <div style={{ flex: 1, paddingTop: 4 }}>
          <div style={{ fontSize: 13, color: T.ink, fontWeight: 500, marginBottom: 4 }}>Foto de perfil</div>
          <div style={{ fontSize: 11.5, color: T.inkMuted, lineHeight: 1.5, marginBottom: 8 }}>
            Arrastra una imagen o haz click para subir. JPG, PNG o WebP, máx 5 MB.
          </div>
          {blockingMessage && (
            <div style={{ fontSize: 11.5, color: T.warn, marginBottom: 8, fontStyle: 'italic' }}>
              {blockingMessage}
            </div>
          )}
          {error && (
            <div style={{ fontSize: 11.5, color: T.danger, marginBottom: 8 }}>{error}</div>
          )}
          {photoUrl && !blockingMessage && (
            <button
              onClick={removePhoto}
              disabled={disabled}
              style={{
                background: 'transparent', border: `1px solid ${T.line}`,
                cursor: disabled ? 'not-allowed' : 'pointer',
                color: T.inkSoft, fontSize: 12, fontFamily: T.sans,
                padding: '5px 10px', borderRadius: 6,
              }}
            >Quitar foto</button>
          )}
        </div>
      </div>

      <div>
        <Label>Bio</Label>
        <textarea
          value={v.bio ?? ''}
          onChange={e => patch({ bio: e.target.value })}
          rows={3}
          placeholder="Breve descripción profesional…"
          disabled={disabled}
          style={{ ...textInput, resize: 'vertical', fontFamily: T.sans, lineHeight: 1.5 }}
        />
      </div>

      <div>
        <Label>Especialidades</Label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={chip}
            onChange={e => setChip(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addChip() } }}
            placeholder="Ansiedad, depresión, terapia de pareja…"
            disabled={disabled}
            style={{ ...textInput, flex: 1 }}
          />
          <button
            onClick={addChip}
            disabled={disabled || !chip.trim()}
            style={{
              ...btn('soft'),
              cursor: disabled || !chip.trim() ? 'not-allowed' : 'pointer',
              opacity: disabled || !chip.trim() ? 0.5 : 1,
            }}
          >
            <Icon name="plus" size={13} stroke={T.primary} />
            Agregar
          </button>
        </div>
        {(v.specialties?.length ?? 0) > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {v.specialties.map((s, i) => (
              <span key={`${s}-${i}`} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 4px 4px 10px', borderRadius: 999,
                background: T.primarySoft, color: T.primary,
                fontSize: 11.5, fontWeight: 500, letterSpacing: 0.1,
              }}>
                {s}
                <button
                  onClick={() => removeChip(i)}
                  disabled={disabled}
                  aria-label={`Quitar ${s}`}
                  style={{
                    background: 'transparent', border: 'none',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    color: T.primary, padding: 2, display: 'grid', placeItems: 'center',
                  }}
                ><Icon name="x" size={11} stroke={T.primary} /></button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 14 }}>
        <div>
          <Label>Educación</Label>
          <input
            value={v.education ?? ''}
            onChange={e => patch({ education: e.target.value })}
            placeholder="Magíster en Psicología Clínica, Universidad de Chile"
            disabled={disabled}
            style={textInput}
          />
        </div>
        <div>
          <Label>Años de experiencia</Label>
          <input
            type="number"
            min="0"
            value={v.years_experience ?? ''}
            onChange={e => patch({ years_experience: e.target.value === '' ? null : Math.max(0, parseInt(e.target.value, 10) || 0) })}
            placeholder="0"
            disabled={disabled}
            style={{ ...textInput, fontFamily: T.mono }}
          />
        </div>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '12px 14px', background: T.bgSunk, borderRadius: 8,
        border: `1px solid ${T.lineSoft}`,
      }}>
        <Toggle value={!!v.public_profile} onChange={x => patch({ public_profile: x })} disabled={disabled} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5, color: T.ink, fontWeight: 500 }}>Visible en página pública de reservas</div>
          <div style={{ fontSize: 11, color: T.inkMuted, marginTop: 2 }}>
            Cuando está activo, este profesional aparece en la página pública para tomar hora.
          </div>
        </div>
      </div>
    </div>
  )
}

function Label({ children }) {
  return (
    <div style={{
      fontSize: 11, color: T.inkMuted, marginBottom: 6,
      letterSpacing: 0.4, textTransform: 'uppercase',
    }}>{children}</div>
  )
}

function Toggle({ value, onChange, disabled }) {
  return (
    <div onClick={() => !disabled && onChange(!value)} style={{
      width: 38, height: 22, borderRadius: 999,
      cursor: disabled ? 'not-allowed' : 'pointer',
      background: value ? T.primary : T.line,
      position: 'relative', transition: 'background .15s',
      flexShrink: 0, opacity: disabled ? 0.5 : 1,
    }}>
      <div style={{
        position: 'absolute', top: 2, left: value ? 18 : 2,
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,.2)', transition: 'left .15s',
      }} />
    </div>
  )
}
