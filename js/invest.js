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
  const open = () => init();
  return { open, calc, run };
})();
