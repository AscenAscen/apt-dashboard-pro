/* ─────────────────────────────────────────────────────────
   home.js — [최근 거래] 탭 (첫 화면)
   달력 한 달 기준 · 지역(묶음/광역시/중소도시/구) · 평형(소형·59·74·84·대형) · 억대 막대 · 신고가 카드 · 단지 표
   자료: data/sale|rent/{지역}/{연도}.json (이미 저장소에 있는 실거래 파일을 화면에서 바로 계산)
   ───────────────────────────────────────────────────────── */
const Home = (() => {
  const $ = (id) => document.getElementById(id);
  const SK = 'apt.home.v2', PK = 'apt.homePresets.v1', NK = 'apt.homeSeen.v1';
  const METRO = ['부산', '대구', '광주', '대전', '울산'];
  const CITY = ['창원', '청주', '천안', '전주', '김해', '포항', '세종'];
  const GRP = { seoul: '서울', capital: '수도권', metro: '광역시 전체', city: '중소도시 전체', all: '전체' };
  /* 억대 (만원) */
  const BANDS = [{ l: '3억 미만', s: '3억↓', lo: 0, hi: 30000 }];
  for (let e = 3; e <= 19; e++) BANDS.push({ l: `${e}억대`, s: `${e}억`, lo: e * 10000, hi: (e + 1) * 10000 });
  BANDS.push({ l: '20~25억', s: '20~25', lo: 200000, hi: 250000 }, { l: '25~30억', s: '25~30', lo: 250000, hi: 300000 }, { l: '30억 이상', s: '30억↑', lo: 300000, hi: Infinity });
  const bandOf = (p) => BANDS.findIndex(b => p >= b.lo && p < b.hi);
  /* 평형 구분 (공급 평 추정) */
  const PYC = [['s', '소형'], ['59', '59'], ['74', '74'], ['84', '84'], ['L', '대형']];
  const pyClass = (area) => { const p = CONFIG.toPyeong(area); return p <= 22 ? 's' : p <= 25 ? '59' : p <= 31 ? '74' : p <= 36 ? '84' : 'L'; };
  const pyName = (c) => (PYC.find(x => x[0] === c) || [, ''])[1];
  const eok = (v) => (v == null ? '-' : (v / 10000).toFixed(2) + '억');
  const ymOf = (d) => Math.floor(d / 100);
  const ymAdd = (ym, n) => { let y = Math.floor(ym / 100), m = ym % 100 + n; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return y * 100 + m; };
  const ymText = (ym) => `${Math.floor(ym / 100)}년 ${ym % 100}월`;
  const nowYm = () => { const t = new Date(); return t.getFullYear() * 100 + t.getMonth() + 1; };
  const FROM_Y = Math.floor(CONFIG.PEAK_FROM / 10000);

  let regions = [], regBy = new Map();
  let st = {};
  let rowsNow = [], tblRows = [], shown = 300, sel = new Set(), open = new Set(), chart = null, loadSeq = 0, hf = null;
  const built = { sale: new Map(), rent: new Map() };       // 지역코드 → Map(단지·평형 → {…, tr:[거래]})
  const meta = new Map();                                   // 지역코드 → { by: 연식표, hh: 세대수표 }
  const seenPrev = new Map();                               // 이번 접속 전에 본 거래 (NEW 표시용)

  const DEF = () => ({ kind: 'sale', ym: ymAdd(nowYm(), -1), regs: ['g:seoul'], pys: [], hhMin: null, hhMax: null, age: '', view: 'month', years: 1, low: false, direct: false, bands: [], metric: 'n', onlyHigh: false, folder: '' });
  const save = () => Store.set(SK, st);

  /* ── 지역 ── */
  function grpOf(r) {
    const s = r[1], g = r[2];
    if (s.startsWith('서울')) return 'seoul';
    if (/^(경기|인천)/.test(s)) return 'capital';
    if (METRO.some(m => s.startsWith(m))) return 'metro';
    if (cityOf(r)) return 'city';
    return 'etc';
  }
  function cityOf(r) { return CITY.find(c => (c === '세종' ? r[1].startsWith('세종') : r[2].startsWith(c + '시'))) || ''; }
  const metroOf = (r) => METRO.find(m => r[1].startsWith(m)) || '';
  function codesOf(tok) {
    const [t, v] = [tok.slice(0, 1), tok.slice(2)];
    if (t === 'g') return regions.filter(r => v === 'all' || grpOf(r) === v).map(r => r[0]);
    if (t === 'm') return regions.filter(r => metroOf(r) === v || cityOf(r) === v).map(r => r[0]);
    if (t === 'p') return regions.filter(r => r[1] === v).map(r => r[0]);
    if (t === 'c') return regBy.has(v) ? [v] : [];
    return [];
  }
  const shortSido = (s) => s.replace(/특별자치시|특별자치도|특별시|광역시/, '').replace(/^(충청|전라|경상)(북|남)도$/, (m, a, b) => ({ 충청: '충', 전라: '전', 경상: '경' }[a] + b)).replace(/도$/, '');
  function tokLabel(tok) {
    const t = tok[0], v = tok.slice(2);
    if (t === 'g') return GRP[v] || v;
    if (t === 'm') return v;
    if (t === 'p') return shortSido(v);
    const r = regBy.get(v); if (!r) return v;
    const city = cityOf(r), m = metroOf(r);
    return `${m || city || shortSido(r[1])} ${city && city !== '세종' ? r[2].replace(/^\S+시\s*/, '') || r[2] : r[2]}`.trim();
  }
  const codes = () => [...new Set(st.regs.flatMap(codesOf))];

  /* ── 자료 읽기 ── */
  async function loadKind(code, kind) {
    if (built[kind].has(code)) return;
    const idx = await Data.index(code);
    const ys = (idx.y[kind] || []).filter(y => y >= FROM_Y);
    const ym = {};
    await Promise.all(ys.map(y => Data.json(`${kind}/${code}/${y}.json`, {}).then(d => { ym[y] = d; })));
    const m = new Map();
    Data.eachTrade(ym, null, (key, t) => {
      const id = `${code}|${key}#${t.g}`;
      let o = m.get(id);
      if (!o) { o = { id, code, key, g: t.g, area: t.area, tr: [] }; m.set(id, o); }
      o.tr.push(t);
    });
    m.forEach(o => o.tr.sort((a, b) => a.d - b.d || a.price - b.price));
    built[kind].set(code, m);
    if (!meta.has(code)) {
      const kp = await Data.kapt(code);
      meta.set(code, { by: idx.c || {}, kp: kp.m || {} });
    }
  }
  async function ensure() {
    const seq = ++loadSeq, cs = codes(), kinds = st.kind === 'rent' ? ['sale', 'rent'] : ['sale'];
    const need = cs.filter(c => kinds.some(k => !built[k].has(c)));
    if (need.length) {
      let done = 0;
      const el = $('hmLoad'); el.hidden = false;
      const tick = () => { el.textContent = `실거래 자료 불러오는 중… ${done} / ${need.length} 지역 (처음 한 번만 오래 걸립니다)`; };
      tick();
      for (let i = 0; i < need.length; i += 6) {                     // 6개 지역씩 나눠 받기
        await Promise.all(need.slice(i, i + 6).map(async c => { for (const k of kinds) await loadKind(c, k); done++; tick(); }));
        if (seq !== loadSeq) return false;
      }
      el.hidden = true;
    }
    return seq === loadSeq;
  }

  /* ── NEW: 지난 방문 때 본 거래와 비교 ── */
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  const sig = (o, t) => hash(`${o.id}|${t.d}|${t.floor}|${t.price}`);
  function noteSeen(kind, M, list) {
    const all = Store.get(NK, {}) || {};
    const k = `${kind}${M}`;
    if (!seenPrev.has(k)) seenPrev.set(k, all[k] ? new Set(all[k].split(',')) : null);
    const cur = new Set(all[k] ? all[k].split(',') : []);
    let add = 0;
    list.forEach(h => { if (!cur.has(h)) { cur.add(h); add++; } });
    if (add) {
      all[k] = [...cur].join(',');
      const keep = Object.keys(all).sort((a, b) => +b.slice(4) - +a.slice(4) || a.localeCompare(b)).slice(0, 8);   // 최근 몇 달만 기억
      Object.keys(all).forEach(x => { if (!keep.includes(x)) delete all[x]; });
      Store.set(NK, all);
    }
    return seenPrev.get(k);
  }

  /* ── 계산 ── */
  const okT = (t) => !(st.direct && t.direct) && !(st.low && t.floor != null && t.floor <= 3);
  function info(o) {
    const reg = regBy.get(o.code) || [o.code, '', ''];
    const [si, gu] = U.siGu(reg[1], reg[2]);
    const p = Data.parseKey(o.key), mt = meta.get(o.code) || { by: {}, kp: {} };
    const k = mt.kp[o.key];
    return { sido: reg[1], sgg: reg[2], si, gu, dong: p.dong, jibun: p.jibun, name: p.name, by: mt.by[o.key] || null, hh: k ? +k[0] || null : null };
  }
  function lastSale(id, end) {
    const o = built.sale.get(id.split('|')[0])?.get(id);
    if (!o) return null;
    for (let i = o.tr.length - 1; i >= 0; i--) if (o.tr[i].d <= end && !o.tr[i].direct) return o.tr[i];
    return null;
  }
  /** 한 달(M) 동안 거래된 단지·평형 → 억대별 한 줄 (거래된 억대마다) */
  function monthRows(M, kind, withNew) {
    const out = [], start = M * 100, end = M * 100 + 99;
    for (const c of codes()) {
      const m = built[kind].get(c); if (!m) continue;
      const hs = [];
      m.forEach(o => {
        const tm = o.tr.filter(t => t.d >= start && t.d <= end && okT(t));
        if (!tm.length) return;
        let peak = null;
        for (const t of o.tr) { if (t.d >= start) break; if (t.d >= CONFIG.PEAK_FROM && !t.direct && (peak == null || t.price > peak)) peak = t.price; }
        const byB = new Map();
        tm.forEach(t => { const b = bandOf(t.price); if (!byB.has(b)) byB.set(b, []); byB.get(b).push(t); });
        const fo = info(o);
        byB.forEach((list, b) => {
          const rep = list.reduce((a, t) => (t.price > a.price ? t : a), list[0]);
          let prev = null;
          for (const t of o.tr) { if (t === rep) break; if (!t.direct && t.d <= rep.d) prev = t; }
          const r = { rid: `${o.id}@${b}`, o, ...fo, area: o.area, g: o.g, pc: pyClass(o.area), band: b, rep, trades: list, cnt: list.length,
            peak, drop: peak ? (rep.price / peak - 1) * 100 : null, prevd: prev ? rep.price - prev.price : null, prevr: prev ? (rep.price / prev.price - 1) * 100 : null };
          r.high = peak != null && rep.price > peak;
          r.fall = r.prevr != null && r.prevr <= -10;
          r.mine = Tracking.has(o.id);
          r.leader = leaderOf(o.code)?.key === o.key;
          extras(r, kind, end);
          out.push(r);
        });
        if (withNew) tm.forEach(t => hs.push(sig(o, t)));
      });
      if (withNew) {
        const prev = noteSeen(kind, M, hs);
        if (prev) out.forEach(r => { if (r.o.code === c) r.isNew = r.trades.some(t => !prev.has(sig(r.o, t))); });
      }
    }
    return out;
  }
  function extras(r, kind, end) {
    if (kind !== 'rent') return;
    const s = lastSale(r.o.id, end);
    r.sale = s ? s.price : null; r.saleD = s ? s.d : null;
    r.ratio = s ? r.rep.price / s.price * 100 : null;
    r.gap = s ? s.price - r.rep.price : null;
  }
  /** 지역 전체: 단지·평형마다 기간 안의 가장 최근 실거래 하나 */
  function allRows(M, kind) {
    const out = [], end = M * 100 + 99, from = ymAdd(M, -12 * st.years + 1) * 100, mStart = M * 100;
    for (const c of codes()) {
      const m = built[kind].get(c); if (!m) continue;
      m.forEach(o => {
        let rep = null;
        for (let i = o.tr.length - 1; i >= 0; i--) { const t = o.tr[i]; if (t.d <= end && okT(t)) { rep = t; break; } }
        if (!rep || rep.d < from) return;
        let peak = null, prev = null;
        for (const t of o.tr) { if (t === rep) break; if (t.d >= CONFIG.PEAK_FROM && !t.direct && (peak == null || t.price > peak)) peak = t.price; if (!t.direct) prev = t; }
        const tm = o.tr.filter(t => t.d >= mStart && t.d <= end && okT(t));
        const r = { rid: `${o.id}@all`, o, ...info(o), area: o.area, g: o.g, pc: pyClass(o.area), band: bandOf(rep.price), rep, trades: tm.length ? tm : [rep], cnt: tm.length,
          peak, drop: peak ? (rep.price / peak - 1) * 100 : null, prevd: prev ? rep.price - prev.price : null, prevr: prev ? (rep.price / prev.price - 1) * 100 : null, thisMonth: tm.length > 0, old: rep.d < ymAdd(M, -5) * 100 };
        r.high = peak != null && rep.price > peak;
        r.fall = r.prevr != null && r.prevr <= -10;
        r.mine = Tracking.has(o.id);
        r.leader = leaderOf(o.code)?.key === o.key;
        extras(r, kind, end);
        out.push(r);
      });
    }
    return out;
  }

  /* ── 평형·세대수·연식 조건 ── */
  const thisYear = new Date().getFullYear();
  function condOk(r, skipPy) {
    if (!skipPy && st.pys.length && !st.pys.includes(r.pc)) return false;
    if (st.hhMin != null || st.hhMax != null) {             // 세대수를 고르면 세대수 모르는 단지는 뺌
      if (!r.hh) return false;
      if (st.hhMin != null && r.hh < st.hhMin) return false;
      if (st.hhMax != null && r.hh > st.hhMax) return false;
    }
    if (st.age) {
      if (!r.by) return false;
      const age = thisYear - r.by;
      if (st.age === '20+' ? age <= 20 : age > +st.age) return false;
    }
    return true;
  }
  function hhText() {
    if (st.hhMin == null && st.hhMax == null) return '';
    if (st.hhMax == null) return `${st.hhMin.toLocaleString()}세대↑`;
    if (st.hhMin == null) return `${st.hhMax.toLocaleString()}세대↓`;
    return `${st.hhMin.toLocaleString()}~${st.hhMax.toLocaleString()}세대`;
  }
  const ageText = () => (!st.age ? '' : st.age === '20+' ? '20년 넘음' : `${st.age}년 이내`);
  const HHB = [[2000, '2,000세대↑'], [1000, '1,000~1,999'], [500, '500~999'], [300, '300~499'], [0, '300 미만']];
  const hhBucket = (h) => (h ? HHB.findIndex(([m]) => h >= m) : 5);

  /* ── 대장 단지 👑: 같은 구(지역 코드)에서 200세대 이상 중 최근 1년 ㎡당 평균 매매가 1위 ── */
  const leaders = new Map();                                 // 지역코드 → { key, ppm, name }
  function leaderOf(code) {
    if (leaders.has(code)) return leaders.get(code);
    const m = built.sale.get(code), mt = meta.get(code);
    if (!m || !mt) return null;
    const t = new Date(), since = (t.getFullYear() - 1) * 10000 + (t.getMonth() + 1) * 100 + t.getDate();
    const acc = new Map();                                   // 단지 key → [합(만원/㎡), 건수]
    m.forEach(o => {
      const k = mt.kp[o.key]; const hh = k ? +k[0] || 0 : 0;
      if (hh < 200) return;
      o.tr.forEach(x => { if (x.d >= since && !x.direct && o.area) { const a = acc.get(o.key) || [0, 0]; a[0] += x.price / o.area; a[1]++; acc.set(o.key, a); } });
    });
    let best = null;
    acc.forEach(([s, n], key) => { if (n >= 2) { const ppm = s / n; if (!best || ppm > best.ppm) best = { key, ppm, n }; } });
    if (best) best.name = Data.parseKey(best.key).name;
    leaders.set(code, best);
    return best;
  }

  /* ── 표 열 (엑셀식 필터와 공용) ── */
  const tagsOf = (r) => [r.isNew && 'NEW', r.leader && '대장', r.high && '신고가', r.fall && '급락', r.mine && '내 단지', r.rep.floor != null && r.rep.floor <= 3 && '저층', r.rep.direct && '직거래', st.view === 'all' && r.thisMonth && '이달 거래'].filter(Boolean);
  function cols() {
    const N = ColFilter.numCol, T = ColFilter.txtCol, rent = st.kind === 'rent', all = st.view === 'all';
    const c = {
      si: T('시', r => r.si), gu: T('구', r => r.gu), dong: T('동', r => r.dong), name: T('단지', r => r.name),
      area: { label: '평형', get: r => `${r.g}㎡ (${CONFIG.toPyeong(r.area)}평)`, num: r => r.area }, pc: { label: '평형 구분', get: r => pyName(r.pc), num: r => PYC.findIndex(x => x[0] === r.pc) },
      price: N(all ? (rent ? '최근 전세 실거래가' : '최근 실거래가') : (rent ? '전세 실거래가' : '실거래가'), r => r.rep.price),
      date: { label: all ? '거래 월' : '계약일', get: r => (all ? `${String(r.rep.d).slice(0, 4)}.${String(r.rep.d).slice(4, 6)}` : U.date(r.rep.d)), num: r => r.rep.d },
      cnt: N(all ? '이달 거래 건수' : '건수', r => r.cnt, 'n'), floor: N('층', r => r.rep.floor, 'n'),
      year: N('연식', r => r.by, 'n'), age: N('연차', r => (r.by ? CONFIG.toAge(r.by) : null), 'n'), hh: N('세대수', r => r.hh, 'n'),
      peak: N(rent ? '전세 최고가' : '전고점', r => r.peak), drop: N(rent ? '최고가 대비' : '전고 대비', r => r.drop, 'pct'),
      prevd: N('직전 대비', r => r.prevd, 'diff'),
    };
    if (rent) { c.sale = N('최근 매매가', r => r.sale); c.ratio = N('전세가율', r => r.ratio, 'rat'); c.gap = N('매-전(투자금)', r => r.gap); }
    c.tags = T('표시', r => tagsOf(r).join(', '));
    c.mine = T('내 단지', r => (r.mine ? '내 단지' : '아님'));
    c.leader = T('대장 단지', r => (r.leader ? '👑 대장' : '-'));
    return c;
  }
  const HF = () => hf || (hf = ColFilter.create({ key: 'home', cols, bar: 'hmCfBar', sortSel: 'hmSort', onChange: () => { shown = 300; drawTable(); } }));
  function sortFn(l) {
    const v = $('hmSort').value, nz = (x, d) => (x == null || isNaN(x) ? d : x);
    const f = {
      drop: (a, b) => nz(a.drop, 1e9) - nz(b.drop, 1e9), pdesc: (a, b) => b.rep.price - a.rep.price, pasc: (a, b) => a.rep.price - b.rep.price,
      cnt: (a, b) => b.cnt - a.cnt || b.rep.price - a.rep.price, name: (a, b) => a.name.localeCompare(b.name, 'ko') || a.area - b.area,
    }[v] || (() => 0);
    return [...l].sort((a, b) => f(a, b) || a.name.localeCompare(b.name, 'ko'));
  }

  /* ── 그리기 ── */
  async function refresh() {
    syncControls();
    if (!(await ensure())) return;
    const M = st.ym;
    const mRows = monthRows(M, st.kind, true);
    const base = st.view === 'all' ? allRows(M, st.kind) : mRows;
    const pyOk = (r) => condOk(r);
    const bOk = (r) => !st.bands.length || st.bands.includes(r.band);
    rowsNow = base.filter(pyOk);
    drawBars(rowsNow, mRows.filter(pyOk));
    drawSummary(mRows.filter(r => pyOk(r) && bOk(r)), monthRows(ymAdd(M, -1), st.kind, false).filter(r => pyOk(r) && bOk(r)));
    drawCards(mRows.filter(r => bOk(r) && condOk(r, true)));         // 카드는 평형별이라 평형 조건만 빼고 적용
    tblRows = st.bands.length ? rowsNow.filter(bOk) : [];
    drawTable();
    if ($('hmRegDet').open) drawRegions();
  }

  function drawBars(rows, mRows) {
    const ct = new Array(BANDS.length).fill(0), tr = new Array(BANDS.length).fill(0), hi = new Array(BANDS.length).fill(0), n = new Array(BANDS.length).fill(0);
    const hb = BANDS.map(() => [0, 0, 0, 0, 0, 0]);
    rows.forEach(r => { ct[r.band]++; tr[r.band] += st.view === 'all' ? 1 : r.cnt; hb[r.band][hhBucket(r.hh)]++; });
    mRows.forEach(r => { n[r.band] += r.cnt; if (r.high) hi[r.band]++; });
    const vals = st.metric === 't' ? tr : ct;
    const C = st.kind === 'rent' ? CK.C.rent() : CK.C.sale(), gray = CK.alpha(CK.C.sub(), 0.35);
    const colors = vals.map((_, i) => (!st.bands.length || st.bands.includes(i) ? C : gray));
    $('hmBarTitle').textContent = `억대별 분포 · ${st.kind === 'rent' ? '전세' : '매매'} · ${ymText(st.ym)}${[st.pys.map(pyName).join('·'), hhText(), ageText()].filter(Boolean).map(x => ' · ' + x).join('')}${st.view === 'all' ? ` · 지역 전체(최근 ${st.years}년)` : ''}${st.bands.length ? ' · ' + st.bands.map(b => BANDS[b].l).join('·') + ' 선택' : ''}`;
    $('hmBandClear').hidden = !st.bands.length;
    if (chart) { chart.data.datasets[0].data = vals; chart.data.datasets[0].backgroundColor = colors; chart.$meta = { ct, n, hi, tr, hb }; chart.update('none'); return; }
    chart = new Chart($('hmBarChart'), {
      type: 'bar',
      data: { labels: BANDS.map(b => b.s), datasets: [{ data: vals, backgroundColor: colors, borderRadius: { topLeft: 4, topRight: 4 }, maxBarThickness: 26 }] },
      options: {
        maintainAspectRatio: false, animation: false,
        scales: { x: { grid: { display: false }, ticks: { autoSkip: window.innerWidth <= 760, maxRotation: 0, font: { size: window.innerWidth <= 760 ? 10 : 11 } } }, y: { beginAtZero: true, ticks: { maxTicksLimit: 4, precision: 0 } } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: (it) => BANDS[it[0].dataIndex].l, label: (it) => { const m = chart.$meta, i = it.dataIndex; return `${m.ct[i]}곳 · ${st.view === 'all' ? '' : m.tr[i] + '건 · '}신고가 ${m.hi[i]}곳`; },
            afterLabel: (it) => { const h = chart.$meta.hb[it.dataIndex]; const parts = HHB.map(([, t], k) => (h[k] ? `${t} ${h[k]}곳` : '')).concat(h[5] ? [`세대수 모름 ${h[5]}곳`] : []).filter(Boolean); return parts.length ? parts : ''; } } },
        },
        onHover: (e, els) => { e.native.target.style.cursor = els.length || (e.y > chart.chartArea.bottom) ? 'pointer' : 'default'; },
        onClick: (e, els) => {
          let i = els.length ? els[0].index : null;
          if (i == null && e.y > chart.chartArea.bottom) { i = Math.round(chart.scales.x.getValueForPixel(e.x)); if (i < 0 || i >= BANDS.length) i = null; }
          if (i == null) return;
          pickBand(i, e.native && (e.native.ctrlKey || e.native.metaKey));
        },
      },
    });
    chart.$meta = { ct, n, hi, tr, hb };
  }
  function pickBand(i, multi) {
    if (multi) st.bands = st.bands.includes(i) ? st.bands.filter(x => x !== i) : [...st.bands, i].sort((a, b) => a - b);
    else st.bands = st.bands.length === 1 && st.bands[0] === i ? [] : [i];
    sel.clear(); shown = 300; save(); refresh();
    if (st.bands.length && window.innerWidth > 760) setTimeout(() => $('hmTable').closest('section').scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  function drawSummary(cur, prev) {
    const n = cur.reduce((t, r) => t + r.cnt, 0), np = prev.reduce((t, r) => t + r.cnt, 0);
    const h = cur.filter(r => r.high).length, hp = prev.filter(r => r.high).length;
    const rt = cur.length ? h / cur.length * 100 : null, rtp = prev.length ? hp / prev.length * 100 : null;
    const tc = st.pys.length === 1 ? st.pys[0] : st.pys.includes('84') || !st.pys.length ? '84' : st.pys[0];
    const avg = (rs) => { const ps = rs.filter(r => r.pc === tc).flatMap(r => r.trades.map(t => t.price)); return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null; };
    const a = avg(cur), ap = avg(prev);
    const d = n - np, ach = a && ap ? (a / ap - 1) * 100 : null;
    const kind = st.kind === 'rent' ? '전세' : '매매';
    $('hmSum').innerHTML =
      `<div class="hmst"><div class="k">${kind} 거래</div><div class="v">${n.toLocaleString()}<small>건</small></div><div class="s">지난달 대비 <b class="${U.cls(d)}">${d > 0 ? '+' : ''}${d.toLocaleString()}</b></div></div>` +
      `<div class="hmst"><div class="k">신고가</div><div class="v">${h.toLocaleString()}<small>곳</small></div><div class="s">비중 ${rtp == null ? '-' : rtp.toFixed(0) + '%'} → <b class="${U.cls(rt != null && rtp != null ? rt - rtp : null)}">${rt == null ? '-' : rt.toFixed(0) + '%'}</b>${rt != null && rtp != null && rt !== rtp ? (rt > rtp ? ' ▲' : ' ▼') : ''}</div></div>` +
      `<div class="hmst"><div class="k">${pyName(tc)} 평균 ${kind}가</div><div class="v">${a ? eok(a) : '-'}</div><div class="s">지난달 대비 <b class="${U.cls(ach)}">${U.pct(ach)}</b></div></div>` +
      (ymAdd(nowYm(), -1) <= st.ym ? '<div class="hint hmwait">이번 달·지난달은 신고 기한(계약 후 30일)이 남아 숫자가 더 늘어납니다.</div>' : '');
  }

  function drawCards(rows) {
    const bl = st.bands.length ? st.bands.map(b => BANDS[b].l).join('·') : '전체 억대';
    $('hmCardTitle').textContent = `평형별 ${st.kind === 'rent' ? '전세 ' : ''}신고가`;
    $('hmCards').innerHTML = PYC.map(([c, nm]) => {
      const rs = rows.filter(r => r.pc === c), hs = rs.filter(r => r.high);
      const top = hs.slice().sort((a, b) => (b.rep.price / b.peak) - (a.rep.price / a.peak))[0];
      return `<div class="hmcard${st.pys.includes(c) ? ' on' : ''}${st.pys.length && !st.pys.includes(c) ? ' dim' : ''}"><div class="k">${nm}</div><div class="v">${hs.length}<small> / ${rs.length}곳</small></div>` +
        `<div class="s">${top ? `${U.esc(top.name)} <b class="up">+${((top.rep.price / top.peak - 1) * 100).toFixed(1)}%</b>` : '-'}</div>` +
        (hs.length ? `<button class="mini" data-card="${c}">보기</button>` : '') + '</div>';
    }).join('');
  }

  function drawTable() {
    const all = st.view === 'all', rent = st.kind === 'rent';
    const bl = st.bands.map(b => BANDS[b].l).join('·');
    $('hmTblTitle').textContent = st.bands.length ? `${all ? '지역 전체 단지' : '거래 단지'}` : '거래 단지';
    const list = HF().apply(st.onlyHigh ? tblRows.filter(r => r.high) : tblRows, sortFn);
    $('hmOnlyHigh').classList.toggle('on', st.onlyHigh);
    const emp = $('hmEmpty');
    if (!st.bands.length) { $('hmTable').innerHTML = ''; emp.hidden = false; emp.innerHTML = '위 <b>억대 막대</b>(또는 제목의 억대 칸)에서 억대를 골라 주세요. 그 금액대에 실거래된 단지가 여기에 나옵니다.'; $('hmTblTitle').textContent = '거래 단지'; return; }
    emp.hidden = list.length > 0;
    if (!list.length) emp.textContent = tblRows.length ? '필터에 맞는 단지가 없습니다.' : `${bl}에 해당하는 단지가 없습니다.`;
    $('hmTblTitle').textContent = `${all ? '지역 전체 단지' : '거래 단지'} (${list.length.toLocaleString()}곳)`;
    const b = (k) => HF().btn(k);
    const th = (k, t, cls = '') => `<th class="${cls}">${t}${b(k)}</th>`;
    let head = `<thead><tr><th class="c"><input type="checkbox" id="hmAll" title="걸러진 단지 전체 선택"></th>${th('si', '시', 'l')}${th('gu', '구', 'l')}${th('dong', '동', 'l')}${th('name', '단지', 'l name')}${th('area', '평형')}${th('pc', '구분')}` +
      `${th('price', all ? '최근 실거래가' : '실거래가')}${th('date', all ? '거래 월' : '계약일')}${th('cnt', all ? '이달' : '건수')}${th('floor', '층')}${th('year', '연식')}${th('hh', '세대수')}` +
      `${th('peak', rent ? '전세 최고가' : '전고점')}${th('drop', rent ? '최고가 대비' : '전고 대비')}${all ? '' : th('prevd', '직전 대비')}` +
      (rent ? `${th('sale', '최근 매매가')}${th('ratio', '전세가율')}${th('gap', '매-전')}` : '') + `${th('tags', '표시', 'l')}<th></th></tr></thead>`;
    const ncol = 19 + (rent ? 3 : 0) - (all ? 1 : 0);
    const rowsH = list.slice(0, shown).map(r => {
      const tg = [r.isNew && '<span class="tg new">NEW</span>', r.leader && `<span title="${U.esc(r.gu || r.si)} 대장 · ㎡당 평균 ${Math.round(leaderOf(r.o.code).ppm).toLocaleString()}만 원">👑</span>`, r.high && '<span title="신고가">🔴</span>', r.fall && '<span title="급락">🔵</span>', r.mine && '<span title="내 단지">⭐</span>', all && r.thisMonth && '<span title="이달 거래 있음">🟠</span>'].filter(Boolean).join('');
      const fl = r.rep.floor != null && r.rep.floor <= 3 ? ' <small class="tg low">저층</small>' : '';
      const dr = r.rep.direct ? ' <small class="tg dir">직</small>' : '';
      const cntH = all ? (r.cnt ? `<b>${r.cnt}</b>` : '-') : (r.cnt > 1 ? `<button class="mini hmexp" data-exp="${r.rid}">${r.cnt} ${open.has(r.rid) ? '▴' : '▾'}</button>` : '1');
      let h = `<tr data-rid="${r.rid}" class="${all && r.old ? 'old' : ''}"><td class="c"><input type="checkbox" data-sel="${r.rid}" ${sel.has(r.rid) ? 'checked' : ''}></td><td class="l">${U.esc(r.si)}</td><td class="l">${U.esc(r.gu)}</td><td class="l">${U.esc(r.dong)}</td>` +
        `<td class="l name">${tg}<a href="#" data-open="${r.rid}">${U.esc(r.name)}</a></td><td>${r.g}㎡<small>${CONFIG.toPyeong(r.area)}평</small></td><td>${pyName(r.pc)}</td>` +
        `<td class="${rent ? 'rent' : 'sale'}"><b>${eok(r.rep.price)}</b>${dr}</td><td>${all ? `${String(r.rep.d).slice(0, 4)}.${String(r.rep.d).slice(4, 6)}` : U.date(r.rep.d).slice(3)}</td><td>${cntH}</td><td>${r.rep.floor ?? '-'}${fl}</td><td>${r.by || '-'}</td><td>${r.hh ? r.hh.toLocaleString() : '-'}</td>` +
        `<td>${eok(r.peak)}</td><td class="${U.cls(r.drop)}">${U.pct(r.drop)}</td>${all ? '' : `<td class="${U.cls(r.prevd)}">${r.prevd == null ? '-' : (r.prevd > 0 ? '+' : r.prevd < 0 ? '-' : '') + eok(Math.abs(r.prevd))}</td>`}` +
        (rent ? `<td>${eok(r.sale)}</td><td>${r.ratio == null ? '-' : r.ratio.toFixed(0) + '%'}</td><td>${eok(r.gap)}</td>` : '') +
        `<td class="l tags">${tagsOf(r).filter(x => !['NEW'].includes(x)).join(' · ')}</td><td><button class="mini" data-add="${r.rid}">담기</button></td></tr>`;
      if (open.has(r.rid) && !all) h += `<tr class="hmsub"><td></td><td colspan="${ncol - 1}">${r.trades.slice().sort((a, b) => a.d - b.d).map(t => `<span>${U.date(t.d).slice(3)} <b>${eok(t.price)}</b> ${t.floor ?? '-'}층${t.floor != null && t.floor <= 3 ? '(저층)' : ''}${t.direct ? '(직거래)' : ''}</span>`).join(' · ')}</td></tr>`;
      return h;
    }).join('');
    const narrow = window.innerWidth <= 760;
    $('hmTable').closest('.tablewrap').hidden = narrow;
    $('hmCardList').hidden = !narrow;
    if (narrow) {
      $('hmCardList').innerHTML = list.slice(0, shown).map(r => {
        const tg = [r.isNew && '<span class="tg new">NEW</span>', r.leader && '👑', r.high && '🔴', r.fall && '🔵', r.mine && '⭐', all && r.thisMonth && '🟠'].filter(Boolean).join('');
        return `<div class="hmrc"><div class="hmrc1"><input type="checkbox" data-sel="${r.rid}" ${sel.has(r.rid) ? 'checked' : ''}> ${tg}<a href="#" data-open="${r.rid}">${U.esc(r.name)}</a> <small>${U.esc([r.gu || r.si, r.dong].join(' '))}</small></div>` +
          `<div class="hmrc2"><span>${r.g}㎡ ${CONFIG.toPyeong(r.area)}평</span><b class="${rent ? 'rent' : 'sale'}">${eok(r.rep.price)}</b><span>${all ? String(r.rep.d).slice(0, 4) + '.' + String(r.rep.d).slice(4, 6) : U.date(r.rep.d).slice(3)} · ${r.rep.floor ?? '-'}층${all ? '' : ' · ' + r.cnt + '건'}</span></div>` +
          `<div class="hmrc2"><span>${rent ? '최고가' : '전고'} ${eok(r.peak)} <b class="${U.cls(r.drop)}">${U.pct(r.drop)}</b></span>${all ? '' : `<span>직전 <b class="${U.cls(r.prevd)}">${r.prevd == null ? '-' : (r.prevd > 0 ? '+' : r.prevd < 0 ? '-' : '') + eok(Math.abs(r.prevd))}</b></span>`}${rent ? `<span>전세가율 ${r.ratio == null ? '-' : r.ratio.toFixed(0) + '%'} · 매-전 ${eok(r.gap)}</span>` : ''}<button class="mini" data-add="${r.rid}">담기</button></div></div>`;
      }).join('') + (list.length > shown ? `<button class="mini" id="hmMore">더 보기 (${(list.length - shown).toLocaleString()}곳 남음)</button>` : '');
    }
    $('hmTable').innerHTML = head + `<tbody>${rowsH}${list.length > shown ? `<tr><td colspan="${ncol}" class="c"><button class="mini" id="hmMore">더 보기 (${(list.length - shown).toLocaleString()}곳 남음)</button></td></tr>` : ''}</tbody>`;
    const a = $('hmAll'); a.checked = list.length > 0 && list.every(r => sel.has(r.rid)); a.indeterminate = !a.checked && list.some(r => sel.has(r.rid));
    a.onchange = () => { list.forEach(r => (a.checked ? sel.add(r.rid) : sel.delete(r.rid))); drawTable(); };
    Home._list = list;
  }

  function drawRegions() {
    const M = st.ym, cs = codes();
    const s6 = [5, 4, 3, 2, 1, 0].map(k => ymAdd(M, -k));
    const rows = cs.map(c => {
      const reg = regBy.get(c); if (!reg) return null;
      const cnt = new Map(); let sum = 0, n = 0;
      (built.sale.get(c) || new Map()).forEach(o => o.tr.forEach(t => { const y = ymOf(t.d); cnt.set(y, (cnt.get(y) || 0) + 1); if (y === M && !t.direct) { sum += t.price; n++; } }));
      let rc = null;
      if (built.rent.has(c)) { rc = 0; built.rent.get(c).forEach(o => o.tr.forEach(t => { if (ymOf(t.d) === M) rc++; })); }
      const g = (y) => cnt.get(y) || 0, s = g(M), sp = g(ymAdd(M, -1)), sy = g(ymAdd(M, -12));
      return { name: tokLabel('c:' + c), s, sp, sy, chg: sp ? (s / sp - 1) * 100 : null, sp6: s6.map(g), rc, avg: n ? sum / n : null };
    }).filter(Boolean).sort((a, b) => b.s - a.s);
    $('hmRegTitle').textContent = `지역별 거래 현황 · ${ymText(M)} · ${rows.length}개 지역`;
    $('hmRegTable').innerHTML = `<thead><tr><th class="l">지역</th><th>${M % 100}월 매매</th><th>지난달</th><th>증감</th><th>작년 ${M % 100}월</th><th>6개월 흐름</th><th>${M % 100}월 전세</th><th>매매 평균가</th></tr></thead><tbody>` +
      rows.map(r => `<tr><td class="l">${U.esc(r.name)}</td><td class="sale">${r.s.toLocaleString()}</td><td>${r.sp.toLocaleString()}</td><td class="${U.cls(r.chg)}">${U.pct(r.chg, 0)}</td><td>${r.sy.toLocaleString()}</td><td class="spk">${CK.spark(r.sp6, 70, 20)}</td><td class="rent">${r.rc == null ? '<small>전세 선택 시</small>' : r.rc.toLocaleString()}</td><td>${eok(r.avg)}</td></tr>`).join('') + '</tbody>';
  }

  /* ── 고르는 줄 ── */
  function syncControls() {
    document.querySelectorAll('#hmKind button').forEach(b => b.classList.toggle('on', b.dataset.k === st.kind));
    document.querySelectorAll('#hmPy button').forEach(b => b.classList.toggle('on', b.dataset.p ? st.pys.includes(b.dataset.p) : !st.pys.length));
    const custom = !!st.hhCustom && (st.hhMin != null || st.hhMax != null);     // 직접 입력한 범위
    const hhPreset = custom ? null : st.hhMin == null ? '' : String(st.hhMin);
    document.querySelectorAll('#hmHh button').forEach(b => b.classList.toggle('on', hhPreset !== null && b.dataset.h === hhPreset));
    $('hmHhMin').value = custom && st.hhMin != null ? st.hhMin : ''; $('hmHhMax').value = custom && st.hhMax != null ? st.hhMax : '';
    document.querySelectorAll('#hmAge button').forEach(b => b.classList.toggle('on', b.dataset.a === st.age));
    document.querySelectorAll('.hmth').forEach(sel => {
      const opts = [['', '세대수 전체'], ['300', '300세대↑'], ['500', '500세대↑'], ['1000', '1,000세대↑'], ['2000', '2,000세대↑']];
      sel.innerHTML = opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('') + (custom ? `<option value="custom">${hhText()}</option>` : '');
      sel.value = custom ? 'custom' : hhPreset || '';
    });
    document.querySelectorAll('#hmView button').forEach(b => b.classList.toggle('on', b.dataset.v === st.view));
    $('hmYearsWrap').hidden = st.view !== 'all'; $('hmYears').value = String(st.years);
    $('hmLow').checked = st.low; $('hmDirect').checked = st.direct;
    $('hmMonth').value = String(st.ym); $('hmBarMetric').value = st.metric;
    document.querySelectorAll('.hmtm').forEach(s => { s.innerHTML = $('hmMonth').innerHTML; s.value = String(st.ym); });
    document.querySelectorAll('.hmtk').forEach(s => { s.value = st.kind; });
    document.querySelectorAll('.hmtb').forEach(s => {
      s.innerHTML = '<option value="">전체 억대</option>' + BANDS.map((b, i) => `<option value="${i}">${b.l}</option>`).join('') +
        (st.bands.length > 1 ? `<option value="multi">${st.bands.map(b => BANDS[b].l).join('·')}</option>` : '');
      s.value = st.bands.length > 1 ? 'multi' : st.bands.length ? String(st.bands[0]) : '';
    });
    document.getElementById('tab-home').classList.toggle('rentmode', st.kind === 'rent');
    $('hmChips').innerHTML = st.regs.map(t => `<span class="hmchip">${U.esc(tokLabel(t))}<button data-rm="${t}" title="빼기">✕</button></span>`).join('') || '<span class="hint" style="margin:0">지역을 추가하세요</span>';
    const fl = Tracking.folderList();
    if (!st.folder || !fl.includes(st.folder)) st.folder = Tracking.curFolder() || fl[0] || '기본';
    $('hmFolder').innerHTML = fl.map(f => `<option${f === st.folder ? ' selected' : ''}>${U.esc(f)}</option>`).join('') + '<option value="__new">+ 새 폴더…</option>';
    $('hmCondSum').textContent = [st.kind === 'rent' ? '전세' : '매매', ymText(st.ym), st.regs.map(tokLabel).join(', ') || '지역 없음', st.pys.length ? st.pys.map(pyName).join('·') : '전체 평형', hhText(), ageText(), st.bands.length ? st.bands.map(b => BANDS[b].l).join('·') : '억대 미선택', st.view === 'all' ? `지역 전체(${st.years}년)` : ''].filter(Boolean).join(' · ');
    const ps = Store.get(PK, {}) || {};
    const cur = $('hmPreset').value;
    $('hmPreset').innerHTML = '<option value="">저장한 조건 ▾</option>' + Object.keys(ps).map(n => `<option${n === cur ? ' selected' : ''}>${U.esc(n)}</option>`).join('');
    $('hmPresetDel').hidden = !$('hmPreset').value;
  }

  function regPop() {
    const pop = $('hmRegPop');
    const sidoList = [...new Set(regions.map(r => r[1]))];
    const cur = pop.dataset.p || '';
    const subs = cur ? regions.filter(r => (cur.startsWith('m:') ? (metroOf(r) === cur.slice(2) || cityOf(r) === cur.slice(2)) : r[1] === cur)) : [];
    const on = (t) => (st.regs.includes(t) ? ' on' : '');
    pop.innerHTML = `<div class="hmpr"><span class="hmk">묶음</span>${Object.entries(GRP).map(([k, v]) => `<button class="mini${on('g:' + k)}" data-tok="g:${k}">${v}</button>`).join('')}</div>` +
      `<div class="hmpr"><span class="hmk">광역시</span>${METRO.map(m => `<button class="mini${on('m:' + m)}" data-tok="m:${m}">${m}</button>`).join('')}</div>` +
      `<div class="hmpr"><span class="hmk">중소도시</span>${CITY.map(m => `<button class="mini${on('m:' + m)}" data-tok="m:${m}">${m}</button>`).join('')}</div>` +
      `<div class="hmpr"><span class="hmk">구 고르기</span><select id="hmGuSel"><option value="">시·도 / 도시 고르기</option>` +
      sidoList.map(s => `<option value="${U.esc(s)}"${cur === s ? ' selected' : ''}>${U.esc(shortSido(s))}</option>`).join('') +
      [...METRO, ...CITY].filter(m => regions.some(r => metroOf(r) === m || cityOf(r) === m)).map(m => `<option value="m:${m}"${cur === 'm:' + m ? ' selected' : ''}>${m} (구별)</option>`).join('') + '</select></div>' +
      (subs.length ? `<div class="hmpr hmgus">${subs.map(r => `<label class="inline"><input type="checkbox" data-gu="${r[0]}"${st.regs.includes('c:' + r[0]) ? ' checked' : ''}> ${U.esc(tokLabel('c:' + r[0]))}</label>`).join('')}</div>` : '') +
      '<div class="hmpr" style="justify-content:flex-end"><button class="mini" data-close="1">닫기</button></div>';
  }
  function addTok(t) {
    if (t === 'g:all') st.regs = ['g:all'];
    else if (st.regs.includes(t)) st.regs = st.regs.filter(x => x !== t);
    else st.regs = [...st.regs.filter(x => x !== 'g:all'), t];
  }
  const regChanged = () => { sel.clear(); shown = 300; save(); regPop(); refresh(); };

  function rowsByRid(ids) { const all = new Map(rowsNow.map(r => [r.rid, r])); return ids.map(i => all.get(i)).filter(Boolean); }
  function toTrack(rs) {
    const seen = new Set();
    return rs.filter(r => !seen.has(r.o.id) && seen.add(r.o.id)).map(r => {
      const s = st.kind === 'rent' ? lastSale(r.o.id, st.ym * 100 + 99) : r.rep;
      return { id: r.o.id, code: r.o.code, sido: r.sido, sgg: r.sgg, dong: r.dong, jibun: r.jibun, key: r.o.key, name: r.name, g: r.g, buildYear: r.by, st: { last: s ? { price: s.price } : null } };
    });
  }
  function folderPick() {
    let f = $('hmFolder').value;
    if (f === '__new') {
      f = (prompt('새 폴더 이름') || '').trim();
      if (!f) { $('hmFolder').value = st.folder; return null; }
    }
    st.folder = f; save();
    return f;
  }

  function excel() {
    if (!st.bands.length) return U.toast('억대를 먼저 고르세요.');
    const list = Home._list || [], c = cols(), keys = Object.keys(c).filter(k => k !== 'mine' && !(st.view === 'all' && k === 'prevd'));
    const rows = [keys.map(k => c[k].label), ...list.map(r => keys.map(k => { const col = c[k]; if (col.num && !['area', 'pc', 'date'].includes(k)) { const v = col.num(r); return v == null || isNaN(v) ? '' : (['price', 'peak', 'sale', 'gap', 'prevd'].includes(k) ? +(v / 10000).toFixed(2) : +(+v).toFixed(1)); } return col.get(r); }))];
    U.download(`최근거래_${st.kind === 'rent' ? '전세' : '매매'}_${st.ym}_${st.bands.map(b => BANDS[b].l).join('_')}`, [{ name: '최근거래', rows }]);
  }

  async function init() {
    regions = await Data.regions();
    regBy = new Map(regions.map(r => [r[0], r]));
    st = Object.assign(DEF(), Store.get(SK, {}) || {});
    if (!Array.isArray(st.bands)) st.bands = [];
    const saved0 = Store.get(SK, {}) || {};
    if (!Array.isArray(saved0.pys)) st.pys = st.py ? [st.py] : [];      // 예전 한 개 선택(py) → 여러 개(pys)
    delete st.py;
    const months = []; for (let k = 0; k < 36; k++) months.push(ymAdd(nowYm(), -k));
    if (!months.includes(st.ym)) st.ym = ymAdd(nowYm(), -1);
    $('hmMonth').innerHTML = months.map(m => `<option value="${m}">${ymText(m)}${m >= ymAdd(nowYm(), -1) ? ' (집계 중)' : ''}</option>`).join('');
    if (window.innerWidth <= 760) $('hmCond').open = false;

    $('hmKind').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.kind = b.dataset.k; sel.clear(); save(); refresh(); };
    $('hmPy').onclick = (e) => {                             // 여러 개 선택 ([전체] = 모두 풀기)
      const b = e.target.closest('button'); if (!b) return;
      const p = b.dataset.p;
      st.pys = !p ? [] : st.pys.includes(p) ? st.pys.filter(x => x !== p) : PYC.map(x => x[0]).filter(x => x === p || st.pys.includes(x));
      save(); refresh();
    };
    $('hmHh').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.hhMin = b.dataset.h ? +b.dataset.h : null; st.hhMax = null; st.hhCustom = false; save(); refresh(); };
    const hhIn = () => { const a = $('hmHhMin').value.trim(), b = $('hmHhMax').value.trim(); st.hhCustom = a !== '' || b !== ''; st.hhMin = a === '' ? null : Math.max(0, +a); st.hhMax = b === '' ? null : Math.max(0, +b); if (st.hhMin != null && st.hhMax != null && st.hhMax < st.hhMin) [st.hhMin, st.hhMax] = [st.hhMax, st.hhMin]; save(); refresh(); };
    $('hmHhMin').onchange = hhIn; $('hmHhMax').onchange = hhIn;
    $('hmAge').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.age = b.dataset.a; save(); refresh(); };
    document.querySelectorAll('.hmth').forEach(sel => { sel.onchange = () => { if (sel.value === 'custom') return; st.hhMin = sel.value ? +sel.value : null; st.hhMax = null; st.hhCustom = false; save(); refresh(); }; });
    $('hmView').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.view = b.dataset.v; sel.clear(); shown = 300; save(); refresh(); };
    $('hmYears').onchange = () => { st.years = +$('hmYears').value; save(); refresh(); };
    $('hmLow').onchange = () => { st.low = $('hmLow').checked; save(); refresh(); };
    $('hmDirect').onchange = () => { st.direct = $('hmDirect').checked; save(); refresh(); };
    $('hmMonth').onchange = () => { st.ym = +$('hmMonth').value; sel.clear(); save(); refresh(); };
    $('hmBarMetric').onchange = () => { st.metric = $('hmBarMetric').value; save(); refresh(); };
    $('hmBandClear').onclick = () => { st.bands = []; save(); refresh(); };
    $('hmOnlyHigh').onclick = () => { st.onlyHigh = !st.onlyHigh; save(); shown = 300; drawTable(); };
    $('hmSort').onchange = () => { shown = 300; drawTable(); };
    document.querySelectorAll('.hmtb').forEach(s => { s.onchange = () => { if (s.value === 'multi') return; st.bands = s.value === '' ? [] : [+s.value]; sel.clear(); save(); refresh(); }; });
    document.querySelectorAll('.hmtm').forEach(s => { s.onchange = () => { st.ym = +s.value; sel.clear(); save(); refresh(); }; });
    document.querySelectorAll('.hmtk').forEach(s => { s.onchange = () => { st.kind = s.value; sel.clear(); save(); refresh(); }; });
    $('hmChips').onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { st.regs = st.regs.filter(t => t !== b.dataset.rm); regChanged(); } };
    $('hmAddReg').onclick = () => { const p = $('hmRegPop'); p.hidden = !p.hidden; if (!p.hidden) regPop(); };
    $('hmRegPop').onclick = (e) => {
      const t = e.target.closest('[data-tok]'); if (t) { addTok(t.dataset.tok); regChanged(); return; }
      if (e.target.closest('[data-close]')) $('hmRegPop').hidden = true;
    };
    $('hmRegPop').onchange = (e) => {
      if (e.target.id === 'hmGuSel') { $('hmRegPop').dataset.p = e.target.value; regPop(); return; }
      const g = e.target.dataset.gu;
      if (g) { const t = 'c:' + g; st.regs = e.target.checked ? [...st.regs.filter(x => x !== 'g:all' && x !== t), t] : st.regs.filter(x => x !== t); regChanged(); }
    };
    document.addEventListener('mousedown', (e) => { const p = $('hmRegPop'); if (!p.hidden && !p.contains(e.target) && e.target.id !== 'hmAddReg') p.hidden = true; });
    $('hmCards').onclick = (e) => { const b = e.target.closest('[data-card]'); if (!b) return; st.pys = [b.dataset.card]; st.onlyHigh = true; st.view = 'month'; save(); refresh(); };
    $('hmTable').onclick = (e) => {
      const o = e.target.closest('[data-open]');
      if (o) { e.preventDefault(); const r = rowsByRid([o.dataset.open])[0]; if (r) { App.showTab('search'); Search.openComplex({ code: r.o.code, key: r.o.key }); } return; }
      const x = e.target.closest('[data-exp]');
      if (x) { const id = x.dataset.exp; open.has(id) ? open.delete(id) : open.add(id); drawTable(); return; }
      const a = e.target.closest('[data-add]');
      if (a) { const f = folderPick(); if (!f) return; Tracking.add(toTrack(rowsByRid([a.dataset.add])), f); refresh(); return; }
      if (e.target.id === 'hmMore') { shown += 300; drawTable(); }
    };
    $('hmTable').onchange = (e) => { const c = e.target.dataset.sel; if (c) { e.target.checked ? sel.add(c) : sel.delete(c); const a = $('hmAll'); if (a) { const l = Home._list || []; a.checked = l.length > 0 && l.every(r => sel.has(r.rid)); a.indeterminate = !a.checked && l.some(r => sel.has(r.rid)); } } };
    $('hmCardList').onclick = $('hmTable').onclick; $('hmCardList').onchange = (e) => { const c = e.target.dataset.sel; if (c) e.target.checked ? sel.add(c) : sel.delete(c); };
    $('hmFolder').onchange = () => { folderPick(); syncControls(); };
    $('hmAddSel').onclick = () => {
      if (!sel.size) return U.toast('표에서 담을 단지를 체크하세요.');
      const f = folderPick(); if (!f) return;
      Tracking.add(toTrack(rowsByRid([...sel])), f); sel.clear(); refresh();
    };
    $('hmMapSel').onclick = () => {
      if (!sel.size) return U.toast('표에서 지도로 볼 단지를 체크하세요.');
      Tracking.add(toTrack(rowsByRid([...sel])), '지도 추가', true);
      U.toast(`${sel.size}곳을 [지도 추가] 폴더에 담고 시세지도로 이동합니다.`);
      App.showTab('map');
      setTimeout(() => document.querySelector('#pmFolders button[data-pf="지도 추가"]')?.click(), 400);
    };
    $('hmExcel').onclick = excel;
    $('hmRegDet').ontoggle = () => { if ($('hmRegDet').open) drawRegions(); };
    $('hmPreset').onchange = () => {
      const n = $('hmPreset').value, ps = Store.get(PK, {}) || {};
      $('hmPresetDel').hidden = !n;
      if (!n || !ps[n]) return;
      st = Object.assign(st, { pys: [], hhMin: null, hhMax: null, hhCustom: false, age: '' }, ps[n]); if (!Array.isArray(st.pys)) st.pys = st.py ? [st.py] : []; delete st.py; sel.clear(); save(); refresh();
      U.toast(`[${n}] 조건을 불러왔습니다.`);
    };
    $('hmPresetSave').onclick = () => {
      const n = (prompt('이 조건의 이름 (예: 대구 수성 84 5억대)', '') || '').trim();
      if (!n) return;
      const ps = Store.get(PK, {}) || {};
      ps[n] = { kind: st.kind, regs: st.regs, pys: st.pys, hhMin: st.hhMin, hhMax: st.hhMax, hhCustom: !!st.hhCustom, age: st.age, view: st.view, years: st.years, low: st.low, direct: st.direct, bands: st.bands };
      Store.set(PK, ps); syncControls(); $('hmPreset').value = n; $('hmPresetDel').hidden = false;
      U.toast(`[${n}] 조건을 저장했습니다.`);
    };
    $('hmPresetDel').onclick = () => {
      const n = $('hmPreset').value; if (!n || !confirm(`[${n}] 저장 조건을 지울까요?`)) return;
      const ps = Store.get(PK, {}) || {}; delete ps[n]; Store.set(PK, ps); $('hmPreset').value = ''; syncControls();
    };
    await refresh();
  }

  /* 다른 탭(공급)에서 같이 쓰는 도구: 지역 고르기·실거래 자료 */
  async function regReady() { if (!regions.length) { regions = await Data.regions(); regBy = new Map(regions.map(r => [r[0], r])); } return regions; }
  const kit = {
    GRP, METRO, CITY, shortSido, metroOf, cityOf, regReady,
    regions: () => regions, reg: (c) => regBy.get(c),
    codesOf: (tok) => codesOf(tok), tokLabel: (tok) => tokLabel(tok),
    /** 실거래(매매) 자료 → Map(단지·평형 id → {code,key,g,area,tr}) 를 지역마다 */
    async sale(cs, onTick) { let i = 0; for (const c of cs) { await loadKind(c, 'sale'); onTick && onTick(++i, cs.length); } return built.sale; },
    meta: (c) => meta.get(c),
  };
  return { init, refresh, BANDS, pyClass, pyName, kit, _st: () => st };
})();
