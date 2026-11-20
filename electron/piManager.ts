import { app, safeStorage, shell } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  PiRuntimeConfig,PiRuntimeInfo,PiRuntimeChange,PiProjectTrust,PiSlashCommand,PiTrustChoice,PiTrustSaveResponse,
  PiCompactionConfiguration,PiCompactionResponse,PiContextProjection,PiDirectBashState,PiEntriesResponse,PiForkResponse,PiModelDefaults,PiModelSummary,PiProviderStatus,
  PiQueueState,PiRuntimeStatus,PiSessionCatalog,PiSessionInfo,PiSessionScope,PiSessionSearchResult,PiSessionSnapshot,PiSessionSort,
  PiSessionSummary,PiSessionTreeResponse,PiThinkingLevel,PiTreeNavigationResponse,PiUsageStats,RevuPiEvent,
} from '../shared/piTypes';
import { calculatePiCacheHitPercent, countPiSessionRuns, derivedPiSessionName, isReservedPiSessionName } from '../shared/piSession';
import { searchPiSessions } from '../shared/piSessionSearch';
import { acceptPiQueueHead, cleanPiQueue, emptyPiQueue, mergePiQueues } from '../shared/piQueue';
import { parsePiCommand, PI_BUILTIN_COMMANDS, piQueueWarning } from '../shared/piCommands';
import { directoryExists,replaceSessionCwd,runtimeInfo,runtimeLaunch,sessionCwd,wslPath } from './piRuntime';
import {extensionRequest,PiExtensionUI} from '../shared/piExtensionUI';
import type {PiExtensionReply,PiExtensionPending} from '../shared/piTypes';
import { copyPiSessions, nativePiSessionDir, nativePiSessionsDir } from './piSessionStorage';

type PiModule=typeof import('@earendil-works/pi-coding-agent');
type NativeRpcClient=InstanceType<PiModule['RpcClient']>;
type RpcClient=Omit<NativeRpcClient,'bash'>&{
  bash:(command:string,excludeFromContext?:boolean)=>Promise<{output:string;exitCode:number|null;cancelled:boolean;truncated:boolean;fullOutputPath?:string}>;
  navigateTree:(entryId:string,options:{summarize:boolean;customInstructions?:string})=>Promise<{editorText?:string;cancelled:boolean;aborted?:boolean;summaryEntry?:unknown}>;
  setEntryLabel:(entryId:string,label?:string)=>Promise<void>;
  abortBranchSummary:()=>Promise<void>;
  getCacheWarmingInfo:()=>Promise<{mode:string;status?:CacheWarmingStatus;cacheWaste:CacheWaste}>;
  getContextProjection:()=>Promise<PiContextProjection>;
  reloadSettings:()=>Promise<void>;
  reloadResources:()=>Promise<void>;
  respondExtensionUI:(response:{id:string}&PiExtensionReply)=>Promise<void>;
};
interface PiTrustModule {
  ProjectTrustStore:new(agentDir:string)=>{getEntry:(cwd:string)=>{path:string;decision:boolean}|null;setMany:(updates:{path:string;decision:boolean|null}[])=>void};
  getProjectTrustOptions:(cwd:string)=>{trusted:boolean;updates:{path:string;decision:boolean|null}[];savedPath:string}[];
  hasTrustRequiringProjectResources:(cwd:string)=>boolean;
}
interface CompactionSettingsManager {
  getCompactionConfiguration:()=>PiCompactionConfiguration;
  setCompactionConfiguration:(configuration:PiCompactionConfiguration)=>void;
  flush:()=>Promise<void>;
  drainErrors:()=>Array<{error:Error}>;
}
interface CacheWarmingDecision {phase:'streaming'|'idle';warmCost:number;missCost:number;continuationProbability:number;expectedSavings:number;economicsAvailable:boolean;action:'warm'|'stop'}
interface CacheWarmingStatus {state:'inactive'|'scheduled'|'refreshing';reason?:string;nextWarmAt?:number;decision?:CacheWarmingDecision;extensionOverride?:boolean}
interface CacheWaste {missedTokens:number;missedCost:number;missCount:number}
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
  runtimeCwd:string;
  ui:PiExtensionUI;
  client:RpcClient;
  status:PiRuntimeStatus;
  sessionPath?:string;
  error?:string;
  isCompacting?:boolean;
  queue:PiQueueState;
  bash?:PiDirectBashState;
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
const valueRecord=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'?value as Record<string,unknown>:{};
const numberValue=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:0;
function usageCostBreakdown(entries:unknown[]){
  const totals=new Map<string,{key:string;cost:number;tokens:number}>();
  for(const rawEntry of entries){
    const entry=valueRecord(rawEntry);const message=valueRecord(entry.message);let key:string|undefined;let usage:Record<string,unknown>|undefined;
    if(entry.type==='message'&&message.role==='assistant'){
      key=`${String(message.provider??'')}/${String(message.responseModel??message.model??'')}`;usage=valueRecord(message.usage);
    }else if(entry.type==='usage'){
      key=`${String(entry.provider??'')}/${String(entry.model??'')}`;usage=valueRecord(entry.usage);
    }else if(entry.type==='message'&&message.role==='toolResult'&&message.usage){key='Tools/summaries';usage=valueRecord(message.usage);
    }else if((entry.type==='branch_summary'||entry.type==='compaction')&&entry.usage){key='Tools/summaries';usage=valueRecord(entry.usage);}
    if(!key||!usage)continue;
    const current=totals.get(key)??{key,cost:0,tokens:0};
    current.cost+=numberValue(valueRecord(usage.cost).total);
    current.tokens+=numberValue(usage.input)+numberValue(usage.output)+numberValue(usage.cacheRead)+numberValue(usage.cacheWrite);
    totals.set(key,current);
  }
  return [...totals.values()].filter(item=>item.cost>0||item.tokens>0).sort((a,b)=>b.cost-a.cost);
}
function warmingDollars(value:number){return value<0?`-$${Math.abs(value).toFixed(3)}`:`$${value.toFixed(3)}`;}
function warmingEconomics(decision:CacheWarmingDecision){
  if(!decision.economicsAvailable)return 'cache economics unavailable';
  const probability=Math.round(decision.continuationProbability*100);const probabilityText=decision.phase==='streaming'
    ?`${probability}% continuation probability while agent is running`:`${probability}% continuation probability`;
  return `${probabilityText}, expected savings ${warmingDollars(decision.expectedSavings)} ${decision.action==='warm'?'>=':'<'} $0.050`;
}
function warmingDecisionTime(nextWarmAt?:number){
  if(nextWarmAt===undefined||nextWarmAt<=Date.now())return 'Decision now';
  let remaining=Math.ceil((nextWarmAt-Date.now())/1000);const hours=Math.floor(remaining/3600);remaining%=3600;
  const minutes=Math.floor(remaining/60);const seconds=remaining%60;const parts:string[]=[];
  if(hours)parts.push(`${hours}h`);if(minutes)parts.push(`${minutes}m`);if(seconds||!parts.length)parts.push(`${seconds}s`);
  return `Decision in ${parts.join(' ')}`;
}
function formatWarmingStatus(status?:CacheWarmingStatus){
  if(!status)return 'Inactive (cache warming unavailable)';const decision=status.decision;
  if(!decision||(status.state==='inactive'&&!decision.economicsAvailable&&!status.extensionOverride))return `Inactive (${status.reason??'unknown reason'})`;
  const details=status.extensionOverride?`extension override, ${warmingEconomics(decision)}`:`${warmingEconomics(decision)} -> ${decision.action}`;
  if(status.state==='inactive')return `Stopped (${details})`;
  if(status.state==='refreshing')return `Warming cache (${details})`;
  return `${warmingDecisionTime(status.nextWarmAt)} (${details})`;
}

export class PiManager {
  private readonly runtimes=new Map<string,RuntimeHandle>();
  private readonly retainedQueues=new Map<string,PiQueueState>();
  private readonly retainedQueueRevisions=new Map<string,number>();
  private readonly runCountCache=new Map<string,{modifiedAt:number;count:number}>();
  private readonly treeOperations=new Map<string,TreeOperation>();
  private readonly trustDecisions=new Map<string,boolean>();
  private readonly trustPrompts=new Map<string,Promise<boolean>>();
  private readonly trustRequests=new Map<string,{cwd:string;projectId:string;resolve:(choice:PiTrustChoice|null)=>void}>();
  private readonly clientTrust=new WeakMap<RpcClient,boolean>();
  private readonly clientCwd=new WeakMap<RpcClient,string>();
  private readonly resourceOperations=new Set<string>();
  private changingTrust=false;
  private changingRuntime=false;
  private readonly clients=new Set<RpcClient>();
  private readonly resourceLoads=new Set<Promise<unknown>>();
  private readonly sessionStarts=new Map<string,Promise<RuntimeHandle>>();
  private runtimeConfig:PiRuntimeConfig={kind:'native'};
  private readonly cwdRequests=new Map<string,{projectId:string;resolve:(accept:boolean)=>void}>();
  private trustModulePromise?:Promise<PiTrustModule>;
  private selectedSessionId:string|null=null;
  private modulePromise:Promise<PiModule>|null=null;
  private readonly agentDir:string;
  private readonly nativeSessionsDir=nativePiSessionsDir();
  private readonly secretsPath:string;
  private readonly sessionFolderSettingsPath:string;
  private sessionFolder?:string;

  constructor(private readonly options:PiManagerOptions){
    this.agentDir=join(app.getPath('userData'),'pi-agent');
    this.secretsPath=join(app.getPath('userData'),'pi-api-keys.bin');
    this.sessionFolderSettingsPath=join(app.getPath('userData'),'pi-session-folder.json');
    process.env.PI_SKIP_VERSION_CHECK='1';
  }

  async initialize(){
    try{const saved=JSON.parse(await readFile(join(app.getPath('userData'),'pi-runtime.json'),'utf8'));if(saved.kind==='native'||saved.kind==='wsl')this.runtimeConfig={kind:saved.kind,distribution:typeof saved.distribution==='string'?saved.distribution:undefined,nativeShellPath:typeof saved.nativeShellPath==='string'?saved.nativeShellPath:undefined};}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')console.warn('Could not load Pi runtime settings.',error);}
    try{
      const saved=JSON.parse(await readFile(this.sessionFolderSettingsPath,'utf8')) as {sessionDir?:unknown};
      if(typeof saved.sessionDir==='string'&&saved.sessionDir.trim())this.sessionFolder=resolve(saved.sessionDir);
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')console.warn('Could not load the Pi session folder setting.',error);}
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
  private queueKey(projectId:string,sessionId:string){return `${projectId}\u0000${sessionId}`;}
  private retainedQueue(projectId:string,sessionId:string){return this.retainedQueues.get(this.queueKey(projectId,sessionId))??emptyPiQueue();}
  private updateRetainedQueue(handle:Pick<RuntimeHandle,'projectId'|'sessionId'>,queue:PiQueueState){
    const normalized=cleanPiQueue(queue);const key=this.queueKey(handle.projectId,handle.sessionId);
    if(normalized.steering.length||normalized.followUp.length)this.retainedQueues.set(key,normalized);else this.retainedQueues.delete(key);
    this.retainedQueueRevisions.set(key,(this.retainedQueueRevisions.get(key)??0)+1);
    this.emit(handle,'retained-queue',normalized);return normalized;
  }
  private retainQueue(handle:Pick<RuntimeHandle,'projectId'|'sessionId'>,queue:PiQueueState){
    return this.updateRetainedQueue(handle,mergePiQueues(this.retainedQueue(handle.projectId,handle.sessionId),cleanPiQueue(queue)));
  }
  private captureLiveQueue(handle:RuntimeHandle){
    const mirrored=cleanPiQueue(handle.queue);if(!mirrored.steering.length&&!mirrored.followUp.length)return;const key=this.queueKey(handle.projectId,handle.sessionId);
    const existing=this.retainedQueue(handle.projectId,handle.sessionId);handle.queue=emptyPiQueue();this.updateRetainedQueue(handle,mergePiQueues(existing,mirrored));
    const revision=this.retainedQueueRevisions.get(key);void handle.client.clearQueue().then(cleared=>{
      if(this.retainedQueueRevisions.get(key)!==revision)return;this.updateRetainedQueue(handle,mergePiQueues(existing,cleared));
    }).catch(()=>{});
  }
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


  private cliPath(){
    if(app.isPackaged)return join(process.resourcesPath,'pi','app','bundle','cli.js');
    return join(app.getAppPath(),'.pi-runtime','app','bundle','cli.js');
  }

  private runtimePaths(){return {root:app.isPackaged?join(process.resourcesPath,'pi'):join(app.getAppPath(),'.pi-runtime'),agentDir:this.agentDir,processDir:join(app.getPath('userData'),'pi-processes')};}
  async getRuntimeInfo():Promise<PiRuntimeInfo>{return runtimeInfo(this.runtimeConfig,this.runtimePaths());}
  async getRuntimeCwd(projectId:string){const cwd=this.project(projectId).root;return this.runtimeConfig.kind==='wsl'?wslPath(this.runtimeConfig.distribution!,cwd):cwd;}
  getExtensionRequests():PiExtensionPending[]{return [...this.runtimes.values()].filter(handle=>handle.ui.size).map(handle=>({projectId:handle.projectId,sessionId:handle.sessionId,requests:handle.ui.requests}));}
  async respondExtensionUI(projectId:string,sessionId:string,requestId:string,reply:PiExtensionReply){
    this.project(projectId);const handle=this.runtimes.get(sessionId);
    if(!handle||handle.projectId!==projectId)throw new Error('Question session is unavailable.');
    await handle.ui.reply(requestId,reply);
  }
  async respondSessionCwd(requestId:string,accept:boolean){if(typeof accept!=='boolean')throw new Error('Invalid directory recovery choice.');this.cwdRequests.get(requestId)?.resolve(accept);}
  private async checkSessionCwd(projectId:string,path:string,config:PiRuntimeConfig,current:string){
    const saved=await sessionCwd(path);if(!saved||await directoryExists(config,saved))return;
    if(!await directoryExists(config,current))throw new Error('The current project directory is unavailable in the selected runtime.');
    const id=crypto.randomUUID();const accepted=new Promise<boolean>(resolve=>this.cwdRequests.set(id,{projectId,resolve}));
    this.options.emit({projectId,sessionId:'',type:'cwd-request',payload:{id,saved,current}});
    try{if(!await accepted)throw new Error('Session recovery cancelled.');return {path,saved,current};}finally{this.cwdRequests.delete(id);}
  }
  async setRuntime(config:PiRuntimeConfig):Promise<PiRuntimeChange>{
    if(!config||!['native','wsl'].includes(config.kind)||config.nativeShellPath!==undefined&&typeof config.nativeShellPath!=='string'||config.distribution!==undefined&&typeof config.distribution!=='string')throw new Error('Invalid runtime settings.');
    if(this.changingRuntime||this.changingTrust||this.cwdRequests.size)throw new Error('Wait for the current resource operation to finish.');
    this.changingRuntime=true;const previous=this.runtimeConfig;const handles:RuntimeHandle[]=[];const changes:{path:string;saved:string;current:string}[]=[];
    const restarted:PiRuntimeChange['restarted']=[];const states=new Map<RuntimeHandle,Awaited<ReturnType<RpcClient['getState']>>>();let stopped=false;
    try{
      await Promise.allSettled([...this.resourceLoads]);
      if([...this.clients].some(client=>![...this.runtimes.values()].some(handle=>handle.client===client)))throw new Error('Wait for Pi resources to finish loading before switching runtime.');
      handles.push(...this.runtimes.values());
      for(const handle of handles){if(handle.ui.size||!['idle','error'].includes(handle.status)||handle.isCompacting||handle.bash||this.treeOperations.has(handle.sessionId)||this.resourceOperations.has(handle.sessionId))throw new Error('Answer pending questions and wait for all sessions and tools to finish before switching runtime.');
        const state=await handle.client.getState();if(state.isStreaming||state.isCompacting||!['idle','error'].includes(handle.status)||handle.bash)throw new Error('Wait for all sessions and tools to finish before switching runtime.');states.set(handle,state);}
      const info=await runtimeInfo(config,this.runtimePaths());if(!info.ready)throw new Error(info.error||'Runtime is unavailable.');config=info.config;
      for(const handle of handles)if(handle.sessionPath&&existsSync(handle.sessionPath)){const current=config.kind==='wsl'?await wslPath(config.distribution!,handle.cwd):handle.cwd;
        const change=await this.checkSessionCwd(handle.projectId,handle.sessionPath,config,current);if(change)changes.push(change);}
      for(const handle of handles)if(handle.ui.size||!['idle','error'].includes(handle.status)||handle.isCompacting||handle.bash)throw new Error('Wait for all sessions and tools to finish before switching runtime.');
      for(const handle of handles)await this.disposeRuntime(handle.sessionId);stopped=true;
      for(const change of changes)await replaceSessionCwd(change.path,change.saved,change.current);
      this.runtimeConfig=config;
      for(const handle of handles){const state=states.get(handle)!;const path=handle.sessionPath&&existsSync(handle.sessionPath)?handle.sessionPath:undefined;
        const next=await this.startRuntime(handle.projectId,handle.sessionId,path,true);const models=await next.client.getAvailableModels();
        if(state.model&&models.some(model=>model.provider===state.model!.provider&&model.id===state.model!.id))await next.client.setModel(state.model.provider,state.model.id);
        await next.client.setThinkingLevel(state.thinkingLevel);await next.client.setAutoCompaction(state.autoCompactionEnabled);if(state.sessionName)await next.client.setSessionName(state.sessionName);
        this.updateRetainedQueue(next,this.retainedQueue(handle.projectId,handle.sessionId));restarted.push({previousId:handle.sessionId,snapshot:await this.snapshot(next)});}
      await mkdir(app.getPath('userData'),{recursive:true});await writeFile(join(app.getPath('userData'),'pi-runtime.json'),JSON.stringify(config,null,2));
      const response={info,restarted};this.options.emit({projectId:'',sessionId:'',type:'runtime-changed',payload:response});return response;
    }catch(error){
      if(stopped){for(const item of restarted)await this.disposeRuntime(item.snapshot.sessionId);for(const handle of handles)await this.disposeRuntime(handle.sessionId);
        this.runtimeConfig=previous;for(const change of changes){if(await sessionCwd(change.path)===change.current)await replaceSessionCwd(change.path,change.current,change.saved);}
        const restored:PiRuntimeChange['restarted']=[];for(const handle of handles){try{const next=await this.startRuntime(handle.projectId,handle.sessionId,handle.sessionPath&&existsSync(handle.sessionPath)?handle.sessionPath:undefined,true);const state=states.get(handle)!;if(state.model&&state.model.provider!=='unknown')await next.client.setModel(state.model.provider,state.model.id);await next.client.setThinkingLevel(state.thinkingLevel);await next.client.setAutoCompaction(state.autoCompactionEnabled);restored.push({previousId:handle.sessionId,snapshot:await this.snapshot(next)});}catch(restoreError){this.emit(handle,'error',errorMessage(restoreError));}}
        this.options.emit({projectId:'',sessionId:'',type:'runtime-changed',payload:{info:await this.getRuntimeInfo(),restarted:restored}});
      }throw error;
    }finally{this.changingRuntime=false;}
  }

  private async sessionLocation(cwd:string){
    const {SettingsManager}=await this.module();
    const configured=process.env.PI_CODING_AGENT_SESSION_DIR?.trim()||SettingsManager.create(cwd,this.agentDir).getSessionDir()?.trim()||this.sessionFolder;
    if(configured)return {dir:isAbsolute(configured)?configured:resolve(cwd,configured),custom:true};
    return {dir:nativePiSessionDir(cwd),custom:false};
  }

  private async createClient(cwd:string,sessionPath?:string,ephemeral=false,projectId='',trustRestart=false,expectedId?:string){
    if((this.changingTrust||this.changingRuntime)&&!trustRestart)throw new Error('Wait for the current resource operation to finish.');
    const {RpcClient}=await this.module();const trusted=await this.ensureProjectTrust(cwd,projectId);if(projectId)this.project(projectId);
    const config=this.runtimeConfig;const {dir}=await this.sessionLocation(cwd);const paths=this.runtimePaths();
    const {SettingsManager}=await this.module();const nativeShell=config.kind==='native'?SettingsManager.create(cwd,this.agentDir,{projectTrusted:trusted}).getShellPath():undefined;
    const launch=await runtimeLaunch(config,{...paths,nativeShell},cwd,dir);
    if(sessionPath){const change=await this.checkSessionCwd(projectId,sessionPath,config,launch.cwd);if(change)await replaceSessionCwd(change.path,change.saved,change.current);}
    if(projectId)this.project(projectId);if((this.changingTrust||this.changingRuntime)&&!trustRestart)throw new Error('Runtime changed. Try again.');
    const targetPath=(path:string)=>config.kind==='wsl'?wslPath(config.distribution!,path):Promise.resolve(path);
    const args=[trusted?'--approve':'--no-approve','--extension',await targetPath(join(paths.root,'app','revu-extensions','ask-user.ts')),'--session-dir',await targetPath(dir),'--append-system-prompt',`Runtime: ${config.kind==='wsl'?'WSL/'+config.distribution:process.platform==='darwin'?'macOS':'Windows'}; cwd: ${launch.cwd}. Historical paths may differ.`];
    if(sessionPath)args.push('--session',await targetPath(sessionPath));else if(ephemeral)args.push('--no-session');
    const env:Record<string,string>={...launch.env,PI_SKIP_VERSION_CHECK:'1',REVU_PI_SESSION_ID:!sessionPath?expectedId??'':''};const secrets=await this.readSecrets();for(const provider of PROVIDERS)env[provider.env]=secrets[provider.id]??'';
    const client=new RpcClient({cwd,cliPath:this.cliPath(),args,launchCommand:launch.command,launchArgs:[...launch.prefix,await targetPath(this.cliPath())],bootstrap:JSON.stringify({cwd:launch.cwd,env,pidFile:launch.pidFile}),stopProcess:launch.stop} as unknown as ConstructorParameters<PiModule['RpcClient']>[0]) as unknown as RpcClient;
    if(config.kind==='wsl'){const getState=client.getState.bind(client);client.getState=async()=>{const state=await getState();return {...state,sessionFile:state.sessionFile?launch.hostPath(state.sessionFile):state.sessionFile};};}
    this.clients.add(client);const stop=client.stop.bind(client);client.stop=async()=>{try{await stop();}finally{this.clients.delete(client);}};
    this.clientTrust.set(client,trusted);this.clientCwd.set(client,launch.cwd);return client;
  }

  private async listedSessions(projectId:string,scope:PiSessionScope){
    const project=this.project(projectId);const {SessionManager}=await this.module();const location=await this.sessionLocation(project.root);
    if(scope==='current')return SessionManager.list(project.root,location.dir);
    if(location.custom)return SessionManager.listAll(location.dir);
    let entries;
    try{entries=await readdir(this.nativeSessionsDir,{withFileTypes:true});}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
    const batches=await Promise.all(entries.filter(entry=>entry.isDirectory()||entry.isSymbolicLink())
      .map(entry=>SessionManager.listAll(join(this.nativeSessionsDir,entry.name))));
    const byPath=new Map<string,(typeof batches)[number][number]>();
    for(const session of batches.flat())byPath.set(this.sessionPathKey(session.path),session);
    return [...byPath.values()].sort((a,b)=>b.modified.getTime()-a.modified.getTime());
  }

  private async findSession(projectId:string,sessionId:string,scope:PiSessionScope='current'){
    const sessions=await this.listedSessions(projectId,scope);
    const session=sessions.find(item=>item.id===sessionId);
    if(!session)throw new Error('Session not found.');
    return session;
  }

  private sessionPathKey(path:string){const normalized=path.replace(/\\/g,'/');return process.platform==='win32'?normalized.toLocaleLowerCase():normalized;}

  private cwdKey(path:string){const normalized=resolve(path).replace(/\\/g,'/');return process.platform==='win32'?normalized.toLocaleLowerCase():normalized;}

  private summaries(projectId:string,scope:PiSessionScope,listed:Awaited<ReturnType<PiModule['SessionManager']['list']>>):PiSessionSummary[]{
    const idsByPath=new Map(listed.map(session=>[this.sessionPathKey(session.path),session.id]));
    return listed.map(session=>({
      id:session.id,projectId,cwd:session.cwd,name:session.name||session.firstMessage.trim().slice(0,80)||'New Chat',hasName:!!session.name,scope,
      firstMessage:session.firstMessage,createdAt:session.created.getTime(),modifiedAt:session.modified.getTime(),
      runCount:0,status:this.runtimes.get(session.id)?.status??'idle' as PiRuntimeStatus,hasSessionFile:true,
      isCompacting:this.runtimes.get(session.id)?.isCompacting,
      question:!!this.runtimes.get(session.id)?.ui.size,
      parentSessionId:session.parentSessionPath?idsByPath.get(this.sessionPathKey(session.parentSessionPath)):undefined,
    }));
  }

  async listSessions(projectId:string,scope:PiSessionScope='current'):Promise<PiSessionCatalog>{
    const project=this.project(projectId);const {SessionManager}=await this.module();
    const listed=await this.listedSessions(projectId,scope);
    const result=this.summaries(projectId,scope,listed).map((summary,index)=>({...summary,
      runCount:this.countRuns(SessionManager,listed[index].path,listed[index].modified.getTime())}));
    if(scope==='current')for(const runtime of this.runtimes.values()){
      if(runtime.projectId!==projectId||result.some(item=>item.id===runtime.sessionId))continue;
      result.unshift({id:runtime.sessionId,projectId,cwd:project.root,name:'New Chat',hasName:false,scope,firstMessage:'',createdAt:Date.now(),
        modifiedAt:Date.now(),runCount:0,status:runtime.status,hasSessionFile:!!runtime.sessionPath&&existsSync(runtime.sessionPath),isCompacting:runtime.isCompacting,question:!!runtime.ui.size});
    }
    const groups=[...new Map(result.filter(item=>item.cwd).map(item=>[this.cwdKey(item.cwd),{
      key:this.cwdKey(item.cwd),name:basename(item.cwd)||item.cwd,cwd:item.cwd,available:existsSync(item.cwd),
    }])).values()].sort((a,b)=>a.name.localeCompare(b.name)||a.cwd.localeCompare(b.cwd));
    return {groups,sessions:result.sort((a,b)=>b.modifiedAt-a.modifiedAt)};
  }

  async searchSessions(projectId:string,query:string,sort:PiSessionSort,scope:PiSessionScope='current'):Promise<PiSessionSearchResult[]>{
    const {SessionManager}=await this.module();const listed=await this.listedSessions(projectId,scope);
    const summaries=this.summaries(projectId,scope,listed);
    return searchPiSessions(listed.map((session,index)=>({summary:{...summaries[index],
      runCount:this.countRuns(SessionManager,session.path,session.modified.getTime())},allMessagesText:session.allMessagesText})),query,sort);
  }

  private countRuns(SessionManager:PiModule['SessionManager'],path:string,modifiedAt:number){
    const cached=this.runCountCache.get(path);if(cached?.modifiedAt===modifiedAt)return cached.count;
    let count=0;
    try{count=countPiSessionRuns(SessionManager.open(path).getBranch());}catch{count=0;}
    this.runCountCache.set(path,{modifiedAt,count});return count;
  }

  private async startRuntime(projectId:string,sessionId?:string,sessionPath?:string,trustRestart=false){
    const provisional=sessionId??crypto.randomUUID();
    const project=this.project(projectId);const client=await this.createClient(project.root,sessionPath,false,projectId,trustRestart,provisional);
    const ui=new PiExtensionUI((id,reply)=>client.respondExtensionUI({id,...reply}),()=>this.emit(handle,'extension-ui',ui.requests));
    const handle:RuntimeHandle={sessionId:provisional,projectId,cwd:project.root,runtimeCwd:this.clientCwd.get(client)??project.root,ui,client,status:'starting',sessionPath,queue:emptyPiQueue(),unsubscribe:()=>{}};
    handle.unsubscribe=client.onEvent(event=>this.onEvent(handle,event));
    this.runtimes.set(provisional,handle);
    try{
      await client.start();
      this.project(projectId);
      const state=await client.getState();
      handle.sessionId=state.sessionId;handle.sessionPath=state.sessionFile;handle.status=state.isStreaming?'running':'idle';
      if(sessionId&&sessionId!==state.sessionId)throw new Error('Pi opened a different session than requested.');
      this.runtimes.set(handle.sessionId,handle);
      this.emit(handle,'status',handle.status);
      return handle;
    }catch(error){
      this.runtimes.delete(provisional);handle.ui.clear();handle.unsubscribe();await client.stop().catch(()=>{});throw error;
    }
  }

  private async ensureRuntime(projectId:string,sessionId:string){
    if(this.changingTrust||this.changingRuntime||this.resourceOperations.has(sessionId))throw new Error('Wait for the current resource operation to finish.');
    const existing=this.runtimes.get(sessionId);
    if(existing){if(existing.projectId!==projectId)throw new Error('Session does not belong to this project.');return existing;}
    const session=await this.findSession(projectId,sessionId);
    return this.startRuntime(projectId,sessionId,session.path);
  }

  private async stableRuntime(projectId:string,sessionId:string){
    const existing=this.runtimes.get(sessionId);
    if(existing?.status==='error')await this.disposeRuntime(sessionId);
    const handle=await this.ensureRuntime(projectId,sessionId);
    if(handle.ui.size)throw new Error('Answer the pending question first.');
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
    const previousQueueKey=this.queueKey(handle.projectId,previousId);const retained=this.retainedQueue(handle.projectId,previousId);this.retainedQueues.delete(previousQueueKey);this.retainedQueueRevisions.delete(previousQueueKey);
    handle.sessionId=state.sessionId;handle.sessionPath=state.sessionFile;handle.status='idle';handle.error=undefined;handle.queue=emptyPiQueue();
    if(retained.steering.length||retained.followUp.length){const queueKey=this.queueKey(handle.projectId,handle.sessionId);this.retainedQueues.set(queueKey,retained);this.retainedQueueRevisions.set(queueKey,1);}
    this.runtimes.set(handle.sessionId,handle);this.selectedSessionId=handle.sessionId;
    return handle;
  }

  async openSession(projectId:string,sessionId:string){
    this.selectedSessionId=sessionId;
    const handle=await this.ensureRuntime(projectId,sessionId);
    await this.disposeUnselectedIdleRuntimes();
    return this.snapshot(handle);
  }

  async discoveredSession(projectId:string,sessionId:string){return this.findSession(projectId,sessionId,'all');}

  async openSessionFile(projectId:string,sessionId:string,path:string){
    this.selectedSessionId=sessionId;const existing=this.runtimes.get(sessionId);
    const handle=existing??await this.startRuntime(projectId,sessionId,path);
    if(handle.projectId!==projectId)throw new Error('Session is already open in another project.');
    await this.disposeUnselectedIdleRuntimes();return this.snapshot(handle);
  }

  async getSessionInfo(projectId:string,sessionId:string):Promise<PiSessionInfo>{
    const handle=await this.ensureRuntime(projectId,sessionId);
    const [stats,warming,state,entryResponse]=await Promise.all([
      handle.client.getSessionStats(),handle.client.getCacheWarmingInfo(),handle.client.getState(),handle.client.getEntries(),
    ]);
    const input=stats.tokens.input+stats.tokens.cacheRead+stats.tokens.cacheWrite;
    const breakdown=usageCostBreakdown(entryResponse.entries as unknown[]);const selectedModelKey=`${state.model?.provider}/${state.model?.id}`;
    const costBreakdown=breakdown.length>1||breakdown[0]?.key!==selectedModelKey?breakdown:[];
    const decision=warming.status?.decision;const waste=warming.cacheWaste;
    return {file:stats.sessionFile??'In-memory',id:stats.sessionId,name:state.sessionName||undefined,
      messages:{total:stats.totalMessages,user:stats.userMessages,assistant:stats.assistantMessages,toolCalls:stats.toolCalls,toolResults:stats.toolResults},
      tokens:{input,cached:stats.tokens.cacheRead,uncached:stats.tokens.input+stats.tokens.cacheWrite,cacheWrite:stats.tokens.cacheWrite,
        output:stats.tokens.output,total:stats.tokens.total,cachePercent:input?stats.tokens.cacheRead/input*100:0},
      cacheWarming:{mode:warming.mode,status:formatWarmingStatus(warming.status),
        missPenalty:decision?.economicsAvailable?decision.missCost:undefined,refreshCost:decision?.economicsAvailable?decision.warmCost:undefined},
      cost:stats.cost,costBreakdown,
      cacheRebilled:waste.missedTokens>0?{cost:waste.missedCost,tokens:waste.missedTokens,missCount:waste.missCount}:undefined};
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
    if(handle.status==='starting'&&handle.ui.size)return {entries:[],leafId:null};
    const response=await handle.client.getEntries(sinceEntryId);
    return response as PiEntriesResponse;
  }

  async getSessionTree(projectId:string,sessionId:string):Promise<PiSessionTreeResponse>{
    const handle=await this.ensureRuntime(projectId,sessionId);return handle.client.getTree() as Promise<PiSessionTreeResponse>;
  }

  private async stopForTreeOperation(handle:RuntimeHandle){
    if(handle.ui.size)throw new Error('Answer the pending question first.');
    let state=await handle.client.getState();
    if(handle.status==='running'||handle.status==='stopping'||state.isStreaming){
      const cleared=await handle.client.clearQueue();this.retainQueue(handle,cleared);await handle.client.abort();handle.status='idle';this.emit(handle,'status','idle');
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
      const summaryId=crypto.randomUUID();
      if(summarize)this.emit(handle,'event',{type:'summary_operation_start',id:summaryId,kind:'branchSummary'});
      let result:Awaited<ReturnType<RpcClient['navigateTree']>>;
      try{
        result=await handle.client.navigateTree(entryId,{summarize,customInstructions});
        if(summarize)this.emit(handle,'event',{type:'summary_operation_end',id:summaryId,kind:'branchSummary',
          result:result.summaryEntry,cancelled:result.cancelled,aborted:result.aborted,skipped:!result.summaryEntry});
      }catch(error){
        if(summarize)this.emit(handle,'event',{type:'summary_operation_end',id:summaryId,kind:'branchSummary',errorMessage:errorMessage(error)});
        throw error;
      }
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
    const sessions=(await this.listSessions(projectId)).sessions;const source=sessions.find(item=>item.id===sessionId);
    if(!source)throw new Error('Session not found.');
    const handle=await this.stableRuntime(projectId,sessionId);const result=await handle.client.fork(entryId);
    if(result.cancelled)throw new Error('Fork was cancelled.');
    await this.replaceRuntimeSession(handle,sessionId);
    await handle.client.setSessionName(derivedPiSessionName(source.name,'Fork',sessions.map(item=>item.name)));
    this.emit(handle,'sessions-changed');await this.disposeUnselectedIdleRuntimes();
    return {snapshot:await this.snapshot(handle),selectedText:result.text};
  }

  async cloneSession(projectId:string,sessionId:string){
    const sessions=(await this.listSessions(projectId)).sessions;const source=sessions.find(item=>item.id===sessionId);
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
    if(handle)await handle.ui.cancel();
    if(this.selectedSessionId===sessionId)this.selectedSessionId=null;
    if(handle&&!handle.isCompacting&&!this.treeOperations.has(sessionId)&&(handle.status==='idle'||handle.status==='error'))await this.disposeRuntime(sessionId);
  }

  async sessionName(projectId:string,sessionId:string){
    const session=await this.findSession(projectId,sessionId);
    return session.name||session.firstMessage.trim().slice(0,80)||'New Chat';
  }

  private async snapshot(handle:RuntimeHandle):Promise<PiSessionSnapshot>{
    if(handle.status==='starting'&&handle.ui.size)return {sessionId:handle.sessionId,projectId:handle.projectId,status:'starting',cwd:handle.runtimeCwd,name:'New Chat',messages:[],thinkingLevel:'medium',availableThinkingLevels:[],autoCompactionEnabled:true,isCompacting:false,extensionRequests:handle.ui.requests};
    const [state,messages,levels,stats]=await Promise.all([
      handle.client.getState(),handle.client.getMessages(),handle.client.getAvailableThinkingLevels(),
      handle.client.getSessionStats().catch(()=>undefined),
    ]);
    handle.sessionPath=state.sessionFile;
    return {sessionId:handle.sessionId,projectId:handle.projectId,status:handle.status,cwd:handle.runtimeCwd,extensionRequests:handle.ui.requests,
      name:state.sessionName||'New Chat',messages,model:state.model?{
        provider:state.model.provider,id:state.model.id,contextWindow:state.model.contextWindow,
        reasoning:!!state.model.reasoning,
      }:undefined,thinkingLevel:state.thinkingLevel,availableThinkingLevels:levels,
      autoCompactionEnabled:state.autoCompactionEnabled,isCompacting:state.isCompacting,queue:handle.queue,
      retainedQueue:this.retainedQueue(handle.projectId,handle.sessionId),bash:handle.bash,
      usage:stats?this.mapUsage(stats):undefined,error:handle.error};
  }

  async prompt(projectId:string,sessionId:string,text:string){
    const message=text.trimEnd();if(!message.trim())throw new Error('Message is required.');
    const command=parsePiCommand(message);
    if(command&&PI_BUILTIN_COMMANDS.some(item=>item.name===command.name))throw new Error('Built-in commands must be handled by Revu.');
    const handle=await this.ensureRuntime(projectId,sessionId);
    if(handle.status==='running'||handle.status==='stopping')throw new Error('This session is already running.');
    handle.status='running';handle.error=undefined;this.emit(handle,'status','running');
    try{
      const disposition=await handle.client.prompt(message);
      if(disposition!=='handled')await this.flushRetainedQueue(handle);
      if(disposition==='handled'){const state=await handle.client.getState();handle.status=state.isStreaming?'running':'idle';this.emit(handle,'status',handle.status);}
    }catch(error){this.fail(handle,error);throw error;}
  }

  private async flushRetainedQueue(handle:RuntimeHandle){
    const pending=this.retainedQueue(handle.projectId,handle.sessionId);let next={steering:[...pending.steering],followUp:[...pending.followUp]};
    try{
      while(next.steering.length){await this.validateQueue(handle,[next.steering[0]]);await handle.client.steer(next.steering[0]);next=acceptPiQueueHead(next,'steering');this.updateRetainedQueue(handle,next);}
      while(next.followUp.length){await this.validateQueue(handle,[next.followUp[0]]);await handle.client.followUp(next.followUp[0]);next=acceptPiQueueHead(next,'followUp');this.updateRetainedQueue(handle,next);}
    }catch(error){this.emit(handle,'event',{type:'retained_queue_error',message:errorMessage(error)});}
  }

  async steer(projectId:string,sessionId:string,text:string){
    const message=text.trim();if(!message)throw new Error('Message is required.');const handle=await this.ensureRuntime(projectId,sessionId);
    if(handle.status!=='running')throw new Error('Steering is only available while the session is running.');await this.validateQueue(handle,[message]);await handle.client.steer(message);
  }

  async followUp(projectId:string,sessionId:string,text:string){
    const message=text.trim();if(!message)throw new Error('Message is required.');const handle=await this.ensureRuntime(projectId,sessionId);
    if(handle.status!=='running')throw new Error('Follow-up is only available while the session is running.');await this.validateQueue(handle,[message]);await handle.client.followUp(message);
  }

  async clearQueue(projectId:string,sessionId:string):Promise<PiQueueState>{
    const handle=this.runtimes.get(sessionId);
    if(!handle){this.project(projectId);return this.updateRetainedQueue({projectId,sessionId},emptyPiQueue());}
    if(handle.projectId!==projectId)throw new Error('Session does not belong to this project.');
    const cleared=await handle.client.clearQueue();handle.queue=emptyPiQueue();this.updateRetainedQueue(handle,emptyPiQueue());return cleared;
  }

  async setRetainedQueue(projectId:string,sessionId:string,queue:PiQueueState){
    this.project(projectId);const handle=await this.ensureRuntime(projectId,sessionId);
    const existing=this.retainedQueue(projectId,sessionId);
    const added:string[]=[];
    for(const kind of ['steering','followUp'] as const){
      const remaining=[...existing[kind]];
      for(const text of queue[kind]){const index=remaining.indexOf(text);if(index>=0)remaining.splice(index,1);else added.push(text);}
    }
    await this.validateQueue(handle,added);return this.updateRetainedQueue({projectId,sessionId},queue);
  }

  async stop(projectId:string,sessionId:string){
    this.project(projectId);const handle=this.runtimes.get(sessionId);if(!handle)return;
    handle.status='stopping';this.emit(handle,'status','stopping');
    try{const cleared=await handle.client.clearQueue();this.retainQueue(handle,cleared);await handle.client.abort();}
    catch(error){this.fail(handle,error);throw error;}
  }

  async bash(projectId:string,sessionId:string,command:string,excludeFromContext:boolean):Promise<PiDirectBashState>{
    const value=command.trim();if(!value)throw new Error('Command is required.');const handle=await this.ensureRuntime(projectId,sessionId);
    if(handle.bash?.status==='running')throw new Error('Wait for the current Bash command to finish.');
    const started:PiDirectBashState={command:value,output:'',status:'running',excludeFromContext,startedAt:Date.now()};handle.bash=started;this.emit(handle,'bash',started);
    try{
      const result=await handle.client.bash(value,excludeFromContext);const completed:PiDirectBashState={...started,...result,status:result.cancelled||result.exitCode===0?'done':'error'};
      handle.bash=completed;this.emit(handle,'bash',completed);handle.bash=undefined;this.emit(handle,'sessions-changed');return completed;
    }catch(error){const failed:PiDirectBashState={...started,output:handle.bash?.output??'',status:'error',error:errorMessage(error)};
      handle.bash=failed;this.emit(handle,'bash',failed);handle.bash=undefined;throw error;}
  }

  async abortBash(projectId:string,sessionId:string){const handle=await this.ensureRuntime(projectId,sessionId);await handle.client.abortBash();}
  async abortRetry(projectId:string,sessionId:string){const handle=await this.ensureRuntime(projectId,sessionId);await handle.client.abortRetry();}

  async compact(projectId:string,sessionId:string,customInstructions?:string):Promise<PiCompactionResponse>{
    const handle=await this.ensureRuntime(projectId,sessionId);
    if(handle.ui.size)throw new Error('Answer the pending question first.');
    if(handle.status==='running'||handle.status==='stopping')throw new Error('Stop the session before compacting context.');
    const summaryId=crypto.randomUUID();
    this.emit(handle,'event',{type:'summary_operation_start',id:summaryId,kind:'compaction',reason:'manual'});
    let result:Awaited<ReturnType<RpcClient['compact']>>;
    try{
      result=await handle.client.compact(customInstructions?.trim()||undefined);
      this.emit(handle,'event',{type:'summary_operation_end',id:summaryId,kind:'compaction',result});
    }catch(error){
      this.emit(handle,'event',{type:'summary_operation_end',id:summaryId,kind:'compaction',errorMessage:errorMessage(error)});
      throw error;
    }
    const snapshot=await this.snapshot(handle);
    if(this.selectedSessionId!==sessionId)await this.disposeRuntime(sessionId);
    return {snapshot,result:{tokensBefore:result.tokensBefore,estimatedTokensAfter:result.estimatedTokensAfter,
      cost:result.usage?.cost.total}};
  }

  async setAutoCompaction(projectId:string,sessionId:string,enabled:boolean){
    const handle=await this.ensureRuntime(projectId,sessionId);
    await handle.client.setAutoCompaction(enabled);
    return this.snapshot(handle);
  }

  async getContextProjection(projectId:string,sessionId:string){
    const handle=await this.ensureRuntime(projectId,sessionId);return handle.client.getContextProjection();
  }

  private onEvent(handle:RuntimeHandle,event:JsonEvent){
    const raw=event as unknown as Record<string,unknown>;
    if(raw.type==='revu_process_exit'){this.fail(handle,raw.message??'Pi process exited.');return;}
    if(raw.type==='extension_ui_closed'){if(typeof raw.id==='string')handle.ui.remove(raw.id);return;}
    if(raw.type==='extension_ui_request'){
      if(raw.method==='notify'){this.emit(handle,'extension-notify',{message:String(raw.message??''),level:raw.notifyType==='error'?'error':raw.notifyType==='warning'?'warning':'info'});return;}
      const request=extensionRequest(raw);
      if(request)handle.ui.add(request);
      else if(['select','confirm','input','editor'].includes(String(raw.method))&&typeof raw.id==='string')void handle.client.respondExtensionUI({id:raw.id,cancelled:true}).catch(error=>this.fail(handle,error));
      else this.emit(handle,'warning',`Extension UI ${String(raw.method)} is not supported in Revu yet.`);
      return;
    }
    if(event.type==='queue_update')handle.queue={steering:[...event.steering],followUp:[...event.followUp]};
    if(event.type==='bash_execution_update'&&handle.bash?.status==='running'){
      handle.bash={...handle.bash,output:handle.bash.output+event.delta};this.emit(handle,'bash',handle.bash);
    }
    this.emit(handle,'event',event);
    if(event.type==='agent_start'){handle.status='running';this.emit(handle,'status','running');}
    if(event.type==='turn_end')void this.refreshUsage(handle);
    if(event.type==='compaction_start')handle.isCompacting=true;
    if(event.type==='compaction_end')handle.isCompacting=false;
    if(event.type==='agent_settled'){
      this.captureLiveQueue(handle);
      handle.status='idle';this.emit(handle,'status','idle');
      this.emit(handle,'sessions-changed');
      void this.refreshUsage(handle).finally(()=>{
        if(this.selectedSessionId!==handle.sessionId&&!handle.ui.size)return this.disposeRuntime(handle.sessionId);
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
    handle.ui.clear();
    this.captureLiveQueue(handle);
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

  async renameSession(projectId:string,sessionId:string,name:string,scope:PiSessionScope='current'){
    const normalized=name.trim();if(!normalized)throw new Error('Session name is required.');
    if(isReservedPiSessionName(normalized))throw new Error('Names ending in (Fork), (Clone), or a numbered variant are reserved.');
    const runtime=this.runtimes.get(sessionId);
    if(runtime)await runtime.client.setSessionName(normalized);
    else{
      const session=await this.findSession(projectId,sessionId,scope);
      const client=await this.createClient(session.cwd||this.project(projectId).root,session.path,false,projectId);
      try{await client.start();await client.setSessionName(normalized);}
      finally{await client.stop().catch(()=>{});}
    }
    this.options.emit({sessionId,projectId,type:'sessions-changed'});
  }

  async getSessionDirectory(projectId:string){return (await this.sessionLocation(this.project(projectId).root)).dir;}

  async setSessionFolder(projectId:string,directory:string,copyExisting:boolean){
    this.project(projectId);const target=resolve(directory);const targetStats=await stat(target);
    if(!targetStats.isDirectory())throw new Error('The selected session folder is not a directory.');
    if([...this.runtimes.values()].some(item=>item.status==='starting'||item.status==='running'||item.status==='stopping'||item.isCompacting))
      throw new Error('Stop active responses before changing the session folder.');
    const sessions=copyExisting?await this.listedSessions(projectId,'all'):[];
    if(copyExisting)await this.disposeIdleRuntimes();
    const result=copyExisting?await copyPiSessions(sessions.map(session=>({path:session.path,parentSessionPath:session.parentSessionPath})),target):{copied:0,skipped:0};
    await writeFile(this.sessionFolderSettingsPath,JSON.stringify({sessionDir:target},null,2),'utf8');this.sessionFolder=target;
    for(const runtime of this.runtimes.values())this.emit(runtime,'sessions-changed');
    return {path:target,...result};
  }

  async deleteSession(projectId:string,sessionId:string,scope:PiSessionScope='current'){
    const runtime=this.runtimes.get(sessionId);let path=runtime?.sessionPath;
    if(!path){try{path=(await this.findSession(projectId,sessionId,scope)).path;}catch{path=undefined;}}
    await this.disposeRuntime(sessionId);const queueKey=this.queueKey(projectId,sessionId);this.retainedQueues.delete(queueKey);this.retainedQueueRevisions.delete(queueKey);
    if(path){this.runCountCache.delete(path);await shell.trashItem(path);}
    if(this.selectedSessionId===sessionId)this.selectedSessionId=null;
    this.options.emit({sessionId,projectId,type:'sessions-changed'});
  }

  async closeProject(projectId:string){
    for(const request of this.trustRequests.values())if(request.projectId===projectId)request.resolve(null);
    for(const request of this.cwdRequests.values())if(request.projectId===projectId)request.resolve(false);
    await Promise.all([...this.runtimes.values()].filter(item=>item.projectId===projectId).map(item=>this.disposeRuntime(item.sessionId)));
    for(const key of this.retainedQueues.keys())if(key.startsWith(`${projectId}\u0000`)){this.retainedQueues.delete(key);this.retainedQueueRevisions.delete(key);}
    for(const key of this.retainedQueueRevisions.keys())if(key.startsWith(`${projectId}\u0000`))this.retainedQueueRevisions.delete(key);
    this.runCountCache.clear();
  }

  async listModels(projectId:string,sessionId?:string):Promise<PiModelSummary[]>{
    const client=sessionId?this.runtimes.get(sessionId)?.client:undefined;
    const models=client?await client.getAvailableModels():await this.withResourceClient(projectId,client=>client.getAvailableModels());
    return models.map(model=>({...model}));
  }

  async setModel(projectId:string,sessionId:string,provider:string,modelId:string){
    const handle=await this.ensureRuntime(projectId,sessionId);
    if(handle.ui.size)throw new Error('Answer the pending question first.');
    if(handle.status==='running'||handle.status==='stopping')throw new Error('Stop the session before changing models.');
    await handle.client.setModel(provider,modelId);
    return this.snapshot(handle);
  }

  async setThinkingLevel(projectId:string,sessionId:string,level:PiThinkingLevel){
    const handle=await this.ensureRuntime(projectId,sessionId);
    if(handle.ui.size)throw new Error('Answer the pending question first.');
    if(handle.status==='running'||handle.status==='stopping')throw new Error('Stop the session before changing thinking level.');
    await handle.client.setThinkingLevel(level);
    return this.snapshot(handle);
  }

  async getModelDefaults(projectId?:string):Promise<PiModelDefaults>{
    const cwd=projectId?this.project(projectId).root:process.cwd();const {SettingsManager}=await this.module();
    const projectTrusted=projectId?await this.ensureProjectTrust(cwd,projectId):false;
    const settings=SettingsManager.create(cwd,this.agentDir,{projectTrusted});
    return {provider:settings.getDefaultProvider(),modelId:settings.getDefaultModel(),
      thinkingLevel:settings.getDefaultThinkingLevel()??'medium'};
  }

  async saveModelDefaults(provider:string,modelId:string,thinkingLevel:PiThinkingLevel){
    const {SettingsManager}=await this.module();const settings=SettingsManager.create(process.cwd(),this.agentDir);
    settings.setDefaultModelAndProvider(provider,modelId);settings.setDefaultThinkingLevel(thinkingLevel);await settings.flush();
    const errors=settings.drainErrors();if(errors.length)throw new Error(errors.map(item=>item.error.message).join('\n'));
  }

  async getCompactionConfiguration(projectId?:string){
    const cwd=projectId?this.project(projectId).root:process.cwd();const {SettingsManager}=await this.module();
    const projectTrusted=projectId?await this.ensureProjectTrust(cwd,projectId):false;
    return (SettingsManager.create(cwd,this.agentDir,{projectTrusted}) as unknown as CompactionSettingsManager).getCompactionConfiguration();
  }

  async saveCompactionConfiguration(configuration:PiCompactionConfiguration){
    const integer=(value:number,label:string)=>{if(!Number.isSafeInteger(value)||value<0)throw new Error(`${label} must be a non-negative integer.`);return value;};
    const modelOverrides:PiCompactionConfiguration['modelOverrides']={};
    for(const [key,value] of Object.entries(configuration.modelOverrides)){
      if(!key.trim()||!key.includes('/'))throw new Error('Model override keys must use provider/modelId.');const entry:{reserveTokens?:number;keepRecentTokens?:number}={};
      if(value.reserveTokens!==undefined)entry.reserveTokens=integer(value.reserveTokens,`${key} reserveTokens`);
      if(value.keepRecentTokens!==undefined)entry.keepRecentTokens=integer(value.keepRecentTokens,`${key} keepRecentTokens`);
      if(entry.reserveTokens!==undefined||entry.keepRecentTokens!==undefined)modelOverrides[key]=entry;
    }
    const normalized:PiCompactionConfiguration={enabled:!!configuration.enabled,
      reserveTokens:integer(configuration.reserveTokens,'reserveTokens'),keepRecentTokens:integer(configuration.keepRecentTokens,'keepRecentTokens'),modelOverrides};
    const {SettingsManager}=await this.module();const settings=SettingsManager.create(process.cwd(),this.agentDir) as unknown as CompactionSettingsManager;
    settings.setCompactionConfiguration(normalized);await settings.flush();const errors=settings.drainErrors();
    if(errors.length)throw new Error(errors.map(item=>item.error.message).join('\n'));
    await Promise.all([...this.runtimes.values()].map(handle=>handle.client.reloadSettings().catch(()=>{})));
  }

  private async trustModule(){
    return this.trustModulePromise??=import(pathToFileURL(join(dirname(this.cliPath()),'chunks','revu-trust.js')).href) as Promise<PiTrustModule>;
  }
  private trustKey(cwd:string){return resolve(cwd).toLocaleLowerCase();}
  async getProjectTrust(projectId:string,sessionId?:string):Promise<PiProjectTrust>{
    const cwd=this.project(projectId).root;const native=await this.trustModule();const store=new native.ProjectTrustStore(this.agentDir);
    const saved=store.getEntry(cwd);const options=native.getProjectTrustOptions(cwd);
    const handle=sessionId?this.runtimes.get(sessionId):undefined;
    if(handle&&handle.projectId!==projectId)throw new Error('Session does not belong to this project.');
    return {cwd,parentPath:options.length>2?options[1].savedPath:undefined,saved,
      current:handle?this.clientTrust.get(handle.client)??null:null,
      needsDecision:saved===null&&!this.trustDecisions.has(this.trustKey(cwd))&&native.hasTrustRequiringProjectResources(cwd)};
  }
  private async ensureProjectTrust(cwd:string,projectId:string):Promise<boolean>{
    const key=this.trustKey(cwd);const native=await this.trustModule();const store=new native.ProjectTrustStore(this.agentDir);
    const decision=store.getEntry(cwd);if(decision)return decision.decision;
    const previous=this.trustDecisions.get(key);if(previous!==undefined)return previous;
    if(!native.hasTrustRequiringProjectResources(cwd))return true;
    const pending=this.trustPrompts.get(key);if(pending)return pending;
    const requestId=crypto.randomUUID();
    const waiting=new Promise<PiTrustChoice|null>(resolve=>this.trustRequests.set(requestId,{cwd,projectId,resolve}));
    const promise=waiting.then(async choice=>{
      if(choice!==null)await this.writeProjectTrust(cwd,choice);
      const trusted=choice!==null&&choice!=='untrust';this.trustDecisions.set(key,trusted);return trusted;
    }).finally(()=>{this.trustPrompts.delete(key);this.trustRequests.delete(requestId);});
    this.trustPrompts.set(key,promise);
    const options=native.getProjectTrustOptions(cwd);
    this.options.emit({projectId,sessionId:'',type:'trust-request',payload:{id:requestId,trust:{cwd,parentPath:options.length>2?options[1].savedPath:undefined,saved:null,current:null,needsDecision:true}}});
    return promise;
  }
  async respondProjectTrust(requestId:string,choice:PiTrustChoice|null){
    if(choice!==null&&!['trust','parent','untrust'].includes(choice))throw new Error('Invalid trust choice.');
    const request=this.trustRequests.get(requestId);if(!request)return;
    const completion=this.trustPrompts.get(this.trustKey(request.cwd));request.resolve(choice);await completion;
  }
  private async writeProjectTrust(cwd:string,choice:PiTrustChoice){
    const native=await this.trustModule();const options=native.getProjectTrustOptions(cwd);
    const option=choice==='parent'?(options.length>2?options[1]:undefined):choice==='trust'?options[0]:choice==='untrust'?options.at(-1):undefined;
    if(!option)throw new Error('Invalid trust choice.');
    new native.ProjectTrustStore(this.agentDir).setMany(option.updates);
  }
  async saveProjectTrust(projectId:string,choice:PiTrustChoice,sessionId?:string):Promise<PiTrustSaveResponse>{
    if(this.changingTrust||this.changingRuntime)throw new Error('Wait for the current resource operation to finish.');
    const cwd=this.project(projectId).root;const scope=this.trustKey(choice==='parent'?dirname(cwd):cwd);
    if(sessionId){const current=this.runtimes.get(sessionId);if(current&&current.projectId!==projectId)throw new Error('Session does not belong to this project.');}
    const affected=[...this.runtimes.values()].filter(handle=>{const key=this.trustKey(handle.cwd);return key===scope||key.startsWith(scope.endsWith('\\')?scope:scope+'\\');});
    const restarted:PiTrustSaveResponse['restarted']=[];this.changingTrust=true;
    try{
    for(const handle of affected){
      if(handle.ui.size||!['idle','error'].includes(handle.status)||handle.isCompacting||handle.bash?.status==='running'||this.treeOperations.has(handle.sessionId)||this.resourceOperations.has(handle.sessionId))
        throw new Error('Wait for active project sessions to finish before changing trust.');
      const state=await handle.client.getState();if(handle.ui.size||state.isStreaming||state.isCompacting||!['idle','error'].includes(handle.status)||handle.bash)throw new Error('Wait for active project sessions to finish before changing trust.');
    }
    await this.writeProjectTrust(cwd,choice);
    for(const key of this.trustDecisions.keys())if(key===scope||key.startsWith(scope.endsWith('\\')?scope:scope+'\\'))this.trustDecisions.delete(key);
    for(const handle of affected){
      const previousId=handle.sessionId;const path=handle.sessionPath&&existsSync(handle.sessionPath)?handle.sessionPath:undefined;
      const state=await handle.client.getState();const retained=this.retainedQueue(handle.projectId,previousId);
      await this.disposeRuntime(previousId);
      const next=await this.startRuntime(handle.projectId,path?previousId:undefined,path,true);
      if(state.model&&state.model.provider!=='unknown'){
        const models=await next.client.getAvailableModels();
        if(models.some(model=>model.provider===state.model!.provider&&model.id===state.model!.id))await next.client.setModel(state.model.provider,state.model.id);
        else this.emit(next,'warning','The previous model is unavailable after changing project trust. Select a model to continue.');
      }
      await next.client.setThinkingLevel(state.thinkingLevel);
      await next.client.setAutoCompaction(state.autoCompactionEnabled);
      if(state.sessionName)await next.client.setSessionName(state.sessionName);
      if(previousId!==next.sessionId){this.retainedQueues.delete(this.queueKey(handle.projectId,previousId));this.retainedQueueRevisions.delete(this.queueKey(handle.projectId,previousId));}
      this.updateRetainedQueue(next,retained);
      if(this.selectedSessionId===previousId)this.selectedSessionId=next.sessionId;
      restarted.push({previousId,snapshot:await this.snapshot(next)});
    }
    const replacement=restarted.find(item=>item.previousId===sessionId);
    return {trust:await this.getProjectTrust(projectId,replacement?.snapshot.sessionId??sessionId),restarted};
    }finally{this.changingTrust=false;for(const item of restarted)this.emit(item.snapshot,'resources-changed');}
  }
  private async withResourceClient<T>(projectId:string,read:(client:RpcClient)=>Promise<T>):Promise<T>{
    const operation=(async()=>{
      const client=await this.createClient(this.project(projectId).root,undefined,true,projectId);
      const dispose=client.onEvent(event=>{const raw=event as unknown as Record<string,unknown>;if(raw.type==='extension_ui_request'&&['select','confirm','input','editor'].includes(String(raw.method))&&typeof raw.id==='string')void client.respondExtensionUI({id:raw.id,cancelled:true}).catch(()=>{});});
      try{await client.start();return await read(client);}finally{dispose();await client.stop();}
    })();
    this.resourceLoads.add(operation);
    try{return await operation;}finally{this.resourceLoads.delete(operation);}
  }
  async getCommands(projectId:string,sessionId?:string):Promise<PiSlashCommand[]>{
    if(sessionId){const handle=await this.ensureRuntime(projectId,sessionId);return handle.client.getCommands();}
    return this.withResourceClient(projectId,client=>client.getCommands());
  }
  private async validateQueue(handle:RuntimeHandle,texts:string[]){
    if(!texts.length)return;const commands=await handle.client.getCommands();
    for(const text of texts){const warning=piQueueWarning(text,commands);if(warning)throw new Error(warning);}
  }
  async reloadResources(projectId:string,sessionId:string){
    const handle=await this.ensureRuntime(projectId,sessionId);
    if(handle.ui.size)throw new Error('Answer the pending question before reloading.');
    if(!['idle','error'].includes(handle.status)||handle.isCompacting||handle.bash?.status==='running'||this.treeOperations.has(sessionId))
      throw new Error('Wait for the session to finish before reloading.');
    this.resourceOperations.add(sessionId);
    try{await handle.client.reloadResources();return await this.snapshot(handle);}
    finally{this.resourceOperations.delete(sessionId);this.emit(handle,'resources-changed');}
  }
  private async disposeRuntime(sessionId:string){
    const handle=this.runtimes.get(sessionId);if(!handle)return;
    handle.ui.clear();
    this.runtimes.delete(sessionId);handle.unsubscribe();await handle.client.stop().catch(()=>{});
  }
  private async disposeUnselectedIdleRuntimes(){
    await Promise.all([...this.runtimes.values()].filter(item=>item.sessionId!==this.selectedSessionId&&item.status==='idle'&&!item.ui.size&&!item.isCompacting&&!this.treeOperations.has(item.sessionId))
      .map(item=>this.disposeRuntime(item.sessionId)));
  }
  private async disposeIdleRuntimes(){
    await Promise.all([...this.runtimes.values()].filter(item=>(item.status==='idle'||item.status==='error')&&!item.ui.size&&!item.isCompacting&&!this.treeOperations.has(item.sessionId))
      .map(item=>this.disposeRuntime(item.sessionId)));
  }
  async dispose(){for(const request of this.cwdRequests.values())request.resolve(false);for(const request of this.trustRequests.values())request.resolve(null);this.trustRequests.clear();await Promise.all([...this.runtimes.keys()].map(id=>this.disposeRuntime(id)));await Promise.all([...this.clients].map(client=>client.stop().catch(()=>{})));}
}
