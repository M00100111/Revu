import { useRef, type PointerEvent } from 'react';

export default function ResizeHandle({width,onResize,label='Resize sidebar'}:{
  width?:number;onResize:(width:number)=>void;label?:string;
}){
  const drag=useRef<{id:number;x:number;width:number}|null>(null);
  function start(event:PointerEvent<HTMLDivElement>){
    if(event.button!==0)return;
    event.preventDefault();
    drag.current={id:event.pointerId,x:event.clientX,width:width??event.currentTarget.parentElement!.getBoundingClientRect().width};
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event:PointerEvent<HTMLDivElement>){
    if(drag.current?.id!==event.pointerId)return;
    onResize(Math.max(250,drag.current.width+event.clientX-drag.current.x));
  }
  return <div className="resize-handle" role="separator" aria-label={label}
    aria-orientation="vertical" onPointerDown={start} onPointerMove={move} onLostPointerCapture={()=>{drag.current=null;}}/>;
}
