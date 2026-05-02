import React, { useState, useEffect } from 'react'
import { T, Icon } from '../shared.jsx'
import { supabase } from '../../lib/supabase.js'

const DOC_BUCKET = 'professional-documents'
const DOC_MAX_BYTES = 10 * 1024 * 1024
const DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png']

const DOC_TYPE_OPTIONS = [
  { value: 'certificate', label: 'Certificado' },
  { value: 'license',     label: 'Licencia' },
  { value: 'diploma',     label: 'Diploma' },
  { value: 'other',       label: 'Otro' },
]

const textInput = {
  padding: '8px 10px', borderRadius: 6,
  border: `1px solid ${T.line}`, background: T.bg,
  fontSize: 13, color: T.ink, width: '100%', outline: 'none',
  fontFamily: T.sans, boxSizing: 'border-box',
}

function safeName(name) {
  return (name ?? 'file').replace(/[^a-z0-9.\-_]/gi, '_').slice(0, 120)
}

function docTypeLabel(t) {
  return DOC_TYPE_OPTIONS.find(o => o.value === t)?.label ?? t ?? '—'
}

export default function DocumentsSection({ professionalId, disabled }) {
  const [docs, setDocs]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [error, setError]       = useState(null)

  async function fetchDocs() {
    if (!professionalId) {
      setDocs([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error: err } = await supabase
      .from('professional_documents')
      .select('id, doc_type, title, file_url, file_path, issuer, issued_date, display_on_profile, display_order')
      .eq('professional_id', professionalId)
      .order('display_order', { ascending: true })
      .order('created_at',    { ascending: true })
    if (err) {
      setError(`Error al cargar documentos: ${err.message}`)
      setLoading(false)
      return
    }
    setDocs(data ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchDocs() }, [professionalId])

  async function deleteDoc(doc) {
    setError(null)
    // Storage first; if it fails, surface but still try to remove the row so
    // we don't leave a phantom file_url pointing nowhere.
    if (doc.file_path) {
      const { error: storErr } = await supabase.storage.from(DOC_BUCKET).remove([doc.file_path])
      if (storErr) {
        setError(`No se pudo borrar el archivo: ${storErr.message}`)
      }
    }
    const { error: dbErr } = await supabase
      .from('professional_documents')
      .delete()
      .eq('id', doc.id)
    if (dbErr) {
      setError(`Error al eliminar: ${dbErr.message}`)
      return
    }
    setDocs(list => list.filter(d => d.id !== doc.id))
  }

  async function toggleProfile(doc) {
    const next = !doc.display_on_profile
    const prev = docs
    setDocs(list => list.map(d => d.id === doc.id ? { ...d, display_on_profile: next } : d))
    const { error: err } = await supabase
      .from('professional_documents')
      .update({ display_on_profile: next })
      .eq('id', doc.id)
    if (err) {
      setError(`No se pudo actualizar: ${err.message}`)
      setDocs(prev)
    }
  }

  async function move(idx, dir) {
    const j = idx + dir
    if (j < 0 || j >= docs.length) return
    const a = docs[idx], b = docs[j]
    const next = [...docs]
    next[idx] = b
    next[j]   = a
    // Persist new display_order for all rows; cheap and consistent.
    setDocs(next)
    const updates = next.map((d, i) =>
      supabase.from('professional_documents').update({ display_order: i }).eq('id', d.id)
    )
    const results = await Promise.all(updates)
    const failed = results.find(r => r.error)
    if (failed) setError(`No se pudo reordenar: ${failed.error.message}`)
  }

  async function addDoc(form) {
    setError(null)
    if (!professionalId) {
      setError('Guarda primero el profesional para subir documentos')
      return false
    }
    if (!form.title.trim()) { setError('Título requerido'); return false }
    if (!form.file)         { setError('Archivo requerido'); return false }
    if (!DOC_TYPES.includes(form.file.type)) { setError('Formato no permitido (PDF, JPG, PNG)'); return false }
    if (form.file.size > DOC_MAX_BYTES)      { setError('Archivo excede 10 MB'); return false }

    const path = `${professionalId}/${Date.now()}_${safeName(form.file.name)}`
    const { error: upErr } = await supabase.storage
      .from(DOC_BUCKET)
      .upload(path, form.file, { upsert: false, contentType: form.file.type })
    if (upErr) { setError(`Error al subir: ${upErr.message}`); return false }
    const { data: pub } = supabase.storage.from(DOC_BUCKET).getPublicUrl(path)

    const insertRow = {
      professional_id:    professionalId,
      doc_type:           form.doc_type,
      title:              form.title.trim(),
      file_url:           pub.publicUrl,
      file_path:          path,
      issuer:             form.issuer.trim() || null,
      issued_date:        form.issued_date || null,
      display_on_profile: form.display_on_profile,
      display_order:      docs.length,
    }
    const { data, error: dbErr } = await supabase
      .from('professional_documents')
      .insert(insertRow)
      .select()
      .single()
    if (dbErr) {
      // Roll back the upload so we don't leave an orphan blob.
      await supabase.storage.from(DOC_BUCKET).remove([path])
      setError(`Error al guardar documento: ${dbErr.message}`)
      return false
    }
    setDocs(list => [...list, data])
    return true
  }

  if (!professionalId) {
    return (
      <div style={{
        padding: 18, background: T.bgSunk, border: `1px dashed ${T.line}`, borderRadius: 10,
        fontSize: 12.5, color: T.inkMuted, fontStyle: 'italic',
      }}>
        Guarda primero el profesional para subir documentos.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && (
        <div style={{
          padding: '8px 12px', borderRadius: 6, background: T.dangerSoft, color: T.danger,
          fontSize: 12, lineHeight: 1.4,
        }}>{error}</div>
      )}

      {loading ? (
        <div style={{ padding: 18, color: T.inkMuted, fontStyle: 'italic', fontSize: 12.5 }}>Cargando…</div>
      ) : docs.length === 0 && !showForm ? (
        <div style={{
          padding: 22, background: T.bgSunk, border: `1px dashed ${T.line}`, borderRadius: 10,
          fontSize: 12.5, color: T.inkMuted, fontStyle: 'italic', textAlign: 'center',
        }}>
          Aún no hay documentos cargados.
        </div>
      ) : (
        <div style={{ background: T.bgRaised, border: `1px solid ${T.line}`, borderRadius: 10, overflow: 'hidden' }}>
          {docs.map((d, idx) => (
            <div key={d.id} style={{
              padding: '12px 14px',
              display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center',
              borderBottom: idx < docs.length - 1 ? `1px solid ${T.lineSoft}` : 'none',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, color: T.ink, fontWeight: 500 }}>{d.title}</span>
                  <span style={{
                    fontSize: 10.5, padding: '2px 8px', borderRadius: 999,
                    background: T.primarySoft, color: T.primary, letterSpacing: 0.3, fontWeight: 500,
                  }}>{docTypeLabel(d.doc_type)}</span>
                  {!d.display_on_profile && (
                    <span style={{ fontSize: 10.5, color: T.inkFaint, fontStyle: 'italic' }}>oculto</span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: T.inkMuted, marginTop: 3 }}>
                  {d.issuer ?? 'Sin emisor'}{d.issued_date ? ` · ${d.issued_date}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <a
                  href={d.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Ver archivo"
                  style={{
                    display: 'grid', placeItems: 'center', width: 28, height: 28,
                    color: T.inkSoft, textDecoration: 'none', borderRadius: 6,
                  }}
                ><Icon name="download" size={14} stroke={T.inkSoft} /></a>
                <button
                  onClick={() => toggleProfile(d)}
                  disabled={disabled}
                  title={d.display_on_profile ? 'Ocultar del perfil público' : 'Mostrar en perfil público'}
                  style={iconBtn(disabled)}
                ><Icon name={d.display_on_profile ? 'check' : 'x'} size={14} stroke={d.display_on_profile ? T.confirmado : T.inkMuted} /></button>
                <button
                  onClick={() => move(idx, -1)}
                  disabled={disabled || idx === 0}
                  title="Subir"
                  style={iconBtn(disabled || idx === 0)}
                ><Icon name="chevronU" size={14} stroke={T.inkSoft} /></button>
                <button
                  onClick={() => move(idx, 1)}
                  disabled={disabled || idx === docs.length - 1}
                  title="Bajar"
                  style={iconBtn(disabled || idx === docs.length - 1)}
                ><Icon name="chevronD" size={14} stroke={T.inkSoft} /></button>
                <button
                  onClick={() => deleteDoc(d)}
                  disabled={disabled}
                  title="Eliminar"
                  style={iconBtn(disabled)}
                ><Icon name="x" size={14} stroke={T.inkMuted} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm ? (
        <AddDocForm
          onSubmit={async form => { const ok = await addDoc(form); if (ok) setShowForm(false) }}
          onCancel={() => { setShowForm(false); setError(null) }}
          disabled={disabled}
        />
      ) : (
        <button
          onClick={() => setShowForm(true)}
          disabled={disabled}
          style={{
            alignSelf: 'flex-start',
            background: 'transparent', border: `1px solid ${T.line}`,
            cursor: disabled ? 'not-allowed' : 'pointer', borderRadius: 8,
            padding: '8px 12px', fontSize: 12.5, color: T.inkSoft, fontFamily: T.sans,
            display: 'flex', alignItems: 'center', gap: 6,
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <Icon name="plus" size={13} /> Agregar documento
        </button>
      )}
    </div>
  )
}

function iconBtn(disabled) {
  return {
    width: 28, height: 28, display: 'grid', placeItems: 'center',
    background: 'transparent', border: 'none', borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
  }
}

function AddDocForm({ onSubmit, onCancel, disabled }) {
  const [title, setTitle]                   = useState('')
  const [docType, setDocType]               = useState('certificate')
  const [issuer, setIssuer]                 = useState('')
  const [issuedDate, setIssuedDate]         = useState('')
  const [file, setFile]                     = useState(null)
  const [displayOnProfile, setDisplayOnProfile] = useState(true)
  const [submitting, setSubmitting]         = useState(false)

  async function submit() {
    setSubmitting(true)
    await onSubmit({
      title,
      doc_type: docType,
      issuer,
      issued_date: issuedDate,
      file,
      display_on_profile: displayOnProfile,
    })
    setSubmitting(false)
  }

  return (
    <div style={{
      padding: 16, borderRadius: 10,
      background: T.bgSunk, border: `1px solid ${T.line}`,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 10 }}>
        <div>
          <Label>Título *</Label>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ej: Certificado de psicólogo clínico"
                 style={textInput} disabled={submitting} />
        </div>
        <div>
          <Label>Tipo</Label>
          <select value={docType} onChange={e => setDocType(e.target.value)} style={textInput} disabled={submitting}>
            {DOC_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 10 }}>
        <div>
          <Label>Emisor</Label>
          <input value={issuer} onChange={e => setIssuer(e.target.value)} placeholder="Universidad de Chile"
                 style={textInput} disabled={submitting} />
        </div>
        <div>
          <Label>Fecha de emisión</Label>
          <input type="date" value={issuedDate} onChange={e => setIssuedDate(e.target.value)}
                 style={textInput} disabled={submitting} />
        </div>
      </div>
      <div>
        <Label>Archivo *</Label>
        <input
          type="file"
          accept={DOC_TYPES.join(',')}
          onChange={e => setFile(e.target.files?.[0] ?? null)}
          disabled={submitting}
          style={{ fontSize: 12, color: T.inkSoft, fontFamily: T.sans }}
        />
        <div style={{ fontSize: 10.5, color: T.inkMuted, marginTop: 4 }}>PDF, JPG o PNG. Máx 10 MB.</div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: T.inkSoft, cursor: 'pointer' }}>
        <input type="checkbox" checked={displayOnProfile}
               onChange={e => setDisplayOnProfile(e.target.checked)}
               disabled={submitting} />
        Mostrar en perfil público
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button
          onClick={onCancel}
          disabled={submitting}
          style={{
            padding: '7px 14px', borderRadius: 6, fontSize: 12.5,
            background: 'transparent', border: `1px solid ${T.line}`,
            color: T.inkSoft, fontFamily: T.sans,
            cursor: submitting ? 'not-allowed' : 'pointer',
          }}
        >Cancelar</button>
        <button
          onClick={submit}
          disabled={submitting || disabled}
          style={{
            padding: '7px 14px', borderRadius: 6, fontSize: 12.5,
            background: T.primary, color: T.primaryText,
            border: '1px solid transparent', fontFamily: T.sans,
            cursor: submitting ? 'not-allowed' : 'pointer',
            opacity: submitting ? 0.7 : 1,
          }}
        >{submitting ? 'Subiendo…' : 'Subir'}</button>
      </div>
    </div>
  )
}

function Label({ children }) {
  return (
    <div style={{
      fontSize: 11, color: T.inkMuted, marginBottom: 4,
      letterSpacing: 0.4, textTransform: 'uppercase',
    }}>{children}</div>
  )
}
