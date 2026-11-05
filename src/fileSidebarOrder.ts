export const OPEN_EDITORS_KEY='open-editors';

export function reconcileFileSidebarOrder(saved:readonly string[],roots:readonly string[]){
  const available=new Set([OPEN_EDITORS_KEY,...roots]);
  const seen=new Set<string>();
  const order:string[]=[];
  for(const key of saved){
    if(!available.has(key)||seen.has(key))continue;
    seen.add(key);order.push(key);
  }
  if(!seen.has(OPEN_EDITORS_KEY)){seen.add(OPEN_EDITORS_KEY);order.unshift(OPEN_EDITORS_KEY);}
  for(const root of roots){
    if(seen.has(root))continue;
    seen.add(root);order.push(root);
  }
  return order;
}

export function moveFileSidebarItem(order:readonly string[],source:string,target:string,after:boolean){
  if(source===target||!order.includes(source)||!order.includes(target))return [...order];
  const next=order.filter(key=>key!==source);
  const targetIndex=next.indexOf(target);
  next.splice(targetIndex+(after?1:0),0,source);
  return next;
}
