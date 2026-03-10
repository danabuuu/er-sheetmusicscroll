export interface StaffBox {
  top: number;      // pixel row on the page image
  bottom: number;
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
