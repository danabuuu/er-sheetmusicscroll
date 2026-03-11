/**
 * ER Sheet Music Scroll — Glasses App
 *
 * Displays a horizontally scrolling sheet music strip on the Even Realities G2
 * glasses via the Even Hub SDK.
 *
 * Layout (576×288 SDK coordinates):
 *   - Image container  [200×100] at (0, 94)  — the scroll window
 *   - List container   [576×60]  at (0, 200) — playback controls
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
const FRAME_W = 200;
/** Height of the scroll strip. Hard max is 100px. */
const FRAME_H = 100;

const BPM_STEP = 5;
const BPM_MIN  = 20;
const BPM_MAX  = 300;

/** Pixels scrolled per beat. One beat = one FRAME_W advance. */
const PIXELS_PER_BEAT = FRAME_W;

/** Poll interval (ms) when idle / waiting for a song. */
const POLL_INTERVAL_MS = 5000;

// Container IDs
const ID_SCROLL   = 1;
const ID_CONTROLS = 2;

// Control list items (order = index used in listEvent)
const CONTROLS = ['▶ Play', '⏸ Pause', '+ BPM', '- BPM'];

// ─── Types ───────────────────────────────────────────────────────────────────

interface Song {
  id: number;
  title: string;
  artist: string | null;
  tempo: number | null;
  scroll_url: string | null;
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
    const res = await fetch(url);
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
 * Extracts a 200×100 RGBA slice starting at xOffset from the full scroll strip,
 * resampled to fit FRAME_W × FRAME_H.
 * Returns a number[] (List<int>) as expected by updateImageRawData.
 */
function extractSlice(
  pixels: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  xOffset: number,
): number[] {
  // Source rect: crop a FRAME_W-wide, full-height strip at xOffset,
  // then scale it down to FRAME_W × FRAME_H.
  const srcX = Math.min(xOffset, srcW - 1);
  const srcSliceW = Math.min(FRAME_W, srcW - srcX);

  // Use an OffscreenCanvas to resample
  const srcCanvas = new OffscreenCanvas(srcSliceW, srcH);
  const srcCtx = srcCanvas.getContext('2d')!;
  const srcImageData = new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), srcW, srcH);
  srcCtx.putImageData(srcImageData, -srcX, 0);

  const dstCanvas = new OffscreenCanvas(FRAME_W, FRAME_H);
  const dstCtx = dstCanvas.getContext('2d')!;
  // Fill with white for any area beyond the scroll strip
  dstCtx.fillStyle = '#FFFFFF';
  dstCtx.fillRect(0, 0, FRAME_W, FRAME_H);
  dstCtx.drawImage(srcCanvas, 0, 0, srcSliceW, srcH, 0, 0, FRAME_W, FRAME_H);

  const out = dstCtx.getImageData(0, 0, FRAME_W, FRAME_H).data;
  return Array.from(out);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  setStatus('Connecting to glasses…');
  const bridge = await waitForEvenAppBridge();
  setStatus('Connected. Loading song…');

  // ── Build the initial page layout ─────────────────────────────────────────
  const imageContainer = new ImageContainerProperty({
    containerID: ID_SCROLL,
    containerName: 'scroll',
    xPosition: 0,
    yPosition: 94,   // vertically centred in the 288px tall display
    width: FRAME_W,
    height: FRAME_H,
  });

  const listContainer = new ListContainerProperty({
    containerID: ID_CONTROLS,
    containerName: 'controls',
    xPosition: 0,
    yPosition: 200,
    width: 576,
    height: 60,
    isEventCapture: 1,
    itemContainer: new ListItemContainerProperty({
      itemCount: CONTROLS.length,
      itemName: CONTROLS,
      isItemSelectBorderEn: 1,
    }),
  });

  const startupPage = new CreateStartUpPageContainer({
    containerTotalNum: 2,
    imageObject: [imageContainer],
    listObject: [listContainer],
  });

  await bridge.createStartUpPageContainer(startupPage);

  // ── Playback state ────────────────────────────────────────────────────────
  let playing     = false;
  let bpm         = 80;
  let xOffset     = 0;
  let tickTimer   : ReturnType<typeof setTimeout> | null = null;
  let currentSong : Song | null = null;
  let scrollPixels: Uint8ClampedArray | null = null;
  let scrollW     = 0;
  let scrollH     = 0;

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
    const slice = extractSlice(scrollPixels, scrollW, scrollH, xOffset);
    const update = new ImageRawDataUpdate({
      containerID: ID_SCROLL,
      containerName: 'scroll',
      imageData: slice,
    });
    await bridge.updateImageRawData(update);
    xOffset += PIXELS_PER_BEAT;
  }

  function scheduleTick(): void {
    if (!playing) return;
    const intervalMs = (60 / bpm) * 1000;
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
    setStatus(`${song.title}${song.artist ? ` · ${song.artist}` : ''} — ${bpm} BPM`);

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
