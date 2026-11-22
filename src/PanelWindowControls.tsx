import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PanelWindow } from '../shared/panelWindows';
import Icon from './Icon';

export default function PanelWindowControls({panel,targetWindow}:{panel:PanelWindow;targetWindow:Window}){
  const [maximized,setMaximized]=useState(false);
  useEffect(()=>{
    let pending=true;
    const unsubscribe=window.revu.panels.onMaximized((changed,value)=>{
      if(changed===panel){pending=false;setMaximized(value);}
    });
    void window.revu.panels.control(panel,'isMaximized').then(value=>{if(pending)setMaximized(value);});
    return ()=>{pending=false;unsubscribe();};
  },[panel,targetWindow]);
  const maximizeLabel=maximized?'Restore':'Maximize';
  return createPortal(<div className="window-controls panel-window-controls" aria-label="Window controls">
    <button title="Minimize" aria-label="Minimize" onClick={()=>void window.revu.panels.control(panel,'minimize')}>
      <Icon name="minimize" size={11}/>
    </button>
    <button title={maximizeLabel} aria-label={maximizeLabel} onClick={()=>void window.revu.panels.control(panel,'maximize')}>
      <Icon name={maximized?'restore':'maximize'} size={11}/>
    </button>
    <button className="window-close" title="Close and return to main window" aria-label="Close" onClick={()=>void window.revu.panels.control(panel,'close')}>
      <Icon name="close" size={10}/>
    </button>
  </div>,targetWindow.document.body);
}
