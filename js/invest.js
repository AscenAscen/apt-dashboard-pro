/* ─────────────────────────────────────────────────────────
   invest.js — 투자금 탭: 지역별·월별 전용 84 / 59 평균 매매가 · 전세가 · 투자금
   투자금 = 평균 매매가 − 평균 전세가 (취득세·중개료·대출 제외, 순수 차액)
   평형은 러프하게 묶음 (전용 59 = 55~62㎡, 전용 84 = 80~86㎡). 직거래는 제외.
   ───────────────────────────────────────────────────────── */
const Invest = (() => {
  const $ = (id) => document.getElementById(id);
  const SIZES = [{ k: 59, lo: 55, hi: 62 }, { k: 84, lo: 80, hi: 86 }];
  let regions = [], inited = false, rows = [], title = '', seq = 0;

  async function init() {
    if (inited) return; inited = true;
    regions = await Data.regions();
    const sidos = [...new Set(regions.map(r => r[1]))];
    $('ivSido').innerHTML = sidos.map(x => `<option>${U.esc(x)}</option>`).join('');
    const saved = Store.get('apt.lastRegion', null);
    if (saved && sidos.includes(saved.sido)) $('ivSido').value = saved.sido;
    const fillSgg = (code) => {
      const list = regions.filter(r => r[1] === $('ivSido').value);
      $('ivSgg').innerHTML = list.map(r => `<option value="${r[0]}">${U.esc(r[2])}</option>`).join('');
      if (code && list.some(r => r[0] === code)) $('ivSgg').value = code;
    };
    fillSgg(saved?.code);
    $('ivSido').onchange = () => fillSgg();
    $('btnIv').onclick = run;
    $('btnIvExcel').onclick = excel;
    // 여러 지역 한눈에: 범위(시/도 또는 전국) · 기준 월
    $('ivmScope').innerHTML = '<option value="">전국</option>' + sidos.map(x => `<option ${saved?.sido === x ? 'selected' : ''}>${U.esc(x)}</option>`).join('');
    const now = new Date(), ms = [];
    for (let i = 0; i < 24; i++) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); ms.push(d.getFullYear() * 100 + d.getMonth() + 1); }
    $('ivmMonth').innerHTML = ms.map((m, i) => `<option value="${m}" ${i === 1 ? 'selected' : ''}>${lab(m)}${i === 0 ? ' (이번 달, 신고 진행 중)' : ''}</option>`).join('');
    $('btnIvm').onclick = runMany;
    $('btnIvmExcel').onclick = excelMany;
    $('ivmOut').onclick = (e) => {
      const th = e.target.closest('th[data-sort]');
      if (th) { const k = th.dataset.sort; sortBy = sortBy === k ? '-' + k : k; return renderMany(); }
      const tr = e.target.closest('tr[data-code]');
      if (tr) { const r = regions.find(x => x[0] === tr.dataset.code); $('ivSido').value = r[1]; $('ivSido').onchange(); $('ivSgg').value = r[0]; run(); $('ivOut').scrollIntoView({ behavior: 'smooth' }); }
    };
  }

  /* ── 여러 지역 한눈에 (기준 월 1개, 지역마다 한 줄) ── */
  let many = [], manyTitle = '', sortBy = '-84.inv';
  async function runMany() {
    const my = ++seq, scope = $('ivmScope').value, m = +$('ivmMonth').value, mons = +$('ivmSpan').value, y = Math.floor(m / 100);
    const fromD = new Date(y, m % 100 - mons, 1), fromYm = fromD.getFullYear() * 100 + fromD.getMonth() + 1;
    const list = regions.filter(r => !scope || r[1] === scope);
    many = []; let done = 0;
    const step = async (r) => {
      const data = await Data.loadYears(r[0], Math.floor(fromYm / 100), y);
      if (my !== seq) return;
      const rows = calc(data, fromYm, m), agg = { code: r[0], sido: r[1], sgg: r[2] };
      // 기간 안 여러 달이면 거래를 합친 평균이 되도록 다시 계산
      for (const sz of SIZES) {
        let ss = 0, sn = 0, rs = 0, rn = 0;
        for (const x of rows) { const c = x[sz.k]; if (c.sale != null) { ss += c.sale * c.ns; sn += c.ns; } if (c.rent != null) { rs += c.rent * c.nr; rn += c.nr; } }
        const sa = sn ? ss / sn : null, ra = rn ? rs / rn : null;
        agg[sz.k] = { sale: sa, rent: ra, ns: sn, nr: rn, inv: sa != null && ra != null ? sa - ra : null };
      }
      many.push(agg);
      done++; $('ivmOut').innerHTML = `<p class="hint">불러오는 중… ${done} / ${list.length} 지역</p>`;
    };
    const q = [...list];
    await Promise.all(Array.from({ length: 6 }, async () => { while (q.length) { const r = q.shift(); try { await step(r); } catch (e) { console.error(e); done++; } } }));
    if (my !== seq) return;
    if (typeof Market !== 'undefined' && Market.kbStatOf) for (const r of many) {      // KB 주간 신호 붙이기 (KB 에 있는 지역만)
      const k = await Market.kbStatOf(r.sido, r.sgg);
      r.kb = k ? { s4: k.s?.w4 ?? null, r4: k.r?.w4 ?? null, gap: k.s && k.r ? +(k.r.w4 - k.s.w4).toFixed(2) : null } : { s4: null, r4: null, gap: null };
    }
    manyTitle = `${scope || '전국'} · ${mons > 1 ? `${lab(fromYm)}~${lab(m)} (${mons}개월)` : lab(m)}`;
    renderMany();
  }
  const getK = (r, k) => { const [sz, f] = k.replace('-', '').split('.'); return f ? r[sz]?.[f] ?? null : r[sz]; };
  function renderMany() {
    if (!many.length) { $('ivmOut').innerHTML = '<p class="empty">자료가 있는 지역이 없습니다.</p>'; return; }
    const desc = sortBy.startsWith('-'), key = sortBy.replace('-', '');
    const rows = [...many].sort((a, b) => {
      if (key === 'name') return (a.sido + a.sgg).localeCompare(b.sido + b.sgg, 'ko') * (desc ? -1 : 1);
      const x = getK(a, key), y2 = getK(b, key);
      if (x == null && y2 == null) return 0; if (x == null) return 1; if (y2 == null) return -1;
      return desc ? y2 - x : x - y2;
    });
    const order = SIZES.slice().reverse(), arrow = (k) => (key === k ? (desc ? ' ▼' : ' ▲') : '');
    const th = (k, t) => `<th data-sort="${k}" style="cursor:pointer" title="눌러서 정렬">${t}${arrow(k)}</th>`;
    const hasKb = many.some(r => r.kb && (r.kb.s4 != null || r.kb.r4 != null));
    const pct = (v) => v == null ? '<td class="none">·</td>' : `<td class="r ${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v > 0 ? '+' : ''}${v.toFixed(2)}%</td>`;
    const head = `<thead><tr><th rowspan="2" data-sort="name" style="cursor:pointer">지역${arrow('name')}</th>` + order.map(s => `<th colspan="3">전용 ${s.k}㎡</th>`).join('') + (hasKb ? '<th colspan="3" title="KB 주간 지수 최근 4주 변동률">KB 최근 4주</th>' : '') + '</tr><tr>' +
      order.map(s => th(s.k + '.sale', '평균 매매가') + th(s.k + '.rent', '평균 전세가') + th(s.k + '.inv', '투자금')).join('') +
      (hasKb ? th('kb.s4', '매매') + th('kb.r4', '전세') + th('kb.gap', '전세 강세') : '') + '</tr></thead>';
    const body = rows.map(r => `<tr data-code="${r.code}" style="cursor:pointer" title="눌러서 이 지역 월별 보기"><td class="l">${$('ivmScope').value ? '' : U.esc(r.sido) + ' '}${U.esc(r.sgg)}</td>${order.map(s => cell(r[s.k], true)).join('')}${hasKb ? pct(r.kb?.s4) + pct(r.kb?.r4) + pct(r.kb?.gap) : ''}</tr>`).join('');
    const none = many.filter(r => SIZES.every(s => !r[s.k].ns && !r[s.k].nr)).length;
    $('ivmOut').innerHTML = `<div class="bar"><strong>${U.esc(manyTitle)}</strong><span class="hint" style="margin:0">— ${many.length}개 지역${none ? ` (거래 없음 ${none}곳)` : ''} · 머리글을 누르면 정렬, 줄을 누르면 아래에 그 지역 월별 표${hasKb ? ' · KB 전세 강세가 플러스면 전세가 더 빨리 올라 투자금이 줄어드는 지역 (KB 에 없는 군 단위는 ·)' : ''}</span></div><div class="tablewrap"><table class="data" id="ivmTable">${head}<tbody>${body}</tbody></table></div>`;
  }
  function excelMany() {
    if (!many.length) return U.toast('먼저 [한눈에 보기]를 눌러 주세요.');
    const order = SIZES.slice().reverse(), rd = (v) => v == null ? '' : Math.round(v);
    const out = [['시/도', '시/군/구', ...order.flatMap(s => [`${s.k}㎡ 평균 매매가(만원)`, `${s.k}㎡ 매매 건수`, `${s.k}㎡ 평균 전세가(만원)`, `${s.k}㎡ 전세 건수`, `${s.k}㎡ 투자금(만원)`]), 'KB 매매 4주(%)', 'KB 전세 4주(%)', 'KB 전세 강세(%p)']];
    for (const r of many) out.push([r.sido, r.sgg, ...order.flatMap(s => { const c = r[s.k]; return [rd(c.sale), c.ns, rd(c.rent), c.nr, rd(c.inv)]; }), r.kb?.s4 ?? '', r.kb?.r4 ?? '', r.kb?.gap ?? '']);
    U.download(`투자금_지역별_${manyTitle.replace(/[\s·~()]+/g, '_')}_${U.stamp()}`, [{ name: '지역별 투자금', rows: out }], 'xlsx');
  }

  const avg = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  const ym = (d) => Math.floor(d / 100);                         // YYYYMMDD → YYYYMM
  const lab = (m) => `${Math.floor(m / 100)}.${String(m % 100).padStart(2, '0')}`;
  const eok = (v) => v == null ? '<span class="hint" style="margin:0">거래 없음</span>' : U.price(v);

  /** 월 × 평형별 { sale:[가격…], rent:[가격…] } 로 모은 뒤 평균·투자금 계산 (순수 계산 — 테스트용으로 공개) */
  function calc(data, fromYm, toYm) {
    const bucket = new Map();
    const get = (m, k) => { const key = m + '|' + k; if (!bucket.has(key)) bucket.set(key, { sale: [], rent: [] }); return bucket.get(key); };
    for (const kind of ['sale', 'rent']) {
      Data.eachTrade(data[kind] || {}, null, (key, t) => {
        if (t.direct) return;
        const m = ym(t.d); if (m < fromYm || m > toYm) return;
        const sz = SIZES.find(s => t.area >= s.lo && t.area < s.hi + 1);
        if (!sz) return;
        get(m, sz.k)[kind].push(t.price);
      });
    }
    const months = [...new Set([...bucket.keys()].map(k => +k.split('|')[0]))].sort((a, b) => b - a);
    return months.map(m => {
      const row = { m };
      for (const s of SIZES) {
        const b = bucket.get(m + '|' + s.k) || { sale: [], rent: [] };
        const sa = avg(b.sale), ra = avg(b.rent);
        row[s.k] = { sale: sa, rent: ra, ns: b.sale.length, nr: b.rent.length, inv: sa != null && ra != null ? sa - ra : null };
      }
      return row;
    });
  }

  async function run() {
    const code = $('ivSgg').value; if (!code) return;
    const my = ++seq, yrs = +$('ivYears').value, now = new Date(), y = now.getFullYear();
    $('ivOut').innerHTML = '<p class="hint">불러오는 중…</p>';
    const data = await Data.loadYears(code, y - yrs + 1, y);
    if (my !== seq) return;
    const fromYm = (y - yrs + 1) * 100 + 1, toYm = y * 100 + 12;
    rows = calc(data, fromYm, toYm);
    const r = regions.find(x => x[0] === code); title = `${r[1]} ${r[2]}`;
    Store.set('apt.lastRegion', { sido: r[1], code });
    render();
  }

  function cell(c, strong) {
    return `<td class="r">${eok(c.sale)}<small class="hint" style="margin:0"> ${c.ns ? c.ns + '건' : ''}</small></td><td class="r">${eok(c.rent)}<small class="hint" style="margin:0"> ${c.nr ? c.nr + '건' : ''}</small></td><td class="r"${strong ? ' style="font-weight:700"' : ''}>${c.inv == null ? '<span class="hint" style="margin:0">-</span>' : U.price(c.inv)}</td>`;
  }
  function render() {
    if (!rows.length) { $('ivOut').innerHTML = '<p class="empty">이 기간에 전용 59·84㎡ 거래가 없습니다.</p>'; return; }
    const head = '<thead><tr><th rowspan="2">월</th>' + SIZES.slice().reverse().map(s => `<th colspan="3">전용 ${s.k}㎡</th>`).join('') + '</tr><tr>' + SIZES.map(() => '<th>평균 매매가</th><th>평균 전세가</th><th>투자금</th>').join('') + '</tr></thead>';
    const order = SIZES.slice().reverse();
    const body = rows.map(r => `<tr><td>${lab(r.m)}</td>${order.map(s => cell(r[s.k], true)).join('')}</tr>`).join('');
    $('ivOut').innerHTML = `<div class="bar"><strong>${U.esc(title)}</strong><span class="hint" style="margin:0">— 직거래 제외 · 투자금 = 평균 매매가 − 평균 전세가 · 단위 만원(억)</span></div><div class="tablewrap"><table class="data" id="ivTable">${head}<tbody>${body}</tbody></table></div>`;
  }
  function excel() {
    if (!rows.length) return U.toast('먼저 [조회]를 눌러 주세요.');
    const order = SIZES.slice().reverse();
    const out = [['월', ...order.flatMap(s => [`${s.k}㎡ 평균 매매가(만원)`, `${s.k}㎡ 매매 건수`, `${s.k}㎡ 평균 전세가(만원)`, `${s.k}㎡ 전세 건수`, `${s.k}㎡ 투자금(만원)`])]];
    for (const r of rows) out.push([lab(r.m), ...order.flatMap(s => { const c = r[s.k]; const rd = (v) => v == null ? '' : Math.round(v); return [rd(c.sale), c.ns, rd(c.rent), c.nr, rd(c.inv)]; })]);
    U.download(`투자금_${title.replace(/\s/g, '_')}_${U.stamp()}`, [{ name: '투자금', rows: out }], 'xlsx');
  }
  const open = () => { init(); if (typeof Monthly !== 'undefined') Monthly.open(); };
  return { open, calc, run, runMany };
})();
