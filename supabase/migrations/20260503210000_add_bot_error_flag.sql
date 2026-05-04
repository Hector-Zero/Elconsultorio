-- Migration: add bot_error flag and message to leads
-- ─────────────────────────────────────────────────────────────────────────────
-- When the bot's booking attempt fails (Edge Function returns non-2xx), the
-- Make.com scenario sets bot_error = true and writes a plain-text Spanish
-- explanation of what went wrong into bot_error_message.
--
-- Dashboard surfaces leads with bot_error = true as needing human attention.
-- A "Marcar como resuelto" action sets it back to false and clears the
-- message.
--
-- Both columns are nullable-friendly: bot_error defaults to false, and
-- bot_error_message stays null until something fails.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS bot_error boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bot_error_message text;

-- Partial index so the dashboard "needs attention" filter is fast even when
-- the leads table grows large. Only indexes rows with bot_error = true,
-- which should be a small minority.
CREATE INDEX IF NOT EXISTS idx_leads_bot_error
  ON public.leads (client_id, last_updated DESC)
  WHERE bot_error = true;

COMMENT ON COLUMN public.leads.bot_error IS
  'True when the bot failed to complete a booking. Surfaced in dashboard as needing human attention. Cleared manually after resolution.';

COMMENT ON COLUMN public.leads.bot_error_message IS
  'Plain-text Spanish explanation of what failed, for the human handling the case.';
