# Feature: ER Sheet Music Scroll — App Overview

## Requirements
- User can upload a PDF of sheet music to a web app
- User can isolate a specific staff/voice line (e.g. Tenor) from the PDF automatically, with the ability to manually override the selection
- User can attach metadata to a song: title and playback tempo (BPM)
- User can rename or delete songs in their library
- User can create a setlist by selecting songs and ordering them
- User can choose a song or setlist to play back
- During playback, the music scrolls horizontally across the Even Realities G2 glasses display at the configured tempo, delivered via Even Hub (the app is a website rendered onto the glasses through the Even Realities mobile app)
- User can pause playback and adjust tempo on the fly during a session
- Scroll image can display 1 or 2 staff rows stacked vertically, allowing 2 lines of music to be visible at once

## Architecture Notes

### Two-App Structure
This project is split into two separate apps that share a database:

| App | Tech | Purpose |
|-----|------|---------|
| **Admin app** | Next.js + TypeScript | PDF upload, staff isolation, library management, setlist builder |
| **Glasses app** | Vite + TypeScript (Even Hub) | Playback view rendered on G2 glasses via Even Hub |

### Even Hub (Glasses App)
- The glasses app is a plain website: `index.html` in the project root + `Main.ts` as entry point
- Served locally with Vite: `vite --host 0.0.0.0 --port 5173`
- The Even Realities app on the user's phone connects to the Vite server and renders it on the glasses
- SDK bridge: `import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'`
- Display SDK coordinate space: **576×288** (physical resolution is higher)
- SDK constraints: max 4 containers total; one must have `isEventCapture: 1`; image containers max 200×100px each
- Layout: controls list (576×160 at top), three 192×100 image containers side-by-side filling 576×100 at the bottom
- Test with the Even Hub Simulator: `evenhub-simulator [VITE_URL]`

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
The glasses app fetches the current song from Supabase directly (`now_playing` table) and loads scroll images from Supabase Storage (`scrolls` bucket). The admin app exposes API routes (`/api/now-playing`) as an alternative.

### Database (Supabase)
- `songs` table: `id`, `title`, `tempo`, `scroll_url`, `beats_in_scroll`, `created_at`
- `scrolls` storage bucket: stores the stitched scroll PNG per song
- `now_playing` table: single-row table indicating which song is active

### Other
- **Staff isolation**: Automatic detection of staff rows from the PDF, with per-system override capability
- **Persistence**: Songs stored in Supabase; scroll PNGs in Supabase Storage
- **Design**: Even Realities design tokens documented in `.github/instructions/even-hub.instructions.md`

## Tasks

### Admin App (Next.js)
- [x] Scaffold Next.js project with TypeScript (`admin/`)
- [x] Set up database schema: `songs` (id, title, tempo, scroll_url, beats_in_scroll, created_at) in Supabase
- [x] Build PDF upload UI and server-side storage (Supabase Storage)
- [x] Render PDF pages server-side; auto-detect staff rows using image processing
- [x] Show staff detection results to user with ability to manually adjust selection per system
- [x] Extract and stitch selected staff rows across all pages into one long horizontal PNG; store in Supabase
- [x] Build song metadata form (title, tempo BPM); save to database
- [x] Build song library page with rename and delete actions
- [ ] Build setlist creation UI: pick songs from library, drag to reorder, save to database

### Glasses App (Even Hub / Vite)
- [x] Scaffold Even Hub app with `index.html` + `Main.ts` + Vite config (`glasses/`)
- [x] Install Even Hub SDK and wire up `waitForEvenAppBridge`
- [x] On startup, call `createStartUpPageContainer` with three `ImageContainerProperty` (192×100 each, side-by-side) and one `ListContainerProperty` (Play / Pause / +BPM / -BPM) with `isEventCapture: 1`
- [x] Fetch current song from Supabase `now_playing` table and load scroll image from Supabase Storage
- [x] Implement playback loop: on each tick (interval derived from BPM), crop next three 192px-wide slices from the scroll image and push to the three image containers
- [x] Handle `onEvenHubEvent` listEvent to respond to play/pause/tempo controls via temple gesture
- [x] Wire auto-advance: on scroll image end, fetch next song and restart loop
- [x] Test in Even Hub Simulator and on real G2 hardware

## Open Questions
- Setlist feature is not yet implemented.
