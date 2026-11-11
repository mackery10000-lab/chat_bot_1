"use strict";
const sceneLoading = document.getElementById('scene-loading');
function showSceneLoading(show) { if(window.TrainLoading)window.TrainLoading.show(show);else if(sceneLoading)sceneLoading.hidden=!show; }
window.addEventListener('pageshow',event=>{if(event.persisted)showSceneLoading(false);});
if(!document.querySelector('.chat-area')) {
  document.querySelectorAll('a[href]').forEach(a=>a.addEventListener('click',e=>{
    if(!e.ctrlKey&&!e.metaKey&&e.button===0&&new URL(a.href,location.href).pathname==='/chat') showSceneLoading(true);
  }));
  document.querySelector('.boarding-form')?.addEventListener('submit',()=>showSceneLoading(true));
}
(function(){
if(!document.querySelector('.chat-area')) return;
const $ = (id) => document.getElementById(id);
const shell = document.querySelector('.chat-area');
const overlay = $('overlay');
const cinematic = $('cinematic');
const cinematicVideo = $('cinematic-video');
let cinematicSession = 0, cinematicActive = false, cinematicLeaving = false;
let cinematicNeedsSound = false, cinematicLastTime = 0, cinematicRestoringTime = false;
let cinematicStallTimer = null;
let resumeCinematic = null;
const openingSeenKey = 'train.opening.seen';
let state = null, scene = null, busy = false, lastRequest = null, toastTimer = null;
let locationNoticeTimer = null, locationNoticeSequence = 0;
let activeHintChoice = null;
let sceneLayoutFrame = null;
let selectedDocument = null;
let inventoryPage = 0, catalogPage = 0;
const inventoryMobile = window.matchMedia('(max-width: 600px)');
let controlDraft = {destination: '', password: '0000'};
const documents = new Map();
const seenEvents = new Set();
const supportedActions = new Set(['look','move','select_npc','inspect','read_item','use_item','operate','read_report','ack_document','prepare_evidence','prepare_control','confirm','cancel','abandon','hint','end_talk','present','choose']);
let acquisitionQueue=[], acquisitionActive=false;
let acquisitionTimer=null;
const preparedImages=new Map();
const wallRepairRooms=new Set(['car_2','car_3']);
const wallRepairImage='/assets/images/scenes/passenger-wall-repaired.png';
function prepareImage(src) {
  if(preparedImages.has(src)) return preparedImages.get(src);
  const promise=new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{if(img.decode)img.decode().then(()=>resolve(img)).catch(()=>resolve(img));else resolve(img);};img.onerror=()=>reject(new Error('장면 이미지를 불러오지 못했습니다. 같은 요청으로 다시 시도해 주세요.'));img.src=src;});
  preparedImages.set(src,promise);promise.catch(()=>preparedImages.delete(src));return promise;
}
async function prepareScene(data,force=false) {
  window.TrainLoading?.setReady();
  const changed=force||!state||data.game.location.id!==state.location.id;
  const traveled=!!state&&data.game.location.id!==state.location.id;
  let movementReady=Promise.resolve();
  if(traveled){
    if(overlay.open)overlay.close();
    if(window.TrainLoading){window.TrainLoading.showMovement(data.game.location.name);movementReady=window.TrainLoading.waitForMovement();}
    else{showSceneLoading(true);movementReady=new Promise(resolve=>setTimeout(resolve,1000));}
  }else if(changed)showSceneLoading(true);
  const surfaces=!state?['dialogue-paper','chat-input','choice-paper','hint-paper','train-window-frame'].map(name=>prepareImage('/assets/images/ui/'+name+'.png')):[];
  const roomArt=wallRepairRooms.has(data.game.location.id)?[prepareImage(wallRepairImage)]:[];
  const artwork=Promise.all([...surfaces,...roomArt,prepareImage(data.scene.background),...data.scene.people.filter(p=>p.active||!data.game.npc).map(p=>prepareImage(!p.active&&p.registration?p.registration.image:p.image)),...(data.scene.hotspots||[]).filter(p=>p.image).map(p=>prepareImage(p.image)),...(data.ui?.document?.artwork?[prepareImage(data.ui.document.artwork)]:[])]);
  const [loaded]=await Promise.allSettled([artwork,movementReady]);
  if(loaded.status==='rejected')throw loaded.reason;

}
function acquisition(events) {
  for(const e of events) {const id=e.event_id||e.item.id;if(seenEvents.has(id))continue;seenEvents.add(id);acquisitionQueue.push(e.item);}
  showAcquisition();
}
function showAcquisition() {
  if(acquisitionActive||!acquisitionQueue.length)return;
  acquisitionActive=true;const item=acquisitionQueue.shift(),card=$('acquisition-notice');card.replaceChildren();
  window.TrainAudio?.playEffect('clue-coin');
  const art=node('div','acquired-icon');art.append(inventoryArt(item));
  const copy=node('div','acquired-copy');copy.append(node('small','','소지품 획득'),node('strong','',item.name),node('span','','보관함에 보관되었습니다.'));
  const close=button('×',dismissAcquisition,'acquired-close');close.setAttribute('aria-label','획득 알림 닫기');
  card.append(art,copy,close);card.hidden=false;card.classList.add('appearing');placeAcquisition();
  clearTimeout(acquisitionTimer);acquisitionTimer=setTimeout(dismissAcquisition,4500);
}
function placeAcquisition(){const card=$('acquisition-notice');if(overlay.open){card.classList.add('in-focus');$('overlay-header-anchor')?.remove();overlay.insertBefore(card,$('overlay-body'));}else{card.classList.remove('in-focus');document.body.append(card);}}
overlay.addEventListener('close',placeAcquisition);
function dismissAcquisition(){clearTimeout(acquisitionTimer);$('acquisition-notice').hidden=true;acquisitionActive=false;showAcquisition();}

const inventoryArtwork = {
  ticket_current:'ticket-current', newspaper:'newspaper', flashlight:'flashlight',
  facility_manual:'facility-manual', elder_testimony:'elder-testimony',
  ticket_old:'ticket-old', route_report:'route-report',
  faded_paper:'faded-paper', punched_receipt:'punched-receipt'
};
function inventoryArt(item, cls='inventory-item-art') {
  const img=node('img',cls);
  img.src='/assets/images/inventory/'+(inventoryArtwork[item.id]||'elder-testimony')+'.png';
  img.alt=item.name||item.title||'소지품';img.draggable=false;return img;
}
function node(tag, cls = '', text = '') { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; }
function button(text, handler, cls = '', server = false) { const b = node('button', cls, text); b.type = 'button'; if (server) { b.dataset.busyControl = '1'; b.disabled = busy; } b.addEventListener('click', handler); return b; }
function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3800); }
function setBusy(value) { busy = value; $('overlay-body').querySelector('.puzzle-host')?.puzzle?.setBusy(busy); $('send-btn').disabled = busy || !state?.npc || state?.status !== 'playing'; $('user-message').disabled = busy || !state?.npc || state?.status !== 'playing'; document.querySelectorAll('[data-busy-control]').forEach(b => { b.disabled = busy || b.dataset.locked === '1'; }); $('save-status').textContent = busy ? '응답을 기다리는 중' : '기록 보관됨'; }
function setError(text, canRetry = true) { $('error-text').textContent = text; $('error-banner').hidden = false; $('retry-btn').hidden = !canRetry; if (overlay.open) { let e = $('modal-error'); if (!e) { e = node('p','error-banner'); e.id='modal-error'; $('overlay-body').prepend(e); } e.textContent = text; } }
function clearError() { $('error-banner').hidden = true; $('modal-error')?.remove(); }
async function request(url, body = null) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 60000);
  try { const res = await fetch(url, {method: body === null ? 'GET' : 'POST', credentials:'same-origin', headers: body === null ? {} : {'Content-Type':'application/json'}, body:body === null ? undefined : JSON.stringify(body), signal:controller.signal});
    let data; try { data = await res.json(); } catch { throw new Error('응답을 읽지 못했습니다. 진행 기록을 다시 불러와 주세요.'); }
    if (!res.ok) { const e = new Error(data.error?.message || '요청을 처리하지 못했습니다.'); e.code=data.error?.code; e.status=res.status; throw e; } return data;
  } catch(e) { if (e.name === 'AbortError') throw new Error('응답 대기가 길어졌습니다. 같은 요청으로 다시 시도하거나 기록을 불러와 주세요.'); throw e; }
  finally { clearTimeout(timer); }
}
async function perform(content,reuse=false) {
  if(busy||!state||cinematic.open)return null;clearError();$('reply-status').textContent='';
  let focusComposer=false;
  const body=reuse?content:{...content,request_id:crypto.randomUUID?crypto.randomUUID():'turn_'+Date.now()+'_'+Math.random().toString(36).slice(2),revision:state.revision};
  // The server's actual location change starts the passage scene. This also
  // covers free-text movement, without flashing it for rejected travel requests.
  lastRequest=body;setBusy(true);
  try {
    const data=await request('/api/chat',body);await prepareScene(data);apply(data,false,body);lastRequest=null;
    if(body.action?.type==='present'&&overlay.open&&!data.ui?.inventory&&!data.ui?.document&&!data.game.confirmation)overlay.close();
    if(body.message){$('user-message').value='';$('user-message').style.height='auto';}
    focusComposer=!!data.ui?.compose&&state.status==='playing'&&!overlay.open;
    if(data.ui?.ignored)$('reply-status').textContent='장면에 반영되지 않은 입력입니다.';
    return data;
  } catch(e) {setError(e.message,e.code!=='stale_state');if(e.code==='stale_state'){lastRequest=null;try{const data=await request('/api/game');await prepareScene(data);apply(data);}catch{}}return null;}
  finally{showSceneLoading(false);setBusy(false);if(focusComposer)$('user-message').focus({preventScroll:true});}
}
const act=(type,extra={}) => perform({action:{type,...extra}});
function setDialogueVisible(visible) {
  const box=$('dialogue-box');box.hidden=!visible;
  shell.classList.toggle('dialogue-open',visible);shell.dataset.dialogue=visible?'open':'closed';
  document.querySelectorAll('.person-hotspot').forEach(person=>person.setAttribute('aria-expanded',String(visible&&person.dataset.npc===state?.npc)));
}
function updateDialogue(data, interaction, previous) {
  const action=interaction?.action?.type;
  const reply=typeof data.reply==='string'?data.reply.trim():'';
  const entry=state.history?.at(-1);
  // A saved conversation has no triggering action, but its last NPC reply still belongs on screen.
  const restoring=!interaction&&!!state.npc&&entry?.role==='npc'&&entry.npc===state.npc&&entry.text===data.reply;
  const traveled=previous&&previous.location.id!==state.location.id;
  const endedTalk=!state.npc&&reply.startsWith('대화를 마치고 주변으로 시선을 돌렸다.');
  const exploring=action==='look'||action==='end_talk'||action==='hint'||(action==='move'&&interaction.action.target===state.location.id);
  if((!interaction&&!restoring)||data.ui?.ignored||!reply||traveled||endedTalk||exploring||state.status!=='playing') {
    setDialogueVisible(false);return;
  }
  const speaker=entry?.role!=='user'&&entry?.text===data.reply?entry.speaker:'차내';
  $('speaker-name').textContent=speaker;
  // '차내' is narration (wrapped in parentheses); any other speaker is spoken dialogue.
  $('dialogue-box').classList.toggle('narration',speaker==='차내');
  $('dialogue-text').replaceChildren(...(speaker==='차내'?[reply]:dialogueParts(reply)));$('dialogue-text').scrollTop=0;
  if(state.npc==='elder')emphasizeTestimony($('dialogue-text'));
  setDialogueVisible(true);
}
function emphasizeTestimony(parent) {
  const walker=document.createTreeWalker(parent,NodeFilter.SHOW_TEXT),texts=[];
  while(walker.nextNode())texts.push(walker.currentNode);
  texts.forEach(text=>{
    const parts=text.textContent.split(/(바랜\s*종이|구멍)/g);
    if(parts.length>1)text.replaceWith(...parts.map((part,index)=>index%2?node('strong','testimony-clue',part):part));
  });
}
// A character line may mix narration with quoted speech: “…” is spoken, the rest is narration.
// Lines without quotes are spoken as a whole, and so are lines that only quote a word
// mid-sentence: a particle right after the closing mark (“산”이었는데) means it is not a separate line.
function dialogueParts(text) {
  if(!text.includes('“')||/”[가-힣]/.test(text))return [node('span','dialogue-speech',text)];
  return text.split(/(“[^”]*(?:”|$))/).filter(Boolean).map(part=>{
    if(part.startsWith('“'))return node('span','dialogue-speech',part);
    if(!part.trim())return part;
    const [,lead,body,trail]=part.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const aside=document.createDocumentFragment();
    aside.append(lead,node('span','dialogue-aside',body),trail);
    return aside;
  });
}
function renderGuidance(data, interaction) {
  const candidate=data.ui?.hint_choice;
  activeHintChoice=interaction?.action?.type==='hint'&&!data.ui?.ignored&&state.status==='playing'&&!state.confirmation&&candidate&&typeof candidate.label==='string'&&candidate.label.trim()&&candidate.action?.type==='choose'&&typeof candidate.action.target==='string'&&candidate.action.target.startsWith('hint.')?candidate:null;
  const hint=!!activeHintChoice;
  $('hint-title').textContent=hint?'지금 해야 할 일':'';
  $('hint-text').textContent=hint?activeHintChoice.label:'';
  $('hint-panel').hidden=!hint||!state.npc;
  $('hint-choice').dataset.locked=hint?'0':'1';
  $('hint-choice').dataset.choiceId=hint?activeHintChoice.id:'';
  $('hint-choice').disabled=busy||!hint;
  $('hint-btn').setAttribute('aria-expanded',String(hint));
  const choices=!state.npc||state.status!=='playing'||state.confirmation?[]:Array.isArray(data.ui?.choices)?data.ui.choices:Array.isArray(state.choices)?state.choices:[];
  const list=$('choice-list');list.replaceChildren();
  choices.forEach(choice=>{
    if(!choice||typeof choice!=='object'||list.childElementCount>=2)return;
    const label=typeof choice.label==='string'?choice.label.trim():typeof choice.text==='string'?choice.text.trim():'';
    const action=choice.action&&typeof choice.action==='object'&&supportedActions.has(choice.action.type)?choice.action:null;
    const message=typeof choice.message==='string'?choice.message.trim():'';
    if(!label||(!action&&(!message||message.length>2000)))return;
    const b=button('',()=>action?perform({action:{...action}}):sendText(message),'choice-button',true);
    b.append(node('span','choice-label',label));
    if(typeof choice.id==='string')b.dataset.choiceId=choice.id;
    if(choice.kind==='interaction')b.dataset.choiceKind=choice.kind;
    if(choice.disabled||state.status!=='playing'){b.disabled=true;b.dataset.locked='1';}
    list.append(b);
  });
  list.hidden=hint||!list.childElementCount;
  $('hints-and-choices').hidden=!list.childElementCount&&!hint;
  $('hints-and-choices').dataset.mode=hint?'hint':list.childElementCount?'choices':'empty';
}
function updateLocationNotice(previous) {
  $('location-name').textContent=state.location.name;
  if(previous?.location.id===state.location.id)return;
  const notice=$('location-notice'),sequence=++locationNoticeSequence;
  clearTimeout(locationNoticeTimer);notice.hidden=false;
  locationNoticeTimer=setTimeout(()=>{
    if(sequence!==locationNoticeSequence)return;
    notice.hidden=true;locationNoticeTimer=null;
  },5000);
}
function fitDialogueFont() {
  // Reflow live text at a readable size instead of scaling a rasterized UI.
  const paper=Math.min(document.querySelector('.scene-frame').clientWidth-20,1020);
  const size=Math.round(Math.min(20,Math.max(14,7+paper*.013))*2)/2;
  shell.style.setProperty('--dialogue-font',size+'px');
}
function fitScene() {
  if(sceneLayoutFrame!==null)return;
  sceneLayoutFrame=requestAnimationFrame(()=>{
    sceneLayoutFrame=null;
    const frame=document.querySelector('.scene-frame');
    const viewport=document.querySelector('.scene-viewport');
    if(!viewport)return;
    const px=value=>parseFloat(value)||0;
    const border=getComputedStyle(frame);
    const borderHeight=px(border.borderTopWidth)+px(border.borderBottomWidth);
    const borderWidth=px(border.borderLeftWidth)+px(border.borderRightWidth);
    const ratio=String(scene?.aspect_ratio||'3 / 2').split('/').map(Number);
    const aspect=ratio.length===2&&ratio.every(n=>Number.isFinite(n)&&n>0)?ratio[0]/ratio[1]:1.5;
    // The viewport reserves the real map/composer space through CSS grid. Fit
    // width AND height, keeping actors, background and hit areas on one canvas.
    const width=Math.max(0,Math.min(viewport.clientWidth-borderWidth,(viewport.clientHeight-borderHeight)*aspect));
    const pixels=window.devicePixelRatio||1;
    shell.style.setProperty('--scene-width',(Math.floor(width*pixels)/pixels+borderWidth)+'px');
    fitDialogueFont();
  });
}
function apply(data, force = false, interaction = null) {
  if(!data?.game || !data?.scene) throw new Error('진행 상태 응답이 올바르지 않습니다.');
  if(!force && state && data.game.revision < state.revision) return;
  const previous=state;
  state=data.game; scene=data.scene;
  shell.classList.toggle('conversation-active',!!state.npc&&state.status==='playing');
  document.querySelector('.conversation-console').hidden=!state.npc||state.status!=='playing';
  if(overlay.open&&overlay.dataset.view==='hint'&&interaction?.action?.type!=='hint')overlay.close();
  noteOpenedLocations(previous);
  updateLocationNotice(previous);
  $('scene-world').style.aspectRatio=scene.aspect_ratio||'3 / 2';
  const bg=$('scene-image');if(bg.getAttribute('src')!==scene.background)bg.src=scene.background;
  bg.alt=state.location.name+'의 현재 장면';
  // Keep the notice unreadable in the room, including before hover and while
  // another character is speaking. Only the inspection reveals its writing.
  let obscurer=$('scene-notice-obscurer');
  if(state.location.id==='car_1'){
    if(!obscurer){obscurer=noticeObscurer();obscurer.id='scene-notice-obscurer';bg.after(obscurer);}
    if(obscurer.getAttribute('src')!==scene.background)obscurer.src=scene.background;
  }else obscurer?.remove();
  // Only the unused plaque area changes in cars 2 and 3. Keep the original
  // scene canvas and registrations so every actor and door stays aligned.
  let repair=$('scene-wall-repair');
  if(wallRepairRooms.has(state.location.id)){
    if(!repair){repair=node('div','scene-wall-repair');repair.id='scene-wall-repair';repair.setAttribute('aria-hidden','true');bg.after(repair);}
  }else repair?.remove();
  $('darkness').hidden=scene.light_mode==='normal';$('darkness').classList.toggle('flashlight-mask',scene.light_mode==='flashlight');if(state.npc){$('darkness').style.setProperty('--beam-x','50%');$('darkness').style.setProperty('--beam-y','48%');}
  $('scene-world').dataset.mode=state.npc?'conversation':'exploration';
  $('scene-caption').textContent=scene.dark?'불이 꺼져 아무것도 보이지 않는다.':state.status!=='playing'?'끝나지 않던 밤의 기록.':'';
  const layer=$('character-layer');layer.replaceChildren();
  const people=state.npc?scene.people.filter(p=>p.active):scene.people;
  people.forEach(p=>{
    if(!p.active&&p.registration){registeredHotspot(layer,p,()=>{if(!busy)window.TrainAudio?.playEffect('person-select');act('select_npc',{target:p.id});},true);return;}
    const b=button('',()=>act('select_npc',{target:p.id}),'person-hotspot'+(p.active?' talking':''),true);b.dataset.npc=p.id;
    b.setAttribute('aria-label',p.name+'에게 말 걸기');b.setAttribute('aria-controls','dialogue-box');b.title=p.name+' · 대화 시작';
    const bounds=p.active?[31,3,38,97]:p.bounds;place(b,bounds);
    const img=node('img','character-sprite');img.src=p.image;img.alt=p.name;img.draggable=false;
    const label=node('span','hotspot-label',p.name+' · 대화');b.append(img,label);layer.append(b);
  });
  $('conversation-badge').hidden=!state.npc;$('active-person').textContent=state.npc?(scene.people.find(p=>p.id===state.npc)?.name||'인물')+'와 대화 중':'';
  $('interaction-guide').textContent=state.npc?'채팅으로 대화하세요. 대화를 마치려면 위의 ‘대화 마치기’를 누르세요.':'빛나는 지점에서 물건을 조사하거나 인물을 눌러 대화를 시작하세요.';
  updateDialogue(data,interaction,previous);renderGuidance(data,interaction);
  $('current-target').textContent=state.npc? (scene.people.find(p=>p.id===state.npc)?.name || '상대')+'에게 말하거나 주변에 행동하기':'현재 장면에 행동하기';
  $('item-count').textContent=state.inventory.length; $('bag-btn').classList.toggle('bag-pulse',!!state.bag_hint);
  renderLinearMap();renderSceneActions();
  acquisition((data.events||[]).filter(e=>e.type==='item_acquired'));
  if(state.status!=='playing') openEnding();
  else if(state.confirmation) openConfirmation();
  else if(data.ui?.document) { selectedDocument=data.ui.document;documents.set(selectedDocument.id,selectedDocument);openInventory(selectedDocument); }
  else if(data.ui?.notice) openNotice();
  else if(data.ui?.window_video) openWindowVideo();
  else if(data.ui?.inventory) openInventory();
  else if(data.ui?.control) openControl();
  else if(data.ui?.lever) openLever();
  else if(activeHintChoice&&!state.npc) openHint();
  else if(overlay.open && overlay.dataset.view==='lever') openLever();
  revealOpenedLocations();
  setBusy(busy);
  fitScene();
}
function place(el,bounds){const [x,y,w,h]=bounds;Object.assign(el.style,{left:x+'%',top:y+'%',width:w+'%',height:h+'%'});}
function noticeObscurer(){
  const img=node('img','notice-obscurer');img.src=scene.background;img.alt='';img.draggable=false;img.setAttribute('aria-hidden','true');return img;
}
function registeredHotspot(layer,p,handler,person=false){
  // Art and background use the same full canvas, with a shared origin and
  // scale. The silhouette clips only the hit area; it never clips the glow.
  const art=p.registration;
  if(art.background!==scene.background)return;
  const sprite=art.render_mode==='sprite';
  const group=node('div','registered-hotspot'+(sprite?' registered-character':'')+(art.grounded?' grounded-character':'')+(p.id==='notice'?' notice-hotspot':''));
  const b=button('',handler,(person?'person-hotspot':'world-hotspot')+' registered-hit',true);
  b.style.clipPath='polygon('+art.polygon.map(([x,y])=>x+'% '+y+'%').join(',')+')';
  if(person&&art.hit_path){
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),defs=document.createElementNS(ns,'defs'),clip=document.createElementNS(ns,'clipPath'),path=document.createElementNS(ns,'path');
    svg.setAttribute('width','0');svg.setAttribute('height','0');svg.setAttribute('aria-hidden','true');svg.style.position='absolute';
    clip.id='actor-hit-'+p.id;clip.setAttribute('clipPathUnits','objectBoundingBox');path.setAttribute('d',art.hit_path);
    clip.append(path);defs.append(clip);svg.append(defs);group.append(svg);b.style.clipPath='url("#'+clip.id+'")';
  }
  const label=person?p.name+' · 대화':p.label;
  b.setAttribute('aria-label',person?p.name+'에게 말 걸기':label);
  if(person){b.dataset.npc=p.id;b.setAttribute('aria-controls','dialogue-box');b.setAttribute('aria-expanded','false');}
  else b.dataset.hotspot=p.id;
  // Mask the original texture after sampling it at the background's scale.
  // Resampling a transparent cutout directly can darken its boundary pixels.
  const img=node('img','registered-art');img.src=sprite?art.image:art.background;img.alt='';img.draggable=false;
  if(!sprite)img.style.maskImage='url("'+art.image+'")';
  img.setAttribute('aria-hidden','true');
  const visual=node('div','registered-visual');visual.append(img);
  if(p.id==='notice')visual.append(noticeObscurer());
  const caption=node('span','hotspot-label registered-label',label);
  const [x,y,w]=art.bounds;
  caption.style.left=Math.max(12,Math.min(88,x+w/2))+'%';caption.style.top=Math.max(11,y-4)+'%';
  group.append(b,visual,caption);layer.append(group);
}
function navigationHotspot(layer,p,handler) {
  if(p.background!==scene.background||!Array.isArray(p.polygon))return;
  const polygon=p.polygon.map(([x,y])=>x+'% '+y+'%').join(',');
  const group=node('div','registered-hotspot navigation-hotspot');
  const hit=button('',handler,'world-hotspot registered-hit navigation-door',true);
  hit.dataset.hotspot=p.id;hit.dataset.navigationTarget=p.target;
  hit.setAttribute('aria-label',p.label);hit.style.clipPath='polygon('+polygon+')';
  // Sample the same full-size scene so the door keeps its original texture,
  // perspective and position. Only its exact silhouette receives the glow.
  const art=node('img','registered-art navigation-art');
  art.src=p.background;art.alt='';art.draggable=false;art.setAttribute('aria-hidden','true');
  art.style.clipPath='polygon('+polygon+')';
  const outline=document.createElementNS('http://www.w3.org/2000/svg','svg');
  outline.classList.add('navigation-outline');outline.setAttribute('viewBox','0 0 100 100');
  outline.setAttribute('preserveAspectRatio','none');outline.setAttribute('aria-hidden','true');
  const edge=document.createElementNS('http://www.w3.org/2000/svg','polygon');
  edge.setAttribute('points',p.polygon.map(point=>point.join(',')).join(' '));
  edge.setAttribute('vector-effect','non-scaling-stroke');outline.append(edge);
  const visual=node('div','registered-visual');visual.append(art,outline);
  const caption=node('span','hotspot-label registered-label',p.label),[x,y,w]=p.bounds;
  caption.style.left=Math.max(12,Math.min(88,x+w/2))+'%';caption.style.top=Math.max(11,y-4)+'%';
  group.append(hit,visual,caption);layer.append(group);
}
function mapClosed(){return $('train-map-panel').classList.contains('is-closed');}
function updateMapToggle(){
  const closed=mapClosed(),here=state?.map?.find(p=>p.current)?.name,toggle=$('map-toggle');
  toggle.setAttribute('aria-expanded',String(!closed));
  toggle.setAttribute('aria-label',closed?'열차 안내도 펼치기'+(here?' · '+here:''):'열차 안내도 접기');
  toggle.replaceChildren(node('span','map-toggle-label',closed?'열차 안내도 펼치기':'열차 안내도 접기'));
  if(closed&&here)toggle.append(node('span','map-toggle-place','· '+here));
}
function applyMapClosed(closed){
  const panel=$('train-map-panel');
  panel.classList.toggle('is-closed',closed);panel.inert=closed;panel.setAttribute('aria-hidden',String(closed));updateMapToggle();
}
let mapRollSequence=0,mapMotion=null;
const mapReducedMotion=matchMedia('(prefers-reduced-motion:reduce)');
function settleMapRoll(){
  if(!mapMotion)return;
  const motion=mapMotion;mapMotion=null;mapRollSequence++;
  motion.animations.forEach(animation=>animation.cancel());
  document.querySelector('.train-map-bar').classList.remove('rolling');
  delete document.querySelector('.train-map-bar').dataset.rollDirection;
  $('train-map-panel').inert=mapClosed();
  motion.resolve(false);
}
function rollMap(closed){
  // Feed the unwarped paper behind the roller. Sampling before cancellation
  // allows rapid reversals to continue from the exact visible paper length.
  const bar=document.querySelector('.train-map-bar'),panel=$('train-map-panel'),sheet=panel.querySelector('.train-map-sheet'),curl=bar.querySelector('.map-roll-edge');
  const from=panel.getBoundingClientRect().height;
  settleMapRoll();
  applyMapClosed(closed);
  const full=sheet.getBoundingClientRect().height,to=closed?0:full;
  const still=document.documentElement.classList.contains('reduced-motion')||mapReducedMotion.matches;
  if(still||full<1||Math.abs(from-to)<1)return Promise.resolve(true);
  const sequence=++mapRollSequence;
  const duration=Math.max(180,Math.round(720*Math.abs(from-to)/full));
  const timing={duration,easing:'cubic-bezier(.4,.04,.24,1)'};
  bar.classList.add('rolling');bar.dataset.rollDirection=closed?'closing':'opening';
  panel.inert=true;
  const animations=[
    panel.animate({height:[from+'px',to+'px']},timing),
    sheet.animate({transform:['translateY('+(from-full)+'px)','translateY('+(to-full)+'px)']},timing),
    curl.animate([
      {opacity:0,transform:'scaleY(.3)',backgroundPosition:'center,center '+(closed?'-90px':'0px')},
      {opacity:1,transform:'scaleY(1)',offset:.14},
      {opacity:1,transform:'scaleY(.82)',offset:.85},
      {opacity:0,transform:'scaleY(.2)',backgroundPosition:'center,center '+(closed?'0px':'-90px')}
    ],timing)
  ];
  let resolveMotion;
  const completion=new Promise(resolve=>{resolveMotion=resolve;});
  mapMotion={animations,resolve:resolveMotion,promise:completion};
  Promise.all(animations.map(animation=>animation.finished)).then(()=>{
    if(sequence!==mapRollSequence)return;
    mapMotion=null;bar.classList.remove('rolling');delete bar.dataset.rollDirection;
    panel.inert=mapClosed();
    animations.forEach(animation=>animation.cancel());resolveMotion(true);
  }).catch(()=>{});
  return completion;
}
// Scrollbar disappearance also fires visualViewport.resize in Chromium. Its
// width-only change must not interrupt a fold; real resize, keyboard-height
// and zoom changes settle to the sheet's new natural dimensions.
const mapViewport=()=>({width:window.innerWidth,height:window.innerHeight,visualHeight:window.visualViewport?.height||window.innerHeight,scale:window.visualViewport?.scale||1});
let mapViewportSize=mapViewport();
function mapViewportChanged(){
  const next=mapViewport(),previous=mapViewportSize;mapViewportSize=next;
  if(next.width!==previous.width||next.height!==previous.height||Math.abs(next.visualHeight-previous.visualHeight)>.5||Math.abs(next.scale-previous.scale)>.001)settleMapRoll();
}
window.addEventListener('resize',mapViewportChanged);
window.visualViewport?.addEventListener('resize',mapViewportChanged);
mapReducedMotion.addEventListener('change',event=>{if(event.matches)settleMapRoll();});
new MutationObserver(()=>{if(document.documentElement.classList.contains('reduced-motion'))settleMapRoll();}).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
function toggleMapByPlayer(){
  const closed=!mapClosed();
  rollMap(closed).then(finished=>{if(finished&&!closed)revealOpenedLocations();});
  try{localStorage.setItem('train_map_closed',String(closed));}catch{}
}
// Carriages that became reachable wait here until the player can actually see the map.
const pendingOpened=new Set();
const MAP_SPARKLE_MS=4000;
let mapSparkle=null;
let mapRevealPending=false;
function noteOpenedLocations(previous){
  if(!previous?.map)return;
  const wasOpen=new Set(previous.map.filter(p=>p.open).map(p=>p.id));
  state.map.filter(p=>p.open&&!wasOpen.has(p.id)).forEach(p=>pendingOpened.add(p.id));
}
function revealOpenedLocations(){
  if(mapRevealPending||!pendingOpened.size||state?.status!=='playing'||state.npc||overlay.open||cinematic.open)return;
  // Unlock feedback starts only after the complete sheet is visible. Automatic
  // reveals never overwrite the player's saved open/closed preference.
  mapRevealPending=true;
  const complete=mapClosed()?rollMap(false):(mapMotion?.promise||Promise.resolve(true));
  complete.then(finished=>{
    mapRevealPending=false;
    if(!finished){
      if(!mapClosed())revealOpenedLocations();
      return;
    }
    if(mapClosed()||state?.status!=='playing'||state.npc||overlay.open||cinematic.open)return;
    mapSparkle={ids:new Set(pendingOpened),start:performance.now()};pendingOpened.clear();renderLinearMap();
  });
}
function renderLinearMap(){
  updateMapToggle();
  const box=$('train-map');box.replaceChildren();
  const canvas=node('div','train-map-canvas'),art=node('img','train-map-art');
  art.src='/assets/images/ui/train-route-six-cars.png';art.alt='';art.draggable=false;art.setAttribute('aria-hidden','true');canvas.append(art);
  const sections={car_1:[1.93,16.95],car_2:[18.88,15.79],car_3:[34.67,15.47],car_4:[50.14,15.61],crew:[65.75,15.19],engine:[80.94,17.31]};
  const order=['car_1','car_2','car_3','car_4','crew','engine'];
  const stops=[...state.map].sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id));
  stops.forEach((p,index)=>{
    const status=p.current?'현재 위치':!p.open?'잠김':p.visited?'다녀온 곳':'이동 가능';
    const b=button('',async()=>{if(overlay.open)overlay.close();await act('move',{target:p.id});},'linear-stop train-carriage'+(p.current?' current':p.visited?' visited':'')+(!p.open?' locked':''),true);
    const label=p.name;
    const description=p.id==='crew'?'승무원실 · 4호차와 기관실 사이':p.id==='engine'?'기관실 · 승무원실을 통해 연결':p.name;
    b.dataset.location=p.id;b.setAttribute('aria-current',p.current?'location':'false');b.setAttribute('aria-label',p.open||p.current?description+' · '+status:'아직 열리지 않은 칸');
    const [left,width]=sections[p.id]||[index*100/state.map.length,100/state.map.length];
    b.style.left=left+'%';b.style.width=width+'%';
    const sparkleAt=mapSparkle?.ids.has(p.id)&&p.open&&!p.current?performance.now()-mapSparkle.start:Infinity;
    if(sparkleAt<MAP_SPARKLE_MS){
      // A negative delay keeps the sparkle in step when the map is redrawn mid-way.
      b.classList.add('just-opened');b.style.setProperty('--sparkle-delay',-sparkleAt+'ms');
    }
    if(!p.open&&!p.current){
      // The original unlit artwork shares the same full-size train canvas.
      const dark=node('img','train-map-lights-off');
      dark.src='/assets/images/ui/train-route-lights-off.webp';dark.alt='';dark.draggable=false;dark.setAttribute('aria-hidden','true');
      dark.style.clipPath='inset(0 '+(100-left-width)+'% 0 '+left+'%)';
      canvas.append(dark);
    }
    b.append(node('span','stop-name',label));
    if(!p.open||p.current||state.status!=='playing'){b.disabled=true;b.dataset.locked='1';}canvas.append(b);
  });
  box.append(canvas);
}
function renderSceneActions(){
 const layer=$('scene-hotspots');layer.replaceChildren();
 if(state.status!=='playing')return;
 (scene.hotspots||[]).forEach(p=>{const interact=()=>{
   if(p.kind==='focus'){if(p.target==='door')openLever();else if(p.target==='control'){if(state.controls.control)openControl();else if(state.controls.proof)openInventory();else toast('먼저 기관사에게 장치에 관해 물어보세요.');}}
   else act(p.kind,{target:p.target});
 };
 if(p.kind==='move'&&p.polygon){navigationHotspot(layer,p,interact);return;}
 if(p.registration){registeredHotspot(layer,p,interact);return;}
 const b=button('',interact,'world-hotspot '+(p.image?'art-hotspot ':'')+(p.appearance||''),true);b.dataset.hotspot=p.id;b.setAttribute('aria-label',p.label);b.title=p.label;place(b,p.bounds);
 if(p.image){const img=node('img','hotspot-art');img.src=p.image;img.alt='';img.draggable=false;b.append(img,node('span','hotspot-label',p.label));layer.append(b);return;}
 const outline=document.createElementNS('http://www.w3.org/2000/svg','svg');outline.setAttribute('viewBox','0 0 100 100');outline.setAttribute('preserveAspectRatio','none');outline.setAttribute('aria-hidden','true');const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');for(const [k,v] of Object.entries({x:2,y:2,width:96,height:96,rx:4}))rect.setAttribute(k,String(v));outline.append(rect);
 b.append(outline,node('span','hotspot-dot',''),node('span','hotspot-label',p.label));
 if(p.appearance==='paper')b.append(node('span','notice-mark','안내문'));layer.append(b);
 });
}
function stopOverlayMedia(){
  $('overlay-body').querySelectorAll('video').forEach(video=>{video.pause();video.removeAttribute('src');video.querySelectorAll('source').forEach(source=>source.removeAttribute('src'));video.load();});
}
function openNotice(){
  if(state?.location.id!=='car_1')return;
  const body=openOverlay('기관실 안내문','notice');
  const page=node('figure','notice-art-view'),img=node('img');
  img.src='/assets/images/car1/notice.png';img.alt='Warning: 열차의 정차는 기관실에서만 가능';
  page.append(img);body.append(page);
}
function openWindowVideo(){
  if(state?.location.id!=='car_1')return;
  const body=openOverlay('차창 밖','window');
  const frame=node('div','window-video-view'),aperture=node('div','window-aperture');
  const video=node('video'),status=node('p','window-video-status'),art=node('img','window-frame-art');
  const glass=node('div','window-glass');glass.setAttribute('aria-hidden','true');
  art.src='/assets/images/ui/train-window-frame.png';art.alt='';art.draggable=false;art.setAttribute('aria-hidden','true');
  video.controls=false;video.disablePictureInPicture=true;video.disableRemotePlayback=true;video.loop=true;video.autoplay=true;video.muted=true;video.playsInline=true;video.preload='auto';video.tabIndex=0;
  video.setAttribute('aria-label','반복되는 열차 밖의 밤 풍경');video.setAttribute('playsinline','');
  for(const [ext,type] of [['webm','video/webm'],['mp4','video/mp4']]){const source=node('source');source.src='/assets/videos/car1-window-loop.'+ext;source.type=type;video.append(source);}
  status.setAttribute('role','status');status.hidden=true;
  const showStatus=text=>{if(!video.isConnected)return;status.textContent=text;status.hidden=!text;};
  video.addEventListener('error',()=>{if(video.querySelector('source[src]'))showStatus('영상을 재생하지 못했습니다. 창을 닫고 다시 열어 주세요.');});
  video.addEventListener('playing',()=>showStatus(''));
  video.addEventListener('click',()=>video.play().then(()=>showStatus('')).catch(()=>{}));
  video.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();video.play().then(()=>showStatus('')).catch(()=>{});}});
  aperture.append(video,glass,status);frame.append(aperture,art);body.append(frame);
  video.play().catch(()=>{
    if(!video.isConnected)return;
    showStatus('창문을 눌러 창밖을 살펴보세요.');
  });
}
function openOverlay(title, view) {
  stopOverlayMedia();overlay.dataset.view=view;
  overlay.classList.toggle('paper-dialog',!['inventory','control','ending-complete','window','notice'].includes(view));
  overlay.classList.toggle('device-dialog',view==='control');
  overlay.classList.toggle('ending-dialog',view==='ending-complete');
  overlay.classList.toggle('window-dialog',view==='window');
  overlay.classList.toggle('notice-dialog',view==='notice');
  overlay.querySelector('.ending-card-art')?.remove();overlay.querySelector('.ending-result')?.remove();
  $('overlay-title').textContent=title;$('overlay-body').replaceChildren();
  if(!overlay.open)overlay.showModal();
  placeAcquisition();return $('overlay-body');
}
function pendingReport(){return overlay.open&&overlay.dataset.view==='inventory'&&selectedDocument?.id==='route_report'&&state?.inventory.some(item=>item.id==='route_report'&&!item.read);}
async function confirmReport(close=false){const data=await act('ack_document',{target:'route_report'});if(data&&close)overlay.close();return data;}
function closeOverlay() { if(overlay.dataset.view==='ending-complete'||busy && (overlay.dataset.view==='confirm'||pendingReport())) return; if(pendingReport()){confirmReport(true);return;} if(overlay.dataset.view==='confirm' && state?.confirmation) { act('cancel').then(data=>{if(data) overlay.close();}); } else {stopOverlayMedia();overlay.close();} }
function paperAction(label, handler, art, cls = '', server = true) {
  const b=button('',handler,'paper-action '+cls,server);
  b.setAttribute('aria-label',label);
  const image=node('img');image.src='/assets/images/inventory/actions/'+art+'.png';image.alt=label;image.draggable=false;
  b.append(image);return b;
}
function inventoryPager(parent,index,count,onPage) {
  if(count<2)return;
  const nav=node('nav','inventory-pager');nav.setAttribute('aria-label','소지품 페이지');
  const previous=paperAction('이전 페이지',()=>onPage(index-1),'previous');
  const next=paperAction('다음 페이지',()=>onPage(index+1),'next');
  for(const [b,locked] of [[previous,index===0],[next,index===count-1]])if(locked){b.disabled=true;b.dataset.locked='1';}
  nav.append(previous,node('span','inventory-page-number',String(index+1)+' / '+String(count)),next);parent.append(nav);
}
function openInventory(doc = null, keepCatalogPage = false) {
  if(!state) return;
  const selected=doc && state.inventory.some(i=>i.id===doc.id)?doc:null;
  selectedDocument=selected;
  const body=openOverlay('보관함','inventory');
  overlay.dataset.inventoryMode=selected?'detail':'overview';
  if(!selected){
    shownDocument=null;
    const book=node('section','inventory-overview');book.setAttribute('aria-label','낡은 수집품 기록장');
    book.append(node('h3','visually-hidden','INVENTORY · 소지품'));
    const grid=node('div','inventory-grid');grid.setAttribute('aria-label','소지품 목록');
    const capacity=inventoryMobile.matches?6:8,count=Math.max(1,Math.ceil(state.inventory.length/capacity));
    inventoryPage=Math.max(0,Math.min(inventoryPage,count-1));
    state.inventory.slice(inventoryPage*capacity,(inventoryPage+1)*capacity).forEach(item=>{
      const card=button('',()=>openItem(item.id),'inventory-card',true);card.dataset.itemId=item.id;
      const mount=node('span','inventory-photo-mount');mount.append(inventoryArt(item));
      const frame=node('img','inventory-mount-art');frame.src='/assets/images/inventory/photo-mount.png';frame.alt='';frame.draggable=false;mount.append(frame);
      card.append(mount,node('strong','',item.name));grid.append(card);
    });
    if(!state.inventory.length)grid.append(node('p','inventory-empty','아직 모은 물건이 없습니다.'));
    book.append(grid);inventoryPager(book,inventoryPage,count,index=>{inventoryPage=index;openInventory();});body.append(book);return;
  }
  const book=node('div','inventory-detail'),catalog=node('aside','inventory-catalog');
  const back=paperAction('소지품 펼쳐 보기',async()=>{
    if(pendingReport()&&!(await confirmReport()))return;
    openInventory();
  },'inventory-back','inventory-back');
  const list=node('nav','item-list');list.setAttribute('aria-label','소지품 목록');
  const capacity=inventoryMobile.matches?3:5,count=Math.max(1,Math.ceil(state.inventory.length/capacity));
  if(!keepCatalogPage)catalogPage=Math.floor(state.inventory.findIndex(item=>item.id===selected.id)/capacity);
  catalogPage=Math.max(0,Math.min(catalogPage,count-1));
  state.inventory.slice(catalogPage*capacity,(catalogPage+1)*capacity).forEach(item=>{
    const row=button('',()=>openItem(item.id),'item-row'+(selected.id===item.id?' selected':''),true);
    row.dataset.itemId=item.id;row.setAttribute('aria-current',selected.id===item.id?'true':'false');
    const mount=node('span','inventory-list-mount');mount.append(inventoryArt(item));
    row.append(mount,node('span','',item.name));list.append(row);
  });
  catalog.append(back,list);
  inventoryPager(catalog,catalogPage,count,index=>{catalogPage=index;openInventory(selected,true);});
  const spread=node('div','inventory-spread'),object=node('figure','inventory-object'),page=node('article','book-page');
  const item=state.inventory.find(i=>i.id===selected.id);
  object.append(inventoryArt(item,'inventory-object-art'),node('figcaption','visually-hidden',item.name));
  renderDocument(page,selected);spread.append(object,page);book.append(catalog,spread);body.append(book);
}
inventoryMobile.addEventListener('change',()=>{if(overlay.open&&overlay.dataset.view==='inventory')openInventory(selectedDocument);});
async function openItem(id) {
  if(busy) return;
  if(pendingReport()&&id!=='route_report'&&!(await confirmReport()))return;
  if(state.status!=='playing') { try { const data=await request('/api/item/'+encodeURIComponent(id));openInventory(data.document); }catch(e){setError(e.message,false);} return; }
  await act('read_item',{target:id});
}
// Paper documents rustle once when they come into view, not on every re-render of the same page.
const pagedDocuments=new Set(['route_report','newspaper','facility_manual']);
let shownDocument=null;
['page-turn','person-select','lever','door-clunk','clue-coin'].forEach(name=>window.TrainAudio?.preloadEffect(name));
overlay.addEventListener('close',()=>{shownDocument=null;});
function renderDocument(page,doc) {
  if(pagedDocuments.has(doc.id)&&shownDocument!==doc.id)window.TrainAudio?.playEffect('page-turn');
  shownDocument=doc.id;
  const record=node('img','inventory-record-image');
  record.src=doc.artwork||'/assets/images/inventory/records/'+doc.id.replaceAll('_','-')+'.png';
  record.alt=[doc.title,...(doc.paragraphs||[]),...(doc.fields||[]).map(([key,value])=>key+': '+value)].join('\n');
  record.draggable=false;page.append(record);
  const actions=node('div','document-actions');
  if(state.status==='playing') {
    if(doc.id==='route_report'&&!state.inventory.find(item=>item.id==='route_report')?.read)actions.append(paperAction('보고서 내용 확인',()=>confirmReport(true),'confirm-report'));
    if(doc.id==='flashlight' && state.location.id==='car_3' && scene?.light_mode==='dark')actions.append(paperAction('손전등 사용',async()=>{if(await act('use_item',{target:doc.id}))overlay.close();},'use-flashlight'));
    if(doc.id==='ticket_old' && state.location.id==='car_3') {
      const returned=state.inventory.find(i=>i.id==='ticket_old')?.name.includes('조사 기록');
      actions.append(paperAction(returned?'노인에게 조사 기록 보여주기':'노인에게 원본 돌려드리기',()=>act('present',{target:'ticket_old',recipient:'elder'}),returned?'show-ticket-record':'return-ticket'));
    }
    if(doc.id==='route_report' && state.location.id==='car_4')actions.append(paperAction('승무원에게 보고서 보여주기',()=>act('present',{target:'route_report',recipient:'attendant'}),'show-route-report'));
    if(state.controls.proof)actions.append(paperAction('이 물건을 최종 증거로 제출',()=>act('prepare_evidence',{target:doc.id}),'submit-evidence','danger-action'));
  }
  page.dataset.actionCount=String(actions.childElementCount);
  if(actions.childElementCount)page.append(actions);
}
function openMap() {
  if(!state)return;const body=openOverlay('열차 안내도','map');const sheet=node('div','map-sheet');sheet.append(node('p','','방문한 장소로 돌아가 놓친 기록을 확인할 수 있습니다. 잠긴 구역은 조건을 충족해야 진입할 수 있습니다.'));
  const grid=node('div','map-nodes');state.map.forEach(p=>{const b=button(p.name,async()=>{const d=await act('move',{target:p.id});if(d&&d.game.location.id===p.id)overlay.close();},'map-node'+(p.current?' current':''),true);if(!p.open||state.status!=='playing'){b.disabled=true;b.dataset.locked='1';}b.append(node('span','',p.current?'현재 위치':p.open?(p.visited?'방문한 장소':'이동 가능'):'아직 진입할 수 없음'));grid.append(b);});sheet.append(grid,node('p','map-foot','1호차 ↔ 2호차 ↔ 3호차 ↔ 4호차 ↔ 승무원실 ↔ 기관실'));body.append(sheet);
}
function openHistory() { if(!state)return;const body=openOverlay('대화 기록','history');const list=node('div','history-list');state.history.forEach(h=>{const r=node('article','history-row '+h.role);r.append(node('strong','',h.speaker),node('p','',h.text));if(h.record){const d=node('details');d.append(node('summary','','대화에서 확인한 사실'),node('p','',h.record));r.append(d);}if(h.npc==='elder')emphasizeTestimony(r);list.append(r);});body.append(list);list.lastElementChild?.scrollIntoView({block:'end'}); }
function openHint() {
  if(!activeHintChoice)return;
  const choice=activeHintChoice,body=openOverlay('조사 힌트','hint');
  const card=button('',()=>perform({action:{...choice.action}}),'choice-button hint-choice',true);
  card.append(node('span','hint-title','지금 해야 할 일'),node('span','hint-text',choice.label));
  body.append(card);
}
function openJournal() {if(!state)return;const body=openOverlay('조사 기록','journal');const list=node('div','journal-list');(state.journal.length?state.journal:['아직 확인한 단서가 없습니다.']).forEach(t=>list.append(node('p','journal-entry',t)));body.append(list);}
function puzzleHost(body) {
  const host=node('div','puzzle-host');
  if(document.documentElement.classList.contains('reduced-motion'))host.dataset.reducedMotion='';
  body.append(host);return host;
}
function openLever() {
  if(!state||state.location.id!=='car_4')return;
  const existing=overlay.open&&overlay.dataset.view==='lever'&&$('overlay-body').querySelector('.puzzle-host');
  if(existing?.puzzle){existing.puzzle.update(state.door);return;}
  const body=openOverlay('승무원실 출입문','lever');
  const host=puzzleHost(body);
  window.TrainPuzzles.mountLever(host,{
    door:state.door,
    onOperate:target=>act('operate',{target}),
    onInventory:()=>openInventory(),
    onEnter:async()=>{const data=await act('move',{target:'crew'});if(data?.game.location.id==='crew'){window.TrainAudio?.playEffect('door-clunk');overlay.close();}}
  }).setBusy(busy);
}
function openControl() {
  if(!state?.controls.control)return;
  const body=openOverlay('분기기 제어 장치','control');
  window.TrainPuzzles.mountDial(puzzleHost(body),{
    draft:controlDraft,attempts:state.attempts,
    onChange:draft=>{controlDraft=draft;},
    onSubmit:values=>act('prepare_control',values)
  }).setBusy(busy);
}
function openConfirmation() {
  const c=state?.confirmation;if(!c)return;const body=openOverlay(c.title,'confirm');const content=node('div','modal-content');content.append(node('p','',c.text));
  if(c.kind==='control'){const values=node('div','confirmation-values');values.append(node('span','','목적지: '+c.destination),node('span','','비밀번호: '+c.password));content.append(values);}
  if(c.kind==='evidence'){const values=node('div','confirmation-values',c.title);content.append(values);}
  const actions=node('div','modal-actions');
  const cancel=button('취소하고 다시 살펴보기',async()=>{const d=await act('cancel');if(d){if(c.kind==='control')openControl();else overlay.close();}},'',true);
  const confirm=button(c.kind==='abandon'?'탈출을 포기한다':'최종 확정',async()=>{const d=await act('confirm',{token:c.token});if(d&&d.game.status==='playing'&&!d.ui?.control)overlay.close();},'primary',true);
  for(const control of [cancel,confirm])control.setAttribute('aria-label',control.textContent);
  actions.append(cancel,confirm);content.append(actions);body.append(content);
}
const cinematicMediaActions=['play','pause','stop','seekbackward','seekforward','seekto','previoustrack','nexttrack'];
function lockMediaSession(locked) {
  if(!navigator.mediaSession)return;
  for(const action of cinematicMediaActions){
    try{navigator.mediaSession.setActionHandler(action,locked?()=>{if(action==='play'||action==='pause'||action==='stop')resumeCinematic?.();}:null);}catch{}
  }
}
function releaseCinematic(resumeMusic=true) {
  cinematicActive=false;cinematicSession++;resumeCinematic=null;cinematicNeedsSound=false;
  clearTimeout(cinematicStallTimer);cinematicStallTimer=null;
  cinematic.dataset.phase='closed';lockMediaSession(false);
  cinematicVideo.onended=null;cinematicVideo.onerror=null;cinematicVideo.ontimeupdate=null;
  cinematicVideo.pause();cinematicVideo.removeAttribute('src');cinematicVideo.load();
  if(cinematic.open)cinematic.close();
  if(resumeMusic)window.TrainAudio?.setSuspended(false);
}
function showEndingComplete(kind) {
  const good=kind==='good';
  overlay.dataset.ending=good?'good':'bad';
  const body=openOverlay(good?'긴 밤의 끝':'영원한 승객','ending-complete');
  const art=node('img','ending-card-art');art.src='/assets/images/ui/ending-certificate'+(good?'':'-sad')+'.png';
  art.alt='';art.draggable=false;art.setAttribute('aria-hidden','true');overlay.prepend(art);
  // 결과가 한눈에 보이도록 제목 위에 성공·실패를 크게 표시한다.
  $('overlay-title').before(node('p','ending-result',good?'탈출 성공':'탈출 실패'));
  const content=node('section','ending-complete');
  content.append(node('p','',good?'당신은 끝없는 열차에서 벗어나 현실로 돌아왔습니다.':'열차를 벗어나지 못했습니다. 열차의 밤은 계속됩니다.'));
  const restart=button('처음부터 다시 시작',()=>startNewGame(),'brass-button');restart.id='ending-restart';
  content.append(restart);body.append(content);
}
function openCinematic(kind,src) {
  if(overlay.open){stopOverlayMedia();overlay.close();}
  acquisitionQueue=[];dismissAcquisition();
  const opening=kind==='opening',session=++cinematicSession;
  cinematicActive=true;cinematicLeaving=false;cinematicNeedsSound=false;
  cinematicLastTime=0;cinematicRestoringTime=false;
  cinematic.dataset.kind=kind;cinematic.dataset.phase='playing';
  $('cinematic-title').textContent=opening?'오프닝':kind==='good'?'굿엔딩':'배드엔딩';
  $('cinematic-status').textContent='영상을 불러오는 중…';
  cinematicVideo.controls=false;cinematicVideo.muted=false;cinematicVideo.playbackRate=1;
  window.TrainAudio?.setSuspended(true);
  let resolveCompleted,rejectCompleted;
  const completed=new Promise((resolve,reject)=>{resolveCompleted=resolve;rejectCompleted=reject;});
  const current=()=>cinematicActive&&session===cinematicSession;
  const fail=()=>{
    if(!current())return;
    releaseCinematic();rejectCompleted(new Error('영상을 불러오지 못했습니다. 기록 불러오기로 다시 시도해 주세요.'));
  };
  const watchProgress=()=>{
    clearTimeout(cinematicStallTimer);
    cinematicStallTimer=setTimeout(()=>{if(!current())return;if(document.hidden)watchProgress();else fail();},45000);
  };
  let playPending=false,lastProgress=-1;
  const play=async()=>{
    if(!current()||playPending||cinematicLeaving||cinematicVideo.ended||cinematicVideo.error)return;
    playPending=true;
    try{await cinematicVideo.play();}
    catch(error){
      if(!current()||error.name==='AbortError')return;
      if(error.name==='NotAllowedError'&&!cinematicVideo.muted){
        // A direct visit may lack a browser audio grant. Keep the film automatic
        // and restore its sound on the first real gesture, without player UI.
        cinematicNeedsSound=true;cinematicVideo.muted=true;
        try{await cinematicVideo.play();}catch(next){if(current()&&next.name!=='AbortError')fail();}
      }else fail();
    }finally{
      playPending=false;
      if(current()&&!cinematicLeaving&&!document.hidden&&cinematicVideo.paused&&!cinematicVideo.ended&&!cinematicVideo.error)setTimeout(play,0);
    }
  };
  resumeCinematic=play;lockMediaSession(true);
  cinematicVideo.onplaying=()=>{$('cinematic-status').textContent='';watchProgress();};
  cinematicVideo.onwaiting=()=>{$('cinematic-status').textContent='영상을 불러오는 중…';};
  cinematicVideo.ontimeupdate=()=>{if(current()&&!cinematicVideo.seeking&&cinematicVideo.currentTime>lastProgress){lastProgress=cinematicVideo.currentTime;watchProgress();}};
  const finish=()=>{
    if(!current())return;
    if(opening){
      try{sessionStorage.setItem(openingSeenKey,'1');}catch{}
      releaseCinematic();
    }else{releaseCinematic(false);showEndingComplete(kind);}
    resolveCompleted();
  };
  cinematicVideo.onended=finish;
  cinematicVideo.onerror=fail;
  // Only the opening can be skipped; endings always play through.
  $('cinematic-skip').hidden=!opening;
  $('cinematic-skip').onclick=opening?finish:null;
  cinematicVideo.src=src;cinematicVideo.setAttribute('aria-label',$('cinematic-title').textContent+' 영상');
  if(!cinematic.open)cinematic.showModal();
  showSceneLoading(false);watchProgress();play();
  return completed;
}
function restoreCinematicSound(event) {
  if(!cinematicActive||!cinematicNeedsSound||!event.isTrusted)return;
  cinematicNeedsSound=false;cinematicVideo.muted=false;resumeCinematic?.();
}
document.addEventListener('pointerdown',restoreCinematicSound,{capture:true,passive:true});
document.addEventListener('keydown',event=>{
  if(!cinematicActive)return;
  restoreCinematicSound(event);
  // Keyboard players reach the skip button with Tab; endings have no button to reach.
  if(event.key==='Tab'&&!$('cinematic-skip').hidden)return;
  if(event.target?.id==='cinematic-skip'&&(event.key==='Enter'||event.key===' '))return;
  if(!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();event.stopImmediatePropagation();}
},true);
for(const name of ['pointerdown','click','dblclick','contextmenu','wheel','touchmove']){
  cinematic.addEventListener(name,event=>{if(cinematicActive){event.preventDefault();event.stopPropagation();}},{passive:false});
}
cinematic.addEventListener('cancel',event=>event.preventDefault());
cinematicVideo.addEventListener('pause',()=>{
  if(cinematicActive&&!cinematicLeaving&&!document.hidden&&!cinematicVideo.ended)resumeCinematic?.();
});
cinematicVideo.addEventListener('timeupdate',()=>{
  if(cinematicActive&&!cinematicVideo.seeking&&!cinematicRestoringTime)cinematicLastTime=cinematicVideo.currentTime;
});
cinematicVideo.addEventListener('seeking',()=>{
  if(!cinematicActive||cinematicRestoringTime)return;
  cinematicRestoringTime=true;cinematicVideo.currentTime=cinematicLastTime;
});
cinematicVideo.addEventListener('seeked',()=>{cinematicRestoringTime=false;});
cinematicVideo.addEventListener('ratechange',()=>{if(cinematicActive&&cinematicVideo.playbackRate!==1)cinematicVideo.playbackRate=1;});
window.addEventListener('pagehide',()=>{cinematicLeaving=true;cinematicVideo.pause();});
window.addEventListener('pageshow',()=>{cinematicLeaving=false;if(cinematicActive)resumeCinematic?.();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&cinematicActive)resumeCinematic?.();});
function openEnding() {
  if(!state?.ending_video)return;
  if(cinematic.open&&cinematic.dataset.kind===state.ending_video.kind)return;
  openCinematic(state.ending_video.kind,state.ending_video.src).catch(error=>setError(error.message,false));
}
async function beginGame(data,newGame=false) {
  let openingSeen=false;
  try{if(newGame)sessionStorage.removeItem(openingSeenKey);openingSeen=sessionStorage.getItem(openingSeenKey)==='1';}catch{}
  const needsOpening=data.game.status==='playing'&&data.game.location.id==='car_1'&&data.game.revision===0&&!openingSeen;
  if(needsOpening){document.body.classList.add('game-booting');await openCinematic('opening','/assets/videos/opening.mp4');}
  showSceneLoading(true);
  await prepareScene(data,true);apply(data,true);
  document.body.classList.remove('game-booting');
}
function openSettings() {
  const body=openOverlay('설정과 진행','settings'),list=node('div','settings-list');
  if(window.TrainAudio){
    const toggle=node('label','audio-setting'),enabled=node('input');enabled.type='checkbox';enabled.checked=!window.TrainAudio.isMuted();
    enabled.addEventListener('change',()=>window.TrainAudio.setMuted(!enabled.checked));toggle.append(enabled,node('span','','배경음악 재생'));
    const volume=node('label','audio-setting'),slider=node('input'),value=node('output','',window.TrainAudio.getVolume()+'%');
    slider.type='range';slider.min='0';slider.max='100';slider.step='5';slider.value=String(window.TrainAudio.getVolume());slider.setAttribute('aria-label','배경음악 음량');
    slider.addEventListener('input',()=>{window.TrainAudio.setVolume(slider.value);value.value=slider.value+'%';});
    volume.append(node('span','','음악 음량'),slider,value);list.append(toggle,volume);
  }
  const l=node('label'),check=node('input');check.type='checkbox';check.checked=document.documentElement.classList.contains('reduced-motion');
  check.addEventListener('change',()=>{document.documentElement.classList.toggle('reduced-motion',check.checked);try{localStorage.setItem('train_reduced_motion',String(check.checked));}catch{}});
  l.append(check,node('span','','움직임 효과 줄이기'));
  list.append(l,node('p','','진행은 현재 브라우저에 연결된 기록으로 자동 보관됩니다. 잠시 쉬려면 창을 닫고 다시 이어서 조사할 수 있습니다.'),button('조사 기록 보기',openJournal),button('새로운 조사 시작',confirmNewGame));
  if(state?.status==='playing')list.append(button('탈출 포기 여부 선택',()=>act('abandon'),'',true));body.append(list);
}
function confirmNewGame() {if(busy)return;const body=openOverlay('새로운 조사 시작','newgame');const c=node('div','modal-content');c.append(node('p','','진행을 초기화하고 처음 화면으로 돌아갑니다. 승객 이름을 다시 정하고 새 승차권을 발권할 수 있습니다. 새로 시작할까요?'));const actions=node('div','modal-actions');actions.append(button('이어서 조사하기',()=>overlay.close()),button('새 게임 시작',()=>startNewGame(),'primary'));c.append(actions);body.append(c);}
async function startNewGame() {
  if(busy)return;
  showSceneLoading(true);setBusy(true);clearError();let leaving=false;
  try{
    await request('/api/game/reset',{});
    try{sessionStorage.removeItem(openingSeenKey);}catch{}
    try{localStorage.removeItem('noTerminus.playerName');}catch{}
    stopOverlayMedia();releaseCinematic();
    // Return to boarding before creating a replacement game or playing its intro.
    window.location.replace('/');leaving=true;
  }catch(e){setError(e.message,false);}
  finally{if(!leaving){showSceneLoading(false);setBusy(false);}}
}
async function sendText(message) { if(overlay.open)overlay.close();$('user-message').value=message;return perform({message}); }
$('chat-form').addEventListener('submit',e=>{e.preventDefault();if(!state?.npc||state.status!=='playing')return;const message=$('user-message').value.trim();if(message)perform({message});});
$('user-message').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('chat-form').requestSubmit();}});
$('user-message').addEventListener('input',e=>{e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,100)+'px';});
$('close-dialogue').addEventListener('click',()=>{setDialogueVisible(false);(document.querySelector('.person-hotspot.talking')||$('hint-btn')).focus({preventScroll:true});});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing&&!overlay.open&&!$('dialogue-box').hidden){e.preventDefault();setDialogueVisible(false);}});
$('menu-btn').addEventListener('click',openSettings);
$('map-toggle').addEventListener('click',toggleMapByPlayer);
overlay.addEventListener('close',revealOpenedLocations);
try{if(localStorage.getItem('train_map_closed')==='true')applyMapClosed(true);}catch{}
$('hint-choice').addEventListener('click',()=>{if(activeHintChoice)perform({action:{...activeHintChoice.action}});});
$('bag-btn').addEventListener('click',()=>openInventory());$('end-talk').addEventListener('click',()=>act('end_talk'));$('history-btn').addEventListener('click',openHistory);$('hint-btn').addEventListener('click',()=>act('hint'));$('close-overlay').addEventListener('click',closeOverlay);overlay.addEventListener('close',stopOverlayMedia);overlay.addEventListener('cancel',e=>{e.preventDefault();closeOverlay();});
$('retry-btn').addEventListener('click',()=>{if(lastRequest)perform(lastRequest,true);});$('reload-btn').addEventListener('click',async()=>{if(busy)return;setBusy(true);try{const data=await request('/api/game');if(state){await prepareScene(data);apply(data);}else await beginGame(data);clearError();toast('진행 기록을 불러왔습니다.');}catch(e){document.body.classList.remove('game-booting');setError(e.message,false);}finally{showSceneLoading(false);setBusy(false);}});
$('scene-world').addEventListener('pointermove',e=>{if(scene?.light_mode!=='flashlight'||state?.npc)return;const r=e.currentTarget.getBoundingClientRect();$('darkness').style.setProperty('--beam-x',((e.clientX-r.left)/r.width*100)+'%');$('darkness').style.setProperty('--beam-y',((e.clientY-r.top)/r.height*100)+'%');});
try{if(localStorage.getItem('train_reduced_motion')==='true')document.documentElement.classList.add('reduced-motion');}catch{}
window.addEventListener('resize',fitScene);
window.visualViewport?.addEventListener('resize',fitScene);
fitDialogueFont();
window.addEventListener('resize',fitDialogueFont);
if(window.ResizeObserver){
  new ResizeObserver(fitDialogueFont).observe(document.querySelector('.scene-frame'));
  const sceneObserver=new ResizeObserver(fitScene);
  sceneObserver.observe(document.querySelector('.scene-viewport'));
}
(async()=>{showSceneLoading(true);setBusy(true);try{const params=new URLSearchParams(location.search);let data,newGame=false;if(params.get('new')==='1'){newGame=true;data=await request('/api/game/new',{username:shell.dataset.username||'사용자'});params.delete('new');history.replaceState(null,'',location.pathname+(params.toString()?'?'+params:''));}else{try{data=await request('/api/game');}catch(e){if(e.code!=='game_missing')throw e;newGame=true;data=await request('/api/game/new',{username:shell.dataset.username||'사용자'});}}await beginGame(data,newGame);}catch(e){document.body.classList.remove('game-booting');setError(e.message,false);$('save-status').textContent='불러오기 실패';}finally{showSceneLoading(false);setBusy(false);}})();

})();
