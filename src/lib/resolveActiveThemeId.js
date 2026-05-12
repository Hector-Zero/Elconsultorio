import { DEFAULT_THEME_ID } from '../config/themes.js'

// Canonical resolver for the active dashboard theme. Pro users with a
// personal theme set get their pick; everyone else falls back to the
// centro's theme, then the global default.
//
// IMPORTANT: this resolver is for the AUTHENTICATED DASHBOARD VIEW
// only. Patient-facing surfaces (public profile page, themed emails,
// any UI patients see) must read clients.config.theme_id directly to
// preserve the centro's brand. Never call resolveActiveThemeId from
// those surfaces.
export function resolveActiveThemeId({ proThemeId, centroThemeId, isPro }) {
  console.log('[resolver] inputs', { proThemeId, centroThemeId, isPro })
  let returnValue
  if (isPro && proThemeId) returnValue = proThemeId
  else if (centroThemeId)  returnValue = centroThemeId
  else                     returnValue = DEFAULT_THEME_ID
  console.log('[resolver] returns', returnValue)
  return returnValue
}
