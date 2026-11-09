import { useEffect,useLayoutEffect,useRef,useState } from 'react';
import { createPortal } from 'react-dom';

export interface RevuContextMenuItem<T extends string=string> {
  id:T;
  label:string;
  disabled?:boolean;
  separatorBefore?:boolean;
}

interface ContextMenuRequest {
  x:number;
  y:number;
  items:readonly RevuContextMenuItem[];
  resolve:(value:string|null)=>void;
}

let openContextMenu:((request:ContextMenuRequest)=>void)|undefined;

export const showContextMenu=<T extends string>(event:{clientX:number;clientY:number;preventDefault:()=>void},items:readonly RevuContextMenuItem<T>[])=>{
  event.preventDefault();
  return new Promise<T|null>(resolve=>{
    if(!openContextMenu){resolve(null);return;}
    openContextMenu({x:event.clientX,y:event.clientY,items,resolve:value=>resolve(value as T|null)});
  });
};

export default function ContextMenuHost(){
  const [request,setRequest]=useState<ContextMenuRequest|null>(null);
  const [position,setPosition]=useState({left:0,top:0});
  const requestRef=useRef<ContextMenuRequest|null>(null);
  const menuRef=useRef<HTMLDivElement|null>(null);
  const finish=(value:string|null)=>{
    const current=requestRef.current;if(!current)return;
    requestRef.current=null;setRequest(null);current.resolve(value);
  };
  useEffect(()=>{
    openContextMenu=next=>{
      requestRef.current?.resolve(null);requestRef.current=next;
      setPosition({left:next.x,top:next.y});setRequest(next);
    };
    return()=>{if(openContextMenu){openContextMenu=undefined;}requestRef.current?.resolve(null);requestRef.current=null;};
  },[]);
  useLayoutEffect(()=>{
    if(!request||!menuRef.current)return;
    const rect=menuRef.current.getBoundingClientRect();const margin=6;
    setPosition({left:Math.max(margin,Math.min(request.x,window.innerWidth-rect.width-margin)),top:Math.max(margin,Math.min(request.y,window.innerHeight-rect.height-margin))});
    menuRef.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  },[request]);
  useEffect(()=>{
    if(!request)return;
    const close=()=>finish(null);window.addEventListener('blur',close);window.addEventListener('resize',close);
    return()=>{window.removeEventListener('blur',close);window.removeEventListener('resize',close);};
  },[request]);
  if(!request)return null;
  const moveFocus=(event:React.KeyboardEvent)=>{
    if(event.key==='Escape'){event.preventDefault();finish(null);return;}
    if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;
    event.preventDefault();const buttons=[...menuRef.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const current=buttons.indexOf(document.activeElement as HTMLButtonElement);const step=event.key==='ArrowDown'?1:-1;
    buttons[(current+step+buttons.length)%buttons.length]?.focus();
  };
  return createPortal(<div className="revu-context-menu-layer" onPointerDown={event=>{if(event.target===event.currentTarget)finish(null);}} onContextMenu={event=>event.preventDefault()}>
    <div ref={menuRef} className="revu-context-menu" role="menu" style={position} onKeyDown={moveFocus} onPointerDown={event=>event.stopPropagation()}>
      {request.items.map(item=><button type="button" role="menuitem" className={item.separatorBefore?'separator':''} disabled={item.disabled}
        key={item.id} onClick={()=>finish(item.id)}>{item.label}</button>)}
    </div>
  </div>,document.body);
}
