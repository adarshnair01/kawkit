import { createClient } from '@supabase/supabase-js'

// Public values: the publishable key only grants what row-level security allows.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://cmjedgyaquekrtixmwbf.supabase.co'
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_kP_VJHd-mbNFdzrxxGBcqg_NGMCneAq'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
})

/** Where sign-in emails send people back to. */
export const siteUrl = () => `${window.location.origin}${import.meta.env.BASE_URL}`
