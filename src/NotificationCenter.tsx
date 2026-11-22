import { useEffect } from 'react';
import Icon from './Icon';

export type NotificationLevel='info'|'success'|'warning'|'error';
export interface NotificationAction {type:'open-agent-session';projectId:string;sessionId:string;runKey?:string;question?:boolean}
export interface AppNotification {
  id:string;level:NotificationLevel;message:string;createdAt:number;read:boolean;toast:boolean;count:number;
  action?:NotificationAction;
}

function Toast({notification,onClose,onActivate}:{notification:AppNotification;onClose:(id:string)=>void;onActivate:(id:string)=>void}){
  useEffect(()=>{
    if(notification.level!=='info'&&notification.level!=='success')return;
    const timer=setTimeout(()=>onClose(notification.id),5000);
    return()=>clearTimeout(timer);
  },[notification.id,notification.createdAt,notification.level,onClose]);
  return <article className={'notification-toast '+notification.level}
    role={notification.level==='error'?'alert':'status'}>
    <button className="notification-toast-body" onClick={()=>onActivate(notification.id)}>
      <span><strong>{notification.level}</strong>{notification.count>1&&<i>×{notification.count}</i>}</span>
      <p>{notification.message}</p>
    </button>
    <button className="icon-button" title="Dismiss" aria-label="Dismiss notification"
      onClick={()=>onClose(notification.id)}><Icon name="close" size={13}/></button>
  </article>;
}

export default function NotificationCenter({notifications,open,onClose,onDismissToast,onDelete,onActivate,onReadAll,onClear}:{
  notifications:AppNotification[];open:boolean;onClose:()=>void;onDismissToast:(id:string)=>void;
  onDelete:(id:string)=>void;onActivate:(id:string)=>void;onReadAll:()=>void;onClear:()=>void;
}){
  const toasts=notifications.filter(notification=>notification.toast);
  return <>
    {open&&<section className="notification-center" role="dialog" aria-label="Notifications">
      <header><strong>Notifications</strong><div>
        <button className="icon-button" title="Read all" aria-label="Read all" disabled={!notifications.some(item=>!item.read)} onClick={onReadAll}><Icon name="readAll" size={15}/></button>
        <button className="icon-button" title="Clear notifications" aria-label="Clear notifications" disabled={!notifications.length} onClick={onClear}><Icon name="clear" size={15}/></button>
        <button className="icon-button" title="Close" aria-label="Close notifications" onClick={onClose}>
          <Icon name="close" size={14}/>
        </button>
      </div></header>
      <div className="notification-list">
        {!notifications.length?<p className="notification-empty">No notifications</p>:notifications.map(notification=><article
          key={notification.id} className={'notification-item '+notification.level+(notification.read?' read':' unread')}>
          <button className="notification-item-body" onClick={()=>onActivate(notification.id)}>
            <span><strong>{notification.level}</strong>{notification.count>1&&<i>×{notification.count}</i>}
              <time>{new Date(notification.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></span>
            <p>{notification.message}</p>
          </button>
          <button className="icon-button notification-delete" title="Delete" aria-label="Delete notification"
            onClick={()=>onDelete(notification.id)}><Icon name="close" size={12}/></button>
        </article>)}
      </div>
    </section>}
    <div className="notification-toasts" aria-label="New notifications">
      {toasts.map(notification=><Toast key={notification.id} notification={notification} onClose={onDismissToast} onActivate={onActivate}/>) }
    </div>
  </>;
}
