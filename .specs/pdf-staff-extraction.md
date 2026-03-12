# Feature: PDF Staff Extraction

> **Deployment note**: This module runs exclusively in the **Processing API** (`admin/`) hosted on Render. It uses Node.js-only native binaries (`mupdf`, `sharp`) and cannot run in a browser or on a serverless/edge platform.

## Requirements
- Module accepts a PDF file and renders each page to a raster image at sufficient DPI
- Module detects all staves across all pages as a flat list of bounding boxes; there is no system-grouping step — the UI handles visual grouping by page
- Module returns `ScoreAnalysis { pageCount: number, staves: StaffBox[] }` so the caller can present bounding boxes to the user
- User selects which staves to extract by clicking on each one individually — the selection is an ordered list of `StaffBox` objects that becomes the scroll sequence
- Optionally, two consecutive strips can be stacked vertically (each 50px tall) before stitching, producing a 2-row layout where pairs of systems appear in each 100px column
- The scroll image has a total width that is a multiple of 576px (3×192), matching the three 192×100 image containers on the glasses display
- Module crops each selected stave, applies consistent proportional padding (`PAD_ABOVE = 0.10×`, `PAD_BELOW = 0.90×` staff height) so the staff lines sit at the same relative vertical position in every strip, resizes to exactly 100px tall (preserving aspect ratio for width), and stitches strips left-to-right into a single wide PNG
- Output image is ready to use on the glasses display with no further scaling

## Types

```ts
interface StaffBox {
  top: number;        // padded crop top (used for image extraction)
  bottom: number;     // padded crop bottom
  lineTop: number;    // actual top of the 5-line staff (used for grouping/spacing)
  lineBottom: number; // actual bottom of the 5-line staff
  pageIndex: number;
}

interface ScoreAnalysis {
  pageCount: number;
  staves: StaffBox[];  // all detected staves, in page order top-to-bottom
}

// An ordered list of StaffBox objects; the nth entry becomes the nth strip.
type StaffSelection = StaffBox[];
```

## Tasks
- [x] Scaffold standalone TypeScript module at `lib/staff-extraction/` with `sharp` (image processing) and `mupdf` (PDF rendering)
- [x] `renderPageToImage(pdfPath, pageIndex)` — rasterise one PDF page to a greyscale PNG buffer at 150 DPI using MuPDF
- [x] `detectStaves(imageBuffer, pageIndex)` — horizontal projection profile with multi-pass fallback (full-width at high threshold → lower threshold → clef-region scan); finds 5-line clusters → returns `StaffBox[]`
- [x] `detectStaffAtPoint(imageBuffer, pageIndex, yNatural)` — scans a narrow vertical window around the click Y; returns the nearest `StaffBox` or `null` if none found (used for manual grab when auto-detection missed a staff)
- [x] `analyzeScore(pdfPath)` — renders all pages, runs `detectStaves` on each, returns `ScoreAnalysis { pageCount, staves }`
- [x] `extractStrip(imageBuffer, staffBox)` — applies `expandedCropBox` (proportional padding), horizontally trims whitespace margins, then resizes to 100px tall
- [x] `stitchStrips(strips: Buffer[])` — composites strips left-to-right into one wide PNG using `sharp`
- [x] `stitchStrips2Row(strips: Buffer[])` — pairs consecutive strips, scales each to 576×50 with `fit: 'contain'`, stacks vertically to 576×100 per column, then stitches columns left-to-right
- [x] `buildScrollImage(pdfPath, selectedStaves: StaffBox[], rows?: 1|2, padAbove?: number, padBelow?: number)` — main entry point: iterates the ordered selection, renders each page (cached), extracts strip, stitches (1-row or 2-row), returns PNG buffer
- [x] Export `DEFAULT_PAD_ABOVE = 0.10` and `DEFAULT_PAD_BELOW = 0.90` for use by API routes
- [ ] Add optional per-part padding overrides for multi-voice serial workflow
- [x] Manual test script (`lib/staff-extraction/test-run.ts`) that accepts a real PDF path and writes the output PNG to disk for visual inspection

## Open Questions
- None currently.
