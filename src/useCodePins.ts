import {useCallback,useMemo,useRef,useState} from 'react';
import {advancePins,changePin,showPins,type PinPiece,type PinSession,type PinSource,type PinTarget} from '../shared/codePins';
import {locatePins,type PinPlacement} from '../shared/pinLayout';
import {codeLineCount} from '../shared/codeSource';
import type {OpenFile} from './editor';

const emptyPlacements:PinPlacement[]=[];
const emptyKept=new Set<string>();

export function placementsFor(file:OpenFile,target:PinTarget,snapshot=false,piece?:PinPiece){
  const {source,reference}=target;
  if(file.project.id!==source.projectId||file.path!==reference.path)return undefined;
  const encoding=reference.encoding??'utf-8';
  if(snapshot?(file.synced.encoding??'utf-8')!==encoding:encoding!=='utf-8')return undefined;
  const editorText=file.model.getValue();
  const items=file.computing||file.diffError?[]:[...file.chunks,...file.records];
  const range=piece??reference;
  const pending=(text:string)=>range.endLine<=codeLineCount(text)?emptyPlacements:undefined;
  if(snapshot||!reference.revision){
    if(file.synced.hash!==reference.hash||!file.draftExists||editorText!==file.synced.text)return undefined;
    if(file.computing)return pending(editorText);
    return locatePins(target,editorText,editorText,items,false,piece);
  }
  if(file.baselineHash!==reference.hash||!file.baselineExists||file.reason||file.diffError)return undefined;
  if(file.computing)return pending(file.baseline);
  return locatePins(target,file.baseline,editorText,items,true,piece);
}

export function useCodePins(documents:OpenFile[],snapshots:OpenFile[],tick:number){
  const [sessionId,setSessionId]=useState<string|null>(null);
  const sessionRef=useRef<string|null>(null);
  const [sessions,setSessions]=useState<Record<string,PinSession>>({});
  const current=sessionId?sessions[sessionId]:undefined;
  const requiredFiles=useMemo(()=>{
    const targets:PinTarget[]=[...(current?.kept??[])];
    const source=current?.source;
    if(source)for(const reference of source.references)targets.push({source,reference});
    return [...new Map(targets.filter(target=>target.reference.encoding!=='gb18030').map(({source,reference})=>{
      const id=source.projectId+'/'+reference.path;
      return [id,{id,projectId:source.projectId,path:reference.path}];
    })).values()];
  },[current?.source,current?.kept]);
  const selectSession=useCallback((id:string|null,latest?:PinSource)=>{
    sessionRef.current=id;setSessionId(id);
    if(id)setSessions(previous=>{
      const next=advancePins(previous[id],latest);
      return next===previous[id]?previous:{...previous,[id]:next};
    });
  },[]);
  const selectSource=useCallback((source:PinSource,hide:boolean)=>{
    setSessions(previous=>{
      const session=previous[source.sessionId];if(!session)return previous;
      return {...previous,[source.sessionId]:showPins(session,hide?undefined:source)};
    });
  },[]);
  const selectReference=useCallback(({source,reference}:PinTarget)=>{
    if(sessionRef.current!==source.sessionId)return false;
    setSessions(previous=>{
      const session=previous[source.sessionId];if(!session)return previous;
      const active=session.source?.messageId===source.messageId?session.source:undefined;
      if(!active)return {...previous,[source.sessionId]:showPins(session,{...source,references:[reference]})};
      const references=active.references.some(ref=>ref.href===reference.href)?active.references:[...active.references,reference];
      const prefix=JSON.stringify([source.messageId,reference.href]).slice(0,-1)+',';
      return {...previous,[source.sessionId]:{...session,source:{...source,references},hidden:new Set([...session.hidden].filter(id=>!id.startsWith(prefix)))}};
    });
    return true;
  },[]);
  const updatePiece=useCallback((piece:PinPiece,action:'keep'|'hide'|'close')=>{
    setSessions(previous=>{
      const id=piece.source.sessionId;const session=previous[id];if(!session)return previous;
      return {...previous,[id]:changePin(session,piece,action)};
    });
  },[]);
  return {
    selectSession,selectSource,selectReference,updatePiece,requiredFiles,
    ...useMemo(()=>{
      const byFile=new Map<string,PinPlacement[]>();
      const keptIds=current?new Set(current.kept.map(pin=>pin.id)):emptyKept;
      const locate=(target:PinTarget,piece?:PinPiece)=>{
        let resolved=false;let visible=false;
        for(const file of [...documents,...snapshots]){
          const placements=placementsFor(file,target,snapshots.includes(file),piece);
          if(!placements?.length)continue;
          resolved=true;
          for(const placement of placements){
            if(piece?(placement.id!==piece.id||placement.chunkId):current?.hidden.has(placement.id)||keptIds.has(placement.id))continue;
            const list=byFile.get(file.id)??[];list.push(placement);byFile.set(file.id,list);visible=true;
          }
        }
        return visible||(!resolved&&!piece);
      };
      for(const kept of current?.kept??[])locate(kept,kept);
      let visible=false;
      if(current?.source)for(const reference of current.source.references)if(locate({source:current.source,reference}))visible=true;
      return {byFile,keptIds,visiblePinSource:visible?current?.source?.messageId:undefined};
    },[current,documents,snapshots,tick]),
  };
}
