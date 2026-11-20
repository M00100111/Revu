import type { PiSessionEntry,PiSlashCommand } from './piTypes';

export const PI_BUILTIN_COMMANDS:PiSlashCommand[]=[
  ['settings','Open Chat settings'],['model','Select model'],['thinking','Select thinking level'],['scoped-models','Open model selector'],
  ['new','Start a new chat'],['resume','Open Sessions'],['name','Rename session'],['session','Show session information'],
  ['tree','Navigate session tree'],['fork','Fork from a user message'],['clone','Clone current session'],['compact','Open context controls'],
  ['copy','Copy last assistant message'],['trust','Manage project trust'],['reload','Reload Pi resources'],
  ['export','Export session'],['import','Import session'],['share','Share session'],['bug','Report a Pi bug'],
  ['changelog','Show changelog'],['hotkeys','Show keyboard shortcuts'],['login','Configure provider authentication'],
  ['logout','Remove provider authentication'],['quit','Quit'],
].map(([name,description])=>({name,description,source:'builtin'}));

export const UNSUPPORTED_PI_COMMANDS=new Set(['export','import','share','bug','changelog','hotkeys','login','logout','quit']);
export function parsePiCommand(text:string){
  const match=/^\/([^\s]+)(?: ([\s\S]*))?$/.exec(text);
  return match?{name:match[1],args:match[2]??''}:null;
}
export function piCommandAt(text:string,caret:number){
  const match=/^\/([^\s/]*)$/.exec(text.slice(0,caret));
  const end=text.search(/\s/);
  return match?{end:end<0?text.length:end,query:match[1]}:null;
}
export function mergePiCommands(commands:PiSlashCommand[]){
  const result=[...PI_BUILTIN_COMMANDS];const names=new Set(result.map(item=>item.name));
  for(const command of commands)if(!names.has(command.name)){result.push(command);names.add(command.name);}
  return result;
}
export function piQueueWarning(text:string,commands:PiSlashCommand[]):string|undefined{
  const value=text.trim();if(value.startsWith('!'))return 'Bash commands cannot be queued.';
  const command=parsePiCommand(value);if(!command)return;
  if(PI_BUILTIN_COMMANDS.some(item=>item.name===command.name))return 'Built-in commands cannot be queued.';
  if(commands.some(item=>item.name===command.name&&item.source==='extension'))return 'Extension commands cannot be queued.';
}
export function activePiBranch(entries:PiSessionEntry[],leafId:string|null){
  const byId=new Map(entries.map(entry=>[entry.id,entry]));const result:PiSessionEntry[]=[];const seen=new Set<string>();
  let id=leafId;while(id&&!seen.has(id)){seen.add(id);const entry=byId.get(id);if(!entry)break;result.push(entry);id=entry.parentId;}
  return result.reverse();
}
