export interface FileTabs {
  ids:string[];
  // Most recently activated preview first.
  previews:string[];
}

export type FileTabAction =
  | {type:'open';id:string;mode:'preview'|'keep'|'select';projectId:string;mixed:boolean}
  | {type:'activate'|'keep';id:string}
  | {type:'remove';ids:ReadonlySet<string>};

export function updateFileTabs(state:FileTabs,action:FileTabAction):FileTabs {
  if(action.type==='remove')return {
    ids:state.ids.filter(id=>!action.ids.has(id)),
    previews:state.previews.filter(id=>!action.ids.has(id)),
  };
  const {id}=action;
  if(action.type!=='open'||state.ids.includes(id)){
    if(!state.previews.includes(id))return state;
    const remaining=state.previews.filter(item=>item!==id);
    if(action.type==='keep'||action.type==='open'&&action.mode==='keep')return {...state,previews:remaining};
    return state.previews[0]===id?state:{...state,previews:[id,...remaining]};
  }
  if(action.mode!=='preview')return {...state,ids:[...state.ids,id]};
  const replaced=state.previews.find(item=>action.mixed||item.startsWith(action.projectId+'/'));
  return {
    ids:replaced?state.ids.map(item=>item===replaced?id:item):[...state.ids,id],
    previews:[id,...state.previews.filter(item=>item!==replaced)],
  };
}

export function fileMenuTargets<T extends {id:string;groupId:string|null}>(
  tabs:T[],target:T,action:'close'|'closeOthers'|'closeAll',mixed:boolean,
){
  if(action==='close')return [target];
  return tabs.filter(tab=>(mixed||tab.groupId===target.groupId)&&(action==='closeAll'||tab.id!==target.id));
}
