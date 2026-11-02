interface RevuResponse<T>{ok:boolean;value?:T;status?:number;error?:string}
interface Window{
  revu:{
    invoke<T>(body:Record<string,unknown>):Promise<RevuResponse<T>>;
    contextMenu(kind:'project'|'tab'):Promise<'close'|'closeOthers'|'closeAll'|null>;
    windowControl(action:'minimize'|'maximize'|'close'|'isMaximized'):Promise<boolean>;
    setDirty(dirty:boolean):void;
    onMaximized(listener:(maximized:boolean)=>void):()=>void;
    onProjectChanged(listener:(projectId:string)=>void):()=>void;
  };
}
