import { app, safeStorage, shell } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  PiCompactionResponse,PiEntriesResponse,PiForkResponse,PiModelDefaults,PiModelSummary,PiProviderStatus,
  PiRuntimeStatus,PiSessionSearchResult,PiSessionSnapshot,PiSessionSort,PiSessionSummary,PiSessionTreeResponse,
  PiThinkingLevel,PiTreeNavigationResponse,PiUsageStats,RevuPiEvent,
} from '../shared/piTypes';
import { calculatePiCacheHitPercent, countPiSessionRuns, derivedPiSessionName } from '../shared/piSession';
import { searchPiSessions } from '../shared/piSessionSearch';

type PiModule=typeof import('@earendil-works/pi-coding-agent');
type RpcClient=InstanceType<PiModule['RpcClient']>&{
  navigateTree:(entryId:string,options:{summarize:boolean;customInstructions?:string})=>Promise<{editorText?:string;cancelled:boolean;aborted?:boolean}>;
  setEntryLabel:(entryId:string,label?:string)=>Promise<void>;
  abortBranchSummary:()=>Promise<void>;
};
type JsonEvent=Parameters<Parameters<RpcClient['onEvent']>[0]>[0];

interface ProviderDefinition {id:string;name:string;env:string}
const PROVIDERS:ProviderDefinition[]=[
  {id:'anthropic',name:'Anthropic',env:'ANTHROPIC_API_KEY'},
  {id:'openai',name:'OpenAI',env:'OPENAI_API_KEY'},
  {id:'google',name:'Google Gemini',env:'GEMINI_API_KEY'},
  {id:'openrouter',name:'OpenRouter',env:'OPENROUTER_API_KEY'},
  {id:'deepseek',name:'DeepSeek',env:'DEEPSEEK_API_KEY'},
  {id:'xai',name:'xAI',env:'XAI_API_KEY'},
  {id:'groq',name:'Groq',env:'GROQ_API_KEY'},
  {id:'mistral',name:'Mistral',env:'MISTRAL_API_KEY'},
  {id:'cerebras',name:'Cerebras',env:'CEREBRAS_API_KEY'},
  {id:'nvidia',name:'NVIDIA NIM',env:'NVIDIA_API_KEY'},
  {id:'zai',name:'ZAI',env:'ZAI_API_KEY'},
  {id:'moonshotai',name:'Moonshot AI',env:'MOONSHOT_API_KEY'},
];

interface RuntimeHandle {
  sessionId:string;
  projectId:string;
  cwd:string;
  client:RpcClient;
  status:PiRuntimeStatus;
  sessionPath?:string;
  error?:string;
  isCompacting?:boolean;
  unsubscribe:()=>void;
  usageRefresh?:Promise<void>;
  usageRefreshPending?:boolean;
}

interface TreeOperation {cancelled:boolean;abort?:()=>Promise<void>}

interface PiManagerOptions {
  resolveProject:(projectId:string)=>{id:string;root:string};
  emit:(event:RevuPiEvent)=>void;
}

function errorMessage(error:unknown){return error instanceof Error?error.message:String(error);}

export class PiManager {
  private readonly runtimes=new Map<string,RuntimeHandle>();
  private readonly runCountCache=new Map<string,{modifiedAt:number;count:number}>();
  private readonly treeOperations=new Map<string,TreeOperation>();
  private selectedSessionId:string|null=null;
  private modulePromise:Promise<PiModule>|null=null;
  private readonly agentDir:string;
  private readonly secretsPath:string;

  constructor(private readonly options:PiManagerOptions){
    this.agentDir=join(app.getPath('userData'),'pi-agent');
    this.secretsPath=join(app.getPath('userData'),'pi-api-keys.bin');
    process.env.PI_CODING_AGENT_DIR=this.agentDir;
    process.env.PI_SKIP_VERSION_CHECK='1';
  }

  private module(){
    if(!this.modulePromise){
      const path=app.isPackaged
        ?join(process.resourcesPath,'pi','app','bundle','index.js')
        :join(app.getAppPath(),'.pi-runtime','app','bundle','index.js');
      this.modulePromise=import(pathToFileURL(path).href) as Promise<PiModule>;
    }
    return this.modulePromise;
  }
  private project(projectId:string){return this.options.resolveProject(projectId);}
  private emit(handle:Pick<RuntimeHandle,'sessionId'|'projectId'>,type:RevuPiEvent['type'],payload?:unknown){
    this.options.emit({sessionId:handle.sessionId,projectId:handle.projectId,type,payload});
  }

  private async readSecrets():Promise<Record<string,string>>{
    let encrypted:Buffer;
    try{encrypted=await readFile(this.secretsPath);}catch(error){
      if((error as NodeJS.ErrnoException).code==='ENOENT')return {};
      throw error;
    }
    if(!safeStorage.isEncryptionAvailable())throw new Error('Secure credential storage is unavailable.');
    const parsed:unknown=JSON.parse(safeStorage.decryptString(encrypted));
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));
  }

  private async writeSecrets(secrets:Record<string,string>){
    if(!safeStorage.isEncryptionAvailable())throw new Error('Secure credential storage is unavailable.');
    await mkdir(dirname(this.secretsPath),{recursive:true});
    await writeFile(this.secretsPath,safeStorage.encryptString(JSON.stringify(secrets)));
  }

  async listProviders():Promise<PiProviderStatus[]>{
    const secrets=await this.readSecrets();
    return PROVIDERS.map(provider=>{
      const key=secrets[provider.id];
      const maskedKey=key?(key.length<=4?'•'.repeat(key.length):`${'•'.repeat(key.length-4)}${key.slice(-4)}`):undefined;
      return {id:provider.id,name:provider.name,configured:!!key,maskedKey};
    });
  }

  async saveApiKey(providerId:string,key:string){
    if(!PROVIDERS.some(provider=>provider.id===providerId))throw new Error('Unknown model provider.');
    const value=key.trim();if(!value)throw new Error('API key is required.');
    const secrets=await this.readSecrets();secrets[providerId]=value;await this.writeSecrets(secrets);
    await this.disposeIdleRuntimes();
  }

  async removeApiKey(providerId:string){
    if(!PROVIDERS.some(provider=>provider.id===providerId))throw new Error('Unknown model provider.');
    const secrets=await this.readSecrets();delete secrets[providerId];await this.writeSecrets(secrets);
    await this.disposeIdleRuntimes();
  }

  private runtimeNodeDirectory(){
    const root=app.isPackaged?join(process.resourcesPath,'pi','node'):join(app.getAppPath(),'.pi-runtime','node');
    if(!existsSync(join(root,'node.exe')))throw new Error('The bundled Pi runtime is missing. Run npm run prepare:pi.');
    return root;
  }

  private cliPath(){
    if(app.isPackaged)return join(process.resourcesPath,'pi','app','bundle','cli.js');
    return join(app.getAppPath(),'.pi-runtime','app','bundle','cli.js');
  }

  private async childEnv(){
    const secrets=await this.readSecrets();
    const env:Record<string,string>={
      PI_CODING_AGENT_DIR:this.agentDir,PI_SKIP_VERSION_CHECK:'1',
      PATH:`${this.runtimeNodeDirectory()};${process.env.PATH??''}`,
    };
    for(const provider of PROVIDERS)env[provider.env]=secrets[provider.id]??'';
    return env;
  }

  private async createClient(cwd:string,sessionPath?:string,ephemeral=false){
    const {RpcClient}=await this.module();
    const args=['--no-extensions','--no-approve'];
    if(sessionPath)args.push('--session',sessionPath);
    else if(ephemeral)args.push('--no-session');
    return new RpcClient({cwd,cliPath:this.cliPath(),env:await this.childEnv(),args}) as RpcClient;
  }

  private async findSession(projectId:string,sessionId:string){
    const project=this.project(projectId);const {SessionManager}=await this.module();
    const sessions=await SessionManager.list(project.root);
    const session=sessions.find(item=>item.id===sessionId);
    if(!session)throw new Error('Session not found.');
    return session;
  }

  private sessionPathKey(path:string){const normalized=path.replace(/\\/g,'/');return process.platform==='win32'?normalized.toLocaleLowerCase():normalized;}

  private summaries(projectId:string,listed:Awaited<ReturnType<PiModule['SessionManager']['list']>>):PiSessionSummary[]{
    const idsByPath=new Map(listed.map(session=>[this.sessionPathKey(session.path),session.id]));
    return listed.map(session=>({
      id:session.id,projectId,name:session.name||session.firstMessage.trim().slice(0,80)||'New Chat',
      firstMessage:session.firstMessage,createdAt:session.created.getTime(),modifiedAt:session.modified.getTime(),
      runCount:0,status:this.runtimes.get(session.id)?.status??'idle' as PiRuntimeStatus,hasSessionFile:true,
      isCompacting:this.runtimes.get(session.id)?.isCompacting,
      parentSessionId:session.parentSessionPath?idsByPath.get(this.sessionPathKey(session.parentSessionPath)):undefined,
    }));
  }

  async listSessions(projectId:string):Promise<PiSessionSummary[]>{
    const project=this.project(projectId);const {SessionManager}=await this.module();
    const listed=await SessionManager.list(project.root);
    const result=this.summaries(projectId,listed).map((summary,index)=>({...summary,
      runCount:this.countRuns(SessionManager,listed[index].path,listed[index].modified.getTime())}));
    for(const runtime of this.runtimes.values()){
      if(runtime.projectId!==projectId||result.some(item=>item.id===runtime.sessionId))continue;
      result.unshift({id:runtime.sessionId,projectId,name:'New Chat',firstMessage:'',createdAt:Date.now(),
        modifiedAt:Date.now(),runCount:0,status:runtime.status,hasSessionFile:!!runtime.sessionPath&&existsSync(runtime.sessionPath),isCompacting:runtime.isCompacting});
    }
    return result.sort((a,b)=>b.modifiedAt-a.modifiedAt);
  }

  async searchSessions(projectId:string,query:string,sort:PiSessionSort):Promise<PiSessionSearchResult[]>{
    const project=this.project(projectId);const {SessionManager}=await this.module();
    const listed=await SessionManager.list(project.root);
    const summaries=this.summaries(projectId,listed);
    return searchPiSessions(listed.map((session,index)=>({summary:{...summaries[index],
      runCount:this.countRuns(SessionManager,session.path,session.modified.getTime())},allMessagesText:session.allMessagesText})),query,sort);
  }

  private countRuns(SessionManager:PiModule['SessionManager'],path:string,modifiedAt:number){
    const cached=this.runCountCache.get(path);if(cached?.modifiedAt===modifiedAt)return cached.count;
    let count=0;
    try{count=countPiSessionRuns(SessionManager.open(path).getBranch());}catch{count=0;}
    this.runCountCache.set(path,{modifiedAt,count});return count;
  }

  private async startRuntime(projectId:string,sessionId?:string,sessionPath?:string){
    const project=this.project(projectId);const client=await this.createClient(project.root,sessionPath);
    const provisional=sessionId??crypto.randomUUID();
    const handle:RuntimeHandle={sessionId:provisional,projectId,cwd:project.root,client,status:'starting',sessionPath,unsubscribe:()=>{}};
    handle.unsubscribe=client.onEvent(event=>this.onEvent(handle,event));
    try{
      await client.start();
      const state=await client.getState();
      handle.sessionId=state.sessionId;handle.sessionPath=state.sessionFile;handle.status=state.isStreaming?'running':'idle';
      if(sessionId&&sessionId!==state.sessionId)throw new Error('Pi opened a different session than requested.');
      this.runtimes.set(handle.sessionId,handle);
      this.emit(handle,'status',handle.status);
      return handle;
    }catch(error){
      handle.unsubscribe();await client.stop().catch(()=>{});throw error;
    }
  }

  private async ensureRuntime(projectId:string,sessionId:string){
    const existing=this.runtimes.get(sessionId);
    if(existing){if(existing.projectId!==projectId)throw new Error('Session does not belong to this project.');return existing;}
    const session=await this.findSession(projectId,sessionId);
    return this.startRuntime(projectId,sessionId,session.path);
  }

  private async stableRuntime(projectId:string,sessionId:string){
    const existing=this.runtimes.get(sessionId);
    if(existing?.status==='error')await this.disposeRuntime(sessionId);
    const handle=await this.ensureRuntime(projectId,sessionId);
    if(handle.status==='starting'||handle.status==='running'||handle.status==='stopping')
      throw new Error('Wait for the session to finish before using this action.');
    const state=await handle.client.getState();
    if(state.isStreaming||state.isCompacting)throw new Error('Wait for the session to finish before using this action.');
    if(!state.sessionFile||!existsSync(state.sessionFile))throw new Error('Send a message before using this action.');
    handle.sessionPath=state.sessionFile;
    return handle;
  }

  private async replaceRuntimeSession(handle:RuntimeHandle,previousId:string){
    const state=await handle.client.getState();
    if(!state.sessionId||!state.sessionFile)throw new Error('Pi did not create the new session.');
    this.runtimes.delete(previousId);
    handle.sessionId=state.sessionId;handle.sessionPath=state.sessionFile;handle.status='idle';handle.error=undefined;
    this.runtimes.set(handle.sessionId,handle);this.selectedSessionId=handle.sessionId;
    return handle;
  }

  async openSession(projectId:string,sessionId:string){
    this.selectedSessionId=sessionId;
    const handle=await this.ensureRuntime(projectId,sessionId);
    await this.disposeUnselectedIdleRuntimes();
    return this.snapshot(handle);
  }

  async newSession(projectId:string){
    const handle=await this.startRuntime(projectId);
    this.selectedSessionId=handle.sessionId;
    await this.disposeUnselectedIdleRuntimes();
    this.emit(handle,'sessions-changed');
    return this.snapshot(handle);
  }

  async getEntries(projectId:string,sessionId:string,sinceEntryId?:string):Promise<PiEntriesResponse>{
    const handle=await this.ensureRuntime(projectId,sessionId);
    const response=await handle.client.getEntries(sinceEntryId);
    return response as PiEntriesResponse;
  }

  async getSessionTree(projectId:string,sessionId:string):Promise<PiSessionTreeResponse>{
    const handle=await this.ensureRuntime(projectId,sessionId);return handle.client.getTree() as Promise<PiSessionTreeResponse>;
  }

  private async stopForTreeOperation(handle:RuntimeHandle){
    let state=await handle.client.getState();
    if(handle.status==='running'||handle.status==='stopping'||state.isStreaming){
      await handle.client.clearQueue();await handle.client.abort();handle.status='idle';this.emit(handle,'status','idle');
      state=await handle.client.getState();
    }
    if(state.isCompacting)throw new Error('Wait for the current compaction to finish before navigating the session tree.');
    if(!state.sessionFile||!existsSync(state.sessionFile))throw new Error('Send a message before using the session tree.');
    handle.sessionPath=state.sessionFile;return state.sessionFile;
  }

  async navigateSessionTree(projectId:string,sessionId:string,entryId:string,summarize:boolean,customInstructions?:string):Promise<PiTreeNavigationResponse>{
    if(this.treeOperations.has(sessionId))throw new Error('Session tree navigation is already in progress.');
    const operation:TreeOperation={cancelled:false};this.treeOperations.set(sessionId,operation);
    try{
      const handle=await this.ensureRuntime(projectId,sessionId);await this.stopForTreeOperation(handle);
      if(operation.cancelled){const tree=await handle.client.getTree() as PiSessionTreeResponse;
        return {...tree,snapshot:await this.snapshot(handle),cancelled:true,aborted:true};}
      operation.abort=()=>handle.client.abortBranchSummary();
      const result=await handle.client.navigateTree(entryId,{summarize,customInstructions});
      const tree=await handle.client.getTree() as PiSessionTreeResponse;
      this.emit(handle,'sessions-changed');return {...tree,snapshot:await this.snapshot(handle),editorText:result.editorText,
        cancelled:result.cancelled,aborted:result.aborted};
    }finally{this.treeOperations.delete(sessionId);}
  }

  async abortSessionTreeNavigation(projectId:string,sessionId:string){
    this.project(projectId);const operation=this.treeOperations.get(sessionId);if(!operation)return;operation.cancelled=true;await operation.abort?.();
  }

  async setSessionEntryLabel(projectId:string,sessionId:string,entryId:string,label?:string):Promise<PiSessionTreeResponse>{
    if(this.treeOperations.has(sessionId))throw new Error('Wait for session tree navigation to finish.');
    const handle=await this.stableRuntime(projectId,sessionId);await handle.client.setEntryLabel(entryId,label?.trim()||undefined);
    this.emit(handle,'sessions-changed');return handle.client.getTree() as Promise<PiSessionTreeResponse>;
  }

  async forkSession(projectId:string,sessionId:string,entryId:string):Promise<PiForkResponse>{
    const sessions=await this.listSessions(projectId);const source=sessions.find(item=>item.id===sessionId);
    if(!source)throw new Error('Session not found.');
    const handle=await this.stableRuntime(projectId,sessionId);const result=await handle.client.fork(entryId);
    if(result.cancelled)throw new Error('Fork was cancelled.');
    await this.replaceRuntimeSession(handle,sessionId);
    await handle.client.setSessionName(derivedPiSessionName(source.name,'Fork',sessions.map(item=>item.name)));
    this.emit(handle,'sessions-changed');await this.disposeUnselectedIdleRuntimes();
    return {snapshot:await this.snapshot(handle),selectedText:result.text};
  }

  async cloneSession(projectId:string,sessionId:string){
    const sessions=await this.listSessions(projectId);const source=sessions.find(item=>item.id===sessionId);
    if(!source)throw new Error('Session not found.');
    const handle=await this.stableRuntime(projectId,sessionId);const result=await handle.client.clone();
    if(result.cancelled)throw new Error('Clone was cancelled.');
    await this.replaceRuntimeSession(handle,sessionId);
    await handle.client.setSessionName(derivedPiSessionName(source.name,'Clone',sessions.map(item=>item.name)));
    this.emit(handle,'sessions-changed');await this.disposeUnselectedIdleRuntimes();
    return this.snapshot(handle);
  }

  async exportHtml(projectId:string,sessionId:string,outputPath:string){
    const handle=await this.stableRuntime(projectId,sessionId);
    const result=await handle.client.exportHtml(outputPath);
    if(this.selectedSessionId!==sessionId)await this.disposeRuntime(sessionId);
    return result.path;
  }

  async releaseSession(projectId:string,sessionId:string){
    this.project(projectId);const handle=this.runtimes.get(sessionId);
    if(handle&&handle.projectId!==projectId)throw new Error('Session does not belong to this project.');
    if(this.selectedSessionId===sessionId)this.selectedSessionId=null;
    if(handle&&(handle.status==='idle'||handle.status==='error'))await this.disposeRuntime(sessionId);
  }

  async sessionName(projectId:string,sessionId:string){
    const session=await this.findSession(projectId,sessionId);
    return session.name||session.firstMessage.trim().slice(0,80)||'New Chat';
  }

  private async snapshot(handle:RuntimeHandle):Promise<PiSessionSnapshot>{
    const [state,messages,levels,stats]=await Promise.all([
      handle.client.getState(),handle.client.getMessages(),handle.client.getAvailableThinkingLevels(),
      handle.client.getSessionStats().catch(()=>undefined),
    ]);
    handle.sessionPath=state.sessionFile;
    return {sessionId:handle.sessionId,projectId:handle.projectId,status:handle.status,
      name:state.sessionName||'New Chat',messages,model:state.model?{
        provider:state.model.provider,id:state.model.id,contextWindow:state.model.contextWindow,
        reasoning:!!state.model.reasoning,
      }:undefined,thinkingLevel:state.thinkingLevel,availableThinkingLevels:levels,
      autoCompactionEnabled:state.autoCompactionEnabled,isCompacting:state.isCompacting,
      usage:stats?this.mapUsage(stats):undefined,error:handle.error};
  }

  async prompt(projectId:string,sessionId:string,text:string){
    const message=text.trim();if(!message)throw new Error('Message is required.');
    const handle=await this.ensureRuntime(projectId,sessionId);
    if(handle.status==='running'||handle.status==='stopping')throw new Error('This session is already running.');
    handle.status='running';handle.error=undefined;this.emit(handle,'status','running');
    try{
      const disposition=await handle.client.prompt(message);
      if(disposition==='handled'){handle.status='idle';this.emit(handle,'status','idle');}
    }catch(error){this.fail(handle,error);throw error;}
  }

  async stop(projectId:string,sessionId:string){
    this.project(projectId);const handle=this.runtimes.get(sessionId);if(!handle)return;
    handle.status='stopping';this.emit(handle,'status','stopping');
    try{await handle.client.clearQueue();await handle.client.abort();}
    catch(error){this.fail(handle,error);throw error;}
  }

  async compact(projectId:string,sessionId:string):Promise<PiCompactionResponse>{
    const handle=await this.ensureRuntime(projectId,sessionId);
    if(handle.status==='running'||handle.status==='stopping')throw new Error('Stop the session before compacting context.');
    const result=await handle.client.compact();
    const snapshot=await this.snapshot(handle);
    return {snapshot,result:{tokensBefore:result.tokensBefore,estimatedTokensAfter:result.estimatedTokensAfter,
      cost:result.usage?.cost.total}};
  }

  async setAutoCompaction(projectId:string,sessionId:string,enabled:boolean){
    const handle=await this.ensureRuntime(projectId,sessionId);
    await handle.client.setAutoCompaction(enabled);
    return this.snapshot(handle);
  }

  private onEvent(handle:RuntimeHandle,event:JsonEvent){
    this.emit(handle,'event',event);
    if(event.type==='agent_start'){handle.status='running';this.emit(handle,'status','running');}
    if(event.type==='turn_end')void this.refreshUsage(handle);
    if(event.type==='compaction_start')handle.isCompacting=true;
    if(event.type==='compaction_end')handle.isCompacting=false;
    if(event.type==='agent_settled'){
      handle.status='idle';this.emit(handle,'status','idle');
      this.emit(handle,'sessions-changed');
      void this.refreshUsage(handle).finally(()=>{
        if(this.selectedSessionId!==handle.sessionId)return this.disposeRuntime(handle.sessionId);
      });
    }
  }

  private refreshUsage(handle:RuntimeHandle):Promise<void>{
    if(handle.usageRefresh){handle.usageRefreshPending=true;return handle.usageRefresh;}
    handle.usageRefresh=(async()=>{do{
      handle.usageRefreshPending=false;
      try{const stats=await handle.client.getSessionStats();if(this.runtimes.get(handle.sessionId)===handle)this.emit(handle,'usage',this.mapUsage(stats));}
      catch{}
    }while(handle.usageRefreshPending&&this.runtimes.get(handle.sessionId)===handle);})().finally(()=>{handle.usageRefresh=undefined;});
    return handle.usageRefresh;
  }

  private fail(handle:RuntimeHandle,error:unknown){
    handle.status='error';handle.error=errorMessage(error);this.emit(handle,'error',handle.error);
  }

  private mapUsage(stats:Awaited<ReturnType<RpcClient['getSessionStats']>>):PiUsageStats{
    return {input:stats.tokens.input,output:stats.tokens.output,cacheRead:stats.tokens.cacheRead,
      cacheWrite:stats.tokens.cacheWrite,total:stats.tokens.total,cost:stats.cost,
      runs:stats.userMessages,toolCalls:stats.toolCalls,
      cacheHitPercent:calculatePiCacheHitPercent(stats.tokens.input,stats.tokens.cacheRead,stats.tokens.cacheWrite),
      contextTokens:stats.contextUsage?.tokens,contextWindow:stats.contextUsage?.contextWindow,
      contextPercent:stats.contextUsage?.percent};
  }

  async renameSession(projectId:string,sessionId:string,name:string){
    const normalized=name.trim();if(!normalized)throw new Error('Session name is required.');
    const runtime=this.runtimes.get(sessionId);
    if(runtime)await runtime.client.setSessionName(normalized);
    else{
      const session=await this.findSession(projectId,sessionId);
      const client=await this.createClient(this.project(projectId).root,session.path);
      try{await client.start();await client.setSessionName(normalized);}
      finally{await client.stop().catch(()=>{});}
    }
    this.options.emit({sessionId,projectId,type:'sessions-changed'});
  }

  async deleteSession(projectId:string,sessionId:string){
    const runtime=this.runtimes.get(sessionId);let path=runtime?.sessionPath;
    if(!path){try{path=(await this.findSession(projectId,sessionId)).path;}catch{path=undefined;}}
    await this.disposeRuntime(sessionId);
    if(path){this.runCountCache.delete(path);await shell.trashItem(path);}
    if(this.selectedSessionId===sessionId)this.selectedSessionId=null;
    this.options.emit({sessionId,projectId,type:'sessions-changed'});
  }

  async closeProject(projectId:string){
    await Promise.all([...this.runtimes.values()].filter(item=>item.projectId===projectId).map(item=>this.disposeRuntime(item.sessionId)));
    this.runCountCache.clear();
  }

  async listModels(projectId:string,sessionId?:string):Promise<PiModelSummary[]>{
    let client:RpcClient|undefined;let temporary=false;
    if(sessionId)client=this.runtimes.get(sessionId)?.client;
    if(!client){client=await this.createClient(this.project(projectId).root,undefined,true);temporary=true;await client.start();}
    try{return (await client.getAvailableModels()).map(model=>({...model}));}
    finally{if(temporary)await client.stop();}
  }

  async setModel(projectId:string,sessionId:string,provider:string,modelId:string){
    const handle=await this.ensureRuntime(projectId,sessionId);
    if(handle.status==='running'||handle.status==='stopping')throw new Error('Stop the session before changing models.');
    await handle.client.setModel(provider,modelId);
    return this.snapshot(handle);
  }

  async setThinkingLevel(projectId:string,sessionId:string,level:PiThinkingLevel){
    const handle=await this.ensureRuntime(projectId,sessionId);
    if(handle.status==='running'||handle.status==='stopping')throw new Error('Stop the session before changing thinking level.');
    await handle.client.setThinkingLevel(level);
    return this.snapshot(handle);
  }

  async getModelDefaults(projectId?:string):Promise<PiModelDefaults>{
    const cwd=projectId?this.project(projectId).root:process.cwd();const {SettingsManager}=await this.module();
    const settings=SettingsManager.create(cwd,this.agentDir);
    return {provider:settings.getDefaultProvider(),modelId:settings.getDefaultModel(),
      thinkingLevel:settings.getDefaultThinkingLevel()??'medium'};
  }

  async saveModelDefaults(provider:string,modelId:string,thinkingLevel:PiThinkingLevel){
    const {SettingsManager}=await this.module();const settings=SettingsManager.create(process.cwd(),this.agentDir);
    settings.setDefaultModelAndProvider(provider,modelId);settings.setDefaultThinkingLevel(thinkingLevel);await settings.flush();
    const errors=settings.drainErrors();if(errors.length)throw new Error(errors.map(item=>item.error.message).join('\n'));
  }

  private async disposeRuntime(sessionId:string){
    const handle=this.runtimes.get(sessionId);if(!handle)return;
    this.runtimes.delete(sessionId);handle.unsubscribe();await handle.client.stop().catch(()=>{});
  }
  private async disposeUnselectedIdleRuntimes(){
    await Promise.all([...this.runtimes.values()].filter(item=>item.sessionId!==this.selectedSessionId&&item.status==='idle')
      .map(item=>this.disposeRuntime(item.sessionId)));
  }
  private async disposeIdleRuntimes(){
    await Promise.all([...this.runtimes.values()].filter(item=>item.status==='idle'||item.status==='error')
      .map(item=>this.disposeRuntime(item.sessionId)));
  }
  async dispose(){await Promise.all([...this.runtimes.keys()].map(id=>this.disposeRuntime(id)));}
}
