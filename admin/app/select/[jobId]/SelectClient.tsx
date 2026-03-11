'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { ScoreAnalysis, StaffBox } from '@lib/staff-extraction/types';
import type { Song } from '@/lib/supabase';

interface SelectionEntry {
  stave: StaffBox;
  /** Stable key: `auto-{idx}` for detected staves, `manual-{uuid}` for user-added */
  key: string;
  manual: boolean;
}

/** Sort comparator: page order, then top-to-bottom within a page. */
function byPageThenTop(a: SelectionEntry, b: SelectionEntry) {
  if (a.stave.pageIndex !== b.stave.pageIndex) return a.stave.pageIndex - b.stave.pageIndex;
  return a.stave.lineTop - b.stave.lineTop;
}

interface Props {
  jobId: string;
  analysis: ScoreAnalysis;
}

export default function SelectClient({ jobId, analysis }: Props) {
  const { staves, pageCount } = analysis;

  const [selection, setSelection] = useState<SelectionEntry[]>([]);
  const [detectingPage, setDetectingPage] = useState<number | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [scrollUrl, setScrollUrl] = useState<string | null>(null);
  const [buildError, setBuildError] = useState('');
  const [saved, setSaved] = useState(false);

  // Song picker
  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedSongId, setSelectedSongId] = useState<number | null>(null);
  const [tempo, setTempo] = useState<string>('');

  useEffect(() => {
    fetch('/api/songs').then(r => r.json()).then(setSongs).catch(() => {});
  }, []);

  // key → 1-based position in selection (for overlay labels)
  const selectionPos = new Map(selection.map((e, pos) => [e.key, pos + 1]));

  /** Add a stave to the selection, deduplicating by overlap, and keep sorted. */
  function addEntry(entry: SelectionEntry) {
    setSelection(prev => {
      // Skip if any existing entry overlaps this stave on the same page
      const overlaps = prev.some(e =>
        e.stave.pageIndex === entry.stave.pageIndex &&
        e.stave.lineTop < entry.stave.lineBottom &&
        entry.stave.lineTop < e.stave.lineBottom
      );
      if (overlaps) return prev;
      return [...prev, entry].sort(byPageThenTop);
    });
  }

  function toggleAutoStave(staveIdx: number) {
    const key = `auto-${staveIdx}`;
    if (selectionPos.has(key)) {
      setSelection(prev => prev.filter(e => e.key !== key));
    } else {
      addEntry({ stave: staves[staveIdx], key, manual: false });
    }
  }

  function removeFromSelection(key: string) {
    setSelection(prev => prev.filter(e => e.key !== key));
  }

  /** Called when the user clicks a blank area of a page: detect staff at that point.
   * Falls back to a size-estimated box if pixel detection fails. */
  const handlePageClick = useCallback(async (
    pageIndex: number, naturalY: number, naturalH: number,
  ) => {
    setDetectingPage(pageIndex);
    setDetectError(null);
    try {
      const res = await fetch('/api/detect-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, pageIndex, yNatural: naturalY }),
      });

      let stave: StaffBox;

      if (res.ok) {
        stave = await res.json();
        // If the detected stave overlaps an already-shown auto-detected box,
        // tell the user to click that existing grey box instead.
        const alreadyDetected = staves.some(
          s => s.pageIndex === stave.pageIndex &&
            s.lineTop < stave.lineBottom &&
            stave.lineTop < s.lineBottom
        );
        if (alreadyDetected) {
          setDetectError('That staff was already detected — click its grey box to select it');
          return;
        }
      } else {
        // Pixel detection failed — place a box at the click position sized to
        // match the median stave height on this page (or across all pages).
        const pageStaves = staves.filter(s => s.pageIndex === pageIndex);
        const pool = pageStaves.length > 0 ? pageStaves : staves;
        const heights = pool.map(s => s.bottom - s.top).sort((a, b) => a - b);
        const medianH = heights.length > 0
          ? heights[Math.floor(heights.length / 2)]
          : Math.round(naturalH / 20);
        const half = Math.round(medianH / 2);
        const pad  = Math.round(medianH * 0.15);
        const top    = Math.max(0, naturalY - half);
        const bottom = Math.min(naturalH, naturalY + half);
        stave = { top, bottom, lineTop: top + pad, lineBottom: bottom - pad, pageIndex };
      }

      const key = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      addEntry({ stave, key, manual: true });
    } catch {
      setDetectError('Network error — is the dev server running?');
    } finally {
      setDetectingPage(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, staves]);

  async function handleBuild() {
    if (selection.length === 0) return;
    setBuilding(true);
    setBuildError('');
    setScrollUrl(null);
    setSaved(false);
    try {
      const tempoNum = tempo.trim() !== '' ? parseInt(tempo, 10) : undefined;
      const res = await fetch('/api/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          staves: selection.map(e => e.stave),
          ...(selectedSongId !== null ? { songId: selectedSongId } : {}),
          ...(tempoNum && tempoNum > 0 ? { tempo: tempoNum } : {}),
        }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      setScrollUrl(URL.createObjectURL(blob));
      if (selectedSongId !== null) setSaved(true);
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : 'Build failed');
    } finally {
      setBuilding(false);
    }
  }

  // Group detected stave indices by page
  const stavesByPage: Record<number, number[]> = {};
  staves.forEach((_, idx) => {
    const pg = staves[idx].pageIndex;
    (stavesByPage[pg] ??= []).push(idx);
  });

  // Group manual selection entries by page (for overlay rendering)
  const manualByPage: Record<number, SelectionEntry[]> = {};
  selection.filter(e => e.manual).forEach(e => {
    const pg = e.stave.pageIndex;
    (manualByPage[pg] ??= []).push(e);
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between gap-4 pr-60">
        <h1 className="text-lg font-semibold">Select Staves</h1>
        <div className="flex-1 flex flex-col justify-center min-w-0">
          <p className="text-sm text-gray-500 truncate">
            {detectingPage !== null
              ? `Detecting staff on page ${detectingPage + 1}…`
              : selection.length === 0
              ? 'Click a stave box to select it. Click blank page areas to detect missed staves.'
              : `${selection.length} stave${selection.length !== 1 ? 's' : ''} selected — ordered top-to-bottom`}
          </p>
          {detectError && (
            <p className="text-xs text-amber-600 truncate">{detectError}</p>
          )}
        </div>
        <button
          onClick={handleBuild}
          disabled={selection.length === 0 || building}
          className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold
            text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {building ? 'Building…' : 'Build Scroll'}
        </button>
      </header>

      <div className="pr-56">
        {/* ── Page images ───────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-8 p-6">
          {Array.from({ length: pageCount }, (_, pageIdx) => (
            <PageView
              key={pageIdx}
              jobId={jobId}
              pageIndex={pageIdx}
              staveIndices={stavesByPage[pageIdx] ?? []}
              staves={staves}
              selectionPos={selectionPos}
              manualEntries={manualByPage[pageIdx] ?? []}
              detecting={detectingPage === pageIdx}
              onToggle={toggleAutoStave}
              onRemoveManual={removeFromSelection}
              onPageClick={handlePageClick}
            />
          ))}
        </div>
      </div>

      {/* ── Selection sidebar ───────────────────────────────────────────── */}
      <aside className="fixed top-[3.75rem] right-0 h-[calc(100vh-3.75rem)] w-56 z-10 border-l border-gray-200 bg-white flex flex-col">

          {/* Song + tempo */}
          <div className="shrink-0 border-b border-gray-100 p-3 flex flex-col gap-2">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Song</label>
            <select
              value={selectedSongId ?? ''}
              onChange={e => {
                const id = e.target.value ? Number(e.target.value) : null;
                setSelectedSongId(id);
                if (id) {
                  const song = songs.find(s => s.id === id);
                  if (song?.tempo) setTempo(String(song.tempo));
                }
              }}
              className="w-full rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 bg-white"
            >
              <option value="">— no song —</option>
              {songs.map(s => (
                <option key={s.id} value={s.id}>
                  {s.title}{s.artist ? ` · ${s.artist}` : ''}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-400 shrink-0">BPM</label>
              <input
                type="number"
                min={20}
                max={300}
                value={tempo}
                onChange={e => setTempo(e.target.value)}
                placeholder="e.g. 120"
                className="w-full rounded border border-gray-200 px-2 py-1 text-xs text-gray-700"
              />
            </div>
          </div>

          {/* Scroll order list — scrollable */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
              Scroll order
            </h2>
            {selection.length === 0 && (
              <p className="text-xs text-gray-400 italic">Nothing selected yet</p>
            )}
            {selection.map((entry, pos) => (
              <div
                key={entry.key}
                className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${
                  entry.manual
                    ? 'border-green-200 bg-green-50'
                    : 'border-gray-200 bg-gray-50'
                }`}
              >
                <span className={`w-5 text-center font-mono font-bold ${entry.manual ? 'text-green-700' : 'text-indigo-600'}`}>
                  {pos + 1}
                </span>
                <span className="flex-1 text-gray-600">
                  p{entry.stave.pageIndex + 1}{entry.manual ? ' ✦' : ''}
                </span>
                <button
                  onClick={() => removeFromSelection(entry.key)}
                  className="text-gray-300 hover:text-red-500 ml-1 font-bold leading-none"
                  title="Remove"
                >×</button>
              </div>
            ))}
            {selection.length > 0 && (
              <button
                onClick={() => setSelection([])}
                className="mt-2 text-xs text-gray-400 hover:text-red-500 underline"
              >
                Clear all
              </button>
            )}
          </div>

          {/* Build result — pinned to bottom of sidebar */}
          {(buildError || scrollUrl) && (
            <div className="shrink-0 border-t border-gray-200 p-3 flex flex-col gap-2">
              {buildError && (
                <p className="text-xs text-red-600">{buildError}</p>
              )}
              {scrollUrl && (
                <>
                  {saved && (
                    <p className="text-xs font-semibold text-green-600">✓ Saved to library</p>
                  )}
                  <p className="text-xs font-semibold text-gray-600">Scroll preview</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={scrollUrl}
                    alt="Scroll preview"
                    className="border border-gray-200 rounded w-full"
                    style={{ maxHeight: 80, objectFit: 'contain', objectPosition: 'top' }}
                  />
                  <a
                    href={scrollUrl}
                    download="scroll.png"
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    Download scroll.png
                  </a>
                </>
              )}
            </div>
          )}
      </aside>
    </div>
  );
}

// ─── PageView ─────────────────────────────────────────────────────────────────

interface PageViewProps {
  jobId: string;
  pageIndex: number;
  staveIndices: number[];
  staves: StaffBox[];
  selectionPos: Map<string, number>;
  manualEntries: SelectionEntry[];
  detecting: boolean;
  onToggle: (staveIdx: number) => void;
  onRemoveManual: (key: string) => void;
  onPageClick: (pageIndex: number, naturalY: number, naturalH: number) => void;
}

function PageView({
  jobId, pageIndex, staveIndices, staves, selectionPos, manualEntries,
  detecting, onToggle, onRemoveManual, onPageClick,
}: PageViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [renderW, setRenderW] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => setRenderW(entry.contentRect.width));
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const scale = dims ? renderW / dims.w : 1;

  function handleSvgClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!dims) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const naturalY = Math.round((e.clientY - rect.top) / scale);
    onPageClick(pageIndex, naturalY, dims.h);
  }

  return (
    <div className="w-full max-w-4xl bg-white rounded-xl shadow overflow-hidden">
      <p className="px-4 py-2 text-xs text-gray-400 border-b border-gray-100">
        Page {pageIndex + 1}
        {detecting && <span className="ml-2 text-amber-500 animate-pulse">detecting…</span>}
      </p>
      <div ref={containerRef} className="relative w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/pages/${jobId}/${pageIndex}`}
          alt={`Page ${pageIndex + 1}`}
          className="w-full block"
          onLoad={e => {
            const img = e.currentTarget;
            setDims({ w: img.naturalWidth, h: img.naturalHeight });
            setRenderW(img.clientWidth);
          }}
        />

        {dims && renderW > 0 && (
          <svg
            className="absolute inset-0 cursor-crosshair"
            width={renderW}
            height={dims.h * scale}
            viewBox={`0 0 ${renderW} ${dims.h * scale}`}
            onClick={handleSvgClick}
          >
            {/* Auto-detected staves */}
            {staveIndices.map(staveIdx => {
              const stave = staves[staveIdx];
              const key = `auto-${staveIdx}`;
              const top    = stave.top    * scale;
              const bottom = stave.bottom * scale;
              const pos    = selectionPos.get(key);
              const selected = pos !== undefined;

              return (
                <g
                  key={staveIdx}
                  className="pointer-events-auto cursor-pointer"
                  onClick={e => { e.stopPropagation(); onToggle(staveIdx); }}
                >
                  <rect
                    x={0} y={top} width={renderW} height={bottom - top}
                    fill={selected ? 'rgba(99,102,241,0.25)' : 'rgba(156,163,175,0.12)'}
                    stroke={selected ? '#4f46e5' : '#9ca3af'}
                    strokeWidth={selected ? 2 : 1}
                  />
                  {selected && (
                    <text x={8} y={top + 14} fontSize={13} fontWeight="bold" fontFamily="monospace" fill="#4f46e5">
                      {pos}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Manually detected staves — click to remove */}
            {manualEntries.map(entry => {
              const top    = entry.stave.top    * scale;
              const bottom = entry.stave.bottom * scale;
              const pos    = selectionPos.get(entry.key)!;
              return (
                <g
                  key={entry.key}
                  className="pointer-events-auto cursor-pointer"
                  onClick={e => { e.stopPropagation(); onRemoveManual(entry.key); }}
                >
                  <rect
                    x={0} y={top} width={renderW} height={bottom - top}
                    fill="rgba(34,197,94,0.2)"
                    stroke="#16a34a"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                  />
                  <text x={8} y={top + 14} fontSize={13} fontWeight="bold" fontFamily="monospace" fill="#16a34a">
                    {pos}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

