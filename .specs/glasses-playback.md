# Feature: Glasses Playback App

## Requirements
- On startup the app connects to the Even Hub SDK bridge and registers a layout of 4 containers: one controls list and three side-by-side image containers filling the full 576px display width
- The app operates in four states: **idle/selection**, **part selection**, **ready**, and **playing** (described below)

### Idle / selection state
- On startup (and after a setlist completes), fetch the list of gigs from Supabase `gigs` table
- Display gig names as items in the controls list; user scrolls and selects using the temple or ring gesture
- The image containers show a welcome/instruction message or remain blank

### Part selection state
- After the user selects a gig, fetch its ordered song list from `setlist_items` joined with `songs`
- Collect all unique part labels across all songs in the setlist (from `songs.parts[].label`)
- If only one part label exists across the whole setlist (or no song has multiple parts), skip this state and proceed directly to ready
- Otherwise display the unique part labels as a controls list (e.g. "S", "A", "T", "B"); user selects their voice part
- "← Back to gigs" returns to the idle/selection state
- The selected part label is stored and used when resolving each song's scroll URL during playback
- If a song has no part matching the selected label, fall back to `scroll_url` (legacy single-part field); if that is also null, skip the song

### Ready state
- After the user selects a part (or the part-selection state was skipped), resolve the scroll URL for the first song using the selected part label
- Pre-load the first song's scroll PNG into the image containers as a preview
- Controls list shows two items: "▶ Start" and "← Back"
- The setlist does not begin scrolling until the user explicitly selects "▶ Start"
- "← Back" returns to part selection (or to idle if part selection was skipped)

### Playing state
- **Auto mode**: each tick advances the scroll by one full screen width (576 source pixels) and pushes three 192px-wide slices to the three image containers simultaneously; tick interval is derived from BPM + `beats_in_scroll` for accurate musical timing
- **Manual mode**: when the user selects "→ Step" or "← Back", or uses the ring gesture, the scroll advances or retreats by one full screen (576px); the tick loop is paused in manual mode
- Temple and ring gestures (via Even Hub list event) trigger controls: Play, Pause, +BPM, -BPM, Step forward, Step back
- BPM changes are reflected immediately and shown in the HTML status line
- When one scroll image ends, the app automatically loads the next song in the setlist without re-fetching the gig
- When the last song ends, the app returns to the idle/selection state and shows "Setlist complete"
- If a song has no `scroll_url` it is skipped

### SDK gesture constraint
The Even Hub SDK provides no raw tap/long-press API. All temple input fires `listEvent.currentSelectItemIndex`. Ring gesture likely fires the same event type — to be confirmed with SDK docs. "Manual advance" maps to selecting the "→ Step" list item (or ring push); "go backwards" maps to "← Back".

## Architecture

### Container layout (SDK coordinate space 576×288)
| Container | ID | Type | Position | Size |
|---|---|---|---|---|
| Controls list | 2 | `ListContainerProperty` (isEventCapture:1) | 0, 0 | 576×160 |
| Scroll left | 1 | `ImageContainerProperty` | 0, 188 | 192×100 |
| Scroll mid | 3 | `ImageContainerProperty` | 192, 188 | 192×100 |
| Scroll right | 4 | `ImageContainerProperty` | 384, 188 | 192×100 |

### Controls list — idle/selection state (dynamic)
List items are populated from the `gigs` table at runtime. Selecting a gig item transitions to part selection state.

### Controls list — part selection state (dynamic)
List items are the unique part labels collected from the setlist (e.g. `["S", "A", "T", "B"]`), plus a final "← Back to gigs" item. Selecting a part label transitions to ready state.

### Controls list — ready state
| Index | Label | Action |
|---|---|---|
| 0 | ▶ Start | Begin playback of the selected gig from song 0 |
| 1 | ← Back | Return to part selection (or idle if part selection was skipped) |

### Controls list — playing state
| Index | Label | Action |
|---|---|---|
| 0 | ▶ Play | Start auto-play tick loop |
| 1 | ⏸ Pause | Stop tick loop |
| 2 | + BPM | Increase tempo by step |
| 3 | - BPM | Decrease tempo by step |
| 4 | → Step | Advance one screen (clamp to scroll width) |
| 5 | ← Back | Retreat one screen (clamp at 0) |

### Key constants
- `FRAME_W = 192` — width of each image container and each source slice
- `FRAME_H = 100` — height of each image container
- `SOURCE_SLICE_W = 192` — source pixels consumed per container per frame
- `PIXELS_PER_BEAT = 576` — source pixels advanced per tick (3 containers × 192); also the step size for manual mode
- `RENDER_DPI = 300` (set in `lib/staff-extraction`)

### Scroll image format
- Width: multiple of 576px (one column = 576px = one full screen)
- Height: 100px
- Produced by admin build with `rows=2`: pairs of staves stacked 50px each into 100px columns, each column scaled to 576×100

## Deployment

The glasses app is a **static Vite build deployed to GitHub Pages** at:

```
https://danabuuu.github.io/er-sheetmusicscroll/
```

The Even Realities phone app loads this URL and renders the page on the G2 glasses.

Deployment is fully automated via `.github/workflows/deploy-glasses.yml`:
- Triggers on every push to `main` that touches `glasses/` (or the workflow file itself)
- Runs `npm run build` in `glasses/` with `CI=true`, which sets `base: '/er-sheetmusicscroll/'` in vite.config.ts
- Uploads `glasses/dist` to GitHub Pages via `actions/upload-pages-artifact` + `actions/deploy-pages`

**Local development:** `cd glasses && vite --host 0.0.0.0 --port 5173`, then point the simulator or phone app at `http://<your-local-ip>:5173`.

**Environment variable:** `VITE_ADMIN_URL` must be set (in `glasses/.env.local` for dev, or as a build secret in CI) to the Vercel Processing API URL.

## Tasks
- [x] Scaffold `glasses/` with `index.html`, `Main.ts`, `vite.config.ts`
- [x] Install `@evenrealities/even_hub_sdk` in `glasses/`
- [x] Wire `waitForEvenAppBridge` and `setStatus` helper
- [x] Define container layout constants (`FRAME_W`, `FRAME_H`, `PIXELS_PER_BEAT`, container IDs)
- [x] `createStartUpPageContainer` with 3 image containers + 1 controls list container

### Idle / selection state
- [x] On startup, query Supabase `gigs` table for all gigs (ordered by date desc)
- [x] Populate controls list (`updateListData`) with gig names; set `itemCount` to number of gigs
- [x] `onEvenHubEvent` in idle state: selecting a list item triggers `selectGig(gigId)`

### Part selection state
- [x] `selectGig(gigId)`: fetch `setlist_items` JOIN `songs` for the gig, order by `position` → store as `setlistSongs[]`
- [x] Collect unique part labels from `setlistSongs` (union of `song.parts.map(p => p.label)` across all songs)
- [x] If 0 or 1 unique labels: skip part selection, set `selectedPart = labels[0] ?? null`, proceed to `enterReady()`
- [x] Otherwise: `updateListData([...labels, '← Back to gigs'])`; set state to PART_SELECT
- [x] `onEvenHubEvent` in PART_SELECT: index for a label → `selectedPart = label`, call `enterReady()`; index for "← Back" → return to IDLE

### Ready state
- [x] `enterReady()`: resolve scroll URL for first song using `selectedPart` (match `song.parts.find(p => p.label === selectedPart)?.imageUrl ?? song.scroll_url`)
- [x] Pre-fetch and decode resolved scroll PNG; push to image containers as a static preview
- [x] Update controls list to ready state (2 items: "▶ Start", "← Back")
- [x] `onEvenHubEvent` in ready state: index 0 → `playSetlistFrom(setlistSongs, 0)`; index 1 → return to PART_SELECT (or IDLE if skipped)

### Playing state
- [x] `fetchScrollPixels(url)` — download scroll PNG, decode to raw RGBA pixel buffer via canvas
- [x] `extractSlice(pixels, w, h, xOffset)` — crop a 192×100 slice
- [x] `sendFrame()` — extract 3 slices at `xOffset`, `xOffset+192`, `xOffset+384`, push to LEFT/MID/RIGHT containers in parallel
- [x] `scheduleTick()` — compute interval from BPM + `beats_in_scroll`, call `sendFrame`, advance `xOffset`, recurse
- [x] `playSetlistFrom(songs, index)` — resolve scroll URL for `songs[index]` using `selectedPart`; load, start tick loop; on scroll end call `playSetlistFrom(songs, index + 1)`; when exhausted return to idle state
- [x] `onEvenHubEvent` handler: Play / Pause / +BPM / -BPM
- [x] `onEvenHubEvent`: → Step (index 4) — advance `xOffset` by `PIXELS_PER_BEAT`, clamp, call `sendFrame()`
- [x] `onEvenHubEvent`: ← Back (index 5) — retreat `xOffset` by `PIXELS_PER_BEAT`, clamp at 0, call `sendFrame()`
- [x] Ring gesture: fires the same `listEvent` as temple — handled by existing `onEvenHubEvent`; no separate mapping needed
- [x] Cache-bust scroll image URL with `?t=Date.now()` to force re-fetch on re-build
