import {Component,createContext,useContext,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';

const PanelWindowContext=createContext<Window|null>(null);
export const usePanelWindow=()=>useContext(PanelWindowContext)?.document.defaultView??window;

function capturePanel(host:HTMLElement){
  const document=host.ownerDocument;
  const focused=document.activeElement as HTMLElement|null;
  const selection=document.getSelection();
  const caret=selection?.anchorNode&&host.contains(selection.anchorNode)&&host.contains(selection.focusNode)
    ?{anchor:selection.anchorNode,anchorOffset:selection.anchorOffset,focus:selection.focusNode!,focusOffset:selection.focusOffset}:null;
  const scroll=[...host.querySelectorAll<HTMLElement>('[data-panel-scroll]')].map(element=>{
    const top=element.getBoundingClientRect().top;
    const anchor=[...element.querySelectorAll<HTMLElement>('[data-panel-anchor]')].find(item=>item.getBoundingClientRect().bottom>top);
    return {element,top:element.scrollTop,left:element.scrollLeft,atBottom:element.scrollHeight>element.clientHeight&&element.scrollHeight-element.scrollTop-element.clientHeight<=1,
      anchor,anchorOffset:anchor?anchor.getBoundingClientRect().top-top:0};
  });
  return ()=>{
    if(focused&&host.contains(focused))focused.focus({preventScroll:true});
    if(caret&&host.contains(caret.anchor)&&host.contains(caret.focus)){
      const withinNode=(node:Node,offset:number)=>Math.min(offset,node.nodeType===Node.TEXT_NODE?(node.textContent?.length??0):node.childNodes.length);
      host.ownerDocument.getSelection()?.setBaseAndExtent(caret.anchor,withinNode(caret.anchor,caret.anchorOffset),
        caret.focus,withinNode(caret.focus,caret.focusOffset));
    }
    for(const {element,top,left,atBottom,anchor,anchorOffset} of scroll){
      element.scrollLeft=left;
      if(atBottom)element.scrollTop=element.scrollHeight;
      else if(anchor&&element.contains(anchor))element.scrollTop+=anchor.getBoundingClientRect().top-element.getBoundingClientRect().top-anchorOffset;
      else element.scrollTop=top;
    }
  };
}

// Snapshot before React changes panel widths. Moving the portal's existing host keeps
// child components, streaming subscriptions, and in-progress forms mounted.
class PanelPlacement extends Component<{host:HTMLElement;targetWindow?:Window|null}>{
  private dock:HTMLDivElement|null=null;

  getSnapshotBeforeUpdate(previous:Readonly<typeof this.props>){
    return previous.targetWindow!==this.props.targetWindow?capturePanel(this.props.host):null;
  }
  componentDidMount(){this.place();}
  componentDidUpdate(_previous:Readonly<typeof this.props>,_state:unknown,restore:ReturnType<typeof capturePanel>|null){
    if(restore){this.place();restore();}
  }
  componentWillUnmount(){this.props.host.remove();}
  private place(){
    const destination=this.props.targetWindow?.document.getElementById('panel-root')??this.dock;
    destination?.append(this.props.host);
  }
  render(){return <div style={{display:'contents'}} ref={node=>{this.dock=node;}}/>;}
}

export function PanelPortal({targetWindow,children}:{targetWindow?:Window|null;children:ReactNode}){
  const [host]=useState(()=>{const node=document.createElement('div');node.style.display='contents';return node;});
  return <><PanelPlacement host={host} targetWindow={targetWindow}/>
    {createPortal(<PanelWindowContext.Provider value={targetWindow??null}>{children}</PanelWindowContext.Provider>,host)}
  </>;
}
