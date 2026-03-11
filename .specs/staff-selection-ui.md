# Feature: Visual Staff Selection UI

## Requirements
- After uploading a PDF, user sees each page rendered with numbered bounding boxes overlaid on every detected staff
- User clicks one staff in any system to set it as the global default — all matching staff indices highlight across all pages
- User can click a different staff in any individual system to override just that system (shown in a distinct colour)
- A summary shows the current selection (e.g. "Staff 3 everywhere, except system 11: Staff 1")
- **Multiple voice parts are built one at a time in a serial workflow.** The user completes a full selection pass for one part, builds its scroll image, confirms it looks correct, and then moves on to the next part. There is no side-by-side multi-part editing panel.
- Each part has a short user-editable label. Common values are `S`, `A`, `T`, `B` (and split-section variants `S1`, `S2`, `A1`, `A2`, `T1`, `T2`, `B1`, `B2`). The label field is pre-filled with the next default in `S → A → T → B` order; beyond four it defaults to "Part N".
- After a part's image is built and confirmed, the user can either "Save Part & Add Another" (clears all selections and starts a fresh pass) or "Save Part & Finish" to proceed to the song metadata form.
- Because parts are built independently, each part can have its own vertical padding setting, and the same staff position can be selected for more than one part across different systems without conflict.
- The final scroll image for each part uses fixed vertical padding around each staff strip (proportional to staff height) so that when viewed as a horizontal scroll, the staff lines appear at a consistent vertical position — creating the illusion of one continuous staff.
- On save, all completed parts (label + image URL) are stored together under the song.

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

## Workflow (per-part serial loop)

```
Upload PDF
  → /select/[jobId] (Step 1 of N)
      ├── Enter label for this part (pre-filled)
      ├── Make staff selections across all systems
      ├── Set vertical padding for this part
      ├── "Build Scroll Image" → preview PNG
      └── Confirm
            ├── "Save Part & Add Another" → clear selections, increment label default, repeat
            └── "Save Part & Finish" → proceed to song metadata form
  → Song metadata form (title, BPM)
  → Save to library (all parts persisted together)
```

## Tasks

### Prerequisite
- [ ] Scaffold the admin Next.js app (`admin/`) — see app-overview.md

### API routes
- [ ] `POST /api/analyze` — accept a PDF file upload, run `analyzeScore()` from `lib/staff-extraction`, return `ScoreAnalysis` JSON + per-page image URLs
- [ ] `GET /api/pages/[jobId]/[pageIndex]` — serve a rendered page image (greyscale PNG) for display in the UI
- [ ] `POST /api/build` — accept `{ pdfJobId, label: string, selection: StaffSelection, paddingPx?: number }`, call `buildScrollImage()`, upload the PNG, return `{ label: string, imageUrl: string }`
- [ ] `POST /api/songs` — accept `{ title, tempo, parts: SongPart[] }`, persist to DB, return the created song

### Frontend
- [ ] `/upload` page: PDF file picker → calls `/api/analyze` on submit → redirects to `/select/[jobId]`
- [ ] `/select/[jobId]` page: renders each page image with an SVG overlay of staff bounding boxes, numbered per system; shows label field, padding control, and current selection state
- [ ] Global pick: clicking a staff box sets it as global default and highlights all matching indices in yellow
- [ ] Per-system override: clicking a different box in a system marks it orange; double-click resets to global
- [ ] Selection summary panel listing the global default and any per-system overrides
- [ ] Vertical padding control (slider or number input) applied per-part at build time
- [ ] "Build Scroll Image" button → calls `/api/build` → displays result PNG inline for confirmation
- [ ] "Save Part & Add Another" button → appends completed part to in-progress list, clears selections, advances label default, resets padding to default
- [ ] "Save Part & Finish" button → appends final part, advances to song metadata form
- [ ] Song metadata form: title and BPM inputs, "Save to Library" → calls `/api/songs` with all accumulated parts

## Open Questions
- None currently.
