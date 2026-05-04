# Database Schema

> Auto-generated. Run `./scripts/update-context.sh schema` to refresh.
> Last updated: 2026-05-04 16:12:32 -04

## admin_clients_summary

- `id` uuid
- `slug` text
- `name` text
- `business_type` text
- `plan` text
- `active` boolean
- `total_leads` bigint
- `qualified_leads` bigint
- `active_leads` bigint
- `total_conversions` bigint
- `revenue_total` bigint
- `created_at` timestamp with time zone

## agents_config

- `id` uuid NOT NULL DEFAULT uuid_generate_v4()
- `client_id` uuid NOT NULL
- `agent_name` text NOT NULL
- `system_prompt` text NOT NULL DEFAULT ''::text
- `closing_question` text
- `message_limit` integer NOT NULL DEFAULT 10
- `active` boolean NOT NULL DEFAULT true
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

## appointments

- `id` uuid NOT NULL DEFAULT uuid_generate_v4()
- `client_id` uuid NOT NULL
- `lead_id` uuid
- `datetime` timestamp with time zone NOT NULL
- `duration` integer DEFAULT 50
- `type` text DEFAULT 'presencial'::text
- `status` text DEFAULT 'pending_payment'::text
- `notes` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `professional_id` uuid
- `session_type_id` uuid
- `patient_id` uuid
- `payment_link` text

## clients

- `id` uuid NOT NULL DEFAULT uuid_generate_v4()
- `slug` text NOT NULL
- `name` text NOT NULL
- `business_type` text NOT NULL DEFAULT 'generic'::text
- `plan` text NOT NULL DEFAULT 'starter'::text
- `active` boolean NOT NULL DEFAULT true
- `config` jsonb NOT NULL DEFAULT '{}'::jsonb
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

## clinical_notes

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `assignment_id` uuid NOT NULL
- `client_id` uuid NOT NULL
- `session_date` date NOT NULL DEFAULT CURRENT_DATE
- `notes` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

## conversions

- `id` uuid NOT NULL DEFAULT uuid_generate_v4()
- `client_id` uuid NOT NULL
- `lead_id` uuid
- `invoice_id` uuid
- `revenue` integer
- `source` text DEFAULT 'whatsapp'::text
- `converted_at` timestamp with time zone NOT NULL DEFAULT now()

## email_logs

- `id` uuid NOT NULL DEFAULT uuid_generate_v4()
- `client_id` uuid NOT NULL
- `lead_id` uuid
- `type` text NOT NULL
- `to_email` text NOT NULL
- `subject` text
- `resend_id` text
- `status` text DEFAULT 'sent'::text
- `sent_at` timestamp with time zone NOT NULL DEFAULT now()

## invoices

- `id` uuid NOT NULL DEFAULT uuid_generate_v4()
- `client_id` uuid NOT NULL
- `lead_id` uuid
- `patient_id` uuid
- `amount` integer NOT NULL
- `method` text DEFAULT 'pendiente'::text
- `status` text DEFAULT 'pendiente'::text
- `bsales_id` text
- `bsales_number` text
- `mp_payment_id` text
- `mp_link` text
- `description` text DEFAULT 'Sesión clínica'::text
- `issued_at` timestamp with time zone DEFAULT now()
- `paid_at` timestamp with time zone
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

## leads

- `id` uuid NOT NULL DEFAULT uuid_generate_v4()
- `client_id` uuid NOT NULL
- `chat_id` text NOT NULL
- `name` text
- `phone` text
- `phase` text DEFAULT 'active'::text
- `quality` text DEFAULT 'frio'::text
- `qualified_lead` boolean DEFAULT false
- `message_count` integer DEFAULT 0
- `conversation_context` text
- `history` text
- `notes` text
- `agent_name` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `last_updated` timestamp with time zone NOT NULL DEFAULT now()
- `bot_paused` boolean DEFAULT false
- `email` text
- `pending_booking_data` jsonb NOT NULL DEFAULT '{}'::jsonb — Progressive booking payload captured by Haiku during conversation. Keys: patient_full_name, patient_rut, patient_email, patient_address, agreed_datetime, agreed_professional_name, agreed_session_type. Cleared (set to {}) after successful booking via create-booking Edge Function.
- `bot_error` boolean NOT NULL DEFAULT false — True when the bot failed to complete a booking. Surfaced in dashboard as needing human attention. Cleared manually after resolution.
- `bot_error_message` text — Plain-text Spanish explanation of what failed, for the human handling the case.

## patient_assignments

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `patient_id` uuid NOT NULL
- `professional_id` uuid
- `client_id` uuid NOT NULL
- `status` text NOT NULL DEFAULT 'active'::text
- `started_at` timestamp with time zone NOT NULL DEFAULT now()
- `ended_at` timestamp with time zone
- `admin_can_view_notes` boolean NOT NULL DEFAULT true
- `ai_summary` text
- `ai_summary_hash` text
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()

## patients

- `id` uuid NOT NULL DEFAULT uuid_generate_v4()
- `client_id` uuid NOT NULL
- `lead_id` uuid
- `full_name` text NOT NULL
- `rut` text
- `phone` text
- `email` text
- `insurance` text
- `diagnosis` text
- `medication` text
- `session_value` integer DEFAULT 0
- `total_sessions` integer DEFAULT 0
- `balance` integer DEFAULT 0
- `status` text DEFAULT 'activo'::text
- `tags` ARRAY DEFAULT '{}'::text[]
- `since` date DEFAULT CURRENT_DATE
- `created_at` timestamp with time zone NOT NULL DEFAULT now()
- `updated_at` timestamp with time zone NOT NULL DEFAULT now()
- `professional_id` uuid
- `address` text

## professional_documents

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `professional_id` uuid NOT NULL
- `doc_type` text NOT NULL
- `title` text NOT NULL
- `file_url` text NOT NULL
- `file_path` text NOT NULL
- `issuer` text
- `issued_date` date
- `display_on_profile` boolean DEFAULT true
- `display_order` integer DEFAULT 0
- `created_at` timestamp with time zone DEFAULT now()

## professional_schedules

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `professional_id` uuid NOT NULL
- `day_of_week` integer NOT NULL
- `start_time` time without time zone NOT NULL
- `end_time` time without time zone NOT NULL
- `active` boolean DEFAULT true
- `created_at` timestamp with time zone DEFAULT now()

## professional_session_types

- `professional_id` uuid NOT NULL
- `session_type_id` uuid NOT NULL
- `custom_price_amount` numeric
- `active` boolean DEFAULT true
- `created_at` timestamp with time zone DEFAULT now()

## professionals

- `id` uuid NOT NULL DEFAULT uuid_generate_v4()
- `client_id` uuid NOT NULL
- `full_name` text NOT NULL
- `initials` text
- `color` text DEFAULT '#2f4a3a'::text
- `avatar_url` text
- `email` text
- `role` text DEFAULT 'professional'::text
- `active` boolean DEFAULT true
- `availability` jsonb DEFAULT '{"friday": {"end": "18:00", "start": "09:00", "available": true}, "monday": {"end": "18:00", "start": "09:00", "available": true}, "sunday": {"end": "13:00", "start": "09:00", "available": false}, "tuesday": {"end": "18:00", "start": "09:00", "available": true}, "saturday": {"end": "13:00", "start": "09:00", "available": false}, "thursday": {"end": "18:00", "start": "09:00", "available": true}, "wednesday": {"end": "18:00", "start": "09:00", "available": true}}'::jsonb
- `created_at` timestamp with time zone DEFAULT now()
- `user_id` uuid
- `public_summary` text
- `public_credentials` text
- `public_documents` jsonb
- `bio` text
- `specialties` ARRAY DEFAULT '{}'::text[]
- `education` text
- `years_experience` integer
- `public_profile` boolean DEFAULT true
- `photo_url` text

## session_types

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `client_id` uuid NOT NULL
- `name` text NOT NULL
- `price_amount` numeric NOT NULL
- `price_currency` text NOT NULL DEFAULT 'CLP'::text
- `active` boolean DEFAULT true
- `display_order` integer DEFAULT 0
- `created_at` timestamp with time zone DEFAULT now()
- `updated_at` timestamp with time zone DEFAULT now()

## super_admins

- `user_id` uuid NOT NULL
- `email` text NOT NULL
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

## usage_log

- `id` uuid NOT NULL DEFAULT gen_random_uuid()
- `client_id` uuid NOT NULL
- `chat_id` text NOT NULL
- `model` text NOT NULL
- `input_tokens` integer
- `cache_creation_tokens` integer DEFAULT 0
- `cache_read_tokens` integer DEFAULT 0
- `output_tokens` integer
- `created_at` timestamp with time zone DEFAULT now()
- `estimated_cost_usd` numeric

## users

- `id` uuid NOT NULL
- `client_id` uuid NOT NULL
- `email` text NOT NULL
- `full_name` text
- `role` text NOT NULL DEFAULT 'owner'::text
- `active` boolean NOT NULL DEFAULT true
- `created_at` timestamp with time zone NOT NULL DEFAULT now()

## v_client_health

- `client_id` uuid
- `name` text
- `plan` text
- `active` boolean
- `new_leads_30d` bigint
- `qualified_30d` bigint
- `conversions_30d` bigint
- `revenue_30d` bigint
- `ai_cost_30d` numeric
- `ai_calls_30d` bigint
