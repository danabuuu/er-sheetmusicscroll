import { readFileSync } from 'fs';
import mupdf from 'mupdf';
import sharp from 'sharp';
import type { StaffBox, ScoreAnalysis, StaffSelection } from './types.js';

// PDF points are 72 DPI; 150 DPI gives enough resolution for reliable line detection.
const RENDER_DPI = 150;
const SCALE = RENDER_DPI / 72;

// ─── Task 2: renderPageToImage ────────────────────────────────────────────────

/**
 * Renders one page of a PDF to a greyscale PNG buffer at 150 DPI.
 */
export function renderPageToImage(pdfPath: string, pageIndex: number): Buffer {
  const fileData = readFileSync(pdfPath);
  const doc = mupdf.Document.openDocument(fileData, 'application/pdf');
  const page = doc.loadPage(pageIndex);
  const matrix = mupdf.Matrix.scale(SCALE, SCALE);
  const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceGray, false);
  return Buffer.from(pixmap.asPNG());
}

// ─── Task 3: detectStaves ─────────────────────────────────────────────────────

/**
 * Detects individual staff bounding boxes on a rendered page image.
 *
 * Strategy: horizontal projection profile — sum dark pixels per row to find
 * staff lines, then cluster 5-line groups into staves.
 */
export async function detectStaves(imageBuffer: Buffer, pageIndex: number): Promise<StaffBox[]> {
  const { data, info } = await sharp(imageBuffer)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;

  // At 150 DPI, thin staff lines are often anti-aliased to gray (value ~150-200).
  // Using 200 catches both solid black and gray lines without picking up the
  // white (255) background.  MIN_DARK_FRACTION of 20% is enough to require
  // substantial line coverage while ignoring local note/text clusters.
  const DARK_THRESHOLD = 200;
  const MIN_DARK_FRACTION = 0.20;

  // Build projection profile: darkness count per row
  const profile: number[] = new Array(height).fill(0);
  for (let y = 0; y < height; y++) {
    let darkCount = 0;
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] < DARK_THRESHOLD) darkCount++;
    }
    profile[y] = darkCount;
  }

  // Find candidate staff-line rows (rows with enough dark pixels)
  const minDark = Math.floor(width * MIN_DARK_FRACTION);
  const lineRows: number[] = [];
  for (let y = 0; y < height; y++) {
    if (profile[y] >= minDark) lineRows.push(y);
  }

  // Merge consecutive dark rows into line segments.
  // Allow up to 4-row gaps for anti-aliased thin lines.
  // A larger gap would merge two adjacent staves in dense scores.
  const segments: { top: number; bottom: number }[] = [];
  for (const row of lineRows) {
    if (segments.length === 0 || row > segments[segments.length - 1].bottom + 4) {
      segments.push({ top: row, bottom: row });
    } else {
      segments[segments.length - 1].bottom = row;
    }
  }

  // Group segments into staves: a staff = 5 lines roughly equally spaced.
  // We look for runs of 5 consecutive segments where spacing is consistent.
  const staves: StaffBox[] = [];
  let i = 0;
  while (i <= segments.length - 5) {
    // Measure spacing between segment midpoints
    const mids = segments.slice(i, i + 5).map(s => Math.round((s.top + s.bottom) / 2));
    const gaps = mids.slice(1).map((m, idx) => m - mids[idx]);
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const maxDeviation = Math.max(...gaps.map(g => Math.abs(g - avgGap)));

    // Accept if gaps are consistent (deviation < 60% of avg gap) and reasonably
    // sized.  60% is more permissive than the old 40% to handle cases where
    // some lines are detected slightly off-position due to anti-aliasing.
    // Upper limit 150px covers even large-format PDFs rendered at 150 DPI.
    if (maxDeviation < avgGap * 0.6 && avgGap >= 1 && avgGap <= 150) {
      // lineTop/lineBottom = actual outermost staff line pixels (no padding).
      // These are used for gap measurement to keep inter-stave metrics accurate.
      const lineTop    = segments[i].top;
      const lineBottom = segments[i + 4].bottom;
      // Pad slightly above/below for the render crop box.
      const padding = Math.round(avgGap * 0.6);
      staves.push({
        lineTop,
        lineBottom,
        top:    Math.max(0, lineTop - padding),
        bottom: Math.min(height - 1, lineBottom + padding),
        pageIndex,
      });
      i += 5; // skip past the matched 5 lines
    } else {
      i++;
    }
  }

  return staves;
}

// ─── Task 5: analyzeScore ────────────────────────────────────────────────────

/**
 * Detects all staves across every page of a PDF and returns them as a flat
 * list in page order (top-to-bottom within each page).
 *
 * System grouping is intentionally omitted — the user selects individual
 * staves in the UI, so no automatic grouping is needed or desired.
 */
export async function analyzeScore(pdfPath: string): Promise<ScoreAnalysis> {
  const fileData = readFileSync(pdfPath);
  const doc = mupdf.Document.openDocument(fileData, 'application/pdf');
  const pageCount = doc.countPages();

  const staves: StaffBox[] = [];
  for (let i = 0; i < pageCount; i++) {
    const imgBuffer = renderPageToImage(pdfPath, i);
    const pageStaves = await detectStaves(imgBuffer, i);
    staves.push(...pageStaves);
  }

  return { pageCount, staves };
}

// ─── Task 7: extractStrip ────────────────────────────────────────────────────

const TARGET_HEIGHT = 100; // px — final strip height for glasses display
const HORIZ_PAD = 12;      // px — horizontal margin to keep around content after trim
const DARK_THRESHOLD = 180;
const MIN_DARK_FRACTION_COL = 0.02; // column needs ≥2% dark pixels to count as content

/**
 * Crops one staff row from a page image, trims horizontal whitespace so only
 * the musical content remains (no page margins), then resizes to TARGET_HEIGHT.
 */
export async function extractStrip(imageBuffer: Buffer, staffBox: StaffBox): Promise<Buffer> {
  const cropHeight = staffBox.bottom - staffBox.top;

  // Step 1: vertical crop to the staff band
  const bandBuffer = await sharp(imageBuffer)
    .extract({
      left: 0,
      top: staffBox.top,
      width: (await sharp(imageBuffer).metadata()).width!,
      height: cropHeight,
    })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = bandBuffer;
  const { width, height } = info;

  // Step 2: column projection — find leftmost and rightmost content columns
  const minDarkRows = Math.ceil(height * MIN_DARK_FRACTION_COL);
  let left = 0;
  let right = width - 1;

  for (let x = 0; x < width; x++) {
    let darkCount = 0;
    for (let y = 0; y < height; y++) {
      if (data[y * width + x] < DARK_THRESHOLD) darkCount++;
    }
    if (darkCount >= minDarkRows) { left = x; break; }
  }

  for (let x = width - 1; x >= 0; x--) {
    let darkCount = 0;
    for (let y = 0; y < height; y++) {
      if (data[y * width + x] < DARK_THRESHOLD) darkCount++;
    }
    if (darkCount >= minDarkRows) { right = x; break; }
  }

  const trimLeft  = Math.max(0, left - HORIZ_PAD);
  const trimRight = Math.min(width - 1, right + HORIZ_PAD);
  const trimWidth = trimRight - trimLeft + 1;

  // Step 3: apply horizontal trim and resize to target height
  return sharp(imageBuffer)
    .extract({
      left: trimLeft,
      top: staffBox.top,
      width: trimWidth,
      height: cropHeight,
    })
    .resize({ height: TARGET_HEIGHT, fit: 'contain', background: '#FFFFFF' })
    .png()
    .toBuffer();
}

// ─── Task 8: stitchStrips ────────────────────────────────────────────────────

/**
 * Composites an array of same-height strip buffers left-to-right into one
 * wide PNG.
 */
export async function stitchStrips(strips: Buffer[]): Promise<Buffer> {
  if (strips.length === 0) throw new Error('No strips to stitch');

  // Get dimensions of each strip
  const metas = await Promise.all(strips.map(s => sharp(s).metadata()));
  const totalWidth = metas.reduce((sum, m) => sum + (m.width ?? 0), 0);
  const height = metas[0].height ?? TARGET_HEIGHT;

  // Build composite input list with x offsets
  let offsetX = 0;
  const composites: sharp.OverlayOptions[] = strips.map((strip, i) => {
    const entry: sharp.OverlayOptions = { input: strip, left: offsetX, top: 0 };
    offsetX += metas[i].width ?? 0;
    return entry;
  });

  return sharp({
    create: {
      width: totalWidth,
      height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

// ─── Task 9: buildScrollImage ─────────────────────────────────────────────────

/**
 * Main entry point.
 * Analyzes the PDF, applies the user's staff selection, extracts and stitches
 * all selected strips into one wide PNG ready for the glasses scroll display.
 */
/**
 * Crops a staff to a fixed proportional extent so that every strip has the
 * staff lines at the same relative vertical position — making the final
 * horizontal scroll look like one continuous staff.
 *
 * Padding is expressed as a multiple of the detected staff height:
 *   - 15% above  (room for ties, slurs, dynamics)
 *   - 130% below (room for lyrics, chord symbols, figured bass)
 *
 * These constants give a total strip height of ~2.45× the staff height,
 * which is consistent regardless of which system the staff came from.
 */
const PAD_ABOVE = 0.15;
const PAD_BELOW = 1.30;

function expandedCropBox(staffBox: StaffBox, imageHeight: number): StaffBox {
  const staffHeight = staffBox.bottom - staffBox.top;
  const topPad    = Math.round(staffHeight * PAD_ABOVE);
  const bottomPad = Math.round(staffHeight * PAD_BELOW);

  return {
    pageIndex:   staffBox.pageIndex,
    lineTop:     staffBox.lineTop,
    lineBottom:  staffBox.lineBottom,
    top:    Math.max(0, staffBox.top - topPad),
    bottom: Math.min(imageHeight - 1, staffBox.bottom + bottomPad),
  };
}

/**
 * Builds a horizontal scroll PNG from an explicit ordered list of staves.
 * Each stave is expanded to a consistent proportional crop and stitched
 * left-to-right.
 */
export async function buildScrollImage(
  pdfPath: string,
  selectedStaves: StaffBox[],
): Promise<Buffer> {
  if (selectedStaves.length === 0) throw new Error('No staves selected.');

  // Cache rendered page images — each page is only rasterised once.
  const pageCache = new Map<number, Buffer>();
  const getPageImage = (pageIndex: number): Buffer => {
    if (!pageCache.has(pageIndex)) {
      pageCache.set(pageIndex, renderPageToImage(pdfPath, pageIndex));
    }
    return pageCache.get(pageIndex)!;
  };

  const pageHeightCache = new Map<number, number>();
  const getPageHeight = async (pageIndex: number): Promise<number> => {
    if (!pageHeightCache.has(pageIndex)) {
      const meta = await sharp(getPageImage(pageIndex)).metadata();
      pageHeightCache.set(pageIndex, meta.height ?? 9999);
    }
    return pageHeightCache.get(pageIndex)!;
  };

  const strips: Buffer[] = [];
  for (const staffBox of selectedStaves) {
    const imageHeight = await getPageHeight(staffBox.pageIndex);
    const cropBox = expandedCropBox(staffBox, imageHeight);
    const strip = await extractStrip(getPageImage(staffBox.pageIndex), cropBox);
    strips.push(strip);
  }

  return stitchStrips(strips);
}

export type { StaffBox, ScoreAnalysis, StaffSelection };
