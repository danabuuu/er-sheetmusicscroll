import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import type { StaffBox } from '@lib/staff-extraction/types';
import { buildScrollImage, DEFAULT_PAD_ABOVE, DEFAULT_PAD_BELOW } from '@lib/staff-extraction';
import { isValidJobId } from '@/lib/jobs';
import { downloadJobFile } from '@/lib/supabase-jobs';
import { supabaseAdmin } from '@/lib/supabase';

const BUCKET = 'scrolls';

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    jobId?: unknown;
    staves?: unknown;
    songId?: unknown;
    tempo?: unknown;
    beatsInScroll?: unknown;
    rows?: unknown;
    padAbove?: unknown;
    padBelow?: unknown;
    partLabel?: unknown;
  };

  const { jobId, staves, songId, tempo, beatsInScroll, rows, padAbove, padBelow, partLabel } = body;

  if (typeof jobId !== 'string' || !isValidJobId(jobId)) {
    return NextResponse.json({ error: 'Invalid or missing jobId' }, { status: 400 });
  }
  if (!Array.isArray(staves) || staves.length === 0) {
    return NextResponse.json({ error: 'staves must be a non-empty array' }, { status: 400 });
  }

  // Download PDF from Supabase Storage
  const pdfBuffer = await downloadJobFile(jobId, 'upload.pdf');
  if (!pdfBuffer) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const tmpDir = path.join('/tmp', `build-${jobId}`);
  const tmpPdf = path.join(tmpDir, 'upload.pdf');

  try {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(tmpPdf, pdfBuffer);
  // cropLeft/cropRight are passed through transparently on each StaffBox.
  const selectedStaves = staves as StaffBox[];
    const rowCount: 1 | 2 = rows === 2 ? 2 : 1;
    const padA = typeof padAbove === 'number' ? padAbove : DEFAULT_PAD_ABOVE;
    const padB = typeof padBelow === 'number' ? padBelow : DEFAULT_PAD_BELOW;
    const png = await buildScrollImage(tmpPdf, selectedStaves, rowCount, padA, padB);

    // If a song ID was provided, upload the PNG to Supabase Storage and update the DB.
    let scrollUrl: string | null = null;
    if (typeof songId === 'number') {
      const label = typeof partLabel === 'string' && partLabel.trim() ? partLabel.trim() : null;
      const filePath = label ? `${songId}-${label}.png` : `${songId}.png`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(filePath, png, { contentType: 'image/png', upsert: true });

      if (uploadError) {
        console.error('Storage upload failed:', uploadError.message);
      } else {
        const { data: { publicUrl } } = supabaseAdmin.storage
          .from(BUCKET)
          .getPublicUrl(filePath);
        scrollUrl = `${publicUrl}?t=${Date.now()}`;

        const updates: Record<string, unknown> = {};
        const tempoNum = typeof tempo === 'number' ? tempo : (typeof tempo === 'string' ? parseInt(tempo, 10) : NaN);
        if (!isNaN(tempoNum) && tempoNum > 0) updates.tempo = tempoNum;
        const beatsNum = typeof beatsInScroll === 'number' ? beatsInScroll : (typeof beatsInScroll === 'string' ? parseInt(beatsInScroll, 10) : NaN);
        if (!isNaN(beatsNum) && beatsNum > 0) updates.beats_in_scroll = beatsNum;

        if (label) {
          // Multi-part workflow: append or update this part in songs.parts JSONB
          const { data: songRow } = await supabaseAdmin
            .from('songs').select('parts').eq('id', songId).single();
          const currentParts: { label: string; imageUrl: string }[] =
            Array.isArray(songRow?.parts) ? songRow.parts : [];
          const existingIdx = currentParts.findIndex(p => p.label === label);
          if (existingIdx >= 0) {
            currentParts[existingIdx] = { label, imageUrl: scrollUrl };
          } else {
            currentParts.push({ label, imageUrl: scrollUrl });
          }
          updates.parts = currentParts;
        }

        const { error: dbError } = await supabaseAdmin.from('songs').update(updates).eq('id', songId);
        if (dbError) console.error('DB update failed:', dbError.message);
      }
    }

    return new NextResponse(png.buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': 'inline; filename="scroll.png"',
        ...(scrollUrl ? { 'X-Scroll-Url': scrollUrl } : {}),
      },
    });
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
