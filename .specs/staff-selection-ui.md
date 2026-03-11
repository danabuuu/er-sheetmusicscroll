# Feature: Visual Staff Selection UI

## Requirements
- After uploading a PDF, user sees each page rendered with numbered bounding boxes overlaid on every detected staff
- User clicks one staff in any system to set it as the global default — all matching staff indices highlight across all pages
- User can click a different staff in any individual system to override just that system (shown in a distinct colour)
- A summary shows the current selection (e.g. "Staff 3 everywhere, except system 11: Staff 1")
- **Multiple voice parts**: A song may have more than one scroll image — e.g. both "Tenor" and "Bass". The UI allows the user to define multiple named voice parts, each with its own independent staff selection.
- Each voice part has a short user-editable label. Common values are `S`, `A`, `T`, `B` (and split-section variants `S1`, `S2`, `A1`, `A2`, `T1`, `T2`, `B1`, `B2`). Labels default to `S`, `A`, `T`, `B` in order as parts are added; beyond four the default falls back to "Part N".
- The user can add a new voice part ("+ Add Part") and remove any part that is not the last remaining one.
- Each voice part panel shows its own staff selection state (global default + per-system overrides) independently from other parts.
- User clicks "Build All" to trigger extraction for every defined part; each resulting PNG is shown inline for visual confirmation before saving.
- The final scroll image for each part uses fixed vertical padding around each staff strip (proportional to staff height) so that when viewed as a horizontal scroll, the staff lines appear at a consistent vertical position — creating the illusion of one continuous staff.
- On save, all parts (label + image URL) are stored together under the song.

## Data Shape

```ts
// One entry per named voice part
type SongPart = {
  label: string;       // e.g. "S", "A", "T", "B", "T1", "T2"
  imageUrl: string;    // URL of the stitched scroll PNG for this part
};

// songs table: image_url replaced by parts: SongPart[]
// Stored as a JSONB column or a separate song_parts join table.
```

## Tasks

### Prerequisite
- [ ] Scaffold the admin Next.js app (`admin/`) — see app-overview.md

### API routes
- [ ] `POST /api/analyze` — accept a PDF file upload, run `analyzeScore()` from `lib/staff-extraction`, return `ScoreAnalysis` JSON + per-page image URLs
- [ ] `GET /api/pages/[jobId]/[pageIndex]` — serve a rendered page image (greyscale PNG) for display in the UI
- [ ] `POST /api/build` — accept `{ pdfJobId, parts: Array<{ label: string, selection: StaffSelection }> }`, call `buildScrollImage()` once per part, upload each PNG, return `Array<{ label: string, imageUrl: string }>`

### Frontend
- [ ] `/upload` page: PDF file picker → calls `/api/analyze` on submit → redirects to `/select/[jobId]`
- [ ] `/select/[jobId]` page: renders each page image with an SVG overlay of staff bounding boxes, numbered per system
- [ ] Parts panel: list of voice part cards, each with an editable label field and its own staff selection state
- [ ] "+ Add Part" button appends a new part card with a blank selection state and a default label
- [ ] "Remove" button on each part card (disabled when only one part remains)
- [ ] Global pick per part: clicking a staff box in a part's active card sets that part's global default and highlights all matching indices in yellow
- [ ] Per-system override per part: clicking a different box in a system marks it orange for that part; double-click resets to that part's global default
- [ ] Selection summary panel per part listing that part's global default and any per-system overrides
- [ ] "Build All" button → calls `/api/build` with all parts → displays each resulting PNG inline, labelled by part name
- [ ] "Save to Library" button to save all part images and enter song metadata (title, BPM) — wires into the songs DB with a `parts` array

## Open Questions
- None currently.
