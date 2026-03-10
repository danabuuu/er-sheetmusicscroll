export interface StaffBox {
  /** Padded render bounds — used for image cropping */
  top: number;
  bottom: number;
  /** True staff-line bounds — used for gap measurement and system grouping */
  lineTop: number;
  lineBottom: number;
  pageIndex: number;
}

export interface System {
  systemIndex: number;  // 0-based, sequential across all pages
  pageIndex: number;
  staves: StaffBox[];
}

export interface ScoreAnalysis {
  pageCount: number;
  systems: System[];
}

export type StaffSelection =
  | { mode: 'global'; staffIndex: number }
  | { mode: 'per-system'; map: Record<number, number> }; // systemIndex → staffIndex
