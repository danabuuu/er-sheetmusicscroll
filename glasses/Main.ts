/**
 * ER Sheet Music Scroll — Glasses App
 *
 * Displays a horizontally scrolling sheet music strip on the Even Realities G2
 * glasses via the Even Hub SDK.
 *
 * Layout (576×288 SDK coordinates):
 *   - List container    [576×160] at (0, 0)     — navigation / playback controls (max 4 containers total)
 *   - Image container L [192×100] at (0, 188)   — left third of the scroll window
 *   - Image container M [192×100] at (192, 188) — centre third
 *   - Image container R [192×100] at (384, 188) — right third
 *
 * State machine:
 *   IDLE        → List shows voice parts (S / A / T / B)
 *   GIG_SELECT  → List shows gigs that have ≥1 song with the chosen voice
 *   READY       → List shows [▶ Start, ← Back]; first song pre-fetched as preview
 *   PLAYING     → List shows [⏸ Pause / ▶ Play, → Step, ← Back, + BPM, - BPM]; tick loop running
 */

import {
  waitForEvenAppBridge,
  ImageContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  TextContainerUpgrade,
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

// Container IDs  (max 4 total: 3 images + 1 list)
const ID_SCROLL_LEFT  = 1;
const ID_SCROLL_MID   = 3;
const ID_SCROLL_RIGHT = 4;
const ID_CONTROLS     = 2;

// State machine
const enum AppState { IDLE, GIG_SELECT, READY, PLAYING, CONFIRM_EXIT }

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
      `?select=position,songs(id,title,tempo,beats_in_scroll,parts)` +
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

function resolveScrollUrl(song: SetlistSong, voice: string | null): string | null {
  if (!Array.isArray(song.parts) || !voice) return null;
  // Match by voice prefix (S/A/T/B) — ignores 1R/2R distinction.
  // Returns null if no strip exists for this voice; caller skips the song.
  const part = song.parts.find(p => p.label.charAt(0) === voice && p.imageUrl);
  return part?.imageUrl ?? null;
}

const CANONICAL_PARTS = ['S 1R', 'S 2R', 'A 1R', 'A 2R', 'T 1R', 'T 2R', 'B 1R', 'B 2R'] as const;

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
  canvas: OffscreenCanvas;
  width: number;
  height: number;
} | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);

    // Pre-draw to an OffscreenCanvas once so extractSlice can crop directly
    // without cloning the full pixel buffer on every call.
    const srcCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = srcCanvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { pixels: imageData.data, canvas: srcCanvas, width: bitmap.width, height: bitmap.height };
  } catch {
    return null;
  }
}

/**
 * Extracts a SOURCE_SLICE_W-wide section from the scroll strip at xOffset,
 * resamples to FRAME_W×FRAME_H, inverts colors, encodes as PNG, returns bytes as number[].
 */
async function extractSlice(
  srcCanvas: OffscreenCanvas,
  srcX: number,
  srcH: number,
): Promise<Uint8Array> {
  const dstCanvas = new OffscreenCanvas(FRAME_W, FRAME_H);
  const dstCtx = dstCanvas.getContext('2d')!;
  dstCtx.fillStyle = '#000000';
  dstCtx.fillRect(0, 0, FRAME_W, FRAME_H);
  // drawImage clips cleanly if srcX + SOURCE_SLICE_W exceeds srcCanvas.width
  dstCtx.drawImage(srcCanvas, srcX, 0, SOURCE_SLICE_W, srcH, 0, 0, FRAME_W, FRAME_H);

  // Invert + threshold to pure B&W: dark original pixels (notes/staffs) → white;
  // light original pixels (paper) → black. Pure 2-level images compress much
  // smaller as PNG, reducing BLE transfer time significantly.
  const frameData = dstCtx.getImageData(0, 0, FRAME_W, FRAME_H);
  const d = frameData.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] + d[i+1] + d[i+2]) < 384 ? 255 : 0; // dark pixel → white, light → black
    d[i] = d[i+1] = d[i+2] = v;
  }
  dstCtx.putImageData(frameData, 0, 0);

  const blob = await dstCanvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
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
  let visibleGigs   : Gig[] = [];  // gigs filtered to those with ≥1 strip for selectedVoice
  let setlistSongs  : SetlistSong[] = [];
  let selectedVoice : string | null = null;  // 'S' | 'A' | 'T' | 'B'
  let currentGigId  : number | null = null;

  // Pre-fetch cache: key = URL, value = decoded pixel data + pre-drawn canvas
  const pixelCache = new Map<string, { pixels: Uint8ClampedArray; canvas: OffscreenCanvas; width: number; height: number }>();

  // Per-song rendered frame cache: key = xOffset, value = [sliceL, sliceM, sliceR] as PNG Uint8Arrays
  // Cleared whenever a new song loads. Pre-rendered in the background after load.
  let scrollCanvas: OffscreenCanvas | null = null;
  let frameRenderCache = new Map<number, [Uint8Array, Uint8Array, Uint8Array]>();
  let avgSendMs = 250; // EMA of BLE transfer time; used to fire ticks early so frames arrive on-beat

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
  // Startup: use a list container so the SDK initialises its event system.
  const startupPage = new CreateStartUpPageContainer({
    containerTotalNum: 4,
    imageObject: [imageContainerLeft, imageContainerMid, imageContainerRight],
    listObject: [new ListContainerProperty({
      containerID: ID_CONTROLS,
      containerName: 'controls',
      xPosition: 0, yPosition: 0, width: 576, height: 160,
      isEventCapture: 1,
      itemContainer: new ListItemContainerProperty({
        itemCount: 1, itemName: ['Loading…'], isItemSelectBorderEn: 1,
      }),
    })],
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

  // Playing-state controls
  function playingControls(): string[] {
    return [playing ? '|| Pause' : '> Play', 'Step', 'Back', '+BPM', '-BPM'];
  }

  async function updateListData(items: string[]): Promise<void> {
    const safe = items.length > 0 ? items : ['(empty)'];
    currentListItems = safe;
    await bridge.rebuildPageContainer(new RebuildPageContainer({
      containerTotalNum: 4,
      imageObject: [imageContainerLeft, imageContainerMid, imageContainerRight],
      listObject: [new ListContainerProperty({
        containerID: ID_CONTROLS,
        containerName: 'controls',
        xPosition: 0, yPosition: 0, width: 576, height: 160,
        isEventCapture: 1,
        itemContainer: new ListItemContainerProperty({
          itemCount: safe.length,
          itemName: safe,
          isItemSelectBorderEn: 1,
        }),
      })],
    }));
  }

  // ── Image frame helpers ────────────────────────────────────────────────────
  async function renderFrame(x: number): Promise<[Uint8Array, Uint8Array, Uint8Array]> {
    const cached = frameRenderCache.get(x);
    if (cached) return cached;
    const sc = scrollCanvas!;
    const slices = await Promise.all([
      extractSlice(sc, x, scrollH),
      extractSlice(sc, x + SOURCE_SLICE_W, scrollH),
      extractSlice(sc, x + SOURCE_SLICE_W * 2, scrollH),
    ]) as [Uint8Array, Uint8Array, Uint8Array];
    frameRenderCache.set(x, slices);
    return slices;
  }

  async function sendFrame(): Promise<void> {
    if (!scrollCanvas) return;
    const t0 = performance.now();
    const [sliceL, sliceM, sliceR] = await renderFrame(xOffset);
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
    avgSendMs = avgSendMs * 0.75 + (performance.now() - t0) * 0.25;
  }

  /** Pre-render all frames for a song in parallel batches.
   *  Aborts silently if frameRenderCache is replaced (new song loaded). */
  async function prerenderFrames(
    canvas: OffscreenCanvas, w: number, h: number,
    cache: Map<number, [Uint8Array, Uint8Array, Uint8Array]>,
  ): Promise<void> {
    const xs: number[] = [];
    for (let x = 0; x < w; x += PIXELS_PER_BEAT) xs.push(x);
    const BATCH = 4;
    for (let i = 0; i < xs.length; i += BATCH) {
      if (cache !== frameRenderCache) return;
      await Promise.all(xs.slice(i, i + BATCH).filter(x => !cache.has(x)).map(async x => {
        const slices = await Promise.all([
          extractSlice(canvas, x, h),
          extractSlice(canvas, x + SOURCE_SLICE_W, h),
          extractSlice(canvas, x + SOURCE_SLICE_W * 2, h),
        ]) as [Uint8Array, Uint8Array, Uint8Array];
        if (cache === frameRenderCache) cache.set(x, slices);
      }));
    }
  }

  function scheduleTick(): void {
    if (!playing) return;
    const pixelsPerBeat = (currentSong?.beats_in_scroll && scrollW)
      ? scrollW / currentSong.beats_in_scroll
      : PIXELS_PER_BEAT;
    const beatsPerScreen = PIXELS_PER_BEAT / pixelsPerBeat;
    const intervalMs = beatsPerScreen * (60 / bpm) * 1000;
    // Fire the tick avgSendMs early so the BLE transfer completes on the beat,
    // not avgSendMs after it. Clamped to 50% of the interval so we never fire
    // more than halfway through the previous beat.
    const leadMs = Math.min(avgSendMs, intervalMs * 0.5);
    tickTimer = setTimeout(async () => {
      if (!playing) return;
      xOffset += PIXELS_PER_BEAT;
      if (scrollCanvas && xOffset >= scrollW) {
        playing = false;
        setStatus('Song ended. Loading next…');
        void playSetlistFrom(setlistSongs, currentSongIdx + 1);
        return;
      }
      await sendFrame(); // avgSendMs updates here; next tick uses fresh estimate
      scheduleTick();
    }, Math.max(50, intervalMs - leadMs));
  }

  // ── State machine ──────────────────────────────────────────────────────────

  async function enterIdle(): Promise<void> {
    appState = AppState.IDLE;
    playing = false;
    if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
    scrollPixels = null;
    scrollCanvas = null;
    selectedVoice = null;
    gigs = await fetchGigs(); // pre-fetch in background for speed
    setStatus('Choose your voice part');
    await updateListData(['Soprano', 'Alto', 'Tenor', 'Bass']);
  }

  async function enterGigSelect(): Promise<void> {
    appState = AppState.GIG_SELECT;
    setStatus('Loading setlists…');
    await updateListData(['Loading…']);
    if (gigs.length === 0) gigs = await fetchGigs();
    if (gigs.length === 0) {
      setStatus('No setlists found');
      await updateListData(['(no setlists)', 'Back']);
      return;
    }
    // Fetch all setlists in parallel to filter by selected voice.
    setStatus(`${selectedVoice} — loading…`);
    await updateListData(['Filtering setlists…']);
    const songLists = await Promise.all(gigs.map(g => fetchSetlistSongs(g.id)));
    visibleGigs = gigs.filter((_, i) =>
      songLists[i].some(s =>
        Array.isArray(s.parts) && s.parts.some(p => p.imageUrl && p.label.charAt(0) === selectedVoice)
      )
    );
    if (visibleGigs.length === 0) {
      setStatus(`No setlists with ${selectedVoice} parts`);
      await updateListData([`No ${selectedVoice} setlists`, 'Back']);
      return;
    }
    setStatus(`${selectedVoice} — select setlist`);
      await updateListData([...visibleGigs.map(g => g.name + (g.date ? ` (${g.date})` : '')), 'Back']);
  }

  async function selectGig(gigId: number): Promise<void> {
    appState = AppState.READY; // lock state while loading
    currentGigId = gigId;
    setStatus('Loading setlist…');
    await updateListData(['Loading…']);
    setlistSongs = await fetchSetlistSongs(gigId);
    if (setlistSongs.length === 0) {
      setStatus('Setlist is empty');
      await updateListData(['(empty setlist)', 'Back']);
      return;
    }
    // Check at least one song has the selected voice
    const hasVoice = setlistSongs.some(s =>
      Array.isArray(s.parts) && s.parts.some(p => p.imageUrl && p.label.charAt(0) === selectedVoice)
    );
    if (!hasVoice) {
      setStatus(`No ${selectedVoice} parts in this setlist`);
      await updateListData([`No ${selectedVoice} parts here`, 'Back']);
      return;
    }
    await enterReady();
  }

  async function enterReady(): Promise<void> {
    appState = AppState.READY;
    const firstSong = setlistSongs[0];
    await updateListData([firstSong ? `Loading: ${firstSong.title}…` : 'Loading…']);
    if (firstSong) {
      const url = resolveScrollUrl(firstSong, selectedVoice);
      console.log('[scroll] enterReady firstSong:', firstSong.title, 'url:', url);
      if (url) {
        setStatus(`Ready: ${firstSong.title}`);
        const result = await fetchScrollPixelsCached(url);
        if (result) {
          scrollPixels = result.pixels;
          scrollCanvas = result.canvas;
          scrollW = result.width;
          scrollH = result.height;
          xOffset = 0;
          await sendFrame();
          // Pre-fetch second song in background
          const second = setlistSongs[1];
          if (second) {
            const u = resolveScrollUrl(second, selectedVoice);
            if (u) void fetchScrollPixelsCached(u);
          }
        }
      } else {
        setStatus(`Ready: ${firstSong.title} (no scroll image)`);
      }
    }
    await updateListData(['Start', 'Back']);
  }

  async function playSetlistFrom(songs: SetlistSong[], index: number): Promise<void> {
    if (index >= songs.length) {
      setStatus('Setlist complete');
      void enterIdle();
      return;
    }
    const song = songs[index];
    const url = resolveScrollUrl(song, selectedVoice);
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
    // If the next-song pre-renderer already finished, adopt its frame cache
    const preRendered = (result as any).__frameCache as Map<number, [Uint8Array, Uint8Array, Uint8Array]> | undefined;
    scrollPixels = result.pixels;
    scrollCanvas = result.canvas;
    scrollW = result.width;
    scrollH = result.height;
    xOffset = 0;
    bpm = song.tempo ?? bpm;
    currentSong = song;
    currentSongIdx = index;
    appState = AppState.PLAYING;
    playing = false;  // start paused — manual step/back is the default mode
    // Clear frame cache and eagerly pre-render frame 0 so first display is instant
    frameRenderCache = preRendered ?? new Map();
    const thisCache = frameRenderCache;
    await renderFrame(0); // blocks until frame 0 ready
    // Start paused
    await updateListData(playingControls());
    setStatus(`${song.title} — ${bpm} BPM`);
    await sendFrame();
    // Background-render remaining frames so ticks are instant
    void prerenderFrames(result.canvas, scrollW, scrollH, thisCache);
    // Pre-fetch + pre-render next song in background
    const next = songs[index + 1];
    if (next) {
      const nextUrl = resolveScrollUrl(next, selectedVoice);
      if (nextUrl) void fetchScrollPixelsCached(nextUrl).then(r => {
        if (r && thisCache === frameRenderCache) {
          // next song has its own cache — use a temporary one just to warm it
          const nextCache = new Map<number, [Uint8Array, Uint8Array, Uint8Array]>();
          void prerenderFrames(r.canvas, r.width, r.height, nextCache).then(() => {
            // Store under a special key in pixelCache so playSetlistFrom can use it
            // (frames are stored in nextCache; swapped to frameRenderCache on load)
            (r as any).__frameCache = nextCache;
          });
        }
      });
    }
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  // Dispatch uses the SDK-reported currentSelectItemIndex on every click event.
  // We do not track cursor position ourselves — scroll events move the hardware
  // cursor natively and we leave them entirely to the firmware.
  // Dispatch is by item name, not index, so it's immune to any cursor drift.
  let lastClickMs = 0;

  function dispatchTap(idx: number): void {
    const now = Date.now();
    if (now - lastClickMs < 90) return; // drop hardware duplicate tap
    lastClickMs = now;
    const name = currentListItems[idx] ?? '';
    console.log('[nav] tap idx=%d name=%s state=%s', idx, name, appState);

    if (appState === AppState.IDLE) {
      const voiceMap: Record<string, string> = { 'Soprano': 'S', 'Alto': 'A', 'Tenor': 'T', 'Bass': 'B' };
      if (voiceMap[name]) { selectedVoice = voiceMap[name]; void enterGigSelect(); }

    } else if (appState === AppState.GIG_SELECT) {
      if (name === 'Back') void enterIdle();
      else { const gig = visibleGigs[idx]; if (gig) void selectGig(gig.id); }

    } else if (appState === AppState.READY) {
      if (name === 'Start') void playSetlistFrom(setlistSongs, 0);
      else if (name === 'Back') void (currentGigId !== null ? enterGigSelect() : enterIdle());

    } else if (appState === AppState.CONFIRM_EXIT) {
      if (name === 'Yes') void enterIdle();
      else if (name === 'No') { appState = AppState.PLAYING; void updateListData(playingControls()).then(() => sendFrame()); }

    } else if (appState === AppState.PLAYING) {
      if (name === '> Play') {
        if (scrollPixels) { playing = true; void updateListData(playingControls()).then(() => sendFrame()); scheduleTick(); }
      } else if (name === '|| Pause') {
        playing = false; if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
        void updateListData(playingControls()).then(() => sendFrame());
      } else if (name === 'Step') {
        if (scrollPixels) {
          if (xOffset + PIXELS_PER_BEAT >= scrollW) void playSetlistFrom(setlistSongs, currentSongIdx + 1);
          else { xOffset += PIXELS_PER_BEAT; void sendFrame(); if (playing) { if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; } scheduleTick(); } }
        }
      } else if (name === 'Back') {
        xOffset = Math.max(0, xOffset - PIXELS_PER_BEAT); void sendFrame();
        if (playing) { if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; } scheduleTick(); }
      } else if (name === '+BPM') {
        bpm = Math.min(BPM_MAX, bpm + BPM_STEP); setStatus(`${currentSong?.title ?? 'Playing'} — ${bpm} BPM`);
        if (playing) { if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; } scheduleTick(); }
      } else if (name === '-BPM') {
        bpm = Math.max(BPM_MIN, bpm - BPM_STEP); setStatus(`${currentSong?.title ?? 'Playing'} — ${bpm} BPM`);
        if (playing) { if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; } scheduleTick(); }
      }
    }
  }

  function dispatchDouble(): void {
    if (appState === AppState.PLAYING) {
      playing = false;
      if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
      appState = AppState.CONFIRM_EXIT;
      void updateListData(['Return to main menu?', 'No', 'Yes']);
    } else if (appState === AppState.GIG_SELECT || appState === AppState.READY) {
      void enterIdle();
    }
  }

  _unsubscribeEvents = bridge.onEvenHubEvent((event) => {
    console.log('[nav] event:', JSON.stringify(event));
    if (event.sysEvent?.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      dispatchDouble(); return;
    }
    const ev = event.listEvent;
    if (!ev) return;
    const et = ev.eventType as number;
    if (et === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      dispatchDouble();
    } else if (et === OsEventTypeList.CLICK_EVENT || et == null) {
      dispatchTap(ev.currentSelectItemIndex ?? 0);
    }
    // SCROLL events: firmware moves the visual cursor natively — nothing to do here
  });

  // ── Kick off ──────────────────────────────────────────────────────────────
  void enterIdle();
}

main().catch(err => {
  console.error('Fatal error:', err);
  const el = document.getElementById('status');
  if (el) el.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
});
