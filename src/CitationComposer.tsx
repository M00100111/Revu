import {useImperativeHandle,useLayoutEffect,useRef,useState,type Ref,type KeyboardEventHandler,type FocusEventHandler,type ClipboardEventHandler} from 'react';
import {createPortal} from 'react-dom';
import {references,type CitationReference,type CiteTarget} from '../shared/citations';
import {CitationChip} from './CitationView';

export interface ComposerHandle {element:HTMLDivElement;selectionStart:number;selectionEnd:number;focus:()=>void;setSelectionRange:(start:number,end:number)=>void}
function raw(node:Node):string{
  if(node.nodeType===Node.ELEMENT_NODE){
    const token=(node as Element).getAttribute('data-raw');
    if(token!==null)return token;
  }
  if(node.nodeType===Node.TEXT_NODE)return node.textContent??'';
  if(node.nodeName==='BR')return '\n';
  if(node.childNodes.length===1&&node.firstChild?.nodeName==='BR')return '';
  return Array.from(node.childNodes,raw).join('');
}
function point(root:HTMLElement,offset:number):[Node,number]{
  for(const [index,node] of Array.from(root.childNodes).entries()){const size=raw(node).length;if(offset<=size)return node.nodeType===Node.TEXT_NODE?[node,offset]:[root,index+(offset>0?1:0)];offset-=size;}return [root,root.childNodes.length];
}
function selected(root:HTMLElement){
  const selection=root.ownerDocument.getSelection();if(!selection?.rangeCount||!root.contains(selection.anchorNode)||!root.contains(selection.focusNode))return [raw(root).length,raw(root).length];
  const range=selection.getRangeAt(0);const length=(node:Node,offset:number)=>{const prefix=root.ownerDocument.createRange();prefix.selectNodeContents(root);prefix.setEnd(node,offset);return raw(prefix.cloneContents()).length;};return [length(range.startContainer,range.startOffset),length(range.endContainer,range.endOffset)];
}
function place(root:HTMLElement,start:number,end:number){const range=root.ownerDocument.createRange();range.setStart(...point(root,start));range.setEnd(...point(root,end));const selection=root.ownerDocument.getSelection();selection?.removeAllRanges();selection?.addRange(range);}
export function CitationComposer({ref,value,freshCitationTail=false,disabled,onValue,onCaret,onKeyDown,onBlur,onPaste,onGoto,onEdit,onDelete}:{ref:Ref<ComposerHandle>;value:string;freshCitationTail?:boolean;disabled:boolean;onValue:(text:string,caret:number)=>void;onCaret:(offset:number)=>void;onKeyDown:KeyboardEventHandler<HTMLDivElement>;onBlur:FocusEventHandler<HTMLDivElement>;onPaste:ClipboardEventHandler<HTMLDivElement>;onGoto:(target:CiteTarget)=>void;onEdit:(ref:CitationReference)=>void;onDelete:(ref:CitationReference)=>void}){
  const root=useRef<HTMLDivElement>(null),composing=useRef(false);const [portals,setPortals]=useState<{node:HTMLSpanElement;ref:ReturnType<typeof references>[number]}[]>([]);
  const pendingCaret=useRef<{value:string;offset:number}|null>(null);
  useImperativeHandle(ref,()=>({element:root.current!,get selectionStart(){return selected(root.current!)[0];},get selectionEnd(){return selected(root.current!)[1];},focus:()=>root.current?.focus(),setSelectionRange:(start,end)=>place(root.current!,start,end)}),[]);
  useLayoutEffect(()=>{
    const edit=root.current!;if(composing.current)return;const refs=references(value);const existing=Array.from(edit.children);
    const pending=pendingCaret.current;pendingCaret.current=null;
    if(raw(edit)===value&&existing.length===refs.length&&refs.every((ref,index)=>existing[index]===portals[index]?.node&&portals[index].ref.offset===ref.offset&&portals[index].ref.raw===ref.raw)){
      if(freshCitationTail){edit.focus();place(edit,value.length,value.length);}
      else if(pending?.value===value&&edit.ownerDocument.activeElement===edit)place(edit,pending.offset,pending.offset);
      return;
    }
    const caret=pending?.value===value?[pending.offset,pending.offset]:selected(edit),focused=edit.ownerDocument.activeElement===edit;let offset=0;const fragment=edit.ownerDocument.createDocumentFragment();const next=refs.map(ref=>{fragment.append(value.slice(offset,ref.offset));const node=edit.ownerDocument.createElement('span');node.contentEditable='false';node.dataset.raw=ref.raw;fragment.append(node);offset=ref.offset+ref.raw.length;return {node,ref};});fragment.append(value.slice(offset));edit.replaceChildren(fragment);setPortals(next);if(focused)place(edit,caret[0],caret[1]);
  },[value,portals,freshCitationTail]);
  const commit=(text:string,caret:number,allowSeparator:boolean,restoreCaret:boolean)=>{
    if(freshCitationTail&&allowSeparator&&caret===text.length&&text.startsWith(value)&&/^[^\s\p{P}]/u.test(text.slice(value.length))){
      text=value+' '+text.slice(value.length);caret++;restoreCaret=true;
    }
    if(restoreCaret)pendingCaret.current={value:text,offset:caret};
    onValue(text,caret);
  };
  const emit=()=>{if(composing.current)return;const edit=root.current!,text=raw(edit);if(text!==value)commit(text,selected(edit)[0],true,false);};
  const replace=(text:string)=>{const edit=root.current!,before=raw(edit);const [start,end]=selected(edit);
    commit(before.slice(0,start)+text+before.slice(end),start+text.length,start===end&&end===before.length,true);
  };
  return <div ref={root} className="citation-composer" role="textbox" aria-label="Chat input" aria-multiline="true" aria-disabled={disabled} contentEditable={!disabled} suppressContentEditableWarning spellCheck={false}
    onBlur={onBlur} onInput={emit} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;emit();}}
    onMouseUp={event=>{if(!(event.target as Element).closest('button'))onCaret(selected(root.current!)[0]);}} onKeyUp={event=>{if(!composing.current&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key))onCaret(selected(root.current!)[0]);}}
    onPaste={event=>{onPaste(event);if(!event.defaultPrevented){event.preventDefault();replace(event.clipboardData.getData('text/plain').replace(/\r\n/g,'\n'));}}}
    onDrop={event=>{if(event.dataTransfer.files.length)return;event.preventDefault();const text=event.dataTransfer.getData('text/plain');if(text)replace(text.replace(/\r\n/g,'\n'));}}
    onCopy={event=>{const [start,end]=selected(root.current!);if(start!==end){event.preventDefault();event.clipboardData.setData('text/plain',value.slice(start,end));}}}
    onCut={event=>{const [start,end]=selected(root.current!);if(start!==end){event.preventDefault();event.clipboardData.setData('text/plain',value.slice(start,end));replace('');}}}
    onKeyDown={event=>{if(composing.current||event.nativeEvent.isComposing||(event.target as Element).closest('button'))return;onKeyDown(event);if(!event.defaultPrevented&&event.key==='Enter'){event.preventDefault();replace('\n');}}}>
    {portals.map(({node,ref})=>createPortal(<CitationChip reference={ref} onGoto={onGoto} onEdit={()=>onEdit(ref)} onDelete={()=>onDelete(ref)}/>,node,`${ref.offset}:${ref.raw}`))}
  </div>;
}
