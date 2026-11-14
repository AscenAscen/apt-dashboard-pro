/* ─────────────────────────────────────────────────────────
   my.js — [내 분석] 탭  (+ 시세그룹핑 탭의 "자동 묶기")
   내가 적어 둔 호가와 실거래를 합쳐 계산합니다.
   · 지표표: 전세가율, 갭, 호가 괴리율, 매물 증감률, 월 회전율, 전고 대비, 12개월 추세, 대장 대비
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
    { id: 'lead', label: '대장 대비', val: r => r.lead?.pct, html: r => (r.lead ? `${r.lead.pct.toFixed(0)}%<small>${U.esc(r.lead.name)}</small>` : '-'), x: r => r.lead?.pct },
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
    const have = mode === 'gap' ? cash : cash + loan;
    const out = [];
    for (const r of src) {
      if (r.s == null || (mode === 'gap' && r.r == null)) continue;
      const need = (mode === 'gap' ? r.s - r.r : r.s) + r.s * cost;
      if (need > have) continue;
      if (!isNaN(minRatio) && !(r.ratio >= minRatio)) continue;
      if (!isNaN(minHouse) && !(r.hh >= minHouse)) continue;
      out.push({ r, need, left: have - need });
    }
    out.sort((a, b) => b.r.s - a.r.s);
    $('bgNote').innerHTML = `${src.length.toLocaleString()}개 중 <b>${out.length.toLocaleString()}개</b>가 조건에 맞습니다. 쓸 수 있는 돈 ${Kit.eok(have)} · 필요 자금 = ${mode === 'gap' ? '매매 − 전세' : '매매가'} + 부대비용(매매가의 ${(cost * 100).toFixed(1)}%)` +
      (fromRegion ? ' · 최근 3년 실거래 기준(직접 적은 호가가 있으면 호가)' : '') + (mode === 'gap' ? ' · 전세가 없는 단지는 빠집니다' : '');
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
  let pvRows = [], pvGrid = null;
  async function pivot() {
    if (!$('pvRow').options.length) {
      const opt = DIMS.map(d => `<option value="${d[0]}">${d[1]}</option>`).join('');
      const sv = Store.get(SKEY, {}).pivot || { row: 'band', col: 'sgg', show: 'price' };
      $('pvRow').innerHTML = $('pvCol').innerHTML = opt; $('pvRow').value = sv.row; $('pvCol').value = sv.col; $('pvShow').value = sv.show;
      ['pvFolder', 'pvRow', 'pvCol', 'pvShow'].forEach(id => { $(id).onchange = pivot; });
      $('btnPvExcel').onclick = () => { if (!pvGrid) return; U.download(`자동묶기_${U.stamp()}`, [{ name: '자동 묶기', rows: [['', ...pvGrid.cols], ...pvGrid.rows.map(rk => [rk, ...pvGrid.cols.map(ck => (pvGrid.cell.get(rk + '\t' + ck) || []).map(r => `${r.name} ${CONFIG.toPyeong(r.g)}평 ${pvText(r)}`).join('\n'))])] }]); };
    }
    const folders = Tracking.exportAll().folders || [], cur = $('pvFolder').value;
    $('pvFolder').innerHTML = '<option value="">전체</option>' + folders.map(f => `<option>${U.esc(f)}</option>`).join('');
    if (folders.includes(cur)) $('pvFolder').value = cur;
    const all = Store.get(SKEY, {}); all.pivot = { row: $('pvRow').value, col: $('pvCol').value, show: $('pvShow').value }; Store.set(SKEY, all);
    let list = await Kit.records(true);
    if ($('pvFolder').value) list = list.filter(x => (x.rec.folders || []).includes($('pvFolder').value));
    if (!list.length) { $('pvTable').innerHTML = '<tbody><tr><td style="color:var(--sub);padding:24px">시세트래킹에 담은 단지가 없습니다.</td></tr></tbody>'; pvGrid = null; return; }
    await Real.load(list);
    pvRows = list.map(calc);
    const R = DIMS.find(d => d[0] === $('pvRow').value), C = DIMS.find(d => d[0] === $('pvCol').value);
    const order = (d, keys) => (d[4] ? [...d[4].filter(k => keys.includes(k)), ...keys.filter(k => !d[4].includes(k))] : keys.sort(d[3] || ((a, b) => a.localeCompare(b, 'ko'))));
    const cell = new Map(), rk = new Set(), ck = new Set();
    for (const r of pvRows) {
      const a = R[2](r) ?? '(값 없음)', b = C[2](r) ?? '(값 없음)';
      rk.add(a); ck.add(b);
      const k = a + '\t' + b; if (!cell.has(k)) cell.set(k, []); cell.get(k).push(r);
    }
    pvGrid = { rows: order(R, [...rk]), cols: order(C, [...ck]), cell };
    $('pvTable').innerHTML = `<thead><tr><th>${R[1]} ＼ ${C[1]}</th>` + pvGrid.cols.map(c => `<th>${U.esc(c)}</th>`).join('') + '</tr></thead><tbody>' +
      pvGrid.rows.map(a => `<tr><th class="band">${U.esc(a)}</th>` + pvGrid.cols.map(b => `<td>${(cell.get(a + '\t' + b) || []).sort((x, y) => (y.s || 0) - (x.s || 0)).map(r => `<div class="pv"><b>${U.esc(r.name)}</b> ${CONFIG.toPyeong(r.g)}평 <span class="sale">${pvText(r)}</span></div>`).join('')}</td>`).join('') + '</tr>').join('') + '</tbody>';
  }
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
