# Feature: ER Sheet Music Scroll — App Overview

## Requirements
- User can upload a PDF of sheet music to a web app
- User can isolate a specific staff/voice line (e.g. Tenor) from the PDF automatically, with the ability to manually override the selection
- User can attach metadata to a song: title, optional artist, and playback tempo (BPM)
- User can rename or delete songs in their library
- User can create a setlist by selecting songs and ordering them
- User can choose a song or setlist to play back
- During playback, the music scrolls horizontally across the Even Realities G2 glasses display at the configured tempo, delivered via Even Hub (the app is a website rendered onto the glasses through the Even Realities mobile app)
- User can pause playback and adjust tempo on the fly during a session
- Scroll image can display 1 or 2 staff rows stacked vertically, allowing 2 lines of music to be visible at once

## Architecture Notes

### Three-Part Architecture

| Part | Repo | Hosting | Tech | Purpose |
|------|------|---------|------|---------|
| **Bandtracker** | [danabuuu/BandTracker](https://github.com/danabuuu/BandTracker) | GitHub Pages | Static site | All user-facing UI: PDF upload, staff selection, scroll building, song library, setlist builder, now-playing control |
| **Processing API** | this repo (`admin/`) | Render (Node.js) | Next.js API routes only — no UI pages | Server-side PDF rendering, staff detection, scroll image building; exposes REST endpoints called by Bandtracker |
| **Glasses app** | this repo (`glasses/`) | GitHub Pages | Vite + Even Hub SDK | Even Hub display client — scrolls sheet music on G2 glasses |

All three parts share the **same Supabase project** for data and storage.

### Why the split
- PDF processing (`mupdf`, `sharp`) requires a persistent Node.js server — it can't run in a browser or on a serverless/edge platform
- Bandtracker is a static GitHub Pages site, so it delegates all heavy processing to the Render-hosted API via HTTP
- The glasses app only needs to read `now_playing` at runtime — no processing needed

### Processing API (this repo — `admin/`)
- Lives at `admin/` in this repo; deployed to Render as a Node.js service
- **API routes only** — no UI pages (upload/select pages have moved to Bandtracker)
- Exposes: `POST /api/analyze`, `GET /api/pages/[jobId]/[pageIndex]`, `POST /api/detect-staff`, `POST /api/build`, `GET /api/songs`, `GET /api/now-playing`, `PUT /api/now-playing`
- Uses `admin/tmp/` for ephemeral per-job file storage (PDF + rendered page PNGs); Render's disk is sufficient
- Render environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- CORS must allow requests from `https://danabuuu.github.io` (Bandtracker) and the glasses app origin

### Even Hub (Glasses App — this repo — `glasses/`)
- Static Vite build deployed to GitHub Pages from this repo
- The Even Realities phone app loads the GitHub Pages URL and renders it on the glasses
- SDK bridge: `import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'`
- Display SDK coordinate space: **576×288** (physical resolution is higher)
- Layout: controls list (`ListContainerProperty`, 576×160 at top), three image containers side-by-side (192×100 each, total 576×100 at bottom)
- `VITE_ADMIN_URL` env var points to the Render-hosted Processing API URL (e.g. `https://er-sheetmusicscroll.onrender.com`)
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
- **Bandtracker** → calls Processing API (Render) for all PDF/image operations; reads/writes Supabase directly for song library and setlist data
- **Glasses app** → calls `GET /api/now-playing` on the Processing API to get the current song and `scroll_url`; fetches the scroll PNG from Supabase Storage directly

### Database (Supabase)
Current schema (Postgres via Supabase):

| Table | Columns | Notes |
|-------|---------|-------|
| `songs` | `id`, `title`, `artist`, `tempo`, `scroll_url`, `beats_in_scroll`, `created_at` | `artist` is optional. `scroll_url` points to a PNG in the `scrolls` Supabase Storage bucket. Will gain a `parts` JSONB column for multi-voice support. |
| `now_playing` | `id` (always 1), `song_id` | Single-row table. `GET /api/now-playing` returns the current song; `PUT /api/now-playing { songId }` sets it. |

### Other
- **Staff isolation**: Automatic detection of staff rows from the PDF, with per-system override capability
- **Persistence**: Songs stored in Supabase; scroll PNGs in Supabase Storage
- **Design**: Even Realities design tokens documented in `.github/instructions/even-hub.instructions.md`

## Tasks

### Processing API — this repo `admin/` → deployed to Render
- [x] Scaffold Next.js project with TypeScript (`admin/`)
- [x] CORS middleware (`admin/middleware.ts`) — allows requests from `https://danabuuu.github.io` and localhost in dev
- [x] `render.yaml` Blueprint — defines web service, persistent disk mount at `/opt/render/project/src/tmp`, env vars
- [x] `TMP_DIR` env var support in `admin/lib/jobs.ts` — defaults to `<cwd>/tmp` locally, uses Render disk path in production; dir created at startup
- [x] `admin/.env.example` documenting required env vars
- [ ] Remove UI pages (`/upload`, `/select`) from `admin/` — UI has moved to Bandtracker _(do after Bandtracker has parity)_
- [ ] Set up database schema: `songs` (id, title, artist, tempo, scroll_url, beats_in_scroll, created_at), `now_playing` (id, song_id) — **currently managed directly in Supabase dashboard; no migration script yet**
- [x] `POST /api/analyze` — saves PDF to `admin/tmp/`, renders pages, runs staff detection
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
- [ ] Add PDF upload page: file picker → `POST {SCROLL_API_URL}/api/analyze` → redirect to staff selection
- [ ] Add staff selection page: calls `GET {SCROLL_API_URL}/api/pages/[jobId]/[pageIndex]`, `POST /api/detect-staff`, `POST /api/build`
- [ ] Add song library page: list, rename, delete songs; calls Processing API
- [ ] Add setlist creation UI: pick songs, drag to reorder, save to Supabase
- [ ] Add now-playing control: pick song/setlist, calls `PUT {SCROLL_API_URL}/api/now-playing`
- [ ] `SCROLL_API_URL` env var pointing to the Render Processing API

### Glasses App — this repo `glasses/` → deployed to GitHub Pages
- [x] Scaffold Even Hub app with `index.html` + `Main.ts` + Vite config (`glasses/`)
- [x] Install Even Hub SDK and wire up `waitForEvenAppBridge`
- [x] On startup, call `createStartUpPageContainer` with three `ImageContainerProperty` (192×100 each, side-by-side at x=0/192/384, y=188) and one `ListContainerProperty` (▶ Play / ⏸ Pause / +BPM / -BPM / → Step / ← Back at y=0) with `isEventCapture: 1`
- [x] Poll `GET /api/now-playing` on the Render API for the current song; fetch scroll PNG and decode into pixel slices via `OffscreenCanvas`
- [x] Implement playback loop: on each tick (interval derived from BPM), crop next three 192px-wide slices and push to the three image containers
- [x] Handle `onEvenHubEvent` listEvent: Play / Pause / +BPM / -BPM via temple gesture; → Step / ← Back for manual step-through mode
- [x] When scroll ends, poll for next song and restart loop
- [x] Test in Even Hub Simulator and on real G2 hardware
- [ ] Configure GitHub Actions to build `glasses/` and deploy to GitHub Pages on push to `main`
- [ ] Wire setlist playback: ordered queue of songs, auto-advance

## Open Questions
- ~~The root `package.json` currently has `@evenrealities/even_hub_sdk` installed at the workspace root. Move it into `glasses/` when that folder is scaffolded.~~ ✅ Done — SDK is now only in `glasses/package.json`.
