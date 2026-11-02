import type { CSSProperties } from 'react';
const paths = {
  review: 'M5 3h14v18H5V3Zm4 5h6m-6 4h6m-6 4h3',
  files: 'M8 3h9l4 4v14H8V3Zm9 0v5h4M4 3v14',
  folder: 'M3 6h6l2 2h10v12H3V6Z',
  file: 'M6 3h8l4 4v14H6V3Zm8 0v5h4',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5',
  moon: 'M20 15A8 8 0 0 1 9 4a8 8 0 1 0 11 11Z',
  chevron: 'm9 6 6 6-6 6',
  close: 'm6 6 12 12M6 18 18 6',
  save: 'M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8',
  split: 'M4 4h6v16H4V4Zm10 0h6v16h-6V4Z',
  merge: 'M4 4h16v16H4V4Zm5 5 3 3-3 3m6-6-3 3 3 3',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm8 3 2-1-2-4-2 1a8 8 0 0 0-2-1l-1-3h-5L9 7a8 8 0 0 0-2 1L5 7l-2 4 2 1a8 8 0 0 0 0 2l-2 1 2 4 2-1a8 8 0 0 0 2 1l1 3h5l1-3a8 8 0 0 0 2-1l2 1 2-4-2-1a8 8 0 0 0 0-2Z',
} as const;
export default function Icon({ name, size = 18, style }: {
  name: keyof typeof paths; size?: number; style?: CSSProperties;
}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
    <path d={paths[name]} />
  </svg>;
}
