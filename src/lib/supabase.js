import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const serviceKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY

export const supabase = createClient(url, anonKey)

// Only used in /admin — never expose to client tenants
export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false },
})
