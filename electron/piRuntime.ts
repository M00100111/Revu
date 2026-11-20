import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,readFile,rename,writeFile,rm} from 'node:fs/promises';
import {join,win32} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {PiRuntimeConfig,PiRuntimeInfo} from '../shared/piTypes';

export function runFile(file:string,args:string[],input?:string,timeout=20000):Promise<string>{
  return new Promise((resolve,reject)=>{
    const decode=(value:Buffer)=>value.subarray(0,80).includes(0)?value.toString('utf16le'):value.toString('utf8');
    const child=execFile(file,args,{encoding:'buffer',windowsHide:true,timeout,maxBuffer:1024*1024},(error,stdout,stderr)=>{
      if(!error){resolve(decode(stdout).trim());return;}
      const output=[decode(stderr).trim(),decode(stdout).trim()].filter(Boolean).join('\n');
      const reason=error.killed?`Command timed out after ${timeout/1000}s: ${file} ${args.join(' ')}`:error.message;
      reject(new Error(output?reason+'\n'+output:reason));
    });
    child.stdin?.on('error',()=>{});child.stdin?.end(input);
  });
}
const wslExe=()=>join(process.env.SystemRoot??'C:\\Windows','System32','wsl.exe');
export async function wslDistributions(){
  if(process.platform!=='win32')return {names:[] as string[],defaultName:undefined as string|undefined};
  try{const raw=await runFile(wslExe(),['--list','--verbose']);const lines=raw.replace(/\0/g,'').split(/\r?\n/).slice(1);const names:string[]=[];let defaultName:string|undefined;
    for(const line of lines){const match=/^\s*(\*)?\s*(.+?)\s{2,}\S+\s+\d+\s*$/.exec(line);if(match){names.push(match[2]);if(match[1])defaultName=match[2];}}return {names,defaultName};
  }catch{return {names:[] as string[],defaultName:undefined as string|undefined};}
}
export function wslRun(distribution:string,args:string[],input?:string){return runFile(wslExe(),['--distribution',distribution,'--cd','/','--exec',...args],input,60000);}
export async function wslPath(distribution:string,path:string){return wslRun(distribution,['wslpath','-a','-u',path]);}
function isWslBash(path:string){const root=process.env.SystemRoot??'C:\\Windows';const normalized=win32.normalize(path).toLowerCase();return ['System32','Sysnative'].some(directory=>normalized===win32.join(root,directory,'bash.exe').toLowerCase())||/[\\/]Microsoft[\\/]WindowsApps[\\/]bash\.exe$/i.test(path);}
export async function nativeBashPaths(){
  if(process.platform!=='win32')return [];
  const candidates:string[]=[];
  try{for(const git of (await runFile('where.exe',['git.exe'])).split(/\r?\n/)){const root=win32.dirname(win32.dirname(git));candidates.push(join(root,'bin','bash.exe'),join(root,'usr','bin','bash.exe'),join(win32.dirname(root),'bin','bash.exe'));}}catch{}
  for(const base of [process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.LOCALAPPDATA&&join(process.env.LOCALAPPDATA,'Programs')])if(base)candidates.push(join(base,'Git','bin','bash.exe'));
  try{candidates.push(...(await runFile('where.exe',['bash.exe'])).split(/\r?\n/));}catch{}
  const paths=new Map<string,string>();for(const path of candidates)if(existsSync(path)&&!isWslBash(path))paths.set(win32.normalize(path).toLowerCase(),path);
  return [...paths.values()];
}
export async function nativeBash(custom?:string){
  if(custom){if(!existsSync(custom)||isWslBash(custom))throw new Error('Choose a Windows Bash executable, or select WSL runtime.');if(!/^GNU bash\b/im.test(await runFile(custom,['--version'])))throw new Error('The selected executable is not Bash.');return custom;}
  if(process.platform!=='win32')return '/bin/bash';
  const found=(await nativeBashPaths())[0];if(!found)throw new Error('No Windows Bash found. Install Git for Windows or specify its Bash path.');return found;
}

export interface RuntimePaths {root:string;agentDir:string;processDir:string;nativeShell?:string}
export interface RuntimeLaunch {command:string;prefix:string[];cwd:string;env:Record<string,string>;pidFile?:string;hostPath:(path:string)=>string;stop?:()=>Promise<void>}
export async function runtimeInfo(config:PiRuntimeConfig,paths:RuntimePaths):Promise<PiRuntimeInfo>{
  const distributions=await wslDistributions();const info:PiRuntimeInfo={config,distributions:distributions.names,defaultDistribution:distributions.defaultName,platform:process.platform,bashPaths:await nativeBashPaths(),user:'',ready:false};
  try{if(config.kind==='wsl'){const distro=config.distribution??distributions.defaultName;if(!distro||!distributions.names.includes(distro))throw new Error('Choose an installed WSL distribution.');
    info.config={...config,distribution:distro};info.user=await wslRun(distro,['id','-un']);const arch=await wslRun(distro,['uname','-m']);if(arch!=='x86_64')throw new Error('The bundled WSL runtime requires x86_64.');
    const node=await wslPath(distro,join(paths.root,'node-linux-x64','node'));if(!existsSync(join(paths.root,'node-linux-x64','node')))throw new Error('The bundled Linux Node runtime is missing. Run npm run prepare:pi.');await wslRun(distro,[node,'--version']);info.shell='/bin/bash';
  }else{info.shell=await nativeBash(config.nativeShellPath??paths.nativeShell);info.user=process.env.USERNAME??process.env.USER??'';}
  info.ready=true;}catch(error){info.error=error instanceof Error?error.message:String(error);}return info;
}
export async function runtimeLaunch(config:PiRuntimeConfig,paths:RuntimePaths,cwd:string,sessionDir:string):Promise<RuntimeLaunch>{
  const launcher=join(paths.root,'app','revu-launcher.mjs');
  if(config.kind==='native')return {command:join(paths.root,'node','node.exe'),prefix:[launcher],cwd,env:{PI_CODING_AGENT_DIR:paths.agentDir,REVU_PI_SHELL_PATH:await nativeBash(config.nativeShellPath??paths.nativeShell),PATH:join(paths.root,'node')+';'+(process.env.PATH??'')},hostPath:path=>path};
  const distro=config.distribution;if(!distro)throw new Error('Choose a WSL distribution.');await mkdir(paths.processDir,{recursive:true});const pidHost=join(paths.processDir,randomUUID()+'.json');
  const hostPaths=[cwd,sessionDir,paths.agentDir,launcher,join(paths.root,'node-linux-x64','node'),pidHost];const mapped=await Promise.all(hostPaths.map(path=>wslPath(distro,path)));const [linuxCwd,linuxSessions,agent,entry,node,pidFile]=mapped;
  const hostPath=(path:string)=>{for(const [index,prefix] of [linuxSessions,agent,linuxCwd].entries()){const host=[sessionDir,paths.agentDir,cwd][index];if(path===prefix)return host;if(path.startsWith(prefix+'/'))return join(host,path.slice(prefix.length+1));}return '\\\\wsl.localhost\\'+distro+path.replace(/\//g,'\\');};
  return {command:wslExe(),prefix:['--distribution',distro,'--exec','/bin/bash','-lc','exec "$@"','revu',node,entry],cwd:linuxCwd,pidFile,
    env:{PI_CODING_AGENT_DIR:agent,REVU_PI_SHELL_PATH:'/bin/bash'},hostPath,
    stop:async()=>{await wslRun(distro,[node,'-e',`const fs=require('fs');let data;try{data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));}catch{process.exit(0);}let stat;try{stat=fs.readFileSync('/proc/'+data.pid+'/stat','utf8');}catch{process.exit(0);}if(stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]!==data.start)process.exit(0);const visit=pid=>{let children=[];try{children=fs.readFileSync('/proc/'+pid+'/task/'+pid+'/children','utf8').trim().split(' ').filter(Boolean).map(Number);}catch{}for(const child of children)visit(child);try{process.kill(pid,'SIGKILL');}catch{}};visit(data.pid);try{fs.unlinkSync(process.argv[1]);}catch{}`,pidFile]);}};
}
export async function directoryExists(config:PiRuntimeConfig,path:string){
  if(config.kind==='native')return existsSync(path);try{await wslRun(config.distribution!,['test','-d',path]);return true;}catch{return false;}
}
export async function sessionCwd(path:string){const content=await readFile(path,'utf8');const header=JSON.parse(content.split(/\r?\n/,1)[0]);return typeof header.cwd==='string'?header.cwd:undefined;}
export async function replaceSessionCwd(path:string,expected:string,next:string){
  const content=await readFile(path,'utf8');const end=content.indexOf('\n');const first=end<0?content:content.slice(0,end);const header=JSON.parse(first);if(header.type!=='session'||header.cwd!==expected)throw new Error('Session directory changed. Open the session again.');
  header.cwd=next;const temporary=path+'.'+randomUUID()+'.tmp';try{await writeFile(temporary,JSON.stringify(header)+(first.endsWith('\r')?'\r':'')+(end<0?'':content.slice(end)));if(await readFile(path,'utf8')!==content)throw new Error('Session changed during directory recovery. Try again.');await rename(temporary,path);}finally{await rm(temporary,{force:true});}
}
