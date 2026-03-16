import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';

const JOBS_BUCKET = 'jobs';

/**
 * Returns a Supabase signed upload URL so the browser can PUT the PDF directly
 * to Supabase Storage without routing it through Vercel (avoids the 4.5 MB
 * serverless request-body limit).
 *
 * Response: { jobId, signedUrl }
 *   jobId      – UUID to use for the subsequent /api/analyze call
 *   signedUrl  – pre-signed URL; PUT the raw PDF bytes to it
 */
export async function POST() {
  const jobId = randomUUID();
  const path = `${jobId}/upload.pdf`;

  const { data, error } = await supabaseAdmin.storage
    .from(JOBS_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    console.error('createSignedUploadUrl failed:', error?.message);
    return NextResponse.json({ error: 'Failed to create upload URL' }, { status: 500 });
  }

  return NextResponse.json({ jobId, signedUrl: data.signedUrl });
}
