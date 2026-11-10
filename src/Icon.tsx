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
  restore:new URL('../assets/icons/application/restore.svg',import.meta.url).href,
  save:new URL('../assets/icons/application/save.svg',import.meta.url).href,
  collapse:new URL('../assets/icons/chat/collapseInput.svg',import.meta.url).href,
  copy:new URL('../assets/icons/chat/copy.svg',import.meta.url).href,
  mention:new URL('../assets/icons/chat/@.svg',import.meta.url).href,
  chatFile:new URL('../assets/icons/chat/files.svg',import.meta.url).href,
  chatFolder:new URL('../assets/icons/chat/folder.svg',import.meta.url).href,
  expand:new URL('../assets/icons/chat/expandInput.svg',import.meta.url).href,
  fork:new URL('../assets/icons/chat/fork.svg',import.meta.url).href,
  tree:new URL('../assets/icons/chat/tree.svg',import.meta.url).href,
  format:new URL('../assets/icons/chat/format.svg',import.meta.url).href,
  image:new URL('../assets/icons/chat/image.svg',import.meta.url).href,
  send:new URL('../assets/icons/chat/send.svg',import.meta.url).href,
  stop:new URL('../assets/icons/chat/stop.svg',import.meta.url).href,
  thought:new URL('../assets/icons/chat/thought.svg',import.meta.url).href,
  retry:new URL('../assets/icons/chat/retry.svg',import.meta.url).href,
  pi:new URL('../assets/icons/chat/pi.svg',import.meta.url).href,
  add:new URL('../assets/icons/common/add.svg',import.meta.url).href,
  close:new URL('../assets/icons/common/close.svg',import.meta.url).href,
  check:new URL('../assets/icons/common/check.svg',import.meta.url).href,
  down:new URL('../assets/icons/common/down.svg',import.meta.url).href,
  detail:new URL('../assets/icons/common/detail.svg',import.meta.url).href,
  more:new URL('../assets/icons/common/more.svg',import.meta.url).href,
  sessionSettings:new URL('../assets/icons/common/settings.svg',import.meta.url).href,
  editorDocument:new URL('../assets/icons/editor/document.svg',import.meta.url).href,
  projectFolder:new URL('../assets/icons/editor/folder.svg',import.meta.url).href,
  file:new URL('../assets/icons/file/files.svg',import.meta.url).href,
  folder:new URL('../assets/icons/file/folder.svg',import.meta.url).href,
  openFolder:new URL('../assets/icons/file/openFolder.svg',import.meta.url).href,
  merge:new URL('../assets/icons/review/mergeReviewPanes.svg',import.meta.url).href,
  split:new URL('../assets/icons/review/splitReviewPanes.svg',import.meta.url).href,
} as const;

export type IconName=keyof typeof assets;

export default function Icon({name,size=18,style}:{name:IconName;size?:number;style?:CSSProperties}){
  const source=assets[name];
  if(name==='pi')return <img className="app-icon pi-icon" src={source} alt="" aria-hidden="true"
    style={{width:size,height:size,display:'block',flexShrink:0,...style}}/>;
  return <span className="app-icon" aria-hidden="true" style={{
    width:size,height:size,display:'inline-block',flexShrink:0,backgroundColor:'currentColor',
    WebkitMaskImage:`url("${source}")`,maskImage:`url("${source}")`,
    WebkitMaskPosition:'center',maskPosition:'center',WebkitMaskRepeat:'no-repeat',maskRepeat:'no-repeat',
    WebkitMaskSize:'contain',maskSize:'contain',...style,
  }}/>;
}
