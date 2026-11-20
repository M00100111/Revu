import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {PiExtensionReply,PiExtensionRequest} from '../shared/piTypes';
import Icon from './Icon';

export function ExtensionQuestionnaire({requests,active,onReply}:{requests:PiExtensionRequest[];active:boolean;onReply:(id:string,reply:PiExtensionReply)=>Promise<void>}){
  const [currentId,setCurrentId]=useState(requests[0].id);
  const [sending,setSending]=useState(false);
  const answers=useRef(new Map<string,PiExtensionReply>());
  const submitting=useRef(false);
  const first=requests[0];
  if(!first.group)return <ExtensionInput request={first} active={active} onReply={reply=>onReply(first.id,reply)}/>;
  const group=requests.filter(request=>request.group?.id===first.group!.id);
  const index=Math.max(0,group.findIndex(request=>request.id===currentId));
  const last=group[index].group?.index===first.group.total-1;
  const answer=async(request:PiExtensionRequest,reply:PiExtensionReply)=>{
    if(submitting.current)return;
    if(!('cancelled' in reply)){
      answers.current.set(request.id,reply);
      if(!last){if(group[index+1])setCurrentId(group[index+1].id);return;}
    }
    const cancelled='cancelled' in reply;
    submitting.current=true;setSending(true);
    try{
      for(const item of group){
        const saved=answers.current.get(item.id);
        if(!saved||cancelled&&item.id===request.id){
          if(cancelled){await onReply(item.id,{cancelled:true});return;}
          throw new Error('Answer every question before submitting.');
        }
        await onReply(item.id,saved);
      }
    }finally{submitting.current=false;setSending(false);}
  };
  return <>{group.map((request,position)=><ExtensionInput key={request.id} request={request} active={active&&index===position}
    navigation={{previous:index>0?()=>setCurrentId(group[index-1].id):undefined,last,canContinue:last||index<group.length-1,sending}}
    onReply={reply=>answer(request,reply)}/>)}</>;
}

export default function ExtensionInput({request,active,onReply,navigation}:{request:PiExtensionRequest;active:boolean;onReply:(reply:PiExtensionReply)=>Promise<void>;
  navigation?:{previous?:()=>void;last:boolean;canContinue:boolean;sending:boolean}}){
  const [selected,setSelected]=useState(0);
  const [value,setValue]=useState(request.method==='editor'?request.prefill??'':'');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [now,setNow]=useState(Date.now());
  const submitting=useRef(false);const root=useRef<HTMLElement>(null);const inputRef=useRef<HTMLInputElement>(null);const editorRef=useRef<HTMLTextAreaElement>(null);
  const options=request.method==='select'?request.options:request.method==='confirm'?['No','Yes']:[];
  const choiceCount=options.length+(request.method==='select'?1:0);
  const custom=request.method==='select'&&selected===options.length;
  const expired=request.deadline!==undefined&&now>=request.deadline;
  const locked=busy||navigation?.sending;
  const cannotSubmit=locked||expired||navigation?.canContinue===false||custom&&!value.trim();
  useEffect(()=>{if(!active||request.deadline===undefined)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),250);return()=>clearInterval(timer);},[active,request.deadline]);
  useLayoutEffect(()=>{if(!active)return;const target=choiceCount?root.current?.querySelector(`[data-choice-index="${selected}"]`):inputRef.current??editorRef.current;(target as HTMLElement|null)?.focus();},[active]);
  useEffect(()=>{if(active)root.current?.querySelector(`[data-choice-index="${selected}"]`)?.scrollIntoView({block:'nearest'});},[active,selected]);
  const reply=async(answer:PiExtensionReply)=>{if(submitting.current)return;submitting.current=true;setBusy(true);setError('');try{await onReply(answer);}catch(error){setError(error instanceof Error?error.message:String(error));}finally{submitting.current=false;setBusy(false);}};
  const choose=(index:number,submit=false)=>{
    if(locked||expired)return;setSelected(index);
    if(navigation?.canContinue===false)return;
    if(submit)void reply(request.method==='confirm'?{confirmed:index===1}:{value:options[index]});
  };
  const submit=()=>{if(cannotSubmit)return;if(options.length&&!custom){choose(selected,true);return;}void reply({value});};
  return <section ref={root} className="agent-composer agent-extension-input" hidden={!active} aria-label={request.title||'Question'} aria-busy={busy}
    onKeyDown={event=>{
      if(event.nativeEvent.isComposing)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!locked)void reply({cancelled:true});return;}
      if(event.target instanceof HTMLElement&&event.target.closest('button')&&!event.target.closest('[role="option"]'))return;
      if(!locked&&!expired&&choiceCount&&!event.shiftKey&&!event.ctrlKey&&!event.altKey&&(event.key==='ArrowUp'||event.key==='ArrowDown')){event.preventDefault();const next=(selected+(event.key==='ArrowDown'?1:-1)+choiceCount)%choiceCount;setSelected(next);(root.current?.querySelector(`[data-choice-index="${next}"]`) as HTMLElement|null)?.focus();return;}
      if(event.key==='Enter'&&(request.method!=='editor'||event.ctrlKey||event.metaKey)){event.preventDefault();submit();}
    }}>
    <header className="agent-extension-header"><strong>{request.title||'Question'}</strong>
      {request.deadline!==undefined&&<span className="agent-extension-countdown" role="timer">{Math.max(0,Math.ceil((request.deadline-now)/1000))}s</span>}
      <button type="button" className="agent-icon-button" aria-label="Cancel question" title="Cancel question (Esc)" disabled={locked} onClick={()=>void reply({cancelled:true})}><Icon name="close" size={14}/></button>
    </header>
    {request.method==='confirm'&&<p className="agent-extension-message">{request.message}</p>}
    <div className={`agent-extension-body${request.method==='select'?' agent-extension-choices':''}${options.some(option=>option.includes('\n'))?' two-lines':''}`}>
    {options.length>0&&<div className="agent-extension-options" role="listbox" aria-label={request.title||'Options'}>{options.map((option,index)=>{
      const [label,...description]=option.split(/\r?\n/);
      return <button type="button" key={index} role="option" aria-selected={selected===index} data-choice-index={index}
        title={option} className="agent-extension-choice agent-extension-option" disabled={locked||expired} onFocus={()=>setSelected(index)} onClick={()=>choose(index)} onDoubleClick={()=>choose(index,true)}>
        <span className="agent-extension-option-copy"><strong>{label}</strong>{description.length>0&&<small>{description.join('\n')}</small>}</span>
        {selected===index&&<Icon name="check" size={12}/>}</button>;
    })}</div>}
    {request.method==='select'&&<input ref={inputRef} className="agent-extension-choice agent-extension-custom" data-choice-index={options.length}
      aria-label="Custom answer" placeholder="Custom answer…" value={value} disabled={locked||expired}
      onFocus={()=>setSelected(options.length)} onChange={event=>{setSelected(options.length);setValue(event.target.value);}}/>}
    {(request.method==='input'||request.method==='editor')&&<div className="agent-extension-field">
      {request.method==='editor'?<textarea ref={editorRef} aria-label={request.title||'Response'} value={value} disabled={locked||expired} onChange={event=>setValue(event.target.value)}/>
        :<input ref={inputRef} aria-label={request.title||'Response'} placeholder={request.placeholder} value={value} disabled={locked||expired} onChange={event=>setValue(event.target.value)}/>}
    </div>}
    </div>
    {error&&<p className="command-dialog-error" role="alert">{error}</p>}
    {(request.method!=='confirm'||navigation)&&<footer>
      {navigation&&<div className="agent-extension-navigation">
        <button type="button" className="agent-footer-select-trigger" disabled={!navigation.previous||locked||expired} onClick={navigation.previous}>Previous</button>
        <button type="button" className="agent-footer-select-trigger" disabled={navigation.last||cannotSubmit} onClick={submit}>Next</button>
      </div>}
      {(!navigation||navigation.last)&&<button type="button" className="agent-send" disabled={cannotSubmit} title={request.method==='editor'?'Submit (Ctrl+Enter)':'Submit (Enter)'} onClick={submit}>
        <Icon name="send" size={14}/>{locked?'Submitting…':!navigation&&request.method==='select'&&!custom?'Select':'Submit'}</button>}</footer>}
  </section>;
}
