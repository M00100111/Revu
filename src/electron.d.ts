interface RevuResponse<T>{ok:boolean;value?:T;status?:number;error?:string}
interface Window{
  revu:{
    invoke<T>(body:Record<string,unknown>):Promise<RevuResponse<T>>;
    onProjectChanged(listener:(projectId:string)=>void):()=>void;
  };
}
