import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
// Run: node tools/check_gameplay_ui.mjs [--screenshots] [--entry-only|--window-map-only|--presentation-only|--interface-only|--cleaner-items-only|--feedback-only|--scenes-only|--puzzles-only|--cinematics-only|--doors-only|--inventory-only]
// Uses an isolated save and offline model. No remote AI or dependency installation.
// GAMEPLAY_QA_GAME_ROOT selects an extracted portable game for the same checks.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gameRoot = path.resolve(process.env.GAMEPLAY_QA_GAME_ROOT || root);
const cinematicsOnly = process.argv.includes('--cinematics-only');
const doorsOnly = process.argv.includes('--doors-only');
const inventoryOnly = process.argv.includes('--inventory-only');
const scenesOnly = process.argv.includes('--scenes-only');
const feedbackOnly = process.argv.includes('--feedback-only');
const cleanerItemsOnly = process.argv.includes('--cleaner-items-only');
const interfaceOnly = process.argv.includes('--interface-only');
const presentationOnly = process.argv.includes('--presentation-only');
const windowMapOnly = process.argv.includes('--window-map-only');
const entryOnly = process.argv.includes('--entry-only');
const entryArtOnly = process.argv.includes('--entry-art-only');
const out = path.join(root, '.local', 'gameplay-ui-qa', String(Date.now()));
fs.mkdirSync(out, {recursive: true});
const chromeProfile = fs.mkdtempSync(path.join(out, 'chrome-'));
function websocketClass() {
 if (globalThis.WebSocket) return globalThis.WebSocket;
 const require=createRequire(import.meta.url);
 try { return require('ws'); } catch {}
 const cache=path.join(process.env.LOCALAPPDATA||os.homedir(),'npm-cache','_npx');
 for(const folder of fs.existsSync(cache)?fs.readdirSync(cache):[]){try{return require(path.join(cache,folder,'node_modules','ws'));}catch{}}
 throw new Error('Use Node 22+ or an existing ws package.');
}
function chromeExecutable() {
 if(process.env.DIALOGUE_QA_CHROME)return process.env.DIALOGUE_QA_CHROME;
 const cache=path.join(process.env.LOCALAPPDATA||os.homedir(),'ms-playwright');
 const folders=fs.existsSync(cache)?fs.readdirSync(cache).filter(p=>/^chromium-\d+$/.test(p)).sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1])):[];
 const candidates=folders.map(p=>path.join(cache,p,'chrome-win64','chrome.exe'));
 candidates.push(path.join(process.env.PROGRAMFILES||'C:/Program Files','Google/Chrome/Application/chrome.exe'));
 const found=candidates.find(p=>fs.existsSync(p));
 if(!found)throw new Error('Chrome not found. Set DIALOGUE_QA_CHROME.');return found;
}
async function stopChild(child) {
 if(!child||child.exitCode!==null)return;
 await new Promise(resolve=>{const timer=setTimeout(resolve,5000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill();});
}
const checks=[],errors=[],networkErrors=[],inventoryMetrics=[],actorMetrics=[];let server,browser,socket,captureFailure,serverLog='';
try {
 server=spawn(process.env.GAMEPLAY_QA_PYTHON||process.env.DIALOGUE_QA_PYTHON||path.join(gameRoot,'runtime/python.exe'),['-B','-X','utf8',path.join(root,'tools/gameplay_ui_server.py')],{cwd:gameRoot,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});
 // Flask logs every request. Drain the pipe so long suites cannot block the
 // server when its OS stderr buffer fills, retaining only useful diagnostics.
 server.stderr.on('data',data=>{serverLog=(serverLog+data.toString()).slice(-8000);});
 const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server startup timeout')),15000);server.stdout.on('data',data=>{const m=data.toString().match(/QA_PORT=(\d+)/);if(m){clearTimeout(timer);resolve(Number(m[1]));}});server.once('error',reject);server.once('exit',code=>reject(new Error('Server exited '+code)));});
 const base='http://127.0.0.1:'+port;
 browser=spawn(chromeExecutable(),['--headless=new',...(process.argv.includes('--software-renderer')?['--disable-gpu']:[]),...(process.argv.includes('--no-sandbox')?['--no-sandbox']:[]),'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-extensions','--disable-breakpad','--autoplay-policy=document-user-activation-required','--remote-debugging-port=0','--user-data-dir='+chromeProfile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 const ws=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Chrome startup timeout')),15000);browser.stderr.on('data',data=>{const m=data.toString().match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});browser.once('error',reject);});
 const Socket=websocketClass();socket=new Socket(ws);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let id=0;const pending=new Map();
 socket.addEventListener('message',event=>{const m=JSON.parse(typeof event.data==='string'?event.data:event.data.toString());if(m.method==='Network.responseReceived'&&m.params.response.status>=400&&/\/(assets|api)\//.test(m.params.response.url))networkErrors.push({url:m.params.response.url,status:m.params.response.status});if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(p.method+' '+JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
 const cdp=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>reject(new Error('CDP timeout '+method)),20000);pending.set(n,{resolve,reject,timer,method});socket.send(JSON.stringify({id:n,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await cdp('Target.createTarget',{url:'about:blank'}),{sessionId}=await cdp('Target.attachToTarget',{targetId,flatten:true});
 const call=(method,params={})=>cdp(method,params,sessionId);
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 captureFailure=async()=>{const r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,'failed.png'),Buffer.from(r.data,'base64'));fs.writeFileSync(path.join(out,'failure-state.json'),JSON.stringify(await evaluate(`(async()=>({game:await fetch('/api/game').then(r=>r.json()).then(d=>d.game),puzzle:document.querySelector('.puzzle-host')?.shadowRoot.innerHTML,overlay:document.querySelector('#overlay')?.outerHTML,cinematic:document.querySelector('#cinematic')?.outerHTML,video:(()=>{const v=document.querySelector('#cinematic-video');return v?{src:v.currentSrc,readyState:v.readyState,error:v.error?.code,paused:v.paused,time:v.currentTime,duration:v.duration}:null;})()}))()`),null,2));};
 const wait=async(expression,label=expression,timeoutMs=10500)=>{const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,70));}throw new Error('Timeout '+label+' '+JSON.stringify(await evaluate(`({error:document.querySelector('#error-text')?.textContent,images:[...document.images].filter(i=>!i.complete||!i.naturalWidth).map(i=>i.src)})`)));};
 const check=async(label,expression)=>{const value=typeof expression==='string'?await evaluate(expression):expression;checks.push({label,pass:!!value});if(!value)throw new Error('Failed '+label);};
 const viewport=async(width,height=900)=>{await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:width===390?2:1,mobile:width<601});await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');};
 const navigate=async url=>{const previous=await evaluate('performance.timeOrigin');await call('Page.navigate',{url:base+url});await wait(`performance.timeOrigin!==${previous}&&document.readyState==='complete'&&!!window.TrainAudio`);await evaluate('document.fonts.ready');};
 const ready=async()=>wait(`document.querySelector('#scene-loading')?.hidden&&document.querySelector('#save-status')?.textContent==='기록 보관됨'`);
 const seed=async phase=>{await navigate('/qa/new?phase='+phase);await ready();};
 const click=async(selector,hoverOnly=false)=>{
  const p=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('Missing '+${JSON.stringify(selector)});el.scrollIntoView({block:'center',inline:'nearest'});const r=el.getBoundingClientRect(),left=Math.max(0,r.left),top=Math.max(0,r.top),right=Math.min(innerWidth,r.right),bottom=Math.min(innerHeight,r.bottom),polygon=el.style.clipPath.match(/[0-9.]+%/g)?.map(parseFloat);if(polygon?.length>=6){const count=polygon.length/2,x=r.left+r.width*polygon.filter((_,i)=>i%2===0).reduce((a,b)=>a+b,0)/count/100,y=r.top+r.height*polygon.filter((_,i)=>i%2===1).reduce((a,b)=>a+b,0)/count/100;if(el.contains(document.elementFromPoint(x,y)))return{x,y};}for(const fy of [.5,.3,.7,.1,.9,.2,.8,.05,.95])for(const fx of [.5,.3,.7,.1,.9,.2,.8,.05,.95]){const x=left+(right-left)*fx,y=top+(bottom-top)*fy;if(right>left&&bottom>top&&el.contains(document.elementFromPoint(x,y)))return{x,y};}throw new Error('Control is covered: '+${JSON.stringify(selector)});})()`);
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',...p});if(hoverOnly)return;await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});
 };
 const snapshot=async name=>{if(!process.argv.includes('--screenshots')&&!name.startsWith('failed'))return;await evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');let r;try{r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});}catch(error){if(!String(error).includes('\"code\":-32603'))throw error;await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});}fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'));};
 const images=async()=>wait(`[...document.querySelector('#overlay').querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth)`);
 const openBag=async()=>{await click('#bag-btn');await wait(`document.querySelector('#overlay').dataset.inventoryMode==='overview'`);await images();};
 const openItem=async id=>{
  const result=await evaluate(`fetch('/api/game').then(r=>r.json())`);
  const target=result.game.inventory.findIndex(i=>i.id===id),capacity=await evaluate(`matchMedia('(max-width:600px)').matches?6:8`);
  if(await evaluate(`document.querySelector('#overlay').dataset.inventoryMode!=='overview'`)){await click('.inventory-back');await ready();}
  while(!await evaluate(`!!document.querySelector('.inventory-card[data-item-id=${JSON.stringify(id)}]')`)){
   const page=await evaluate(`document.querySelector('.inventory-overview .inventory-page-number')?.textContent`);
   const direction=Math.floor(target/capacity)<parseInt(page,10)-1?'이전 페이지':'다음 페이지';
   await click('.inventory-overview .inventory-pager [aria-label="'+direction+'"]');await images();
   if(page===await evaluate(`document.querySelector('.inventory-overview .inventory-page-number')?.textContent`))throw new Error('Pagination failed '+target+'/'+capacity);
  }
  await click('.inventory-card[data-item-id="'+id+'"]');await ready();await wait(`document.querySelector('#overlay').dataset.inventoryMode==='detail'&&!!document.querySelector('.inventory-record-image')`);await images();
 };
 const fit=async label=>{
  const metrics=await evaluate(`(()=>{const d=document.querySelector('#overlay'),r=d.getBoundingClientRect();return {viewport:[innerWidth,innerHeight],locked:getComputedStyle(document.documentElement).overflow==='hidden',rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},elements:[d,...d.querySelectorAll('.inventory-overview,.inventory-detail,.item-list,.book-page')].map(el=>({name:el.className,w:el.clientWidth,sw:el.scrollWidth,h:el.clientHeight,sh:el.scrollHeight}))};})()`);
  const r=metrics.rect,pass=metrics.locked&&r.left>=-1&&r.top>=-1&&r.right<=metrics.viewport[0]+1&&r.bottom<=metrics.viewport[1]+1&&metrics.elements.every(e=>e.sw<=e.w+1&&e.sh<=e.h+1);
  if(!pass){console.error(metrics);await snapshot('failed-fit');}
  await check(label,pass);
 };
 const captureInventoryRecord=async(label,layout,artwork,actionCount,reference,objectArtwork)=>{
  await fit(label+' fits without scrolling');
  const metrics=await evaluate(`(()=>{
   const page=document.querySelector('.book-page'),image=page.querySelector('.inventory-record-image'),spread=document.querySelector('.inventory-spread'),object=document.querySelector('.inventory-object'),actions=page.querySelector('.document-actions');
   const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
   const box=rect(image),paper=rect(page),book=rect(spread),leftObject=rect(object),scale=Math.min(box.width/image.naturalWidth,box.height/image.naturalHeight),paintWidth=image.naturalWidth*scale,paintHeight=image.naturalHeight*scale;
   const position=getComputedStyle(image).objectPosition.split(' '),fraction=value=>value==='center'?.5:value==='right'||value==='bottom'?1:parseFloat(value)/100||0;
   const painted={left:box.left+(box.width-paintWidth)*fraction(position[0]),top:box.top+(box.height-paintHeight)*fraction(position[1]),width:paintWidth,height:paintHeight};
   const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
   const ink={left:canvas.width,top:canvas.height,right:-1,bottom:-1,pixels:0};
   for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(pixels[(y*canvas.width+x)*4+3]>24){ink.left=Math.min(ink.left,x);ink.top=Math.min(ink.top,y);ink.right=Math.max(ink.right,x);ink.bottom=Math.max(ink.bottom,y);ink.pixels++;}
   return {src:image.currentSrc,alt:image.alt,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,paper,painted,ink,inkScreen:{left:painted.left+ink.left*scale,top:painted.top+ink.top*scale,right:painted.left+(ink.right+1)*scale,bottom:painted.top+(ink.bottom+1)*scale},actionCount:Number(page.dataset.actionCount),actions:actions?rect(actions):null,buttons:actions?[...actions.children].map(rect):[],background:getComputedStyle(spread).backgroundImage,objectSrc:object.querySelector('img').getAttribute('src'),objectFractions:{left:(leftObject.left-book.left)/book.width,top:(leftObject.top-book.top)/book.height,width:leftObject.width/book.width,height:leftObject.height/book.height},onlyRecord:document.querySelectorAll('img[src*="/inventory/records/"]').length===1,bitmapOnly:page.querySelectorAll('p,table,h3').length===0};
  })()`);
  inventoryMetrics.push({label,...metrics});
  await check(label+' uses its own transparent PNG record',metrics.src.endsWith('/records/'+artwork+'.png')&&metrics.naturalWidth===900&&metrics.naturalHeight===1120&&metrics.bitmapOnly&&metrics.onlyRecord);
  await check(label+' preserves the expected action count',metrics.actionCount===actionCount&&metrics.buttons.length===actionCount);
  const p=metrics.paper,i=metrics.inkScreen;
  await check(label+' keeps compact printed content inside the page',metrics.ink.pixels>0&&metrics.ink.left>0&&metrics.ink.top>0&&metrics.ink.right<899&&metrics.ink.bottom<=730&&i.left>=p.left-1&&i.top>=p.top-1&&i.right<=p.right+1&&i.bottom<=p.bottom+1);
  await check(label+' keeps all ink above its action buttons',!metrics.actions||i.bottom<=metrics.actions.top-1);
  await check(label+' keeps action buttons inside their page',metrics.buttons.every(b=>b.width>0&&b.height>=23&&b.left>=p.left-1&&b.top>=p.top-1&&b.right<=p.right+1&&b.bottom<=p.bottom+1));
  const fractions=layout==='mobile'?[.07,.04,.24,.17]:[.05,.10,.39,.80],actual=metrics.objectFractions;
  await check(label+' preserves the book background and left object layout',metrics.background.includes(layout==='mobile'?'record-paper.png':'book-detail.png')&&metrics.objectSrc.endsWith('/inventory/'+objectArtwork+'.png')&&[actual.left,actual.top,actual.width,actual.height].every((value,index)=>Math.abs(value-fractions[index])<.003));
  if(reference){
   const a=metrics.painted,b=reference.painted;
   await check(label+' keeps the same text scale and alignment across action counts',Math.abs(a.width-b.width)<.5&&Math.abs(a.height-b.height)<.5&&Math.abs((a.left-p.left)-(b.left-reference.paper.left))<.5&&Math.abs((a.top-p.top)-(b.top-reference.paper.top))<.5);
  }
  await snapshot('inventory-'+label);
  return metrics;
 };
 const inventoryChecks=async()=>{
  const baselineArg=process.argv.find(arg=>arg.startsWith('--inventory-baseline='));
  if(baselineArg){
   const baselinePath=path.resolve(root,baselineArg.slice('--inventory-baseline='.length)),baseline=JSON.parse(fs.readFileSync(baselinePath,'utf8').replace(/^\uFEFF/,''));
   const changed=baseline.filter(entry=>createHash('sha256').update(fs.readFileSync(path.join(gameRoot,entry.path))).digest('hex')!==entry.sha256).map(entry=>entry.path);
   await check('all '+baseline.length+' original book, object and control PNGs remain byte-identical',changed.length===0);
   if(changed.length)throw new Error('Changed preserved inventory assets: '+changed.join(', '));
  }
  const manifest=JSON.parse(fs.readFileSync(path.join(gameRoot,'public/assets/images/inventory/records/layout-manifest.json'),'utf8').replace(/^\uFEFF/,''));
  await check('record artwork uses the antique font on the shared transparent canvas',manifest.font==='Nanum Myeongjo ExtraBold'&&manifest.canvas[0]===900&&manifest.canvas[1]===1120&&manifest.contentBottom<=730&&Object.keys(manifest.records).length>=12);
  await check('all printed titles share a consistent left edge and top baseline',Object.values(manifest.records).every(record=>record.lines[0]?.x===42&&record.lines[0]?.y===28&&record.inkBounds[3]<=730));
  for(const [suffix,appearance,destination] of [['00',false,false],['10',true,false],['01',false,true],['11',true,true]]){
   const text=manifest.records['elder-testimony-'+suffix+'.png'].lines.map(line=>line.text).join(' ').replace(/\s+/g,'');
   await check('printed testimony '+suffix+' contains only its earned clues',text.includes('누렇게')===appearance&&text.includes('커피')===appearance&&text.includes('삶과죽음')===destination&&!text.includes('아지산'));
  }
  const baseRecords=[['ticket_current','ticket-current',0],['newspaper','newspaper',0],['flashlight','flashlight',0],['facility_manual','facility-manual',0],['ticket_old','ticket-old',1],['route_report','route-report',1],['elder_testimony','elder-testimony-10',0],['faded_paper','faded-paper',0],['punched_receipt','punched-receipt',0]];
  for(const [width,height] of [[1440,1000],[1024,768],[390,844],[320,568]]){
   await viewport(width,height);await seed('base');await openBag();await fit('inventory overview '+width);
   await check('inventory overview preserves its original book, mounts and close control '+width,`getComputedStyle(document.querySelector('.inventory-overview')).backgroundImage.includes('book-overview.png')&&document.querySelector('.inventory-mount-art')?.getAttribute('src').endsWith('/inventory/photo-mount.png')&&!!document.querySelector('#close-overlay')`);
   await snapshot('inventory-overview-'+width);
   let reference=null;
   const capture=async(id,artwork,actions,label=artwork)=>{
    await openItem(id);
    const metrics=await captureInventoryRecord(label+'-'+width,width<=600?'mobile':'desktop',artwork,actions,reference,id.replaceAll('_','-'));
    reference??=metrics;return metrics;
   };
   for(const [id,artwork,actions] of baseRecords){
    const metrics=await capture(id,artwork,actions);
    if(id==='elder_testimony')await check('testimony appearance state hides the unearned destination clue '+width,metrics.alt.includes('누렇게')&&!metrics.alt.includes('삶과 죽음')&&!metrics.alt.includes('아지산'));
   }
   for(const [phase,id,artwork,actions] of [['returned','ticket_old','ticket-old-returned',1],['early','elder_testimony','elder-testimony-00',0],['hint_only','elder_testimony','elder-testimony-01',0],['full','elder_testimony','elder-testimony-11',0],['proof','ticket_current','ticket-current',1],['proof','flashlight','flashlight',1],['dark','flashlight','flashlight',1],['record_two_actions','route_report','route-report',2]]){
    await seed(phase);await openBag();const metrics=await capture(id,artwork,actions,artwork+'-'+phase);
    if(id==='elder_testimony')await check('testimony reveals only earned clues '+phase+' '+width,metrics.alt.includes('누렇게')===(phase==='full')&&metrics.alt.includes('삶과 죽음')===(phase!=='early')&&!metrics.alt.includes('아지산'));
    if(phase==='returned')await check('returned ticket retains its preserved-record explanation '+width,metrics.alt.includes('원본은 노인에게 돌려드렸다'));
   }
  }
  await viewport(1440,1000);await seed('dark');await openBag();await openItem('flashlight');
  await click('[aria-label="손전등 사용"]');await ready();
  await check('flashlight use lights car three and closes inventory',`!document.querySelector('#overlay').open&&document.querySelector('#darkness').classList.contains('flashlight-mask')`);
  await openBag();await openItem('flashlight');
  await check('flashlight use disappears once car three is lit',`!document.querySelector('[aria-label="손전등 사용"]')`);
 };
 const cinematicReady=async(kind,file)=>{
  await wait(`document.querySelector('#cinematic')?.open&&document.querySelector('#cinematic').dataset.kind===${JSON.stringify(kind)}`);
  await wait(`document.querySelector('#cinematic-video')?.readyState>=2`,'cinematic decodes '+kind);
  await evaluate(`window.__qaVideoEnded=false;document.querySelector('#cinematic-video').addEventListener('ended',()=>window.__qaVideoEnded=true,{once:true})`);
  await check('local '+kind+' video decodes',`(()=>{const v=document.querySelector('#cinematic-video');return v.currentSrc.endsWith('/assets/videos/${file}')&&v.videoWidth>0&&v.videoHeight>0&&Number.isFinite(v.duration)&&v.duration>10&&!v.loop&&v.playsInline;})()`);
  await wait(`!document.querySelector('#cinematic-video').paused&&document.querySelector('#cinematic-video').currentTime>.05`,'cinematic playback starts '+kind);
  await check(kind+' has no playback controls or visible interface',`(()=>{const d=document.querySelector('#cinematic'),v=document.querySelector('#cinematic-video');return !v.controls&&!v.hasAttribute('controls')&&v.disablePictureInPicture&&v.disableRemotePlayback&&[...d.querySelectorAll('button:not(#cinematic-skip),input,[role="status"],.cinematic-controls')].every(el=>{const r=el.getBoundingClientRect();return r.width<=1||r.height<=1||getComputedStyle(el).visibility==='hidden';});})()`);
  if(await evaluate(`document.querySelector('#cinematic-video').muted`))await click('#cinematic');
  await wait(`!document.querySelector('#cinematic-video').muted`,'first gesture restores cinematic sound '+kind);
  await evaluate(`TrainAudio.setMuted(false);TrainAudio.setVolume(35)`);
  await check(kind+' pauses music and blocks background controls',`TrainAudio.element.paused&&document.querySelector('#cinematic').matches(':modal')`);
  await check(kind+' video fits the viewport',`(()=>{const r=document.querySelector('#cinematic-video').getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})()`);
  const before=await evaluate(`({time:document.querySelector('#cinematic-video').currentTime,at:performance.now()})`);
  await click('#cinematic');
  for(const [key,code,windowsVirtualKeyCode] of [[' ','Space',32],['k','KeyK',75],['ArrowRight','ArrowRight',39],['ArrowLeft','ArrowLeft',37],['Home','Home',36],['End','End',35],['Escape','Escape',27],['Tab','Tab',9],['MediaPlayPause','MediaPlayPause',179]]){
   await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode});
   await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode});
  }
  await check(kind+' ignores pointer, playback keys and Escape',`(()=>{const v=document.querySelector('#cinematic-video'),elapsed=(performance.now()-${before.at})/1000;return document.querySelector('#cinematic').open&&!v.paused&&!v.ended&&v.playbackRate===1&&v.currentTime>=${before.time}-.2&&v.currentTime<=${before.time}+elapsed+1;})()`);
  await check(kind+' suppresses the video context menu',`(()=>{const e=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});document.querySelector('#cinematic-video').dispatchEvent(e);return e.defaultPrevented;})()`);
  const guardStart=await evaluate(`({time:document.querySelector('#cinematic-video').currentTime,at:performance.now()})`);
  await evaluate(`(()=>{const v=document.querySelector('#cinematic-video');v.pause();v.playbackRate=2;v.currentTime=Math.min(v.duration-1,v.currentTime+5);})()`);
  await wait(`(()=>{const v=document.querySelector('#cinematic-video'),elapsed=(performance.now()-${guardStart.at})/1000;return !v.paused&&!v.seeking&&v.playbackRate===1&&v.currentTime<${guardStart.time}+elapsed+1;})()`,'cinematic rejects pause, seek and rate changes '+kind);
  await check(kind+' restores protected continuous playback',`document.querySelector('#cinematic').dataset.phase==='playing'&&!document.querySelector('#cinematic-video').ended`);
  if(process.argv.includes('--screenshots'))await wait(`document.querySelector('#cinematic-video').currentTime>=3`,'cinematic preview frame '+kind);
  await snapshot('cinematic-'+kind+'-'+await evaluate('innerWidth'));
 };
 const finishVideo=async()=>{
  const remaining=await evaluate(`Math.max(0,document.querySelector('#cinematic-video').duration-document.querySelector('#cinematic-video').currentTime)`);
  const kind=await evaluate(`document.querySelector('#cinematic').dataset.kind`);
  // A final-frame check or media fallback may finish before native "ended".
  // Verify the player's next screen instead of depending on that one event.
  await wait(`!document.querySelector('#cinematic').open&&(${JSON.stringify(kind)}==='opening'||(document.querySelector('#overlay').open&&document.querySelector('#overlay').dataset.view==='ending-complete'&&!!document.querySelector('#ending-restart')))`,'cinematic reaches its next screen',Math.ceil(remaining*1000)+15000);
 };
 const openingChecks=async()=>{
  await cinematicReady('opening','opening.mp4');
  await check('opening plays before the first game action',`fetch('/api/game').then(r=>r.json()).then(d=>d.game.revision===0&&d.game.location.id==='car_1'&&d.game.status==='playing'&&d.game.attempts===null&&!d.game.clock_running)`);
  await check('opening offers a visible skip control',`(()=>{const r=document.querySelector('#cinematic-skip').getBoundingClientRect();return r.width>1&&r.height>1&&r.right<=innerWidth&&r.top>=0;})()`);
  await finishVideo();await wait(`!document.querySelector('#cinematic').open`);await ready();
  await check('opening completion begins in car 1 without starting the clock',`fetch('/api/game').then(r=>r.json()).then(d=>d.game.location.id==='car_1'&&d.game.status==='playing'&&d.game.attempts===null&&!d.game.clock_running&&d.game.revision===0)`);
  await navigate('/chat');await ready();
  await check('refresh does not replay a completed opening',`!document.querySelector('#cinematic').open`);
 };
 const issueName=async name=>{
  await navigate('/detail');
  await evaluate(`document.querySelector('#passengerName').value=${JSON.stringify(name)};document.querySelector('#passengerName').dispatchEvent(new Event('input'))`);
  await click('#issueBtn');
 };
 const freshTitle=async label=>{
  await wait(`location.pathname==='/'&&!!document.querySelector('.boarding-pass')&&document.readyState==='complete'`,label+' reaches the first screen');
  await check(label+' returns to the title without a film or saved name',`!document.querySelector('#cinematic')&&localStorage.getItem('noTerminus.playerName')===null&&sessionStorage.getItem('train.opening.seen')===null`);
  await click('.boarding-pass');await wait(`location.pathname==='/detail'&&!!document.querySelector('#passengerName')&&document.readyState==='complete'`);
  await check(label+' offers blank name entry before issuing again',`document.querySelector('#passengerName').value===''&&document.querySelector('#issueBtn').disabled`);
 };
 const openingRecoveryChecks=async()=>{
  await evaluate(`sessionStorage.removeItem('train.opening.seen')`);
  const {identifier}=await call('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
   if(location.pathname!=='/chat')return;
   const originalFetch=window.fetch;
   let failSnapshot=true,blockAutoplay=true;
   window.fetch=function(input,...args){
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(failSnapshot&&url.pathname==='/api/game'){failSnapshot=false;return Promise.reject(new TypeError('Offline QA snapshot failure'));}
    return originalFetch.call(this,input,...args);
   };
   const originalPlay=HTMLMediaElement.prototype.play;
   HTMLMediaElement.prototype.play=function(...args){
    if(blockAutoplay&&this.id==='cinematic-video'){blockAutoplay=false;window.__qaAutoplayBlocked=true;return Promise.reject(new DOMException('Offline QA autoplay policy','NotAllowedError'));}
    return originalPlay.apply(this,args);
   };
  })();`});
  await navigate('/chat');
  await call('Page.removeScriptToEvaluateOnNewDocument',{identifier});
  await wait(`!document.querySelector('#error-banner').hidden`,'initial snapshot failure offers recovery');
  await click('#reload-btn');
  await wait(`document.querySelector('#cinematic').open&&document.querySelector('#cinematic-video').muted&&!document.querySelector('#cinematic-video').paused`,'blocked autoplay falls back to muted playback automatically');
  await check('recovering an untouched save preserves the opening and autoplay fallback',`window.__qaAutoplayBlocked&&document.querySelector('#cinematic').dataset.kind==='opening'&&document.querySelector('#train-map').childElementCount===0`);
  await cinematicReady('opening','opening.mp4');await finishVideo();await ready();
  await check('recovered opening continues into car 1',`fetch('/api/game').then(r=>r.json()).then(d=>d.game.revision===0&&d.game.location.id==='car_1'&&!document.querySelector('#cinematic').open&&document.querySelector('#error-banner').hidden)`);
 };
 const walkThroughDoor=async(target,width)=>{
  const selector='[data-hotspot="door_to_'+target+'"]';
  await wait(`!!document.querySelector(${JSON.stringify(selector)})`,'unlocked scene door to '+target);
  await check('door hotspot matches its scene and destination '+target+' '+width,`fetch('/api/game').then(r=>r.json()).then(d=>{const p=d.scene.hotspots.find(p=>p.id==='door_to_${target}');return p?.kind==='move'&&p.target==='${target}'&&p.background===d.scene.background&&p.polygon.length>=3;})`);
  await click(selector,true);await snapshot('door-to-'+target+'-'+width);
  await click(selector);await ready();
  await check('clicking the actual door moves to '+target+' '+width,`fetch('/api/game').then(r=>r.json()).then(d=>d.game.location.id==='${target}'&&d.game.status==='playing'&&!document.querySelector('#overlay').open&&document.querySelector('#scene-image').getAttribute('src')===d.scene.background)`);
 };
 const actorHitGeometry=async(npc,width)=>{
  const metrics=await evaluate(`(async()=>{
   const npc=${JSON.stringify(npc)},hit=document.querySelector('.registered-character [data-npc="'+npc+'"]'),image=hit.parentElement.querySelector('.registered-art');
   await image.decode();
   const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
   const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);
   const pixels=context.getImageData(0,0,canvas.width,canvas.height).data,rect=image.getBoundingClientRect();
   const alpha=(x,y)=>x<0||y<0||x>=canvas.width||y>=canvas.height?0:pixels[(Math.round(y)*canvas.width+Math.round(x))*4+3];
   const ink={left:canvas.width,top:canvas.height,right:0,bottom:0};
   for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(alpha(x,y)>=220){ink.left=Math.min(ink.left,x);ink.top=Math.min(ink.top,y);ink.right=Math.max(ink.right,x);ink.bottom=Math.max(ink.bottom,y);}
   // Sample well inside opaque or empty areas, allowing antialiasing and a
   // three-screen-pixel contour tolerance. Clear gaps and seat occlusion must
   // not turn the entire rectangular portrait into a clickable character.
   const radius=Math.max(5,Math.ceil(canvas.width/rect.width*3)),stepX=Math.max(2,Math.round((ink.right-ink.left)/35)),stepY=Math.max(2,Math.round((ink.bottom-ink.top)/45));
   const neighbors=[[0,0],[radius,0],[-radius,0],[0,radius],[0,-radius],[radius,radius],[radius,-radius],[-radius,radius],[-radius,-radius]];
   const opaque=[],empty=[],unreachable=[],leaks=[];
   for(let y=ink.top;y<=ink.bottom;y+=stepY)for(let x=ink.left;x<=ink.right;x+=stepX){
    const point={x:rect.left+x/canvas.width*rect.width,y:rect.top+y/canvas.height*rect.height};
    // elementFromPoint rounds subpixel edge coordinates to CSS pixels.
    // Keep sampled pixel centres inside the viewport, excluding clipped edges.
    if(point.x<.5||point.y<.5||point.x>innerWidth-.5||point.y>innerHeight-.5)continue;
    const target=document.elementFromPoint(point.x,point.y);
    if(target?.closest('.scene-top'))continue;
    const own=target?.closest('[data-npc]')?.dataset.npc===npc;
    if(neighbors.every(([dx,dy])=>alpha(x+dx,y+dy)>=220)){opaque.push(point);if(!own)unreachable.push({native:[x,y],point,target:target?.className});}
    else if(neighbors.every(([dx,dy])=>alpha(x+dx,y+dy)<=2)){empty.push(point);if(own)leaks.push({native:[x,y],point});}
   }
   return {npc,viewport:innerWidth,src:image.getAttribute('src'),ink,opaqueSamples:opaque.length,emptySamples:empty.length,unreachable:unreachable.slice(0,8),unreachableCount:unreachable.length,leaks:leaks.slice(0,8),leakCount:leaks.length,click:opaque.find(p=>document.elementFromPoint(p.x,p.y)?.closest('[data-npc]')?.dataset.npc===npc)};
  })()`);
  actorMetrics.push(metrics);
  await check('visible actor pixels receive the matching NPC '+npc+' '+width,metrics.opaqueSamples>=10&&metrics.unreachableCount===0&&!!metrics.click);
  await check('clear gaps and occluded seats do not capture NPC clicks '+npc+' '+width,metrics.emptySamples>=10&&metrics.leakCount===0);
  return metrics.click;
 };

 if(entryArtOnly){
  await viewport(390,844);await navigate('/');
  await evaluate(`localStorage.setItem('noTerminus.settings',JSON.stringify({bgm:35,sfx:60,speed:'fast',effects:true}))`);await navigate('/');
  await wait(`[...document.querySelectorAll('.lamp__art')].every(i=>i.complete&&i.naturalWidth>0)`);
  await evaluate(`new Promise(resolve=>{const start=performance.now();const frame=now=>now-start>1000?resolve():requestAnimationFrame(frame);requestAnimationFrame(frame);})`);
  const lampMetrics=()=>evaluate(`[...document.querySelectorAll('.lamp')].map(lamp=>{const image=lamp.querySelector('.lamp__art'),rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};},css=el=>{const s=getComputedStyle(el);return Object.fromEntries(['display','visibility','opacity','transform','filter','zIndex','position','isolation','clipPath','mixBlendMode'].map(k=>[k,s[k]]));};return {className:lamp.className,box:rect(lamp),css:css(lamp),image:{src:image.currentSrc,complete:image.complete,natural:[image.naturalWidth,image.naturalHeight],box:rect(image),css:css(image)},emission:css(lamp.querySelector('.lamp__emission'))};})`);
  const metrics={fresh:await lampMetrics()};await snapshot('entry-art-fresh-390');
  const surface=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:false});fs.writeFileSync(path.join(out,'entry-art-fresh-from-view-390.png'),Buffer.from(surface.data,'base64'));
  await evaluate(`new Promise(resolve=>{const start=performance.now();const frame=now=>now-start>5000?resolve():requestAnimationFrame(frame);requestAnimationFrame(frame);})`);
  metrics.afterCycle=await lampMetrics();await snapshot('entry-art-cycle-390');
  await evaluate(`document.querySelectorAll('.lamp__art').forEach(el=>el.style.transform='translateZ(0)');new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  metrics.translated=await lampMetrics();await snapshot('entry-art-translatez-390');
  await evaluate(`document.querySelectorAll('.lamp__art').forEach(el=>{el.style.transform='';el.style.opacity='.9999';});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  metrics.repainted=await lampMetrics();await snapshot('entry-art-repaint-390');
  fs.writeFileSync(path.join(out,'entry-lamp-metrics.json'),JSON.stringify(metrics,null,2));
  await check('fresh mobile title retains all three loaded fixtures',metrics.fresh.length===3&&metrics.fresh.every(lamp=>lamp.image.complete&&lamp.image.natural[0]>0&&lamp.image.box.w>0&&lamp.image.css.visibility==='visible'&&lamp.image.css.opacity==='1'));
 }
 if(entryOnly){
  const sizes=[[1440,900],[390,844],[320,568],[844,390]];
  const settled=()=>evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  const landingReady=async()=>{
   await navigate('/');await wait(`[...document.querySelectorAll('.main img,.ceiling img,.top-actions img')].every(i=>i.complete&&i.naturalWidth>0)`,'entry artwork loads');await settled();
  };
  const talkToExplorer=async()=>{
   // Scrolling the full-canvas hit layer can trigger a final scene fit. Let that
   // paint before choosing a real pointer coordinate on its silhouette.
   await evaluate(`document.querySelector('[data-npc="explorer"]').scrollIntoView({block:'center',inline:'nearest'})`);await settled();
   await click('[data-npc="explorer"]');await wait(`!document.querySelector('#dialogue-box').hidden&&document.querySelector('#speaker-name').textContent==='탐험가'`,'explorer responds to the actual pointer');await ready();
  };
  await navigate('/');
  await evaluate(`localStorage.removeItem('noTerminus.playerName');localStorage.setItem('noTerminus.settings',JSON.stringify({bgm:35,sfx:60,speed:'fast',effects:true}))`);
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  const motionSampler=await call('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
   if(location.pathname!=='/')return;
   document.addEventListener('DOMContentLoaded',()=>{
    window.__qaEntryMotion=[];const start=performance.now();let last=-100;
    const sample=now=>{
     const elapsed=now-start,sign=document.querySelector('.sign'),frame=document.querySelector('.sign__frame');
     if(sign&&frame&&elapsed-last>=35){last=elapsed;const matrix=new DOMMatrix(getComputedStyle(frame).transform);window.__qaEntryMotion.push({at:elapsed,phase:sign.dataset.phase,tension:sign.dataset.tension,angle:Math.atan2(matrix.b,matrix.a)*180/Math.PI,left:document.querySelector('.sign__cord--left')?.getAttribute('d'),right:document.querySelector('.sign__cord--right')?.getAttribute('d')});}
     if(elapsed<4700)requestAnimationFrame(sample);else window.__qaEntryMotionDone=true;
    };requestAnimationFrame(sample);
   },{once:true});
  })();`});
  for(const [width,height] of sizes){
   await viewport(width,height);await landingReady();
   if(width===1440){
    await wait(`window.__qaEntryMotionDone`,'initial sign settles naturally',7000);
    await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:motionSampler.identifier});
    const motion=await evaluate('window.__qaEntryMotion');
    fs.writeFileSync(path.join(out,'entry-sign-motion.json'),JSON.stringify(motion,null,2));
    const level=motion.filter(s=>s.phase==='level'),sag=motion.filter(s=>s.phase==='sagging'),end=motion.at(-1);
    await check('arrival starts with a horizontal sign and both cords attached',level.length>3&&level.every(s=>Math.abs(s.angle)<.02)&&!!level[0].left&&!!level[0].right);
    await check('both suspension cords paint even when a path is vertical',`document.querySelector('#cord-brass').getAttribute('gradientUnits')==='userSpaceOnUse'&&[...document.querySelectorAll('.sign__cord')].every(el=>el.getTotalLength()>25&&getComputedStyle(el).stroke!=='none')`);
    await check('left cord begins to sag after half a second',sag.length>3&&sag[0].at>=400&&sag[0].at<=1100&&new Set(sag.map(s=>s.left)).size>5);
    const strain=sag.filter(s=>s.tension==='straining'),yielding=sag.filter(s=>s.tension==='yielding');
    await check('worn cord trembles before the sign yields',strain.length>8&&Math.max(...strain.map(s=>s.angle))-Math.min(...strain.map(s=>s.angle))>.04&&strain.every(s=>Math.abs(s.angle)<.24)&&yielding.length>8);
    await check('short slips settle without a large pendulum bounce',end.phase==='settled'&&Math.abs(end.angle+2.2)<.02&&Math.min(...sag.map(s=>s.angle))>-2.4&&Math.min(...yielding.map(s=>s.angle))<-2.24&&yielding.some(s=>s.angle>-1));
    await check('frayed fibers remain joined to the left suspension',`[...document.querySelectorAll('.sign__fray')].length===3&&[...document.querySelectorAll('.sign__fray')].every(p=>p.getTotalLength()>2&&getComputedStyle(p).pointerEvents==='none')`);
    await check('all three fixture images match their physical light layers',`[...document.querySelectorAll('.ceiling .lamp')].length===3&&[...document.querySelectorAll('.ceiling .lamp')].every(el=>el.querySelector('.lamp__art')?.complete&&el.querySelector('.lamp__emission'))`);
    await check('first lamp stays off and third lamp stays lit',`getComputedStyle(document.querySelector('.lamp--off .lamp__emission')).opacity==='0'&&Number(getComputedStyle(document.querySelector('.lamp--on .lamp__emission')).opacity)>.95`);
    await check('middle lamp flickers every five seconds with actual light intensity changes',`(async()=>{const el=document.querySelector('.lamp--flicker .lamp__emission'),animations=el.getAnimations();if(!animations.length||!animations.some(a=>a.effect.getTiming().duration===5000))return false;const light=[],start=performance.now();await new Promise(resolve=>{const sample=now=>{light.push(Number(getComputedStyle(el).opacity));if(now-start>=5200)resolve();else requestAnimationFrame(sample);};requestAnimationFrame(sample);});return Math.max(...light)>.9&&Math.min(...light)<.2;})()`);
   }
   await check('title narration uses the requested premise '+width,`document.querySelector('#narration-full').textContent==='평범한 출장길이었다. 적어도, 그 열차에 오르기 전까지는...'`);
   await check('title ticket consistently announces carriage 01 and seat 08C '+width,`(()=>{const a=document.querySelector('.boarding-pass'),text=(a.getAttribute('aria-label')||'')+' '+a.querySelector('img').alt;return text.includes('01호차')&&text.includes('08C');})()`);
   await check('title keeps its sign, narration and ticket order '+width,`(()=>{const a=document.querySelector('.sign').getBoundingClientRect(),b=document.querySelector('.narration').getBoundingClientRect(),image=document.querySelector('.boarding-pass img'),c=image.getBoundingClientRect();return a.width>0&&b.width>0&&c.width>0&&a.bottom<=b.top+2&&b.bottom<=c.top+2&&Math.abs(image.offsetWidth/image.offsetHeight-1200/417)<.025&&document.documentElement.scrollWidth<=innerWidth+1;})()`);
   await check('title image controls are reachable without covering each other '+width,`(()=>{const a=[...document.querySelectorAll('.top-actions button')].map(el=>el.getBoundingClientRect());return a.length===2&&a.every(r=>r.width>=40&&r.height>=40&&r.left>=0&&r.right<=innerWidth+1&&r.top>=0)&&a[0].right<=a[1].left+1;})()`);
   await snapshot('entry-title-'+width+'x'+height);
   await click('.boarding-pass');await wait(`location.pathname==='/detail'&&!!document.querySelector('#passengerName')&&document.readyState==='complete'`);await wait(`[...document.querySelector('.pass').getAnimations()].every(a=>a.playState!=='running')`,'ticket feed completes');await settled();
   await check('boarding helper and ticket identify carriage 01 seat 08C '+width,`document.querySelector('#message').textContent==='저희 열차에 탑승해 주셔서 감사합니다.'&&document.querySelector('.pass__foot').textContent.includes('객차 01호차')&&document.querySelector('.pass__foot').textContent.includes('좌석 08C')`);
   await check('boarding keeps the existing ticket sections and compact viewport width '+width,`(()=>{const slot=document.querySelector('.booth__slot').getBoundingClientRect(),pass=document.querySelector('.pass').getBoundingClientRect(),name=document.querySelector('#passengerName').getBoundingClientRect(),random=document.querySelector('#randomBtn').getBoundingClientRect();return slot.width>0&&pass.width>0&&slot.bottom<=pass.top+5&&slot.width>=pass.width&&name.width>0&&random.width>=32&&name.right<=random.left+1&&pass.left>=0&&pass.right<=innerWidth+1&&document.querySelectorAll('.pass__cell').length===6&&document.documentElement.scrollWidth<=innerWidth+1;})()`);
   await check('blank boarding name remains blocked '+width,`document.querySelector('#passengerName').value===''&&document.querySelector('#issueBtn').disabled`);
   await evaluate(`document.querySelector('#passengerName').value='123';document.querySelector('#passengerName').dispatchEvent(new Event('input'))`);
   await check('invalid boarding name still gives a validation warning '+width,`document.querySelector('#issueBtn').disabled&&document.querySelector('#message').textContent.includes('한글이나 영문')`);
   await evaluate(`document.querySelector('#passengerName').value='윤슬';document.querySelector('#passengerName').dispatchEvent(new Event('input'))`);
   await check('valid name retains the welcome helper and issue control '+width,`!document.querySelector('#issueBtn').disabled&&document.querySelector('#message').textContent==='저희 열차에 탑승해 주셔서 감사합니다.'`);
   await snapshot('entry-boarding-'+width+'x'+height);
   await seed('feedback');
   const before=await evaluate(`fetch('/api/game').then(r=>r.json()).then(d=>d.game.revision)`);
   await check('notice text is obscured while keeping the original scene geometry '+width,`(()=>{const el=document.querySelector('#scene-notice-obscurer'),image=document.querySelector('#scene-image');return el?.complete&&el.naturalWidth>0&&el.currentSrc===image.currentSrc&&parseFloat(getComputedStyle(el).filter.match(/blur\\(([^)]+)/)?.[1])>=2&&getComputedStyle(el).clipPath.startsWith('polygon(')&&!document.querySelector('#overlay').open;})()`);
   await click('[data-hotspot="notice"]',true);await settled();
   await check('hover still obscures the text and never records an inspection '+width,`fetch('/api/game').then(r=>r.json()).then(d=>d.game.revision===${before}&&!document.querySelector('#overlay').open&&[...document.querySelectorAll('.notice-hotspot .notice-obscurer')].some(el=>parseFloat(getComputedStyle(el).filter.match(/blur\\(([^)]+)/)?.[1])>=2))`);
   await snapshot('entry-notice-hover-'+width);
   await click('[data-hotspot="notice"]');await ready();await images();
   await check('click lifts a readable notice directly above the darkened room '+width,`(()=>{const d=document.querySelector('#overlay'),i=d.querySelector('.notice-art-view img'),css=getComputedStyle(d),backdrop=getComputedStyle(d,'::backdrop').backgroundColor;return d.open&&d.dataset.view==='notice'&&d.classList.contains('notice-dialog')&&!d.classList.contains('paper-dialog')&&i?.complete&&i.naturalWidth>0&&i.currentSrc.includes('/car1/notice.png')&&getComputedStyle(i).filter==='none'&&css.backgroundImage==='none'&&/rgba\\(3, 3, 2, 0\\.[67]/.test(backdrop);})()`);
   await check('notice and close control fit the current display '+width,`(()=>{const d=document.querySelector('#overlay'),r=d.getBoundingClientRect(),c=document.querySelector('#close-overlay').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&c.width>=44&&c.height>=44&&c.right<=innerWidth+1&&c.top>=0;})()`);
   await check('only clicking the notice unlocks carriage two '+width,`fetch('/api/game').then(r=>r.json()).then(d=>d.game.revision>${before}&&d.game.map.find(p=>p.id==='car_2').open)`);
   await snapshot('entry-notice-open-'+width);await click('#close-overlay');
   await check('notice close restores scene controls '+width,`!document.querySelector('#overlay').open&&!document.querySelector(':modal')&&!document.querySelector('.chat-area').inert&&getComputedStyle(document.querySelector('.chat-area')).pointerEvents!=='none'&&!!document.querySelector('[data-hotspot="notice"]')`);
  }
  await viewport(1440,900);await landingReady();
  await click('[data-bgm-toggle]');await check('redrawn title sound button still mutes',`TrainAudio.isMuted()&&TrainAudio.element.paused`);
  await click('[data-bgm-toggle]');await wait(`!TrainAudio.isMuted()&&!TrainAudio.element.paused`,'title sound restores actual music');
  await click('#settingsBtn');await check('redrawn title settings control opens the existing dialog',`document.querySelector('#settingsDialog').matches(':modal')`);
  await click('#setFx');
  await check('visual effects preference remains functional',`document.documentElement.classList.contains('no-fx')&&!JSON.parse(localStorage.getItem('noTerminus.settings')).effects`);
  await check('disabling visual effects settles the sign and stops lighting animation',`document.querySelector('.sign').dataset.phase==='settled'&&document.querySelectorAll('.lamp__emission').length===3&&[...document.querySelectorAll('.lamp__emission')].every(el=>el.getAnimations().every(a=>a.playState!=='running'))`);
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await check('title settings still closes with Escape',`!document.querySelector('#settingsDialog').open`);
  await navigate('/detail');
  await check('boarding respects the saved visual effects preference',`document.documentElement.classList.contains('no-fx')&&document.querySelector('.lamp__emission').getAnimations().every(a=>a.playState!=='running')&&document.querySelector('.pass').getAnimations().every(a=>a.playState!=='running')`);
  await evaluate(`localStorage.setItem('noTerminus.settings',JSON.stringify({...JSON.parse(localStorage.getItem('noTerminus.settings')),effects:true}))`);
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await landingReady();
  await check('system reduced motion also keeps the sign and lights still',`document.querySelector('.sign').dataset.phase==='settled'&&[...document.querySelectorAll('.lamp__emission')].every(el=>el.getAnimations().every(a=>a.playState!=='running'))&&document.querySelector('#line2').textContent==='적어도, 그 열차에 오르기 전까지는...'`);
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await seed('scene_car_2');await talkToExplorer();
  await check('returning explorer opens with the requested greeting',`/^“?안녕하세요[.!]/.test(document.querySelector('#dialogue-text').textContent.trim())`);
  await seed('feedback');await click('[data-hotspot="notice"]');await ready();await click('#close-overlay');await wait(`!document.querySelector('.train-map-bar').classList.contains('rolling')`);
  await click('[data-hotspot="door_to_car_2"]');await ready();await talkToExplorer();
  await check('first explorer meeting also opens with the requested greeting',`/^“?안녕하세요[.!]/.test(document.querySelector('#dialogue-text').textContent.trim())`);
  await seed('feedback');
  await evaluate(`localStorage.setItem('noTerminus.playerName','이전승객');sessionStorage.setItem('train.opening.seen','1');localStorage.setItem('train_map_closed','true')`);
  const preferences=await evaluate(`localStorage.getItem('noTerminus.settings')`);
  const revision=await evaluate(`fetch('/api/game').then(r=>r.json()).then(d=>d.game.revision)`);
  await click('#menu-btn');await click('.settings-list>button:nth-last-child(2)');await click('.modal-actions button');
  await check('cancelling new investigation preserves the active save',`fetch('/api/game').then(r=>r.json()).then(d=>d.game.revision===${revision}&&!document.querySelector('#overlay').open)`);
  await click('#menu-btn');await click('.settings-list>button:nth-last-child(2)');await click('.modal-actions .primary');
  await freshTitle('settings new investigation');
  await check('new investigation preserves audio, effects and map preferences',`localStorage.getItem('noTerminus.settings')===${JSON.stringify(preferences)}&&localStorage.getItem('train_map_closed')==='true'`);
  await evaluate(`document.querySelector('#passengerName').value='새승객';document.querySelector('#passengerName').dispatchEvent(new Event('input'))`);await click('#issueBtn');
  await cinematicReady('opening','opening.mp4');
  await check('fresh name issuance creates a pristine first carriage save',`fetch('/api/game').then(r=>r.json()).then(d=>d.game.username==='새승객'&&d.game.location.id==='car_1'&&d.game.revision===0&&d.game.attempts===null&&!d.game.clock_running)`);
  await click('#cinematic-skip');await ready();
  await seed('ending_good');await cinematicReady('good','good-ending.mp4');await finishVideo();await wait(`document.querySelector('#ending-restart')&&document.querySelector('#overlay').open`);
  await click('#ending-restart');await freshTitle('completed ending restart');
 }
 if(cleanerItemsOnly){
  for(const [width,height] of [[1440,1000],[390,844],[320,568]]){
   await viewport(width,height);await seed('cleaner_items');
   const say=async message=>{await evaluate(`document.querySelector('#user-message').value=${JSON.stringify(message)}`);await click('#send-btn');await ready();};
   const game=()=>evaluate(`fetch('/api/game').then(r=>r.json()).then(d=>d.game)`);
   for(const [id,message,art] of [['faded_paper','누렇게 바랜 종이입니다.','faded-paper'],['punched_receipt','구멍이 뚫린 종이입니다.','punched-receipt']]){
    await say(message);
    await wait(`!document.querySelector('#acquisition-notice').hidden&&document.querySelector('#acquisition-notice img')?.complete`);
    await check('partial description displays its own acquisition picture '+id+' '+width,`document.querySelector('#acquisition-notice img').getAttribute('src').endsWith('/inventory/${art}.png')`);
    await snapshot('cleaner-award-'+id+'-'+width);
    let g=await game();await check('partial answer retains the lost-ticket gate '+id+' '+width,g.inventory.some(i=>i.id===id)&&!g.inventory.some(i=>i.id==='ticket_old'));
    await click('.acquired-close');await openBag();await openItem(id);
    const metrics=await captureInventoryRecord('cleaner-'+id+'-'+width,width<601?'mobile':'desktop',art,0,null,art);
    await check('wrong paper description distinguishes it from the lost ticket '+id+' '+width,metrics.alt.includes('승차권은 아니다'));
    await click('#close-overlay');
    await say(message);
    g=await game();await check('repeating partial answer does not duplicate the picture '+id+' '+width,g.inventory.filter(i=>i.id===id).length===1&&await evaluate(`document.querySelector('#acquisition-notice').hidden`));
   }
   await say('누렇게 바랜 종이에 구멍이 뚫려 있는 승차권입니다.');
   const g=await game();await check('both features still award the real ticket and preserve the papers '+width,['ticket_old','faded_paper','punched_receipt'].every(id=>g.inventory.some(i=>i.id===id)));
   await snapshot('cleaner-real-ticket-'+width);
  }
 }
 if(feedbackOnly){
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  for(const [width,height] of [[1440,1000],[390,844],[320,568]]){
   await viewport(width,height);await seed('feedback');
   await evaluate(`localStorage.removeItem('train_map_closed')`);await navigate('/chat');await ready();
   await check('map scroll and bold toggle restored '+width,`document.querySelector('#map-toggle').getAttribute('aria-expanded')==='true'&&getComputedStyle(document.querySelector('#map-toggle span')).webkitTextStrokeWidth!=='0px'&&document.querySelectorAll('.train-map-lights-off').length===5`);
   await check('locked rooms hide names, tooltips and accessible names '+width,`[...document.querySelectorAll('.train-carriage.locked:not(.current)')].every(b=>getComputedStyle(b.querySelector('.stop-name')).visibility==='hidden'&&!b.title&&b.getAttribute('aria-label')==='아직 열리지 않은 칸')`);
   await check('hint sparkles before it is requested '+width,`getComputedStyle(document.querySelector('#hint-btn .ui-art')).animationIterationCount==='infinite'`);
   await snapshot('feedback-start-'+width);
   await click('#map-toggle');await wait(`document.querySelector('#train-map-panel').getBoundingClientRect().height<1`);
   await check('closed map is inert and shows current room '+width,`document.querySelector('#train-map-panel').inert&&document.querySelector('#map-toggle').textContent.includes('1호차')`);
   await navigate('/chat');await ready();
   await check('map fold preference survives reload '+width,`document.querySelector('#train-map-panel').inert&&document.querySelector('#map-toggle').getAttribute('aria-expanded')==='false'`);
   await click('#map-toggle');await wait(`!document.querySelector('.train-map-bar').classList.contains('rolling')`);
   await click('#hint-btn');await ready();
   await check('hint sparkle stops while hint is open '+width,`document.querySelector('#hint-btn').getAttribute('aria-expanded')==='true'&&getComputedStyle(document.querySelector('#hint-btn .ui-art')).animationName==='none'`);
   await check('exploration hint opens its own paper panel '+width,`document.querySelector('#overlay').open&&document.querySelector('#overlay').dataset.view==='hint'&&document.querySelector('.conversation-console').hidden`);
   await click('#close-overlay');
   await click('[data-hotspot="notice"]');await ready();await wait(`document.querySelector('#overlay').open`);
   await check('new room sparkle waits for the notice to close '+width,`!document.querySelector('[data-location="car_2"]').classList.contains('just-opened')`);
   await click('#close-overlay');await wait(`document.querySelector('[data-location="car_2"]').classList.contains('just-opened')`);
   await check('newly reachable room sparkles four times '+width,`getComputedStyle(document.querySelector('[data-location="car_2"]'),'::before').animationIterationCount==='4'&&getComputedStyle(document.querySelector('[data-location="car_2"] .stop-name')).visibility==='visible'`);
   await snapshot('feedback-unlocked-'+width);
   await click('[data-location="car_2"]');await ready();await click('[data-npc="explorer"]');await ready();
   await check('conversation preserves the player-opened map '+width,`!document.querySelector('#train-map-panel').inert&&document.querySelector('#map-toggle').getAttribute('aria-expanded')==='true'&&!!document.querySelector('.character-sprite')`);
   await snapshot('feedback-conversation-'+width);
   await click('#end-talk');await ready();await wait(`!document.querySelector('.train-map-bar').classList.contains('rolling')`);
   await check('ending conversation keeps the player-opened map '+width,`!document.querySelector('#train-map-panel').inert&&document.querySelector('#map-toggle').getAttribute('aria-expanded')==='true'`);
   await click('#map-toggle');await wait(`!document.querySelector('.train-map-bar').classList.contains('rolling')`);
   await click('[data-npc="explorer"]');await ready();await click('#end-talk');await ready();
   await check('conversation preserves a map closed by the player '+width,`document.querySelector('#train-map-panel').inert`);
   await seed('proof');await openBag();await openItem('newspaper');
   await check('newspaper is the original 2016 disappearance record '+width,`document.querySelector('.inventory-record-image').alt.includes('2016.11.13')&&!document.querySelector('.inventory-record-image').alt.includes('2026')`);
   await click('[aria-label="이 물건을 최종 증거로 제출"]');await ready();
   await check('newspaper proof compares the owned current ticket '+width,`document.querySelector('#overlay').textContent.includes('2026년 승차권')`);
   await click('[aria-label="최종 확정"]');await ready();
   await check('driver replies before opening the manual control '+width,`!document.querySelector('#overlay').open&&document.querySelector('#speaker-name').textContent==='기관사'&&document.querySelector('#dialogue-text').textContent.includes('믿기 어렵')&&document.querySelector('#choice-list').textContent.includes('마지막 한 번')`);
   await snapshot('feedback-driver-proof-'+width);
   await click('#choice-list .choice-button');await ready();
   await check('player choice opens restored control puzzle '+width,`document.querySelector('#overlay').open&&document.querySelector('#overlay').dataset.view==='control'`);
  }
  await viewport(390,844);await issueName('윤슬');await cinematicReady('opening','opening.mp4');
  await click('#cinematic-skip');await ready();
  await check('opening skip enters the fresh game and releases media '+390,`!document.querySelector('#cinematic').open&&!document.querySelector('#cinematic-video').hasAttribute('src')&&document.querySelector('#scene-image').naturalWidth===1403`);
 }
 if(scenesOnly){
  const expected={car_1:['notice','window'],car_2:[],car_3:[],car_4:['crew_door','inspection_cover','door_handle'],crew:['report'],engine:['control','engine_lever']};
  const npcs={car_2:['explorer'],car_3:['cleaner','elder'],car_4:['attendant'],engine:['driver']};
  for(const [width,height] of [[1440,1000],[390,844],[320,568]]){
   await viewport(width,height);
   for(const location of Object.keys(expected)){
    await seed('scene_'+location);
    await check('native scene ratio '+location+' '+width,`(()=>{const w=document.querySelector('#scene-world').getBoundingClientRect(),i=document.querySelector('#scene-image');return Math.abs(w.width/w.height-i.naturalWidth/i.naturalHeight)<.003&&document.documentElement.scrollWidth<=innerWidth;})()`);
    await check('all visible actor layers load '+location+' '+width,`[...document.querySelectorAll('.registered-character .registered-art')].every(i=>i.complete&&i.naturalWidth===document.querySelector('#scene-image').naturalWidth&&getComputedStyle(i.parentElement).opacity==='1')`);
    await check('unused plaques disappear only in cars two and three '+location+' '+width,`(()=>{const repair=document.querySelector('#scene-wall-repair'),expected=${JSON.stringify(['car_2','car_3'].includes(location))};return expected?!!repair&&getComputedStyle(repair).pointerEvents==='none'&&getComputedStyle(repair).backgroundImage.includes('passenger-wall-repaired.png')&&!document.querySelector('[data-hotspot="notice"],#scene-notice-obscurer'):!repair;})()`);
    if(location==='car_3')await check('flashlight shades actors as well as the scene '+width,`Number(getComputedStyle(document.querySelector('#darkness')).zIndex)>Number(getComputedStyle(document.querySelector('#character-layer')).zIndex)`);
    if(location==='crew'){
     await check('crew room has only the operating report interaction '+width,`!document.querySelector('[data-hotspot="desk"]')&&document.querySelectorAll('[data-hotspot="report"]').length===1`);
     await evaluate(`document.querySelector('#scene-image').scrollIntoView({block:'center'})`);
     const closedBook=await evaluate(`(()=>{const r=document.querySelector('#scene-image').getBoundingClientRect();return {x:r.left+r.width*650/2464,y:r.top+r.height*1300/1968};})()`);
     await check('closed rear record is not an interactive target '+width,closedBook.x>0&&closedBook.x<width&&closedBook.y>0&&closedBook.y<height&&await evaluate(`!document.elementFromPoint(${closedBook.x},${closedBook.y})?.closest('[data-hotspot]')`));
     await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...closedBook});
     await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...closedBook});
     await check('clicking the closed rear record keeps exploration open '+width,`!document.querySelector('#overlay').open`);
    }
    await snapshot('scene-'+location+'-'+width);
    for(const id of expected[location]){
     const selector='[data-hotspot="'+id+'"]';
     await click(selector,true);
     await check('exact hover silhouette '+id+' '+width,`getComputedStyle(document.querySelector(${JSON.stringify(selector)}).nextElementSibling).opacity==='1'`);
     await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus({preventScroll:true})`);
     await check('keyboard focus '+id+' '+width,`document.activeElement===document.querySelector(${JSON.stringify(selector)})`);
     await snapshot('target-'+id+'-'+width);
     await click(selector);
     await wait(`document.querySelector('#overlay').open`);
     const view=id==='notice'?'notice':id==='window'?'window':location==='crew'?'inventory':location==='engine'?'control':'lever';
     await check('target opens preserved interaction '+id+' '+width,`document.querySelector('#overlay').dataset.view===${JSON.stringify(view)}`);
     await snapshot('opened-'+id+'-'+width);
     // Use a fresh fixture: closing a report legitimately acknowledges it.
     await seed('scene_'+location);
    }
    for(const npc of npcs[location]||[]){
     const affected=['explorer','elder','cleaner','attendant','driver'].includes(npc);
     if(affected){
      const point=await actorHitGeometry(npc,width);
      await call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
      await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
      await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
     }else await click('[data-npc="'+npc+'"]');
     await ready();
     await check('actor starts original dialogue '+npc+' '+width,`document.querySelector('.person-hotspot.talking')?.dataset.npc===${JSON.stringify(npc)}&&document.querySelectorAll('.character-sprite').length===1&&!document.querySelector('#dialogue-box').hidden`);
     await snapshot('actor-'+npc+'-'+width);
     await wait(`!document.querySelector('.train-map-bar').classList.contains('rolling')`,'map settles before ending '+npc);
     await click('#end-talk');await ready();
     await check('dialogue returns to placed actor '+npc+' '+width,`!document.querySelector('.person-hotspot.talking')&&!!document.querySelector('.registered-character [data-npc="${npc}"]')`);
     if(affected){
      await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
      await evaluate(`document.querySelector('.registered-character [data-npc="${npc}"]').focus({preventScroll:true})`);
      await wait(`document.querySelector('.registered-character [data-npc="${npc}"]').matches(':focus-visible')&&getComputedStyle(document.querySelector('.registered-character [data-npc="${npc}"]').parentElement.querySelector('.registered-label')).opacity==='1'`,'visible NPC keyboard focus '+npc);
      await check('keyboard focus identifies the placed actor '+npc+' '+width,`document.activeElement.dataset.npc===${JSON.stringify(npc)}&&document.activeElement.getAttribute('aria-label').includes('말 걸기')`);
      await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
      await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      await wait(`document.querySelector('.person-hotspot.talking')?.dataset.npc===${JSON.stringify(npc)}`,'native Enter activates NPC '+npc);
      await ready();
      await check('keyboard activation opens the same NPC '+npc+' '+width,`document.querySelector('.person-hotspot.talking')?.dataset.npc===${JSON.stringify(npc)}`);
      await wait(`!document.querySelector('.train-map-bar').classList.contains('rolling')`,'map settles after keyboard conversation '+npc);
      await click('#end-talk');await ready();
      await wait(`!document.querySelector('.person-hotspot.talking')`,'keyboard conversation ends '+npc);
     }
    }
    if(location==='car_2'||location==='car_3')await walkThroughDoor(location==='car_2'?'car_3':'car_4',width);
   }
   await seed('dark');
   await check('dark car hides every actor and door '+width,`document.querySelectorAll('.person-hotspot,[data-hotspot^="door_to_"]').length===0&&!document.querySelector('#darkness').hidden`);
  }
 }
 if(interfaceOnly){
  const dimensions=async()=>evaluate(`(()=>{
   const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return [r.x+scrollX,r.y+scrollY,r.width,r.height];};
   return ['.scene-frame','#scene-image','.scene-top','#menu-btn','#bag-btn','.train-map-bar'].map(rect);
  })()`);
  const settled=()=>evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  const panelFits=async label=>{
   await settled();
   await check(label,`(()=>{const d=document.querySelector('#overlay'),b=document.querySelector('#overlay-body'),r=d.getBoundingClientRect(),css=getComputedStyle(d),ending=d.dataset.view==='ending-complete',art=d.querySelector('.ending-card-art');const skin=ending?d.classList.contains('ending-dialog')&&art?.complete&&art.naturalWidth>0&&Math.abs(r.width/r.height-art.naturalWidth/art.naturalHeight)<.003&&css.borderImageSource==='none':d.classList.contains('paper-dialog')&&css.borderImageSlice.includes('fill')&&css.borderImageSource.includes('dossier-panel.png');return d.matches(':modal')&&skin&&r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&b.scrollWidth<=b.clientWidth+1;})()`);
   await check(label+' uses the game font and has no English subtitle',`(()=>{const d=document.querySelector('#overlay'),family=getComputedStyle(document.querySelector('.chat-area')).fontFamily;return !d.querySelector('.eyebrow')&&!/[A-Za-z]/.test(d.querySelector('.overlay-header').textContent)&&[d.querySelector('#overlay-title'),d.querySelector('#overlay-body'),...d.querySelectorAll('#overlay-body button')].every(el=>getComputedStyle(el).fontFamily===family);})()`);
  };
  for(const [width,height] of [[1440,900],[1024,768],[390,844],[320,568]]){
   await viewport(width,height);await seed('feedback');
   await evaluate(`localStorage.setItem('train_map_closed','true')`);
   for(const [location,people] of Object.entries({car_1:[],car_2:['explorer'],car_3:['elder','cleaner'],car_4:['attendant'],crew:[],engine:['driver']})){
    await seed('scene_'+location);await settled();
    await check('exploration hides composer and choices '+location+' '+width,`document.querySelector('.conversation-console').hidden&&document.querySelector('#user-message').disabled&&document.querySelector('#choice-list').hidden&&document.querySelector('#choice-list').childElementCount===0&&!document.querySelector('.game-header')&&!document.querySelector('#settings-btn')&&document.querySelector('.train-map-bar').getBoundingClientRect().top<12`);
    const folded=await dimensions();
    await check('folded map matches the scene edges '+location+' '+width,Math.abs(folded[0][0]-folded[5][0])<1&&Math.abs(folded[0][2]-folded[5][2])<1);
    await click('#map-toggle');await wait(`!document.querySelector('.train-map-bar').classList.contains('rolling')`);await settled();
    const unfolded=await dimensions();
    await check('unfolding the map preserves scene and HUD sizes '+location+' '+width,folded.slice(0,5).every((box,i)=>Math.abs(box[2]-unfolded[i][2])<1&&Math.abs(box[3]-unfolded[i][3])<1));
    await check('unfolded map matches the scene edges '+location+' '+width,Math.abs(unfolded[0][0]-unfolded[5][0])<1&&Math.abs(unfolded[0][2]-unfolded[5][2])<1);
    await check('map retains native ratio with only carriage labels '+location+' '+width,`(()=>{const map=document.querySelector('.train-map-canvas'),r=map.getBoundingClientRect();return Math.abs(r.width/r.height-3)<.01&&!document.querySelector('.map-heading,.map-caption,.stop-state')&&map.querySelectorAll('.stop-name').length===6&&document.documentElement.scrollWidth<=innerWidth;})()`);
    if(location==='car_1'||location==='car_3')await snapshot('interface-map-expanded-'+location+'-'+width);
    await click('#map-toggle');await wait(`!document.querySelector('.train-map-bar').classList.contains('rolling')`);await settled();
    const refolded=await dimensions();
    await check('folding the map restores the same scene layout '+location+' '+width,folded.every((box,i)=>box.every((value,j)=>Math.abs(value-refolded[i][j])<1)));
    await snapshot('interface-explore-'+location+'-'+width);
    for(const npc of people){
     const before=await dimensions();
     await click('[data-npc="'+npc+'"]');await ready();await settled();
     const during=await dimensions();
     await check('conversation preserves every scene and HUD rectangle '+npc+' '+width,before.every((box,i)=>box.every((value,j)=>Math.abs(value-during[i][j])<1)));
     await check('only conversation enables the composer '+npc+' '+width,`!document.querySelector('.conversation-console').hidden&&!document.querySelector('#user-message').disabled&&!document.querySelector('#choice-list').hidden&&document.querySelector('#choice-list').childElementCount>0&&document.querySelectorAll('.character-sprite').length===1&&document.querySelector('#train-map-panel').inert`);
     if(width>700)await check('desktop conversation fits one viewport '+npc+' '+width,`document.querySelector('.conversation-console').getBoundingClientRect().bottom<=innerHeight+1&&document.documentElement.scrollWidth<=innerWidth`);
     await snapshot('interface-talk-'+npc+'-'+width);
     if(npc==='explorer'){
      await click('#user-message');await call('Input.insertText',{text:'입력창 확인'});await click('#send-btn');await ready();
      await check('real typed conversation clears input '+width,`document.querySelector('#user-message').value===''&&!document.querySelector('#dialogue-box').hidden`);
      await navigate('/chat');await ready();await settled();
      await check('reload restores active conversation '+width,`!document.querySelector('.conversation-console').hidden&&!document.querySelector('#user-message').disabled&&!document.querySelector('#dialogue-box').hidden`);
     }
     await click('#end-talk');await ready();await settled();
     const after=await dimensions();
     await check('ending dialogue hides controls and preserves the canvas '+npc+' '+width,await evaluate(`document.querySelector('.conversation-console').hidden&&document.querySelector('#choice-list').hidden&&document.querySelector('#user-message').disabled`)&&before.every((box,i)=>box.every((value,j)=>Math.abs(value-after[i][j])<1)));
    }
   }
   // Opened map preference also stays fixed during NPC selection.
   await seed('scene_car_2');await click('#map-toggle');await wait(`!document.querySelector('.train-map-bar').classList.contains('rolling')`);await settled();
   const expanded=await dimensions();await click('[data-npc="explorer"]');await ready();await settled();
   const expandedTalk=await dimensions();
   await check('conversation keeps the expanded map and layout '+width,await evaluate(`!document.querySelector('#train-map-panel').inert`)&&expanded.every((box,i)=>box.every((value,j)=>Math.abs(value-expandedTalk[i][j])<1)));
   await click('#end-talk');await ready();await click('#map-toggle');await wait(`!document.querySelector('.train-map-bar').classList.contains('rolling')`);
   await click('#history-btn');await panelFits('history image panel fits '+width);await snapshot('interface-history-'+width);await click('#close-overlay');
   await click('#menu-btn');await panelFits('settings image panel fits '+width);
   await check('settings toggles retain audio preferences '+width,`(()=>{const t=document.querySelector('.audio-setting input[type=checkbox]'),before=TrainAudio.isMuted();t.click();const changed=TrainAudio.isMuted()!==before;t.click();return changed&&TrainAudio.isMuted()===before;})()`);
   await snapshot('interface-settings-'+width);
   await click('.settings-list>button:nth-last-child(3)');await panelFits('journal image panel fits '+width);await snapshot('interface-journal-'+width);await click('#close-overlay');
   await click('#menu-btn');await click('.settings-list>button:nth-last-child(2)');await panelFits('new game confirmation fits '+width);await snapshot('interface-newgame-'+width);await click('.modal-actions button');
   await click('#menu-btn');await click('.settings-list>button:last-child');await ready();await panelFits('abandon confirmation fits '+width);await snapshot('interface-confirm-'+width);await click('[aria-label="취소하고 다시 살펴보기"]');await ready();
   await click('#hint-btn');await ready();await panelFits('requested hint fits outside conversation '+width);
   await check('hint keeps ordinary composer and choices hidden '+width,`document.querySelector('.conversation-console').hidden&&document.querySelector('#choice-list').hidden&&document.querySelector('#overlay').dataset.view==='hint'`);
   await snapshot('interface-hint-'+width);await click('#close-overlay');
   await seed('early');await click('[data-npc="elder"]');await ready();
   for(let step=0;step<5;step++){await click('#choice-list .choice-button');await ready();}
   await check('elder speech emphasizes the two ticket features '+width,`JSON.stringify([...document.querySelectorAll('#dialogue-text strong')].map(el=>el.textContent))===JSON.stringify(['바랜 종이','구멍'])&&[...document.querySelectorAll('#dialogue-text strong')].every(el=>getComputedStyle(el).fontWeight==='700')`);
   await snapshot('interface-testimony-'+width);
   await click('#end-talk');await ready();await openBag();await openItem('elder_testimony');
   await check('testimony retains the printed record and exact learned text '+width,`document.querySelector('.inventory-record-image').src.endsWith('/elder-testimony-10.png')&&document.querySelector('.inventory-record-image').alt.includes('바랜 종이')&&document.querySelector('.inventory-record-image').alt.includes('구멍')`);
   await snapshot('interface-testimony-record-'+width);await click('#close-overlay');
  }
  for(const [width,height,kind] of [[1440,900,'good'],[390,844,'bad']]){
   await viewport(width,height);await seed('ending_'+kind);await cinematicReady(kind,kind+'-ending.mp4');await finishVideo();
   await wait(`document.querySelector('#overlay').dataset.view==='ending-complete'&&document.querySelector('#overlay').open`);
   await panelFits('ending certificate fits '+kind+' '+width);
   await check('completed ending keeps composer hidden '+kind,`document.querySelector('.conversation-console').hidden&&document.querySelector('#user-message').disabled&&!!document.querySelector('#ending-restart')`);
   await snapshot('interface-ending-'+kind+'-'+width);
   await click('#ending-restart');await freshTitle('ending restart '+kind);
  }
 }
 if(presentationOnly){
  const sizes=[[1440,900],[1920,1080],[1024,768],[390,844],[320,568],[844,390]];
  for(const [width,height] of sizes){
   await viewport(width,height);await seed('scene_car_3');
   await wait(`document.querySelector('#loading-lore').dataset.source==='ai'`,'offline fixture supplies generated loading copy');
   const revision=await evaluate(`fetch('/api/game').then(r=>r.json()).then(d=>d.game.revision)`);
   await evaluate(`TrainLoading.show(true)`);
   await check('black loading screen fits the viewport '+width+'x'+height,`(()=>{const d=document.querySelector('#scene-loading'),r=d.getBoundingClientRect();return !d.hidden&&getComputedStyle(d).backgroundColor==='rgb(0, 0, 0)'&&r.left===0&&r.top===0&&Math.abs(r.width-innerWidth)<1&&Math.abs(r.height-innerHeight)<1&&!d.querySelector('.loading-train');})()`);
   await check('loading lore and corner indicator stay visible '+width+'x'+height,`(()=>{const a=document.querySelector('#loading-lore').getBoundingClientRect(),b=document.querySelector('.loading-indicator').getBoundingClientRect();return a.width>0&&a.left>=0&&a.right<=innerWidth&&a.top>=0&&a.bottom<b.top&&b.left>=0&&b.right<=innerWidth&&b.bottom<=innerHeight&&document.querySelector('#loading-lore').textContent.length>=15;})()`);
   await snapshot('presentation-loading-'+width+'x'+height);
   await evaluate(`document.documentElement.classList.add('reduced-motion')`);
   await check('loading respects reduced motion '+width,`getComputedStyle(document.querySelector('.loading-gear')).animationName==='none'`);
   await evaluate(`document.documentElement.classList.remove('reduced-motion');TrainLoading.show(false)`);
   await check('loading copy never spends a game turn '+width,`fetch('/api/game').then(r=>r.json()).then(d=>d.game.revision===${revision})`);
   if(width===1440||width===390)await snapshot('presentation-seated-elder-'+width);
   await seed('control');await click('[data-hotspot="control"]');await wait(`document.querySelector('#overlay').dataset.view==='control'`);
   await wait(`(()=>{const r=document.querySelector('.puzzle-host')?.shadowRoot;return r&&[...r.querySelectorAll('link')].every(l=>!!l.sheet)&&[...r.querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth);})()`);
   await check('control restores the dark mechanical surface '+width+'x'+height,`(()=>{const d=document.querySelector('#overlay'),r=d.getBoundingClientRect(),p=d.querySelector('.puzzle-host').shadowRoot;return d.classList.contains('device-dialog')&&!d.classList.contains('paper-dialog')&&getComputedStyle(d).borderImageSource==='none'&&r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&p.querySelector('.panel__bg').naturalWidth===1402&&p.querySelectorAll('.dial').length===4&&!!p.querySelector('.station');})()`);
   await snapshot('presentation-control-'+width+'x'+height);await click('#close-overlay');
  }
  // A stalled copy service cannot hold the game behind the loading overlay.
  const {identifier}=await call('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const original=window.fetch;window.fetch=function(input,...args){if(String(input).includes('/api/loading-text')){window.__qaLoreWaiting=true;return new Promise(resolve=>{window.__qaReleaseLore=()=>{window.__qaLoreWaiting=false;resolve(new Response(JSON.stringify({text:'낡은 객차를 흔드는 바퀴 소리가 밤의 적막 사이로 낮게 이어집니다.',source:'ai'}),{status:200,headers:{'Content-Type':'application/json'}}));};});}return original.call(this,input,...args);};})()`});
  await viewport(390,844);await seed('scene_car_2');
  await check('slow lore generation does not block the scene',`window.__qaLoreWaiting&&document.querySelector('#scene-loading').hidden&&!document.querySelector('.game-shell').hidden&&document.querySelector('#error-banner').hidden`);
  await evaluate(`window.__qaReleaseLore()`);await wait(`document.querySelector('#loading-lore').dataset.source==='ai'`);
  await call('Page.removeScriptToEvaluateOnNewDocument',{identifier});
  const failure=await call('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const original=window.fetch;window.fetch=function(input,...args){if(String(input).includes('/api/loading-text'))return Promise.reject(new TypeError('Offline lore failure'));return original.call(this,input,...args);};})()`});
  await seed('scene_car_2');
  await check('copy connection failure leaves the scene playable',`document.querySelector('#scene-loading').hidden&&document.querySelector('#error-banner').hidden&&document.querySelector('#loading-lore').dataset.source==='fallback'&&!!document.querySelector('[data-npc="explorer"]')`);
  await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:failure.identifier});
  for(const kind of ['good','bad']){
   await viewport(1440,900);await seed('ending_'+kind);await cinematicReady(kind,kind+'-ending.mp4');await finishVideo();
   await wait(`document.querySelector('#overlay').dataset.view==='ending-complete'&&document.querySelector('.ending-card-art')?.complete`);
   for(const [width,height] of sizes){
    await viewport(width,height);
    await evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
    await check('ending keeps the train seal undistorted '+kind+' '+width+'x'+height,`(()=>{const d=document.querySelector('#overlay'),i=d.querySelector('.ending-card-art'),r=d.getBoundingClientRect(),a=i.getBoundingClientRect();return d.classList.contains('ending-dialog')&&!d.classList.contains('paper-dialog')&&d.dataset.ending==='${kind}'&&i.src.endsWith('${kind==='bad'?'ending-certificate-sad':'ending-certificate'}.png')&&Math.abs(r.width/r.height-i.naturalWidth/i.naturalHeight)<.003&&Math.abs(a.width/a.height-1.5)<.003&&r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;})()`);
    await check('ending text and restart fit the native paper '+kind+' '+width+'x'+height,`(()=>{const d=document.querySelector('#overlay'),r=d.getBoundingClientRect(),ink=getComputedStyle(d.querySelector('#overlay-title')).color;return [d.querySelector('#overlay-title'),d.querySelector('.ending-complete p'),d.querySelector('#ending-restart')].every(el=>{const b=el.getBoundingClientRect();return b.width>0&&b.height>0&&b.left>=r.left&&b.right<=r.right+1&&b.top>=r.top&&b.bottom<=r.bottom+1;})&&ink==='${kind==='bad'?'rgb(238, 234, 224)':'rgb(99, 55, 43)'}'&&getComputedStyle(d.querySelector('#ending-restart')).borderImageSlice.includes('fill');})()`);
    await snapshot('presentation-ending-'+kind+'-'+width+'x'+height);
   }
   await check('ending image preserves transparent wear '+kind,`(()=>{const i=document.querySelector('.ending-card-art'),c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;const g=c.getContext('2d');g.drawImage(i,0,0);const center=g.getImageData(768,512,1,1).data;return ${kind==='bad'?'Math.max(...center.slice(0,3))-Math.min(...center.slice(0,3))<12&&g.getImageData(53,620,1,1).data[3]<30':'center[0]-center[2]>25'};})()`);
  }
 }
 if(windowMapOnly){
  const dimensions=()=>evaluate("['.scene-frame','#scene-image','.scene-top','#menu-btn','#bag-btn'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {width:r.width,height:r.height};})");
  const sameSizes=(a,b)=>a.every((box,i)=>Math.abs(box.width-b[i].width)<1&&Math.abs(box.height-b[i].height)<1);
  const mapSettled=()=>wait("!document.querySelector('.train-map-bar').classList.contains('rolling')&&document.querySelector('#train-map-panel').getAnimations().length===0",'paper roller settles');
  const mapState=closed=>"(()=>{const p=document.querySelector('#train-map-panel'),t=document.querySelector('#map-toggle');return p.inert==="+closed+"&&p.getAttribute('aria-hidden')==='"+closed+"'&&p.classList.contains('is-closed')==="+closed+"&&t.getAttribute('aria-expanded')==='"+!closed+"'&&localStorage.getItem('train_map_closed')==='"+closed+"'&&"+(closed?"p.getBoundingClientRect().height<1":"p.getBoundingClientRect().height>1")+";})()";
  const mapArtFits=()=>evaluate("(()=>{const b=document.querySelector('.train-map-bar').getBoundingClientRect(),t=document.querySelector('#map-toggle').getBoundingClientRect(),c=document.querySelector('.train-map-canvas').getBoundingClientRect(),s=document.querySelector('.scene-frame').getBoundingClientRect(),i=document.querySelector('.train-map-art'),r=i.getBoundingClientRect(),roller=getComputedStyle(document.querySelector('#map-toggle')).backgroundImage;return Math.abs(b.left-s.left)<1&&Math.abs(b.width-s.width)<1&&Math.abs(t.height-Math.min(44,Math.max(30,innerWidth*.04)))<1&&Math.abs(c.width/c.height-3)<.01&&Math.abs(r.width/r.height-3)<.01&&i.naturalWidth===2172&&i.naturalHeight===724&&i.getAttribute('src')==='/assets/images/ui/train-route-six-cars.png'&&['scroll-knob-left.svg','scroll-knob-right.svg','scroll-band.svg'].every(name=>roller.includes(name))&&[...document.querySelectorAll('.train-map-lights-off')].every(el=>el.tagName==='IMG'&&el.complete&&el.naturalWidth===2172&&el.naturalHeight===724&&el.getAttribute('src')==='/assets/images/ui/train-route-lights-off.webp')&&!document.querySelector('.map-heading,.map-caption,.stop-state')&&document.documentElement.scrollWidth<=innerWidth;})()");
  const windowReady=()=>wait("document.querySelector('#overlay').open&&document.querySelector('#overlay').dataset.view==='window'&&document.querySelector('.window-frame-art')?.complete&&document.querySelector('.window-frame-art').naturalWidth>0&&document.querySelector('.window-aperture video')?.readyState>=2&&!document.querySelector('.window-aperture video').paused",'live train window');
  const retainWindow=()=>evaluate("window.__qaOldWindow=document.querySelector('.window-aperture video');true");
  const windowReleased=()=>wait("!document.querySelector('#overlay').open&&window.__qaOldWindow?.paused&&!window.__qaOldWindow.hasAttribute('src')&&![...window.__qaOldWindow.querySelectorAll('source')].some(s=>s.hasAttribute('src'))&&window.__qaOldWindow.readyState===0",'closed window releases its media');
  const escape=async()=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});};
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  for(const [width,height] of [[1440,900],[1920,1080],[1024,768],[390,844],[320,568],[844,390]]){
   const size=width+'x'+height;
   await viewport(width,height);await seed('feedback');
   await evaluate("localStorage.setItem('train_map_closed','false');localStorage.removeItem('train_reduced_motion')");
   await navigate('/chat');await ready();await mapSettled();
   await evaluate("document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))");
   const revision=await evaluate("fetch('/api/game').then(r=>r.json()).then(d=>d.game.revision)");
   const openDimensions=await dimensions();
   await check('original map art keeps its native ratio and wooden paper roller '+size,await mapArtFits());
   await check('six map rooms preserve server locks and accessible current labels '+size,"fetch('/api/game').then(r=>r.json()).then(d=>{const rooms=[...document.querySelectorAll('#train-map [data-location]')],ids=['car_1','car_2','car_3','car_4','crew','engine'];return rooms.length===6&&rooms.every((b,i)=>{const p=d.game.map.find(p=>p.id===ids[i]);return b.dataset.location===p.id&&b.disabled===(!p.open||p.current)&&b.classList.contains('locked')===!p.open&&b.getAttribute('aria-current')===(p.current?'location':'false')&&b.getAttribute('aria-label')===(p.open||p.current?(p.id==='crew'?'승무원실 · 4호차와 기관실 사이':p.id==='engine'?'기관실 · 승무원실을 통해 연결':p.name)+' · '+(p.current?'현재 위치':p.visited?'다녀온 곳':'이동 가능'):'아직 열리지 않은 칸')&&(p.open||p.current?getComputedStyle(b.querySelector('.stop-name')).visibility==='visible':getComputedStyle(b.querySelector('.stop-name')).visibility==='hidden');});})");
   await snapshot('window-map-expanded-'+size);
   await evaluate("(()=>{const start=performance.now(),trace=window.__qaMapTrace=[],record=event=>{const p=document.querySelector('#train-map-panel');trace.push({event,time:performance.now()-start,height:p.getBoundingClientRect().height,full:p.querySelector('.train-map-sheet').getBoundingClientRect().height,direction:document.querySelector('.train-map-bar').dataset.rollDirection,animations:p.getAnimations().length,width:innerWidth,viewportWidth:visualViewport.width,viewportHeight:visualViewport.height,clientWidth:document.documentElement.clientWidth,scrollHeight:document.documentElement.scrollHeight});};const tick=()=>{record('frame');if(performance.now()-start<1300)requestAnimationFrame(tick);};visualViewport.addEventListener('resize',()=>record('viewport resize'),{once:true});window.addEventListener('resize',()=>record('window resize'),{once:true});requestAnimationFrame(tick);})()");
   // Sample the actual native WAAPI effects at their midpoint. Explicit timing
   // avoids missing every intermediate frame under concurrent browser QA load.
   await evaluate("(()=>{window.__qaNativeAnimate=Element.prototype.animate;Element.prototype.animate=function(frames,timing){const animation=window.__qaNativeAnimate.call(this,frames,timing);if(this.matches('#train-map-panel,.train-map-sheet,.map-roll-edge')){animation.pause();animation.currentTime=timing.duration/2;}return animation;};})()");
   await click('#map-toggle');
   try{await wait("(()=>{const p=document.querySelector('#train-map-panel'),h=p.getBoundingClientRect().height,f=p.querySelector('.train-map-sheet').getBoundingClientRect().height;return document.querySelector('.train-map-bar').dataset.rollDirection==='closing'&&h>f*.2&&h<f*.8;})()",'map partially rolls into its spindle');}
   catch(error){fs.writeFileSync(path.join(out,'map-motion-trace.json'),JSON.stringify(await evaluate("window.__qaMapTrace||[]"),null,2));throw error;}
   await check('full roll uses a native 720ms animation '+size,"document.querySelector('#train-map-panel').getAnimations().some(a=>a.effect.getComputedTiming().duration===720&&a.currentTime===360&&a.playState==='paused')");
   await check('rolling paper translates without scaling or folding the illustration '+size,"(()=>{const m=new DOMMatrix(getComputedStyle(document.querySelector('.train-map-sheet')).transform);return Math.abs(m.a-1)<.001&&Math.abs(m.d-1)<.001&&m.f<0&&getComputedStyle(document.querySelector('#train-map-panel')).overflow==='hidden'&&Number(getComputedStyle(document.querySelector('.map-roll-edge')).opacity)>0;})()");
   const rollingDimensions=await dimensions();
   if(!sameSizes(openDimensions,rollingDimensions))fs.writeFileSync(path.join(out,'map-size-drift.json'),JSON.stringify({viewport:[width,height],before:openDimensions,during:rollingDimensions,trace:await evaluate("window.__qaMapTrace||[]")},null,2));
   await check('rolling keeps scene and HUD sizes '+size,sameSizes(openDimensions,rollingDimensions));
   await snapshot('window-map-rolling-'+size);
   const reversal=await evaluate("(()=>{Element.prototype.animate=window.__qaNativeAnimate;const p=document.querySelector('#train-map-panel'),before=p.getBoundingClientRect().height;document.querySelector('#map-toggle').click();return {before,after:p.getBoundingClientRect().height,direction:document.querySelector('.train-map-bar').dataset.rollDirection};})()");
   await check('mid-roll reversal continues at the visible paper length '+size,Math.abs(reversal.before-reversal.after)<1.5&&reversal.direction==='opening');
   await evaluate("new Promise(resolve=>requestAnimationFrame(()=>{document.querySelector('#map-toggle').click();requestAnimationFrame(()=>{document.querySelector('#map-toggle').click();resolve();});}))");
   await mapSettled();await check('rapid toggles converge to an open accessible sheet '+size,mapState(false));
   await click('#map-toggle');await mapSettled();await check('folded paper is inert and preferences converge '+size,mapState(true));
   await check('folding preserves scene and HUD dimensions '+size,sameSizes(openDimensions,await dimensions()));
   await click('#map-toggle');await mapSettled();await check('reopening restores the complete native sheet '+size,mapState(false));
   await check('map animation does not commit a game turn '+size,await evaluate("fetch('/api/game').then(r=>r.json()).then(d=>d.game.revision)")===revision);
   await click('[data-hotspot="window"]');await ready();await windowReady();
   await check('window is a native-ratio frame without paper or internal scrolling '+size,"(()=>{const d=document.querySelector('#overlay'),r=d.getBoundingClientRect(),b=document.querySelector('#overlay-body'),a=document.querySelector('.window-frame-art'),c=document.querySelector('#close-overlay').getBoundingClientRect();return d.matches(':modal')&&d.classList.contains('window-dialog')&&!d.classList.contains('paper-dialog')&&getComputedStyle(d).borderImageSource==='none'&&r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&Math.abs(r.width/r.height-a.naturalWidth/a.naturalHeight)<.003&&d.scrollWidth<=d.clientWidth+1&&d.scrollHeight<=d.clientHeight+1&&b.scrollWidth<=b.clientWidth+1&&b.scrollHeight<=b.clientHeight+1&&c.width>=44&&c.height>=44&&c.left>=r.left&&c.top>=r.top&&c.right<=r.right+1&&c.bottom<=r.bottom+1;})()");
   await check('scenery plays behind glass and a truly transparent window aperture '+size,"(()=>{const a=document.querySelector('.window-frame-art'),v=document.querySelector('.window-aperture video'),g=document.querySelector('.window-glass'),c=document.createElement('canvas');c.width=a.naturalWidth;c.height=a.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(a,0,0);const alpha=(x,y)=>ctx.getImageData(Math.round(x*c.width),Math.round(y*c.height),1,1).data[3];return a.getAttribute('src')==='/assets/images/ui/train-window-frame.png'&&alpha(.5,.5)<10&&alpha(.02,.02)<10&&[alpha(.15,.5),alpha(.85,.5),alpha(.5,.1),alpha(.5,.9)].some(a=>a>220)&&getComputedStyle(a).pointerEvents==='none'&&getComputedStyle(g).pointerEvents==='none'&&v.loop&&v.muted&&v.playsInline&&!v.controls&&v.disablePictureInPicture&&v.querySelectorAll('source[src]').length===2&&getComputedStyle(v).objectFit==='cover';})()");
   const beforeTime=await evaluate("document.querySelector('.window-aperture video').currentTime");
   await wait("Math.abs(document.querySelector('.window-aperture video').currentTime-"+beforeTime+")>.08",'window scenery advances');
   await snapshot('window-frame-'+size);
   await retainWindow();await click('#close-overlay');await windowReleased();
   await check('close releases video decoder and restores scene controls '+size,"!document.querySelector('#overlay').open&&!document.querySelector(':modal')&&!document.querySelector('.chat-area').inert&&getComputedStyle(document.querySelector('.chat-area')).pointerEvents!=='none'&&window.__qaOldWindow.readyState===0");
   await click('[data-hotspot="window"]');await ready();await windowReady();
   await check('reopening creates one fresh window player '+size,"document.querySelectorAll('.window-aperture video').length===1&&window.__qaOldWindow!==document.querySelector('.window-aperture video')&&!window.__qaOldWindow.isConnected&&window.__qaOldWindow.paused");
   await retainWindow();await escape();await windowReleased();
   await click('#menu-btn');await images();
   await check('settings restores its ordinary paper after the window '+size,"document.querySelector('#overlay').dataset.view==='settings'&&document.querySelector('#overlay').classList.contains('paper-dialog')&&!document.querySelector('#overlay').classList.contains('window-dialog')&&getComputedStyle(document.querySelector('#overlay')).borderImageSource.includes('dossier-panel.png')&&!document.querySelector('.window-video-view')");
   await click('#close-overlay');
  }
  await viewport(1440,900);await seed('feedback');
  await evaluate("localStorage.setItem('train_map_closed','false');localStorage.removeItem('train_reduced_motion')");await navigate('/chat');await ready();await mapSettled();
  await click('#map-toggle');await wait("document.querySelector('.train-map-bar').classList.contains('rolling')",'rolling before resize');
  await viewport(1024,768);await mapSettled();
  await check('resize mid-roll settles to a closed sheet without stale transforms',mapState(true));
  await check('resize removes animated pixel heights and sheet translation',"document.querySelector('#train-map-panel').style.height===''&&getComputedStyle(document.querySelector('.train-map-sheet')).transform==='none'");
  await click('#map-toggle');await mapSettled();await check('resized reopened sheet preserves its new native proportions',await mapArtFits());
  await click('#map-toggle');await wait("document.querySelector('.train-map-bar').classList.contains('rolling')",'rolling before app reduced motion');
  await evaluate("document.documentElement.classList.add('reduced-motion')");
  await mapSettled();await check('app reduced motion settles an active roll immediately',mapState(true));
  await evaluate("document.querySelector('#map-toggle').click()");
  await check('app reduced motion opens immediately without rolling',"!document.querySelector('.train-map-bar').classList.contains('rolling')&&document.querySelector('#train-map-panel').getAnimations().length===0&&document.querySelector('#map-toggle').getAttribute('aria-expanded')==='true'&&!document.querySelector('#train-map-panel').inert");
  await evaluate("document.documentElement.classList.remove('reduced-motion')");
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await evaluate("document.querySelector('#map-toggle').click()");
  await check('OS reduced motion closes immediately without rolling',mapState(true));
  await check('OS reduced motion suppresses paper and spindle animations',"!document.querySelector('.train-map-bar').classList.contains('rolling')&&document.querySelector('#train-map-panel').getAnimations().length===0&&getComputedStyle(document.querySelector('#map-toggle'),'::before').animationName==='none'");
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await seed('feedback');await click('[data-hotspot="notice"]');await ready();
  await check('room unlock waits while its notice is open',"!document.querySelector('[data-location=\"car_2\"]').classList.contains('just-opened')");
  await click('#close-overlay');
  await wait("document.querySelector('.train-map-bar').classList.contains('rolling')",'unlock unrolls the saved closed map');
  await check('unlock feedback waits until the sheet is fully visible',"!document.querySelector('[data-location=\"car_2\"]').classList.contains('just-opened')");
  await check('automatic unlock reveal retains the players closed preference',"localStorage.getItem('train_map_closed')==='true'");
  await evaluate("(()=>{const toggle=document.querySelector('#map-toggle');toggle.click();toggle.click();for(const el of [document.querySelector('#train-map-panel'),document.querySelector('.train-map-sheet'),document.querySelector('.map-roll-edge')])for(const a of el.getAnimations()){a.pause();a.currentTime=a.effect.getTiming().duration/2;}})()");
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await check('reversing an unlock roll keeps feedback pending until the new roll finishes',"document.querySelector('.train-map-bar').classList.contains('rolling')&&!document.querySelector('[data-location=\"car_2\"]').classList.contains('just-opened')");
  await evaluate("for(const el of [document.querySelector('#train-map-panel'),document.querySelector('.train-map-sheet'),document.querySelector('.map-roll-edge')])for(const a of el.getAnimations())a.play()");
  await mapSettled();await wait("document.querySelector('[data-location=\"car_2\"]').classList.contains('just-opened')",'unlock sparkle follows completed roll');
  await check('manually reversing the unlock roll saves the new open preference',"!document.querySelector('#train-map-panel').inert&&localStorage.getItem('train_map_closed')==='false'");
  await snapshot('window-map-unlocked-after-roll');
  await viewport(390,844);await seed('feedback');
  await evaluate("(()=>{window.__qaNativePlay=HTMLMediaElement.prototype.play;window.__qaAutoplayDescriptor=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'autoplay');Object.defineProperty(HTMLMediaElement.prototype,'autoplay',{...window.__qaAutoplayDescriptor,set(value){window.__qaAutoplayDescriptor.set.call(this,false);}});HTMLMediaElement.prototype.play=function(){if(this.closest('.window-video-view'))return Promise.reject(new DOMException('QA autoplay denied','NotAllowedError'));return window.__qaNativePlay.call(this);};})()");
  await click('[data-hotspot="window"]');await ready();
  await wait("!document.querySelector('.window-video-status').hidden&&document.querySelector('.window-video-status').textContent.includes('창문을 눌러')",'autoplay fallback gives a window gesture');
  await snapshot('window-frame-autoplay-fallback-390');
  await evaluate("(()=>{HTMLMediaElement.prototype.play=window.__qaNativePlay;Object.defineProperty(HTMLMediaElement.prototype,'autoplay',window.__qaAutoplayDescriptor);return true;})()");
  await click('.window-aperture video');await windowReady();
  await check('a real window click recovers rejected autoplay',"document.querySelector('.window-video-status').hidden&&!document.querySelector('.window-aperture video').paused");
  for(const [key,code,virtualCode] of [['Enter','Enter',13],[' ','Space',32]]){
   await evaluate("(()=>{const v=document.querySelector('.window-aperture video');v.pause();v.focus();return true;})()");
   await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtualCode});
   await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtualCode});
   await windowReady();await check('keyboard '+code+' resumes the focused window',"document.activeElement===document.querySelector('.window-aperture video')&&!document.querySelector('.window-aperture video').paused");
  }
  await retainWindow();await escape();await windowReleased();
 }
 if(!entryArtOnly&&!entryOnly&&!windowMapOnly&&!presentationOnly&&!interfaceOnly&&!scenesOnly&&!feedbackOnly&&!cleanerItemsOnly){
 if(inventoryOnly)await inventoryChecks();
 if(cinematicsOnly&&!inventoryOnly){
  await viewport(390,844);await issueName('윤슬');await openingChecks();
 }
 if(!process.argv.includes('--puzzles-only')&&!cinematicsOnly&&!doorsOnly&&!inventoryOnly){
 if(!process.argv.includes('--visuals-only')){
 await viewport(1440);await navigate('/');
 await wait(`Number.isFinite(TrainAudio.element.duration)&&TrainAudio.element.duration>10`);
 await check('MP3 is local and loops',`TrainAudio.element.loop&&TrainAudio.element.currentSrc.endsWith('/assets/audio/train-theme.mp3')`);
 await click('.main');await wait(`!TrainAudio.element.paused`);
 await check('music starts after a real user gesture',`TrainAudio.element.currentTime>=0&&!TrainAudio.element.paused`);
 await evaluate(`TrainAudio.setVolume(35)`);
 await check('real audio volume follows preference',`TrainAudio.element.volume===.35&&JSON.parse(localStorage.getItem('noTerminus.settings')).bgm===35`);
 await click('[data-bgm-toggle]');await check('title sound button mutes music',`TrainAudio.isMuted()&&TrainAudio.element.paused`);
 await click('[data-bgm-toggle]');await wait(`!TrainAudio.element.paused`);
 await evaluate(`TrainAudio.setVolume(0)`);await click('[data-bgm-toggle]');
 await wait(`!TrainAudio.element.paused`);await check('zero volume can be enabled with one click',`TrainAudio.getVolume()>0&&!TrainAudio.isMuted()`);
 await evaluate(`TrainAudio.setVolume(35);TrainAudio.element.currentTime=11`);
 await navigate('/detail');await wait(`Number.isFinite(TrainAudio.element.duration)`);
 await check('boarding page restores the track position and volume',`TrainAudio.getVolume()===35&&TrainAudio.element.currentTime>=10`);
 await seed('base');await click('#bag-btn');await wait(`!TrainAudio.element.paused`);
 await evaluate(`TrainAudio.element.currentTime=TrainAudio.element.duration-.15`);
 await wait(`TrainAudio.element.currentTime<2&&!TrainAudio.element.paused`,'native audio loop crosses end of track');
 await check('track repeats naturally at its end',`TrainAudio.element.loop&&!TrainAudio.element.ended`);
 await evaluate(`TrainAudio.setMuted(true)`);
 }

 for(const [width,height] of [[1440,1000],[1024,768],[768,1024],[390,844],[320,568]]){
  await viewport(width,height);await seed('base');await openBag();await fit('overview fits without internal scrolling '+width);
  await check('overview uses the supplied-style book and taped frame '+width,`getComputedStyle(document.querySelector('.inventory-overview')).backgroundImage.includes('book-overview.png')&&!!document.querySelector('.inventory-mount-art')`);
  await snapshot('overview-'+width);
  for(const id of ['ticket_current','facility_manual','route_report']){
   await openItem(id);await fit(id+' fits without internal scrolling '+width);
   await check(id+' explanation is an actual PNG '+width,`(()=>{const p=document.querySelector('.book-page'),i=p.querySelector('.inventory-record-image');return i.naturalWidth===900&&i.naturalHeight===1120&&i.src.endsWith('.png')&&p.querySelectorAll('p,table,h3').length===0;})()`);
   await snapshot(id+'-'+width);
   if(width<=600&&id==='ticket_current'){
    await click('.inventory-catalog .inventory-pager [aria-label="다음 페이지"]');await images();
    await check('mobile catalog next button is clear of close button '+width,`document.querySelector('#overlay').open&&document.querySelector('.inventory-catalog .inventory-page-number').textContent.startsWith('2 /')`);
    await click('.inventory-catalog .inventory-pager [aria-label="이전 페이지"]');await images();
   }
   await click('.inventory-back');await ready();await images();
  }
  await check('general dialogue uses readable Korean font '+width,`getComputedStyle(document.querySelector('.dialogue-text')).fontFamily.startsWith('TrainKorean')`);
  await check('game header is removed and minimap is first '+width,`!document.querySelector('.game-header')&&document.querySelector('.game-shell').firstElementChild.classList.contains('train-map-bar')`);
 }
 await viewport(1440,1000);await seed('dark');await openBag();await openItem('flashlight');
 await check('flashlight action is a printed dark paper image',`document.querySelector('[aria-label="손전등 사용"] img')?.src.endsWith('/actions/use-flashlight.png')`);
 await snapshot('flashlight-action');await click('[aria-label="손전등 사용"]');await ready();
 await check('using flashlight lights the actual scene and closes book',`!document.querySelector('#overlay').open&&document.querySelector('#darkness').classList.contains('flashlight-mask')`);
 await check('closing inventory restores scene controls',`!document.querySelector('#overlay').open&&!document.querySelector(':modal')&&!document.querySelector('.chat-area').inert&&getComputedStyle(document.querySelector('.chat-area')).pointerEvents!=='none'`);
 await openBag();await openItem('flashlight');
 await check('flashlight use is hidden after lighting car three',`!document.querySelector('[aria-label="손전등 사용"]')`);
 for(const phase of ['crew','car4','proof']){
  await seed(phase);await openBag();await openItem('flashlight');
  await check('flashlight use is hidden outside dark car three '+phase,`!document.querySelector('[aria-label="손전등 사용"]')`);
 }
 await seed('crew');await openBag();await openItem('route_report');await click('[aria-label="보고서 내용 확인"]');await ready();
 await check('report confirmation still records a completed read',`fetch('/api/game').then(r=>r.json()).then(d=>d.game.inventory.find(i=>i.id==='route_report').read&&!document.querySelector('#overlay').open)`);
 await seed('proof');await openBag();await openItem('ticket_current');await click('[aria-label="이 물건을 최종 증거로 제출"]');await ready();
 await check('evidence button preserves final confirmation',`document.querySelector('#overlay').dataset.view==='confirm'`);
  await check('confirmation buttons use live rectangular paper controls',`document.querySelectorAll('.modal-actions button').length===2&&!document.querySelector('.modal-actions img')&&document.querySelector('.modal-actions .primary').textContent==='최종 확정'`);
 await check('opening submission has not spent final attempt',`fetch('/api/game').then(r=>r.json()).then(d=>d.game.attempts===1&&d.game.status==='playing')`);
 await snapshot('evidence-confirmation');await click('[aria-label="취소하고 다시 살펴보기"]');await ready();
 await check('cancelling keeps final attempt',`fetch('/api/game').then(r=>r.json()).then(d=>d.game.attempts===1&&!d.game.confirmation)`);
 for(const [phase,suffix,contains] of [['early','00',false],['base','10',false],['full','11',true]]){
  await seed(phase);await openBag();await openItem('elder_testimony');
  await check('testimony uses state-specific image '+phase,`document.querySelector('.inventory-record-image').src.endsWith('/elder-testimony-${suffix}.png')&&document.querySelector('.inventory-record-image').alt.includes('삶과 죽음')===${contains}`);
 }
 await seed('returned');await openBag();await openItem('ticket_old');await check('returned ticket uses the preserved-record image',`document.querySelector('.inventory-record-image').src.endsWith('/ticket-old-returned.png')`);
 await click('#close-overlay');await click('#menu-btn');
 await evaluate(`(()=>{const s=document.querySelector('input[aria-label="배경음악 음량"]');s.value='20';s.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await check('in-game menu changes actual music volume',`TrainAudio.getVolume()===20&&TrainAudio.element.volume===.2`);
 for(const [width,height] of [[1440,1000],[390,844]]){
  await viewport(width,height);await seed('acquire');await click('#choice-list .choice-button');await ready();
  await wait(`!document.querySelector('#acquisition-notice').hidden&&document.querySelector('#acquisition-notice img')?.complete`);
  await check('new acquisition has real taped-frame artwork '+width,`getComputedStyle(document.querySelector('.acquired-icon')).backgroundImage.includes('photo-mount.png')`);
  await check('acquisition notice fits its paper '+width,`(()=>{const el=document.querySelector('#acquisition-notice'),r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth+1;})()`);
  await snapshot('acquisition-'+width);
 }
 // Exercise actual title/name routes and API, rather than a rendered HTML fixture.
 await viewport(390,844);await navigate('/');await click('#settingsBtn');
 await check('title settings opens',`document.querySelector('#settingsDialog').open`);
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await check('title settings closes with Escape',`!document.querySelector('#settingsDialog').open`);
 await click('.boarding-pass');await wait(`!!document.querySelector('#passengerName')`);
 await check('empty passenger name is blocked',`document.querySelector('#issueBtn').disabled`);
 await evaluate(`document.querySelector('#passengerName').value='123';document.querySelector('#passengerName').dispatchEvent(new Event('input'))`);
 await check('numeric passenger name is blocked',`document.querySelector('#issueBtn').disabled`);
 await evaluate(`document.querySelector('#passengerName').value='윤슬';document.querySelector('#passengerName').dispatchEvent(new Event('input'))`);
 await check('valid passenger name enables issue without horizontal overflow',`!document.querySelector('#issueBtn').disabled&&document.documentElement.scrollWidth<=innerWidth+1`);
 await click('#issueBtn');await openingChecks();await ready();
 await check('issued passenger name reaches the real game',`fetch('/api/game').then(r=>r.json()).then(d=>d.game.username==='윤슬'&&d.game.location.id==='car_1'&&d.game.status==='playing')`);
 await click('[data-hotspot="window"]');await wait(`document.querySelector('#overlay').dataset.view==='window'`);
 await wait(`document.querySelector('#overlay video')?.readyState>=2`);
 await check('local window video decodes and loops',`(()=>{const v=document.querySelector('#overlay video');return v.loop&&v.muted&&v.playsInline&&v.videoWidth>0;})()`);
 await click('#close-overlay');
 }
 if(!cinematicsOnly&&!inventoryOnly)for(const [width,height] of [[1440,900],[390,844]]){
  await viewport(width,height);
  for(const phase of ['nav_blocked','nav_conversation','nav_crew_locked','dark']){
   await seed(phase);
   await check('gated scene has no movement door '+phase+' '+width,`!document.querySelector('[data-hotspot^="door_to_"]')`);
  }
  await seed('nav_crew');
  for(const target of ['car_2','car_3','car_4','crew'])await walkThroughDoor(target,width);
  await check('crew inner door stays inactive before engine permission '+width,`!document.querySelector('[data-hotspot^="door_to_"]')`);
  await seed('nav_engine');
  await check('car 4 door keeps its crew-room destination after engine permission '+width,`!!document.querySelector('[data-hotspot="door_to_crew"]')&&!document.querySelector('[data-hotspot="door_to_engine"]')`);
  await walkThroughDoor('crew',width);await walkThroughDoor('engine',width);
  await click('#train-map [data-location="crew"]');await ready();
  await check('engine returns through the crew room on the minimap '+width,`fetch('/api/game').then(r=>r.json()).then(d=>d.game.location.id==='crew'&&!!document.querySelector('[data-hotspot="door_to_engine"]'))`);
 }
 if(!doorsOnly&&!inventoryOnly){
 // Pull the emergency lever through the real service and enter the crew room.
 const shadowClick=async selector=>{
  await wait(`(()=>{const r=document.querySelector('.puzzle-host')?.shadowRoot;return r&&[...r.querySelectorAll('link')].every(l=>!!l.sheet)&&[...r.querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth);})()`,'puzzle stylesheet and artwork');
  await evaluate(`document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))`);
  const p=await evaluate(`(()=>{const root=document.querySelector('.puzzle-host').shadowRoot,el=root.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!el.contains(root.elementFromPoint(x,y)))throw new Error('Puzzle control is covered: '+${JSON.stringify(selector)});return{x,y};})()`);
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});
 };
 const puzzle=`document.querySelector('.puzzle-host')?.shadowRoot`;
 if(!cinematicsOnly)for(const [width,height] of [[1440,900],[390,844]]){
  await viewport(width,height);await seed('door');await click('[data-hotspot="inspection_cover"]');
  await wait(`${puzzle}?.querySelector('.cover-button')`);
  await check('door starts locked behind its cover '+width,`${puzzle}.querySelector('.lever').disabled&&${puzzle}.querySelector('.enter-room').hidden`);
  await shadowClick('.cover-button');await ready();
  await check('unread manual preserves the emergency access gate '+width,`${puzzle}.querySelector('.lever').disabled`);
  await shadowClick('.inventory');await wait(`document.querySelector('#overlay').dataset.inventoryMode==='overview'`);await images();
  await openItem('facility_manual');await click('#close-overlay');
  if(!await evaluate(`document.querySelector('#dialogue-box').hidden`))await click('#close-dialogue');
  await click('[data-hotspot="inspection_cover"]');await wait(`${puzzle}?.querySelector('.cover-button')`);
  await shadowClick('.cover-button');await ready();
  await wait(`${puzzle}.querySelector('.lever').disabled===false`);
  await shadowClick('.lever');await ready();
  await check('pulling the lever unlocks entry '+width,`${puzzle}.querySelector('.lever').classList.contains('is-down')&&!${puzzle}.querySelector('.enter-room').hidden`);
  await shadowClick('.enter-room');await ready();
  await check('unlocked door enters the real crew scene '+width,`fetch('/api/game').then(r=>r.json()).then(d=>d.game.location.id==='crew'&&!document.querySelector('#overlay').open)`);
 }
 // Validate real dial mechanics, confirmation cancellation and both video endings.
 for(const [width,height,correct] of [[1440,900,true],[390,844,false]]){
  await viewport(width,height);await seed('control');await click('[data-hotspot="control"]');
  await wait(`${puzzle}?.querySelector('.panel__bg')?.naturalWidth>0`);
  await check('control begins with blank station and zero dials '+width,`${puzzle}.querySelector('.station').value===''&&[...${puzzle}.querySelectorAll('.dial')].every(d=>d.getAttribute('aria-valuenow')==='0')`);
  await shadowClick('.lever');
  await check('blank station cannot spend the last attempt '+width,`fetch('/api/game').then(r=>r.json()).then(d=>d.game.attempts===1&&!d.game.confirmation&&document.querySelector('#overlay').dataset.view==='control')`);
  await evaluate(`(()=>{const d=${puzzle}.querySelector('.dial');d.click();d.dispatchEvent(new WheelEvent('wheel',{deltaY:1,cancelable:true}));})()`);
  await check('dial click and wheel rotate separately '+width,`${puzzle}.querySelector('.dial').getAttribute('aria-valuenow')==='2'`);
  await evaluate(`(()=>{const r=${puzzle};r.querySelector('.station').value='아지산역';r.querySelector('.station').dispatchEvent(new Event('input'));[...r.querySelectorAll('.dial')].forEach((d,i)=>d.dispatchEvent(new KeyboardEvent('keydown',{key:'2026'[i],bubbles:true})));})()`);
  await shadowClick('.lever');await ready();await wait(`document.querySelector('#overlay').dataset.view==='confirm'`);
  await check('prepared control still preserves its last attempt '+width,`fetch('/api/game').then(r=>r.json()).then(d=>d.game.attempts===1&&d.game.confirmation.password==='2026'&&d.game.confirmation.destination==='아지산역')`);
  await click('[aria-label="취소하고 다시 살펴보기"]');await ready();
  await check('cancel restores station and all dial values '+width,`${puzzle}.querySelector('.station').value==='아지산역'&&[...${puzzle}.querySelectorAll('.dial')].map(d=>d.getAttribute('aria-valuenow')).join('')==='2026'`);
  if(!correct)await evaluate(`${puzzle}.querySelectorAll('.dial')[3].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`);
  await shadowClick('.lever');await ready();await wait(`document.querySelector('#overlay').dataset.view==='confirm'`);
  await click('[aria-label="최종 확정"]');await ready();
  if(correct){
   await check('correct control immediately ends in the engine room',`fetch('/api/game').then(r=>r.json()).then(d=>d.game.attempts===0&&d.game.status==='good'&&d.game.location.id==='engine'&&document.querySelector('#send-btn').disabled)`);
  }else{
   await check('wrong final control spends exactly one attempt and opens bad ending',`fetch('/api/game').then(r=>r.json()).then(d=>d.game.attempts===0&&d.game.status==='bad'&&d.game.reason==='wrong_control'&&document.querySelector('#send-btn').disabled)`);
  }
  await check('minimap contains only the six connected train rooms '+width,`(()=>{const rooms=[...document.querySelectorAll('#train-map [data-location]')].map(b=>b.dataset.location);return rooms.length===6&&['car_1','car_2','car_3','car_4','crew','engine'].every(id=>rooms.includes(id));})()`);
  const ending=correct?'good':'bad';
  await cinematicReady(ending,ending+'-ending.mp4');
  await check('ending replaces the newspaper presentation '+ending,`!document.querySelector('.ending-paper')&&!document.querySelector('#overlay').open&&document.querySelector('#cinematic-skip').hidden`);
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await check('Escape preserves the '+ending+' ending',`document.querySelector('#cinematic').open`);
  await finishVideo();
  await wait(`document.querySelector('#overlay').open&&document.querySelector('#overlay').dataset.view==='ending-complete'`);
  await check(ending+' exposes restart only after the native ending completes',`!document.querySelector('#cinematic').open&&!document.querySelector('#cinematic-video').hasAttribute('src')&&document.querySelector('#cinematic-video').readyState===0&&!!document.querySelector('#ending-restart')&&document.querySelector('#send-btn').disabled`);
  await check(ending+' completion preserves the saved outcome',`fetch('/api/game').then(r=>r.json()).then(d=>d.game.status==='${ending}'&&d.game.attempts===0)`);
 }
 await click('#ending-restart');
 await freshTitle('ending restart');
 await issueName('새시작');
 await cinematicReady('opening','opening.mp4');
 await check('issuing after ending restart starts a fresh opening before gameplay',`fetch('/api/game').then(r=>r.json()).then(d=>d.game.revision===0&&d.game.username==='새시작'&&d.game.location.id==='car_1'&&d.game.status==='playing'&&d.game.attempts===null&&!d.game.clock_running)`);
 await finishVideo();await ready();
 await check('a completed new opening begins a fresh car 1 game',`fetch('/api/game').then(r=>r.json()).then(d=>d.game.location.id==='car_1'&&d.game.status==='playing'&&d.game.attempts===null&&!d.game.clock_running&&!document.querySelector('#cinematic').open)`);
 await openingRecoveryChecks();
 }
 }
 await check('no failed game or asset responses',networkErrors.length===0);
 await check('no browser exceptions',errors.length===0);
 console.log(JSON.stringify({passed:checks.length,gameRoot,artifacts:out},null,2));
}catch(error){errors.push(String(error.stack||error));console.error(error.stack||error);await captureFailure?.().catch(()=>{});process.exitCode=1;}
finally{
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({gameRoot,checks,errors,networkErrors,...(errors.length?{serverLog}: {})},null,2));
 if(inventoryMetrics.length)fs.writeFileSync(path.join(out,'inventory-metrics.json'),JSON.stringify(inventoryMetrics,null,2));
 if(actorMetrics.length)fs.writeFileSync(path.join(out,'actor-hit-metrics.json'),JSON.stringify(actorMetrics,null,2));
 socket?.close();await stopChild(browser);await stopChild(server);
 const resolvedOut=fs.realpathSync(out),resolvedProfile=fs.realpathSync(chromeProfile);
 if(resolvedProfile.startsWith(resolvedOut+path.sep)&&path.basename(resolvedProfile).startsWith('chrome-'))fs.rmSync(resolvedProfile,{recursive:true,force:true,maxRetries:8,retryDelay:150});
}

