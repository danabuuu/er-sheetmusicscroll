import { NextRequest, NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import type { ScoreAnalysis } from '@lib/staff-extraction/types';
import { buildScrollImage } from '@lib/staff-extraction';
import { pdfPath, analysisPath, isValidJobId } from '@/lib/jobs';

export async function POST(request: NextRequest) {
  const body = await request.json() as { jobId?: unknown; staveIndices?: unknown };

  const { jobId, staveIndices } = body;

  if (typeof jobId !== 'string' || !isValidJobId(jobId)) {
    return NextResponse.json({ error: 'Invalid or missing jobId' }, { status: 400 });
  }
  if (!Array.isArray(staveIndices) || staveIndices.length === 0) {
    return NextResponse.json({ error: 'staveIndices must be a non-empty array' }, { status: 400 });
  }

  const pdf = pdfPath(jobId);
  if (!existsSync(pdf)) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  // Resolve indices → StaffBox objects from the saved analysis
  const analysis: ScoreAnalysis = JSON.parse(readFileSync(analysisPath(jobId), 'utf8'));
  const selectedStaves = (staveIndices as number[]).map(i => {
    const stave = analysis.staves[i];
    if (!stave) throw new Error(`Stave index ${i} out of range`);
    return stave;
  });

  const png = await buildScrollImage(pdf, selectedStaves);

  return new NextResponse(png, {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': 'inline; filename="scroll.png"',
    },
  });
}
