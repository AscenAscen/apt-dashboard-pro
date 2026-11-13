/* ─────────────────────────────────────────────────────────
   search.js — [실거래 조회] 탭
   지역 선택 → 단지 목록(전고점·전저점·등락률) → 단지 상세(그래프·거래내역) → 엑셀
   ───────────────────────────────────────────────────────── */
const Search = (() => {
  const $ = (id) => document.getElementById(id);
  let regions = [];        // [[code, sido, sgg, tier]]
  let rows = [];           // 조회 결과 (단지·평형별 1줄)
  let view = [];           // 검색어·정렬 적용 후
  let sort = { col: 'name', dir: 1 };
  let current = null;      // 상세에 열린 줄
  let fromDate = 0;        // 조회기간 시작일
  let chart = null;
  const checked = new Set();

  // 목록 표의 열 정의 — 열을 추가/삭제하려면 여기만 고치면 됩니다
  const COLS = [
    { id: 'dong', label: '동', cls: 'l', val: r => r.dong, html: r => U.esc(r.dong) },
    { id: 'name', label: '단지명', cls: 'l', val: r => r.name, html: r => U.esc(r.name) },
    { id: 'buildYear', label: '연식', val: r => r.buildYear || 0, html: r => r.buildYear || '-' },
    { id: 'g', label: '전용㎡(평형)', val: r => r.g, html: r => `${r.g}㎡<small>${CONFIG.toPyeong(r.g)}평</small>` },
    { id: 'last', label: '최근 매매', val: r => r.st.last?.price ?? -1, html: r => priceDate(r.st.last, 'sale') },
    { id: 'peak', label: '전고점', val: r => r.st.peak?.price ?? -1, html: r => priceDate(r.st.peak) },
    { id: 'drop', label: '전고대비', val: r => r.st.drop ?? -999, html: r => pctCell(r.st.drop) },
    { id: 'trough', label: '전저점', val: r => r.st.trough?.price ?? -1, html: r => priceDate(r.st.trough) },
    { id: 'rise', label: '전저대비', val: r => r.st.rise ?? -999, html: r => pctCell(r.st.rise) },
    { id: 'rentLast', label: '최근 전세', val: r => r.st.rentLast?.price ?? -1, html: r => priceDate(r.st.rentLast, 'rent') },
    { id: 'ratio', label: '전세가율', val: r => r.st.ratio ?? -1, html: r => (r.st.ratio == null ? '-' : r.st.ratio.toFixed(0) + '%') },
    { id: 'nSale', label: '매매건수', val: r => r.nSale, html: r => r.nSale },
    { id: 'nRent', label: '전세건수', val: r => r.nRent, html: r => r.nRent },
  ];
  const priceDate = (t, cls = '') => (t ? `<span class="${cls}">${U.price(t.price)}</span><small>${U.date(t.d)}</small>` : '-');
  const pctCell = (v) => `<span class="${U.cls(v)}">${U.pct(v)}</span>`;

  /* ── 지역 선택 상자 ── */
  async function init() {
    regions = await Data.regions();
    const sidos = [...new Set(regions.map(r => r[1]))];
    $('selSido').innerHTML = sidos.map(s => `<option>${U.esc(s)}</option>`).join('');
    const saved = Store.get('apt.lastRegion', null);
    if (saved && sidos.includes(saved.sido)) $('selSido').value = saved.sido;
    fillSgg(saved?.code);
    $('selSido').onchange = () => fillSgg();
    $('selSgg').onchange = fillDong;
    $('selDong').onchange = fillApt;
    $('btnSearch').onclick = run;
    $('listFilter').oninput = renderList;
    $('btnExcelList').onclick = excelList;
    $('btnAddTrackSel').onclick = () => {
      const sel = rows.filter(r => checked.has(r.id));
      if (!sel.length) return U.toast('먼저 목록에서 단지를 체크하세요.');
      Tracking.add(sel);
    };
    $('btnDetailMap').onclick = () => current && App.showMap(current);
    $('btnDetailTrack').onclick = () => current && Tracking.add([current]);
    $('btnExcelDetail').onclick = () => current && excel([current], `${current.name}_${current.g}㎡`);
  }

  function fillSgg(selectCode) {
    const sido = $('selSido').value;
    const list = regions.filter(r => r[1] === sido);
    $('selSgg').innerHTML = list.map(r => `<option value="${r[0]}">${U.esc(r[2])}${r[3] === 1 ? '' : ' ·'}</option>`).join('');
    if (selectCode && list.some(r => r[0] === selectCode)) $('selSgg').value = selectCode;
    fillDong();
  }

  async function fillDong() {
    const code = $('selSgg').value;
    const idx = await Data.index(code);
    if (code !== $('selSgg').value) return;
    const dongs = [...new Set(Object.keys(idx.c).map(k => k.split('|')[0]))].sort((a, b) => a.localeCompare(b, 'ko'));
    $('selDong').innerHTML = '<option value="">전체</option>' + dongs.map(d => `<option>${U.esc(d)}</option>`).join('');
    $('selDong')._idx = idx;
    fillApt();
  }

  function fillApt() {
    const idx = $('selDong')._idx || { c: {} };
    const dong = $('selDong').value;
    const keys = Object.keys(idx.c).filter(k => !dong || k.split('|')[0] === dong)
      .sort((a, b) => Data.parseKey(a).name.localeCompare(Data.parseKey(b).name, 'ko'));
    $('selApt').innerHTML = '<option value="">전체</option>' + keys.map(k => {
      const p = Data.parseKey(k);
      return `<option value="${U.esc(k)}">${U.esc(p.name)}${dong ? '' : ` (${U.esc(p.dong)})`}</option>`;
    }).join('');
  }

  /* ── 조회 ── */
  async function run() {
    const code = $('selSgg').value;
    const reg = regions.find(r => r[0] === code);
    if (!reg) return;
    const wantSale = $('chkSale').checked, wantRent = $('chkRent').checked;
    if (!wantSale && !wantRent) return U.toast('매매·전세 중 하나 이상 선택하세요.');
    const idx = await Data.index(code);
    if (!Object.keys(idx.c).length) {
      show(false);
      $('searchEmpty').innerHTML = `<b>${U.esc(reg[1])} ${U.esc(reg[2])}</b> 은(는) 아직 수집된 데이터가 없습니다.<br>자동 수집이 진행되면 표시됩니다. (오른쪽 위 수집률 참고)`;
      return;
    }
    Store.set('apt.lastRegion', { sido: reg[1], code });
    $('btnSearch').disabled = true; $('btnSearch').textContent = '불러오는 중…';
    try {
      const years = +$('selPeriod').value;
      const now = new Date();
      const from = new Date(now.getFullYear() - years, now.getMonth(), now.getDate());
      fromDate = from.getFullYear() * 10000 + (from.getMonth() + 1) * 100 + from.getDate();
      const fromYear = Math.min(from.getFullYear(), Math.floor(CONFIG.PEAK_FROM / 10000));
      const data = await Data.loadYears(code, fromYear, now.getFullYear());
      const dong = $('selDong').value, apt = $('selApt').value;
      const filter = (k) => (apt ? k === apt : !dong || k.split('|')[0] === dong);

      const map = new Map();
      const get = (key, g) => {
        const id = `${code}|${key}#${g}`;
        if (!map.has(id)) {
          const p = Data.parseKey(key);
          map.set(id, { id, code, sido: reg[1], sgg: reg[2], key, ...p, g, buildYear: idx.c[key] || null, sale: [], rent: [] });
        }
        return map.get(id);
      };
      Data.eachTrade(data.sale, filter, (key, t) => get(key, t.g).sale.push(t));
      Data.eachTrade(data.rent, filter, (key, t) => get(key, t.g).rent.push(t));

      const noDirect = $('chkNoDirect').checked;
      rows = [];
      for (const r of map.values()) {
        r.sale.sort((a, b) => a.d - b.d); r.rent.sort((a, b) => a.d - b.d);
        if (!wantSale) r.sale = [];
        if (!wantRent) r.rent = [];
        r.st = Data.stats(r.sale, r.rent, noDirect);
        r.nSale = r.sale.filter(t => t.d >= fromDate).length;
        r.nRent = r.rent.filter(t => t.d >= fromDate).length;
        if (r.nSale + r.nRent > 0) rows.push(r);
      }
      checked.clear(); current = null;
      $('listTitle').textContent = `${reg[1]} ${reg[2]}${dong ? ' ' + dong : ''} — 단지·평형 ${rows.length.toLocaleString()}개`;
      show(true);
      $('detailPanel').hidden = true;
      renderList();
      if (apt && rows.length) openDetail([...rows].sort((a, b) => b.nSale - a.nSale)[0]);
      if (!rows.length) U.toast('조회기간 안에 거래가 없습니다. 기간을 늘려 보세요.');
    } finally {
      $('btnSearch').disabled = false; $('btnSearch').textContent = '조회';
    }
  }

  function show(hasList) {
    $('listPanel').hidden = !hasList;
    $('searchEmpty').hidden = hasList;
    if (!hasList) $('detailPanel').hidden = true;
  }

  /* ── 목록 표 ── */
  function renderList() {
    const q = $('listFilter').value.trim();
    const col = COLS.find(c => c.id === sort.col) || COLS[1];
    view = rows.filter(r => !q || r.name.includes(q) || r.dong.includes(q));
    view.sort((a, b) => {
      const x = col.val(a), y = col.val(b);
      const c = typeof x === 'string' ? x.localeCompare(y, 'ko') : x - y;
      return (c || a.name.localeCompare(b.name, 'ko') || a.g - b.g) * sort.dir;
    });
    const shown = view.slice(0, CONFIG.MAX_ROWS);
    const head = `<thead><tr><th class="c"><input type="checkbox" id="chkAll" title="전체 선택"></th>` +
      COLS.map(c => `<th class="sortable ${c.cls || ''}" data-col="${c.id}">${c.label}${sort.col === c.id ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('') +
      `<th class="c">지도</th></tr></thead>`;
    const body = shown.map((r, i) => `<tr data-i="${i}" class="${current && current.id === r.id ? 'sel' : ''}">` +
      `<td class="c"><input type="checkbox" data-chk="${i}" ${checked.has(r.id) ? 'checked' : ''}></td>` +
      COLS.map(c => `<td class="${c.cls || ''}">${c.html(r)}</td>`).join('') +
      `<td class="c"><button class="mini" data-map="${i}">위치</button></td></tr>`).join('');
    const table = $('listTable');
    table.innerHTML = head + `<tbody>${body}</tbody>`;
    $('listNote').textContent = view.length > shown.length
      ? `${view.length.toLocaleString()}개 중 ${shown.length.toLocaleString()}개만 표시했습니다. 동을 선택하거나 단지명으로 검색해 좁혀 보세요. (엑셀에는 전체가 들어갑니다)` : '';
    table.querySelectorAll('th.sortable').forEach(th => {
      th.onclick = () => { sort = { col: th.dataset.col, dir: sort.col === th.dataset.col ? -sort.dir : (th.dataset.col === 'name' || th.dataset.col === 'dong' ? 1 : -1) }; renderList(); };
    });
    $('chkAll').onclick = (e) => { shown.forEach(r => (e.target.checked ? checked.add(r.id) : checked.delete(r.id))); renderList(); $('chkAll').checked = e.target.checked; };
    table.querySelector('tbody').onclick = (e) => {
      const t = e.target;
      if (t.dataset.chk != null) { const r = shown[+t.dataset.chk]; t.checked ? checked.add(r.id) : checked.delete(r.id); return; }
      if (t.dataset.map != null) return App.showMap(shown[+t.dataset.map]);
      const tr = t.closest('tr');
      if (tr) openDetail(shown[+tr.dataset.i]);
    };
  }

  /* ── 단지 상세 ── */
  function periodTrades(r) {
    const noDirect = $('chkNoDirect').checked;
    return {
      sale: r.sale.filter(t => t.d >= fromDate),
      rent: r.rent.filter(t => t.d >= fromDate),
      noDirect,
    };
  }

  function openDetail(r) {
    current = r;
    document.querySelectorAll('#listTable tbody tr').forEach(tr => tr.classList.toggle('sel', view[+tr.dataset.i]?.id === r.id));
    const st = r.st;
    $('detailTitle').textContent = `${r.sgg} ${r.dong} ${r.name} · 전용 ${r.g}㎡(${CONFIG.toPyeong(r.g)}평)` + (r.buildYear ? ` · ${r.buildYear}년식` : '');
    const card = (k, v, s = '', cls = '') => `<div class="card"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="s">${s}</div></div>`;
    const when = (t) => (t ? `${U.date(t.d)} · ${t.floor}층` : '');
    $('detailCards').innerHTML = [
      card('최근 매매 실거래', st.last ? U.price(st.last.price) : '-', when(st.last)),
      card('전고점 (2020년~)', st.peak ? U.price(st.peak.price) : '-', when(st.peak)),
      card('전고대비 하락률', U.pct(st.drop), st.peak && st.last ? U.diff(st.last.price - st.peak.price) : '', U.cls(st.drop)),
      card('전저점 (2020년~)', st.trough ? U.price(st.trough.price) : '-', when(st.trough)),
      card('전저대비 상승률', U.pct(st.rise), st.trough && st.last ? U.diff(st.last.price - st.trough.price) : '', U.cls(st.rise)),
      card('최근 전세 실거래', st.rentLast ? U.price(st.rentLast.price) : '-', when(st.rentLast)),
      card('전세 전고점 / 전저점', st.rentPeak ? `${U.price(st.rentPeak.price)}` : '-', st.rentTrough ? `전저 ${U.price(st.rentTrough.price)}` : ''),
      card('전세가율 / 매-전', st.ratio == null ? '-' : st.ratio.toFixed(0) + '%', st.last && st.rentLast ? `차이 ${U.price(st.last.price - st.rentLast.price)}` : ''),
    ].join('');

    const p = periodTrades(r);
    drawChart(p);
    const all = [...p.sale.map(t => ({ ...t, kind: '매매' })), ...p.rent.map(t => ({ ...t, kind: '전세' }))].sort((a, b) => b.d - a.d);
    $('detailTable').innerHTML = '<thead><tr><th class="c">구분</th><th class="c">계약일</th><th>금액</th><th>전용㎡</th><th>층</th><th class="l">비고</th></tr></thead><tbody>' +
      all.map(t => `<tr><td class="c ${t.kind === '매매' ? 'sale' : 'rent'}">${t.kind}</td><td class="c">${U.date(t.d)}</td><td>${U.price(t.price)}</td><td>${t.area}</td><td>${t.floor}</td><td class="l">${t.direct ? '직거래' : ''}</td></tr>`).join('') +
      '</tbody>';
    $('detailPanel').hidden = false;
    $('detailPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function drawChart(p) {
    const toX = (d) => new Date(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100).getTime();
    const pts = (arr) => arr.map(t => ({ x: toX(t.d), y: t.price / 10000, t }));
    const css = getComputedStyle(document.documentElement);
    const col = (n) => css.getPropertyValue(n).trim();
    if (chart) chart.destroy();
    chart = new Chart($('chart'), {
      type: 'scatter',
      data: {
        datasets: [
          { label: '매매', data: pts(p.sale.filter(t => !t.direct)), backgroundColor: col('--accent'), pointRadius: 3 },
          { label: '매매(직거래)', data: pts(p.sale.filter(t => t.direct)), backgroundColor: 'transparent', borderColor: col('--accent'), pointRadius: 3, pointStyle: 'triangle', hidden: p.noDirect },
          { label: '전세', data: pts(p.rent), backgroundColor: col('--rent'), pointRadius: 2.5, pointStyle: 'rect' },
        ].filter(d => d.data.length),
      },
      options: {
        maintainAspectRatio: false, animation: false,
        scales: {
          x: { type: 'linear', ticks: { color: col('--sub'), maxTicksLimit: 10, callback: (v) => { const d = new Date(v); return `${String(d.getFullYear()).slice(2)}.${String(d.getMonth() + 1).padStart(2, '0')}`; } }, grid: { color: col('--line') } },
          y: { ticks: { color: col('--sub'), callback: (v) => v + '억' }, grid: { color: col('--line') } },
        },
        plugins: {
          legend: { labels: { color: col('--text'), usePointStyle: true } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label} ${U.price(c.raw.t.price)} · ${U.date(c.raw.t.d)} · ${c.raw.t.floor}층` } },
        },
      },
    });
  }

  /* ── 엑셀 ── */
  function excelList() {
    const sel = rows.filter(r => checked.has(r.id));
    const target = sel.length ? sel : view;
    if (!target.length) return U.toast('내려받을 단지가 없습니다.');
    excel(target, $('selSgg').selectedOptions[0].textContent.replace(' ·', ''));
  }

  function excel(list, label) {
    const sheets = [{
      name: '요약',
      rows: [['시도', '시군구', '동', '단지명', '연식', '전용㎡', '평형', '최근 매매(만원)', '매매 계약일', '전고점(만원)', '전고점 계약일', '전고대비 하락률(%)',
        '전저점(만원)', '전저점 계약일', '전저대비 상승률(%)', '최근 전세(만원)', '전세 계약일', '전세가율(%)', '매매건수', '전세건수']]
        .concat(list.map(r => {
          const s = r.st, n = (v, d = 1) => (v == null ? '' : +v.toFixed(d));
          return [r.sido, r.sgg, r.dong, r.name, r.buildYear || '', r.g, CONFIG.toPyeong(r.g), s.last?.price ?? '', U.date(s.last?.d), s.peak?.price ?? '', U.date(s.peak?.d), n(s.drop),
            s.trough?.price ?? '', U.date(s.trough?.d), n(s.rise), s.rentLast?.price ?? '', U.date(s.rentLast?.d), n(s.ratio), r.nSale, r.nRent];
        })),
    }];
    const detail = (kind, name) => {
      const out = [['시군구', '동', '단지명', '전용㎡', '계약일', '금액(만원)', '층', '비고']];
      for (const r of list) for (const t of r[kind]) if (t.d >= fromDate) out.push([r.sgg, r.dong, r.name, t.area, U.date(t.d), t.price, t.floor, t.direct ? '직거래' : '']);
      if (out.length > 1) sheets.push({ name, rows: out });
    };
    if ($('chkSale').checked) detail('sale', '매매 내역');
    if ($('chkRent').checked) detail('rent', '전세 내역');
    U.xlsx(`실거래_${label}_${U.stamp()}.xlsx`, sheets);
  }

  return { init };
})();
