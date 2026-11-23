import {useCallback} from 'react';

export function useFileTreeReveal(target?:{fromEditor?:boolean;token:number}){
  return useCallback((row:HTMLElement|null)=>{
    if(!row)return;
    if(!target?.fromEditor){
      row.scrollIntoView({block:'nearest'});
      return;
    }
    const list=row.closest<HTMLElement>('.tree-scroll');
    if(!list)return;
    const bounds=row.getBoundingClientRect();
    const top=list.scrollTop+bounds.top-list.getBoundingClientRect().top-list.clientTop;
    const halfHeight=list.clientHeight/2;
    const desired=top<halfHeight?top+bounds.height/2-halfHeight:top;
    list.scrollTop=Math.max(0,Math.min(desired,list.scrollHeight-list.clientHeight));
  },[target]);
}
