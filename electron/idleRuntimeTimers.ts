const idleGraceMs=3*60_000;

export class IdleRuntimeTimers {
  private readonly timers=new Map<string,ReturnType<typeof setTimeout>>();

  cancel(id:string){
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
  }

  update(id:string,eligible:()=>boolean,expire:()=>void){
    if(!eligible()){this.cancel(id);return;}
    if(this.timers.has(id))return;
    this.timers.set(id,setTimeout(()=>{
      this.timers.delete(id);
      if(eligible())expire();
    },idleGraceMs));
  }
}
