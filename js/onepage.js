/* ─────────────────────────────────────────────────────────
   onepage.js — [원페이지] 탭 : 지역 하나를 한 장(16:9)으로 정리하고 PPT 파일로 내려받기
   · 칸 구성 (월급쟁이부자들 원페이지 틀):
       ① 랜드마크 34평 가격 변화 그래프  ← 랜드마크 탭의 단지 + 국토부 실거래(전용 84형 = 34평 고정), 선택한 달까지 6개월 변동률
       ② 매매/전세 물량 (아실 그래프)     ← 캡처 사진 2장을 붙여넣기 (Ctrl+V · 끌어놓기 · 눌러서 고르기). 사진은 저장하지 않고 PPT 에만 들어감
       ③ 공급물량                          ← 공급지도 탭에 올려 둔 부동산지인 입주물량 엑셀
       ④ 시세트래킹 단지 표                ← 시세트래킹 탭 (검정 = 호가 · 파랑 = 호가가 없어 실거래로 채운 값)
          [심화] 시세 스캐닝 (84/59 × 억대별) ← 1등뽑기·시세트래킹 단지
       ⑤ 지역정리 / 리스크 / 내 생각       ← 직접 쓰기 + [자동 초안] (숫자로 계산한 문장, AI 아님)
   · 지역·월마다 따로 저장 (글·제외한 단지·고른 랜드마크·입주 단지 메모). 아실 사진은 저장하지 않습니다.
   · 지역 목록 = 앞마당 탭의 지역 판 + 그 밖의 전체 지역
   · PPT: 글·표·그래프를 PowerPoint 에서 그대로 고칠 수 있음 (lib/pptxgen.bundle.js 를 처음 누를 때 한 번 불러옴)
   저장 위치: apt.onepage.v1 (지역·월별 기록 — 백업·자동 동기화에 들어갑니다) · apt.onepageUi.v1 (화면 설정, 이 기기만)
   ───────────────────────────────────────────────────────── */
let _pptxP = null;
function needPptx() {
  if (typeof PptxGenJS !== 'undefined') return Promise.resolve();
  if (!_pptxP) _pptxP = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'lib/pptxgen.bundle.js';
    s.onload = () => res(); s.onerror = () => { _pptxP = null; rej(new Error('PPT 기능(lib/pptxgen.bundle.js)을 불러오지 못했습니다. 파일이 lib 폴더에 올라갔는지 확인하세요.')); };
    document.head.appendChild(s);
  });
  return _pptxP;
}

const OnePage = (() => {
  const root = document.getElementById('tab-onepage');
  if (!root) return {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => U.esc(s);
  const KEY = 'apt.onepage.v1', UKEY = 'apt.onepageUi.v1';
  const PY = 34;                                   // 그래프 평형: 공급 34평 = 전용 84형 (고정)
  const GAPLIM = 10;                               // 호가가 최근 실거래와 이 % 이상 벌어지면 경고
  const DEF_GROUPS = [{ k: '59', min: 55, max: 65 }, { k: '74', min: 66, max: 79 }, { k: '84', min: 80, max: 89 }];

  /* ═════════ 상태 ═════════ */
  let pages = {}, ui = {}, inited = false, seq = 0, model = null, chart = null;
  let regionsAll = [], regionMap = new Map(), regByName = new Map(), popData = null, board = [];
  const imgs = { a: null, b: null };               // 아실 사진 (이 화면에서만 · 저장 안 함)
  let activeSlot = 'a', saveTimer = null;

  const nowYm = () => { const t = new Date(); return t.getFullYear() * 100 + t.getMonth() + 1; };
  const load = () => {
    pages = Store.get(KEY, {}) || {};
    ui = Object.assign({ code: '', ym: nowYm(), mode: 'basic', range: 36, rFrom: 0, rTo: 0, stat: 'avg', rows: 0, rowsAll: 1, supScope: 'city', supMin: 100, noRent: 0 }, Store.get(UKEY, {}) || {});
    if (!ui.rowsAll) { ui.rows = 0; ui.rowsAll = 1; Store.set(UKEY, ui); }      // 예전에 저장된 '표 단지 수' 제한(8·10·12개)은 한 번 풀어 줌 → 기본 '전체'
  };
  const saveUi = () => Store.set(UKEY, ui);
  const pkey = () => `${ui.code}|${ui.ym}`;
  const page = () => pages[pkey()] || {};
  function patch(fn) {                              // 이 지역·달의 기록 바꾸기
    const k = pkey(), cur = pages[k] ? JSON.parse(JSON.stringify(pages[k])) : {};
    fn(cur); cur.at = Date.now();
    const empty = !(cur.t && Object.values(cur.t).some(Boolean)) && !(cur.ex && cur.ex.length) && !cur.lm && !(cur.memo && Object.keys(cur.memo).length);
    if (empty) delete pages[k]; else pages[k] = cur;
    const ok = Store.set(KEY, pages);
    const el = $('opSaved'); if (el) { const t = new Date(); el.textContent = ok === false ? '⚠ 저장 실패 — 백업 파일로 저장해 두세요' : `✓ 저장됨 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`; el.classList.toggle('bad', ok === false); }
  }
  const locked = () => { if (typeof Vault !== 'undefined' && Vault.isLocked()) { U.toast('잠금 상태입니다. 오른쪽 위 [잠금]을 풀면 고칠 수 있습니다.'); return true; } return false; };

  /* ═════════ 작은 도구 ═════════ */
  const clean = (s) => String(s ?? '').replace(/[　 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const nosp = (s) => clean(s).replace(/\s/g, '');
  function sidoShort(s) {
    const t = nosp(s);
    const M = [['충청북', '충북'], ['충청남', '충남'], ['전라북', '전북'], ['전북', '전북'], ['전라남', '전남'], ['경상북', '경북'], ['경상남', '경남'], ['강원', '강원'], ['제주', '제주'], ['세종', '세종'], ['경기', '경기']];
    for (const [a, b] of M) if (t.startsWith(a)) return b;
    return t.slice(0, 2);
  }
  const addMonths = (ym, k) => { let y = Math.floor(ym / 100), m = ym % 100 + k; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return y * 100 + m; };
  const monthsEnding = (ym, n) => Array.from({ length: n }, (_, i) => addMonths(ym, -(n - 1 - i)));
  const monthsBetween = (a, b) => { const out = []; for (let m = a, k = 0; m <= b && k < 300; m = addMonths(m, 1), k++) out.push(m); return out; };
  /** 그래프에 그릴 달 목록: 목록에서 고른 기간(끝 = 선택한 월) 또는 '직접 지정'(시작월~끝월) */
  function chartMonths(ym) {
    if (+ui.range > 0) return monthsEnding(ym, +ui.range);
    let a = +ui.rFrom || addMonths(ym, -35), b = +ui.rTo || ym;
    if (a > b) [a, b] = [b, a];
    return monthsBetween(a, Math.min(b, Math.max(nowYm(), ym)));
  }
  const ymDot = (ym) => `${Math.floor(ym / 100)}.${String(ym % 100).padStart(2, '0')}`;
  const ymKor = (ym) => `${Math.floor(ym / 100)}년 ${ym % 100}월`;
  const ymStr = (ym) => `${Math.floor(ym / 100)}-${String(ym % 100).padStart(2, '0')}`;            // '2026-11'
  const ymFromStr = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{1,2})/); return m ? +m[1] * 100 + +m[2] : null; };
  const eok = (v) => (v == null ? '-' : U.price(v));                       // 만원 → 12억 1,950
  const eok1 = (v) => (v == null ? '-' : (v / 10000).toFixed(1));          // 15.5
  const man = (v) => (v == null ? '' : Math.round(v).toLocaleString());     // 120,000
  const pct1 = (v) => (v == null ? '-' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
  const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  const agg = (a) => (a.length ? Math.round(ui.stat === 'med' ? median(a) : a.reduce((s, v) => s + v, 0) / a.length) : null);
  const shortLoc = (sido, sgg) => `${sidoShort(sido)} ${String(sgg).split(' ').map(t => (t.length > 2 ? t.replace(/(시|구|군)$/, '') : t)).join(' ')}`;
  const regLabel = (code) => { const r = regionMap.get(code); return r ? (r[2] || '') : ''; };

  /* ═════════ 지역 목록 ═════════ */
  function makeBoard() {
    const st = Store.get('apt.yardmap.v1', null), out = [];
    if (st && Array.isArray(st.groups)) {
      for (const g of st.groups) for (const b of g.boxes || []) {
        const code = regByName.get(`${b.sido}|${b.sgg}`); if (!code) continue;
        out.push({ code, name: b.city ? `${b.city} ${b.name}` : b.name, group: g.name, on: !!b.on });
      }
    }
    return out;
  }
  function regionOptions() {
    const seen = new Set(), parts = [];
    const groups = [...new Set(board.map(b => b.group))];
    for (const g of groups) {
      const list = board.filter(b => b.group === g && !seen.has(b.code));
      list.forEach(b => seen.add(b.code));
      if (list.length) parts.push(`<optgroup label="앞마당 · ${esc(g)}">${list.map(b => `<option value="${b.code}">${b.on ? '★ ' : ''}${esc(b.name)}</option>`).join('')}</optgroup>`);
    }
    const bySido = new Map();
    regionsAll.filter(r => !seen.has(r[0])).forEach(r => { (bySido.get(r[1]) || bySido.set(r[1], []).get(r[1])).push(r); });
    for (const [sido, list] of bySido) parts.push(`<optgroup label="그 밖의 지역 · ${esc(sido)}">${list.map(r => `<option value="${r[0]}">${esc(r[2])}</option>`).join('')}</optgroup>`);
    return parts.join('');
  }

  /* ═════════ 자료 만들기 ═════════ */
  /** ① 랜드마크 34평 월별 실거래 그래프 */
  async function buildChart(lm, ym) {
    const months = chartMonths(ym), pos = new Map(months.map((m, i) => [m, i])), endYm = months[months.length - 1], startYm = months[0];
    const y1 = Math.floor(endYm / 100), y0 = Math.min(Math.floor(CONFIG.PEAK_FROM / 10000), Math.floor(startYm / 100), y1 - 6), endD = endYm * 100 + 31;
    const tr = await Data.complexTrades(lm.code, lm.key, null, y0, y1);
    const sale = tr.sale.filter(t => !t.direct && t.d <= endD && CONFIG.toPyeong(t.area) === PY);
    const rent = tr.rent.filter(t => t.d <= endD && CONFIG.toPyeong(t.area) === PY);
    if (!sale.length && !rent.length) return { empty: true };
    const sl = months.map(() => []), rl = months.map(() => []);
    sale.forEach(t => { const i = pos.get(Math.floor(t.d / 100)); if (i != null) sl[i].push(t.price); });
    rent.forEach(t => { const i = pos.get(Math.floor(t.d / 100)); if (i != null) rl[i].push(t.price); });
    const sv = sl.map(agg), rv = rl.map(agg);
    const change = (vals) => {
      const n = vals.length; let e = -1;
      for (let i = n - 1; i >= Math.max(0, n - 3); i--) if (vals[i] != null) { e = i; break; }
      if (e < 0) return null;
      let s = -1; for (const j of [e - 6, e - 7, e - 5]) if (j >= 0 && vals[j] != null) { s = j; break; }
      return s < 0 ? { e, v: vals[e] } : { e, s, v: vals[e], v0: vals[s], pct: (vals[e] / vals[s] - 1) * 100, diff: vals[e] - vals[s] };
    };
    const cs = change(sv), cr = change(rv);
    const all2020 = sale.filter(t => t.d >= CONFIG.PEAK_FROM), pk = Data.peakTrough(all2020).peak, last = sale[sale.length - 1] || null;
    const cnt = (arr, a, b) => arr.slice(a, b).reduce((s, x) => s + x.length, 0), n = months.length;
    return { months, sv, rv, sn: sl.map(a => a.length), rn: rl.map(a => a.length), cs, cr, peak: pk, last,
      newHigh: !!(pk && Math.floor(pk.d / 100) === endYm), fromPeak: last && pk ? (last.price / pk.price - 1) * 100 : null,
      c3: cnt(sl, n - 3, n), p3: cnt(sl, n - 6, n - 3), rc3: cnt(rl, n - 3, n), rp3: cnt(rl, n - 6, n - 3) };
  }

  /** ④ 시세트래킹 단지 표 (그 달까지 적은 호가, 없으면 실거래) */
  async function buildTracking(code, ym) {
    const items = (typeof Tracking !== 'undefined' ? Tracking.all() : []).filter(it => it.code === code);
    try { await Real.load(items.map(it => ({ id: it.id, code: it.code, key: it.key, g: it.g }))); } catch (e) { console.error(e); }
    const rows = items.map(it => {
      const qs = it.quotes || {}, ms = Object.keys(qs).map(Number).filter(m => m <= ym).sort((a, b) => b - a);
      const pair = (f) => { const l = ms.filter(m => qs[m] && qs[m][f] != null); return [l[0] != null ? qs[l[0]][f] : null, l[1] != null ? qs[l[1]][f] : null]; };
      const [s0, s1] = pair('s'), [r0, r1] = pair('r'), rl = Real.get(it.id) || {};
      const s = s0 ?? rl.sale?.price ?? null, r = r0 ?? rl.rent?.price ?? null;
      const askGap = s0 != null && rl.sale ? (s0 - rl.sale.price) / rl.sale.price * 100 : null;
      return { id: it.id, name: it.name, dong: it.dong, by: it.buildYear || rl.buildYear || null, hh: +it.households || rl.hh || null, g: it.g, py: CONFIG.toPyeong(it.g),
        struct: it.structure || '', rooms: it.rooms || '', baths: it.baths || '', s, sReal: s0 == null && s != null, ds: s0 != null && s1 != null ? s0 - s1 : null,
        r, rReal: r0 == null && r != null, dr: r0 != null && r1 != null ? r0 - r1 : null, gap: s != null && r != null ? s - r : null, ratio: s && r ? r / s * 100 : null, askGap, folders: it.folders || [] };
    }).sort((a, b) => (b.s ?? -1) - (a.s ?? -1) || a.name.localeCompare(b.name, 'ko'));
    return { rows };
  }

  /** ③ 공급물량 (공급지도 탭에 올린 부동산지인 엑셀) */
  function buildSupply(reg, ym) {
    const data = Store.get('apt.supply.v1', { rows: [], files: [] }) || { rows: [] };
    const so = Store.get('apt.supplyOpts.v1', {}) || {}, ratio = so.ratio ?? 0.5;
    if (!data.rows || !data.rows.length) return { none: true };
    const sido = sidoShort(reg[1]), sgg = reg[2], city = sgg.split(' ')[0];
    const inScope = (r) => sidoShort(r.sido) === sido && (ui.supScope === 'gu' ? nosp(r.sgg) === nosp(sgg) : (nosp(r.sgg).startsWith(nosp(city)) || nosp(r.sgg) === nosp(sgg)));
    const from = ymStr(addMonths(ym, -12)), to = ymStr(addMonths(ym, 36)), p = page().memo || {};
    const rows = data.rows.filter(r => inScope(r) && r.ym && r.ym >= from && r.ym <= to && r.hh >= (+ui.supMin || 0) && !(ui.noRent && /임대/.test(r.type || '')))
      .sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : b.hh - a.hh))
      .map(r => ({ id: r.id, loc: shortLoc(r.sido, r.sgg), name: r.name, ym: r.ym, hh: r.hh, memo: p[r.id] || '' }));
    const cur = ymStr(ym), c6 = ymStr(addMonths(ym, 6)), c12 = ymStr(addMonths(ym, 12));
    const sum = (f) => rows.filter(f).reduce((s, r) => s + r.hh, 0);
    const codes = regionsAll.filter(r => sidoShort(r[1]) === sido && (ui.supScope === 'gu' ? r[0] === reg[0] : (nosp(r[2]).startsWith(nosp(city)) || r[0] === reg[0]))).map(r => r[0]);
    let hhTot = null, pop = null;
    if (popData && popData.byCode && codes.length && codes.every(c => popData.byCode[c])) { hhTot = codes.reduce((s, c) => s + (popData.byCode[c].hh || 0), 0) || null; pop = codes.reduce((s, c) => s + (popData.byCode[c].pop || 0), 0) || null; }
    return { rows, total: sum(() => true), n6: rows.filter(r => r.ym >= cur && r.ym <= c6).length, hh6: sum(r => r.ym >= cur && r.ym <= c6), hh12: sum(r => r.ym >= cur && r.ym <= c12),
      hhTot, pop, need: pop ? pop * ratio / 100 : null, ratio, scopeName: ui.supScope === 'gu' ? sgg : city };
  }

  /** 심화: 시세 스캐닝 (평형 × 억대, 칸마다 좋은 단지 2개까지) */
  function buildScan(code, ym, trkRows) {
    const yo = Store.get('apt.yardOpts.v1', {}) || {}, groups = Array.isArray(yo.groups) && yo.groups.length ? yo.groups : DEF_GROUPS;
    const groupOf = (g) => groups.find(x => g >= x.min && g <= x.max) || null;
    const cols = ['84', '59'].filter(k => groups.some(g => g.k === k)); if (!cols.length) cols.push(groups[groups.length - 1].k);
    const cx = Store.get('apt.yard.v1', {}) || {}, sv = Store.get('apt.yardSurveys.v1', {}) || {}, picks = Store.get('apt.yardPicks.v1', {}) || {};
    const lim = `${Math.floor(ym / 100)}-${String(ym % 100).padStart(2, '0')}-31`;
    const surveys = Object.keys(sv).map(id => ({ id, ...sv[id] })).filter(s => s.date && s.date <= lim).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.t || 0) - (b.t || 0)));
    const pool = new Map();
    for (const cid of Object.keys(cx)) {                                   // 1등뽑기 단지 (이 지역)
      const c = cx[cid]; if (c.code !== code) continue;
      for (const g of c.gs || []) {
        if (c.hide && c.hide.includes(g)) continue; const gr = groupOf(g); if (!gr || !cols.includes(gr.k)) continue;
        const id = `${cid}#${g}`; let v = null;
        for (let i = surveys.length - 1; i >= 0; i--) { const q = surveys[i].q?.[id]; if (q && (q.s != null || q.r != null)) { v = { s: q.s ?? null, r: q.r ?? null }; break; } }
        if (!v || v.s == null) continue;
        const first = Object.values(picks[ym] || {}).some(gp => Object.values(gp).some(p => p.id === id));
        pool.set(id, { id, grp: gr.k, name: c.name, s: v.s, r: v.r, gap: v.r != null ? v.s - v.r : null, by: null, first, pk: !!c.pick?.[g], trk: false });
      }
    }
    for (const t of trkRows) {                                             // 시세트래킹 단지 (이 지역)
      const gr = groupOf(t.g); if (!gr || !cols.includes(gr.k) || t.s == null) continue;
      const cur = pool.get(t.id);
      if (cur) { cur.trk = true; cur.by = t.by; continue; }
      pool.set(t.id, { id: t.id, grp: gr.k, name: t.name, s: t.s, r: t.r, gap: t.gap, by: t.by, first: false, pk: false, trk: true });
    }
    const list = [...pool.values()];
    if (!list.length) return { cols, rows: [], none: true };
    const rank = (a, b) => (b.first - a.first) || (b.pk - a.pk) || (b.trk - a.trk) || ((a.gap ?? 1e9) - (b.gap ?? 1e9)) || ((b.by || 0) - (a.by || 0));
    const bandOf = (c) => Math.floor(c.s / 10000);
    let los = [...new Set(list.map(bandOf))].sort((a, b) => b - a);
    const full = []; for (let b = los[0]; b >= los[los.length - 1]; b--) full.push(b);
    let bands = full.map(b => ({ lo: b, hi: b, top: false, bot: false }));
    const cnt = (bd) => list.filter(c => bandOf(c) >= bd.lo && bandOf(c) <= bd.hi).length;
    while (bands.length > 8) {                                             // 너무 길면 양 끝을 합침 (예: 11억대 이상 / 5억대 이하)
      const a = bands[0], z = bands[bands.length - 1];
      if (cnt(a) <= cnt(z)) { bands.splice(0, 2, { lo: bands[1].lo, hi: a.hi, top: true, bot: false }); } else { bands.splice(bands.length - 2, 2, { lo: z.lo, hi: bands[bands.length - 2].hi, top: false, bot: true }); }
    }
    const rows = bands.map(bd => {
      const inb = list.filter(c => bandOf(c) >= bd.lo && bandOf(c) <= bd.hi);
      const rs = inb.map(c => c.r).filter(v => v != null).map(v => Math.floor(v / 10000));
      const label = bd.top ? `${bd.lo}억대 이상` : bd.bot ? `${bd.hi}억대 이하` : `${bd.lo}억대`;
      const sub = rs.length ? `(전세 ${Math.min(...rs) === Math.max(...rs) ? Math.min(...rs) : Math.min(...rs) + '~' + Math.max(...rs)}억대)` : '(전세 -)';
      const cells = {}; cols.forEach(k => { cells[k] = inb.filter(c => c.grp === k).sort(rank).slice(0, 2); });
      return { label, sub, cells };
    });
    return { cols, rows };
  }

  /* ═════════ 자동 초안 (숫자로 계산한 문장 — AI 아님) ═════════ */
  function drafts(m) {
    const out = { sum: [], risk: [], mine: [] }, c = m.chart, lm = m.lm;
    if (lm && c && !c.empty) {
      const s = c.cs, r = c.cr;
      if (s && s.pct != null) out.sum.push(`${lm.name} 34평 매매 6개월(${ymDot(c.months[s.s])}~${ymDot(c.months[s.e])}) ${pct1(s.pct)}(${s.diff > 0 ? '+' : ''}${eok(s.diff)})${r && r.pct != null ? `, 전세 ${pct1(r.pct)}` : ''}.`);
      else if (s) out.sum.push(`${lm.name} 34평 ${ymDot(c.months[s.e])} 매매 평균 ${eok(s.v)} (6개월 전 비교 자료 없음).`);
      if (c.newHigh) out.sum.push('최근 랜드마크 매매가 신고가를 갱신했습니다.');
      else if (c.fromPeak != null) out.sum.push(`최근 매매가는 2020년 이후 전고점 대비 ${pct1(c.fromPeak)}.`);
      if (c.c3 || c.p3) out.sum.push(`랜드마크 34평 매매 거래 최근 3개월 ${c.c3}건 (직전 3개월 ${c.p3}건), 전세 ${c.rc3}건 (직전 ${c.rp3}건).`);
    } else if (lm) out.sum.push(`${lm.name} 34평 실거래가 없어 가격 흐름을 계산하지 못했습니다.`);
    else out.sum.push('이 지역에 등록한 랜드마크가 없습니다.');
    const sp = m.supply;
    if (sp && !sp.none) {
      out.risk.push(`${sp.scopeName} 향후 6개월 입주 ${sp.n6}단지 ${sp.hh6.toLocaleString()}세대, 12개월 ${sp.hh12.toLocaleString()}세대.`);
      if (sp.hhTot) out.risk.push(`12개월 입주 물량은 지역 전체 ${sp.hhTot.toLocaleString()}세대의 ${(sp.hh12 / sp.hhTot * 100).toFixed(1)}%.`);
      if (sp.need) out.risk.push(`적정 수요(인구 × ${sp.ratio}% = 연 ${Math.round(sp.need).toLocaleString()}세대) 대비 12개월 입주 ${Math.round(sp.hh12 / sp.need * 100)}%.`);
      const memos = sp.rows.filter(r => r.memo); memos.slice(0, 4).forEach(r => out.risk.push(`${r.name}(${r.ym.slice(0, 4)}.${r.ym.slice(5)} 입주): ${r.memo}`));
    } else out.risk.push('공급지도 탭에 부동산지인 입주물량 엑셀을 올리면 입주 물량 문장이 채워집니다.');
    const rows = m.trk.rows;
    if (rows.length) {
      const gp = rows.filter(r => r.gap != null);
      const within = (n) => gp.filter(r => r.gap <= n * 10000);
      if (gp.length) out.mine.push(`시세트래킹 ${rows.length}단지 중 투자금 1억 이하 ${within(1).length}단지, 2억 이하 ${within(2).length}단지, 3억 이하 ${within(3).length}단지.`);
      const cheap = [...within(2)].sort((a, b) => a.gap - b.gap).slice(0, 3);
      if (cheap.length) out.mine.push(`투자금 2억 이하 낮은 순: ${cheap.map(r => `${r.name} ${r.py}평 ${eok1(r.s)}/${eok1(r.r)}(${eok1(r.gap)})`).join(', ')}.`);
      const up = rows.filter(r => r.ds != null && r.ds > 0), dn = rows.filter(r => r.ds != null && r.ds < 0);
      if (up.length || dn.length) out.mine.push(`전월 대비 매매 호가 오른 단지 ${up.length}개, 내린 단지 ${dn.length}개.`);
      const big = rows.filter(r => r.askGap != null && Math.abs(r.askGap) >= GAPLIM);
      if (big.length) out.mine.push(`호가와 최근 실거래가 ${GAPLIM}% 이상 벌어진 단지: ${big.slice(0, 4).map(r => `${r.name}(${pct1(r.askGap)})`).join(', ')} — 확인 필요.`);
    } else out.mine.push('이 지역에 담은 시세트래킹 단지가 없습니다.');
    return { sum: out.sum.join('\n'), risk: out.risk.join('\n'), mine: out.mine.join('\n') };
  }

  async function build() {
    const code = ui.code, ym = +ui.ym, reg = regionMap.get(code);
    const pg = page(), lms = (typeof Land !== 'undefined' ? Land.all() : []).filter(l => l.code === code);
    const lm = lms.find(l => l.id === pg.lm) || lms[0] || null;
    const m = { code, ym, reg, lms, lm, page: pg };
    m.chart = lm ? await buildChart(lm, ym) : null;
    m.trk = await buildTracking(code, ym);
    m.supply = buildSupply(reg, ym);
    m.scan = ui.mode === 'deep' ? buildScan(code, ym, m.trk.rows) : null;
    m.draft = drafts(m);
    return m;
  }

  /* ═════════ 화면 ═════════ */
  function frame() {
    root.innerHTML = `
    <section class="panel op-ctl">
      <div class="bar"><strong>📄 원페이지</strong><span class="hint" style="margin:0">지역·월을 고르면 한 장으로 정리됩니다 · PPT 로 내려받기</span><span class="grow"></span>
        <span class="op-saved" id="opSaved" title="글·제외한 단지·입주 단지 메모는 입력하는 순간 이 브라우저에 지역·월별로 저장됩니다 (아실 사진은 저장하지 않음)">✓ 자동 저장</span>
        <button id="opPpt" class="primary">📊 PPT 다운로드</button></div>
      <div class="filters">
        <label>지역 <select id="opRegion" style="min-width:190px"></select></label>
        <label>월 <input type="month" id="opYm"></label>
        <div><span class="hint" style="margin:0">보기</span><div class="presets" id="opMode"><button data-m="basic">기본</button><button data-m="deep">심화 (시세 스캐닝)</button></div></div>
        <label>그래프 기간 <select id="opRange"><option value="12">1년</option><option value="24">2년</option><option value="36">3년</option><option value="60">5년</option><option value="120">10년</option><option value="0">직접 지정</option></select></label>
        <label id="opSpan" hidden title="그래프에 그릴 시작월과 끝월을 직접 고릅니다">기간 <span style="display:flex;gap:4px;align-items:center"><input type="month" id="opFrom"> ~ <input type="month" id="opTo"></span></label>
        <label>월 가격 <select id="opStat"><option value="avg">평균</option><option value="med">중앙값</option></select></label>
        <label>표 단지 수 <select id="opRows"><option value="0">전체 (제한 없음)</option><option value="8">8개</option><option value="10">10개</option><option value="12">12개</option><option value="16">16개</option><option value="20">20개</option></select></label>
        <label>공급 범위 <select id="opSupScope"><option value="city">같은 시 전체</option><option value="gu">이 지역만</option></select></label>
        <label>공급 최소 세대 <select id="opSupMin"><option value="0">전부</option><option value="100">100세대 이상</option><option value="300">300세대 이상</option></select></label>
        <label class="row" style="flex-direction:row;align-items:center;padding-bottom:7px;gap:6px"><input type="checkbox" id="opNoRent"> 임대 제외</label>
      </div>
    </section>
    <div id="opBody"><p class="hint" style="padding:14px">불러오는 중…</p></div>`;
    $('opRegion').innerHTML = regionOptions();
    syncCtl();
  }
  function syncCtl() {
    $('opRegion').value = ui.code; $('opYm').value = ymStr(+ui.ym);
    $('opRange').value = String(ui.range); $('opStat').value = ui.stat;
    const custom = !(+ui.range > 0), mx = ymStr(Math.max(nowYm(), +ui.ym)); $('opSpan').hidden = !custom;
    $('opFrom').max = $('opTo').max = mx; $('opFrom').value = ymStr(+ui.rFrom || addMonths(+ui.ym, -35)); $('opTo').value = ymStr(+ui.rTo || +ui.ym); $('opRows').value = String(ui.rows);
    $('opSupScope').value = ui.supScope; $('opSupMin').value = String(ui.supMin); $('opNoRent').checked = !!ui.noRent;
    $('opMode').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.m === ui.mode));
  }

  const cellMoney = (v, real) => (v == null ? '-' : `<span class="${real ? 'op-real' : ''}">${man(v)}</span>`);
  const cellDiff = (v) => (v == null ? '-' : `<span class="${U.cls(v)}">${v === 0 ? '0' : (v > 0 ? '' : '-') + man(Math.abs(v))}</span>`);

  function trkTable(m) {
    const ex = new Set(m.page.ex || []), rows = m.trk.rows;
    if (!rows.length) return '<p class="hint">이 지역에 담은 시세트래킹 단지가 없습니다. 시세트래킹 탭에서 단지를 담으면 여기에 나옵니다.</p>';
    const shown = rows.filter(r => !ex.has(r.id));
    const lim = +ui.rows > 0 ? shown.slice(0, +ui.rows) : shown;                // 표 단지 수 '전체' = 제한 없음
    return `<div class="tablewrap"><table class="op-t"><thead><tr><th class="c"></th><th class="l">단지</th><th>연식</th><th>세대수</th><th>평형</th><th>전용</th><th>계/복</th><th>방</th><th>화</th><th>매매</th><th>전월대비</th><th>전세</th><th>전월대비</th><th>매-전</th><th>전세가율</th></tr></thead><tbody>` +
      rows.map(r => { const off = ex.has(r.id), inList = lim.includes(r);
        return `<tr class="${off ? 'op-off' : inList ? '' : 'op-over'}" data-id="${esc(r.id)}"><td class="c"><input type="checkbox" data-ex ${off ? '' : 'checked'} title="원페이지·PPT 표에 넣기"></td>` +
          `<td class="l">${esc(r.name)}${r.askGap != null && Math.abs(r.askGap) >= GAPLIM ? ` <span class="op-warn" title="호가가 최근 실거래와 ${pct1(r.askGap)} 벌어짐">⚠</span>` : ''}</td><td>${r.by || '-'}</td><td>${r.hh ? r.hh.toLocaleString() : '-'}</td><td>${r.py}</td><td>${r.g}</td>` +
          `<td>${esc(r.struct) || '-'}</td><td>${esc(r.rooms) || '-'}</td><td>${esc(r.baths) || '-'}</td><td>${cellMoney(r.s, r.sReal)}</td><td>${cellDiff(r.ds)}</td><td>${cellMoney(r.r, r.rReal)}</td><td>${cellDiff(r.dr)}</td><td>${cellMoney(r.gap, false)}</td><td>${r.ratio == null ? '-' : Math.round(r.ratio) + '%'}</td></tr>`; }).join('') +
      `</tbody></table></div><p class="hint" style="margin:6px 0 0"><span class="op-real">파랑</span> = 호가가 없어 최근 실거래로 채운 값 · 맨 앞 ✓ 를 끄면 표에서 뺍니다 · ${+ui.rows > 0 && shown.length > lim.length ? `위에서 ${lim.length}개만 PPT 에 들어갑니다 (옅은 줄 = 개수 초과).` : `체크한 ${lim.length}개가 모두 PPT 한 장에 들어갑니다 (많으면 글자가 작아집니다).`}${lim.length > 30 ? ' <b style="color:var(--danger)">⚠ 30개가 넘으면 PPT 글자가 너무 작아져 읽기 어렵습니다 — 일부를 빼 주세요.</b>' : ''}</p>`;
  }
  function scanTable(m) {
    const s = m.scan;
    if (!s || s.none) return '<p class="hint">이 지역에 1등뽑기·시세트래킹 단지(호가 또는 실거래가 있는 단지)가 없어 스캐닝 표를 만들지 못했습니다.</p>';
    const cell = (c) => `<div class="op-sc">${c.first ? '<b title="1등">★</b>' : c.pk ? '<b title="픽">✔</b>' : ''}${esc(c.name)} <span>${eok1(c.s)}/${eok1(c.r)}${c.gap != null ? `(${eok1(c.gap)})` : ''}</span></div>`;
    return `<div class="tablewrap"><table class="op-t op-scan"><thead><tr><th>평형</th>${s.cols.map(k => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>` +
      s.rows.map(r => `<tr><th class="op-bl">${esc(r.label)}<small>${esc(r.sub)}</small></th>${s.cols.map(k => `<td class="l">${r.cells[k].length ? r.cells[k].map(cell).join('') : '<span class="op-na">-</span>'}</td>`).join('')}</tr>`).join('') +
      '</tbody></table></div><p class="hint" style="margin:6px 0 0">칸마다 최대 2개: ★ 1등 → ✔ 픽 → 시세트래킹 담은 단지 → 투자금 적은 순. 단지명 옆 숫자 = 매매/전세(투자금), 억 단위.</p>';
  }
  function supplyTable(m) {
    const sp = m.supply;
    if (sp.none) return '<p class="hint">공급지도 탭에 부동산지인 입주물량 엑셀을 올리면 이 칸이 채워집니다.</p>';
    if (!sp.rows.length) return `<p class="hint">${esc(sp.scopeName)} 에서 ${ymDot(addMonths(m.ym, -12))} ~ ${ymDot(addMonths(m.ym, 36))} 입주 예정 단지가 없습니다. (조건: ${+ui.supMin ? ui.supMin + '세대 이상' : '전부'}${ui.noRent ? ' · 임대 제외' : ''})</p>`;
    return `<div class="tablewrap"><table class="op-t"><thead><tr><th class="l">위치</th><th class="l">단지명</th><th>입주</th><th>세대수</th><th class="l">메모 (전세 시작가 등)</th></tr></thead><tbody>` +
      sp.rows.map(r => `<tr data-sid="${esc(r.id)}"><td class="l">${esc(r.loc)}</td><td class="l">${esc(r.name)}</td><td>${r.ym.slice(0, 4)}년 ${+r.ym.slice(5)}월</td><td>${r.hh.toLocaleString()}</td><td class="l"><input class="op-memo" data-memo value="${esc(r.memo)}" placeholder="예: 25평 전세 4.9억부터"></td></tr>`).join('') +
      `<tr class="op-sum"><td class="l" colspan="3"><b>${esc(sp.scopeName)} 합계</b></td><td><b>${sp.total.toLocaleString()}</b></td><td></td></tr></tbody></table></div>` +
      `<p class="hint" style="margin:6px 0 0">입주 ${ymDot(addMonths(m.ym, -12))} ~ ${ymDot(addMonths(m.ym, 36))} · 향후 6개월 ${sp.n6}단지 ${sp.hh6.toLocaleString()}세대${sp.need ? ` · 12개월 ${sp.hh12.toLocaleString()}세대 = 적정 수요(연 ${Math.round(sp.need).toLocaleString()})의 ${Math.round(sp.hh12 / sp.need * 100)}%` : ''}. PPT 에는 위 표가 모두 들어갑니다 (많으면 글자가 작아지고 사진 칸이 조금 줄어듭니다).</p>`;
  }
  function chartInfo(m) {
    const c = m.chart;
    if (!m.lm) return '<p class="hint">이 지역에 등록한 랜드마크가 없습니다. <button class="mini" data-go="land">랜드마크 탭 ▸</button> 에서 대표 단지를 추가하세요.</p>';
    if (!c || c.empty) return `<p class="hint">${esc(m.lm.name)} 에 34평형(전용 84㎡형) 실거래가 없습니다. 다른 랜드마크를 고르거나 랜드마크 탭에서 34평형이 있는 단지를 추가하세요.</p>`;
    const s = c.cs, r = c.cr, p = s && s.s != null ? `${ymDot(c.months[s.s])}~${ymDot(c.months[s.e])}` : r && r.s != null ? `${ymDot(c.months[r.s])}~${ymDot(c.months[r.e])}` : '';
    const line = (k, v, n) => v ? `<div class="op-kv"><span>${k}</span><b>${eok(v.v)}</b><small>${ymDot(c.months[v.e])} ${ui.stat === 'med' ? '중앙값' : '평균'} · ${n[v.e]}건</small></div>` : '';
    const chg = (k, v) => (v && v.pct != null ? `${k} <b class="${U.cls(v.pct)}">${pct1(v.pct)}</b> <small>(${v.diff > 0 ? '+' : ''}${eok(v.diff)})</small>` : '');
    return `<div class="op-info">${line('매매', s, c.sn)}${line('전세', r, c.rn)}` +
      `<div class="op-ch">${p ? `<span>${p} (6개월)</span> ` : ''}${[chg('매매', s), chg('전세', r)].filter(Boolean).join(' / ') || '<small>6개월 전 비교 자료 없음</small>'}</div>` +
      `<div class="op-sub">${c.newHigh ? '🔺 최근 매매 신고가 갱신 · ' : c.fromPeak != null ? `전고점(${eok(c.peak.price)}, ${U.date(c.peak.d)}) 대비 ${pct1(c.fromPeak)} · ` : ''}거래 최근 3개월 매매 ${c.c3}건(직전 ${c.p3}건) · 전세 ${c.rc3}건(직전 ${c.rp3}건)</div></div>`;
  }
  const imgSlot = (k, title) => `<div class="op-slot${imgs[k] ? ' has' : ''}${activeSlot === k ? ' act' : ''}" data-slot="${k}" tabindex="0" title="클릭한 뒤 Ctrl+V 로 붙여넣기 · 사진을 끌어 놓기 · 두 번 눌러 파일 고르기">` +
    (imgs[k] ? `<img src="${imgs[k].data}" alt="${esc(title)}"><button class="mini op-x" data-delimg="${k}" title="사진 지우기">✕</button>` : `<div class="op-ph"><b>${esc(title)}</b><span>여기를 한 번 누르고 <kbd>Ctrl</kbd>+<kbd>V</kbd><br>(사진을 끌어 놓거나, 두 번 눌러 파일 고르기)</span></div>`) + '</div>';

  function paint(m) {
    const lmSel = m.lms.length > 1 ? `<select id="opLm" class="op-lm">${m.lms.map(l => `<option value="${esc(l.id)}" ${m.lm && l.id === m.lm.id ? 'selected' : ''}>[${esc(l.grade)}] ${esc(l.name)}</option>`).join('')}</select>` : '';
    const t = m.page.t || {}, d = m.draft;
    $('opBody').innerHTML = `
    <div class="op-grid">
      <section class="panel op-a"><h3>① 랜드마크 가격 변화 <small>${m.lm ? esc(m.lm.name) : ''} · 34평(전용 84형) · 실거래${m.chart && m.chart.months ? ` · ${ymDot(m.chart.months[0])}~${ymDot(m.chart.months[m.chart.months.length - 1])}` : ''}</small></h3>${lmSel}
        <div class="op-chartbox"><canvas id="opChart"></canvas></div>${chartInfo(m)}</section>
      <section class="panel op-b1"><h3>② 매매/전세 물량 <small>아실 캡처 · 저장되지 않고 PPT 에만 들어갑니다</small></h3>
        ${imgSlot('a', '매매 물량 (아실)')}${imgSlot('b', '전세 물량 (아실)')}<input type="file" id="opFile" accept="image/*" hidden></section>
      <section class="panel op-b2"><h3>③ 공급물량 <small>입주 예정 단지</small></h3>${supplyTable(m)}</section>
      <section class="panel op-c1"><h3>${ui.mode === 'deep' ? '④ 시세 스캐닝 <small>평형 × 억대별 · 매매/전세(투자금)</small>' : '④ 시세트래킹 단지 <small>호가 기준 · 만원</small>'}</h3>${ui.mode === 'deep' ? scanTable(m) : trkTable(m)}</section>
      <section class="panel op-c2"><div class="bar" style="margin:0 0 6px"><h3 style="margin:0">⑤ 지역정리 · 리스크 · 내 생각</h3><span class="grow"></span><button id="opDraftAll" title="세 칸 모두 계산으로 만든 문장으로 채움">✨ 자동 초안 전체</button></div>
        ${[['sum', '지역 정리'], ['risk', '리스크'], ['mine', '내 생각']].map(([k, n]) => `<div class="op-tx"><div class="bar" style="margin:0"><b>[${n}]</b><span class="grow"></span><button class="mini" data-draft="${k}">✨ 자동 초안</button></div>
          <textarea class="op-ta" data-t="${k}" rows="4" placeholder="${esc(d[k].split('\n')[0] || '')} …(✨ 자동 초안을 누르면 이런 문장이 채워집니다)">${esc(t[k] || '')}</textarea></div>`).join('')}</section>
    </div>`;
    drawChart(m);
  }

  function drawChart(m) {
    if (chart) { chart.destroy(); chart = null; }
    const cv = $('opChart'), c = m.chart;
    if (!cv || !c || c.empty || typeof Chart === 'undefined') { if (cv) cv.parentElement.hidden = true; return; }
    const K = (typeof CK !== 'undefined' && CK.C) ? CK.C : null;
    const col = { sale: K ? K.sale() : '#d95926', rent: K ? K.rent() : '#199e70', text: K ? K.text() : '#ddd', sub: K ? K.sub() : '#999', line: K ? K.line() : '#333' };
    const n = c.months.length, v = (a) => a.map(x => (x == null ? null : +(x / 10000).toFixed(3)));
    const band = { id: 'opBand', beforeDatasetsDraw(ch, a, o) {
      const x = ch.scales.x, A = ch.chartArea, ctx = ch.ctx; if (!o || o.from == null || !x) return;
      const x0 = x.getPixelForValue(o.from), x1 = x.getPixelForValue(o.to); ctx.save(); ctx.fillStyle = o.color; ctx.fillRect(x0, A.top, x1 - x0, A.bottom - A.top);
      ctx.strokeStyle = o.edge; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x0, A.top); ctx.lineTo(x0, A.bottom); ctx.moveTo(x1, A.top); ctx.lineTo(x1, A.bottom); ctx.stroke(); ctx.restore(); } };
    chart = new Chart(cv, { type: 'line', plugins: [band],
      data: { labels: c.months.map(ymDot), datasets: [
        { label: '매매', data: v(c.sv), borderColor: col.sale, backgroundColor: col.sale, spanGaps: true, pointRadius: n > 60 ? 0 : 2, borderWidth: 2, tension: .2 },
        { label: '전세', data: v(c.rv), borderColor: col.rent, backgroundColor: col.rent, spanGaps: true, pointRadius: n > 60 ? 0 : 2, borderWidth: 2, tension: .2 }] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { opBand: n > 7 ? { from: n - 7, to: n - 1, color: 'rgba(120,150,255,.12)', edge: 'rgba(150,170,255,.55)' } : {}, legend: { position: 'bottom', labels: { color: col.text, usePointStyle: true, boxWidth: 8 } },
          tooltip: { callbacks: { label: (it) => { const a = it.datasetIndex ? c.rn : c.sn; return `${it.dataset.label} ${it.parsed.y == null ? '-' : it.parsed.y.toFixed(2) + '억'} (${a[it.dataIndex]}건)`; } } } },
        scales: { x: { ticks: { color: col.sub, maxTicksLimit: 8, autoSkip: true }, grid: { display: false } }, y: { ticks: { color: col.sub, callback: (x) => x + '억' }, grid: { color: col.line } } } } });
  }

  /* ═════════ 아실 사진 (붙여넣기·끌어놓기·파일) ═════════ */
  function fitImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => {
        const w0 = im.naturalWidth, h0 = im.naturalHeight, k = Math.min(1, 1400 / w0), cv = document.createElement('canvas');
        cv.width = Math.round(w0 * k); cv.height = Math.round(h0 * k);
        const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(im, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url); res({ data: cv.toDataURL('image/png'), w: cv.width, h: cv.height });
      };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('사진을 읽지 못했습니다.')); };
      im.src = url;
    });
  }
  async function putImage(file, slot) {
    if (!file || !/^image\//.test(file.type || 'image/png')) return U.toast('사진 파일만 넣을 수 있습니다.');
    try {
      const k = slot || (!imgs[activeSlot] ? activeSlot : !imgs.a ? 'a' : !imgs.b ? 'b' : activeSlot);
      imgs[k] = await fitImage(file); activeSlot = k === 'a' ? 'b' : 'a';
      refreshSlots();
    } catch (e) { U.toast(e.message || '사진을 넣지 못했습니다.'); }
  }
  function refreshSlots() {
    if (!model) return;
    const box = root.querySelector('.op-b1'); if (!box) return;
    const keep = box.querySelector('h3').outerHTML;
    box.innerHTML = keep + imgSlot('a', '매매 물량 (아실)') + imgSlot('b', '전세 물량 (아실)') + '<input type="file" id="opFile" accept="image/*" hidden>';
  }

  /* ═════════ PPT 내려받기 ═════════ */
  async function exportPptx() {
    if (!model) return U.toast('아직 불러오는 중입니다. 잠시 뒤에 다시 눌러 주세요.');
    const btn = $('opPpt'); btn.disabled = true; btn.textContent = '만드는 중…';
    try {
      await needPptx();
      const m = model, pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE';
      const F = 'Malgun Gothic', BK = '000000', GR = '595959', SALE = 'D95926', RENT = '199E70', BLUE = '0000FF';
      const slide = pptx.addSlide(); slide.background = { color: 'FFFFFF' };
      const regName = m.reg ? (m.reg[2] || '') : '', sido = m.reg ? sidoShort(m.reg[1]) : '', title = `${sido} ${regName}`.trim();
      const box = (x, y, w, h) => slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: 'FFFFFF' }, line: { color: BK, width: 1 } });
      const head = (t, x, y, w, sub) => slide.addText([{ text: t, options: { bold: true, fontSize: 11, color: BK } }, ...(sub ? [{ text: '  ' + sub, options: { fontSize: 8, color: GR } }] : [])], { x: x + 0.05, y: y + 0.02, w: w - 0.1, h: 0.3, fontFace: F, valign: 'middle', margin: 0.03 });
      /** 표가 칸 높이(availH, 인치)에 들어가도록 글자 크기·줄 높이를 줄임. nameW = 단지명 칸 너비, maxLen = 가장 긴 이름 글자 수 (줄바꿈으로 줄이 늘어나지 않게) */
      const warns = [];
      const fitTable = (nRows, availH, fsMax, fsMin, rowMax, nameW, maxLen) => {
        const mgOf = (fs) => (fs < 6 ? 0.005 : 0.015), need = (fs) => fs * 1.35 / 72 + 2 * mgOf(fs) + 0.015;      // 한글 글꼴은 줄 간격이 글자 크기의 약 1.35배
        let fs = fsMax; while (fs > fsMin && nRows * need(fs) > availH) fs -= 0.25;
        if (nameW && maxLen) { const fw = (nameW - 2 * mgOf(fs)) * 72 / (maxLen * 0.92); if (fw < fs) fs = Math.max(Math.min(fs, Math.max(fw, 5.5)), fsMin); }   // 이름이 길어 줄바꿈될 때만 더 줄임 (5.5pt 아래로는 내리지 않음)
        return { fs: Math.round(fs * 4) / 4, mg: mgOf(fs), rowH: Math.min(rowMax, availH / nRows), fits: nRows * need(fs) <= availH + 0.001 };
      };
      // 머리글
      slide.addShape(pptx.ShapeType.rect, { x: 0.25, y: 0.14, w: 0.06, h: 0.42, fill: { color: BK }, line: { color: BK, width: 0 } });
      slide.addText('원페이지', { x: 0.4, y: 0.1, w: 3, h: 0.5, fontFace: F, fontSize: 22, bold: true, color: BK, valign: 'middle' });
      slide.addText(`자료: 국토교통부 실거래가 · 직접 입력 호가 · 부동산지인 · 아실   ${U.stamp().replace(/(\d{4})(\d{2})(\d{2})/, '$1.$2.$3')} 작성`, { x: 6.2, y: 0.18, w: 6.9, h: 0.35, fontFace: F, fontSize: 9, color: GR, align: 'right', valign: 'middle' });
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.7, w: 13.333, h: 0.5, fill: { color: BK }, line: { color: BK, width: 0 } });
      slide.addText(`${title} · ${ymKor(m.ym)}${ui.mode === 'deep' ? ' (심화)' : ''}`, { x: 0, y: 0.7, w: 13.333, h: 0.5, fontFace: F, fontSize: 22, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle' });

      // ① 랜드마크 그래프
      const AX = 0.2, AY = 1.35, AW = 3.7, AH = 5.95;
      box(AX, AY, AW, AH); const c = m.chart;
      head('랜드마크 가격 변화', AX, AY, AW, m.lm ? `${m.lm.name} · 34평${c && c.months ? ` · ${ymDot(c.months[0])}~${ymDot(c.months[c.months.length - 1])}` : ' · 실거래'}` : '');
      if (c && !c.empty) {
        const fill = (a) => { const o = [...a], idx = o.map((v, i) => (v != null ? i : -1)).filter(i => i >= 0); for (let i = idx[0] + 1; i < idx[idx.length - 1]; i++) if (o[i] == null) { const p = idx.filter(j => j < i).pop(), q = idx.find(j => j > i); o[i] = o[p] + (o[q] - o[p]) * (i - p) / (q - p); } return o; };
        const sv = fill(c.sv), rv = fill(c.rv), first = Math.min(...[sv, rv].map(a => a.findIndex(x => x != null)).filter(i => i >= 0)), last = Math.max(...[sv, rv].map(a => { let j = -1; a.forEach((x, i) => { if (x != null) j = i; }); return j; }));
        const sl = (a) => a.slice(first, last + 1).map(x => (x == null ? null : +(x / 10000).toFixed(2)));
        slide.addChart(pptx.charts.LINE, [{ name: '매매', labels: c.months.slice(first, last + 1).map(ymDot), values: sl(sv) }, { name: '전세', labels: c.months.slice(first, last + 1).map(ymDot), values: sl(rv) }],
          { x: AX + 0.05, y: AY + 0.36, w: AW - 0.1, h: 3.7, chartColors: [SALE, RENT], lineSize: 2, lineDataSymbolSize: 4, showLegend: true, legendPos: 'b', legendFontSize: 9, legendFontFace: F,
            catAxisLabelFontSize: 8, catAxisLabelFontFace: F, catAxisLabelFrequency: last - first + 1 > 18 ? Math.ceil((last - first + 1) / 12) : 1, valAxisLabelFontSize: 8, valAxisLabelFormatCode: '0.0', catAxisLabelRotate: 270, valGridLine: { color: 'D9D9D9', size: 0.5 }, catGridLine: { style: 'none' }, displayBlanksAs: 'span' });
        const s = c.cs, r = c.cr, runs = [];
        const ln = (t, o = {}) => runs.push({ text: t, options: { fontSize: 10, fontFace: F, breakLine: true, color: BK, ...o } });
        if (s) ln(`${ymDot(c.months[s.e])} 매매 ${ui.stat === 'med' ? '중앙값' : '평균'} ${eok(s.v)} (${c.sn[s.e]}건)`, { bold: true });
        if (r) ln(`${ymDot(c.months[r.e])} 전세 ${ui.stat === 'med' ? '중앙값' : '평균'} ${eok(r.v)} (${c.rn[r.e]}건)`, { bold: true });
        const ch = s && s.pct != null ? s : r && r.pct != null ? r : null;
        if (ch) ln(`6개월 (${ymDot(c.months[ch.s])}~${ymDot(c.months[ch.e])})`, { color: GR });
        if (s && s.pct != null) ln(`매매 ${pct1(s.pct)} (${s.diff > 0 ? '+' : ''}${eok(s.diff)})`, { color: s.pct >= 0 ? 'C00000' : '1F4E9E', bold: true });
        if (r && r.pct != null) ln(`전세 ${pct1(r.pct)} (${r.diff > 0 ? '+' : ''}${eok(r.diff)})`, { color: r.pct >= 0 ? 'C00000' : '1F4E9E', bold: true });
        ln(c.newHigh ? '최근 매매 신고가 갱신' : c.fromPeak != null ? `전고점 대비 ${pct1(c.fromPeak)}` : '', { fontSize: 9, color: GR });
        ln(`거래 최근 3개월 매매 ${c.c3}건 (직전 ${c.p3}건) · 전세 ${c.rc3}건 (직전 ${c.rp3}건)`, { fontSize: 9, color: GR });
        slide.addText(runs, { x: AX + 0.1, y: AY + 4.1, w: AW - 0.2, h: 1.8, fontFace: F, valign: 'top', margin: 0.03 });
      } else slide.addText(m.lm ? '34평형(전용 84㎡형) 실거래가 없어 그래프를 그리지 못했습니다.' : '이 지역에 등록한 랜드마크가 없습니다.', { x: AX + 0.1, y: AY + 1.5, w: AW - 0.2, h: 1, fontFace: F, fontSize: 11, color: GR, align: 'center' });

      // ③ 공급물량 크기 먼저 정하기 — 행이 많으면 ② 사진 칸을 줄여(최소 2.5인치) 표 칸을 키움
      const BX = 4.0, BW = 3.2, COLH = AH, sp = m.supply, spOk = !!(sp && !sp.none && sp.rows.length);
      const supRows = spOk ? sp.rows : [], supN = supRows.length + 2, supName = Math.max(0, ...supRows.map(r => r.name.length));
      let H2 = 3.7, supFit = null;
      if (spOk) {
        const tryH = (h, fsMin) => fitTable(supN, (COLH - 0.1 - h) - 0.42, 8, fsMin, 0.24, 1.2, supName);
        for (; H2 >= 2.5; H2 = Math.round((H2 - 0.1) * 10) / 10) { supFit = tryH(H2, 6); if (supFit.fits) break; }   // 6pt 이상으로 들어갈 때까지 사진 칸을 조금씩 줄임
        if (H2 < 2.5) { H2 = 2.5; supFit = tryH(2.5, 4); }                                                          // 그래도 안 되면 사진 칸 최소(2.5인치)에서 글자를 4pt 까지 줄임
      }
      const SY = AY + H2 + 0.1, SH = COLH - H2 - 0.1;

      // ② 아실 사진
      box(BX, AY, BW, H2); head('매매/전세 물량', BX, AY, BW, '아실');
      const slotH = (H2 - 0.52) / 2;
      [['a', '매매 물량'], ['b', '전세 물량']].forEach(([k, nm], i) => {
        const y = AY + 0.4 + i * (slotH + 0.06), w = BW - 0.2, h = slotH, im = imgs[k];
        if (im) { const r = Math.min(w / im.w, h / im.h), iw = im.w * r, ih = im.h * r; slide.addImage({ data: im.data, x: BX + 0.1 + (w - iw) / 2, y: y + (h - ih) / 2, w: iw, h: ih }); }
        else { slide.addShape(pptx.ShapeType.rect, { x: BX + 0.1, y, w, h, fill: { color: 'F7F7F7' }, line: { color: 'A6A6A6', width: 0.75, dashType: 'dash' } });
          slide.addText(`${nm} (아실) 그래프를\n여기에 붙여넣기`, { x: BX + 0.1, y, w, h, fontFace: F, fontSize: 10, color: '7F7F7F', align: 'center', valign: 'middle' }); }
      });

      // ③ 공급물량 (표 전체)
      box(BX, SY, BW, SH); head('공급물량', BX, SY, BW, spOk ? `${sp.scopeName} 입주 · ${sp.rows.length}단지` : '');
      if (spOk) {
        const hd = (t) => ({ text: t, options: { bold: true, fill: { color: 'D9D9D9' }, align: 'center' } });
        const trs = [[hd('위치'), hd('단지명'), hd('입주'), hd('세대수')], ...supRows.map(r => [{ text: r.loc, options: { align: 'left' } }, { text: r.name, options: { align: 'left' } }, { text: `${r.ym.slice(0, 4)}.${r.ym.slice(5)}` }, { text: r.hh.toLocaleString() }]),
          [{ text: `${sp.scopeName} 합계 (${sp.rows.length}단지)`, options: { colspan: 3, bold: true, align: 'left' } }, { text: sp.total.toLocaleString(), options: { bold: true } }]];
        slide.addTable(trs, { x: BX + 0.08, y: SY + 0.36, w: BW - 0.16, colW: [0.62, 1.2, 0.55, 0.63], fontFace: F, fontSize: supFit.fs, color: BK, align: 'center', valign: 'middle', border: { type: 'solid', pt: 0.5, color: BK }, rowH: supFit.rowH, margin: supFit.mg });
        if (supFit.fs < 6) warns.push(`공급물량 ${sp.rows.length}단지라 글자가 ${supFit.fs}pt 로 작아졌습니다`);
        if (!supFit.fits) warns.push('공급물량이 많아 칸을 넘칠 수 있습니다 — 단지를 줄여 주세요 (공급 최소 세대·임대 제외)');
      } else slide.addText(sp && sp.none ? '공급지도 탭에 입주물량 엑셀을 올리면 채워집니다.' : '입주 예정 단지가 없습니다.', { x: BX + 0.1, y: SY + 0.5, w: BW - 0.2, h: 1, fontFace: F, fontSize: 9, color: GR, align: 'center' });

      // ④ 표
      const CX = 7.3, CW = 5.83; box(CX, AY, CW, 3.7);
      if (ui.mode === 'deep' && m.scan && !m.scan.none) {
        head('시세 스캐닝', CX, AY, CW, '평형 × 억대별 · 매매/전세(투자금) · 억');
        const hd = (t) => ({ text: t, options: { bold: true, fill: { color: 'D9D9D9' }, align: 'center' } }), s = m.scan;
        const rowsP = s.rows.filter(r => s.cols.some(k => r.cells[k].length)).slice(0, 9);
        const trs = [[hd('평형'), ...s.cols.map(hd)], ...rowsP.map(r => [{ text: `${r.label}\n${r.sub}`, options: { bold: true, align: 'center', fontSize: 7 } },
          ...s.cols.map(k => ({ text: r.cells[k].length ? r.cells[k].map(x => `${x.first ? '★ ' : ''}${x.name} ${eok1(x.s)}/${eok1(x.r)}${x.gap != null ? `(${eok1(x.gap)})` : ''}`).join('\n') : '-', options: { align: 'left' } }))])];
        const cw = (CW - 0.16 - 1.15) / s.cols.length;
        slide.addTable(trs, { x: CX + 0.08, y: AY + 0.36, w: CW - 0.16, colW: [1.15, ...s.cols.map(() => cw)], fontFace: F, fontSize: 7.5, color: BK, valign: 'middle', border: { type: 'solid', pt: 0.5, color: BK }, rowH: 0.3, margin: 0.02 });
      } else if (ui.mode !== 'deep' && m.trk.rows.length) {
        head('시세트래킹 단지', CX, AY, CW, '호가(검정) · 실거래로 채운 값(파랑) · 만원');
        const ex = new Set(m.page.ex || []), shownAll = m.trk.rows.filter(r => !ex.has(r.id)), list = +ui.rows > 0 ? shownAll.slice(0, +ui.rows) : shownAll;
        const hd = (t) => ({ text: t, options: { bold: true, fill: { color: 'D9D9D9' }, align: 'center' } });
        const mny = (v, real) => ({ text: v == null ? '-' : man(v), options: { color: real ? BLUE : BK } });
        const df = (v) => ({ text: v == null ? '-' : v === 0 ? '0' : (v > 0 ? '' : '-') + man(Math.abs(v)), options: { color: v == null || v === 0 ? BK : v > 0 ? 'C00000' : '1F4E9E' } });
        const trs = [['단지', '연식', '세대', '평형', '계/복', '방/화', '매매', '전월', '전세', '전월', '매-전', '전세가율'].map(hd),
          ...list.map(r => [{ text: r.name, options: { align: 'left' } }, { text: r.by || '-' }, { text: r.hh ? r.hh.toLocaleString() : '-' }, { text: String(r.py) }, { text: r.struct || '-' }, { text: `${r.rooms || '-'}/${r.baths || '-'}` },
            mny(r.s, r.sReal), df(r.ds), mny(r.r, r.rReal), df(r.dr), mny(r.gap, false), { text: r.ratio == null ? '-' : Math.round(r.ratio) + '%' }])];
        const tf = fitTable(list.length + 1, 3.7 - 0.36 - 0.06, 7, 4.5, 0.27, 1.1, Math.max(0, ...list.map(r => r.name.length)));      // 단지가 많으면 글자·줄 높이를 줄여 한 장에 담음
        slide.addTable(trs, { x: CX + 0.08, y: AY + 0.36, w: CW - 0.16, colW: [1.1, 0.38, 0.42, 0.34, 0.4, 0.36, 0.5, 0.4, 0.5, 0.4, 0.46, 0.4], fontFace: F, fontSize: tf.fs, color: BK, align: 'center', valign: 'middle', border: { type: 'solid', pt: 0.5, color: BK }, rowH: tf.rowH, margin: tf.mg });
        if (tf.fs < 6) warns.push(`시세트래킹 ${list.length}단지라 글자가 ${tf.fs}pt 로 작아졌습니다`);
        if (!tf.fits) warns.push(`시세트래킹 ${list.length}단지는 한 장에 다 들어가지 않을 수 있습니다 — 일부를 빼 주세요`);
      } else { head(ui.mode === 'deep' ? '시세 스캐닝' : '시세트래킹 단지', CX, AY, CW); slide.addText('표로 만들 단지가 없습니다. (시세트래킹 탭에 단지를 담거나 1등뽑기에 호가를 적어 주세요)', { x: CX + 0.1, y: AY + 1.4, w: CW - 0.2, h: 1, fontFace: F, fontSize: 10, color: GR, align: 'center' }); }

      // ⑤ 글
      const TY = 5.15, TH = 2.15; box(CX, TY, CW, TH);
      const tx = m.page.t || {}, secs = [['지역 정리', tx.sum], ['리스크', tx.risk], ['내 생각', tx.mine]].map(([n, t]) => [n, String(t || '').split('\n').map(l => l.trim()).filter(Boolean)]);
      const need = (fs) => { const cpl = Math.floor((CW - 0.3) * 72 / (fs * 0.98)), lh = fs * 1.3 / 72; return secs.reduce((s, [, ls]) => s + lh * (1 + ls.reduce((a, l) => a + Math.max(1, Math.ceil(l.length / cpl)), 0)), 0); };
      let fs = 10; while (fs > 6 && need(fs) > TH - 0.15) fs -= 0.5;
      const runs = []; secs.forEach(([n, ls]) => { runs.push({ text: `[${n}]`, options: { bold: true, fontSize: fs, breakLine: true } }); ls.forEach(l => runs.push({ text: l, options: { fontSize: fs, bullet: { indent: 10 }, breakLine: true } })); });
      slide.addText(runs.length ? runs : [{ text: '[지역 정리]\n[리스크]\n[내 생각]', options: { fontSize: 10, color: '7F7F7F' }}], { x: CX + 0.08, y: TY + 0.05, w: CW - 0.16, h: TH - 0.1, fontFace: F, color: BK, valign: 'top', margin: 0.03, paraSpaceAfter: 0 });

      const fname = `원페이지_${(title || '지역').replace(/[\\/:*?"<>|\s]+/g, '')}_${ymStr(m.ym)}.pptx`;
      await pptx.writeFile({ fileName: fname });
      U.toast(`${fname} 을(를) 내려받았습니다.${imgs.a || imgs.b ? '' : ' (아실 사진 칸은 비어 있습니다 — PPT 에서 붙여넣으세요)'}${warns.length ? ' ⚠ ' + warns.join(' · ') : ''}`);
    } catch (e) { console.error(e); U.toast('PPT 를 만들지 못했습니다: ' + (e.message || e)); }
    finally { btn.disabled = false; btn.textContent = '📊 PPT 다운로드'; }
  }

  /* ═════════ 연결 ═════════ */
  async function refresh() {
    const my = ++seq;
    try {
      const m = await build();
      if (my !== seq) return;
      model = m; paint(m);
    } catch (e) { console.error(e); if (my === seq) $('opBody').innerHTML = `<p class="hint" style="padding:14px;color:var(--danger)">원페이지를 만들지 못했습니다: ${esc(e.message || e)}</p>`; }
  }
  const setUi = (patchUi, imgReset) => { Object.assign(ui, patchUi); saveUi(); if (imgReset) { imgs.a = imgs.b = null; activeSlot = 'a'; } };
  function wire() {
    root.addEventListener('change', (e) => {
      const t = e.target;
      if (t.id === 'opRegion') { setUi({ code: t.value }, true); return refresh(); }
      if (t.id === 'opYm') { const ym = ymFromStr(t.value); if (!ym) return; setUi({ ym }); return refresh(); }
      if (t.id === 'opRange') {
        const v = +t.value, ch = { range: v };
        if (!v && !(+ui.rFrom && +ui.rTo)) { ch.rFrom = addMonths(+ui.ym, -35); ch.rTo = +ui.ym; }       // 처음 '직접 지정'을 고르면 3년 구간으로 시작
        setUi(ch); syncCtl(); return refresh();
      }
      if (t.id === 'opFrom' || t.id === 'opTo') {
        let a = ymFromStr($('opFrom').value), b = ymFromStr($('opTo').value); if (!a || !b) return;
        if (a > b) { [a, b] = [b, a]; U.toast('시작월이 끝월보다 늦어 두 값을 바꿨습니다.'); }
        setUi({ range: 0, rFrom: a, rTo: b }); syncCtl(); return refresh();
      }
      if (t.id === 'opStat') { setUi({ stat: t.value }); return refresh(); }
      if (t.id === 'opRows') { setUi({ rows: +t.value }); return refresh(); }
      if (t.id === 'opSupScope') { setUi({ supScope: t.value }); return refresh(); }
      if (t.id === 'opSupMin') { setUi({ supMin: +t.value }); return refresh(); }
      if (t.id === 'opNoRent') { setUi({ noRent: t.checked ? 1 : 0 }); return refresh(); }
      if (t.id === 'opLm') { if (locked()) return; patch(p => { p.lm = t.value; }); return refresh(); }
      if (t.id === 'opFile') { const f = t.files && t.files[0]; t.value = ''; if (f) putImage(f, activeSlot); return; }
      if (t.matches('[data-ex]')) { if (locked()) { t.checked = !t.checked; return; } const id = t.closest('tr').dataset.id; patch(p => { const s = new Set(p.ex || []); if (t.checked) s.delete(id); else s.add(id); p.ex = [...s]; }); return refresh(); }
    });
    root.addEventListener('input', (e) => {
      const t = e.target;
      if (t.matches('[data-t]')) { if (locked()) return; clearTimeout(saveTimer); saveTimer = setTimeout(() => patch(p => { p.t = p.t || {}; p.t[t.dataset.t] = t.value; if (!t.value) delete p.t[t.dataset.t]; }), 400); }
      if (t.matches('[data-memo]')) { if (locked()) return; const id = t.closest('tr').dataset.sid; clearTimeout(saveTimer); saveTimer = setTimeout(() => patch(p => { p.memo = p.memo || {}; if (t.value.trim()) p.memo[id] = t.value; else delete p.memo[id]; }), 400); }
    });
    root.addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest('#opPpt')) return exportPptx();
      const md = t.closest('#opMode button'); if (md) { setUi({ mode: md.dataset.m }); syncCtl(); return refresh(); }
      const go = t.closest('[data-go]'); if (go) return App.showTab(go.dataset.go);
      const dr = t.closest('[data-draft]');
      if (dr) { const k = dr.dataset.draft, ta = root.querySelector(`[data-t="${k}"]`); if (!ta || !model || locked()) return;
        if (ta.value.trim() && !confirm('이미 적은 글이 있습니다. 자동 초안으로 바꿀까요?')) return;
        ta.value = model.draft[k]; ta.dispatchEvent(new Event('input', { bubbles: true })); return; }
      if (t.closest('#opDraftAll')) { if (!model || locked()) return;
        const any = [...root.querySelectorAll('[data-t]')].some(x => x.value.trim());
        if (any && !confirm('이미 적은 글이 있습니다. 세 칸 모두 자동 초안으로 바꿀까요?')) return;
        root.querySelectorAll('[data-t]').forEach(ta => { ta.value = model.draft[ta.dataset.t]; ta.dispatchEvent(new Event('input', { bubbles: true })); }); return; }
      const di = t.closest('[data-delimg]'); if (di) { imgs[di.dataset.delimg] = null; activeSlot = di.dataset.delimg; refreshSlots(); return; }
      const sl = t.closest('[data-slot]'); if (sl) { activeSlot = sl.dataset.slot; root.querySelectorAll('.op-slot').forEach(x => x.classList.toggle('act', x === sl)); sl.focus(); }
    });
    root.addEventListener('dblclick', (e) => { const sl = e.target.closest('[data-slot]'); if (sl && !e.target.closest('[data-delimg]')) { activeSlot = sl.dataset.slot; const f = $('opFile'); if (f) f.click(); } });
    root.addEventListener('dragover', (e) => { if (e.target.closest('[data-slot]')) { e.preventDefault(); e.target.closest('[data-slot]').classList.add('over'); } });
    root.addEventListener('dragleave', (e) => { const s = e.target.closest('[data-slot]'); if (s) s.classList.remove('over'); });
    root.addEventListener('drop', (e) => { const s = e.target.closest('[data-slot]'); if (!s) return; e.preventDefault(); s.classList.remove('over'); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) putImage(f, s.dataset.slot); });
    root.addEventListener('focusin', (e) => { const t = e.target; if ((t.matches('[data-t]') || t.matches('[data-memo]')) && typeof Vault !== 'undefined' && Vault.isLocked()) { t.blur(); locked(); } });
    document.addEventListener('paste', (e) => {                                      // Ctrl+V: 이 탭이 보이고, 글 입력 중이 아닐 때만 사진으로 받음
      if (root.hidden || !inited) return;
      const a = document.activeElement; if (a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'checkbox'))) return;
      const it = [...(e.clipboardData?.items || [])].find(x => x.kind === 'file' && /^image\//.test(x.type)); if (!it) return;
      e.preventDefault(); putImage(it.getAsFile(), null);
    });
  }

  async function open() {
    try {
      const [r, p] = await Promise.all([Data.regions(), Data.json('population.json', null)]);
      regionsAll = r || []; regionMap = new Map(regionsAll.map(x => [x[0], x])); regByName = new Map(regionsAll.map(x => [`${x[1]}|${x[2]}`, x[0]])); popData = p;
    } catch (e) { console.error(e); }
    board = makeBoard();
    if (!inited) {
      load();
      if (!regionMap.has(ui.code)) ui.code = (board.find(b => b.on) || board[0] || { code: (regionsAll[0] || [''])[0] }).code;
      inited = true; frame(); wire();
    } else { const sel = $('opRegion'); if (sel) { sel.innerHTML = regionOptions(); sel.value = ui.code; } }
    refresh();
  }
  const reload = () => { pages = Store.get(KEY, {}) || {}; if (inited && !root.hidden) refresh(); };
  return { open, reload, _model: () => model };
})();
