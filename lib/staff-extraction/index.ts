import { readFileSync } from 'fs';
import mupdf from 'mupdf';
import sharp from 'sharp';
import type { StaffBox, System, ScoreAnalysis, StaffSelection } from './types.js';

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
  const DARK_THRESHOLD = 128;
  const MIN_DARK_FRACTION = 0.25; // row must have 25%+ dark pixels to count as a staff line

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

  // Merge consecutive dark rows into line segments (each staff line is a few px thick)
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

    // Accept if gaps are consistent (deviation < 40% of avg gap) and reasonably sized
    if (maxDeviation < avgGap * 0.4 && avgGap >= 3 && avgGap <= 60) {
      // Pad slightly above/below the outermost lines
      const padding = Math.round(avgGap * 0.6);
      staves.push({
        top: Math.max(0, segments[i].top - padding),
        bottom: Math.min(height - 1, segments[i + 4].bottom + padding),
        pageIndex,
      });
      i += 5; // skip past the matched 5 lines
    } else {
      i++;
    }
  }

  return staves;
}

// ─── Task 4: detectSystems ───────────────────────────────────────────────────

/**
 * Groups staves into systems.
 *
 * Uses an adaptive threshold: computes all same-page consecutive gaps first,
 * then treats any gap > 2× the minimum gap as a system break.
 * This reliably separates intra-system spacing (which varies but stays
 * proportional) from the larger white-space gaps between systems.
 */
export function detectSystems(staves: StaffBox[]): System[] {
  if (staves.length === 0) return [];

  // Collect all same-page consecutive gaps to find the minimum spacing.
  const gaps: number[] = [];
  for (let i = 1; i < staves.length; i++) {
    if (staves[i].pageIndex === staves[i - 1].pageIndex) {
      gaps.push(staves[i].top - staves[i - 1].bottom);
    }
  }

  // Inter-system gaps are always > 2× the tightest intra-system spacing.
  const minGap = gaps.length > 0 ? Math.min(...gaps) : 50;
  const MAX_INTER_STAFF_GAP = minGap * 2;

  const systems: System[] = [];
  let systemIndex = 0;
  let current: StaffBox[] = [];

  for (let i = 0; i < staves.length; i++) {
    if (current.length === 0) {
      current.push(staves[i]);
    } else {
      const prev = current[current.length - 1];
      const samePageAndClose =
        staves[i].pageIndex === prev.pageIndex &&
        staves[i].top - prev.bottom < MAX_INTER_STAFF_GAP;

      if (samePageAndClose) {
        current.push(staves[i]);
      } else {
        systems.push({
          systemIndex: systemIndex++,
          pageIndex: current[0].pageIndex,
          staves: current,
        });
        current = [staves[i]];
      }
    }
  }

  if (current.length > 0) {
    systems.push({
      systemIndex: systemIndex,
      pageIndex: current[0].pageIndex,
      staves: current,
    });
  }

  return systems;
}

// ─── Task 5: analyzeScore ────────────────────────────────────────────────────

/**
 * Runs staff and system detection across all pages of a PDF.
 * Returns a ScoreAnalysis with all detected systems in page order.
 */
export async function analyzeScore(pdfPath: string): Promise<ScoreAnalysis> {
  const fileData = readFileSync(pdfPath);
  const doc = mupdf.Document.openDocument(fileData, 'application/pdf');
  const pageCount = doc.countPages();

  const allStaves: StaffBox[] = [];
  for (let i = 0; i < pageCount; i++) {
    const imgBuffer = renderPageToImage(pdfPath, i);
    const staves = await detectStaves(imgBuffer, i);
    allStaves.push(...staves);
  }

  const systems = detectSystems(allStaves);
  return { pageCount, systems };
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

function expandedCropBox(
  staffBox: StaffBox,
  _staffIndexInSystem: number,
  _systemStaves: StaffBox[],
  imageHeight: number
): StaffBox {
  const staffHeight = staffBox.bottom - staffBox.top;
  const topPad    = Math.round(staffHeight * PAD_ABOVE);
  const bottomPad = Math.round(staffHeight * PAD_BELOW);

  return {
    pageIndex: staffBox.pageIndex,
    top:    Math.max(0, staffBox.top - topPad),
    bottom: Math.min(imageHeight - 1, staffBox.bottom + bottomPad),
  };
}

export async function buildScrollImage(
  pdfPath: string,
  selection: StaffSelection
): Promise<Buffer> {
  const analysis = await analyzeScore(pdfPath);

  // Cache rendered page images — each page is only rasterised once.
  const pageCache = new Map<number, Buffer>();
  const getPageImage = (pageIndex: number): Buffer => {
    if (!pageCache.has(pageIndex)) {
      pageCache.set(pageIndex, renderPageToImage(pdfPath, pageIndex));
    }
    return pageCache.get(pageIndex)!;
  };

  // Pre-compute image heights for clamping expanded crop boxes.
  const pageHeightCache = new Map<number, number>();
  const getPageHeight = async (pageIndex: number): Promise<number> => {
    if (!pageHeightCache.has(pageIndex)) {
      const meta = await sharp(getPageImage(pageIndex)).metadata();
      pageHeightCache.set(pageIndex, meta.height ?? 9999);
    }
    return pageHeightCache.get(pageIndex)!;
  };

  const strips: Buffer[] = [];

  for (const system of analysis.systems) {
    // Determine which staff index to use for this system
    let staffIndex: number;
    if (selection.mode === 'global') {
      staffIndex = selection.staffIndex;
    } else {
      staffIndex = selection.map[system.systemIndex] ?? 0;
    }

    let staffBox = system.staves[staffIndex];
    if (!staffBox) {
      // Fewer staves than usual — voices have been consolidated. Fall back to
      // the last available staff (voices merge downward in condensed systems).
      const fallback = system.staves.length - 1;
      console.warn(
        `System ${system.systemIndex} has only ${system.staves.length} staves; ` +
          `index ${staffIndex} not found. Using last staff (index ${fallback}).`
      );
      staffBox = system.staves[fallback];
    }

    const imageHeight = await getPageHeight(system.pageIndex);
    const cropBox = expandedCropBox(staffBox, staffIndex, system.staves, imageHeight);
    const pageImage = getPageImage(system.pageIndex);
    const strip = await extractStrip(pageImage, cropBox);
    strips.push(strip);
  }

  if (strips.length === 0) throw new Error('No strips could be extracted with the given selection.');

  return stitchStrips(strips);
}

export type { StaffBox, System, ScoreAnalysis, StaffSelection };
