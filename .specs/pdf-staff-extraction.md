# Feature: PDF Staff Extraction

## Requirements
- Module accepts a PDF file and renders each page to a raster image at sufficient DPI
- Module detects all "systems" in the score — a system is one horizontal band of staves spanning the full page width (a page typically has 3–6 systems, each system may have 2–5 staves stacked)
- Module returns a structured list of all detected systems and their individual staves (as bounding boxes) so the caller can present them to the user
- User can select which staff to extract using one of two modes:
  - **Simple**: "always use staff N in every system" (e.g. always the 3rd staff down)
  - **Advanced**: pick the staff index individually per system (for scores where the target voice moves position)
- Module crops the selected staff from each system across all pages, with configurable vertical padding above and below the staff strip (expressed as a fraction of staff height)
- Each strip is resized to exactly 100px tall (preserving aspect ratio) and stitched left-to-right into a single wide PNG
- Optionally, two consecutive strips can be stacked vertically (each 50px tall) before stitching, producing a 2-row layout where pairs of systems appear in each 100px column
- The scroll image has a total width that is a multiple of 576px (3×192), matching the three 192×100 image containers on the glasses display
- Output image is ready to use on the glasses display with no further scaling

## Tasks
- [x] Scaffold standalone TypeScript module at `lib/staff-extraction/` with `sharp` (image processing) and `pdfjs-dist` (PDF rendering)
- [x] `renderPageToImage(pdfPath, pageIndex)` — rasterise one PDF page to a greyscale buffer at 300 DPI
- [x] `detectStaves(imageBuffer)` — horizontal projection profile: sum darkness per row, find 5-line clusters → returns array of `StaffBox { top, bottom, pageIndex }`
- [x] `detectSystems(staves)` — group nearby staves into systems → returns `System { staves: StaffBox[], systemIndex, pageIndex }`
- [x] `analyzeScore(pdfPath)` — runs detection across all pages → returns `ScoreAnalysis { systems: System[] }`
- [x] Define `StaffSelection` type: `{ mode: 'global', staffIndex: number } | { mode: 'per-system', map: Record<systemId, staffIndex> }`
- [x] `extractStrip(imageBuffer, staffBox, targetHeight: 100, padAbove, padBelow)` — crop staff row with proportional padding + resize to 100px tall
- [x] `stitchStrips(strips: Buffer[])` — compose strips left-to-right into one wide PNG using `sharp`
- [x] `stitchStrips2Row(strips: Buffer[])` — pair consecutive strips, scale each to 576×50 with `fit: 'contain'`, stack vertically to 576×100 per column, then stitch columns left-to-right
- [x] `buildScrollImage(pdfPath, selection, rows?, padAbove?, padBelow?)` — main entry point: analyze → extract → stitch (1-row or 2-row) → return final PNG buffer
- [x] Export `DEFAULT_PAD_ABOVE = 0.10` and `DEFAULT_PAD_BELOW = 0.90` for use by API routes
- [x] Manual test script (`lib/staff-extraction/test-run.ts`) that accepts a real PDF path and writes the output PNG to disk for visual inspection

## Open Questions
- None currently.
