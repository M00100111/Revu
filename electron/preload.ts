import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('revu',{
  invoke:(body:Record<string,unknown>)=>ipcRenderer.invoke('revu:invoke',body),
  contextMenu:(kind:'project'|'tab')=>ipcRenderer.invoke('revu:context-menu',kind),
  windowControl:(action:'minimize'|'maximize'|'close'|'isMaximized')=>ipcRenderer.invoke('revu:window-control',action),
  setDirty:(dirty:boolean)=>ipcRenderer.send('revu:dirty-state',dirty),
  onMaximized:(listener:(maximized:boolean)=>void)=>{
    const receive=(_event:Electron.IpcRendererEvent,maximized:boolean)=>listener(maximized);
    ipcRenderer.on('revu:maximized',receive);
    return()=>ipcRenderer.removeListener('revu:maximized',receive);
  },
  onProjectChanged:(listener:(projectId:string)=>void)=>{
    const receive=(_event:Electron.IpcRendererEvent,projectId:string)=>listener(projectId);
    ipcRenderer.on('revu:project-changed',receive);
    return()=>ipcRenderer.removeListener('revu:project-changed',receive);
  },
});
