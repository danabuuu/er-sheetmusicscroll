import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const songId = parseInt(id, 10);
  if (isNaN(songId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body = await request.json() as Record<string, unknown>;
  const updates: Record<string, unknown> = {};

  if (typeof body.title === 'string' && body.title.trim()) updates.title = body.title.trim();
  if ('artist' in body) {
    updates.artist = typeof body.artist === 'string' ? (body.artist.trim() || null) : null;
  }
  const tempoNum = typeof body.tempo === 'number' ? body.tempo
    : typeof body.tempo === 'string' ? parseInt(body.tempo, 10) : NaN;
  if (!isNaN(tempoNum) && tempoNum > 0) updates.tempo = tempoNum;
  const beatsNum = typeof body.beats_in_scroll === 'number' ? body.beats_in_scroll : NaN;
  if (!isNaN(beatsNum) && beatsNum > 0) updates.beats_in_scroll = beatsNum;
  if (Array.isArray(body.parts)) updates.parts = body.parts;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('songs').update(updates).eq('id', songId).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const songId = parseInt(id, 10);
  if (isNaN(songId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const { error } = await supabaseAdmin.from('songs').delete().eq('id', songId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return new NextResponse(null, { status: 204 });
}
