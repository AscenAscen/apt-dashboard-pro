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
      const eok = it.lastSale / 10000;
      const band = b.bands.find(x => eok >= x.lo) || b.bands[b.bands.length - 1];  // 범위를 벗어나면 맨 위/맨 아래 칸
      const tag = `${it.name} ${Tracking.pyeong(it)}`;
      for (const x of b.bands) {   // 이전에 넣었던 같은 단지는 지우고 새 위치에
        const k = `${x.lo}|${z.id}`;
        if (b.cells[k]) b.cells[k] = b.cells[k].split('\n').filter(line => !line.startsWith(tag + ' ')).join('\n');
      }
      const k = `${band.lo}|${z.id}`;
      b.cells[k] = [b.cells[k], `${tag} ${eok.toFixed(2).replace(/\.?0+$/, '')}억`].filter(Boolean).join('\n');
    }
    save(); render();
    U.toast(`${list.length}개 단지를 배치했습니다.` + (skipped ? ` (생활권·시세가 없는 ${skipped}개 제외)` : ''));
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
