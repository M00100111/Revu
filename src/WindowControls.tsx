import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

export default function WindowControls({onSave,saveDisabled,saving}:{
  onSave:()=>void;saveDisabled:boolean;saving:boolean;
}){
  const [maximized,setMaximized]=useState(false);
  useEffect(()=>{
    void window.revu.windowControl('isMaximized').then(setMaximized);
    return window.revu.onMaximized(setMaximized);
  },[]);
  const control=(action:'minimize'|'maximize'|'close')=>void window.revu.windowControl(action);
  return createPortal(<div className="window-controls" aria-label="Window controls">
    <button className="window-save" title={saving?'Saving file':'Save file · Ctrl+S'}
      aria-label={saving?'Saving file':'Save file'} disabled={saveDisabled} onClick={onSave}>
      <Icon name="save" size={11}/>
    </button>
    <button className="window-minimize" title="Minimize" aria-label="Minimize" onClick={()=>control('minimize')}><Icon name="minimize" size={11}/></button>
    <button className="window-maximize" title={maximized?'Restore':'Maximize'} aria-label={maximized?'Restore':'Maximize'}
      onClick={()=>control('maximize')}><Icon name={maximized?'restore':'maximize'} size={11}/></button>
    <button className="window-close" title="Close" aria-label="Close" onClick={()=>control('close')}><Icon name="close" size={10}/></button>
  </div>,document.body);
}
