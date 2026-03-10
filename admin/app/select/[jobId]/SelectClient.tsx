'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import type { ScoreAnalysis, System } from '@lib/staff-extraction/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  jobId: string;
  analysis: ScoreAnalysis;
}

// staffIndex selected per system  (undefined = follows global)
type Overrides = Record<number, number>;

// merges.has(n) means "system n is merged with system n+1"
type Merges = Set<number>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function effectiveStaffIndex(
  system: System,
  globalIndex: number | null,
  overrides: Overrides
): number | null {
  if (overrides[system.systemIndex] !== undefined) return overrides[system.systemIndex];
  return globalIndex;
}

/**
 * Walk back through merges to find the group leader for a system.
 * e.g. if systems 3 and 4 are merged, system 4's leader is system 3.
 */
function groupLeader(sysIdx: number, merges: Merges): number {
  let leader = sysIdx;
  while (leader > 0 && merges.has(leader - 1)) leader--;
  return leader;
}

/**
 * 1-based display number that skips merged followers.
 * e.g. if sys 3 is merged into sys 2, then sys 4 displays as S3, sys 5 as S4…
 */
function logicalNumber(sysIdx: number, merges: Merges): number {
  let count = 0;
  for (let i = 0; i <= sysIdx; i++) {
    if (groupLeader(i, merges) === i) count++;
  }
  return count;
}

/**
 * Compute the full per-system staff-index map respecting merges:
 * every system in a merged group uses the staff index of the group leader.
 */
function computeMergedMap(
  systems: System[],
  globalIndex: number,
  overrides: Overrides,
  merges: Merges,
): Record<number, number> {
  const map: Record<number, number> = {};
  for (const sys of systems) {
    const leader = groupLeader(sys.systemIndex, merges);
    const leaderSys = systems[leader];
    const leaderIdx = overrides[leader] ?? globalIndex;
    map[sys.systemIndex] = Math.min(leaderIdx, leaderSys.staves.length - 1);
  }
  return map;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SelectClient({ jobId, analysis }: Props) {
  const { systems, pageCount } = analysis;

  // Natural dimensions of each page image (needed to scale SVG overlays)
  const [pageDims, setPageDims] = useState<Record<number, { w: number; h: number }>>({});

  const [globalIndex, setGlobalIndex] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [merges, setMerges] = useState<Merges>(new Set());

  const [building, setBuilding] = useState(false);
  const [scrollUrl, setScrollUrl] = useState<string | null>(null);
  const [buildError, setBuildError] = useState('');

  // Group systems by page for rendering
  const systemsByPage: Record<number, System[]> = {};
  for (const sys of systems) {
    (systemsByPage[sys.pageIndex] ??= []).push(sys);
  }

  function handleStaffClick(system: System, staffIdx: number) {
    // Always operate on the group leader so merges share one selection
    const leader = groupLeader(system.systemIndex, merges);

    if (globalIndex === null) {
      setGlobalIndex(staffIdx);
      setOverrides({});
      return;
    }

    if (staffIdx === globalIndex && overrides[leader] !== undefined) {
      // Clicking global index on an overridden group resets the group override
      setOverrides(prev => {
        const next = { ...prev };
        delete next[leader];
        return next;
      });
      return;
    }

    if (staffIdx === globalIndex) {
      return; // already the global, nothing to do
    }

    setOverrides(prev => ({ ...prev, [leader]: staffIdx }));
  }

  function isMergedFollower(system: System): boolean {
    return groupLeader(system.systemIndex, merges) !== system.systemIndex;
  }

  // Effective selected staff for any system — always routed through group leader
  function effectiveIndexForSystem(system: System): number | null {
    const leader = groupLeader(system.systemIndex, merges);
    const leaderSys = systems[leader];
    return effectiveStaffIndex(leaderSys, globalIndex, overrides);
  }

  function boxColour(system: System, staffIdx: number): string {
    const effective = effectiveIndexForSystem(system);
    if (effective !== staffIdx) return 'rgba(100,149,237,0.25)';
    const leader = groupLeader(system.systemIndex, merges);
    if (overrides[leader] !== undefined) return 'rgba(255,165,0,0.55)';
    return 'rgba(250,204,21,0.55)';
  }

  function strokeColour(system: System, staffIdx: number): string {
    const effective = effectiveIndexForSystem(system);
    if (effective !== staffIdx) return '#6495ed';
    const leader = groupLeader(system.systemIndex, merges);
    if (overrides[leader] !== undefined) return '#d97706';
    return '#ca8a04';
  }

  async function handleBuild() {
    if (globalIndex === null) return;
    setBuilding(true);
    setBuildError('');
    setScrollUrl(null);

    // Build the StaffSelection payload — always per-system when merges or overrides exist
    const hasOverrides = Object.keys(overrides).length > 0;
    const hasMerges = merges.size > 0;
    const selection = (hasOverrides || hasMerges)
      ? {
          mode: 'per-system' as const,
          map: computeMergedMap(systems, globalIndex, overrides, merges),
        }
      : { mode: 'global' as const, staffIndex: globalIndex };

    try {
      const res = await fetch('/api/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, selection }),
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

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold">Select Staff</h1>

        {/* Summary */}
        <p className="text-sm text-gray-600 flex-1 min-w-0 truncate">
          {globalIndex === null
            ? 'Click a staff box to set the global selection'
            : `Global: staff ${globalIndex + 1}${
                Object.keys(overrides).length > 0
                  ? ` · ${Object.keys(overrides).length} override(s)`
                  : ''
              }`}
        </p>

        <button
          onClick={handleBuild}
          disabled={globalIndex === null || building}
          className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold
            text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {building ? 'Building…' : 'Build Scroll'}
        </button>
      </header>

      {/* ── Legend ────────────────────────────────────────────────────── */}
      <div className="flex gap-4 px-6 py-2 text-xs text-gray-500 bg-white border-b border-gray-100">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm bg-yellow-300 border border-yellow-600" />
          Global pick
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm bg-orange-300 border border-orange-600" />
          Per-system override (double-click to clear)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm bg-blue-200 border border-blue-400" />
          Other staff
        </span>
      </div>

      {/* ── Overrides summary ─────────────────────────────────────────── */}
      {Object.keys(overrides).length > 0 && (
        <div className="px-6 py-2 bg-orange-50 border-b border-orange-200 text-xs text-orange-800 flex flex-wrap gap-x-4 gap-y-1">
          {Object.entries(overrides).map(([sysIdx, stfIdx]) => (
            <span key={sysIdx}>
              S{logicalNumber(parseInt(sysIdx), merges)}: staff {stfIdx + 1}
              <button
                className="ml-1 underline"
                onClick={() =>
                  setOverrides(prev => {
                    const next = { ...prev };
                    delete next[parseInt(sysIdx)];
                    return next;
                  })
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ── Page images + SVG overlays ────────────────────────────────── */}
      <div className="flex flex-col items-center gap-8 p-6">
        {Array.from({ length: pageCount }, (_, pageIdx) => (
          <PageView
            key={pageIdx}
            jobId={jobId}
            pageIndex={pageIdx}
            systems={systemsByPage[pageIdx] ?? []}
            dims={pageDims[pageIdx]}
            onDimsLoaded={(w, h) =>
              setPageDims(prev => ({ ...prev, [pageIdx]: { w, h } }))
            }
            boxColour={boxColour}
            strokeColour={strokeColour}
            isMergedFollower={isMergedFollower}
            leaderIndexOf={sys => groupLeader(sys.systemIndex, merges)}
            logicalNumber={sys => logicalNumber(sys.systemIndex, merges)}
            onStaffClick={handleStaffClick}
            onOverrideReset={sysIdx =>
              setOverrides(prev => {
                const next = { ...prev };
                delete next[sysIdx];
                return next;
              })
            }
            merges={merges}
            onMerge={sysIdx => setMerges(prev => new Set([...prev, sysIdx]))}
            onUnmerge={sysIdx => setMerges(prev => { const next = new Set(prev); next.delete(sysIdx); return next; })}
          />
        ))}
      </div>

      {/* ── Build result ──────────────────────────────────────────────── */}
      {(buildError || scrollUrl) && (
        <div className="px-6 pb-10">
          {buildError && (
            <p className="text-sm text-red-600 mb-2">{buildError}</p>
          )}
          {scrollUrl && (
            <div className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">Scroll preview</h2>
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
  systems: System[];
  dims: { w: number; h: number } | undefined;
  onDimsLoaded: (w: number, h: number) => void;
  boxColour: (system: System, staffIdx: number) => string;
  strokeColour: (system: System, staffIdx: number) => string;
  isMergedFollower: (system: System) => boolean;
  leaderIndexOf: (system: System) => number;
  logicalNumber: (system: System) => number;
  onStaffClick: (system: System, staffIdx: number) => void;
  onOverrideReset: (sysIdx: number) => void;
  merges: Merges;
  onMerge: (sysIdx: number) => void;
  onUnmerge: (sysIdx: number) => void;
}

function PageView({
  jobId,
  pageIndex,
  systems,
  dims,
  onDimsLoaded,
  boxColour,
  strokeColour,
  isMergedFollower,
  leaderIndexOf,
  logicalNumber,
  onStaffClick,
  onOverrideReset,
  merges,
  onMerge,
  onUnmerge,
}: PageViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderW, setRenderW] = useState(0);

  // Track rendered width for SVG scaling
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      setRenderW(entry.contentRect.width);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const scale = dims ? renderW / dims.w : 1;

  return (
    <div className="w-full max-w-4xl bg-white rounded-xl shadow overflow-hidden">
      <p className="px-4 py-2 text-xs text-gray-400 border-b border-gray-100">
        Page {pageIndex + 1}
      </p>

      {/* Image + SVG stacked via relative/absolute */}
      <div ref={containerRef} className="relative w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/pages/${jobId}/${pageIndex}`}
          alt={`Page ${pageIndex + 1}`}
          className="w-full block"
          onLoad={e => {
            const img = e.currentTarget;
            onDimsLoaded(img.naturalWidth, img.naturalHeight);
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
            {systems.map(system =>
              system.staves.map((staff, staffIdx) => {
                const top    = staff.top    * scale;
                const bottom = staff.bottom * scale;
                const height = bottom - top;
                return (
                  <g
                    key={`${system.systemIndex}-${staffIdx}`}
                    className="pointer-events-auto cursor-pointer"
                    onClick={() => onStaffClick(system, staffIdx)}
                    onDoubleClick={() => onOverrideReset(system.systemIndex)}
                  >
                    <rect
                      x={0}
                      y={top}
                      width={renderW}
                      height={height}
                      fill={boxColour(system, staffIdx)}
                      stroke={strokeColour(system, staffIdx)}
                      strokeWidth={1.5}
                    />
                    {/* Label: only on the top staff of each system */}
                    {staffIdx === 0 && (
                      <text
                        x={6}
                        y={top + 12}
                        fontSize={11}
                        fill={strokeColour(system, staffIdx)}
                        fontFamily="monospace"
                      >
                        {isMergedFollower(system)
                          ? `↳ S${logicalNumber(system)}`
                          : `S${logicalNumber(system)}`}
                      </text>
                    )}
                  </g>
                );
              })
            )}
          </svg>
        )}

        {/* Merge / unmerge buttons between consecutive systems on this page */}
        {dims && renderW > 0 && systems.length > 1 &&
          systems.slice(0, -1).map((sys, i) => {
            const nextSys = systems[i + 1];
            // Gap midpoint in CSS pixels
            const gapY = ((sys.staves.at(-1)!.bottom + nextSys.staves[0].top) / 2) * scale;
            const isMerged = merges.has(sys.systemIndex);
            return (
              <button
                key={sys.systemIndex}
                onClick={() => isMerged ? onUnmerge(sys.systemIndex) : onMerge(sys.systemIndex)}
                style={{ top: gapY - 10, left: renderW / 2 - 48 }}
                className={`absolute z-10 px-2 py-0.5 rounded text-xs font-mono border shadow-sm
                  ${isMerged
                    ? 'bg-purple-100 border-purple-400 text-purple-700 hover:bg-purple-200'
                    : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-100'}`}
              >
                {isMerged ? '⊗ unmerge' : '⊕ merge'}
              </button>
            );
          })
        }
      </div>
    </div>
  );
}
