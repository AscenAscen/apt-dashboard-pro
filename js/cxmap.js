/* ─────────────────────────────────────────────────────────
   cxmap.js — [단지 지도] 탭 (첫 화면): 내가 고른 지역에 어떤 단지가 있는지 지도 라벨로 한눈에
   · 라벨: 단지명 · 연식 · 세대수 (👑 동별 대장 · 🆕 5년 이내 신축 · ⭐ 시세트래킹에 담은 단지)
   · 마우스를 올리면 창: A = 한 평형씩(◀▶) / B = 평형별 표(전고점·전저점 금액·날짜·%) — 라벨 누르면 📌 고정, 휴대폰은 아래서 올라오는 판
   · 처음엔 📍 내 위치 주변, 지도를 옮기면 옆 시군구도 저절로 불러옴
   · 단지 위치는 카카오 주소 검색을 그때그때 씀 (좌표는 저장하지 않음 — 카카오 약관). 한 번 찾은 위치는 이번 접속 동안만 기억
   · 전고점 = 2020년 이후 최고가, 전저점 = 전고점 이후 최저가 (Data.peakTrough, 직거래 제외)
   저장: apt.cxmap.v1 (지역·필터) · apt.cxmapStyle.v1 (라벨 꾸미기) · apt.cxmapPresets.v1 (내 프리셋)
   ───────────────────────────────────────────────────────── */
const CxMap = (() => {
  const $ = (id) => document.getElementById(id);
  const SK = 'apt.cxmap.v1', LK = 'apt.cxmapStyle.v1', PK = 'apt.cxmapPresets.v1';
  const PYC = [['s', '소형'], ['59', '59'], ['74', '74'], ['84', '84'], ['L', '대형']];
  const PYN = Object.fromEntries(PYC);
  const DEF = { codes: [], hide: [], pys: [], pr: 0, pyMin: '', pyMax: '', hh: 0, hhMin: '', hhMax: '', age: 0, ageMax: '', showAll: 0, mine: 0, auto: 1, view: null };
  const LDEF = { v: 2, mu: 0, tip: 'A', ds: 'white', s: 1, f: 15, ff: 'pretendard', th: 'navy', em: 'badge', bDate: 1, bAmt: 1, bPct: 1, bRent: 1, cap: 0 };
  const THEMES = { navy: '남색 (기본)', gold: '골드', green: '초록', coral: '산호', mono: '그레이' };
  const DESIGNS = { white: '화이트 카드 (기본)', dark: '다크 골드', bar: '컬러 바', card: '말풍선 카드', pill: '둥근 알약', fill: '색 채움', line: '테두리만', text: '글자만' };
  const NJ = 'https://cdn.jsdelivr.net/gh/projectnoonnu/';
  // 모두 상업용 무료 글꼴 (눈누 · 제작사 배포 주소 그대로). 고른 글꼴만 그때 불러옴
  const FONTS = [
    { k: '', name: '기본 글씨' },
    { k: 'pretendard', name: '프리텐다드', fam: "'Pretendard', system-ui, sans-serif", css: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css' },
    { k: 'isamanru', name: '이사만루체', fam: "'Isamanru', sans-serif", faces: [[500, 'https://cdn.jsdelivr.net/npm/@noonnu/gong-gothic-medium@0.1.0/fonts/gonggothicmedium-normal.woff', 'woff'], [800, 'https://cdn.jsdelivr.net/npm/@noonnu/gonggothicbold@0.0.1/GongGothicBold.woff', 'woff']] },
    { k: 'jamsil', name: '더잠실체', fam: "'TheJamsil', sans-serif", faces: [[400, NJ + 'noonfonts_2302_01@1.0/TheJamsil3Regular.woff2', 'woff2'], [500, NJ + 'noonfonts_2302_01@1.0/TheJamsil4Medium.woff2', 'woff2'], [700, NJ + 'noonfonts_2302_01@1.0/TheJamsil5Bold.woff2', 'woff2'], [800, NJ + 'noonfonts_2302_01@1.0/TheJamsil6ExtraBold.woff2', 'woff2']] },
    { k: 'gmarket', name: 'G마켓 산스', fam: "'GmarketSans', sans-serif", faces: [[500, NJ + 'noonfonts_2001@1.1/GmarketSansMedium.woff', 'woff'], [800, NJ + 'noonfonts_2001@1.1/GmarketSansBold.woff', 'woff']] },
    { k: 'scdream', name: '에스코어드림', fam: "'SCoreDream', sans-serif", faces: [[500, NJ + 'noonfonts_six@1.2/S-CoreDream-4Regular.woff', 'woff'], [800, NJ + 'noonfonts_six@1.2/S-CoreDream-6Bold.woff', 'woff']] },
    { k: 'suit', name: 'SUIT', fam: "'SUIT', sans-serif", css: 'https://cdn.jsdelivr.net/npm/@sun-typeface/suit@2.0.5/fonts/static/woff2/SUIT.css' },
    { k: 'noto', name: '노토산스', fam: "'Noto Sans KR', sans-serif", css: 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@500;700;800&display=swap' },
    { k: 'nanum', name: '나눔고딕', fam: "'Nanum Gothic', sans-serif", css: 'https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@700;800&display=swap' },
  ];
  const BUILTIN = {
    luxe: { name: '고급 (화이트)', v: { ds: 'white', th: 'navy', s: 1, f: 15, ff: 'pretendard', em: 'badge' } },
    dark: { name: '다크 골드', v: { ds: 'dark', th: 'gold', s: 1, f: 15, ff: 'pretendard', em: 'badge' } },
    field: { name: '임장용 (크게)', v: { ds: 'white', th: 'coral', s: 1.2, f: 17, ff: 'gmarket', em: 'badge' } },
    report: { name: '보고서용', v: { ds: 'bar', th: 'navy', s: 1, f: 14, ff: 'suit', em: 'badge' } },
    simple: { name: '간단히 (작게)', v: { ds: 'pill', th: 'navy', s: 0.9, f: 12, ff: '', em: 'badge' } },
  };
  const NOW_Y = new Date().getFullYear();
  const D5 = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 5); return U.ymd(d); })();
  const D12 = (() => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return U.ymd(d); })();
  const MIN_N5 = 5;                                 // 기본으로 숨기는 기준: 최근 5년 매매 5건 미만

  let st = {}, ls = {}, inited = false, opened = false, map = null, regs = null, regList = [], names = null, namesP = Promise.resolve(null), geocoder = null;
  const loaded = new Map();                         // 지역 코드 → { state, list:[cx] }
  const cxs = new Map();                            // 단지 id(code|key) → cx
  const ovs = new Map();                            // 단지 id → { ov, el }
  const pos = new Map();                            // 단지 id → {lat, lng} (이번 접속 동안만)
  let queue = [], working = 0, tip = null, tipPin = false, tipTimer = null, idleTimer = null, centerDong = '', f = null, tracked = new Set();
  const save = () => Store.set(SK, st);
  const saveL = () => Store.set(LK, ls);
  const visible = () => { const t = $('tab-cxmap'); return t && !t.hidden; };
  const isTouch = () => window.matchMedia('(max-width: 760px), (pointer: coarse)').matches;
  const eok = (v) => (v == null ? '-' : U.price(v));
  const ym = (d) => (d ? `${String(d).slice(2, 4)}.${String(d).slice(4, 6)}` : '');
  const pct = (v) => (v == null || !isFinite(v) ? '-' : (v > 0 ? '+' : '') + v.toFixed(1) + '%');

  /* ── 자료: 한 지역 불러와 단지마다 정리 ── */
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
            year: idx.c[key] || null, hh: (kp.m[key] && kp.m[key][0]) || null, n5: 0, gs: new Map(), ppa: [0, 0] });
        }
        return by.get(key);
      };
      for (const key of (names && names.r && names.r[code]) || []) get(key);
      const G = (cx, g) => { if (!cx.gs.has(g)) cx.gs.set(g, { g, sale: [], rent: [], n: 0 }); return cx.gs.get(g); };
      Data.eachTrade(data.sale, null, (key, t) => {
        const cx = get(key), x = G(cx, t.g);
        if (t.d >= D5) { x.n++; if (!t.direct) cx.n5++; }
        if (!t.direct) { x.sale.push(t); if (t.d >= D12 && t.area) { cx.ppa[0] += t.price / t.area; cx.ppa[1]++; } }
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
        cx.ppa12 = cx.ppa[1] ? cx.ppa[0] / cx.ppa[1] : null;
        cx.isNew = !!cx.year && NOW_Y - cx.year <= 5;
        cx.alias = Alias.of(code, cx.key) || '';
        cx.gList = [...cx.gs.values()].map(x => x.g);
        delete cx.gs; delete cx.ppa;
      }
      // 👑 동마다 대장: 200세대 이상 중 최근 1년 ㎡당 평균가 1위
      const lead = new Map();
      for (const cx of by.values()) if ((cx.hh || 0) >= 200 && cx.ppa12) { const b = lead.get(cx.dong); if (!b || cx.ppa12 > b.ppa12) lead.set(cx.dong, cx); }
      for (const cx of lead.values()) cx.leader = true;
      rec.list = [...by.values()];
      rec.list.forEach(cx => cxs.set(cx.id, cx));
      rec.state = 'ok';
    })().catch(e => { console.error(e); rec.state = 'err'; });
    loaded.set(code, rec);
    await rec.p;
    return rec.p;
  }

  /* ── 거르기 ── */
  const pyOf = (g) => CONFIG.toPyeong(g);
  const rangeOn = () => !!st.pr && (st.pyMin !== '' || st.pyMax !== '');
  const inRange = (py) => (st.pyMin === '' || py >= +st.pyMin) && (st.pyMax === '' || py <= +st.pyMax);
  const pyFilterOn = () => st.pys.length > 0 || rangeOn();
  /** 평형 조건(여러 개 · ○평~○평)에 맞는 평형 구분들 — 조건이 없으면 전부 */
  function matchPcs(cx) {
    return cx.pcs.filter(pc => (!st.pys.length || st.pys.includes(pc)) && (!rangeOn() || inRange(pyOf(cx.cls[pc].g))));
  }
  /** 창·표에서 먼저 보여 줄 평형: 조건에 맞는 것 중 거래가 가장 많은 것 */
  function focusPc(cx) {
    const m = pyFilterOn() ? matchPcs(cx) : [];
    return m.length ? m.slice().sort((a, b) => cx.cls[b].n - cx.cls[a].n)[0] : cx.main;
  }
  function passes(cx) {
    if (st.hide.includes(cx.id) && !st.showHidden) return false;
    const mine = tracked.has(cx.id);
    if (st.mine && !mine) return false;
    if (!st.showAll && !mine && cx.n5 < MIN_N5) return false;
    if (pyFilterOn() && !matchPcs(cx).length) return false;
    const hmin = st.hh === -1 ? +st.hhMin || 0 : st.hh, hmax = st.hh === -1 ? +st.hhMax || 0 : 0;
    if (hmin && (cx.hh || 0) < hmin) return false;
    if (hmax && (cx.hh || 0) > hmax) return false;
    const amax = st.age === -1 ? +st.ageMax || 0 : st.age;
    if (amax && (!cx.year || NOW_Y - cx.year > amax)) return false;
    return true;
  }
  const shown = () => [...cxs.values()].filter(cx => st.codes.includes(cx.code) && passes(cx));
  const nameOf = (cx) => cx.alias || cx.name;

  /* ── 라벨 ── */
  function labelHtml(cx) {
    const mine = tracked.has(cx.id), badge = ls.em === 'badge';
    const bd = badge ? (cx.leader ? '<b class="cxb lead">대장</b>' : '') + (cx.isNew ? '<b class="cxb new">NEW</b>' : '') + (mine ? '<b class="cxb mine" title="시세트래킹에 담은 단지">★</b>' : '') : '';
    const sub = [cx.year ? `'${String(cx.year).slice(2)}` : '', cx.hh ? `${cx.hh.toLocaleString()}세대` : ''].filter(Boolean).join(' · ');
    return `<div class="cxl-n">${U.esc(nameOf(cx))}${bd}</div>${sub ? `<div class="cxl-s">${sub}</div>` : ''}`;
  }
  function labelCls(cx) {
    return ['cxl', 'ds-' + ls.ds, 'th-' + ls.th, cx.leader ? 'lead' : '', cx.isNew ? 'new' : '', tracked.has(cx.id) ? 'mine' : '', ls.em !== 'badge' ? 'em-' + ls.em : ''].filter(Boolean).join(' ');
  }
  function lkData(cx) {
    const pc = focusPc(cx), c = pc && cx.cls[pc], last = c && c.last, mine = tracked.has(cx.id);
    const bd = (cx.leader ? '<b class="lk-bd lead">대장</b>' : '') + (cx.isNew ? '<b class="lk-bd new">NEW</b>' : '') + (mine ? '<b class="lk-bd mine" title="시세트래킹에 담은 단지">★</b>' : '');
    return { id: cx.id, name: (cx.alias || '').split(',')[0].trim() || cx.name, year: cx.year, hh: cx.hh,
      py: c && c.g ? `${Math.floor(+c.g)}㎡` : '', pr: last ? last.price : null, chg: last && c.peak ? (last.price / c.peak.price - 1) * 100 : null,
      emph: !!cx.leader, badges: bd, cls: st.hide.includes(cx.id) ? 'hid' : '' };
  }
  function place(cx) {
    const p = pos.get(cx.id); if (!p || !map) return;
    let o = ovs.get(cx.id);
    if (!o) {
      const el = document.createElement('div');
      el.addEventListener('mouseenter', () => { if (!isTouch()) showTip(cx, el, false); });
      el.addEventListener('mouseleave', () => { if (!isTouch() && !tipPin) hideSoon(); });
      el.addEventListener('click', (e) => { e.stopPropagation(); if (tipPin && tip && tip.cx === cx) { hideTip(); return; } showTip(cx, el, true); });
      LabelKit.bind(el, 'cxmap', cx.id, () => map);
      const ov = new kakao.maps.CustomOverlay({ position: KMap.LL(p), content: el, yAnchor: 1, xAnchor: 0.5, clickable: true, zIndex: cx.leader ? 5 : 2 });
      o = { ov, el }; ovs.set(cx.id, o);
    }
    if (LabelKit.isLK('cxmap')) LabelKit.render(o.el, 'cxmap', lkData(cx));       // 새 디자인 (🏷 라벨)
    else {                                                                          // 예전 디자인 (🎨 라벨 꾸미기)
      o.el.style.translate = '';
      o.el.className = labelCls(cx) + (st.hide.includes(cx.id) ? ' hid' : ''); o.el.innerHTML = labelHtml(cx);
      o.el.style.setProperty('--cxs', ls.s); o.el.style.setProperty('--cxf', ls.f + 'px');
    }
    if (!o.ov.getMap()) o.ov.setMap(map);
  }
  function relabel() { if (!map) return; for (const [id, o] of ovs) if (o.ov.getMap()) place(cxs.get(id)); declutterSoon(); }
  function redraw() {
    if (!map) return;
    tracked = new Set(Tracking.all().map(it => `${it.code}|${it.key}`));
    const want = new Set(shown().map(cx => cx.id));
    for (const [id, o] of ovs) if (!want.has(id)) o.ov.setMap(null);
    for (const id of want) { const cx = cxs.get(id); if (pos.has(id)) place(cx); else enqueue(cx); }
    pump(); declutterSoon(); drawList(); counts();
  }

  /* ── 위치 찾기: 화면 가운데 동부터, 거래 많은 단지부터, 여러 개 동시에 ── */
  function enqueue(cx) { if (!cx.qd) { cx.qd = 1; queue.push(cx); } }
  function pump() {
    queue.sort((a, b) => (b.dong === centerDong) - (a.dong === centerDong) || (b.leader ? 1 : 0) - (a.leader ? 1 : 0) || b.n5 - a.n5);
    while (working < 6 && queue.length) {
      const cx = queue.shift(); working++;
      KMap.geocode(cx).then(p => { if (p) { pos.set(cx.id, p); if (passes(cx) && st.codes.includes(cx.code)) { place(cx); declutterSoon(); } } })
        .catch(() => {}).finally(() => { working--; progress(); pump(); });
    }
    progress();
  }
  function progress() {
    const tot = shown().length, got = shown().filter(cx => pos.has(cx.id)).length, el = $('cxmMsg');
    if (!el) return;
    el.textContent = queue.length || working ? `단지 위치 찾는 중… ${got}/${tot}` : `${tot.toLocaleString()}개 단지${st.showAll ? '' : ` (최근 5년 매매 ${MIN_N5}건 미만 단지는 숨김)`}`;
  }

  /* ── 겹치면 작은 점으로 (중요한 단지 먼저: 대장·내 단지·세대수 큰 순) ── */
  function declutterSoon() { clearTimeout(declutterSoon.t); declutterSoon.t = setTimeout(declutter, 120); }
  function declutter() {
    if (!map) return;
    const lv = map.getLevel(), box = $('cxmMap').getBoundingClientRect();
    const mode = lv >= 8 ? 'dot' : lv >= 6 ? 'name' : 'full';
    $('cxmMap').dataset.zoom = mode;
    const lk = LabelKit.isLK('cxmap'), stg = LabelKit.stage('cxmap', lv), ed = lk && LabelKit.isEditing('cxmap');
    const items = [...ovs.entries()].filter(([, o]) => o.ov.getMap()).map(([id, o]) => ({ cx: cxs.get(id), o }))
      .sort((a, b) => (b.cx.leader - a.cx.leader) || (tracked.has(b.cx.id) - tracked.has(a.cx.id)) || ((b.cx.hh || 0) - (a.cx.hh || 0)) || (b.cx.n5 - a.cx.n5));
    const placed = [], z = (o, mini, cx) => { if (o.ov.setZIndex) o.ov.setZIndex(mini ? 1 : cx.leader ? 6 : 4); };   // 작은 점은 늘 라벨 아래
    for (const { cx, o } of items) {
      o.el.classList.remove('mini');
      const big = cx.leader || tracked.has(cx.id);
      if (lk) {
        if (o.el.classList.contains('lk-hid')) { z(o, !ed, cx); continue; }
        if (!big && (stg === 'far' || (stg === 'mid' && o.el.classList.contains('lk-small')))) { z(o, true, cx); continue; }   // 모양은 CSS 가 바꿈
      } else if (mode === 'dot' && !big) { o.el.classList.add('mini'); z(o, true, cx); continue; }
      const r = o.el.getBoundingClientRect();
      if (r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom) { z(o, false, cx); continue; }
      const hit = placed.some(q => !(r.right < q.left + 2 || r.left > q.right - 2 || r.bottom < q.top + 2 || r.top > q.bottom - 2));
      if (hit) o.el.classList.add('mini'); else placed.push(r);
      z(o, hit, cx);
    }
  }

  /* ── 창 (A: 한 평형씩 / B: 평형별 표) ── */
  function tipBox() {
    let t = $('cxTip');
    if (!t) {
      t = document.createElement('div'); t.id = 'cxTip'; t.className = 'cxtip'; t.hidden = true;
      t.addEventListener('mouseenter', () => clearTimeout(tipTimer));
      t.addEventListener('mouseleave', () => { if (!tipPin) hideSoon(); });
      t.addEventListener('click', tipClick);
      let sx = null;
      t.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
      t.addEventListener('touchend', (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 50) stepPc(dx < 0 ? 1 : -1); });
      document.body.appendChild(t);
    }
    return t;
  }
  function showTip(cx, el, pin) {
    clearTimeout(tipTimer);
    const same = tip && tip.cx === cx;
    tip = { cx, el, pc: same ? tip.pc : focusPc(cx) };
    tipPin = pin || (same && tipPin);
    renderTip();
  }
  function hideSoon() { clearTimeout(tipTimer); tipTimer = setTimeout(hideTip, 280); }
  function hideTip() { tip = null; tipPin = false; const t = $('cxTip'); if (t) t.hidden = true; }
  function stepPc(d) { if (!tip) return; const a = tip.cx.pcs, i = a.indexOf(tip.pc); if (a.length < 2) return; tip.pc = a[(i + d + a.length) % a.length]; renderTip(); }
  function quoteOf(cx, g) {
    const rec = Tracking.has(`${cx.id}#${g}`) ? Tracking.rec(`${cx.id}#${g}`) : null;
    return rec ? Kit.quote(rec) : null;
  }
  function renderTip() {
    const t = tipBox(); if (!tip) { t.hidden = true; return; }
    const { cx } = tip, sheet = isTouch();
    const head = `<div class="cxt-h"><b>${U.esc(nameOf(cx))}</b>${cx.alias ? `<small>${U.esc(cx.name)}</small>` : ''}<span class="grow"></span>${tipPin ? '<button class="cxt-x" data-a="close" title="닫기 (Esc)">✕</button>' : ''}</div>
      <div class="cxt-s">${[cx.year ? `${cx.year}년` : '', cx.hh ? `${cx.hh.toLocaleString()}세대` : '세대수 모름', cx.year ? `${NOW_Y - cx.year}년차` : '', cx.leader ? '👑 동 대장' : '', cx.isNew ? '🆕 신축' : '', tracked.has(cx.id) ? '⭐ 내 단지' : ''].filter(Boolean).join(' · ')}<br><small>${U.esc(cx.sgg)} ${U.esc(cx.dong)} ${U.esc(cx.jibun)}</small></div>`;
    let body = '';
    if (!cx.pcs.length) body = '<p class="cxt-none">2020년 이후 거래가 없습니다.</p>';
    else if (ls.tip === 'B') body = tableB(cx);
    else body = viewA(cx, tip.pc);
    const btns = `<div class="cxt-b"><button data-a="cx">단지 요약</button><button data-a="search">실거래</button><button data-a="trk">${tracked.has(cx.id) ? '⭐ 담김' : '☆ 시세트래킹'}</button><button data-a="naver">네이버 부동산</button>${typeof View3D !== 'undefined' ? '<button data-a="v3d" title="이 단지를 3D 탭에서 보기">3D</button>' : ''}<button data-a="hide" title="이 단지를 지도에서 숨김 (조건 줄에서 다시 보기)">${st.hide.includes(cx.id) ? '다시 보이기' : '숨기기'}</button></div>`;
    t.innerHTML = head + body + (tipPin || sheet ? btns : '<div class="cxt-hint">누르면 고정 · ' + (ls.tip === 'A' ? '← → 평형 바꾸기' : 'A/B 모양은 🎨 에서') + '</div>');
    t.className = 'cxtip' + (sheet ? ' sheet' : '') + (tipPin ? ' pin' : '') + (ls.tip === 'B' ? ' wide' : '');
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
    const rent = c.rentLast, ratio = ref && rent ? rent.price / ref * 100 : null, gap = ref && rent ? ref - rent.price : null, q = quoteOf(cx, c.g);
    const tabs = cx.pcs.length > 1 ? `<div class="cxt-t"><button data-a="prev" title="이전 평형 (←)">◀</button>${cx.pcs.map(p => `<button data-pc="${p}" class="${p === c.pc ? 'on' : ''}">${PYN[p]}</button>`).join('')}<button data-a="next" title="다음 평형 (→)">▶</button></div>` : '';
    return `${tabs}<div class="cxt-a"><div class="cxt-g">전용 ${c.g}㎡ (${CONFIG.toPyeong(c.g)}평)</div>
      <div><span>매매</span><b>${eok(last && last.price)}</b><small>${last ? ym(last.d) + ' 실거래' : ''}</small></div>
      <div><span>전세</span><b class="rent">${eok(rent && rent.price)}</b><small>${rent ? ym(rent.d) + ' 실거래' : ''}</small></div>
      <div><span>전고점</span><b>${eok(c.peak && c.peak.price)}</b><small>${c.peak ? ym(c.peak.d) : ''}</small><em class="${U.cls(drop)}">${drop == null ? '' : `지금 ${pct(drop)} ▼`}</em></div>
      <div><span>전저점</span>${c.trough ? `<b>${eok(c.trough.price)}</b><small>${ym(c.trough.d)}</small><em class="${U.cls(rise)}">지금 ${pct(rise)} ▲</em>` : c.peak ? '<b class="hot">🔥 신고가 중</b>' : '<b>-</b>'}</div>
      <div><span>전세가율</span><b>${ratio == null ? '-' : ratio.toFixed(0) + '%'}</b>${gap != null ? `<small>갭 ${eok(gap)}</small>` : ''}</div>
      ${q && (q.s != null || q.r != null) ? `<div class="cxt-q"><span>내 호가</span><b>매 ${eok(q.s)} · 전 ${eok(q.r)}</b><small>${Kit.ymText(q.ym)}</small></div>` : ''}</div>`;
  }
  function tableB(cx) {
    const D = ls.bDate, A = ls.bAmt, P = ls.bPct;
    const cell = (t, ref, sign) => {
      if (!t) return '<td>-</td>' + (P && A ? '<td></td>' : '');
      const r = ref ? (ref / t.price - 1) * 100 : null;
      const amt = A ? `${eok(t.price)}${D ? `<small>${ym(t.d)}</small>` : ''}` : '';
      return A && P ? `<td>${amt}</td><td class="${U.cls(r)}">${pct(r)}${sign}</td>` : P ? `<td class="${U.cls(r)}">${pct(r)}${sign}</td>` : `<td>${amt}</td>`;
    };
    const head = `<tr><th class="l">평형</th><th>최근 매매</th>${A && P ? '<th>전고점</th><th>대비</th><th>전저점</th><th>대비</th>' : '<th>전고점</th><th>전저점</th>'}</tr>`;
    const rows = cx.pcs.map(pc => {
      const c = cx.cls[pc], ref = c.last && c.last.price;
      const tr = c.trough ? cell(c.trough, ref, '▲') : c.peak ? `<td colspan="${A && P ? 2 : 1}" class="hot">🔥 신고가 중</td>` : '<td>-</td>' + (A && P ? '<td></td>' : '');
      return `<tr class="${pc === cx.main ? 'main' : ''}${pyFilterOn() && matchPcs(cx).includes(pc) ? ' sel' : ''}"><td class="l"><b>${PYN[pc]}</b><small>${c.g}㎡</small></td><td>${eok(ref)}${D && c.last ? `<small>${ym(c.last.d)}</small>` : ''}</td>${cell(c.peak, ref, '▼')}${tr}</tr>`;
    }).join('');
    const m = cx.cls[focusPc(cx)] || cx.cls[cx.main], rr = m && m.rentLast, ratio = m && m.last && rr ? rr.price / m.last.price * 100 : null;
    return `<table class="cxt-tb">${head}${rows}</table>${ls.bRent && m ? `<div class="cxt-r">전세(${PYN[m.pc]}) ${eok(rr && rr.price)}${rr && D ? ` (${ym(rr.d)})` : ''} · 전세가율 ${ratio == null ? '-' : ratio.toFixed(0) + '%'}</div>` : ''}`;
  }
  async function tipClick(e) {
    const pcb = e.target.closest('[data-pc]'); if (pcb && tip) { tip.pc = pcb.dataset.pc; tipPin = true; renderTip(); return; }
    const b = e.target.closest('[data-a]'); if (!b || !tip) { if (tip && !tipPin) { tipPin = true; renderTip(); } return; }
    const cx = tip.cx, g = (cx.cls[tip.pc] || cx.cls[cx.main] || {}).g || 0, a = b.dataset.a;
    if (a === 'close') return hideTip();
    if (a === 'prev') return stepPc(-1);
    if (a === 'next') return stepPc(1);
    if (a === 'cx') { hideTip(); return CxView.open(`${cx.id}#${g}`); }
    if (a === 'naver') return LandLink.open(cx.sgg, cx.dong, cx.name);
    if (a === 'v3d' && typeof View3D !== 'undefined') { hideTip(); App.showTab('v3d'); return View3D.show({ code: cx.code, key: cx.key, sido: cx.sido, sgg: cx.sgg, dong: cx.dong, jibun: cx.jibun, name: cx.name }); }
    if (a === 'hide') { st.hide = st.hide.includes(cx.id) ? st.hide.filter(x => x !== cx.id) : [...st.hide, cx.id]; save(); hideTip(); syncCtl(); return redraw(); }
    if (a === 'search') { hideTip(); App.showTab('search'); return Search.openComplex({ code: cx.code, key: cx.key, sido: cx.sido, sgg: cx.sgg, dong: cx.dong, jibun: cx.jibun, name: cx.name }); }
    if (a === 'trk') {
      if (!g) return U.toast('거래가 없어 평형을 정할 수 없습니다.');
      const n = Tracking.add([{ id: `${cx.id}#${g}`, code: cx.code, sido: cx.sido, sgg: cx.sgg, dong: cx.dong, jibun: cx.jibun, key: cx.key, name: cx.name, g, buildYear: cx.year }], '단지 지도', true);
      U.toast(n ? `${cx.name} ${CONFIG.toPyeong(g)}평을 시세트래킹 '단지 지도' 폴더에 담았습니다.` : '이미 시세트래킹에 있는 단지·평형입니다.');
      tracked.add(cx.id); place(cx); renderTip();
    }
  }

  /* ── 지역 ── */
  function regionOfPoint(lat, lng) {
    return new Promise(res => {
      if (!geocoder) return res(null);
      geocoder.coord2RegionCode(lng, lat, (rs, s) => {
        if (s !== kakao.maps.services.Status.OK) return res(null);
        const b = rs.find(x => x.region_type === 'B') || rs[0]; if (!b) return res(null);
        let code = String(b.code || '').slice(0, 5);
        if (!regs.has(code)) {                                  // 코드가 다르면 이름으로 (예: 시도 이름이 바뀐 곳)
          const n2 = String(b.region_2depth_name || '').replace(/\s/g, '');
          const hit = regList.filter(r => r[2].replace(/\s/g, '') === n2 || r[2].replace(/\s/g, '').endsWith(n2));
          code = hit.length === 1 ? hit[0][0] : (hit.find(r => String(b.region_1depth_name || '').slice(0, 2) === r[1].slice(0, 2)) || [])[0] || null;
        }
        res(code ? { code, dong: b.region_3depth_name || '' } : null);
      });
    });
  }
  async function addRegion(code, opt = {}) {
    if (!regs.has(code)) return;
    if (!st.codes.includes(code)) { st.codes.push(code); if (st.codes.length > 8) st.codes = st.codes.slice(-8); save(); }
    chips();
    $('cxmMsg').textContent = `${regs.get(code)[2]} 단지 불러오는 중…`;
    await loadRegion(code);
    redraw();
    if (opt.fit) fitTo(code);
  }
  function removeRegion(code) {
    st.codes = st.codes.filter(c => c !== code); save();
    for (const cx of (loaded.get(code) || { list: [] }).list) { const o = ovs.get(cx.id); if (o) o.ov.setMap(null); }
    chips(); redraw();
  }
  function fitTo(code) {
    const wait = () => {
      const pts = shown().filter(cx => cx.code === code && pos.has(cx.id)).map(cx => pos.get(cx.id));
      if (pts.length >= Math.min(8, shown().filter(cx => cx.code === code).length) && pts.length) KMap.fit(map, pts); else setTimeout(wait, 400);
    };
    setTimeout(wait, 300);
  }
  function chips() {
    $('cxmChips').innerHTML = st.codes.map(c => { const r = regs.get(c); return r ? `<span class="hmchip">${U.esc(r[2])}<button data-rm="${c}" title="빼기">✕</button></span>` : ''; }).join('')
      || '<span class="hint" style="margin:0">지역이 없습니다 — 📍 내 위치 또는 + 지역 추가</span>';
  }
  function regPop() {
    const p = $('cxmRegPop'), sidos = [...new Set(regList.map(r => r[1]))], cur = p.dataset.sido || '';
    const subs = cur ? regList.filter(r => r[1] === cur) : [];
    p.innerHTML = `<div class="hmpr"><select id="cxmSido"><option value="">시·도 고르기</option>${sidos.map(s => `<option${s === cur ? ' selected' : ''}>${U.esc(s)}</option>`).join('')}</select><span class="grow"></span><button class="mini" data-close="1">닫기</button></div>` +
      (subs.length ? `<div class="hmpr hmgus">${subs.map(r => `<label class="inline"><input type="checkbox" data-code="${r[0]}"${st.codes.includes(r[0]) ? ' checked' : ''}> ${U.esc(r[2])}</label>`).join('')}</div>` : '');
  }

  /* ── 내 위치 ── */
  function myLocation(first) {
    const msg = $('cxmMsg');
    if (!navigator.geolocation) { if (first) fallbackStart(); else U.toast('이 브라우저는 위치 찾기를 지원하지 않습니다.'); return; }
    msg.textContent = '📍 내 위치 찾는 중… (브라우저가 위치 허용을 물으면 "허용")';
    navigator.geolocation.getCurrentPosition(async (p) => {
      const ll = { lat: p.coords.latitude, lng: p.coords.longitude };
      map.setLevel(5); map.setCenter(KMap.LL(ll));
      if (myDot) myDot.setMap(null);
      const el = document.createElement('div'); el.className = 'cxme'; el.title = '내 위치';
      myDot = new kakao.maps.CustomOverlay({ position: KMap.LL(ll), content: el, zIndex: 9 }); myDot.setMap(map);
      const r = await regionOfPoint(ll.lat, ll.lng);
      if (r) { centerDong = r.dong; await addRegion(r.code); } else msg.textContent = '내 위치의 지역을 찾지 못했습니다. + 지역 추가로 골라 주세요.';
    }, () => { if (first) fallbackStart(); else U.toast('위치를 가져오지 못했습니다. 브라우저의 위치 허용을 확인하세요.'); }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
  }
  let myDot = null;
  function fallbackStart() {
    if (st.codes.length) { const c = st.codes.slice(); st.codes = []; c.forEach((code, i) => addRegion(code, { fit: i === c.length - 1 })); }
    else { $('cxmMsg').innerHTML = '위치를 쓸 수 없어 <b>+ 지역 추가</b>로 지역을 골라 주세요.'; $('cxmRegPop').hidden = false; regPop(); }
  }

  /* ── 아래 단지 표 ── */
  function cols() {
    const N = ColFilter.numCol, T = ColFilter.txtCol, M = (cx) => cx.cls[focusPc(cx)] || cx.cls[cx.main] || {};
    const last = (cx) => M(cx).last ? M(cx).last.price : null;
    return {
      gu: T('구', cx => cx.sgg), dong: T('동', cx => cx.dong), name: T('단지', cx => nameOf(cx)),
      year: N('연식', cx => cx.year), hh: N('세대수', cx => cx.hh), n5: N('5년 매매', cx => cx.n5),
      py: T('평형', cx => (M(cx).pc ? PYN[M(cx).pc] : '')), last: N('최근 매매', last),
      drop: N('전고 대비', cx => (last(cx) && M(cx).peak ? (last(cx) / M(cx).peak.price - 1) * 100 : null), 'pct'),
      rise: N('전저 대비', cx => (last(cx) && M(cx).trough ? (last(cx) / M(cx).trough.price - 1) * 100 : null), 'pct'),
    };
  }
  const F = () => f || (f = ColFilter.create({ key: 'cxm', cols, bar: 'cxmCfBar', onChange: drawList }));
  let listRows = [];
  function drawList() {
    if (!$('cxmList').open) { $('cxmListN').textContent = shown().length.toLocaleString(); return; }
    const c = cols(), b = (k) => F().btn(k);
    listRows = F().apply(shown(), (x) => [...x].sort((a, b2) => (b2.hh || 0) - (a.hh || 0) || b2.n5 - a.n5));
    $('cxmListN').textContent = listRows.length.toLocaleString();
    const th = (k, cls = '') => `<th class="${cls}">${c[k].label}${b(k)}</th>`;
    $('cxmTable').innerHTML = `<thead><tr>${th('gu', 'l')}${th('dong', 'l')}${th('name', 'l')}${th('year')}${th('hh')}${th('n5')}${th('py')}${th('last')}${th('drop')}${th('rise')}</tr></thead><tbody>` +
      listRows.slice(0, 600).map((cx, i) => { const v = (k) => c[k].num ? c[k].num(cx) : c[k].get(cx); const d = v('drop'), r = v('rise');
        return `<tr data-i="${i}" class="click"><td class="l">${U.esc(cx.sgg)}</td><td class="l">${U.esc(cx.dong)}</td><td class="l"><b>${cx.leader ? '👑' : ''}${cx.isNew ? '🆕' : ''}${U.esc(nameOf(cx))}</b></td><td>${cx.year || '-'}</td><td>${cx.hh ? cx.hh.toLocaleString() : '-'}</td><td>${cx.n5}</td><td>${U.esc(v('py'))}</td><td>${eok(v('last'))}</td><td class="${U.cls(d)}">${pct(d)}</td><td class="${U.cls(r)}">${pct(r)}</td></tr>`; }).join('') + '</tbody>';
  }
  function excel() {
    const c = cols(), ks = Object.keys(c);
    U.download(`단지지도_${st.codes.map(x => (regs.get(x) || [, , x])[2]).join('_')}`, [{ name: '단지 지도', rows: [ks.map(k => c[k].label), ...listRows.map(cx => ks.map(k => { const v = c[k].num ? c[k].num(cx) : c[k].get(cx); return k === 'drop' || k === 'rise' ? (v == null ? '' : +v.toFixed(1)) : v ?? ''; }))] }]);
  }
  function counts() { const n = shown().length; $('cxmListN').textContent = n.toLocaleString(); progress(); }

  /* ── 조건 줄 ── */
  function syncCtl() {
    const seg = (id, v) => document.querySelectorAll(`#${id} button`).forEach(b => b.classList.toggle('on', b.dataset.v === String(v)));
    document.querySelectorAll('#cxmPy button').forEach(b => { const v = b.dataset.v; b.classList.toggle('on', v === '' ? !st.pys.length && !st.pr : v === 'R' ? !!st.pr : st.pys.includes(v)); });
    $('cxmPyCustom').hidden = !st.pr; $('cxmPyMin').value = st.pyMin; $('cxmPyMax').value = st.pyMax;
    seg('cxmHh', st.hh); seg('cxmAge', st.age);
    $('cxmHhCustom').hidden = st.hh !== -1; $('cxmAgeCustom').hidden = st.age !== -1;
    $('cxmHhMin').value = st.hhMin; $('cxmHhMax').value = st.hhMax; $('cxmAgeMax').value = st.ageMax;
    $('cxmHidN').textContent = st.hide.length; $('cxmHidWrap').hidden = !st.hide.length; $('cxmShowHid').checked = !!st.showHidden;
    $('cxmAll').checked = !!st.showAll; $('cxmMine').checked = !!st.mine; $('cxmAuto').checked = !!st.auto;
    $('cxmCondSum').textContent = [st.pys.map(p => PYN[p]).join('·'), rangeOn() ? `${st.pyMin || ''}~${st.pyMax || ''}평` : '', st.hh === -1 ? `${st.hhMin || 0}~${st.hhMax || ''}세대` : st.hh ? `${st.hh}세대↑` : '', st.age === -1 ? `${st.ageMax}년↓` : st.age ? `${st.age}년↓` : '', st.mine ? '⭐ 내 단지만' : ''].filter(Boolean).join(' · ') || '전체 단지';
  }

  /* ── 🎨 라벨 꾸미기 ── */
  function useFont() {
    const ft = FONTS.find(x => x.k === ls.ff) || FONTS[0];
    if (ft.css && !document.querySelector(`link[data-cxfont="${ft.k}"]`)) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = ft.css; l.dataset.cxfont = ft.k; document.head.appendChild(l); }
    if (ft.faces && !document.querySelector(`style[data-cxfont="${ft.k}"]`)) {
      const fam = ft.fam.split(',')[0].replace(/'/g, ''), st2 = document.createElement('style'); st2.dataset.cxfont = ft.k;
      st2.textContent = ft.faces.map(([w, u, fmt]) => `@font-face{font-family:'${fam}';src:url('${u}') format('${fmt}');font-weight:${w};font-display:swap}`).join('\n');
      document.head.appendChild(st2);
    }
    $('cxmMap').style.setProperty('--cxff', ft.fam || 'inherit');
  }
  function styleUi() {
    const p = $('cxmStyle'), presets = Store.get(PK, {});
    const sel = (k, obj) => `<select data-ls="${k}">${Object.entries(obj).map(([v, n]) => `<option value="${v}"${String(ls[k]) === v ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
    const chk = (k, n) => `<label class="inline"><input type="checkbox" data-lc="${k}"${ls[k] ? ' checked' : ''}> ${n}</label>`;
    p.innerHTML = `<div class="cxs-row"><b>창 모양</b><span class="seg" id="cxmTipSeg"><button data-tip="A" class="${ls.tip === 'A' ? 'on' : ''}">A. 한 평형씩</button><button data-tip="B" class="${ls.tip === 'B' ? 'on' : ''}">B. 평형별 표</button></span></div>
      <div class="cxs-row" ${ls.tip === 'B' ? '' : 'hidden'}><b>B 표 칸</b>${chk('bAmt', '금액')}${chk('bPct', '%')}${chk('bDate', '날짜')}${chk('bRent', '전세 줄')}</div>
      <div class="cxs-row"><b>라벨 모양</b>${sel('ds', DESIGNS)}<b>색</b>${sel('th', THEMES)}</div>
      <div class="cxs-row"><b>크기</b><input type="range" min="0.7" max="1.6" step="0.05" data-lr="s" value="${ls.s}"><b>글자</b><input type="range" min="10" max="20" step="1" data-lr="f" value="${ls.f}"><span class="hint" style="margin:0">${(+ls.s).toFixed(2)}배 · ${ls.f}px</span></div>
      <div class="cxs-row"><b>글씨체</b>${sel('ff', Object.fromEntries(FONTS.map(x => [x.k, x.name])))}<span class="cxs-prev" style="font-family:${(FONTS.find(x => x.k === ls.ff) || FONTS[0]).fam || 'inherit'}">은평뉴타운 '10 · 486세대</span><b>강조 표시</b>${sel('em', { badge: '작은 뱃지 (대장·NEW·★)', color: '라벨 색 바꾸기', border: '굵은 테두리' })}${chk('mu', '지도 바탕 흐리게')}</div>
      <div class="cxs-row"><b>프리셋</b>${Object.entries(BUILTIN).map(([k, x]) => `<button class="mini" data-pre="${k}">${x.name}</button>`).join('')}${Object.keys(presets).map(n => `<span class="hmchip">${U.esc(n)}<button data-my="${U.esc(n)}" title="불러오기">↺</button><button data-del="${U.esc(n)}" title="지우기">✕</button></span>`).join('')}<button class="mini" data-savepre="1">＋ 지금 설정 저장</button></div>
      <div class="cxs-row"><button class="mini" data-cap="1">📷 깔끔하게 캡처 모드</button><button class="mini" data-reset="1">기본값으로</button><span class="hint" style="margin:0">캡처 모드: 버튼·조건 줄을 숨기고 지도와 라벨만 (Esc 로 돌아옴)</span></div>`;
  }
  function applyStyle(rerender = true) {
    useFont(); saveL(); $('cxmMap').classList.toggle('muted', !!ls.mu);
    for (const [id, o] of ovs) if (o.ov.getMap()) place(cxs.get(id));
    if (rerender) styleUi();
    declutterSoon(); if (tip) renderTip();
  }
  function capture(on) {
    ls.cap = on ? 1 : 0;
    document.body.classList.toggle('cxm-cap', !!on);
    if (map) { map.relayout(); if (map._zc) on ? map.removeControl(map._zc) : map.addControl(map._zc, kakao.maps.ControlPosition.RIGHT); }
    if (on) U.toast('캡처 모드: 화면을 캡처한 뒤 Esc 를 누르면 돌아옵니다.');
  }

  /* ── 시작 ── */
  async function makeMap() {
    const msg = $('cxmMsg');
    if (!KMap.ready()) { msg.innerHTML = KMap.needKeyHtml; return false; }
    try { await KMap.load(); } catch (e) { msg.textContent = e.message; return false; }
    const v = st.view || { lat: 37.5665, lng: 126.978, level: 8 };
    map = KMap.create($('cxmMap'), { lat: v.lat, lng: v.lng }, v.level || 8);
    geocoder = new kakao.maps.services.Geocoder();
    kakao.maps.event.addListener(map, 'idle', onIdle);
    kakao.maps.event.addListener(map, 'zoom_changed', () => { declutterSoon(); });
    kakao.maps.event.addListener(map, 'click', () => { if (tipPin) hideTip(); });
    kakao.maps.event.addListener(map, 'dragstart', () => { if (!tipPin) hideTip(); });
    return true;
  }
  function onIdle() {
    declutterSoon();
    if (tip && tipPin) renderTip();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(async () => {
      const c = map.getCenter(); st.view = { lat: c.getLat(), lng: c.getLng(), level: map.getLevel() }; save();
      if (!st.auto || map.getLevel() > 7) return;            // 너무 멀리 보면 자동으로 불러오지 않음
      const r = await regionOfPoint(c.getLat(), c.getLng());
      if (r) { centerDong = r.dong; if (!st.codes.includes(r.code)) addRegion(r.code); else pump(); }
    }, 700);
  }
  async function open() {
    if (!inited) return;
    if (!opened) {
      opened = true;
      if (!(await makeMap())) return;
      chips(); syncCtl(); $('cxmMap').classList.toggle('muted', !!ls.mu);
      myLocation(true);
      return;
    }
    if (map) { map.relayout(); declutterSoon(); }
  }

  async function init() {
    if (!$('tab-cxmap')) return;
    st = Object.assign({ ...DEF, codes: [], hide: [], pys: [] }, Store.get(SK, {}) || {});
    if (typeof st.py === 'string') { if (st.py && !st.pys.length) st.pys = [st.py]; delete st.py; }
    const sl = Store.get(LK, {}) || {};
    ls = sl.v === 2 ? Object.assign({ ...LDEF }, sl) : Object.assign({ ...LDEF }, { tip: sl.tip || 'A', bDate: sl.bDate ?? 1, bAmt: sl.bAmt ?? 1, bPct: sl.bPct ?? 1, bRent: sl.bRent ?? 1, mu: sl.mu || 0 });   // 예전 노란 라벨 → 새 고급 디자인
    ls.cap = 0;
    const R = await Data.regions(); regList = R; regs = new Map(R.map(r => [r[0], r]));
    namesP = Data.names().catch(() => null); namesP.then(n => { names = n; });   // 전국 이름 목록(1.7MB)은 기다리지 않고 뒤에서 받음 → 지도가 먼저 뜸
    st.codes = st.codes.filter(c => regs.has(c));
    inited = true;
    LabelKit.mount('cxmap', { el: $('cxmMap'), host: $('cxmMap').parentElement, moreLabel: '🎨 창 모양·예전 디자인 설정',
      more: () => { const p = $('cxmStyle'); p.hidden = false; styleUi(); p.scrollIntoView({ behavior: 'smooth', block: 'center' }); } });
    LabelKit.on('cxmap', relabel);
    // 조건 줄
    $('cxmPy').onclick = (e) => {                               // 여러 개 고르기 · [직접] = ○평~○평
      const b = e.target.closest('button'); if (!b) return; const v = b.dataset.v;
      if (v === '') { st.pys = []; st.pr = 0; } else if (v === 'R') st.pr = st.pr ? 0 : 1; else st.pys = st.pys.includes(v) ? st.pys.filter(x => x !== v) : [...st.pys, v];
      st.pys = PYC.map(p => p[0]).filter(p => st.pys.includes(p));
      save(); syncCtl(); redraw(); if (v === 'R' && st.pr) $('cxmPyMin').focus();
    };
    ['cxmPyMin', 'cxmPyMax'].forEach(id => { $(id).onchange = () => { st.pyMin = $('cxmPyMin').value.trim(); st.pyMax = $('cxmPyMax').value.trim(); save(); syncCtl(); redraw(); }; });
    $('cxmLoc2').onclick = () => myLocation(false);
    $('cxmHh').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.hh = +b.dataset.v; save(); syncCtl(); redraw(); };
    $('cxmAge').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.age = +b.dataset.v; save(); syncCtl(); redraw(); };
    ['cxmHhMin', 'cxmHhMax', 'cxmAgeMax'].forEach(id => { $(id).onchange = () => { st.hhMin = $('cxmHhMin').value; st.hhMax = $('cxmHhMax').value; st.ageMax = $('cxmAgeMax').value; save(); syncCtl(); redraw(); }; });
    $('cxmAll').onchange = () => { st.showAll = $('cxmAll').checked ? 1 : 0; save(); syncCtl(); redraw(); };
    $('cxmMine').onchange = () => { st.mine = $('cxmMine').checked ? 1 : 0; save(); syncCtl(); redraw(); };
    $('cxmAuto').onchange = () => { st.auto = $('cxmAuto').checked ? 1 : 0; save(); };
    $('cxmShowHid').onchange = () => { st.showHidden = $('cxmShowHid').checked ? 1 : 0; save(); redraw(); };
    $('cxmClearHid').onclick = () => { if (!confirm(`숨긴 단지 ${st.hide.length}곳을 모두 다시 보이게 할까요?`)) return; st.hide = []; st.showHidden = 0; save(); syncCtl(); redraw(); };
    $('cxmLoc').onclick = () => myLocation(false);
    $('cxmChips').onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) removeRegion(b.dataset.rm); };
    $('cxmAddReg').onclick = () => { const p = $('cxmRegPop'); p.hidden = !p.hidden; if (!p.hidden) regPop(); };
    $('cxmRegPop').onchange = (e) => {
      if (e.target.id === 'cxmSido') { $('cxmRegPop').dataset.sido = e.target.value; regPop(); return; }
      const c = e.target.dataset.code; if (!c) return;
      if (e.target.checked) addRegion(c, { fit: true }); else removeRegion(c);
    };
    $('cxmRegPop').onclick = (e) => { if (e.target.closest('[data-close]')) $('cxmRegPop').hidden = true; };
    // 단지 표
    $('cxmList').addEventListener('toggle', drawList);
    $('cxmExcel').onclick = excel;
    $('cxmTable').onclick = (e) => {
      const tr = e.target.closest('tr[data-i]'); if (!tr || e.target.closest('button.colf')) return;
      const cx = listRows[+tr.dataset.i], p = pos.get(cx.id);
      if (!p) return U.toast('이 단지의 위치를 아직 찾는 중입니다.');
      map.setLevel(Math.min(map.getLevel(), 4)); map.setCenter(KMap.LL(p));
      $('cxmMap').scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => { const o = ovs.get(cx.id); if (o) showTip(cx, o.el, true); }, 500);
    };
    // 꾸미기
    $('btnCxmStyle').onclick = () => { const p = $('cxmStyle'); p.hidden = !p.hidden; if (!p.hidden) styleUi(); };
    $('cxmStyle').addEventListener('click', (e) => {
      const t = e.target;
      if (t.dataset.tip) { ls.tip = t.dataset.tip; return applyStyle(); }
      if (t.dataset.pre) { Object.assign(ls, BUILTIN[t.dataset.pre].v); return applyStyle(); }
      if (t.dataset.my) { Object.assign(ls, Store.get(PK, {})[t.dataset.my] || {}); return applyStyle(); }
      if (t.dataset.del) { const ps = Store.get(PK, {}); delete ps[t.dataset.del]; Store.set(PK, ps); return styleUi(); }
      if (t.dataset.savepre) { const n = prompt('이 설정의 이름을 적어 주세요 (예: 임장 지도)'); if (!n) return; const ps = Store.get(PK, {}); const { cap, ...v } = ls; ps[n.trim()] = v; Store.set(PK, ps); U.toast(`'${n.trim()}' 프리셋을 저장했습니다.`); return styleUi(); }
      if (t.dataset.cap) return capture(true);
      if (t.dataset.reset) { ls = { ...LDEF }; return applyStyle(); }
    });
    $('cxmStyle').addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.ls) { ls[t.dataset.ls] = t.value; applyStyle(); }
      if (t.dataset.lc) { ls[t.dataset.lc] = t.checked ? 1 : 0; if (!ls.bAmt && !ls.bPct) { ls.bPct = 1; } applyStyle(); }
    });
    $('cxmStyle').addEventListener('input', (e) => { const t = e.target; if (t.dataset.lr) { ls[t.dataset.lr] = +t.value; applyStyle(false); const h = t.parentElement.querySelector('.hint'); if (h) h.textContent = `${(+ls.s).toFixed(2)}배 · ${ls.f}px`; } });
    document.addEventListener('keydown', (e) => {
      if (!visible()) return;
      if (e.key === 'Escape') { if (ls.cap) capture(false); else if (tip) hideTip(); }
      if (tip && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && ls.tip === 'A' && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || '')) { e.preventDefault(); stepPc(e.key === 'ArrowLeft' ? -1 : 1); }
    });
    document.addEventListener('click', (e) => { if (tipPin && tip && !e.target.closest('#cxTip') && !e.target.closest('.cxl')) hideTip(); });
    document.addEventListener('mousedown', (e) => { const p = $('cxmRegPop'); if (!p.hidden && !p.contains(e.target) && e.target.id !== 'cxmAddReg') p.hidden = true; });
    window.addEventListener('resize', () => { if (map && visible()) { map.relayout(); declutterSoon(); } });
    if (window.innerWidth <= 760) $('cxmCond').open = false;
    chips(); syncCtl();
    if (visible()) open();
  }
  return { init, open, _st: () => st, _ls: () => ls, _cx: (id) => cxs.get(id), _shown: shown, _pos: pos, _map: () => map, _tip: () => tip, _decl: declutter };
})();
