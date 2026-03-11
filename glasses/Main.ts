/**
 * ER Sheet Music Scroll — Glasses App
 *
 * Displays a horizontally scrolling sheet music strip on the Even Realities G2
 * glasses via the Even Hub SDK.
 *
 * Layout (576×288 SDK coordinates):
 *   - List container    [576×160] at (0, 0)    — playback controls
 *   - Image container L [192×100] at (0, 188)  — left third of the scroll window
 *   - Image container M [192×100] at (192, 188) — centre third
 *   - Image container R [192×100] at (384, 188) — right third
 *
 * Playback flow:
 *   1. Poll GET /api/now-playing for the current song
 *   2. Fetch the scroll PNG, decode it into pixel slices via OffscreenCanvas
 *   3. Send successive 200×100 slices to the image container at BPM-tick rate
 *   4. Temple gestures control Play / Pause / +BPM / -BPM via the list container
 *   5. When the scroll ends, poll for the next song and restart
 */

import {
  waitForEvenAppBridge,
  ImageContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  CreateStartUpPageContainer,
  ImageRawDataUpdate,
} from '@evenrealities/even_hub_sdk';

// ─── Config ──────────────────────────────────────────────────────────────────

const ADMIN_URL = (import.meta.env.VITE_ADMIN_URL as string) ?? 'http://localhost:3000';

/** Width of each scroll frame sent to the glasses. Hard max is 200px. */
const FRAME_W = 192;
/** Height of the scroll strip. SDK max is 100px. */
const FRAME_H = 100;
/** Source pixels each container samples — 1:1 with display pixels. */
const SOURCE_SLICE_W = FRAME_W;

const BPM_STEP = 1;
const BPM_MIN  = 20;
const BPM_MAX  = 300;

/** Source pixels advanced per beat. One full screen = three containers = 3×FRAME_W. */
const PIXELS_PER_BEAT = FRAME_W * 3;

/** Poll interval (ms) when idle / waiting for a song. */
const POLL_INTERVAL_MS = 5000;

// Container IDs
const ID_SCROLL_LEFT  = 1;
const ID_SCROLL_MID   = 3;
const ID_SCROLL_RIGHT = 4;
const ID_CONTROLS     = 2;

// Control list items (order = index used in listEvent)
const CONTROLS = ['▶ Play', '⏸ Pause', '+ BPM', '- BPM'];

// ─── Types ───────────────────────────────────────────────────────────────────

interface Song {
  id: number;
  title: string;
  artist: string | null;
  tempo: number | null;
  scroll_url: string | null;
  beats_in_scroll: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setStatus(msg: string): void {
  const el = document.getElementById('status');
  if (el) el.textContent = msg;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchNowPlaying(): Promise<Song | null> {
  try {
    const res = await fetch(`${ADMIN_URL}/api/now-playing`);
    if (!res.ok) return null;
    const { song } = await res.json() as { song: Song | null };
    return song;
  } catch {
    return null;
  }
}

/**
 * Fetches the scroll PNG from Supabase Storage and decodes it into a flat
 * RGBA Uint8ClampedArray using an OffscreenCanvas.
 * Returns { pixels, width, height }.
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
 * resamples it down to FRAME_W×FRAME_H, encodes as PNG, and returns bytes as number[].
 */
async function extractSlice(
  pixels: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  xOffset: number,
): Promise<number[]> {
  const srcX = Math.min(xOffset, srcW - 1);
  const srcSliceW = Math.min(SOURCE_SLICE_W, srcW - srcX);

  // Copy the source strip into a canvas
  const srcCanvas = new OffscreenCanvas(srcSliceW, srcH);
  const srcCtx = srcCanvas.getContext('2d')!;
  const srcImageData = new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), srcW, srcH);
  srcCtx.putImageData(srcImageData, -srcX, 0);

  // Resample to FRAME_W × FRAME_H
  const dstCanvas = new OffscreenCanvas(FRAME_W, FRAME_H);
  const dstCtx = dstCanvas.getContext('2d')!;
  dstCtx.fillStyle = '#000000';
  dstCtx.fillRect(0, 0, FRAME_W, FRAME_H);
  dstCtx.drawImage(srcCanvas, 0, 0, srcSliceW, srcH, 0, 0, FRAME_W, FRAME_H);

  // Invert colors so the dark glasses display shows white notes on black
  const frameData = dstCtx.getImageData(0, 0, FRAME_W, FRAME_H);
  const d = frameData.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i]   = 255 - d[i];
    d[i+1] = 255 - d[i+1];
    d[i+2] = 255 - d[i+2];
  }
  dstCtx.putImageData(frameData, 0, 0);

  // Encode as PNG
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
    setStatus(`Glasses: ${JSON.stringify(status)}`);
  });

  // ── Playback state ────────────────────────────────────────────────────────
  let playing     = false;
  let bpm         = 80;
  let xOffset     = 0;
  let tickTimer   : ReturnType<typeof setTimeout> | null = null;
  let currentSong : Song | null = null;
  let scrollPixels: Uint8ClampedArray | null = null;
  let scrollW     = 0;
  let scrollH     = 0;

  // ── Build the initial page layout ─────────────────────────────────────────
  // Three 192px image containers side-by-side = 576px = full display width
  const imageContainerLeft = new ImageContainerProperty({
    containerID: ID_SCROLL_LEFT,
    containerName: 'scroll-left',
    xPosition: 0,
    yPosition: 188,  // flush to bottom: 188 + 100 = 288
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

  const listContainer = new ListContainerProperty({
    containerID: ID_CONTROLS,
    containerName: 'controls',
    xPosition: 0,
    yPosition: 0,  // top of display
    width: 576,
    height: 160,
    isEventCapture: 1,
    itemContainer: new ListItemContainerProperty({
      itemCount: CONTROLS.length,
      itemName: CONTROLS,
      isItemSelectBorderEn: 1,
    }),
  });

  const startupPage = new CreateStartUpPageContainer({
    containerTotalNum: 4,
    imageObject: [imageContainerLeft, imageContainerMid, imageContainerRight],
    listObject: [listContainer],
    textObject: [],
  });

  const startupResult = await bridge.createStartUpPageContainer(startupPage);
  console.log('[scroll] createStartUpPageContainer result:', startupResult);
  // 0=success, 1=invalid, 2=oversize, 3=outOfMemory
  if (startupResult !== 0) {
    setStatus(`Layout error (code ${startupResult}) — check container counts/sizes`);
    return;
  }
  setStatus('Connected. Loading song…');

  // ── Temple gesture handler ─────────────────────────────────────────────────
  bridge.onEvenHubEvent((event) => {
    if (!event.listEvent) return;
    const idx = event.listEvent.currentSelectItemIndex ?? -1;
    switch (idx) {
      case 0: // ▶ Play
        if (!playing && scrollPixels) {
          playing = true;
          scheduleTick();
        }
        break;
      case 1: // ⏸ Pause
        playing = false;
        if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }
        break;
      case 2: // + BPM
        bpm = Math.min(BPM_MAX, bpm + BPM_STEP);
        break;
      case 3: // - BPM
        bpm = Math.max(BPM_MIN, bpm - BPM_STEP);
        break;
    }
  });

  // ── Tick: advance one frame ────────────────────────────────────────────────
  async function sendFrame(): Promise<void> {
    if (!scrollPixels) return;
    // Extract all three slices in parallel; each is SOURCE_SLICE_W (192px) of source → 192px display
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
    // How many musical beats does one full screen (PIXELS_PER_BEAT source px) span?
    // pixelsPerBeat = scroll_width / total_beats — derived from stored beats_in_scroll.
    // Interval = (beats per screen) × (ms per beat).
    const pixelsPerBeat = (currentSong?.beats_in_scroll && scrollW)
      ? scrollW / currentSong.beats_in_scroll
      : PIXELS_PER_BEAT;
    const beatsPerScreen = PIXELS_PER_BEAT / pixelsPerBeat;
    const intervalMs = beatsPerScreen * (60 / bpm) * 1000;
    tickTimer = setTimeout(async () => {
      if (!playing) return;

      // Check if scroll is exhausted
      if (scrollPixels && xOffset >= scrollW) {
        playing = false;
        setStatus('Song ended. Loading next…');
        void loadAndPlay();
        return;
      }

      await sendFrame();
      xOffset += PIXELS_PER_BEAT;  // advance one full screen per snap
      scheduleTick();   // schedule next tick
    }, intervalMs);
  }

  // ── Load a song and start playing ─────────────────────────────────────────
  async function loadAndPlay(): Promise<void> {
    // Stop any current playback
    playing = false;
    if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; }

    // Poll until we get a song with a scroll URL
    let song: Song | null = null;
    while (!song?.scroll_url) {
      song = await fetchNowPlaying();
      if (!song?.scroll_url) {
        setStatus('Waiting for a song to be queued…');
        await sleep(POLL_INTERVAL_MS);
      }
    }

    // Song changed?
    if (song.id !== currentSong?.id) {
      setStatus(`Loading: ${song.title}…`);
      currentSong = song;
      xOffset = 0;
      scrollPixels = null;

      const result = await fetchScrollPixels(song.scroll_url);
      if (!result) {
        setStatus('Failed to load scroll image. Retrying…');
        await sleep(POLL_INTERVAL_MS);
        void loadAndPlay();
        return;
      }

      scrollPixels = result.pixels;
      scrollW = result.width;
      scrollH = result.height;
    }

    bpm = song.tempo ?? bpm;
    const beatsInfo = song.beats_in_scroll
      ? `${song.beats_in_scroll}b / ${scrollW}px = ${(scrollW / song.beats_in_scroll).toFixed(1)}px/beat`
      : 'no beats_in_scroll';
    setStatus(`${song.title} — ${bpm} BPM — ${beatsInfo}`);
    // Send the first frame so something visible appears immediately
    await sendFrame();

    // Auto-play
    playing = true;
    scheduleTick();
  }

  // ── Kick off ──────────────────────────────────────────────────────────────
  void loadAndPlay();
}

main().catch(err => {
  console.error('Fatal error:', err);
  const el = document.getElementById('status');
  if (el) el.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
});
