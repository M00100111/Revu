const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'?value as Record<string,unknown>:{};

export const countPiSessionRuns=(entries:unknown[])=>entries.reduce<number>((total,entry)=>{
  const value=record(entry);
  return total+(value.type==='message'&&record(value.message).role==='user'?1:0);
},0);

export const calculatePiCacheHitPercent=(input:number,cacheRead:number,cacheWrite:number)=>{
  const total=input+cacheRead+cacheWrite;
  return total?cacheRead/total*100:0;
};

export const derivedPiSessionName=(source:string,kind:'Fork'|'Clone',existingNames:Iterable<string>)=>{
  const clean=source.trim()||'New Chat';
  const base=clean.replace(/ \((?:Fork|Clone)(?: \d+)?\)$/,'');
  const existing=new Set([...existingNames].map(name=>name.toLocaleLowerCase()));
  for(let index=1;;index++){
    const suffix=index===1?kind:`${kind} ${index}`;
    const candidate=`${base} (${suffix})`;
    if(!existing.has(candidate.toLocaleLowerCase()))return candidate;
  }
};
