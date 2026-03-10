import { readFileSync, existsSync } from 'fs';
import { notFound } from 'next/navigation';
import type { ScoreAnalysis } from '@lib/staff-extraction/types';
import { analysisPath, isValidJobId } from '@/lib/jobs';
import SelectClient from './SelectClient';

export default async function SelectPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;

  if (!isValidJobId(jobId)) notFound();

  const file = analysisPath(jobId);
  if (!existsSync(file)) notFound();

  const analysis: ScoreAnalysis = JSON.parse(readFileSync(file, 'utf8'));

  return <SelectClient jobId={jobId} analysis={analysis} />;
}
