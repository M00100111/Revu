import {Fragment,useEffect,useMemo,useState} from 'react';
import {lastSelectedLine,type DraftSelection} from '../shared/citations';

interface Token {offset:number;type:string}
export type SnapshotTokenizer=(text:string,language:string)=>Promise<Token[][]>;

export function snapshotLines(snapshot:DraftSelection){
  const parts=snapshot.text.split(/(\r\n|\r|\n)/),lines:{text:string;eol:string}[]=[];
  for(let index=0;index<parts.length;index+=2){
    if(index>0&&index===parts.length-1&&!parts[index])break;
    lines.push({text:parts[index],eol:parts[index+1]??''});
  }
  let indent:string|undefined;
  if(snapshot.wholeLines??(snapshot.startColumn===1&&snapshot.endColumn===1&&snapshot.endLine>snapshot.startLine)){
    for(const line of lines){
      if(!line.text.trim())continue;
      const prefix=/^[\t ]*/.exec(line.text)![0];
      if(indent===undefined)indent=prefix;
      else{let count=0;while(count<indent.length&&indent[count]===prefix[count])count++;indent=indent.slice(0,count);}
      if(!indent)break;
    }
  }
  return {lines,indent:indent??''};
}

export function CitationCode({snapshot,tokenize}:{snapshot:DraftSelection;tokenize?:SnapshotTokenizer}){
  const {lines,indent}=useMemo(()=>snapshotLines(snapshot),[snapshot]);
  const [syntax,setSyntax]=useState<{source:DraftSelection;lines:Token[][]}>();
  useEffect(()=>{
    let active=true;
    if(tokenize)void tokenize(snapshot.text,snapshot.language).then(lines=>{if(active)setSyntax({source:snapshot,lines});}).catch(()=>{});
    return ()=>{active=false;};
  },[snapshot,tokenize]);
  const last=lastSelectedLine(snapshot);
  return <><header className="citation-caption" title={snapshot.path}>{snapshot.path.split(/[\\/]/).at(-1)} · {snapshot.startLine}{last!==snapshot.startLine?'–'+last:''}</header>
    <div className="citation-listing"><div className="citation-line-numbers" aria-hidden="true">
      {lines.map((_,index)=><span key={index} data-line={snapshot.startLine+index}/>)}
    </div><pre><code>{lines.map(({text,eol},index)=>{
      const hidden=indent&&text.startsWith(indent)?indent:'';
      const tokens=syntax?.source===snapshot?syntax.lines[index]:undefined;
      return <Fragment key={index}>{hidden&&<span className="citation-indent">{hidden}</span>}{tokens?.length?tokens.map((token,position)=>{
        const end=tokens[position+1]?.offset??text.length;if(end<=hidden.length)return null;
        return <span key={position} data-token={token.type.split('.')[0]}>{text.slice(Math.max(token.offset,hidden.length),end)}</span>;
      }):text.slice(hidden.length)}{eol}</Fragment>;
    })}</code></pre></div></>;
}
