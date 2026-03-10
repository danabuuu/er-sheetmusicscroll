'use client';

import { useState, useRef, useEffect } from 'react';
import type { ScoreAnalysis, StaffBox } from '@lib/staff-extraction/types';

interface Props {
  jobId: string;
  analysis: ScoreAnalysis;
}

export default function SelectClient({ jobId, analysis }: Props) {
  const { staves, pageCount } = analysis;

  // ordered list of stave indices to include in the scroll
  const [selection, setSelection] = useState<number[]>([]);

  const [building, setBuilding] = useState(false);
  const [scrollUrl, setScrollUrl] = useState<string | null>(null);
  const [buildError, setBuildError] = useState('');

  // Map staveIndex → position (1-based) in selection, or undefined if not selected
  const selectionPos = new Map(selection.map((idx, pos) => [idx, pos + 1]));

  function toggleStave(staveIdx: number) {
    if (selectionPos.has(staveIdx)) {
      setSelection(prev => prev.filter(i => i !== staveIdx));
    } else {
      setSelection(prev => [...prev, staveIdx]);
    }
  }

  function removeFromSelection(staveIdx: number) {
    setSelection(prev => prev.filter(i => i !== staveIdx));
  }

  function moveUp(pos: number) {
    if (pos <= 1) return;
    setSelection(prev => {
      const next = [...prev];
      [next[pos - 2], next[pos - 1]] = [next[pos - 1], next[pos - 2]];
      return next;
    });
  }

  function moveDown(pos: number) {
    setSelection(prev => {
      if (pos >= prev.length) return prev;
      const next = [...prev];
      [next[pos - 1], next[pos]] = [next[pos], next[pos - 1]];
      return next;
    });
  }

  async function handleBuild() {
    if (selection.length === 0) return;
    setBuilding(true);
    setBuildError('');
    setScrollUrl(null);
    try {
      const res = await fetch('/api/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, staveIndices: selection }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      setScrollUrl(URL.createObjectURL(blob));
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : 'Build failed');
    } finally {
      setBuilding(false);
    }
  }

  // Group stave indices by page
  const stavesByPage: Record<number, number[]> = {};
  staves.forEach((_, idx) => {
    const pg = staves[idx].pageIndex;
    (stavesByPage[pg] ??= []).push(idx);
  });

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">Select Staves</h1>
        <p className="text-sm text-gray-500 flex-1">
          {selection.length === 0
            ? 'Click stave boxes to add them to the scroll, in order'
            : `${selection.length} stave${selection.length !== 1 ? 's' : ''} selected`}
        </p>
        <button
          onClick={handleBuild}
          disabled={selection.length === 0 || building}
          className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold
            text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {building ? 'Building…' : 'Build Scroll'}
        </button>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* ── Page images ───────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto flex flex-col items-center gap-8 p-6">
          {Array.from({ length: pageCount }, (_, pageIdx) => (
            <PageView
              key={pageIdx}
              jobId={jobId}
              pageIndex={pageIdx}
              staveIndices={stavesByPage[pageIdx] ?? []}
              staves={staves}
              selectionPos={selectionPos}
              onToggle={toggleStave}
            />
          ))}
        </div>

        {/* ── Selection sidebar ─────────────────────────────────────── */}
        <aside className="w-52 shrink-0 border-l border-gray-200 bg-white overflow-y-auto p-4 flex flex-col gap-2">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
            Scroll order
          </h2>
          {selection.length === 0 && (
            <p className="text-xs text-gray-400 italic">Nothing selected yet</p>
          )}
          {selection.map((staveIdx, pos) => {
            const stave = staves[staveIdx];
            return (
              <div
                key={staveIdx}
                className="flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs"
              >
                <span className="w-5 text-center font-mono font-bold text-indigo-600">
                  {pos + 1}
                </span>
                <span className="flex-1 text-gray-600">
                  p{stave.pageIndex + 1}
                </span>
                <div className="flex flex-col">
                  <button
                    onClick={() => moveUp(pos + 1)}
                    disabled={pos === 0}
                    className="text-gray-400 hover:text-gray-700 disabled:opacity-20 leading-none"
                    title="Move up"
                  >▲</button>
                  <button
                    onClick={() => moveDown(pos + 1)}
                    disabled={pos === selection.length - 1}
                    className="text-gray-400 hover:text-gray-700 disabled:opacity-20 leading-none"
                    title="Move down"
                  >▼</button>
                </div>
                <button
                  onClick={() => removeFromSelection(staveIdx)}
                  className="text-gray-300 hover:text-red-500 ml-1 font-bold leading-none"
                  title="Remove"
                >×</button>
              </div>
            );
          })}
          {selection.length > 0 && (
            <button
              onClick={() => setSelection([])}
              className="mt-2 text-xs text-gray-400 hover:text-red-500 underline"
            >
              Clear all
            </button>
          )}
        </aside>
      </div>

      {/* ── Build result ──────────────────────────────────────────────── */}
      {(buildError || scrollUrl) && (
        <div className="px-6 py-4 border-t border-gray-200 bg-white">
          {buildError && (
            <p className="text-sm text-red-600 mb-2">{buildError}</p>
          )}
          {scrollUrl && (
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">Scroll preview</h2>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={scrollUrl}
                alt="Scroll preview"
                className="border border-gray-200 rounded max-w-full"
                style={{ maxHeight: 120 }}
              />
              <a
                href={scrollUrl}
                download="scroll.png"
                className="self-start text-sm text-indigo-600 hover:underline"
              >
                Download scroll.png
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── PageView ─────────────────────────────────────────────────────────────────

interface PageViewProps {
  jobId: string;
  pageIndex: number;
  staveIndices: number[];  // indices into analysis.staves on this page
  staves: StaffBox[];
  selectionPos: Map<number, number>;  // staveIdx → 1-based position
  onToggle: (staveIdx: number) => void;
}

function PageView({ jobId, pageIndex, staveIndices, staves, selectionPos, onToggle }: PageViewProps) {
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

  return (
    <div className="w-full max-w-4xl bg-white rounded-xl shadow overflow-hidden">
      <p className="px-4 py-2 text-xs text-gray-400 border-b border-gray-100">
        Page {pageIndex + 1}
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
            className="absolute inset-0 pointer-events-none"
            width={renderW}
            height={dims.h * scale}
            viewBox={`0 0 ${renderW} ${dims.h * scale}`}
          >
            {staveIndices.map(staveIdx => {
              const stave = staves[staveIdx];
              const top    = stave.top    * scale;
              const bottom = stave.bottom * scale;
              const pos    = selectionPos.get(staveIdx);
              const selected = pos !== undefined;

              return (
                <g
                  key={staveIdx}
                  className="pointer-events-auto cursor-pointer"
                  onClick={() => onToggle(staveIdx)}
                >
                  <rect
                    x={0}
                    y={top}
                    width={renderW}
                    height={bottom - top}
                    fill={selected ? 'rgba(99,102,241,0.25)' : 'rgba(156,163,175,0.12)'}
                    stroke={selected ? '#4f46e5' : '#9ca3af'}
                    strokeWidth={selected ? 2 : 1}
                  />
                  {selected && (
                    <text
                      x={8}
                      y={top + 14}
                      fontSize={13}
                      fontWeight="bold"
                      fontFamily="monospace"
                      fill="#4f46e5"
                    >
                      {pos}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

