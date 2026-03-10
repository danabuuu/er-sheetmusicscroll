import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { analyzeScore, renderPageToImage } from '@lib/staff-extraction';
import { jobDir, pdfPath, analysisPath, pagePath } from '@/lib/jobs';

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
  mkdirSync(jobDir(jobId), { recursive: true });

  // Save uploaded PDF to disk
  const bytes = await file.arrayBuffer();
  writeFileSync(pdfPath(jobId), Buffer.from(bytes));

  // Analyze — detects staves, groups into systems, returns pageCount
  const analysis = await analyzeScore(pdfPath(jobId));
  writeFileSync(analysisPath(jobId), JSON.stringify(analysis));

  // Pre-render and cache all page images so the pages route is instant
  for (let i = 0; i < analysis.pageCount; i++) {
    writeFileSync(pagePath(jobId, i), renderPageToImage(pdfPath(jobId), i));
  }

  return NextResponse.json({ jobId, analysis });
}
