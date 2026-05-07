import React, { useContext, useState, useEffect, useRef } from 'react'
import { ClientCtx } from '../lib/ClientCtx.js'
import { useClientBootstrap } from '../lib/useClientBootstrap.js'
import { supabase } from '../lib/supabase.js'

// ───────────── design tokens ─────────────
export const T = {
  bg:        '#faf8f4',
  bgSunk:    '#f4f1ea',
  bgRaised:  '#ffffff',
  line:      '#e7e2d6',
  lineSoft:  '#efeadd',

  ink:       '#1d2420',
  inkSoft:   '#4a524c',
  inkMuted:  '#8a8f86',
  inkFaint:  '#b5b8ae',

  primary:   '#2f4a3a',
  primarySoft: '#eaf0ea',
  primaryText: '#ffffff',
  sidebarText: '#1d2420',
  sidebarTextMuted: '#8a8f86',
  surfaceHover: '#f4f1ea',
  accent:    '#a65d44',
  accentSoft:'#f6ece4',

  potencial:      '#a65d44',
  potencialSoft:  '#f6ece4',
  confirmado:     '#2f4a3a',
  confirmadoSoft: '#e5ece5',

  warn:      '#b8862e',
  warnSoft:  '#f5ecd4',
  danger:    '#9a4a3f',
  dangerSoft:'#f3dcd6',

  radius: 10,
  radiusSm: 6,

  serif: "'Instrument Serif', 'Cormorant Garamond', Georgia, serif",
  sans:  "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono:  "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
}

// Mix hex toward white at ratio (0..1 of original).
function softenHex(hex, ratio = 0.12) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return hex
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const mix = (c) => Math.round(c * ratio + 255 * (1 - ratio))
  const toHex = (n) => n.toString(16).padStart(2, '0')
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`
}

const loadedFonts = new Set()
function loadGoogleFont(name) {
  if (!name || loadedFonts.has(name)) return
  loadedFonts.add(name)
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@400;500;600;700&display=swap`
  document.head.appendChild(link)
}

// Apply a full theme. Mutates T tokens and CSS vars on :root.
// Caller must re-render (e.g. bump a key) to pick up T changes.
export function applyTheme(theme) {
  if (!theme?.colors) return
  const c = theme.colors
  const primarySoft = softenHex(c.primary, 0.12)

  T.primary          = c.primary
  T.primarySoft      = primarySoft
  T.primaryText      = c.primaryText
  T.confirmado       = c.primary
  T.confirmadoSoft   = primarySoft
  T.bg               = c.background
  T.bgRaised         = c.surface
  T.bgSunk           = c.sidebar
  T.line             = c.border
  T.lineSoft         = softenHex(c.border, 0.5)
  T.sidebarText      = c.sidebarText
  T.sidebarTextMuted = c.sidebarTextMuted
  T.surfaceHover     = c.surfaceHover
  T.ink              = c.text
  T.inkSoft          = c.text
  T.inkMuted         = c.textMuted
  T.inkFaint         = softenHex(c.textMuted, 0.5)

  if (theme.font) {
    loadGoogleFont(theme.font)
    T.sans = `'${theme.font}', ui-sans-serif, system-ui, -apple-system, sans-serif`
    document.body.style.fontFamily = T.sans
  }
  document.body.style.background = c.background
  document.body.style.color = c.text

  const root = document.documentElement.style
  root.setProperty('--color-primary',            c.primary)
  root.setProperty('--color-primary-soft',       primarySoft)
  root.setProperty('--color-primary-text',       c.primaryText)
  root.setProperty('--color-background',         c.background)
  root.setProperty('--color-sidebar',            c.sidebar)
  root.setProperty('--color-sidebar-text',       c.sidebarText)
  root.setProperty('--color-sidebar-text-muted', c.sidebarTextMuted)
  root.setProperty('--color-surface',            c.surface)
  root.setProperty('--color-surface-hover',      c.surfaceHover)
  root.setProperty('--color-border',             c.border)
  root.setProperty('--color-text',               c.text)
  root.setProperty('--color-text-muted',         c.textMuted)
}

// ───────────── icons ─────────────
export const Icon = ({ name, size = 16, stroke = 'currentColor', fill = 'none' }) => {
  const paths = {
    inbox:    <><path d="M3 13l3-8h12l3 8"/><path d="M3 13v6h18v-6"/><path d="M3 13h5l1 2h6l1-2h5"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></>,
    user:     <><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></>,
    users:    <><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="3"/><path d="M15 15c3 0 6 2 6 5"/></>,
    file:     <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></>,
    card:     <><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/></>,
    cog:      <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></>,
    briefcase:<><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/></>,
    search:   <><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>,
    filter:   <><path d="M4 5h16M7 12h10M10 19h4"/></>,
    bell:     <><path d="M18 16v-5a6 6 0 0 0-12 0v5l-2 2h16z"/><path d="M10 20a2 2 0 0 0 4 0"/></>,
    check:    <path d="M4 12l5 5L20 6"/>,
    phone:    <path d="M5 4h4l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>,
    wa:       <><path d="M20 12a8 8 0 1 1-3.5-6.6L20 4l-1.4 3.4A7.9 7.9 0 0 1 20 12z"/><path d="M8 9c0 4 3 7 7 7l1.5-1.5-2-1-1 1c-1 0-3-2-3-3l1-1-1-2z"/></>,
    arrow:    <path d="M5 12h14M13 6l6 6-6 6"/>,
    more:     <><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></>,
    pause:    <><rect x="7" y="5" width="3" height="14" rx="1"/><rect x="14" y="5" width="3" height="14" rx="1"/></>,
    play:     <path d="M7 5l12 7-12 7z"/>,
    chat:     <><path d="M4 5h16v11H9l-5 4z"/></>,
    sparkle:  <><path d="M12 3l1.8 4.7L18 9l-4.2 1.3L12 15l-1.8-4.7L6 9l4.2-1.3z"/><path d="M19 15l.7 1.8L21 17.5l-1.3.7L19 20l-.7-1.8L17 17.5l1.3-.7z"/></>,
    plus:     <path d="M12 5v14M5 12h14"/>,
    clock:    <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    chevronR: <path d="M9 6l6 6-6 6"/>,
    chevronL: <path d="M15 6l-6 6 6 6"/>,
    chevronD: <path d="M6 9l6 6 6-6"/>,
    chevronU: <path d="M6 15l6-6 6 6"/>,
    x:        <path d="M6 6l12 12M18 6L6 18"/>,
    mail:     <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 7 9-7"/></>,
    dollar:   <path d="M12 3v18M17 7a4 4 0 0 0-4-3h-1a4 4 0 0 0 0 8h2a4 4 0 0 1 0 8h-1a4 4 0 0 1-4-3"/>,
    download: <><path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/></>,
    send:     <path d="M3 11l18-7-7 18-3-7z"/>,
    edit:     <><path d="M4 20h4l10-10-4-4L4 16z"/></>,
    home:     <><path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"/></>,
    video:    <><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/></>,
    map:      <><path d="M12 21s-7-7.5-7-12a7 7 0 0 1 14 0c0 4.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/></>,
    pill:     <><rect x="3" y="9" width="18" height="6" rx="3"/><path d="M12 9v6"/></>,
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill}
         stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
         style={{ flexShrink: 0, display: 'block' }}>
      {paths[name]}
    </svg>
  )
}

// ───────────── helpers ─────────────
export const initials = (name) => {
  return (name ?? '').trim().split(/\s+/).slice(0, 2).map(s => s[0] ?? '').join('').toUpperCase() || '?'
}

// Shared by Empresa wizard, Profesionales screen, and pro avatars across the app.
export const PRO_COLORS = ['#2f4a3a', '#0077b6', '#7c5cbf', '#d4688a', '#e07a3a', '#9a4a3f']
export const MAX_PROS = 5

export const avatarTint = (name) => {
  const hues = [18, 32, 140, 160, 200, 220, 260, 330]
  if (!name) return `oklch(0.92 0.03 ${hues[0]})`
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return `oklch(0.92 0.03 ${hues[h % hues.length]})`
}

export const avatarInk = (name) => {
  const hues = [18, 32, 140, 160, 200, 220, 260, 330]
  if (!name) return `oklch(0.38 0.06 ${hues[0]})`
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return `oklch(0.38 0.06 ${hues[h % hues.length]})`
}

export const CLP = (n) => '$' + n.toLocaleString('es-CL')

// ───────────── sidebar ─────────────
const ALL_ITEMS = [
  { id: 'leads',         label: 'Leads',         icon: 'inbox' },
  { id: 'calendar',      label: 'Agenda',        icon: 'calendar' },
  { id: 'patients',      label: 'Pacientes',     icon: 'users' },
  { id: 'professionals', label: 'Profesionales', icon: 'user' },
  { id: 'billing',       label: 'Facturación',   icon: 'card' },
  { id: 'settings',      label: 'Ajustes',       icon: 'cog' },
]

export const Sidebar = ({ active = 'leads', onNavigate }) => {
  const ctx = useContext(ClientCtx)
  const { modules, brandName, avatarUrl } = useClientBootstrap()
  const safeBrandName = brandName ?? 'consultorio'
  const letter    = safeBrandName[0]?.toLowerCase() ?? 'c'
  const userEmail = ctx?.session?.user?.email ?? ''

  const isPro     = !!ctx?.professional
  const proAllowed = ['calendar', 'patients', 'settings']
  let items = modules ? ALL_ITEMS.filter(it => modules.includes(it.id)) : ALL_ITEMS
  if (isPro) items = items.filter(it => proAllowed.includes(it.id))

  return (
    <aside style={{
      width: 232, flexShrink: 0,
      background: T.bgSunk,
      borderRight: `1px solid ${T.line}`,
      display: 'flex', flexDirection: 'column',
      padding: '18px 12px',
      fontFamily: T.sans, color: T.sidebarText ?? T.inkSoft,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px 18px' }}>
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            style={{ width: 28, height: 28, borderRadius: 8, objectFit: 'cover' }}
          />
        ) : (
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: T.primary, color: T.primaryText,
            display: 'grid', placeItems: 'center',
            fontFamily: T.serif, fontSize: 18, fontStyle: 'italic', lineHeight: 1, paddingBottom: 2,
          }}>{letter}</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
          <div style={{ fontFamily: T.serif, fontSize: 17, color: T.sidebarText, fontStyle: 'italic' }}>{safeBrandName}</div>
          <div style={{ fontSize: 10.5, color: T.sidebarTextMuted, letterSpacing: 0.4, textTransform: 'uppercase' }}>{userEmail}</div>
        </div>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map(it => {
          const on = it.id === active
          return (
            <div key={it.id} onClick={() => onNavigate?.(it.id)} style={{
              display: 'flex', alignItems: 'center', gap: 11,
              padding: '9px 10px', borderRadius: 8,
              background: on ? T.bgRaised : 'transparent',
              boxShadow: on ? `0 1px 0 ${T.lineSoft}, 0 1px 2px rgba(30,30,20,0.04)` : 'none',
              color: on ? T.ink : T.sidebarTextMuted,
              fontSize: 13.5, fontWeight: on ? 500 : 400,
              cursor: 'pointer',
            }}>
              <Icon name={it.icon} size={16} stroke={on ? T.primary : T.sidebarTextMuted} />
              <span style={{ flex: 1 }}>{it.label}</span>
            </div>
          )
        })}
      </nav>

      <div style={{ flex: 1 }} />

      <div style={{
        padding: 12, borderRadius: 10,
        background: T.bgRaised, border: `1px solid ${T.lineSoft}`,
        fontSize: 11.5, color: T.inkSoft, lineHeight: 1.5,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, color: T.primary, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          <Icon name="sparkle" size={12} stroke={T.primary} />
          Bot activo
        </div>
        <div style={{ color: T.inkMuted }}>Responde en WhatsApp y califica leads automáticamente.</div>
      </div>

      <button
        onClick={() => supabase.auth.signOut()}
        style={{
          marginTop: 6,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 8px', borderRadius: 8, width: '100%',
          background: 'transparent', border: 'none',
          color: T.inkFaint, fontSize: 11.5, cursor: 'pointer',
          fontFamily: T.sans, letterSpacing: 0.1,
        }}
      >
        <Icon name="arrow" size={13} stroke={T.inkFaint} />
        Cerrar sesión
      </button>
    </aside>
  )
}

// ───────────── shared components ─────────────
export const Avatar = ({ name, size = 36 }) => (
  <div style={{
    width: size, height: size, borderRadius: size / 2,
    background: avatarTint(name), color: avatarInk(name),
    display: 'grid', placeItems: 'center',
    fontSize: size * 0.38, fontWeight: 600, fontFamily: T.sans,
    flexShrink: 0, letterSpacing: 0.2,
  }}>{initials(name)}</div>
)

export const TopBar = ({ title, subtitle, right }) => (
  <>
    <div style={{
      padding: '18px 24px 16px',
      borderBottom: `1px solid ${T.line}`,
      background: T.bg,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16,
    }}>
      <div>
        <h1 style={{
          margin: 0, fontFamily: T.serif, fontWeight: 400,
          fontSize: 30, color: T.ink, letterSpacing: -0.3, lineHeight: 1,
        }}>{title}</h1>
        {subtitle && (
          <div style={{ marginTop: 6, fontFamily: T.sans, fontSize: 12.5, color: T.inkMuted }}>
            {subtitle}
          </div>
        )}
      </div>
      {right}
    </div>
    <OnboardingBanner />
  </>
)

function OnboardingBanner() {
  const ctx = useContext(ClientCtx)
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem('onb_profile_dismissed') === '1' } catch { return false }
  })
  if (!ctx?.profileIncomplete || dismissed) return null
  const goSettings = () => {
    try { sessionStorage.setItem('onb_scroll_perfil', '1') } catch {}
    window.location.hash = 'settings'
  }
  const dismiss = () => {
    try { sessionStorage.setItem('onb_profile_dismissed', '1') } catch {}
    setDismissed(true)
  }
  return (
    <div style={{
      margin: '14px 24px 0', padding: '12px 14px',
      background: T.warnSoft, border: `1px solid ${T.warn}33`,
      borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12,
      fontFamily: T.sans,
    }}>
      <Icon name="user" size={16} stroke={T.warn} />
      <div style={{ flex: 1, fontSize: 12.5, color: T.ink, lineHeight: 1.45 }}>
        Completa tu perfil profesional para usar todas las funciones — el bot, la agenda y las notificaciones dependen de tus datos.
      </div>
      <button onClick={goSettings} style={{
        ...btn('primary'), background: T.warn, color: '#fff',
        border: '1px solid transparent', padding: '6px 12px', fontSize: 12,
      }}>Completar perfil →</button>
      <button onClick={dismiss} aria-label="Cerrar" style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        color: T.inkMuted, fontSize: 18, lineHeight: 1, padding: '0 4px',
      }}>×</button>
    </div>
  )
}

export const btn = (variant) => {
  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: 6, fontSize: 12.5, fontWeight: 500, fontFamily: T.sans,
    borderRadius: 8, cursor: 'pointer', padding: '8px 12px',
    border: '1px solid transparent',
  }
  if (variant === 'primary') return { ...base, background: T.primary, color: T.primaryText }
  if (variant === 'soft')    return { ...base, background: T.primarySoft, color: T.primary, border: `1px solid #d4e0d4` }
  if (variant === 'ghost')   return { ...base, background: 'transparent', color: T.inkSoft, border: `1px solid ${T.line}` }
  if (variant === 'ghostSm') return { ...base, background: 'transparent', color: T.inkSoft, padding: '6px 8px' }
  if (variant === 'accent')  return { ...base, background: T.accent, color: T.primaryText }
  return base
}

// ───────────── confirm modal (replaces native window.confirm) ─────────────
export function ConfirmModal({
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel  = 'Cancelar',
  variant      = 'default',
  onConfirm,
  onCancel,
}) {
  const danger = variant === 'danger'
  const confirmStyle = {
    ...btn('primary'),
    background: danger ? T.danger : T.primary,
    color: T.primaryText,
    border: '1px solid transparent',
    minWidth: 110,
  }
  return (
    <div onClick={cancelLabel === null ? undefined : onCancel} style={{
      position: 'fixed', inset: 0, background: 'rgba(20,18,14,0.4)',
      display: 'grid', placeItems: 'center', zIndex: 100,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 420, background: T.bgRaised, borderRadius: 14,
        boxShadow: '0 24px 60px rgba(20,18,14,0.25)', overflow: 'hidden',
        fontFamily: T.sans,
      }}>
        <div style={{ padding: '22px 24px 6px' }}>
          <div style={{ fontFamily: T.serif, fontSize: 20, color: T.ink, lineHeight: 1.2 }}>{title}</div>
          {description && (
            <div style={{ marginTop: 10, fontSize: 13, color: T.inkSoft, lineHeight: 1.5 }}>{description}</div>
          )}
        </div>
        <div style={{ padding: '18px 24px 18px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {cancelLabel !== null && (
            <button onClick={onCancel} style={btn('ghost')}>{cancelLabel}</button>
          )}
          <button onClick={onConfirm} style={confirmStyle}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

// TODO: Internal AI Assistant (Mode B)
// When activated, this opens a chat with full company context:
// patients, appointments, invoices, clinical notes.
// Agent can generate reports, find patient info, draft boletas,
// and answer internal queries. Only accessible to admin/professional
// logged into the dashboard — never exposed to external leads.
// See session notes for full spec.
export function AssistantFAB() {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={wrapRef} style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 90 }}>
      {open && (
        <div style={{
          position: 'absolute', bottom: 64, right: 0, width: 280,
          background: 'var(--color-surface, #ffffff)',
          border: '1px solid var(--color-border, #e7e2d6)',
          color: 'var(--color-text, #1d2420)',
          borderRadius: 12, boxShadow: '0 16px 40px rgba(20,18,14,0.18)',
          fontFamily: T.sans, padding: '16px 18px 14px',
        }}>
          <button
            onClick={() => setOpen(false)}
            aria-label="Cerrar"
            style={{
              position: 'absolute', top: 8, right: 8, width: 24, height: 24,
              border: 'none', background: 'transparent', cursor: 'pointer',
              fontSize: 18, lineHeight: 1, color: 'var(--color-text, #1d2420)',
              opacity: 0.6, padding: 0,
            }}
          >×</button>
          <div style={{ fontFamily: T.serif, fontSize: 17, marginBottom: 6, paddingRight: 16 }}>
            Asistente interno IA
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, opacity: 0.75, marginBottom: 14 }}>
            Próximamente podrás consultar pacientes, generar reportes y más desde aquí.
          </div>
          <button
            disabled
            style={{
              width: '100%', padding: '8px 12px', borderRadius: 8,
              border: '1px solid var(--color-border, #e7e2d6)',
              background: 'var(--color-border, #e7e2d6)',
              color: 'var(--color-text, #1d2420)', opacity: 0.5,
              fontSize: 12.5, fontFamily: T.sans, cursor: 'not-allowed',
            }}
          >Comenzar conversación</button>
        </div>
      )}
      <div style={{ position: 'relative' }}
           onMouseEnter={() => setHover(true)}
           onMouseLeave={() => setHover(false)}>
        {hover && !open && (
          <div style={{
            position: 'absolute', bottom: '50%', right: 64, transform: 'translateY(50%)',
            background: T.ink, color: '#fff', fontFamily: T.sans,
            fontSize: 11.5, padding: '6px 10px', borderRadius: 6,
            whiteSpace: 'nowrap', pointerEvents: 'none',
          }}>Asistente IA — próximamente</div>
        )}
        <button
          onClick={() => setOpen(o => !o)}
          aria-label="Asistente IA"
          style={{
            width: 52, height: 52, borderRadius: '50%',
            background: 'var(--color-primary, #2f4a3a)',
            border: 'none', cursor: 'pointer',
            boxShadow: '0 6px 18px rgba(20,18,14,0.22)',
            display: 'grid', placeItems: 'center',
            transition: 'transform 0.15s ease',
            transform: hover ? 'scale(1.05)' : 'scale(1)',
          }}
        >
          <Icon name="sparkle" size={22} stroke="#fff" />
        </button>
      </div>
    </div>
  )
}

export const SectionLabel = ({ icon, label }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 7,
    fontSize: 10.5, fontWeight: 500,
    color: T.inkMuted, letterSpacing: 0.6, textTransform: 'uppercase',
    marginBottom: 10,
  }}>
    {icon && <Icon name={icon} size={12} stroke={T.inkMuted} />}
    {label}
  </div>
)
