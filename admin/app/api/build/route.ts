import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'fs';
import type { StaffBox } from '@lib/staff-extraction/types';
import { buildScrollImage } from '@lib/staff-extraction';
import { pdfPath, isValidJobId } from '@/lib/jobs';

export async function POST(request: NextRequest) {
  const body = await request.json() as { jobId?: unknown; staves?: unknown };

  const { jobId, staves } = body;

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

  return new NextResponse(png.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': 'inline; filename="scroll.png"',
    },
  });
}
