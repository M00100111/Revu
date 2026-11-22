import {useEffect,useMemo,useState} from 'react';
import type {PiSessionScope,PiSessionSearchResult,PiSessionSort,PiSessionSummary} from '../shared/piTypes';

export function savedSessionSort():PiSessionSort{
  const sort=localStorage.getItem('revu-session-sort');
  return sort==='recent'||sort==='relevance'?sort:'threaded';
}

export function useSessionSearch(projectId:string,scope:PiSessionScope,sort:PiSessionSort|undefined,sessions:readonly PiSessionSummary[]){
  const [query,setQuery]=useState('');
  const trimmedQuery=query.trim();
  const searchSort=sort??(trimmedQuery?savedSessionSort():'recent');
  const request=useMemo(()=>({projectId,scope,sort:searchSort,query:trimmedQuery}),[projectId,scope,searchSort,trimmedQuery]);
  const [response,setResponse]=useState<{request:typeof request;items:PiSessionSearchResult[]}>();
  useEffect(()=>{
    if(!request.query||!request.projectId)return;
    let current=true;
    const timer=setTimeout(async()=>{
      try{
        const result=await window.revu.agent.searchSessions(request.projectId,request.query,request.sort,request.scope);
        if(current)setResponse({request,items:result.ok?result.value??[]:[]});
      }catch{if(current)setResponse({request,items:[]});}
    },150);
    return ()=>{current=false;clearTimeout(timer);};
  },[request,sessions]);
  const loaded=response?.request===request;
  return {query,setQuery,trimmedQuery,results:loaded?response.items:[],searching:!!projectId&&!!trimmedQuery&&!loaded};
}

export function SessionSearchInput({query,setQuery}:{query:string;setQuery:(value:string)=>void}){
  return <input value={query} onChange={event=>setQuery(event.target.value)}
    placeholder="Search conversations..." aria-label="Search conversations"/>;
}

export function sessionDateGroups(sessions:readonly PiSessionSummary[]){
  const today=new Date();
  today.setHours(0,0,0,0);
  const yesterday=new Date(today),weekStart=new Date(today);
  yesterday.setDate(yesterday.getDate()-1);
  weekStart.setDate(weekStart.getDate()-6);
  const groups:{label:string;since:number;items:PiSessionSummary[]}[]=[
    {label:'Today',since:today.getTime(),items:[]},
    {label:'Yesterday',since:yesterday.getTime(),items:[]},
    {label:'Previous 7 Days',since:weekStart.getTime(),items:[]},
    {label:'Older',since:-Infinity,items:[]},
  ];
  for(const session of sessions){
    const group=groups.find(group=>session.modifiedAt>=group.since);
    group?.items.push(session);
  }
  return groups.filter(group=>group.items.length);
}

export const canCloneOrExportSession=(session:PiSessionSummary)=>
  (session.status==='idle'||session.status==='error')&&session.hasSessionFile!==false&&!session.isCompacting&&!session.question;
