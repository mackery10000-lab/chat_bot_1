// Offline lifecycle checks: node tools/check_movement_transition.mjs
// Runs the real loading controller and scene preparation with a controlled clock.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const loadingSource=fs.readFileSync(new URL('../public/assets/js/loading.js',import.meta.url),'utf8');
const chatbotSource=fs.readFileSync(new URL('../public/assets/js/chatbot.js',import.meta.url),'utf8');
const begin=chatbotSource.indexOf('async function prepareScene(');
const end=chatbotSource.indexOf('\nfunction acquisition(',begin);
assert.ok(begin>=0&&end>begin,'scene preparation function exists');
const sceneSource=chatbotSource.slice(begin,end);
const game=(id,name=id)=>({game:{location:{id,name}},scene:{background:id+'.png',people:[],hotspots:[]}});
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

function harness({location='car_1',artwork=()=>Promise.resolve(),initialInert=false}={}){
  let now=0,nextTimer=0,fetches=0;
  const timers=new Map();
  const screen={hidden:true,dataset:{},attributes:{},setAttribute(key,value){this.attributes[key]=value;}};
  const copy={textContent:'초기 장면 설명',dataset:{}},destination={textContent:''};
  const shell={inert:initialInert};
  const overlay={open:true,close(){this.open=false;}};
  const context=vm.createContext({
    document:{getElementById:id=>({'scene-loading':screen,'loading-lore':copy,'movement-destination':destination}[id]),querySelector:selector=>selector==='.chat-area'?shell:null},
    window:{},performance:{now:()=>now},AbortController,Promise,
    setTimeout(callback,delay){const id=++nextTimer;timers.set(id,{at:now+delay,callback});return id;},
    clearTimeout:id=>timers.delete(id),
    fetch:async()=>{fetches++;return {ok:true,json:async()=>({text:'객차에는 바퀴가 선로를 지나는 낮은 소리만 남습니다.',source:'fallback'})};},
    state:location?game(location).game:null,overlay,wallRepairRooms:new Set(),wallRepairImage:'wall.png',prepareImage:artwork
  });
  vm.runInContext(loadingSource,context);
  context.showSceneLoading=show=>context.window.TrainLoading.show(show);
  vm.runInContext(sceneSource,context);
  return {
    context,screen,copy,destination,overlay,shell,
    fetches:()=>fetches,
    prepare:data=>context.prepareScene(data),
    async tick(ms){
      const target=now+ms;
      while(true){
        const next=[...timers].filter(([,task])=>task.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
        if(!next)break;
        now=next[1].at;timers.delete(next[0]);next[1].callback();await flush();
      }
      now=target;await flush();
    }
  };
}

// Every confirmed room change has a full second even when every image is cached.
{
  const h=harness();let finished=false;
  const work=h.prepare(game('car_2','2호차')).then(()=>{finished=true;});
  assert.equal(h.screen.hidden,false);
  assert.equal(h.screen.dataset.mode,'movement');
  assert.equal(h.screen.attributes['aria-label'],'칸 이동 중');
  assert.equal(h.destination.textContent,'2호차로 이동합니다.');
  assert.equal(h.overlay.open,false,'top-layer dialogs cannot cover the passage');
  assert.equal(h.shell.inert,true,'keyboard cannot reopen dialogs behind the passage');
  await h.tick(999);assert.equal(finished,false);
  await h.tick(1);await work;assert.equal(finished,true);
  assert.equal(h.fetches(),0,'movement never requests generated lore');
  h.context.showSceneLoading(false);assert.equal(h.screen.hidden,true);
  assert.equal(h.shell.inert,false,'controls are restored when the passage closes');
}

// A slower image keeps the passage open beyond the minimum duration.
{
  let release;const image=new Promise(resolve=>{release=resolve;});
  const h=harness({artwork:()=>image});let finished=false;
  const work=h.prepare(game('crew','승무원실')).then(()=>{finished=true;});
  await h.tick(1300);assert.equal(finished,false);
  release();await work;assert.equal(finished,true);
  assert.equal(h.screen.hidden,false,'scene preparation keeps the overlay until apply completes');
}

// Blocked moves, dialogue, inventory and other same-room responses have no delay.
{
  const h=harness();await h.prepare(game('car_1'));
  assert.equal(h.screen.hidden,true);
  assert.equal(h.overlay.open,true);
  assert.equal(h.fetches(),0);
}

// A failed asset cannot cut short an already-confirmed movement scene.
{
  const h=harness({artwork:()=>Promise.reject(new Error('Offline image'))});let failure=null;
  const work=h.prepare(game('car_2')).catch(error=>{failure=error;});
  await h.tick(999);assert.equal(failure,null);
  await h.tick(1);await work;assert.equal(failure.message,'Offline image');
  h.context.showSceneLoading(false);assert.equal(h.shell.inert,false,'error cleanup restores controls');
}

// Repeated starts, page-show cleanup and an existing inert state are reversible.
{
  const h=harness();
  h.context.window.TrainLoading.showMovement('2호차');
  h.context.window.TrainLoading.showMovement('3호차');
  h.context.showSceneLoading(false);
  assert.equal(h.shell.inert,false,'repeated starts preserve the original interactive state');
  h.context.window.TrainLoading.showMovement('4호차');
  h.context.showSceneLoading(true);
  assert.equal(h.shell.inert,false,'switching back to boot loading releases movement focus lock');
  const locked=harness({initialInert:true});
  locked.context.window.TrainLoading.showMovement('2호차');
  locked.context.showSceneLoading(false);
  assert.equal(locked.shell.inert,true,'cleanup preserves an existing inert state');
}

// Boot loading keeps the original lore and does not inherit the movement delay.
{
  const h=harness({location:null});await h.prepare(game('car_1'));await flush();
  assert.equal(h.screen.dataset.mode,'loading');
  assert.equal(h.screen.attributes['aria-label'],'장면 로딩');
  assert.equal(h.fetches(),1);
  assert.ok(h.copy.textContent.includes('바퀴'));
}

console.log('Movement transition lifecycle: 6 scenarios passed.');
