import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import { analyzeScore } from '@lib/staff-extraction';
import { isValidJobId } from '@/lib/jobs';
import { uploadJobFile, downloadJobFile } from '@/lib/supabase-jobs';

// Allow up to 60 s on Vercel Pro (Hobby is capped at 10 s but this export is harmless there).
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';

  // ── Path A: browser already uploaded the PDF directly to Supabase ──────────
  // Body is JSON { jobId } — file is already at jobs/<jobId>/upload.pdf.
  if (contentType.includes('application/json')) {
    let jobId: string;
    try {
      const body = await request.json() as { jobId?: unknown };
      if (typeof body.jobId !== 'string' || !isValidJobId(body.jobId)) {
        return NextResponse.json({ error: 'Invalid or missing jobId' }, { status: 400 });
      }
      jobId = body.jobId;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const pdfBuffer = await downloadJobFile(jobId, 'upload.pdf');
    if (!pdfBuffer) {
      return NextResponse.json({ error: 'PDF not found for this jobId — did the direct upload complete?' }, { status: 404 });
    }

    const tmpDir = path.join('/tmp', `analyze-${jobId}`);
    const tmpPdf = path.join(tmpDir, 'upload.pdf');
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(tmpPdf, pdfBuffer);
      const analysis = await analyzeScore(tmpPdf);
      await uploadJobFile(jobId, 'analysis.json', Buffer.from(JSON.stringify(analysis)), 'application/json');
      return NextResponse.json({ jobId, analysis });
    } finally {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  // ── Path B: legacy — PDF sent as multipart/form-data through Vercel ────────
  // Works for small files; large files should use Path A via /api/upload-url.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with a pdf field' }, { status: 400 });
  }
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

    const analysis = await analyzeScore(tmpPdf);

    await uploadJobFile(jobId, 'upload.pdf', pdfBuffer, 'application/pdf');
    await uploadJobFile(jobId, 'analysis.json', Buffer.from(JSON.stringify(analysis)), 'application/json');

    return NextResponse.json({ jobId, analysis });
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// Silence unused-import warning — isValidJobId is not used here but keeps the jobs module in sync.
void (isValidJobId as unknown);
