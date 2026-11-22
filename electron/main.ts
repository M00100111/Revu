import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell, type OpenDialogOptions, type SaveDialogOptions } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { diff } from '../server/git';
import { HttpError, Workspace } from '../server/workspace';
import {isCodeEncoding} from '../shared/codeSource';
import type { PiAgentRequest } from '../shared/piTypes';
import type { ChatFilePickerOptions } from '../shared/types';
import { PiManager } from './piManager';
import {attachPanelWindows,chatWindow} from './panelWindows';

let mainWindow:BrowserWindow|null=null;
let hasDirtyDrafts=false;
let closeApproved=false;
let confirmingClose=false;
let shutdownStarted=false;
const workspace=new Workspace(projectId=>mainWindow?.webContents.send('revu:project-changed',projectId));
let piManager:PiManager|null=null;

const openFoldersPath=()=>join(app.getPath('userData'),'open-folders.json');
const recentFoldersPath=()=>join(app.getPath('userData'),'recent-folders.json');
let recentFolders:string[]=[];
let historyWrite=Promise.resolve();
let windowShown=false;
let standbyEnabled=false;
function syncPiStandby(){
  const project=workspace.projects.values().next().value;
  const enabled=windowShown&&!shutdownStarted&&!!project;
  if(enabled===standbyEnabled)return;
  standbyEnabled=enabled;piManager?.enableStandby(enabled);
  if(enabled&&project)void piManager?.latestSession(project.id,true).catch(error=>console.warn('Recent chat preparation failed',error));
}
async function rememberFolder(root:string){
  recentFolders=[root,...recentFolders.filter(path=>path.toLowerCase()!==root.toLowerCase())].slice(0,10);
  historyWrite=historyWrite.then(()=>writeFile(recentFoldersPath(),JSON.stringify(recentFolders),'utf8'))
    .catch(error=>console.warn('Failed to remember recent folders',error));
  await historyWrite;
}
async function persistOpenFolders(){
  syncPiStandby();
  try{
    const roots=[...workspace.projects.values()].map(project=>project.root);
    await writeFile(openFoldersPath(),JSON.stringify(roots),'utf8');
  }catch(error){console.warn('Failed to remember open folders',error);}
}
async function restoreOpenFolders(){
  let roots:unknown;
  try{roots=JSON.parse(await readFile(openFoldersPath(),'utf8'));}
  catch(error){
    if((error as NodeJS.ErrnoException).code!=='ENOENT')console.warn('Failed to read open folders',error);
    return;
  }
  if(!Array.isArray(roots))return;
  for(const root of roots){
    if(typeof root!=='string')continue;
    try{await workspace.add(root);}
    catch(error){console.warn('Failed to restore folder',root,error);}
  }
  await persistOpenFolders();
}

async function invoke(body:Record<string,any>){
  if(body.action==='tabMenu'){
    const win=mainWindow;if(!win)return null;
    return new Promise<string|null>(resolve=>{
      const item=(id:string,label:string)=>({label,click:()=>resolve(id)});
      const menu=Menu.buildFromTemplate(body.scope==='file'
        ?[item('close','Close'),item('closeOthers','Close Others'),item('closeAll','Close All')]
        :[item('close','Close Tabs'),item('closeAll','Close All Tabs'),
          ...(body.scope==='project'?[{type:'separator' as const},item('folder','Close Folder')]:[])]);
      menu.popup({window:win,callback:()=>setImmediate(()=>resolve(null))});
    });
  }
  if(body.action==='recentFolders')return recentFolders;
  if(body.action==='openRecent'){
    if(!recentFolders.includes(body.root))throw new HttpError(400,'Folder is no longer in Recent Folders.');
    const existing=[...workspace.projects.values()].find(project=>project.root===body.root);
    const project=existing?workspace.public(existing):await workspace.add(body.root);
    await rememberFolder(project.root);await persistOpenFolders();return project;
  }
  if(body.action==='projects')return [...workspace.projects.values()].map(project=>workspace.public(project));
  if(body.action==='pick'){
    if(!mainWindow)return null;
    const result=await dialog.showOpenDialog(mainWindow,{title:'Open Folder',properties:['openDirectory','createDirectory']});
    if(result.canceled)return null;
    const project=await workspace.add(result.filePaths[0]);
    await rememberFolder(project.root);
    await persistOpenFolders();
    return project;
  }
  if(body.action==='removeProject'){
    await piManager?.closeProject(body.projectId);workspace.remove(body.projectId);await persistOpenFolders();return null;
  }
  const project=workspace.get(body.projectId);
  switch(body.action){
    case 'checkCitation':
    case 'revealExternalCitation':{
      const external=body.action==='revealExternalCitation';
      if(typeof body.path!=='string'||(external&&!isAbsolute(body.path)))throw new HttpError(400,'Invalid citation path.');
      const path=external?normalize(body.path):await workspace.path(project,body.path);
      const info=await stat(path);
      if(body.directory?!info.isDirectory():!info.isFile())throw new HttpError(404,'The cited file or folder no longer exists.');
      if(external){
        if(info.isDirectory()){const error=await shell.openPath(path);if(error)throw new Error(error);}
        else shell.showItemInFolder(path);
      }
      return null;
    }
    case 'list':return workspace.list(project,body.path??'');
    case 'chatPaths':return workspace.paths(project);
    case 'chatDirectory':return workspace.chatDirectory(project,body.prefix??'',body.searchProject===true);
    case 'read':return workspace.read(project,body.path);
    case 'baseline':return {...await workspace.baseline(project,body.path),base:project.base};
    case 'codeSnapshot':
      if(typeof body.hash!=='string'||!/^[a-f0-9]{64}$/.test(body.hash))throw new HttpError(400,'Invalid content hash');
      if(body.revision!==undefined&&(typeof body.revision!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(body.revision)))throw new HttpError(400,'Invalid commit ID');
      if(body.encoding!==undefined&&!isCodeEncoding(body.encoding))throw new HttpError(400,'Invalid code reference encoding');
      return workspace.codeSnapshot(project,body.path,body.hash,body.revision,body.encoding);
    case 'status':return workspace.status(project);
    case 'refreshBase':
      project.base=project.repo?await workspace.head(project.repo):null;
      return workspace.public(project);
    case 'save':return workspace.save(project,body.path,body.expected,body.text,body.bom,body.exists);
    case 'mixedPreview':return workspace.mixedPreview(project,body.path,body.key);
    case 'diff':{
      if(body.base!==project.base)throw new HttpError(409,'Review base changed');
      const base=await workspace.baseline(project,body.path);
      const [chunks,changes]=await Promise.all([diff(base.text,body.text),diff(body.previous,body.text)]);
      return {version:body.version,chunks,changes};
    }
    default:throw new HttpError(400,'Unknown action');
  }
}

ipcMain.handle('revu:invoke',async(_event,body)=>{
  try{return {ok:true,value:await invoke(body)};}
  catch(error){return {ok:false,status:error instanceof HttpError?error.status:500,
    error:error instanceof Error?error.message:String(error)};}
});

async function invokeAgent(body:PiAgentRequest,sourceWindow?:BrowserWindow|null){
  if(!piManager)throw new Error('Pi Agent is not ready.');
  switch(body.action){
    case 'getRuntimeCwd':return piManager.getRuntimeCwd(body.projectId);
    case 'getExtensionRequests':return piManager.getExtensionRequests();
    case 'respondExtensionUI':return piManager.respondExtensionUI(body.projectId,body.sessionId,body.requestId,body.reply);
    case 'chooseBashPath':{
      const owner=sourceWindow??mainWindow;if(!owner)throw new Error('The application window is unavailable.');
      const result=await dialog.showOpenDialog(owner,{title:'Choose Bash executable',properties:['openFile'],filters:[{name:'Executables',extensions:['exe']}]});
      return result.canceled?null:result.filePaths[0]??null;
    }
    case 'getRuntimeInfo':return piManager.getRuntimeInfo();
    case 'setRuntime':return piManager.setRuntime(body.config);
    case 'respondSessionCwd':return piManager.respondSessionCwd(body.requestId,body.accept);
    case 'getCommands':return piManager.getCommands(body.projectId,body.sessionId);
    case 'getProjectTrust':return piManager.getProjectTrust(body.projectId,body.sessionId);
    case 'saveProjectTrust':return piManager.saveProjectTrust(body.projectId,body.choice,body.sessionId);
    case 'respondProjectTrust':return piManager.respondProjectTrust(body.requestId,body.choice);
    case 'reloadResources':return piManager.reloadResources(body.projectId,body.sessionId);
    case 'listSessions':return piManager.listSessions(body.projectId,body.scope);
    case 'searchSessions':return piManager.searchSessions(body.projectId,body.query,body.sort,body.scope);
    case 'openSession':return piManager.openSession(body.projectId,body.sessionId);
    case 'getSessionSnapshot':return piManager.getSessionSnapshot(body.projectId,body.sessionId);
    case 'leaveSession':return piManager.leaveSession(body.sessionId);
    case 'retainSessionTabs':return piManager.retainSessionTabs(body.sessionIds);
    case 'openDiscoveredSession':{
      const session=await piManager.discoveredSession(body.projectId,body.sessionId);
      const project=await workspace.add(session.cwd);await rememberFolder(project.root);await persistOpenFolders();
      return {project,snapshot:await piManager.openSessionFile(project.id,session.id,session.path)};
    }
    case 'newSession':return piManager.newSession(body.projectId);
    case 'latestSession':return piManager.latestSession(body.projectId,false);
    case 'prepareNew':await piManager.prepareNew(body.projectId);return;
    case 'abandonNew':return piManager.abandonNew(body.projectId);
    case 'getSessionInfo':return piManager.getSessionInfo(body.projectId,body.sessionId);
    case 'chooseSessionFolder':{
      const options:OpenDialogOptions={title:'Select Session Folder',defaultPath:await piManager.getSessionDirectory(body.projectId),
        properties:['openDirectory','createDirectory']};
      const owner=chatWindow()??sourceWindow??mainWindow;
      const selected=owner?await dialog.showOpenDialog(owner,options):await dialog.showOpenDialog(options);
      if(selected.canceled||!selected.filePaths[0])return null;
      const confirmation={type:'question' as const,title:'Session Folder',message:'Copy existing sessions to the new folder?',
        detail:'Existing session files will remain in their current location.',buttons:['Cancel',"Don't Copy",'Copy'],cancelId:0,defaultId:2};
      const confirmationOwner=chatWindow()??sourceWindow??mainWindow;
      const choice=confirmationOwner?await dialog.showMessageBox(confirmationOwner,confirmation):await dialog.showMessageBox(confirmation);
      if(choice.response===0)return null;
      return piManager.setSessionFolder(body.projectId,selected.filePaths[0],choice.response===2);
    }
    case 'getEntries':return piManager.getEntries(body.projectId,body.sessionId,body.sinceEntryId);
    case 'getSessionTree':return piManager.getSessionTree(body.projectId,body.sessionId);
    case 'navigateSessionTree':return piManager.navigateSessionTree(body.projectId,body.sessionId,body.entryId,body.summarize,body.customInstructions);
    case 'abortSessionTreeNavigation':return piManager.abortSessionTreeNavigation(body.projectId,body.sessionId);
    case 'setSessionEntryLabel':return piManager.setSessionEntryLabel(body.projectId,body.sessionId,body.entryId,body.label);
    case 'forkSession':return piManager.forkSession(body.projectId,body.sessionId,body.entryId);
    case 'cloneSession':return piManager.cloneSession(body.projectId,body.sessionId);
    case 'releaseSession':return piManager.releaseSession(body.projectId,body.sessionId);
    case 'exportHtml':{
      const name=await piManager.sessionName(body.projectId,body.sessionId);
      const fileName=(name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,100)||'Conversation')+'.html';
      const options:SaveDialogOptions={
        title:'Export Conversation',defaultPath:join(workspace.get(body.projectId).root,fileName),
        filters:[{name:'HTML',extensions:['html']}],properties:['showOverwriteConfirmation'],
      };
      const owner=chatWindow()??sourceWindow??mainWindow;const result=owner?await dialog.showSaveDialog(owner,options):await dialog.showSaveDialog(options);
      if(result.canceled||!result.filePath)return null;
      return piManager.exportHtml(body.projectId,body.sessionId,result.filePath);
    }
    case 'renameSession':return piManager.renameSession(body.projectId,body.sessionId,body.name,body.scope);
    case 'deleteSession':return piManager.deleteSession(body.projectId,body.sessionId,body.scope);
    case 'closeProject':return piManager.closeProject(body.projectId);
    case 'prompt':return piManager.prompt(body.projectId,body.sessionId,body.text);
    case 'steer':return piManager.steer(body.projectId,body.sessionId,body.text);
    case 'followUp':return piManager.followUp(body.projectId,body.sessionId,body.text);
    case 'clearQueue':return piManager.clearQueue(body.projectId,body.sessionId);
    case 'withdrawInput':return piManager.withdrawInput(body.projectId,body.sessionId,body.kind,body.index,body.wire);
    case 'setRetainedQueue':return piManager.setRetainedQueue(body.projectId,body.sessionId,body.queue);
    case 'stop':return piManager.stop(body.projectId,body.sessionId);
    case 'bash':return piManager.bash(body.projectId,body.sessionId,body.command,body.excludeFromContext);
    case 'abortBash':return piManager.abortBash(body.projectId,body.sessionId);
    case 'abortRetry':return piManager.abortRetry(body.projectId,body.sessionId);
    case 'compact':return piManager.compact(body.projectId,body.sessionId,body.customInstructions);
    case 'getContextProjection':return piManager.getContextProjection(body.projectId,body.sessionId);
    case 'setAutoCompaction':return piManager.setAutoCompaction(body.projectId,body.sessionId,body.enabled);
    case 'listProviders':return piManager.listProviders();
    case 'saveApiKey':return piManager.saveApiKey(body.providerId,body.key);
    case 'removeApiKey':return piManager.removeApiKey(body.providerId);
    case 'listModels':return piManager.listModels(body.projectId,body.sessionId);
    case 'setModel':return piManager.setModel(body.projectId,body.sessionId,body.provider,body.modelId);
    case 'setThinkingLevel':return piManager.setThinkingLevel(body.projectId,body.sessionId,body.level);
    case 'getModelDefaults':return piManager.getModelDefaults(body.projectId);
    case 'saveModelDefaults':return piManager.saveModelDefaults(body.provider,body.modelId,body.thinkingLevel);
    case 'getCompactionConfiguration':return piManager.getCompactionConfiguration(body.projectId);
    case 'saveCompactionConfiguration':return piManager.saveCompactionConfiguration(body.configuration);
  }
}

ipcMain.handle('revu:agent',async(event,body:PiAgentRequest)=>{
  try{return {ok:true,value:await invokeAgent(body,BrowserWindow.fromWebContents(event.sender))};}
  catch(error){return {ok:false,status:500,error:error instanceof Error?error.message:String(error)};}
});

ipcMain.handle('revu:open-external',async(_event,value:unknown)=>{
  if(typeof value!=='string')return false;
  try{
    const url=new URL(value);if(!['http:','https:','mailto:'].includes(url.protocol))return false;
    await shell.openExternal(url.toString());return true;
  }catch{return false;}
});
ipcMain.handle('revu:copy-text',(_event,value:unknown)=>{
  if(typeof value!=='string')return false;
  try{clipboard.writeText(value);return true;}catch{return false;}
});
ipcMain.handle('revu:choose-chat-files',async(event,projectId:unknown,picker?:ChatFilePickerOptions)=>{
  if(typeof projectId!=='string')return [];
  const project=workspace.get(projectId);
  const options:OpenDialogOptions={title:'Choose Files',defaultPath:project.root,properties:['openFile','multiSelections']};
  if(picker&&'startDirectory' in picker){
    if(typeof picker.startDirectory!=='string'||!isAbsolute(picker.startDirectory)||!(await stat(picker.startDirectory)).isDirectory())throw new Error('Folder is unavailable.');
    options.defaultPath=normalize(picker.startDirectory);
  }else if(picker){
    if(typeof picker.path!=='string'||!isAbsolute(picker.path))throw new Error('Invalid replacement path.');
    options.title=picker.directory?'Replace Folder Reference':'Replace File Reference';
    options.defaultPath=dirname(normalize(picker.path));
    options.properties=[picker.directory?'openDirectory':'openFile'];
  }
  const owner=chatWindow()??BrowserWindow.fromWebContents(event.sender)??mainWindow;
  const result=owner?await dialog.showOpenDialog(owner,options):await dialog.showOpenDialog(options);
  return result.canceled?[]:result.filePaths;
});
ipcMain.handle('revu:save-chat-image',async(_event,mimeType:unknown,bytes:unknown)=>{
  if(typeof mimeType!=='string'||!(bytes instanceof Uint8Array))throw new Error('Invalid clipboard image.');
  const extensions:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp','image/bmp':'bmp'};
  const extension=extensions[mimeType];if(!extension)throw new Error('Unsupported clipboard image format.');
  const directory=join(app.getPath('temp'),'revu-chat');await mkdir(directory,{recursive:true});
  const path=join(directory,`clipboard-${randomUUID()}.${extension}`);await writeFile(path,bytes);return path;
});

ipcMain.handle('revu:window-control',(event,action:'minimize'|'maximize'|'close'|'isMaximized')=>{
  const window=BrowserWindow.fromWebContents(event.sender);
  if(!window)return false;
  if(action==='minimize')window.minimize();
  if(action==='maximize')window.isMaximized()?window.unmaximize():window.maximize();
  if(action==='close')window.close();
  return window.isMaximized();
});

ipcMain.on('revu:dirty-state',(event,dirty:boolean)=>{
  if(mainWindow?.webContents===event.sender)hasDirtyDrafts=!!dirty;
});

function createWindow(){
  hasDirtyDrafts=false;closeApproved=false;confirmingClose=false;
  mainWindow=new BrowserWindow({
    width:1280,height:800,minWidth:720,minHeight:500,show:false,backgroundColor:'#ffffff',
    frame:false,
    webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false},
  });
  const closePanelWindows=attachPanelWindows(mainWindow);
  mainWindow.webContents.on('before-input-event',(event,input)=>{
    if(input.type==='keyDown'&&input.key==='F12'){event.preventDefault();mainWindow?.webContents.toggleDevTools();}
  });
  const maximized=()=>mainWindow?.webContents.send('revu:maximized',mainWindow.isMaximized());
  mainWindow.on('maximize',maximized);mainWindow.on('unmaximize',maximized);
  mainWindow.on('close',event=>{
    if(closeApproved||!hasDirtyDrafts){closePanelWindows();return;}
    event.preventDefault();
    if(confirmingClose||!mainWindow)return;
    confirmingClose=true;
    void dialog.showMessageBox(mainWindow,{
      type:'warning',title:'Unsaved Changes',message:'There are unsaved files.',
      detail:'Discard the unsaved changes and close Revu?',
      buttons:['Cancel','Discard and Close'],defaultId:0,cancelId:0,noLink:true,
    }).then(result=>{
      confirmingClose=false;
      if(result.response!==1||!mainWindow)return;
      closeApproved=true;mainWindow.close();
    });
  });
  mainWindow.on('closed',()=>{mainWindow=null;windowShown=false;syncPiStandby();});
  const devUrl=process.env.REVU_DEV_URL;
  const loading=devUrl?mainWindow.loadURL(devUrl):mainWindow.loadFile(join(__dirname,'../dist/index.html'));
  void loading.then(()=>{
    mainWindow?.show();
    windowShown=true;syncPiStandby();
  });
}

app.whenReady().then(async()=>{
  app.setAppUserModelId('com.revu.editor');
  Menu.setApplicationMenu(null);
  piManager=new PiManager({
    resolveProject:projectId=>{
      const project=workspace.get(projectId);return {id:project.id,root:project.root};
    },
    emit:event=>mainWindow?.webContents.send('revu:agent-event',event),
  });
  await piManager.initialize();
  await restoreOpenFolders();
  try{
    const saved:unknown=JSON.parse(await readFile(recentFoldersPath(),'utf8'));
    if(Array.isArray(saved))recentFolders=saved.filter((path):path is string=>typeof path==='string').slice(0,10);
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')console.warn('Failed to read recent folders',error);}
  if(!recentFolders.length){
    for(const project of workspace.projects.values())await rememberFolder(project.root);
  }
  createWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{
  if(shutdownStarted)return;
  if(mainWindow){event.preventDefault();mainWindow.close();return;}
  event.preventDefault();shutdownStarted=true;
  piManager?.enableStandby(false);piManager?.abandonNew();
  const stopping=piManager?.dispose()??Promise.resolve();
  void stopping.catch(error=>console.warn('Failed to stop Pi Agent',error)).finally(()=>{
    workspace.dispose();app.quit();
  });
});
