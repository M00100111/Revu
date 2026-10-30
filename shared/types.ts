export interface Project {
  id: string;
  name: string;
  root: string;
  git: boolean;
  base: string | null;
}
export interface Entry { name: string; kind: 'file' | 'directory' }
export interface Snapshot {
  text: string;
  hash: string;
  exists: boolean;
  bom: boolean;
  reason?: string;
}
export interface ChangeFile { path: string; status: string; reason?: string }
export interface ProjectStatus {
  files: ChangeFile[];
  head: string | null;
  base: string | null;
  changedHead: boolean;
  branch: string | null;
}
export type ChunkKind = 'add' | 'modify' | 'delete';
export interface Chunk {
  id: string;
  kind: ChunkKind;
  oldStart: number;
  oldEnd: number;
  start: number;
  end: number;
  oldText: string;
  newText: string;
  line: number;
}
export interface ReviewRecord extends Chunk {
  decision: 'accepted' | 'rejected';
  stale: boolean;
}
export interface DiffResult { version: number; chunks: Chunk[]; changes: Chunk[] }
export type ReviewAction = 'accept' | 'reject' | 'undo';
export type ReviewBulkAction = 'accept' | 'reject' | 'undo';
