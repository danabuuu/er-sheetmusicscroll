import path from 'path';

export const TMP_DIR = path.join(process.cwd(), 'tmp');

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
