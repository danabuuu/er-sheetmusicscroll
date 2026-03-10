import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { pagePath, isValidJobId } from '@/lib/jobs';

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

  const filePath = pagePath(jobId, pageIndex);
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: 'Page not found' }, { status: 404 });
  }

  return new NextResponse(readFileSync(filePath), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600, immutable',
    },
  });
}
