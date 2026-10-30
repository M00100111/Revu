import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export default function WindowControls(){
  const [maximized,setMaximized]=useState(false);
  useEffect(()=>{
    void window.revu.windowControl('isMaximized').then(setMaximized);
    return window.revu.onMaximized(setMaximized);
  },[]);
  const control=(action:'minimize'|'maximize'|'close')=>void window.revu.windowControl(action);
  return createPortal(<div className="window-controls" aria-label="Window controls">
    <button title="Minimize" aria-label="Minimize" onClick={()=>control('minimize')}><i className="window-minimize"/></button>
    <button title={maximized?'Restore':'Maximize'} aria-label={maximized?'Restore':'Maximize'}
      onClick={()=>control('maximize')}><i className={maximized?'window-restore':'window-maximize'}/></button>
    <button className="window-close" title="Close" aria-label="Close" onClick={()=>control('close')}><i/></button>
  </div>,document.body);
}
