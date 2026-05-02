import React, { useState, useEffect, useContext } from 'react'
import { T, Icon, btn, SectionLabel } from '../shared.jsx'
import { ClientCtx } from '../../lib/ClientCtx.js'
import { supabase } from '../../lib/supabase.js'

const textInput = {
  padding: '10px 12px', borderRadius: 8,
  border: `1px solid ${T.line}`, background: T.bg,
  fontSize: 13, color: T.ink, width: '100%', outline: 'none',
  fontFamily: T.sans, boxSizing: 'border-box',
}

function SettingsHeader({ title, subtitle }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      marginBottom: 24, paddingBottom: 16, borderBottom: `1px solid ${T.lineSoft}`,
    }}>
      <div>
        <div style={{ fontFamily: T.serif, fontSize: 22, color: T.ink, lineHeight: 1 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: T.inkMuted, marginTop: 6 }}>{subtitle}</div>
      </div>
    </div>
  )
}

export default function ServiciosSesionesSettings() {
  const { clientId } = useContext(ClientCtx)
  const [rows, setRows]                 = useState([])
  const [originalRows, setOriginalRows] = useState([])
  const [loading, setLoading]           = useState(true)
  const [saving, setSaving]             = useState(false)
  const [toast, setToast]               = useState(null)

  async function fetchRows() {
    const { data, error } = await supabase
      .from('session_types')
      .select('id, name, price_amount, display_order')
      .eq('client_id', clientId)
      .eq('active', true)
      .order('display_order', { ascending: true })
      .order('created_at',    { ascending: true })
    if (error) {
      setToast({ kind: 'err', msg: 'Error al cargar servicios' })
      setLoading(false)
      return
    }
    const fresh = (data ?? []).map(r => ({
      id: r.id,
      name: r.name ?? '',
      price_amount: r.price_amount == null ? 0 : Number(r.price_amount),
    }))
    setRows(fresh)
    setOriginalRows(fresh.map(r => ({ ...r })))
    setLoading(false)
  }

  useEffect(() => {
    if (!clientId) return
    fetchRows()
  }, [clientId])

  // A row "blocks save" if invalid; "shows inline error" only after the user
  // has typed something — freshly-added empty rows don't shout, they just
  // wear a (nuevo) tag.
  function rowBlocksSave(row) {
    const name = (row.name ?? '').trim()
    if (name.length < 2) return true
    if (!(Number(row.price_amount) > 0)) return true
    return false
  }
  function rowVisibleError(row) {
    const name = (row.name ?? '').trim()
    if (name.length > 0 && name.length < 2) return 'Nombre mínimo 2 caracteres'
    const price = Number(row.price_amount)
    if (row.price_amount !== '' && row.price_amount != null && (Number.isNaN(price) || price < 0)) {
      return 'Precio inválido'
    }
    return null
  }
  const hasBlockers = rows.some(rowBlocksSave)

  function updateRow(idx, patch) {
    setRows(rs => rs.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }
  function removeRow(idx) {
    setRows(rs => rs.filter((_, i) => i !== idx))
  }
  function addRow() {
    setRows(rs => [...rs, { name: '', price_amount: '' }])
  }

  async function save() {
    if (hasBlockers || saving) return
    setSaving(true)
    setToast(null)

    const currentIds = new Set(rows.filter(r => r.id).map(r => r.id))
    const toDelete   = originalRows.filter(o => !currentIds.has(o.id))
    const toInsert   = rows.map((r, idx) => ({ ...r, _idx: idx })).filter(r => !r.id)
    const toUpdate   = rows.map((r, idx) => ({ ...r, _idx: idx }))
      .filter(r => r.id)
      .filter(r => {
        const orig    = originalRows.find(o => o.id === r.id)
        const origIdx = originalRows.findIndex(o => o.id === r.id)
        if (!orig) return false
        return r.name.trim() !== orig.name
            || Number(r.price_amount) !== Number(orig.price_amount)
            || r._idx !== origIdx
      })

    function isDupErr(err) {
      return err?.code === '23505' || /duplicate|unique/i.test(err?.message ?? '')
    }
    async function failAndReload(prefix, err) {
      setSaving(false)
      const msg = isDupErr(err) ? 'Ya existe un servicio con ese nombre' : `${prefix}: ${err?.message ?? 'error'}`
      setToast({ kind: 'err', msg })
      await fetchRows()
    }

    if (toDelete.length) {
      const { error } = await supabase
        .from('session_types')
        .delete()
        .in('id', toDelete.map(d => d.id))
      if (error) return failAndReload('Error al eliminar', error)
    }

    for (const r of toUpdate) {
      const { error } = await supabase
        .from('session_types')
        .update({
          name:          r.name.trim(),
          price_amount:  Number(r.price_amount),
          display_order: r._idx,
        })
        .eq('id', r.id)
      if (error) return failAndReload('Error al actualizar', error)
    }

    if (toInsert.length) {
      const inserts = toInsert.map(r => ({
        client_id:      clientId,
        name:           r.name.trim(),
        price_amount:   Number(r.price_amount),
        price_currency: 'CLP',
        active:         true,
        display_order:  r._idx,
      }))
      const { error } = await supabase.from('session_types').insert(inserts)
      if (error) return failAndReload('Error al guardar', error)
    }

    await fetchRows()
    setSaving(false)
    setToast({ kind: 'ok', msg: '✓ Servicios actualizados' })
    setTimeout(() => setToast(null), 2500)
  }

  if (loading) {
    return (
      <div style={{ padding: '24px 32px 40px', maxWidth: 880 }}>
        <SettingsHeader title="Servicios y Sesiones" subtitle="Catálogo de servicios y precios del centro" />
        <div style={{ padding: 40, color: T.inkMuted, fontStyle: 'italic', fontFamily: T.serif, textAlign: 'center' }}>
          Cargando…
        </div>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div style={{ padding: '24px 32px 40px', maxWidth: 880 }}>
        <SettingsHeader title="Servicios y Sesiones" subtitle="Catálogo de servicios y precios del centro" />
        <div style={{
          marginTop: 4, padding: 60,
          background: T.bgRaised, border: `1px solid ${T.line}`, borderRadius: 12,
          textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: T.primarySoft, color: T.primary, display: 'grid', placeItems: 'center',
          }}>
            <Icon name="briefcase" size={26} stroke={T.primary} />
          </div>
          <div style={{ fontSize: 14, color: T.ink, fontFamily: T.serif, fontStyle: 'italic' }}>
            Aún no hay servicios definidos
          </div>
          <button style={btn('primary')} onClick={addRow}>
            <Icon name="plus" size={13} stroke={T.primaryText} /> Agregar primero
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 880 }}>
      <SettingsHeader title="Servicios y Sesiones" subtitle="Catálogo de servicios y precios del centro" />

      <div style={{ marginTop: 4, marginBottom: 14 }}>
        <SectionLabel icon="briefcase" label={`Servicios (${rows.length})`} />
      </div>

      <div style={{ background: T.bgRaised, border: `1px solid ${T.line}`, borderRadius: 12, overflow: 'hidden' }}>
        {rows.map((r, idx) => {
          const err   = rowVisibleError(r)
          const isNew = !r.id
          const nameInvalid  = (r.name ?? '').trim().length > 0 && (r.name ?? '').trim().length < 2
          const priceInvalid = r.price_amount !== '' && r.price_amount != null && Number(r.price_amount) < 0
          return (
            <div key={r.id ?? `new-${idx}`} style={{
              padding: '14px 18px',
              borderBottom: idx < rows.length - 1 ? `1px solid ${T.lineSoft}` : 'none',
              background: isNew ? T.primarySoft : 'transparent',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px 32px', gap: 10, alignItems: 'center' }}>
                <input
                  value={r.name ?? ''}
                  onChange={e => updateRow(idx, { name: e.target.value })}
                  placeholder="Ej: Sesión individual"
                  disabled={saving}
                  style={{
                    ...textInput,
                    border: `1px solid ${nameInvalid ? T.danger : T.line}`,
                  }}
                />
                <div style={{
                  ...textInput,
                  display: 'flex', alignItems: 'center', gap: 6,
                  border: `1px solid ${priceInvalid ? T.danger : T.line}`,
                }}>
                  <span style={{ color: T.inkMuted }}>$</span>
                  <input
                    type="number"
                    min="0"
                    value={r.price_amount ?? ''}
                    onChange={e => updateRow(idx, { price_amount: e.target.value === '' ? '' : Number(e.target.value) })}
                    placeholder="45000"
                    disabled={saving}
                    style={{ border: 'none', outline: 'none', background: 'transparent', fontFamily: T.mono, width: '100%', padding: 0 }}
                  />
                  <span style={{ color: T.inkMuted, fontSize: 11 }}>CLP</span>
                </div>
                <button
                  onClick={() => removeRow(idx)}
                  disabled={saving}
                  title="Eliminar"
                  style={{ background: 'transparent', border: 'none', cursor: saving ? 'not-allowed' : 'pointer', color: T.inkMuted, padding: 4 }}
                ><Icon name="x" size={14} stroke={T.inkMuted} /></button>
              </div>
              {(err || isNew) && (
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, fontSize: 11 }}>
                  {err && <span style={{ color: T.danger }}>{err}</span>}
                  {isNew && !err && <span style={{ color: T.primary, fontWeight: 500, letterSpacing: 0.3 }}>(nuevo)</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 12 }}>
        <button style={btn('ghost')} onClick={addRow} disabled={saving}>
          <Icon name="plus" size={13} /> Agregar servicio
        </button>
      </div>

      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
        {toast?.kind === 'ok'  && <span style={{ fontSize: 12, color: T.confirmado }}>{toast.msg}</span>}
        {toast?.kind === 'err' && <span style={{ fontSize: 12, color: T.danger }}>{toast.msg}</span>}
        <button
          style={{ ...btn('primary'), opacity: hasBlockers || saving ? 0.5 : 1, cursor: hasBlockers || saving ? 'not-allowed' : 'pointer' }}
          onClick={save}
          disabled={hasBlockers || saving}
        >
          {saving ? 'Guardando…' : 'Guardar configuración'}
        </button>
      </div>
    </div>
  )
}
