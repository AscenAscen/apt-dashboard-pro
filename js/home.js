/* ─────────────────────────────────────────────────────────
   home.js — [최근 거래] 탭 (첫 화면)
   지역별 최근 1개월 거래 현황. 순서: 서울 → 수도권(경기·인천) → 광역시 (→ 그 외 지역은 체크 시)
   자료: data/summary.json (자동 수집 때마다 새로 만들어짐)
   ───────────────────────────────────────────────────────── */
const Home = (() => {
  const $ = (id) => document.getElementById(id);
  // 묶음 순서와 이름. 순서를 바꾸려면 이 줄의 순서만 바꾸면 됩니다.
  const GROUPS = [
    { name: '서울', test: (sido) => sido.startsWith('서울') },
    { name: '수도권 (경기·인천)', test: (sido) => sido.startsWith('경기') || sido.startsWith('인천') },
    { name: '광역시', test: (sido) => /^(부산|대구|광주|대전|울산)/.test(sido) },
    { name: '그 외 지역', test: () => true, extra: true },
  ];
  let rows = [], sort = { col: 's', dir: -1 }, info = null, regs = [], chart = null, volChart = null;
  const GROUP_COLORS = ['--accent', '--rent', '#34c759'];

  const COLS = [
    { id: 'name', label: '지역', cls: 'l', val: r => r.name },
    { id: 's', label: '매매 (최근 1개월)', val: r => r.s },
    { id: 'sp', label: '직전 1개월', val: r => r.sp },
    { id: 'chg', label: '증감', val: r => r.chg ?? -9999 },
    { id: 'r', label: '전세 (최근 1개월)', val: r => r.r },
    { id: 'avg', label: '매매 평균가', val: r => r.avg ?? -1 },
    { id: 'top', label: '최고가 거래', cls: 'l', val: r => (r.top ? r.top[3] : -1) },
  ];

  async function init() {
    const [regions, sum] = await Promise.all([Data.regions(), Data.summary()]);
    $('homeAll').onchange = render;
    if (!sum) {
      $('homeTable').parentElement.hidden = true;
      $('homeEmpty').hidden = false;
      $('homeEmpty').innerHTML = '거래 현황 요약이 아직 없습니다.<br>다음 자동 수집(매일 새벽 4시·오후 1시경)이 끝나면 표시됩니다. 바로 보려면 GitHub Actions 에서 [Run workflow] 를 누르세요.';
      return;
    }
    info = sum; regs = regions;
    if (sum.deals && (sum.deals.sale.length || sum.deals.rent.length)) {
      $('homeChartPanel').hidden = false;
      ['hcGroup', 'hcKind', 'hcMetric', 'hcCount'].forEach(id => { $(id).onchange = drawChart; });
      drawChart();
    }
    $('homeTitle').textContent = `최근 1개월 거래 현황 (${sum.asOf} 기준, 계약일 기준 최근 ${sum.days}일)`;
    rows = regions.filter(r => sum.regions[r[0]]).map(r => {
      const v = sum.regions[r[0]];
      return { code: r[0], sido: r[1], sgg: r[2], name: `${U.siGu(r[1], r[2]).filter(Boolean).join(' ')}`, ...v,
        chg: v.sp ? (v.s / v.sp - 1) * 100 : null, group: GROUPS.findIndex(g => g.test(r[1])) };
    });
    summary();
    render();
  }

  /* ── 한눈에: 묶음별 요약 카드 + 최근 1개월 vs 직전 1개월 그래프 ── */
  function summary() {
    const css = getComputedStyle(document.documentElement);
    const col = (c) => (c.startsWith('--') ? css.getPropertyValue(c).trim() : c);
    const sums = GROUPS.slice(0, 3).map((g, gi) => {
      const list = rows.filter(r => r.group === gi);
      const s = list.reduce((t, r) => t + r.s, 0), sp = list.reduce((t, r) => t + r.sp, 0), r = list.reduce((t, x) => t + x.r, 0), rp = list.reduce((t, x) => t + (x.rp || 0), 0);
      return { name: g.name.split(' ')[0], full: g.name, n: list.length, s, sp, r, rp, chg: sp ? (s / sp - 1) * 100 : null, rchg: rp ? (r / rp - 1) * 100 : null };
    });
    if (!sums.some(x => x.n)) return;
    $('homeSummary').hidden = false;
    $('homeSumTitle').textContent = `최근 1개월 한눈에 (${info.asOf} 기준)`;
    $('homeCards').innerHTML = sums.map((x, i) => `<div class="card g${i}"><div class="k">${x.full}</div><div class="v">매매 ${x.s.toLocaleString()}건</div>` +
      `<div class="s">직전 1개월 대비 <b class="${U.cls(x.chg)}">${U.pct(x.chg, 0)}</b></div><div class="s" style="margin-top:4px">전세 ${x.r.toLocaleString()}건 <span class="${U.cls(x.rchg)}">${U.pct(x.rchg, 0)}</span></div></div>`).join('');
    if (volChart) volChart.destroy();
    volChart = new Chart($('homeVol'), {
      type: 'bar',
      data: {
        labels: sums.map(x => x.name),
        datasets: [
          { label: '직전 1개월 매매', data: sums.map(x => x.sp), backgroundColor: sums.map((x, i) => col(GROUP_COLORS[i]) + '55'), borderRadius: 5 },
          { label: '최근 1개월 매매', data: sums.map(x => x.s), backgroundColor: sums.map((x, i) => col(GROUP_COLORS[i])), borderRadius: 5 },
        ],
      },
      options: {
        maintainAspectRatio: false, animation: false,
        scales: { x: { ticks: { color: col('--text') }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: col('--sub') }, grid: { color: col('--line') } } },
        plugins: { legend: { display: false }, title: { display: true, text: '매매 건수 — 옅은 막대: 직전 1개월 / 진한 막대: 최근 1개월', color: col('--sub'), font: { size: 12, weight: '400' } } },
      },
    });
  }

  function render() {
    const showExtra = $('homeAll').checked;
    const col = COLS.find(c => c.id === sort.col);
    const head = '<thead><tr>' + COLS.map(c => `<th class="sortable ${c.cls || ''}" data-col="${c.id}">${c.label}${sort.col === c.id ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('') + '</tr></thead>';
    let body = '';
    GROUPS.forEach((g, gi) => {
      if (g.extra && !showExtra) return;
      const list = rows.filter(r => r.group === gi).sort((a, b) => {
        const x = col.val(a), y = col.val(b);
        return (typeof x === 'string' ? x.localeCompare(y, 'ko') : x - y) * sort.dir || b.s - a.s;
      });
      if (!list.length) return;
      const s = list.reduce((t, r) => t + r.s, 0), sp = list.reduce((t, r) => t + r.sp, 0), rr = list.reduce((t, r) => t + r.r, 0);
      const chg = sp ? (s / sp - 1) * 100 : null;
      body += `<tr class="group"><td class="l">${g.name} <small>${list.length}개 지역</small></td><td>${s.toLocaleString()}</td><td>${sp.toLocaleString()}</td>` +
        `<td class="${U.cls(chg)}">${U.pct(chg, 0)}</td><td>${rr.toLocaleString()}</td><td></td><td></td></tr>`;
      body += list.map(r => `<tr class="reg" data-code="${r.code}"><td class="l">${U.esc(r.name)}</td><td class="sale">${r.s.toLocaleString()}</td><td>${r.sp.toLocaleString()}</td>` +
        `<td class="${U.cls(r.chg)}">${U.pct(r.chg, 0)}</td><td class="rent">${r.r.toLocaleString()}</td><td>${r.avg ? U.price(r.avg) : '-'}</td>` +
        `<td class="l">${r.top ? `${U.esc(r.top[0])} ${U.esc(r.top[1])} ${r.top[2]}㎡ <b>${U.price(r.top[3])}</b><small>${U.date(r.top[4])}</small>` : '-'}</td></tr>`).join('');
    });
    const table = $('homeTable');
    table.innerHTML = head + `<tbody>${body}</tbody>`;
    table.querySelectorAll('th.sortable').forEach(th => {
      th.onclick = () => { sort = { col: th.dataset.col, dir: sort.col === th.dataset.col ? -sort.dir : (th.dataset.col === 'name' ? 1 : -1) }; render(); };
    });
    table.querySelector('tbody').onclick = (e) => {
      const tr = e.target.closest('tr.reg');
      if (tr) { App.showTab('search'); Search.openRegion(tr.dataset.code); }
    };
  }

  /* ── 가로 막대그래프: 최근 1개월 고가 거래 ── */
  function drawChart() {
    const kind = $('hcKind').value, grp = $('hcGroup').value, n = +$('hcCount').value;
    if (kind === 'rent' && $('hcMetric').value === 'rec') { $('hcMetric').value = 'price'; U.toast('전고점 대비 회복률은 매매에서만 볼 수 있습니다.'); }
    const metric = $('hcMetric').value;
    const byCode = new Map(regs.map(r => [r[0], r]));
    let list = (info.deals[kind] || []).map(d => {
      const reg = byCode.get(d[0]); if (!reg) return null;
      const g = GROUPS.findIndex(x => x.test(reg[1]));
      const rec = d[6] ? d[4] / d[6] * 100 : null;
      return { g, place: U.siGu(reg[1], reg[2]).filter(Boolean).pop(), dong: d[1], name: d[2], area: d[3], price: d[4], d: d[5], rec };
    }).filter(x => x && x.g <= 2 && (grp === 'all' || x.g === +grp) && (metric === 'price' || x.rec != null));
    list.sort((a, b) => (metric === 'price' ? b.price - a.price : b.rec - a.rec || b.price - a.price));
    list = list.slice(0, n);
    const css = getComputedStyle(document.documentElement);
    const col = (c) => (c.startsWith('--') ? css.getPropertyValue(c).trim() : c);
    const eok = (v) => +(v / 10000).toFixed(2) + '억';
    const text = (x) => {
      const chg = x.rec == null ? '' : (x.rec >= 99.95 ? '신고가' : `${(x.rec - 100).toFixed(0)}%`);
      return metric === 'price' ? `${eok(x.price)}${chg ? ` (${chg})` : ''}` : `${x.rec.toFixed(0)}% · ${eok(x.price)}`;
    };
    const canvas = $('homeChart');
    canvas.parentElement.style.height = Math.max(180, list.length * 38 + 56) + 'px';
    if (chart) chart.destroy();
    const narrow = window.innerWidth < 760;
    chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: list.map(x => [`${x.name} ${x.area}㎡`, `${x.place} ${x.dong}`]),      // 두 줄: 단지명 / 위치
        datasets: [
          { data: list.map(x => (metric === 'price' ? x.price / 10000 : x.rec)), backgroundColor: list.map(x => col(GROUP_COLORS[x.g])), borderRadius: 6, barPercentage: 0.62, grouped: false, order: 1 },
          // 옅은 막대 = 2020년 이후 전고점(가격) 또는 100%(회복률) → 지금 가격이 전고점에 얼마나 가까운지 보임
          { data: list.map(x => (metric === 'price' ? (x.rec != null ? x.price / 10000 / (x.rec / 100) : null) : 100)), backgroundColor: list.map(x => col(GROUP_COLORS[x.g]) + '2e'), borderRadius: 6, barPercentage: 0.62, grouped: false, order: 2 },
        ],
      },
      options: {
        indexAxis: 'y', maintainAspectRatio: false, animation: false,
        layout: { padding: { right: narrow ? 100 : 136, top: 4 } },
        scales: {
          x: { beginAtZero: true, ticks: { color: col('--sub'), callback: (v) => (metric === 'price' ? v + '억' : v + '%') }, grid: { color: col('--line') } },
          y: { ticks: { color: col('--text'), autoSkip: false, font: { size: narrow ? 11 : 13 } }, grid: { display: false }, border: { display: false } },
        },
        plugins: { legend: { display: false }, tooltip: { filter: (c) => c.datasetIndex === 0, callbacks: { title: (c) => c[0] ? list[c[0].dataIndex].name + ' ' + list[c[0].dataIndex].area + '㎡' : '', label: (c) => `${text(list[c.dataIndex])} · 계약 ${U.date(list[c.dataIndex].d)}` } } },
      },
      // 막대 오른쪽 끝에 수치를 고정 표시
      plugins: [{
        id: 'endLabel',
        afterDatasetsDraw(ch) {
          const ctx = ch.ctx;
          ctx.save(); ctx.fillStyle = col('--text'); ctx.font = `600 ${narrow ? 11 : 12}px system-ui, sans-serif`; ctx.textBaseline = 'middle';
          const ghost = ch.getDatasetMeta(1).data;
          ch.getDatasetMeta(0).data.forEach((bar, i) => ctx.fillText(text(list[i]), Math.max(bar.x, ghost[i] ? ghost[i].x || 0 : 0) + 8, bar.y));
          ctx.restore();
        },
      }],
    });
  }

  return { init };
})();
