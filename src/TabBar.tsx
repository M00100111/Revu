import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { api } from './files';
import { countTabRows, defaultTabExpansion, nextTabExpansion, type FileTabExpansion, type FileTabOverflow } from './tabLayout';
export type TabContextAction='close'|'closeOthers'|'closeAll';
export interface EditorTabItem {id:string;name:string;title:string;projectName:string;groupId:string|null;dirty:boolean;preview?:boolean}
export default function TabBar({ tabs, activeId, onSelect, onClose, onDoubleClick, onContextAction, mixed,
  overflowMode,expansion,onExpansionChange,underWindowControls }: {
  tabs: EditorTabItem[]; activeId: string | null; onSelect: (tab: EditorTabItem) => void;
  onClose: (tab: EditorTabItem) => void;onContextAction:(tab:EditorTabItem,action:TabContextAction)=>void;
  onDoubleClick:(tab:EditorTabItem)=>void;mixed: boolean;overflowMode:FileTabOverflow;expansion:FileTabExpansion;
  onExpansionChange:(expansion:FileTabExpansion)=>void;underWindowControls:boolean;
}) {
  const barRef=useRef<HTMLDivElement|null>(null);
  const tabsRef=useRef<HTMLDivElement|null>(null);
  const activeRef=useRef<HTMLDivElement|null>(null);
  const [metrics,setMetrics]=useState({overflow:false,rows:1});
  const wrapped=overflowMode==='wrap'||expansion!=='single';
  const limited=wrapped&&expansion!=='all';
  useLayoutEffect(()=>{
    const bar=barRef.current,tabs=tabsRef.current;if(!bar||!tabs)return;
    const measure=()=>{
      const widths=[...tabs.children].map(node=>(node as HTMLElement).offsetWidth);
      const paddingRight=parseFloat(getComputedStyle(bar).paddingRight)||0;
      const available=Math.max(1,tabs.clientWidth);
      const total=widths.reduce((sum,width)=>sum+width,0);
      const overflow=total>bar.clientWidth-paddingRight+0.5;
      const rows=countTabRows(widths,available);
      setMetrics(current=>current.overflow===overflow&&current.rows===rows?current:{overflow,rows});
    };
    const observer=new ResizeObserver(measure);observer.observe(bar);observer.observe(tabs);measure();
    return()=>observer.disconnect();
  },[tabs,mixed,overflowMode,metrics.overflow]);
  useEffect(()=>{
    const fallback=defaultTabExpansion(overflowMode);
    if(!metrics.overflow&&expansion!==fallback)onExpansionChange(fallback);
  },[metrics.overflow,overflowMode,expansion,onExpansionChange]);
  useEffect(()=>{
    activeRef.current?.scrollIntoView({block:'nearest',inline:'nearest'});
  },[activeId,expansion,metrics.rows]);
  const showToggle=metrics.overflow&&(overflowMode==='scroll'||metrics.rows>4||expansion==='all');
  const toggleTitle=overflowMode==='wrap'
    ? expansion==='all'?'Limit to four rows':'Show all tabs'
    : expansion==='single'?'Wrap tabs':expansion==='limited'&&metrics.rows>4?'Show all tabs':'Collapse tabs';
  return <div ref={barRef} className={'tab-bar '+(wrapped?'wrapped ':'')+(limited?'limited ':'')+
    (expansion==='all'?'all ':'')+(underWindowControls?'under-window-controls':'')}>
    <div ref={tabsRef} className="tabs" aria-label="Open files">
      {tabs.map(tab => <div key={tab.id} className={'tab ' + (tab.id === activeId ? 'active' : '')}
        ref={tab.id===activeId?activeRef:undefined}
        onContextMenu={async event=>{event.preventDefault();const action=await api<TabContextAction|null>('tabMenu',{scope:'file'});if(action)onContextAction(tab,action);}}>
        <button className="tab-select" title={tab.title}
          aria-pressed={tab.id === activeId} onClick={() => onSelect(tab)} onDoubleClick={()=>onDoubleClick(tab)}>
          <Icon name="editorDocument" size={14} /><span className={tab.preview?'preview-name':undefined}>{tab.name}</span>
          {mixed && <small className="tab-project">{tab.projectName}</small>}
        </button>
        <button className={'tab-close ' + (tab.dirty ? 'dirty' : '')}
          aria-label={'Close ' + tab.title + (tab.dirty ? ' (unsaved)' : '')}
          title={tab.dirty ? 'Unsaved · Close file' : 'Close file'} onClick={() => onClose(tab)}>
          {tab.dirty && <span className="dirty-dot" />}<Icon name="close" size={12} />
        </button>
      </div>)}
    </div>
    {showToggle&&<button className="tab-wrap-toggle" title={toggleTitle} aria-label={toggleTitle}
      onClick={()=>onExpansionChange(nextTabExpansion(overflowMode,expansion,metrics.rows))}>
      <Icon name="more" size={14}/>
    </button>}
  </div>;
}
