// Child of benchmark-pi-standby.ts. Exercise the built app against its isolated test profile.
const {app,dialog,ipcMain}=require('electron');
const assert=require('node:assert/strict');
const {resolve}=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
const profile=process.argv[2];
const scenario=process.argv[3];
const emptyProject=resolve(profile,'empty-project');
require('node:fs').mkdirSync(emptyProject,{recursive:true});
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[emptyProject]});
app.setPath('userData',profile);
app.setAppPath(resolve(__dirname,'..'));
let sent=0,submitted=0,first=0;
let recentReady, draftReady;
const recent=new Promise(resolve=>{recentReady=resolve;});
const draft=new Promise(resolve=>{draftReady=resolve;});
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(name,handler)=>handle(name,(event,...args)=>{
  if(name==='revu:agent'&&args[0]?.action==='prepareNew'){
    if(scenario==='cold')return {ok:true};
    return Promise.resolve(handler(event,...args)).then(response=>{if(response.ok)draftReady();return response;});
  }
  return handler(event,...args);
});
app.on('browser-window-created',(_event,window)=>{
  const web=window.webContents,send=web.send.bind(web);
  web.send=(name,...args)=>{
    if(!first&&args[0]?.payload?.assistantMessageEvent?.type==='text_delta')first=performance.now();
    return send(name,...args);
  };
  window.once('show',()=>void run(web).then(()=>app.quit()).catch(error=>{console.error(error);process.exitCode=1;app.quit();}));
});
async function run(web){
  const shown=performance.now();
  const withDeadline=promise=>Promise.race([promise,delay(60000,undefined,{ref:false}).then(()=>{throw new Error('Timed out waiting for prewarm');})]);
  async function wait(expression,label){
    const end=Date.now()+60000;
    while(Date.now()<end){if(await web.executeJavaScript('Boolean('+expression+')'))return;await delay(40);}
    throw new Error('Timed out waiting for '+label);
  }
  await wait("document.querySelector('.project-tab')",'restored project');
  if(scenario==='ready')await withDeadline(recent);
  const open=performance.now();
  await web.executeJavaScript("document.querySelector('[aria-label=\"Pi Agent\"]').click()");
  await wait("document.querySelector('.agent-chat-body')?.textContent.includes('window history marker')",'recent chat');
  const readable=performance.now();
  await web.executeJavaScript("document.querySelector('.agent-new-chat').click()");
  await web.executeJavaScript(`const input=document.querySelector('.citation-composer');input.focus();input.textContent='ping';input.dispatchEvent(new Event('input',{bubbles:true}));`);
  await wait("document.querySelector('.agent-send:not(:disabled)')",'new chat composer');
  if(scenario==='ready')await withDeadline(draft);
  const click=performance.now();
  await web.executeJavaScript("document.querySelector('.agent-send').click()");
  await wait("document.querySelector('.agent-chat-body')?.textContent.includes('pong')",'local model response');
  assert.equal(sent,1);assert.ok(first>=submitted);
  if(scenario==='ready'){
    // Open a project with no history, then leave its prepared draft for a known session.
    await web.executeJavaScript("document.querySelector('[aria-label=\"Pi Agent\"]').click();document.querySelector('[aria-label=\"Open folder\"]').click()");
    await wait("document.querySelector('.project-tab.active')?.textContent.includes('empty-project')",'empty project');
    await web.executeJavaScript("document.querySelector('[aria-label=\"Pi Agent\"]').click()");
    await wait("document.querySelector('.agent-project-trigger')?.textContent.includes('empty-project')&&document.querySelector('.agent-session-tab.new')",'empty chat');
    await web.executeJavaScript("document.querySelector('.agent-session-more').click()");
    await wait("document.querySelectorAll('.agent-session-more-menu [role=option]').length===2",'two existing sessions');
    await web.executeJavaScript("document.querySelector('.agent-session-more-menu [role=option]').click()");
    await wait("document.querySelector('.agent-chat-body')?.textContent.includes('pong')",'cross-project jump');
    const visible=await web.executeJavaScript(`(async()=>{
      const projects=(await window.revu.invoke({action:'projects'})).value;
      const id=projects.find(project=>project.name==='empty-project').id;
      return (await window.revu.agent.listSessions(id)).value.sessions.length;
    })()`);
    assert.equal(visible,0,'Abandoned draft must not appear in history');
  }
  require('node:fs').writeFileSync(resolve(profile,'benchmark-result.json'),JSON.stringify({windowToReadableMs:Math.round(readable-shown),openChatToReadableMs:Math.round(readable-open),clickToPiMs:Math.round(submitted-click),piToLocalResponseMs:Math.round(first-submitted)}));
}
// Expose the two classes only inside this isolated benchmark process. The cold control
// bypasses speculative startup; all foreground paths still use the built application.
const Module=require('node:module'),filename=require.resolve('../dist-electron/main.cjs');
const entry=new Module(filename,module);entry.filename=filename;entry.paths=module.paths;
entry._compile(require('node:fs').readFileSync(filename,'utf8')+'\nmodule.exports={PiManager,PiStandby};',filename);
const {PiManager,PiStandby}=entry.exports;
const loadPi=PiManager.prototype.module;
let measured=false;
PiManager.prototype.module=async function(){
  const sdk=await loadPi.call(this);
  if(!measured){
    measured=true;const prompt=sdk.RpcClient.prototype.prompt;
    sdk.RpcClient.prototype.prompt=function(...args){submitted=performance.now();sent++;return prompt.apply(this,args);};
  }
  return sdk;
};
if(scenario==='cold')PiStandby.prototype.enable=()=>{};
const latest=PiManager.prototype.latestSession;
PiManager.prototype.latestSession=async function(project,prepare){
  if(prepare&&scenario==='cold')return null;
  const id=await latest.call(this,project,prepare);
  if(prepare)recentReady();
  return id;
};
