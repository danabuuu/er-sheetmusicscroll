import { NextRequest, NextResponse } from 'next/server';
import { detectStaffAtPoint } from '@lib/staff-extraction';
import { isValidJobId } from '@/lib/jobs';
import { downloadJobFile } from '@/lib/supabase-jobs';

export async function POST(request: NextRequest) {
  const body = await request.json() as { jobId?: unknown; pageIndex?: unknown; yNatural?: unknown };
  const { jobId, pageIndex, yNatural } = body;

  if (typeof jobId !== 'string' || !isValidJobId(jobId)) {
    return NextResponse.json({ error: 'Invalid or missing jobId' }, { status: 400 });
  }
  if (typeof pageIndex !== 'number' || !Number.isInteger(pageIndex) || pageIndex < 0) {
    return NextResponse.json({ error: 'Invalid pageIndex' }, { status: 400 });
  }
  if (typeof yNatural !== 'number' || yNatural < 0) {
    return NextResponse.json({ error: 'Invalid yNatural' }, { status: 400 });
  }

  const imageBuffer = await downloadJobFile(jobId, `page-${pageIndex}.png`);
  if (!imageBuffer) {
    return NextResponse.json({ error: 'Page not found' }, { status: 404 });
  }

  const stave = await detectStaffAtPoint(imageBuffer, pageIndex, Math.round(yNatural));
  if (!stave) {
    return NextResponse.json({ error: 'No staff detected at that position' }, { status: 404 });
  }

  return NextResponse.json(stave);
}
