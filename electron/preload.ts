import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('revu',{
  invoke:(body:Record<string,unknown>)=>ipcRenderer.invoke('revu:invoke',body),
  onProjectChanged:(listener:(projectId:string)=>void)=>{
    const receive=(_event:Electron.IpcRendererEvent,projectId:string)=>listener(projectId);
    ipcRenderer.on('revu:project-changed',receive);
    return()=>ipcRenderer.removeListener('revu:project-changed',receive);
  },
});
