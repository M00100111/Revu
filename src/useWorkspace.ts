import { useCallback, useEffect, useRef, useState } from 'react';
import { monaco, type OpenFile, type Project } from './editor';
import { api, ApiError, errorMessage } from './files';
import type { Chunk, DiffResult, ProjectStatus, ReviewAction, ReviewBulkAction, ReviewRecord, Snapshot } from '../shared/types';
import { invalidateFileReview, mapRange, reconcile, replaceExact } from '../shared/review';
import { planBulkReview } from '../shared/bulkReview';
import { externalSyncKind, rebaseExternalReview, resetForExternalSnapshot } from './externalSync';

export function useWorkspace(onError: (message: string) => void) {
  const [projects, setProjects] = useState<Project[]>([]);
  const projectRef = useRef(projects);
  projectRef.current = projects;
  const docs = useRef(new Map<string, OpenFile>());
  const loading = useRef(new Map<string, Promise<OpenFile>>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [documents, setDocuments] = useState<OpenFile[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ProjectStatus>>({});
  const [tick, setTick] = useState(0);
  const refreshTasks = useRef(new Map<string, Promise<void>>());
  const refreshAgain = useRef(new Set<string>());
  const internalEdits = useRef(new Set<string>());
  const refreshRef = useRef<(project: Project) => Promise<void>>(async () => {});
  const emit = useCallback(() => { setDocuments([...docs.current.values()]); setTick(v => v + 1); }, []);

  async function compute(file: OpenFile) {
    if (!file.project.git || file.reason) { file.computing = false; emit(); return; }
    const version = file.version, text = file.model.getValue(), previous = file.reviewText;
    const base = file.project.base;
    try {
      const result = await api<DiffResult>('diff', { projectId:file.project.id, path:file.path,
        base, text, previous, version });
      if (file.version !== version || file.project.base !== base || result.version !== version) return;
      let chunks=result.chunks;
      if(!file.baselineExists&&file.draftExists)chunks=[{
        id:'file-add',kind:'add' as const,oldStart:0,oldEnd:0,start:0,end:text.length,
        oldText:'',newText:text,line:1,fileChange:'add',
      }];
      else if(file.baselineExists&&!file.draftExists)chunks=[{
        id:'file-delete',kind:'delete' as const,oldStart:0,oldEnd:file.baseline.length,start:0,end:0,
        oldText:file.baseline,newText:'',line:1,fileChange:'delete',
      }];
      const state = reconcile(file.records, chunks, result.changes, text);
      file.records = state.records;
      file.chunks = state.chunks.map((chunk, index) => ({...chunk,id:version + ':' + index}));
      file.reviewText = text;
      file.computing = false;
      file.diffError = '';
      emit();
    } catch(error) {
      if (file.version !== version) return;
      file.diffError = errorMessage(error); file.computing = false; emit();
    }
  }

  function schedule(file: OpenFile) {
    clearTimeout(timers.current.get(file.id));
    file.computing = file.project.git && !file.reason;
    emit();
    timers.current.set(file.id, setTimeout(() => { void compute(file); }, 180));
  }

  function discardExternalFile(file: OpenFile) {
    clearTimeout(timers.current.get(file.id));
    timers.current.delete(file.id);
    file.subscription.dispose();
    file.model.dispose();
    docs.current.delete(file.id);
  }

  async function load(project: Project, path: string): Promise<OpenFile> {
    const id = project.id + '/' + path;
    const existing = docs.current.get(id);
    if (existing) return existing;
    const pending = loading.current.get(id);
    if (pending) return pending;
    const task = (async () => {
      const [snapshot, base] = await Promise.all([
        api<Snapshot>('read', {projectId:project.id,path}),
        api<{text:string;bom?:boolean;exists:boolean;reason?:string}>('baseline', {projectId:project.id,path}),
      ]);
      if (snapshot.reason) throw new Error(snapshot.reason);
      if(!snapshot.exists)snapshot.bom=base.bom??false;
      const model = monaco.editor.createModel(snapshot.text, undefined,
        monaco.Uri.from({scheme:'file',path:'/' + id}));
      if(!snapshot.exists&&base.text.includes('\r\n')){
        model.setEOL(monaco.editor.EndOfLineSequence.CRLF);
      }
      const file: OpenFile = {
        id, project, path, name:path.split('/').pop()!, model, synced:snapshot,draftExists:snapshot.exists,
        baseline:base.text,baselineExists:base.exists, reason:base.reason, dirty:false, version:1, reviewText:snapshot.text,
        chunks:[], records:[], computing:false, syncing:false, saving:false,
        diffError:'', notice:'', subscription:{dispose(){}},
      };
      file.subscription = model.onDidChangeContent(() => {
        if(!internalEdits.current.has(file.id)){
          file.draftExists=true;
          file.records=invalidateFileReview(file.records);
        }
        file.version++;
        file.dirty = file.draftExists !== file.synced.exists || model.getValue() !== file.synced.text;
        schedule(file);
      });
      docs.current.set(id,file);
      schedule(file);
      return file;
    })();
    loading.current.set(id,task);
    try { return await task; } finally { loading.current.delete(id); }
  }

  async function sync(file: OpenFile) {
    if (file.syncing || file.saving) return;
    file.syncing = true; file.syncError = ''; emit();
    try {
      const external = await api<Snapshot>('read',{projectId:file.project.id,path:file.path});
      const kind = externalSyncKind(file.synced.hash, external);
      if (kind === 'unchanged') return;
      if (kind === 'remove') {
        discardExternalFile(file);
        return;
      }
      clearTimeout(timers.current.get(file.id));
      timers.current.delete(file.id);
      let review={text:external.text,records:[] as ReviewRecord[]};
      if(file.project.git&&!file.reason&&!external.reason&&file.records.length){
        const result=await api<DiffResult>('diff',{projectId:file.project.id,path:file.path,
          base:file.project.base,text:external.text,previous:external.text,version:file.version});
        review=rebaseExternalReview(file.records,result.chunks,external.text);
      }
      resetForExternalSnapshot(file, external, review);
      if (external.reason) file.reason = external.reason;
      internalEdits.current.add(file.id);
      try{file.model.setValue(review.text);}finally{internalEdits.current.delete(file.id);}
      file.dirty = review.text !== external.text;
      schedule(file);
    } catch(error) {
      file.syncError = errorMessage(error);
      onError('Sync failed: ' + file.syncError);
    } finally { file.syncing = false; emit(); }
  }

  async function save(file: OpenFile) {
    if (!file.dirty || file.saving || file.syncing || file.reason) return;
    await sync(file);
    if (!docs.current.has(file.id) || file.syncError || file.reason || file.syncing) return;
    file.saving = true; emit();
    const text = file.model.getValue();
    try {
      const saved = await api<Snapshot>('save', {projectId:file.project.id,path:file.path,
        text,expected:file.synced.hash,bom:file.synced.bom,exists:file.draftExists});
      file.synced = saved;file.draftExists=saved.exists;
      file.dirty = file.model.getValue() !== saved.text;
      file.notice = '';
    } catch(error) {
      if (error instanceof ApiError && error.status === 409) {
        file.saving = false;
        await sync(file);
        onError('Save canceled because the disk file changed. The latest disk content was loaded.');
      } else onError('Save failed: ' + errorMessage(error));
    } finally {
      file.saving = false; emit();
      void refreshRef.current(file.project);
    }
  }

  function act(file: OpenFile, id: string, action: ReviewAction, version: number) {
    if (file.version !== version || file.computing || file.syncing || file.saving ||
        file.syncError || file.diffError || file.reason) return;
    try {
      if (action === 'undo') {
        const record = file.records.find(item => item.id === id);
        if (!record) throw new Error('This review record is no longer available.');
        if (record.decision === 'accepted') {
          file.records = file.records.filter(item => item !== record);
          schedule(file);
        } else {
          if(record.fileChange)file.draftExists=record.fileChange==='add';
          editReview(file, record, record.oldText, record.newText, undefined);
        }
      } else {
        const chunk = file.chunks.find(item => item.id === id);
        if (!chunk) throw new Error('The diff changed. Select the chunk again.');
        const record: ReviewRecord = {...chunk,id:crypto.randomUUID(),decision:action === 'accept' ? 'accepted' : 'rejected'};
        if (action === 'accept') {
          file.records.push(record);
          file.chunks = file.chunks.filter(item => item !== chunk);
          emit();
        } else {
          if(chunk.fileChange)file.draftExists=chunk.fileChange==='delete';
          editReview(file, chunk, chunk.newText, chunk.oldText, record);
        }
      }
    } catch(error) { onError(errorMessage(error)); }
  }

  function applyBulk(files:OpenFile[],action:ReviewBulkAction,confirmAction:boolean) {
    files=files.filter(file=>action==='undo'?file.records.length:file.chunks.length);
    const count=files.reduce((sum,file)=>sum+(action==='undo'?file.records.length:file.chunks.length),0);
    if(!count)return;
    const label=action[0].toUpperCase()+action.slice(1);
    const state=action==='undo'?'reviewed':'pending';
    if(confirmAction&&!window.confirm(`${label} ${count} ${state} change${count===1?'':'s'} across ${files.length} file${files.length===1?'':'s'}?`))return;
    try{
      const plans=files.map(file=>{
        if(file.computing||file.syncing||file.saving||file.syncError||file.diffError||file.reason)
          throw new Error(`${file.path} is not ready for review actions.`);
        return {file,plan:planBulkReview({text:file.model.getValue(),chunks:file.chunks,records:file.records},
          action,()=>crypto.randomUUID())};
      });
      for(const {file,plan} of plans){
        const textChanged=plan.text!==file.model.getValue();
        if(action==='reject'){
          const change=file.chunks.find(chunk=>chunk.fileChange)?.fileChange;
          if(change)file.draftExists=change==='delete';
        }
        if(action==='undo'){
          const change=file.records.find(record=>record.fileChange&&record.decision==='rejected')?.fileChange;
          if(change)file.draftExists=change==='add';
        }
        file.records=plan.records;file.chunks=plan.chunks;
        if(plan.edits.length){
          file.reviewText=plan.text;
          const edits=plan.edits.map(edit=>({range:new monaco.Range(
            file.model.getPositionAt(edit.start).lineNumber,file.model.getPositionAt(edit.start).column,
            file.model.getPositionAt(edit.end).lineNumber,file.model.getPositionAt(edit.end).column),text:edit.text}));
          internalEdits.current.add(file.id);
          try{
            file.model.pushStackElement();file.model.pushEditOperations([],edits,()=>null);file.model.pushStackElement();
          }finally{internalEdits.current.delete(file.id);}
          file.reviewText=file.model.getValue();
          const fileRecord=file.records.find(record=>record.fileChange&&record.decision==='rejected');
          if(fileRecord){fileRecord.oldText=file.reviewText;fileRecord.start=0;fileRecord.end=file.reviewText.length;}
        }
        file.dirty=file.draftExists!==file.synced.exists||file.model.getValue()!==file.synced.text;
        if(!textChanged&&action==='undo')schedule(file);
      }
      emit();
    }catch(error){onError(errorMessage(error));}
  }

  function bulk(projectIds:string[],action:ReviewBulkAction) {
    const ids=new Set(projectIds);
    applyBulk([...docs.current.values()].filter(file=>ids.has(file.project.id)),action,true);
  }

  function bulkFile(file:OpenFile,action:ReviewBulkAction) {
    applyBulk([file],action,false);
  }

  function editReview(file: OpenFile, item: Chunk, expected: string, replacement: string, added?: ReviewRecord) {
    const current = file.model.getValue();
    const text = replaceExact(current,item.start,item.end,expected,replacement);
    const delta: Chunk = {...item, oldStart:item.start,oldEnd:item.end,start:item.start,end:item.start+replacement.length};
    file.records = file.records.filter(record => record.id !== item.id).flatMap(record => {
      const mapped = mapRange(record.start,record.end,[delta]);
      return mapped ? [{...record,...mapped}] : [];
    });
    if(added) file.records.push({...added,end:item.start+replacement.length});
    // Account for this known edit now; the next diff maps only later user edits.
    file.reviewText = text;
    const start = file.model.getPositionAt(item.start), end = file.model.getPositionAt(item.end);
    internalEdits.current.add(file.id);
    try{
      file.model.pushStackElement();
      file.model.pushEditOperations([], [{range:new monaco.Range(start.lineNumber,start.column,end.lineNumber,end.column),text:replacement}], () => null);
      file.model.pushStackElement();
    }finally{internalEdits.current.delete(file.id);}
    file.reviewText=file.model.getValue();
    if(added?.fileChange&&added.decision==='rejected'){
      const record=file.records.find(record=>record.id===added.id);
      if(record){record.oldText=file.reviewText;record.start=0;record.end=file.reviewText.length;}
    }
    file.dirty=file.draftExists!==file.synced.exists||file.model.getValue()!==file.synced.text;
    schedule(file);
  }

  async function refresh(project: Project): Promise<void> {
    const running = refreshTasks.current.get(project.id);
    if(running) { refreshAgain.current.add(project.id); return running; }
    const task = (async () => {
      do {
        refreshAgain.current.delete(project.id);
        window.dispatchEvent(new CustomEvent('revu-project-changed',{detail:project.id}));
        let status = await api<ProjectStatus>('status',{projectId:project.id});
        const affected=[...docs.current.values()].filter(file=>file.project.id===project.id);
        if(status.changedHead){
          if(affected.some(file=>file.saving||file.syncing)){
            setStatuses(current=>({...current,[project.id]:status}));
            continue;
          }
          affected.forEach(file=>{
            file.version++;file.computing=true;
            clearTimeout(timers.current.get(file.id));timers.current.delete(file.id);
          });
          emit();
          try{
            const updated=await api<Project>('refreshBase',{projectId:project.id});
            Object.assign(project,updated);
            for(const file of affected){
              const base=await api<{text:string;exists:boolean;reason?:string}>('baseline',{
                projectId:project.id,path:file.path,
              });
              file.baseline=base.text;file.baselineExists=base.exists;file.reason=base.reason;
              file.records=[];file.chunks=[];file.reviewText=file.model.getValue();schedule(file);
            }
            setProjects([...projectRef.current]);
            status=await api<ProjectStatus>('status',{projectId:project.id});
          }catch(error){
            const message=errorMessage(error);
            affected.forEach(file=>{file.computing=false;file.diffError=message;});
            emit();
            throw error;
          }
        }
        setStatuses(current => ({...current,[project.id]:status}));
        for(const file of docs.current.values()) {
          if(file.project.id !== project.id || file.saving) continue;
          file.syncError = '';
          const listed = status.files.find(item => item.path === file.path);
          file.reason = listed?.reason;
          await sync(file);
        }
        for(const item of status.files) {
          if(item.reason) continue;
          const file = await load(project,item.path);
          file.reason = item.reason;
        }
        emit();
      } while(refreshAgain.current.has(project.id));
    })().catch(error => onError('Refresh failed: ' + errorMessage(error)));
    refreshTasks.current.set(project.id,task);
    try { await task; } finally { refreshTasks.current.delete(project.id); }
  }
  refreshRef.current = refresh;

  async function addProject() {
    const project = await api<Project | null>('pick');
    if(!project) return null;
    const existing = projectRef.current.find(item => item.id === project.id);
    if(existing) return existing;
    projectRef.current = [...projectRef.current,project];
    setProjects(projectRef.current);
    void refresh(project);
    return project;
  }

  async function removeProject(project:Project) {
    await api('removeProject',{projectId:project.id});
    for(const [id,file] of docs.current){
      if(file.project.id!==project.id)continue;
      clearTimeout(timers.current.get(id));timers.current.delete(id);
      file.subscription.dispose();file.model.dispose();docs.current.delete(id);
    }
    projectRef.current=projectRef.current.filter(item=>item.id!==project.id);
    setProjects(projectRef.current);
    setStatuses(current=>{const next={...current};delete next[project.id];return next;});
    emit();
  }


  useEffect(() => {
    let live=true;
    void api<Project[]>('projects').then(items=>{
      if(!live) return;
      projectRef.current=items;setProjects(items);
      items.forEach(project=>void refreshRef.current(project));
    }).catch(error=>onError(errorMessage(error)));
    const refreshAll = () => projectRef.current.forEach(project=>void refreshRef.current(project));
    const unsubscribe=window.revu.onProjectChanged(projectId=>{
      const project=projectRef.current.find(p=>p.id===projectId);
      if(project) void refreshRef.current(project);
    });
    window.addEventListener('focus',refreshAll);
    return ()=>{live=false;unsubscribe();window.removeEventListener('focus',refreshAll);};
  },[onError]);

  return { projects, documents, statuses, tick, load, addProject, removeProject, save, act, bulk, bulkFile, refresh };
}
