import type { PiCompactionConfiguration, PiCompactionResponse, PiContextProjection, PiDirectBashState, PiDiscoveredSessionResponse, PiEntriesResponse, PiForkResponse, PiModelDefaults, PiModelSummary, PiProviderStatus, PiQueueState, PiSessionCatalog, PiSessionFolderResult, PiSessionInfo, PiSessionScope, PiSessionSearchResult, PiSessionSnapshot, PiSessionSort, PiSessionTreeResponse, PiThinkingLevel, PiTreeNavigationResponse, RevuPiEvent } from '../shared/piTypes';
interface RevuResponse<T>{ok:boolean;value?:T;status?:number;error?:string}
interface RevuAgentApi {
  listSessions(projectId:string,scope?:PiSessionScope):Promise<RevuResponse<PiSessionCatalog>>;
  searchSessions(projectId:string,query:string,sort:PiSessionSort,scope?:PiSessionScope):Promise<RevuResponse<PiSessionSearchResult[]>>;
  openSession(projectId:string,sessionId:string):Promise<RevuResponse<PiSessionSnapshot>>;
  openDiscoveredSession(projectId:string,sessionId:string):Promise<RevuResponse<PiDiscoveredSessionResponse>>;
  newSession(projectId:string):Promise<RevuResponse<PiSessionSnapshot>>;
  getSessionInfo(projectId:string,sessionId:string):Promise<RevuResponse<PiSessionInfo>>;
  chooseSessionFolder(projectId:string):Promise<RevuResponse<PiSessionFolderResult|null>>;
  getEntries(projectId:string,sessionId:string,sinceEntryId?:string):Promise<RevuResponse<PiEntriesResponse>>;
  getSessionTree(projectId:string,sessionId:string):Promise<RevuResponse<PiSessionTreeResponse>>;
  navigateSessionTree(projectId:string,sessionId:string,entryId:string,summarize:boolean,customInstructions?:string):Promise<RevuResponse<PiTreeNavigationResponse>>;
  abortSessionTreeNavigation(projectId:string,sessionId:string):Promise<RevuResponse<void>>;
  setSessionEntryLabel(projectId:string,sessionId:string,entryId:string,label?:string):Promise<RevuResponse<PiSessionTreeResponse>>;
  forkSession(projectId:string,sessionId:string,entryId:string):Promise<RevuResponse<PiForkResponse>>;
  cloneSession(projectId:string,sessionId:string):Promise<RevuResponse<PiSessionSnapshot>>;
  releaseSession(projectId:string,sessionId:string):Promise<RevuResponse<void>>;
  exportHtml(projectId:string,sessionId:string):Promise<RevuResponse<string|null>>;
  renameSession(projectId:string,sessionId:string,name:string,scope?:PiSessionScope):Promise<RevuResponse<void>>;
  deleteSession(projectId:string,sessionId:string,scope?:PiSessionScope):Promise<RevuResponse<void>>;
  prompt(projectId:string,sessionId:string,text:string):Promise<RevuResponse<void>>;
  steer(projectId:string,sessionId:string,text:string):Promise<RevuResponse<void>>;
  followUp(projectId:string,sessionId:string,text:string):Promise<RevuResponse<void>>;
  clearQueue(projectId:string,sessionId:string):Promise<RevuResponse<PiQueueState>>;
  setRetainedQueue(projectId:string,sessionId:string,queue:PiQueueState):Promise<RevuResponse<PiQueueState>>;
  stop(projectId:string,sessionId:string):Promise<RevuResponse<void>>;
  bash(projectId:string,sessionId:string,command:string,excludeFromContext:boolean):Promise<RevuResponse<PiDirectBashState>>;
  abortBash(projectId:string,sessionId:string):Promise<RevuResponse<void>>;
  abortRetry(projectId:string,sessionId:string):Promise<RevuResponse<void>>;
  compact(projectId:string,sessionId:string,customInstructions?:string):Promise<RevuResponse<PiCompactionResponse>>;
  getContextProjection(projectId:string,sessionId:string):Promise<RevuResponse<PiContextProjection>>;
  setAutoCompaction(projectId:string,sessionId:string,enabled:boolean):Promise<RevuResponse<PiSessionSnapshot>>;
  listProviders():Promise<RevuResponse<PiProviderStatus[]>>;
  saveApiKey(providerId:string,key:string):Promise<RevuResponse<void>>;
  removeApiKey(providerId:string):Promise<RevuResponse<void>>;
  listModels(projectId:string,sessionId?:string):Promise<RevuResponse<PiModelSummary[]>>;
  setModel(projectId:string,sessionId:string,provider:string,modelId:string):Promise<RevuResponse<PiSessionSnapshot>>;
  setThinkingLevel(projectId:string,sessionId:string,level:PiThinkingLevel):Promise<RevuResponse<PiSessionSnapshot>>;
  getModelDefaults(projectId?:string):Promise<RevuResponse<PiModelDefaults>>;
  saveModelDefaults(provider:string,modelId:string,thinkingLevel:PiThinkingLevel):Promise<RevuResponse<void>>;
  getCompactionConfiguration(projectId?:string):Promise<RevuResponse<PiCompactionConfiguration>>;
  saveCompactionConfiguration(configuration:PiCompactionConfiguration):Promise<RevuResponse<void>>;
  onEvent(listener:(event:RevuPiEvent)=>void):()=>void;
}
declare global {
  interface Window{
    revu:{
      invoke<T>(body:Record<string,unknown>):Promise<RevuResponse<T>>;
      copyText(text:string):Promise<boolean>;
      chooseChatFiles(projectId:string):Promise<string[]>;
      filePath(file:File):string;
      saveChatImage(mimeType:string,bytes:Uint8Array):Promise<string>;
      openExternal(url:string):Promise<boolean>;
      windowControl(action:'minimize'|'maximize'|'close'|'isMaximized'):Promise<boolean>;
      setDirty(dirty:boolean):void;
      onMaximized(listener:(maximized:boolean)=>void):()=>void;
      onProjectChanged(listener:(projectId:string)=>void):()=>void;
      agent:RevuAgentApi;
    };
  }
}
export {};
