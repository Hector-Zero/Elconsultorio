import React, { useState, useEffect } from 'react'

const FONT_STACKS = [
  'ui-serif, Georgia, serif',
  'Didot, "Bodoni MT", serif',
  'Cambria, "Times New Roman", serif',
]

// Hypnotic ψ loader for centro users (admin + pro dashboards).
// Reads theme colors via CSS variables on :root, set synchronously
// pre-mount by index.html's inline script — so the first paint
// after a hard refresh renders in the user's saved theme.
//
// Two variants:
//   default     — fills the viewport, fixed background, three
//                 emanating rings; for App.jsx boot and any other
//                 "whole screen is loading" state.
//   "inline"    — sized to parent, transparent, smaller ψ, one
//                 ring; for in-screen section loaders.
//
// Both respect prefers-reduced-motion: rings + breathing pause,
// ψ stays static at full opacity.
//
// Patient-facing convention reminder: this Loader appears only to
// centro users (admins, pros) — patients never see it because the
// bot is text-only and there's no patient-facing dashboard yet.
// Future patient-facing surfaces should use their own loading
// state, not this component (no ψ watermark for end patients).
export default function Loader({ size }) {
  const inline = size === 'inline'
  const [fontIdx, setFontIdx] = useState(0)
  const [bloom,   setBloom]   = useState(0)

  // Font cycle: swap stack every 1500ms and bump the bloom counter,
  // which re-keys the glyph and re-runs the bloom animation.
  useEffect(() => {
    const id = setInterval(() => {
      setFontIdx(i => (i + 1) % FONT_STACKS.length)
      setBloom(b => b + 1)
    }, 1500)
    return () => clearInterval(id)
  }, [])

  return (
    <div
      role="status"
      aria-label="Cargando"
      style={
        inline
          ? { display: 'grid', placeItems: 'center', width: '100%', padding: '24px 0', minHeight: 96 }
          : { position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--color-background)', zIndex: 9999 }
      }
    >
      <style>{loaderCss}</style>
      <div className={`psi-loader ${inline ? 'psi-loader--inline' : ''}`}>
        {inline ? (
          <span className="psi-ring psi-ring--inline" aria-hidden="true" />
        ) : (
          <>
            <span className="psi-ring psi-ring--1" aria-hidden="true" />
            <span className="psi-ring psi-ring--2" aria-hidden="true" />
            <span className="psi-ring psi-ring--3" aria-hidden="true" />
          </>
        )}
        <span className="psi-breath-wrap" aria-hidden="true">
          <span
            key={bloom}
            className="psi-glyph"
            style={{ fontFamily: FONT_STACKS[fontIdx] }}
          >ψ</span>
        </span>
      </div>
    </div>
  )
}

// Inline keyframes — separated from inline styles because @keyframes
// rules can't be expressed via style={{}}. Rendered as a <style> tag
// inside the component; duplicate identical rules across simultaneous
// mounts are harmless (browser parses each but they don't conflict).
const loaderCss = `
.psi-loader {
  position: relative;
  display: grid;
  place-items: center;
  color: var(--color-primary);
}
.psi-breath-wrap {
  display: inline-block;
  animation: psi-breathe 4400ms ease-in-out infinite;
  color: var(--color-primary);
}
.psi-glyph {
  display: inline-block;
  font-size: clamp(56px, 7.4vmin, 92px);
  line-height: 1;
  animation: psi-bloom 700ms ease-out;
}
.psi-loader--inline .psi-glyph {
  font-size: clamp(28px, 3vmin, 48px);
}
.psi-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  width: clamp(80px, 11vmin, 140px);
  height: clamp(80px, 11vmin, 140px);
  margin-left: calc(clamp(80px, 11vmin, 140px) * -0.5);
  margin-top:  calc(clamp(80px, 11vmin, 140px) * -0.5);
  border-radius: 50%;
  border: 1.25px solid currentColor;
  opacity: 0;
  pointer-events: none;
  animation: psi-emanate 5200ms ease-out infinite;
}
.psi-ring--2 { animation-delay: 1733ms; }
.psi-ring--3 { animation-delay: 3466ms; }
.psi-ring--inline {
  width: clamp(48px, 6vmin, 72px);
  height: clamp(48px, 6vmin, 72px);
  margin-left: calc(clamp(48px, 6vmin, 72px) * -0.5);
  margin-top:  calc(clamp(48px, 6vmin, 72px) * -0.5);
  animation-duration: 3600ms;
}
@keyframes psi-emanate {
  0%   { transform: scale(0.55); opacity: 0;    border-width: 1.25px; }
  20%  { opacity: 0.18; }
  100% { transform: scale(1.35); opacity: 0;    border-width: 0.5px;  }
}
@keyframes psi-breathe {
  0%, 100% { transform: scale(0.96); opacity: 0.62; letter-spacing: 0.004em; }
  50%      { transform: scale(1.04); opacity: 1;    letter-spacing: 0;       }
}
@keyframes psi-bloom {
  0%   { filter: blur(4px); opacity: 0.1; }
  100% { filter: blur(0);   opacity: 1;   }
}
@media (prefers-reduced-motion: reduce) {
  .psi-breath-wrap { animation: none; }
  .psi-glyph       { animation: none; opacity: 1; }
  .psi-ring        { animation: none; opacity: 0; }
}
`
