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

  // 화면 낭독기는 처음부터 전체 문장을 읽게
  full.textContent = LINES.join(' ');

  const all = LINES[0] + LINES[1];
  const total = all.length;

  function render(n) {
    line1.textContent = LINES[0].slice(0, n);
    line2.textContent = LINES[1].slice(0, Math.max(0, n - LINES[0].length));
  }

  // 움직임 줄이기 설정이면 바로 전체 표시
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    render(total);
    return;
  }

  let n = 0;

  function tick() {
    n += 1;
    render(n);
    if (n >= total) return;

    const ch = all.charAt(n - 1);
    let delay = 75 + Math.random() * 60; // 사람이 치는 것처럼 속도를 들쭉날쭉하게
    if (ch === '.' || ch === ',') delay = PUNCT_DELAY;
    if (n === LINES[0].length) delay = LINE_DELAY;

    // 환경 설정의 글자 속도 반영
    const mul = window.gameSettings ? window.gameSettings.speedMultiplier() : 1;
    setTimeout(tick, delay * mul);
  }

  setTimeout(tick, START_DELAY);
})();
