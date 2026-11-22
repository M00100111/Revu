import {useRef,type PointerEvent,type ReactNode} from 'react';

export default function ScrollbarScope({className='scrollbar-contents',children}:{className?:string;children:ReactNode}){
  const hovered=useRef<HTMLElement|null>(null);
  const lastTarget=useRef<{element:HTMLElement;style:CSSStyleDeclaration}|null>(null);
  const clear=()=>{
    if(hovered.current)delete hovered.current.dataset.scrollbarHover;
    hovered.current=null;
  };
  const update=(event:PointerEvent<HTMLDivElement>)=>{
    const element=event.target as HTMLElement;
    if(!('offsetWidth' in element)){clear();return;}
    if(lastTarget.current?.element!==element){
      lastTarget.current={element,style:element.ownerDocument.defaultView!.getComputedStyle(element)};
    }
    const style=lastTarget.current.style;
    const vertical=(style.overflowY==='auto'||style.overflowY==='scroll')&&element.scrollHeight>element.clientHeight;
    const horizontal=(style.overflowX==='auto'||style.overflowX==='scroll')&&element.scrollWidth>element.clientWidth;
    if(!vertical&&!horizontal){clear();return;}
    // Chromium targets the scroll container when the pointer is on the native track.
    const rect=element.getBoundingClientRect();
    const x=event.clientX-rect.left-element.clientLeft;
    const y=event.clientY-rect.top-element.clientTop;
    const overYTrack=vertical&&y>=0&&y<element.clientHeight&&(x<0||x>=element.clientWidth)
      &&event.clientX>=rect.left+parseFloat(style.borderLeftWidth)&&event.clientX<rect.right-parseFloat(style.borderRightWidth);
    const overXTrack=horizontal&&x>=0&&x<element.clientWidth&&y>=element.clientHeight
      &&event.clientY<rect.bottom-parseFloat(style.borderBottomWidth);
    const axis=overYTrack?'vertical':overXTrack?'horizontal':null;
    if(hovered.current!==element||!axis)clear();
    if(axis&&element.dataset.scrollbarHover!==axis){
      element.dataset.scrollbarHover=axis;
      hovered.current=element;
    }
  };
  return <div className={className} data-app-scrollbars onPointerMove={update} onPointerUp={update}
    onPointerOut={clear} onPointerCancel={clear}>{children}</div>;
}
