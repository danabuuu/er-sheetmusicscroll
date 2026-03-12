import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import { analyzeScore, renderPageToImage } from '@lib/staff-extraction';
import { isValidJobId } from '@/lib/jobs';
import { uploadJobFile } from '@/lib/supabase-jobs';

// Allow up to 60 s on Vercel Pro (Hobby is capped at 10 s but this export is harmless there).
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get('pdf');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing pdf field' }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'File must be a PDF' }, { status: 400 });
  }

  const jobId = randomUUID();
  const tmpDir = path.join('/tmp', jobId);
  const tmpPdf = path.join(tmpDir, 'upload.pdf');

  try {
    mkdirSync(tmpDir, { recursive: true });
    const pdfBuffer = Buffer.from(await file.arrayBuffer());
    writeFileSync(tmpPdf, pdfBuffer);

    // Analyze — detects staves and counts pages
    const analysis = await analyzeScore(tmpPdf);

    // Upload PDF and analysis JSON to Supabase Storage (jobs bucket)
    await uploadJobFile(jobId, 'upload.pdf', pdfBuffer, 'application/pdf');
    await uploadJobFile(
      jobId,
      'analysis.json',
      Buffer.from(JSON.stringify(analysis)),
      'application/json',
    );

    // Pre-render all page images and upload them
    for (let i = 0; i < analysis.pageCount; i++) {
      const pageBuffer = renderPageToImage(tmpPdf, i);
      await uploadJobFile(jobId, `page-${i}.png`, pageBuffer, 'image/png');
    }

    return NextResponse.json({ jobId, analysis });
  } finally {
    // Best-effort cleanup of /tmp
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// Silence unused-import warning — isValidJobId is not used here but keeps the jobs module in sync.
void (isValidJobId as unknown);
