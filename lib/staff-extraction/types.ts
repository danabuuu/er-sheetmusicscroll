export interface StaffBox {
  /** Padded render bounds — used for image cropping */
  top: number;
  bottom: number;
  /** True staff-line bounds — used for gap measurement and system grouping */
  lineTop: number;
  lineBottom: number;
  pageIndex: number;
}

export interface ScoreAnalysis {
  pageCount: number;
  /** All detected staves across all pages, in page order top-to-bottom. */
  staves: StaffBox[];
}

/**
 * Ordered list of indices into ScoreAnalysis.staves.
 * The nth entry in this array becomes the nth strip in the final scroll image.
 */
export type StaffSelection = number[];
