import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/now-playing
 * Returns the currently queued song (tempo, title, parts).
 * The glasses app polls this on startup and after each song ends.
 *
 * PUT /api/now-playing  { songId: number }
 * Sets the now-playing song. Called from the admin UI or BandTracker.
 */

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('now_playing')
    .select('song_id, songs(id, title, artist, tempo, beats_in_scroll, parts)')
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ song: null });
  }

  return NextResponse.json({ song: (data as any).songs });
}

export async function PUT(request: NextRequest) {
  const body = await request.json() as { songId?: unknown };
  const { songId } = body;

  if (typeof songId !== 'number') {
    return NextResponse.json({ error: 'songId must be a number' }, { status: 400 });
  }

  // Upsert — the table has a single row with a fixed id=1
  const { error } = await supabaseAdmin
    .from('now_playing')
    .upsert({ id: 1, song_id: songId }, { onConflict: 'id' });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
