import ChatRuntimeSettings from './ChatRuntimeSettings';
import {ChatToolbarSettings,type useChatToolbarSettings} from './ChatToolbarSettings';
import { useEffect, useState } from 'react';
import ResizeHandle from './ResizeHandle';
import type { FileTabOverflow } from './tabLayout';

export type SettingsCategory='file'|'interaction'|'editor'|'review'|'appearance'|'activity-bar'|'chat';
export type ReviewFileLabels='name'|'path';

function FontSizeSetting({fontSize,onChange}:{fontSize:number;onChange:(value:number)=>void}){
  const [draft,setDraft]=useState(String(fontSize));
  useEffect(()=>setDraft(String(fontSize)),[fontSize]);
  const commit=()=>{
    const value=Number(draft);
    if(!/^\d+$/.test(draft)||!Number.isInteger(value)||value<10||value>24){
      setDraft(String(fontSize));return;
    }
    onChange(value);setDraft(String(value));
  };
  return <input className="setting-number-input" type="text" inputMode="numeric" value={draft}
    aria-label="Font size" onChange={event=>{if(/^\d{0,2}$/.test(event.target.value))setDraft(event.target.value);}}
    onBlur={commit} onKeyDown={event=>{
      if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}
    }}/>;
}

function ThemeColorSetting({value,label,onChange}:{value:string;label:string;onChange:(value:string)=>void}){
  const [draft,setDraft]=useState(value);
  useEffect(()=>setDraft(value),[value]);
  const commit=()=>{
    const next=draft.toUpperCase();
    if(!/^#[0-9A-F]{6}$/.test(next)){setDraft(value);return;}
    onChange(next);setDraft(next);
  };
  return <div className="theme-color-setting">
    <i style={{background:value}}/>
    <input className="setting-text-input" type="text" value={draft} maxLength={7} aria-label={label}
      spellCheck={false} onChange={event=>{const next=event.target.value.toUpperCase();setDraft(next);if(/^#[0-9A-F]{6}$/.test(next))onChange(next);}} onBlur={commit}
      onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}}}/>
  </div>;
}

export function SettingsSidebar({width,onResize,category,onCategoryChange}:{
  width:number;onResize:(width:number)=>void;category:SettingsCategory;
  onCategoryChange:(category:SettingsCategory)=>void;
}){
  return <aside className="explorer" style={{width}}>
    <header className="explorer-header"><span>Settings</span></header>
    <nav className="settings-categories" aria-label="Settings categories">
      <button className={category==='interaction'?'active':''} onClick={()=>onCategoryChange('interaction')}>Interaction</button>
      <button className={category==='appearance'?'active':''} onClick={()=>onCategoryChange('appearance')}>Appearance</button>
      <button className={category==='activity-bar'?'active':''} onClick={()=>onCategoryChange('activity-bar')}>Activity Bar</button>
      <button className={category==='file'?'active':''} onClick={()=>onCategoryChange('file')}>File</button>
      <button className={category==='editor'?'active':''} onClick={()=>onCategoryChange('editor')}>Editor</button>
      <button className={category==='review'?'active':''} onClick={()=>onCategoryChange('review')}>Review</button>
      <button className={category==='chat'?'active':''} onClick={()=>onCategoryChange('chat')}>Chat</button>
    </nav>
    <ResizeHandle width={width} onResize={onResize}/>
  </aside>;
}

export default function SettingsPage({revealEditorSelection,onRevealEditorSelectionChange,category,chatToolbar,syncWidths,onChange,mixed,onModeChange,hideSingleProjectTabs,onHideSingleProjectTabsChange,fontSize,
  onFontSizeChange,onResetEditor,previewMode,onPreviewModeChange,fileTabOverflow,onFileTabOverflowChange,reviewFileLabels,onReviewFileLabelsChange,dark,onThemeChange,
  showThemeSwitcher,onShowThemeSwitcherChange,showDockButton,onShowDockButtonChange,lightThemeColor,darkThemeColor,onLightThemeColorChange,onDarkThemeColorChange,onResetThemeColors}:{
  revealEditorSelection:boolean;onRevealEditorSelectionChange:(value:boolean)=>void;
  category:SettingsCategory;syncWidths:boolean;onChange:(value:boolean)=>void;
  chatToolbar:ReturnType<typeof useChatToolbarSettings>;
  mixed:boolean;onModeChange:(mixed:boolean)=>void;hideSingleProjectTabs:boolean;
  onHideSingleProjectTabsChange:(value:boolean)=>void;fontSize:number;
  onFontSizeChange:(value:number)=>void;onResetEditor:()=>void;
  previewMode:boolean;onPreviewModeChange:(value:boolean)=>void;
  fileTabOverflow:FileTabOverflow;onFileTabOverflowChange:(value:FileTabOverflow)=>void;
  reviewFileLabels:ReviewFileLabels;onReviewFileLabelsChange:(value:ReviewFileLabels)=>void;
  dark:boolean;onThemeChange:(dark:boolean)=>void;showThemeSwitcher:boolean;onShowThemeSwitcherChange:(value:boolean)=>void;
  showDockButton?:boolean;onShowDockButtonChange?:(value:boolean)=>void;
  lightThemeColor:string;darkThemeColor:string;onLightThemeColorChange:(value:string)=>void;
  onDarkThemeColorChange:(value:string)=>void;onResetThemeColors:()=>void;
}){
  return <main className="main settings-main">
    <div className="settings-content">
      {category==='interaction'?<>
        <h1>Interaction</h1>
        <label className="setting-row">
          <span><strong>Sync sidebar widths</strong><small>Use the same width for File, Review, and Settings.</small></span>
          <input type="checkbox" checked={syncWidths} onChange={event=>onChange(event.target.checked)}/>
        </label>
      </>:category==='file'?<>
        <h1>File</h1>
        <label className="setting-row">
          <span><strong>Reveal Editor Selection in File</strong><small>When File is visible, selecting an editor tab reveals its project or file. Tabs in Other reveal Open Editors.</small></span>
          <input type="checkbox" checked={revealEditorSelection} onChange={event=>onRevealEditorSelectionChange(event.target.checked)}/>
        </label>
      </>:category==='editor'?<>
        <div className="settings-title-row"><h1>Editor</h1><button onClick={onResetEditor}>Reset</button></div>
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
        <div className="setting-row">
          <span><strong>File tab overflow</strong><small>Choose how file tabs behave when they no longer fit.</small></span>
          <div className="setting-options" role="group" aria-label="File tab overflow">
            <button className={fileTabOverflow==='scroll'?'active':''} onClick={()=>onFileTabOverflowChange('scroll')}>Scroll</button>
            <button className={fileTabOverflow==='wrap'?'active':''} onClick={()=>onFileTabOverflowChange('wrap')}>Wrap automatically</button>
          </div>
        </div>
        <div className="setting-row">
          <span><strong>File Open Mode</strong><small>Choose how files open from the file tree.</small></span>
          <div className="setting-options" role="group" aria-label="File Open Mode">
            <button aria-pressed={previewMode} className={previewMode?'active':''} onClick={()=>onPreviewModeChange(true)}>Preview</button>
            <button aria-pressed={!previewMode} className={!previewMode?'active':''} onClick={()=>onPreviewModeChange(false)}>Keep Open</button>
          </div>
        </div>
        <label className="setting-row">
          <span><strong>Font size</strong><small>Set the editor font size from 10 to 24 pixels.</small></span>
          <FontSizeSetting fontSize={fontSize} onChange={onFontSizeChange}/>
        </label>
        <div className="font-preview" style={{fontSize}}>const preview = 'Revu';</div>
      </>:category==='review'?<>
        <h1>Review</h1>
        <div className="setting-row">
          <span><strong>Changed file labels</strong><small>Choose how changed files are labeled in Review.</small></span>
          <div className="setting-options" role="group" aria-label="Changed file labels">
            <button className={reviewFileLabels==='name'?'active':''}
              onClick={()=>onReviewFileLabelsChange('name')}>File name only</button>
            <button className={reviewFileLabels==='path'?'active':''}
              onClick={()=>onReviewFileLabelsChange('path')}>Relative path</button>
          </div>
        </div>
      </>:category==='appearance'?<>
        <div className="settings-title-row"><h1>Appearance</h1><button onClick={onResetThemeColors}>Reset</button></div>
        <div className="setting-row">
          <span><strong>Color theme</strong><small>Choose the application color theme.</small></span>
          <div className="setting-options" role="group" aria-label="Color theme">
            <button className={!dark?'active':''} onClick={()=>onThemeChange(false)}>Light</button>
            <button className={dark?'active':''} onClick={()=>onThemeChange(true)}>Dark</button>
          </div>
        </div>
        <div className="setting-row">
          <span><strong>Light theme color</strong><small>Set the light theme background using #RRGGBB.</small></span>
          <ThemeColorSetting value={lightThemeColor} label="Light theme color" onChange={onLightThemeColorChange}/>
        </div>
        <div className="setting-row">
          <span><strong>Dark theme color</strong><small>Set the dark theme background using #RRGGBB.</small></span>
          <ThemeColorSetting value={darkThemeColor} label="Dark theme color" onChange={onDarkThemeColorChange}/>
        </div>
      </>:category==='chat'?<>
        <ChatRuntimeSettings/>
        <ChatToolbarSettings {...chatToolbar}/>
      </>:<>
        <h1>Activity Bar</h1>
        <label className="setting-row">
          <span><strong>Merge all windows</strong><small>Show a shortcut when Chat or Review is in a separate window.</small></span>
          <input type="checkbox" checked={showDockButton??true}
            onChange={event=>onShowDockButtonChange?.(event.target.checked)}/>
        </label>
        <label className="setting-row">
          <span><strong>Theme switcher</strong><small>Show the theme switcher in the Activity Bar.</small></span>
          <input type="checkbox" checked={showThemeSwitcher}
            onChange={event=>onShowThemeSwitcherChange(event.target.checked)}/>
        </label>
      </>}
    </div>
  </main>;
}
