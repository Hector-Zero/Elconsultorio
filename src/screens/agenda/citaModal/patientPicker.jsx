import React from 'react'
import { T, Icon } from '../../shared.jsx'
import { Label, inputStyle, monoInput } from './_shared.jsx'

export default function PatientPicker({
  isEdit, appt, selectedPat,
  patientId, setPatientId,
  patientMode, setPatientMode,
  patientSearch, setPatientSearch,
  searchOpen, setSearchOpen,
  newPt, setNewPt,
  filteredPatients, pickPatient, clearPatient,
  searchRef,
}) {
  return isEdit ? (
    (() => {
      // Prefer the joined patients row from the appointment payload;
      // fall back to the catalog if the join was empty.
      const ptInfo = appt?.patients ?? selectedPat ?? null
      const meta   = ptInfo
        ? [ptInfo.rut, ptInfo.email, ptInfo.phone].filter(Boolean).join(' · ')
        : ''
      return (
        <div>
          <Label>Paciente</Label>
          <div style={{
            padding: '10px 12px', borderRadius: 8,
            background: T.bgSunk, border: `1px solid ${T.line}`,
          }}>
            <div style={{ fontSize: 14, color: T.ink, fontWeight: 500 }}>
              {ptInfo?.full_name ?? '— sin paciente —'}
            </div>
            {meta && (
              <div style={{ fontSize: 11.5, color: T.inkMuted, marginTop: 3 }}>{meta}</div>
            )}
          </div>
        </div>
      )
    })()
  ) : (
    <div>
      <Label>Paciente *</Label>
      <div style={{
        display: 'flex', gap: 6, marginBottom: 8,
        background: T.bgSunk, borderRadius: 8, padding: 2, border: `1px solid ${T.line}`,
      }}>
        {[['existing', 'Buscar paciente'], ['new', '+ Crear nuevo']].map(([k, label]) => (
          <button key={k} type="button" onClick={() => setPatientMode(k)} style={{
            flex: 1, border: 'none', background: patientMode === k ? T.bgRaised : 'transparent',
            color: patientMode === k ? T.ink : T.inkMuted,
            padding: '7px 10px', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer',
          }}>{label}</button>
        ))}
      </div>

      {patientMode === 'existing' ? (
        <div ref={searchRef} style={{ position: 'relative' }}>
          <input
            value={patientSearch || (selectedPat?.full_name ?? '')}
            onChange={e => { setPatientSearch(e.target.value); setSearchOpen(true); if (selectedPat) setPatientId('') }}
            onFocus={() => setSearchOpen(true)}
            placeholder="Buscar por nombre, RUT o email…"
            style={inputStyle}
          />
          {selectedPat && !searchOpen && (
            <button
              onClick={clearPatient}
              title="Cambiar paciente"
              style={{
                position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: T.inkMuted, padding: 6,
              }}
            ><Icon name="x" size={13} stroke={T.inkMuted} /></button>
          )}
          {searchOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
              background: T.bgRaised, border: `1px solid ${T.line}`, borderRadius: 8,
              boxShadow: '0 8px 24px rgba(20,18,14,0.16)', maxHeight: 240, overflow: 'auto', zIndex: 10,
            }}>
              {filteredPatients.length === 0 ? (
                <div style={{ padding: '10px 12px', fontSize: 12.5, color: T.inkMuted, fontStyle: 'italic' }}>
                  Sin resultados. Cambia a "Crear nuevo" para agregar.
                </div>
              ) : filteredPatients.map(p => (
                <div
                  key={p.id}
                  onClick={() => pickPatient(p)}
                  style={{
                    padding: '8px 12px', fontSize: 12.5, cursor: 'pointer',
                    borderBottom: `1px solid ${T.lineSoft}`,
                    background: p.id === patientId ? T.bgSunk : 'transparent',
                  }}
                >
                  <div style={{ color: T.ink, fontWeight: 500 }}>{p.full_name}</div>
                  <div style={{ fontSize: 11, color: T.inkMuted, marginTop: 2 }}>
                    {[p.rut, p.email, p.phone].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{
          padding: 12, borderRadius: 8, background: T.bgSunk, border: `1px solid ${T.line}`,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div>
            <Label>Nombre completo *</Label>
            <input
              value={newPt.full_name}
              onChange={e => setNewPt(p => ({ ...p, full_name: e.target.value }))}
              placeholder="Ej: María Pérez"
              style={inputStyle}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <Label>RUT</Label>
              <input value={newPt.rut} onChange={e => setNewPt(p => ({ ...p, rut: e.target.value }))} placeholder="12.345.678-9" style={monoInput} />
            </div>
            <div>
              <Label>Teléfono</Label>
              <input value={newPt.phone} onChange={e => setNewPt(p => ({ ...p, phone: e.target.value }))} placeholder="+56 9 …" style={monoInput} />
            </div>
          </div>
          <div>
            <Label>Email</Label>
            <input type="email" value={newPt.email} onChange={e => setNewPt(p => ({ ...p, email: e.target.value }))} placeholder="correo@ejemplo.cl" style={inputStyle} />
          </div>
          <div>
            <Label>Dirección</Label>
            <input value={newPt.address} onChange={e => setNewPt(p => ({ ...p, address: e.target.value }))} placeholder="Av. … 1234, Comuna" style={inputStyle} />
          </div>
        </div>
      )}
    </div>
  )
}
