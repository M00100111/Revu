import Icon from './Icon';
export type Panel='files'|'review'|'settings'|null;
export default function Sidebar({ panel, setPanel, dark, toggleTheme,showThemeSwitcher,agentOpen,toggleAgent,notificationCount,notificationsOpen,toggleNotifications,
  chatAtTop,showDock,onDockAll,reviewDetached,chatDetached,onFocusReview,onFocusChat }: {
  panel:Panel; setPanel:(panel:Panel)=>void;
  dark:boolean;toggleTheme:()=>void;showThemeSwitcher:boolean;
  chatAtTop:boolean;agentOpen:boolean;toggleAgent:()=>void;
  notificationCount:number;notificationsOpen:boolean;toggleNotifications:()=>void;
  showDock?:boolean;onDockAll?:()=>void;reviewDetached?:boolean;chatDetached?:boolean;onFocusReview?:()=>void;onFocusChat?:()=>void;
}) {
  const chat=<button className="activity-button activity-chat" title="Chat" aria-label="Chat"
    aria-pressed={chatDetached?undefined:agentOpen} onClick={chatDetached?onFocusChat:toggleAgent}>
    <Icon name="agent" size={21}/></button>;
  return <nav className="activity-bar" aria-label="Activity bar">
    <div className="activity-top">
      {chatAtTop&&chat}
      <button className={'activity-button '+(panel==='files'?'selected':'')} title="File"
        aria-label="File" aria-pressed={panel==='files'} onClick={()=>setPanel(panel==='files'?null:'files')}>
        <Icon name="files" size={21}/></button>
      <button className={'activity-button '+(panel==='review'?'selected':'')} title="Review"
        aria-label="Review" aria-pressed={reviewDetached?undefined:panel==='review'} onClick={reviewDetached?onFocusReview:()=>setPanel(panel==='review'?null:'review')}>
        <Icon name="review" size={21}/></button>
    </div>
    <div className="activity-footer">
      {showDock&&<button className="activity-button" title="Merge all windows" aria-label="Merge all windows" onClick={onDockAll}>
        <Icon name="dock" size={21}/></button>}
      {!chatAtTop&&chat}
      <button className={'activity-button '+(notificationsOpen?'selected':'')} title="Notifications"
        aria-label={`Notifications${notificationCount?` (${notificationCount} unread)`:''}`}
        aria-pressed={notificationsOpen} onClick={toggleNotifications}>
        <Icon name="notifications" size={21}/>{notificationCount>0&&<span className="notification-badge">
          {notificationCount>99?'99+':notificationCount}</span>}
      </button>
      {showThemeSwitcher&&<button className="activity-button" title={dark?'Use light theme':'Use dark theme'}
        aria-label={dark?'Use light theme':'Use dark theme'} onClick={toggleTheme}>
        <Icon name={dark?'sun':'moon'} size={21}/></button>}
      <button className={'activity-button '+(panel==='settings'?'selected':'')} title="Settings"
        aria-label="Settings" aria-pressed={panel==='settings'} onClick={()=>setPanel(panel==='settings'?null:'settings')}>
        <Icon name="settings" size={24}/></button>
    </div>
  </nav>;
}
