# Feature: PDF Staff Extraction

## Requirements
- Module accepts a PDF file and renders each page to a raster image at sufficient DPI
- Module detects all "systems" in the score — a system is one horizontal band of staves spanning the full page width (a page typically has 3–6 systems, each system may have 2–5 staves stacked)
- Module returns a structured list of all detected systems and their individual staves (as bounding boxes) so the caller can present them to the user
- User can select which staff to extract using one of two modes:
  - **Simple**: "always use staff N in every system" (e.g. always the 3rd staff down)
  - **Advanced**: pick the staff index individually per system (for scores where the target voice moves position)
- Module crops the selected staff from each system across all pages, resizes each strip to exactly 100px tall (preserving aspect ratio for width), and stitches them left-to-right into a single wide PNG
- Output image is ready to use on the glasses display with no further scaling

## Tasks
- [x] Scaffold standalone TypeScript module at `lib/staff-extraction/` with `sharp` (image processing) and `pdfjs-dist` (PDF rendering)
- [x] `renderPageToImage(pdfPath, pageIndex)` — rasterise one PDF page to a greyscale buffer at 150 DPI
- [x] `detectStaves(imageBuffer)` — horizontal projection profile: sum darkness per row, find 5-line clusters → returns array of `StaffBox { top, bottom, pageIndex }`
- [x] `detectSystems(staves)` — group nearby staves into systems → returns `System { staves: StaffBox[], systemIndex, pageIndex }`
- [x] `analyzeScore(pdfPath)` — runs detection across all pages → returns `ScoreAnalysis { systems: System[] }`
- [x] Define `StaffSelection` type: `{ mode: 'global', staffIndex: number } | { mode: 'per-system', map: Record<systemId, staffIndex> }`
- [x] `extractStrip(imageBuffer, staffBox, targetHeight: 100)` — crop staff row + resize to 100px tall
- [x] `stitchStrips(strips: Buffer[])` — compose strips left-to-right into one wide PNG using `sharp`
- [x] `buildScrollImage(pdfPath, selection: StaffSelection)` — main entry point: analyze → extract → stitch → return final PNG buffer
- [ ] `buildScrollImages(pdfPath, parts: Array<{ label: string, selection: StaffSelection }>)` — convenience wrapper that calls `buildScrollImage` once per part and returns `Array<{ label: string, buffer: Buffer }>` (avoids re-rendering PDF pages for each part by sharing the rasterized page cache)
- [x] Manual test script (`lib/staff-extraction/test-run.ts`) that accepts a real PDF path and writes the output PNG to disk for visual inspection

## Open Questions
- None currently.
