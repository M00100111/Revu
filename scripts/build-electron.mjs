import { build } from 'vite';

async function bundle(entry,file,emptyOutDir){
  await build({configFile:false,logLevel:'info',build:{ssr:entry,target:'node22',outDir:'dist-electron',
    emptyOutDir,minify:false,rollupOptions:{external:['electron'],output:{format:'cjs',entryFileNames:file}}}});
}
await bundle('electron/main.ts','main.cjs',true);
await bundle('electron/preload.ts','preload.cjs',false);
