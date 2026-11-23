import {app,BrowserWindow,ipcMain,Menu,Tray} from 'electron';
import {readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

export function attachSystemTray(main:BrowserWindow,icon:string){
  const preference=join(app.getPath('userData'),'close-to-tray.json');
  let tray:Tray|null=null;
  // Only windows visible before hiding (or requested while hidden) should return.
  let hidden:Map<BrowserWindow,boolean>|null=null;

  function open(){
    if(main.isDestroyed())return;
    if(main.isMinimized())main.restore();
    main.show();
    const panels=hidden;
    hidden=null;
    for(const [win,minimized] of panels??[]){
      if(win.isDestroyed())continue;
      win.showInactive();
      if(minimized)win.minimize();
    }
    main.focus();
  }
  function createIcon(){
    const next=new Tray(icon);
    try{
      next.setToolTip('Revu');
      next.setContextMenu(Menu.buildFromTemplate([
        {label:'Open Revu',click:open},
        {type:'separator'},
        {label:'Quit Revu',click:()=>app.quit()},
      ]));
      next.on('click',open);
      return next;
    }catch(error){next.destroy();throw error;}
  }
  try{
    if(JSON.parse(readFileSync(preference,'utf8'))===true)tray=createIcon();
  }catch(error){
    if((error as NodeJS.ErrnoException).code!=='ENOENT')console.warn('Failed to initialize system tray',error);
  }
  ipcMain.handle('revu:close-to-tray',(event,value?:boolean)=>{
    if(event.sender!==main.webContents||event.senderFrame!==main.webContents.mainFrame)throw new Error('Invalid settings request');
    if(value===undefined||value===Boolean(tray))return Boolean(tray);
    if(typeof value!=='boolean')throw new Error('Invalid tray preference');
    const next=value?createIcon():null;
    try{
      const temp=preference+'.'+process.pid+'.tmp';
      writeFileSync(temp,JSON.stringify(value));
      renameSync(temp,preference);
    }catch(error){next?.destroy();throw error;}
    if(hidden)open();
    tray?.destroy();tray=next;
    return value;
  });
  main.once('closed',()=>{
    ipcMain.removeHandler('revu:close-to-tray');
    tray?.destroy();tray=null;hidden=null;
  });
  return {
    hide(){
      if(!tray)return false;
      if(hidden)return true;
      hidden=new Map();
      for(const win of BrowserWindow.getAllWindows()){
        if(win===main||(!win.isVisible()&&!win.isMinimized()))continue;
        hidden.set(win,win.isMinimized());
        win.hide();
      }
      main.hide();
      return true;
    },
    deferFocus(win:BrowserWindow){
      if(!hidden)return false;
      if(win!==main&&!hidden.has(win))hidden.set(win,false);
      return true;
    },
    restoreIfHidden(){if(hidden)open();},
  };
}
