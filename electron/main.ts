import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { diff } from '../server/git';
import { HttpError, Workspace } from '../server/workspace';
import type { PiAgentRequest } from '../shared/piTypes';
import { PiManager } from './piManager';

let mainWindow:BrowserWindow|null=null;
let hasDirtyDrafts=false;
let closeApproved=false;
let confirmingClose=false;
let shutdownStarted=false;
const workspace=new Workspace(projectId=>mainWindow?.webContents.send('revu:project-changed',projectId));
let piManager:PiManager|null=null;

const openFoldersPath=()=>join(app.getPath('userData'),'open-folders.json');
async function persistOpenFolders(){
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
  if(body.action==='projects')return [...workspace.projects.values()].map(project=>workspace.public(project));
  if(body.action==='pick'){
    if(!mainWindow)return null;
    const result=await dialog.showOpenDialog(mainWindow,{title:'Open Folder',properties:['openDirectory','createDirectory']});
    if(result.canceled)return null;
    const project=await workspace.add(result.filePaths[0]);
    await persistOpenFolders();
    return project;
  }
  if(body.action==='removeProject'){
    await piManager?.closeProject(body.projectId);workspace.remove(body.projectId);await persistOpenFolders();return null;
  }
  const project=workspace.get(body.projectId);
  switch(body.action){
    case 'list':return workspace.list(project,body.path??'');
    case 'read':return workspace.read(project,body.path);
    case 'baseline':return {...await workspace.baseline(project,body.path),base:project.base};
    case 'status':return workspace.status(project);
    case 'refreshBase':
      project.base=project.repo?await workspace.head(project.repo):null;
      return workspace.public(project);
    case 'save':return workspace.save(project,body.path,body.expected,body.text,body.bom,body.exists);
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

async function invokeAgent(body:PiAgentRequest){
  if(!piManager)throw new Error('Pi Agent is not ready.');
  switch(body.action){
    case 'listSessions':return piManager.listSessions(body.projectId);
    case 'openSession':return piManager.openSession(body.projectId,body.sessionId);
    case 'newSession':return piManager.newSession(body.projectId);
    case 'renameSession':return piManager.renameSession(body.projectId,body.sessionId,body.name);
    case 'deleteSession':return piManager.deleteSession(body.projectId,body.sessionId);
    case 'closeProject':return piManager.closeProject(body.projectId);
    case 'prompt':return piManager.prompt(body.projectId,body.sessionId,body.text);
    case 'stop':return piManager.stop(body.projectId,body.sessionId);
    case 'compact':return piManager.compact(body.projectId,body.sessionId);
    case 'setAutoCompaction':return piManager.setAutoCompaction(body.projectId,body.sessionId,body.enabled);
    case 'listProviders':return piManager.listProviders();
    case 'saveApiKey':return piManager.saveApiKey(body.providerId,body.key);
    case 'removeApiKey':return piManager.removeApiKey(body.providerId);
    case 'listModels':return piManager.listModels(body.projectId,body.sessionId);
    case 'setModel':return piManager.setModel(body.projectId,body.sessionId,body.provider,body.modelId);
    case 'setThinkingLevel':return piManager.setThinkingLevel(body.projectId,body.sessionId,body.level);
    case 'getModelDefaults':return piManager.getModelDefaults(body.projectId);
    case 'saveModelDefaults':return piManager.saveModelDefaults(body.provider,body.modelId,body.thinkingLevel);
  }
}

ipcMain.handle('revu:agent',async(_event,body:PiAgentRequest)=>{
  try{return {ok:true,value:await invokeAgent(body)};}
  catch(error){return {ok:false,status:500,error:error instanceof Error?error.message:String(error)};}
});

ipcMain.handle('revu:context-menu',async(event,kind:'project'|'tab')=>{
  const window=BrowserWindow.fromWebContents(event.sender);
  if(!window)return null;
  return new Promise<string|null>(resolve=>{
    let selected:string|null=null;
    const item=(label:string,id:string):MenuItemConstructorOptions=>({label,click:()=>{selected=id;}});
    const template=kind==='project'
      ? [item('Close Folder','close')]
      : [item('Close','close'),item('Close Others','closeOthers'),item('Close All','closeAll')];
    Menu.buildFromTemplate(template).popup({window,callback:()=>resolve(selected)});
  });
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
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  mainWindow.webContents.on('before-input-event',(event,input)=>{
    if(input.type==='keyDown'&&input.key==='F12'){event.preventDefault();mainWindow?.webContents.toggleDevTools();}
  });
  const maximized=()=>mainWindow?.webContents.send('revu:maximized',mainWindow.isMaximized());
  mainWindow.on('maximize',maximized);mainWindow.on('unmaximize',maximized);
  mainWindow.on('close',event=>{
    if(closeApproved||!hasDirtyDrafts)return;
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
  mainWindow.on('closed',()=>{mainWindow=null;});
  const devUrl=process.env.REVU_DEV_URL;
  const loading=devUrl?mainWindow.loadURL(devUrl):mainWindow.loadFile(join(__dirname,'../dist/index.html'));
  void loading.then(()=>mainWindow?.show());
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
  await restoreOpenFolders();
  createWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{
  if(shutdownStarted)return;
  event.preventDefault();shutdownStarted=true;
  const stopping=piManager?.dispose()??Promise.resolve();
  void stopping.catch(error=>console.warn('Failed to stop Pi Agent',error)).finally(()=>{
    workspace.dispose();app.quit();
  });
});
