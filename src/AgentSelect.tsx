import { useEffect,useLayoutEffect,useRef,useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

export interface SelectOption {value:string;label:string}
export interface SelectGroup {label?:string;options:SelectOption[]}

export default function AgentSelect({value,groups,placeholder,onChange,disabled=false,placement='down',align='start',compact=false,showCheck=true,ariaLabel}:{
  value?:string;groups:SelectGroup[];placeholder:string;onChange:(value:string)=>void;disabled?:boolean;
  placement?:'up'|'down';align?:'start'|'end';compact?:boolean;showCheck?:boolean;ariaLabel?:string;
}){
  const [open,setOpen]=useState(false);const [menuStyle,setMenuStyle]=useState<React.CSSProperties>({});
  const root=useRef<HTMLDivElement|null>(null);const menu=useRef<HTMLDivElement|null>(null);
  const options=groups.flatMap(group=>group.options);const selected=options.find(option=>option.value===value);
  useLayoutEffect(()=>{if(!open||!root.current)return;const rect=root.current.getBoundingClientRect();const width=compact?Math.max(96,rect.width):rect.width;
    const left=Math.max(8,Math.min(window.innerWidth-width-8,align==='end'?rect.right-width:rect.left));
    setMenuStyle({position:'fixed',left,width,maxHeight:Math.max(100,Math.min(280,(placement==='up'?rect.top:window.innerHeight-rect.bottom)-12)),
      ...(placement==='up'?{bottom:window.innerHeight-rect.top+5}:{top:rect.bottom+5})});
  },[open,placement,align,compact]);
  useEffect(()=>{if(!open)return;const outside=(event:PointerEvent|FocusEvent)=>{const target=event.target as Node;if(!root.current?.contains(target)&&!menu.current?.contains(target))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};
    document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('keydown',escape);};
  },[open]);
  const choose=(next:string)=>{onChange(next);setOpen(false);};
  const keyDown=(event:React.KeyboardEvent<HTMLButtonElement>)=>{
    if(event.key==='Escape'){setOpen(false);return;}
    if(event.key==='Enter'||event.key===' '){event.preventDefault();setOpen(current=>!current);return;}
    if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;
    event.preventDefault();const index=options.findIndex(option=>option.value===value);
    const next=event.key==='ArrowDown'?Math.min(options.length-1,index+1):index<0?options.length-1:Math.max(0,index-1);if(options[next])choose(options[next].value);
  };
  return <div className={'agent-select '+(compact?'compact':'')} ref={root}
    onBlur={event=>{const next=event.relatedTarget as Node|null;if(!root.current?.contains(next)&&!menu.current?.contains(next))setOpen(false);}}
    onKeyDownCapture={event=>{if(event.key==='Escape')setOpen(false);}}><button type="button" className="agent-select-trigger" disabled={disabled}
    aria-label={ariaLabel??placeholder} aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen(current=>!current)} onKeyDown={keyDown}>
    <span className={selected?'':'placeholder'}>{selected?.label??placeholder}</span><Icon name="down" size={12}/></button>
    {open&&createPortal(<div ref={menu} style={menuStyle} className="agent-select-menu" role="listbox">{groups.map((group,index)=><section key={group.label??index}>
      {group.label&&<strong>{group.label}</strong>}{group.options.map(option=><button type="button" role="option" aria-selected={option.value===value}
        className={option.value===value?'selected':''} key={option.value} title={option.label} onClick={()=>choose(option.value)}><span>{option.label}</span>{showCheck&&option.value===value&&<Icon name="check" size={11}/>}</button>)}</section>)}</div>,document.body)}
  </div>;
}

