# Feature: PDF Staff Extraction

> **Deployment note**: This module runs exclusively in the **Processing API** (`admin/`) hosted on Render. It uses Node.js-only native binaries (`mupdf`, `sharp`) and cannot run in a browser or on a serverless/edge platform.

## Requirements
- Module accepts a PDF file and renders each page to a raster image at sufficient DPI
- Module detects all staves across all pages as a flat list of bounding boxes; there is no system-grouping step — the UI handles visual grouping by page
- Module returns `ScoreAnalysis { pageCount: number, staves: StaffBox[] }` so the caller can present bounding boxes to the user
- User selects which staves to extract by clicking on each one individually — the selection is an ordered list of `StaffBox` objects that becomes the scroll sequence
- Module crops each selected stave, applies consistent proportional padding (`PAD_ABOVE = 0.15×`, `PAD_BELOW = 1.30×` staff height) so the staff lines sit at the same relative vertical position in every strip, resizes to exactly 100px tall (preserving aspect ratio for width), and stitches strips left-to-right into a single wide PNG
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
- [x] `buildScrollImage(pdfPath, selectedStaves: StaffBox[])` — main entry point: iterates the ordered selection, renders each page once (cached), applies proportional crop, extracts strip, stitches, returns PNG buffer
- [ ] Add optional `paddingPx` / custom `PAD_ABOVE`/`PAD_BELOW` overrides to `buildScrollImage` so each part can have its own vertical padding
- [x] Manual test script (`lib/staff-extraction/test-run.ts`) that accepts a real PDF path and writes the output PNG to disk for visual inspection

## Open Questions
- None currently.
