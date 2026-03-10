# Feature: Visual Staff Selection UI

## Requirements
- After uploading a PDF, user sees each page rendered with numbered bounding boxes overlaid on every detected staff
- User clicks one staff in any system to set it as the global default — all matching staff indices highlight across all pages
- User can click a different staff in any individual system to override just that system (shown in a distinct colour)
- A summary shows the current selection (e.g. "Staff 3 everywhere, except system 11: Staff 1")
- User clicks "Build Scroll Image" to trigger extraction; the resulting PNG is shown for visual confirmation before saving
- The final scroll image uses fixed vertical padding around each staff strip (proportional to staff height) so that when viewed as a horizontal scroll, the staff lines appear at a consistent vertical position — creating the illusion of one continuous staff

## Tasks

### Prerequisite
- [ ] Scaffold the admin Next.js app (`admin/`) — see app-overview.md

### API routes
- [ ] `POST /api/analyze` — accept a PDF file upload, run `analyzeScore()` from `lib/staff-extraction`, return `ScoreAnalysis` JSON + per-page image URLs
- [ ] `GET /api/pages/[jobId]/[pageIndex]` — serve a rendered page image (greyscale PNG) for display in the UI
- [ ] `POST /api/build` — accept `{ pdfJobId, selection: StaffSelection }`, run `buildScrollImage()`, return the stitched PNG as a download

### Frontend
- [ ] `/upload` page: PDF file picker → calls `/api/analyze` on submit → redirects to `/select/[jobId]`
- [ ] `/select/[jobId]` page: renders each page image with an SVG overlay of staff bounding boxes, numbered per system
- [ ] Global pick: clicking a staff box sets it as global default and highlights all matching indices in yellow
- [ ] Per-system override: clicking a different box in a system marks it with a distinct highlight (orange); double-click resets to global
- [ ] Selection summary panel listing the global default and any per-system overrides
- [ ] "Build Scroll Image" button → calls `/api/build` → displays result PNG inline
- [ ] "Save to Library" button to save the PNG and enter song metadata (title, BPM) — wires into the songs DB

## Open Questions
- None currently.
