import { spawn } from 'node:child_process';
import electron from 'electron';

const run=(command,args,options={})=>spawn(command,args,{stdio:'inherit',windowsHide:true,...options});
const compile=run(process.execPath,['scripts/build-electron.mjs']);
await new Promise((resolve,reject)=>{compile.on('exit',code=>code===0?resolve():reject(new Error('Electron build failed')));compile.on('error',reject);});
const vite=run(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','7310','--strictPort']);
for(let attempts=0;;attempts++){
  try{const response=await fetch('http://127.0.0.1:7310');if(response.ok)break;}catch{}
  if(attempts===100)throw new Error('Vite did not start');
  await new Promise(resolve=>setTimeout(resolve,100));
}
const desktop=run(electron,['.'],{env:{...process.env,REVU_DEV_URL:'http://127.0.0.1:7310'}});
const processes=[vite,desktop];
let stopping = false;
function stop(code = 0) {
  if(stopping) return;
  stopping = true;
  for(const child of processes) child.kill();
  process.exitCode = code;
}
for(const child of processes){child.on('error',e=>{console.error(e);stop(1);});child.on('exit',code=>stop(code??0));}
process.on('SIGINT',()=>stop()); process.on('SIGTERM',()=>stop());
