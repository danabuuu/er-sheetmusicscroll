import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  const { data, error } = await supabase
    .from('songs')
    .select('id, title, artist, tempo, scroll_url, beats_in_scroll, parts')
    .order('title');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const body = await request.json() as { title?: unknown; artist?: unknown; tempo?: unknown };
  const { title, artist, tempo } = body;

  if (typeof title !== 'string' || !title.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }

  const insert: Record<string, unknown> = { title: title.trim() };
  if (typeof artist === 'string' && artist.trim()) insert.artist = artist.trim();
  const tempoNum = typeof tempo === 'number' ? tempo
    : typeof tempo === 'string' ? parseInt(tempo, 10) : NaN;
  if (!isNaN(tempoNum) && tempoNum > 0) insert.tempo = tempoNum;

  const { data, error } = await supabaseAdmin.from('songs').insert(insert).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data, { status: 201 });
}
