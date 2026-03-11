import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'fs';
import type { StaffBox } from '@lib/staff-extraction/types';
import { buildScrollImage } from '@lib/staff-extraction';
import { pdfPath, isValidJobId } from '@/lib/jobs';
import { supabase } from '@/lib/supabase';

const BUCKET = 'scrolls';

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    jobId?: unknown;
    staves?: unknown;
    songId?: unknown;
    tempo?: unknown;
  };

  const { jobId, staves, songId, tempo } = body;

  if (typeof jobId !== 'string' || !isValidJobId(jobId)) {
    return NextResponse.json({ error: 'Invalid or missing jobId' }, { status: 400 });
  }
  if (!Array.isArray(staves) || staves.length === 0) {
    return NextResponse.json({ error: 'staves must be a non-empty array' }, { status: 400 });
  }

  const pdf = pdfPath(jobId);
  if (!existsSync(pdf)) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const selectedStaves = staves as StaffBox[];
  const png = await buildScrollImage(pdf, selectedStaves);

  // If a song ID was provided, upload the PNG to Supabase Storage and save the URL.
  let scrollUrl: string | null = null;
  if (typeof songId === 'number') {
    const filePath = `${songId}.png`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, png, { contentType: 'image/png', upsert: true });

    if (uploadError) {
      console.error('Storage upload failed:', uploadError.message);
    } else {
      const { data: { publicUrl } } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(filePath);
      scrollUrl = publicUrl;

      const updates: Record<string, unknown> = { scroll_url: scrollUrl };
      if (typeof tempo === 'number' && tempo > 0) updates.tempo = tempo;

      await supabase.from('songs').update(updates).eq('id', songId);
    }
  }

  return new NextResponse(png.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': 'inline; filename="scroll.png"',
      ...(scrollUrl ? { 'X-Scroll-Url': scrollUrl } : {}),
    },
  });
}
