export type PiRuntimeStatus='starting'|'idle'|'running'|'stopping'|'error';
export type PiThinkingLevel='off'|'minimal'|'low'|'medium'|'high'|'xhigh'|'max';
export type PiSessionSort='threaded'|'relevance'|'recent';

export interface PiSessionSummary {
  id:string;
  projectId:string;
  name:string;
  firstMessage:string;
  createdAt:number;
  modifiedAt:number;
  runCount:number;
  status:PiRuntimeStatus;
  hasSessionFile?:boolean;
  isCompacting?:boolean;
  parentSessionId?:string;
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
  type:'event'|'status'|'usage'|'error'|'sessions-changed';
  payload?:unknown;
}

export type PiAgentRequest=
  |{action:'listSessions';projectId:string}
  |{action:'searchSessions';projectId:string;query:string;sort:PiSessionSort}
  |{action:'openSession';projectId:string;sessionId:string}
  |{action:'newSession';projectId:string}
  |{action:'getEntries';projectId:string;sessionId:string;sinceEntryId?:string}
  |{action:'getSessionTree';projectId:string;sessionId:string}
  |{action:'navigateSessionTree';projectId:string;sessionId:string;entryId:string;summarize:boolean;customInstructions?:string}
  |{action:'abortSessionTreeNavigation';projectId:string;sessionId:string}
  |{action:'setSessionEntryLabel';projectId:string;sessionId:string;entryId:string;label?:string}
  |{action:'forkSession';projectId:string;sessionId:string;entryId:string}
  |{action:'cloneSession';projectId:string;sessionId:string}
  |{action:'releaseSession';projectId:string;sessionId:string}
  |{action:'exportHtml';projectId:string;sessionId:string}
  |{action:'renameSession';projectId:string;sessionId:string;name:string}
  |{action:'deleteSession';projectId:string;sessionId:string}
  |{action:'closeProject';projectId:string}
  |{action:'prompt';projectId:string;sessionId:string;text:string}
  |{action:'stop';projectId:string;sessionId:string}
  |{action:'compact';projectId:string;sessionId:string}
  |{action:'setAutoCompaction';projectId:string;sessionId:string;enabled:boolean}
  |{action:'listProviders'}
  |{action:'saveApiKey';providerId:string;key:string}
  |{action:'removeApiKey';providerId:string}
  |{action:'listModels';projectId:string;sessionId?:string}
  |{action:'setModel';projectId:string;sessionId:string;provider:string;modelId:string}
  |{action:'setThinkingLevel';projectId:string;sessionId:string;level:PiThinkingLevel}
  |{action:'getModelDefaults';projectId?:string}
  |{action:'saveModelDefaults';provider:string;modelId:string;thinkingLevel:PiThinkingLevel};
