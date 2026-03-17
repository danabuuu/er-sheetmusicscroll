# Feature: Glasses Playback App

## Requirements
- On startup the app connects to the Even Hub SDK bridge and registers a layout of 4 containers: one controls list and three side-by-side image containers filling the full 576px display width
- The app operates in four states: **idle/voice selection**, **setlist selection**, **ready**, and **playing** (plus a **confirm exit** overlay described below)

### Idle / voice selection state
- On startup (and after a setlist completes or the user exits), display a status of "Choose your voice part" and show four items: **Soprano**, **Alto**, **Tenor**, **Bass**
- The user selects their voice part using the temple or ring gesture; the selection is stored internally as the single character S / A / T / B
- Pre-fetches the full gig list from Supabase in the background while the user is choosing

### Setlist selection state
- After the user picks a voice part, all gigs are fetched (from cache if already loaded)
- Each gig's setlist is fetched in parallel; only gigs that contain **at least one song with a strip for the chosen voice** are shown
- If no gigs match, show "No [Voice] setlists" with a "← Back" item
- Otherwise display the matching gig names in the controls list, plus a final "← Back" item
- Selecting a gig loads its setlist; if no song has the chosen voice, shows an error and stays on this screen
- "← Back" returns to the idle/voice selection state

### Ready state
- After a gig is selected, resolve the scroll URL for the first song using the chosen voice (single-char prefix match against `parts[].label`)
- Pre-load the first song's scroll PNG into the image containers as a preview
- Controls list shows: **▶ Start** and **← Back**
- The setlist does not begin scrolling until the user explicitly selects "▶ Start"
- "← Back" returns to setlist selection

### Playing state
- Songs start in **manual/paused mode** — the scroll is shown at the first frame but the tick loop does not start until the user selects "▶ Play"
- **Auto mode**: each tick advances the scroll by one full screen width (576 source pixels) and pushes three 192px-wide slices to the three image containers simultaneously; tick interval is derived from BPM + `beats_in_scroll` for accurate musical timing
- **Manual mode**: when the user selects "→ Step" or "← Back", the scroll advances or retreats by one full screen (576px); the tick loop is paused in manual mode
- Temple and ring gestures (via Even Hub list event) trigger controls: Play, Pause, +BPM, -BPM, Step forward, Step back
- BPM changes are reflected immediately and shown in the HTML status line
- When one scroll image ends during auto-play, the app automatically loads the next song in the setlist; stepping forward past the last frame also advances to the next song
- Songs with no strip for the chosen voice are **silently skipped** (no fallback to a different voice)
- When the last song ends, the app returns to the idle/voice selection state and shows "Setlist complete"
- **Double-click in PLAYING**: shows the confirm-exit dialog (see below)

### Confirm exit state
- Triggered by a double-click gesture while in the playing state
- Controls list shows three items: "Return to menu?", "← No", "✓ Yes"
- "← No" is focused by default — an accidental double-click resumes playing immediately
- Selecting "← No" (or the title row) resumes the playing state (re-shows playing controls)
- Selecting "✓ Yes" returns to the idle/voice selection state

### SDK gesture constraint
The Even Hub SDK provides no raw tap/long-press API. All temple input fires `listEvent.currentSelectItemIndex` for scroll/click events, or `sysEvent.eventType` for system gestures (including double-click). Ring gesture likely fires `listEvent` as well — handled by existing `onEvenHubEvent`; no separate mapping needed.

## Architecture

### Container layout (SDK coordinate space 576×288)
| Container | ID | Type | Position | Size |
|---|---|---|---|---|
| Controls list | 2 | `ListContainerProperty` (isEventCapture:1) | 0, 0 | 576×160 |
| Scroll left | 1 | `ImageContainerProperty` | 0, 188 | 192×100 |
| Scroll mid | 3 | `ImageContainerProperty` | 192, 188 | 192×100 |
| Scroll right | 4 | `ImageContainerProperty` | 384, 188 | 192×100 |

### Controls list — idle/voice selection state
List items are always: **Soprano**, **Alto**, **Tenor**, **Bass**. Selecting one stores the single-char voice code (S/A/T/B) and transitions to setlist selection state.

### Controls list — setlist selection state (dynamic)
List items are populated from gigs that have at least one song with a strip for the chosen voice, plus a final "← Back" item. Selecting a gig item transitions to ready state.

### Controls list — ready state
| Index | Label | Action |
|---|---|---|
| 0 | ▶ Start | Begin playback of the selected gig from song 0 |
| 1 | ← Back | Return to part selection (or idle if part selection was skipped) |

### Controls list — playing state
| Index | Label | Action |
|---|---|---|
| 0 | → Step | Advance one screen; if at last frame, load next song |
| 1 | ← Back | Retreat one screen (clamp at 0) |
| 2 | ▶ Play / ⏸ Pause | Toggle auto-play tick loop (label reflects current state) |
| 3 | + BPM | Increase tempo by step |
| 4 | - BPM | Decrease tempo by step |

The play/pause slot is a single toggle item whose label switches between "▶ Play" (paused) and "⏸ Pause" (playing). Songs always start paused; the tick loop only starts when the user selects "▶ Play".

### Controls list — confirm exit state
| Index | Label | Action |
|---|---|---|
| 0 | Return to menu? | Non-interactive title (treated as No if clicked) |
| 1 | ← No | Resume playing state |
| 2 | ✓ Yes | Return to idle/gig-selection state |

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
- [x] `scheduleTick()` — compute interval from BPM + `beats_in_scroll`, call `sendFrame`, advance `xOffset`, recurse; initial `sendFrame` in `playSetlistFrom` advances `xOffset` by `PIXELS_PER_BEAT` so the tick loop starts on column 1 (not column 0 again)
- [x] `playSetlistFrom(songs, index)` — resolve scroll URL for `songs[index]` using `selectedPart`; load, start tick loop; on scroll end call `playSetlistFrom(songs, index + 1)`; when exhausted return to idle state
- [x] `onEvenHubEvent` handler: Play / Pause / +BPM / -BPM
- [x] `onEvenHubEvent`: → Step (index 0) — advance `xOffset` by `PIXELS_PER_BEAT`; if at end of scroll, load next song via `playSetlistFrom`
- [x] `onEvenHubEvent`: ← Back (index 1) — retreat `xOffset` by `PIXELS_PER_BEAT`, clamp at 0, call `sendFrame()`
- [x] Ring gesture: fires the same `listEvent` as temple — handled by existing `onEvenHubEvent`; no separate mapping needed
- [x] Cache-bust scroll image URL with `?t=Date.now()` to force re-fetch on re-build
- [x] List rebuild skipped on Step/Back when already paused (avoids resetting SDK list selection to item 0)
- [x] Double-click detected via `sysEvent.eventType === DOUBLE_CLICK_EVENT` OR two clicks within 350 ms; triggers confirm-exit dialog
- [x] Confirm-exit state: `['Return to menu?', '← No', '✓ Yes']`; No resumes playing, Yes calls `enterIdle()`
- [x] Double-click timer reset on scroll events (prevents accidental trigger when moving between buttons)
