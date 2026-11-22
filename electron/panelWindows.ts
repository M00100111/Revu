import {app,BrowserWindow,ipcMain,screen,type Display,type IpcMainInvokeEvent,type Rectangle} from 'electron';
import {readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {PanelControl,PanelWindow} from '../shared/panelWindows';

interface Placement {displayId:number;bounds:Rectangle}
interface OpenPanel {window:BrowserWindow;displayId:number;pendingBounds?:Rectangle}

const windows=new Map<PanelWindow,OpenPanel>();
const placements:Partial<Record<PanelWindow,Placement>>={};
const settingsPath=()=>join(app.getPath('userData'),'panel-windows.json');
const panelFromFrame=(name:string)=>name==='revu-chat'?'chat':name==='revu-review'?'review':undefined;

function validPlacement(saved:Partial<Placement>|null|undefined):saved is Placement{
  const bounds=saved?.bounds;
  return !!bounds&&Number.isInteger(saved.displayId)&&[bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isSafeInteger)
    &&bounds.width>0&&bounds.height>0;
}

function readPlacements(){
  try{
    const data=JSON.parse(readFileSync(settingsPath(),'utf8'));
    for(const panel of ['chat','review'] as const){
      if(validPlacement(data?.[panel]))placements[panel]=data[panel];
    }
  }catch(error){
    if((error as NodeJS.ErrnoException).code!=='ENOENT')console.warn('Failed to read panel window positions',error);
  }
}

function savePlacement(panel:PanelWindow,entry:OpenPanel){
  const bounds=entry.pendingBounds??entry.window.getNormalBounds();
  placements[panel]={bounds,displayId:screen.getDisplayMatching(bounds).id};
  const file=settingsPath();
  try{
    const temp=file+'.'+process.pid+'.tmp';
    writeFileSync(temp,JSON.stringify(placements),'utf8');
    renameSync(temp,file);
  }catch(error){console.warn('Failed to save panel window position',error);}
}

function windowOptions(panel:PanelWindow,main:BrowserWindow){
  const saved=placements[panel];
  const oldDisplay=saved&&screen.getAllDisplays().find(display=>display.id===saved.displayId);
  const {workArea}=oldDisplay??screen.getDisplayMatching(main.getBounds());
  const minWidth=Math.min(workArea.width,panel==='chat'?400:510);
  const minHeight=Math.min(workArea.height,360);
  const width=Math.min(workArea.width,Math.max(minWidth,saved?.bounds.width??(panel==='chat'?580:780)));
  const height=Math.min(workArea.height,Math.max(minHeight,saved?.bounds.height??760));
  const x=oldDisplay?saved!.bounds.x:workArea.x+Math.floor((workArea.width-width)/2);
  const y=oldDisplay?saved!.bounds.y:workArea.y+Math.floor((workArea.height-height)/2);
  return {width,height,minWidth,minHeight,
    x:Math.max(workArea.x,Math.min(x,workArea.x+workArea.width-width)),
    y:Math.max(workArea.y,Math.min(y,workArea.y+workArea.height-height)),
    title:panel==='chat'?'Chat · Revu':'Review · Revu',show:false,frame:false};
}

function restoreBounds(win:BrowserWindow,bounds:Rectangle){
  const requested={x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height};
  // At fractional Windows display scales Electron rounds the outer rectangle
  // both when writing and when reading it. Avoid growth on every detach.
  for(let attempt=0;attempt<4;attempt++){
    win.setBounds(requested);
    const actual=win.getBounds();
    if(actual.x===bounds.x&&actual.y===bounds.y&&actual.width===bounds.width&&actual.height===bounds.height)break;
    requested.x+=bounds.x-actual.x;requested.y+=bounds.y-actual.y;
    requested.width=Math.max(1,requested.width+bounds.width-actual.width);
    requested.height=Math.max(1,requested.height+bounds.height-actual.height);
  }
}

function bringForward(win:BrowserWindow){
  if(win.isMinimized())win.restore();
  win.show();win.focus();
}

function closePanel(panel:PanelWindow){
  const entry=windows.get(panel);
  if(!entry)return;
  windows.delete(panel);
  savePlacement(panel,entry);
  entry.window.destroy();
}

// Chat's DOM moves to the child but its IPC is still sent by the opener.
export function chatWindow(){
  return windows.get('chat')?.window;
}

export function attachPanelWindows(main:BrowserWindow){
  readPlacements();
  main.webContents.setWindowOpenHandler(({url,frameName})=>{
    const panel=panelFromFrame(frameName);
    if(url!=='about:blank'||!panel||windows.has(panel))return {action:'deny'};
    return {action:'allow',overrideBrowserWindowOptions:windowOptions(panel,main)};
  });
  main.webContents.on('did-create-window',(win,{frameName})=>{
    const panel=panelFromFrame(frameName);
    if(!panel)return;
    if(placements[panel])restoreBounds(win,windowOptions(panel,main));
    const entry:OpenPanel={window:win,displayId:screen.getDisplayMatching(win.getBounds()).id};
    windows.set(panel,entry);
    win.setMenu(null);
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',event=>event.preventDefault());
    win.on('move',()=>{if(!win.isMinimized())entry.displayId=screen.getDisplayMatching(win.getBounds()).id;});
    win.on('restore',()=>{
      if(!entry.pendingBounds)return;
      const bounds=entry.pendingBounds;entry.pendingBounds=undefined;
      movePanelToDisplay(win,bounds);
    });
    const maximized=()=>main.webContents.send('revu:panel-maximized',panel,win.isMaximized());
    win.on('maximize',maximized);win.on('unmaximize',maximized);
    win.on('close',event=>{
      event.preventDefault();
      main.webContents.send('revu:panel-merge-request',panel);
    });
    win.on('closed',()=>{
      if(windows.get(panel)!==entry)return;
      windows.delete(panel);
      if(!main.isDestroyed())main.webContents.send('revu:panel-merge-request',panel);
    });
  });
  const onDisplayRemoved=(_event:Electron.Event,display:Display)=>{
    for(const [panel,entry] of windows){
      if(entry.displayId!==display.id)continue;
      const bounds=entry.window.getNormalBounds();
      placements[panel]={bounds,displayId:display.id};
      const target=windowOptions(panel,main);
      if(entry.window.isMinimized())entry.pendingBounds=target;
      else movePanelToDisplay(entry.window,target);
      entry.displayId=screen.getDisplayMatching(main.getBounds()).id;
    }
  };
  screen.on('display-removed',onDisplayRemoved);
  const fromMain=(event:IpcMainInvokeEvent)=>event.sender===main.webContents&&event.senderFrame===main.webContents.mainFrame;
  ipcMain.handle('revu:panel-focus',(event,target:PanelWindow|'main')=>{
    if(!fromMain(event))return;
    const win=target==='main'?main:windows.get(target)?.window;
    if(win)bringForward(win);
  });
  ipcMain.handle('revu:panel-close',(event,panel:PanelWindow)=>{
    if(fromMain(event))closePanel(panel);
  });
  ipcMain.handle('revu:panel-control',(event,panel:PanelWindow,action:PanelControl)=>{
    const win=fromMain(event)&&windows.get(panel)?.window;
    if(!win)return false;
    if(action==='close'){win.close();return false;}
    if(action==='minimize')win.minimize();
    if(action==='maximize')win.isMaximized()?win.unmaximize():win.maximize();
    return win.isMaximized();
  });
  const closeAll=()=>{for(const panel of windows.keys())closePanel(panel);};
  main.on('closed',()=>{
    closeAll();
    screen.removeListener('display-removed',onDisplayRemoved);
    for(const channel of ['revu:panel-focus','revu:panel-close','revu:panel-control'])ipcMain.removeHandler(channel);
  });
  return closeAll;
}

function movePanelToDisplay(win:BrowserWindow,bounds:Rectangle){
  const maximized=win.isMaximized();
  if(maximized)win.unmaximize();
  restoreBounds(win,bounds);
  if(maximized)win.maximize();
}
