import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { diff } from '../server/git';
import { HttpError, Workspace } from '../server/workspace';

let mainWindow:BrowserWindow|null=null;
const workspace=new Workspace(projectId=>mainWindow?.webContents.send('revu:project-changed',projectId));

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
  if(body.action==='removeProject'){workspace.remove(body.projectId);await persistOpenFolders();return null;}
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

function createWindow(){
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
  mainWindow.on('closed',()=>{mainWindow=null;});
  const devUrl=process.env.REVU_DEV_URL;
  const loading=devUrl?mainWindow.loadURL(devUrl):mainWindow.loadFile(join(__dirname,'../dist/index.html'));
  void loading.then(()=>mainWindow?.show());
}

app.whenReady().then(async()=>{
  app.setAppUserModelId('com.revu.editor');
  Menu.setApplicationMenu(null);
  await restoreOpenFolders();
  createWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>workspace.dispose());
