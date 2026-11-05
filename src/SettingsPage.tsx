import ResizeHandle from './ResizeHandle';

export type SettingsCategory='interaction'|'editor';

export function SettingsSidebar({width,onResize,category,onCategoryChange}:{
  width:number;onResize:(width:number)=>void;category:SettingsCategory;
  onCategoryChange:(category:SettingsCategory)=>void;
}){
  return <aside className="explorer" style={{width}}>
    <header className="explorer-header"><span>Settings</span></header>
    <nav className="settings-categories" aria-label="Settings categories">
      <button className={category==='interaction'?'active':''} onClick={()=>onCategoryChange('interaction')}>Interaction</button>
      <button className={category==='editor'?'active':''} onClick={()=>onCategoryChange('editor')}>Editor</button>
    </nav>
    <ResizeHandle width={width} onResize={onResize}/>
  </aside>;
}

export default function SettingsPage({category,syncWidths,onChange,mixed,onModeChange,hideSingleProjectTabs,onHideSingleProjectTabsChange,fontFamily,fontSize,
  onFontFamilyChange,onFontSizeChange,onResetEditor}:{
  category:SettingsCategory;syncWidths:boolean;onChange:(value:boolean)=>void;
  mixed:boolean;onModeChange:(mixed:boolean)=>void;hideSingleProjectTabs:boolean;
  onHideSingleProjectTabsChange:(value:boolean)=>void;fontFamily:string;fontSize:number;
  onFontFamilyChange:(value:string)=>void;onFontSizeChange:(value:number)=>void;onResetEditor:()=>void;
}){
  return <main className="main settings-main">
    <div className="settings-content">
      {category==='interaction'?<>
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
        <label className={'setting-row '+(mixed?'disabled':'')}>
          <span><strong>Hide project tabs for single project</strong><small>{mixed
            ? 'Available only in Isolated mode.'
            : 'Hide the project tab row when only one project is open.'}</small></span>
          <input type="checkbox" checked={hideSingleProjectTabs} disabled={mixed}
            onChange={event=>onHideSingleProjectTabsChange(event.target.checked)}/>
        </label>
      </>:<>
        <div className="settings-title-row"><h1>Editor</h1><button onClick={onResetEditor}>Reset</button></div>
        <label className="setting-row">
          <span><strong>Font family</strong><small>Use a CSS font family or fallback list for code.</small></span>
          <input className="setting-text-input" value={fontFamily}
            onChange={event=>onFontFamilyChange(event.target.value)} spellCheck={false}/>
        </label>
        <label className="setting-row">
          <span><strong>Font size</strong><small>Set the editor font size from 10 to 24 pixels.</small></span>
          <input className="setting-number-input" type="number" min={10} max={24} step={1} value={fontSize}
            onChange={event=>{const value=Number(event.target.value);if(Number.isFinite(value))onFontSizeChange(value);}}/>
        </label>
        <div className="font-preview" style={{fontFamily,fontSize}}>const preview = 'Revu';</div>
      </>}
    </div>
  </main>;
}
