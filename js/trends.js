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

  const inSize = (g, size) => size === 'all' || (size === 's' ? g < 60 : size === 'm' ? g >= 60 && g <= 85 : g > 85);

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
      // 단지·평형별 매매(직거래 제외) 날짜순
      const groups = new Map();
      Data.eachTrade(data.sale, null, (key, t) => {
        if (!inSize(t.g, size) || t.d < CONFIG.PEAK_FROM) return;
        bump(t, 0);
        if (t.direct) return;
        const id = key + '#' + t.g;
        if (!groups.has(id)) groups.set(id, { key, g: t.g, list: [] });
        groups.get(id).list.push(t);
      });
      Data.eachTrade(data.rent, null, (key, t) => { if (inSize(t.g, size) && t.d >= CONFIG.PEAK_FROM) bump(t, 1); });

      const highs = [], lows = [];
      for (const grp of groups.values()) {
        grp.list.sort((a, b) => a.d - b.d);
        let peak = null;
        for (const t of grp.list) {
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
    } finally {
      btn.disabled = false; btn.textContent = '보기';
    }
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
          { label: '매매 건수', data: yms.map(ym => vol.get(ym)[0]), backgroundColor: col('--accent') },
          { label: '전세 건수', data: yms.map(ym => vol.get(ym)[1]), backgroundColor: col('--rent') },
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
