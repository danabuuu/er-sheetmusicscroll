import path from 'path';
import { mkdirSync } from 'fs';

// On Render the persistent disk is mounted at a fixed path.
// Locally (and in CI) fall back to a tmp/ folder next to the Next.js project root.
export const TMP_DIR =
  process.env.TMP_DIR ??
  path.join(process.cwd(), 'tmp');

// Ensure the directory exists at startup (safe to call multiple times).
mkdirSync(TMP_DIR, { recursive: true });

export function jobDir(jobId: string): string {
  return path.join(TMP_DIR, jobId);
}

export function pdfPath(jobId: string): string {
  return path.join(jobDir(jobId), 'upload.pdf');
}

export function analysisPath(jobId: string): string {
  return path.join(jobDir(jobId), 'analysis.json');
}

export function pagePath(jobId: string, pageIndex: number): string {
  return path.join(jobDir(jobId), `page-${pageIndex}.png`);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidJobId(jobId: string): boolean {
  return UUID_RE.test(jobId);
}
