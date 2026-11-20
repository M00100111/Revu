import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { PiRuntimeConfig,PiRuntimeInfo,PiRuntimeChange, PiTrustSaveResponse, PiProjectTrust, PiSlashCommand, PiTrustChoice, PiAgentRequest, PiCompactionConfiguration, PiCompactionResponse, PiContextProjection, PiDirectBashState, PiDiscoveredSessionResponse, PiEntriesResponse, PiForkResponse, PiModelDefaults, PiModelSummary, PiProviderStatus, PiQueueState, PiSessionCatalog, PiSessionFolderResult, PiSessionInfo, PiSessionScope, PiSessionSearchResult, PiSessionSnapshot, PiSessionSort, PiSessionTreeResponse, PiThinkingLevel, PiTreeNavigationResponse, RevuPiEvent } from '../shared/piTypes';

const agentInvoke=<T>(body:PiAgentRequest)=>ipcRenderer.invoke('revu:agent',body) as Promise<{ok:boolean;value?:T;error?:string}>;

contextBridge.exposeInMainWorld('revu',{
  invoke:(body:Record<string,unknown>)=>ipcRenderer.invoke('revu:invoke',body),
  copyText:(text:string)=>ipcRenderer.invoke('revu:copy-text',text) as Promise<boolean>,
  chooseChatFiles:(projectId:string)=>ipcRenderer.invoke('revu:choose-chat-files',projectId) as Promise<string[]>,
  filePath:(file:File)=>webUtils.getPathForFile(file),
  saveChatImage:(mimeType:string,bytes:Uint8Array)=>ipcRenderer.invoke('revu:save-chat-image',mimeType,bytes) as Promise<string>,
  openExternal:(url:string)=>ipcRenderer.invoke('revu:open-external',url) as Promise<boolean>,
  windowControl:(action:'minimize'|'maximize'|'close'|'isMaximized')=>ipcRenderer.invoke('revu:window-control',action),
  setDirty:(dirty:boolean)=>ipcRenderer.send('revu:dirty-state',dirty),
  onMaximized:(listener:(maximized:boolean)=>void)=>{
    const receive=(_event:Electron.IpcRendererEvent,maximized:boolean)=>listener(maximized);
    ipcRenderer.on('revu:maximized',receive);
    return()=>ipcRenderer.removeListener('revu:maximized',receive);
  },
  onProjectChanged:(listener:(projectId:string)=>void)=>{
    const receive=(_event:Electron.IpcRendererEvent,projectId:string)=>listener(projectId);
    ipcRenderer.on('revu:project-changed',receive);
    return()=>ipcRenderer.removeListener('revu:project-changed',receive);
  },
  agent:{
    chooseBashPath:()=>agentInvoke<string|null>({action:'chooseBashPath'}),
    getRuntimeInfo:()=>agentInvoke<PiRuntimeInfo>({action:'getRuntimeInfo'}),
    setRuntime:(config:PiRuntimeConfig)=>agentInvoke<PiRuntimeChange>({action:'setRuntime',config}),
    respondSessionCwd:(requestId:string,accept:boolean)=>agentInvoke<void>({action:'respondSessionCwd',requestId,accept}),
    getCommands:(projectId:string,sessionId?:string)=>agentInvoke<PiSlashCommand[]>({action:'getCommands',projectId,sessionId}),
    getProjectTrust:(projectId:string,sessionId?:string)=>agentInvoke<PiProjectTrust>({action:'getProjectTrust',projectId,sessionId}),
    saveProjectTrust:(projectId:string,choice:PiTrustChoice,sessionId?:string)=>agentInvoke<PiTrustSaveResponse>({action:'saveProjectTrust',projectId,choice,sessionId}),
    respondProjectTrust:(requestId:string,choice:PiTrustChoice|null)=>agentInvoke<void>({action:'respondProjectTrust',requestId,choice}),
    reloadResources:(projectId:string,sessionId:string)=>agentInvoke<PiSessionSnapshot>({action:'reloadResources',projectId,sessionId}),
    listSessions:(projectId:string,scope:PiSessionScope='current')=>agentInvoke<PiSessionCatalog>({action:'listSessions',projectId,scope}),
    searchSessions:(projectId:string,query:string,sort:PiSessionSort,scope:PiSessionScope='current')=>agentInvoke<PiSessionSearchResult[]>({action:'searchSessions',projectId,query,sort,scope}),
    openSession:(projectId:string,sessionId:string)=>agentInvoke<PiSessionSnapshot>({action:'openSession',projectId,sessionId}),
    openDiscoveredSession:(projectId:string,sessionId:string)=>agentInvoke<PiDiscoveredSessionResponse>({action:'openDiscoveredSession',projectId,sessionId}),
    newSession:(projectId:string)=>agentInvoke<PiSessionSnapshot>({action:'newSession',projectId}),
    getSessionInfo:(projectId:string,sessionId:string)=>agentInvoke<PiSessionInfo>({action:'getSessionInfo',projectId,sessionId}),
    chooseSessionFolder:(projectId:string)=>agentInvoke<PiSessionFolderResult|null>({action:'chooseSessionFolder',projectId}),
    getEntries:(projectId:string,sessionId:string,sinceEntryId?:string)=>agentInvoke<PiEntriesResponse>({action:'getEntries',projectId,sessionId,sinceEntryId}),
    getSessionTree:(projectId:string,sessionId:string)=>agentInvoke<PiSessionTreeResponse>({action:'getSessionTree',projectId,sessionId}),
    navigateSessionTree:(projectId:string,sessionId:string,entryId:string,summarize:boolean,customInstructions?:string)=>
      agentInvoke<PiTreeNavigationResponse>({action:'navigateSessionTree',projectId,sessionId,entryId,summarize,customInstructions}),
    abortSessionTreeNavigation:(projectId:string,sessionId:string)=>agentInvoke<void>({action:'abortSessionTreeNavigation',projectId,sessionId}),
    setSessionEntryLabel:(projectId:string,sessionId:string,entryId:string,label?:string)=>
      agentInvoke<PiSessionTreeResponse>({action:'setSessionEntryLabel',projectId,sessionId,entryId,label}),
    forkSession:(projectId:string,sessionId:string,entryId:string)=>agentInvoke<PiForkResponse>({action:'forkSession',projectId,sessionId,entryId}),
    cloneSession:(projectId:string,sessionId:string)=>agentInvoke<PiSessionSnapshot>({action:'cloneSession',projectId,sessionId}),
    releaseSession:(projectId:string,sessionId:string)=>agentInvoke<void>({action:'releaseSession',projectId,sessionId}),
    exportHtml:(projectId:string,sessionId:string)=>agentInvoke<string|null>({action:'exportHtml',projectId,sessionId}),
    renameSession:(projectId:string,sessionId:string,name:string,scope:PiSessionScope='current')=>agentInvoke<void>({action:'renameSession',projectId,sessionId,name,scope}),
    deleteSession:(projectId:string,sessionId:string,scope:PiSessionScope='current')=>agentInvoke<void>({action:'deleteSession',projectId,sessionId,scope}),
    prompt:(projectId:string,sessionId:string,text:string)=>agentInvoke<void>({action:'prompt',projectId,sessionId,text}),
    steer:(projectId:string,sessionId:string,text:string)=>agentInvoke<void>({action:'steer',projectId,sessionId,text}),
    followUp:(projectId:string,sessionId:string,text:string)=>agentInvoke<void>({action:'followUp',projectId,sessionId,text}),
    clearQueue:(projectId:string,sessionId:string)=>agentInvoke<PiQueueState>({action:'clearQueue',projectId,sessionId}),
    setRetainedQueue:(projectId:string,sessionId:string,queue:PiQueueState)=>agentInvoke<PiQueueState>({action:'setRetainedQueue',projectId,sessionId,queue}),
    stop:(projectId:string,sessionId:string)=>agentInvoke<void>({action:'stop',projectId,sessionId}),
    bash:(projectId:string,sessionId:string,command:string,excludeFromContext:boolean)=>
      agentInvoke<PiDirectBashState>({action:'bash',projectId,sessionId,command,excludeFromContext}),
    abortBash:(projectId:string,sessionId:string)=>agentInvoke<void>({action:'abortBash',projectId,sessionId}),
    abortRetry:(projectId:string,sessionId:string)=>agentInvoke<void>({action:'abortRetry',projectId,sessionId}),
    compact:(projectId:string,sessionId:string,customInstructions?:string)=>agentInvoke<PiCompactionResponse>({action:'compact',projectId,sessionId,customInstructions}),
    getContextProjection:(projectId:string,sessionId:string)=>agentInvoke<PiContextProjection>({action:'getContextProjection',projectId,sessionId}),
    setAutoCompaction:(projectId:string,sessionId:string,enabled:boolean)=>
      agentInvoke<PiSessionSnapshot>({action:'setAutoCompaction',projectId,sessionId,enabled}),
    listProviders:()=>agentInvoke<PiProviderStatus[]>({action:'listProviders'}),
    saveApiKey:(providerId:string,key:string)=>agentInvoke<void>({action:'saveApiKey',providerId,key}),
    removeApiKey:(providerId:string)=>agentInvoke<void>({action:'removeApiKey',providerId}),
    listModels:(projectId:string,sessionId?:string)=>agentInvoke<PiModelSummary[]>({action:'listModels',projectId,sessionId}),
    setModel:(projectId:string,sessionId:string,provider:string,modelId:string)=>
      agentInvoke<PiSessionSnapshot>({action:'setModel',projectId,sessionId,provider,modelId}),
    setThinkingLevel:(projectId:string,sessionId:string,level:PiThinkingLevel)=>
      agentInvoke<PiSessionSnapshot>({action:'setThinkingLevel',projectId,sessionId,level}),
    getModelDefaults:(projectId?:string)=>agentInvoke<PiModelDefaults>({action:'getModelDefaults',projectId}),
    saveModelDefaults:(provider:string,modelId:string,thinkingLevel:PiThinkingLevel)=>
      agentInvoke<void>({action:'saveModelDefaults',provider,modelId,thinkingLevel}),
    getCompactionConfiguration:(projectId?:string)=>agentInvoke<PiCompactionConfiguration>({action:'getCompactionConfiguration',projectId}),
    saveCompactionConfiguration:(configuration:PiCompactionConfiguration)=>
      agentInvoke<void>({action:'saveCompactionConfiguration',configuration}),
    onEvent:(listener:(event:RevuPiEvent)=>void)=>{
      const receive=(_event:Electron.IpcRendererEvent,value:RevuPiEvent)=>listener(value);
      ipcRenderer.on('revu:agent-event',receive);
      return()=>ipcRenderer.removeListener('revu:agent-event',receive);
    },
  },
});
