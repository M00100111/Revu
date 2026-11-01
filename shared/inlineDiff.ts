export interface InlineSegment { text:string; changed:boolean }
export interface InlineDiff { before:InlineSegment[]; after:InlineSegment[] }

interface SourceLine { text:string; eol:string }

function lines(text:string):SourceLine[]{
  const result:SourceLine[]=[];
  const pattern=/([^\r\n]*)(\r\n|\n|$)/g;
  for(let match=pattern.exec(text);match&&match[0];match=pattern.exec(text)){
    result.push({text:match[1],eol:match[2]});
  }
  return result;
}

function exactLinePairs(before:SourceLine[],after:SourceLine[]){
  if(!before.length||!after.length||before.length*after.length>10_000)return [] as [number,number][];
  const width=after.length+1;
  const table=new Uint16Array((before.length+1)*width);
  for(let i=before.length-1;i>=0;i--){
    for(let j=after.length-1;j>=0;j--){
      table[i*width+j]=before[i].text===after[j].text
        ? table[(i+1)*width+j+1]+1
        : Math.max(table[(i+1)*width+j],table[i*width+j+1]);
    }
  }
  const result:[number,number][]=[];
  for(let i=0,j=0;i<before.length&&j<after.length;){
    if(before[i].text===after[j].text){result.push([i++,j++]);continue;}
    if(table[(i+1)*width+j]>=table[i*width+j+1])i++;else j++;
  }
  return result;
}

function linePairing(before:SourceLine[],after:SourceLine[]){
  const oldToNew=new Map<number,number>(),newToOld=new Map<number,number>();
  const anchors=[...exactLinePairs(before,after),[before.length,after.length] as [number,number]];
  let oldStart=0,newStart=0;
  for(const [oldAnchor,newAnchor] of anchors){
    const count=Math.min(oldAnchor-oldStart,newAnchor-newStart);
    for(let offset=0;offset<count;offset++){
      oldToNew.set(oldStart+offset,newStart+offset);newToOld.set(newStart+offset,oldStart+offset);
    }
    if(oldAnchor<before.length){oldToNew.set(oldAnchor,newAnchor);newToOld.set(newAnchor,oldAnchor);}
    oldStart=oldAnchor+1;newStart=newAnchor+1;
  }
  return {oldToNew,newToOld};
}

function changedCharacters(before:string,after:string){
  const oldChanged=Array(before.length).fill(true) as boolean[];
  const newChanged=Array(after.length).fill(true) as boolean[];
  if(!before.length||!after.length)return {oldChanged,newChanged};
  if(before.length*after.length>40_000){
    let prefix=0;
    while(prefix<before.length&&prefix<after.length&&before[prefix]===after[prefix])prefix++;
    let suffix=0;
    while(suffix<before.length-prefix&&suffix<after.length-prefix&&
      before[before.length-1-suffix]===after[after.length-1-suffix])suffix++;
    for(let i=0;i<prefix;i++){oldChanged[i]=false;newChanged[i]=false;}
    for(let i=0;i<suffix;i++){
      oldChanged[before.length-1-i]=false;newChanged[after.length-1-i]=false;
    }
    return {oldChanged,newChanged};
  }
  const width=after.length+1;
  const table=new Uint16Array((before.length+1)*width);
  for(let i=before.length-1;i>=0;i--){
    for(let j=after.length-1;j>=0;j--){
      table[i*width+j]=before[i]===after[j]
        ? table[(i+1)*width+j+1]+1
        : Math.max(table[(i+1)*width+j],table[i*width+j+1]);
    }
  }
  for(let i=0,j=0;i<before.length&&j<after.length;){
    if(before[i]===after[j]){oldChanged[i++]=false;newChanged[j++]=false;continue;}
    if(table[(i+1)*width+j]>=table[i*width+j+1])i++;else j++;
  }
  return {oldChanged,newChanged};
}

function append(result:InlineSegment[],text:string,changed:boolean){
  if(!text)return;
  const last=result[result.length-1];
  if(last?.changed===changed)last.text+=text;else result.push({text,changed});
}

function appendLine(result:InlineSegment[],line:SourceLine,flags:boolean[],eolChanged:boolean){
  let start=0;
  for(let index=1;index<=line.text.length;index++){
    if(index<line.text.length&&flags[index]===flags[start])continue;
    append(result,line.text.slice(start,index),flags[start]??false);start=index;
  }
  append(result,line.eol,eolChanged);
}

export function inlineDiff(beforeText:string,afterText:string):InlineDiff{
  const before=lines(beforeText),after=lines(afterText);
  const {oldToNew,newToOld}=linePairing(before,after);
  const characterChanges=new Map<string,{oldChanged:boolean[];newChanged:boolean[]}>();
  for(const [oldIndex,newIndex] of oldToNew){
    characterChanges.set(oldIndex+':'+newIndex,changedCharacters(before[oldIndex].text,after[newIndex].text));
  }
  const oldSegments:InlineSegment[]=[],newSegments:InlineSegment[]=[];
  before.forEach((line,index)=>{
    const paired=oldToNew.get(index);
    if(paired===undefined){appendLine(oldSegments,line,Array(line.text.length).fill(true),true);return;}
    const changes=characterChanges.get(index+':'+paired)!;
    appendLine(oldSegments,line,changes.oldChanged,line.eol!==after[paired].eol);
  });
  after.forEach((line,index)=>{
    const paired=newToOld.get(index);
    if(paired===undefined){appendLine(newSegments,line,Array(line.text.length).fill(true),true);return;}
    const changes=characterChanges.get(paired+':'+index)!;
    appendLine(newSegments,line,changes.newChanged,line.eol!==before[paired].eol);
  });
  return {before:oldSegments,after:newSegments};
}

export function changedRanges(segments:InlineSegment[]){
  const ranges:{start:number;end:number}[]=[];
  let offset=0;
  for(const segment of segments){
    const end=offset+segment.text.length;
    if(segment.changed&&end>offset)ranges.push({start:offset,end});
    offset=end;
  }
  return ranges;
}
