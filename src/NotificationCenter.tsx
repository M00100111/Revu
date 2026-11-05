import { useEffect } from 'react';
import Icon from './Icon';

export type NotificationLevel='info'|'success'|'warning'|'error';
export interface AppNotification {
  id:string;level:NotificationLevel;message:string;createdAt:number;read:boolean;toast:boolean;count:number;
}

function Toast({notification,onClose}:{notification:AppNotification;onClose:(id:string)=>void}){
  useEffect(()=>{
    if(notification.level!=='info'&&notification.level!=='success')return;
    const timer=setTimeout(()=>onClose(notification.id),5000);
    return()=>clearTimeout(timer);
  },[notification.id,notification.createdAt,notification.level,onClose]);
  return <article className={'notification-toast '+notification.level}
    role={notification.level==='error'?'alert':'status'}>
    <div><strong>{notification.level}</strong>{notification.count>1&&<span>×{notification.count}</span>}</div>
    <p>{notification.message}</p>
    <button className="icon-button" title="Dismiss" aria-label="Dismiss notification"
      onClick={()=>onClose(notification.id)}><Icon name="close" size={13}/></button>
  </article>;
}

export default function NotificationCenter({notifications,open,onClose,onDismissToast,onDelete,onRead,onReadAll}:{
  notifications:AppNotification[];open:boolean;onClose:()=>void;onDismissToast:(id:string)=>void;
  onDelete:(id:string)=>void;onRead:(id:string)=>void;onReadAll:()=>void;
}){
  const toasts=notifications.filter(notification=>notification.toast);
  return <>
    {open&&<section className="notification-center" role="dialog" aria-label="Notifications">
      <header><strong>Notifications</strong><div>
        {notifications.some(item=>!item.read)&&<button className="notification-mark-read"
          onClick={onReadAll}>Read all</button>}
        <button className="icon-button" title="Close" aria-label="Close notifications" onClick={onClose}>
          <Icon name="close" size={14}/>
        </button>
      </div></header>
      <div className="notification-list">
        {!notifications.length?<p className="notification-empty">No notifications</p>:notifications.map(notification=><article
          key={notification.id} className={'notification-item '+notification.level+(notification.read?' read':' unread')}>
          <button className="notification-item-body" onClick={()=>onRead(notification.id)}>
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
      {toasts.map(notification=><Toast key={notification.id} notification={notification} onClose={onDismissToast}/>) }
    </div>
  </>;
}
