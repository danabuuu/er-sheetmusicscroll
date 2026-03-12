# Feature: Setlist Selection & Sequential Playback

## Background

BandTracker manages setlists ("gigs") in the same Supabase project (`yhchfhhdrfcotlvyoogz`). The glasses app shares the `songs` table, so `song_id` values are directly compatible.

**Setlist selection happens on the glasses** (not in admin). The user picks a gig directly from the Even Hub glasses app. Bandtracker's only role here is creating and managing gigs — it never pushes a gig to the glasses.

## BandTracker Schema (confirmed from source)

```
gigs           { id, name, venue, date, time, notes }
setlist_items  { gig_id, song_id, position }
songs          { id, title, tempo, scroll_url, beats_in_scroll, ... }  ← shared table
```

## Requirements

- The glasses app fetches all available gigs from Supabase on startup and displays them as a selectable list
- The user picks a gig via the glasses controls (temple/ring gesture); the setlist is loaded and a preview of the first song is shown
- The setlist does **not** start playing until the user explicitly confirms ("▶ Start")
- Songs play sequentially: when one scroll ends, the next loads automatically without any admin input
- Playback controls (Play / Pause / +BPM / -BPM / → Step / ← Back) work as described in `glasses-playback.md`
- When the last song ends the app returns to the gig selection state and shows "Setlist complete"
- Songs without a `scroll_url` are skipped

## UX Flow

```
Glasses app — idle/selection state
  On startup: query Supabase `gigs` table (ordered by date)
  Controls list shows gig names; user scrolls + selects via temple or ring
  → selectGig(gigId)

Glasses app — part selection state
  Fetch all songs for the gig; collect unique part labels (from songs.parts[].label)
  If only one label (or none): skip this state
  Controls list shows part labels (e.g. "T", "B") + "← Back to gigs"
  User selects their voice part → selectedPart = label
  → enterReady()

Glasses app — ready state
  Resolve first song's scroll URL: parts.find(p => p.label === selectedPart)?.imageUrl ?? scroll_url
  Pre-fetch scroll PNG → show preview in image containers
  Controls list: ["▶ Start", "← Back"]
  User selects "▶ Start" → begin playback from song 0
  User selects "← Back" → return to part selection (or idle if skipped)

Glasses app — playing state
  playSetlistFrom(songs, 0) → resolve + play songs[0], on end call playSetlistFrom(songs, 1)
  When exhausted: show "Setlist complete", return to idle state
```

## Data Access

The glasses app queries Supabase directly (same credential pattern as existing `now_playing` fetch):

```ts
// Fetch all gigs
supabase.from('gigs').select('id, name, venue, date').order('date', { ascending: false })

// Fetch ordered songs for a gig
supabase.from('setlist_items')
  .select('position, songs(id, title, tempo, scroll_url, beats_in_scroll)')
  .eq('gig_id', gigId)
  .not('songs.scroll_url', 'is', null)
  .order('position')
```

## Optional: API routes

`GET /api/gigs` and `GET /api/gigs/[id]/songs` may be implemented as server-side alternatives to direct Supabase access (useful if Supabase credentials should not appear in the client bundle). These are not required for the initial implementation.

## Optional: `now_playing` visibility

The glasses may optionally write the active `gig_id` and `song_id` to the `now_playing` table as playback advances, so external tools (e.g. Bandtracker) can display what is currently playing. This is not required for playback to function.

If implemented, add a nullable `gig_id` column:
```sql
ALTER TABLE now_playing ADD COLUMN gig_id integer;
```

## Tasks

### Glasses App (`glasses/Main.ts`)
- [ ] `fetchGigs()` — query Supabase `gigs` table, return `{ id, name, date }[]` ordered by date desc
- [ ] `fetchSetlistSongs(gigId)` — join `setlist_items` → `songs`, order by `position`; return `Song[]` (including `parts` field)
- [ ] Implement `AppState` enum: `IDLE | PART_SELECT | READY | PLAYING`
- [ ] IDLE: call `fetchGigs()` on entry; `updateListData(gigNames)` on controls list
- [ ] IDLE `onEvenHubEvent`: selecting index N → `selectGig(gigs[N].id)`
- [ ] `selectGig(gigId)`: fetch songs; collect unique part labels; if ≤1 label skip to `enterReady(selectedPart)`; else populate part list + "← Back to gigs", set state PART_SELECT
- [ ] PART_SELECT `onEvenHubEvent`: selecting a label → `enterReady(label)`; last item ("← Back") → return to IDLE
- [ ] `enterReady(selectedPart)`: resolve first song's scroll URL via `parts.find(p => p.label === selectedPart)?.imageUrl ?? scroll_url`; pre-load PNG; `updateListData(['▶ Start', '← Back'])`, set state READY
- [ ] READY `onEvenHubEvent`: index 0 → `playSetlistFrom(songs, 0)`; index 1 → back to PART_SELECT (or IDLE if skipped)
- [ ] `resolveScrollUrl(song, selectedPart)` — helper: find matching part URL or fall back to `scroll_url`; return null if neither exists (song will be skipped)
- [ ] `playSetlistFrom(songs, index)` — resolve URL, load, start tick loop; on scroll end call `playSetlistFrom(songs, index + 1)`; when exhausted: set status "Setlist complete", return to IDLE
- [ ] PLAYING `onEvenHubEvent`: Play / Pause / +BPM / -BPM / → Step / ← Back (see `glasses-playback.md`)

### Optional
- [ ] Write active `gig_id` + `song_id` to `now_playing` during playback for external visibility
- [ ] `GET /api/gigs` and `GET /api/gigs/[id]/songs` Admin API routes as server-side alternative

## Open Questions
- None — schema confirmed, approach agreed.
