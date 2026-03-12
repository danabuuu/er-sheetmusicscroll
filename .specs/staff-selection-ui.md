# Feature: Visual Staff Selection UI

## Requirements
- After uploading a PDF, user sees each page rendered with numbered bounding boxes overlaid on every detected staff
- The user scrolls through the score system by system and clicks the staff they want for each system individually — there is no global default
- Clicked staves highlight in yellow; unselected staves are outlined but dim
- A progress indicator shows how many systems have been selected out of the total (e.g. "12 / 18 systems selected")
- **Manual staff grab**: automated detection does not always find every staff. If a system is missing or a staff was not outlined, the user can click anywhere on the page image outside a detected bounding box; the app infers the staff at that vertical position (using the same horizontal-projection detection on a narrow horizontal slice around the click point) and adds it as a selection for the nearest system.
- **Multiple voice parts are built one at a time in a serial workflow.** The user completes a full selection pass for one part, builds its scroll image, confirms it looks correct, and then moves on to the next part. There is no side-by-side multi-part editing panel.
- Each part has a short user-editable label. Common values are `S`, `A`, `T`, `B` (and split-section variants `S1`, `S2`, `A1`, `A2`, `T1`, `T2`, `B1`, `B2`). The label field is pre-filled with the next default in `S → A → T → B` order; beyond four it defaults to "Part N".
- After a part's image is built and confirmed, the user can either "Save Part & Add Another" (clears all selections and starts a fresh pass) or "Save Part & Finish" to proceed to the song metadata form.
- Because parts are built independently, each part can have its own vertical padding setting, and the same staff position can be selected for more than one part across different systems without conflict.
- The final scroll image for each part uses fixed vertical padding around each staff strip (proportional to staff height) so that when viewed as a horizontal scroll, the staff lines appear at a consistent vertical position — creating the illusion of one continuous staff.
- On save, all completed parts (label + image URL) are stored together under the song.
- A library home page shows all saved songs and provides navigation to upload a new PDF or queue a song for playback
- All pages have clear navigation: the select page has a link back to the library (or to upload a new PDF), and after saving a song the user can immediately start another upload

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
- [x] Processing API deployed to Render — see app-overview.md
- [ ] Bandtracker configured with `SCROLL_API_URL` env var pointing to the Render API

### Processing API routes (this repo `admin/` → Render)
- [x] `POST /api/analyze` — accept a PDF file upload, run `analyzeScore()` from `lib/staff-extraction`, return `ScoreAnalysis` JSON + per-page image URLs
- [x] `GET /api/pages/[jobId]/[pageIndex]` — serve a rendered page image (greyscale PNG) for display in the UI
- [x] `POST /api/detect-staff` — accept `{ jobId, pageIndex, yNatural: number }`, run `detectStaffAtPoint` on the cached page image, return a `StaffBox` or 404 if no staff found
- [x] `POST /api/build` — accept `{ jobId, staves: StaffBox[], songId?: number, tempo?: number }`, call `buildScrollImage()`, upload PNG to Supabase Storage (`scrolls` bucket), update `songs.scroll_url` and optionally `songs.tempo`, return the PNG with `X-Scroll-Url` header
- [ ] `GET /api/songs` — returns all songs from DB ✅ exists; `POST /api/songs` — create a new song with title, tempo, parts — **not yet implemented** (songs currently must be pre-created directly in Supabase)

### Bandtracker frontend (danabuuu/BandTracker)
- [ ] `/upload` page: PDF file picker → `POST {SCROLL_API_URL}/api/analyze` on submit → redirect to `/select/[jobId]`
- [ ] `/select/[jobId]` page: fetches page images from `GET {SCROLL_API_URL}/api/pages/[jobId]/[pageIndex]`; renders each page with an SVG overlay of staff bounding boxes; sidebar shows song picker and BPM field
- [ ] Clicking a staff box selects it (highlights yellow); clicking again deselects it
- [ ] Clicking outside any detected bounding box calls `POST {SCROLL_API_URL}/api/detect-staff` with the click's Y coordinate; on success, the returned `StaffBox` is added as a custom selection and rendered with a distinct (green/dashed) outline. If it returns 404, the client falls back to a size-estimated bounding box at the click Y using the median stave height on that page.
- [ ] Selection sidebar shows ordered scroll list; each entry can be removed individually or all cleared
- [ ] "Build Scroll" button → calls `POST {SCROLL_API_URL}/api/build` with the ordered `StaffBox[]` → auto-saves PNG to the selected song's `scroll_url` in Supabase and displays inline preview with download link
- [ ] Progress indicator showing "N / total staves selected"
- [ ] Library home page (`/`): list songs with Queue and delete actions; "Upload new PDF" button
- [ ] Back-navigation: upload page → library, select page → library; post-save "Upload another" button
- [ ] **Multi-part serial workflow** (future): label field, "Save Part & Add Another" / "Save Part & Finish" buttons; accumulate `parts: SongPart[]` and save to songs DB
- [ ] `POST /api/songs` for creating a new song inline — blocked on endpoint creation

## Open Questions
- None currently.
