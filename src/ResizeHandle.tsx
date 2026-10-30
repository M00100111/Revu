import type { PointerEvent as ReactPointerEvent } from 'react';
export default function ResizeHandle({width,onResize}:{width:number;onResize:(width:number)=>void}){
  function start(event:ReactPointerEvent<HTMLDivElement>){
    event.preventDefault();
    const origin=event.clientX;
    const move=(next:PointerEvent)=>onResize(Math.max(180,Math.min(520,width+next.clientX-origin)));
    const stop=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);};
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop);
  }
  return <div className="resize-handle" role="separator" aria-label="Resize sidebar"
    aria-orientation="vertical" onPointerDown={start}/>;
}
