import { NextResponse } from 'next/server';
import { supabase, type Song } from '@/lib/supabase';

export async function GET() {
  const { data, error } = await supabase
    .from('songs')
    .select('id, title, artist, tempo, scroll_url')
    .order('title');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data as Song[]);
}
