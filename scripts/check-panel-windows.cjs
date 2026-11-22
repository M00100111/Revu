// Run with Electron after npm run build. Use a fresh profile and a local session fixture.
const {app,BrowserWindow,dialog,ipcMain,screen}=require('electron');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {mkdirSync,mkdtempSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');

const profile=mkdtempSync(join(tmpdir(),'revu-panels-'));
const project=join(profile,'project');
mkdirSync(project);
execFileSync('git',['init','-q'],{cwd:project,windowsHide:true});
writeFileSync(join(project,'sample.txt'),'First line\nSecond line\n');
writeFileSync(join(profile,'open-folders.json'),JSON.stringify([project]));
app.setPath('userData',profile);
app.setAppPath(resolve(__dirname,'..'));
let sessionOpens=0;
let projectId;
let lastSearch;
const now=Date.now();
const fixtures=[
  {id:'panel-session',name:'Window test',status:'running',historyAt:now,modifiedAt:now},
  {id:'older-session',name:'Earlier discussion',status:'idle',historyAt:now-3*86400000,modifiedAt:now+1000},
  {id:'unused-draft',name:'Unsent draft',status:'idle',historyAt:null,modifiedAt:now+2000},
];
const summaries=id=>fixtures.map(session=>({...session,projectId:id,cwd:project,scope:'current',
  hasName:true,createdAt:now-5*86400000,firstMessage:session.historyAt?session.name:'',runCount:session.historyAt?1:0}));
const registerHandler=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,handler)=>registerHandler(channel,(event,...args)=>{
  if(channel!=='revu:agent')return handler(event,...args);
  const request=args[0];
  let value=[];
  switch(request.action){
    case 'latestSession': value='panel-session'; break;
    case 'openSession':
    case 'getSessionSnapshot':{
      if(request.action==='openSession')sessionOpens++;
      projectId=request.projectId;
      const session=fixtures.find(item=>item.id===request.sessionId);
      value={projectId,sessionId:session.id,name:session.name,status:session.status,
        thinkingLevel:'medium',availableThinkingLevels:[],messages:Array.from({length:30},(_,i)=>({role:'user',content:'Sample prompt '+i,timestamp:i+1}))};
      break;
    }
    case 'getEntries': value={entries:[],leafId:null}; break;
    case 'listSessions': value={groups:[],sessions:summaries(request.projectId)}; break;
    case 'searchSessions':{
      lastSearch=request;
      const match=summaries(request.projectId)[1];
      value=[{...match,matchSnippet:'scrollTop in the editor'},{...match,id:'foreign-session',projectId:'other',name:'Another project'}];
      break;
    }
  }
  return {ok:true,value};
});
const evaluate=(win,code)=>win.webContents.executeJavaScript('(()=>{'+code+'})()',true);
async function until(check,description){
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){if(await check())return;await delay(35);}
  throw new Error('Timed out waiting for '+description);
}
const has=(win,selector)=>evaluate(win,'return !!document.querySelector('+JSON.stringify(selector)+');');
const click=(win,selector)=>evaluate(win,'document.querySelector('+JSON.stringify(selector)+').click();');
async function mouseClick(win,selector){
  const point=await evaluate(win,'const button=document.querySelector('+JSON.stringify(selector)+');const r=button.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};');
  win.webContents.sendInputEvent({type:'mouseMove',...point});
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
  win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
}
const label=name=>'[aria-label="'+name+'"]';
const byTitle=title=>'[title="'+title+'"]';
const panelWindow=name=>BrowserWindow.getAllWindows().find(win=>win.getTitle()===name+' · Revu');
const textOf=(win,selector)=>evaluate(win,'return document.querySelector('+JSON.stringify(selector)+')?.textContent;');
const dockAll=label('Merge all windows');

async function checkComposerLayout(win,detached){
  const measure=()=>evaluate(win,`
    const rect=selector=>document.querySelector(selector).getBoundingClientRect();
    return {body:rect('.agent-chat-body').height,marker:rect('[aria-label="Go to run 15"]').top,
      tree:rect('.agent-run-tree').top,railRight:rect('.agent-run-rail').right,inputLeft:rect('.agent-composer').left};
  `);
  const initial=await measure();
  await click(win,label('Expand Input'));
  await until(async()=>(await measure()).body<initial.body-20,'expanded input reduces the message viewport');
  const expanded=await measure();
  if(detached){
    assert.ok(Math.abs(expanded.marker-initial.marker)<1,'detached run markers stay in place');
    assert.ok(Math.abs(expanded.tree-initial.tree)<1,'detached Session Tree stays in place');
    assert.ok(expanded.railRight<=expanded.inputLeft,'the expanded composer clears the navigation rail');
    await click(win,label('Go to run 15'));
    await until(()=>evaluate(win,`
      const body=document.querySelector('.agent-chat-body');
      const target=body.querySelectorAll('.agent-run')[14];
      return Math.abs(target.getBoundingClientRect().top-body.getBoundingClientRect().top-12)<2;
    `),'rail navigates to the requested message with the composer expanded');
  }else{
    assert.ok(expanded.marker<initial.marker-5,'docked run markers follow the message viewport');
  }
  await click(win,label('Collapse Input'));
  await until(async()=>Math.abs((await measure()).body-initial.body)<1,'original input height');
}

async function checkMenuBounds(win,wide=false){
  const bounds=await evaluate(win,`
    const rect=selector=>document.querySelector(selector).getBoundingClientRect();
    const menu=rect('.agent-session-more-menu'),panel=rect('.agent-chat'),trigger=rect('.agent-session-more');
    return {width:menu.width,leftMargin:menu.left-panel.left,rightMargin:panel.right-menu.right,anchor:menu.right-trigger.right};
  `);
  assert.ok(bounds.width>0&&bounds.width<=361);
  if(wide)assert.ok(Math.abs(bounds.width-360)<1);
  assert.ok(bounds.leftMargin>=15&&bounds.rightMargin>=15,'Open Chats respects panel margins: '+JSON.stringify(bounds));
  assert.ok(Math.abs(bounds.anchor)<1,'Open Chats aligns with its button');
}

async function checkSearchFocus(win,selector,color){
  win.focus();
  await until(()=>evaluate(win,'return document.hasFocus();'),'search window focus');
  const style=await evaluate(win,`
    const field=document.querySelector(${JSON.stringify(selector)});
    const initialWidth=getComputedStyle(field).borderTopWidth;
    field.focus();
    const style=getComputedStyle(field);
    return [document.activeElement===field,style.borderTopColor,style.borderTopWidth===initialWidth,style.outlineStyle];
  `);
  assert.deepEqual(style,[true,color,true,'none']);
}

const scrollbarThumb=(win,selector)=>evaluate(win,
  'return getComputedStyle(document.querySelector('+JSON.stringify(selector)+'),"::-webkit-scrollbar-thumb").backgroundColor;');

async function checkSessionSidebar(chat){
  const side='.chat-session-sidebar',toggle=label('Toggle sessions sidebar');
  const names=()=>evaluate(chat,"return [...document.querySelectorAll('.chat-history-name')].map(row=>row.textContent);");
  const activeTab=()=>textOf(chat,'.agent-session-tab.active');
  const row=name=>'.chat-history-select'+byTitle(name);
  // Keep the breakpoint measurable even on smaller test displays.
  const zoom=Math.min(1,(screen.getDisplayMatching(chat.getBounds()).workArea.width-40)/1450);
  chat.webContents.setZoomFactor(zoom);
  const resize=async width=>{
    chat.setContentSize(Math.round(width*zoom),chat.getContentSize()[1]);
    await until(()=>evaluate(chat,'return Math.abs(window.innerWidth-'+width+')<5;'),'Chat width '+width);
  };
  await resize(1080);
  await until(async()=>!await has(chat,side),'compact Chat');
  await resize(1200);
  await until(()=>has(chat,row('Earlier discussion')),'current project history in wide Chat');
  const sidebarWidth=()=>evaluate(chat,"return Math.round(document.querySelector('.chat-session-sidebar').getBoundingClientRect().width);");
  assert.equal(await sidebarWidth(),264);
  const leftInsets=await evaluate(chat,`
    const sidebar=document.querySelector('.chat-session-sidebar');
    return ['h2','.session-search input','.chat-session-group h3'].map(selector=>
      Math.round(sidebar.querySelector(selector).getBoundingClientRect().left-sidebar.getBoundingClientRect().left));
  `);
  assert.deepEqual(leftInsets,[20,20,20]);
  assert.deepEqual(await names(),['Window test','Earlier discussion'],'use input time and exclude unsent drafts');
  await click(chat,toggle);
  await until(async()=>!await has(chat,side),'manual collapse');
  await resize(1080);
  await resize(1200);
  await until(()=>has(chat,toggle+'[aria-expanded="false"]'),'manual collapse survives resize');
  await click(chat,toggle);
  await resize(1080);
  await until(async()=>!await has(chat,side),'automatic collapse');
  await resize(1440);
  await until(()=>has(chat,row('Window test')),'automatic expansion');
  assert.equal(await sidebarWidth(),280);
  const columnWidths=await evaluate(chat,`
    const rect=selector=>document.querySelector(selector).getBoundingClientRect();
    const message=rect('.agent-run'),composer=rect('.agent-composer');
    return [Math.round(message.width),Math.round(composer.width),Math.round(message.left-composer.left)];
  `);
  assert.deepEqual(columnWidths,[840,840,0]);

  await evaluate(chat,"const trigger=document.querySelector('.agent-session-more');trigger.focus();trigger.click();");
  await until(()=>has(chat,'.agent-session-more-menu'),'wide Open Chats menu');
  await checkMenuBounds(chat,true);
  await click(chat,'.agent-session-more');
  const input=side+' input[aria-label="Search conversations"]';
  await checkSearchFocus(chat,input,'rgb(222, 222, 222)');
  await chat.webContents.insertText('scrollTop');
  await until(()=>textOf(chat,'.chat-history-snippet').then(text=>text==='scrollTop in the editor'),'body search result');
  assert.deepEqual([lastSearch.projectId,lastSearch.scope,lastSearch.query],[projectId,'current','scrollTop']);
  assert.deepEqual(await names(),['Earlier discussion']);
  await evaluate(chat,"const field=document.querySelector('.chat-session-sidebar input');field.select();document.execCommand('delete');");
  await until(()=>has(chat,row('Window test')),'cleared history search');
  const before=sessionOpens;
  await click(chat,row('Window test'));
  assert.equal(sessionOpens,before);
  await click(chat,row('Earlier discussion'));
  await until(()=>activeTab().then(name=>name?.includes('Earlier discussion')),'open session from history');
  await click(chat,row('Window test'));
  await until(()=>activeTab().then(name=>name?.includes('Window test')),'switch to existing tab');
  assert.equal(await evaluate(chat,"return document.querySelectorAll('.agent-session-tab [role=tab]').length;"),2);
  await click(chat,label('Close Earlier discussion'));
  await until(async()=>!await has(chat,'.agent-session-tab '+byTitle('Earlier discussion')),'closed history tab');
  assert.equal(await has(chat,row('Earlier discussion')),true);
}

async function run(main){
  await until(()=>has(main,'.project-tab'),'test project');
  await click(main,label('Pi Agent'));
  await until(()=>textOf(main,'.agent-session-tab.active').then(text=>text?.includes('Window test')),'session');
  assert.equal(await scrollbarThumb(main,'.agent-chat-body'),'rgb(214, 214, 214)');
  const originalOpens=sessionOpens;
  const input='.citation-composer';
  await click(main,'.agent-project-trigger');
  await until(()=>has(main,'.session-dialog'),'Sessions dialog');
  assert.equal(await scrollbarThumb(main,'.session-groups'),'rgb(235, 235, 235)');
  await checkSearchFocus(main,'.session-dialog input[aria-label="Search conversations"]','rgb(0, 0, 0)');
  await click(main,'.session-dialog '+label('Close'));
  await evaluate(main,"const edit=document.querySelector('.citation-composer');edit.focus();document.execCommand('insertText',false,'unfinished draft');");
  await checkComposerLayout(main,false);
  await mouseClick(main,byTitle('Open Chats'));
  await until(()=>has(main,'.agent-session-more-menu'),'docked Open Chats menu');
  await checkMenuBounds(main);
  await mouseClick(main,byTitle('Open Chats'));
  const stream=delta=>main.webContents.send('revu:agent-event',{type:'event',projectId,sessionId:'panel-session',
    payload:{type:'message_update',assistantMessageEvent:{type:'text_delta',delta}}});
  stream('Before ');
  await until(()=>textOf(main,'.agent-chat-body').then(text=>text?.includes('Before')),'initial response');
  const scroll=win=>evaluate(win,"return document.querySelector('.agent-chat-body').scrollTop;");
  await evaluate(main,"document.querySelector('.agent-chat-body').scrollTop=116;");
  const initialScroll=await scroll(main);
  assert.ok(initialScroll>100);
  await click(main,byTitle('Separate Chat window'));
  await until(()=>panelWindow('Chat')?.isVisible(),'detached Chat');
  const chat=panelWindow('Chat');
  assert.equal(await has(main,'.agent-chat'),false);
  assert.equal(await textOf(chat,input),'unfinished draft');
  assert.ok(Math.abs(await scroll(chat)-initialScroll)<2,'preserve reading position on detach');
  await checkComposerLayout(chat,true);
  assert.equal(await has(chat,'.window-close'),true);
  assert.equal(await has(chat,byTitle('Merge Chat window')),false);
  assert.equal(await has(chat,byTitle('Separate Chat window')),false);
  assert.equal(await has(main,dockAll),true);
  assert.equal(await scrollbarThumb(chat,'.agent-chat-body'),'rgb(214, 214, 214)');
  await click(main,byTitle('Use dark theme'));
  await until(()=>evaluate(chat,"return document.documentElement.dataset.theme==='dark'&&getComputedStyle(document.documentElement).colorScheme==='dark';"),'detached theme');
  assert.equal(await scrollbarThumb(chat,'.agent-chat-body'),'rgb(48, 48, 48)');
  stream('and after');
  await until(()=>textOf(chat,'.agent-chat-body').then(text=>text?.includes('Before and after')),'stream across detach');

  await mouseClick(chat,byTitle('Open Chats'));
  await until(()=>has(chat,'.agent-session-more-menu'),'Open Chats menu in its own window');
  await checkMenuBounds(chat);
  assert.equal(await scrollbarThumb(chat,'.agent-session-more-menu'),'rgb(48, 48, 48)');
  await mouseClick(chat,byTitle('Open Chats'));
  await click(main,label('Review Dashboard'));
  await click(main,byTitle('Split review panes'));
  await click(main,byTitle('Separate Review window'));
  await until(()=>panelWindow('Review')?.isVisible(),'detached Review');
  const review=panelWindow('Review');
  assert.equal(await has(review,'.window-close'),true);
  assert.equal(await has(review,byTitle('Merge Review window')),false);
  assert.equal(await has(review,byTitle('Separate Review window')),false);
  assert.equal(await has(review,byTitle('Merge review panes')),true);
  assert.equal(await has(review,'.review-chunk-pane'),true);
  assert.equal(await has(main,'.review-dashboard'),false);
  await until(()=>has(review,'.review-file-name'),'changed file');
  assert.notEqual(await scrollbarThumb(review,'.review-file-list'),'rgb(48, 48, 48)');
  await click(review,'.review-file-name');
  await until(()=>textOf(main,'.breadcrumb').then(text=>text?.includes('sample.txt')),'background editor preview');
  assert.equal(review.isFocused(),true);
  await until(()=>has(review,'.chunk-preview'),'review chunk');
  await click(review,'.chunk-preview');
  await until(()=>main.isFocused(),'Go to code focus');

  await click(main,label('File'));
  await until(()=>has(main,'.open-editor-row'),'file reference source');
  assert.equal(await scrollbarThumb(main,'.tree-scroll'),'rgb(48, 48, 48)');
  await evaluate(main,"document.querySelector('.open-editor-row').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));");
  await until(()=>has(main,'[role=menuitem]'),'Cite action');
  await click(main,'[role=menuitem]');
  await until(()=>has(chat,'.citation-composer [data-raw]'),'citation in detached Chat');
  await until(()=>chat.isFocused(),'citation focus');
  const draft=await textOf(chat,input);
  assert.ok(draft.startsWith('unfinished draft'));
  chat.minimize();
  await until(()=>chat.isMinimized(),'minimized Chat');
  await click(main,label('Pi Agent'));
  await until(()=>!chat.isMinimized()&&chat.isFocused(),'restored Chat');
  assert.equal(BrowserWindow.getAllWindows().length,3);

  await click(main,label('Settings'));
  assert.notEqual(await scrollbarThumb(main,'.settings-main'),'rgb(48, 48, 48)');
  await evaluate(main,"[...document.querySelectorAll('.settings-categories button')].find(button=>button.textContent==='Activity Bar').click();");
  const switchDock=()=>evaluate(main,"[...document.querySelectorAll('label.setting-row')].find(row=>row.textContent.includes('Merge all windows')).querySelector('input').click();");
  await switchDock();
  assert.equal(await has(main,dockAll),false);
  await switchDock();
  const bounds=chat.getNormalBounds();
  chat.close();
  await until(()=>chat.isDestroyed(),'system close merged Chat');
  assert.equal(await textOf(main,input),draft);
  assert.equal(await has(main,'.settings-categories'),true);
  assert.equal(await has(main,dockAll),true);
  await click(main,byTitle('Separate Chat window'));
  await until(()=>panelWindow('Chat')?.isVisible(),'second Chat detach');
  assert.deepEqual(panelWindow('Chat').getNormalBounds(),bounds);
  await click(main,dockAll);
  await until(()=>BrowserWindow.getAllWindows().length===1,'merge all');
  assert.equal(await has(main,'.review-file-row.active'),true);
  assert.equal(await has(main,'.review-chunk-pane'),true);
  assert.equal(await has(main,dockAll),false);
  assert.equal(await textOf(main,input),draft);
  assert.equal(sessionOpens,originalOpens);
  stream(' merge');
  await until(()=>textOf(main,'.agent-chat-body').then(text=>text?.includes('Before and after merge')),'stream across merge');
  await click(main,byTitle('Separate Review window'));
  await until(()=>panelWindow('Review')?.isVisible(),'standalone Review');
  await mouseClick(panelWindow('Review'),'.window-close');
  await until(()=>BrowserWindow.getAllWindows().length===1,'close button docked Review');
  assert.equal(await has(main,'.review-file-row.active'),true);

  await click(main,byTitle('Separate Chat window'));
  await click(main,byTitle('Separate Review window'));
  await until(()=>panelWindow('Chat')?.isVisible()&&panelWindow('Review')?.isVisible(),'both windows before exit');
  await checkSessionSidebar(panelWindow('Chat'));
  await evaluate(main,"window.revu.setDirty(true);return window.revu.windowControl('isMaximized');");
  let prompted=false;
  dialog.showMessageBox=async(_window,options)=>{
    assert.equal(options.title,'Unsaved Changes');
    prompted=true;return {response:0};
  };
  main.close();
  await until(()=>prompted,'unsaved file prompt');
  assert.equal(BrowserWindow.getAllWindows().length,3);
  await evaluate(main,"window.revu.setDirty(false);return window.revu.windowControl('isMaximized');");
}

app.on('web-contents-created',(_event,web)=>{
  web.on('console-message',event=>{if(event.level==='error')console.error('Renderer:',event.message);});
});
app.once('browser-window-created',(_event,main)=>{
  main.once('show',()=>run(main).then(()=>{
    console.log('Panel window integration checks passed.');
    main.close();
  }).catch(error=>{console.error(error);app.exit(1);}));
});
require('../dist-electron/main.cjs');
