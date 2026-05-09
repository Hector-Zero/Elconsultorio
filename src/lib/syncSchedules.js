// Syncs an employment's professional_schedules rows to match a desired
// availability map. The map is keyed by day-of-week names (mon, tue, ...)
// and each value is an array of {start, end} time-string pairs.
//
// Used by all three create/update flows: empresaWizard.jsx (initial
// pro creation), professionalEditor.jsx (admin edit), and
// settings/profile.jsx (Single-mode admin self-edit).
//
// Returns { error } on first failure (the function is non-atomic; a
// partial sync is acceptable since the caller can retry).
//
// Shape adapter: also accepts the legacy settings-form shape
// `{ monday: { start, end, available }, tuesday: {...}, ... }`. If the
// helper sees long-name keys with a single-object value, it normalizes
// to the canonical short-key + array shape before diffing.

const DOW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const LEGACY_LONG_TO_SHORT = {
  sunday:    'sun',
  monday:    'mon',
  tuesday:   'tue',
  wednesday: 'wed',
  thursday:  'thu',
  friday:    'fri',
  saturday:  'sat',
}

function normalizeAvailabilityMap(input) {
  if (!input || typeof input !== 'object') return {}
  const out = {}
  for (const key of Object.keys(input)) {
    const v = input[key]
    const shortKey = LEGACY_LONG_TO_SHORT[key] ?? key
    if (Array.isArray(v)) {
      out[shortKey] = v
    } else if (v && typeof v === 'object' && v.available && v.start && v.end) {
      out[shortKey] = [{ start: v.start, end: v.end }]
    } else {
      out[shortKey] = []
    }
  }
  return out
}

// Accepts either of two SPA-internal shapes for the desired availability:
//
//   1. Short-key / array (canonical): {sun: [{start, end}], mon: [...]}.
//      The professional editor uses this — supports multi-slot per day.
//
//   2. Long-key / single-object (legacy): {monday: {start, end, available}}.
//      Used by settings/profile.jsx and settings/empresaWizard.jsx.
//      Single slot per day, with an `available` flag that toggles on/off.
//
// The internal adapter normalizes both into the canonical (short-key,
// array) form before diffing. Callers don't need to convert before calling.
//
// If the codebase ever standardizes on the canonical shape (a refactor
// out of scope for gap 66), the adapter can be removed.
export async function syncSchedules(supabase, employmentId, desiredMap, existingRows) {
  if (!employmentId || !desiredMap) return { error: 'employment_id and availability required' }

  const normalized = normalizeAvailabilityMap(desiredMap)

  const desiredFlat = []
  for (let dow = 0; dow < 7; dow++) {
    const key = DOW_KEYS[dow]
    const slots = normalized[key] ?? []
    for (const slot of slots) {
      if (slot?.start && slot?.end) {
        desiredFlat.push({ day_of_week: dow, start_time: slot.start, end_time: slot.end })
      }
    }
  }

  // Index existing rows by composite key
  const existingByKey = new Map()
  for (const row of existingRows ?? []) {
    const key = `${row.day_of_week}|${row.start_time}|${row.end_time}`
    existingByKey.set(key, row)
  }

  const desiredByKey = new Map()
  for (const slot of desiredFlat) {
    const key = `${slot.day_of_week}|${slot.start_time}|${slot.end_time}`
    desiredByKey.set(key, slot)
  }

  // Compute diffs
  const toInsert = []
  for (const [key, slot] of desiredByKey) {
    if (!existingByKey.has(key)) {
      toInsert.push({ ...slot, employment_id: employmentId, active: true })
    }
  }

  const toDelete = []
  for (const [key, row] of existingByKey) {
    if (!desiredByKey.has(key)) {
      toDelete.push(row.id)
    }
  }

  // Apply
  if (toInsert.length > 0) {
    const { error } = await supabase.from('professional_schedules').insert(toInsert)
    if (error) return { error }
  }
  if (toDelete.length > 0) {
    const { error } = await supabase
      .from('professional_schedules')
      .delete()
      .in('id', toDelete)
    if (error) return { error }
  }

  return { error: null }
}
