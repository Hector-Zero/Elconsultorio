import React, { useState } from 'react'
import { supabase } from './lib/supabase.js'
import { T } from './screens/shared.jsx'

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState(null)
  const [loading, setLoading]   = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  const field = {
    padding: '10px 12px', borderRadius: 8,
    border: `1px solid ${T.line}`, background: T.bg,
    fontSize: 13, color: T.ink, width: '100%', outline: 'none',
    fontFamily: T.sans, boxSizing: 'border-box',
  }

  return (
    <div style={{
      height: '100vh', background: T.bgSunk,
      display: 'grid', placeItems: 'center',
      fontFamily: T.sans,
    }}>
      <div style={{
        width: 380,
        background: T.bgRaised, borderRadius: 14,
        border: `1px solid ${T.line}`,
        boxShadow: '0 8px 40px rgba(20,18,14,0.1)',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '28px 32px 24px', borderBottom: `1px solid ${T.lineSoft}`, background: T.bg }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: T.primary, color: T.primaryText,
              display: 'grid', placeItems: 'center',
              fontFamily: T.serif, fontSize: 20, fontStyle: 'italic', lineHeight: 1,
            }}>c</div>
            <span style={{ fontFamily: T.serif, fontSize: 20, color: T.ink, fontStyle: 'italic' }}>elconsultorio</span>
          </div>
          <h1 style={{
            fontFamily: T.serif, fontSize: 28, fontWeight: 400,
            color: T.ink, margin: 0, lineHeight: 1,
          }}>Iniciar sesión</h1>
          <p style={{ fontSize: 12.5, color: T.inkMuted, marginTop: 6, margin: '6px 0 0' }}>
            Accede a tu panel de gestión
          </p>
        </div>

        <form onSubmit={submit} style={{ padding: '24px 32px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, color: T.inkMuted, letterSpacing: 0.4, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
              Email
            </label>
            <input
              type="email" required autoFocus
              value={email} onChange={e => setEmail(e.target.value)}
              style={field}
              placeholder="tu@email.com"
            />
          </div>

          <div>
            <label style={{ fontSize: 11, color: T.inkMuted, letterSpacing: 0.4, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
              Contraseña
            </label>
            <input
              type="password" required
              value={password} onChange={e => setPassword(e.target.value)}
              style={field}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div style={{
              padding: '10px 12px', borderRadius: 8,
              background: T.dangerSoft, color: T.danger,
              fontSize: 12.5,
            }}>{error}</div>
          )}

          <button
            type="submit" disabled={loading}
            style={{
              marginTop: 4, padding: '11px 12px', borderRadius: 8,
              background: loading ? T.inkFaint : T.primary,
              color: T.primaryText, border: 'none',
              fontSize: 13.5, fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: T.sans,
            }}
          >
            {loading ? 'Iniciando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
