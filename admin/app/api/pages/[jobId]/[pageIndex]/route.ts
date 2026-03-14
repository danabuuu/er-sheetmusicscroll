import { writeFileSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { isValidJobId } from '@/lib/jobs';
import { downloadJobFile } from '@/lib/supabase-jobs';
import { renderPageToImage } from '@lib/staff-extraction';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string; pageIndex: string }> }
) {
  const { jobId, pageIndex: pageIndexStr } = await params;

  if (!isValidJobId(jobId)) {
    return NextResponse.json({ error: 'Invalid job ID' }, { status: 400 });
  }

  const pageIndex = parseInt(pageIndexStr, 10);
  if (isNaN(pageIndex) || pageIndex < 0) {
    return NextResponse.json({ error: 'Invalid page index' }, { status: 400 });
  }

  // Download PDF and render the requested page on demand.
  const pdfBuffer = await downloadJobFile(jobId, 'upload.pdf');
  if (!pdfBuffer) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const tmpDir = path.join('/tmp', `pages-${jobId}`);
  const tmpPdf = path.join(tmpDir, 'upload.pdf');
  try {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(tmpPdf, pdfBuffer);
    const png = renderPageToImage(tmpPdf, pageIndex);
    return new NextResponse(png.buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600, immutable',
      },
    });
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
