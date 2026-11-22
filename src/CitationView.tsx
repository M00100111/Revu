import {usePanelWindow} from './PanelPortal';
import {createContext,Fragment,useContext,useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {copyReference,references,type CitationReference,type CiteTarget,type DraftSelection} from '../shared/citations';
import Icon from './Icon';
import {CitationCode,type SnapshotTokenizer} from './CitationCode';

type Preview={anchor:HTMLElement;snapshot:DraftSelection};
const PreviewContext=createContext<(preview:Preview)=>void>(()=>{});
export function CitationPreviews({epoch,children,tokenize}:{epoch:string;children:ReactNode;tokenize?:SnapshotTokenizer}){
  const panelWindow=usePanelWindow();
  const [preview,setPreview]=useState<Preview|null>(null),panel=useRef<HTMLElement>(null);
  useLayoutEffect(()=>setPreview(null),[epoch]);
  useLayoutEffect(()=>{
    if(!preview||!panel.current)return;
    const anchor=preview.anchor,element=panel.current,chat=anchor.closest('.agent-chat'),body=anchor.closest('.agent-chat-body');
    const position=()=>{
      const rect=anchor.getBoundingClientRect(),bounds=chat?.getBoundingClientRect(),clip=body?.getBoundingClientRect();
      const left=Math.max(0,bounds?.left??0)+8,right=Math.min(panelWindow.innerWidth,bounds?.right??panelWindow.innerWidth)-8;
      const top=Math.max(0,bounds?.top??0)+8,bottom=Math.min(panelWindow.innerHeight,bounds?.bottom??panelWindow.innerHeight)-8;
      if(!anchor.isConnected||!rect.width||rect.bottom<(clip?.top??top-8)||rect.top>(clip?.bottom??bottom+8)){setPreview(null);return;}
      element.style.maxWidth=Math.max(1,Math.min(620,right-left))+'px';
      const preferred=Math.min(element.scrollHeight+2,440,panelWindow.innerHeight/2);
      const above=rect.top-6-top,below=bottom-rect.bottom-6,placeAbove=above>=preferred||(below<preferred&&above>=below);
      element.style.maxHeight=Math.max(1,Math.min(440,panelWindow.innerHeight/2,placeAbove?above:below))+'px';
      element.style.left=Math.max(left,Math.min(rect.left+(rect.width-element.offsetWidth)/2,right-element.offsetWidth))+'px';
      element.style.top=(placeAbove?rect.top-6-element.offsetHeight:rect.bottom+6)+'px';
    };
    const dismiss=(event:PointerEvent)=>{const target=event.target as Node;if(!element.contains(target)&&!anchor.contains(target))setPreview(null);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setPreview(null);anchor.focus();}};
    position();const observer=new panelWindow.ResizeObserver(position);observer.observe(element);observer.observe(anchor);if(chat)observer.observe(chat);
    panelWindow.addEventListener('scroll',position,true);panelWindow.addEventListener('resize',position);
    panelWindow.document.addEventListener('keydown',escape,true);panelWindow.document.addEventListener('pointerdown',dismiss);
    return()=>{observer.disconnect();panelWindow.removeEventListener('scroll',position,true);panelWindow.removeEventListener('resize',position);panelWindow.document.removeEventListener('keydown',escape,true);panelWindow.document.removeEventListener('pointerdown',dismiss);};
  },[preview,panelWindow]);
  return <PreviewContext.Provider value={next=>setPreview(current=>current?.anchor===next.anchor?null:next)}>{children}
    {preview&&createPortal(<aside role="dialog" aria-label="Code snapshot" ref={panel} data-app-scrollbars className="citation-preview"><CitationCode snapshot={preview.snapshot} tokenize={tokenize}/></aside>,panelWindow.document.body)}
  </PreviewContext.Provider>;
}
export function CitationChip({reference,onGoto,onEdit,onCopy,onDelete,onView}:{reference:CitationReference;onGoto:(target:CiteTarget)=>void;onEdit?:()=>void;onCopy?:()=>void;onDelete?:()=>void;onView?:(anchor:HTMLElement)=>void}){
  const chip=useRef<HTMLSpanElement>(null);
  const label='@'+(reference.path.replace(/\/$/,'').split('/').at(-1)??reference.path)+(reference.directory?'/':'')+(reference.line?`:${reference.line}`+(reference.lastLine!==reference.line?`–${reference.lastLine}`:''):'');
  return <span ref={chip} className="cite-chip" contentEditable={false} tabIndex={0} role="group" aria-label={reference.raw} title={reference.raw}><span className="cite-label">{label}</span><span className="cite-tools">
    <button type="button" title="Go to" aria-label="Go to" onClick={()=>onGoto(reference)}><Icon name="goTo" size={16}/></button>
    {onEdit&&!reference.line&&<button type="button" title="Editor" aria-label="Edit reference" onMouseDown={event=>event.preventDefault()} onClick={onEdit}><Icon name="editReference" size={12}/></button>}
    {onView&&<button type="button" title="View snapshot" aria-label="View snapshot" onClick={()=>{if(chip.current)onView(chip.current);}}><span className="citation-view-ink"><Icon name="view" size={13}/></span></button>}
    {onCopy&&<button type="button" title="Copy reference" aria-label="Copy reference" onClick={onCopy}><span className="citation-copy-ink"><Icon name="copy" size={13}/></span></button>}
    {onDelete&&<button type="button" title="Delete reference" aria-label="Delete reference" onClick={onDelete}><Icon name="delete" size={13}/></button>}
  </span></span>;
}
export function CitationBubble({text,selections=[],epoch,onGoto,onCopy}:{text:string;selections?:DraftSelection[];epoch:string;onGoto:(target:CiteTarget)=>void;onCopy:(text:string)=>void}){
  const showPreview=useContext(PreviewContext);
  const [expanded,setExpanded]=useState<Set<number>>(()=>new Set());
  useEffect(()=>setExpanded(new Set()),[epoch]);
  const toggle=(offset:number)=>setExpanded(current=>{const next=new Set(current);if(!next.delete(offset))next.add(offset);return next;});
  const parts:React.ReactNode[]=[];
  const renderText=(start:number,end:number)=>{
    let cursor=start;for(const ref of references(text.slice(start,end))){const offset=start+ref.offset;const snapshot=selections.find(item=>item.offset===offset);parts.push(text.slice(cursor,offset));
      parts.push(<CitationChip key={offset} reference={ref} onGoto={onGoto} onCopy={()=>onCopy(copyReference(ref))}
        onView={snapshot&&ref.line?anchor=>showPreview({anchor,snapshot}):undefined}/>);cursor=offset+ref.raw.length;
    }parts.push(text.slice(cursor,end));
  };
  let cursor=0;for(const match of text.matchAll(/(?:^|(?<=\n))<skill\s+name="([^"\n]+)"\s+location="[^"\n]*">[^]*?^<\/skill>(?=\r?$)/gm)){
    const offset=match.index;renderText(cursor,offset);parts.push(<Fragment key={'skill'+offset}><button type="button" className="skill-chip" aria-expanded={expanded.has(offset)} onClick={()=>toggle(offset)}>/{match[1]}</button>{expanded.has(offset)&&<span className="cite-details"><code>{match[0]}</code></span>}</Fragment>);cursor=offset+match[0].length;
  }renderText(cursor,text.length);return <div className="agent-user-bubble">{parts}</div>;
}
