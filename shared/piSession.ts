const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'?value as Record<string,unknown>:{};

export function piSessionProjectKey(cwd:string){
  const windowsDrive=/^[A-Za-z]:[\\/]/.test(cwd);
  const path=windowsDrive||cwd.startsWith('\\\\')?cwd.replace(/\\/g,'/'):cwd;
  const key=path.replace(/\/+$/,'');
  if(windowsDrive)return (key.length===2?key+'/':key).toLowerCase();
  return key||path;
}

export const countPiSessionRuns=(entries:unknown[])=>entries.reduce<number>((total,entry)=>{
  const value=record(entry);
  return total+(value.type==='message'&&record(value.message).role==='user'?1:0);
},0);

export const calculatePiCacheHitPercent=(input:number,cacheRead:number,cacheWrite:number)=>{
  const total=input+cacheRead+cacheWrite;
  return total?cacheRead/total*100:0;
};

const reservedPiSessionNameSuffix=/\((?:Fork|Clone)(?:\s+\d+)?\)$/i;
export const isReservedPiSessionName=(name:string)=>reservedPiSessionNameSuffix.test(name.trim());

export const derivedPiSessionName=(source:string,kind:'Fork'|'Clone',existingNames:Iterable<string>)=>{
  const clean=source.trim()||'New Chat';
  const base=clean.replace(/\s+\((?:Fork|Clone)(?:\s+\d+)?\)$/i,'');
  const existing=new Set([...existingNames].map(name=>name.toLocaleLowerCase()));
  for(let index=1;;index++){
    const suffix=index===1?kind:`${kind} ${index}`;
    const candidate=`${base} (${suffix})`;
    if(!existing.has(candidate.toLocaleLowerCase()))return candidate;
  }
};

export interface ThreadedPiSession<T> {session:T;depth:number;isLast:boolean;ancestorContinues:boolean[]}

export const threadPiSessions=<T extends {id:string;parentSessionId?:string;modifiedAt:number}>(sessions:T[]):ThreadedPiSession<T>[]=>{
  interface Node {session:T;children:Node[];latestActivity:number}
  const byId=new Map(sessions.map(session=>[session.id,{session,children:[],latestActivity:session.modifiedAt} as Node]));
  const roots:Node[]=[];
  for(const session of sessions){const node=byId.get(session.id)!;const parent=session.parentSessionId?byId.get(session.parentSessionId):undefined;
    if(parent&&parent!==node)parent.children.push(node);else roots.push(node);}
  const update=(node:Node):number=>{node.latestActivity=Math.max(node.session.modifiedAt,...node.children.map(update));return node.latestActivity;};
  const sort=(nodes:Node[])=>{nodes.sort((a,b)=>b.latestActivity-a.latestActivity);for(const node of nodes)sort(node.children);};
  roots.forEach(update);sort(roots);
  const result:ThreadedPiSession<T>[]=[];
  const walk=(node:Node,depth:number,ancestorContinues:boolean[],isLast:boolean)=>{result.push({session:node.session,depth,isLast,ancestorContinues});
    const childAncestors=depth===0?[]:[...ancestorContinues,!isLast];
    node.children.forEach((child,index)=>walk(child,depth+1,childAncestors,index===node.children.length-1));};
  roots.forEach((root,index)=>walk(root,0,[],index===roots.length-1));return result;
};
