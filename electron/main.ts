import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import { join } from 'node:path';
import { diff, merge } from '../server/git';
import { HttpError, Workspace } from '../server/workspace';

let mainWindow:BrowserWindow|null=null;
const workspace=new Workspace(projectId=>mainWindow?.webContents.send('revu:project-changed',projectId));

async function invoke(body:Record<string,any>){
  if(body.action==='projects')return [...workspace.projects.values()].map(project=>workspace.public(project));
  if(body.action==='pick'){
    if(!mainWindow)return null;
    const result=await dialog.showOpenDialog(mainWindow,{title:'Open Folder',properties:['openDirectory','createDirectory']});
    return result.canceled?null:workspace.add(result.filePaths[0]);
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
    case 'save':return workspace.save(project,body.path,body.expected,body.text,body.bom);
    case 'diff':{
      if(body.base!==project.base)throw new HttpError(409,'Review base changed');
      const base=await workspace.baseline(project,body.path);
      const [chunks,changes]=await Promise.all([diff(base.text,body.text),diff(body.previous,body.text)]);
      return {version:body.version,chunks,changes};
    }
    case 'merge':
      await workspace.path(project,body.path,true);
      return {...await merge(body.base,body.draft,body.external),version:body.version};
    default:throw new HttpError(400,'Unknown action');
  }
}

ipcMain.handle('revu:invoke',async(_event,body)=>{
  try{return {ok:true,value:await invoke(body)};}
  catch(error){return {ok:false,status:error instanceof HttpError?error.status:500,
    error:error instanceof Error?error.message:String(error)};}
});

function createWindow(){
  mainWindow=new BrowserWindow({
    width:1280,height:800,minWidth:720,minHeight:500,show:false,backgroundColor:'#ffffff',
    webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false},
  });
  mainWindow.once('ready-to-show',()=>mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  mainWindow.on('closed',()=>{mainWindow=null;});
  const devUrl=process.env.REVU_DEV_URL;
  if(devUrl)void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(join(__dirname,'../dist/index.html'));
}

app.whenReady().then(()=>{
  app.setAppUserModelId('com.revu.editor');
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>workspace.dispose());
