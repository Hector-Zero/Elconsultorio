import React, { useState, useEffect, useContext } from 'react'
import { T, Icon, btn, SectionLabel, applyTheme } from '../shared.jsx'
import { ClientCtx } from '../../lib/ClientCtx.js'
import { ClientConfigCtx } from '../../lib/ClientConfigCtx.js'
import { fetchClientConfig, mergeClientConfig } from '../../lib/clientConfig.js'
import { THEMES, DEFAULT_THEME_ID, getTheme } from '../../config/themes.js'
import { SettingsHeader } from './_shared.jsx'

// ───── Appearance — themes ─────
export default function AppearanceSettings() {
  const { clientId } = useContext(ClientCtx)
  const { config, setConfig } = useContext(ClientConfigCtx)

  // null = no card highlighted (no saved theme). A string = saved theme id.
  const [themeId, setThemeId] = useState(config?.theme_id ?? null)
  const [saving, setSaving]   = useState(false)
  const [toast, setToast]     = useState(null)

  // On-mount fetch:
  //   - If a theme is saved → highlight + apply it.
  //   - Else → apply the default light theme silently and leave themeId=null
  //     (no card highlighted) so the UI reflects "no saved preference".
  useEffect(() => {
    if (!clientId) return
    let alive = true
    fetchClientConfig(clientId).then(({ config: fresh, error }) => {
      console.log('[Apariencia mount] fetch result:', { error, theme_id: fresh?.theme_id })
      if (!alive) return
      if (fresh) setConfig(fresh)
      if (fresh?.theme_id) {
        setThemeId(fresh.theme_id)
        applyTheme(getTheme(fresh.theme_id))
      } else {
        setThemeId(null)
        applyTheme(getTheme(DEFAULT_THEME_ID))
      }
    })
    return () => { alive = false }
  }, [clientId])

  function pickTheme(id) {
    setThemeId(id)
    applyTheme(getTheme(id))
  }

  async function save() {
    setSaving(true)
    console.log('[Apariencia save] BEFORE mergeClientConfig', { clientId, themeId })
    const { error, config: next } = await mergeClientConfig(clientId, { theme_id: themeId })
    console.log('[Apariencia save] AFTER mergeClientConfig', { error, theme_id_in_next: next?.theme_id })
    if (error) { setSaving(false); setToast({ kind: 'err', msg: 'Error al guardar' }); return }
    const { config: verify, error: vErr } = await fetchClientConfig(clientId)
    console.log('[Apariencia save] VERIFY re-fetch from Supabase', { error: vErr, theme_id: verify?.theme_id, persisted: verify?.theme_id === themeId })
    setSaving(false)
    setConfig(next)
    setToast({ kind: 'ok', msg: '✓ Apariencia guardada' })
    setTimeout(() => setToast(null), 2500)
  }

  return (
    <div style={{ padding: '24px 32px 40px', maxWidth: 880 }}>
      <SettingsHeader title="Apariencia" subtitle="Elige el tema visual de tu plataforma" />

      <div style={{ marginTop: 4, marginBottom: 18 }}>
        <SectionLabel icon="sparkle" label="Tema de la plataforma" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {THEMES.map(t => {
          const selected = t.id === themeId
          return (
            <div
              key={t.id}
              onClick={() => pickTheme(t.id)}
              style={{
                cursor: 'pointer',
                borderRadius: 12,
                border: `2px solid ${selected ? T.primary : T.line}`,
                background: T.bgRaised,
                padding: 14,
                display: 'flex', flexDirection: 'column', gap: 10,
                transition: 'border-color 120ms',
              }}
            >
              <ThemePreview theme={t} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{t.name}</div>
                  <div style={{ fontSize: 11.5, color: T.inkMuted, marginTop: 2 }}>{t.description}</div>
                </div>
                {selected && (
                  <div style={{
                    width: 20, height: 20, borderRadius: '50%',
                    background: T.primary, color: T.primaryText,
                    display: 'grid', placeItems: 'center', flexShrink: 0,
                  }}><Icon name="check" size={12} stroke={T.primaryText} /></div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
        {toast?.kind === 'ok'  && <span style={{ fontSize: 12, color: T.confirmado }}>{toast.msg}</span>}
        {toast?.kind === 'err' && <span style={{ fontSize: 12, color: T.danger }}>{toast.msg}</span>}
        <button style={btn('primary')} onClick={save} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar apariencia'}
        </button>
      </div>
    </div>
  )
}

function ThemePreview({ theme }) {
  const c = theme.colors
  const accent = c.primary
  return (
    <div style={{
      height: 84, borderRadius: 8, overflow: 'hidden',
      border: `1px solid ${c.border}`,
      display: 'grid', gridTemplateColumns: '32px 1fr',
    }}>
      <div style={{ background: c.sidebar, display: 'flex', flexDirection: 'column', gap: 4, padding: 6 }}>
        <div style={{ height: 6, borderRadius: 2, background: c.sidebarText, opacity: 0.85 }} />
        <div style={{ height: 4, borderRadius: 2, background: c.sidebarText, opacity: 0.5 }} />
        <div style={{ height: 4, borderRadius: 2, background: c.sidebarText, opacity: 0.5 }} />
      </div>
      <div style={{ background: c.background, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ height: 18, borderRadius: 4, background: c.surface, border: `1px solid ${c.border}` }} />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ height: 14, flex: 1, borderRadius: 4, background: c.surface, border: `1px solid ${c.border}` }} />
          <div style={{ width: 22, height: 14, borderRadius: 4, background: accent }} />
        </div>
        <div style={{ height: 6, width: 38, borderRadius: 3, background: accent, opacity: 0.7 }} />
      </div>
    </div>
  )
}
