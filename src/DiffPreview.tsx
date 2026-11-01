import { useMemo } from 'react';
import { inlineDiff, type InlineSegment } from '../shared/inlineDiff';

const content=(segments:InlineSegment[])=>segments.map((segment,index)=>segment.changed
  ? <mark key={index}>{segment.text}</mark>
  : <span key={index}>{segment.text}</span>);

export default function DiffPreview({oldText,newText,showBefore=true,showAfter=true,highlightChanges=true}:{
  oldText:string;newText:string;showBefore?:boolean;showAfter?:boolean;highlightChanges?:boolean;
}){
  const parts=useMemo(()=>inlineDiff(oldText,newText),[oldText,newText]);
  return <div className="diff-preview">
    {showBefore&&oldText&&<pre className="diff-before" aria-label="Before">
      {highlightChanges?content(parts.before):oldText}
    </pre>}
    {showAfter&&newText&&<pre className="diff-after" aria-label="After">
      {highlightChanges?content(parts.after):newText}
    </pre>}
  </div>;
}
