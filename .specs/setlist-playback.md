# Feature: Setlist Selection & Sequential Playback

## Background

BandTracker already manages setlists ("gigs") in the same Supabase project (`yhchfhhdrfcotlvyoogz`). The glasses app shares the same `songs` table, so `song_id` values are directly compatible.

**Setlist selection happens on the phone/admin** (not on the glasses). The user picks a gig in the admin app, which writes the `gig_id` to `now_playing`. The glasses app then fetches the ordered song list for that gig and plays them sequentially — no changes needed to the glasses list UI.

## BandTracker Schema (confirmed from source)

```
gigs           { id, name, venue, date, time, notes }
setlist_items  { gig_id, song_id, position }
songs          { id, title, tempo, scroll_url, beats_in_scroll, ... }  ← shared table
```

## Requirements

- The admin app shows a "Queue Gig" UI: a dropdown of all gigs from BandTracker, and a button that writes the chosen `gig_id` to `now_playing`
- The glasses app, when it detects a `gig_id` in `now_playing`, fetches the gig's song list (ordered by `position`, filtered to songs with `scroll_url`) and plays them sequentially
- Songs play sequentially: when a scroll image ends the app advances to the next song in the list without re-polling `now_playing`
- Playback controls (Play / Pause / +BPM / -BPM) continue to work exactly as they do now
- When the last song ends, playback stops and the status shows "Setlist complete"
- Single-song mode (current behaviour, `song_id` only, no `gig_id`) continues to work as a fallback

## Data Model Changes

### `now_playing` table
Add a nullable `gig_id` column:
```sql
ALTER TABLE now_playing ADD COLUMN gig_id integer;
```
When a gig is queued: `gig_id` is set. When a single song is queued: `gig_id` is null, `song_id` is set (existing behaviour unchanged).

## UX Flow

```
Admin / phone
  User visits admin app → "Queue" section shows list of gigs from BandTracker
  User picks a gig → PUT /api/now-playing { gigId: 3 }
    → upserts now_playing row: gig_id=3, song_id=null

Glasses app (polling loop)
  fetchNowPlaying() returns { gig_id: 3, song_id: null }
  → fetch GET /api/gigs/3/songs  (ordered, scroll_url only)
  → play songs[0], songs[1], … songs[N]
  → on each song end: advance index; if exhausted → "Setlist complete", stop

  fetchNowPlaying() returns { gig_id: null, song_id: 7 }  ← existing single-song path
  → play that one song (current behaviour)
```

## Admin API Routes (new)

### `GET /api/gigs`
Returns all gigs ordered by date descending:
```json
[{ "id": 3, "name": "Sunday Service", "date": "2026-03-09" }, ...]
```

### `GET /api/gigs/[id]/songs`
Joins `setlist_items` → `songs`, filters `scroll_url IS NOT NULL`, orders by `position`:
```json
[{ "id": 7, "title": "Song A", "tempo": 120, "scroll_url": "...", "beats_in_scroll": 96 }, ...]
```

### `PUT /api/now-playing` (extend existing)
Extend to accept `gigId?: number` (sets `gig_id`, clears `song_id`) or `songId?: number` (existing, clears `gig_id`):
```json
{ "gigId": 3 }   // queue a gig
{ "songId": 7 }  // queue a single song (existing)
```

## Tasks

### Database
- [ ] Add nullable `gig_id integer` column to `now_playing` in Supabase

### Admin API
- [ ] `GET /api/gigs` — query `gigs` table, return `id`, `name`, `date` ordered by `date` desc
- [ ] `GET /api/gigs/[id]/songs` — join `setlist_items` → `songs` on `song_id`, filter `scroll_url IS NOT NULL`, order by `setlist_items.position`
- [ ] `PUT /api/now-playing` — extend to accept `gigId` param; upsert `gig_id` and clear `song_id` (or vice versa)
- [ ] Extend `GET /api/now-playing` response to include `gig_id`

### Admin UI
- [ ] Add "Queue Gig" section to the admin home/library page
- [ ] Fetch gig list from `GET /api/gigs` on load; show as a dropdown or list
- [ ] "Queue" button next to each gig calls `PUT /api/now-playing { gigId }` and shows a confirmation

### Glasses App (`glasses/Main.ts`)
- [ ] Update `Song` / `NowPlaying` type to include optional `gig_id`
- [ ] In `loadAndPlay()`: after fetching `now_playing`, if `gig_id` is set → call `startGigPlayback(gigId)` instead of the single-song path
- [ ] `fetchGigSongs(gigId)` — `GET /api/gigs/[id]/songs`, return ordered array
- [ ] `startGigPlayback(gigId)` — fetch songs, then call `playSetlistFrom(songs, 0)`
- [ ] `playSetlistFrom(songs, index)` — load and play `songs[index]`; on scroll end call `playSetlistFrom(songs, index + 1)`; when exhausted set status "Setlist complete" and stop

## Open Questions
- None — schema confirmed, approach agreed.
