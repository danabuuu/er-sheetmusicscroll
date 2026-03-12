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

Glasses app — ready state
  Query `setlist_items` JOIN `songs` for gigId; filter scroll_url IS NOT NULL; order by position
  Pre-fetch first song scroll PNG → show preview in image containers
  Controls list: ["▶ Start", "← Back to gigs"]
  User selects "▶ Start" → begin playback from song 0
  User selects "← Back to gigs" → return to idle state

Glasses app — playing state
  playSetlistFrom(songs, 0) → play songs[0], on end call playSetlistFrom(songs, 1)
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
- [ ] `fetchSetlistSongs(gigId)` — join `setlist_items` → `songs`, filter `scroll_url IS NOT NULL`, order by `position`; return `Song[]`
- [ ] Implement `AppState` enum: `IDLE | READY | PLAYING`
- [ ] IDLE: call `fetchGigs()` on entry; `updateListData(gigNames)` on controls list
- [ ] IDLE `onEvenHubEvent`: selecting index N → `selectGig(gigs[N].id)`
- [ ] `selectGig(gigId)`: fetch songs, pre-load first scroll PNG, transition to READY state; `updateListData(['▶ Start', '← Back to gigs'])`
- [ ] READY `onEvenHubEvent`: index 0 → `playSetlistFrom(songs, 0)`; index 1 → return to IDLE
- [ ] `playSetlistFrom(songs, index)` — load `songs[index]`, start tick loop; on scroll end call `playSetlistFrom(songs, index + 1)`; when exhausted: set status "Setlist complete", return to IDLE
- [ ] PLAYING `onEvenHubEvent`: Play / Pause / +BPM / -BPM / → Step / ← Back (see `glasses-playback.md`)

### Optional
- [ ] Write active `gig_id` + `song_id` to `now_playing` during playback for external visibility
- [ ] `GET /api/gigs` and `GET /api/gigs/[id]/songs` Admin API routes as server-side alternative

## Open Questions
- None — schema confirmed, approach agreed.
