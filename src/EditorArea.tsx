import Editor from '@monaco-editor/react';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Chunk, ReviewRecord } from '../shared/types';
import { monaco, type OpenFile } from './editor';
import { reviewItems, ReviewActions, type ActionHandler } from './ReviewActions';

export default function EditorArea({file,dark,editorRef,tick,onAction,revealLine}:{
  file:OpenFile;dark:boolean;editorRef:MutableRefObject<monaco.editor.IStandaloneCodeEditor|null>;
  tick:number;onAction:ActionHandler;revealLine?:number;
}){
  const [editor,setEditor]=useState<monaco.editor.IStandaloneCodeEditor|null>(null);
  const [toolbars,setToolbars]=useState<{node:HTMLElement;item:Chunk|ReviewRecord}[]>([]);
  const actionRef=useRef(onAction); actionRef.current=onAction;
  useEffect(()=>()=>{editorRef.current=null;},[editorRef]);
  useEffect(()=>{
    if(!editor)return;
    const reveal=()=>{
      if(editor.getModel()===file.model&&revealLine){
        const line=Math.max(1,Math.min(revealLine,file.model.getLineCount()));
        editor.revealLineInCenter(line);editor.setPosition({lineNumber:line,column:1});
      }
    };
    const changed=editor.onDidChangeModel(reveal);reveal();
    return()=>changed.dispose();
  },[editor,file.id,revealLine]);
  useEffect(()=>{
    if(!editor)return;
    let zones:string[]=[];
    const decorations=editor.createDecorationsCollection();
    const render=()=>{
      const nextToolbars:{node:HTMLElement;item:Chunk|ReviewRecord}[]=[];
      editor.changeViewZones(accessor=>{
        zones.forEach(id=>accessor.removeZone(id));zones=[];
        if(editor.getModel()!==file.model){decorations.clear();return;}
        const marks:monaco.editor.IModelDeltaDecoration[]=[];
        const rows=(text:string)=>text?text.replace(/\r?\n$/,'').split('\n').length:0;
        for(const item of reviewItems(file)){
          const position=file.model.getPositionAt(item.start);
          const line=Math.max(1,Math.min(file.model.getLineCount(),position.lineNumber));
          const record='decision' in item?item:null;
          const node=document.createElement('div');node.className='inline-review '+(record?'reviewed':item.kind);
          const toolbar=document.createElement('div');node.append(toolbar);
          nextToolbars.push({node:toolbar,item});
          const old=document.createElement('pre');
          old.className='inline-deleted';old.textContent=item.oldText.replace(/\r?\n$/,'');
          if(item.oldText)node.append(old);
          if(record&&item.newText){
            const next=document.createElement('pre');next.className='inline-proposed';
            next.textContent=item.newText.replace(/\r?\n$/,'');node.append(next);
          }
          node.style.overflow='auto';
          const height=32+(rows(item.oldText)+(record?rows(item.newText):0))*20;
          const atEOF=item.start===file.model.getValueLength()&&position.column>1;
          zones.push(accessor.addZone({afterLineNumber:atEOF?line:line-1,
            heightInPx:Math.min(240,height),domNode:node,suppressMouseDown:false}));
          if(!record||record.decision==='accepted'){
            const end=file.model.getPositionAt(item.end);
            const endLine=item.end>item.start&&end.column===1?end.lineNumber-1:end.lineNumber;
            if(item.newText)marks.push({range:new monaco.Range(line,1,Math.max(line,endLine),1),options:{
              isWholeLine:true,className:record?'review-accepted-line':'review-added-line',linesDecorationsClassName:'review-gutter',
            }});
          }
        }
        decorations.set(marks);
      });
      setToolbars(nextToolbars);
    };
    render();
    const subscription=editor.onDidChangeModel(render);
    return ()=>{
      subscription.dispose();decorations.clear();
      editor.changeViewZones(accessor=>zones.forEach(id=>accessor.removeZone(id)));
    };
  },[editor,file.id,tick]);  return <><Editor path={file.model.uri.toString()} theme={dark?'revu-dark':'revu-light'}
    keepCurrentModel saveViewState
    onMount={instance=>{editorRef.current=instance;setEditor(instance);}}
    loading={<div className="editor-loading">Opening editor…</div>}
    options={{
      automaticLayout:true,fontFamily:"'Cascadia Code', Consolas, 'Courier New', monospace",
      fontSize:14,lineHeight:24,padding:{top:0,bottom:24},minimap:{enabled:false},
      scrollBeyondLastLine:false,smoothScrolling:true,renderLineHighlight:'line',
      overviewRulerLanes:0,hideCursorInOverviewRuler:true,lineNumbersMinChars:4,
      glyphMargin:false,folding:true,tabSize:2,stickyScroll:{enabled:false},
      wordWrap:file.model.getLanguageId()==='markdown'?'on':'off',
    }}/>
    {toolbars.map(({node,item})=>createPortal(
      <ReviewActions file={file} item={item} onAction={(...args)=>actionRef.current(...args)}
        navigationDisabled={toolbars.length<=1} onNavigate={direction=>{
          if(!editor)return;const items=reviewItems(file);const index=items.findIndex(entry=>entry.id===item.id);
          const target=items[(index+direction+items.length)%items.length];if(!target)return;
          const position=file.model.getPositionAt(target.start);editor.revealLineInCenter(position.lineNumber);
          editor.setPosition({lineNumber:position.lineNumber,column:1});editor.focus();
          for(const toolbar of toolbars)toolbar.node.parentElement?.classList.toggle('active',toolbar.item.id===target.id);
        }}/>,node,item.id))}
  </>;
}
