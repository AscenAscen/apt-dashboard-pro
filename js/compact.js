/* ─────────────────────────────────────────────────────────
   compact.js — 휴대폰 화면 넓히기 (위쪽 줄 접기)
   · 휴대폰(너비 760px 이하)에서 맨 위에는 "제목 + [⚙ 설정] 단추 + 탭"만 남깁니다.
     잠금·배경·단지 찾기·수집 상태·동기화·"데이터 기준" 줄은 [⚙ 설정]을 누르면 펼쳐집니다.
   · 수집 문제나 동기화 실패가 있으면 [⚙ 설정] 단추에 빨간 점(확인 필요는 노란 점)이 뜹니다.
   · PC 화면에서는 아무것도 바뀌지 않습니다 (단추가 보이지 않음).
   · 홈 탭의 [전체화면] 단추는 js/start.js 에 있습니다.
   ───────────────────────────────────────────────────────── */
const Compact = (() => {
  let inited = false;

  function init() {
    if (inited) return; inited = true;
    const top = document.querySelector('header.top');
    if (!top || document.getElementById('btnTopMore')) return;

    const b = document.createElement('button');
    b.id = 'btnTopMore'; b.type = 'button'; b.className = 'topmore';
    b.innerHTML = '⚙ 설정<i class="topdot"></i>';
    b.title = '잠금 · 배경 · 단지 찾기 · 수집 상태 · 동기화 (눌러서 펼치기/접기)';
    b.setAttribute('aria-expanded', 'false');
    const h1 = top.querySelector('h1');
    if (h1) h1.after(b); else top.prepend(b);

    b.addEventListener('click', () => {
      const open = top.classList.toggle('open');
      b.classList.toggle('on', open);
      b.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    /* 접혀 있어도 문제가 생기면 점으로 알려 줌 */
    const has = (id, cls) => { const el = document.getElementById(id); return !!el && el.classList.contains(cls); };
    function dot() {
      const bad = has('btnHealth', 'bad') || has('btnAutoSync', 'bad');
      const warn = has('btnHealth', 'warn') || has('status', 'warn');
      const v = bad ? 'bad' : warn ? 'warn' : '';
      if ((b.dataset.dot || '') !== v) { if (v) b.dataset.dot = v; else delete b.dataset.dot; }
    }
    dot();
    new MutationObserver(dot).observe(top, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  }

  return { init };
})();
