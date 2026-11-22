export interface CiteRange {startLine:number;startColumn:number;endLine:number;endColumn:number}
export interface SelectionSnapshot extends CiteRange {path:string;text:string;language:string;wholeLines?:boolean}
export interface DraftSelection extends SelectionSnapshot {offset:number}
export interface CiteTarget {path:string;directory?:boolean;line?:number;lastLine?:number}
export interface CiteRequest {projectId:string;path:string;directory?:boolean;selection?:SelectionSnapshot}
export interface CiteInput {text:string;deliveryId:string;selections:DraftSelection[]}
export const lastSelectedLine=(range:CiteRange)=>Math.max(range.startLine,range.endLine-(range.endColumn===1?1:0));
export const referenceText=(path:string,range?:CiteRange)=>`@${JSON.stringify(path)}`+(range?`#L${range.startLine}`+(lastSelectedLine(range)>range.startLine?`-L${lastSelectedLine(range)}`:''):'');
const slashPath=(path:string)=>path.replaceAll('\\','/');
const absolutePath=(path:string)=>/^(?:[a-z]:\/|\/)/i.test(path);
export function projectRelativePath(root:string,path:string){
  const base=slashPath(root).replace(/\/$/,''),value=slashPath(path);
  const windows=/^(?:[a-z]:|\/\/)/i.test(base);
  const left=windows?base.toLowerCase():base,right=windows?value.toLowerCase():value;
  if(left===right)return '';
  return right.startsWith(left+'/')?value.slice(base.length+1):undefined;
}
export function citePath(sourceRoot:string,chatRoot:string,request:CiteRequest){
  const local=slashPath(request.path),base=slashPath(sourceRoot).replace(/\/$/,''),full=local==='.'?base:base+'/'+local;
  const path=(sourceRoot===chatRoot?local:full).replace(/\/$/,'');
  return path+(request.directory?'/':'');
}
export function locateCitation<Project extends {root:string}>(path:string,chat:Project,projects:Project[]){
  const value=slashPath(path);
  if(!absolutePath(value))return {project:chat,path:value};
  for(const project of [...projects].sort((first,second)=>second.root.length-first.root.length)){
    const relative=projectRelativePath(project.root,value);if(relative!==undefined)return {project,path:relative};
  }
  return {project:undefined,path:value};
}
export function references(text:string){
  return Array.from(text.matchAll(/@(?:"((?:[^"\\\n]|\\.)+)"|“([^”\r\n]+)”)(?:#L([1-9]\d*)(?:-L([1-9]\d*))?)?/g)).flatMap(match=>{
    try{const path:string=match[2]??JSON.parse('"'+match[1]+'"');return [{offset:match.index,raw:match[0],path,directory:path.endsWith('/'),line:match[3]?Number(match[3]):undefined,lastLine:match[4]?Number(match[4]):match[3]?Number(match[3]):undefined}];}catch{return [];}
  });
}
export type CitationReference=ReturnType<typeof references>[number];
export const copyReference=(ref:CitationReference)=>'@'+JSON.stringify(ref.path)+(ref.line?'#L'+ref.line+(ref.lastLine!==ref.line?'-L'+ref.lastLine:''):'');
export function shiftSelections(before:string,after:string,items:DraftSelection[],editEnd?:number){
  if(before===after)return items;
  let prefix=0,suffix=0;const delta=after.length-before.length;
  if(editEnd===undefined)while(prefix<Math.min(before.length,after.length)&&before[prefix]===after[prefix])prefix++;
  const suffixLimit=Math.min(before.length,after.length-(editEnd??0));
  while(suffix<suffixLimit&&suffix<Math.min(before.length,after.length)-prefix&&before[before.length-1-suffix]===after[after.length-1-suffix])suffix++;
  while(prefix<Math.min(before.length,after.length)-suffix&&before[prefix]===after[prefix])prefix++;
  return items.flatMap(item=>{const size=referenceText(item.path,item).length;
    if(item.offset+size<=prefix)return [item];if(item.offset>=before.length-suffix)return [{...item,offset:item.offset+delta}];return [];
  }).filter(item=>after.startsWith(referenceText(item.path,item),item.offset));
}
const envelope='\u001eRevuInput/1:';
export function packInput(text:string,items:DraftSelection[]){
  if(!items.length&&!text.startsWith(envelope))return text;
  return envelope+JSON.stringify({deliveryId:crypto.randomUUID(),text,selections:items.filter(item=>text.startsWith(referenceText(item.path,item),item.offset)).sort((first,second)=>first.offset-second.offset)} satisfies CiteInput);
}
export function unpackInput(value:string):CiteInput|undefined{
  if(!value.startsWith(envelope))return;
  try{const item=JSON.parse(value.slice(envelope.length));if(typeof item.text==='string'&&typeof item.deliveryId==='string'&&Array.isArray(item.selections))return item;}catch{}
}
export const inputText=(value:string)=>unpackInput(value)?.text??value;
