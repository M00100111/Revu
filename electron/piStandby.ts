import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';

export interface StandbyProcess {
  child:ChildProcessWithoutNullStreams;
  ready:Promise<void>;
}

export function spawnStandby(command:string,args:string[],cwd:string):StandbyProcess {
  const child=spawn(command,[...args,'--revu-standby'],{cwd,windowsHide:true,stdio:'pipe'});
  const ready=new Promise<void>((resolve,reject)=>{
    let line='';
    const failed=()=>finish(new Error('Pi standby exited before it was ready.'));
    const received=(data:Buffer)=>{
      line+=data.toString();
      if(line.includes('\n'))finish(line.trim()==='revu-ready'?undefined:new Error('Unexpected Pi standby output.'));
    };
    function finish(error?:Error){
      clearTimeout(timeout);child.stdout.off('data',received);child.off('exit',failed);child.off('error',finish);
      if(error){child.kill();reject(error);}else resolve();
    }
    const timeout=setTimeout(()=>finish(new Error('Pi standby startup timed out.')),60000);
    child.stdout.on('data',received);child.once('exit',failed);child.once('error',finish);
  });
  return {child,ready};
}

interface StandbySlot {process?:StandbyProcess;ready:Promise<StandbyProcess|undefined>;claimed:boolean}
export class PiStandby {
  private enabled=false;
  private slot?:StandbySlot;
  private retry?:ReturnType<typeof setTimeout>;
  private delay=1000;
  private generation=0;
  constructor(private readonly launch:()=>Promise<StandbyProcess>){}

  enable(enabled:boolean){
    if(enabled===this.enabled)return;
    this.enabled=enabled;this.generation++;
    clearTimeout(this.retry);this.retry=undefined;this.delay=1000;
    this.slot?.process?.child.stdin.end();this.slot=undefined;
    if(enabled)this.fill();
  }
  private fill(){
    if(!this.enabled||this.slot||this.retry)return;
    const generation=this.generation;
    const slot:StandbySlot={claimed:false,ready:Promise.resolve(undefined)};
    this.slot=slot;
    const retry=()=>{
      if(this.slot!==slot)return;
      this.slot=undefined;
      this.retry=setTimeout(()=>{this.retry=undefined;this.fill();},this.delay);
      this.delay=Math.min(30000,this.delay*2);
    };
    slot.ready=this.launch().then(async process=>{
      slot.process=process;
      process.child.once('exit',retry);
      if(generation!==this.generation)process.child.stdin.end();
      await process.ready;
      if(generation!==this.generation)return undefined;
      this.delay=1000;
      return process;
    }).catch(()=>{slot.process?.child.stdin.end();retry();return undefined;});
  }
  async take(){
    const slot=this.slot;
    if(!slot||slot.claimed)return;
    slot.claimed=true;
    const process=await slot.ready;
    if(!process||slot!==this.slot)return;
    this.slot=undefined;this.fill();
    return process.child;
  }
}
