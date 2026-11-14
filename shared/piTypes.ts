import type { Project } from './types';

export type PiRuntimeStatus='starting'|'idle'|'running'|'stopping'|'error';
export type PiThinkingLevel='off'|'minimal'|'low'|'medium'|'high'|'xhigh'|'max';
export type PiSessionSort='threaded'|'relevance'|'recent';
export type PiSessionScope='current'|'all';

export interface PiSessionSummary {
  id:string;
  projectId:string;
  cwd:string;
  name:string;
  hasName:boolean;
  scope:PiSessionScope;
  firstMessage:string;
  createdAt:number;
  modifiedAt:number;
  runCount:number;
  status:PiRuntimeStatus;
  hasSessionFile?:boolean;
  isCompacting?:boolean;
  parentSessionId?:string;
}

export interface PiSessionGroup {
  key:string;
  name:string;
  cwd:string;
  available:boolean;
}

export interface PiSessionCatalog {
  groups:PiSessionGroup[];
  sessions:PiSessionSummary[];
}

export interface PiSessionInfo {
  file:string;
  id:string;
  name?:string;
  messages:{total:number;user:number;assistant:number;toolCalls:number;toolResults:number};
  tokens:{input:number;cached:number;uncached:number;cacheWrite:number;output:number;total:number;cachePercent:number};
  cacheWarming:{mode:string;status:string;missPenalty?:number;refreshCost?:number};
  cost:number;
  costBreakdown:{key:string;cost:number;tokens:number}[];
  cacheRebilled?:{cost:number;tokens:number;missCount:number};
}

export interface PiSessionFolderResult {path:string;copied:number;skipped:number}

export interface PiDiscoveredSessionResponse {
  project:Project;
  snapshot:PiSessionSnapshot;
}

export interface PiSessionSearchResult extends PiSessionSummary {
  matchSnippet?:string;
}

export interface PiSessionEntry {
  id:string;
  parentId:string|null;
  type:string;
  timestamp:string;
  [key:string]:unknown;
}

export interface PiEntriesResponse {
  entries:PiSessionEntry[];
  leafId:string|null;
}

export interface PiSessionTreeNode {
  entry:PiSessionEntry;
  children:PiSessionTreeNode[];
  label?:string;
  labelTimestamp?:string;
}

export interface PiSessionTreeResponse {
  tree:PiSessionTreeNode[];
  leafId:string|null;
}

export interface PiTreeNavigationResponse extends PiSessionTreeResponse {
  snapshot:PiSessionSnapshot;
  editorText?:string;
  cancelled:boolean;
  aborted?:boolean;
}

export interface PiProviderStatus {
  id:string;
  name:string;
  configured:boolean;
  maskedKey?:string;
}

export interface PiModelSummary {
  provider:string;
  id:string;
  contextWindow:number;
  reasoning:boolean;
}

export interface PiUsageStats {
  input:number;
  output:number;
  cacheRead:number;
  cacheWrite:number;
  total:number;
  cost:number;
  runs:number;
  toolCalls:number;
  cacheHitPercent:number;
  contextTokens?:number|null;
  contextWindow?:number;
  contextPercent?:number|null;
}

export interface PiQueueState {
  steering:string[];
  followUp:string[];
}

export interface PiDirectBashState {
  command:string;
  output:string;
  status:'running'|'done'|'error';
  excludeFromContext:boolean;
  startedAt:number;
  exitCode?:number|null;
  cancelled?:boolean;
  truncated?:boolean;
  fullOutputPath?:string;
  error?:string;
}

export interface PiContextProjectionEntry {
  sourceEntry:PiSessionEntry;
  messages:unknown[];
}

export interface PiContextProjection {
  entries:PiContextProjectionEntry[];
  messages:unknown[];
  thinkingLevel:string;
  model:{provider:string;modelId:string}|null;
}

export interface PiCompactionModelOverride {
  reserveTokens?:number;
  keepRecentTokens?:number;
}

export interface PiCompactionConfiguration {
  enabled:boolean;
  reserveTokens:number;
  keepRecentTokens:number;
  modelOverrides:Record<string,PiCompactionModelOverride>;
}

export interface PiSessionSnapshot {
  sessionId:string;
  projectId:string;
  status:PiRuntimeStatus;
  name:string;
  messages:unknown[];
  model?:PiModelSummary;
  thinkingLevel:PiThinkingLevel;
  availableThinkingLevels:PiThinkingLevel[];
  autoCompactionEnabled:boolean;
  isCompacting:boolean;
  queue?:PiQueueState;
  retainedQueue?:PiQueueState;
  bash?:PiDirectBashState;
  usage?:PiUsageStats;
  error?:string;
}

export interface PiCompactionResult {
  tokensBefore:number;
  estimatedTokensAfter?:number;
  cost?:number;
}

export interface PiCompactionResponse {
  snapshot:PiSessionSnapshot;
  result:PiCompactionResult;
}

export interface PiForkResponse {
  snapshot:PiSessionSnapshot;
  selectedText:string;
}

export interface PiModelDefaults {
  provider?:string;
  modelId?:string;
  thinkingLevel:PiThinkingLevel;
}

export interface RevuPiEvent {
  sessionId:string;
  projectId:string;
  type:'event'|'status'|'usage'|'error'|'sessions-changed'|'bash'|'retained-queue';
  payload?:unknown;
}

export type PiAgentRequest=
  |{action:'listSessions';projectId:string;scope?:PiSessionScope}
  |{action:'searchSessions';projectId:string;query:string;sort:PiSessionSort;scope?:PiSessionScope}
  |{action:'openSession';projectId:string;sessionId:string}
  |{action:'openDiscoveredSession';projectId:string;sessionId:string}
  |{action:'newSession';projectId:string}
  |{action:'getSessionInfo';projectId:string;sessionId:string}
  |{action:'chooseSessionFolder';projectId:string}
  |{action:'getEntries';projectId:string;sessionId:string;sinceEntryId?:string}
  |{action:'getSessionTree';projectId:string;sessionId:string}
  |{action:'navigateSessionTree';projectId:string;sessionId:string;entryId:string;summarize:boolean;customInstructions?:string}
  |{action:'abortSessionTreeNavigation';projectId:string;sessionId:string}
  |{action:'setSessionEntryLabel';projectId:string;sessionId:string;entryId:string;label?:string}
  |{action:'forkSession';projectId:string;sessionId:string;entryId:string}
  |{action:'cloneSession';projectId:string;sessionId:string}
  |{action:'releaseSession';projectId:string;sessionId:string}
  |{action:'exportHtml';projectId:string;sessionId:string}
  |{action:'renameSession';projectId:string;sessionId:string;name:string;scope?:PiSessionScope}
  |{action:'deleteSession';projectId:string;sessionId:string;scope?:PiSessionScope}
  |{action:'closeProject';projectId:string}
  |{action:'prompt';projectId:string;sessionId:string;text:string}
  |{action:'steer';projectId:string;sessionId:string;text:string}
  |{action:'followUp';projectId:string;sessionId:string;text:string}
  |{action:'clearQueue';projectId:string;sessionId:string}
  |{action:'setRetainedQueue';projectId:string;sessionId:string;queue:PiQueueState}
  |{action:'stop';projectId:string;sessionId:string}
  |{action:'bash';projectId:string;sessionId:string;command:string;excludeFromContext:boolean}
  |{action:'abortBash';projectId:string;sessionId:string}
  |{action:'abortRetry';projectId:string;sessionId:string}
  |{action:'compact';projectId:string;sessionId:string;customInstructions?:string}
  |{action:'getContextProjection';projectId:string;sessionId:string}
  |{action:'setAutoCompaction';projectId:string;sessionId:string;enabled:boolean}
  |{action:'listProviders'}
  |{action:'saveApiKey';providerId:string;key:string}
  |{action:'removeApiKey';providerId:string}
  |{action:'listModels';projectId:string;sessionId?:string}
  |{action:'setModel';projectId:string;sessionId:string;provider:string;modelId:string}
  |{action:'setThinkingLevel';projectId:string;sessionId:string;level:PiThinkingLevel}
  |{action:'getModelDefaults';projectId?:string}
  |{action:'saveModelDefaults';provider:string;modelId:string;thinkingLevel:PiThinkingLevel}
  |{action:'getCompactionConfiguration';projectId?:string}
  |{action:'saveCompactionConfiguration';configuration:PiCompactionConfiguration};
