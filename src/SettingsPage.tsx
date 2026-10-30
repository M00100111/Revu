import ResizeHandle from './ResizeHandle';

export function SettingsSidebar({width,onResize}:{width:number;onResize:(width:number)=>void}){
  return <aside className="explorer" style={{width}}>
    <header className="explorer-header"><span>Settings</span></header>
    <nav className="settings-categories" aria-label="Settings categories">
      <button className="active">Interaction</button>
    </nav>
    <ResizeHandle width={width} onResize={onResize}/>
  </aside>;
}

export default function SettingsPage({syncWidths,onChange,mixed,onModeChange}:{
  syncWidths:boolean;onChange:(value:boolean)=>void;mixed:boolean;onModeChange:(mixed:boolean)=>void;
}){
  return <main className="main settings-main">
    <div className="settings-content">
      <h1>Interaction</h1>
      <label className="setting-row">
        <span><strong>Sync sidebar widths</strong><small>Use the same width for File, Review, and Settings.</small></span>
        <input type="checkbox" checked={syncWidths} onChange={event=>onChange(event.target.checked)}/>
      </label>
      <div className="setting-row">
        <span><strong>Editor tab mode</strong><small>Keep file tabs separated by project or show them together.</small></span>
        <div className="setting-options" role="group" aria-label="Editor tab mode">
          <button className={!mixed?'active':''} onClick={()=>onModeChange(false)}>Isolated</button>
          <button className={mixed?'active':''} onClick={()=>onModeChange(true)}>Mixed</button>
        </div>
      </div>
    </div>
  </main>;
}
