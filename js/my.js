/* ─────────────────────────────────────────────────────────
   my.js — [내 분석] 탭  (+ 시세그룹핑 탭의 "자동 묶기")
   내가 적어 둔 호가와 실거래를 합쳐 계산합니다.
   · 지표표: 전세가율, 갭, 호가 괴리율, 매물 증감률, 월 회전율, 전고 대비, 12개월 추세, 랜드마크 대비
   · 가용 자금 필터 · 산점도 · 갈아타기 시뮬레이터
   지표를 추가하려면 아래 COLS 에 한 줄을 더하면 됩니다.
   ───────────────────────────────────────────────────────── */
const My = (() => {
  const $ = (id) => document.getElementById(id);
  const SKEY = 'apt.my.v1';
  let rows = [], sort = { col: 's', dir: -1 }, chart = null, regions = [], inited = false;
  const real = (flag) => (flag ? '' : ' <span class="star" title="호가가 없어 최근 실거래 기준">실</span>');
  const pct = (v, d = 1) => (v == null ? '-' : `<span class="${U.cls(v)}">${U.pct(v, d)}</span>`);

  // 지표표의 열: [이름표, 정렬값, 화면 내용, 엑셀 값]
  const COLS = [
    { id: 'name', label: '단지', cls: 'l', val: r => r.name, html: r => `${U.esc(r.sgg)} ${U.esc(r.dong)} <b>${U.esc(r.name)}</b>${r.tracked ? '' : ' <small>전수조사</small>'}`, x: r => `${r.sgg} ${r.dong} ${r.name}` },
    { id: 'g', label: '평형', val: r => r.g, html: r => `${r.g}㎡<small>${CONFIG.toPyeong(r.g)}평</small>`, x: r => r.g },
    { id: 's', label: '매매', val: r => r.s, html: r => (r.s == null ? '-' : `<span class="sale">${U.price(r.s)}</span>${real(r.sQ)}`), x: r => r.s },
    { id: 'r', label: '전세', val: r => r.r, html: r => (r.r == null ? '-' : `<span class="rent">${U.price(r.r)}</span>${real(r.rQ)}`), x: r => r.r },
    { id: 'ratio', label: '전세가율', val: r => r.ratio, html: r => (r.ratio == null ? '-' : r.ratio.toFixed(1) + '%'), x: r => r.ratio },
    { id: 'gap', label: '갭 (매-전)', val: r => r.gap, html: r => (r.gap == null ? '-' : U.price(r.gap)), x: r => r.gap },
    { id: 'real', label: '최근 실거래', val: r => r.rl.sale?.price, html: r => (r.rl.sale ? `${U.price(r.rl.sale.price)}<small>${U.date(r.rl.sale.d)}${Kit.badge(r.rl.sale.d)}</small>` : '-'), x: r => r.rl.sale?.price },
    { id: 'ask', label: '호가 괴리율', val: r => r.ask, html: r => pct(r.ask), x: r => r.ask },
    { id: 'sn', label: '매물<small>매 / 전</small>', val: r => r.q?.sn, html: r => (r.q && (r.q.sn != null || r.q.rn != null) ? `${r.q.sn ?? '-'} / ${r.q.rn ?? '-'}` : '-'), x: r => r.q?.sn },
    { id: 'snChg', label: '매물 증감률', val: r => r.snChg, html: r => pct(r.snChg, 0), x: r => r.snChg },
    { id: 'turn', label: '월 회전율', val: r => r.turn, html: r => (r.turn == null ? '-' : r.turn.toFixed(0) + '%') + `<small>90일 ${r.rl.n90 ?? 0}건</small>`, x: r => r.turn },
    { id: 'drop', label: '전고 대비', val: r => r.drop, html: r => pct(r.drop), x: r => r.drop },
    { id: 'hh', label: '세대수', val: r => r.hh, html: r => (r.hh ? r.hh.toLocaleString() : '-'), x: r => r.hh },
    { id: 'spark', label: '12개월 실거래', val: r => { const m = (r.rl.mon || []).filter(v => v != null); return m.length > 1 ? m[m.length - 1] / m[0] : null; }, html: r => Kit.spark(r.rl.mon || []), x: () => '' },
    { id: 'lead', label: '랜드마크 대비', val: r => r.lead?.pct, html: r => (r.lead ? `${r.lead.pct.toFixed(0)}%<small>${U.esc(r.lead.name)}</small>` : '-'), x: r => r.lead?.pct },
  ];
  // 산점도·자동 묶기에 쓰는 숫자 축
  const AXES = [['s', '매매가 (억)', r => r.s / 10000], ['r', '전세가 (억)', r => r.r / 10000], ['ratio', '전세가율 (%)', r => r.ratio], ['gap', '갭 (억)', r => r.gap / 10000],
    ['drop', '전고 대비 (%)', r => r.drop], ['ask', '호가 괴리율 (%)', r => r.ask], ['hh', '세대수', r => r.hh], ['age', '연차 (년)', r => (r.buildYear ? CONFIG.toAge(r.buildYear) : null)], ['g', '전용면적 (㎡)', r => r.g], ['turn', '월 회전율 (%)', r => r.turn]];

  /** 한 단지의 계산값 (금액: 만원) */
  function calc(x) {
    const q = Kit.quote(x.rec), rl = Real.get(x.id) || {};
    const s = q?.s ?? rl.sale?.price ?? null, r = q?.r ?? rl.rent?.price ?? null;
    const peak = x.rec.peakO ?? rl.peak?.price ?? null;
    const o = { ...x, q, rl, s, r, sQ: q?.s != null, rQ: q?.r != null,
      ratio: s && r ? r / s * 100 : null, gap: s != null && r != null ? s - r : null,
      ask: q?.s != null && rl.sale ? (q.s / rl.sale.price - 1) * 100 : null,
      snChg: q?.sn != null && q.p?.sn ? (q.sn / q.p.sn - 1) * 100 : null,
      turn: q?.sn ? (rl.n90 || 0) / 3 / q.sn * 100 : null,
      drop: s && peak ? (s / peak - 1) * 100 : null,
      hh: parseInt(x.rec.households, 10) || rl.hh || null, buildYear: x.rec.buildYear || rl.buildYear || null };
    o.lead = typeof Land !== 'undefined' ? Land.leadOf(o) : null;
    return o;
  }

  function fillScope() {
    const cur = $('myScope').value || Store.get('apt.myScope', 'track'), folders = Tracking.exportAll().folders || [];
    $('myScope').innerHTML = '<option value="track">시세트래킹 전체</option>' + folders.map(f => `<option value="f:${U.esc(f)}">폴더: ${U.esc(f)}</option>`).join('') + '<option value="all">시세트래킹 + 전수조사 기록</option>';
    $('myScope').value = [...$('myScope').options].some(o => o.value === cur) ? cur : 'track';
  }
  async function scopeRows(scope) {
    let list = await Kit.records(scope !== 'all');
    if (scope.startsWith('f:')) list = list.filter(x => (x.rec.folders || []).includes(scope.slice(2)));
    if (scope === 'all') list = list.filter(x => x.tracked || Kit.quote(x.rec));
    return list;
  }

  async function load(force) {
    const scope = $('myScope').value;
    const list = await scopeRows(scope);
    $('myEmpty').hidden = list.length > 0; $('myBody').hidden = !list.length;
    fillMover();
    if (!list.length) { rows = []; return; }
    const btn = $('btnMyLoad'); btn.disabled = true; btn.textContent = '읽는 중…';
    try {
      await Real.load([...list, ...(typeof Land !== 'undefined' ? Land.all() : [])], force);
      rows = list.map(calc);
    } finally { btn.disabled = false; btn.textContent = '실거래 다시 읽기'; }
    table(); scatter();
    if ($('bgSource').value === 'mine' && $('bgCash').value) budget();
  }

  /* ── 지표표 ── */
  function sorted() {
    const col = COLS.find(c => c.id === sort.col) || COLS[0];
    return [...rows].sort((a, b) => {
      const x = col.val(a), y = col.val(b);
      if (x == null || y == null || (typeof x === 'number' && isNaN(x))) return (x == null) - (y == null) || a.name.localeCompare(b.name, 'ko');
      return (typeof x === 'string' ? x.localeCompare(y, 'ko') : x - y) * sort.dir || a.name.localeCompare(b.name, 'ko') || a.g - b.g;
    });
  }
  function table() {
    const list = sorted();
    $('myTable').innerHTML = '<thead><tr>' + COLS.map(c => `<th class="sortable ${c.cls || ''}" data-col="${c.id}">${c.label}${sort.col === c.id ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('') + '</tr></thead><tbody>' +
      list.map(r => '<tr>' + COLS.map(c => `<td class="${c.cls || ''}">${c.html(r)}</td>`).join('') + '</tr>').join('') + '</tbody>';
    $('myTable').querySelectorAll('th.sortable').forEach(th => { th.onclick = () => { sort = { col: th.dataset.col, dir: sort.col === th.dataset.col ? -sort.dir : (th.dataset.col === 'name' ? 1 : -1) }; table(); }; });
  }
  function excel() {
    if (!rows.length) return U.toast('내려받을 내용이 없습니다.');
    const cols = COLS.filter(c => c.id !== 'spark');
    U.download(`내분석_지표표_${U.stamp()}`, [{ name: '지표표', rows: [cols.map(c => c.label.replace(/<[^>]+>/g, ' ') + (['s', 'r', 'gap', 'real'].includes(c.id) ? '(만원)' : ['ratio', 'ask', 'snChg', 'turn', 'drop', 'lead'].includes(c.id) ? '(%)' : '')),
      ...sorted().map(r => cols.map(c => { const v = c.x(r); return typeof v === 'number' ? +v.toFixed(2) : (v ?? ''); }))] }]);
  }

  /* ── 가용 자금 필터 ── */
  function saveBudget() {
    const o = {}; ['bgMode', 'bgCash', 'bgLoan', 'bgCost', 'bgRatio', 'bgHouse', 'bgSource'].forEach(id => { o[id] = $(id).value; });
    const all = Store.get(SKEY, {}); all.budget = o; Store.set(SKEY, all);
  }
  function fillBgSgg() { $('bgSgg').innerHTML = regions.filter(r => r[1] === $('bgSido').value).map(r => `<option value="${r[0]}">${U.esc(r[2])}</option>`).join(''); }
  /** 한 지역 전체를 실거래(최근 3년)로 훑음 */
  async function regionRows(code) {
    const reg = regions.find(r => r[0] === code), now = new Date(), from = U.ymd(new Date(now.getFullYear() - 3, now.getMonth(), now.getDate()));
    const [data, idx, kp] = await Promise.all([Data.loadYears(code, now.getFullYear() - 3, now.getFullYear()), Data.index(code), Data.kapt(code)]);
    const map = new Map();
    const get = (key, g) => { const id = `${code}|${key}#${g}`; if (!map.has(id)) map.set(id, { id, code, key, g, ...Data.parseKey(key), sido: reg[1], sgg: reg[2], sale: null, rent: null }); return map.get(id); };
    Data.eachTrade(data.sale, null, (key, t) => { if (t.direct || t.d < from) return; const x = get(key, t.g); if (!x.sale || t.d >= x.sale.d) x.sale = t; });
    Data.eachTrade(data.rent, null, (key, t) => { if (t.d < from) return; const x = get(key, t.g); if (!x.rent || t.d >= x.rent.d) x.rent = t; });
    return [...map.values()].filter(x => x.sale).map(x => {
      const rec = Tracking.rec(x.id) || {}, q = Kit.quote(rec), s = q?.s ?? x.sale.price, r = q?.r ?? x.rent?.price ?? null;
      return { ...x, rec, tracked: Tracking.has(x.id), q, rl: { sale: x.sale, rent: x.rent }, s, r, sQ: q?.s != null, rQ: q?.r != null, ratio: r ? r / s * 100 : null, gap: r != null ? s - r : null,
        hh: parseInt(rec.households, 10) || kp.m[x.key]?.[0] || null, buildYear: idx.c[x.key] || null, st: { last: x.sale } };
    });
  }
  async function budget() {
    saveBudget();
    const mode = $('bgMode').value, cash = parseFloat($('bgCash').value) * 10000, loan = (parseFloat($('bgLoan').value) || 0) * 10000, cost = (parseFloat($('bgCost').value) || 0) / 100;
    const minRatio = parseFloat($('bgRatio').value), minHouse = parseInt($('bgHouse').value, 10), fromRegion = $('bgSource').value === 'region';
    if (isNaN(cash)) return U.toast('"내 돈" 칸에 금액(억)을 적어 주세요.');
    const btn = $('btnBudget'); btn.disabled = true;
    let src = rows;
    try { if (fromRegion) src = await regionRows($('bgSgg').value); } finally { btn.disabled = false; }
    const have = mode === 'live' ? cash + loan : cash;          // 기준 3가지: gap = 투자금(매매−전세), live = 매매가, rent = 전세가
    const out = [];
    for (const r of src) {
      if (mode === 'rent' ? r.r == null : (r.s == null || (mode === 'gap' && r.r == null))) continue;
      const need = mode === 'rent' ? r.r : (mode === 'gap' ? r.s - r.r : r.s) + r.s * cost;
      if (need > have) continue;
      if (!isNaN(minRatio) && !(r.ratio >= minRatio)) continue;
      if (!isNaN(minHouse) && !(r.hh >= minHouse)) continue;
      out.push({ r, need, left: have - need });
    }
    out.sort((a, b) => (mode === 'rent' ? b.r.r - a.r.r : b.r.s - a.r.s));
    $('bgNote').innerHTML = `${src.length.toLocaleString()}개 중 <b>${out.length.toLocaleString()}개</b>가 조건에 맞습니다. 쓸 수 있는 돈 ${Kit.eok(have)} · 필요 자금 = ${mode === 'rent' ? '전세가 (부대비용 제외' : (mode === 'gap' ? '매매 − 전세' : '매매가') + ` + 부대비용(매매가의 ${(cost * 100).toFixed(1)}%`})` +
      (fromRegion ? ' · 최근 3년 실거래 기준(직접 적은 호가가 있으면 호가)' : '') + ' · 적어 둔 호가가 없는 값은 최근 실거래로 대신하고 <span class="star">실</span> 로 표시합니다' + (mode !== 'live' ? ' · 전세 호가·실거래가 모두 없는 단지는 빠집니다' : '');
    $('bgTable').innerHTML = '<thead><tr><th class="l">단지</th><th>평형</th><th>매매</th><th>전세</th><th>갭</th><th>전세가율</th><th>필요 자금</th><th>남는 돈</th><th>세대수</th><th>연식</th><th class="c">트래킹</th></tr></thead><tbody>' +
      (out.length ? out.slice(0, 500).map(({ r, need, left }, i) => `<tr><td class="l">${U.esc(r.dong)} <b>${U.esc(r.name)}</b></td><td>${r.g}㎡<small>${CONFIG.toPyeong(r.g)}평</small></td>` +
        `<td class="sale">${U.price(r.s)}${real(r.sQ)}</td><td class="rent">${r.r == null ? '-' : U.price(r.r) + real(r.rQ)}</td><td>${r.gap == null ? '-' : U.price(r.gap)}</td><td>${r.ratio == null ? '-' : r.ratio.toFixed(0) + '%'}</td>` +
        `<td><b>${U.price(Math.round(need))}</b></td><td>${U.price(Math.round(left))}</td><td>${r.hh ? r.hh.toLocaleString() : '-'}</td><td>${r.buildYear || '-'}</td>` +
        `<td class="c">${r.tracked || Tracking.has(r.id) ? '★' : `<button class="mini" data-add="${i}">담기</button>`}</td></tr>`).join('')
        : '<tr><td colspan="11" style="color:var(--sub);padding:20px">조건에 맞는 단지가 없습니다. 금액을 늘리거나 조건을 풀어 보세요.</td></tr>') + '</tbody>';
    $('bgTable').onclick = (e) => { const i = e.target.dataset.add; if (i == null) return; Tracking.add([out[+i].r]); e.target.outerHTML = '★'; };
  }

  /* ── 산점도 ── */
  function scatter() {
    const css = getComputedStyle(document.documentElement), col = (n) => css.getPropertyValue(n).trim();
    const ax = (id) => AXES.find(a => a[0] === id), X = ax($('scX').value), Y = ax($('scY').value);
    const PAL = ['#4f9cff', '#f5a742', '#34c759', '#ff5c5c', '#b388ff', '#00c2d1', '#ffcc00', '#ff7eb6', '#8d99ae', '#a3e635'];
    const groups = new Map();
    for (const r of rows) {
      const x = X[2](r), y = Y[2](r);
      if (x == null || y == null || isNaN(x) || isNaN(y)) continue;
      if (!groups.has(r.sgg)) groups.set(r.sgg, []);
      groups.get(r.sgg).push({ x: +x.toFixed(2), y: +y.toFixed(2), name: `${r.name} ${r.g}㎡` });
    }
    if (chart) chart.destroy();
    chart = new Chart($('scChart'), { type: 'scatter',
      data: { datasets: [...groups.entries()].map(([name, data], i) => ({ label: name, data, backgroundColor: PAL[i % PAL.length] + 'cc', borderColor: PAL[i % PAL.length], pointRadius: 5, pointHoverRadius: 7 })) },
      options: { responsive: true, maintainAspectRatio: false, animation: false,
        scales: { x: { title: { display: true, text: X[1], color: col('--sub') }, ticks: { color: col('--sub') }, grid: { color: col('--line') } }, y: { title: { display: true, text: Y[1], color: col('--sub') }, ticks: { color: col('--sub') }, grid: { color: col('--line') } } },
        plugins: { legend: { labels: { color: col('--text') } }, tooltip: { callbacks: { label: (c) => `${c.raw.name} — ${X[1]} ${c.raw.x}, ${Y[1]} ${c.raw.y}` } } } } });
  }

  /* ── 갈아타기 시뮬레이터 ── */
  /** 중개보수 상한(만원). price = 매매가(만원) */
  function fee(p) {
    if (p < 5000) return Math.min(p * 0.006, 25);
    if (p < 20000) return Math.min(p * 0.005, 80);
    return p * (p < 90000 ? 0.004 : p < 120000 ? 0.005 : p < 150000 ? 0.006 : 0.007);
  }
  /** 취득세 + 지방교육세 대략값(만원). 1주택·85㎡ 이하 기준 */
  function acquire(p) {
    const rate = p <= 60000 ? 1 : p <= 90000 ? p / 10000 * 2 / 3 - 3 : 3;
    return p * rate * 1.1 / 100;
  }
  function fillMover() {
    const list = Tracking.all(), opt = '<option value="">(직접 입력)</option>' + list.map(it => `<option value="${U.esc(it.id)}">${U.esc(it.name)} ${it.g}㎡</option>`).join('');
    for (const id of ['mvFrom', 'mvTo']) { const cur = $(id).value; $(id).innerHTML = opt; if (list.some(it => it.id === cur)) $(id).value = cur; }
  }
  async function pickMover(sel, target) {
    const it = Tracking.all().find(x => x.id === $(sel).value);
    if (!it) return;
    await Real.load([it]);
    const s = Kit.quote(it)?.s ?? Real.get(it.id)?.sale?.price;
    if (s) $(target).value = +(s / 10000).toFixed(2);
    mover();
  }
  function mover() {
    const v = (id) => (parseFloat($(id).value) || 0) * 10000;
    const sell = v('mvSell'), buy = v('mvBuy'), debt = v('mvDebt'), tax = v('mvTax'), loan = v('mvLoan'), cash = v('mvCash'), etc = parseFloat($('mvEtc').value) || 0;
    const all = Store.get(SKEY, {}); all.mover = {}; ['mvSell', 'mvBuy', 'mvDebt', 'mvTax', 'mvLoan', 'mvCash', 'mvEtc'].forEach(id => { all.mover[id] = $(id).value; }); Store.set(SKEY, all);
    if (!sell && !buy) { $('mvCards').innerHTML = '<p class="hint">파는 가격과 사는 가격을 적으면 계산됩니다.</p>'; return; }
    const feeS = sell ? fee(sell) : 0, feeB = buy ? fee(buy) : 0, acq = buy ? acquire(buy) : 0;
    const hand = sell - debt - tax - feeS, cost = buy + acq + feeB + etc, need = cost - hand - cash - loan;
    const card = (k, val, s, cls = '') => `<div class="card"><div class="k">${k}</div><div class="v ${cls}">${val}</div><div class="s">${s}</div></div>`;
    const man = (x) => Math.round(x).toLocaleString() + '만';
    $('mvCards').innerHTML = [
      card('① 팔고 손에 쥐는 돈', U.price(Math.round(hand)), `매도 ${Kit.eok(sell)} − 대출·전세 ${Kit.eok(debt)} − 양도세 ${man(tax)} − 중개보수 ${man(feeS)}`),
      card('② 새 집에 드는 돈', U.price(Math.round(cost)), `매수 ${Kit.eok(buy)} + 취득세 약 ${man(acq)} + 중개보수 ${man(feeB)} + 이사·수리 ${man(etc)}`),
      card('③ 쓸 수 있는 돈', U.price(Math.round(hand + cash + loan)), `① + 현금 ${Kit.eok(cash)} + 새 대출 ${Kit.eok(loan)}`),
      card(need > 0 ? '더 필요한 돈 (② − ③)' : '남는 돈 (③ − ②)', U.price(Math.abs(Math.round(need))), need > 0 ? '이만큼 더 모으거나 대출을 늘려야 합니다' : '갈아타기가 가능한 금액입니다', need > 0 ? 'up' : 'down'),
      card('가격 차이 (새 집 − 지금 집)', U.diff(buy - sell), sell ? `새 집이 지금 집의 ${(buy / sell * 100).toFixed(0)}%` : ''),
    ].join('');
  }

  /* ── 시세그룹핑 탭: 자동 묶기 (다차원) ── */
  const band = (v, step, unit) => (v == null ? null : `${Math.floor(v / step) * step}${unit}`);
  const DIMS = [
    ['band', '가격대', r => (r.s ? CONFIG.priceBand(r.s) : null), (a, b) => parseFloat(b) - parseFloat(a)],
    ['zone', '생활권', r => r.rec.zone || null], ['sgg', '시군구', r => r.sgg], ['dong', '동', r => r.dong],
    ['age', '연식대', r => { if (!r.buildYear) return null; const a = CONFIG.toAge(r.buildYear); return a <= 5 ? '신축 (5년 이하)' : a <= 10 ? '6~10년' : a <= 20 ? '11~20년' : a <= 30 ? '21~30년' : '30년 초과'; }, null, ['신축 (5년 이하)', '6~10년', '11~20년', '21~30년', '30년 초과']],
    ['size', '평형대', r => band(CONFIG.toPyeong(r.g), 10, '평대'), (a, b) => parseFloat(a) - parseFloat(b)],
    ['hh', '세대수', r => (!r.hh ? null : r.hh < 300 ? '300세대 미만' : r.hh < 500 ? '300~499' : r.hh < 1000 ? '500~999' : '1000세대 이상'), null, ['1000세대 이상', '500~999', '300~499', '300세대 미만']],
    ['ratio', '전세가율', r => (r.ratio == null ? null : `${Math.floor(r.ratio / 10) * 10}%대`), (a, b) => parseFloat(b) - parseFloat(a)],
    ['status', '상태', r => r.rec.status || '(상태 없음)'], ['folder', '폴더', r => (r.rec.folders || [])[0] || null],
  ];
  let pvRows = [], pvGrid = null, pvPick = null;
  /* 자동 묶기 편집: 삭제(removed) · 고정값(fix: 가격·칸) · 직접 추가(adds) · 칸 이름(labels) · 크기(w,h). 자동 값은 건드리지 않고 위에 덮어씀 */
  const PKEY = 'apt.pvEdit.v1';
  const pvSt = () => { const x = Store.get(PKEY, null) || {}; return { removed: x.removed || [], fix: x.fix || {}, adds: x.adds || [], labels: x.labels || {}, w: x.w || 0, h: x.h || 0 }; };
  const pvSave = (st) => Store.set(PKEY, st);
  if (typeof Saves !== 'undefined') Saves.register('pvEdit', { name: '시세그룹핑 자동 묶기 편집', keys: [PKEY], hint: '자동 묶기에서 고친 가격·칸, 뺀 단지, 직접 추가한 단지, 칸 크기를 저장합니다.' });
  const pvVal = (D, r) => r.fixDims?.[D[0]] ?? D[2](r);                              // 고정한 칸이 있으면 그것을, 아니면 자동 값
  function pvFix(r, f) {
    if (!f) return r;
    const o = { ...r };
    if (f.s != null) { o.s = f.s; o.sFixed = true; o.ratio = o.r ? o.r / o.s * 100 : null; o.gap = o.r != null ? o.s - o.r : null; }
    if (f.dims && Object.keys(f.dims).length) { o.fixDims = f.dims; o.dFixed = true; }
    return o;
  }
  function pvApply(rows, st) {
    const rm = new Set(st.removed), out = rows.filter(r => !rm.has(r.id)).map(r => pvFix(r, st.fix[r.id]));
    for (const a of st.adds) if (!rm.has(a.id) && !out.some(r => r.id === a.id)) {
      out.push(pvFix({ id: a.id, name: a.name, g: a.g, s: a.s, r: null, ratio: null, gap: null, sgg: a.sgg || '', dong: a.dong || '', sido: a.sido || '', rec: { zone: null, status: null, folders: [] }, buildYear: null, hh: null, manual: true, fixDims: a.dims || {} }, st.fix[a.id]));
    }
    return out;
  }
  async function pivot() {
    if (!$('pvRow').options.length) {
      const opt = DIMS.map(d => `<option value="${d[0]}">${d[1]}</option>`).join('');
      const sv = Store.get(SKEY, {}).pivot || { row: 'band', col: 'sgg', show: 'price' };
      $('pvRow').innerHTML = $('pvCol').innerHTML = opt; $('pvRow').value = sv.row; $('pvCol').value = sv.col; $('pvShow').value = sv.show;
      ['pvFolder', 'pvRow', 'pvCol', 'pvShow', 'pvCmp'].forEach(id => { $(id).onchange = pivot; });
      pvWire();
      $('btnPvExcel').onclick = () => { if (!pvGrid) return; U.download(`자동묶기_${U.stamp()}`, [{ name: '자동 묶기', rows: [['', ...pvGrid.cols], ...pvGrid.rows.map(rk => [rk, ...pvGrid.cols.map(ck => (pvGrid.cell.get(rk + '\t' + ck) || []).map(r => `${r.name} ${CONFIG.toPyeong(r.g)}평 ${pvText(r)}`).join('\n'))])] }]); };
      $('btnPvPng').onclick = async () => { const t = $('pvTable'); if (!t.rows.length) return U.toast('먼저 표를 만들어 주세요.'); const r = await Snap.png(t, '자동묶기'); U.toast(`그림으로 저장했습니다 (${r.w}×${r.h}).`); };
      $('btnPvPdf').onclick = () => { const t = $('pvTable'); if (!t.rows.length) return U.toast('먼저 표를 만들어 주세요.'); Snap.pdf(t, '자동 묶기'); };
    }
    const folders = Tracking.exportAll().folders || [], cur = $('pvFolder').value;
    $('pvFolder').innerHTML = '<option value="">전체</option>' + folders.map(f => `<option>${U.esc(f)}</option>`).join('');
    if (folders.includes(cur)) $('pvFolder').value = cur;
    const all = Store.get(SKEY, {}); all.pivot = { row: $('pvRow').value, col: $('pvCol').value, show: $('pvShow').value }; Store.set(SKEY, all);
    let list = await Kit.records(true);
    if ($('pvFolder').value) list = list.filter(x => (x.rec.folders || []).includes($('pvFolder').value));
    const st0 = pvSt();
    if (!list.length && !st0.adds.length) { $('pvTable').innerHTML = '<tbody><tr><td style="color:var(--sub);padding:24px">시세트래킹에 담은 단지가 없습니다.</td></tr></tbody>'; pvGrid = null; return; }
    if (list.length) await Real.load(list);
    const st = pvSt();
    pvRows = pvApply(list.map(calc), st);
    const R = DIMS.find(d => d[0] === $('pvRow').value), C = DIMS.find(d => d[0] === $('pvCol').value);
    const order = (d, keys) => (d[4] ? [...d[4].filter(k => keys.includes(k)), ...keys.filter(k => !d[4].includes(k))] : keys.sort(d[3] || ((a, b) => a.localeCompare(b, 'ko'))));
    const cell = new Map(), rk = new Set(), ck = new Set();
    (st.labels[R[0]] || []).forEach(x => rk.add(x)); (st.labels[C[0]] || []).forEach(x => ck.add(x));     // 직접 만든 빈 칸
    for (const r of pvRows) {
      const a = pvVal(R, r) ?? '(값 없음)', b = pvVal(C, r) ?? '(값 없음)';
      rk.add(a); ck.add(b);
      const k = a + '\t' + b; if (!cell.has(k)) cell.set(k, []); cell.get(k).push(r);
    }
    pvGrid = { rows: order(R, [...rk]), cols: order(C, [...ck]), cell };
    pvGrid.R = R[0]; pvGrid.C = C[0];
    const w = st.w || 150, ext = (d, k) => (st.labels[d[0]] || []).includes(k) ? `<button class="mini" data-pvdel="${d[0]}" data-v="${U.esc(k)}" title="이 빈 칸 삭제">×</button>` : '';
    const emptyOf = (d, k, isRow) => !pvRows.some(r => (pvVal(d, r) ?? '(값 없음)') === k);
    const item = (r) => `<div class="pv" draggable="true" data-id="${U.esc(r.id)}"><b>${U.esc(r.name)}</b> ${CONFIG.toPyeong(r.g)}평 <span class="sale">${pvText(r)}</span>${pvCmpTag(r)}${r.sFixed || r.dFixed ? ' <span class="pin" title="직접 고친 값(고정) — 자동 값이 바뀌어도 유지됩니다">📌</span>' : ''}${r.manual ? ' <span class="pin" title="직접 추가한 단지">＋</span>' : ''}<span class="pvact"><button type="button" data-pv="edit" title="가격·칸 고치기">✎</button><button type="button" data-pv="del" title="이 표에서만 빼기 (시세트래킹은 그대로)">✕</button></span></div>`;
    $('pvTable').style.minWidth = (120 + pvGrid.cols.length * w) + 'px';
    $('pvTable').style.setProperty('--pvh', st.h ? st.h + 'px' : 'auto');
    $('pvTable').innerHTML = `<thead><tr><th style="width:120px">${R[1]} ＼ ${C[1]}</th>` + pvGrid.cols.map(c => `<th style="width:${w}px">${U.esc(c)}${emptyOf(C, c) ? ext(C, c) : ''}</th>`).join('') + '</tr></thead><tbody>' +
      pvGrid.rows.map(a => `<tr><th class="band">${U.esc(a)}${emptyOf(R, a) ? ext(R, a) : ''}</th>` + pvGrid.cols.map(b => `<td data-r="${U.esc(a)}" data-c="${U.esc(b)}">${(cell.get(a + '\t' + b) || []).sort((x, y) => (y.s || 0) - (x.s || 0)).map(item).join('')}</td>`).join('') + '</tr>').join('') + '</tbody>';
    $('pvW').value = w; $('pvWV').textContent = w + 'px'; $('pvH').value = st.h || 0; $('pvHV').textContent = st.h ? st.h + 'px' : '자동';
    const nfix = Object.keys(st.fix).length;
    pvFillAdd();
    $('pvInfo').textContent = [nfix ? `고정한 단지 ${nfix}개` : '', st.removed.length ? `뺀 단지 ${st.removed.length}개` : '', st.adds.length ? `직접 추가 ${st.adds.length}개` : ''].filter(Boolean).join(' · ');
  }
  /** 칸 목록(현재 표의 세로·가로 칸 이름) → <option> */
  const pvOpts = (list, cur) => list.map(x => `<option ${x === cur ? 'selected' : ''}>${U.esc(x)}</option>`).join('');
  /** 단지를 옮기면 비게 되는 원래 칸도 빈 칸으로 남김 (자동으로 사라져 되돌릴 곳이 없어지는 것을 막음) */
  function pvKeep(st, r) {
    if (!r || !pvGrid) return;
    for (const dim of [pvGrid.R, pvGrid.C]) {
      const D = DIMS.find(d => d[0] === dim), v = pvVal(D, r);
      if (v != null && !(st.labels[dim] || (st.labels[dim] = [])).includes(v)) st.labels[dim].push(v);
    }
  }
  function pvMove(id, rowLab, colLab) {
    if (!pvGrid) return;
    const st = pvSt(); pvKeep(st, pvRows.find(x => x.id === id));
    const f = st.fix[id] || (st.fix[id] = {}), d = f.dims || (f.dims = {});
    if (rowLab != null) d[pvGrid.R] = rowLab;
    if (colLab != null && pvGrid.C !== pvGrid.R) d[pvGrid.C] = colLab;
    pvSave(st); pivot();
  }
  function pvPop(id, btn) {
    const r = pvRows.find(x => x.id === id), pop = $('pvPop'); if (!r) return;
    const st = pvSt(), R = DIMS.find(d => d[0] === pvGrid.R), C = DIMS.find(d => d[0] === pvGrid.C);
    pop.innerHTML = `<div class="cfh">${U.esc(r.name)} ${CONFIG.toPyeong(r.g)}평</div>
      <label>가격 (억)<input type="number" step="0.1" min="0" id="pvpPrice" value="${r.s != null ? (r.s / 10000).toFixed(2).replace(/\.?0+$/, '') : ''}" placeholder="예: 12.5"></label>
      <label>${U.esc(R[1])} 칸<select id="pvpRow">${pvOpts(pvGrid.rows, pvVal(R, r) ?? '(값 없음)')}</select></label>
      <label>${U.esc(C[1])} 칸<select id="pvpCol">${pvOpts(pvGrid.cols, pvVal(C, r) ?? '(값 없음)')}</select></label>
      <div class="cfbtns"><button data-pvp="ok" class="primary">적용(고정)</button><button data-pvp="auto" title="직접 고친 가격·칸을 지우고 자동 값으로">자동 값으로</button><button data-pvp="close">닫기</button></div>
      <small class="hint" style="margin:0">고친 값은 📌 고정되어 자동 갱신 때도 유지됩니다.</small>`;
    pop.hidden = false;
    const b = btn.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(b.left, innerWidth - 250)) + 'px';
    pop.style.top = Math.max(8, Math.min(b.bottom + 4, innerHeight - pop.offsetHeight - 8)) + 'px';
    pop.onclick = (e) => {
      const k = e.target.dataset.pvp; if (!k) return;
      if (k === 'close') { pop.hidden = true; return; }
      const st2 = pvSt();
      if (k === 'auto') { delete st2.fix[id]; }
      if (k === 'ok') {
        pvKeep(st2, r);
        const f = st2.fix[id] || (st2.fix[id] = {}), v = parseFloat($('pvpPrice').value);
        if (v > 0 && Math.round(v * 10000) !== r.s) f.s = Math.round(v * 10000);
        const rowV = $('pvpRow').value, colV = $('pvpCol').value, d = f.dims || (f.dims = {});
        if (rowV !== (pvVal(R, r) ?? '(값 없음)')) d[R[0]] = rowV;
        if (colV !== (pvVal(C, r) ?? '(값 없음)') && C[0] !== R[0]) d[C[0]] = colV;
        if (f.s == null && !Object.keys(d).length) delete st2.fix[id];
      }
      pvSave(st2); pop.hidden = true; pivot();
    };
  }
  function pvWire() {
    const t = $('pvTable'), pop = $('pvPop');
    t.onclick = (e) => {
      const act = e.target.closest('button[data-pv]'), del = e.target.closest('button[data-pvdel]');
      if (del) { const st = pvSt(), a = st.labels[del.dataset.pvdel] || []; st.labels[del.dataset.pvdel] = a.filter(x => x !== del.dataset.v); pvSave(st); return pivot(); }
      if (!act) return;
      const id = act.closest('.pv').dataset.id;
      if (act.dataset.pv === 'edit') return pvPop(id, act);
      const r = pvRows.find(x => x.id === id), st = pvSt();
      st.removed = [...new Set([...st.removed, id])]; delete st.fix[id];
      pvSave(st); pivot(); U.toast(`${r?.name || '단지'} 을(를) 이 표에서 뺐습니다. (시세트래킹은 그대로) [뺀 단지 되살리기]로 되돌릴 수 있습니다.`);
    };
    t.ondragstart = (e) => { const el = e.target.closest?.('.pv'); if (!el) return; e.dataTransfer.setData('text/plain', el.dataset.id); e.dataTransfer.effectAllowed = 'move'; };
    t.ondragover = (e) => { if (e.target.closest('td[data-r]')) e.preventDefault(); };
    t.ondrop = (e) => { const td = e.target.closest('td[data-r]'); if (!td) return; e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) pvMove(id, td.dataset.r, td.dataset.c); };
    document.addEventListener('mousedown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('button[data-pv]')) pop.hidden = true; });
    const addLabel = (isRow) => {
      if (!pvGrid) return;
      const dim = isRow ? pvGrid.R : pvGrid.C, D = DIMS.find(d => d[0] === dim), ex = (isRow ? pvGrid.rows : pvGrid.cols)[0] || '';
      const name = (prompt(`새 ${isRow ? '세로' : '가로'}칸(${D[1]}) 이름 (예: ${ex || '새 칸'})`) || '').trim(); if (!name) return;
      const st = pvSt(), a = st.labels[dim] || (st.labels[dim] = []); if (!a.includes(name)) a.push(name); pvSave(st); pivot();
    };
    $('btnPvAddRow').onclick = () => addLabel(true); $('btnPvAddCol').onclick = () => addLabel(false);
    const size = (patch) => { const st = pvSt(); Object.assign(st, patch); pvSave(st); pivot(); };
    $('pvW').oninput = () => size({ w: +$('pvW').value }); $('pvH').oninput = () => size({ h: +$('pvH').value });
    $('btnPvSize').onclick = () => size({ w: 0, h: 0 });
    $('btnPvUnfix').onclick = () => { const st = pvSt(); if (!Object.keys(st.fix).length) return U.toast('고정한 값이 없습니다.'); if (!confirm('직접 고친 가격·칸(📌)을 모두 자동 값으로 되돌릴까요?')) return; st.fix = {}; pvSave(st); pivot(); };
    $('btnPvRestore').onclick = () => { const st = pvSt(); if (!st.removed.length) return U.toast('뺀 단지가 없습니다.'); st.removed = []; pvSave(st); pivot(); };
    Finder.attach($('pvAddFind'), async (x) => {
      pvPick = x; const ar = await Finder.areas(x.code, x.key), list = ar.list.length ? ar.list : [{ g: 84, n: 0 }];
      $('pvAddArea').innerHTML = list.map(a => `<option value="${a.g}" ${a.g === ar.best ? 'selected' : ''}>${a.g}㎡ (${CONFIG.toPyeong(a.g)}평)${a.n ? ` · ${a.n}건` : ''}</option>`).join('');
      $('btnPvAdd').disabled = false;
    });
    $('btnPvAdd').onclick = async () => {
      if (!pvPick) return;
      const g = +$('pvAddArea').value, y = new Date().getFullYear(); let price = parseFloat($('pvAddPrice').value) * 10000;
      if (!(price > 0)) {
        const tr = await Data.complexTrades(pvPick.code, pvPick.key, g, y - 5, y), last = tr.sale.filter(t => !t.direct).sort((a, b) => b.d - a.d)[0];
        if (last) price = last.price;
        else { const v = parseFloat(prompt(`${pvPick.name} ${CONFIG.toPyeong(g)}평: 최근 5년 매매 실거래가 없습니다.\n넣을 가격을 억 단위로 입력하세요 (예: 12.5)`) || ''); if (!(v > 0)) return; price = v * 10000; }
      }
      const id = `${pvPick.code}|${pvPick.key}#${g}`, st = pvSt();
      if (pvRows.some(r => r.id === id)) return U.toast('이미 표에 있는 단지·평형입니다.');
      st.removed = st.removed.filter(x => x !== id); st.adds = st.adds.filter(a => a.id !== id);
      const dims = {}, rv = $('pvAddRow').value, cv = $('pvAddCol').value;
      if (pvGrid && rv) dims[pvGrid.R] = rv; if (pvGrid && cv && pvGrid.C !== pvGrid.R) dims[pvGrid.C] = cv;
      st.adds.push({ id, name: pvPick.name, g, s: price, sido: pvPick.sido, sgg: pvPick.sgg, dong: pvPick.dong, dims }); pvSave(st);
      U.toast(`${pvPick.name} 을(를) 표에 넣었습니다. 끌어서 다른 칸으로 옮길 수 있습니다.`);
      pvPick = null; $('pvAddFind').value = ''; $('pvAddPrice').value = ''; $('btnPvAdd').disabled = true; pivot();
    };
  }
  /** 칸 선택 목록(직접 추가용)을 현재 표의 칸으로 채움 */
  function pvFillAdd() {
    if (!pvGrid) return;
    const rv = $('pvAddRow').value, cv = $('pvAddCol').value;
    $('pvAddRow').innerHTML = '<option value="">(자동)</option>' + pvOpts(pvGrid.rows); $('pvAddCol').innerHTML = '<option value="">(자동)</option>' + pvOpts(pvGrid.cols);
    if (pvGrid.rows.includes(rv)) $('pvAddRow').value = rv; if (pvGrid.cols.includes(cv)) $('pvAddCol').value = cv;
  }
  /** n개월 전 매매가: 그 달(또는 그 이전 가장 가까운 달)에 적은 호가 → 없으면 그 달 실거래 평균 */
  function pvPast(r, n) {
    const t = new Date(), d = new Date(t.getFullYear(), t.getMonth() - n, 1), ym = d.getFullYear() * 100 + d.getMonth() + 1;
    const qs = (r.rec && r.rec.quotes) || {}, ms = Object.keys(qs).map(Number).filter(m => m <= ym && qs[m] && qs[m].s != null).sort((a, b) => b - a);
    if (ms.length && ym - ms[0] < 100) return qs[ms[0]].s;
    const mon = r.rl && r.rl.mon, i = 11 - n;
    return mon && i >= 0 && mon[i] != null ? Math.round(mon[i]) : null;
  }
  const pvCmpTag = (r) => {
    const n = +($('pvCmp') && $('pvCmp').value || 0); if (!n || r.s == null) return '';
    const p = pvPast(r, n); if (p == null) return ` <small class="pvcmp">${n}개월 전 자료 없음</small>`;
    const d = r.s - p, moved = CONFIG.priceBand(p) !== CONFIG.priceBand(r.s);
    return ` <small class="pvcmp ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d === 0 ? '변동 없음' : (d > 0 ? '▲' : '▼') + Kit.eok(Math.abs(d))} (${n}개월 전 ${Kit.eok(p)})${moved ? ' ↗칸 이동' : ''}</small>`;
  };
  const pvText = (r) => { const m = $('pvShow').value; return m === 'ratio' ? (r.ratio == null ? '-' : r.ratio.toFixed(0) + '%') : m === 'gap' ? (r.gap == null ? '-' : Kit.eok(r.gap)) : Kit.eok(r.s); };

  async function init() {
    regions = await Data.regions();
    const opt = AXES.map(a => `<option value="${a[0]}">${a[1]}</option>`).join('');
    $('scX').innerHTML = $('scY').innerHTML = opt; $('scX').value = 's'; $('scY').value = 'ratio';
    $('scX').onchange = $('scY').onchange = scatter;
    $('myScope').onchange = () => { Store.set('apt.myScope', $('myScope').value); load(false); };
    $('btnMyLoad').onclick = () => load(true);
    $('btnMyExcel').onclick = excel;
    const sidos = [...new Set(regions.map(r => r[1]))], last = Store.get('apt.lastRegion', null);
    $('bgSido').innerHTML = sidos.map(s => `<option>${U.esc(s)}</option>`).join('');
    if (last && sidos.includes(last.sido)) $('bgSido').value = last.sido;
    fillBgSgg(); if (last) $('bgSgg').value = last.code;
    $('bgSido').onchange = fillBgSgg;
    const sv = Store.get(SKEY, {});
    Object.entries(sv.budget || {}).forEach(([id, v]) => { if ($(id)) $(id).value = v; });
    Object.entries(sv.mover || {}).forEach(([id, v]) => { if ($(id)) $(id).value = v; });
    const showRegion = () => document.querySelectorAll('.bgRegion').forEach(el => { el.hidden = $('bgSource').value !== 'region'; });
    $('bgSource').onchange = showRegion; showRegion();
    $('btnBudget').onclick = () => budget().catch(e => { console.error(e); U.toast('찾는 중 오류: ' + (e.message || e)); });
    $('mvFrom').onchange = () => pickMover('mvFrom', 'mvSell');
    $('mvTo').onchange = () => pickMover('mvTo', 'mvBuy');
    ['mvSell', 'mvBuy', 'mvDebt', 'mvTax', 'mvLoan', 'mvCash', 'mvEtc'].forEach(id => { $(id).oninput = mover; });
    inited = true;
  }
  async function open() { if (!inited) return; fillScope(); await load(false); mover(); }

  return { init, open, pivot, calc, scopeRows };
})();
