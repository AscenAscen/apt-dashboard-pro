/* ─────────────────────────────────────────────────────────
   start.js — [홈] 탭 (첫 화면): 시세랩처럼 화면 전체를 지도로
   · 단지 라벨: 단지명 · 연식 · 세대수 (시세트래킹·랜드마크 단지는 빨간 강조 라벨)
   · 라벨에 마우스를 올리면 실거래·전고점·전저점 창 (A: 한 평형씩 / B: 평형별 표)
   · 라벨을 누르거나 검색하면: 단지 경계선(빨간 선) + 동 번호 (브이월드 연속지적도·도로명주소 건물)
   · 왼쪽 패널: 라벨(기본/강조) · 트래킹 · 지역 · 단지비교 · 필터 · 평형(59·74·84)
   · 위쪽 레이어: 학교 · 학원가 · 상권 · 지하철 · 입주예정 · 행정경계(시군구) · 법정경계(법정동)
   다른 탭의 코드·저장값은 고치지 않고 읽기만 합니다. (시세트래킹 담기·단지 비교 보내기는 버튼을 누를 때만)
   좌표는 저장하지 않습니다(카카오 약관). 저장: apt.start.v1 (지도 위치·지역·필터·레이어)
   ───────────────────────────────────────────────────────── */
const Start = (() => {
  const $ = (id) => document.getElementById(id);
  const SK = 'apt.start.v1';
  const PYC = [['s', '소형'], ['59', '59'], ['74', '74'], ['84', '84'], ['L', '대형']];
  const PYN = Object.fromEntries(PYC);
  const PY_PICK = ['59', '74', '84'];
  const DEF = { codes: [], view: null, mode: 'basic', trk: 0, pys: [], hh: 300, unk: 1, age: 0, tip: 'A', layers: {}, other: 0, autoLv: 3 };
  const NOW_Y = new Date().getFullYear(), NOW_YM = NOW_Y * 100 + new Date().getMonth() + 1;
  const D5 = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 5); return U.ymd(d); })();
  const MAX_REG = 6;                                   // 한 번에 불러 두는 시군구 수 (넘으면 오래된 것부터 내림)
  const TRK_FOLDER = '지도 추가';                       // 지도에서 담은 단지는 이 시세트래킹 폴더로
  const LAYERS = [
    { k: 'school', name: '학교', icon: '🏫', type: 'cat', codes: ['SC4'], maxLv: 5 },
    { k: 'acad', name: '학원가', icon: '✏️', type: 'cat', codes: ['AC5'], maxLv: 4 },
    { k: 'shop', name: '상권', icon: '🛍️', type: 'cat', codes: ['MT1'], kw: ['백화점'], maxLv: 6, tip: '대형마트·백화점' },
    { k: 'subway', name: '지하철', icon: '🚇', type: 'cat', codes: ['SW8'], maxLv: 7 },
    { k: 'supply', name: '입주예정', icon: '🏗️', type: 'supply', maxLv: 8, tip: '공급 탭(청약홈) 자료 중 앞으로 입주할 단지 · 불러온 지역만' },
    { k: 'sgg', name: '행정경계', icon: '🗺️', type: 'vw', data: 'LT_C_ADSIGG_INFO', nm: ['sig_kor_nm'], maxLv: 9, color: '#7c3aed', tip: '시·군·구 경계 (브이월드)' },
    { k: 'emd', name: '법정경계', icon: '📐', type: 'vw', data: 'LT_C_ADEMD_INFO', nm: ['emd_kor_nm'], maxLv: 6, color: '#0284c7', tip: '법정동 경계 (브이월드)' },
  ];

  let st = {}, inited = false, map = null, regs = null, regList = [], names = null, namesP = Promise.resolve(null), geocoder = null, places = null;
  const loaded = new Map();                            // 지역 코드 → { state, list, p }
  const cxs = new Map();                               // 단지 id(code|key) → cx
  const ovs = new Map();                               // 단지 id → { ov, el }
  const pos = new Map();                               // 단지 id → {lat, lng} (이번 접속 동안만)
  const forced = new Set();                            // 검색으로 찾은 단지: 필터와 상관없이 보이기
  let queue = [], working = 0, tip = null, tipPin = false, tipTimer = null, idleTimer = null, centerDong = '';
  let tracked = new Set(), lands = new Set(), basket = [], pop = '', myDot = null;
  const save = () => Store.set(SK, st);
  const visible = () => { const t = $('tab-start'); return !!t && !t.hidden; };
  const isTouch = () => window.matchMedia('(max-width: 760px), (pointer: coarse)').matches;
  const eok = (v) => (v == null ? '-' : U.price(v));
  const ym = (d) => (d ? `${String(d).slice(2, 4)}.${String(d).slice(4, 6)}` : '');
  const pct = (v) => (v == null || !isFinite(v) ? '-' : (v > 0 ? '+' : '') + v.toFixed(1) + '%');
  const msg = (h) => { const el = $('stMsg'); if (el) { el.innerHTML = h || ''; el.hidden = !h; } };
  const nameOf = (cx) => cx.alias || cx.name;
  const isEmph = (cx) => tracked.has(cx.id) || lands.has(cx.id);

  /* ═════════ 자료: 한 지역을 불러와 단지마다 정리 ═════════ */
  async function loadRegion(code) {
    if (loaded.has(code)) return loaded.get(code).p;
    const rec = { state: 'loading', list: [] };
    rec.p = (async () => {
      const r = regs.get(code); if (!r) { rec.state = 'none'; return; }
      const [idx, kp, , data] = await Promise.all([Data.index(code), Data.kapt(code), namesP, Data.loadYears(code, Math.floor(CONFIG.PEAK_FROM / 10000), NOW_Y)]);
      const by = new Map();
      const get = (key) => {
        if (!by.has(key)) {
          const p = Data.parseKey(key);
          by.set(key, { id: `${code}|${key}`, code, key, sido: r[1], sgg: r[2], dong: p.dong, jibun: p.jibun, name: p.name,
            year: idx.c[key] || null, hh: (kp.m[key] && kp.m[key][0]) || null, dn: (kp.m[key] && kp.m[key][1]) || null, vl: Data.vlRat(kp, key), n5: 0, gs: new Map() });
          const ex = Data.extraOf(code, key), cx = by.get(key);
          if (ex) { cx.ex = ex; cx.addr = ex.addr; cx.year = cx.year || ex.year; }
        }
        return by.get(key);
      };
      for (const key of (names && names.r && names.r[code]) || []) get(key);
      const G = (cx, g) => { if (!cx.gs.has(g)) cx.gs.set(g, { g, sale: [], rent: [], n: 0 }); return cx.gs.get(g); };
      Data.eachTrade(data.sale, null, (key, t) => {
        const cx = get(key), x = G(cx, t.g);
        if (t.d >= D5) { x.n++; if (!t.direct) cx.n5++; }
        if (!t.direct) x.sale.push(t);
      });
      Data.eachTrade(data.rent, null, (key, t) => { const x = G(get(key), t.g); x.rent.push(t); if (t.d >= D5) x.n++; });
      for (const cx of by.values()) {
        cx.cls = {};
        for (const x of cx.gs.values()) {                       // 평형 구분마다 거래가 가장 많은 전용면적을 대표로
          const pc = Home.pyClass(x.g), cur = cx.cls[pc];
          if (!cur || x.n > cur.n || (x.n === cur.n && x.sale.length > cur.sale.length)) cx.cls[pc] = x;
        }
        for (const [pc, x] of Object.entries(cx.cls)) {
          x.sale.sort((a, b) => a.d - b.d); x.rent.sort((a, b) => a.d - b.d);
          cx.cls[pc] = { pc, g: x.g, n: x.n, last: x.sale[x.sale.length - 1] || null, rentLast: x.rent[x.rent.length - 1] || null, ...Data.peakTrough(x.sale) };
        }
        cx.pcs = PYC.map(p => p[0]).filter(pc => cx.cls[pc]);
        cx.main = cx.pcs.slice().sort((a, b) => cx.cls[b].n - cx.cls[a].n)[0] || null;
        cx.alias = (typeof Alias !== 'undefined' && Alias.of(code, cx.key)) || '';
        delete cx.gs;
      }
      rec.list = [...by.values()];
      rec.list.forEach(cx => cxs.set(cx.id, cx));
      rec.state = 'ok';
    })().catch(e => { console.error(e); rec.state = 'err'; });
    loaded.set(code, rec);
    return rec.p;
  }

  /* ═════════ 거르기 ═════════ */
  function passes(cx) {
    if (forced.has(cx.id)) return true;
    if (st.trk && !isEmph(cx)) return false;
    if (st.pys.length && !cx.pcs.some(pc => st.pys.includes(pc))) return false;
    if (st.hh && !cx.hh) { if (!st.unk) return false; }          // 세대수 모르는 단지: 숨기지 않고 흐리게 (필터 → 체크 해제하면 숨김)
    else if (st.hh && cx.hh < st.hh) return false;
    if (st.age && (!cx.year || NOW_Y - cx.year > st.age)) return false;
    return true;
  }
  const shown = () => [...cxs.values()].filter(cx => st.codes.includes(cx.code) && passes(cx));
  function focusPc(cx) {
    const m = st.pys.length ? cx.pcs.filter(pc => st.pys.includes(pc)) : [];
    return m.length ? m.slice().sort((a, b) => cx.cls[b].n - cx.cls[a].n)[0] : cx.main;
  }
  function refreshSets() {
    try { tracked = new Set(Tracking.all().map(it => `${it.code}|${it.key}`)); } catch (e) { tracked = new Set(); }
    try { lands = typeof Land !== 'undefined' ? new Set(Land.all().map(l => `${l.code}|${l.key}`)) : new Set(); } catch (e) { lands = new Set(); }
  }

  /* ═════════ 라벨 (모양은 js/labelkit.js · css/labels.css — 오른쪽 위 [🏷 라벨] 에서 바꿈) ═════════ */
  function labelData(cx) {
    const pc = focusPc(cx), c = pc && cx.cls[pc], last = c && c.last;
    const bd = (lands.has(cx.id) ? '<b class="lk-bd land">랜드마크</b>' : tracked.has(cx.id) ? '<b class="lk-bd mine" title="시세트래킹 단지">★</b>' : '')
      + (basket.some(b => b.id === cx.id) ? '<b class="lk-bd cmp">비교</b>' : '');
    return { id: cx.id, name: (cx.alias || '').split(',')[0].trim() || cx.name, year: cx.year, hh: cx.hh,
      py: c && c.g ? `${Math.floor(+c.g)}㎡` : '', pr: last ? last.price : null, chg: last && c.peak ? (last.price / c.peak.price - 1) * 100 : null,
      emph: isEmph(cx), on: !!(OL.cx && OL.cx.id === cx.id), badges: bd };
  }
  function place(cx) {
    const p = pos.get(cx.id); if (!p || !map) return;
    let o = ovs.get(cx.id);
    if (!o) {
      const el = document.createElement('div');
      el.addEventListener('mouseenter', () => { if (!isTouch()) showTip(cx, el, false); });
      el.addEventListener('mouseleave', () => { if (!isTouch() && !tipPin) hideSoon(); });
      el.addEventListener('click', (e) => { e.stopPropagation(); showTip(cx, el, true); outline(cx); });
      LabelKit.bind(el, 'start', cx.id, () => map, p);
      const ov = new kakao.maps.CustomOverlay({ position: KMap.LL(p), content: el, yAnchor: 1, xAnchor: 0.5, clickable: true, zIndex: 3 });
      o = { ov, el }; ovs.set(cx.id, o);
    }
    LabelKit.render(o.el, 'start', labelData(cx));
    o.el.style.opacity = st.hh && !cx.hh ? '0.5' : '';                 // 세대수 모름 → 흐리게
    o.el.title = st.hh && !cx.hh ? '세대수 모름 (필터에서 숨길 수 있음)' : '';
    if (!o.ov.getMap()) o.ov.setMap(map);
  }
  /** 라벨 설정·짧은 이름이 바뀌면 보이는 라벨만 다시 그림 */
  function relabel() { if (!map) return; for (const [id, o] of ovs) if (o.ov.getMap()) place(cxs.get(id)); declutterSoon(); }
  function redraw() {
    if (!map) return;
    refreshSets();
    const want = new Set(shown().map(cx => cx.id));
    for (const [id, o] of ovs) if (!want.has(id)) o.ov.setMap(null);
    for (const id of want) { const cx = cxs.get(id); if (pos.has(id)) place(cx); else enqueue(cx); }
    pump(); declutterSoon(); sideState(); autoRefreshSoon();
  }

  /* 위치 찾기: 강조 단지 → 화면 가운데 동 → 세대수 큰 순, 6개씩 동시에 */
  function enqueue(cx) { if (!cx.qd) { cx.qd = 1; queue.push(cx); } }
  function pump() {
    queue.sort((a, b) => (isEmph(b) - isEmph(a)) || ((b.dong === centerDong) - (a.dong === centerDong)) || ((b.hh || 0) - (a.hh || 0)));
    while (working < 6 && queue.length) {
      const cx = queue.shift(); working++;
      KMap.geocode(cx).then(p => { if (p) { pos.set(cx.id, p); if (st.codes.includes(cx.code) && passes(cx)) { place(cx); declutterSoon(); } } })
        .catch(() => {}).finally(() => { cx.qd = 0; working--; progress(); pump(); if (!queue.length && !working) autoRefreshSoon(); });
    }
    progress();
  }
  function progress() {
    const all = shown(), got = all.filter(cx => pos.has(cx.id)).length;
    if (queue.length || working) msg(`단지 위치 찾는 중… ${got.toLocaleString()}/${all.length.toLocaleString()}`);
    else msg(st.codes.length ? '' : '지도를 움직이면 그 지역 단지를 불러옵니다. (왼쪽 <b>지역</b>에서 골라도 됩니다)');
  }

  /* 겹치면 작은 점으로 (강조 단지·세대수 큰 단지 먼저) */
  function declutterSoon() { clearTimeout(declutterSoon.t); declutterSoon.t = setTimeout(declutter, 120); }
  function declutter() {
    if (!map) return;
    const lv = map.getLevel(), box = $('stMap').getBoundingClientRect();
    $('stWrap').dataset.lv = lv;
    const stg = LabelKit.stage('start', lv), ed = LabelKit.isEditing('start');   // 편집 중에는 늘 '가까이' 모양 (겹치면 점 — 확대해서 고치기)
    const items = [...ovs.entries()].filter(([, o]) => o.ov.getMap()).map(([id, o]) => ({ cx: cxs.get(id), o }))
      .sort((a, b) => (isEmph(b.cx) - isEmph(a.cx)) || ((b.cx.hh || 0) - (a.cx.hh || 0)));
    const placed = [];
    for (const { cx, o } of items) {
      o.el.classList.remove('mini');
      if (o.el.classList.contains('lk-hid')) { o.ov.setZIndex(ed ? 2 : 1); continue; }
      const sel = OL.cx && OL.cx.id === cx.id, big = sel || isEmph(cx);
      if (!big && st.mode === 'emph' && !o.el.classList.contains('lk-moved')) { o.el.classList.add('mini'); o.ov.setZIndex(1); continue; }
      // 멀리 볼 때(동그라미) · 중간 거리의 작은 단지(점)는 CSS 가 모양을 바꾸므로 겹침 계산을 하지 않음
      if (!big && (stg === 'far' || (stg === 'mid' && o.el.classList.contains('lk-small')))) { o.ov.setZIndex(1); continue; }
      const r = o.el.getBoundingClientRect();
      if (r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom) continue;
      const hit = !sel && !o.el.classList.contains('lk-moved') && placed.some(q => !(r.right < q.left + 2 || r.left > q.right - 2 || r.bottom < q.top + 2 || r.top > q.bottom - 2));
      if (hit) o.el.classList.add('mini'); else placed.push(r);
      o.ov.setZIndex(hit ? 1 : sel ? 9 : isEmph(cx) ? 6 : 4);
    }
  }

  /* ═════════ 마우스 올리면 나오는 창 (A: 한 평형씩 / B: 평형별 표) ═════════ */
  function tipBox() {
    let t = $('stTip');
    if (!t) {
      t = document.createElement('div'); t.id = 'stTip'; t.className = 'cxtip'; t.hidden = true;
      t.addEventListener('mouseenter', () => clearTimeout(tipTimer));
      t.addEventListener('mouseleave', () => { if (!tipPin) hideSoon(); });
      t.addEventListener('click', tipClick);
      document.body.appendChild(t);
    }
    return t;
  }
  function showTip(cx, el, pin) {
    clearTimeout(tipTimer);
    if (isTouch() && pop) { pop = ''; renderPop(); }              // 휴대폰: 단지 창을 열면 아래 펼침 창은 닫음
    const same = tip && tip.cx === cx;
    tip = { cx, el, pc: same ? tip.pc : focusPc(cx) };
    tipPin = pin || (same && tipPin);
    renderTip();
  }
  function hideSoon() { clearTimeout(tipTimer); tipTimer = setTimeout(hideTip, 280); }
  function hideTip() { tip = null; tipPin = false; const t = $('stTip'); if (t) t.hidden = true; }
  function stepPc(d) { if (!tip) return; const a = tip.cx.pcs, i = a.indexOf(tip.pc); if (a.length < 2) return; tip.pc = a[(i + d + a.length) % a.length]; renderTip(); }
  function renderTip() {
    const t = tipBox(); if (!tip) { t.hidden = true; return; }
    const { cx } = tip, sheet = isTouch();
    const head = `<div class="cxt-h"><b>${U.esc(nameOf(cx))}</b>${cx.alias ? `<small>${U.esc(cx.name)}</small>` : ''}<span class="grow"></span>${tipPin ? '<button class="cxt-x" data-a="close" title="닫기 (Esc)">✕</button>' : ''}</div>
      <div class="cxt-s">${[cx.year ? `${cx.year}년` : '', cx.hh ? `${cx.hh.toLocaleString()}세대${cx.ex && cx.ex.approx ? '(일반분양)' : ''}` : '세대수 모름', cx.year ? `${NOW_Y - cx.year}년차` : '', cx.ex ? (cx.ex.ym ? `🆕 ${String(cx.ex.ym).slice(2, 4)}.${String(cx.ex.ym).slice(4)} 입주${cx.ex.ym > NOW_YM ? ' 예정' : ''}` : '실거래 없음') : '', cx.vl ? `용적률 ${Math.round(cx.vl)}%` : '', lands.has(cx.id) ? '🏛 랜드마크' : '', tracked.has(cx.id) ? '⭐ 시세트래킹' : ''].filter(Boolean).join(' · ')}<br><small>${U.esc(cx.sgg)} ${U.esc(cx.dong)} ${U.esc(cx.jibun)}</small></div>`;
    let body = '';
    if (!cx.pcs.length) body = `<p class="cxt-none">${cx.ex ? '아직 실거래가 없는 단지입니다 (K-apt·청약홈 목록에서 보충).' : '2020년 이후 거래가 없습니다.'}</p>`;
    else if (st.tip === 'B') body = tableB(cx);
    else body = viewA(cx, tip.pc);
    const inB = basket.some(b => b.id === cx.id);
    const btns = `<div class="cxt-b"><button data-a="ol">경계 보기</button><button data-a="cx">단지 요약</button><button data-a="search">실거래</button><button data-a="trk">${tracked.has(cx.id) ? '⭐ 담김' : '☆ 시세트래킹'}</button><button data-a="cmp">${inB ? '비교에서 빼기' : '+ 비교 담기'}</button><button data-a="naver">네이버 부동산</button></div>`;
    t.innerHTML = head + body + (tipPin || sheet ? btns : `<div class="cxt-hint">누르면 고정·경계 보기 · ${st.tip === 'A' ? '← → 평형 바꾸기' : 'A/B 모양은 왼쪽 필터에서'}</div>`);
    t.className = 'cxtip' + (sheet ? ' sheet' : '') + (tipPin ? ' pin' : '') + (st.tip === 'B' ? ' wide' : '');
    t.hidden = false;
    if (!sheet) {
      const r = tip.el.getBoundingClientRect(), w = t.offsetWidth, h = t.offsetHeight;
      let x = r.left + r.width / 2 - w / 2, y = r.top - h - 8;
      if (y < 8) y = r.bottom + 8;
      x = Math.max(8, Math.min(window.innerWidth - w - 8, x)); y = Math.max(8, Math.min(window.innerHeight - h - 8, y));
      t.style.left = x + 'px'; t.style.top = y + 'px';
    } else { t.style.left = ''; t.style.top = ''; }
  }
  function viewA(cx, pc) {
    const c = cx.cls[pc] || cx.cls[cx.main], last = c.last, ref = last ? last.price : null;
    const drop = ref && c.peak ? (ref / c.peak.price - 1) * 100 : null, rise = ref && c.trough ? (ref / c.trough.price - 1) * 100 : null;
    const rent = c.rentLast, ratio = ref && rent ? rent.price / ref * 100 : null, gap = ref && rent ? ref - rent.price : null;
    const tabs = cx.pcs.length > 1 ? `<div class="cxt-t"><button data-a="prev" title="이전 평형 (←)">◀</button>${cx.pcs.map(p => `<button data-pc="${p}" class="${p === c.pc ? 'on' : ''}">${PYN[p]}</button>`).join('')}<button data-a="next" title="다음 평형 (→)">▶</button></div>` : '';
    return `${tabs}<div class="cxt-a"><div class="cxt-g">전용 ${c.g}㎡ (${CONFIG.toPyeong(c.g)}평)</div>
      <div><span>매매</span><b>${eok(last && last.price)}</b><small>${last ? ym(last.d) + ' 실거래' : ''}</small></div>
      <div><span>전세</span><b class="rent">${eok(rent && rent.price)}</b><small>${rent ? ym(rent.d) + ' 실거래' : ''}</small></div>
      <div><span>전고점</span><b>${eok(c.peak && c.peak.price)}</b><small>${c.peak ? ym(c.peak.d) : ''}</small><em class="${U.cls(drop)}">${drop == null ? '' : `지금 ${pct(drop)} ▼`}</em></div>
      <div><span>전저점</span>${c.trough ? `<b>${eok(c.trough.price)}</b><small>${ym(c.trough.d)}</small><em class="${U.cls(rise)}">지금 ${pct(rise)} ▲</em>` : c.peak ? '<b class="hot">🔥 신고가 중</b>' : '<b>-</b>'}</div>
      <div><span>전세가율</span><b>${ratio == null ? '-' : ratio.toFixed(0) + '%'}</b>${gap != null ? `<small>갭 ${eok(gap)}</small>` : ''}</div></div>`;
  }
  function tableB(cx) {
    const cell = (t, ref, sign) => {
      if (!t) return '<td>-</td><td></td>';
      const r = ref ? (ref / t.price - 1) * 100 : null;
      return `<td>${eok(t.price)}<small>${ym(t.d)}</small></td><td class="${U.cls(r)}">${pct(r)}${sign}</td>`;
    };
    const head = '<tr><th class="l">평형</th><th>최근 매매</th><th>전고점</th><th>대비</th><th>전저점</th><th>대비</th></tr>';
    const rows = cx.pcs.map(pc => {
      const c = cx.cls[pc], ref = c.last && c.last.price;
      const tr = c.trough ? cell(c.trough, ref, '▲') : c.peak ? '<td colspan="2" class="hot">🔥 신고가 중</td>' : '<td>-</td><td></td>';
      return `<tr class="${pc === cx.main ? 'main' : ''}${st.pys.includes(pc) ? ' sel' : ''}"><td class="l"><b>${PYN[pc]}</b><small>${c.g}㎡</small></td><td>${eok(ref)}${c.last ? `<small>${ym(c.last.d)}</small>` : ''}</td>${cell(c.peak, ref, '▼')}${tr}</tr>`;
    }).join('');
    const m = cx.cls[focusPc(cx)] || cx.cls[cx.main], rr = m && m.rentLast, ratio = m && m.last && rr ? rr.price / m.last.price * 100 : null;
    return `<table class="cxt-tb">${head}${rows}</table>${m ? `<div class="cxt-r">전세(${PYN[m.pc]}) ${eok(rr && rr.price)}${rr ? ` (${ym(rr.d)})` : ''} · 전세가율 ${ratio == null ? '-' : ratio.toFixed(0) + '%'}</div>` : ''}`;
  }
  function tipClick(e) {
    const pcb = e.target.closest('[data-pc]'); if (pcb && tip) { tip.pc = pcb.dataset.pc; tipPin = true; renderTip(); return; }
    const b = e.target.closest('[data-a]'); if (!b || !tip) { if (tip && !tipPin) { tipPin = true; renderTip(); } return; }
    const cx = tip.cx, g = (cx.cls[tip.pc] || cx.cls[cx.main] || {}).g || 0, a = b.dataset.a;
    const ref = { code: cx.code, key: cx.key, sido: cx.sido, sgg: cx.sgg, dong: cx.dong, jibun: cx.jibun, name: cx.name };
    if (a === 'close') return hideTip();
    if (a === 'prev') return stepPc(-1);
    if (a === 'next') return stepPc(1);
    if (a === 'ol') return outline(cx);
    if (a === 'cx') { hideTip(); return CxView.open(`${cx.id}#${g}`); }
    if (a === 'naver') return LandLink.open(cx.sgg, cx.dong, cx.name);
    if (a === 'search') { hideTip(); App.showTab('search'); return Search.openComplex(ref); }
    if (a === 'cmp') { toggleBasket(cx, g); return renderTip(); }
    if (a === 'trk') {
      if (!g) return U.toast('거래가 없어 평형을 정할 수 없습니다.');
      const n = Tracking.add([{ id: `${cx.id}#${g}`, code: cx.code, sido: cx.sido, sgg: cx.sgg, dong: cx.dong, jibun: cx.jibun, key: cx.key, name: cx.name, g, buildYear: cx.year }], TRK_FOLDER, true);
      U.toast(n ? `${cx.name} ${CONFIG.toPyeong(g)}평을 시세트래킹 '${TRK_FOLDER}' 폴더에 담았습니다.` : '이미 시세트래킹에 있는 단지·평형입니다.');
      tracked.add(cx.id); place(cx); renderTip();
    }
  }

  /* ═════════ 지역 ═════════ */
  function regionOfPoint(lat, lng) {
    return new Promise(res => {
      if (!geocoder) return res(null);
      geocoder.coord2RegionCode(lng, lat, (rs, s) => {
        if (s !== kakao.maps.services.Status.OK) return res(null);
        const b = rs.find(x => x.region_type === 'B') || rs[0]; if (!b) return res(null);
        let code = String(b.code || '').slice(0, 5);
        if (!regs.has(code)) {                                  // 코드가 다르면 이름으로 (시도 이름이 바뀐 곳 등)
          const n2 = String(b.region_2depth_name || '').replace(/\s/g, '');
          const hit = regList.filter(r => r[2].replace(/\s/g, '') === n2 || r[2].replace(/\s/g, '').endsWith(n2));
          code = hit.length === 1 ? hit[0][0] : (hit.find(r => String(b.region_1depth_name || '').slice(0, 2) === r[1].slice(0, 2)) || [])[0] || null;
        }
        res(code ? { code, dong: b.region_3depth_name || '' } : null);
      });
    });
  }
  async function addRegion(code) {
    if (!regs.has(code)) return;
    if (!st.codes.includes(code)) {
      st.codes.push(code);
      while (st.codes.length > MAX_REG) dropRegion(st.codes[0]);
      save();
    }
    if (!loaded.has(code) || loaded.get(code).state === 'loading') msg(`${U.esc(regs.get(code)[2])} 단지 불러오는 중…`);
    await loadRegion(code);
    redraw();
    if (pop === 'region') renderPop();
  }
  function dropRegion(code) {
    st.codes = st.codes.filter(c => c !== code);
    for (const cx of (loaded.get(code) || { list: [] }).list) { const o = ovs.get(cx.id); if (o) o.ov.setMap(null); }
  }
  function goRegion(code) {
    const r = regs.get(code); if (!r || !geocoder) return;
    geocoder.addressSearch(`${r[1]} ${r[2]}`, (list, s) => {
      if (s === kakao.maps.services.Status.OK && list.length) { map.setLevel(6); map.setCenter(new kakao.maps.LatLng(+list[0].y, +list[0].x)); }
    });
    addRegion(code);
  }

  /* 내 위치 */
  function myLocation(first) {
    if (!navigator.geolocation) { if (first) onIdle(); else U.toast('이 브라우저는 위치 찾기를 지원하지 않습니다.'); return; }
    msg('📍 내 위치 찾는 중… (브라우저가 위치 허용을 물으면 "허용")');
    navigator.geolocation.getCurrentPosition((p) => {
      const ll = { lat: p.coords.latitude, lng: p.coords.longitude };
      map.setLevel(5); map.setCenter(KMap.LL(ll));
      if (myDot) myDot.setMap(null);
      const el = document.createElement('div'); el.className = 'cxme'; el.title = '내 위치';
      myDot = new kakao.maps.CustomOverlay({ position: KMap.LL(ll), content: el, zIndex: 9 }); myDot.setMap(map);
      onIdle();
    }, () => { if (first) onIdle(); else U.toast('위치를 가져오지 못했습니다. 브라우저의 위치 허용을 확인하세요.'); }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
  }

  /* 지도를 멈추면: 위치 저장 → 가운데 지역 불러오기 → 레이어 새로 그리기 */
  function onIdle() {
    if (!map) return;
    const c = map.getCenter();
    st.view = { lat: c.getLat(), lng: c.getLng(), level: map.getLevel() }; save();
    declutterSoon();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(async () => {
      if (map.getLevel() <= 7) {
        const r = await regionOfPoint(c.getLat(), c.getLng());
        if (r) { centerDong = r.dong; if (!st.codes.includes(r.code) || !loaded.has(r.code)) addRegion(r.code); }
      }
      refreshLayers();
      olLabelsVis(); autoRefreshSoon();
    }, 450);
  }

  /* ═════════ 브이월드 (JSONP) · 도형 계산 도구(turf) ═════════ */
  let vwSeq = 0, turfP = null;
  function vw(params) {
    return new Promise((resolve, reject) => {
      const key = CONFIG.VWORLD_KEY || Store.get('apt.vworldKey', '');
      if (!key) return reject(new Error('브이월드 키가 없습니다. js/config.js 의 VWORLD_KEY 를 확인하세요.'));
      const cb = '__stvw' + (++vwSeq) + '_' + Date.now();
      const q = new URLSearchParams(Object.assign({ service: 'data', request: 'GetFeature', version: '2.0', format: 'json', crs: 'EPSG:4326', geometry: 'true', attribute: 'true', size: '1000', page: '1', key, domain: location.origin, callback: cb }, params));
      const s = document.createElement('script');
      const timer = setTimeout(() => { cleanup(); reject(new Error('브이월드 응답 시간 초과')); }, 15000);
      function cleanup() { clearTimeout(timer); delete window[cb]; s.remove(); }
      window[cb] = (data) => { cleanup(); resolve(data); };
      s.onerror = () => { cleanup(); reject(new Error('브이월드 요청 실패 (키·도메인 확인)')); };
      s.src = 'https://api.vworld.kr/req/data?' + q.toString();
      document.head.appendChild(s);
    });
  }
  function vwFeatures(d) {
    const r = d && d.response;
    if (!r) throw new Error('브이월드 응답 형식이 예상과 다릅니다');
    if (r.status === 'NOT_FOUND') return [];
    if (r.status !== 'OK') throw new Error('브이월드 오류: ' + JSON.stringify(r.error || r.status));
    return (r.result && r.result.featureCollection && r.result.featureCollection.features) || [];
  }
  async function vwAll(data, geomFilter, maxPage = 5) {
    let out = [];
    for (let page = 1; page <= maxPage; page++) {
      const d = await vw({ data, geomFilter, page: String(page) });
      out = out.concat(vwFeatures(d));
      if (page >= Number((d.response.page && d.response.page.total) || 1)) break;
    }
    return out;
  }
  function loadTurf() {
    if (window.turf) return Promise.resolve();
    return turfP || (turfP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@turf/turf@6.5.0/turf.min.js';
      s.onload = res; s.onerror = () => { turfP = null; rej(new Error('도형 계산 도구(turf)를 불러오지 못했습니다.')); };
      document.head.appendChild(s);
    }));
  }
  const boxOf = (b) => `BOX(${b[0]},${b[1]},${b[2]},${b[3]})`;
  function boxAround(p, r) {
    const dLat = r / 111000, dLng = r / (111000 * Math.cos(p.lat * Math.PI / 180));
    return [p.lng - dLng, p.lat - dLat, p.lng + dLng, p.lat + dLat];
  }
  function viewBox() { const b = map.getBounds(), sw = b.getSouthWest(), ne = b.getNorthEast(); return [sw.getLng(), sw.getLat(), ne.getLng(), ne.getLat()]; }
  function toPaths(geom) {
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    return polys.map(rings => rings.map(r => r.map(c => new kakao.maps.LatLng(c[1], c[0]))));
  }
  function drawPoly(geom, style) {
    return toPaths(geom).map(path => { const pg = new kakao.maps.Polygon(Object.assign({ path, map }, style)); return pg; });
  }
  const ptOf = (f) => { try { return turf.pointOnFeature(f); } catch (e) { return turf.centroid(f); } };
  const inside = (pt, poly) => { try { return turf.booleanPointInPolygon(pt, poly); } catch (e) { return false; } };
  const fid = (f) => String(f.id || (f.properties && f.properties.pnu) || JSON.stringify(f.geometry.coordinates).slice(0, 80));

  /* ═════════ 단지 경계선 + 동 번호 ═════════
     · 라벨을 누르거나 검색한 단지: 굵은 빨간 선 + 왼쪽 아래 조절 상자 (필지 추가/빼기)
     · 지도를 확대하면(필터의 "단지 경계 자동", 기본 레벨 3 이하) 화면 안 단지들의 경계를 저절로 (가는 선)
     · 한 번 구한 경계는 이번 접속 동안 기억 → 다시 와도 바로 그림. 건물 자료는 약 500m 칸 단위로 한 번만 받음 */
  const NAME_KEYS = ['buld_nm', 'bld_nm', 'bldg_nm', 'build_nm'];
  const DONG_KEYS = ['buld_nm_dc', 'dong_nm', 'bld_dong_nm', 'dongnm'];
  const FLOOR_KEYS = ['gro_flo_co', 'grnd_flr', 'ground_floor', 'flo_co'];
  const OL = { cx: null, data: null, view: null, manual: false, seq: 0 };
  const olCache = new Map();                  // 단지 id → Promise<{ parcels: Map, pool: Map, u, labels } | null>
  const tiles = new Map();                    // 건물 칸 → Promise<[건물]>
  const TILE = 0.005, AUTO_MAX = 20;
  const auto = new Map();                     // 단지 id → 저절로 그린 경계 { remove, vis }
  let autoSeq = 0;
  const pick = (p, keys) => { p = p || {}; for (const k of keys) if (p[k] != null && String(p[k]).trim() !== '') return String(p[k]).trim(); return ''; };
  // 이름 맞추기: 괄호·띄어쓰기·'아파트' 빼고, 영문 표기를 한글 읽기로 통일 (DMC = 디엠씨, e편한세상 = 이편한세상 …)
  const NM_VARIANTS = [[/dmc/g, '디엠씨'], [/sk/g, '에스케이'], [/lh/g, '엘에이치'], [/gs/g, '지에스'], [/kcc/g, '케이씨씨'], [/kb/g, '케이비'], [/e편한/g, '이편한'], [/ipark/g, '아이파크'], [/xi/g, '자이'], [/the/g, '더'], [/hillstate/g, '힐스테이트'], [/lotte/g, '롯데']];
  const normNm = (s) => NM_VARIANTS.reduce((t, [a, b]) => t.replace(a, b), String(s || '').replace(/\(.*?\)/g, '').replace(/\s/g, '').replace(/아파트|apt/gi, '').toLowerCase());
  const pnu = (f) => pick(f.properties, ['pnu']) || fid(f);
  function dongLabel(p) {
    let s = pick(p, DONG_KEYS);
    if (!s) { const m = pick(p, NAME_KEYS).match(/(\d{1,4})\s*동/); if (m) s = m[1] + '동'; }
    if (!s) return { text: '', apt: false };
    s = s.replace(/\s/g, '');
    let m = s.match(/^제?(\d{1,4})(동)?$/) || s.match(/(\d{1,4})동$/);
    if (m) return { text: m[1] + '동', apt: true };
    m = s.match(/^([A-Za-z가-하])동?$/);
    if (m) return { text: m[1] + '동', apt: true };
    return { text: s, apt: false };
  }
  function olMsg(h) { const el = $('stOlMsg'); if (el) el.innerHTML = h || ''; }
  function olBox() {
    const b = $('stOl'); b.hidden = !OL.cx;
    if (!OL.cx) return;
    $('stOlName').textContent = nameOf(OL.cx);
    $('stOther').checked = !!st.other;
    $('stManual').classList.toggle('on', OL.manual);
    $('stManual').textContent = OL.manual ? '필지 추가/빼기: 켜짐' : '필지 추가/빼기';
    olFixBtn();
  }
  function olFixBtn() { const b = $('stOlAuto'); if (b) b.hidden = !(OL.cx && fixOf(OL.cx.id)); }

  /* 건물 자료: 약 500m 칸으로 나눠 칸마다 한 번만 받기 */
  function tileBlds(tx, ty) {
    const k = tx + ',' + ty;
    if (!tiles.has(k)) tiles.set(k, (async () => {
      const box = boxOf([tx * TILE, ty * TILE, (tx + 1) * TILE, (ty + 1) * TILE]);
      let f = await vwAll('LT_C_SPBD', box, 3);
      if (!f.length) f = await vwAll('LT_C_BLDGINFO', box, 3);
      return f;
    })().catch(e => { tiles.delete(k); throw e; }));
    return tiles.get(k);
  }
  async function bldsNear(p, r) {
    const b = boxAround(p, r), out = new Map(), jobs = [];
    for (let tx = Math.floor(b[0] / TILE); tx <= Math.floor(b[2] / TILE); tx++)
      for (let ty = Math.floor(b[1] / TILE); ty <= Math.floor(b[3] / TILE); ty++) jobs.push(tileBlds(tx, ty));
    (await Promise.all(jobs)).forEach(list => list.forEach(f => out.set(fid(f), f)));
    return out;
  }

  /* 한 단지의 경계 구하기 (결과는 기억)
     ① 시작 필지: 실거래 주소(대표 지번) 필지 + 카카오 장소 검색 위치의 필지 (길로 나뉜 단지도 잡히게)
     ② 주변 건물: 세대수가 많을수록 넓게 (300세대 미만 300m · 500세대+ 450m · 1,000세대+ 600m)
     ③ 이 단지 건물 고르기: 이름 일치(영문·한글 표기 차이 무시) + 시작 필지 안 건물
     ④ 고른 건물이 서 있는 필지 + 시작 필지 → 단지 경계
     ⑤ 손으로 고친 필지(필지 추가/빼기)는 저장해 두었다가 늘 반영 (apt.olFix.v1) */
  const FIX_KEY = 'apt.olFix.v1';
  const fixOf = (id) => (Store.get(FIX_KEY, {}) || {})[id] || null;
  function saveFix(id, f) {
    const all = Store.get(FIX_KEY, {}) || {};
    if (f && ((f.add && f.add.length) || (f.del && f.del.length))) all[id] = f; else delete all[id];
    Store.set(FIX_KEY, all);
    const cc = Store.get(CKEY, {}) || {}; if (cc[id]) { delete cc[id]; Store.set(CKEY, cc); }      // 경계가 바뀌었으니 단지 중심도 다시 구함
  }
  const jimok = (f) => { const j = pick(f.properties, ['jibun']); const m = j.match(/([가-힣])\s*$/); return m ? m[1] : ''; };
  /** 카카오 장소 검색으로 단지 위치 (주소 위치에서 1km 안, 이름이 맞는 아파트만) */
  function kakaoSpot(cx, p) {
    return new Promise((res) => {
      if (!(window.kakao && kakao.maps.services)) return res(null);
      const target = normNm(cx.name), alias = normNm((cx.alias || '').split(',')[0]);
      // 이름이 같거나, 한쪽이 다른 쪽을 품되 남는 부분에 숫자(2단지·3차 등 다른 단지)가 없을 때만
      const same = (n, t) => n === t || (n.includes(t) && !/\d/.test(n.replace(t, ''))) || (n.length >= 4 && t.includes(n) && !/\d/.test(t.replace(n, '')));
      const ok = (pl) => { const n = normNm(pl.place_name); return n.length >= 2 && [target, alias].some(t => t && t.length >= 2 && same(n, t)) && /아파트|주거|주택/.test(pl.category_name || '') && +pl.distance <= 800; };
      const done = setTimeout(() => res(null), 6000);
      new kakao.maps.services.Places().keywordSearch(cx.name + ' 아파트', (list, stt) => {
        clearTimeout(done);
        const hit = stt === kakao.maps.services.Status.OK ? (list || []).find(ok) : null;
        res(hit ? { lat: +hit.y, lng: +hit.x } : null);
      }, { location: new kakao.maps.LatLng(p.lat, p.lng), radius: 1000, sort: kakao.maps.services.SortBy.DISTANCE });
    });
  }
  const parcelAt = (q) => vw({ data: 'LP_PA_CBND_BUBUN', geomFilter: `POINT(${q.lng} ${q.lat})` }).then(vwFeatures).then(f => f[0] || null);
  function computeOl(cx) {
    if (olCache.has(cx.id)) return olCache.get(cx.id);
    const pr = (async () => {
      const p = pos.get(cx.id); if (!p) return null;
      await loadTurf();
      const hh = cx.hh || 0, R = hh >= 1000 ? 600 : hh >= 500 ? 450 : 300, NEAR = R + 300;
      // ① 시작 필지 (카카오 위치가 주소 위치와 30m 넘게 떨어져 있을 때만 두 번째 시작점으로)
      const kp = await kakaoSpot(cx, p).catch(() => null);
      const pts = [p];
      if (kp && turf.distance(turf.point([p.lng, p.lat]), turf.point([kp.lng, kp.lat]), { units: 'meters' }) > 30) pts.push(kp);
      const [seedRaw, pools] = await Promise.all([Promise.all(pts.map(q => parcelAt(q).catch(() => null))), Promise.all(pts.map(q => bldsNear(q, R)))]);
      // 카카오 위치가 길·공원 위에 찍혔으면 그 필지는 쓰지 않음 (대지만)
      const seeds = seedRaw.filter((f, i) => f && (i === 0 || jimok(f) === '대' || !jimok(f)));
      const pool = new Map(); pools.forEach(m => m.forEach((v, k) => pool.set(k, v)));
      const heres = pts.map(q => turf.point([q.lng, q.lat]));
      const near = (pt) => Math.min(...heres.map(h => turf.distance(h, pt, { units: 'meters' })));
      // ③ 이 단지 건물 고르기
      const target = normNm(cx.name), alias = normNm(cx.alias);
      const info = [...pool.values()].map(b => ({ b, n: normNm(pick(b.properties, NAME_KEYS)), fl: Number(pick(b.properties, FLOOR_KEYS)) || 0, pt: ptOf(b) }));
      const nameHit = (n) => n.length >= 2 && [target, alias].some(t => t && (n.includes(t) || (n.length >= 4 && t.includes(n))));
      const selSet = new Set();
      info.forEach(x => { if (nameHit(x.n) && near(x.pt) <= NEAR) selSet.add(x); });
      info.forEach(x => { if (seeds.some(sp => inside(x.pt, sp))) selSet.add(x); });          // 시작 필지 안 건물은 늘 포함
      let sel = [...selSet];
      if (!sel.length) {
        const here = heres[0];
        const tall = info.filter(x => x.fl >= 5).map(x => ({ ...x, d: turf.distance(here, x.pt, { units: 'meters' }) })).sort((a, b) => a.d - b.d);
        if (tall.length && tall[0].n) sel = info.filter(x => x.n === tall[0].n && turf.distance(here, x.pt, { units: 'meters' }) <= 600); else sel = tall.filter(x => x.d <= 150);
      }
      // ③-2 동 수 보강: K-apt 동 수보다 적게 잡혔으면, 붙어 있는 건물을 '모자란 동 수만큼만' 가까운 순서로 더 넣기
      //      (건물 이름에 단지명이 없거나 비어 있어서 빠진 동을 찾기 위함 · 다른 단지 이름이 붙은 건물, 이미 있는 동 번호와 겹치는 건물은 제외)
      let grown = 0;
      if (cx.dn >= 3 && sel.length) {
        const dl = (x) => { const d = dongLabel(x.b.properties); return d.apt ? d.text : ''; };
        const labs = new Set(sel.map(dl).filter(Boolean));
        const have = labs.size || sel.filter(x => x.fl >= 5).length;
        let need = cx.dn - have;
        if (have >= 2 && need > 0) {
          const GAP = 150;                                              // 이미 잡힌 건물과 이만큼(m) 안에 붙어 있어야 함
          const dist = (a, b) => { const c = a.geometry.coordinates, e = b.geometry.coordinates; return Math.hypot((c[0] - e[0]) * Math.cos(c[1] * Math.PI / 180) * 111000, (c[1] - e[1]) * 111000); };
          const otherNm = (n) => { const rem = n.replace(/제?\d{1,4}동?/g, '').replace(/[a-z가-하]동$/, ''); return rem.length >= 2 && ![target, alias].some(t => t && (t.includes(rem) || rem.includes(t))); };
          const have0 = new Set(sel);
          const rest = info.filter(x => !have0.has(x) && x.fl >= 5 && !(dl(x) && labs.has(dl(x))) && !otherNm(x.n));
          const cur = sel.map(x => x.pt);
          while (need > 0 && rest.length) {
            let bi = -1, bd = GAP;
            rest.forEach((x, i) => { for (const q of cur) { const d = dist(x.pt, q); if (d < bd) { bd = d; bi = i; } } });
            if (bi < 0) break;
            const [x] = rest.splice(bi, 1);
            sel.push(x); cur.push(x.pt); if (dl(x)) labs.add(dl(x)); need--; grown++;
          }
        }
      }
      // ④ 고른 건물이 서 있는 필지 + 시작 필지 → 단지 경계
      const parcels = new Map();
      seeds.forEach(f => parcels.set(pnu(f), f));
      if (sel.length) {
        const bb = turf.bbox(turf.featureCollection(sel.map(x => x.b))), pad = 0.0002;
        const ps = await vwAll('LP_PA_CBND_BUBUN', boxOf([bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad]), 3);
        ps.forEach(pc => { if (sel.some(x => inside(x.pt, pc))) parcels.set(pnu(pc), pc); });
      }
      // ⑤ 손으로 고친 필지 반영
      const fx = fixOf(cx.id);
      if (fx) {
        (fx.del || []).forEach(k => parcels.delete(k));
        const added = await Promise.all((fx.add || []).map(a => parcelAt({ lng: a.p[0], lat: a.p[1] }).catch(() => null)));
        added.forEach(f => { if (f) parcels.set(pnu(f), f); });
        const extra = await Promise.all((fx.add || []).map(a => bldsNear({ lng: a.p[0], lat: a.p[1] }, 150).catch(() => new Map())));
        extra.forEach(m => m.forEach((v, k) => pool.set(k, v)));
      }
      return { parcels, pool, u: null, labels: null, fixed: !!fx, two: seeds.length > 1, grown };
    })().catch(e => { olCache.delete(cx.id); throw e; });
    olCache.set(cx.id, pr);
    return pr;
  }
  function unionAll(list) {
    let u = null;
    for (const f of list) {
      let g = f;
      try { g = turf.buffer(f, 0.5, { units: 'meters' }); } catch (e) { /* 그대로 */ }
      try { u = u ? turf.union(u, g) : g; } catch (e) { console.warn('합치기 실패', e); }
    }
    try { const s = u && turf.buffer(u, -0.5, { units: 'meters' }); if (s) u = s; } catch (e) { /* 그대로 */ }
    return u;
  }
  /* 경계 모양·동 번호 위치 계산 (필지가 바뀌면 다시) */
  function finalize(d) {
    const parcels = [...d.parcels.values()];
    d.u = parcels.length ? unionAll(parcels) : null;
    const bb = d.u ? turf.bbox(d.u) : null, seen = new Set();
    d.labels = [];
    if (!bb) return;
    for (const b of d.pool.values()) {
      const pt = ptOf(b), c = pt.geometry.coordinates;
      if (c[0] < bb[0] || c[0] > bb[2] || c[1] < bb[1] || c[1] > bb[3]) continue;
      if (!parcels.some(pc => inside(pt, pc))) continue;
      const lb = dongLabel(b.properties);
      if (!lb.text) { d.labels.push({ text: '', apt: false, c }); continue; }
      const k = lb.text + '@' + c[0].toFixed(4) + ',' + c[1].toFixed(4);
      if (seen.has(k)) continue; seen.add(k);
      d.labels.push({ ...lb, c });
    }
  }
  /* ═════════ 단지 중심 (시세지도 같은 다른 탭이 점을 단지 한가운데에 찍을 때 씀) ═════════
     · 단지 경계(필지 합친 모양)의 무게중심. 한가운데가 경계 밖(ㄱ자 단지 등)이면 경계 안의 가장 가까운 점
     · 브이월드 자료로 구한 값이라 저장해 둠 → 한 번 구하면 다음부터는 바로 (apt.cxCenter.v1)
     · 구하지 못했거나 주소 위치에서 400m 넘게 벗어나면 "못 구함"으로 적어 두고 7일 뒤 다시 시도 (주소 위치를 그대로 씀)
     · 네트워크·키 문제처럼 잠깐 안 되는 경우는 적어 두지 않고 10분만 쉼 */
  const CKEY = 'apt.cxCenter.v1', RETRY_MS = 7 * 864e5, PAUSE_MS = 10 * 60000, MAX_OFF = 400;
  const cenErr = new Map();
  const centers = () => Store.get(CKEY, {}) || {};
  /** 저장해 둔 중심 { lat, lng } (없으면 null) */
  function centerCached(id) { const c = centers()[id]; return c && c.lat != null ? { lat: c.lat, lng: c.lng } : null; }
  /** info = { code, key, name } · p = 주소로 찾은 위치 { lat, lng } → 단지 중심 { lat, lng } 또는 null */
  async function centerOf(info, p) {
    const id = `${info.code}|${info.key}`, hit = centers()[id];
    if (hit && hit.lat != null) return { lat: hit.lat, lng: hit.lng };
    if (hit && hit.x && Date.now() - hit.t < RETRY_MS) return null;
    if (cenErr.has(id) && Date.now() - cenErr.get(id) < PAUSE_MS) return null;
    if (!p) return null;
    let out = null;
    try {
      const kp = await Data.kapt(info.code), m = (kp && kp.m && kp.m[info.key]) || [];
      const cx = { id, code: info.code, key: info.key, name: info.name, alias: (typeof Alias !== 'undefined' && Alias.of(info.code, info.key)) || '', hh: info.hh || m[0] || null, dn: m[1] || null };
      if (!pos.get(id)) pos.set(id, p);
      const d = await computeOl(cx);
      if (d) {
        await loadTurf(); finalize(d);
        if (d.u) {
          let c = turf.centerOfMass(d.u);
          if (!inside(c, d.u)) c = turf.pointOnFeature(d.u);
          const [lng, lat] = c.geometry.coordinates;
          if (turf.distance(turf.point([p.lng, p.lat]), turf.point([lng, lat]), { units: 'meters' }) <= MAX_OFF) out = { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
        }
      }
    } catch (e) { cenErr.set(id, Date.now()); console.warn('단지 중심 계산 실패', id, e); return null; }
    const cur = centers(); cur[id] = out ? { ...out, t: Date.now() } : { x: 1, t: Date.now() }; Store.set(CKEY, cur);
    return out;
  }

  /* 그리기: strong = 고른 단지(굵게) / 아니면 저절로 그린 경계(가늘게) */
  function drawOl(d, strong) {
    if (!d.labels) finalize(d);
    const objs = d.u ? drawPoly(d.u.geometry, strong
      ? { strokeWeight: 3, strokeColor: '#e5322d', strokeOpacity: 1, fillColor: '#e5322d', fillOpacity: 0.08 }
      : { strokeWeight: 2, strokeColor: '#e5322d', strokeOpacity: 0.75, fillColor: '#e5322d', fillOpacity: 0.03 }) : [];
    const labs = d.labels.filter(l => l.text && (l.apt || st.other)).map(l => {
      const el = document.createElement('div'); el.className = 'st-dong' + (l.apt ? '' : ' other') + (strong ? '' : ' sm'); el.textContent = l.text;
      return new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(l.c[1], l.c[0]), content: el, yAnchor: 0.5, zIndex: strong ? 7 : 5 });
    });
    const g = {
      vis() { const on = !!map && map.getLevel() <= 4; labs.forEach(o => o.setMap(on ? map : null)); },
      remove() { objs.forEach(o => o.setMap(null)); labs.forEach(o => o.setMap(null)); },
    };
    g.vis();
    return g;
  }
  function olLabelsVis() { if (OL.view) OL.view.vis(); auto.forEach(g => g.vis()); }

  /* 고른 단지 (라벨 누르기·검색) */
  async function outline(cx) {
    if (!pos.get(cx.id)) return U.toast('이 단지의 위치를 아직 찾는 중입니다.');
    const prev = OL.cx;
    OL.seq++; const my = OL.seq;
    if (OL.view) OL.view.remove();
    OL.view = null; OL.data = null; OL.manual = false;
    OL.cx = cx; if (prev && prev !== cx) place(prev); place(cx);
    autoRemove(cx.id);
    olBox(); olMsg('경계 불러오는 중…');
    try {
      const d = await computeOl(cx);
      if (my !== OL.seq) return;
      if (!d) return olMsg('위치를 찾지 못했습니다.');
      OL.data = d; olShow(true);
      if (prev && prev !== cx) autoRefreshSoon();
    } catch (e) {
      console.error(e);
      if (my === OL.seq) olMsg(`<span class="warn">${U.esc(e.message || String(e))}</span>`);
    }
  }
  function olShow(fit) {
    if (OL.view) OL.view.remove();
    OL.view = null;
    const d = OL.data; if (!d) return;
    if (!d.labels) finalize(d);
    if (!d.parcels.size) { olMsg('경계를 찾지 못했습니다. <b>필지 추가/빼기</b>를 켜고 단지 땅을 눌러 보세요.'); return; }
    OL.view = drawOl(d, true);
    if (fit && d.u) {
      const bb = turf.bbox(d.u);
      map.setBounds(new kakao.maps.LatLngBounds(new kakao.maps.LatLng(bb[1], bb[0]), new kakao.maps.LatLng(bb[3], bb[2])), 80, 80, 80, 80);
      if (map.getLevel() > 3) map.setLevel(3);
    }
    const apt = d.labels.filter(l => l.apt).length, none = d.labels.filter(l => !l.text).length;
    olMsg(`필지 ${d.parcels.size}개 · 동 번호 ${apt}개${none ? ` · 이름 없는 건물 ${none}개` : ''}${d.grown ? ` · 동 수(${cx.dn}동) 맞추려고 ${d.grown}동 더 넣음` : ''}${d.fixed ? ' · <b>손으로 고친 경계</b>' : ''}${map.getLevel() > 4 ? ' · 확대하면 동 번호가 보입니다' : ''}`);
    olFixBtn();
    declutterSoon();
  }
  function olClear() {
    OL.seq++;
    if (OL.view) OL.view.remove();
    const prev = OL.cx;
    OL.view = null; OL.cx = null; OL.data = null; OL.manual = false;
    if (prev) place(prev);
    olBox(); declutterSoon(); autoRefreshSoon();
  }
  async function toggleParcel(latLng) {
    const d = OL.data; if (!d) return;
    const lng = latLng.getLng(), lat = latLng.getLat();
    try {
      await loadTurf();
      olMsg('필지 확인 중…');
      const f = vwFeatures(await vw({ data: 'LP_PA_CBND_BUBUN', geomFilter: `POINT(${lng} ${lat})` }));
      if (!f.length) return olMsg('이 위치의 필지를 찾지 못했습니다.');
      const pc = f[0], key = pnu(pc), id = OL.cx && OL.cx.id;
      const fx = (id && fixOf(id)) || { add: [], del: [] };
      fx.add = fx.add || []; fx.del = fx.del || [];
      if (d.parcels.has(key)) {
        d.parcels.delete(key);
        if (fx.add.some(a => a.k === key)) fx.add = fx.add.filter(a => a.k !== key); else if (!fx.del.includes(key)) fx.del.push(key);
      } else {
        d.parcels.set(key, pc); (await bldsNear({ lat, lng }, 150)).forEach((b, k) => d.pool.set(k, b));
        if (fx.del.includes(key)) fx.del = fx.del.filter(k => k !== key); else fx.add.push({ k: key, p: [+lng.toFixed(6), +lat.toFixed(6)] });
      }
      if (id) { saveFix(id, fx); d.fixed = !!fixOf(id); olFixBtn(); }      // 저장 → 새로고침해도 이 경계 그대로
      d.labels = null; d.u = null;                // 바뀐 필지로 다시 계산 (기억해 둔 결과에도 반영)
      if (OL.data === d) olShow(false);
    } catch (e) { olMsg(`<span class="warn">${U.esc(e.message || String(e))}</span>`); }
  }
  /* 동 번호(상가·관리동 표시) 설정이 바뀌면 다시 그리기 */
  function olRestyle() { if (OL.data) olShow(false); autoClear(); autoRefreshSoon(); }

  /* 확대하면 화면 안 단지들의 경계를 저절로 */
  function autoRemove(id) { const g = auto.get(id); if (g) { g.remove(); auto.delete(id); } }
  function autoClear() { [...auto.keys()].forEach(autoRemove); }
  function autoRefreshSoon() { clearTimeout(autoRefreshSoon.t); autoRefreshSoon.t = setTimeout(autoRefresh, 300); }
  async function autoRefresh() {
    if (!map) return;
    const my = ++autoSeq;
    if (!st.autoLv || map.getLevel() > st.autoLv) return autoClear();
    const b = viewBox(), c = map.getCenter();
    const cand = shown().filter(cx => { const p = pos.get(cx.id); return p && p.lng >= b[0] && p.lng <= b[2] && p.lat >= b[1] && p.lat <= b[3] && !(OL.cx && OL.cx.id === cx.id); })
      .map(cx => { const p = pos.get(cx.id); return { cx, d: Math.hypot(p.lat - c.getLat(), p.lng - c.getLng()) }; })
      .sort((a, z) => a.d - z.d).slice(0, AUTO_MAX).map(x => x.cx);
    const want = new Set(cand.map(cx => cx.id));
    [...auto.keys()].filter(id => !want.has(id)).forEach(autoRemove);
    const todo = cand.filter(cx => !auto.has(cx.id));
    for (let i = 0; i < todo.length; i += 3) {                  // 가까운 단지부터 3개씩
      await Promise.all(todo.slice(i, i + 3).map(async (cx) => {
        try {
          const d = await computeOl(cx);
          if (my !== autoSeq || !d || !d.parcels.size || auto.has(cx.id) || (OL.cx && OL.cx.id === cx.id)) return;
          auto.set(cx.id, drawOl(d, false));
        } catch (e) { console.warn('단지 경계', cx.name, e); }
      }));
      if (my !== autoSeq) return;
    }
  }

  /* ═════════ 위쪽 레이어 ═════════ */
  const LY = new Map();                                // k → Map(id → { remove })
  let lySeq = 0, supplyItems = null;
  const supplyGeo = new Map();                         // 이번 접속 동안만
  function poi(p, icon, name, sub, cls) {
    const el = document.createElement('div');
    el.className = 'st-poi ' + (cls || '');
    el.title = name + (sub ? ' · ' + sub : '');
    el.innerHTML = `<span>${icon}</span><b>${U.esc(name)}</b>${sub ? `<small>${U.esc(sub)}</small>` : ''}`;
    const ov = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(p.lat, p.lng), content: el, yAnchor: 0.5, xAnchor: 0.5, zIndex: 2 });
    ov.setMap(map);
    return { remove: () => ov.setMap(null) };
  }
  function lyClear(k) { const m = LY.get(k); if (m) { m.forEach(o => o.remove()); m.clear(); } }
  function lySync(k, list) {                         // list: [{ id, make: () => {remove} }]
    if (!LY.has(k)) LY.set(k, new Map());
    const m = LY.get(k), want = new Set(list.map(x => x.id));
    for (const [id, o] of m) if (!want.has(id)) { o.remove(); m.delete(id); }
    for (const x of list) if (!m.has(x.id)) { const o = x.make(); if (o) m.set(x.id, o); }
  }
  function kakaoAll(kind, q, bounds) {
    const S = kakao.maps.services;
    return new Promise(res => {
      const out = [];
      const cb = (data, s, pg) => {
        if (s === S.Status.OK) out.push(...data);
        if (s === S.Status.OK && pg && pg.hasNextPage && pg.current < 3) pg.nextPage(); else res(out);
      };
      if (kind === 'cat') places.categorySearch(q, cb, { bounds }); else places.keywordSearch(q, cb, { bounds });
    });
  }
  async function refreshLayers() {
    if (!map) return;
    const my = ++lySeq, lv = map.getLevel();
    for (const L of LAYERS) {
      const btn = document.querySelector(`#stLayers [data-ly="${L.k}"]`);
      const on = !!st.layers[L.k];
      if (btn) { btn.classList.toggle('on', on); btn.classList.toggle('far', on && lv > L.maxLv); }
      if (!on || lv > L.maxLv) { lyClear(L.k); continue; }
      try {
        if (L.type === 'cat') {
          const b = map.getBounds(), found = [];
          for (const c of L.codes) found.push(...await kakaoAll('cat', c, b));
          for (const w of L.kw || []) found.push(...(await kakaoAll('kw', w, b)).filter(x => /백화점/.test(x.category_name || '')));
          if (my !== lySeq || !st.layers[L.k]) return;
          const uniq = new Map(found.map(x => [x.id, x]));
          lySync(L.k, [...uniq.values()].map(x => ({ id: x.id, make: () => poi({ lat: +x.y, lng: +x.x }, L.icon, x.place_name, '', 'ly-' + L.k) })));
        } else if (L.type === 'supply') {
          await supplyLayer(my, L);
        } else if (L.type === 'vw') {
          await loadTurf();
          const feats = await vwAll(L.data, boxOf(viewBox()), 2);
          if (my !== lySeq || !st.layers[L.k]) return;
          lySync(L.k, feats.map(f => ({ id: fid(f), make: () => {
            const polys = drawPoly(f.geometry, { strokeWeight: L.k === 'sgg' ? 3 : 2, strokeColor: L.color, strokeOpacity: 0.85, strokeStyle: L.k === 'sgg' ? 'solid' : 'shortdash', fillOpacity: 0 });
            const nm = pick(f.properties, L.nm) || Object.entries(f.properties || {}).find(([k, v]) => /_nm$/.test(k) && v)?.[1] || '';
            let lab = null;
            if (nm) {
              const c = ptOf(f).geometry.coordinates, el = document.createElement('div');
              el.className = 'st-bnd ly-' + L.k; el.textContent = nm;
              lab = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(c[1], c[0]), content: el, zIndex: 1 }); lab.setMap(map);
            }
            return { remove: () => { polys.forEach(p => p.setMap(null)); if (lab) lab.setMap(null); } };
          } })));
        }
      } catch (e) { console.error(e); U.toast(`${L.name} 레이어: ${e.message || e}`); }
    }
  }
  async function supplyLayer(my, L) {
    if (!supplyItems) {
      const d = await Data.json('supply.json', null);
      const t = new Date(), now = t.getFullYear() * 100 + t.getMonth() + 1;
      supplyItems = ((d && d.items) || []).filter(it => it.mv && it.mv >= now && it.ad);
    }
    const b = viewBox();
    const list = supplyItems.filter(it => st.codes.includes(it.c));
    const geo = (it) => new Promise(res => {
      if (supplyGeo.has(it.id)) return res(supplyGeo.get(it.id));
      geocoder.addressSearch(it.ad, (r, s) => { const p = s === kakao.maps.services.Status.OK && r.length ? { lat: +r[0].y, lng: +r[0].x } : null; supplyGeo.set(it.id, p); res(p); });
    });
    const out = [];
    for (const it of list) {
      const p = await geo(it);
      if (my !== lySeq || !st.layers[L.k]) return;
      if (!p || p.lng < b[0] || p.lng > b[2] || p.lat < b[1] || p.lat > b[3]) continue;
      out.push({ id: it.id, make: () => poi(p, L.icon, it.nm, `${String(it.mv).slice(2, 4)}.${String(it.mv).slice(4)} 입주${it.hh ? ' · ' + it.hh.toLocaleString() + '세대' : ''}`, 'ly-supply') });
    }
    lySync(L.k, out);
  }

  /* ═════════ 단지 비교 바구니 ═════════ */
  function toggleBasket(cx, g) {
    const i = basket.findIndex(b => b.id === cx.id);
    if (i >= 0) basket.splice(i, 1);
    else {
      if (!g) return U.toast('거래가 없어 평형을 정할 수 없습니다.');
      if (basket.length >= 4) return U.toast('단지 비교는 최대 4개까지입니다. 왼쪽 단지비교에서 하나를 빼 주세요.');
      basket.push({ id: cx.id, code: cx.code, key: cx.key, g, name: nameOf(cx) });
      U.toast(`${nameOf(cx)} ${CONFIG.toPyeong(g)}평을 비교에 담았습니다. (${basket.length}/4)`);
    }
    place(cx); sideState(); if (pop === 'cmp') renderPop();
  }
  async function sendCompare() {
    if (!basket.length) return U.toast('담은 단지가 없습니다. 라벨 창의 [+ 비교 담기]로 담으세요.');
    if (typeof Compare === 'undefined') return U.toast('단지 비교 탭을 찾지 못했습니다.');
    const cur = Compare.getState(), n = (cur.slots || []).length || 4;
    const slots = Array.from({ length: n }, (_, i) => { const s = cur.slots && cur.slots[i]; return s && s.key ? { code: s.code, key: s.key, g: s.g } : null; });
    const add = basket.filter(b => !slots.some(s => s && s.code === b.code && s.key === b.key && +s.g === +b.g));
    const empty = slots.map((s, i) => (s ? -1 : i)).filter(i => i >= 0);
    let next;
    if (add.length <= empty.length) { next = slots.slice(); add.forEach((b, i) => { next[empty[i]] = { code: b.code, key: b.key, g: String(b.g) }; }); }
    else {
      if (!confirm(`단지 비교의 빈 칸이 ${empty.length}개뿐입니다.\n지금 비교 중인 단지를 비우고, 담은 ${basket.length}개로 바꿀까요?`)) return;
      next = basket.slice(0, n).map(b => ({ code: b.code, key: b.key, g: String(b.g) }));
    }
    hideTip(); App.showTab('compare');
    await Compare.setState({ ...cur, slots: Array.from({ length: n }, (_, i) => next[i] || { code: '', key: '', g: '' }) });
    U.toast(`단지 비교로 ${add.length}개를 보냈습니다.`);
  }

  /* ═════════ 검색 ═════════ */
  async function goTo(x) {
    const id = `${x.code}|${x.key}`;
    forced.add(id);
    await addRegion(x.code);
    const cx = cxs.get(id); if (!cx) return U.toast('단지 자료를 찾지 못했습니다.');
    let p = pos.get(id);
    if (!p) { p = await KMap.geocode(cx).catch(() => null); if (p) pos.set(id, p); }
    if (!p) return U.toast('이 단지의 위치를 찾지 못했습니다.');
    map.setLevel(3); map.setCenter(KMap.LL(p));
    redraw();
    setTimeout(() => { const o = ovs.get(id); if (o) showTip(cx, o.el, true); }, 450);
    outline(cx);
  }

  /* ═════════ 왼쪽 패널 · 펼침 창 ═════════ */
  function sideState() {
    const side = $('stSide'); if (!side) return;
    side.querySelector('[data-p="label"] small').textContent = st.mode === 'emph' ? '강조' : '기본';
    side.querySelector('[data-p="label"]').classList.toggle('on', st.mode === 'emph');
    side.querySelector('[data-p="trk"]').classList.toggle('on', !!st.trk);
    side.querySelector('[data-p="cmp"] small').textContent = basket.length ? `${basket.length}/4` : '단지비교';
    side.querySelector('[data-p="filter"]').classList.toggle('on', !!(st.hh !== 300 || st.age || st.pys.length));
    ['region', 'cmp', 'filter'].forEach(k => side.querySelector(`[data-p="${k}"]`).classList.toggle('open', pop === k));
    side.querySelectorAll('[data-py]').forEach(c => { c.checked = st.pys.includes(c.dataset.py); });
  }
  function seg(name, vals, cur) {
    return `<span class="seg">${vals.map(([v, t]) => `<button data-${name}="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</span>`;
  }
  function renderPop() {
    const p = $('stPop'); p.hidden = !pop; sideState();
    const w = $('stWrap'); if (w) w.classList.toggle('pop-open', !!pop);
    if (pop && isTouch() && tip) hideTip();                       // 휴대폰: 시트는 한 번에 하나만
    if (!pop) return;
    let h = '';
    if (pop === 'region') {
      const zone = p.dataset.zone || CONFIG.ZONES[0];
      const sidos = [...new Set(regList.filter(r => CONFIG.zoneOf(r[1]) === zone).map(r => r[1]))];
      const sido = sidos.includes(p.dataset.sido) ? p.dataset.sido : sidos[0];
      const subs = regList.filter(r => r[1] === sido);
      h = `<div class="st-ph"><b>지역</b><span class="grow"></span><button class="mini" data-close>✕</button></div>
        ${seg('zone', CONFIG.ZONES.map(z => [z, z]), zone)}
        <div class="st-row"><select id="stSido">${sidos.map(s => `<option${s === sido ? ' selected' : ''}>${U.esc(s)}</option>`).join('')}</select><button class="mini" data-me>📍 내 위치</button></div>
        <div class="st-gus">${subs.map(r => `<button data-go="${r[0]}" class="${st.codes.includes(r[0]) ? 'on' : ''}">${U.esc(r[2])}</button>`).join('')}</div>
        <div class="st-sub">불러온 지역 <small>(최대 ${MAX_REG}곳 · 지도를 옮기면 저절로 바뀜)</small></div>
        <div class="st-chips">${st.codes.map(c => { const r = regs.get(c); return r ? `<span class="hmchip">${U.esc(r[2])}<button data-rm="${c}" title="빼기">✕</button></span>` : ''; }).join('') || '<small class="hint">없음</small>'}</div>`;
    } else if (pop === 'cmp') {
      h = `<div class="st-ph"><b>단지비교</b><span class="grow"></span><button class="mini" data-close>✕</button></div>
        <p class="hint">라벨을 누르고 창의 <b>[+ 비교 담기]</b>로 최대 4개까지 담은 뒤 보내세요.</p>
        <ol class="st-bk">${basket.map((b, i) => `<li>${U.esc(b.name)} <small>${b.g}㎡ (${CONFIG.toPyeong(b.g)}평)</small><button class="mini" data-bk="${i}" title="빼기">✕</button></li>`).join('') || '<li class="hint">아직 담은 단지가 없습니다.</li>'}</ol>
        <div class="st-row"><button class="primary" data-send ${basket.length ? '' : 'disabled'}>단지 비교로 보내기</button><button class="mini" data-bkclear ${basket.length ? '' : 'disabled'}>비우기</button></div>`;
    } else if (pop === 'filter') {
      h = `<div class="st-ph"><b>필터</b><span class="grow"></span><button class="mini" data-close>✕</button></div>
        <div class="st-sub">세대수</div>${seg('hh', [[0, '전체'], [200, '200↑'], [300, '300↑'], [500, '500↑'], [1000, '1,000↑']], st.hh)}
        <label class="inline"><input type="checkbox" id="stUnk" ${st.unk ? 'checked' : ''}> 세대수 모르는 단지도 흐리게 보기</label>
        <div class="st-sub">연식</div>${seg('age', [[0, '전체'], [5, '5년↓'], [10, '10년↓'], [20, '20년↓'], [30, '30년↓']], st.age)}
        <div class="st-sub">마우스 올렸을 때 창</div>${seg('tip', [['A', 'A 한 평형씩'], ['B', 'B 평형별 표']], st.tip)}
        <div class="st-sub">단지 경계 자동 표시 <small>(지도를 이만큼 확대하면 화면 안 단지 경계가 저절로)</small></div>${seg('aol', [[0, '끄기'], [2, '많이 확대'], [3, '확대 (기본)'], [4, '조금 확대']], st.autoLv)}
        <div class="st-sub">단지 경계</div><label class="inline"><input type="checkbox" id="stOther2" ${st.other ? 'checked' : ''}> 상가·관리동 이름도 표시</label>
        <div class="st-sub st-mobonly">평형 <small>(여러 개 고를 수 있어요)</small></div>
        <span class="seg st-mobonly" id="stPyPick">${PY_PICK.map(p => `<button data-py="${p}" class="${st.pys.includes(p) ? 'on' : ''}">${p}</button>`).join('')}</span>
        <p class="hint st-deskonly">평형은 왼쪽 아래 59·74·84 체크로 고릅니다.</p>`;
    }
    p.innerHTML = h;
  }
  function onPopClick(e) {
    const t = e.target.closest('button'); if (!t) return;
    const d = t.dataset;
    if ('close' in d) { pop = ''; return renderPop(); }
    if (d.zone) { $('stPop').dataset.zone = d.zone; $('stPop').dataset.sido = ''; return renderPop(); }
    if ('me' in d) return myLocation(false);
    if (d.go) { goRegion(d.go); return renderPop(); }
    if (d.rm) { dropRegion(d.rm); save(); redraw(); return renderPop(); }
    if (d.bk) { basket.splice(+d.bk, 1); redraw(); return renderPop(); }
    if ('bkclear' in d) { basket = []; redraw(); return renderPop(); }
    if ('send' in d) return sendCompare();
    if (d.py) {
      st.pys = PY_PICK.filter(x => (x === d.py ? !st.pys.includes(x) : st.pys.includes(x))); save(); redraw();
      if (tip) { tip.pc = focusPc(tip.cx); renderTip(); }
      return renderPop();
    }
    if (d.hh != null) { st.hh = +d.hh; save(); redraw(); return renderPop(); }
    if (d.age != null) { st.age = +d.age; save(); redraw(); return renderPop(); }
    if (d.tip) { st.tip = d.tip; save(); if (tip) renderTip(); return renderPop(); }
    if (d.aol != null) { st.autoLv = +d.aol; save(); autoClear(); autoRefreshSoon(); if (st.autoLv && map && map.getLevel() > st.autoLv) U.toast('지도를 더 확대하면 단지 경계가 저절로 나옵니다.'); return renderPop(); }
  }
  function onPopChange(e) {
    if (e.target.id === 'stSido') { $('stPop').dataset.sido = e.target.value; return renderPop(); }
    if (e.target.id === 'stUnk') { st.unk = e.target.checked ? 1 : 0; save(); redraw(); return; }
    if (e.target.id === 'stOther2') { st.other = e.target.checked ? 1 : 0; save(); olBox(); olRestyle(); }
  }

  /* ═════════ 화면 만들기 ═════════ */
  function build() {
    $('tab-start').innerHTML = `<div class="st-wrap" id="stWrap">
      <div id="stMap" class="st-map"></div>
      <div class="st-top">
        <div class="st-search"><input id="stQ" type="search" placeholder="🔍 단지 이름 검색 (전국)" autocomplete="off"></div>
        <button type="button" class="st-lybtn" id="stLyBtn" title="학교·지하철·상권 같은 레이어 켜고 끄기">🗂 레이어<b id="stLyN"></b></button>
        <div class="st-layers" id="stLayers">${LAYERS.map(L => `<button data-ly="${L.k}" title="${U.esc(L.tip || L.name)} · 확대하면 보입니다"><span>${L.icon}</span>${L.name}</button>`).join('')}</div>
      </div>
      <div class="st-side" id="stSide">
        <button data-p="label" title="기본: 모든 단지 라벨 · 강조: 시세트래킹·랜드마크만 라벨, 나머지는 점"><span>🏷️</span>라벨<small>기본</small></button>
        <button data-p="trk" title="시세트래킹·랜드마크 단지만 보기"><span>⭐</span>트래킹</button>
        <button data-p="region" title="권역·시군구로 이동"><span>🗺️</span>지역</button>
        <button data-p="cmp" title="담은 단지를 단지 비교 탭으로"><span>📊</span><small>단지비교</small></button>
        <button data-p="filter" title="세대수·연식·창 모양"><span>🔧</span>필터</button>
        <div class="st-py"><b>평형</b>${PY_PICK.map(p => `<label><input type="checkbox" data-py="${p}"> ${p}</label>`).join('')}</div>
      </div>
      <div class="st-pop" id="stPop" hidden></div>
      <div class="st-ol" id="stOl" hidden>
        <div class="st-row"><b id="stOlName"></b><span class="hint" style="margin:0">경계</span><span class="grow"></span><button class="mini" id="stOlClear" title="경계 지우기">✕ 지우기</button></div>
        <div class="st-row"><label class="inline"><input type="checkbox" id="stOther"> 상가·관리동</label><button class="mini" id="stManual" title="켜고 지도에서 땅을 누르면 그 필지가 경계에 들어가거나 빠집니다 (고친 결과는 저장돼요)">필지 추가/빼기</button><button class="mini" id="stOlAuto" hidden title="손으로 고친 필지를 지우고 자동으로 찾은 경계로">↺ 자동 경계로</button></div>
        <div class="hint" id="stOlMsg"></div>
      </div>
      <button type="button" id="stLoc" class="cxmloc" title="내 위치로 이동"><span>◎</span><b>내 위치</b></button>
      <button type="button" id="stFull" class="cxmloc stfull" title="전체화면 — 위·아래 메뉴를 숨기고 지도만 크게 (다시 누르면 돌아옴)"><span>⛶</span><b>전체화면</b></button>
      <div class="st-msg" id="stMsg" hidden></div>
    </div>`;
    $('stLoc').addEventListener('click', () => myLocation(false));
    $('stFull').addEventListener('click', () => setFull(!full));
    $('stSide').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-p]'); if (!b) return;
      const k = b.dataset.p;
      if (k === 'label') { st.mode = st.mode === 'emph' ? 'basic' : 'emph'; save(); sideState(); return declutter(); }
      if (k === 'trk') { st.trk = st.trk ? 0 : 1; save(); return redraw(); }
      pop = pop === k ? '' : k; renderPop();
    });
    $('stSide').addEventListener('change', (e) => {
      const c = e.target.closest('[data-py]'); if (!c) return;
      st.pys = PY_PICK.filter(p => (p === c.dataset.py ? c.checked : st.pys.includes(p))); save(); redraw();
      if (tip) { tip.pc = focusPc(tip.cx); renderTip(); }
    });
    $('stLyBtn').addEventListener('click', () => { const top = document.querySelector('#stWrap .st-top'); top.classList.toggle('lyopen'); $('stLyBtn').classList.toggle('on', top.classList.contains('lyopen')); });
    $('stLayers').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ly]'); if (!b) return;
      const k = b.dataset.ly; st.layers[k] = st.layers[k] ? 0 : 1; save(); lyBadge();
      if (!st.layers[k]) lyClear(k);
      const L = LAYERS.find(x => x.k === k);
      if (st.layers[k] && map && map.getLevel() > L.maxLv) U.toast(`${L.name}은(는) 지도를 더 확대하면 보입니다.`);
      refreshLayers();
    });
    $('stPop').addEventListener('click', onPopClick);
    $('stPop').addEventListener('change', onPopChange);
    $('stOlClear').onclick = olClear;
    $('stOther').onchange = () => { st.other = $('stOther').checked ? 1 : 0; save(); olRestyle(); };
    $('stOlAuto').onclick = () => {
      const cx = OL.cx; if (!cx || !confirm(`${nameOf(cx)} 경계에서 손으로 고친 필지를 지우고 자동 경계로 되돌릴까요?`)) return;
      saveFix(cx.id, null); olCache.delete(cx.id); autoRemove(cx.id); outline(cx);
    };
    $('stManual').onclick = () => { OL.manual = !OL.manual; olBox(); if (OL.manual) olMsg('지도에서 단지 땅을 누르면 필지가 들어가거나 빠집니다.'); };
    if (typeof Finder !== 'undefined') Finder.attach($('stQ'), goTo);
  }

  /** 휴대폰 [레이어] 단추에 켜 둔 레이어 수 표시 */
  function lyBadge() { const el = $('stLyN'); if (el) el.textContent = Object.values(st.layers || {}).filter(Boolean).length || ''; }
  /* 전체화면: 맨 위 제목·메뉴줄과 아래 단추 줄을 숨기고 지도만 (홈 탭에서만. 다른 탭으로 가면 저절로 꺼짐) */
  let full = false;
  function setFull(on) {
    full = !!on;
    document.body.classList.toggle('st-full', full);
    const b = $('stFull');
    if (b) {
      b.classList.toggle('on', full);
      b.querySelector('span').textContent = full ? '✕' : '⛶';
      b.querySelector('b').textContent = full ? '전체화면 끄기' : '전체화면';
    }
    if (full) { if (pop) { pop = ''; renderPop(); } window.scrollTo(0, 0); }
    requestAnimationFrame(() => { fitHeight(); declutterSoon(); });
  }
  /* 지도 높이: 화면 아래 끝까지 */
  function fitHeight() {
    const w = $('stWrap'); if (!w || !visible()) return;
    const top = w.getBoundingClientRect().top + window.scrollY;
    w.style.height = Math.max(420, window.innerHeight - top - 6) + 'px';
    if (map) map.relayout();
  }

  async function open() {
    if (!inited) return;
    document.body.classList.toggle('st-full', full);
    fitHeight();
    if (map) { map.relayout(); redraw(); refreshLayers(); return; }
    if (!KMap.ready()) return msg(KMap.needKeyHtml);
    try { await KMap.load(); } catch (e) { return msg(U.esc(e.message || String(e))); }
    const v = st.view;
    map = KMap.create($('stMap'), v ? { lat: v.lat, lng: v.lng } : { lat: 37.5665, lng: 126.978 }, v ? v.level : 5);
    geocoder = new kakao.maps.services.Geocoder();
    places = new kakao.maps.services.Places();
    kakao.maps.event.addListener(map, 'idle', onIdle);
    kakao.maps.event.addListener(map, 'zoom_changed', () => { declutterSoon(); olLabelsVis(); if (st.autoLv && map.getLevel() > st.autoLv) autoClear(); });
    kakao.maps.event.addListener(map, 'click', (e) => { if (OL.manual) return toggleParcel(e.latLng); if (tipPin) hideTip(); if (pop) { pop = ''; renderPop(); } const tp = document.querySelector('#stWrap .st-top'); if (tp && tp.classList.contains('lyopen')) { tp.classList.remove('lyopen'); $('stLyBtn').classList.remove('on'); } });
    fitHeight();
    const saved = st.codes.slice(); st.codes = [];
    for (const c of saved) addRegion(c);
    if (!v) myLocation(true); else onIdle();
  }

  async function init() {
    if (!$('tab-start')) return;
    st = Object.assign({ ...DEF, codes: [], pys: [], layers: {} }, Store.get(SK, {}) || {});
    st.layers = st.layers || {};
    const R = await Data.regions(); regList = R; regs = new Map(R.map(r => [r[0], r]));
    namesP = Data.names().catch(() => null); namesP.then(n => { names = n; });   // 전국 이름 목록(1.7MB)은 기다리지 않고 뒤에서 받음 → 지도가 먼저 뜸
    st.codes = (st.codes || []).filter(c => regs.has(c));
    build();
    LabelKit.mount('start', { el: $('stMap'), host: $('stWrap') });
    LabelKit.on('start', relabel);
    inited = true;
    sideState(); lyBadge();
    document.addEventListener('keydown', (e) => {
      if (!visible()) return;
      if (e.key === 'Escape') { if (tip) hideTip(); else if (pop) { pop = ''; renderPop(); } else if (OL.manual) { OL.manual = false; olBox(); } else if (full) setFull(false); }
      if (tip && st.tip === 'A' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || '')) { e.preventDefault(); stepPc(e.key === 'ArrowLeft' ? -1 : 1); }
    });
    window.addEventListener('resize', () => { if (visible()) { fitHeight(); declutterSoon(); } });
    if (visible()) open();
  }
  function leave() { hideTip(); document.body.classList.remove('st-full'); }

  return { init, open, leave, centerOf, centerCached };
})();
