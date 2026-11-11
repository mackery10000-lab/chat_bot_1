// 나레이션 타자 효과
(function () {
  const LINES = [
    '평범한 출장길이었다.',
    '적어도, 그 열차에 오르기 전까지는...'
  ];

  const START_DELAY = 900;   // 시작 전 대기 (ms)
  const PUNCT_DELAY = 420;   // . , 뒤에 쉬는 시간
  const LINE_DELAY = 700;    // 첫 줄 끝나고 쉬는 시간

  const line1 = document.getElementById('line1');
  const line2 = document.getElementById('line2');
  const full = document.getElementById('narration-full');
  if(!line1||!line2||!full)return;

  // 화면 낭독기는 처음부터 전체 문장을 읽게
  full.textContent = LINES.join(' ');

  const all = LINES[0] + LINES[1];
  const total = all.length;

  function render(n) {
    line1.textContent = LINES[0].slice(0, n);
    line2.textContent = LINES[1].slice(0, Math.max(0, n - LINES[0].length));
  }

  let n = 0, timer = null, due = 0, remaining = START_DELAY;
  // Text reveal is independent of the OS setting for spatial motion effects.
  render(0);

  function schedule(delay) {
    clearTimeout(timer);timer=null;remaining=delay;
    if(document.hidden||n>=total)return;
    due=performance.now()+delay;timer=setTimeout(tick,delay);
  }
  function pause() {
    if(timer!==null){remaining=Math.max(0,due-performance.now());clearTimeout(timer);timer=null;}
  }
  function resume() {if(timer===null&&n<total)schedule(remaining);}
  function tick() {
    timer=null;
    if(document.hidden)return;
    n += 1;
    render(n);
    if (n >= total) return;

    const ch = all.charAt(n - 1);
    let delay = 75 + Math.random() * 60; // 사람이 치는 것처럼 속도를 들쭉날쭉하게
    if (ch === '.' || ch === ',') delay = PUNCT_DELAY;
    if (n === LINES[0].length) delay = LINE_DELAY;

    // 환경 설정의 글자 속도 반영
    let mul=1;
    try{const value=Number(window.gameSettings&&window.gameSettings.speedMultiplier());if(Number.isFinite(value)&&value>0)mul=value;}catch{}
    schedule(delay * mul);
  }

  schedule(START_DELAY);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();else resume();});
  window.addEventListener('pagehide',pause);
  window.addEventListener('pageshow',resume);
})();
