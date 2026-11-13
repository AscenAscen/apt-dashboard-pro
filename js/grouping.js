/* ─────────────────────────────────────────────────────────
   grouping.js — [시세그룹핑] 탭
   가로 = 생활권, 세로 = 가격대(억). 칸마다 단지를 적어 두는 표.
   표는 여러 개 만들 수 있고 브라우저에 자동 저장됩니다.
   ───────────────────────────────────────────────────────── */
const Grouping = (() => {
  const $ = (id) => document.getElementById(id);
  const KEY = 'apt.grouping.v1';
  let st;   // { boards: [{ name, zones:[{id,name}], bands:[{lo,hi}], cells:{ "lo|zoneId": "글" } }], cur: 0 }

  const blank = (name) => ({ name, zones: [], bands: makeBands(3, 15, 1), cells: {} });
  function makeBands(min, max, step) {
    const out = [];
    for (let lo = max - step; lo >= min - 1e-9; lo -= step) out.push({ lo: +lo.toFixed(2), hi: +(lo + step).toFixed(2) });
    return out;   // 비싼 가격대가 위
  }
  const label = (b) => (Math.abs(b.hi - b.lo - 1) < 1e-9 && Number.isInteger(b.lo) ? `${b.lo}억대` : `${b.lo}~${b.hi}억`);
  const board = () => st.boards[st.cur];
  const save = () => Store.set(KEY, st);

  function reload() {
    st = Store.get(KEY, null) || { boards: [blank('기본 그룹핑')], cur: 0 };
    if (!st.boards.length) st.boards.push(blank('기본 그룹핑'));
    st.cur = Math.min(st.cur || 0, st.boards.length - 1);
    render();
  }

  function init() {
    reload();
    $('grpBoard').onchange = () => { st.cur = +$('grpBoard').value; save(); render(); };
    $('btnGrpNew').onclick = () => {
      const name = prompt('새 그룹핑 표 이름 (예: 안양시 2026-11)');
      if (!name) return;
      st.boards.push(blank(name.trim())); st.cur = st.boards.length - 1; save(); render();
    };
    $('btnGrpRename').onclick = () => {
      const name = prompt('표 이름', board().name);
      if (name) { board().name = name.trim(); save(); render(); }
    };
    $('btnGrpDelete').onclick = () => {
      if (!confirm(`"${board().name}" 표를 삭제할까요?`)) return;
      st.boards.splice(st.cur, 1); if (!st.boards.length) st.boards.push(blank('기본 그룹핑'));
      st.cur = 0; save(); render();
    };
    const addZone = () => {
      const names = $('grpZoneName').value.split(',').map(s => s.trim()).filter(Boolean);
      if (!names.length) return U.toast('생활권 이름을 입력하세요. (쉼표로 여러 개)');
      names.forEach(ensureZone); $('grpZoneName').value = ''; save(); render();
    };
    $('btnGrpAddZone').onclick = addZone;
    $('grpZoneName').onkeydown = (e) => { if (e.key === 'Enter') addZone(); };
    $('btnGrpBands').onclick = () => {
      const min = +$('grpMin').value, max = +$('grpMax').value, step = +$('grpStep').value || 1;
      if (!(max > min) || step <= 0 || (max - min) / step > 200) return U.toast('가격대 범위를 확인하세요.');
      const bands = makeBands(min, max, step);
      const keep = new Set(bands.map(b => String(b.lo)));
      const lost = Object.keys(board().cells).filter(k => board().cells[k] && !keep.has(k.split('|')[0])).length;
      if (lost && !confirm(`새 가격대에 없는 ${lost}개 칸의 내용은 지워집니다. 계속할까요?`)) return;
      for (const k of Object.keys(board().cells)) if (!keep.has(k.split('|')[0])) delete board().cells[k];
      board().bands = bands; save(); render();
    };
    $('btnGrpAuto').onclick = autoPlace;
    initSearch();
    $('btnGrpExcel').onclick = excel;
  }

  function ensureZone(name) {
    let z = board().zones.find(x => x.name === name);
    if (!z) { z = { id: 'z' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name }; board().zones.push(z); }
    return z;
  }

  function render() {
    $('grpBoard').innerHTML = st.boards.map((b, i) => `<option value="${i}" ${i === st.cur ? 'selected' : ''}>${U.esc(b.name)}</option>`).join('');
    const b = board();
    const curZone = $('grpTargetZone').value;
    $('grpTargetZone').innerHTML = b.zones.length ? b.zones.map(z => `<option value="${z.id}">${U.esc(z.name)}</option>`).join('') : '<option value="">(생활권을 먼저 추가)</option>';
    if (b.zones.some(z => z.id === curZone)) $('grpTargetZone').value = curZone;
    const head = '<thead><tr><th class="band">가격대 \\ 생활권</th>' +
      (b.zones.length ? b.zones.map(z => `<th><input data-zone="${z.id}" value="${U.esc(z.name)}" aria-label="생활권 이름"><button class="mini" data-del="${z.id}" title="생활권 삭제">×</button></th>`).join('')
        : '<th style="color:var(--sub);font-weight:400">위에서 생활권을 추가하세요</th>') + '</tr></thead>';
    const body = b.bands.map(band => `<tr><td class="band">${label(band)}</td>` +
      (b.zones.length ? b.zones.map(z => `<td><textarea data-cell="${band.lo}|${z.id}" aria-label="${label(band)} ${U.esc(z.name)}">${U.esc(b.cells[`${band.lo}|${z.id}`] || '')}</textarea></td>`).join('') : '<td></td>') +
      '</tr>').join('');
    const table = $('grpTable');
    table.innerHTML = head + `<tbody>${body}</tbody>`;
    table.onchange = (e) => {
      const t = e.target;
      if (t.dataset.cell) { b.cells[t.dataset.cell] = t.value; save(); }
      if (t.dataset.zone) { const z = b.zones.find(x => x.id === t.dataset.zone); if (z && t.value.trim()) { z.name = t.value.trim(); save(); } }
    };
    table.onclick = (e) => {
      const id = e.target.dataset.del;
      if (!id) return;
      const z = b.zones.find(x => x.id === id);
      if (!confirm(`생활권 "${z.name}" 과(와) 그 안의 내용을 삭제할까요?`)) return;
      b.zones = b.zones.filter(x => x.id !== id);
      for (const k of Object.keys(b.cells)) if (k.endsWith('|' + id)) delete b.cells[k];
      save(); render();
    };
  }

  /** 트래킹 단지를 생활권·가격대에 맞는 칸에 자동으로 적어 넣기 */
  function autoPlace() {
    const b = board();
    const list = Tracking.all().filter(it => it.zone && it.lastSale);
    const skipped = Tracking.all().length - list.length;
    if (!list.length) return U.toast('시세트래킹에서 단지의 "생활권" 칸을 먼저 입력하고 [시세 불러오기]를 해 주세요.');
    if (!b.bands.length) return U.toast('가격대를 먼저 만들어 주세요.');
    for (const it of list) {
      const z = ensureZone(it.zone);
      put(z, `${it.name} ${Tracking.pyeong(it)}`, it.lastSale / 10000);
    }
    save(); render();
    U.toast(`${list.length}개 단지를 배치했습니다.` + (skipped ? ` (생활권·시세가 없는 ${skipped}개 제외)` : ''));
  }

  /** 생활권 z 의 가격대 칸에 "단지 평형 가격" 한 줄 넣기 (같은 단지가 이미 있으면 옮김) */
  function put(z, tag, eok) {
    const b = board();
    const band = b.bands.find(x => eok >= x.lo) || b.bands[b.bands.length - 1];  // 범위를 벗어나면 맨 위/맨 아래 칸
    for (const x of b.bands) {
      const k = `${x.lo}|${z.id}`;
      if (b.cells[k]) b.cells[k] = b.cells[k].split('\n').filter(line => !line.startsWith(tag + ' ')).join('\n');
    }
    const k = `${band.lo}|${z.id}`;
    b.cells[k] = [b.cells[k], `${tag} ${eok.toFixed(2).replace(/\.?0+$/, '')}억`].filter(Boolean).join('\n');
    return band;
  }

  /* ── 단지 검색 → 누르면 자동으로 칸에 넣기 ── */
  let regions = [], latest = [], latestCode = '', hits = [];

  async function initSearch() {
    regions = await Data.regions();
    const sidos = [...new Set(regions.map(r => r[1]))];
    $('grpSido').innerHTML = sidos.map(x => `<option>${U.esc(x)}</option>`).join('');
    const saved = Store.get('apt.lastRegion', null);
    if (saved && sidos.includes(saved.sido)) $('grpSido').value = saved.sido;
    const fillSgg = (code) => {
      const list = regions.filter(r => r[1] === $('grpSido').value);
      $('grpSgg').innerHTML = list.map(r => `<option value="${r[0]}">${U.esc(r[2])}</option>`).join('');
      if (code && list.some(r => r[0] === code)) $('grpSgg').value = code;
      search();
    };
    fillSgg(saved?.code);
    $('grpSido').onchange = () => fillSgg();
    $('grpSgg').onchange = search;
    let timer;
    $('grpSearch').oninput = () => { clearTimeout(timer); timer = setTimeout(search, 250); };
    $('grpResults').onclick = (e) => {
      const btn = e.target.closest('button[data-i]');
      if (btn) place(hits[+btn.dataset.i]);
    };
  }

  /** 한 지역의 단지·평형별 최근 매매 실거래 (최근 3년, 직거래 제외) */
  async function loadLatest(code) {
    const y = new Date().getFullYear();
    const data = await Data.loadYears(code, y - 2, y);
    const m = new Map();
    Data.eachTrade(data.sale, null, (key, t) => {
      if (t.direct) return;
      const id = key + '#' + t.g, cur = m.get(id);
      if (!cur || t.d > cur.d) m.set(id, { key, g: t.g, d: t.d, price: t.price });
    });
    return [...m.values()].map(x => ({ ...x, ...Data.parseKey(x.key) }));
  }

  async function search() {
    const q = $('grpSearch').value.trim().toLowerCase();
    const box = $('grpResults');
    if (!q) { hits = []; box.innerHTML = '<span class="none">단지명을 입력하세요.</span>'; return; }
    const code = $('grpSgg').value;
    if (latestCode !== code) {
      box.innerHTML = '<span class="none">불러오는 중…</span>';
      const got = await loadLatest(code);
      if (code !== $('grpSgg').value) return;
      latest = got; latestCode = code;
    }
    hits = latest.filter(x => x.name.toLowerCase().includes(q) || x.dong.includes(q))
      .sort((a, b2) => a.name.localeCompare(b2.name, 'ko') || a.g - b2.g).slice(0, 60);
    box.innerHTML = hits.length
      ? hits.map((x, i) => `<button data-i="${i}">${U.esc(x.dong)} ${U.esc(x.name)} ${x.g}㎡(${CONFIG.toPyeong(x.g)}평)<b>${U.price(x.price)}</b> <small>${U.date(x.d)}</small></button>`).join('')
      : `<span class="none">${latest.length ? '검색 결과가 없습니다.' : '이 지역은 최근 3년 매매 자료가 아직 없습니다.'}</span>`;
  }

  function place(x) {
    const b = board();
    const z = b.zones.find(v => v.id === $('grpTargetZone').value);
    if (!z) return U.toast('먼저 위에서 생활권을 추가하세요.');
    if (!b.bands.length) return U.toast('가격대를 먼저 만들어 주세요.');
    const band = put(z, `${x.name} ${CONFIG.toPyeong(x.g)}평`, x.price / 10000);
    save(); render();
    U.toast(`${x.name} → ${z.name} · ${label(band)} 칸에 넣었습니다.`);
  }

  function excel() {
    const b = board();
    if (!b.zones.length) return U.toast('생활권을 먼저 추가하세요.');
    const rows = [['가격대', ...b.zones.map(z => z.name)]]
      .concat(b.bands.map(band => [label(band), ...b.zones.map(z => b.cells[`${band.lo}|${z.id}`] || '')]));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 10 }, ...b.zones.map(() => ({ wch: 34 }))];
    for (const addr of Object.keys(ws)) if (addr[0] !== '!') ws[addr].s = { alignment: { wrapText: true, vertical: 'top' } };
    XLSX.utils.book_append_sheet(wb, ws, '시세그룹핑');
    XLSX.writeFile(wb, `시세그룹핑_${b.name.replace(/[\\/:*?"<>|]/g, '_')}_${U.stamp()}.xlsx`);
  }

  return { init, reload };
})();
