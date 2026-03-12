import { supabaseAdmin } from './supabase';

const JOBS_BUCKET = 'jobs';

/**
 * Uploads a file to the `jobs` Supabase Storage bucket.
 * The bucket must exist (create it in the Supabase dashboard with public=false).
 */
export async function uploadJobFile(
  jobId: string,
  fileName: string,
  data: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await supabaseAdmin.storage
    .from(JOBS_BUCKET)
    .upload(`${jobId}/${fileName}`, data, { contentType, upsert: true });
  if (error) throw new Error(`Job upload failed (${jobId}/${fileName}): ${error.message}`);
}

/**
 * Downloads a file from the `jobs` bucket.
 * Returns null if the file does not exist.
 */
export async function downloadJobFile(
  jobId: string,
  fileName: string,
): Promise<Buffer | null> {
  const { data, error } = await supabaseAdmin.storage
    .from(JOBS_BUCKET)
    .download(`${jobId}/${fileName}`);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}
