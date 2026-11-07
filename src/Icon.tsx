import type { CSSProperties } from 'react';

const assets={
  review:new URL('../assets/icons/activity-bar/review.svg',import.meta.url).href,
  files:new URL('../assets/icons/activity-bar/files.svg',import.meta.url).href,
  sun:new URL('../assets/icons/activity-bar/sun.svg',import.meta.url).href,
  moon:new URL('../assets/icons/activity-bar/moon.svg',import.meta.url).href,
  notifications:new URL('../assets/icons/activity-bar/notifications.svg',import.meta.url).href,
  settings:new URL('../assets/icons/activity-bar/settings.svg',import.meta.url).href,
  agent:new URL('../assets/icons/activity-bar/chat.svg',import.meta.url).href,
  minimize:new URL('../assets/icons/application/minimize.svg',import.meta.url).href,
  maximize:new URL('../assets/icons/application/maximize.svg',import.meta.url).href,
  save:new URL('../assets/icons/application/save.svg',import.meta.url).href,
  collapse:new URL('../assets/icons/chat/collapseInput.svg',import.meta.url).href,
  copy:new URL('../assets/icons/chat/copy.svg',import.meta.url).href,
  expand:new URL('../assets/icons/chat/expandInput.svg',import.meta.url).href,
  fork:new URL('../assets/icons/chat/fork.svg',import.meta.url).href,
  format:new URL('../assets/icons/chat/format.svg',import.meta.url).href,
  image:new URL('../assets/icons/chat/image.svg',import.meta.url).href,
  send:new URL('../assets/icons/chat/send.svg',import.meta.url).href,
  stop:new URL('../assets/icons/chat/stop.svg',import.meta.url).href,
  think:new URL('../assets/icons/chat/think.svg',import.meta.url).href,
  close:new URL('../assets/icons/common/close.svg',import.meta.url).href,
  projectFolder:new URL('../assets/icons/editor/folder.svg',import.meta.url).href,
  file:new URL('../assets/icons/file/document.svg',import.meta.url).href,
  folder:new URL('../assets/icons/file/folder.svg',import.meta.url).href,
  openFolder:new URL('../assets/icons/file/openFolder.svg',import.meta.url).href,
  merge:new URL('../assets/icons/review/mergeReviewPanes.svg',import.meta.url).href,
  split:new URL('../assets/icons/review/splitReviewPanes.svg',import.meta.url).href,
} as const;

const paths={
  chevron:'m9 6 6 6-6 6',
  plus:'M12 5v14M5 12h14',
  edit:'m4 20 4-1 11-11-3-3L5 16l-1 4ZM14 7l3 3',
  trash:'M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6',
} as const;

export type IconName=keyof typeof assets|keyof typeof paths;

export default function Icon({name,size=18,style}:{name:IconName;size?:number;style?:CSSProperties}){
  const source=(assets as Partial<Record<IconName,string>>)[name];
  if(source)return <span className="app-icon" aria-hidden="true" style={{
    width:size,height:size,display:'inline-block',flexShrink:0,backgroundColor:'currentColor',
    WebkitMaskImage:`url("${source}")`,maskImage:`url("${source}")`,
    WebkitMaskPosition:'center',maskPosition:'center',WebkitMaskRepeat:'no-repeat',maskRepeat:'no-repeat',
    WebkitMaskSize:'contain',maskSize:'contain',...style,
  }}/>;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
    <path d={paths[name as keyof typeof paths]}/>
  </svg>;
}
