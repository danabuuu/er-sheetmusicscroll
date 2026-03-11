import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** Server-side Supabase client for DB reads/writes (anon key). */
export const supabase = createClient(supabaseUrl, supabaseKey);

/** Service-role client — bypasses RLS. Use only in API routes for storage uploads. */
export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

export interface Song {
  id: number;
  title: string;
  artist: string | null;
  tempo: number | null;
  scroll_url: string | null;
}
