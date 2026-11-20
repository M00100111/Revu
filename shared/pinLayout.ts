import type {Chunk,ReviewRecord} from './types';
import {pinPiece,type PinPiece,type PinTarget} from './codePins';
import {codeLineCount} from './codeSource';

interface LineRange {startLine:number;endLine:number}
export interface PinPlacement extends PinPiece, LineRange {
  line:number;lastLine:number;preview:string;chunkId?:string;
  oldRows?:{start:number;end:number};
}

function lineStarts(text:string){
  const starts=[0];for(let index=0;index<text.length;index++)if(text[index]==='\n')starts.push(index+1);
  return starts;
}

function lineAt(starts:number[],offset:number){
  let low=0,high=starts.length;
  while(low+1<high){const middle=Math.floor((low+high)/2);if(starts[middle]<=offset)low=middle;else high=middle;}
  return low+1;
}

export function locatePins(target:PinTarget,sourceText:string,editorText:string,items:(Chunk|ReviewRecord)[],oldSide:boolean,range:LineRange=target.reference):PinPlacement[]{
  const starts=lineStarts(sourceText),editorStarts=oldSide?lineStarts(editorText):starts;
  if(range.endLine>codeLineCount(sourceText,starts.length))return [];
  const changed=items.filter(item=>!('decision' in item)||item.decision==='accepted').sort((first,second)=>first.oldStart-second.oldStart);
  const covering=items.flatMap(item=>{
    if('decision' in item&&item.decision==='rejected'&&!oldSide)return [];
    const start=oldSide?item.oldStart:item.start,end=oldSide?item.oldEnd:item.end;
    return start<end?[{item,first:lineAt(starts,start),last:lineAt(starts,end-1)}]:[];
  }).sort((first,second)=>first.first-second.first);
  const breaks=new Set([range.startLine,range.endLine+1]);
  const splitAt=(line:number)=>{if(line>range.startLine&&line<=range.endLine)breaks.add(line);};
  for(const match of covering){splitAt(match.first);splitAt(match.last+1);}
  if(oldSide)for(const chunk of changed)if(chunk.oldStart===chunk.oldEnd)splitAt(lineAt(starts,chunk.oldStart));
  const boundaries=[...breaks].sort((first,second)=>first-second);
  const result:PinPlacement[]=[];
  for(let index=0;index+1<boundaries.length;index++){
    const startLine=boundaries[index],endLine=boundaries[index+1]-1;
    const start=starts[startLine-1],lastStart=starts[endLine-1];
    const preview=sourceText.slice(start,starts[startLine]??sourceText.length).replace(/\r?\n$/,'');
    const match=covering.find(entry=>entry.first<=startLine&&entry.last>=startLine);
    const piece=pinPiece(target,startLine,endLine);
    if(match){
      const line=oldSide?lineAt(editorStarts,match.item.start):startLine;
      result.push({...piece,line,lastLine:line,preview,chunkId:match.item.id,
        oldRows:oldSide?{start:startLine-match.first,end:endLine-match.first}:undefined});
    }else if(oldSide){
      const offset=changed.reduce((delta,chunk)=>chunk.oldEnd<=start?delta+(chunk.end-chunk.start)-(chunk.oldEnd-chunk.oldStart):delta,0);
      const end=starts[endLine]??sourceText.length;
      if(editorText.slice(start+offset,end+offset)!==sourceText.slice(start,end))continue;
      result.push({...piece,line:lineAt(editorStarts,start+offset),lastLine:lineAt(editorStarts,lastStart+offset),preview});
    }else result.push({...piece,line:startLine,lastLine:endLine,preview});
  }
  return result;
}
