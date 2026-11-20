import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const nodeVersion='22.19.0';
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
  await cp(resolve('scripts','pi-launcher.mjs'),join(piAppDir,'revu-launcher.mjs'));
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
    source=replaceOnce(source,'async reloadSettings(){await this.send({type:"reload_settings"})}',
      'async reloadSettings(){await this.send({type:"reload_settings"})}async reloadResources(){await this.send({type:"reload_resources"},6e5)}', 'RpcClient resource reload');
    source=replaceOnce(source,'case"reload_settings":return await session.settingsManager.reload(),success(id,"reload_settings");',
      'case"reload_settings":return await session.settingsManager.reload(),success(id,"reload_settings");case"reload_resources":{if(session.isStreaming||session.isCompacting||session.isBashRunning)throw new Error("Wait for the session to finish before reloading.");await session.reload();return success(id,"reload_resources")}', 'RPC resource reload');
    source=replaceOnce(source,'output({type:"extension_ui_request",id,...request})',
      'output({type:"extension_ui_request",id,...request}),pendingExtensionRequests.delete(id),cleanup(),resolve15(defaultValue)', 'Unsupported extension dialogs');
    source=replaceOnce(source,'output({type:"extension_ui_request",id,method:"editor",title,prefill})',
      'output({type:"extension_ui_request",id,method:"editor",title,prefill}),pendingExtensionRequests.delete(id),resolve15(void 0)', 'Unsupported extension editor');
    source=replaceOnce(source,'spawn9("node",[cliPath,...args],{cwd:this.options.cwd,env:{...process.env,...this.options.env},stdio:["pipe","pipe","pipe"]})',
      'spawn9(this.options.launchCommand??"node",[...(this.options.launchArgs??[cliPath]),...args],{cwd:this.options.cwd,env:{...process.env,...this.options.env},windowsHide:!0,stdio:["pipe","pipe","pipe"]})','RPC process launcher');
    source=replaceOnce(source,'this.process=childProcess,childProcess.stderr', 'this.process=childProcess,this.options.bootstrap&&childProcess.stdin.write(this.options.bootstrap+"\\n"),childProcess.stderr','RPC bootstrap');
    source=replaceOnce(source,'this.process.kill("SIGTERM"),await new Promise','this.options.stopProcess&&await this.options.stopProcess(),this.process.kill("SIGTERM"),await new Promise','RPC process shutdown');
    source=replaceOnce(source,'getShellPath(){let shellPath=this.settings.shellPath;', 'getShellPath(){let shellPath=process.env.REVU_PI_SHELL_PATH??this.settings.shellPath;','Runtime shell override');
    source=replaceOnce(source,'sessionManager=await createSessionManager(parsed,cwd,sessionDir,startupSettingsManager),missingSessionCwdIssue=',
      'sessionManager=await createSessionManager(parsed,cwd,sessionDir,startupSettingsManager),revuSessionId=process.env.REVU_PI_SESSION_ID,revuInit=revuSessionId&&!sessionManager.getEntries().length?sessionManager.newSession({id:revuSessionId}):void 0,missingSessionCwdIssue=','Empty session identity');
    source=replaceOnce(source,'stream2.on("end",onEnd),()=>{stream2.off("data",onData)', 'stream2.on("end",onEnd),stream2.resume(),()=>{stream2.off("data",onData)','RPC bootstrap input resume');
    const trustImport=/import\{([^}]*\bProjectTrustStore\b[^}]*)\}from"([^"]+)"/.exec(source);
    if(!trustImport)throw new Error('Could not find Pi trust exports.');
    await writeFile(join(chunksDir,'revu-trust.js'),`export {ProjectTrustStore,getProjectTrustOptions,hasTrustRequiringProjectResources} from "${trustImport[2]}";\n`);
    await writeFile(path,source);patched=true;break;
  }
  if(!patched)throw new Error('Could not find Pi 1.5.0 RPC bundle chunk to patch.');
}

async function download(url){
  const response=await fetch(url);
  if(!response.ok)throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function prepareNode(platform='win-x64'){
  const archiveName=`node-v${nodeVersion}-${platform}.${platform==='win-x64'?'zip':'tar.gz'}`;
  const destination=platform==='win-x64'?nodeDir:join(runtimeRoot,'node-linux-x64');
  const executable=platform==='win-x64'?'node.exe':'node';
  if(existsSync(join(destination,executable)))return;
  if(process.platform!=='win32')throw new Error('Revu currently packages Pi for Windows only.');
  const temporary=await mkdtemp(join(tmpdir(),'revu-pi-runtime-'));
  try{
    const base=`https://nodejs.org/dist/v${nodeVersion}`;
    const [archive,sums]=await Promise.all([download(`${base}/${archiveName}`),download(`${base}/SHASUMS256.txt`)]);
    const expected=sums.toString('utf8').split(/\r?\n/).find(line=>line.endsWith(`  ${archiveName}`))?.split(/\s+/)[0];
    if(!expected||createHash('sha256').update(archive).digest('hex')!==expected)throw new Error('Node runtime checksum verification failed.');
    const archivePath=join(temporary,archiveName);await writeFile(archivePath,archive);
    const folder=`node-v${nodeVersion}-${platform}`;
    const member=platform==='win-x64'?`${folder}/node.exe`:`${folder}/bin/node`;
    const extracted=spawnSync('tar',['-xf',archivePath,'-C',temporary,member],{stdio:'inherit',windowsHide:true,timeout:120000});
    if(extracted.status!==0)throw new Error('Failed to extract the Node runtime.');
    await mkdir(destination,{recursive:true});await cp(join(temporary,...member.split('/')),join(destination,executable));
  }finally{await rm(temporary,{recursive:true,force:true});}
}

await preparePiApp();
await prepareNode();
await prepareNode('linux-x64');
console.log(`Prepared Node ${nodeVersion} and patched Pi 1.5.0 RPC runtime in ${runtimeRoot}`);
