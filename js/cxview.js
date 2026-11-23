/* ───────────── 단지 한 장 요약 + 비슷한 단지 찾기 ─────────────
   어디서든 data-cx="지역코드|단지키#평형" 이 붙은 이름을 누르면 큰 창으로 열립니다.
   · 실거래(2020년~)·연식·세대수·내 호가·메모·랜드마크를 한 화면에
   · 비슷한 단지: data/cx/{시도}.json (scripts/cx_summary.py 가 자동 수집 때 만듦) 에서 가격·평형·연식·세대수가 가까운 단지 */
const CxView = (() => {
  const $ = (id) => document.getElementById(id);
  // 권역별로 불러올 시도 묶음 파일(data/cx/앞2자리.json). 2026.7 광주·전남 통합으로 둘 다 '12' → 불러온 뒤 시도 이름으로 다시 거름
  const ZONE_SD = { 서울: ['11'], 수도권: ['41', '28'], 광역시: ['26', '27', '12', '29', '30', '31'] };
  const SIM = 'apt.cxSim.v1';                                  // 비슷한 단지 찾기 조건 (기기에 기억)
  const DEF = { scope: 'sido', price: 1, area: 1, year: 1, hh: 1, ratio: 0, pp: 15, ap: 5, yp: 5, rp: 5, unknownHH: 1 };
  let chart = null, cur = null, sumCache = new Map();
  const eok = (v) => (v == null ? '-' : U.price(v));
  const pct = (v, d = 0) => (v == null || !isFinite(v) ? '-' : (v > 0 ? '+' : '') + v.toFixed(d) + '%');
  const x = (d) => { const y = Math.floor(d / 10000), m = Math.floor(d / 100) % 100, dd = d % 100; return y + (m - 1) / 12 + (dd - 1) / 365; };
  const hhBand = (h) => (!h ? null : h < 300 ? 0 : h < 1000 ? 1 : 2);
  const HHB = ['300세대 미만', '300~999세대', '1,000세대 이상'];

  function modal() {
    let m = $('cxModal'); if (m) return m;
    m = document.createElement('div'); m.className = 'modal'; m.id = 'cxModal'; m.hidden = true;
    m.innerHTML = '<div class="modalbox cxbox"><div class="cxtop"><span class="grow"></span><button id="cxPng" title="이 요약을 그림으로 저장">그림 저장</button><button id="cxClose">닫기 ✕</button></div><div id="cxBody"></div></div>';
    document.body.appendChild(m);
    $('cxClose').onclick = close;
    m.addEventListener('click', (e) => { if (e.target === m) close(); });
    $('cxPng').onclick = async () => { const b = $('cxBody'); if (!b.firstChild) return; const r = await Snap.png(b, (cur && cur.name) || '단지요약'); U.toast(`그림으로 저장했습니다 (${r.w}×${r.h}).`); };
    $('cxBody').addEventListener('click', act);
    $('cxBody').addEventListener('change', onChange);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !m.hidden) close(); });
    return m;
  }
  function close() { $('cxModal').hidden = true; if (chart) { chart.destroy(); chart = null; } }

  /* ── 자료 모으기 ── */
  async function load(id) {
    const q = Kit.parseId(id), regs = await Kit.regions(), reg = regs.get(q.code) || [];
    const nowY = new Date().getFullYear();
    const [idx, kp, data] = await Promise.all([Data.index(q.code), Data.kapt(q.code), Data.loadYears(q.code, 2020, nowY)]);
    const sale = [], rent = [];
    Data.eachTrade(data.sale, k => k === q.key, (k, t) => sale.push(t));
    Data.eachTrade(data.rent, k => k === q.key, (k, t) => rent.push(t));
    const areas = new Map(); sale.concat(rent).forEach(t => areas.set(t.g, (areas.get(t.g) || 0) + 1));
    let g = +q.g;
    if (!areas.has(g) && areas.size) g = [...areas].sort((a, b) => b[1] - a[1])[0][0];
    const gid = `${q.code}|${q.key}#${g}`, rec = Tracking.has(gid) ? Tracking.rec(gid) : null;
    const anyRec = rec || [...areas.keys()].map(a => Tracking.has(`${q.code}|${q.key}#${a}`) ? Tracking.rec(`${q.code}|${q.key}#${a}`) : null).find(Boolean);
    const hhMan = anyRec && String(anyRec.households || '').trim() && !anyRec.hhAuto ? parseInt(anyRec.households, 10) : null;
    const hh = hhMan || (kp.m[q.key] ? kp.m[q.key][0] : null);
    const S = sale.filter(t => t.g === g).sort((a, b) => a.d - b.d), R = rent.filter(t => t.g === g).sort((a, b) => a.d - b.d);
    const real = S.filter(t => !t.direct), last = real[real.length - 1] || null, lastR = R[R.length - 1] || null;
    const { peak, trough } = Data.peakTrough(real);
    const d12 = +new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
    const n12 = S.filter(t => t.d >= d12).length;
    const qs = rec ? rec.quotes || {} : {}, ms = Object.keys(qs).map(Number).sort((a, b) => b - a);
    const qS = ms.find(m => qs[m] && qs[m].s != null), qR = ms.find(m => qs[m] && qs[m].r != null);
    const nowS = qS ? qs[qS].s : last ? last.price : null, nowR = qR ? qs[qR].r : (lastR && lastR.d >= d12 ? lastR.price : null);
    const land = Store.get('apt.land.v1', {});
    return { ...q, id: gid, g, sido: reg[1] || '', sgg: reg[2] || '', year: idx.c[q.key] || null, hh, hhAuto: !hhMan && !!hh, vl: Data.vlRat(kp, q.key), rec, areas,
      S, R, last, lastR, peak, trough, n12, qs, ms, qS, qR, nowS, nowR, land: !!land[gid] || Object.keys(land).some(k => k.startsWith(`${q.code}|${q.key}#`)),
      ratio: nowS && nowR ? nowR / nowS * 100 : null, gap: nowS && nowR ? nowS - nowR : null, drop: peak && nowS ? (nowS / peak.price - 1) * 100 : null };
  }

  /* ── 화면 ── */
  function render(c) {
    const age = c.year ? CONFIG.toAge(c.year) : null, link = U.landLink(c.sgg, c.dong, c.name);
    const kakao = `https://map.kakao.com/?q=${encodeURIComponent(`${c.sgg} ${c.dong} ${c.name}`)}`;
    const chips = [...c.areas].sort((a, b) => a[0] - b[0]).map(([g, n]) => `<button class="chip${g === c.g ? ' on' : ''}" data-cxg="${g}">${g}㎡ · ${CONFIG.toPyeong(g)}평 <b>${n}</b></button>`).join('');
    const turn = c.hh && c.n12 ? c.n12 / c.hh * 100 : null;
    const stat = (k, v, sub = '', sp = '') => `<div class="cxstat"><span>${k}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}${sp}</div>`;
    const mon = (arr, f) => { const out = [], t = new Date(); for (let i = 23; i >= 0; i--) { const d = new Date(t.getFullYear(), t.getMonth() - i, 1), ym = d.getFullYear() * 100 + d.getMonth() + 1, xs = arr.filter(z => Math.floor(z.d / 100) === ym); out.push(f(xs)); } return out; };
    const spS = CK.spark(mon(c.S.filter(t => !t.direct), xs => (xs.length ? xs.reduce((a, z) => a + z.price, 0) / xs.length : null))), spN = CK.spark(mon(c.S, xs => xs.length));
    const recent = c.S.map(t => ({ ...t, k: '매매' })).concat(c.R.map(t => ({ ...t, k: '전세' }))).sort((a, b) => b.d - a.d).slice(0, 20);
    const hist = c.ms.filter(m => c.qs[m] && (c.qs[m].s != null || c.qs[m].r != null)).slice(0, 12);
    $('cxBody').innerHTML = `
      <div class="cxhead"><div><h3>${c.land ? '<span title="랜드마크">★</span> ' : ''}${U.esc(c.name)}</h3>
        <p class="hint" style="margin:2px 0 0">${U.esc(c.sido)} ${U.esc(c.sgg)} ${U.esc(c.dong)} ${U.esc(c.jibun || '')} · ${c.year ? `${c.year}년 (${age}년차)` : '연식 모름'} · ${c.hh ? `${c.hh.toLocaleString()}세대${c.hhAuto ? ' <small>(자동)</small>' : ''}` : '세대수 모름'}${c.vl ? ` · 용적률 ${Math.round(c.vl)}%` : ''}${c.rec ? ` · 폴더: ${U.esc((c.rec.folders || []).join(', '))}` : ''}</p></div>
        <div class="cxbtns">${c.rec ? `<button data-cxa="table">시세트래킹 표에서 보기</button>` : `<button class="primary" data-cxa="add">시세트래킹에 담기</button>`}
          <a class="btn" href="${link}" target="_blank" rel="noopener">네이버 부동산</a><a class="btn" href="${kakao}" target="_blank" rel="noopener">카카오맵</a></div></div>
      <div class="chips cxareas">${chips || '<span class="hint">2020년 이후 거래가 없습니다.</span>'}</div>
      <div class="cxstats">
        ${stat('최근 매매 실거래', eok(c.last?.price), c.last ? U.date(c.last.d) + (c.last.floor ? ` · ${c.last.floor}층` : '') : '', spS)}
        ${stat('최근 전세 실거래', eok(c.lastR?.price), c.lastR ? U.date(c.lastR.d) : '')}
        ${stat('내 최신 호가', c.qS ? eok(c.qs[c.qS].s) : '-', c.qS ? Tracking.ymLabel(c.qS) + (c.qR ? ` · 전세 ${eok(c.qs[c.qR].r)}` : '') : c.rec ? '아직 안 적음' : '시세트래킹에 담으면 적을 수 있어요')}
        ${stat('전고점 (2020년~)', eok(c.peak?.price), c.peak ? U.date(c.peak.d) : '')}
        ${stat('전고점 대비', `<span class="${U.cls(c.drop)}">${pct(c.drop, 1)}</span>`, c.trough ? `전저점 ${eok(c.trough.price)} (${U.date(c.trough.d)})` : c.peak ? '🔥 신고가 중 (전고점 뒤 더 싼 거래 없음)' : '')}
        ${stat('전세가율', c.ratio == null ? '-' : c.ratio.toFixed(0) + '%', c.gap == null ? '' : `투자금 ${eok(c.gap)}`)}
        ${stat('1년 매매 거래', `${c.n12}건`, turn == null ? (c.hh ? '' : '세대수를 알면 회전율 계산') : `회전율 ${turn.toFixed(1)}% (세대수 대비)`, spN)}
      </div>
      ${c.S.length || c.R.length ? '<div class="cxchartbar"><span class="hint" style="margin:0">점 = 실거래 · 굵은 선 = 3개월 평균 · 파란 선 = 내 호가 · 빨간 점선 = 전고점</span><span class="ckrange" id="cxRange"></span></div><div class="cxchart"><canvas id="cxChart"></canvas></div>' : ''}
      <div class="cxcols">
        <div><h4>최근 거래 ${recent.length}건</h4><div class="tablewrap short"><table class="grid"><thead><tr><th>계약일</th><th>구분</th><th>층</th><th>가격</th><th></th></tr></thead><tbody>${recent.map(t => `<tr class="${t.direct ? 'dim' : ''}"><td>${U.date(t.d)}</td><td>${t.k}</td><td>${t.floor ?? ''}</td><td class="${t.k === '매매' ? 'sale' : 'rent'}">${eok(t.price)}</td><td>${t.direct ? '직거래' : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="hint">거래 없음</td></tr>'}</tbody></table></div></div>
        <div><h4>내 기록</h4>${c.rec ? `<label class="cxmemo">메모 <textarea id="cxMemo" rows="3" placeholder="임장 소감, 중개사 통화 내용 등">${U.esc(c.rec.memo || '')}</textarea></label><button data-cxa="memo">메모 저장</button>
          <div class="tablewrap short" style="margin-top:8px"><table class="grid"><thead><tr><th>달</th><th>매매 호가</th><th>전세 호가</th></tr></thead><tbody>${hist.map(m => `<tr><td>${Tracking.ymLabel(m)}</td><td>${eok(c.qs[m].s)}</td><td>${eok(c.qs[m].r)}</td></tr>`).join('') || '<tr><td colspan="3" class="hint">적은 호가 없음</td></tr>'}</tbody></table></div>`
          : '<p class="hint">시세트래킹에 담으면 메모와 호가를 적을 수 있습니다.</p>'}</div>
      </div>
      <div class="cxsim" id="cxSim"><h4>비슷한 단지</h4><div id="cxSimCtl"></div><div id="cxSimOut" class="hint">찾는 중…</div></div>`;
    const yrs = $('cxRange') ? CK.range($('cxRange'), 'cx', (y) => drawChart(c, y)) : null;
    drawChart(c, yrs);
  }
  function drawChart(c, years) {
    if (chart) { chart.destroy(); chart = null; }
    if (typeof Chart === 'undefined' || !$('cxChart') || (!c.S.length && !c.R.length)) return;
    const S = CK.C.sale(), R = CK.C.rent(), Q = CK.C.quote();
    const now = new Date(), minX = years ? now.getFullYear() + now.getMonth() / 12 - years : -Infinity;
    const pts = (a) => a.map(t => ({ x: x(t.d), y: t.price / 10000, t })).filter(p => p.x >= minX);
    const sale = pts(c.S.filter(t => !t.direct)), rent = pts(c.R);
    const sets = [
      { label: '매매 실거래', data: sale, backgroundColor: CK.alpha(S, .45), borderColor: 'transparent', pointRadius: 3, ckNoEnd: true },
      { label: '매매(직거래)', data: pts(c.S.filter(t => t.direct)), backgroundColor: CK.alpha(S, .18), borderColor: 'transparent', pointRadius: 3, pointStyle: 'triangle', ckNoEnd: true },
      { label: '전세 실거래', data: rent, backgroundColor: CK.alpha(R, .45), borderColor: 'transparent', pointRadius: 2.5, ckNoEnd: true },
      { label: '매매 3개월 평균', data: CK.ma(sale, 'year'), showLine: true, borderColor: S, backgroundColor: S, pointRadius: 0, borderWidth: 2.5, endLabel: '매매' },
      { label: '전세 3개월 평균', data: CK.ma(rent, 'year'), showLine: true, borderColor: R, backgroundColor: R, pointRadius: 0, borderWidth: 2.5, endLabel: '전세' }];
    const qm = [...c.ms].filter(m => c.qs[m] && c.qs[m].s != null).sort((a, b) => a - b).map(m => ({ x: Math.floor(m / 100) + (m % 100 - 1) / 12 + .5 / 12, y: c.qs[m].s / 10000 })).filter(p => p.x >= minX);
    if (qm.length) sets.push({ label: '내 호가', data: qm, showLine: true, borderColor: Q, backgroundColor: Q, pointRadius: 4, pointBorderColor: CK.C.panel(), pointBorderWidth: 2, tension: 0, endLabel: '호가' });
    const fmtX = (v) => (Number.isInteger(v) ? v + '년' : '');
    chart = new Chart($('cxChart'), { type: 'scatter', data: { datasets: sets.filter(d => d.data.length) },
      options: { responsive: true, maintainAspectRatio: false,
        scales: { x: { min: years ? Math.floor(minX * 4) / 4 : undefined, ticks: { callback: fmtX, stepSize: years === 1 ? .25 : 1 } }, y: { ticks: { callback: (v) => v + '억' } } },
        plugins: { ckPeak: c.peak ? [{ y: c.peak.price / 10000, text: `전고점 ${U.price(c.peak.price)} · ${U.date(c.peak.d)}` }] : [], ckEnd: { unit: '억', dec: 2 },
          legend: { labels: { filter: (it) => !/직거래/.test(it.text) } },
          tooltip: { callbacks: { label: (it) => { const t = it.raw.t; return t ? `${it.dataset.label} ${U.date(t.d)} ${U.price(t.price)}${t.floor ? ` · ${t.floor}층` : ''}` : `${it.dataset.label} ${it.raw.y.toFixed(2)}억`; } } } } } });
  }

  /* ── 비슷한 단지 ── */
  const simOpts = () => ({ ...DEF, ...Store.get(SIM, {}) });
  async function sums(scope, c) {
    const regs = await Kit.regions(), all = [...new Set([...regs.keys()].map(k => k.slice(0, 2)))], sd = c.code.slice(0, 2);
    const zone = CONFIG.zoneOf(c.sido);
    const list = scope === 'sgg' || scope === 'sido' ? [sd] : scope === 'zone' ? (ZONE_SD[zone] || all.filter(s => !['11', '41', '28', '26', '27', '29', '30', '31'].includes(s))) : all;
    const out = [];
    for (const s of list) { if (!sumCache.has(s)) sumCache.set(s, Data.cx(s)); const j = await sumCache.get(s); if (j && j.rows) out.push(...j.rows); }
    const sidoOf = (code) => (regs.get(code) || [])[1] || '';
    const rows = scope === 'sgg' ? out.filter(r => r[0] === c.code) : scope === 'sido' ? out.filter(r => sidoOf(r[0]) === c.sido)
      : scope === 'zone' ? out.filter(r => CONFIG.zoneOf(sidoOf(r[0])) === zone) : out;
    return { rows, ok: list.some(s => sumCache.has(s)), any: rows.length > 0 };
  }
  async function similar(c, n) {
    const o = simOpts(), ctl = $('cxSimCtl'), outEl = $('cxSimOut');
    ctl.innerHTML = `<div class="filters cxsimctl">
      <label>범위 <select data-sim="scope"><option value="sgg">같은 구</option><option value="sido">같은 시·도</option><option value="zone">같은 권역</option><option value="all">전국</option></select></label>
      <label class="inline"><input type="checkbox" data-sim="price"> 가격 ±<input type="number" data-sim="pp" min="3" max="50" style="width:52px">%</label>
      <label class="inline"><input type="checkbox" data-sim="area"> 평형 ±<input type="number" data-sim="ap" min="1" max="30" style="width:48px">㎡</label>
      <label class="inline"><input type="checkbox" data-sim="year"> 연식 ±<input type="number" data-sim="yp" min="1" max="20" style="width:48px">년</label>
      <label class="inline"><input type="checkbox" data-sim="hh"> 세대 규모 같음</label>
      <label class="inline"><input type="checkbox" data-sim="ratio"> 전세가율 ±<input type="number" data-sim="rp" min="1" max="30" style="width:48px">%p</label>
      <label class="inline"><input type="checkbox" data-sim="unknownHH"> 세대수 모르는 단지도 포함</label></div>`;
    ctl.querySelectorAll('[data-sim]').forEach(el => { const k = el.dataset.sim; if (el.type === 'checkbox') el.checked = !!o[k]; else el.value = o[k]; });
    const baseS = c.last ? c.last.price : null, baseR = c.lastR ? c.lastR.price : null, baseRatio = baseS && baseR ? baseR / baseS * 100 : null;
    if (o.price && !baseS) { outEl.innerHTML = '이 평형은 최근 매매 실거래가 없어 가격으로 견줄 수 없습니다. 가격 조건을 끄고 찾아 보세요.'; return; }
    outEl.textContent = '찾는 중…';
    const { rows, any } = await sums(o.scope, c);
    if (!any) { outEl.innerHTML = '아직 단지 요약 파일이 없습니다. 자동 수집이 한 번 돌면 생깁니다. (Actions → 실거래가 자동 수집 → Run workflow)'; return; }
    const bb = hhBand(c.hh), res = [];
    for (const r of rows) {
      const [code, key, g, year, hh, sale, saleD, rent, peak, n12] = r;
      if (code === c.code && key === c.key) continue;
      const ratio = sale && rent ? rent / sale * 100 : null;
      let sc = 0;
      if (o.price) { const d = Math.abs(sale / baseS - 1) * 100; if (d > o.pp) continue; sc += d / o.pp; }
      if (o.area) { const d = Math.abs(g - c.g); if (d > o.ap) continue; sc += d / o.ap; }
      if (o.year) { if (!year || !c.year) continue; const d = Math.abs(year - c.year); if (d > o.yp) continue; sc += d / o.yp; }
      if (o.hh && bb != null) { if (!hh) { if (!o.unknownHH) continue; sc += .5; } else if (hhBand(hh) !== bb) continue; else sc += Math.abs(Math.log(hh / c.hh)) / Math.log(3); }
      if (o.ratio && baseRatio != null) { if (ratio == null) continue; const d = Math.abs(ratio - baseRatio); if (d > o.rp) continue; sc += d / o.rp; }
      if (!n12) sc += .3;                                       // 1년 거래가 없으면 살짝 뒤로
      res.push({ code, key, g, year, hh, sale, saleD, ratio, drop: peak ? (sale / peak - 1) * 100 : null, n12, sc });
    }
    res.sort((a, b) => a.sc - b.sc);
    const top = res.slice(0, n), regs = await Kit.regions();
    if (!top.length) { outEl.innerHTML = '조건에 맞는 단지가 없습니다. 범위를 넓히거나 조건을 줄여 보세요.'; return; }
    const diff = (r) => [o.price && baseS ? `가격 ${pct((r.sale / baseS - 1) * 100)}` : '', r.year && c.year && r.year !== c.year ? `연식 ${r.year - c.year > 0 ? '+' : ''}${r.year - c.year}년` : '', r.g !== c.g ? `평형 ${r.g - c.g > 0 ? '+' : ''}${r.g - c.g}㎡` : ''].filter(Boolean).join(' · ');
    outEl.innerHTML = `<p class="hint" style="margin:0 0 6px">기준: ${c.g}㎡ · 최근 매매 ${eok(baseS)} · ${c.year || '연식 모름'}년 · ${c.hh ? HHB[bb] : '세대수 모름'} — 조건에 맞는 ${res.length.toLocaleString()}곳 중 가까운 순 ${top.length}곳</p>
      <div class="tablewrap short"><table class="grid"><thead><tr><th class="l">단지</th><th>평형</th><th>연식</th><th>세대수</th><th>최근 매매</th><th>전세가율</th><th>전고 대비</th><th>1년 거래</th><th class="l">기준과 차이</th><th></th></tr></thead><tbody>` +
      top.map(r => { const p = Data.parseKey(r.key), rg = regs.get(r.code) || [], id = `${r.code}|${r.key}#${r.g}`;
        return `<tr><td class="l"><a href="#" class="cxlink" data-cx="${U.esc(id)}">${U.esc(p.name)}</a><br><small>${U.esc(rg[2] || '')} ${U.esc(p.dong)}</small></td><td>${r.g}㎡<small>${CONFIG.toPyeong(r.g)}평</small></td><td>${r.year || '-'}</td><td>${r.hh ? r.hh.toLocaleString() : '-'}</td>` +
          `<td class="sale">${eok(r.sale)}<small>${U.date(r.saleD)}</small></td><td>${r.ratio == null ? '-' : r.ratio.toFixed(0) + '%'}</td><td class="${U.cls(r.drop)}">${pct(r.drop, 1)}</td><td>${r.n12}건</td><td class="l"><small>${diff(r)}</small></td>` +
          `<td>${Tracking.has(id) ? '<span class="hint" style="margin:0">담김</span>' : `<button class="mini" data-cxa="addsim" data-id="${U.esc(id)}">담기</button>`}</td></tr>`; }).join('') + '</tbody></table></div>' +
      (n < 10 && res.length > n ? '<button data-cxa="more" style="margin-top:6px">10곳 보기</button>' : '');
  }

  /* ── 동작 ── */
  async function act(e) {
    const g = e.target.closest('[data-cxg]'); if (g) return open(`${cur.code}|${cur.key}#${g.dataset.cxg}`, { keepSim: true });
    const b = e.target.closest('[data-cxa]'); if (!b) return;
    const a = b.dataset.cxa;
    if (a === 'add') { Tracking.add([{ id: cur.id, code: cur.code, key: cur.key, dong: cur.dong, jibun: cur.jibun, name: cur.name, g: cur.g, sido: cur.sido, sgg: cur.sgg, buildYear: cur.year }]); return open(cur.id); }
    if (a === 'addsim') { const id = b.dataset.id, q = Kit.parseId(id), regs = await Kit.regions(), rg = regs.get(q.code) || [], idx = await Data.index(q.code);
      Tracking.add([{ ...q, id, sido: rg[1] || '', sgg: rg[2] || '', buildYear: idx.c[q.key] || null }]); b.outerHTML = '<span class="hint" style="margin:0">담김</span>'; return; }
    if (a === 'table') { close(); App.showTab('tracking'); setTimeout(() => Tracking.focus(cur.id), 250); return; }
    if (a === 'memo') { Tracking.setField(cur.id, 'memo', $('cxMemo').value.trim()); U.toast('메모를 저장했습니다.'); return; }
    if (a === 'more') return similar(cur, 10);
  }
  function onChange(e) {
    const el = e.target.closest('[data-sim]'); if (!el) return;
    const o = simOpts(), k = el.dataset.sim; o[k] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.tagName === 'SELECT' ? el.value : Math.max(1, +el.value || DEF[k]);
    Store.set(SIM, o); similar(cur, 10);
  }

  /** 열기. opt.sim = true 면 비슷한 단지 쪽으로 바로 내려감 */
  async function open(id, opt = {}) {
    const m = modal(); m.hidden = false;
    if (!opt.keepSim) $('cxBody').innerHTML = '<p class="hint">불러오는 중…</p>';
    try { cur = await load(id); } catch (err) { $('cxBody').innerHTML = `<p class="hint">불러오지 못했습니다: ${U.esc(err.message || String(err))}</p>`; return; }
    render(cur);
    $('cxModal').querySelector('.modalbox').scrollTop = 0;
    await similar(cur, opt.sim ? 10 : 5);
    if (opt.sim) $('cxSim').scrollIntoView({ block: 'start' });
  }
  function init() {
    // 어디서든 data-cx 가 붙은 단지 이름을 누르면 열림 (다른 클릭 동작보다 먼저)
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-cx]'); if (!a) return;
      e.preventDefault(); e.stopPropagation(); open(a.dataset.cx, { sim: a.dataset.cxSim === '1' });
    }, true);
  }
  return { init, open };
})();
