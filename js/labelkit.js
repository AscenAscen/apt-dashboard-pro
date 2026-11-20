/* ─────────────────────────────────────────────────────────
   labelkit.js — 모든 지도가 함께 쓰는 단지 라벨 (모양 · 설정 창 · 직접 고치기)
   · 디자인 4가지: A 2단 태그 · B 연식 블록 · C 한 줄 칩 · D 시세 카드  (모양은 css/labels.css)
   · 색 기준: 연식 / 세대수 / 입주 시기(공급) / 한 가지 색
   · 확대 단계: 멀리 = 세대수 크기 동그라미, 중간 = 이름만(작은 단지는 점), 가까이 = 전체 라벨
   · 지도마다 오른쪽 위 [🏷 라벨] 버튼 → 같은 모양의 설정 창
   · 직접 고치기(편집 모드): 끌어서 옮기기 · 짧은 이름 · 숨기기 · ★ 강조 · 원래대로
   쓰는 지도: 홈 · 단지 지도 · 공급지도 · 공급 · 입지 분석 · 인구이동 (시세지도·랜드마크는 js/maplabel.js 가 같은 디자인을 씀)
   저장: apt.labels.v1 (지도별 설정) · apt.labelEdits.v1 (단지별 짧은 이름·숨김·강조·위치) · apt.labelPresets.v1 (내 프리셋)
         세 값 모두 백업 파일과 자동 동기화(js/autosync.js)에 들어갑니다.
   ───────────────────────────────────────────────────────── */
const LabelKit = (() => {
  const SK = 'apt.labels.v1', EK = 'apt.labelEdits.v1', PK = 'apt.labelPresets.v1';
  const NOW_Y = new Date().getFullYear();
  const NJ = 'https://cdn.jsdelivr.net/gh/projectnoonnu/';
  // 글꼴 — 모두 상업용 무료 글꼴. 고른 글꼴만 그때 내려받습니다. (프리텐다드는 index.html 에서 처음부터 불러옴)
  const FONTS = [
    { k: 'pretendard', name: '프리텐다드 (기본)', fam: "'Pretendard', system-ui, sans-serif" },
    { k: 'suit', name: 'SUIT', fam: "'SUIT', sans-serif", css: 'https://cdn.jsdelivr.net/npm/@sun-typeface/suit@2.0.5/fonts/static/woff2/SUIT.css' },
    { k: 'gmarket', name: 'G마켓 산스', fam: "'GmarketSans', sans-serif", faces: [[500, NJ + 'noonfonts_2001@1.1/GmarketSansMedium.woff', 'woff'], [800, NJ + 'noonfonts_2001@1.1/GmarketSansBold.woff', 'woff']] },
    { k: 'scdream', name: '에스코어드림', fam: "'SCoreDream', sans-serif", faces: [[500, NJ + 'noonfonts_six@1.2/S-CoreDream-4Regular.woff', 'woff'], [800, NJ + 'noonfonts_six@1.2/S-CoreDream-6Bold.woff', 'woff']] },
    { k: 'jamsil', name: '더잠실체', fam: "'TheJamsil', sans-serif", faces: [[400, NJ + 'noonfonts_2302_01@1.0/TheJamsil3Regular.woff2', 'woff2'], [500, NJ + 'noonfonts_2302_01@1.0/TheJamsil4Medium.woff2', 'woff2'], [700, NJ + 'noonfonts_2302_01@1.0/TheJamsil5Bold.woff2', 'woff2'], [800, NJ + 'noonfonts_2302_01@1.0/TheJamsil6ExtraBold.woff2', 'woff2']] },
    { k: 'isamanru', name: '이사만루체', fam: "'Isamanru', sans-serif", faces: [[500, 'https://cdn.jsdelivr.net/npm/@noonnu/gong-gothic-medium@0.1.0/fonts/gonggothicmedium-normal.woff', 'woff'], [800, 'https://cdn.jsdelivr.net/npm/@noonnu/gonggothicbold@0.0.1/GongGothicBold.woff', 'woff']] },
    { k: 'noto', name: '노토산스', fam: "'Noto Sans KR', sans-serif", css: 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@500;700;800&display=swap' },
    { k: 'nanum', name: '나눔고딕', fam: "'Nanum Gothic', sans-serif", css: 'https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@700;800&display=swap' },
    { k: 'gowun', name: '고운돋움', fam: "'Gowun Dodum', sans-serif", css: 'https://fonts.googleapis.com/css2?family=Gowun+Dodum&display=swap' },
    { k: 'sys', name: '컴퓨터 기본 글씨', fam: "system-ui, 'Malgun Gothic', sans-serif" },
  ];
  const DESIGNS = [['tag', 'A 2단 태그'], ['block', 'B 연식 블록'], ['chip', 'C 한 줄 칩'], ['price', 'D 시세 카드']];
  const ITEMS = {
    cx: [['yr', '연식'], ['hh', '세대수'], ['py', '평형'], ['pr', '최근 실거래'], ['chg', '전고점 대비']],
    sup: [['yr', '입주 연월'], ['hh', '세대수']],
  };
  const CMS = { cx: [['age', '연식'], ['hh', '세대수'], ['one', '한 가지 색']], sup: [['move', '입주 시기'], ['hh', '세대수'], ['one', '한 가지 색']] };
  const COL = {
    age: [['#6d28d9', '5년 이내'], ['#2563eb', '6~10년'], ['#0f8a6a', '11~20년'], ['#8a8f98', '20년 넘음'], ['#e5322d', '입주 예정']],
    move: [['#e5322d', '올해 입주'], ['#d97706', '내년 입주'], ['#6d5bd0', '내후년 이후'], ['#8a8f98', '입주 완료']],
    hh: [['#1f2a44', '1,000세대 이상'], ['#2563eb', '500~999'], ['#0f8a6a', '300~499'], ['#8a8f98', '300 미만']],
  };
  // 지도 목록. kind: cx = 기존 단지 · sup = 입주(공급) 단지 · poi = 시설·거리 이름표 · bubble = 지역 동그라미 · ext = 자기 설정 창이 따로 있음
  const MAPS = {
    start: { name: '홈', kind: 'cx', edit: 1 },
    cxmap: { name: '단지 지도', kind: 'cx', edit: 1, legacy: '예전 디자인 (🎨 라벨 꾸미기 설정대로)' },
    supplymap: { name: '공급지도', kind: 'sup', edit: 1, legacy: '예전 디자인 (🎨 라벨 꾸미기 설정대로)' },
    supply: { name: '공급', kind: 'sup', edit: 1 },
    infra: { name: '입지 분석', kind: 'poi' },
    migration: { name: '인구이동', kind: 'bubble' },
    map: { name: '시세지도', kind: 'ext' },
    land: { name: '랜드마크', kind: 'ext' },
  };
  const DEF = { ds: 'tag', it: ['yr', 'hh'], cm: 'age', oc: '#2563eb', s: 1, f: 13, ff: 'pretendard', zm: 1, du: 300, lg: 1 };
  const DEF_BY = { supplymap: { cm: 'move', du: 0 }, supply: { cm: 'move', du: 0 }, infra: { f: 12 }, migration: { f: 11 } };
  const BUILTIN = [
    { k: 'field', name: '임장용 (크게)', v: { ds: 'tag', s: 1.2, f: 15, ff: 'gmarket' } },
    { k: 'report', name: '보고서용', v: { ds: 'block', s: 1, f: 13, ff: 'suit' } },
    { k: 'simple', name: '간단히 (작게)', v: { ds: 'chip', s: 0.9, f: 12, ff: 'pretendard', it: ['hh'] } },
    { k: 'price', name: '시세 보기', v: { ds: 'price', s: 1, f: 13, ff: 'pretendard', it: ['py', 'pr', 'chg'] } },
  ];

  let store = Store.get(SK, null) || { maps: {}, link: 0 };
  let edits = Store.get(EK, null) || {};
  const subs = new Map();            // 지도 → [다시 그리기 함수]
  const mounts = new Map();          // 지도 → { host, btn, panel, legend, opt }
  const editing = new Set();         // 지금 편집 모드인 지도
  const fontLoaded = new Set(['pretendard', 'sys']);
  const esc = (s) => U.esc(s);

  /* ═══ 설정 ═══ */
  const kindOf = (m) => (MAPS[m] || {}).kind || 'cx';
  function get(m) {
    const s = { ...DEF, ...(DEF_BY[m] || {}), ...((store.maps || {})[m] || {}) };
    if (!Array.isArray(s.it)) s.it = DEF.it.slice();
    if (!MAPS[m] || !MAPS[m].legacy) { if (s.ds === 'legacy') s.ds = 'tag'; }
    if (!(CMS[kindOf(m)] || []).some(c => c[0] === s.cm)) s.cm = (CMS[kindOf(m)] || [['age']])[0][0];
    return s;
  }
  const saveStore = () => Store.set(SK, store);
  /** 이 지도 설정 바꾸기. 모든 지도에 똑같이 적용이 켜져 있으면 맞는 지도마다 함께 바꿈 */
  function set(m, patch, opt = {}) {
    store.maps = store.maps || {};
    const targets = (opt.all ?? store.link) ? Object.keys(MAPS).filter(k => k === m || fits(k, patch)) : [m];
    for (const k of targets) {
      const p = k === m ? patch : pick(k, patch);
      if (!Object.keys(p).length) continue;
      store.maps[k] = { ...(store.maps[k] || {}), ...p };
    }
    saveStore();
    targets.forEach(fire);
  }
  // 다른 종류의 지도에는 맞는 값만 옮김 (예: 인구이동에는 크기·글꼴만)
  function pick(k, patch) {
    const kd = kindOf(k), out = {};
    if (kd === 'ext') return out;
    for (const [key, v] of Object.entries(patch)) {
      if (['s', 'f', 'ff'].includes(key)) out[key] = v;
      else if (kd === 'cx' || kd === 'sup') {
        if (key === 'ds') { if (v !== 'legacy' || MAPS[k].legacy) out[key] = v; }
        else if (key === 'it') out[key] = v.filter(x => ITEMS[kd].some(i => i[0] === x));
        else if (key === 'cm') { if (CMS[kd].some(c => c[0] === v)) out[key] = v; }
        else out[key] = v;
      }
    }
    return out;
  }
  const fits = (k, patch) => Object.keys(pick(k, patch)).length > 0;
  function reset(m) { if (store.maps) delete store.maps[m]; saveStore(); fire(m); }
  function on(m, fn) { if (!subs.has(m)) subs.set(m, []); subs.get(m).push(fn); }
  function fire(m) {
    applyVars(m); legend(m);
    const mt = mounts.get(m); if (mt && mt.panel && !mt.panel.hidden) panel(m);
    (subs.get(m) || []).forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  }
  /** 백업·동기화로 값이 바뀌었을 때 */
  function reload() {
    store = Store.get(SK, null) || { maps: {}, link: 0 };
    edits = Store.get(EK, null) || {};
    Object.keys(MAPS).forEach(fire);
  }

  /* ═══ 글꼴 ═══ */
  function font(k) {
    const ft = FONTS.find(x => x.k === k) || FONTS[0];
    if (!fontLoaded.has(ft.k)) {
      fontLoaded.add(ft.k);
      if (ft.css) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = ft.css; document.head.appendChild(l); }
      if (ft.faces) {
        const fam = ft.fam.split(',')[0].replace(/'/g, ''), st = document.createElement('style');
        st.textContent = ft.faces.map(([w, u, fmt]) => `@font-face{font-family:'${fam}';src:url('${u}') format('${fmt}');font-weight:${w};font-display:swap}`).join('\n');
        document.head.appendChild(st);
      }
    }
    return ft.fam;
  }

  /* ═══ 색 ═══ */
  function colorOf(m, d) {
    const s = get(m);
    if (s.cm === 'one') return s.oc;
    if (s.cm === 'hh') { const h = d.hh || 0; return h >= 1000 ? COL.hh[0][0] : h >= 500 ? COL.hh[1][0] : h >= 300 ? COL.hh[2][0] : COL.hh[3][0]; }
    if (s.cm === 'move') {
      const ym = +d.ym || 0, y = Math.floor(ym / 100), now = NOW_Y * 100 + new Date().getMonth() + 1;
      if (!ym || ym < now) return COL.move[3][0];
      return y <= NOW_Y ? COL.move[0][0] : y === NOW_Y + 1 ? COL.move[1][0] : COL.move[2][0];
    }
    if (d.future || (d.year && d.year > NOW_Y)) return COL.age[4][0];
    if (!d.year) return COL.age[3][0];
    const a = NOW_Y - d.year;
    return a <= 5 ? COL.age[0][0] : a <= 10 ? COL.age[1][0] : a <= 20 ? COL.age[2][0] : COL.age[3][0];
  }
  function legendItems(m) {
    const s = get(m);
    if (s.cm === 'one') return [[s.oc, '단지']];
    return COL[s.cm] || [];
  }

  /* ═══ 단지별 직접 고친 값 ═══ */
  const E = (id) => (id != null && edits[id]) || {};
  function setE(id, patch, del = []) {
    const cur = { ...E(id), ...patch };
    del.forEach(k => delete cur[k]);
    if (cur.o) { Object.keys(cur.o).forEach(k => { if (!cur.o[k]) delete cur.o[k]; }); if (!Object.keys(cur.o).length) delete cur.o; }
    if (cur.n === '') delete cur.n;
    if (Object.keys(cur).length) edits[id] = cur; else delete edits[id];
    Store.set(EK, edits);
  }
  const nameOf = (id, name) => E(id).n || name;
  const starred = (id) => !!E(id).s;
  const hidden = (id) => !!E(id).h;
  // 옮긴 위치는 "x,y" 글자로 저장 (자동 동기화에서 한 값으로 합쳐지게)
  const offset = (m, id) => { const v = E(id).o && E(id).o[m]; if (!v) return null; const a = String(v).split(',').map(Number); return a.length === 2 && a.every(isFinite) ? a : null; };

  /* ═══ 라벨 그리기 ═══ */
  const eok = (v) => (v == null ? '' : v >= 10000 ? `${+(v / 10000).toFixed(v >= 100000 ? 1 : 2)}억` : `${Math.round(v).toLocaleString()}만`);
  const yrTxt = (d, short) => {
    if (d.ym) { const y = String(d.ym).slice(0, 4), mo = String(d.ym).slice(4, 6); return short ? `${y.slice(2)}.${mo}` : `${y.slice(2)}.${mo}`; }
    return d.year ? (short ? `'${String(d.year).slice(2)}` : `${d.year}년`) : '';
  };
  const hhTxt = (h, short) => (h ? (short ? h.toLocaleString() : `${h.toLocaleString()}세대`) : '');
  const chgTxt = (v) => (v == null || !isFinite(v) ? '' : `<i class="${v > 0 ? 'lk-up' : v < 0 ? 'lk-dn' : ''}">${v > 0 ? '▲' : v < 0 ? '▼' : ''}${Math.abs(v).toFixed(1)}%</i>`);
  const dotTxt = (h) => (h >= 1000 ? `${(h / 1000).toFixed(1)}천` : h >= 500 ? String(h) : '');
  /** 라벨에 넣을 값 (설정한 순서대로) */
  function parts(s, d, kind) {
    const out = [];
    for (const [k] of ITEMS[kind] || ITEMS.cx) {
      if (!s.it.includes(k)) continue;
      if (k === 'yr') { const t = yrTxt(d); if (t) out.push({ k, t }); }
      if (k === 'hh') { const t = hhTxt(d.hh); if (t) out.push({ k, t }); }
      if (k === 'py' && d.py) out.push({ k, t: d.py });
      if (k === 'pr' && d.pr != null) out.push({ k, t: eok(d.pr) });
      if (k === 'chg' && d.chg != null && isFinite(d.chg)) out.push({ k, t: chgTxt(d.chg), html: 1 });
    }
    return out;
  }
  const pTxt = (p) => (p.html ? p.t : esc(p.t));
  /**
   * el 하나를 라벨로 꾸밈.
   * d = { id(고친 값 찾는 이름), name, year, ym(YYYYMM), hh, py('84㎡'), pr(만원), chg(%), future, emph(내 단지), on(선택), badges(html) }
   */
  function render(el, m, d) {
    const s = get(m), kind = kindOf(m) === 'sup' ? 'sup' : 'cx', c = colorOf(m, d), e = E(d.id);
    const nm = esc(e.n || d.name), star = e.s ? '<b class="lk-star">★</b>' : '', bd = d.badges || '';
    const ps = parts(s, d, kind);
    let h;
    if (s.ds === 'block') {
      const y = d.ym || d.year ? (d.future || (d.year && d.year > NOW_Y) ? '예정' : yrTxt(d, true)) : '';
      const rest = ps.filter(p => p.k !== 'yr');
      h = `<div class="lk-b">${s.it.includes('yr') && y ? `<span class="lk-y">${esc(y)}</span>` : '<span class="lk-y lk-y0"></span>'}<span class="lk-n">${star}${nm}${bd}</span>${rest.length ? `<span class="lk-h">${rest.map(pTxt).join(' · ')}</span>` : ''}</div>`;
    } else if (s.ds === 'chip') {
      const first = ps[0], rest = ps.slice(1);
      h = `<div class="lk-b">${first ? `<b class="lk-y">${pTxt(first)}</b>` : '<b class="lk-y lk-y0"></b>'}<span class="lk-n">${star}${nm}${bd}</span>${rest.length ? `<small>${rest.map(pTxt).join(' · ')}</small>` : ''}</div>`;
    } else if (s.ds === 'price') {
      const py = s.it.includes('py') && d.py ? ` · ${esc(d.py)}` : '';
      const big = d.pr != null ? `${eok(d.pr)}${s.it.includes('chg') ? chgTxt(d.chg) : ''}` : esc(ps.filter(p => !p.html && p.k !== 'py').map(p => p.t).join(' · ') || hhTxt(d.hh) || '-');
      h = `<div class="lk-b"><div class="lk-n">${star}${nm}${py}${bd}</div><div class="lk-v">${big}</div></div>`;
    } else {
      // 첫 값은 옅게, 나머지는 굵게 (예: 08.05  379세대)
      const info = ps.length > 1 ? `<span>${pTxt(ps[0])}</span>${ps.slice(1).map(pTxt).join(' · ')}` : ps.length ? pTxt(ps[0]) : '';
      h = `<div class="lk-b"><div class="lk-n">${star}${nm}${bd}</div>${info ? `<div class="lk-i">${info}</div>` : ''}</div>`;
    }
    const keep = ['mini', 'sp-dot', 'sp-hide'].filter(k => el.classList.contains(k));
    el.className = ['lk', 'lk-' + s.ds, d.emph || e.s ? 'emph' : '', d.on ? 'on' : '', (d.hh || 0) < (s.du || 0) && !d.emph && !e.s ? 'lk-small' : '', e.h ? 'lk-hid' : '', d.cls || '', ...keep].filter(Boolean).join(' ');
    el.style.setProperty('--lkc', c);
    el.style.setProperty('--lkr', Math.round(7 + Math.min(d.hh || 0, 3000) / 3000 * 15) + 'px');
    const o = offset(m, d.id);
    el.style.translate = o ? `${o[0]}px ${o[1]}px` : '';
    el.innerHTML = `${h}<i class="lk-tail"></i><b class="lk-dt">${dotTxt(d.hh || 0)}</b>`;
    el.dataset.lkname = d.name || '';
    return el;
  }
  const isLK = (m) => get(m).ds !== 'legacy';
  /** 지도 확대 정도 → 'far' | 'mid' | 'near'. 지도를 담은 상자에 표시해 두면 CSS 가 모양을 바꿉니다 */
  function stage(m, level) {
    const s = get(m), st = !s.zm || editing.has(m) ? 'near' : level >= 8 ? 'far' : level >= 6 ? 'mid' : 'near';
    const mt = mounts.get(m); if (mt) mt.host.dataset.lkz = st;
    return st;
  }
  /** 겹치는 라벨을 점으로 (세대수 큰 단지·강조 단지가 먼저). list = [{ el, ov, w }] */
  function declutter(list) {
    const placed = [];
    const items = list.filter(x => x.ov.getMap && x.ov.getMap()).sort((a, b) => (b.el.classList.contains('emph') - a.el.classList.contains('emph')) || ((b.w || 0) - (a.w || 0)));
    for (const x of items) {
      x.el.classList.remove('mini');
      if (x.el.classList.contains('lk-hid')) continue;
      const r = x.el.getBoundingClientRect();
      if (!r.width) continue;
      const hit = !x.el.classList.contains('on') && placed.some(q => !(r.right < q.left + 2 || r.left > q.right - 2 || r.bottom < q.top + 2 || r.top > q.bottom - 2));
      if (hit) x.el.classList.add('mini'); else placed.push(r);
      if (x.ov.setZIndex) x.ov.setZIndex(hit ? 1 : x.el.classList.contains('emph') ? 6 : 3);
    }
  }

  /* ═══ 지도 상자: 버튼 · 설정 창 · 범례 ═══ */
  /** 지도 칸을 감싸는 상자 (버튼·범례를 지도 위에 띄우기 위해). 지도를 만들기 전에 부르세요 */
  function wrap(el) {
    if (el.parentElement && el.parentElement.classList.contains('lk-host')) return el.parentElement;
    const w = document.createElement('div'); w.className = 'lk-host';
    el.parentElement.insertBefore(w, el); w.appendChild(el);
    return w;
  }
  /**
   * mount(지도이름, { el: 지도 칸, host?: 버튼을 띄울 상자, legendBox?: 범례를 넣을 칸, more?: 이 지도만의 설정 열기, moreLabel?, ext?: 버튼을 누르면 할 일(자기 설정 창이 있는 지도) })
   */
  function mount(m, opt) {
    if (mounts.has(m)) return mounts.get(m);
    const host = opt.host || wrap(opt.el);
    host.classList.add('lk-host'); host.dataset.lkmap = m;
    if (opt.el) opt.el.classList.add('lk-mapel');
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'lk-btn'; btn.innerHTML = '🏷 <b>라벨</b>'; btn.title = '라벨 모양·표시 항목·크기·글꼴 바꾸기, 라벨 직접 고치기';
    const pnl = document.createElement('div'); pnl.className = 'lk-panel'; pnl.hidden = true;
    const lg = opt.legendBox || Object.assign(document.createElement('div'), { className: 'lk-legend' });
    const stop = (e) => e.stopPropagation();
    [btn, pnl, lg].forEach(x => ['mousedown', 'touchstart', 'pointerdown', 'wheel', 'dblclick'].forEach(t => x.addEventListener(t, stop, { passive: true })));
    host.appendChild(btn); host.appendChild(pnl); if (!opt.legendBox) host.appendChild(lg);
    const mt = { host, btn, panel: pnl, legend: lg, opt };
    mounts.set(m, mt);
    btn.onclick = () => {
      if (opt.ext) { opt.ext(); return; }
      pnl.hidden = !pnl.hidden; btn.classList.toggle('on', !pnl.hidden);
      if (!pnl.hidden) panel(m);
    };
    pnl.addEventListener('click', (e) => onPanelClick(m, e));
    pnl.addEventListener('input', (e) => onPanelInput(m, e));
    pnl.addEventListener('change', (e) => onPanelInput(m, e, true));
    applyVars(m); legend(m);
    return mt;
  }
  function applyVars(m) {
    const mt = mounts.get(m); if (!mt) return;
    const s = get(m), h = mt.host;
    h.style.setProperty('--lks', s.s); h.style.setProperty('--lkf', s.f + 'px'); h.style.setProperty('--lkff', font(s.ff));
    h.dataset.lkds = s.ds;
    h.classList.toggle('lk-editing', editing.has(m));
    if (mt.btn) mt.btn.classList.toggle('editing', editing.has(m));
  }
  function legend(m) {
    const mt = mounts.get(m); if (!mt || !mt.legend) return;
    const k = kindOf(m), s = get(m);
    if (!(k === 'cx' || k === 'sup') || s.ds === 'legacy') { mt.legend.hidden = !mt.opt.legendBox; return; }   // 예전 디자인: 그 지도가 직접 범례를 씀
    if (!s.lg) { mt.legend.hidden = true; return; }
    mt.legend.hidden = false;
    const t = { age: '연식', move: '입주 시기', hh: '세대수', one: '' }[s.cm] || '';
    mt.legend.innerHTML = `${t ? `<b>${t}</b>` : ''}${legendItems(m).map(([c, n]) => `<span><i style="background:${c}"></i>${n}</span>`).join('')}${mt.opt.legendSub ? `<span class="sub">${mt.opt.legendSub()}</span>` : ''}`;
  }

  /* ── 설정 창 ── */
  function panel(m) {
    const mt = mounts.get(m); if (!mt) return;
    const s = get(m), k = kindOf(m), full = k === 'cx' || k === 'sup', info = MAPS[m] || {}, pr = Store.get(PK, {}) || {};
    const seg = (key, list, val) => `<div class="lk-seg">${list.map(([v, n]) => `<button type="button" data-set="${key}" data-v="${v}" class="${String(val) === String(v) ? 'on' : ''}">${n}</button>`).join('')}</div>`;
    const nHid = Object.values(edits).filter(x => x.h).length, nPos = Object.values(edits).filter(x => x.o && x.o[m]).length;
    const legacy = s.ds === 'legacy';
    mt.panel.innerHTML = `<div class="lk-ph"><b>🏷 라벨 설정</b><small>${esc(info.name || m)}</small><span class="grow"></span><button type="button" class="lk-x" data-act="close" aria-label="닫기">✕</button></div>
      ${full ? `<div class="lk-sec"><span>디자인</span>${seg('ds', [...DESIGNS, ...(info.legacy ? [['legacy', '예전 디자인']] : [])], s.ds)}
        ${legacy ? `<p class="lk-note">${esc(info.legacy)} — 아래 [이 지도만의 설정]에서 꾸밉니다.</p>` : ''}</div>` : ''}
      ${full && !legacy ? `<div class="lk-sec"><span>라벨에 넣을 정보</span><div class="lk-chk">${ITEMS[k].map(([v, n]) => `<label><input type="checkbox" data-it="${v}"${s.it.includes(v) ? ' checked' : ''}> ${n}</label>`).join('')}</div>
        ${s.ds === 'price' && k === 'cx' ? '<p class="lk-note">D 시세 카드는 최근 실거래를 크게 보여 줍니다.</p>' : ''}</div>
      <div class="lk-sec"><span>색 기준</span>${seg('cm', CMS[k], s.cm)}${s.cm === 'one' ? `<label class="lk-inl">색 <input type="color" data-set="oc" value="${esc(s.oc)}"></label>` : ''}</div>` : ''}
      ${!legacy ? `<div class="lk-sec"><span>크기</span><div class="lk-rng"><input type="range" min="0.7" max="1.6" step="0.05" data-set="s" value="${s.s}"><em>${(+s.s).toFixed(2)}배</em></div>
        <span>글자</span><div class="lk-rng"><input type="range" min="9" max="20" step="1" data-set="f" value="${s.f}"><em>${s.f}px</em></div>
        <span>글꼴</span><select data-set="ff">${FONTS.map(f => `<option value="${f.k}"${f.k === s.ff ? ' selected' : ''}>${f.name}</option>`).join('')}</select></div>` : ''}
      ${full && !legacy ? `<div class="lk-sec"><label class="lk-inl"><input type="checkbox" data-tg="zm"${s.zm ? ' checked' : ''}> 확대 정도에 따라 간단히 보기</label>
        <p class="lk-note">멀리: 세대수 크기 동그라미 · 중간: 이름만 · 가까이: 전체</p>
        <label class="lk-inl">점으로 줄일 단지 <select data-set="du">${[[0, '줄이지 않음'], [100, '100세대 미만'], [200, '200세대 미만'], [300, '300세대 미만'], [500, '500세대 미만']].map(([v, n]) => `<option value="${v}"${+s.du === v ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="lk-inl"><input type="checkbox" data-tg="lg"${s.lg ? ' checked' : ''}> 색 범례 보이기</label></div>
      <div class="lk-sec"><span>프리셋</span><div class="lk-pre">${BUILTIN.map(p => `<button type="button" data-pre="${p.k}">${p.name}</button>`).join('')}
        ${Object.keys(pr).map(n => `<span class="lk-my"><button type="button" data-my="${esc(n)}">${esc(n)}</button><button type="button" data-mydel="${esc(n)}" title="지우기">✕</button></span>`).join('')}
        <button type="button" data-act="savepre">＋ 지금 설정 저장</button></div></div>` : ''}
      <div class="lk-sec"><label class="lk-inl"><input type="checkbox" data-act="link"${store.link ? ' checked' : ''}> 모든 지도에 똑같이 적용</label>
        <button type="button" class="lk-mini" data-act="copy">지금 설정을 모든 지도에 복사</button></div>
      ${info.edit ? `<div class="lk-sec"><button type="button" class="lk-edit${editing.has(m) ? ' on' : ''}" data-act="edit">✎ 라벨 직접 고치기 ${editing.has(m) ? '켜짐 (끝내기)' : ''}</button>
        <p class="lk-note">켜면 라벨을 끌어서 옮기거나, 눌러서 짧은 이름·숨기기·★ 강조를 정할 수 있어요. 짧은 이름·숨김·강조는 모든 지도에 같이 적용돼요.</p>
        <div class="lk-pre"><button type="button" data-act="unhide"${nHid ? '' : ' disabled'}>숨긴 라벨 ${nHid}개 다시 보이기</button><button type="button" data-act="resetpos"${nPos ? '' : ' disabled'}>이 지도에서 옮긴 위치 ${nPos}개 원래대로</button><button type="button" data-act="resetedits">짧은 이름·숨김·강조 전부 원래대로</button></div></div>` : ''}
      <div class="lk-sec lk-foot">${mt.opt.more ? `<button type="button" data-act="more">${esc(mt.opt.moreLabel || '이 지도만의 설정')}</button>` : ''}<button type="button" data-act="def">이 지도 기본값으로</button></div>`;
  }
  function onPanelInput(m, e, changed) {
    const t = e.target, key = t.dataset.set;
    if (t.dataset.it && changed) {
      const s = get(m), v = t.dataset.it, it = t.checked ? [...new Set([...s.it, v])] : s.it.filter(x => x !== v);
      return set(m, { it });
    }
    if (t.dataset.tg && changed) return set(m, { [t.dataset.tg]: t.checked ? 1 : 0 });
    if (t.dataset.act === 'link' && changed) { store.link = t.checked ? 1 : 0; saveStore(); U.toast(t.checked ? '이제 바꾸는 설정이 모든 지도에 똑같이 들어갑니다.' : '이제 이 지도만 바뀝니다.'); return; }
    if (!key || t.tagName === 'BUTTON') return;
    if (t.type === 'range') {                        // 끄는 동안에는 바로 보이게만, 손을 떼면 저장
      const v = +t.value, em = t.parentElement.querySelector('em');
      if (em) em.textContent = key === 's' ? v.toFixed(2) + '배' : v + 'px';
      if (!changed) { const mt = mounts.get(m); if (mt) mt.host.style.setProperty(key === 's' ? '--lks' : '--lkf', key === 's' ? v : v + 'px'); return; }
      return set(m, { [key]: v });
    }
    if (changed) set(m, { [key]: key === 'du' ? +t.value : t.value });
  }
  function onPanelClick(m, e) {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.set) {
      const patch = { [b.dataset.set]: b.dataset.v };
      if (b.dataset.v === 'price' && kindOf(m) === 'cx' && !get(m).it.some(x => ['pr', 'chg'].includes(x))) patch.it = [...get(m).it.filter(x => x !== 'yr' && x !== 'hh'), 'py', 'pr', 'chg'];   // 시세 카드 고르면 가격·등락을 같이 켬
      if (b.dataset.v !== 'price' && b.dataset.set === 'ds' && get(m).ds === 'price' && !get(m).it.some(x => ['yr', 'hh'].includes(x))) patch.it = ['yr', 'hh'];
      return set(m, patch);
    }
    if (b.dataset.pre) { const p = BUILTIN.find(x => x.k === b.dataset.pre); if (p) set(m, p.v); return; }
    if (b.dataset.my) { const p = (Store.get(PK, {}) || {})[b.dataset.my]; if (p) set(m, p); return; }
    if (b.dataset.mydel) { const ps = Store.get(PK, {}) || {}; delete ps[b.dataset.mydel]; Store.set(PK, ps); return panel(m); }
    const a = b.dataset.act;
    if (a === 'close') { const mt = mounts.get(m); mt.panel.hidden = true; mt.btn.classList.remove('on'); return; }
    if (a === 'savepre') {
      const n = (prompt('이 설정의 이름 (예: 임장 지도)') || '').trim(); if (!n) return;
      const { ds, it, cm, oc, s, f, ff, zm, du, lg } = get(m), ps = Store.get(PK, {}) || {};
      ps[n] = { ds: ds === 'legacy' ? 'tag' : ds, it, cm, oc, s, f, ff, zm, du, lg }; Store.set(PK, ps); U.toast(`'${n}' 프리셋을 저장했습니다. 모든 지도에서 쓸 수 있어요.`); return panel(m);
    }
    if (a === 'copy') {
      if (!confirm('지금 이 지도의 라벨 설정을 다른 모든 지도에 똑같이 넣을까요?')) return;
      const { ds, it, cm, oc, s, f, ff, zm, du, lg } = get(m); set(m, { ds, it, cm, oc, s, f, ff, zm, du, lg }, { all: 1 }); U.toast('모든 지도에 복사했습니다.'); return;
    }
    if (a === 'edit') { setEditing(m, !editing.has(m)); return; }
    if (a === 'unhide') { Object.keys(edits).forEach(id => { if (edits[id].h) setE(id, {}, ['h']); }); refreshAll(); U.toast('숨긴 라벨을 모두 다시 보이게 했습니다.'); return; }
    if (a === 'resetpos') { Object.keys(edits).forEach(id => { const o = edits[id].o; if (o && o[m]) setE(id, { o: { ...o, [m]: null } }); }); fire(m); return; }
    if (a === 'resetedits') { if (!confirm('모든 단지의 짧은 이름·숨김·★ 강조를 지울까요? (옮긴 위치는 그대로)')) return; Object.keys(edits).forEach(id => setE(id, {}, ['n', 'h', 's'])); refreshAll(); return; }
    if (a === 'more') { const mt = mounts.get(m); if (mt.opt.more) mt.opt.more(); return; }
    if (a === 'def') { if (!confirm(`${(MAPS[m] || {}).name || m} 라벨 설정을 기본값으로 되돌릴까요?`)) return; reset(m); }
  }
  const refreshAll = () => Object.keys(MAPS).forEach(fire);

  /* ═══ 직접 고치기 (편집 모드) ═══ */
  function setEditing(m, onOff) {
    if (onOff) editing.add(m); else editing.delete(m);
    closePop();
    fire(m);
    U.toast(onOff ? '라벨 직접 고치기: 라벨을 끌어서 옮기거나, 눌러서 짧은 이름·숨기기·★ 강조를 정하세요.' : '라벨 직접 고치기를 끝냈습니다.');
  }
  const isEditing = (m) => editing.has(m);
  /** 라벨 el 이 편집 모드에서 움직이도록 연결. getMap() = 카카오 지도 */
  function bind(el, m, id, getMap) {
    el._lkid = id;
    if (el._lkb) return; el._lkb = 1;
    let drag = null, justDragged = 0;
    const block = (e) => { if (!editing.has(m)) return; e.stopImmediatePropagation(); };
    el.addEventListener('mouseenter', block, true);
    el.addEventListener('mouseleave', block, true);
    el.addEventListener('click', (e) => {
      if (!editing.has(m)) return;
      e.stopImmediatePropagation(); e.preventDefault();
      if (Date.now() - justDragged < 300) return;
      openPop(m, el._lkid, el);
    }, true);
    el.addEventListener('pointerdown', (e) => {
      if (!editing.has(m) || e.button > 0) return;
      e.stopPropagation(); e.preventDefault();
      const o = offset(m, el._lkid) || [0, 0], map = getMap && getMap();
      drag = { sx: e.clientX, sy: e.clientY, ox: o[0], oy: o[1], moved: false, map };
      if (map && map.setDraggable) map.setDraggable(false);
      try { el.setPointerCapture(e.pointerId); } catch (er) { /* 무시 */ }
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true; el.classList.add('lk-drag');
      el.style.translate = `${drag.ox + dx}px ${drag.oy + dy}px`;
    });
    const end = (e, cancel) => {
      if (!drag) return;
      const d = drag; drag = null; el.classList.remove('lk-drag');
      if (d.map && d.map.setDraggable) d.map.setDraggable(true);
      if (!d.moved) return;
      justDragged = Date.now();
      if (cancel) { const o = offset(m, el._lkid); el.style.translate = o ? `${o[0]}px ${o[1]}px` : ''; return; }
      const x = Math.round(d.ox + e.clientX - d.sx), y = Math.round(d.oy + e.clientY - d.sy);
      setE(el._lkid, { o: { ...(E(el._lkid).o || {}), [m]: `${x},${y}` } });
    };
    el.addEventListener('pointerup', (e) => end(e));
    el.addEventListener('pointercancel', (e) => end(e, true));
  }
  let pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; } }
  function openPop(m, id, el) {
    closePop();
    const cur = E(id), base = el.dataset.lkname || '';
    pop = document.createElement('div'); pop.className = 'lk-pop';
    pop.innerHTML = `<div class="lk-ph"><b>${esc(base || cur.n || '단지')}</b><span class="grow"></span><button type="button" class="lk-x" data-p="x" aria-label="닫기">✕</button></div>
      <label class="lk-inl" style="width:100%">짧은 이름 <input type="text" data-p="n" value="${esc(cur.n || '')}" placeholder="${esc(base)}" maxlength="24"></label>
      <div class="lk-pre"><button type="button" data-p="s" class="${cur.s ? 'on' : ''}">★ 강조 ${cur.s ? '끄기' : '켜기'}</button>
      <button type="button" data-p="h" class="${cur.h ? 'on' : ''}">${cur.h ? '다시 보이기' : '숨기기'}</button>
      <button type="button" data-p="o"${cur.o && cur.o[m] ? '' : ' disabled'}>위치 원래대로</button>
      <button type="button" data-p="r">이 단지 원래대로</button></div>
      <p class="lk-note">짧은 이름·숨김·강조는 모든 지도에 같이 적용돼요. 글자를 지우면 원래 이름으로.</p>`;
    document.body.appendChild(pop);
    const r = el.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.left + r.width / 2 - pw / 2)) + 'px';
    pop.style.top = (r.top - ph - 10 > 8 ? r.top - ph - 10 : Math.min(window.innerHeight - ph - 8, r.bottom + 10)) + 'px';
    const inp = pop.querySelector('[data-p="n"]');
    const done = () => { fire(m); Object.keys(MAPS).filter(k => k !== m).forEach(k => (subs.get(k) || []).forEach(fn => { try { fn(); } catch (er) { /* 무시 */ } })); };
    inp.addEventListener('change', () => { setE(id, { n: inp.value.trim() }); done(); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { inp.blur(); closePop(); } if (e.key === 'Escape') closePop(); });
    pop.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const p = b.dataset.p;
      if (p === 'x') return closePop();
      if (p === 's') setE(id, { s: cur.s ? 0 : 1 }, cur.s ? ['s'] : []);
      if (p === 'h') setE(id, { h: cur.h ? 0 : 1 }, cur.h ? ['h'] : []);
      if (p === 'o') setE(id, { o: { ...(cur.o || {}), [m]: null } });
      if (p === 'r') setE(id, {}, ['n', 's', 'h', 'o']);
      closePop(); done();
    });
    setTimeout(() => inp.focus(), 30);
  }
  document.addEventListener('pointerdown', (e) => { if (pop && !pop.contains(e.target) && !e.target.closest('.lk')) closePop(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });

  return { get, set, on, reload, render, isLK, stage, declutter, mount, wrap, legend, bind, isEditing, setEditing, font, colorOf, nameOf, starred, hidden, MAPS, FONTS };
})();
