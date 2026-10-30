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

export default function SettingsPage({syncWidths,onChange}:{syncWidths:boolean;onChange:(value:boolean)=>void}){
  return <main className="main settings-main">
    <div className="settings-content">
      <h1>Interaction</h1>
      <label className="setting-row">
        <span><strong>Sync sidebar widths</strong><small>Use the same width for File, Review, and Settings.</small></span>
        <input type="checkbox" checked={syncWidths} onChange={event=>onChange(event.target.checked)}/>
      </label>
    </div>
  </main>;
}
