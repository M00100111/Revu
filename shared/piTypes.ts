export type PiRuntimeStatus='starting'|'idle'|'running'|'stopping'|'error';
export type PiThinkingLevel='off'|'minimal'|'low'|'medium'|'high'|'xhigh'|'max';

export interface PiSessionSummary {
  id:string;
  projectId:string;
  name:string;
  firstMessage:string;
  createdAt:number;
  modifiedAt:number;
  messageCount:number;
  status:PiRuntimeStatus;
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
  usage?:PiUsageStats;
  error?:string;
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
  |{action:'openSession';projectId:string;sessionId:string}
  |{action:'newSession';projectId:string}
  |{action:'renameSession';projectId:string;sessionId:string;name:string}
  |{action:'deleteSession';projectId:string;sessionId:string}
  |{action:'closeProject';projectId:string}
  |{action:'prompt';projectId:string;sessionId:string;text:string}
  |{action:'stop';projectId:string;sessionId:string}
  |{action:'listProviders'}
  |{action:'saveApiKey';providerId:string;key:string}
  |{action:'removeApiKey';providerId:string}
  |{action:'listModels';projectId:string;sessionId?:string}
  |{action:'setModel';projectId:string;sessionId:string;provider:string;modelId:string}
  |{action:'setThinkingLevel';projectId:string;sessionId:string;level:PiThinkingLevel}
  |{action:'getModelDefaults';projectId?:string}
  |{action:'saveModelDefaults';provider:string;modelId:string;thinkingLevel:PiThinkingLevel};
