/**
 * Manual test script — usage:
 *   npx tsx test-run.ts <path-to-pdf> [staffIndex]
 *
 * Outputs:
 *   out-analysis.json  — detected systems / staves
 *   out-scroll.png     — final stitched scroll image
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

console.log(`Found ${analysis.systems.length} systems:`);
analysis.systems.forEach(sys => {
  console.log(
    `  System ${sys.systemIndex} (page ${sys.pageIndex}): ${sys.staves.length} staves — ` +
      sys.staves.map(s => `[${s.top}–${s.bottom}]`).join(', ')
  );
});

writeFileSync('out-analysis.json', JSON.stringify(analysis, null, 2));
console.log('Wrote out-analysis.json');

console.log(`\nExtracting staff index ${staffIndex} from each system…`);
const scrollImage = await buildScrollImage(pdfPath, { mode: 'global', staffIndex });
writeFileSync('out-scroll.png', scrollImage);
console.log('Wrote out-scroll.png');
console.log('Done.');
