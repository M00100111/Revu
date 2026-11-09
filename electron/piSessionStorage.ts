import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export function nativePiAgentDir(home=homedir()){return join(home,'.pi','agent');}
export function nativePiSessionsDir(home=homedir()){return join(nativePiAgentDir(home),'sessions');}
export function nativePiSessionDir(cwd:string,home=homedir()){
  const safe=`--${resolve(cwd).replace(/^[/\\]/,'').replace(/[/\\:]/g,'-')}--`;
  return join(nativePiSessionsDir(home),safe);
}

export interface PiSessionCopySource {path:string;parentSessionPath?:string}
export interface PiSessionCopyResult {copied:number;skipped:number}

const pathKey=(path:string)=>{
  const normalized=resolve(path).replace(/\\/g,'/');
  return process.platform==='win32'?normalized.toLocaleLowerCase():normalized;
};

function rewriteParentSession(content:string,parentSessionPath?:string){
  if(!parentSessionPath)return content;
  const newlineIndex=content.indexOf('\n');const firstEnd=newlineIndex<0?content.length:newlineIndex;
  const firstLine=content.slice(0,firstEnd).replace(/\r$/,'');
  let header:Record<string,unknown>;
  try{header=JSON.parse(firstLine) as Record<string,unknown>;}catch{return content;}
  if(header.type!=='session')return content;
  header.parentSession=parentSessionPath;
  if(newlineIndex<0)return JSON.stringify(header);
  const newline=content[firstEnd-1]==='\r'?'\r\n':'\n';
  return `${JSON.stringify(header)}${newline}${content.slice(newlineIndex+1)}`;
}

export async function copyPiSessions(sources:PiSessionCopySource[],targetDir:string):Promise<PiSessionCopyResult>{
  const target=resolve(targetDir);await mkdir(target,{recursive:true});
  const targets=new Map(sources.map(source=>[pathKey(source.path),join(target,basename(source.path))]));
  let copied=0;let skipped=0;
  for(const source of sources){
    const targetFile=targets.get(pathKey(source.path))!;
    if(pathKey(source.path)===pathKey(targetFile)){skipped++;continue;}
    const mappedParent=source.parentSessionPath?targets.get(pathKey(source.parentSessionPath)):undefined;
    const content=rewriteParentSession(await readFile(source.path,'utf8'),mappedParent);
    try{await writeFile(targetFile,content,{encoding:'utf8',flag:'wx'});copied++;}
    catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')skipped++;else throw error;}
  }
  return {copied,skipped};
}
