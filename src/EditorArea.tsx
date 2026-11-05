import Editor from '@monaco-editor/react';
import { createPortal } from 'react-dom';
import { Fragment, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Chunk, ReviewRecord } from '../shared/types';
import { changedRanges, inlineDiff } from '../shared/inlineDiff';
import { monaco, type OpenFile } from './editor';
import { reviewItems, ReviewActions, type ActionHandler } from './ReviewActions';
import DiffPreview from './DiffPreview';

export default function EditorArea({file,dark,editorRef,tick,onAction,onReviewReveal,expandedRecords,onToggleReviewPreview,revealLine,fontFamily,fontSize}:{
  file:OpenFile;dark:boolean;editorRef:MutableRefObject<monaco.editor.IStandaloneCodeEditor|null>;
  tick:number;onAction:ActionHandler;onReviewReveal:(itemId:string)=>void;
  expandedRecords:ReadonlySet<string>;onToggleReviewPreview:(itemId:string)=>void;
  revealLine?:number;fontFamily:string;fontSize:number;
}){
  const [editor,setEditor]=useState<monaco.editor.IStandaloneCodeEditor|null>(null);
  const [portals,setPortals]=useState<{toolbarNode:HTMLElement;previewNode?:HTMLElement;item:Chunk|ReviewRecord}[]>([]);
  const actionRef=useRef(onAction); actionRef.current=onAction;
  const editorLineHeight=Math.round(fontSize*12/7);
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
    let toolbarNodes:HTMLElement[]=[];
    const decorations=editor.createDecorationsCollection();
    const selectionDecorations=editor.createDecorationsCollection();
    const renderSelection=()=>{
      if(editor.getModel()!==file.model){selectionDecorations.clear();return;}
      selectionDecorations.set((editor.getSelections()??[]).filter(selection=>!selection.isEmpty()).map(range=>({
        range,options:{inlineClassName:'review-selected-text'},
      })));
    };
    const layoutToolbars=()=>{
      const width=editor.getLayoutInfo().contentWidth;
      const offset=editor.getScrollLeft();
      for(const toolbar of toolbarNodes){
        toolbar.style.width=width+'px';
        toolbar.style.transform=`translateX(${offset}px)`;
      }
    };
    const render=()=>{
      const nextPortals:{toolbarNode:HTMLElement;previewNode?:HTMLElement;item:Chunk|ReviewRecord}[]=[];
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
          const toolbar=document.createElement('div');toolbar.className='inline-review-toolbar';node.append(toolbar);
          const expanded=!!record&&expandedRecords.has(record.id);
          const showPreview=record?expanded:!!item.oldText;
          let preview:HTMLElement|undefined;
          let previewHeight=0;
          if(showPreview){
            preview=document.createElement('div');preview.className='inline-review-preview';
            preview.addEventListener('mousedown',event=>event.stopPropagation());
            preview.addEventListener('pointerdown',event=>event.stopPropagation());
            const previewRows=rows(item.oldText)+(record?rows(item.newText):0);
            previewHeight=previewRows*editorLineHeight;
            preview.style.height=previewHeight+'px';node.append(preview);
          }
          nextPortals.push({toolbarNode:toolbar,previewNode:preview,item});
          node.style.overflow='hidden';
          const height=32+previewHeight;
          const atEOF=item.start===file.model.getValueLength()&&position.column>1;
          zones.push(accessor.addZone({afterLineNumber:atEOF?line:line-1,
            heightInPx:height,domNode:node,suppressMouseDown:false}));
          if(record){
            if(item.end>item.start){
              const end=file.model.getPositionAt(item.end);
              const endLine=end.column===1?end.lineNumber-1:end.lineNumber;
              marks.push({range:new monaco.Range(line,1,Math.max(line,endLine),1),options:{
                isWholeLine:true,className:'review-reviewed-line',linesDecorationsClassName:'review-reviewed-gutter',
              }});
            }
          }else if(item.newText){
            const end=file.model.getPositionAt(item.end);
            const endLine=item.end>item.start&&end.column===1?end.lineNumber-1:end.lineNumber;
            marks.push({range:new monaco.Range(line,1,Math.max(line,endLine),1),options:{
              isWholeLine:true,className:'review-added-line',linesDecorationsClassName:'review-gutter',
            }});
            if(item.kind==='modify'){
              const parts=inlineDiff(item.oldText,item.newText);
              for(const range of changedRanges(parts.after)){
                const start=file.model.getPositionAt(item.start+range.start);
                const finish=file.model.getPositionAt(item.start+range.end);
                marks.push({range:new monaco.Range(start.lineNumber,start.column,finish.lineNumber,finish.column),
                  options:{inlineClassName:'review-inline-added'}});
              }
            }
          }
        }
        decorations.set(marks);
      });
      toolbarNodes=nextPortals.map(portal=>portal.toolbarNode);
      layoutToolbars();
      setPortals(nextPortals);
    };
    render();renderSelection();
    const subscription=editor.onDidChangeModel(()=>{render();renderSelection();});
    const selectionSubscription=editor.onDidChangeCursorSelection(renderSelection);
    const scrollSubscription=editor.onDidScrollChange(event=>{if(event.scrollLeftChanged)layoutToolbars();});
    const layoutSubscription=editor.onDidLayoutChange(layoutToolbars);
    return ()=>{
      subscription.dispose();selectionSubscription.dispose();scrollSubscription.dispose();layoutSubscription.dispose();
      decorations.clear();selectionDecorations.clear();
      editor.changeViewZones(accessor=>zones.forEach(id=>accessor.removeZone(id)));
    };
  },[editor,file.id,tick,expandedRecords,editorLineHeight]);  return <><Editor path={file.model.uri.toString()} theme={dark?'revu-dark':'revu-light'}
    keepCurrentModel saveViewState
    onMount={instance=>{editorRef.current=instance;setEditor(instance);}}
    loading={<div className="editor-loading">Opening editor…</div>}
    options={{
      automaticLayout:true,fontFamily,fontSize,lineHeight:editorLineHeight,padding:{top:0,bottom:24},minimap:{enabled:false},
      scrollBeyondLastLine:false,smoothScrolling:true,renderLineHighlight:'line',
      overviewRulerLanes:0,hideCursorInOverviewRuler:true,lineNumbersMinChars:4,
      glyphMargin:false,folding:true,tabSize:2,stickyScroll:{enabled:false},
      wordWrap:file.model.getLanguageId()==='markdown'?'on':'off',
    }}/>
    {portals.map(({toolbarNode,previewNode,item})=><Fragment key={item.id}>
      {createPortal(<ReviewActions file={file} item={item} onAction={(...args)=>actionRef.current(...args)}
        onReveal={()=>{
          if(!editor)return;
          const position=file.model.getPositionAt(item.start);
          editor.revealLineInCenter(position.lineNumber);editor.setPosition({lineNumber:position.lineNumber,column:1});editor.focus();
          for(const portal of portals)portal.toolbarNode.parentElement?.classList.toggle('active',portal.item.id===item.id);
          onReviewReveal(item.id);
        }}
        detailsExpanded={'decision' in item&&expandedRecords.has(item.id)}
        onToggleDetails={'decision' in item?()=>onToggleReviewPreview(item.id):undefined}
        navigationDisabled={portals.length<=1} onNavigate={direction=>{
          if(!editor)return;const items=reviewItems(file);const index=items.findIndex(entry=>entry.id===item.id);
          const target=items[(index+direction+items.length)%items.length];if(!target)return;
          const position=file.model.getPositionAt(target.start);editor.revealLineInCenter(position.lineNumber);
          editor.setPosition({lineNumber:position.lineNumber,column:1});editor.focus();
          for(const portal of portals)portal.toolbarNode.parentElement?.classList.toggle('active',portal.item.id===target.id);
        }}/>,toolbarNode)}
      {previewNode&&createPortal(<DiffPreview oldText={item.oldText} newText={item.newText}
        showAfter={'decision' in item} highlightChanges={item.kind==='modify'}/>,previewNode)}
    </Fragment>)}
  </>;
}
