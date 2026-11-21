import type {ToolState} from './AgentChat';

type Fields=Record<string,unknown>;
const fields=(value:unknown):Fields=>value&&typeof value==='object'?value as Fields:{};
const list=(value:unknown):Fields[]=>Array.isArray(value)?value.map(fields):[];
const string=(value:unknown)=>typeof value==='string'?value:'';
const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:0;
const textContent=(content:unknown)=>typeof content==='string'?content:list(content).filter(block=>block.type==='text').map(block=>string(block.text)).join('\n');
type Call={kind:'call';text:string;result?:string;isError?:boolean};
type Activity=Call|{kind:'text';text:string};

function transcript(messages:unknown,finished:boolean){
  const history=list(messages);
  const items:Activity[]=[];
  const calls=new Map<string,Call>();
  let output='';
  for(const message of history){
    if(message.role==='toolResult'){
      const id=string(message.toolCallId),call=calls.get(id);
      if(call){
        call.result=textContent(message.content)||(list(message.content).some(block=>block.type==='image')?'(image)':'(no output)');
        call.isError=message.isError===true;
      }
      continue;
    }
    if(message.role!=='assistant')continue;
    const blocks=list(message.content);
    if(message===history.at(-1)&&(finished||message.stopReason==='stop')&&!blocks.some(block=>block.type==='toolCall')){
      output=textContent(message.content);
      continue;
    }
    for(const block of blocks){
      if(block.type==='text'&&block.text)items.push({kind:'text',text:string(block.text)});
      if(block.type==='toolCall'){
        const args=fields(block.arguments);
        const label=block.name==='bash'&&typeof args.command==='string'?`$ ${args.command}`
          :[string(block.name),string(args.path)||string(args.pattern)||JSON.stringify(args)].filter(Boolean).join(' ');
        const call:Call={kind:'call',text:label};
        items.push(call);
        if(typeof block.id==='string')calls.set(block.id,call);
      }
    }
  }
  return {items,output};
}

const tokens=new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1});
function usageOf(value:unknown){
  const usage=fields(value);
  return {turns:number(usage.turns),input:number(usage.input),output:number(usage.output),cacheRead:number(usage.cacheRead),cacheWrite:number(usage.cacheWrite),cost:number(usage.cost)};
}
function usageLabel(usage:ReturnType<typeof usageOf>){
  return [usage.turns&&`${usage.turns} turn${usage.turns===1?'':'s'}`,usage.input&&'↑'+tokens.format(usage.input),usage.output&&'↓'+tokens.format(usage.output),
    usage.cacheRead&&'R'+tokens.format(usage.cacheRead),usage.cacheWrite&&'W'+tokens.format(usage.cacheWrite),usage.cost&&'$'+usage.cost.toFixed(4)].filter(Boolean).join(' · ');
}

export function subagentView(tool:Pick<ToolState,'args'|'result'|'status'>){
  const args=fields(tool.args),result=fields(tool.result),details=fields(result.details);
  const mode=details.mode??(Array.isArray(args.chain)?'chain':Array.isArray(args.tasks)?'parallel':'single');
  const inputs=mode==='chain'?list(args.chain):mode==='parallel'?list(args.tasks):args.agent?[args]:[];
  const results=list(details.results),total=usageOf(null);
  const tasks=Array.from({length:Math.max(inputs.length,results.length)},(_,index)=>{
    const input=inputs[index],child=results[index];
    const status=!child?(tool.status!=='running'?'not run':mode==='chain'&&index>0?'waiting':'pending')
      :child.stopReason==='aborted'?'aborted':child.stopReason==='error'||(typeof child.exitCode==='number'&&child.exitCode!==0&&child.exitCode!==-1)?'failed'
      :tool.status==='running'&&(mode==='single'||(mode==='chain'&&index===results.length-1)||child.exitCode===-1)?'running':'done';
    const {items,output}=transcript(child?.messages,status==='done'||status==='failed'||status==='aborted');
    const usage=usageOf(child?.usage);
    for(const key of Object.keys(total) as (keyof typeof total)[])total[key]+=usage[key];
    const diagnostic=status==='failed'||status==='aborted'?string(child?.errorMessage)||string(child?.stderr):'';
    const preview=diagnostic||output||items.at(-1)?.text||'';
    const context=number(fields(child?.usage).contextTokens);
    return {agent:string(child?.agent)||string(input?.agent)||'Agent',task:string(child?.task)||string(input?.task),items,output,status,diagnostic,preview,
      usage:[usageLabel(usage),context&&'ctx:'+tokens.format(context),string(child?.model)].filter(Boolean).join(' · ')};
  });
  const notice=!results.length&&tool.status!=='running'?textContent(result.content)||'No execution record.':'';
  const cancelled=tasks.some(task=>task.status==='aborted')||/^(?:cancell?ed:|subagent was aborted\b|operation aborted\b|tool execution (?:was )?aborted\b)/i.test(notice);
  const status=tool.status==='running'?'running':cancelled?'cancelled':
    tool.status==='error'||notice||tasks.some(task=>task.status!=='done')?'failed':'done';
  const firstBlock=fields(Array.isArray(result.content)?result.content[0]:undefined);
  const resultText=tool.status!=='running'&&firstBlock.type==='text'&&typeof firstBlock.text==='string'?firstBlock.text:undefined;
  return {mode:String(mode),tasks,total:usageLabel(total),completed:tasks.filter(task=>task.status==='done').length,status,notice,resultText};
}
