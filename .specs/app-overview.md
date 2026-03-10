# Feature: ER Sheet Music Scroll — App Overview

## Requirements
- User can upload a PDF of sheet music to a web app
- User can isolate a specific staff/voice line (e.g. Tenor) from the PDF automatically, with the ability to manually override the selection
- User can attach metadata to a song: title and playback tempo (BPM)
- User can rename or delete songs in their library
- User can create a setlist by selecting songs and ordering them
- User can choose a song or setlist to play back
- During playback, the music scrolls horizontally across the Even Realities G2 glasses display (640×350) at the configured tempo, delivered via Even Hub (the app is a website rendered onto the glasses through the Even Realities mobile app)
- User can pause playback and adjust tempo on the fly during a session

## Architecture Notes

### Two-App Structure
This project is split into two separate apps that share a database:

| App | Tech | Purpose |
|-----|------|---------|
| **Admin app** | Next.js + TypeScript | PDF upload, staff isolation, library management, setlist builder |
| **Glasses app** | Vite + TypeScript (Even Hub) | Playback view rendered on G2 glasses via Even Hub |

### Even Hub (Glasses App)
- The glasses app is a plain website: `index.html` in the project root + `Main.ts` as entry point
- Served locally with Vite: `vite -i [YOUR_IP] -p [PORT]`
- The Even Realities app on the user's phone connects to the Vite server and renders it on the glasses
- SDK bridge: `import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'`
- Display size: **640×350**
- Test with the Even Hub Simulator: `evenhub-simulator [VITE_IP]`

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
The glasses app fetches song/setlist data from the **admin app's Next.js API routes** (e.g. `GET /api/songs`, `GET /api/setlists`). No separate backend needed.

### Other
- **Staff isolation**: Automatic detection of staff rows from the PDF, with a manual crop-box override per page
- **Persistence**: Songs and setlists stored in a database (not localStorage)
- **Design**: Even Realities design tokens (colors, fonts, margins) are documented in `.github/instructions/even-hub.instructions.md`

## Tasks

### Admin App (Next.js)
- [ ] Scaffold Next.js project with TypeScript (`admin/`)
- [ ] Set up database schema: `songs` (id, title, tempo, image_url, created_at), `setlists` (id, name), `setlist_songs` (setlist_id, song_id, position)
- [ ] Build PDF upload UI and server-side storage (e.g. S3 or local disk)
- [ ] Render PDF pages server-side; auto-detect staff rows using image processing (e.g. detect horizontal line clusters)
- [ ] Show staff detection results to user with ability to manually adjust crop boxes per page
- [ ] Extract and stitch selected staff rows across all pages into one long horizontal image; store in database
- [ ] Build song metadata form (title, tempo BPM); save to database
- [ ] Build song library page with rename and delete actions
- [ ] Build setlist creation UI: pick songs from library, drag to reorder, save to database

### Glasses App (Even Hub / Vite)
- [ ] Scaffold Even Hub app with `index.html` + `Main.ts` + Vite config (`glasses/`)
- [ ] Install Even Hub SDK and wire up `waitForEvenAppBridge`
- [ ] On startup, call `createStartUpPageContainer` with one `ImageContainerProperty` (200×100, the scroll window) and one `ListContainerProperty` (playback controls: Play / Pause / +BPM / -BPM) with `isEventCapture: 1`
- [ ] Fetch current song/setlist from admin API and store scroll image URL
- [ ] Implement playback loop: on each tick (interval derived from BPM), crop next 200px-wide slice from scroll image and call `updateImageRawData` serially
- [ ] Handle `onEvenHubEvent` listEvent to respond to play/pause/tempo controls via temple gesture
- [ ] Wire setlist playback: on scroll image end, fetch next song and restart loop
- [ ] Test in Even Hub Simulator

## Open Questions
- The root `package.json` currently has `@evenrealities/even_hub_sdk` installed at the workspace root. Move it into `glasses/` when that folder is scaffolded.
