import {pathToFileURL} from 'node:url';
const standby=process.argv[2]==='--revu-standby';
if(standby){
  await import(new URL('./revu-preload.mjs',import.meta.url));
  process.stdout.write('revu-ready\n');
}
const config=await new Promise((resolve,reject)=>{
  let pending=Buffer.alloc(0);const receive=chunk=>{pending=Buffer.concat([pending,chunk]);const end=pending.indexOf(10);if(end<0){if(pending.length>1048576)reject(new Error('Invalid Pi bootstrap.'));return;}
    process.stdin.pause();process.stdin.removeListener('data',receive);process.stdin.removeListener('end',ended);
    if(end+1<pending.length)process.stdin.unshift(pending.subarray(end+1));try{resolve(JSON.parse(pending.subarray(0,end).toString()));}catch(error){reject(error);}};
  const ended=()=>standby?resolve(null):reject(new Error('Missing Pi bootstrap.'));process.stdin.on('data',receive);process.stdin.once('end',ended);process.stdin.resume();
});
if(config===null)process.exit(0);
Object.assign(process.env,config.env);process.chdir(config.cwd);
if(config.pidFile){const {dirname}=await import('node:path');process.env.PATH=dirname(process.execPath)+':'+process.env.PATH;}
if(config.pidFile){const fs=await import('node:fs');fs.writeFileSync(config.pidFile,JSON.stringify({pid:process.pid,start:fs.readFileSync('/proc/self/stat','utf8').slice(fs.readFileSync('/proc/self/stat','utf8').lastIndexOf(')')+2).split(' ')[19]}));process.once('exit',()=>{try{fs.unlinkSync(config.pidFile);}catch{}});}
const cli=standby?config.cli:process.argv[2];
process.argv=[process.execPath,cli,...(standby?config.args:process.argv.slice(3))];
await import(pathToFileURL(cli).href);
