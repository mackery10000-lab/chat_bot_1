/* Loading copy is cosmetic: its request never blocks a game request or scene. */
(() => {
  'use strict';
  const screen=document.getElementById('scene-loading'),copy=document.getElementById('loading-lore');
  if(!screen||!copy)return;
  const destination=document.getElementById('movement-destination');
  const shell=document.querySelector('.chat-area');
  const minimumMovementMs=1000;
  let ready=false,pending=false,lastRequest=-Infinity,movementStarted=null,previousShellInert=null;
  function releaseMovement(){
    movementStarted=null;
    if(shell&&previousShellInert!==null){shell.inert=previousShellInert;previousShellInert=null;}
  }
  async function refresh(){
    if(!ready||pending||performance.now()-lastRequest<10000)return;
    pending=true;lastRequest=performance.now();
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch('/api/loading-text',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}',signal:controller.signal});
      if(!response.ok)return;
      const result=await response.json();
      if(typeof result.text==='string'&&result.text.trim().length>=15&&result.text.length<=100){
        copy.textContent=result.text;copy.dataset.source=result.source==='ai'?'ai':'fallback';
      }
    }catch{/* Keep the last safe line; loading and game errors have separate lifetimes. */}
    finally{clearTimeout(timer);pending=false;}
  }
  window.TrainLoading={
    show(show){
      const opening=show&&screen.hidden;
      releaseMovement();
      screen.hidden=!show;
      if(show){screen.dataset.mode='loading';screen.setAttribute('aria-label','장면 로딩');}
      if(opening)refresh();
    },
    showMovement(name=''){
      movementStarted=performance.now();
      if(shell){if(previousShellInert===null)previousShellInert=shell.inert;shell.inert=true;}
      if(destination)destination.textContent=name?name+'로 이동합니다.':'';
      screen.dataset.mode='movement';screen.setAttribute('aria-label','칸 이동 중');screen.hidden=false;
      refresh();
    },
    waitForMovement(){
      if(movementStarted===null)return Promise.resolve();
      return new Promise(resolve=>setTimeout(resolve,Math.max(0,minimumMovementMs-(performance.now()-movementStarted))));
    },
    setReady(){if(ready)return;ready=true;if(!screen.hidden&&screen.dataset.mode!=='movement')refresh();}
  };
})();
