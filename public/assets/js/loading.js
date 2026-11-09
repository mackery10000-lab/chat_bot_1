/* Loading copy is cosmetic: its request never blocks a game request or scene. */
(() => {
  'use strict';
  const screen=document.getElementById('scene-loading'),copy=document.getElementById('loading-lore');
  if(!screen||!copy)return;
  let ready=false,pending=false,lastRequest=-Infinity;
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
    show(show){const opening=show&&screen.hidden;screen.hidden=!show;if(opening)refresh();},
    setReady(){if(ready)return;ready=true;if(!screen.hidden)refresh();}
  };
})();
