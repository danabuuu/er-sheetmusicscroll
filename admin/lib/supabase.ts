import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;

/** Server-side Supabase client (used in API routes only). */
export const supabase = createClient(supabaseUrl, supabaseKey);

export interface Song {
  id: number;
  title: string;
  artist: string | null;
  tempo: number | null;
  scroll_url: string | null;
}
