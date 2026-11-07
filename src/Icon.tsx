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
  notifications: 'M6 17h12l-2-3V9a4 4 0 0 0-8 0v5l-2 3Zm4 3h4',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm8 3 2-1-2-4-2 1a8 8 0 0 0-2-1l-1-3h-5L9 7a8 8 0 0 0-2 1L5 7l-2 4 2 1a8 8 0 0 0 0 2l-2 1 2 4 2-1a8 8 0 0 0 2 1l1 3h5l1-3a8 8 0 0 0 2-1l2 1 2-4-2-1a8 8 0 0 0 0-2Z',
  agent: 'M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4.5A2 2 0 0 1 3 15V6a2 2 0 0 1 2-2Zm3 6h8m-8 4h5',
  plus: 'M12 5v14M5 12h14',
  send: 'm4 4 17 8-17 8 4-8-4-8Zm4 8h13',
  stop: 'M7 7h10v10H7V7Z',
  expand: 'M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5',
  collapse: 'M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5',
  edit: 'm4 20 4-1 11-11-3-3L5 16l-1 4ZM14 7l3 3',
  trash: 'M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6',
} as const;
export default function Icon({ name, size = 18, style }: {
  name: keyof typeof paths; size?: number; style?: CSSProperties;
}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
    <path d={paths[name]} />
  </svg>;
}
