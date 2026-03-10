import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'fs';
import type { StaffSelection } from '@lib/staff-extraction/types';
import { buildScrollImage } from '@lib/staff-extraction';
import { pdfPath, isValidJobId } from '@/lib/jobs';

export async function POST(request: NextRequest) {
  const body = await request.json() as { jobId?: unknown; selection?: unknown };

  const { jobId, selection } = body;

  if (typeof jobId !== 'string' || !isValidJobId(jobId)) {
    return NextResponse.json({ error: 'Invalid or missing jobId' }, { status: 400 });
  }
  if (!selection || typeof selection !== 'object') {
    return NextResponse.json({ error: 'Missing selection' }, { status: 400 });
  }

  const pdf = pdfPath(jobId);
  if (!existsSync(pdf)) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const png = await buildScrollImage(pdf, selection as StaffSelection);

  return new NextResponse(png, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': 'inline; filename="scroll.png"',
    },
  });
}
