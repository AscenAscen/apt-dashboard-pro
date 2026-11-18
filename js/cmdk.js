/* ─────────────────────────────────────────────────────────
   cmdk.js — 어디서든 단지 검색 (Ctrl+K)
   · Ctrl+K (맥: ⌘K) 또는 / 키, 또는 위쪽 [🔍 단지 찾기] 버튼
   · 단지 이름 · 별칭 · 동네 · 구 이름 (띄어 쓰면 모두 포함: "평촌 래미안")
   · 단지: Enter = 단지 요약 창, Shift+Enter = 실거래 조회 탭 · 버튼: 요약 / 실거래 / 지도 / 네이버
   · 지역: Enter = 실거래 조회 탭에서 그 지역 · 탭 이름: Enter = 그 탭으로
   · 최근 고른 단지 8개 기억 (apt.cmdk.v1)
   ───────────────────────────────────────────────────────── */
const CmdK = (() => {
  const $ = (id) => document.getElementById(id);
  const SK = 'apt.cmdk.v1';
  let hits = [], at = 0, timer = null, regions = null;
  const norm = (t) => String(t || '').replace(/\s+/g, '').toLowerCase();
  const recent = () => Store.get(SK, []) || [];
  function remember(x) {
    const id = x.code + '|' + x.key;
    Store.set(SK, [{ code: x.code, key: x.key, sido: x.sido, sgg: x.sgg, dong: x.dong, jibun: x.jibun, name: x.name }, ...recent().filter(r => r.code + '|' + r.key !== id)].slice(0, 8));
  }

  function modal() {
    let m = $('ckModal'); if (m) return m;
    m = document.createElement('div'); m.className = 'modal ckmodal'; m.id = 'ckModal'; m.hidden = true;
    m.innerHTML = `<div class="modalbox ckbox" role="dialog" aria-label="단지 찾기">
      <div class="ckin"><span>🔍</span><input id="ckInput" type="search" autocomplete="off" spellcheck="false" placeholder="단지 이름 · 별칭 · 동네 · 구 · 탭 이름 (예: 평촌 래미안, 헬리오, 공급)"><kbd>Esc</kbd></div>
      <div id="ckList" class="cklist" role="listbox"></div>
      <div class="ckfoot"><span><kbd>↑</kbd><kbd>↓</kbd> 고르기</span><span><kbd>Enter</kbd> 단지 요약</span><span><kbd>Shift</kbd>+<kbd>Enter</kbd> 실거래 조회</span><span class="grow"></span><span>어디서든 <kbd>Ctrl</kbd>+<kbd>K</kbd></span></div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('mousedown', (e) => { if (e.target === m) close(); });
    $('ckInput').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 120); });
    $('ckInput').addEventListener('keydown', key);
    $('ckList').addEventListener('click', click);
    $('ckList').addEventListener('mousemove', (e) => { const r = e.target.closest('.ckrow'); if (r && +r.dataset.i !== at) { at = +r.dataset.i; mark(); } });
    return m;
  }

  /* ── 결과 만들기 ── */
  function tabHits(q) {
    const w = norm(q); if (!w) return [];
    return [...document.querySelectorAll('#tabs button[data-tab]')].map(b => ({ t: 'tab', tab: b.dataset.tab, name: b.childNodes[0].textContent.trim() }))
      .filter(x => norm(x.name).includes(w)).slice(0, 4);
  }
  async function regionHits(q) {
    if (q.trim().length < 2) return [];
    if (!regions) regions = await Data.regions();
    const words = q.trim().toLowerCase().split(/\s+/);
    return regions.filter(r => { const s = norm(r[1] + r[2]); return words.every(w => s.includes(w)) && words.some(w => norm(r[2]).includes(w)); })
      .slice(0, 4).map(r => ({ t: 'reg', code: r[0], sido: r[1], name: r[2] }));
  }
  async function search() {
    const q = $('ckInput').value.trim(), list = $('ckList');
    if (!q) { hits = recent().map(x => ({ t: 'apt', x, recent: true })); at = 0; draw(q); return; }
    const tabs = tabHits(q), regs = await regionHits(q);
    let apts = [];
    if (q.length >= 2) {
      list.dataset.loading = '1';
      await Finder.load();
      apts = Finder.find(q, 30).map(x => ({ t: 'apt', x }));
      delete list.dataset.loading;
    }
    if ($('ckInput').value.trim() !== q) return;             // 그사이 더 쳤으면 버림
    // 지역·탭 이름과 똑같이 쳤으면 (예: "강남구", "공급") 그 줄을 맨 위로
    const w = norm(q), exactR = regs.filter(r => norm(r.name.split(' ').pop()) === w || norm(r.name) === w), exactT = tabs.filter(t => norm(t.name) === w);
    hits = exactR.length || exactT.length ? [...exactT, ...exactR, ...apts, ...regs.filter(r => !exactR.includes(r)), ...tabs.filter(t => !exactT.includes(t))] : [...apts, ...regs, ...tabs];
    at = 0; draw(q);
  }

  function hl(text, q) {                                         // 찾은 글자 굵게
    const s = U.esc(text), w = q.trim().split(/\s+/).filter(x => x.length >= 1).map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return w.length ? s.replace(new RegExp(`(${w.join('|')})`, 'gi'), '<mark>$1</mark>') : s;
  }
  function draw(q) {
    const list = $('ckList');
    if (!hits.length) {
      list.innerHTML = q
        ? (q.length < 2 ? '<p class="ckmsg">두 글자 이상 넣어 주세요.</p>' : '<p class="ckmsg">찾는 단지가 없습니다. 이름의 일부만 넣어 보세요 (예: 래미안, 자이). 별칭을 붙여 둔 단지는 별칭으로도 찾습니다.</p>')
        : '<p class="ckmsg">단지 이름을 넣어 보세요. 한 번 고른 단지는 여기에 최근 목록으로 남습니다.</p>';
      return;
    }
    let head = '';
    list.innerHTML = hits.map((h, i) => {
      const sec = h.t === 'apt' ? (h.recent ? '최근 고른 단지' : '단지') : h.t === 'reg' ? '지역' : '탭으로 가기';
      const top = sec !== head ? `<div class="cksec">${sec}</div>` : ''; head = sec;
      if (h.t === 'apt') {
        const x = h.x, al = Alias.of(x.code, x.key);
        return top + `<div class="ckrow" data-i="${i}" role="option"><span class="ckic">🏢</span><span class="ckm"><b>${hl(x.name, q)}</b><small>${hl(`${x.sido} ${x.sgg} ${x.dong}`, q)}${al ? ` · 별칭 <i>${hl(al, q)}</i>` : ''}</small></span>
          <span class="ckact"><button data-a="cx" title="단지 한 장 요약 (Enter)">요약</button><button data-a="search" title="실거래 조회 탭에서 열기 (Shift+Enter)">실거래</button><button data-a="map" title="지도">지도</button><button data-a="naver" title="네이버페이 부동산에서 찾기 (단지 이름 복사)">네이버</button></span></div>`;
      }
      if (h.t === 'reg') return top + `<div class="ckrow" data-i="${i}" role="option"><span class="ckic">📍</span><span class="ckm"><b>${hl(h.name, q)}</b><small>${U.esc(h.sido)} · 실거래 조회에서 이 지역 보기</small></span></div>`;
      return top + `<div class="ckrow" data-i="${i}" role="option"><span class="ckic">↪</span><span class="ckm"><b>${hl(h.name, q)}</b><small>탭으로 가기</small></span></div>`;
    }).join('');
    mark();
  }
  function mark() {
    const rows = $('ckList').querySelectorAll('.ckrow');
    rows.forEach(r => r.classList.toggle('on', +r.dataset.i === at));
    const on = rows[at]; if (on) on.scrollIntoView({ block: 'nearest' });
  }

  /* ── 실행 ── */
  async function run(h, how) {
    if (!h) return;
    close();
    if (h.t === 'tab') { App.showTab(h.tab); return; }
    if (h.t === 'reg') { App.showTab('search'); await Search.openRegion(h.code); return; }
    const x = h.x; remember(x);
    if (how === 'search') { App.showTab('search'); await Search.openComplex(x); window.scrollTo({ top: 0 }); return; }
    if (how === 'map') { App.showMap(x); return; }
    if (how === 'naver') { LandLink.open(x.sgg, x.dong, x.name); return; }
    CxView.open(`${x.code}|${x.key}#0`);                      // 평형 0 → 요약 창이 거래가 가장 많은 평형을 고름
  }
  function key(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (hits.length) { at = (at + 1) % hits.length; mark(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (hits.length) { at = (at - 1 + hits.length) % hits.length; mark(); } }
    else if (e.key === 'Enter') { e.preventDefault(); if (e.isComposing) return; run(hits[at], e.shiftKey ? 'search' : 'cx'); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }
  function click(e) {
    const r = e.target.closest('.ckrow'); if (!r) return;
    const b = e.target.closest('button[data-a]');
    run(hits[+r.dataset.i], b ? b.dataset.a : 'cx');
  }

  function open() {
    const m = modal(); m.hidden = false;
    const inp = $('ckInput'); inp.value = ''; search();
    setTimeout(() => inp.focus(), 0);
    Finder.load();                                                 // 단지 목록을 미리 불러 둠
  }
  function close() { const m = $('ckModal'); if (m) m.hidden = true; }

  function init() {
    if ($('btnCmdK')) $('btnCmdK').onclick = open;
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K' || e.key === 'ㅏ')) { e.preventDefault(); const m = $('ckModal'); if (m && !m.hidden) close(); else open(); return; }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = e.target, typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
        if (!typing && !document.body.classList.contains('locked')) { e.preventDefault(); open(); }
      }
    });
  }
  return { init, open, close };
})();
