import Editor from '@monaco-editor/react';
import { createPortal } from 'react-dom';
import { Fragment, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Chunk, ReviewRecord } from '../shared/types';
import { changedRanges, inlineDiff } from '../shared/inlineDiff';
import { monaco, type OpenFile } from './editor';
import { reviewItems, ReviewActions, PinActions, type ActionHandler,type PinActionHandler } from './ReviewActions';
import DiffPreview from './DiffPreview';
import type {PinPlacement} from '../shared/pinLayout';
import type {CiteRequest} from '../shared/citations';

const EDITOR_FONT="'Cascadia Code', Consolas, 'Courier New', monospace";
const noPins:PinPlacement[]=[];
type Portal={toolbarNode:HTMLElement;previewNode?:HTMLElement;item:Chunk|ReviewRecord|PinPlacement};

export default function EditorArea({file,dark,editorRef,tick,onAction,onReviewReveal,expandedRecords,onToggleReviewPreview,reveal,fontSize,pins=noPins,keptIds,onPinAction,onPinSource,readOnly=false,onCite}:{
  file:OpenFile;dark:boolean;editorRef:MutableRefObject<monaco.editor.IStandaloneCodeEditor|null>;
  tick:number;onAction:ActionHandler;onReviewReveal:(itemId:string)=>void;
  expandedRecords:ReadonlySet<string>;onToggleReviewPreview:(itemId:string)=>void;
  reveal?:{line:number;lastLine?:number;href?:string;pinId?:string};fontSize:number;pins?:PinPlacement[];keptIds:ReadonlySet<string>;readOnly?:boolean;onCite?:(request:CiteRequest)=>void;
  onPinAction:PinActionHandler;onPinSource:(pin:PinPlacement)=>void;
}){
  const [editor,setEditor]=useState<monaco.editor.IStandaloneCodeEditor|null>(null);
  useEffect(()=>{
    if(!editor||!onCite)return;
    const action=editor.addAction({id:'revu.cite',label:'Cite',precondition:'editorHasSelection',contextMenuGroupId:'navigation',contextMenuOrder:1,run:instance=>{
      const range=instance.getSelection();if(!range||range.isEmpty()||instance.getModel()!==file.model)return;
      const wholeLines=range.startColumn===1&&(range.endColumn===1||range.endColumn===file.model.getLineMaxColumn(range.endLineNumber));
      onCite({projectId:file.project.id,path:file.path,selection:{path:file.path,startLine:range.startLineNumber,startColumn:range.startColumn,endLine:range.endLineNumber,endColumn:range.endColumn,text:file.model.getValueInRange(range),language:file.model.getLanguageId(),wholeLines}});
    }});return ()=>action.dispose();
  },[editor,file.model,file.project.id,file.path,onCite]);
  const [portals,setPortals]=useState<Portal[]>([]);
  const lastReveal=useRef<typeof reveal>(undefined);
  const actionRef=useRef(onAction); actionRef.current=onAction;
  const editorLineHeight=Math.round(fontSize*12/7);
  const requestedPin=reveal?.pinId?pins.find(pin=>pin.id===reveal.pinId):reveal?.href?pins.find(pin=>pin.reference.href===reveal.href):undefined;
  useEffect(()=>()=>{editorRef.current=null;},[editorRef]);
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
      const nextPortals:Portal[]=[];
      editor.changeViewZones(accessor=>{
        zones.forEach(id=>accessor.removeZone(id));zones=[];
        if(editor.getModel()!==file.model){decorations.clear();return;}
        const marks:monaco.editor.IModelDeltaDecoration[]=[];
        const rows=(text:string)=>text?text.replace(/\r?\n$/,'').split('\n').length:0;
        const addZone=(node:HTMLElement,afterLineNumber:number,height:number)=>{
          node.style.overflow='hidden';
          zones.push(accessor.addZone({afterLineNumber,heightInPx:height,domNode:node,suppressMouseDown:false}));
        };
        for(const pin of pins){
          if(pin.chunkId!==undefined)continue;
          const node=document.createElement('div');node.className='inline-review pin';
          const toolbar=document.createElement('div');toolbar.className='inline-review-toolbar';node.append(toolbar);
          nextPortals.push({toolbarNode:toolbar,item:pin});
          addZone(node,pin.line-1,32);
          marks.push({range:new monaco.Range(pin.line,1,pin.lastLine,1),options:{
            isWholeLine:true,className:'code-pin-line',linesDecorationsClassName:'code-pin-gutter',
          }});
        }
        for(const item of reviewItems(file)){
          const position=file.model.getPositionAt(item.start);
          const line=Math.max(1,Math.min(file.model.getLineCount(),position.lineNumber));
          const record='decision' in item?item:null;
          const node=document.createElement('div');node.className='inline-review '+(record?'reviewed':item.kind);
          const toolbar=document.createElement('div');toolbar.className='inline-review-toolbar';node.append(toolbar);
          const expanded=!!record&&expandedRecords.has(record.id);
          const focusedOldRows=requestedPin?.chunkId===item.id?requestedPin.oldRows:undefined;
          const showPreview=record?(expanded||!!focusedOldRows):!!item.oldText;
          let preview:HTMLElement|undefined;
          let previewHeight=0;
          if(showPreview){
            preview=document.createElement('div');preview.className='inline-review-preview';
            preview.addEventListener('mousedown',event=>event.stopPropagation());
            preview.addEventListener('pointerdown',event=>event.stopPropagation());
            const previewRows=rows(item.oldText)+(record?rows(item.newText):0);
            previewHeight=previewRows*editorLineHeight;
            preview.style.height=previewHeight+'px';node.append(preview);
            if(focusedOldRows){
              const marker=document.createElement('div');marker.className='code-pin-old-marker';
              marker.style.top=focusedOldRows.start*editorLineHeight+'px';
              marker.style.height=(focusedOldRows.end-focusedOldRows.start+1)*editorLineHeight+'px';preview.append(marker);
            }
          }
          nextPortals.push({toolbarNode:toolbar,previewNode:preview,item});
          const height=32+previewHeight;
          const atEOF=item.start===file.model.getValueLength()&&position.column>1;
          addZone(node,atEOF?line:line-1,height);
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
  },[editor,file.id,tick,expandedRecords,editorLineHeight,pins,requestedPin]);
  useEffect(()=>{
    if(!editor||!reveal||lastReveal.current===reveal)return;
    const go=()=>{
      if(editor.getModel()!==file.model||lastReveal.current===reveal)return;
      const pin=requestedPin;
      if((reveal.href||reveal.pinId)&&!pin)return;
      const line=Math.max(1,Math.min(pin?.line??reveal.line,file.model.getLineCount()));
      editor.revealLineInCenter(line);editor.setPosition({lineNumber:line,column:1});
      if(reveal.lastLine!==undefined){const last=Math.max(line,Math.min(reveal.lastLine,file.model.getLineCount()));editor.setSelection(new monaco.Range(line,1,last,file.model.getLineMaxColumn(last)));editor.focus();}
      if(pin){
        const id=pin.chunkId??pin.id;
        const portal=portals.find(item=>item.item.id===id);
        if(!portal?.toolbarNode.isConnected)return;
        for(const entry of portals)entry.toolbarNode.parentElement?.classList.toggle('active',entry===portal);
        if(pin.oldRows&&portal.previewNode){
          const top=portal.previewNode.getBoundingClientRect().top-(editor.getDomNode()?.getBoundingClientRect().top??0);
          editor.setScrollTop(editor.getScrollTop()+top+pin.oldRows.start*editorLineHeight-editor.getLayoutInfo().height/2);
        }
      }
      lastReveal.current=reveal;
    };
    const changed=editor.onDidChangeModel(go);go();
    return()=>changed.dispose();
  },[editor,file.id,reveal,requestedPin,portals,tick,editorLineHeight]);
  const revealItem=(itemId:string,line:number)=>{
    if(!editor)return;
    editor.revealLineInCenter(line);editor.setPosition({lineNumber:line,column:1});editor.focus();
    for(const portal of portals)portal.toolbarNode.parentElement?.classList.toggle('active',portal.item.id===itemId);
    onReviewReveal(itemId);
  };
  return <><Editor path={file.model.uri.toString()} theme={dark?'revu-dark':'revu-light'}
    keepCurrentModel saveViewState
    onMount={instance=>{editorRef.current=instance;setEditor(instance);}}
    loading={<div className="editor-loading">Opening editor…</div>}
    options={{
      automaticLayout:true,fontFamily:EDITOR_FONT,fontSize,lineHeight:editorLineHeight,padding:{top:0,bottom:24},minimap:{enabled:false},
      scrollBeyondLastLine:false,smoothScrolling:true,renderLineHighlight:'line',
      overviewRulerLanes:0,hideCursorInOverviewRuler:true,lineNumbersMinChars:4,
      glyphMargin:false,folding:true,tabSize:2,stickyScroll:{enabled:false},
      wordWrap:file.model.getLanguageId()==='markdown'?'on':'off',readOnly,
    }}/>
    {portals.map(({toolbarNode,previewNode,item})=>'reference' in item
      ? createPortal(<PinActions pin={item} kept={keptIds.has(item.id)} onAction={onPinAction} onSource={onPinSource}
        onReveal={()=>revealItem(item.id,item.line)}/>,toolbarNode,item.id):<Fragment key={item.id}>
      {createPortal(<ReviewActions file={file} item={item} onAction={(...args)=>actionRef.current(...args)}
        onReveal={()=>revealItem(item.id,file.model.getPositionAt(item.start).lineNumber)}
        detailsExpanded={'decision' in item&&expandedRecords.has(item.id)}
        onToggleDetails={'decision' in item?()=>onToggleReviewPreview(item.id):undefined}
        navigationDisabled={file.chunks.length+file.records.length<=1} onNavigate={direction=>{
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
