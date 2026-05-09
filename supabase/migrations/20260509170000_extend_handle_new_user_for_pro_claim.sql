-- ============================================================================
-- 20260509170000_extend_handle_new_user_for_pro_claim.sql
--
-- Extends the handle_new_user trigger function to wire the pro claim flow.
--
-- Pre-existing responsibility: when raw_user_meta_data carries client_id,
-- insert a matching public.users row (tenancy mapping). Preserved verbatim.
--
-- New responsibility: when raw_user_meta_data carries profile_id, set
-- professional_profiles.user_id = NEW.id, linking the auth user to a
-- previously-unclaimed professional_profiles row. The user_id IS NULL
-- guard prevents accidental clobber if the profile was already claimed
-- (UPDATE silently no-ops; trigger does NOT raise so the auth.users
-- INSERT still completes).
--
-- The two IF blocks are independent: an invite that carries both
-- client_id (so a public.users row is created) AND profile_id (so the
-- professional_profiles row is linked) can be issued in a single invite,
-- or each can fire independently. The pro claim flow uses both.
--
-- Sets search_path = 'public' explicitly — the original handle_new_user
-- omitted this (tracked as gap 54). Tightening as a side benefit.
--
-- Sequence: pro claim flow commit 1 of N.
-- Coordinates with: forthcoming Edge Function `invite-professional`
-- which calls supabase.auth.admin.inviteUserByEmail with metadata
-- including client_id, profile_id, role.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = 'public'
AS $function$
begin
  -- Tenancy mapping: only insert if client_id is provided in metadata
  if (new.raw_user_meta_data->>'client_id') is not null then
    insert into public.users (id, client_id, email, role)
    values (
      new.id,
      (new.raw_user_meta_data->>'client_id')::uuid,
      new.email,
      coalesce(new.raw_user_meta_data->>'role', 'owner')
    );
  end if;

  -- Pro claim: if invite metadata includes profile_id, link the
  -- professional profile to this auth user. The user_id IS NULL guard
  -- prevents accidental clobber: if the profile is already claimed,
  -- the UPDATE no-ops silently and the trigger does NOT raise.
  if (new.raw_user_meta_data->>'profile_id') is not null then
    update public.professional_profiles
       set user_id    = new.id,
           updated_at = now()
     where id      = (new.raw_user_meta_data->>'profile_id')::uuid
       and user_id is null;
  end if;

  return new;
end;
$function$;


COMMENT ON FUNCTION public.handle_new_user() IS
  'Trigger function for AFTER INSERT on auth.users. Provisions '
  'public.users from client_id metadata AND links professional_profiles '
  'to the new auth user when invite metadata contains profile_id (pro '
  'claim flow). Both IF blocks are independent and either can no-op '
  'cleanly without blocking the auth.users INSERT.';

-- (CREATE OR REPLACE preserves the existing GRANT EXECUTE on the
--  function; the trigger `on_auth_user_created` references the function
--  by name and updates in-place. No GRANT or trigger DDL required here.)
