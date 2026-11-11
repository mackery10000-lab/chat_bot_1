// A worn suspension strains, slips in short increments and settles. The right
// eyelet stays fixed; the rope and loose fibers follow the real attachment.
(() => {
  'use strict';
  try{
    if(JSON.parse(localStorage.getItem('noTerminus.settings')||'{}').effects===false)
      document.documentElement.classList.add('no-fx');
  }catch{}
  const sign=document.querySelector('.sign'),frame=sign?.querySelector('.sign__frame');
  if(!frame)return;
  const rig=sign.querySelector('.sign__rigging'),cords=[...rig.querySelectorAll('.sign__cord')],frays=[...rig.querySelectorAll('.sign__fray')];
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let raf=0,start=0,angle=0,tremor=0,width=0,height=0,finished=false;
  const quiet=()=>reduced.matches||document.documentElement.classList.contains('no-fx');
  const ease=t=>{const x=Math.max(0,Math.min(1,t));return x*x*(3-2*x);};
  const lean=[[0,0],[.22,-.008],[.42,-.035],[.6,-.045],[.78,-.1],[.9,-.12],[1.1,-.43],[1.2,-.45],[1.47,-1.13],[1.58,-1.16],[1.9,-2.28],[2.09,-2.14],[2.34,-2.23],[2.63,-2.19],[3.05,-2.2]];
  function wornLean(time){
    for(let i=1;i<lean.length;i++){
      const [until,to]=lean[i],[fromTime,from]=lean[i-1];
      if(time<=until)return from+(to-from)*ease((time-fromTime)/(until-fromTime));
    }
    return -2.2;
  }
  function draw(degrees,shiver=0){
    angle=degrees;tremor=shiver;
    frame.style.transform=`rotate(${degrees.toFixed(5)}deg)`;
    sign.dataset.angle=degrees.toFixed(5);
    // Eyelet centers sampled from the delivered 2172 × 724 frame artwork.
    const radians=degrees*Math.PI/180,originX=width*1782/2172,originY=height*40/724;
    rig.setAttribute('viewBox',`0 0 ${width} 100`);
    cords.forEach((cord,index)=>{
      const anchor=width*(index?1782:388.5)/2172,dx=anchor-originX;
      const x=originX+dx*Math.cos(radians),y=30+originY+dx*Math.sin(radians);
      const bow=index?0:Math.min(1.8,Math.abs(degrees)*.55),shake=index?0:shiver;
      const c1x=anchor+shake*.35,c1y=y*.25,c2x=x-bow+shake,c2y=y*.72;
      cord.setAttribute('d',`M ${anchor} 0 C ${c1x} ${c1y} ${c2x} ${c2y} ${x} ${y}`);
      if(!index)frays.forEach((fiber,i)=>{
        const t=.28+i*.07,u=1-t;
        const px=u*u*u*anchor+3*u*u*t*c1x+3*u*t*t*c2x+t*t*t*x;
        const py=3*u*u*t*c1y+3*u*t*t*c2y+t*t*t*y;
        const side=i===1?1:-1,fan=side*(2.1+i*.55)+shake*.5;
        fiber.setAttribute('d',`M ${px} ${py} q ${fan*.7} ${-1.4+shake*.25} ${fan} ${-3-i*.5}`);
      });
    });
  }
  function measure(){width=frame.offsetWidth;height=frame.offsetHeight;draw(angle,tremor);}
  function settle(){cancelAnimationFrame(raf);raf=0;finished=true;sign.dataset.phase='settled';sign.dataset.tension='resting';draw(-2.2);}
  function tick(now){
    if(quiet()){settle();return;}
    if(!start)start=now;
    const seconds=(now-start-500)/1000;
    if(seconds<0){sign.dataset.phase='level';sign.dataset.tension='taut';draw(0);}
    else if(seconds<3.2){
      sign.dataset.phase='sagging';
      sign.dataset.tension=seconds<.9?'straining':'yielding';
      // Uneven, localized vibration while the fibers carry the load. Short
      // sticking points interrupt the descent instead of a pendulum bounce.
      const noise=(Math.sin(seconds*43)+.48*Math.sin(seconds*71+.6)+.2*Math.sin(seconds*107+.2))/1.68;
      const stress=ease(seconds/.13)*(seconds<.9?.65+.35*seconds/.9:Math.exp(-(seconds-.9)*3));
      draw(wornLean(seconds)+noise*.07*stress,noise*.75*stress);
    }else{settle();return;}
    raf=requestAnimationFrame(tick);
  }
  if(window.ResizeObserver)new ResizeObserver(measure).observe(frame);else window.addEventListener('resize',measure);
  measure();
  if(quiet())settle();else raf=requestAnimationFrame(tick);
  const onPreference=()=>{if(quiet())settle();};
  if(reduced.addEventListener)reduced.addEventListener('change',onPreference);else reduced.addListener(onPreference);
  new MutationObserver(onPreference).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  window.addEventListener('pagehide',()=>{cancelAnimationFrame(raf);raf=0;});
  window.addEventListener('pageshow',event=>{
    if(!event.persisted)return;
    measure();
    if(quiet()||finished)settle();else{start=0;raf=requestAnimationFrame(tick);}
  });
})();
