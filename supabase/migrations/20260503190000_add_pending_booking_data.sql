-- Migration: add pending_booking_data JSONB to leads
-- ─────────────────────────────────────────────────────────────────────────────
-- Stores patient data captured progressively over multiple conversation turns
-- (full_name, rut, email, address, plus agreed slot/professional/service).
--
-- Why JSONB instead of separate columns:
-- - Schema flexibility while booking flow evolves
-- - Single column to read/write in Make.com
-- - Easy to clear with `'{}'::jsonb` after successful booking
--
-- Existing `name` and `phone` columns on leads stay — they're still populated
-- by the Haiku extraction for early-funnel lead qualification, distinct from
-- the structured booking payload here.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS pending_booking_data jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Optional GIN index for future querying (e.g., "find leads with email captured
-- but not yet booked"). Cheap to add now, expensive to add later when the
-- table is large.
CREATE INDEX IF NOT EXISTS idx_leads_pending_booking_data
  ON public.leads
  USING gin (pending_booking_data);

COMMENT ON COLUMN public.leads.pending_booking_data IS
  'Progressive booking payload captured by Haiku during conversation. Keys: '
  'patient_full_name, patient_rut, patient_email, patient_address, '
  'agreed_datetime, agreed_professional_name, agreed_session_type. '
  'Cleared (set to {}) after successful booking via create-booking Edge Function.';
