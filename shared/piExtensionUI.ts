import type {PiExtensionReply,PiExtensionRequest} from './piTypes';

export function extensionRequest(value:Record<string,unknown>):PiExtensionRequest|undefined{
  if(typeof value.id!=='string'||typeof value.title!=='string')return;
  const base={id:value.id,title:value.title,deadline:typeof value.deadline==='number'&&Number.isFinite(value.deadline)?value.deadline:undefined};
  const group=value.group as Partial<NonNullable<PiExtensionRequest['group']>>|undefined;
  if(group&&typeof group.id==='string'&&typeof group.index==='number'&&Number.isSafeInteger(group.index)&&group.index>=0&&
    typeof group.total==='number'&&Number.isSafeInteger(group.total)&&group.total>1&&group.index<group.total){
    Object.assign(base,{group:{id:group.id,index:group.index,total:group.total}});
  }
  if(value.method==='select'&&Array.isArray(value.options)&&value.options.every(item=>typeof item==='string'))return {...base,method:'select',options:[...value.options]};
  if(value.method==='confirm'&&typeof value.message==='string')return {...base,method:'confirm',message:value.message};
  if(value.method==='input')return {...base,method:'input',placeholder:typeof value.placeholder==='string'?value.placeholder:undefined};
  if(value.method==='editor')return {...base,method:'editor',prefill:typeof value.prefill==='string'?value.prefill:undefined};
}

/** Owns a single runtime's questions; the Pi process owns timeout and abort decisions. */
export class PiExtensionUI {
  private readonly pending=new Map<string,PiExtensionRequest>();
  private readonly responding=new Set<string>();
  constructor(private readonly send:(id:string,reply:PiExtensionReply)=>Promise<void>,private readonly changed:()=>void){}
  get requests(){return [...this.pending.values()];}
  get size(){return this.pending.size;}
  add(request:PiExtensionRequest){if(this.pending.has(request.id))return;this.pending.set(request.id,request);this.changed();}
  remove(id:string){if(this.pending.delete(id))this.changed();}
  clear(){if(!this.pending.size)return;this.pending.clear();this.changed();}
  async reply(id:string,reply:PiExtensionReply){
    const request=this.pending.get(id);if(!request)throw new Error('This question has already ended.');
    if(this.responding.has(id))throw new Error('This reply is already being submitted.');
    if(!reply||typeof reply!=='object'||!('cancelled' in reply&&reply.cancelled===true)&&!(request.method==='confirm'?'confirmed' in reply&&typeof reply.confirmed==='boolean':'value' in reply&&typeof reply.value==='string'))throw new Error('Invalid question reply.');
    if(request.deadline!==undefined&&Date.now()>=request.deadline){this.remove(id);await this.send(id,{cancelled:true});return;}
    const answer:PiExtensionReply='cancelled' in reply&&reply.cancelled===true?{cancelled:true}:request.method==='confirm'?{confirmed:(reply as {confirmed:boolean}).confirmed}:{value:(reply as {value:string}).value};
    this.responding.add(id);
    try{await this.send(id,answer);this.remove(id);}finally{this.responding.delete(id);}
  }
  async cancel(){await Promise.allSettled(this.requests.map(request=>this.reply(request.id,{cancelled:true})));this.clear();}
}
