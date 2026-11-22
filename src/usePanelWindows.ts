import {useCallback,useEffect,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import type {PanelWindow} from '../shared/panelWindows';
import {errorMessage} from './files';

type PanelWindows=Record<PanelWindow,Window|null>;
const panelNames:PanelWindow[]=['review','chat'];

function prepareDocument(child:Window,panel:PanelWindow){
  const target=child.document;
  target.title=panel==='chat'?'Chat · Revu':'Review · Revu';
  target.documentElement.lang=document.documentElement.lang;
  const base=target.createElement('base');
  base.href=document.baseURI;
  target.head.append(base);
  const styles:Promise<void>[]=[];
  for(const element of document.head.querySelectorAll('style, link[rel="stylesheet"]')){
    const copy=target.importNode(element,true);
    if(element.tagName==='LINK')styles.push(new Promise<void>((resolve,reject)=>{
      copy.addEventListener('load',()=>resolve(),{once:true});
      copy.addEventListener('error',()=>reject(new Error('Could not load the '+panel+' window stylesheet.')),{once:true});
    }));
    target.head.append(copy);
  }
  const syncTheme=()=>{
    target.documentElement.dataset.theme=document.documentElement.dataset.theme;
    target.documentElement.style.cssText=document.documentElement.style.cssText;
  };
  syncTheme();
  const observer=new MutationObserver(syncTheme);
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','style']});
  target.body.className='panel-window-body';
  const root=target.createElement('div');
  root.id='panel-root';
  target.body.append(root);
  return {ready:Promise.all(styles),dispose:()=>observer.disconnect()};
}

export function usePanelWindows(onDetach:(panel:PanelWindow)=>void,onDock:(panel:PanelWindow)=>void,onError:(message:string)=>void){
  const [windows,setWindows]=useState<PanelWindows>({review:null,chat:null});
  const active=useRef<Partial<Record<PanelWindow,{window:Window;ready:boolean;dispose:()=>void}>>>({});
  const closing=useRef(new Set<PanelWindow>());
  const report=useCallback((error:unknown)=>onError(errorMessage(error)),[onError]);
  const isDetached=useCallback((panel:PanelWindow)=>!!active.current[panel]?.ready,[]);
  const focus=useCallback((panel:PanelWindow|'main')=>{
    const target=panel!=='main'&&active.current[panel]?.ready?panel:'main';
    void window.revu.panels.focus(target).catch(report);
  },[report]);
  const dock=useCallback((...requested:PanelWindow[])=>{
    const panels=requested.filter(panel=>active.current[panel]);
    if(!panels.length)return;
    // Move the live DOM back before Electron destroys its current document.
    flushSync(()=>{
      for(const panel of panels){
        active.current[panel]?.dispose();
        delete active.current[panel];
        onDock(panel);
      }
      setWindows(current=>{
        const next={...current};
        for(const panel of panels)next[panel]=null;
        return next;
      });
    });
    for(const panel of panels){
      closing.current.add(panel);
      void window.revu.panels.close(panel).catch(report).finally(()=>closing.current.delete(panel));
    }
    focus('main');
  },[focus,onDock,report]);
  useEffect(()=>window.revu.panels.onRequestMerge(panel=>dock(panel)),[dock]);
  useEffect(()=>()=>{
    for(const panel of panelNames){
      if(!active.current[panel])continue;
      active.current[panel].dispose();
      delete active.current[panel];
      void window.revu.panels.close(panel);
    }
  },[]);
  const toggle=useCallback(async(panel:PanelWindow)=>{
    if(active.current[panel]?.ready){dock(panel);return;}
    if(active.current[panel]||closing.current.has(panel))return;
    let child:Window|null=null;
    try{
      child=window.open('about:blank','revu-'+panel);
      if(!child)throw new Error('Could not open the '+panel+' window.');
      const {ready,dispose}=prepareDocument(child,panel);
      const entry={window:child,ready:false,dispose};
      active.current[panel]=entry;
      // Scroll positions can only be restored once the new document has laid out its styles.
      await ready;
      if(active.current[panel]!==entry)return;
      entry.ready=true;
      flushSync(()=>{
        setWindows(current=>({...current,[panel]:entry.window}));
        onDetach(panel);
      });
      focus(panel);
    }catch(error){
      if(child&&(!active.current[panel]||active.current[panel]?.window===child)){
        active.current[panel]?.dispose();
        delete active.current[panel];
        void window.revu.panels.close(panel).catch(report);
      }
      report(error);
    }
  },[dock,focus,onDetach,report]);
  return {windows,isDetached,focus,toggle,dockAll:()=>dock(...panelNames)};
}
