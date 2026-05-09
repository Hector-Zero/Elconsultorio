// Flattens a professional_employments row with embedded professional_profiles
// (from the !inner join) into the canonical SPA "pro" shape. The shape
// matches what the SPA passes around as `pro` and merges identity fields
// (full_name, photo_url) from the joined profile with operational fields
// (color, email, active, public_profile) from the employment.
//
// Post-gap-66 shape: every screen that loads pros uses this helper to
// produce the same flat object. Internal data-model split is hidden from
// consumers.

export function flattenEmployment(row) {
  if (!row) return null
  const profile = row.professional_profiles ?? {}
  return {
    id:             row.id,
    client_id:      row.client_id,
    active:         row.active,
    public_profile: row.public_profile,
    color:          row.color,
    email:          row.email,
    profile_id:     profile.id ?? null,
    user_id:        profile.user_id ?? null,
    full_name:      profile.full_name ?? null,
    photo_url:      profile.photo_url ?? null,
  }
}
