/**
 * Manual test script — usage:
 *   npx tsx test-run.ts <path-to-pdf> [staffIndex]
 *
 * Outputs:
 *   out-analysis.json  — all detected staves
 *   out-scroll.png     — scroll image using every stave at the given staff index
 *
 * staffIndex selects which stave within each occurrence of a repeated
 * instrument (e.g. 0 = top voice, 1 = second voice).  For most single-stave
 * scores, staffIndex is always 0 and every detected stave is included.
 */
import { writeFileSync } from 'fs';
import { analyzeScore, buildScrollImage } from './index.js';

const pdfPath = process.argv[2];
const staffIndex = parseInt(process.argv[3] ?? '0', 10);

if (!pdfPath) {
  console.error('Usage: npx tsx test-run.ts <path-to-pdf> [staffIndex]');
  process.exit(1);
}

console.log(`Analyzing: ${pdfPath}`);
const analysis = await analyzeScore(pdfPath);

console.log(`Found ${analysis.staves.length} staves across ${analysis.pageCount} page(s):`);
analysis.staves.forEach((stave, idx) => {
  console.log(`  Stave ${idx} (page ${stave.pageIndex}): [${stave.top}–${stave.bottom}]`);
});

writeFileSync('out-analysis.json', JSON.stringify(analysis, null, 2));
console.log('Wrote out-analysis.json');

// For the scroll test: pick every stave (they're already in order)
const selectedStaves = analysis.staves;
console.log(`\nBuilding scroll from ${selectedStaves.length} stave(s)…`);
const scrollImage = await buildScrollImage(pdfPath, selectedStaves);
writeFileSync('out-scroll.png', scrollImage);
console.log('Wrote out-scroll.png');
console.log('Done.');
