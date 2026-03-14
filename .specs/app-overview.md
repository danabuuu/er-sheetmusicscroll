# Feature: ER Sheet Music Scroll — App Overview

## Requirements
- User can upload a PDF of sheet music and process it within Bandtracker (which calls the Vercel API)
- User can isolate a specific staff/voice line (e.g. Tenor) from the PDF automatically, with the ability to manually override the selection
- User can process the same PDF multiple times for different voice parts (e.g. Tenor, Bass), each producing a separate scroll image
- User can attach metadata to a song: title, optional artist, playback tempo (BPM), and total beats in the scroll image
- User can rename or delete songs in their library
- User can create setlists (gigs) in Bandtracker by selecting songs and ordering them
- On the glasses, the user browses available setlists (gigs), selects one, and waits to start until they press a button
- During playback, the music scrolls horizontally across the Even Realities G2 glasses display; the user can choose auto-advance (driven by BPM + beats timing) or manual step-through (forward/back via ring or temple gesture)
- User can pause playback and adjust tempo on the fly during a session
- When one song ends, the next song in the setlist loads and plays automatically
- Scroll image displays 2 staff rows stacked vertically (one column = two systems), showing more music at once

## Architecture Notes

### Three-Part Architecture

| Part | Repo | Hosting | Tech | Purpose |
|------|------|---------|------|---------|
| **Bandtracker** | [danabuuu/BandTracker](https://github.com/danabuuu/BandTracker) | GitHub Pages | Static site | Setlist/gig management **+** score processing UI: PDF upload, staff selection, scroll building, song library. **This is the active UI for strip building — work on strip-building features happens here, not in `admin/`.** |
| **Processing API** | this repo (`admin/`) | Vercel | Next.js API routes only — no UI pages | Server-side PDF rendering, staff detection, scroll image building; exposes REST endpoints called by Bandtracker. The `admin/app/upload/` and `admin/app/select/` UI pages are legacy reference code — **do not develop new features there.** |
| **Glasses app** | this repo (`glasses/`) | GitHub Pages | Vite + Even Hub SDK | Even Hub display client — browse setlists, wait to start, then scroll sheet music on G2 glasses |

All three parts share the **same Supabase project** for data and storage.

### Why the split
- PDF processing (`mupdf`, `sharp`) requires a persistent Node.js server — it can't run in a browser or on a serverless/edge platform
- Bandtracker is a static GitHub Pages site, so it delegates all heavy processing to the Vercel-hosted API via HTTP
- The glasses app only needs to read `now_playing` at runtime — no processing needed

### Processing API (this repo — `admin/`)
- Lives at `admin/` in this repo; deployed to Vercel
- **API routes only** — no active UI pages
- The `admin/app/upload/` and `admin/app/select/` folders are **legacy reference code** from before Bandtracker had parity. They are not used in production and should not receive new feature work. They will be deleted once confirmed redundant.
- All strip-building UI work (preview, nudge buttons, setlist view, etc.) is done in the **Bandtracker** repo, not here.
- Exposes: `POST /api/analyze`, `GET /api/pages/[jobId]/[pageIndex]`, `POST /api/detect-staff`, `POST /api/build`, `GET /api/songs`, `GET /api/now-playing`, `PUT /api/now-playing`
- Intermediate job files (PDF + rendered page PNGs) stored in Supabase Storage (`jobs` bucket) since Vercel has no persistent disk
- Vercel environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- CORS must allow requests from `https://danabuuu.github.io` (Bandtracker) and the glasses app origin

### Even Hub (Glasses App — this repo — `glasses/`)
- Static Vite build deployed to GitHub Pages from this repo
- The Even Realities phone app loads the GitHub Pages URL and renders it on the glasses
- SDK bridge: `import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'`
- Display SDK coordinate space: **576×288** (physical resolution is higher)
- Layout: controls list (`ListContainerProperty`, 576×160 at top), three image containers side-by-side (192×100 each, total 576×100 at bottom)
- **App states**: idle/selection → part selection (pick voice part if setlist has multiple) → ready (waiting to start) → playing (auto or manual scroll)
- `VITE_ADMIN_URL` env var points to the Vercel-hosted Processing API URL (e.g. `https://er-sheetmusicscroll.vercel.app`)
- Test locally with Vite dev server: `vite --host 0.0.0.0 --port 5173`; test with `evenhub-simulator [VITE_URL]`

### Tooling (Even Hub)
```sh
# Install Even Hub CLI (global)
sudo npm install -g @evenrealities/evenhub-cli

# Install Even Hub SDK in glasses app project
npm install @evenrealities/even_hub_sdk

# Install Even Hub Simulator (global)
sudo npm install -g @evenrealities/evenhub-simulator

# Install Vite (global)
sudo npm install -g vite@latest
```

### Data Fetching
- **Bandtracker** → calls Processing API (Vercel) for all PDF/image operations; reads/writes Supabase directly for song library and setlist data
- **Glasses app** → reads `gigs`/`setlist_items`/`songs` from Supabase directly for gig selection and playback; fetches scroll PNGs from Supabase Storage; optionally writes selected `gig_id` to `now_playing` for external visibility

### Database (Supabase)
Current schema (Postgres via Supabase):

| Table | Columns | Notes |
|-------|---------|-------|
| `songs` | `id`, `title`, `artist`, `tempo`, `scroll_url`, `beats_in_scroll`, `parts`, `created_at` | `artist` optional. `scroll_url` is the legacy single-part URL (fallback). `parts` is a JSONB array `[{ label: string, imageUrl: string }]` for multi-voice support (e.g. S/A/T/B). |
| `now_playing` | `id` (always 1), `song_id`, `gig_id` | Written by the glasses when a gig or song is selected; readable externally. |
| `gigs` | `id`, `name`, `venue`, `date`, `time`, `notes` | Created and managed by BandTracker. |
| `setlist_items` | `gig_id`, `song_id`, `position` | Ordered list of songs per gig. Created and managed by BandTracker. |

### Other
- **Staff isolation**: Automatic detection of staff rows from the PDF, with per-system override capability
- **Persistence**: Songs stored in Supabase; scroll PNGs in Supabase Storage
- **Design**: Even Realities design tokens documented in `.github/instructions/even-hub.instructions.md`

## Tasks

### Processing API — this repo `admin/` → deployed to Vercel
- [x] Scaffold Next.js project with TypeScript (`admin/`)
- [x] CORS middleware (`admin/middleware.ts`) — allows requests from `https://danabuuu.github.io` and localhost in dev
- [x] `admin/.env.example` documenting required env vars
- [ ] Store intermediate job files (PDF + page PNGs) in Supabase Storage (`jobs` bucket) instead of local disk — required for Vercel's stateless/ephemeral environment
- [ ] Remove UI pages (`/upload`, `/select`) from `admin/` — UI has moved to Bandtracker _(do after Bandtracker has parity)_
- [ ] Set up database schema: `songs` (id, title, artist, tempo, scroll_url, beats_in_scroll, created_at), `now_playing` (id, song_id) — **currently managed directly in Supabase dashboard; no migration script yet**
- [ ] `POST /api/analyze` — saves PDF to Supabase Storage (`jobs` bucket), renders pages, stores page PNGs in Supabase Storage; returns job ID
- [x] `GET /api/pages/[jobId]/[pageIndex]` — serves cached page PNG
- [x] `POST /api/detect-staff` — manual staff grab at click Y
- [x] `POST /api/build` — builds scroll PNG, uploads to Supabase Storage, updates `songs.scroll_url`
- [x] `GET /api/songs` — returns all songs from DB
- [x] `GET /api/now-playing` / `PUT /api/now-playing` — gets/sets the currently queued song
- [ ] `POST /api/songs` — create a new song with title, artist, tempo
- [ ] `PATCH /api/songs/[id]` — rename, update tempo
- [ ] `DELETE /api/songs/[id]`
- [ ] Add `parts` JSONB column to `songs` for multi-voice support; update `/api/build` for serial per-part workflow

### Bandtracker — [danabuuu/BandTracker](https://github.com/danabuuu/BandTracker)

> **Porting note**: The admin UI (`admin/app/upload/page.tsx` and `admin/app/select/[jobId]/`) is the reference implementation to port. Remove those pages from `admin/` only after Bandtracker has parity.

#### Prerequisites (Processing API must be ready first)
- [ ] `POST /api/analyze` stores job files in Supabase Storage (not local disk) — required on Vercel
- [ ] `POST /api/songs` — create new song (title, artist, tempo)
- [ ] `PATCH /api/songs/[id]` — update title, tempo, parts
- [ ] `DELETE /api/songs/[id]`
- [ ] `POST /api/build` extended to accept `partLabel` and store result in `songs.parts` JSONB

#### Bandtracker pages to build
- [x] **Upload page** (`upload.html`): PDF file picker → `POST {SCROLL_API_URL}/api/analyze` on submit → redirect to `select.html?job=X&songId=X`
- [x] **Upload page**: accept `?songId=X` — when present, skip the song picker; show song name read-only
- [x] **Staff selection page** (`select.html`): fetch page images; render each page with SVG overlay of staff bounding boxes; clicking a box selects it; clicking outside calls `POST .../api/detect-staff` (green/dashed outline on success, size-estimated fallback on 404)
- [x] Staff selection: sidebar shows ordered scroll list, each entry removable; BPM, measures, label fields; dotted-line padding preview
- [x] **"Build & Finish"**: build scroll, save part, redirect to `index.html`
- [x] **"Build & Add Part"**: build scroll, save part, clear selections, stay on page (true loop)
- [x] Song metadata (BPM, measures) on select page; also editable from song library (see below)
- [x] **Library home page** (`index.html`): list all songs with edit/delete; gigs + setlist tab
- [x] **Song card**: show existing `parts` strips as label badges + small thumbnail previews; show `tempo` and `beats_in_scroll` values
- [x] **Song edit form**: add editable `tempo` and `measures` (beats_in_scroll) fields; saved via Supabase update
- [x] **"Create Strip" button** on each song card → opens `upload.html?songId=<id>`
- [x] **Setlist view**: for each song in a setlist, show strip-status badges (green clickable links when `imageUrl` present, plain green label if not) and inline thumbnail previews (36px) for parts that have an `imageUrl`; "+ Strip" link always visible
- [x] Back-navigation throughout: upload → library, select → library

#### Cleanup (after Bandtracker has parity)
- [ ] Remove `admin/app/upload/` and `admin/app/select/` UI pages from this repo
- [ ] Remove `admin/app/globals.css` and `admin/app/layout.tsx` if no longer needed

### Glasses App — this repo `glasses/` → deployed to GitHub Pages
- [x] Scaffold Even Hub app with `index.html` + `Main.ts` + Vite config (`glasses/`)
- [x] Install Even Hub SDK and wire up `waitForEvenAppBridge`
- [x] `createStartUpPageContainer` with three `ImageContainerProperty` (192×100 each, side-by-side) and one `ListContainerProperty` with `isEventCapture: 1`
- [x] **Idle/selection state**: on startup, fetch gig list from Supabase `gigs` table; populate controls list dynamically with gig names; user selects via temple gesture
- [x] **Ready state**: after gig selected, fetch `setlist_items` + `songs` for that gig; pre-load first song's scroll PNG into image containers; show "▶ Start" and "← Back" in controls list
- [x] **Playing state**: controls list shows ▶ Play / ⏸ Pause / +BPM / -BPM / → Step / ← Back
- [x] Auto-play tick loop: interval from BPM + `beats_in_scroll`, advance 576px per tick, push 3 slices to image containers
- [x] Manual step: → Step advances 576px, ← Back retreats 576px (clamp at 0 and scroll width)
- [x] Ring gesture: fires the same `listEvent` as temple — handled by existing `onEvenHubEvent`; no separate mapping needed
- [x] End of song: auto-load next song in setlist; when last song ends, return to idle/selection state
- [x] Test in Even Hub Simulator and on real G2 hardware
- [x] Configure GitHub Actions to build `glasses/` and deploy to GitHub Pages on push to `main`

## Open Questions
- ~~The root `package.json` currently has `@evenrealities/even_hub_sdk` installed at the workspace root. Move it into `glasses/` when that folder is scaffolded.~~ ✅ Done — SDK is now only in `glasses/package.json`.
