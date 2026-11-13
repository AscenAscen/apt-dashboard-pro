/* ─────────────────────────────────────────────────────────
   tracking.js — [시세트래킹] 탭
   · 매매·전세·매물 개수는 "내가 확인한 가격"을 직접 적습니다 (억 단위, 예: 14.3).
   · [시세 추가] 를 누르면 새 달의 칸 묶음이 맨 앞(왼쪽)에 생기고, 예전 기록은 오른쪽으로 밀려 계속 쌓입니다.
   · 전고점·전저점은 실거래로 자동 기입되며, 칸을 눌러 직접 고칠 수 있습니다.
   · [실거래 불러오기] 는 가장 최근 매매·전세 실거래가와 거래일을 창으로 보여 줍니다.
   · 단지는 폴더로 나눠 담습니다.
   ───────────────────────────────────────────────────────── */
const Tracking = (() => {
  const $ = (id) => document.getElementById(id);
  const KEY = 'apt.tracking.v1', FKEY = 'apt.folders.v1', MKEY = 'apt.trkMonths.v1', BASE = '기본';
  // 표·엑셀의 열 이름 (순서를 바꾸려면 여기서)
  const FIXED = ['가격대', '시', '구', '동', '생활권', '단지명', '연식', '연차', '세대수', '평형', '구조', '방', '화', '링크', '전고점', '전고 대비 하락률', '전저점', '전저 대비 상승률'];
  const GROUP = ['매매', '매매 개수', '전월 대비', '전세', '전세 개수', '전월 대비', '매-전(투자금)', '전월 대비', '전세가율', '전월 대비'];

  let items = Store.get(KEY, []);
  let folders = Store.get(FKEY, [BASE]);
  let months = Store.get(MKEY, null);          // 기록한 달 목록, 최신이 앞 [202611, 202610, …]
  const real = new Map();                       // id → { sale, rent, peak, trough } (실거래)
  const checked = new Set();

  // 예전에 담아 둔 단지에 새 항목 채우기
  for (const it of items) { it.folder = it.folder || BASE; it.quotes = it.quotes || {}; }
  for (const it of items) if (!folders.includes(it.folder)) folders.push(it.folder);
  if (!folders.includes(BASE)) folders.unshift(BASE);
  if (!months) months = [...new Set(items.flatMap(it => Object.keys(it.quotes).map(Number)))];
  months.sort((a, b) => b - a);

  const save = () => { Store.set(KEY, items); Store.set(FKEY, folders); Store.set(MKEY, months); $('trackCount').textContent = items.length; };
  const all = () => items;
  const pyeong = (it) => it.pyeong || CONFIG.toPyeong(it.g) + '평';
  const link = (it) => it.link || U.landLink(it.sgg, it.dong, it.name);
  const curFolder = () => $('trkFolder').value;
  const ymLabel = (ym) => `${Math.floor(ym / 100)}년 ${ym % 100}월`;
  const eok = (v) => (v == null ? '' : String(+(v / 10000).toFixed(4)));           // 만원 → 억 글자
  const toMan = (text) => { const n = parseFloat(String(text).replace(/,/g, '')); return isNaN(n) ? null : Math.round(n * 10000); };

  /** [실거래 조회] 등에서 넘어온 단지를 지금 보고 있는 폴더에 추가 */
  function add(rows) {
    const folder = curFolder() || BASE;
    let n = 0;
    for (const r of rows) {
      if (items.some(it => it.id === r.id)) continue;
      items.push({ id: r.id, code: r.code, sido: r.sido, sgg: r.sgg, dong: r.dong, jibun: r.jibun, key: r.key, name: r.name,
        g: r.g, buildYear: r.buildYear, households: '', structure: '', rooms: '', baths: '', link: '', zone: '', pyeong: '',
        folder, quotes: {}, lastSale: r.st?.last?.price ?? null });
      n++;
    }
    save(); fillSelects();
    U.toast(n ? `${n}개 단지를 [${folder}] 폴더에 담았습니다.` : '이미 담겨 있는 단지입니다.');
  }

  function init() {
    const now = new Date();
    $('trkNewMonth').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    $('btnTrkAddMonth').onclick = () => {
      const ym = +($('trkNewMonth').value || '').replace('-', '');
      if (!ym) return U.toast('추가할 달을 고르세요.');
      if (months.includes(ym)) return U.toast(`${ymLabel(ym)} 칸은 이미 있습니다.`);
      months.push(ym); months.sort((a, b) => b - a); save(); render();
      U.toast(`${ymLabel(ym)} 시세 칸을 추가했습니다. 매매·전세 가격을 적어 주세요.`);
    };
    $('trkRegion').onchange = render;
    $('trkFolder').onchange = () => { Store.set('apt.curFolder', curFolder()); checked.clear(); fillSelects(); render(); };
    $('btnTrkLoad').onclick = () => load(true);
    $('btnTrkExcel').onclick = excel;
    $('btnTrkTrades').onclick = downloadTrades;
    $('btnTrkBackup').onclick = backup;
    $('btnTrkRestore').onclick = () => $('trkFile').click();
    $('trkFile').onchange = restore;
    $('realClose').onclick = () => { $('realModal').hidden = true; };
    $('realModal').onclick = (e) => { if (e.target.id === 'realModal') $('realModal').hidden = true; };
    $('btnFolderNew').onclick = () => {
      const name = (prompt('새 폴더 이름 (예: 평촌 앞마당)') || '').trim();
      if (!name) return;
      if (!folders.includes(name)) folders.push(name);
      save(); fillSelects(); $('trkFolder').value = name; Store.set('apt.curFolder', name); fillSelects(); render();
    };
    $('btnFolderRename').onclick = () => {
      const cur = curFolder();
      if (!cur) return U.toast('이름을 바꿀 폴더를 먼저 고르세요.');
      const name = (prompt('폴더 이름', cur) || '').trim();
      if (!name || name === cur) return;
      if (folders.includes(name)) return U.toast('같은 이름의 폴더가 있습니다.');
      folders[folders.indexOf(cur)] = name;
      items.forEach(it => { if (it.folder === cur) it.folder = name; });
      save(); fillSelects(); $('trkFolder').value = name; Store.set('apt.curFolder', name); render();
    };
    $('btnFolderDelete').onclick = () => {
      const cur = curFolder();
      if (!cur) return U.toast('삭제할 폴더를 먼저 고르세요.');
      if (cur === BASE) return U.toast('[기본] 폴더는 삭제할 수 없습니다.');
      const n = items.filter(it => it.folder === cur).length;
      if (!confirm(`[${cur}] 폴더를 삭제할까요?` + (n ? `\n안에 있는 ${n}개 단지는 [기본] 폴더로 옮겨집니다.` : ''))) return;
      items.forEach(it => { if (it.folder === cur) it.folder = BASE; });
      folders = folders.filter(f => f !== cur);
      save(); fillSelects(); $('trkFolder').value = ''; Store.set('apt.curFolder', ''); fillSelects(); render();
    };
    $('btnTrkMove').onclick = () => {
      const to = $('trkMoveTo').value;
      if (!checked.size) return U.toast('옮길 단지를 체크하세요.');
      items.forEach(it => { if (checked.has(it.id)) it.folder = to; });
      const n = checked.size; checked.clear(); save(); fillSelects(); render();
      U.toast(`${n}개 단지를 [${to}] 폴더로 옮겼습니다.`);
    };
    $('btnTrkDelete').onclick = () => {
      if (!checked.size) return U.toast('삭제할 단지를 체크하세요.');
      if (!confirm(`선택한 ${checked.size}개 단지를 트래킹에서 삭제할까요?\n(적어 둔 가격 기록도 함께 지워집니다)`)) return;
      items = items.filter(it => !checked.has(it.id)); checked.clear(); save(); fillSelects(); render();
    };
    save(); fillSelects();
    const savedFolder = Store.get('apt.curFolder', '');
    if (folders.includes(savedFolder)) { $('trkFolder').value = savedFolder; fillSelects(); }
  }

  function fillSelects() {
    const f = $('trkFolder').value;
    $('trkFolder').innerHTML = `<option value="">전체 (${items.length})</option>` +
      folders.map(x => `<option value="${U.esc(x)}">${U.esc(x)} (${items.filter(it => it.folder === x).length})</option>`).join('');
    if (folders.includes(f)) $('trkFolder').value = f;
    $('trkMoveTo').innerHTML = folders.map(x => `<option>${U.esc(x)}</option>`).join('');
    const cur = $('trkRegion').value;
    const names = [...new Set(items.filter(it => !curFolder() || it.folder === curFolder()).map(it => `${it.sido} ${it.sgg}`))].sort((a, b) => a.localeCompare(b, 'ko'));
    $('trkRegion').innerHTML = '<option value="">전체</option>' + names.map(n => `<option>${U.esc(n)}</option>`).join('');
    if (names.includes(cur)) $('trkRegion').value = cur;
  }

  const visible = () => {
    const reg = $('trkRegion').value, f = curFolder();
    return items.filter(it => (!f || it.folder === f) && (!reg || `${it.sido} ${it.sgg}` === reg));
  };

  /** 실거래 읽기 — 최근 매매·전세 실거래, 전고점·전저점. popup=true 면 결과 창을 띄움 */
  async function load(popup) {
    const list = visible();
    if (!list.length) { if (popup) U.toast('불러올 단지가 없습니다.'); return; }
    const btn = $('btnTrkLoad');
    btn.disabled = true; btn.textContent = '불러오는 중…';
    try {
      const nowY = new Date().getFullYear();
      for (const code of new Set(list.map(it => it.code))) {
        if (popup) Data.refresh(code);                       // 버튼을 누를 때마다 최신 파일을 다시 받음
        const data = await Data.loadYears(code, Math.floor(CONFIG.PEAK_FROM / 10000), nowY);
        const mine = list.filter(it => it.code === code);
        const keys = new Set(mine.map(it => it.key));
        const bucket = new Map(mine.map(it => [it.id, { sale: null, rent: null, peak: null, trough: null }]));
        Data.eachTrade(data.sale, k => keys.has(k), (key, t) => {
          const b = bucket.get(`${code}|${key}#${t.g}`);
          if (!b || t.direct) return;                        // 직거래 제외
          if (!b.sale || t.d >= b.sale.d) b.sale = t;
          if (t.d >= CONFIG.PEAK_FROM) {
            if (!b.peak || t.price >= b.peak.price) b.peak = t;
            if (!b.trough || t.price < b.trough.price) b.trough = t;
          }
        });
        Data.eachTrade(data.rent, k => keys.has(k), (key, t) => {
          const b = bucket.get(`${code}|${key}#${t.g}`);
          if (b && (!b.rent || t.d >= b.rent.d)) b.rent = t;
        });
        for (const it of mine) { const b = bucket.get(it.id); real.set(it.id, b); if (b.sale && !it.lastSale) it.lastSale = b.sale.price; }
      }
      save();
    } finally {
      btn.disabled = false; btn.textContent = '실거래 불러오기';
    }
    if (!popup && $('trkTable').contains(document.activeElement)) return;   // 입력 중이면 표를 다시 그리지 않음
    render();
    if (popup) showReal(list);
  }

  /** 최근 실거래 창 */
  function showReal(list) {
    const cell = (t, cls) => (t ? `<td class="${cls}">${U.price(t.price)}</td><td class="c">${U.date(t.d)}</td><td>${t.floor}층</td>` : '<td>-</td><td class="c">-</td><td>-</td>');
    $('realTable').innerHTML = '<thead><tr><th class="l">단지명</th><th>평형</th><th>최근 매매 실거래</th><th class="c">거래일</th><th>층</th><th>최근 전세 실거래</th><th class="c">거래일</th><th>층</th></tr></thead><tbody>' +
      list.map(it => { const r = real.get(it.id) || {}; return `<tr><td class="l">${U.esc(it.dong)} ${U.esc(it.name)}</td><td>${it.g}㎡<small>${pyeong(it)}</small></td>${cell(r.sale, 'sale')}${cell(r.rent, 'rent')}</tr>`; }).join('') + '</tbody>';
    $('realModal').hidden = false;
  }

  /** 한 단지의 계산값 (금액 단위: 만원) */
  function compute(it) {
    const rl = real.get(it.id) || {};
    const peak = it.peakO ?? rl.peak?.price ?? null, trough = it.troughO ?? rl.trough?.price ?? null;
    const firstSale = months.map(m => it.quotes[m]?.s).find(v => v != null);
    const base = firstSale ?? rl.sale?.price ?? null;       // 현재 매매가: 가장 최근에 적은 값, 없으면 최근 실거래
    const sub = (a, b) => (a == null || b == null ? null : a - b);
    const ratio = (s, r) => (s && r ? r / s * 100 : null);
    const groups = months.map((m, k) => {
      const q = it.quotes[m] || {}, p = it.quotes[months[k + 1]] || {};   // p = 바로 앞(오른쪽) 기록
      return { s: q.s ?? null, sn: q.sn ?? null, r: q.r ?? null, rn: q.rn ?? null,
        sd: sub(q.s, p.s), rd: sub(q.r, p.r), gap: sub(q.s, q.r), gd: sub(sub(q.s, q.r), sub(p.s, p.r)),
        ratio: ratio(q.s, q.r), rtd: sub(ratio(q.s, q.r), ratio(p.s, p.r)) };
    });
    return { peak, trough, peakAuto: rl.peak || null, troughAuto: rl.trough || null, base, band: base ? CONFIG.priceBand(base) : '',
      drop: base && peak ? (base / peak - 1) * 100 : null, rise: base && trough ? (base / trough - 1) * 100 : null,
      groups, realSale: rl.sale || null, realRent: rl.rent || null };
  }

  /** 계산되는 칸들: { 칸이름: [내용, 색] } — 입력할 때마다 이 칸들만 다시 그림 */
  function calcCells(c) {
    const d = (v) => [U.diff(v), U.cls(v)];
    const out = { band: [c.band || '-', ''], drop: [U.pct(c.drop), U.cls(c.drop)], rise: [U.pct(c.rise), U.cls(c.rise)] };
    c.groups.forEach((g, k) => {
      out['sd' + k] = d(g.sd); out['rd' + k] = d(g.rd);
      out['gap' + k] = [g.gap == null ? '-' : U.price(g.gap), '']; out['gd' + k] = d(g.gd);
      out['ratio' + k] = [g.ratio == null ? '-' : g.ratio.toFixed(1) + '%', ''];
      out['rtd' + k] = [g.rtd == null ? '-' : (g.rtd > 0 ? '+' : '') + g.rtd.toFixed(1) + '%p', U.cls(g.rtd)];
    });
    return out;
  }

  function render() {
    const list = visible();
    $('trkEmpty').hidden = items.length > 0;
    $('trkTable').parentElement.hidden = !items.length;
    $('trkNoMonth').hidden = !(items.length && !months.length);
    const fx = (label, cls = '') => `<th rowspan="2" class="${cls}">${label}</th>`;
    const head = '<thead><tr>' + fx('<input type="checkbox" id="trkAll">', 'c') +
      FIXED.map((n, i) => fx(n, [1, 2, 3, 4, 5].includes(i) ? 'l' : '')).join('') +
      months.map((m, k) => `<th colspan="10" class="grp c">${ymLabel(m)}${k === 0 ? ' · 최신' : ''} <button class="mini" data-delmonth="${m}" title="이 달 기록 삭제">×</button></th>`).join('') +
      fx('지도', 'c') + '</tr><tr>' +
      months.map(() => GROUP.map((n, i) => `<th class="${[0, 1, 3, 4].includes(i) ? 'in' : ''}${i === 0 ? ' gl' : ''}">${n}${i === 0 || i === 3 ? '(억)' : ''}</th>`).join('')).join('') + '</tr></thead>';

    const inp = (it, f, cls = '', ph = '') => `<input class="${cls}" data-f="${f}" value="${U.esc(it[f] || '')}" placeholder="${ph}">`;
    const body = list.map((it, i) => {
      const c = compute(it), cells = calcCells(c);
      const [si, gu] = U.siGu(it.sido, it.sgg);
      const cell = (k, extra = '') => `<td data-c="${k}" class="${cells[k][1]} ${extra}">${cells[k][0]}</td>`;
      const over = (f, v, auto) => `<td><input class="num${it[f] != null ? ' edited' : ''}" data-o="${f}" inputmode="decimal" value="${eok(v)}" placeholder="자동" title="${auto ? `실거래 ${U.price(auto.price)} (${U.date(auto.d)}) · 눌러서 수정, 지우면 자동값` : '실거래 자료 없음 · 직접 입력'}"></td>`;
      const qin = (m, f, ph, isPrice, first) => { const v = (it.quotes[m] || {})[f]; return `<td class="${first ? 'gl' : ''}"><input class="num" data-m="${m}" data-q="${f}" inputmode="decimal" value="${isPrice ? eok(v) : (v ?? '')}" placeholder="${ph}"></td>`; };
      return `<tr data-i="${i}"><td class="c"><input type="checkbox" data-chk="${i}" ${checked.has(it.id) ? 'checked' : ''}></td>` +
        `${cell('band')}<td class="l">${U.esc(si)}</td><td class="l">${U.esc(gu)}</td><td class="l">${U.esc(it.dong)}</td><td class="l">${inp(it, 'zone', '', '생활권')}</td><td class="l name">${U.esc(it.name)}</td>` +
        `<td>${it.buildYear || '-'}</td><td>${it.buildYear ? CONFIG.toAge(it.buildYear) : '-'}</td><td>${inp(it, 'households', '', '직접 입력')}</td><td>${inp(it, 'pyeong', '', pyeong(it))}</td><td>${inp(it, 'structure', '', '계/복')}</td><td>${inp(it, 'rooms')}</td><td>${inp(it, 'baths')}</td>` +
        `<td>${inp(it, 'link', 'wide', '직접 입력')} <a class="btn mini" href="${U.esc(link(it))}" target="_blank" rel="noopener">열기</a></td>` +
        `${over('peakO', c.peak, c.peakAuto)}${cell('drop')}${over('troughO', c.trough, c.troughAuto)}${cell('rise')}` +
        months.map((m, k) => qin(m, 's', '예: 14.3', true, true) + qin(m, 'sn', '개') + cell('sd' + k) + qin(m, 'r', '예: 7.5', true) + qin(m, 'rn', '개') + cell('rd' + k) + cell('gap' + k) + cell('gd' + k) + cell('ratio' + k) + cell('rtd' + k)).join('') +
        `<td class="c"><button class="mini" data-map="${i}">위치</button></td></tr>`;
    }).join('');
    const table = $('trkTable');
    table.innerHTML = head + `<tbody>${body}</tbody>`;
    table.querySelector('#trkAll').onclick = (e) => { list.forEach(it => (e.target.checked ? checked.add(it.id) : checked.delete(it.id))); render(); $('trkAll').checked = e.target.checked; };
    table.querySelector('thead').onclick = (e) => {
      const m = +e.target.dataset.delmonth;
      if (!m) return;
      const n = items.filter(it => it.quotes[m]).length;
      if (!confirm(`${ymLabel(m)} 기록을 삭제할까요?` + (n ? `\n${n}개 단지에 적어 둔 이 달의 가격이 모두 지워집니다.` : ''))) return;
      months = months.filter(x => x !== m); items.forEach(it => { delete it.quotes[m]; }); save(); render();
    };
    const tbody = table.querySelector('tbody');
    tbody.onclick = (e) => {
      const t = e.target;
      if (t.dataset.chk != null) { const it = list[+t.dataset.chk]; t.checked ? checked.add(it.id) : checked.delete(it.id); }
      if (t.dataset.map != null) App.showMap(list[+t.dataset.map]);
    };
    tbody.onchange = (e) => {
      const t = e.target, tr = t.closest('tr');
      if (!tr || t.type === 'checkbox') return;
      const it = list[+tr.dataset.i];
      if (t.dataset.f) it[t.dataset.f] = t.value.trim();
      if (t.dataset.o) {                                     // 전고점·전저점 직접 수정 (지우면 자동값으로)
        const v = toMan(t.value), rl = real.get(it.id) || {};
        const auto = (t.dataset.o === 'peakO' ? rl.peak : rl.trough)?.price ?? null;
        if (v == null || v === auto) { delete it[t.dataset.o]; t.value = eok(auto); t.classList.remove('edited'); }
        else { it[t.dataset.o] = v; t.classList.add('edited'); }
      }
      if (t.dataset.q) {                                     // 매매·전세·매물 수 입력
        const f = t.dataset.q, m = +t.dataset.m;
        const q = it.quotes[m] = it.quotes[m] || {};
        const v = (f === 's' || f === 'r') ? toMan(t.value) : (t.value.trim() === '' || isNaN(parseInt(t.value, 10)) ? null : parseInt(t.value, 10));
        if (v == null) { delete q[f]; t.value = ''; } else q[f] = v;
        if (!Object.keys(q).length) delete it.quotes[m];
      }
      const c = compute(it), cells = calcCells(c);          // 계산 칸만 다시 그림 (입력 중인 칸은 그대로)
      if (c.base) it.lastSale = c.base;
      tr.querySelectorAll('td[data-c]').forEach(td => { const x = cells[td.dataset.c]; if (x) { td.innerHTML = x[0]; td.className = x[1]; } });
      save();
    };
  }

  /** 시세트래킹 표 엑셀 (기록한 달이 오른쪽으로 이어짐) */
  function excel() {
    const sel = visible().filter(it => checked.has(it.id));
    const list = sel.length ? sel : visible();
    if (!list.length) return U.toast('내려받을 단지가 없습니다.');
    const r1 = (v) => (v == null ? '' : +v.toFixed(1));
    const tail = ['최근 매매 실거래', '매매 실거래일', '최근 전세 실거래', '전세 실거래일', '폴더'];
    const top = [...FIXED.map(() => ''), ...months.flatMap(m => [ymLabel(m), ...GROUP.slice(1).map(() => '')]), ...tail.map(() => '')];
    const head = [...FIXED.map(n => (n === '구조' ? '구조(계,복)' : n)), ...months.flatMap(() => GROUP), ...tail];
    const rows = list.map(it => {
      const c = compute(it), [si, gu] = U.siGu(it.sido, it.sgg);
      return { sort: c.base || 0, row: [c.band, si, gu, it.dong, it.zone, it.name, it.buildYear || '', it.buildYear ? CONFIG.toAge(it.buildYear) : '', it.households, pyeong(it),
        it.structure, it.rooms, it.baths, link(it), c.peak ?? '', r1(c.drop), c.trough ?? '', r1(c.rise),
        ...c.groups.flatMap(g => [g.s ?? '', g.sn ?? '', g.sd ?? '', g.r ?? '', g.rn ?? '', g.rd ?? '', g.gap ?? '', g.gd ?? '', r1(g.ratio), r1(g.rtd)]),
        c.realSale?.price ?? '', U.date(c.realSale?.d), c.realRent?.price ?? '', U.date(c.realRent?.d), it.folder] };
    }).sort((a, b) => b.sort - a.sort).map(x => x.row);
    const f = curFolder();
    U.download(`시세트래킹_${f ? f.replace(/[\\/:*?"<>|]/g, '_') + '_' : ''}${U.stamp()}`, [
      { name: '시세트래킹', rows: [top, head, ...rows] },
      { name: '설명', rows: [['항목', '설명'], ['금액 단위', '만원'], ['매매·전세·개수', '그 달에 직접 적은 가격과 매물 수'],
        ['전월 대비', '그 달 값 - 바로 앞 기록(오른쪽 묶음) 값'], ['매-전(투자금)', '매매 - 전세'], ['전세가율', '전세 ÷ 매매 × 100 (%)'],
        ['전고점·전저점', `${String(CONFIG.PEAK_FROM).slice(0, 4)}년 이후 매매 실거래 최고가·최저가(직거래 제외). 직접 고친 값이 있으면 그 값`],
        ['전고 대비 하락률·전저 대비 상승률', '가장 최근에 적은 매매가(없으면 최근 실거래가) 기준 (%)'],
        ['최근 매매·전세 실거래', '가장 최근 실거래가와 계약일 (매매는 직거래 제외)'], ['실거래 자료', '국토교통부 실거래가 공개시스템']] },
    ], 'xlsx');
  }

  /** 담아 둔 단지의 전체 실거래 내역 (최대 20년) 내려받기 */
  async function downloadTrades() {
    const sel = visible().filter(it => checked.has(it.id));
    const list = sel.length ? sel : visible();
    if (!list.length) return U.toast('내려받을 단지가 없습니다.');
    const btn = $('btnTrkTrades');
    btn.disabled = true; btn.textContent = '불러오는 중…';
    try {
      const nowY = new Date().getFullYear();
      const head = ['구분', '시', '구', '동', '단지명', '전용㎡', '평형', '계약일', '금액(만원)', '층', '비고'];
      const rows = [head];
      for (const it of list) {
        const tr = await Data.complexTrades(it.code, it.key, it.g, nowY - 20, nowY);
        const [si, gu] = U.siGu(it.sido, it.sgg);
        for (const [kind, arr] of [['매매', tr.sale], ['전세', tr.rent]]) {
          for (let i = arr.length - 1; i >= 0; i--) { const t = arr[i]; rows.push([kind, si, gu, it.dong, it.name, t.area, pyeong(it), U.date(t.d), t.price, t.floor, t.direct ? '직거래' : '']); }
        }
      }
      if (rows.length === 1) return U.toast('수집된 실거래 내역이 없습니다.');
      U.download(`실거래내역_트래킹_${U.stamp()}`, [{ name: '실거래 내역', rows }], $('trkFormat').value);
      U.toast(`${list.length}개 단지, ${(rows.length - 1).toLocaleString()}건을 내려받았습니다.`);
    } catch (e) {
      console.error(e); U.toast('내려받기 중 오류가 났습니다: ' + (e.message || e));
    } finally {
      btn.disabled = false; btn.textContent = '실거래 내역 다운로드';
    }
  }

  function backup() {
    const blob = new Blob([JSON.stringify({ type: 'apt-tracking', savedAt: new Date().toISOString(), items, folders, months, grouping: Store.get('apt.grouping.v1', null) }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `시세트래킹_백업_${U.stamp()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function restore(e) {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      if (obj.type !== 'apt-tracking' || !Array.isArray(obj.items)) throw new Error();
      obj.items.forEach(it => { it.folder = it.folder || BASE; it.quotes = it.quotes || {}; });
      const merge = items.length && confirm('지금 목록에 합칠까요?\n[확인] 합치기  /  [취소] 백업 내용으로 바꾸기');
      items = merge ? [...items, ...obj.items.filter(n => !items.some(it => it.id === n.id))] : obj.items;
      folders = [...new Set([BASE, ...(merge ? folders : []), ...(obj.folders || []), ...items.map(it => it.folder)])];
      months = [...new Set([...(merge ? months : []), ...(obj.months || []), ...items.flatMap(it => Object.keys(it.quotes).map(Number))])].sort((a, b) => b - a);
      if (obj.grouping && (!Store.get('apt.grouping.v1', null) || !merge)) { Store.set('apt.grouping.v1', obj.grouping); Grouping.reload(); }
      save(); fillSelects(); render();
      U.toast(`백업을 불러왔습니다. (단지 ${items.length}개)`);
    } catch (err) { U.toast('백업 파일을 읽을 수 없습니다.'); }
  }

  /** 탭을 열 때: 표를 그리고, 전고점·전저점 자동 기입을 위해 실거래를 조용히 읽음 */
  function open() { fillSelects(); render(); if (visible().some(it => !real.has(it.id))) load(false); }

  /** 다른 탭(그래프)에서 쓰는: 이 단지에 적어 둔 가격 기록 [{ym, s, r}] */
  function quotesOf(id) {
    const it = items.find(x => x.id === id);
    return it ? Object.keys(it.quotes).map(Number).sort((a, b) => a - b).map(ym => ({ ym, s: it.quotes[ym].s ?? null, r: it.quotes[ym].r ?? null })) : [];
  }

  return { init, add, all, open, pyeong, quotesOf };
})();
