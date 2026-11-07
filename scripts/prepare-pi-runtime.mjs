import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const nodeVersion='22.19.0';
const nodeArchive=`node-v${nodeVersion}-win-x64.zip`;
const runtimeRoot=resolve('.pi-runtime');
const nodeDir=join(runtimeRoot,'node');

async function download(url){
  const response=await fetch(url);
  if(!response.ok)throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function prepareNode(){
  if(existsSync(join(nodeDir,'node.exe')))return;
  if(process.platform!=='win32')throw new Error('Revu currently packages Pi for Windows only.');
  const temporary=await mkdtemp(join(tmpdir(),'revu-pi-runtime-'));
  try{
    const base=`https://nodejs.org/dist/v${nodeVersion}`;
    const [archive,sums]=await Promise.all([download(`${base}/${nodeArchive}`),download(`${base}/SHASUMS256.txt`)]);
    const expected=sums.toString('utf8').split(/\r?\n/).find(line=>line.endsWith(`  ${nodeArchive}`))?.split(/\s+/)[0];
    const actual=createHash('sha256').update(archive).digest('hex');
    if(!expected||actual!==expected)throw new Error('Node runtime checksum verification failed.');
    const archivePath=join(temporary,nodeArchive);await writeFile(archivePath,archive);
    const extracted=spawnSync('tar',['-xf',archivePath,'-C',temporary],{stdio:'inherit'});
    if(extracted.status!==0)throw new Error('Failed to extract the Node runtime.');
    await mkdir(nodeDir,{recursive:true});
    await cp(join(temporary,basename(nodeArchive,'.zip'),'node.exe'),join(nodeDir,'node.exe'));
  }finally{await rm(temporary,{recursive:true,force:true});}
}

await prepareNode();
console.log(`Prepared Node ${nodeVersion} for Pi in ${runtimeRoot}`);
