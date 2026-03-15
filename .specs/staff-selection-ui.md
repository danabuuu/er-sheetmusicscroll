# Feature: Visual Staff Selection UI

## Requirements
- The strip-creation workflow is accessed **from within a song's edit view**, not from a standalone upload page. The user opens a song, then triggers "Create Strip" to upload a PDF and process it for that song.
- `upload.html` accepts an optional `?songId=X` query parameter. When present, the song picker is hidden and the song is pre-selected (title shown read-only). When absent, the legacy song-picker dropdown is shown for backward compatibility.
- After uploading a PDF, user sees each page rendered with numbered bounding boxes overlaid on every detected staff
- The user scrolls through the score system by system and clicks the staff they want for each system individually — there is no global default
- Clicked staves highlight in yellow; unselected staves are outlined but dim
- A progress indicator shows how many systems have been selected out of the total (e.g. "12 / 18 systems selected")
- **Manual staff grab**: automated detection does not always find every staff. If a system is missing or a staff was not outlined, the user can click anywhere on the page image outside a detected bounding box; the app infers the staff at that vertical position (using the same horizontal-projection detection on a narrow horizontal slice around the click point) and adds it as a selection for the nearest system.
- **Multiple voice parts are built one at a time in a serial workflow.** The user completes a full selection pass for one part, builds its scroll image, confirms it looks correct, and then moves on to the next part. There is no side-by-side multi-part editing panel.
- Each part has a short user-editable label chosen from a fixed set: **S, A, T, B** (Soprano, Alto, Tenor, Bass), presented in that order as a dropdown. No free-text entry. When "Build & Add Part" succeeds, the dropdown auto-advances to the next unused label in S→A→T→B order.
- **"Build & Add Part"** builds the scroll, saves the part, clears all stave selections, and stays on the select page so the user can immediately begin selecting the next part's staves.
- **"Build & Finish"** builds the scroll, saves the part, and navigates back to `index.html` (the song library). The processing window closes conceptually and the user lands on their song library.
- Because parts are built independently, each part can have its own vertical padding setting, and the same staff position can be selected for more than one part across different systems without conflict.
- BPM (tempo) and measures (number of bars) can be set/updated on the select page. These values are also visible and editable on the song's edit view in the library.
- The final scroll image for each part uses fixed vertical padding around each staff strip (proportional to staff height) so that when viewed as a horizontal scroll, the staff lines appear at a consistent vertical position — creating the illusion of one continuous staff.
- On save, all completed parts (label + image URL) are stored together under the song via `PATCH /api/songs/[id]` with the full `parts` array.
- A library home page shows all saved songs; each song card shows its existing strips (label + thumbnail) and provides a "Create Strip" button to launch the upload → select workflow for that song.

## Data Shape

```ts
// One entry per named voice part
type SongPart = {
  label: string;       // e.g. "S", "A", "T", "B", "T1", "T2"
  imageUrl: string;    // URL of the stitched scroll PNG for this part
};

// songs table
// parts: SongPart[]  stored as JSONB
// tempo: number (BPM)
// beats_in_scroll: number (total beats = measures × beats-per-measure)
```

## Workflow (per-part serial loop)

```
index.html (Song Library)
  → user opens a song, clicks "Create Strip"
  → upload.html?songId=X

upload.html?songId=X
  Song name shown (read-only). PDF file picker.
  → POST /api/analyze → redirect to select.html?job=X&songId=X

select.html?job=X&songId=X
  ├── Set label for this part (pre-filled S→A→T→B)
  ├── Set BPM / measures (pre-populated from song if present)
  ├── Select staves across all pages
  ├── Set vertical padding (with live dotted-line preview)
  ├── "Build & Add Part" → build + save part → clear selections → stay on page
  └── "Build & Finish"   → build + save part → redirect to index.html
```

## Tasks

### Prerequisite
- [x] Processing API deployed to Vercel — see app-overview.md

### Processing API routes (this repo `admin/` → Vercel)
- [x] `POST /api/analyze` — accept a PDF file upload, store PDF in Supabase Storage, run `analyzeScore()`, return `ScoreAnalysis` JSON + job ID
- [x] `GET /api/pages/[jobId]/[pageIndex]` — serve a rendered page image (greyscale PNG) on demand
- [x] `POST /api/detect-staff` — accept `{ jobId, pageIndex, yNatural: number }`, run `detectStaffAtPoint`, return a `StaffBox` or 404
- [x] `POST /api/build` — accept `{ jobId, staves, songId, tempo, rows, padAbove, padBelow, partLabel }`, build scroll PNG, upload to Supabase Storage, update `songs.parts` JSONB and optionally `songs.tempo`, return PNG

### Bandtracker frontend (danabuuu/BandTracker)
- [x] `upload.html`: PDF file picker → `POST {SCROLL_API_URL}/api/analyze` → redirect to `select.html?job=X&songId=X`
- [x] `upload.html`: accept `?songId=X` — when present, skip the song picker and show song title read-only
- [x] `upload.html`: pass `returnTo` and `gigId` URL params through sessionStorage so select.html can return to the right place
- [x] `upload.html`: pass `beats_in_scroll` from song metadata through sessionStorage so select.html can pre-fill Bars field
- [x] `select.html`: fetch page images; SVG overlay; staff selection; padding preview dotted lines
- [x] `select.html`: clicking outside detected boxes calls `POST /api/detect-staff` (green dashed); fallback to size-estimated box on 404
- [x] `select.html`: sidebar — ordered scroll list, each entry removable; BPM + **part label dropdown (S/A/T/B, auto-advances to next unused on "Build & Add Part")** + measures fields
- [x] `select.html`: **"Build & Finish"** navigates to `index.html` after a successful build (or back to the originating setlist if `returnTo=setlist`)
- [x] `select.html`: **"Build & Add Part"** clears selections and stays on the page (true loop)
- [x] `select.html`: padding preview dotted lines update live as sliders change
- [x] `select.html`: BPM, bars, and beats/bar pre-filled from song metadata passed via sessionStorage
- [x] `select.html`: dismiss (×) button on each auto-detected stave box to hide bad detections without blocking manual clicks
- [x] `select.html`: ↑↓ nudge buttons rendered directly on the stave rectangle in the SVG overlay (top-left and bottom-left corners of the selected stave); nudge moves all four crop coords (top/bottom/lineTop/lineBottom) by 2 px per click; the rectangle redraws immediately from the nudged coords; padding preview (dotted lines) updates immediately
- [x] `index.html`: song card shows `tempo`, `beats_in_scroll`, and the list of existing `parts` (label badges + small thumbnail previews, clickable to open imageUrl)
- [x] `index.html`: song edit form includes editable `tempo` and `measures` fields (saved via Supabase update)
- [x] `index.html`: "Create Strip" button on each song card → `upload.html?songId=<id>`
- [x] `index.html`: setlist view shows strip indicator (green badges, clickable links when `imageUrl` present) for each song in the setlist; songs with `imageUrl` parts also show inline thumbnail `<img>` previews (36px tall); all songs always show a `+ Strip` link → `upload.html?songId=X&returnTo=setlist&gigId=Y`

## Open Questions
- None currently.
