import {useState} from 'react';

const preferenceKey='revu-chat-session-sidebar-collapsed';

export function useChatSessionSidebar(detachedWindow?:Window|null){
  const [collapsed,setCollapsed]=useState(()=>localStorage.getItem(preferenceKey)==='true');
  // AgentChat subscribes to its window's viewport, including moves between windows.
  const available=!!detachedWindow&&detachedWindow.innerWidth>=1100;
  const toggle=()=>{
    const next=!collapsed;
    localStorage.setItem(preferenceKey,String(next));
    setCollapsed(next);
  };
  return {available,visible:available&&!collapsed,toggle};
}
