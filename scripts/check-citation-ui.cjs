const {app,BrowserWindow}=require('electron');
const {buildSync}=require('esbuild');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {pathToFileURL}=require('node:url');
app.setPath('userData',join(tmpdir(),'revu-citation-ui-test-profile'));
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});
  const web=window.webContents,errors=[];web.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
  try{
    const bundle=buildSync({entryPoints:['tests/fixtures/citationUi.tsx'],bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.url':JSON.stringify(pathToFileURL(resolve('src/Icon.tsx')).href)}});
    await window.loadURL(pathToFileURL(resolve('tests/fixtures/citationUi.html')).href);await web.insertCSS(readFileSync('src/styles.css','utf8'));await web.executeJavaScript(bundle.outputFiles[0].text);
    const evaluate=code=>web.executeJavaScript(`(async()=>{const wait=()=>new Promise(resolve=>setTimeout(resolve,30));await wait();${code}})()`);
    await evaluate(`const main=document.querySelector('main');main.classList.add('agent-chat','open');main.style.cssText='position:relative;margin-left:70px;width:460px!important;height:430px;';`);
    assert.equal(await evaluate(`return document.querySelectorAll('.citation-composer [data-raw]').length;`),2);
    assert.equal(await evaluate(`return document.querySelectorAll('.citation-composer [aria-label="Edit reference"]').length;`),1);
    assert.equal(await evaluate(`const editor=document.querySelector('.citation-composer');editor.focus();const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);window.getSelection().removeAllRanges();window.getSelection().addRange(range);document.execCommand('insertText',false,' later');await wait();return document.querySelector('output').textContent;`),'Review @"price.ts"#L2 and @"src/" later');
    assert.equal(await evaluate(`const edit=document.querySelector('.citation-composer');const range=document.createRange();range.selectNode(edit.querySelector('[data-raw]'));window.getSelection().removeAllRanges();window.getSelection().addRange(range);document.execCommand('delete');await wait();return document.querySelector('output').textContent;`),'Review  and @"src/" later');
    const caretPrefix=()=>evaluate(`
      const edit=document.querySelector('.citation-composer'),selection=getSelection(),prefix=document.createRange();
      prefix.selectNodeContents(edit);prefix.setEnd(selection.focusNode,selection.focusOffset);
      const content=prefix.cloneContents();for(const token of content.querySelectorAll('[data-raw]'))token.replaceWith(token.dataset.raw);
      return content.textContent;
    `);
    for(const side of ['left','right']){
      const point=await evaluate(`const box=document.querySelector('.citation-composer .cite-chip').getBoundingClientRect();return {x:${side==='left'?'Math.floor(box.left)-1':'Math.ceil(box.right)+1'},y:Math.floor(box.top+box.height/2)};`);
      web.sendInputEvent({type:'mouseMove',...point});
      web.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
      web.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
      const before='Review  and ',after=before+'@"src/"',left=side==='left';
      assert.equal(await caretPrefix(),left?before:after);
      await evaluate(`const wrapper=document.querySelector('.citation-composer [data-raw]'),text=wrapper.${left?'previousSibling':'nextSibling'};wrapper.parentElement.focus();getSelection().collapse(text,${left?'text.length-1':'1'});document.addEventListener('keydown',event=>window.testArrow=[event.key,event.code,document.activeElement.className],{once:true});`);
      const keyCode=left?'Right':'Left';
      web.sendInputEvent({type:'keyDown',keyCode});web.sendInputEvent({type:'keyUp',keyCode});
      assert.deepEqual([await caretPrefix(),await evaluate('return window.testArrow;')],[left?before:after,[left?'ArrowRight':'ArrowLeft',left?'ArrowRight':'ArrowLeft','citation-composer']]);
    }
    for(const theme of ['light','dark']){
      web.debugger.attach();
      const move=(x,y)=>web.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
      await move(0,0);
      const bubbleStyle=()=>evaluate(`
        const chip=document.querySelector('.agent-user-bubble .cite-chip'),label=chip.querySelector('.cite-label');
        const surrounding=chip.previousSibling,rect=document.createRange(),glyph=document.createRange();rect.setStart(surrounding,surrounding.length-2);rect.setEnd(surrounding,surrounding.length-1);glyph.selectNodeContents(label);
        const box=chip.getBoundingClientRect(),style=getComputedStyle(chip);
        return {baseline:Math.abs(rect.getBoundingClientRect().top-glyph.getBoundingClientRect().top)<=1,bg:style.backgroundColor,color:style.color,width:box.width,x:Math.floor(box.left+box.width/2),y:Math.floor(box.top+box.height/2),tools:getComputedStyle(chip.querySelector('.cite-tools')).visibility};`);
      await evaluate(`document.activeElement.blur();document.documentElement.dataset.theme='${theme}';`);
      const resting=await bubbleStyle();
      assert.deepEqual([resting.baseline,resting.bg,resting.color,resting.tools],[true,'rgba(0, 0, 0, 0)',theme==='dark'?'rgb(153, 200, 239)':'rgb(24, 89, 141)','hidden']);
      await move(resting.x,resting.y);
      const hovered=await bubbleStyle();
      assert.deepEqual([hovered.width,hovered.tools,hovered.bg!==resting.bg],[resting.width,'visible',true]);
      const skillStyle=()=>evaluate(`const skill=document.querySelector('.agent-user-bubble .skill-chip'),style=getComputedStyle(skill),rect=skill.getBoundingClientRect();return {bg:style.backgroundColor,color:style.color,x:rect.left+rect.width/2,y:rect.top+rect.height/2};`);
      const skill=await skillStyle();
      assert.deepEqual([skill.bg,skill.color],['rgba(0, 0, 0, 0)',theme==='dark'?'rgb(222, 194, 239)':'rgb(112, 62, 140)']);
      await move(skill.x,skill.y);assert.equal((await skillStyle()).bg,theme==='dark'?'rgb(81, 65, 88)':'rgb(227, 215, 240)');
      await move(0,0);web.debugger.detach();
      assert.deepEqual(await evaluate(`
        document.documentElement.dataset.theme='${theme}';
        const editor=document.querySelector('.citation-composer'),wrapper=editor.querySelector('[data-raw]'),chip=wrapper.querySelector('.cite-chip'),label=chip.querySelector('.cite-label');
        const rect=(node,edge)=>{const range=document.createRange();range.selectNodeContents(node);if(edge!==undefined)range.collapse(edge);return range.getBoundingClientRect();};
        const box=chip.getBoundingClientRect(),before=rect(wrapper.previousSibling,false),after=rect(wrapper.nextSibling,true);
        return [getComputedStyle(label).textAlign,Math.abs(before.top-rect(label).top)<=1,Math.round(box.left-before.right),Math.round(after.left-box.right),getComputedStyle(document.querySelector('.agent-user-bubble .cite-chip')).marginInlineStart];
      `),['center',true,3,2,'0px']);
      assert.equal(await evaluate(`document.documentElement.dataset.theme='${theme}';const chip=document.querySelector('.agent-user-bubble .cite-chip'),label=chip.querySelector('.cite-label'),tools=chip.querySelector('.cite-tools');chip.blur();const width=chip.offsetWidth;chip.focus();const centered=[...tools.children].every(button=>{const box=button.getBoundingClientRect(),icon=button.firstElementChild.getBoundingClientRect();return Math.abs(box.left+box.width/2-icon.left-icon.width/2)<1&&Math.abs(box.top+box.height/2-icon.top-icon.height/2)<1;});return width===chip.offsetWidth&&width>=tools.offsetWidth&&getComputedStyle(label).visibility==='hidden'&&getComputedStyle(tools).visibility==='visible'&&centered;`),true);
    }
    assert.deepEqual(await evaluate(`document.querySelector('.skill-chip').click();await wait();const bubble=document.querySelector('.agent-user-bubble'),height=bubble.offsetHeight;bubble.querySelector('[aria-label="View snapshot"]').click();await wait();const text=document.querySelector('.citation-preview code');const range=document.createRange();range.selectNodeContents(text);window.getSelection().removeAllRanges();window.getSelection().addRange(range);text.click();return [window.getSelection().toString(),height===bubble.offsetHeight,!bubble.contains(text),document.querySelectorAll('.cite-details').length];`),['selected code',true,true,1]);
    assert.deepEqual(await evaluate(`document.querySelectorAll('[aria-label="View snapshot"]')[1].click();await wait();const card=document.querySelector('.citation-preview'),code=card.querySelector('code'),range=document.createRange();range.selectNodeContents(code);getSelection().removeAllRanges();getSelection().addRange(range);return [card.querySelector('.citation-caption').textContent,[...card.querySelectorAll('[data-line]')].map(node=>node.dataset.line),code.textContent,getSelection().toString(),code.querySelector('.citation-indent').getBoundingClientRect().width,!!code.querySelector('[data-token=keyword]')];`),['price.ts · 2–3',['2','3'],'    if (ok) {\n      run();','    if (ok) {\n      run();',0,true]);
    assert.deepEqual(await evaluate(`const main=document.querySelector('main'),bubble=document.querySelectorAll('.agent-user-bubble')[1],chip=bubble.querySelector('.cite-chip'),card=document.querySelector('.citation-preview');bubble.style.cssText='position:absolute;left:200px;top:230px';const result=[];for(const [left,top] of [[200,230],[-10,230],[385,0]]){bubble.style.left=left+'px';bubble.style.top=top+'px';window.dispatchEvent(new Event('resize'));await wait();const target=chip.getBoundingClientRect(),preview=card.getBoundingClientRect(),panel=main.getBoundingClientRect();result.push([left===200?Math.abs(target.left+target.width/2-preview.left-preview.width/2)<1:left<0?Math.abs(preview.left-panel.left-8)<1:Math.abs(panel.right-preview.right-8)<1,top===0?preview.top>=target.bottom:preview.bottom<=target.top]);}return result;`),[[true,true],[true,true],[true,true]]);
    assert.equal(await evaluate(`document.querySelectorAll('[aria-label="View snapshot"]')[1].click();await wait();return !!document.querySelector('.citation-preview');`),false);
    assert.equal(await evaluate(`document.querySelector('[aria-label="View snapshot"]').click();await wait();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait();return !!document.querySelector('.citation-preview');`),false);
    assert.equal(await evaluate(`document.querySelector('[aria-label="Copy reference"]').click();await wait();return document.querySelector('#copied').textContent;`),'@"price.ts"#L2');
    assert.equal(await evaluate(`document.querySelector('[aria-label="View snapshot"]').click();await wait();document.querySelector('#next').click();await wait();return document.querySelectorAll('.cite-details,.citation-preview').length;`),0);
    assert.equal(await evaluate(`document.querySelector('.citation-composer [aria-label="Delete reference"]').click();await wait();return document.querySelector('output').textContent;`),'Review  and  later');
    assert.equal(await evaluate(`const edit=document.querySelector('.citation-composer'),data=new DataTransfer();edit.focus();data.setData('text/plain','@“some dir/a.py”#L3-L4');edit.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));await wait();return edit.querySelector('[data-raw]').dataset.raw;`),'@“some dir/a.py”#L3-L4');
    const chatBundle=buildSync({entryPoints:['tests/fixtures/citationChatUi.tsx'],bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','import.meta.url':JSON.stringify(pathToFileURL(resolve('src/Icon.tsx')).href)}});
    await window.loadURL(pathToFileURL(resolve('tests/fixtures/citationUi.html')).href);await web.insertCSS(readFileSync('src/styles.css','utf8'));
    await web.executeJavaScript(`window.calls=[];window.revu={
      invoke:async()=>({ok:true,value:[{path:'some dir/a.ts',kind:'file'},{path:'a.ts',kind:'file'}]}),
      chooseChatFiles:async(...args)=>{calls.push(['choose',...args]);return window.picked??[];},
      agent:new Proxy({onEvent:()=>()=>{}},{get:(target,method)=>target[method]??(async(projectId,sessionId)=>{
        calls.push([method,projectId,sessionId]);const value=method==='latestSession'?'first':method==='openSession'?{projectId,sessionId,name:sessionId,messages:[],status:'idle',availableThinkingLevels:[],thinkingLevel:'medium'}:method==='getEntries'?{entries:[],leafId:null}:method==='listSessions'?{sessions:[]}:[];return {ok:true,value};})})};void 0;`);
    await web.executeJavaScript(chatBundle.outputFiles[0].text);
    assert.equal(await evaluate(`document.querySelector('#cite-Test2').click();await wait();return document.querySelector('.citation-composer [data-raw]').dataset.raw;`),'@"D:/work/Test2/some dir/a.ts"');
    assert.deepEqual(await evaluate(`document.querySelector('.citation-composer [aria-label="Edit reference"]').click();await wait();return [calls.filter(row=>row[0]==='openSession').length,calls.find(row=>row[0]==='choose'),document.querySelector('.agent-project-trigger').textContent];`),[1,['choose','Test1',{path:'D:/work/Test2/some dir/a.ts',directory:false}],'Test1']);
    await evaluate(`document.querySelector('#cite-Test1').click();document.addEventListener('click',event=>{if(event.target.closest('[aria-label="Edit reference"]'))window.trustedEditorClick=event.isTrusted;},true);`);
    const center=selector=>evaluate(`const node=document.querySelectorAll(${JSON.stringify(selector)})[1];node.scrollIntoView({block:'nearest'});const rect=node.getBoundingClientRect();return {x:Math.floor(rect.left+rect.width/2),y:Math.floor(rect.top+rect.height/2)};`);
    const clickEditor=async()=>{
      web.sendInputEvent({type:'mouseMove',...await center('.citation-composer .cite-chip')});
      const point=await center('.citation-composer [aria-label="Edit reference"]');
      web.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
      web.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
    };
    await clickEditor();
    assert.deepEqual(await evaluate(`const edit=document.querySelector('.citation-composer'),option=document.querySelector('.agent-path-menu [role=option]'),rect=option?.getBoundingClientRect(),sel=getSelection(),end=document.createRange();end.selectNodeContents(edit);end.setStart(sel.focusNode,sel.focusOffset);return [window.trustedEditorClick,document.activeElement===edit,edit.textContent.endsWith('@some dir/a.ts'),end.toString(),!!rect&&option.contains(document.elementFromPoint(rect.x+10,rect.y+rect.height/2))];`),[true,true,true,'',true]);
    await web.insertText('nomatch');assert.equal(await evaluate(`return document.querySelector('.agent-path-menu')?.textContent;`),'No matching files or folders');
    const key=keyCode=>{web.sendInputEvent({type:'keyDown',keyCode});web.sendInputEvent({type:'keyUp',keyCode});};
    key('Backspace');assert.equal(await evaluate(`return document.querySelector('.citation-composer').textContent.endsWith('@some dir/a.tsnomatc');`),true);
    key('Escape');assert.equal(await evaluate(`return document.querySelectorAll('.citation-composer [data-raw]')[1].dataset.raw;`),'@"some dir/a.ts"');
    await evaluate(`const edit=document.querySelector('.citation-composer'),range=document.createRange(),data=new DataTransfer();edit.focus();range.selectNodeContents(edit);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range);data.setData('text/plain','  suffix');edit.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));`);
    await clickEditor();assert.equal(await evaluate(`const end=document.createRange();end.selectNodeContents(document.querySelector('.citation-composer'));end.setStart(getSelection().focusNode,getSelection().focusOffset);return end.toString();`),'  suffix');
    key('Escape');
    assert.equal(await evaluate(`document.querySelectorAll('.citation-composer [aria-label="Edit reference"]')[1].click();await wait();const input=document.querySelector('.citation-composer'),range=document.createRange(),node=[...input.childNodes].find(node=>node.nodeType===3&&node.textContent.includes('@some dir/a.ts'));const start=node.textContent.indexOf('@some dir/a.ts')+1;range.setStart(node,start);range.setEnd(node,start+'some dir/a.ts'.length);window.getSelection().removeAllRanges();window.getSelection().addRange(range);document.execCommand('insertText',false,'a.ts');await wait();input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await wait();return input.querySelectorAll('[data-raw]')[1].dataset.raw;`),'@"a.ts"');
    assert.equal(await evaluate(`window.picked=['C:/outside/replacement.ts'];document.querySelector('.citation-composer [aria-label="Edit reference"]').click();await wait();return document.querySelector('.citation-composer [data-raw]').dataset.raw;`),'@"C:/outside/replacement.ts"');
    assert.equal(await evaluate(`document.querySelector('#other-chat').click();await wait();document.querySelector('.agent-session-more').click();await wait();const group=document.querySelector('[role=group][aria-label=Test1]'),row=group.querySelector('.open-chat-option'),left=row.firstElementChild.getBoundingClientRect(),close=row.lastElementChild.getBoundingClientRect(),right=row.getBoundingClientRect().right;row.lastElementChild.click();await wait();return Math.abs(left.right-close.left)<1&&Math.abs(close.right-right)<1;`),true);
    assert.deepEqual(await evaluate(`return [document.querySelector('.agent-project-trigger').textContent,calls.filter(row=>row[0]==='openSession').length,calls.some(row=>row[0]==='releaseSession'&&row[1]==='Test1'&&row[2]==='first')];`),['Test2',2,true]);
    const fresh='@"some dir/a.ts"';
    const draftText=()=>evaluate(`const clone=document.querySelector('.citation-composer').cloneNode(true);for(const node of clone.querySelectorAll('[data-raw]'))node.replaceWith(node.dataset.raw);return clone.textContent;`);
    const clearDraft=()=>evaluate(`const edit=document.querySelector('.citation-composer');edit.focus();const range=document.createRange();range.selectNodeContents(edit);getSelection().removeAllRanges();getSelection().addRange(range);edit.dispatchEvent(new ClipboardEvent('cut',{clipboardData:new DataTransfer(),bubbles:true,cancelable:true}));`);
    const cite=async()=>{await clearDraft();await evaluate("document.querySelector('#cite-Test2').click();");assert.equal(await draftText(),fresh);};
    const paste=text=>evaluate(`const data=new DataTransfer();data.setData('text/plain',${JSON.stringify(text)});document.querySelector('.citation-composer').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));`);
    await cite();await web.insertText('explain');await web.insertText('!');assert.equal(await draftText(),fresh+' explain!');
    await cite();await web.insertText(' ');await web.insertText('explain');assert.equal(await draftText(),fresh+' explain');
    await cite();await web.insertText('。');await web.insertText('继续');assert.equal(await draftText(),fresh+'。继续');
    for(const [suffix,expected] of [['解释一下',' 解释一下'],['  explain','  explain'],['\nexplain','\nexplain'],['，继续','，继续'],[')later',')later']]){
      await cite();await paste(suffix);assert.equal(await draftText(),fresh+expected);
    }
    await clearDraft();await paste(fresh);await web.insertText('existing');assert.equal(await draftText(),fresh+'existing');
    await cite();web.debugger.attach();try{
      await web.debugger.sendCommand('Input.imeSetComposition',{text:'jie',selectionStart:3,selectionEnd:3});assert.equal(await draftText(),fresh+'jie');
      await web.debugger.sendCommand('Input.insertText',{text:'解释'});assert.equal(await draftText(),fresh+' 解释');
      await web.insertText('一下');assert.equal(await draftText(),fresh+' 解释一下');
    }finally{web.debugger.detach();}
    assert.deepEqual(errors,[]);console.log('Citation UI checks passed, including bubble baselines, hover and IME continuation.');
  }finally{window.destroy();}
}).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1);});
