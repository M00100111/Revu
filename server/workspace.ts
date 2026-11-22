import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, realpath, stat, open, unlink, mkdir } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Project, Snapshot, ProjectStatus, ChangeFile, ProjectPathEntry, ChatPathDirectory } from '../shared/types';
import {decodeCodeText,isKnownBinaryCodePath,type CodeEncoding} from '../shared/codeSource';
import { git } from './git';

export interface Registered extends Project { repo: string | null; watcher?: FSWatcher; gitWatcher?: FSWatcher }
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const sourceReasons={
  binary:'Binary file. Status only.',
  'bare-cr':'Unsupported line endings (bare CR). Status only.',
  'mixed-line-endings':'Mixed line endings. Status only.',
};
export function decode(bytes:Buffer,{referenceEncoding,knownBinary=false}:{referenceEncoding?:CodeEncoding;knownBinary?:boolean}={}):Snapshot {
  const encoding=referenceEncoding??'utf-8';
  const bom=encoding==='utf-8'&&bytes.subarray(0,3).equals(Buffer.from([239,187,191]));
  const {text,issue}=decodeCodeText(bytes,encoding,knownBinary);
  const snapshot={text,bom,hash:hash(bytes),exists:true,...(encoding==='gb18030'?{encoding}:{})};
  if(referenceEncoding&&issue==='mixed-line-endings')return {...snapshot,text:text.replace(/\r\n/g,'\n')};
  const reason=issue==='invalid-encoding'?`Invalid ${encoding.toUpperCase()} text. Status only.`:issue?sourceReasons[issue]:undefined;
  return {...snapshot,reason};
}
export class Workspace {
  projects = new Map<string, Registered>();
  private locks = new Map<string, Promise<unknown>>();
  constructor(private notify: (projectId: string) => void = () => {}) {}
  private inside(root: string, path: string) {
    const rel = relative(root, path);
    return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
  }
  async path(project: Project, path: string, missing = false) {
    if (isAbsolute(path) || path.split(/[\\/]/).some(part => part.toLowerCase() === '.git')) throw new HttpError(403, 'Path access denied');
    const target = resolve(project.root, path);
    if (!this.inside(project.root, target)) throw new HttpError(403, 'Path is outside the project');
    let actual: string;
    try { actual = await realpath(target); }
    catch (error) {
      if (!missing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      let ancestor=dirname(target);
      while(true){
        try{
          const existing=await realpath(ancestor);
          actual=resolve(existing,relative(ancestor,target));
          break;
        }catch(parentError){
          if((parentError as NodeJS.ErrnoException).code!=='ENOENT')throw parentError;
          const parent=dirname(ancestor);
          if(parent===ancestor||!this.inside(project.root,parent))throw parentError;
          ancestor=parent;
        }
      }
    }
    if (!this.inside(project.root, actual)) throw new HttpError(403, 'Link points outside the project');
    return actual;
  }
  get(id: string) {
    const project = this.projects.get(id);
    if (!project) throw new HttpError(404, 'Project is not open');
    return project;
  }
  async head(repo: string) {
    const value = (await git(repo, ['rev-parse', '--verify', 'HEAD'], [0, 128])).toString().trim();
    return value || null;
  }
  async branch(repo:string,head:string|null) {
    const value=(await git(repo,['symbolic-ref','--quiet','--short','HEAD'],[0,1])).toString().trim();
    return value||(head?head.slice(0,8):null);
  }
  async add(path: string) {
    const root = await realpath(path);
    if (!(await stat(root)).isDirectory()) throw new HttpError(400, 'Select a folder');
    const existing = [...this.projects.values()].find(p => p.root.toLowerCase() === root.toLowerCase());
    if (existing) return this.public(existing);
    const repoText = (await git(root, ['rev-parse', '--show-toplevel'], [0, 128])).toString().trim();
    const repo = repoText ? await realpath(repoText) : null;
    const names = new Set([...this.projects.values()].map(p => p.name));
    let name = basename(root);
    for (let i = 2; names.has(name); i++) name = basename(root) + ' (' + i + ')';
    const project: Registered = { id: randomUUID(), name, root, repo, git: !!repo, base: repo ? await this.head(repo) : null };
    this.projects.set(project.id, project);
    let timer: ReturnType<typeof setTimeout>;
    const changed = () => { clearTimeout(timer); timer = setTimeout(() => this.notify(project.id), 180); };
    project.watcher = watch(root, { recursive: true }, changed);
    project.watcher.on('error', changed);
    if (repo) {
      const gitDir = (await git(repo, ['rev-parse', '--absolute-git-dir'])).toString().trim();
      project.gitWatcher = watch(gitDir, { recursive: true }, changed);
      project.gitWatcher.on('error', changed);
    }
    return this.public(project);
  }
  public(p: Registered): Project { return { id: p.id, name: p.name, root: p.root, git: p.git, base: p.base }; }
  remove(id:string) {
    const project=this.get(id);
    project.watcher?.close();project.gitWatcher?.close();
    this.projects.delete(id);this.locks.delete(id);
  }
  async list(p: Registered, path: string) {
    return this.directoryEntries(await this.path(p,path));
  }
  private async directoryEntries(directory:string) {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter(e => e.name !== '.git' && (e.isFile() || e.isDirectory()))
      .map(e => ({ name: e.name, kind: e.isDirectory() ? 'directory' as const : 'file' as const }))
      .sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1);
  }
  async chatDirectory(project:Registered,prefix:string,searchProject:boolean):Promise<ChatPathDirectory> {
    const directory=resolve(project.root,prefix);
    const breadcrumbs:ChatPathDirectory['breadcrumbs']=[];
    for(let current=directory;;current=dirname(current)){
      const rel=relative(project.root,current).split(sep).join('/');
      breadcrumbs.unshift({name:basename(current)||current.split(sep).join('/'),query:rel?rel.replace(/\/$/,'')+'/':''});
      if(current===dirname(current)||(current!==directory&&current!==project.root&&this.inside(current,project.root)))break;
    }
    const result:ChatPathDirectory={directory:directory.split(sep).join('/'),breadcrumbs,entries:[]};
    try{
      if(directory.split(sep).some(part=>part.toLowerCase()==='.git'))throw new HttpError(403,'Path access denied');
      const entries=this.inside(project.root,directory)
        ?await this.list(project,relative(project.root,directory)):await this.directoryEntries(directory);
      result.entries=entries.map(({name,kind})=>({path:name+(kind==='directory'?'/':''),kind}));
      if(searchProject&&directory===project.root){
        const indexed=await this.paths(project);
        result.entries=result.entries.concat(indexed.filter(entry=>entry.path.replace(/\/$/,'').includes('/')));
      }
    }catch(error){result.error=error instanceof Error?error.message:String(error);}
    return result;
  }
  async paths(p:Registered):Promise<ProjectPathEntry[]> {
    const found=new Map<string,ProjectPathEntry['kind']>();
    const addFile=(rawPath:string)=>{
      const path=rawPath.replaceAll('\\','/').replace(/^\.\//,'').replace(/^\/+|\/+$/g,'');
      if(!path||path.split('/').some(part=>part.toLowerCase()==='.git'))return;
      found.set(path,'file');
      const parts=path.split('/');let current='';
      for(const part of parts.slice(0,-1)){current=current?`${current}/${part}`:part;found.set(current,'directory');}
    };
    if(p.repo){
      const output=(await git(p.root,['ls-files','-co','--exclude-standard','-z'])).toString('utf8');
      for(const path of output.split('\0').filter(Boolean))addFile(path);
    }else{
      const pending=[''];const limit=50_000;
      while(pending.length&&found.size<limit){
        const parent=pending.shift()!;let entries;
        try{entries=await readdir(await this.path(p,parent),{withFileTypes:true});}catch{continue;}
        for(const entry of entries){
          if(entry.name==='.git')continue;
          const path=parent?`${parent}/${entry.name}`:entry.name;
          if(entry.isDirectory()){found.set(path,'directory');pending.push(path);}
          else if(entry.isFile())found.set(path,'file');
          if(found.size>=limit)break;
        }
      }
    }
    return [...found].map(([path,kind])=>({path:kind==='directory'?`${path}/`:path,kind}))
      .sort((a,b)=>a.path.localeCompare(b.path));
  }
  async read(p: Registered, path: string, referenceEncoding?:CodeEncoding): Promise<Snapshot> {
    try{
      const actual=await this.path(p,path,true);
      return decode(await readFile(actual),{referenceEncoding,knownBinary:isKnownBinaryCodePath(path)||isKnownBinaryCodePath(actual)});
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { text: '', hash: 'missing', exists: false, bom: false };
      throw error;
    }
  }
  async baseline(p: Registered, path: string, revision=p.base, referenceEncoding?:CodeEncoding):Promise<Snapshot> {
    await this.path(p, path, true);
    if (!p.repo || !revision) return { text: '', bom: false, exists:false, hash:'missing' };
    const repoPath = relative(p.repo, resolve(p.root, path)).split(sep).join('/');
    const listing = (await git(p.repo, ['ls-tree', '-z', revision, '--', repoPath])).toString();
    if (!listing) return { text: '', bom: false, exists:false, hash:'missing' };
    const match = /^(\d+) \w+ ([a-f0-9]+)\t/.exec(listing);
    if (!match || !['100644','100755'].includes(match[1])) return { text: '', bom: false, exists:true, hash:'missing', reason: 'Unsupported file type' };
    return decode(await git(p.repo, ['cat-file', 'blob', match[2]]),{referenceEncoding,knownBinary:isKnownBinaryCodePath(path)});
  }
  async codeSnapshot(p:Registered,path:string,expectedHash:string,revision?:string,encoding:CodeEncoding='utf-8'):Promise<Snapshot>{
    let snapshot:Snapshot;
    if(revision)snapshot=await this.baseline(p,path,revision+'^{commit}',encoding);
    else{
      const disk=await this.read(p,path,encoding);
      snapshot=disk.hash===expectedHash?disk:await this.baseline(p,path,p.base,encoding);
    }
    if(!snapshot.exists||snapshot.hash!==expectedHash||snapshot.reason)throw new HttpError(404,'Referenced version is unavailable');
    return snapshot;
  }
  async status(p: Registered): Promise<ProjectStatus> {
    if (!p.repo) return { files: [], head: null, base: null, changedHead: false, branch:null };
    const head = await this.head(p.repo);
    const branch=await this.branch(p.repo,head);
    const files = new Map<string, ChangeFile>();
    const add = (repoPath: string, status: string, reason?: string) => {
      const abs = resolve(p.repo!, repoPath);
      if (!this.inside(p.root, abs)) return;
      const path = relative(p.root, abs).split(sep).join('/');
      if (path) files.set(path, { path, status, reason });
    };
    if (p.base) {
      const parts = (await git(p.repo, ['diff', '--name-status', '-z', '--find-renames', p.base, '--'])).toString().split('\0');
      for (let i = 0; i < parts.length && parts[i];) {
        const status = parts[i++], oldPath = parts[i++];
        if (status.startsWith('R') || status.startsWith('C')) {
          const newPath = parts[i++]; add(newPath, status, 'Rename or copy. Status only.');
        } else add(oldPath, status);
      }
    } else {
      for (const path of (await git(p.repo, ['ls-files', '-z'])).toString().split('\0').filter(Boolean)) add(path, 'A');
    }
    for (const path of (await git(p.repo, ['ls-files', '--others', '--exclude-standard', '-z'])).toString().split('\0').filter(Boolean)) {
      if (!files.has(relative(p.root, resolve(p.repo, path)).split(sep).join('/'))) add(path, 'A');
    }
    for (const path of (await git(p.repo, ['diff', '--name-only', '--diff-filter=U', '-z'])).toString().split('\0').filter(Boolean)) {
      add(path, 'U', 'Unresolved Git conflict. Status only.');
    }
    for (const file of files.values()) {
      if (file.reason) continue;
      const snapshot = await this.read(p, file.path);
      const base = await this.baseline(p, file.path);
      file.reason = !snapshot.exists ? (file.status.startsWith('D') ? undefined : 'File deleted. Status only.')
        : snapshot.reason ?? base.reason;
      if (!file.reason && snapshot.text === base.text && snapshot.bom !== base.bom) file.reason = 'BOM metadata change only';
    }
    return { files: [...files.values()].sort((a,b) => a.path.localeCompare(b.path)), head, base: p.base, changedHead: head !== p.base, branch };
  }
  async save(p: Registered, path: string, expected: string, text: string, bom: boolean, exists = true) {
    const previous = this.locks.get(p.id) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      const current = await this.read(p, path);
      if (current.exists ? current.hash !== expected : expected !== 'missing') {
        throw new HttpError(409, 'Disk content changed. Sync first.');
      }
      if (current.reason) throw new HttpError(409, current.reason);
      let target = await this.path(p, path, !current.exists);
      if(!exists){
        if(!current.exists)return current;
        if(hash(await readFile(target))!==expected)throw new HttpError(409, 'Disk content changed. Sync first.');
        await unlink(target);
        const result=await this.read(p,path);
        if(result.exists)throw new HttpError(409, 'The file changed during save. Sync first.');
        this.notify(p.id);return result;
      }
      const bytes = Buffer.from((bom ? '\uFEFF' : '') + text, 'utf8');
      if(!current.exists){
        await mkdir(dirname(target),{recursive:true});
        const parent=await realpath(dirname(target));
        if(!this.inside(p.root,parent))throw new HttpError(403,'Link points outside the project');
        target=resolve(parent,basename(target));
      }
      let handle:Awaited<ReturnType<typeof open>>;
      try { handle = await open(target, current.exists ? 'r+' : 'wx'); }
      catch(error) {
        if(['EEXIST','ENOENT'].includes((error as NodeJS.ErrnoException).code??''))
          throw new HttpError(409, 'Disk content changed. Sync first.');
        throw error;
      }
      try {
        if(current.exists){
          const actual = await handle.readFile();
          if (hash(actual) !== expected) throw new HttpError(409, 'Disk content changed. Sync first.');
        }
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
          if (!bytesWritten) throw new Error('File write did not complete');
          offset += bytesWritten;
        }
        await handle.truncate(bytes.length);
        await handle.sync();
      } finally { await handle.close(); }
      const result = await this.read(p, path);
      if (result.hash !== hash(bytes)) throw new HttpError(409, 'The file changed during save. Sync first.');
      this.notify(p.id);
      return result;
    });
    this.locks.set(p.id, task);
    return task;
  }
  dispose() {
    for (const p of this.projects.values()) { p.watcher?.close(); p.gitWatcher?.close(); }
  }
}
