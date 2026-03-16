import { readFileSync } from 'fs';
import mupdf from 'mupdf';
import sharp from 'sharp';
import type { StaffBox, ScoreAnalysis, StaffSelection } from './types.js';

// 150 DPI is sufficient for staff detection and display, and 4× faster to render than 300.
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

interface ScanCfg {
  darkThreshold: number;
  staffLinePxMax: number;
  searchWindow: number;
  spacingMax: number;
  spacingMin: number;
}

function buildScanCfg(height: number): ScanCfg {
  const staffLinePxMax = Math.min(30, Math.max(5, Math.round(height / 300)));
  return {
    darkThreshold: 200,
    staffLinePxMax,
    searchWindow: Math.max(2, Math.round(staffLinePxMax / 2)),
    spacingMax: Math.min(200, Math.max(25, staffLinePxMax * 4)),
    spacingMin: Math.max(3, Math.round(staffLinePxMax * 0.8)),
  };
}

/**
 * Core band-scan function. Builds a horizontal projection profile for the
 * pixel rectangle [xs,xe) × [ys,ye), finds thin dark segments, then searches
 * for 5-line stave motifs using consistent inter-line spacing.
 *
 * @param xs/xe  Horizontal range (columns) to consider
 * @param ys/ye  Vertical range (rows) to consider; rows outside are ignored
 * @param minFrac  Minimum dark-pixel fraction to count a row as "dark"
 * @param maxThick Maximum segment height (rows) to qualify as a staff line
 * @param gapTol  Max gap (rows) between consecutive dark rows before splitting
 */
function scanBand(
  data: Buffer,
  width: number,
  height: number,
  pageIndex: number,
  xs: number, xe: number,
  ys: number, ye: number,
  minFrac: number,
  maxThick: number,
  gapTol: number,
  cfg: ScanCfg,
): StaffBox[] {
  const { darkThreshold, staffLinePxMax, searchWindow, spacingMax, spacingMin } = cfg;
  const bw = xe - xs;

  const profile = new Float32Array(height);
  for (let y = ys; y < ye; y++) {
    let dark = 0;
    for (let x = xs; x < xe; x++) {
      if (data[y * width + x] < darkThreshold) dark++;
    }
    profile[y] = dark / bw;
  }

  const segs: { top: number; bottom: number }[] = [];
  for (let y = ys; y < ye; y++) {
    if (profile[y] < minFrac) continue;
    if (segs.length === 0 || y > segs[segs.length - 1].bottom + gapTol) {
      segs.push({ top: y, bottom: y });
    } else {
      segs[segs.length - 1].bottom = y;
    }
  }

  const thin = segs.filter(s => s.bottom - s.top <= maxThick);

  // Map EVERY row in each thin segment → segment index.
  // Using all rows (not just the midpoint) ensures the search finds a segment
  // even when its midpoint is offset from the expected staff-line position
  // (e.g. when dense notation merges into the top of a segment, shifting the mid).
  const rowToSeg = new Map<number, number>();
  for (let k = 0; k < thin.length; k++) {
    for (let r = thin[k].top; r <= thin[k].bottom; r++) {
      rowToSeg.set(r, k);
    }
  }

  const result: StaffBox[] = [];
  const usedRows = new Set<number>();

  for (let k = 0; k < thin.length; k++) {
    const seg0 = thin[k];
    const mid0 = Math.round((seg0.top + seg0.bottom) / 2);
    if (usedRows.has(seg0.top) || usedRows.has(seg0.bottom) || usedRows.has(mid0)) continue;

    let bestGroup: number[] | null = null;
    let bestD = 0;

    spacingSearch:
    for (let d = spacingMin; d <= spacingMax; d++) {
      const win = Math.min(searchWindow, Math.max(1, Math.floor(d / 4)));
      const group: number[] = [mid0];
      for (let line = 1; line < 5; line++) {
        const expected = mid0 + line * d;
        let found = -1;
        for (let delta = -win; delta <= win; delta++) {
          if (rowToSeg.has(expected + delta)) { found = expected + delta; break; }
        }
        if (found < 0) continue spacingSearch;
        if (usedRows.has(found)) continue spacingSearch;
        group.push(found);
      }

      const gaps = group.slice(1).map((m, i) => m - group[i]);
      const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const maxDev = Math.max(...gaps.map(g => Math.abs(g - avgGap)));
      if (maxDev < avgGap * 0.3 && avgGap >= spacingMin) {
        bestGroup = group;
        bestD = Math.round(avgGap);
        break;
      }
    }

    if (!bestGroup) continue;

    const segFirst = thin[rowToSeg.get(bestGroup[0])!];
    const segLast  = thin[rowToSeg.get(bestGroup[4])!];
    const lineTop    = segFirst.top;
    const lineBottom = segLast.bottom;
    const padding    = Math.round(bestD * 0.6);

    for (let r = lineTop; r <= lineBottom; r++) usedRows.add(r);

    result.push({
      lineTop,
      lineBottom,
      top:    Math.max(0, lineTop - padding),
      bottom: Math.min(height - 1, lineBottom + padding),
      pageIndex,
    });
  }

  result.sort((a, b) => a.lineTop - b.lineTop);
  return result;
}

export async function detectStaves(imageBuffer: Buffer, pageIndex: number): Promise<StaffBox[]> {
  const { data, info } = await sharp(imageBuffer)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const cfg = buildScanCfg(height);

  let staves = scanBand(data, width, height, pageIndex, 0, width, 0, height, 0.15, cfg.staffLinePxMax, 1, cfg);

  if (staves.length < 2)
    staves = scanBand(data, width, height, pageIndex, 0, width, 0, height, 0.08, cfg.staffLinePxMax, 1, cfg);

  if (staves.length < 2) {
    const clefXs = Math.max(1, Math.floor(width * 0.02));
    const clefXe = Math.min(width, Math.floor(width * 0.30));
    staves = scanBand(data, width, height, pageIndex, clefXs, clefXe, 0, height, 0.03, cfg.staffLinePxMax, 1, cfg);
  }

  return staves;
}

/**
 * Detects the single staff closest to the given natural-image y-coordinate.
 * Restricts scanning to a vertical window around the click, which both speeds
 * up processing and avoids false positives from the rest of the page.
 * Useful for recovering staves that auto-detection missed.
 */
export async function detectStaffAtPoint(
  imageBuffer: Buffer,
  pageIndex: number,
  yNatural: number,
): Promise<StaffBox | null> {
  const { data, info } = await sharp(imageBuffer)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const cfg = buildScanCfg(height);

  // Window must be large enough to contain a full 5-line staff (4 gaps × max spacing)
  const WINDOW = Math.max(300, cfg.spacingMax * 6);
  const ys = Math.max(0, yNatural - WINDOW);
  const ye = Math.min(height, yNatural + WINDOW);

  // Try minFrac=0.15 first (same as primary detectStaves scan) — this keeps rows
  // between staff lines below threshold so individual lines form separate thin segments.
  let staves = scanBand(data, width, height, pageIndex, 0, width, ys, ye, 0.15, cfg.staffLinePxMax, 1, cfg);
  if (staves.length === 0)
    staves = scanBand(data, width, height, pageIndex, 0, width, ys, ye, 0.08, cfg.staffLinePxMax, 1, cfg);
  if (staves.length === 0)
    staves = scanBand(data, width, height, pageIndex, 0, width, ys, ye, 0.03, cfg.staffLinePxMax, 1, cfg);

  if (staves.length === 0) return null;

  // Only return a stave if the click actually lands within its padded bounds.
  // Do NOT fall back to returning the nearest stave — that would hand back an
  // already-detected stave when the user clicks in a gap where nothing was found.
  return staves.find(s => s.top <= yNatural && yNatural <= s.bottom) ?? null;
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

  let trimLeft  = Math.max(0, left - HORIZ_PAD);
  let trimRight = Math.min(width - 1, right + HORIZ_PAD);
  let trimWidth = trimRight - trimLeft + 1;

  // Apply any manual per-strip horizontal crop on top of auto-trim.
  // cropLeft / cropRight are fractions of the trimmed width (0–0.5).
  if (staffBox.cropLeft && staffBox.cropLeft > 0) {
    trimLeft  = Math.round(trimLeft + trimWidth * staffBox.cropLeft);
  }
  if (staffBox.cropRight && staffBox.cropRight > 0) {
    trimRight = Math.round(trimRight - trimWidth * staffBox.cropRight);
  }
  trimWidth = Math.max(1, trimRight - trimLeft + 1);

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

/**
 * Pairs up strips vertically (top row + bottom row) then stitches the pairs
 * left-to-right. Each pair has the same width (the wider of the two, padded
 * with white) and double the height.
 *
 * Used when rows=2 in buildScrollImage to show 2 staves at once on the glasses.
 * If there's an odd number of strips, the last pair has a blank bottom row.
 */
async function stitchStrips2Row(strips: Buffer[]): Promise<Buffer> {
  if (strips.length === 0) throw new Error('No strips to stitch');

  // Layout: each column is 400×100px (= two containers wide × full container tall).
  //   - top 50px: stave N scaled to fit 400×50 (contain, letterboxed)
  //   - bottom 50px: stave N+1 scaled to fit 400×50
  // LEFT container (xOffset..xOffset+200) sees the left halves of both staves.
  // RIGHT container (xOffset+200..xOffset+400) sees the right halves.
  // Together they show both complete staves stacked vertically.
  // xOffset advances 400px per tick → one complete stave pair per snap.
  const PAIR_W = 576;
  const halfH  = Math.round(TARGET_HEIGHT / 2); // 50px

  // Scale each strip to fit within 400×50, preserving aspect ratio
  const resized = await Promise.all(
    strips.map(s =>
      sharp(s)
        .resize({ width: PAIR_W, height: halfH, fit: 'contain', background: '#FFFFFF' })
        .png()
        .toBuffer(),
    ),
  );

  // Stack pairs into 400×100 columns, then stitch columns left-to-right
  const columns: Buffer[] = [];
  for (let i = 0; i < resized.length; i += 2) {
    const top    = resized[i];
    const bottom = resized[i + 1] ?? null;

    const composites: sharp.OverlayOptions[] = [{ input: top, left: 0, top: 0 }];
    if (bottom) composites.push({ input: bottom, left: 0, top: halfH });

    columns.push(
      await sharp({
        create: { width: PAIR_W, height: TARGET_HEIGHT, channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 } },
      })
        .composite(composites)
        .png()
        .toBuffer(),
    );
  }

  return stitchStrips(columns);
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
export const DEFAULT_PAD_ABOVE = 0.10;
export const DEFAULT_PAD_BELOW = 0.90;

function expandedCropBox(
  staffBox: StaffBox,
  imageHeight: number,
  padAbove = DEFAULT_PAD_ABOVE,
  padBelow = DEFAULT_PAD_BELOW,
): StaffBox {
  const staffHeight = staffBox.bottom - staffBox.top;
  const topPad    = Math.round(staffHeight * padAbove);
  const bottomPad = Math.round(staffHeight * padBelow);

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
 *
 * @param rows  1 = single row (default, original behaviour)
 *              2 = pairs of staves stacked vertically; shows 2 lines at once
 *              on the glasses but produces a PNG half as wide.
 */
export async function buildScrollImage(
  pdfPath: string,
  selectedStaves: StaffBox[],
  rows: 1 | 2 = 1,
  padAbove = DEFAULT_PAD_ABOVE,
  padBelow = DEFAULT_PAD_BELOW,
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
    // Use per-stave pad if provided, otherwise fall back to global params.
    const effectivePadAbove = staffBox.padAbove ?? padAbove;
    const effectivePadBelow = staffBox.padBelow ?? padBelow;
    const cropBox = expandedCropBox(staffBox, imageHeight, effectivePadAbove, effectivePadBelow);
    const strip = await extractStrip(getPageImage(staffBox.pageIndex), cropBox);
    strips.push(strip);
  }

  return rows === 2 ? stitchStrips2Row(strips) : stitchStrips(strips);
}

export type { StaffBox, ScoreAnalysis, StaffSelection };
