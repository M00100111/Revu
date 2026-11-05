import Icon from './Icon';
export type Panel='files'|'review'|'settings'|null;
export default function Sidebar({ panel, setPanel, dark, toggleTheme,showThemeSwitcher,notificationCount,notificationsOpen,toggleNotifications }: {
  panel:Panel; setPanel:(panel:Panel)=>void;
  dark:boolean;toggleTheme:()=>void;showThemeSwitcher:boolean;
  notificationCount:number;notificationsOpen:boolean;toggleNotifications:()=>void;
}) {
  return <nav className="activity-bar" aria-label="Activity bar">
    <div className="brand" title="Revu">r.</div>
    <button className={'activity-button '+(panel==='files'?'selected':'')} title="File"
      aria-label="File" aria-pressed={panel==='files'} onClick={()=>setPanel(panel==='files'?null:'files')}>
      <Icon name="files" size={21}/></button>
    <button className={'activity-button '+(panel==='review'?'selected':'')} title="Review Dashboard"
      aria-label="Review Dashboard" aria-pressed={panel==='review'} onClick={()=>setPanel(panel==='review'?null:'review')}>
      <Icon name="review" size={21}/></button>
    <div className="activity-footer">
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
        <Icon name="settings" size={21}/></button>
    </div>
  </nav>;
}
