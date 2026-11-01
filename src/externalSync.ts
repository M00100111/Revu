import type { Chunk, ReviewRecord, Snapshot } from '../shared/types';

export type ExternalSyncKind = 'unchanged' | 'replace' | 'remove';

export function externalSyncKind(currentHash: string, external: Snapshot): ExternalSyncKind {
  if (!external.exists) return currentHash === 'missing' ? 'unchanged' : 'remove';
  return external.hash === currentHash ? 'unchanged' : 'replace';
}

export interface ExternalReviewState {
  synced: Snapshot;
  draftExists: boolean;
  dirty: boolean;
  version: number;
  reviewText: string;
  chunks: Chunk[];
  records: ReviewRecord[];
  computing: boolean;
  syncError?: string;
  notice: string;
}

export function resetForExternalSnapshot(state: ExternalReviewState, external: Snapshot) {
  state.synced = external;
  state.draftExists = external.exists;
  state.dirty = false;
  state.version++;
  state.reviewText = external.text;
  state.chunks = [];
  state.records = [];
  state.computing = false;
  state.syncError = '';
  state.notice = 'External changes loaded. Review state was reset.';
}
