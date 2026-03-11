# Feature: Visual Staff Selection UI

## Requirements
- After uploading a PDF, user sees each page rendered with numbered bounding boxes overlaid on every detected staff
- User clicks one staff in any system to set it as the global default — all matching staff indices highlight across all pages
- User can click a different staff in any individual system to override just that system (shown in a distinct colour)
- A summary shows the current selection (e.g. "Staff 3 everywhere, except system 11: Staff 1")
- User can choose a 1-row or 2-row layout: 1-row produces one staff strip per column; 2-row stacks two consecutive strips vertically, making each column show two systems
- User can set vertical padding above and below the staff strip (as a fraction of staff height) to control how much whitespace surrounds the notes; a live amber overlay shows the padded capture region on the PDF page view
- User clicks "Build Scroll Image" to trigger extraction; the resulting PNG is shown for visual confirmation before saving
- The final scroll image uses the configured padding so that when viewed as a horizontal scroll, the staff lines appear at a consistent vertical position

## Tasks

### Prerequisite
- [x] Scaffold the admin Next.js app (`admin/`) — see app-overview.md

### API routes
- [x] `POST /api/analyze` — accept a PDF file upload, run `analyzeScore()` from `lib/staff-extraction`, return `ScoreAnalysis` JSON + per-page image URLs
- [x] `GET /api/pages/[jobId]/[pageIndex]` — serve a rendered page image (greyscale PNG) for display in the UI
- [x] `POST /api/build` — accept `{ pdfJobId, selection, rows, padAbove, padBelow }`, run `buildScrollImage()`, upload to Supabase Storage, return the public scroll URL

### Frontend
- [x] `/upload` page: PDF file picker → calls `/api/analyze` on submit → redirects to `/select/[jobId]`
- [x] `/select/[jobId]` page: renders each page image with an SVG overlay of staff bounding boxes, numbered per system
- [x] Global pick: clicking a staff box sets it as global default and highlights all matching indices in yellow
- [x] Per-system override: clicking a different box in a system marks it with a distinct highlight (orange); double-click resets to global
- [x] Selection summary panel listing the global default and any per-system overrides
- [x] Layout toggle: "1 row" / "2 rows" buttons in sidebar to set `rows` param sent to build API
- [x] Padding controls: "Pad above" and "Pad below" number inputs (step 0.05) in sidebar; amber dashed SVG overlay rect on page view shows the live padded capture region
- [x] "Build Scroll Image" button → calls `/api/build` → displays result PNG inline
- [x] "Save to Library" button to save the PNG and enter song metadata (title, BPM) — wires into Supabase `songs` table

## Open Questions
- None currently.
