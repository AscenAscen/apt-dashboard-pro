/* ─────────────────────────────────────────────────────────
   trends.js — [지역 동향] 탭
   한 시/군/구의 2020년 이후 실거래로
     ① 월별 거래량 흐름  ② 신고가 거래  ③ 전고점 대비 크게 내린 거래
   를 찾아 보여 줍니다.
   ───────────────────────────────────────────────────────── */
const Trends = (() => {
  const $ = (id) => document.getElementById(id);
  const DROP_MIN = 10;      // 전고점 대비 몇 % 이상 내린 거래를 "하락 거래"로 볼지
  const MAX_LIST = 300;     // 표에 보여 줄 최대 줄 수
  let regions = [], chart = null, last = null;

  async function init() {
    regions = await Data.regions();
    const sidos = [...new Set(regions.map(r => r[1]))];
    $('trSido').innerHTML = sidos.map(x => `<option>${U.esc(x)}</option>`).join('');
    const saved = Store.get('apt.lastRegion', null);
    if (saved && sidos.includes(saved.sido)) $('trSido').value = saved.sido;
    const fillSgg = (code) => {
      const list = regions.filter(r => r[1] === $('trSido').value);
      $('trSgg').innerHTML = list.map(r => `<option value="${r[0]}">${U.esc(r[2])}</option>`).join('');
      if (code && list.some(r => r[0] === code)) $('trSgg').value = code;
    };
    fillSgg(saved?.code);
    $('trSido').onchange = () => fillSgg();
    $('btnTrends').onclick = run;
    $('btnTrendsExcel').onclick = excel;
  }

  const inSize = (g, size) => size === 'all' || (size === 'p59' ? g >= 55 && g <= 62 : size === 'p84' ? g >= 80 && g <= 86 : size === 'p114' ? g >= 100 : size === 's' ? g < 60 : size === 'm' ? g >= 60 && g <= 85 : g > 85);
  const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  let chart2 = null;

  async function run() {
    const code = $('trSgg').value;
    const reg = regions.find(r => r[0] === code);
    if (!reg) return;
    const btn = $('btnTrends');
    btn.disabled = true; btn.textContent = '불러오는 중…';
    try {
      const idx = await Data.index(code);
      const now = new Date();
      const data = await Data.loadYears(code, Math.floor(CONFIG.PEAK_FROM / 10000), now.getFullYear());
      const size = $('trSize').value, months = +$('trDays').value;
      const fromD = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
      const from = fromD.getFullYear() * 10000 + (fromD.getMonth() + 1) * 100 + fromD.getDate();

      // 월별 거래량
      const vol = new Map();   // ym → [매매, 전세]
      const bump = (t, i) => { const ym = Math.floor(t.d / 100); if (!vol.has(ym)) vol.set(ym, [0, 0]); vol.get(ym)[i]++; };
      const per = new Map();   // ym → { s:[매매 ㎡당], r:[전세 ㎡당], n: 이전 최고가가 있는 매매 수, h: 그중 신고가 수 }
      const mon = (ym) => { if (!per.has(ym)) per.set(ym, { s: [], r: [], n: 0, h: 0 }); return per.get(ym); };
      const unit = (t, i) => { const a = t.area || t.g; if (a > 0) mon(Math.floor(t.d / 100))[i ? 'r' : 's'].push(t.price / a); };
      // 단지·평형별 매매(직거래 제외) 날짜순
      const groups = new Map();
      Data.eachTrade(data.sale, null, (key, t) => {
        if (!inSize(t.g, size) || t.d < CONFIG.PEAK_FROM) return;
        bump(t, 0);
        if (!t.direct) unit(t, 0);
        if (t.direct) return;
        const id = key + '#' + t.g;
        if (!groups.has(id)) groups.set(id, { key, g: t.g, list: [] });
        groups.get(id).list.push(t);
      });
      Data.eachTrade(data.rent, null, (key, t) => { if (inSize(t.g, size) && t.d >= CONFIG.PEAK_FROM) { bump(t, 1); unit(t, 1); } });

      const highs = [], lows = [];
      for (const grp of groups.values()) {
        grp.list.sort((a, b) => a.d - b.d);
        let peak = null;
        for (const t of grp.list) {
          if (peak) { const mm = mon(Math.floor(t.d / 100)); mm.n++; if (t.price > peak.price) mm.h++; }
          if (peak && t.d >= from) {
            const pct = (t.price / peak.price - 1) * 100;
            const row = { ...Data.parseKey(grp.key), key: grp.key, g: grp.g, t, peak, pct, buildYear: idx.c[grp.key] || null, code, sido: reg[1], sgg: reg[2] };
            if (t.price > peak.price) highs.push(row);
            else if (pct <= -DROP_MIN) lows.push(row);
          }
          if (!peak || t.price >= peak.price) peak = t;
        }
      }
      highs.sort((a, b) => b.t.d - a.t.d || b.pct - a.pct);
      lows.sort((a, b) => a.pct - b.pct);
      const recentSale = [...vol.entries()].filter(([ym]) => ym >= Math.floor(from / 100)).reduce((s, [, v]) => s + v[0], 0);
      last = { reg, size, months, vol, highs, lows };

      if (!vol.size) {
        $('trBody').hidden = true; $('trEmpty').hidden = false;
        $('trEmpty').innerHTML = `<b>${U.esc(reg[1])} ${U.esc(reg[2])}</b> 은(는) 조건에 맞는 2020년 이후 자료가 아직 없습니다.`;
        return;
      }
      $('trEmpty').hidden = true; $('trBody').hidden = false;
      const sizeName = $('trSize').selectedOptions[0].textContent;
      $('trTitle').textContent = `${reg[1]} ${reg[2]} · ${sizeName} · 월별 거래량 (2020년~)`;
      const card = (k, v, s2 = '') => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s2}</div></div>`;
      const total = highs.length + lows.length;
      $('trCards').innerHTML = [
        card(`최근 ${months}개월 매매`, recentSale.toLocaleString() + '건', '직거래 포함'),
        card('신고가 거래', highs.length.toLocaleString() + '건', '이전 최고가 경신'),
        card(`전고점 대비 -${DROP_MIN}% 이하`, lows.length.toLocaleString() + '건'),
        card('신고가 비중', total ? Math.round(highs.length / total * 100) + '%' : '-', '신고가 ÷ (신고가 + 하락 거래)'),
      ].join('');
      drawChart(vol);
      table('trHigh', highs, true);
      table('trLow', lows, false);
      extras({ reg, code, per, groups, from, fromD, months });
    } finally {
      btn.disabled = false; btn.textContent = '보기';
    }
  }

  /* ── 추가 분석: 전세가율·신고가 비율 추이, 오른·내린 단지, 구별 비교 ── */
  async function extras({ reg, code, per, groups, from, fromD, months }) {
    const css = getComputedStyle(document.documentElement), col = (n) => css.getPropertyValue(n).trim();
    // ① 월별 추이 (최근 36개월)
    const yms = [...per.keys()].sort((a, b) => a - b).slice(-36);
    const rowsM = yms.map(ym => { const m = per.get(ym), ms = median(m.s), mr = median(m.r); return { ym, ratio: ms && mr && m.s.length >= 3 && m.r.length >= 3 ? mr / ms * 100 : null, high: m.n >= 5 ? m.h / m.n * 100 : null, ns: m.s.length, nr: m.r.length, h: m.h, n: m.n }; });
    const lab = (ym) => `${String(ym).slice(2, 4)}.${String(ym).slice(4)}`;
    drawFlow(yms, per);
    if (chart2) chart2.destroy();
    chart2 = new Chart($('trChart2'), { type: 'line', data: { labels: rowsM.map(r => lab(r.ym)), datasets: [
      { label: '전세가율 (%)', data: rowsM.map(r => r.ratio == null ? null : +r.ratio.toFixed(1)), borderColor: CK.C.rent(), backgroundColor: CK.C.rent(), borderWidth: 2, pointRadius: 2, tension: 0.25, spanGaps: true, yAxisID: 'y' },
      { label: '신고가 비율 (%)', data: rowsM.map(r => r.high == null ? null : +r.high.toFixed(1)), borderColor: CK.C.quote(), backgroundColor: CK.C.quote(), borderWidth: 2, pointRadius: 2, tension: 0.25, spanGaps: true, yAxisID: 'y2' }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
        scales: { x: { ticks: { color: col('--sub') }, grid: { color: col('--line') } }, y: { position: 'left', title: { display: true, text: '전세가율 %', color: col('--sub') }, ticks: { color: col('--sub') }, grid: { color: col('--line') } },
          y2: { position: 'right', min: 0, title: { display: true, text: '신고가 비율 %', color: col('--sub') }, ticks: { color: col('--sub') }, grid: { drawOnChartArea: false } } },
        plugins: { legend: { labels: { color: col('--text') } }, ckCross: true } } });
    $('trMonthly').innerHTML = '<thead><tr><th>월</th><th>매매 건수</th><th>전세 건수</th><th>전세가율</th><th>신고가 수</th><th>신고가 비율</th></tr></thead><tbody>' +
      [...rowsM].reverse().map(r => `<tr><td>${lab(r.ym)}</td><td>${r.ns}</td><td>${r.nr}</td><td>${r.ratio == null ? '-' : r.ratio.toFixed(1) + '%'}</td><td>${r.h}</td><td>${r.high == null ? '-' : r.high.toFixed(0) + '%'}</td></tr>`).join('') + '</tbody>';
    // ② 오른 단지 · 내린 단지: 최근 N개월 중간값 vs 그 앞 N개월 중간값 (같은 단지·평형)
    const prevD = new Date(fromD.getFullYear(), fromD.getMonth() - months, fromD.getDate()), prev = prevD.getFullYear() * 10000 + (prevD.getMonth() + 1) * 100 + prevD.getDate();
    const mv = [];
    for (const g of groups.values()) {
      const a = g.list.filter(t => t.d >= from).map(t => t.price), b = g.list.filter(t => t.d < from && t.d >= prev).map(t => t.price);
      if (!a.length || !b.length) continue;
      const ma = median(a), mb = median(b);
      mv.push({ ...Data.parseKey(g.key), g: g.g, now: ma, was: mb, pct: (ma / mb - 1) * 100, na: a.length, nb: b.length });
    }
    const up = mv.filter(x => x.pct > 1).length, down = mv.filter(x => x.pct < -1).length, flat = mv.length - up - down;
    const card = (k, v, s2 = '', cls = '') => `<div class="card"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="s">${s2}</div></div>`;
    $('trMoveNote').textContent = `— 최근 ${months}개월과 그 앞 ${months}개월에 모두 매매가 있는 단지·평형 ${mv.length}개 비교 (직거래 제외, ±1% 안은 보합)`;
    $('trMoveCards').innerHTML = mv.length ? [card('오른 단지', `${up}개`, `${Math.round(up / mv.length * 100)}%`, 'up'), card('내린 단지', `${down}개`, `${Math.round(down / mv.length * 100)}%`, 'down'), card('보합', `${flat}개`, `${Math.round(flat / mv.length * 100)}%`),
      card('중간 변동률', U.pct(median(mv.map(x => x.pct))), '단지별 변동률의 중간값', U.cls(median(mv.map(x => x.pct))))].join('') : '';
    mv.sort((x, y) => y.pct - x.pct);
    $('trMove').innerHTML = '<thead><tr><th class="l">동</th><th class="l">단지</th><th>평형</th><th>앞 기간 중간값</th><th>최근 중간값</th><th>변동</th><th>거래 수 (앞 → 최근)</th></tr></thead><tbody>' +
      (mv.length ? mv.slice(0, 200).map(x => `<tr><td class="l">${U.esc(x.dong)}</td><td class="l"><b>${U.esc(x.name)}</b></td><td>${x.g}㎡<small>${CONFIG.toPyeong(x.g)}평</small></td><td>${U.price(Math.round(x.was))}</td><td>${U.price(Math.round(x.now))}</td><td class="${U.cls(x.pct)}">${U.pct(x.pct)}</td><td>${x.nb} → ${x.na}</td></tr>`).join('')
        : '<tr><td colspan="7" style="color:var(--sub);padding:18px">두 기간에 모두 거래가 있는 단지가 없습니다. "최근 기간"을 늘려 보세요.</td></tr>') + '</tbody>';
    // ③ 구별 비교 (시장 신호 자료)
    const sig = await Data.signals();
    if (!sig || !sig.regions) { $('trCmp').innerHTML = '<tbody><tr><td style="color:var(--sub);padding:18px">시장 신호 자료가 아직 없습니다. 자동 수집이 한 번 돌면 채워집니다.</td></tr></tbody>'; return; }
    const sum = (a) => a.reduce((s, v) => s + (v || 0), 0), lastOf = (a) => { for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return a[i]; return null; };
    const cmp = regions.filter(r => r[1] === reg[1] && sig.regions[r[0]]).map(r => { const x = sig.regions[r[0]], v = x.v || [], rv = x.rv || [], p = x.p || [];
      const v3 = sum(v.slice(-3)), v3b = sum(v.slice(-6, -3)), pNow = lastOf(p), pOld = lastOf(p.slice(0, Math.max(0, p.length - 12)));
      return { r, v3, vchg: v3b ? (v3 / v3b - 1) * 100 : null, r3: sum(rv.slice(-3)), high: x.n90 ? x.nh90 / x.n90 * 100 : null, nh: x.nh90 || 0, p: pNow, pchg: pNow && pOld ? (pNow / pOld - 1) * 100 : null, full: x.full };
    }).sort((a, b) => b.v3 - a.v3);
    $('trCmp').innerHTML = '<thead><tr><th class="l">지역</th><th>최근 3개월 매매</th><th>앞 3개월 대비</th><th>최근 3개월 전세</th><th>90일 신고가 수</th><th>신고가 비율</th><th>㎡당 매매가(만원)</th><th>1년 전 대비</th></tr></thead><tbody>' +
      cmp.map(c => `<tr${c.r[0] === code ? ' style="font-weight:700"' : ''}><td class="l">${U.esc(c.r[2])}${c.full ? '' : ' <span class="tag prov">수집 중</span>'}</td><td>${c.v3.toLocaleString()}</td><td class="${U.cls(c.vchg)}">${U.pct(c.vchg)}</td><td>${c.r3.toLocaleString()}</td><td>${c.nh}</td><td>${c.high == null ? '-' : c.high.toFixed(0) + '%'}</td><td>${c.p == null ? '-' : Math.round(c.p).toLocaleString()}</td><td class="${U.cls(c.pchg)}">${U.pct(c.pchg)}</td></tr>`).join('') + '</tbody>';
  }

  /** 매매·전세 흐름 (84㎡ 환산 중간값) + 사이 색칠 = 투자금 */
  let chart3 = null, flowArgs = null;
  function drawFlow(yms, per, years) {
    flowArgs = [yms, per];
    if (!$('trChart3')) return;
    if (years === undefined) years = CK.range($('trRange'), 'trends', (y) => drawFlow(flowArgs[0], flowArgs[1], y));
    const use = years ? yms.slice(-years * 12) : yms;
    const lab = (ym) => `${String(ym).slice(2, 4)}.${String(ym).slice(4)}`;
    const v = (ym, k) => { const a = per.get(ym)[k]; return a.length >= 3 ? +(median(a) * 84 / 10000).toFixed(2) : null; };
    const S = use.map(ym => v(ym, 's')), R = use.map(ym => v(ym, 'r'));
    const lastS = [...S].reverse().find(x => x != null), lastR = [...R].reverse().find(x => x != null);
    if (chart3) chart3.destroy();
    chart3 = new Chart($('trChart3'), { type: 'line', data: { labels: use.map(lab), datasets: [
      { label: '매매 (84㎡ 환산)', data: S, borderColor: CK.C.sale(), backgroundColor: CK.C.sale(), pointRadius: 0, borderWidth: 2.5, spanGaps: true, endLabel: '매매' },
      { label: '전세 (84㎡ 환산)', data: R, borderColor: CK.C.rent(), backgroundColor: CK.C.rent(), pointRadius: 0, borderWidth: 2.5, spanGaps: true, endLabel: '전세' }] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: { x: { ticks: { maxTicksLimit: 12 } }, y: { ticks: { callback: (x) => x + '억' } } },
        plugins: { ckCross: true, ckEnd: { unit: '억', dec: 2 },
          ckBand: { from: 0, to: 1, label: lastS != null && lastR != null ? `투자금 ${(lastS - lastR).toFixed(2)}억` : '' },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label} ${c.raw == null ? '-' : c.raw + '억'}`, footer: (it) => { const a = it[0] && S[it[0].dataIndex], b = it[0] && R[it[0].dataIndex]; return a != null && b != null ? `투자금 ${(a - b).toFixed(2)}억 · 전세가율 ${Math.round(b / a * 100)}%` : ''; } } } } } });
  }
  function drawChart(vol) {
    const yms = [...vol.keys()].sort((a, b) => a - b);
    const css = getComputedStyle(document.documentElement), col = (n) => css.getPropertyValue(n).trim();
    if (chart) chart.destroy();
    chart = new Chart($('trChart'), {
      type: 'bar',
      data: {
        labels: yms.map(ym => `${String(ym).slice(2, 4)}.${String(ym).slice(4)}`),
        datasets: [
          { label: '매매 건수', data: yms.map(ym => vol.get(ym)[0]), backgroundColor: CK.C.sale() },
          { label: '전세 건수', data: yms.map(ym => vol.get(ym)[1]), backgroundColor: CK.C.rent() },
        ],
      },
      options: {
        maintainAspectRatio: false, animation: false,
        scales: {
          x: { ticks: { color: col('--sub'), maxTicksLimit: 14 }, grid: { display: false } },
          y: { ticks: { color: col('--sub') }, grid: { color: col('--line') } },
        },
        plugins: { legend: { labels: { color: col('--text') } } },
      },
    });
  }

  function table(id, list, isHigh) {
    const shown = list.slice(0, MAX_LIST);
    const el = $(id);
    if (!shown.length) { el.innerHTML = '<tbody><tr><td class="c" style="color:var(--sub);padding:24px">해당 거래가 없습니다.</td></tr></tbody>'; return; }
    el.innerHTML = '<thead><tr><th class="c">계약일</th><th class="l">동</th><th class="l">단지명</th><th>연식</th><th>전용㎡(평형)</th><th>층</th><th>거래가</th>' +
      `<th>이전 최고가</th><th>${isHigh ? '상승폭' : '하락폭'}</th><th>전고대비</th><th class="c">지도</th></tr></thead><tbody>` +
      shown.map((r, i) => `<tr><td class="c">${U.date(r.t.d)}</td><td class="l">${U.esc(r.dong)}</td><td class="l">${U.esc(r.name)}</td><td>${r.buildYear || '-'}</td>` +
        `<td>${r.g}㎡<small>${CONFIG.toPyeong(r.g)}평</small></td><td>${r.t.floor}</td><td class="sale">${U.price(r.t.price)}</td>` +
        `<td>${U.price(r.peak.price)}<small>${U.date(r.peak.d)}</small></td><td class="${U.cls(r.pct)}">${U.diff(r.t.price - r.peak.price)}</td>` +
        `<td class="${U.cls(r.pct)}">${U.pct(r.pct)}</td><td class="c"><button class="mini" data-i="${i}">위치</button></td></tr>`).join('') + '</tbody>';
    el.onclick = (e) => { if (e.target.dataset.i != null) App.showMap(shown[+e.target.dataset.i]); };
  }

  function excel() {
    if (!last || !last.vol.size) return U.toast('먼저 [보기]를 눌러 주세요.');
    const head = ['계약일', '시군구', '동', '단지명', '연식', '전용㎡', '평형', '층', '거래가(만원)', '이전 최고가(만원)', '이전 최고가 계약일', '차이(만원)', '전고대비(%)'];
    const rows = (list) => [head].concat(list.map(r => [U.date(r.t.d), r.sgg, r.dong, r.name, r.buildYear || '', r.g, CONFIG.toPyeong(r.g), r.t.floor, r.t.price, r.peak.price, U.date(r.peak.d), r.t.price - r.peak.price, +r.pct.toFixed(1)]));
    const yms = [...last.vol.keys()].sort((a, b) => a - b);
    U.xlsx(`지역동향_${last.reg[2]}_${U.stamp()}.xlsx`, [
      { name: '신고가 거래', rows: rows(last.highs) },
      { name: '전고대비 하락 거래', rows: rows(last.lows) },
      { name: '월별 거래량', rows: [['연월', '매매 건수', '전세 건수']].concat(yms.map(ym => [ym, ...last.vol.get(ym)])) },
    ]);
  }

  return { init };
})();
