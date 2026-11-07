import type { PiModelDefaults, PiModelSummary, PiProviderStatus, PiSessionSnapshot, PiSessionSummary, PiThinkingLevel, RevuPiEvent } from '../shared/piTypes';
interface RevuResponse<T>{ok:boolean;value?:T;status?:number;error?:string}
interface RevuAgentApi {
  listSessions(projectId:string):Promise<RevuResponse<PiSessionSummary[]>>;
  openSession(projectId:string,sessionId:string):Promise<RevuResponse<PiSessionSnapshot>>;
  newSession(projectId:string):Promise<RevuResponse<PiSessionSnapshot>>;
  renameSession(projectId:string,sessionId:string,name:string):Promise<RevuResponse<void>>;
  deleteSession(projectId:string,sessionId:string):Promise<RevuResponse<void>>;
  prompt(projectId:string,sessionId:string,text:string):Promise<RevuResponse<void>>;
  stop(projectId:string,sessionId:string):Promise<RevuResponse<void>>;
  listProviders():Promise<RevuResponse<PiProviderStatus[]>>;
  saveApiKey(providerId:string,key:string):Promise<RevuResponse<void>>;
  removeApiKey(providerId:string):Promise<RevuResponse<void>>;
  listModels(projectId:string,sessionId?:string):Promise<RevuResponse<PiModelSummary[]>>;
  setModel(projectId:string,sessionId:string,provider:string,modelId:string):Promise<RevuResponse<PiSessionSnapshot>>;
  setThinkingLevel(projectId:string,sessionId:string,level:PiThinkingLevel):Promise<RevuResponse<PiSessionSnapshot>>;
  getModelDefaults(projectId?:string):Promise<RevuResponse<PiModelDefaults>>;
  saveModelDefaults(provider:string,modelId:string,thinkingLevel:PiThinkingLevel):Promise<RevuResponse<void>>;
  onEvent(listener:(event:RevuPiEvent)=>void):()=>void;
}
declare global {
  interface Window{
    revu:{
      invoke<T>(body:Record<string,unknown>):Promise<RevuResponse<T>>;
      contextMenu(kind:'project'|'tab'):Promise<'close'|'closeOthers'|'closeAll'|null>;
      windowControl(action:'minimize'|'maximize'|'close'|'isMaximized'):Promise<boolean>;
      setDirty(dirty:boolean):void;
      onMaximized(listener:(maximized:boolean)=>void):()=>void;
      onProjectChanged(listener:(projectId:string)=>void):()=>void;
      agent:RevuAgentApi;
    };
  }
}
export {};
