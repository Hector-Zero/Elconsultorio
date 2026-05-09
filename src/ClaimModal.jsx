import React, { useState, useContext } from 'react'
import { supabase } from './lib/supabase.js'
import { ClientCtx } from './lib/ClientCtx.js'
import { useClientBootstrap } from './lib/useClientBootstrap.js'
import { T, btn } from './screens/shared.jsx'

// Forced password-set modal for invited professionals on first login.
// Renders as a full-page blocking overlay (no Cancelar — the user must
// complete this step before they can reach the SPA).
//
// Triggered by App.jsx when `session.user.user_metadata.invite_pending`
// is true. After successful submit, supabase.auth.updateUser fires
// USER_UPDATED → onAuthStateChange in App.jsx → setSession reads the
// updated metadata (invite_pending: false) → this modal unmounts.

export default function ClaimModal({ session }) {
  // Read centro name for the greeting. ClientCtx may be null if the
  // bootstrap hasn't resolved yet (rare race), so fall back to bootstrap.
  const ctx = useContext(ClientCtx)
  const bootstrap = useClientBootstrap()
  const centroName = ctx?.session ? bootstrap.name : (bootstrap.name ?? null)

  const meta = session?.user?.user_metadata ?? {}
  const fullName = (meta.full_name ?? '').trim()

  const [password,        setPassword]        = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting,      setSubmitting]      = useState(false)
  const [error,           setError]           = useState(null)

  const headerTitle = centroName
    ? `Bienvenido a ${centroName}`
    : 'Activa tu cuenta'
  const greeting = fullName
    ? `Hola ${fullName}. Define tu contraseña para acceder a tu cuenta.`
    : 'Define tu contraseña para acceder a tu cuenta.'

  async function handleSubmit(e) {
    e?.preventDefault?.()
    setError(null)
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres')
      return
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden')
      return
    }
    setSubmitting(true)
    const { error: updErr } = await supabase.auth.updateUser({
      password,
      data: { invite_pending: false },
    })
    setSubmitting(false)
    if (updErr) {
      setError(`Error: ${updErr.message}`)
      return
    }
    // Success: USER_UPDATED event fires automatically via
    // onAuthStateChange in App.jsx, which re-reads the session and
    // sees invite_pending: false. The modal unmounts as a result.
  }

  const field = {
    padding: '10px 12px', borderRadius: 8,
    border: `1px solid ${T.line}`, background: T.bg,
    fontSize: 13, color: T.ink, width: '100%', outline: 'none',
    fontFamily: T.sans, boxSizing: 'border-box',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(20,18,14,0.4)',
      display: 'grid', placeItems: 'center', zIndex: 100,
      padding: 16,
    }}>
      <div style={{
        width: 420, maxWidth: '100%',
        background: T.bgRaised, borderRadius: 14,
        boxShadow: '0 24px 60px rgba(20,18,14,0.25)',
        overflow: 'hidden',
        fontFamily: T.sans,
      }}>
        <form onSubmit={handleSubmit}>
          <div style={{ padding: '22px 24px 6px' }}>
            <div style={{ fontFamily: T.serif, fontSize: 20, color: T.ink, lineHeight: 1.2 }}>
              {headerTitle}
            </div>
            <div style={{ marginTop: 10, fontSize: 13, color: T.inkSoft, lineHeight: 1.5 }}>
              {greeting}
            </div>
          </div>

          <div style={{ padding: '18px 24px 6px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{
                fontSize: 11, color: T.inkMuted, letterSpacing: 0.4,
                textTransform: 'uppercase', display: 'block', marginBottom: 6,
              }}>Contraseña</label>
              <input
                type="password"
                required
                autoFocus
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={field}
                placeholder="Mínimo 8 caracteres"
                disabled={submitting}
              />
            </div>

            <div>
              <label style={{
                fontSize: 11, color: T.inkMuted, letterSpacing: 0.4,
                textTransform: 'uppercase', display: 'block', marginBottom: 6,
              }}>Confirmar contraseña</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                style={field}
                placeholder="Repite la contraseña"
                disabled={submitting}
              />
            </div>

            {error && (
              <div style={{
                padding: '10px 12px', borderRadius: 8,
                background: T.dangerSoft, color: T.danger,
                fontSize: 12.5,
              }}>{error}</div>
            )}
          </div>

          <div style={{
            padding: '18px 24px 18px',
            display: 'flex', justifyContent: 'flex-end',
          }}>
            <button
              type="submit"
              disabled={submitting}
              style={{
                ...btn('primary'),
                minWidth: 160,
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? 'Activando…' : 'Activar cuenta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
