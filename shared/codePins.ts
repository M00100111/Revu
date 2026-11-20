import {isCodeEncoding,type CodeEncoding} from './codeSource';

export const CODE_PIN_TOOL='pin_code';

export interface CodeReference {
  href:string;path:string;startLine:number;endLine:number;hash:string;revision?:string;note?:string;
  encoding?:CodeEncoding;
}

export function codeReferenceLabel({path,startLine,endLine}:CodeReference){
  return `${path.split('/').at(-1)}:${startLine}${endLine===startLine?'':'-'+endLine}`;
}

export interface PinSource {projectId:string;sessionId:string;messageId:string;references:CodeReference[]}
export interface PinTarget {source:PinSource;reference:CodeReference}
export interface PinPiece extends PinTarget {id:string;startLine:number;endLine:number}
export interface PinSession {latest:string|null;source?:PinSource;hidden:ReadonlySet<string>;kept:PinPiece[]}

export function advancePins(previous:PinSession|undefined,latest?:PinSource):PinSession{
  const id=latest?.messageId??null;
  if(previous?.latest===id)return previous;
  return {latest:id,source:latest,hidden:new Set(),kept:previous?.kept??[]};
}

export function showPins(session:PinSession,source?:PinSource):PinSession{
  return {...session,source,hidden:new Set()};
}

export function pinPiece(target:PinTarget,startLine:number,endLine:number):PinPiece{
  return {...target,startLine,endLine,id:JSON.stringify([target.source.messageId,target.reference.href,startLine,endLine])};
}

export function changePin(session:PinSession,piece:PinPiece,action:'keep'|'hide'|'close'):PinSession{
  const kept=session.kept.filter(pin=>pin.id!==piece.id);
  return {...session,kept:action==='keep'?[...kept,piece]:kept,hidden:new Set([...session.hidden,piece.id])};
}

export function referencePath(value:string){
  const path=value.replaceAll('\\','/').replace(/^(?:\.\/)+/,'');
  if(!path||path.includes(':')||/[\x00-\x1f]/.test(path)||path.split('/').some(part=>!part||part==='.'||part==='..'||part.toLowerCase()==='.git'))
    throw new Error('Use a project-relative file path.');
  return path;
}

export function codeReferences(details:unknown):CodeReference[]{
  if(!details||typeof details!=='object'||!('references' in details)||!Array.isArray(details.references))return [];
  return details.references.filter((ref):ref is CodeReference=>{
    if(!ref||typeof ref.href!=='string'||!/^revu-code:[\w%-]+-\d+$/.test(ref.href)||typeof ref.path!=='string'
      ||typeof ref.hash!=='string'||!/^[a-f0-9]{64}$/.test(ref.hash)||!Number.isSafeInteger(ref.startLine)||!Number.isSafeInteger(ref.endLine)
      ||ref.startLine<1||ref.endLine<ref.startLine||(ref.revision!==undefined&&(typeof ref.revision!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(ref.revision)))
      ||(ref.note!==undefined&&typeof ref.note!=='string')||(ref.encoding!==undefined&&!isCodeEncoding(ref.encoding)))return false;
    try{return referencePath(ref.path)===ref.path;}catch{return false;}
  });
}
