import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

// Node 22+ provides WebSocket. Uses the real Flask app with an isolated save
// and offline model; no browser package, dependency install or player save.
// Run: node tools/check_viewport_ui.mjs [--software-renderer] [--no-sandbox]
// --no-sandbox is opt-in for restricted QA hosts whose browser renderer cannot
// start its sandbox. The fixture remains local and uses a temporary save.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const gameRoot=path.resolve(process.env.GAMEPLAY_QA_GAME_ROOT||root);
const out=path.join(root,'.local','viewport-ui-qa',String(Date.now()));
fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(out,'edge-'));
const sizes=[[1920,1080],[2560,1080],[1440,900],[1366,768],[1024,768],[768,1024],[390,844],[320,568],[844,390],[667,375]];
const checks=[],metrics=[],transitions=[],mapPaint=[],errors=[],networkErrors=[],fontRequests=[];
let server,browser,socket,captureFailure,serverLog='',browserLog='';

function browserExecutable(){
  if(process.env.DIALOGUE_QA_CHROME)return process.env.DIALOGUE_QA_CHROME;
  const candidates=[
    path.join(process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.PROGRAMFILES||'C:/Program Files','Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.PROGRAMFILES||'C:/Program Files','Google/Chrome/Application/chrome.exe'),
  ];
  const found=candidates.find(candidate=>fs.existsSync(candidate));
  if(!found)throw new Error('Set DIALOGUE_QA_CHROME to an installed Edge or Chrome executable.');
  return found;
}

async function stopChild(child){
  if(!child||child.exitCode!==null)return;
  await new Promise(resolve=>{
    const timer=setTimeout(resolve,5000);
    child.once('exit',()=>{clearTimeout(timer);resolve();});
    child.kill();
  });
}

// This function runs in the page. Every scene layer uses native coordinates;
// checking both rectangles and actual actor hits catches independent scaling.
async function collectMetrics(){
  const data=await fetch('/api/game').then(response=>response.json());
  const rect=el=>{
    const r=el.getBoundingClientRect();
    return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};
  };
  const near=(a,b)=>Math.abs(a-b)<=1.1;
  const same=(a,b)=>['left','top','width','height'].every(key=>near(a[key],b[key]));
  const image=document.querySelector('#scene-image'),world=document.querySelector('#scene-world');
  const frame=document.querySelector('.scene-frame'),viewport=document.querySelector('.scene-viewport');
  const worldRect=rect(world),frameRect=rect(frame),css=getComputedStyle(frame);
  const borderWidth=parseFloat(css.borderLeftWidth)+parseFloat(css.borderRightWidth);
  const borderHeight=parseFloat(css.borderTopWidth)+parseFloat(css.borderBottomWidth);
  const aspect=data.scene.aspect_ratio.split('/').map(Number).reduce((a,b)=>a/b);
  const contains=r=>r.width>0&&r.height>0&&r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;
  const control=el=>{
    const r=rect(el),cx=r.left+r.width/2,cy=r.top+r.height/2;
    return {id:el.id||el.dataset.location||el.className,rect:r,inside:contains(r),reachable:el.contains(document.elementFromPoint(cx,cy))};
  };
  const mapOpen=document.querySelector('#map-toggle').getAttribute('aria-expanded')==='true';
  const conversation=!document.querySelector('.conversation-console').hidden;
  const controls=[...document.querySelectorAll('#menu-btn,#bag-btn,#history-btn,#hint-btn,#map-toggle')];
  if(mapOpen)controls.push(...document.querySelectorAll('#train-map [data-location]'));
  if(conversation)controls.push(...document.querySelectorAll('#user-message,#send-btn,#end-talk,#close-dialogue'));
  const registrations=[...document.querySelectorAll('.registered-hotspot')].map(group=>{
    const hit=group.querySelector('.registered-hit'),art=group.querySelector('.registered-art');
    const spec=hit.dataset.npc?data.scene.people.find(person=>person.id===hit.dataset.npc):data.scene.hotspots.find(point=>point.id===hit.dataset.hotspot);
    return {id:hit.dataset.npc||hit.dataset.hotspot,hit:rect(hit),art:rect(art),group:rect(group),
      aligned:same(rect(hit),worldRect)&&same(rect(art),worldRect)&&same(rect(group),worldRect),
      clipped:getComputedStyle(hit).clipPath!=='none',backgroundMatches:(spec?.registration?.background||spec?.background)===data.scene.background,
      nativeMatches:art.naturalWidth===image.naturalWidth&&art.naturalHeight===image.naturalHeight};
  });
  const actorSamples=[];
  for(const hit of document.querySelectorAll('.registered-character [data-npc]')){
    const art=hit.parentElement.querySelector('.registered-art');
    await art.decode();
    const canvas=document.createElement('canvas');canvas.width=art.naturalWidth;canvas.height=art.naturalHeight;
    const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(art,0,0);
    const pixels=context.getImageData(0,0,canvas.width,canvas.height).data,r=rect(art);
    const alpha=(x,y)=>x<0||y<0||x>=canvas.width||y>=canvas.height?0:pixels[(Math.round(y)*canvas.width+Math.round(x))*4+3];
    const radius=Math.max(4,Math.ceil(canvas.width/r.width*3)),offsets=[[0,0],[radius,0],[-radius,0],[0,radius],[0,-radius],[radius,radius],[-radius,radius],[radius,-radius],[-radius,-radius]];
    let samples=0;const misses=[];
    for(let y=radius;y<canvas.height-radius;y+=Math.max(6,Math.floor(canvas.height/50)))for(let x=radius;x<canvas.width-radius;x+=Math.max(6,Math.floor(canvas.width/45))){
      if(!offsets.every(([dx,dy])=>alpha(x+dx,y+dy)>=220))continue;
      const cx=r.left+x/canvas.width*r.width,cy=r.top+y/canvas.height*r.height;
      if(cx<.5||cy<.5||cx>innerWidth-.5||cy>innerHeight-.5)continue;
      const target=document.elementFromPoint(cx,cy);
      if(target?.closest('.scene-top,.train-map-bar,.conversation-badge,.dialogue-box,.interaction-guide'))continue;
      samples++;
      if(target?.closest('[data-npc]')?.dataset.npc!==hit.dataset.npc)misses.push({x:cx,y:cy,target:target?.id||target?.className});
    }
    actorSamples.push({id:hit.dataset.npc,samples,misses:misses.slice(0,8),missCount:misses.length});
  }
  const speech=document.querySelector('.dialogue-speech'),text=document.querySelector('#dialogue-text');
  return {
    viewport:[innerWidth,innerHeight],timeOrigin:performance.timeOrigin,revision:data.game.revision,npc:data.game.npc,
    mapOpen,conversation,mapPanel:rect(document.querySelector('#train-map-panel')),mapSheet:rect(document.querySelector('.train-map-sheet')),mapTransform:getComputedStyle(document.querySelector('#train-map-panel')).transform,
    mapStyles:[...document.querySelectorAll('.train-map-bar,.train-map-panel,.train-map-sheet,.train-map-canvas,.train-map-art')].map(el=>{const style=getComputedStyle(el);return {element:el.className,opacity:style.opacity,visibility:style.visibility,overflow:style.overflow,filter:style.filter,transform:style.transform,clipPath:style.clipPath,zIndex:style.zIndex,background:style.backgroundColor,contain:style.contain,rect:rect(el)};}),
    document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,bodyWidth:document.body.scrollWidth,bodyHeight:document.body.scrollHeight,x:scrollX,y:scrollY},
    native:[image.naturalWidth,image.naturalHeight],aspect,world:worldRect,frame:frameRect,sceneViewport:rect(viewport),
    expectedWorldWidth:Math.min(viewport.clientWidth-borderWidth,(viewport.clientHeight-borderHeight)*aspect),
    image:rect(image),objectFit:getComputedStyle(image).objectFit,
    composer:conversation?rect(document.querySelector('.conversation-console')):null,
    controls:controls.map(control),registrations,actorSamples,
    fonts:{ui:getComputedStyle(document.body).fontFamily,speech:speech?getComputedStyle(speech).fontFamily:null,
      dialogueSize:parseFloat(getComputedStyle(text).fontSize),dialogueRect:rect(text),
      loaded:[...document.fonts].map(font=>({family:font.family,weight:font.weight,status:font.status}))},
    backgroundSameOrigin:new URL(image.currentSrc).origin===location.origin,
  };
}

try{
  if(typeof WebSocket==='undefined')throw new Error('Node 22+ is required for its built-in WebSocket.');
  server=spawn(process.env.GAMEPLAY_QA_PYTHON||process.env.DIALOGUE_QA_PYTHON||path.join(gameRoot,'runtime/python.exe'),['-B','-X','utf8',path.join(root,'tools/gameplay_ui_server.py')],{cwd:gameRoot,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});
  server.stderr.on('data',chunk=>{serverLog=(serverLog+chunk.toString()).slice(-8000);});
  const port=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Server startup timeout')),15000);
    server.stdout.on('data',chunk=>{const match=chunk.toString().match(/QA_PORT=(\d+)/);if(match){clearTimeout(timer);resolve(Number(match[1]));}});
    server.once('error',reject);server.once('exit',code=>reject(new Error('Server exited '+code)));
  });
  const base='http://127.0.0.1:'+port;
  browser=spawn(browserExecutable(),['--headless=new',...(process.argv.includes('--software-renderer')?['--disable-gpu']:[]),...(process.argv.includes('--no-sandbox')?['--no-sandbox']:[]),'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-extensions','--disable-breakpad','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Browser startup timeout')),20000);
    browser.stderr.on('data',chunk=>{browserLog=(browserLog+chunk.toString()).slice(-16000);const match=chunk.toString().match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    browser.once('error',reject);browser.once('exit',code=>reject(new Error('Browser exited '+code)));
  });
  // One direct page websocket keeps these checks on the same browser target
  // throughout resizing, with no flattened Target-session routing required.
  const targets=await fetch('http://'+new URL(endpoint).host+'/json/list').then(response=>response.json());
  const page=targets.find(target=>target.type==='page'&&target.webSocketDebuggerUrl);
  if(!page)throw new Error('No inspectable browser page');
  let sequence=0;const pending=new Map();
  socket=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
    if(message.method==='Network.requestWillBeSent'&&message.params.type==='Font')fontRequests.push(message.params.request.url);
    if(message.method==='Network.responseReceived'&&message.params.response.status>=400&&/\/(assets|api)\//.test(message.params.response.url))networkErrors.push({url:message.params.response.url,status:message.params.response.status});
    if(message.id&&pending.has(message.id)){const waiter=pending.get(message.id);pending.delete(message.id);clearTimeout(waiter.timer);message.error?waiter.reject(new Error(waiter.method+' '+JSON.stringify(message.error))):waiter.resolve(message.result);}
  });
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},20000);
    pending.set(id,{resolve,reject,timer,method});socket.send(JSON.stringify({id,method,params}));
  });
  const call=cdp;
  console.log('CDP connected:',await call('Browser.getVersion'));
  await call('Runtime.enable');await call('Page.enable');await call('Network.enable');
  const evaluate=async expression=>{
    const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
    return result.result.value;
  };
  const wait=async(expression,label=expression)=>{
    const end=Date.now()+12000;
    while(Date.now()<end){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,80));}
    throw new Error('Timeout '+label);
  };
  const settle=async()=>{
    await wait(`document.querySelector('#scene-loading')?.hidden&&document.querySelector('#save-status')?.textContent==='기록 보관됨'&&!document.querySelector('.train-map-bar').classList.contains('rolling')`,'game settles');
    await wait(`[...document.images].filter(image=>image.getAttribute('src')).every(image=>image.complete&&image.naturalWidth>0)`,'images load');
    await evaluate(`document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))))`);
  };
  const screenshot=async name=>{
    const result=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(result.data,'base64'));
    if(name.endsWith('-map-open')){
      // The promoted map panel once painted blank while its geometry and
      // invisible hit areas remained correct. Check actual screenshot pixels.
      const pixels=await evaluate(`(async()=>{const image=new Image();image.src='data:image/png;base64,${result.data}';await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);const r=document.querySelector('.train-map-sheet').getBoundingClientRect(),scale=image.naturalWidth/innerWidth;return [.15,.35,.65,.85].map(fraction=>Array.from(context.getImageData(Math.round((r.left+r.width*fraction)*scale),Math.round((r.top+r.height*.1)*scale),1,1).data));})()`);
      mapPaint.push({name,pixels});
      check(name+' paints the expanded map paper',pixels.filter(([red,green,blue])=>.2126*red+.7152*green+.0722*blue>50).length>=3,pixels);
    }
  };
  captureFailure=async()=>{await screenshot('failed');fs.writeFileSync(path.join(out,'failure-state.json'),JSON.stringify(await evaluate('('+collectMetrics.toString()+')()'),null,2));};
  const check=(label,condition,detail)=>{
    checks.push({label,pass:!!condition,...(!condition?{detail}:{})});
    if(!condition)throw new Error('Failed '+label+(detail?' '+JSON.stringify(detail):''));
  };
  const pointer=async selector=>{
    const point=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('Missing control');const r=el.getBoundingClientRect();for(const fy of [.5,.3,.7,.1,.9,.2,.8,.05,.95])for(const fx of [.5,.3,.7,.1,.9,.2,.8,.05,.95]){const x=r.left+r.width*fx,y=r.top+r.height*fy;if(el.contains(document.elementFromPoint(x,y)))return{x,y};}throw new Error('Covered control '+${JSON.stringify(selector)});})()`);
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
    await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  };
  const setViewport=async(width,height)=>{
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:width===390?2:1,mobile:false});
    await settle();
  };
  const mapState=async open=>{
    if(await evaluate(`document.querySelector('#map-toggle').getAttribute('aria-expanded')==='true'`)!==open)await pointer('#map-toggle');
    await settle();
  };
  const verify=async label=>{
    const m=await evaluate('('+collectMetrics.toString()+')()');metrics.push({label,...m});
    const [width,height]=m.viewport,d=m.document;
    check(label+' needs no document scroll',d.width<=width+1&&d.height<=height+1&&d.bodyWidth<=width+1&&d.bodyHeight<=height+1&&d.x===0&&d.y===0,d);
    check(label+' contains the complete scene',m.frame.left>=-1&&m.frame.top>=-1&&m.frame.right<=width+1&&m.frame.bottom<=height+1,m.frame);
    check(label+' preserves native scene proportions',Math.abs(m.native[0]/m.native[1]-m.aspect)<.001&&Math.abs(m.world.height-m.world.width/m.aspect)<1.1&&m.objectFit==='contain',m);
    check(label+' uses the largest contained scene',Math.abs(m.expectedWorldWidth-m.world.width)<2.1,{expected:m.expectedWorldWidth,actual:m.world.width,viewport:m.sceneViewport});
    check(label+' keeps registered art and hits aligned',m.registrations.every(r=>r.aligned&&r.clipped&&r.backgroundMatches&&r.nativeMatches),m.registrations);
    check(label+' maps actor pixels to the actor hit area',m.actorSamples.every(actor=>actor.samples>=10&&actor.missCount===0),m.actorSamples);
    check(label+' keeps HUD, map and composer controls reachable',m.controls.every(control=>control.inside&&control.reachable),m.controls.filter(control=>!control.inside||!control.reachable));
    check(label+' loads local UI fonts',m.fonts.ui.startsWith('RenaissanceText')&&m.fonts.loaded.some(font=>font.family==='RenaissanceText'&&font.status==='loaded'),m.fonts);
    if(m.conversation){
      check(label+' keeps dialogue at a readable size',m.fonts.dialogueSize>=14&&m.fonts.dialogueRect.height>=m.fonts.dialogueSize*1.4,m.fonts);
      check(label+' loads the local story font',m.fonts.speech?.startsWith('GounBatang'),m.fonts);
    }
    return m;
  };

  await call('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:base+'/qa/new?phase=scene_car_2'});
  await wait(`location.pathname==='/chat'&&document.readyState==='complete'&&!!window.TrainAudio`,'fixture navigates');
  await settle();
  const timeOrigin=await evaluate('performance.timeOrigin');
  for(const mode of ['exploration','conversation']){
    if(mode==='conversation'){
      await mapState(false);await pointer('[data-npc="explorer"]');await settle();
      await wait(`!document.querySelector('#dialogue-box').hidden&&document.querySelector('#speaker-name').textContent==='탐험가'`,'explorer responds');
    }
    let expectedRevision=null;
    for(const [width,height] of sizes){
      await setViewport(width,height);
      for(const open of [false,true]){
        await mapState(open);
        const label=mode+'-'+width+'x'+height+'-map-'+(open?'open':'closed');
        const m=await verify(label);
        expectedRevision??=m.revision;
        check(label+' resizes without reloading or changing the save',m.timeOrigin===timeOrigin&&m.revision===expectedRevision&&m.conversation===(mode==='conversation'));
        if([[1920,1080],[2560,1080],[390,844],[844,390]].some(([w,h])=>w===width&&h===height))await screenshot(label);
      }
    }
  }
  // Real pointer movement must present a passage even after the scene images
  // are cached. Trace the visible DOM; timing allows one 10 ms scheduling tick.
  const fixture=async phase=>{
    const previous=await evaluate('performance.timeOrigin');
    await call('Page.navigate',{url:base+'/qa/new?phase='+phase});
    await wait(`performance.timeOrigin!==${previous}&&document.readyState==='complete'&&!!window.TrainAudio`,'fixture reloads');await settle();
  };
  await setViewport(1440,900);await fixture('nav_base');await mapState(true);
  await evaluate(`(()=>{const loading=document.querySelector('#scene-loading');window.__qaMovement=[];window.__qaVisibleStart=null;new MutationObserver(()=>{const visible=!loading.hidden;if(visible&&window.__qaVisibleStart===null)window.__qaVisibleStart=performance.now();if(!visible&&window.__qaVisibleStart!==null){window.__qaMovement.push({duration:performance.now()-window.__qaVisibleStart});window.__qaVisibleStart=null;}}).observe(loading,{attributes:true,attributeFilter:['hidden']});})()`);
  for(const [index,target] of ['car_2','car_1','car_2'].entries()){
    await evaluate('window.__qaMovement=[]');await pointer('[data-location="'+target+'"]');
    await wait(`!document.querySelector('#scene-loading').hidden`,'passage opens');
    const moving=await evaluate(`(()=>{const loading=document.querySelector('#scene-loading');return {mode:loading.dataset.mode,label:loading.querySelector('.movement-label').textContent,destination:document.querySelector('#movement-destination').textContent,blocked:document.querySelector('.chat-area').inert,passage:getComputedStyle(loading.querySelector('.movement-passage')).display,generic:getComputedStyle(loading.querySelector('.loading-indicator')).display};})()`);
    check('movement '+index+' replaces generic loading and blocks scene controls',moving.mode==='movement'&&moving.label.includes('이동')&&moving.destination.length>0&&moving.blocked&&moving.passage!=='none'&&moving.generic==='none',moving);
    if(index===0)await screenshot('movement-passage');
    await settle();
    const observed=await evaluate(`({trace:window.__qaMovement,blocked:document.querySelector('.chat-area').inert,location:document.querySelector('#location-name').textContent})`);
    transitions.push({index,target,moving,...observed});
    check('movement '+index+' stays visible for one second',observed.trace.length===1&&observed.trace[0].duration>=990,observed);
    check('movement '+index+' restores scene controls',!observed.blocked,observed);
  }
  await evaluate('window.__qaMovement=[]');await pointer('[data-npc="explorer"]');await settle();
  check('same-room interaction does not open a passage',await evaluate('window.__qaMovement.length===0&&document.querySelector("#scene-loading").hidden'));

  // Use the actual inventory controls in both dark and already-lit scenes.
  const flashlight=async()=>{
    await pointer('#bag-btn');await settle();
    for(let page=0;page<4&&!await evaluate(`!!document.querySelector('.inventory-card[data-item-id="flashlight"]')`);page++)await pointer('.inventory-overview .inventory-pager button:last-child');
    await pointer('.inventory-card[data-item-id="flashlight"]');await settle();
  };
  await fixture('scene_car_2');await flashlight();
  check('flashlight use is absent outside carriage three',await evaluate(`!document.querySelector('.document-actions img[src$="use-flashlight.png"]')`));
  await fixture('base');await flashlight();
  check('flashlight use is absent in an already-lit carriage three',await evaluate(`!document.querySelector('.document-actions img[src$="use-flashlight.png"]')`));
  await fixture('dark');await flashlight();
  check('flashlight use is available in dark carriage three',await evaluate(`!!document.querySelector('.document-actions img[src$="use-flashlight.png"]')`));
  await screenshot('flashlight-dark-carriage');
  await pointer('.document-actions button:has(img[src$="use-flashlight.png"])');await settle();
  check('using flashlight closes inventory and reveals carriage three',await evaluate(`!document.querySelector('#overlay').open&&fetch('/api/game').then(response=>response.json()).then(data=>data.scene.light_mode==='flashlight')`));
  await flashlight();
  check('flashlight use disappears after the room is lit',await evaluate(`!document.querySelector('.document-actions img[src$="use-flashlight.png"]')`));
  check('every font request stays local',fontRequests.length>=3&&fontRequests.every(url=>new URL(url).origin===base),fontRequests);
  check('no failed game or asset response',networkErrors.length===0,networkErrors);
  check('no browser exceptions',errors.length===0,errors);
  console.log(JSON.stringify({passed:checks.length,layouts:metrics.length,artifacts:out},null,2));
}catch(error){
  errors.push(String(error.stack||error));console.error(error.stack||error);
  await captureFailure?.().catch(()=>{});process.exitCode=1;
}finally{
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({gameRoot,checks,errors,networkErrors,fontRequests,...(errors.length?{serverLog,browserLog}:{})},null,2));
  fs.writeFileSync(path.join(out,'viewport-metrics.json'),JSON.stringify(metrics,null,2));
  fs.writeFileSync(path.join(out,'movement-metrics.json'),JSON.stringify(transitions,null,2));
  fs.writeFileSync(path.join(out,'map-paint-metrics.json'),JSON.stringify(mapPaint,null,2));
  socket?.close();await stopChild(browser);await stopChild(server);
  if(fs.existsSync(profile)){
    const resolvedOut=fs.realpathSync(out),resolvedProfile=fs.realpathSync(profile);
    if(!resolvedProfile.startsWith(resolvedOut+path.sep)||!path.basename(resolvedProfile).startsWith('edge-'))throw new Error('Unexpected browser profile path');
    fs.rmSync(resolvedProfile,{recursive:true,force:true,maxRetries:8,retryDelay:150});
  }
}
