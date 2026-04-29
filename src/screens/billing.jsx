import React, { useState, useEffect, useContext, useMemo } from 'react'
import { T, Icon, Sidebar, Avatar, TopBar, btn, CLP } from './shared.jsx'
import { ClientCtx } from '../lib/ClientCtx.js'
import { supabase } from '../lib/supabase.js'

const TZ = 'America/Santiago'
const MONTHS = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
const fmtShortDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: TZ }))
  return `${String(d.getDate()).padStart(2,'0')} ${MONTHS[d.getMonth()]}`
}
const chileParts = (iso) => {
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: TZ }))
  return { y: d.getFullYear(), m: d.getMonth() }
}

const METHOD_LABEL = {
  mercado_pago:  'Mercado Pago',
  transferencia: 'Transferencia',
  efectivo:      'Efectivo',
  pendiente:     'Pendiente',
}

export default function BillingScreen({ onNavigate }) {
  const { clientId } = useContext(ClientCtx)
  const [tab, setTab]         = useState('boletas')
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (!clientId) return
    let alive = true
    setLoading(true)
    supabase
      .from('invoices')
      .select('id, lead_id, patient_id, amount, method, status, bsales_number, mp_payment_id, mp_link, description, issued_at, paid_at, created_at, patients(full_name)')
      .eq('client_id', clientId)
      .order('issued_at', { ascending: false })
      .then(({ data, error: e }) => {
        if (!alive) return
        if (e) setError(e.message)
        else setInvoices(data ?? [])
        setLoading(false)
      })
    return () => { alive = false }
  }, [clientId])

  const stats = useMemo(() => {
    const now = chileParts(new Date().toISOString())
    let receivedMonth = 0, monthCount = 0
    let outstanding = 0, outstandingCount = 0
    let receivedYTD = 0
    let paidSum = 0, paidCount = 0
    for (const inv of invoices) {
      const amt = Number(inv.amount ?? 0)
      const at  = inv.issued_at ? chileParts(inv.issued_at) : null
      if (inv.status === 'pagada') {
        paidSum += amt; paidCount++
        if (at && at.y === now.y) receivedYTD += amt
        if (at && at.y === now.y && at.m === now.m) { receivedMonth += amt; monthCount++ }
      } else if (inv.status === 'pendiente' || inv.status === 'vencida') {
        outstanding += amt; outstandingCount++
      }
    }
    const monthName = MONTHS[now.m]
    return {
      receivedMonth, monthCount, monthName,
      outstanding, outstandingCount,
      receivedYTD, year: now.y,
      avg: paidCount ? Math.round(paidSum / paidCount) : 0,
    }
  }, [invoices])

  const statusStyle = (s) => s === 'pagada'
    ? { bg: T.confirmadoSoft, fg: T.confirmado, label: 'Pagada' }
    : s === 'pendiente'
    ? { bg: T.warnSoft,       fg: T.warn,       label: 'Pendiente' }
    : { bg: T.dangerSoft,     fg: T.danger,     label: 'Vencida' }

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', background: T.bg, fontFamily: T.sans, color: T.ink }}>
      <Sidebar active="billing" onNavigate={onNavigate} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'auto' }}>
        <TopBar
          title="Facturación"
          subtitle="Boletas electrónicas · Mercado Pago · Transferencias"
          right={
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <BadgeDot color={T.confirmado} label="bsale conectado" />
              <BadgeDot color={T.confirmado} label="MP activo" />
              <button style={btn('ghost')}><Icon name="download" size={13} /> Exportar</button>
              <button style={btn('primary')}><Icon name="plus" size={14} stroke="#fff" /> Emitir boleta</button>
            </div>
          }
        />

        {error && (
          <div style={{ margin: '14px 24px 0', padding: '12px 14px', borderRadius: 10, background: T.dangerSoft, border: `1px solid ${T.line}`, fontSize: 12, color: T.danger }}>{error}</div>
        )}

        <div style={{ padding: '20px 24px 0', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <StatCard k="Recibido este mes" v={CLP(stats.receivedMonth)} sub={`${stats.monthCount} boletas · ${stats.monthName}`} color={T.primary} />
          <StatCard k="Por cobrar"        v={CLP(stats.outstanding)}   sub={`${stats.outstandingCount} boletas pendientes`} color={T.accent} />
          <StatCard k="Recibido YTD"      v={CLP(stats.receivedYTD)}   sub={`enero – ${stats.monthName} ${stats.year}`} />
          <StatCard k="Ticket promedio"   v={CLP(stats.avg)}           sub="por sesión" />
        </div>

        <div style={{ display: 'flex', gap: 24, padding: '20px 24px 0', borderBottom: `1px solid ${T.line}`, marginTop: 4 }}>
          {[
            { id: 'boletas',   label: 'Boletas' },
            { id: 'pagos',     label: 'Pagos Mercado Pago' },
            { id: 'recurrent', label: 'Cobros recurrentes' },
          ].map(t => {
            const on = tab === t.id
            return (
              <div key={t.id} onClick={() => setTab(t.id)} style={{
                fontSize: 13, fontWeight: on ? 500 : 400,
                color: on ? T.ink : T.inkMuted,
                paddingBottom: 12, cursor: 'pointer',
                borderBottom: on ? `2px solid ${T.primary}` : '2px solid transparent',
                marginBottom: -1,
              }}>{t.label}</div>
            )
          })}
        </div>

        {tab === 'boletas' && (
          <div style={{ padding: '20px 24px 40px' }}>
            <div style={{ background: T.bgRaised, border: `1px solid ${T.line}`, borderRadius: 12, overflow: 'hidden' }}>
              <div style={{
                padding: '12px 16px', display: 'grid',
                gridTemplateColumns: '70px 70px 1fr 120px 140px 110px 80px',
                gap: 12, alignItems: 'center',
                fontSize: 10.5, color: T.inkMuted, letterSpacing: 0.5, textTransform: 'uppercase',
                background: T.bgSunk, borderBottom: `1px solid ${T.line}`,
              }}>
                <div>Boleta</div><div>Fecha</div><div>Paciente</div>
                <div style={{ textAlign: 'right' }}>Monto</div>
                <div>Método</div><div>Estado</div><div />
              </div>

              {loading && (
                <div style={{ padding: 32, textAlign: 'center', color: T.inkMuted, fontFamily: T.serif, fontStyle: 'italic' }}>cargando boletas…</div>
              )}
              {!loading && invoices.length === 0 && (
                <div style={{ padding: 32, textAlign: 'center', color: T.inkMuted, fontFamily: T.serif, fontStyle: 'italic' }}>Sin boletas registradas todavía.</div>
              )}

              {invoices.map((inv, i) => {
                const ss = statusStyle(inv.status)
                const paid = inv.status === 'pagada'
                const name = inv.patients?.full_name ?? 'Sin nombre'
                const methodLabel = METHOD_LABEL[inv.method] ?? (inv.method ?? '—')
                return (
                  <div key={inv.id} style={{
                    padding: '14px 16px', display: 'grid',
                    gridTemplateColumns: '70px 70px 1fr 120px 140px 110px 80px',
                    gap: 12, alignItems: 'center',
                    borderBottom: i < invoices.length - 1 ? `1px solid ${T.lineSoft}` : 'none',
                    fontSize: 13,
                  }}>
                    <div style={{ fontFamily: T.mono, fontSize: 12, color: T.inkSoft }}>
                      {inv.bsales_number ? `#${inv.bsales_number}` : <span style={{ color: T.inkFaint }}>—</span>}
                    </div>
                    <div style={{ fontSize: 12, color: T.inkMuted, fontFamily: T.mono }}>{fmtShortDate(inv.issued_at)}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Avatar name={name} size={28} />
                      <span style={{ fontWeight: 500 }}>{name}</span>
                    </div>
                    <div style={{ textAlign: 'right', fontFamily: T.mono, color: T.ink, fontWeight: 500 }}>{CLP(inv.amount ?? 0)}</div>
                    <div style={{ fontSize: 12, color: T.inkSoft, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {inv.method === 'mercado_pago' && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00b1ea' }} />}
                      {methodLabel}
                    </div>
                    <div>
                      <span style={{ padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 500, background: ss.bg, color: ss.fg }}>{ss.label}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      {paid
                        ? <button style={{ ...btn('ghostSm'), fontSize: 11, padding: '4px 8px' }}><Icon name="download" size={11} /></button>
                        : <button style={{ ...btn('ghostSm'), fontSize: 11, padding: '4px 8px' }}>Emitir</button>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {tab === 'pagos'     && <ComingSoon icon="card"  title="Pagos Mercado Pago" />}
        {tab === 'recurrent' && <ComingSoon icon="clock" title="Cobros recurrentes" />}
      </div>
    </div>
  )
}

function ComingSoon({ icon, title }) {
  return (
    <div style={{ padding: '20px 24px 40px' }}>
      <div style={{
        background: T.bgRaised, border: `1px solid ${T.line}`, borderRadius: 12, padding: 40,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: T.inkMuted, fontSize: 13,
      }}>
        <Icon name={icon} size={28} stroke={T.inkMuted} />
        <div style={{ fontFamily: T.serif, fontSize: 20, color: T.ink }}>{title}</div>
        <div style={{ fontSize: 12, color: T.inkMuted, fontStyle: 'italic' }}>Próximamente</div>
      </div>
    </div>
  )
}

function StatCard({ k, v, sub, color }) {
  return (
    <div style={{ background: T.bgRaised, border: `1px solid ${T.line}`, borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 10.5, color: T.inkMuted, letterSpacing: 0.5, textTransform: 'uppercase' }}>{k}</div>
      <div style={{ fontFamily: T.serif, fontSize: 26, color: color || T.ink, lineHeight: 1, marginTop: 4 }}>{v}</div>
      <div style={{ fontSize: 11, color: T.inkMuted, marginTop: 4 }}>{sub}</div>
    </div>
  )
}

function BadgeDot({ color, label }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 10px', borderRadius: 999,
      background: T.bgSunk, border: `1px solid ${T.lineSoft}`,
      fontSize: 11, color: T.inkSoft,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {label}
    </div>
  )
}
