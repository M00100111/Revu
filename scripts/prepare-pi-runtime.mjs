import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const nodeVersion='22.19.0';
const nodeArchive=`node-v${nodeVersion}-win-x64.zip`;
const runtimeRoot=resolve('.pi-runtime');
const nodeDir=join(runtimeRoot,'node');
const piSourceRoot=resolve('node_modules','@earendil-works','pi-coding-agent');
const piAppDir=join(runtimeRoot,'app');

function replaceOnce(source,search,replacement,label){
  const first=source.indexOf(search);
  if(first<0||source.indexOf(search,first+search.length)>=0)throw new Error(`Could not apply the Pi ${label} patch for version 1.5.0.`);
  return source.slice(0,first)+replacement+source.slice(first+search.length);
}

async function preparePiApp(){
  const manifest=JSON.parse(await readFile(join(piSourceRoot,'package.json'),'utf8'));
  if(manifest.version!=='1.5.0')throw new Error(`Unsupported Pi version ${manifest.version}; Revu's RPC patch requires 1.5.0.`);
  await rm(piAppDir,{recursive:true,force:true});await mkdir(piAppDir,{recursive:true});
  await cp(join(piSourceRoot,'package.json'),join(piAppDir,'package.json'));
  await cp(join(piSourceRoot,'dist','bundle'),join(piAppDir,'bundle'),{recursive:true});
  const chunksDir=join(piAppDir,'bundle','chunks');const chunks=await readdir(chunksDir);
  let patched=false;
  for(const name of chunks.filter(value=>value.endsWith('.js'))){
    const path=join(chunksDir,name);let source=await readFile(path,'utf8');
    if(!source.includes('case"get_tree"')||!source.includes('async getTree()'))continue;
    source=replaceOnce(source,
      'async getTree(){let response=await this.send({type:"get_tree"});return this.getData(response)}async getLastAssistantText()',
      'async getTree(){let response=await this.send({type:"get_tree"});return this.getData(response)}async navigateTree(entryId,options={}){let response=await this.send({type:"navigate_tree",entryId,summarize:options.summarize??!1,customInstructions:options.customInstructions},6e5);return this.getData(response)}async setEntryLabel(entryId,label){await this.send({type:"set_label",entryId,label})}async abortBranchSummary(){await this.send({type:"abort_branch_summary"})}async getCacheWarmingInfo(){let response=await this.send({type:"get_cache_warming_info"});return this.getData(response)}async getContextProjection(){let response=await this.send({type:"get_context_projection"});return this.getData(response)}async reloadSettings(){await this.send({type:"reload_settings"})}async getLastAssistantText()',
      'RpcClient methods');
    source=replaceOnce(source,
      'async bash(command){let response=await this.send({type:"bash",command});return this.getData(response)}async abortBash()',
      'async bash(command,excludeFromContext=!1){let response=await this.send({type:"bash",command,excludeFromContext},6e5);return this.getData(response)}async abortBash()',
      'RpcClient Bash options');
    source=replaceOnce(source,
      'async compact(customInstructions){let response=await this.send({type:"compact",customInstructions});return this.getData(response)}',
      'async compact(customInstructions){let response=await this.send({type:"compact",customInstructions},6e5);return this.getData(response)}',
      'RpcClient compaction timeout');
    source=replaceOnce(source,'async send(command){let childProcess=', 'async send(command,timeoutMs=3e4){let childProcess=', 'RPC timeout parameter');
    source=replaceOnce(source,'},3e4);this.pendingRequests.set(id,', '},timeoutMs);this.pendingRequests.set(id,', 'RPC timeout usage');
    source=replaceOnce(source,
      'case"get_tree":{let sessionManager=session.sessionManager;return success(id,"get_tree",{tree:sessionManager.getTree(),leafId:sessionManager.getLeafId()})}case"get_last_assistant_text"',
      'case"get_tree":{let sessionManager=session.sessionManager;return success(id,"get_tree",{tree:sessionManager.getTree(),leafId:sessionManager.getLeafId()})}case"navigate_tree":{let result=await session.navigateTree(command.entryId,{summarize:command.summarize,customInstructions:command.customInstructions});return success(id,"navigate_tree",{editorText:result.editorText,cancelled:result.cancelled,aborted:result.aborted,summaryEntry:result.summaryEntry})}case"set_label":{let sessionManager=session.sessionManager;return sessionManager.appendLabelChange(command.entryId,command.label?.trim()||void 0),success(id,"set_label")}case"abort_branch_summary":return session.abortBranchSummary(),success(id,"abort_branch_summary");case"get_cache_warming_info":return success(id,"get_cache_warming_info",{mode:session.settingsManager.getCacheWarmingMode(),status:session.cacheWarmingStatus,cacheWaste:computeCacheWaste(session.sessionManager.getEntries(),session.modelRuntime)});case"get_context_projection":return success(id,"get_context_projection",session.sessionManager.buildSessionProjection());case"reload_settings":return await session.settingsManager.reload(),success(id,"reload_settings");case"get_last_assistant_text"',
      'RPC handlers');
    source=replaceOnce(source,
      'getCompactionEnabled(){return this.settings.compaction?.enabled??SETTINGS_DEFAULTS.compaction.enabled}setCompactionEnabled(enabled){this.globalSettings.compaction||(this.globalSettings.compaction={}),this.globalSettings.compaction.enabled=enabled,this.markModified("compaction","enabled"),this.save()}getCompactionTokenSetting',
      'getCompactionEnabled(){return this.settings.compaction?.enabled??SETTINGS_DEFAULTS.compaction.enabled}setCompactionEnabled(enabled){this.globalSettings.compaction||(this.globalSettings.compaction={}),this.globalSettings.compaction.enabled=enabled,this.markModified("compaction","enabled"),this.save()}getCompactionConfiguration(){let compaction=this.globalSettings.compaction??{};return{enabled:compaction.enabled??SETTINGS_DEFAULTS.compaction.enabled,reserveTokens:compaction.reserveTokens??DEFAULT_COMPACTION_TOKEN_SETTINGS.reserveTokens,keepRecentTokens:compaction.keepRecentTokens??DEFAULT_COMPACTION_TOKEN_SETTINGS.keepRecentTokens,modelOverrides:structuredClone(compaction.modelOverrides??{})}}setCompactionConfiguration(configuration){this.globalSettings.compaction={enabled:configuration.enabled,reserveTokens:configuration.reserveTokens,keepRecentTokens:configuration.keepRecentTokens,modelOverrides:structuredClone(configuration.modelOverrides??{})},this.markModified("compaction"),this.save()}getCompactionTokenSetting',
      'SettingsManager compaction configuration');
    await writeFile(path,source);patched=true;break;
  }
  if(!patched)throw new Error('Could not find Pi 1.5.0 RPC bundle chunk to patch.');
}

async function download(url){
  const response=await fetch(url);
  if(!response.ok)throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function prepareNode(){
  if(existsSync(join(nodeDir,'node.exe')))return;
  if(process.platform!=='win32')throw new Error('Revu currently packages Pi for Windows only.');
  const temporary=await mkdtemp(join(tmpdir(),'revu-pi-runtime-'));
  try{
    const base=`https://nodejs.org/dist/v${nodeVersion}`;
    const [archive,sums]=await Promise.all([download(`${base}/${nodeArchive}`),download(`${base}/SHASUMS256.txt`)]);
    const expected=sums.toString('utf8').split(/\r?\n/).find(line=>line.endsWith(`  ${nodeArchive}`))?.split(/\s+/)[0];
    const actual=createHash('sha256').update(archive).digest('hex');
    if(!expected||actual!==expected)throw new Error('Node runtime checksum verification failed.');
    const archivePath=join(temporary,nodeArchive);await writeFile(archivePath,archive);
    const extracted=spawnSync('tar',['-xf',archivePath,'-C',temporary],{stdio:'inherit'});
    if(extracted.status!==0)throw new Error('Failed to extract the Node runtime.');
    await mkdir(nodeDir,{recursive:true});
    await cp(join(temporary,basename(nodeArchive,'.zip'),'node.exe'),join(nodeDir,'node.exe'));
  }finally{await rm(temporary,{recursive:true,force:true});}
}

await prepareNode();
await preparePiApp();
console.log(`Prepared Node ${nodeVersion} and patched Pi 1.5.0 RPC runtime in ${runtimeRoot}`);
