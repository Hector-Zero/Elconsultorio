// Flattens a professional_employments row with embedded
// professional_profiles into the canonical SPA "pro" shape. Hides the
// data-model split from consumers.
//
// The function unconditionally surfaces operational + identity fields
// (id, color, email, full_name, photo_url) that every screen reads.
// Profile-detail fields (bio, specialties, education,
// years_experience, public_summary, public_credentials,
// public_documents) are passed through if present in the joined
// profile, undefined otherwise. Callers control which fields the
// SELECT requested; flattenEmployment merges them into the canonical
// flat shape.
//
// Post-gap-66.

export function flattenEmployment(row) {
  if (!row) return null
  const profile = row.professional_profiles ?? {}
  return {
    // employment fields (centro-owned operational state)
    id:             row.id,
    client_id:      row.client_id,
    active:         row.active,
    public_profile: row.public_profile,
    color:          row.color,
    email:          row.email,
    // profile fields (pro-owned identity, joined from professional_profiles)
    profile_id:     profile.id ?? null,
    user_id:        profile.user_id ?? null,
    full_name:      profile.full_name ?? null,
    photo_url:      profile.photo_url ?? null,
    // optional profile-detail fields (only present when requested in SELECT)
    bio:                  profile.bio,
    specialties:          profile.specialties,
    education:            profile.education,
    years_experience:     profile.years_experience,
    public_summary:       profile.public_summary,
    public_credentials:   profile.public_credentials,
    public_documents:     profile.public_documents,
    theme_id:             profile.theme_id,
  }
}
