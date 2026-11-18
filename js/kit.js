/* ─────────────────────────────────────────────────────────
   kit.js — 여러 탭이 함께 쓰는 작은 도구 모음
   · Kit    : 단지 번호 풀기, 가장 최근 호가, 작은 추세선(스파크라인), [잠정] 배지
   · Alias  : 단지 별칭 (예: "헬리오" → 헬리오시티)
   · Pins   : 자주 보는 지역 핀
   · QLog   : 호가 수정 이력
   · Real   : 단지별 실거래 요약 (최근가·전고점·최근 거래 건수·12개월 월평균)
   ───────────────────────────────────────────────────────── */
const Kit = (() => {
  let regMap = null;
  /** 지역코드 → [code, sido, sgg, tier] */
  async function regions() {
    if (!regMap) regMap = new Map((await Data.regions()).map(r => [r[0], r]));
    return regMap;
  }
  /** "41173|평촌동|932-6|꿈마을#84" → { code, key, g, dong, jibun, name } */
  /** 자동으로 채울 단지 정보: 세대수·구조(K-apt 복도유형)·방·화(전용면적·연식으로 추정한 흔한 구성)
      r: { hh, corr, g, buildYear } → { households, structure, rooms, baths } (모르면 '') */
  function autoInfo(r) {
    const g = +r.g || 0, y = +r.buildYear || 0, nw = !y || y >= 2000;
    const c = String(r.corr || '');
    const structure = /혼합/.test(c) ? '혼합' : /계단/.test(c) ? '계' : /복도/.test(c) ? '복' : '';
    let rooms = '', baths = '';
    if (g) {
      if (g < 40) { rooms = 1; baths = 1; } else if (g < 50) { rooms = 2; baths = 1; }
      else if (g < 67) { rooms = nw ? 3 : 2; baths = nw ? 2 : 1; } else if (g < 76) { rooms = 3; baths = nw ? 2 : 1; }
      else if (g < 100) { rooms = 3; baths = 2; } else { rooms = 4; baths = 2; }
    }
    return { households: r.hh ? String(r.hh) : '', structure, rooms: rooms ? String(rooms) : '', baths: baths ? String(baths) : '' };
  }
  function parseId(id) {
    const rest = id.slice(6), h = rest.lastIndexOf('#'), key = rest.slice(0, h);
    return { id, code: id.slice(0, 5), key, g: +rest.slice(h + 1), ...Data.parseKey(key) };
  }
  /** 기록에서 가장 최근에 적은 호가와 그 앞 기록 → { ym, s, r, sn, rn, p:{ym,s,r,sn,rn} } (없으면 null) */
  function quote(rec) {
    const ms = Object.keys(rec?.quotes || {}).map(Number).sort((a, b) => b - a).filter(m => { const q = rec.quotes[m]; return q && (q.s != null || q.r != null); });
    if (!ms.length) return null;
    const q = rec.quotes[ms[0]], p = ms[1] ? rec.quotes[ms[1]] : null;
    const pick = (f) => { const m = ms.find(x => rec.quotes[x][f] != null); return m ? rec.quotes[m][f] : null; };   // 이번 달에 빈 칸은 가장 가까운 지난 값
    return { ym: ms[0], s: q.s ?? pick('s'), r: q.r ?? pick('r'), sn: q.sn ?? null, rn: q.rn ?? null, at: rec.qt?.[ms[0]] || '',
      p: p ? { ym: ms[1], s: p.s ?? null, r: p.r ?? null, sn: p.sn ?? null, rn: p.rn ?? null } : null };
  }
  /** 작은 추세선. values = 숫자 배열(빈 값 null 가능) */
  function spark(values, w = 90, h = 22) {
    const pts = values.map((v, i) => [i, v]).filter(p => p[1] != null);
    if (pts.length < 2) return '<span class="spark none">·</span>';
    const min = Math.min(...pts.map(p => p[1])), max = Math.max(...pts.map(p => p[1])), n = values.length - 1 || 1;
    const xy = pts.map(([i, v]) => `${(i / n * (w - 4) + 2).toFixed(1)},${(h - 3 - (max === min ? 0.5 : (v - min) / (max - min)) * (h - 6)).toFixed(1)}`);
    const up = pts[pts.length - 1][1] >= pts[0][1];
    return `<svg class="spark ${up ? 'up' : 'down'}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${xy.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="${xy[xy.length - 1].split(',')[0]}" cy="${xy[xy.length - 1].split(',')[1]}" r="2" fill="currentColor"/></svg>`;
  }
  /** 신고된 지 얼마 안 된 거래인지 (계약 해제로 사라질 수 있음) */
  function provisional(d) {
    if (!d) return false;
    const t = new Date(); t.setDate(t.getDate() - CONFIG.PROVISIONAL_DAYS);
    return d > U.ymd(t);
  }
  const badge = (d) => (provisional(d) ? '<span class="tag prov" title="최근 신고된 거래입니다. 계약이 해제되면 나중에 사라질 수 있습니다.">잠정</span>' : '');
  const eok = (v, digits = 2) => (v == null ? '-' : +(v / 10000).toFixed(digits) + '억');
  const ymText = (ym) => (ym ? `${String(ym).slice(2, 4)}.${String(ym).slice(4, 6)}` : '');
  /** 지난 n 개월의 연월 목록 (오래된 달부터) */
  function lastMonths(n) {
    const t = new Date(), out = [];
    for (let i = n - 1; i >= 0; i--) { const d = new Date(t.getFullYear(), t.getMonth() - i, 1); out.push(d.getFullYear() * 100 + d.getMonth() + 1); }
    return out;
  }
  /** 가격을 적어 둔 모든 단지 → [{ id, code, key, g, dong, jibun, name, sido, sgg, rec, tracked }] */
  async function records(trackedOnly) {
    const map = await regions();
    return Tracking.allRecords().filter(x => x.tracked || !trackedOnly).map(x => {
      const p = parseId(x.id), reg = map.get(p.code);
      return { ...p, sido: x.rec.sido || reg?.[1] || '', sgg: x.rec.sgg || reg?.[2] || '', rec: x.rec, tracked: x.tracked };
    });
  }
  return { regions, autoInfo, parseId, quote, spark, provisional, badge, eok, ymText, lastMonths, records };
})();

/* ───────────── 단지 별칭 ───────────── */
const Alias = (() => {
  const KEY = 'apt.alias.v1';
  let map = Store.get(KEY, {});               // { "지역코드|단지키": { a: "헬리오, 헬리오시티" } }
  const id = (code, key) => `${code}|${key}`;
  const of = (code, key) => map[id(code, key)]?.a || '';
  function set(code, key, text) {
    const v = (text || '').split(',').map(x => x.trim()).filter(Boolean).join(', ');
    if (v) map[id(code, key)] = { a: v }; else delete map[id(code, key)];
    Store.set(KEY, map);
  }
  /** 검색어 q 가 단지명·동·별칭 중 하나에 들어 있는지 */
  function hit(code, key, name, dong, q) {
    if (!q) return true;
    const t = q.replace(/\s+/g, '').toLowerCase();
    return name.replace(/\s+/g, '').toLowerCase().includes(t) || (dong || '').includes(q) || of(code, key).replace(/\s+/g, '').toLowerCase().includes(t);
  }
  /** 별칭을 묻는 창 */
  function ask(code, key, name) {
    const v = prompt(`"${name}" 의 별칭 (여러 개는 쉼표로 구분, 비우면 삭제)\n예: 헬리오, 헬시`, of(code, key));
    if (v == null) return false;
    set(code, key, v); U.toast(v.trim() ? '별칭을 저장했습니다. 이제 이 이름으로도 검색됩니다.' : '별칭을 지웠습니다.');
    return true;
  }
  const all = () => Object.keys(map).map(k => ({ k, code: k.slice(0, 5), key: k.slice(6), a: map[k].a }));
  const reload = () => { map = Store.get(KEY, {}); };
  return { of, set, hit, ask, all, reload };
})();

/* ───────────── 지역 핀 ───────────── */
const Pins = (() => {
  const KEY = 'apt.pins.v1';
  let map = Store.get(KEY, {});               // { 지역코드: { t: 핀한 시각 } }
  const has = (code) => !!map[code];
  function toggle(code) { if (map[code]) delete map[code]; else map[code] = { t: Date.now() }; Store.set(KEY, map); render(); return has(code); }
  const list = () => Object.keys(map).sort((a, b) => map[a].t - map[b].t);
  /** 핀 줄 그리기: class="pinbar" 인 곳마다 */
  async function render() {
    const regs = await Kit.regions();
    document.querySelectorAll('.pinbar').forEach(el => {
      const codes = list().filter(c => regs.has(c));
      el.hidden = !codes.length;
      el.innerHTML = '<span class="hint" style="margin:0">📌 핀한 지역</span>' + codes.map(c => `<button data-pin="${c}">${U.esc(regs.get(c)[2])}</button>`).join('');
    });
  }
  const reload = () => { map = Store.get(KEY, {}); render(); };
  return { has, toggle, list, render, reload };
})();

/* ───────────── 호가 수정 이력 ─────────────
   가격을 저장할 때마다 직전 상태와 견주어, "이미 적혀 있던 값이 바뀌거나 지워진 경우"만 남깁니다. (새로 적는 것은 남기지 않음) */
const QLog = (() => {
  const KEY = 'apt.qlog.v1', MAX = 400, NAMES = { s: '매매', r: '전세', sn: '매매 매물', rn: '전세 매물' };
  let prev = null;
  const flat = (recs) => { const m = new Map(); for (const { id, rec } of recs) for (const ym in rec.quotes || {}) for (const f in rec.quotes[ym]) m.set(`${id}\t${ym}\t${f}`, rec.quotes[ym][f]); return m; };
  function check() {
    if (typeof Tracking === 'undefined') return;
    const cur = flat(Tracking.allRecords());
    if (prev) {
      const changes = [];
      for (const [k, old] of prev) { const now = cur.get(k); if (now !== old) changes.push([k, old, now ?? null]); }
      if (changes.length) {
        const log = Store.get(KEY, []), t = new Date().toISOString().slice(0, 16).replace('T', ' ');
        if (changes.length > 40) log.unshift({ t, bulk: changes.length });          // 백업 불러오기 같은 일괄 변경
        else for (const [k, old, now] of changes) { const [id, ym, f] = k.split('\t'); log.unshift({ t, id, ym: +ym, f, a: old, b: now }); }
        Store.set(KEY, log.slice(0, MAX));
      }
    }
    prev = cur;
  }
  const all = () => Store.get(KEY, []);
  const clear = () => Store.set(KEY, []);
  const reset = () => { prev = null; check(); };
  return { check, all, clear, reset, NAMES };
})();

/* ───────────── 단지별 실거래 요약 ─────────────
   Real.load([{id, code, key, g}]) → 끝나면 Real.get(id) 로 꺼냄
   { sale, rent, peak, trough(2020년~, 직거래 제외), n30, n90(매매 건수), r90(전세 건수), mon[12](월평균 매매가, 없으면 null), buildYear, hh(세대수) } */
const Real = (() => {
  const cache = new Map(), loaded = new Set();
  async function load(list, force) {
    const need = list.filter(x => force || !cache.has(x.id));
    const months = Kit.lastMonths(12), pos = new Map(months.map((m, i) => [m, i]));
    const t = new Date(), d30 = U.ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 30)), d90 = U.ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 90));
    for (const code of new Set(need.map(x => x.code))) {
      if (force) Data.refresh(code);
      const [data, idx, kp] = await Promise.all([Data.loadYears(code, Math.floor(CONFIG.PEAK_FROM / 10000), t.getFullYear()), Data.index(code), Data.kapt(code)]);
      const mine = need.filter(x => x.code === code), keys = new Set(mine.map(x => x.key));
      const b = new Map(mine.map(x => [x.id, { sale: null, rent: null, peak: null, trough: null, n30: 0, n90: 0, r90: 0, sum: Array(12).fill(0), cnt: Array(12).fill(0),
        buildYear: idx.c[x.key] || null, hh: kp.m[x.key]?.[0] || null, dongs: kp.m[x.key]?.[1] || null, corr: kp.m[x.key]?.[3] || null }]));
      Data.eachTrade(data.sale, k => keys.has(k), (key, tr) => {
        const x = b.get(`${code}|${key}#${tr.g}`);
        if (!x || tr.direct) return;
        if (!x.sale || tr.d >= x.sale.d) x.sale = tr;
        if (tr.d >= CONFIG.PEAK_FROM) (x.ts || (x.ts = [])).push(tr);          // 전고점·전저점은 다 모은 뒤 Data.peakTrough 로
        if (tr.d > d30) x.n30++;
        if (tr.d > d90) x.n90++;
        const i = pos.get(Math.floor(tr.d / 100));
        if (i != null) { x.sum[i] += tr.price; x.cnt[i]++; }
      });
      Data.eachTrade(data.rent, k => keys.has(k), (key, tr) => {
        const x = b.get(`${code}|${key}#${tr.g}`);
        if (!x) return;
        if (!x.rent || tr.d >= x.rent.d) x.rent = tr;
        if (tr.d > d90) x.r90++;
      });
      for (const [id, x] of b) { x.mon = x.sum.map((s, i) => (x.cnt[i] ? s / x.cnt[i] : null)); delete x.sum; delete x.cnt; Object.assign(x, Data.peakTrough(x.ts || [])); delete x.ts; cache.set(id, x); }
      loaded.add(code);
    }
  }
  const get = (id) => cache.get(id) || null;
  return { load, get };
})();

/* ─────────────────────────────────────────────────────────
   Finder — 전국 단지 이름 검색 (지역을 고르지 않고 단지 이름·별칭만 입력)
   · 자료: data/names.json (자동 수집 때 만들어짐)
   · 쓰는 법: Finder.attach(입력칸, (단지) => { … })   단지 = { code, sido, sgg, key, dong, jibun, name }
   · Finder.areas(code, key) → 그 단지의 평형 목록 [{ g, n }] 과 가장 거래가 많은 평형
   ───────────────────────────────────────────────────────── */
const Finder = (() => {
  let list = null, state = '', loading = null;   // state: '' | 'loading' | 'none' | 'ok'
  const norm = (t) => String(t || '').replace(/\s+/g, '').toLowerCase();
  function load() { return loading || (loading = load0()); }    // 여러 곳에서 동시에 불러도 한 번만, 모두 끝날 때까지 기다림
  async function load0() {
    state = 'loading';
    const [names, regs] = await Promise.all([Data.names(), Kit.regions()]);
    if (!names || !names.r) { state = 'none'; return; }
    list = [];
    for (const code of Object.keys(names.r)) {
      const reg = regs.get(code); if (!reg) continue;
      for (const key of names.r[code]) { const p = Data.parseKey(key); list.push({ code, sido: reg[1], sgg: reg[2], key, dong: p.dong, jibun: p.jibun, name: p.name, n: norm(p.name), w: norm(reg[1] + reg[2] + p.dong + p.name) }); }
    }
    state = 'ok';
  }
  /** 검색: 띄어 쓴 낱말이 모두 들어 있는 단지. 예) "평촌 래미안", "송파 헬리오" */
  function find(q, max = 40) {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!list || !words.length) return [];
    const whole = norm(q), out = [], seen = new Set();
    const push = (x, score) => { const id = x.code + '|' + x.key; if (!seen.has(id)) { seen.add(id); out.push({ x, score }); } };
    for (const a of Alias.all()) if (norm(a.a).includes(whole)) { const x = list.find(v => v.code === a.code && v.key === a.key); if (x) push(x, 0); }
    for (const x of list) {
      if (out.length > 600) break;
      if (x.n.startsWith(whole)) push(x, 1); else if (x.n.includes(whole)) push(x, 2); else if (words.every(w => x.w.includes(w))) push(x, 3);
    }
    return out.sort((a, b) => a.score - b.score || a.x.name.length - b.x.name.length || a.x.name.localeCompare(b.x.name, 'ko')).slice(0, max).map(v => v.x);
  }
  function attach(input, onPick) {
    if (!input) return;
    const host = input.parentElement; host.classList.add('fhost');
    const box = document.createElement('div'); box.className = 'fdrop'; box.hidden = true; host.appendChild(box);
    let hits = [], timer;
    const show = async () => {
      const q = input.value.trim();
      if (q.length < 2) { box.hidden = true; return; }
      if (state !== 'ok' && state !== 'none') { box.innerHTML = '<p>단지 목록을 불러오는 중…</p>'; box.hidden = false; await load(); if (input.value.trim() !== q) return; }
      if (state === 'none') { box.innerHTML = '<p>전국 단지 목록이 아직 준비되지 않았습니다. 새 수집이 한 번 돌면 생깁니다.<br>그때까지는 시/도 · 시/군/구를 골라서 찾아 주세요.</p>'; box.hidden = false; return; }
      hits = find(q);
      box.innerHTML = hits.length ? hits.map((x, i) => `<button type="button" data-i="${i}"><b>${U.esc(x.name)}</b><small>${U.esc(x.sido)} ${U.esc(x.sgg)} ${U.esc(x.dong)}${Alias.of(x.code, x.key) ? ' · 별칭 ' + U.esc(Alias.of(x.code, x.key)) : ''}</small></button>`).join('')
        : '<p>검색 결과가 없습니다. 이름의 일부만 넣어 보세요. (예: 래미안)</p>';
      box.hidden = false;
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(show, 180); });
    input.addEventListener('focus', () => { if (input.value.trim().length >= 2) show(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') box.hidden = true; if (e.key === 'Enter' && !box.hidden && hits.length) { e.preventDefault(); pick(0); } });
    const pick = (i) => { const x = hits[i]; if (!x) return; box.hidden = true; input.value = x.name; onPick(x); };
    box.addEventListener('mousedown', (e) => e.preventDefault());       // 누르는 동안 입력칸의 포커스 유지
    box.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) pick(+b.dataset.i); });
    input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
  }
  /** 단지의 평형 목록. 개수는 최근 5년 기준(없으면 20년), 5년 전에만 거래가 있던 평형도 빠뜨리지 않고 넣음 */
  async function areas(code, key) {
    const y = new Date().getFullYear();
    const recent = await Data.complexTrades(code, key, null, y - 5, y);
    const long = await Data.complexTrades(code, key, null, y - 20, y);
    const tr = recent.sale.length || recent.rent.length ? recent : long;
    const countOf = (t) => { const m = new Map(); [...t.sale, ...t.rent].forEach(x => m.set(x.g, (m.get(x.g) || 0) + 1)); return m; };
    const cnt = countOf(tr), longCnt = countOf(long), old = new Set();
    for (const [g, n] of longCnt) if (!cnt.has(g)) { cnt.set(g, n); old.add(g); }   // 5년 전 거래만 있는 평형
    const all = [...cnt.entries()].map(([g, n]) => ({ g, n, old: old.has(g) })).sort((a, b) => a.g - b.g);
    const lastSale = (g) => long.sale.filter(t => t.g === g && !t.direct).sort((a, b) => b.d - a.d)[0] || null;
    const fresh = all.filter(a => !a.old);
    const best = [...(fresh.length ? fresh : all)].sort((a, b) => b.n - a.n)[0]?.g ?? null;
    return { list: all, best, lastSale,
      html: all.map(a => `<option value="${a.g}">${a.g}㎡ (${CONFIG.toPyeong(a.g)}평) · ${a.n}건${a.old ? ' · 5년 이전 거래' : ''}</option>`).join('') };
  }
  return { attach, areas, find, load };
})();
