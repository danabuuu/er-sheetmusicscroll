# Feature: Glasses Playback App

## Requirements
- On startup the app connects to the Even Hub SDK bridge and registers a layout of 4 containers: one controls list (Play / Pause / +BPM / -BPM) and three side-by-side image containers filling the full 576px display width
- The app polls Supabase `now_playing` for the current song; when a song with a scroll URL appears it downloads the PNG and begins playback automatically
- During playback, each tick advances the scroll by one full screen width (576 source pixels) and pushes three 192px-wide slices to the three image containers simultaneously
- Tick interval is derived from BPM and the `beats_in_scroll` value stored with the song, ensuring musical timing is accurate regardless of scroll image width
- Temple gestures (via the Even Hub list event) control Play, Pause, BPM up, and BPM down
- When the scroll reaches the end of the image the app auto-advances: polls for the next song and restarts playback
- If no song is queued the app polls at a fixed interval and displays a waiting message in the browser status div
- BPM changes are reflected immediately in playback speed and shown in the HTML status line

## Architecture

### Container layout (SDK coordinate space 576×288)
| Container | ID | Type | Position | Size |
|---|---|---|---|---|
| Controls list | 2 | `ListContainerProperty` (isEventCapture:1) | 0, 0 | 576×160 |
| Scroll left | 1 | `ImageContainerProperty` | 0, 188 | 192×100 |
| Scroll mid | 3 | `ImageContainerProperty` | 192, 188 | 192×100 |
| Scroll right | 4 | `ImageContainerProperty` | 384, 188 | 192×100 |

### Key constants
- `FRAME_W = 192` — width of each image container and each source slice
- `FRAME_H = 100` — height of each image container
- `SOURCE_SLICE_W = 192` — source pixels consumed per container per frame
- `PIXELS_PER_BEAT = 576` — source pixels advanced per tick (3 containers × 192)
- `RENDER_DPI = 300` (set in `lib/staff-extraction`)

### Scroll image format
- Width: multiple of 576px (one column = 576px = one full screen)
- Height: 100px
- Produced by admin build with `rows=2`: pairs of staves stacked 50px each into 100px columns, each column scaled to 576×100

## Tasks
- [x] Scaffold `glasses/` with `index.html`, `Main.ts`, `vite.config.ts`
- [x] Install `@evenrealities/even_hub_sdk` in `glasses/`
- [x] Wire `waitForEvenAppBridge` and `setStatus` helper
- [x] Define container layout constants (`FRAME_W`, `FRAME_H`, `PIXELS_PER_BEAT`, container IDs)
- [x] `createStartUpPageContainer` with 3 image containers + 1 controls list container
- [x] `fetchNowPlaying()` — fetch current song from Supabase `now_playing` (with `songs` join)
- [x] `fetchScrollPixels(url)` — download scroll PNG, decode to raw RGBA pixel buffer via canvas
- [x] `extractSlice(pixels, w, h, xOffset)` — crop a 192×100 slice and encode to `ImageRawDataUpdate`-compatible format
- [x] `sendFrame()` — extract 3 slices at `xOffset`, `xOffset+192`, `xOffset+384` and push to LEFT/MID/RIGHT containers in parallel
- [x] `scheduleTick()` — compute interval from BPM + `beats_in_scroll`, call `sendFrame`, advance `xOffset`, recurse
- [x] `loadAndPlay()` — poll for song, download pixels, send first frame, start tick loop
- [x] `onEvenHubEvent` handler for Play / Pause / +BPM / -BPM gestures
- [x] Auto-advance at end of scroll: call `loadAndPlay()` again
- [x] Cache-bust scroll image URL with `?t=Date.now()` to force re-fetch on re-build

## Open Questions
- None currently.
