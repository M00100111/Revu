export interface PiRuntimeConfig {kind:'native'|'wsl';distribution?:string;nativeShellPath?:string}
export interface PiRuntimeInfo {config:PiRuntimeConfig;distributions:string[];defaultDistribution?:string;platform:string;bashPaths:string[];user:string;shell?:string;ready:boolean;error?:string}
export interface PiCwdRequest {id:string;saved:string;current:string}
export interface PiRuntimeChange {info:PiRuntimeInfo;restarted:{previousId:string;snapshot:PiSessionSnapshot}[]}
import type { Project } from './types';

export type PiRuntimeStatus='starting'|'idle'|'running'|'stopping'|'error';
export type PiThinkingLevel='off'|'minimal'|'low'|'medium'|'high'|'xhigh'|'max';
export type PiSessionSort='threaded'|'relevance'|'recent';
export type PiSessionScope='current'|'all';

export interface PiSlashCommand {name:string;description?:string;source:'builtin'|'extension'|'prompt'|'skill'}
export type PiTrustChoice='trust'|'parent'|'untrust';
export interface PiProjectTrust {
  cwd:string;parentPath?:string;saved:{path:string;decision:boolean}|null;
  current:boolean|null;needsDecision:boolean;
}
export interface PiTrustRequest {id:string;trust:PiProjectTrust}
export interface PiTrustSaveResponse {trust:PiProjectTrust;restarted:{previousId:string;snapshot:PiSessionSnapshot}[]}

export interface PiSessionSummary {
  id:string;
  projectId:string;
  /** Project directory with Windows drive mounts translated to host paths. */
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
  question?:boolean;
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
  cwd?:string;
  extensionRequests?:PiExtensionRequest[];
}

export type PiExtensionRequest={id:string;title:string;deadline?:number;group?:{id:string;index:number;total:number}}&(
  |{method:'select';options:string[]}
  |{method:'confirm';message:string}
  |{method:'input';placeholder?:string}
  |{method:'editor';prefill?:string}
);
export type PiExtensionReply={cancelled:true}|{value:string}|{confirmed:boolean};
export interface PiExtensionPending {projectId:string;sessionId:string;requests:PiExtensionRequest[]}

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
  type:'event'|'status'|'usage'|'error'|'sessions-changed'|'bash'|'retained-queue'|'trust-request'|'warning'|'resources-changed'|'cwd-request'|'runtime-changed'|'extension-ui'|'extension-notify';
  payload?:unknown;
}

export type PiAgentRequest=
  |{action:'getExtensionRequests'}
  |{action:'respondExtensionUI';projectId:string;sessionId:string;requestId:string;reply:PiExtensionReply}
  |{action:'getRuntimeCwd';projectId:string}
  |{action:'getRuntimeInfo'}
  |{action:'chooseBashPath'}
  |{action:'setRuntime';config:PiRuntimeConfig}
  |{action:'respondSessionCwd';requestId:string;accept:boolean}
  |{action:'getCommands';projectId:string;sessionId?:string}
  |{action:'getProjectTrust';projectId:string;sessionId?:string}
  |{action:'saveProjectTrust';projectId:string;choice:PiTrustChoice;sessionId?:string}
  |{action:'respondProjectTrust';requestId:string;choice:PiTrustChoice|null}
  |{action:'reloadResources';projectId:string;sessionId:string}
  |{action:'listSessions';projectId:string;scope?:PiSessionScope}
  |{action:'searchSessions';projectId:string;query:string;sort:PiSessionSort;scope?:PiSessionScope}
  |{action:'openSession';projectId:string;sessionId:string}
  |{action:'getSessionSnapshot';projectId:string;sessionId:string}
  |{action:'leaveSession';sessionId:string}
  |{action:'retainSessionTabs';sessionIds:string[]}
  |{action:'openDiscoveredSession';projectId:string;sessionId:string}
  |{action:'newSession';projectId:string}
  |{action:'latestSession'|'prepareNew'|'abandonNew';projectId:string}
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
