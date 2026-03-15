/**
 * ER Sheet Music Scroll — Glasses App
 *
 * Displays a horizontally scrolling sheet music strip on the Even Realities G2
 * glasses via the Even Hub SDK.
 *
 * Layout (576×288 SDK coordinates):
 *   - List container    [576×160] at (0, 0)     — navigation / playback controls
 *   - Image container L [192×100] at (0, 188)   — left third of the scroll window
 *   - Image container M [192×100] at (192, 188) — centre third
 *   - Image container R [192×100] at (384, 188) — right third
 *
 * State machine:
 *   IDLE        → List shows gigs; selecting one calls selectGig()
 *   PART_SELECT → List shows unique part labels across the setlist; selecting one calls enterReady()
 *   READY       → List shows [▶ Start, ← Back]; first song pre-fetched as preview
 *   PLAYING     → List shows [▶ Play, ⏸ Pause, + BPM, - BPM, → Step, ← Back]; tick loop running
 */

import {
  waitForEvenAppBridge,
  ImageContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  ImageRawDataUpdate,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk';

// ─── HMR cleanup ────────────────────────────────────────────────────────────
// Track the active event-listener unsubscribe fn so hot-reload doesn't
// stack up duplicate handlers on the same bridge instance.
let _unsubscribeEvents: (() => void) | null = null;
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _unsubscribeEvents?.();
    _unsubscribeEvents = null;
    console.log('[scroll] HMR: disposed old event handler');
  });
}

// ─── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) ?? '';
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? '';

/** Width of each scroll frame sent to the glasses. Hard max is 200px. */
const FRAME_W = 192;
/** Height of the scroll strip. SDK max is 100px. */
const FRAME_H = 100;
/** Source pixels each container samples — 1:1 with display pixels. */
const SOURCE_SLICE_W = FRAME_W;

const BPM_STEP = 1;
const BPM_MIN  = 20;
const BPM_MAX  = 300;

/** Source pixels advanced per snap. One full screen = three containers = 3×FRAME_W. */
const PIXELS_PER_BEAT = FRAME_W * 3;

// Container IDs
const ID_SCROLL_LEFT  = 1;
const ID_SCROLL_MID   = 3;
const ID_SCROLL_RIGHT = 4;
const ID_CONTROLS     = 2;

// State machine
const enum AppState { IDLE, PART_SELECT, READY, PLAYING, CONFIRM_EXIT }

// ─── Types ───────────────────────────────────────────────────────────────────

interface Gig {
  id: number;
  name: string;
  date: string | null;
}

interface SongPart {
  label: string;
  imageUrl: string;
}

interface SetlistSong {
  id: number;
  title: string;
  artist: string | null;
  tempo: number | null;
  scroll_url: string | null;
  beats_in_scroll: number | null;
  parts: SongPart[] | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setStatus(msg: string): void {
  const el = document.getElementById('status');
  if (el) el.textContent = msg;
}

// ─── Supabase REST fetchers ───────────────────────────────────────────────────

async function fetchGigs(): Promise<Gig[]> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/gigs?select=id,name,date&order=date.desc`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    );
    return res.ok ? (res.json() as Promise<Gig[]>) : [];
  } catch {
    return [];
  }
}

async function fetchSetlistSongs(gigId: number): Promise<SetlistSong[]> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/setlist_items` +
      `?select=position,songs(id,title,tempo,scroll_url,beats_in_scroll,parts)` +
      `&gig_id=eq.${gigId}&order=position`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as { position: number; songs: SetlistSong }[];
    return rows.map(r => r.songs).filter(Boolean);
  } catch {
    return [];
  }
}

function resolveScrollUrl(song: SetlistSong, selectedPart: string | null): string | null {
  if (selectedPart && Array.isArray(song.parts)) {
    const part = song.parts.find(p => p.label === selectedPart);
    if (part?.imageUrl) return part.imageUrl;
  }
  return song.scroll_url;
}

const CANONICAL_PARTS = ['S', 'A', 'T', 'B'] as const;

function uniquePartLabels(songs: SetlistSong[]): string[] {
  const present = new Set<string>();
  for (const song of songs) {
    for (const p of song.parts ?? []) present.add(p.label);
  }
  // Return only canonical labels, in S→A→T→B order
  return CANONICAL_PARTS.filter(l => present.has(l));
}

/**
 * Fetches the scroll PNG and decodes it into a flat RGBA Uint8ClampedArray.
 */
async function fetchScrollPixels(url: string): Promise<{
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
} | null> {
  try {
    const bustUrl = `${url}?t=${Date.now()}`;
    const res = await fetch(bustUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { pixels: imageData.data, width: bitmap.width, height: bitmap.height };
  } catch {
    return null;
  }
}

/**
 * Extracts a SOURCE_SLICE_W-wide section from the scroll strip at xOffset,
 * resamples to FRAME_W×FRAME_H, inverts colors, encodes as PNG, returns bytes as number[].
 */
async function extractSlice(
  pixels: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  xOffset: number,
): Promise<number[]> {
  const srcX = Math.min(xOffset, srcW - 1);
  const srcSliceW = Math.min(SOURCE_SLICE_W, srcW - srcX);

  const srcCanvas = new OffscreenCanvas(srcSliceW, srcH);
  const srcCtx = srcCanvas.getContext('2d')!;
  const srcImageData = new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), srcW, srcH);
  srcCtx.putImageData(srcImageData, -srcX, 0);

  const dstCanvas = new OffscreenCanvas(FRAME_W, FRAME_H);
  const dstCtx = dstCanvas.getContext('2d')!;
  dstCtx.fillStyle = '#000000';
  dstCtx.fillRect(0, 0, FRAME_W, FRAME_H);
  dstCtx.drawImage(srcCanvas, 0, 0, srcSliceW, srcH, 0, 0, FRAME_W, FRAME_H);

  // Invert colors for the dark display
  const frameData = dstCtx.getImageData(0, 0, FRAME_W, FRAME_H);
  const d = frameData.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i]   = 255 - d[i];
    d[i+1] = 255 - d[i+1];
    d[i+2] = 255 - d[i+2];
  }
  dstCtx.putImageData(frameData, 0, 0);

  const blob = await dstCanvas.convertToBlob({ type: 'image/png' });
  const arrayBuffer = await blob.arrayBuffer();
  return Array.from(new Uint8Array(arrayBuffer));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  setStatus('Connecting to glasses…');
  const bridge = await waitForEvenAppBridge();
  setStatus('Bridge ready. Waiting for glasses connection…');

  bridge.onDeviceStatusChanged((status) => {
    console.log('[scroll] device status:', JSON.stringify(status));
  });

  // ── Playback state ────────────────────────────────────────────────────────
  let appState      : AppState = AppState.IDLE;
  let playing       = false;
  let bpm           = 80;
  let xOffset       = 0;
  let tickTimer     : ReturnType<typeof setTimeout> | null = null;
  let currentSong   : SetlistSong | null = null;
  let currentSongIdx = 0;
  let scrollPixels  : Uint8ClampedArray | null = null;
  let scrollW       = 0;
  let scrollH       = 0;

  let gigs          : Gig[] = [];
  let setlistSongs  : SetlistSong[] = [];
  let selectedPart  : string | null = null;
  let partSkipped   = false;
  let currentGigId  : number | null = null;

  // Pre-fetch cache: key = URL, value = decoded pixel data
  const pixelCache = new Map<string, { pixels: Uint8ClampedArray; width: number; height: number }>();

  async function fetchScrollPixelsCached(url: string) {
    if (pixelCache.has(url)) return pixelCache.get(url)!;
    const result = await fetchScrollPixels(url);
    if (result) pixelCache.set(url, result);
    return result;
  }

  // ── Static image container definitions (reused by rebuildPageContainer) ───
  const imageContainerLeft = new ImageContainerProperty({
    containerID: ID_SCROLL_LEFT,
    containerName: 'scroll-left',
    xPosition: 0,
    yPosition: 188,
    width: FRAME_W,
    height: FRAME_H,
  });

  const imageContainerMid = new ImageContainerProperty({
    containerID: ID_SCROLL_MID,
    containerName: 'scroll-mid',
    xPosition: 192,
    yPosition: 188,
    width: FRAME_W,
    height: FRAME_H,
  });

  const imageContainerRight = new ImageContainerProperty({
    containerID: ID_SCROLL_RIGHT,
    containerName: 'scroll-right',
    xPosition: 384,
    yPosition: 188,
    width: FRAME_W,
    height: FRAME_H,
  });

  // ── Initial startup layout (called ONCE) ──────────────────────────────────
  const startupPage = new CreateStartUpPageContainer({
    containerTotalNum: 4,
    imageObject: [imageContainerLeft, imageContainerMid, imageContainerRight],
    listObject: [new ListContainerProperty({
      containerID: ID_CONTROLS,
      containerName: 'controls',
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 160,
      isEventCapture: 1,
      itemContainer: new ListItemContainerProperty({
        itemCount: 1,
        itemName: ['Loading…'],
        isItemSelectBorderEn: 1,
      }),
    })],
    textObject: [],
  });

  const startupResult = await bridge.createStartUpPageContainer(startupPage);
  console.log('[scroll] createStartUpPageContainer result:', startupResult);
  if (startupResult !== 0) {
    // Code 1 (invalid) means the bridge session already has containers — this
    // happens in the simulator when Vite hot-reloads the page without restarting
    // the simulator. The containers are still live; proceed via rebuildPageContainer.
    // Codes 2 (oversize) and 3 (outOfMemory) are genuine failures.
    if (startupResult !== 1) {
      setStatus(`Layout error (code ${startupResult}) — check container counts/sizes`);
      return;
    }
    console.warn('[scroll] createStartUpPageContainer already initialized — continuing');
  }

  // ── Update list items via rebuildPageContainer ─────────────────────────────
  let currentListItems: string[] = []; // authoritative copy of what's in the list

  // Playing-state controls: Step/Back first (primary use), then play toggle, then BPM
  function playingControls(): string[] {
    return ['→ Step', '← Back', playing ? '⏸ Pause' : '▶ Play', '+ BPM', '- BPM'];
  }

  async function updateListData(items: string[], preserveFocus = false): Promise<void> {
    const safe = items.length > 0 ? items : ['(empty)'];
    currentListItems = safe;
    if (!preserveFocus) focusedIdx = 0;
    await bridge.rebuildPageContainer(new RebuildPageContainer({
      containerTotalNum: 4,
      imageObject: [imageContainerLeft, imageContainerMid, imageContainerRight],
      listObject: [new ListContainerProperty({
        containerID: ID_CONTROLS,
        containerName: 'controls',
        xPosition: 0,
        yPosition: 0,
        width: 576,
        height: 160,
        isEventCapture: 1,
        itemContainer: new ListItemContainerProperty({
          itemCount: safe.length,
          itemName: safe,
          isItemSelectBorderEn: 1,
        }),
      })],
      textObject: [],
    }));
  }

  // ── Image frame helpers ────────────────────────────────────────────────────
  async function sendFrame(): Promise<void> {
    if (!scrollPixels) return;
    const [sliceL, sliceM, sliceR] = await Promise.all([
      extractSlice(scrollPixels, scrollW, scrollH, xOffset),
      extractSlice(scrollPixels, scrollW, scrollH, xOffset + SOURCE_SLICE_W),
      extractSlice(scrollPixels, scrollW, scrollH, xOffset + SOURCE_SLICE_W * 2),
    ]);
    await Promise.all([
      bridge.updateImageRawData(new ImageRawDataUpdate({
        containerID: ID_SCROLL_LEFT,
        containerName: 'scroll-left',
        imageData: sliceL,
      })),
      bridge.updateImageRawData(new ImageRawDataUpdate({
        containerID: ID_SCROLL_MID,
        containerName: 'scroll-mid',
        imageData: sliceM,
      })),
      bridge.updateImageRawData(new ImageRawDataUpdate({
        containerID: ID_SCROLL_RIGHT,
        containerName: 'scroll-right',
        imageData: sliceR,
      })),
    ]);
  }

  function scheduleTick(): void {
    if (!playing) return;
    const pixelsPerBeat = (currentSong?.beats_in_scroll && scrollW)
      ? scrollW / currentSong.beats_in_scroll
      : PIXELS_PER_BEAT;
    const beatsPerScreen = PIXELS_PER_BEAT / pixelsPerBeat;
    const intervalMs = beatsPerScreen * (60 / bpm) * 1000;
    tickTimer = setTimeout(async () => {
      if (!playing) return;
      if (scrollPixels && xOffset >= scrollW) {
        playing = false;
        setStatus('Song ended. Loading next…');
        void playSetlistFrom(setlistSongs, currentSongIdx + 1);
        return;
      }
      await sendFrame();
      xOffset += PIXELS_PER_BEAT;
      scheduleTick();
    }, intervalMs);
  }

  // ── State machine ──────────────────────────────────────────────────────────

  async function enterIdle(): Promise<void> {
    appState = AppState.IDLE;
    playing = false;
    if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
    scrollPixels = null;
    setStatus('Select a setlist');
    gigs = await fetchGigs();
    if (gigs.length === 0) {
      setStatus('No setlists found');
      await updateListData(['(no setlists)']);
      return;
    }
    await updateListData(gigs.map(g => g.name + (g.date ? ` (${g.date})` : '')));
  }

  async function selectGig(gigId: number): Promise<void> {
    // Set state immediately so IDLE handler can't fire again while we await
    appState = AppState.PART_SELECT;
    currentGigId = gigId;
    setStatus('Loading setlist…');
    await updateListData(['Loading…']);
    setlistSongs = await fetchSetlistSongs(gigId);
    console.log('[scroll] fetchSetlistSongs returned', setlistSongs.length, 'songs for gig', gigId);
    if (setlistSongs.length === 0) {
      setStatus('Setlist is empty');
      await updateListData(['(empty setlist)', '← Back']);
      return;
    }
    const labels = uniquePartLabels(setlistSongs);
    if (labels.length <= 1) {
      selectedPart = labels[0] ?? null;
      partSkipped = true;
      await enterReady();
    } else {
      partSkipped = false;
      appState = AppState.PART_SELECT;
      await updateListData([...labels, '← Back to gigs']);
      setStatus('Select your part');
    }
  }

  async function enterReady(): Promise<void> {
    appState = AppState.READY;
    const firstSong = setlistSongs[0];
    await updateListData([firstSong ? `Loading: ${firstSong.title}…` : 'Loading…']);
    if (firstSong) {
      const url = resolveScrollUrl(firstSong, selectedPart);
      console.log('[scroll] enterReady firstSong:', firstSong.title, 'url:', url);
      if (url) {
        setStatus(`Ready: ${firstSong.title}`);
        const result = await fetchScrollPixelsCached(url);
        if (result) {
          scrollPixels = result.pixels;
          scrollW = result.width;
          scrollH = result.height;
          xOffset = 0;
          await sendFrame();
          // Pre-fetch second song in background
          const second = setlistSongs[1];
          if (second) {
            const u = resolveScrollUrl(second, selectedPart);
            if (u) void fetchScrollPixelsCached(u);
          }
        }
      } else {
        setStatus(`Ready: ${firstSong.title} (no scroll image)`);
      }
    }
    await updateListData(['▶ Start', '← Back']);
  }

  async function playSetlistFrom(songs: SetlistSong[], index: number): Promise<void> {
    if (index >= songs.length) {
      setStatus('Setlist complete');
      void enterIdle();
      return;
    }
    const song = songs[index];
    const url = resolveScrollUrl(song, selectedPart);
    if (!url) {
      void playSetlistFrom(songs, index + 1);
      return;
    }
    setStatus(`Loading: ${song.title}…`);
    const result = await fetchScrollPixelsCached(url);
    if (!result) {
      void playSetlistFrom(songs, index + 1);
      return;
    }
    scrollPixels = result.pixels;
    scrollW = result.width;
    scrollH = result.height;
    xOffset = 0;
    bpm = song.tempo ?? bpm;
    currentSong = song;
    currentSongIdx = index;
    appState = AppState.PLAYING;
    playing = false;  // start paused — manual step/back is the default mode
    await updateListData(playingControls());
    setStatus(`${song.title} — ${bpm} BPM`);
    await sendFrame();
    xOffset += PIXELS_PER_BEAT;   // advance so the tick loop starts on column 1 (not column 0 again)
    // don't auto-play — user presses ▶ Play to start
    // Pre-fetch next song in background while this one plays
    const next = songs[index + 1];
    if (next) {
      const nextUrl = resolveScrollUrl(next, selectedPart);
      if (nextUrl) void fetchScrollPixelsCached(nextUrl);
    }
  }

  // ── Temple gesture handler ─────────────────────────────────────────────────
  // The simulator sends currentSelectItemIndex on scroll (Up/Down) but NOT
  // on click (idx = -1 on click events). Track the focused index ourselves
  // and resolve the name from our local list copy.
  //
  // Double-click: the simulator may not emit DOUBLE_CLICK_EVENT reliably, so
  // we detect two clicks within 350 ms manually.
  let focusedIdx = 0;
  let lastClickTime = 0;

  _unsubscribeEvents = bridge.onEvenHubEvent((event) => {
    console.log('[scroll] onEvenHubEvent:', JSON.stringify(event), 'appState:', appState);

    // Double-click can arrive as a sysEvent (no listEvent) — handle it first
    const sysEvType = event.sysEvent?.eventType;
    if (sysEvType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      if (appState === AppState.PLAYING) {
        playing = false;
        if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
        appState = AppState.CONFIRM_EXIT;
        void updateListData(['Return to menu?', '← No', '✓ Yes']);
        focusedIdx = 1; // default: ← No
      }
      lastClickTime = 0;
      return;
    }

    if (!event.listEvent) return;
    const rawIdx = event.listEvent.currentSelectItemIndex ?? -1;
    const evType = event.listEvent.eventType;

    // Scroll events just update focus — no action
    if (evType === OsEventTypeList.SCROLL_TOP_EVENT || evType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      if (rawIdx >= 0) focusedIdx = rawIdx;
      lastClickTime = 0; // moving to a different item resets the double-click timer
      return;
    }

    // Click/confirm event (CLICK_EVENT or eventType undefined/0)
    // Detect rapid double-click by timing
    const now = Date.now();
    const isDoubleClick =
      evType === OsEventTypeList.DOUBLE_CLICK_EVENT ||
      (now - lastClickTime < 350);
    lastClickTime = now;

    if (isDoubleClick) {
      // Double-click in PLAYING → show exit confirmation
      if (appState === AppState.PLAYING) {
        playing = false;
        if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
        appState = AppState.CONFIRM_EXIT;
        void updateListData(['Return to menu?', '← No', '✓ Yes']);
        focusedIdx = 1; // default: ← No
      }
      lastClickTime = 0;
      return;
    }

    // Update focus tracking on scroll events; use tracked index on click
    if (rawIdx >= 0) focusedIdx = rawIdx;
    const idx = rawIdx >= 0 ? rawIdx : focusedIdx;

    const name = (idx >= 0 && idx < currentListItems.length)
      ? currentListItems[idx]
      : (event.listEvent.currentSelectItemName ?? '');
    console.log('[scroll] resolved name:', JSON.stringify(name), 'idx:', idx, 'focusedIdx:', focusedIdx, 'listLen:', currentListItems.length);

    if (appState === AppState.IDLE) {
      if (idx >= 0 && idx < gigs.length) {
        void selectGig(gigs[idx].id);
      }

    } else if (appState === AppState.PART_SELECT) {
      if (name === '← Back to gigs') {
        void enterIdle();
      } else {
        const labels = uniquePartLabels(setlistSongs);
        if (labels.includes(name)) {
          selectedPart = name;
          void enterReady();
        }
      }

    } else if (appState === AppState.CONFIRM_EXIT) {
      if (name === '✓ Yes') {
        void enterIdle();
      } else {
        // No (or anything else) — resume playing state
        appState = AppState.PLAYING;
        void updateListData(playingControls());
        focusedIdx = 0; // focus → Step
        void sendFrame();  // restore the scroll strip that was visible before the dialog
      }

    } else if (appState === AppState.READY) {
      if (name === '▶ Start') {
        void playSetlistFrom(setlistSongs, 0);
      } else if (name === '← Back') {
        if (partSkipped) {
          void enterIdle();
        } else {
          appState = AppState.PART_SELECT;
          const labels = uniquePartLabels(setlistSongs);
          void updateListData([...labels, '← Back to gigs']);
          setStatus('Select your part');
        }
      }

    } else if (appState === AppState.PLAYING) {
      switch (name) {
        case '▶ Play':
          if (!playing && scrollPixels) {
            playing = true;
            void updateListData(playingControls(), true);
            scheduleTick();
          }
          break;
        case '⏸ Pause':
          playing = false;
          if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
          void updateListData(playingControls(), true);
          break;
        case '+ BPM':
          bpm = Math.min(BPM_MAX, bpm + BPM_STEP);
          break;
        case '- BPM':
          bpm = Math.max(BPM_MIN, bpm - BPM_STEP);
          break;
        case '→ Step':
          if (scrollPixels) {
            const wasPlayingStep = playing;
            playing = false;
            if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
            // If already at the last frame, advance to the next song
            if (xOffset + PIXELS_PER_BEAT >= scrollW) {
              setStatus('Loading next song…');
              void playSetlistFrom(setlistSongs, currentSongIdx + 1);
            } else {
              xOffset += PIXELS_PER_BEAT;
              void sendFrame();
              if (wasPlayingStep) void updateListData(playingControls(), true);
            }
          }
          break;
        case '← Back':
          {
            const wasPlayingBack = playing;
            playing = false;
            if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
            xOffset = Math.max(0, xOffset - PIXELS_PER_BEAT);
            void sendFrame();
            if (wasPlayingBack) void updateListData(playingControls(), true);
          }
          break;
      }
    }
  });

  // ── Kick off ──────────────────────────────────────────────────────────────
  void enterIdle();
}

main().catch(err => {
  console.error('Fatal error:', err);
  const el = document.getElementById('status');
  if (el) el.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
});
