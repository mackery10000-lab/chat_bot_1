// Fault-injection checks against the real Flask UI, using an isolated offline save.
// No browser prototype changes are shipped; all injections stay in this QA process.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'.local/browser-compat-qa',String(Date.now()));fs.mkdirSync(out,{recursive:true});
const candidates=process.argv.includes('--edge')?[
  path.join(process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),
  path.join(process.env.PROGRAMFILES||'C:/Program Files','Microsoft/Edge/Application/msedge.exe')
]:[path.join(process.env.LOCALAPPDATA,'ms-playwright/chromium-1243/chrome-win64/chrome.exe')];
const executable=process.env.DIALOGUE_QA_CHROME||candidates.find(p=>fs.existsSync(p));
if(!executable)throw new Error('No installed QA browser');
const checks=[],errors=[],intentionalAssetFailures=[];
let server,browser,socket,call,evaluate,serverLog='',browserLog='',sequence=0;
const pending=new Map();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function stop(child){if(!child||child.exitCode!==null)return;child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(3000)]);}
const legacy=`
  Array.prototype.at=undefined;
  HTMLDialogElement.prototype.showModal=undefined;HTMLDialogElement.prototype.close=undefined;
  delete HTMLDialogElement.prototype.open;
  HTMLFormElement.prototype.requestSubmit=undefined;Element.prototype.animate=undefined;
  window.ResizeObserver=undefined;
  const supports=CSS.supports.bind(CSS);CSS.supports=(p,v)=>/aspect-ratio/.test(p)||/cqw|dvh/.test(v)?false:supports(p,v);
  const media=window.matchMedia.bind(window);window.matchMedia=q=>{const m=media(q);Object.defineProperty(m,'addEventListener',{value:undefined});return m;};
`;
const noMedia=`HTMLMediaElement.prototype.play=function(){return Promise.reject(new DOMException('Unsupported test codec','NotSupportedError'));};`;
const mediaHang=`const timer=window.setTimeout;window.setTimeout=function(f,ms,...args){return timer(f,ms===45000?300:ms,...args);};HTMLMediaElement.prototype.play=function(){return new Promise(()=>{});};`;
const renderFailure=`const append=Element.prototype.append;Element.prototype.append=function(...children){if(this.id==='conversation-history')throw new Error('Simulated scene rendering failure');return append.apply(this,children);};`;

try{
  server=spawn(path.join(root,'runtime/python.exe'),['-B','-X','utf8','tools/gameplay_ui_server.py'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  server.stderr.on('data',chunk=>{serverLog=(serverLog+chunk).slice(-6000);});
  const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('QA server timeout')),15000);server.stdout.on('data',chunk=>{const m=String(chunk).match(/QA_PORT=(\d+)/);if(m){clearTimeout(timer);resolve(Number(m[1]));}});server.once('error',reject);});
  const base='http://127.0.0.1:'+port;
  browser=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-extensions','--autoplay-policy=document-user-activation-required','--remote-debugging-port=0','--user-data-dir='+path.join(out,'profile'),'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Browser startup timeout')),20000);browser.stderr.on('data',chunk=>{browserLog=(browserLog+chunk).slice(-6000);const m=String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});browser.once('error',reject);browser.once('exit',code=>reject(new Error('Browser exited '+code)));});
  socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.id&&pending.has(message.id)){const p=pending.get(message.id);pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(new Error(JSON.stringify(message.error))):p.resolve(message.result);}
    if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
    if(message.method==='Fetch.requestPaused'){
      intentionalAssetFailures.push(message.params.request.url);
      call('Fetch.fulfillRequest',{requestId:message.params.requestId,responseCode:404,responseHeaders:[{name:'Content-Type',value:'image/png'}],body:''}).catch(error=>errors.push(String(error)));
    }
  });
  const cdp=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  const {targetId}=await cdp('Target.createTarget',{url:'about:blank'}),{sessionId}=await cdp('Target.attachToTarget',{targetId,flatten:true});
  call=(method,params={})=>cdp(method,params,sessionId);
  await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
  console.log('Compatibility QA:',await cdp('Browser.getVersion'));
  evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  const wait=async(expression,label,timeout=12000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(expression))return;await delay(60);}throw new Error('Timeout '+label+' '+JSON.stringify(await evaluate(`({error:document.querySelector('#error-text')?.textContent,dialog:document.querySelector('#overlay')?.dataset.view,loading:document.querySelector('#scene-loading')?.hidden})`)));};
  const check=async(label,expression)=>{const value=await evaluate(expression);checks.push({label,pass:!!value});if(!value)throw new Error('Failed '+label);};
  const viewport=async(width,height)=>{await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});};
  const media=async reduced=>{await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:reduced?'reduce':'no-preference'}]});};
  const visit=async url=>{const before=await evaluate('performance.timeOrigin');await call('Page.navigate',{url:base+url});await wait(`performance.timeOrigin!==${before}&&document.readyState==='complete'`,'page ready');};
  const ready=async()=>wait(`document.querySelector('#save-status')?.textContent==='기록 보관됨'&&document.querySelector('#scene-loading').hidden&&!document.body.classList.contains('game-booting')`,'game ready');
  const fixture=async phase=>{await visit('/qa/new?phase='+phase);await ready();};
  const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);};
  const snapshot=()=>evaluate(`fetch('/api/game').then(r=>r.json()).then(d=>JSON.stringify(d.game))`);
  const screenshot=async label=>{const s=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,label+'.png'),Buffer.from(s.data,'base64'));};
  const result=async(kind,label)=>{
    await wait(`document.querySelector('#overlay').open&&document.querySelector('#overlay').dataset.view==='ending-complete'&&!document.querySelector('#cinematic').open`,'result '+label,50000);
    await check(label+' preserves the server result and visible restart',`(()=>{const d=document.querySelector('#overlay'),button=document.querySelector('#ending-restart'),r=d.getBoundingClientRect(),b=button.getBoundingClientRect();return d.dataset.ending==='${kind}'&&document.querySelector('.ending-result').textContent==='탈출 ${kind==='good'?'성공':'실패'}'&&r.height>150&&r.width>200&&r.top>=-1&&r.bottom<=innerHeight+1&&b.width>80&&b.height>=25&&getComputedStyle(button).fontSize!=='0px'&&d.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));})()`);
  };
  await media(false);await viewport(1440,900);
  const modes=[
    ['native',''],['missing-browser-features',legacy+noMedia],
    ['dialog-throws',`HTMLDialogElement.prototype.showModal=function(){throw new DOMException('Unavailable modal','InvalidStateError');};`+noMedia],
    ['media-rejected',noMedia],['media-never-starts',mediaHang],['scene-render-fails',renderFailure],
    ['missing-css-and-images',legacy+noMedia]
  ].filter(([name])=>!process.argv.includes('--quick')||name!=='native');
  if(!process.argv.includes('--flow-only')){
  for(const [name,source] of modes){
    const injection=source?await call('Page.addScriptToEvaluateOnNewDocument',{source}):null;
    if(name==='missing-css-and-images')await call('Fetch.enable',{patterns:[{urlPattern:'*/assets/images/*',requestStage:'Request'}]});
    for(const kind of ['good','bad']){
      await viewport(kind==='good'?1440:390,kind==='good'?900:844);
      await fixture('ending_'+kind);const before=await snapshot();
      if(name==='native')await check('native '+kind+' video starts decoding and playback',`new Promise(resolve=>{const video=document.querySelector('#cinematic-video');const timer=setInterval(()=>{if(video.currentTime>.05&&video.videoWidth>0){clearInterval(timer);resolve(true);}},50);setTimeout(()=>{clearInterval(timer);resolve(false);},8000);})`);
      await result(kind,name+' '+kind);
      await check(name+' '+kind+' leaves the saved outcome unchanged',`fetch('/api/game').then(r=>r.json()).then(d=>JSON.stringify(d.game)===${JSON.stringify(before)})`);
      await check(name+' '+kind+' survives Escape without losing its result',`(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return document.querySelector('#overlay').open;})()`);
      await screenshot(name+'-'+kind);
      if(name==='missing-browser-features')await check('missing dialog API uses an accessible fallback '+kind,`document.querySelector('#overlay').classList.contains('dialog-fallback')&&document.querySelector('#overlay').getAttribute('aria-modal')==='true'&&document.querySelectorAll('.dialog-backdrop-fallback').length===1`);
      if(name==='missing-css-and-images')await check('missing certificate retains readable result '+kind,`document.querySelector('#overlay').classList.contains('ending-art-failed')&&getComputedStyle(document.querySelector('#overlay')).backgroundColor!=='rgba(0, 0, 0, 0)'`);
    }
    if(name==='missing-css-and-images')await call('Fetch.disable');
    if(injection)await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:injection.identifier});
  }

  // No ended/timeupdate property callbacks: the final video frame still reaches a result.
  const missingEvents=await call('Page.addScriptToEvaluateOnNewDocument',{source:`document.addEventListener('DOMContentLoaded',()=>{const video=document.querySelector('#cinematic-video');if(video)for(const name of ['onended','ontimeupdate'])Object.defineProperty(video,name,{get:()=>null,set:()=>{}});});`});
  for(const kind of ['good','bad']){
    await fixture('ending_'+kind);await wait(`document.querySelector('#cinematic').open`,'video opens');
    await evaluate(`(()=>{const v=document.querySelector('#cinematic-video');Object.defineProperty(v,'duration',{get:()=>30});Object.defineProperty(v,'currentTime',{get:()=>30});Object.defineProperty(v,'ended',{get:()=>false});})()`);
    await result(kind,'missing-media-events '+kind);
  }
  await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:missingEvents.identifier});

  // Exercise dialogs, text submission and scrolling with the old APIs removed.
  const compat=await call('Page.addScriptToEvaluateOnNewDocument',{source:legacy});
  await media(false);await viewport(390,844);await fixture('transcript');
  await click('#bag-btn');
  await check('fallback inventory opens and blocks background clicks',`(()=>{document.querySelector('#end-talk').click();return document.querySelector('#overlay').open&&document.querySelector('#overlay').dataset.view==='inventory';})()`);
  await click('#close-overlay');await wait(`!document.querySelector('#overlay').open`,'inventory closes');
  await check('closing fallback removes its backdrop',`!document.querySelector('.dialog-backdrop-fallback')`);
  await evaluate(`const input=document.querySelector('#user-message');input.value='입력창 확인';input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));`);await ready();
  await check('Enter submits without requestSubmit and Array.at',`document.querySelector('#user-message').value===''&&document.querySelector('#error-banner').hidden`);
  await click('#history-btn');await check('old-feature fallback history keeps all messages',`document.querySelectorAll('.chat-transcript .chat-row').length>=303`);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
  await wait(`!document.querySelector('#overlay').open`,'Escape closes history');
  await viewport(1440,900);await fixture('feedback');const beforeMap=await snapshot();
  if(await evaluate(`document.querySelector('#map-toggle').getAttribute('aria-expanded')==='true'`)){await click('#map-toggle');await wait(`!document.querySelector('.train-map-bar').classList.contains('rolling')`,'map closes');}
  await click('#map-toggle');await delay(120);
  await check('scroll is partway through its roll without WAAPI',`(()=>{const p=document.querySelector('#train-map-panel'),height=p.getBoundingClientRect().height,full=p.querySelector('.train-map-sheet').getBoundingClientRect().height;return height>0&&height<full&&document.querySelector('.train-map-bar').classList.contains('rolling');})()`);
  await evaluate(`window.visualViewport.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('resize'));`);
  await check('mobile viewport events do not cancel a live roll',`document.querySelector('.train-map-bar').classList.contains('rolling')`);
  await viewport(1440,800);await wait(`!document.querySelector('.train-map-bar').classList.contains('rolling')`,'roll completes after resizing');
  await check('scroll finishes unlocked and fully visible',`(()=>{const p=document.querySelector('#train-map-panel');return !p.inert&&p.style.height===''&&p.getAttribute('aria-hidden')==='false'&&Math.abs(p.getBoundingClientRect().height-p.querySelector('.train-map-sheet').getBoundingClientRect().height)<1.1;})()`);
  await click('#map-toggle');await delay(70);await click('#map-toggle');await wait(`!document.querySelector('.train-map-bar').classList.contains('rolling')`,'rapid reversal');
  await check('rapid direction changes restore the final map state',`document.querySelector('#map-toggle').getAttribute('aria-expanded')==='true'&&!document.querySelector('#train-map-panel').inert`);
  await check('map movement never changes game progress',`fetch('/api/game').then(r=>r.json()).then(d=>JSON.stringify(d.game)===${JSON.stringify(beforeMap)})`);
  await media(true);await click('#map-toggle');
  await check('reduced-motion mode still completes the map state',`document.querySelector('#map-toggle').getAttribute('aria-expanded')==='false'&&!document.querySelector('.train-map-bar').classList.contains('rolling')`);

  // Typewriter lifecycle: no skipped text on back/forward, no background catch-up.
  for(const reduced of [false,true]){
    await media(reduced);await visit('/');
    await wait(`document.querySelector('#line1').textContent.length>0&&document.querySelector('#line1').textContent.length<12`,'typing begins');
    const initial=await evaluate(`document.querySelector('#line1').textContent`);
    await evaluate(`window.dispatchEvent(new Event('pagehide'));`);await delay(250);
    await check('pagehide pauses the typewriter '+reduced,`document.querySelector('#line1').textContent===${JSON.stringify(initial)}`);
    await evaluate(`window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));`);
    await check('pageshow preserves unfinished typing '+reduced,`document.querySelector('#line2').textContent===''`);
    await wait(`document.querySelector('#line1').textContent.length>${initial.length}`,'typing resumes');
    await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));`);
    const paused=await evaluate(`document.querySelector('#line1').textContent`);await delay(200);
    await check('hidden tabs do not advance the typewriter '+reduced,`document.querySelector('#line1').textContent===${JSON.stringify(paused)}`);
    await evaluate(`delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));window.gameSettings.speedMultiplier=()=>{throw new Error('Simulated optional setting failure');};`);
    await wait(`document.querySelector('#line2').textContent==='적어도, 그 열차에 오르기 전까지는...'`,'typing completes after resume',18000);
    await check('typewriter completes without depending on optional settings '+reduced,`document.querySelector('#line1').textContent==='평범한 출장길이었다.'`);
    await click('#settingsBtn');await check('entry settings work without native dialog',`document.querySelector('#settingsDialog').open&&document.querySelector('#settingsDialog').classList.contains('dialog-fallback')`);
    await click('.settings__ok');await wait(`!document.querySelector('#settingsDialog').open`,'fallback dialog form closes');
  }
  await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:compat.identifier});
  }

  // Real confirmations: no injected server outcomes, including the driver's
  // last spoken line before an unsuccessful evidence submission.
  const transition=await call('Page.addScriptToEvaluateOnNewDocument',{source:legacy+noMedia});
  await media(false);await viewport(1440,900);await fixture('proof');
  await click('#bag-btn');await click('[data-item-id="flashlight"]');await ready();
  await click('[aria-label="이 물건을 최종 증거로 제출"]');await ready();
  await check('evidence remains uncommitted until confirmation',`fetch('/api/game').then(r=>r.json()).then(d=>d.game.status==='playing'&&d.game.confirmation.kind==='evidence')`);
  await click('.modal-actions .primary');await ready();
  await check('failed evidence preserves the final NPC line before the ending',`!document.querySelector('#dialogue-box').hidden&&document.querySelector('#speaker-name').textContent==='기관사'&&document.querySelector('#dialogue-text').textContent.length>0`);
  await click('#dialogue-box');await result('bad','live failed evidence');
  await fixture('control');await click('[data-hotspot="control"]');await ready();
  await check('fallback focus navigation includes shadow-root puzzle controls',`(()=>{const root=document.querySelector('.puzzle-host').shadowRoot,lever=root.querySelector('.lever');lever.focus();const event=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,composed:true,cancelable:true});lever.dispatchEvent(event);return event.defaultPrevented&&document.activeElement===document.querySelector('#close-overlay');})()`);
  await evaluate(`(()=>{const root=document.querySelector('.puzzle-host').shadowRoot,input=root.querySelector('.station');input.value='아지산';input.dispatchEvent(new Event('input',{bubbles:true}));[...root.querySelectorAll('.dial')].forEach((dial,index)=>dial.dispatchEvent(new KeyboardEvent('keydown',{key:'2026'[index],bubbles:true,cancelable:true})));root.querySelector('.lever').click();})()`);await ready();
  await check('correct route input still requires explicit confirmation',`fetch('/api/game').then(r=>r.json()).then(d=>d.game.status==='playing'&&d.game.attempts===1&&d.game.confirmation.password==='2026')`);
  await click('.modal-actions .primary');await ready();await result('good','live route success');
  await click('#ending-restart');await wait(`location.pathname==='/'&&!!document.querySelector('#line1')`,'restart returns to entry');
  await check('restart removes every fallback backdrop',`!document.querySelector('.dialog-backdrop-fallback')`);
  await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:transition.identifier});
  if(errors.length)throw new Error(errors.join('\n'));
  console.log(JSON.stringify({passed:checks.length,artifacts:out,intentionalAssetFailures:intentionalAssetFailures.length},null,2));
}catch(error){errors.push(String(error.stack||error));console.error(error.stack||error);process.exitCode=1;if(call)try{const s=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'failure.png'),Buffer.from(s.data,'base64'));}catch{}}
finally{
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({checks,errors,intentionalAssetFailures,executable,...(errors.length?{serverLog,browserLog}:{})},null,2));
  for(const waiter of pending.values()){clearTimeout(waiter.timer);waiter.reject(new Error('QA finished'));}pending.clear();
  socket?.close();await stop(browser);await stop(server);
}
