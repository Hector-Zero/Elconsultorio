import { DEFAULT_THEME_ID } from '../config/themes.js'

/**
 * Theme resolution for the authenticated dashboard view.
 *
 * Returns the theme id that should apply to the current
 * user's dashboard view, in this precedence order:
 *   1. Pro mode + professional_profiles.theme_id set → pro's
 *      personal theme.
 *   2. clients.config.theme_id → centro's brand theme.
 *   3. DEFAULT_THEME_ID → fallback.
 *
 * CRITICAL — patient-facing surface rule:
 *
 * This resolver is for the centro-facing dashboard ONLY. Any
 * surface visible to patients (public booking pages, themed
 * emails, future public profile pages, bot output if it ever
 * renders styled content) MUST read clients.config.theme_id
 * directly. Never call this resolver from a patient-facing
 * surface. Doing so would let a pro's personal theme bleed
 * into the centro's public brand, breaking the multi-tenant
 * brand contract.
 *
 * The centro theme is the centro's public identity. The pro
 * theme is a dashboard personalization preference that stays
 * internal to that pro's logged-in session. These never mix.
 *
 * See gap 69 in .claude-context/08_known_gaps.md for the
 * locked-convention writeup.
 */
export function resolveActiveThemeId({ proThemeId, centroThemeId, isPro }) {
  if (isPro && proThemeId) return proThemeId
  if (centroThemeId) return centroThemeId
  return DEFAULT_THEME_ID
}
