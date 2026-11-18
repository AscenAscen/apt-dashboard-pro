/* ─────────────────────────────────────────────────────────
   common.js — 여러 탭이 함께 쓰는 공통 기능
   ① Saves    : 저장함 (폴더 · 저장 · 불러오기 · 수정 · 삭제). 큰 저장소(IndexedDB)에 담기고 백업 파일에도 들어갑니다.
   ② Xl       : 화면에 보이는 표를 그대로 엑셀로 받기 (탭마다 [이 탭 엑셀], 가이드·설정의 [전체 내보내기])
   ③ Sizer    : 표·지도·그래프 상자의 크기를 끌어서 조절 + 표 글자 크기 (단지 비교 · 비교 평가 · 시세그룹핑)
   ④ Stations : 역 관리 (직선거리를 재는 기준 역. 추가 · 체크로 숨김 · 삭제). 단지 비교·비교 평가·입지 분석이 같이 씁니다.
   ⑤ TabTools : 위 기능의 버튼 줄을 탭 맨 위에 붙임

   새 탭에 저장함을 붙이려면:  Saves.register('탭id', { name: '탭 이름', get: () => 저장할 값, set: (값) => 화면에 되살리기 })
   값이 Store 의 몇 개 이름에 다 들어 있는 탭이면:  Saves.register('탭id', { name, keys: ['apt.xxx.v1', …] })
   ───────────────────────────────────────────────────────── */

/* ═════════ ② 엑셀 ═════════ */
const Xl = (() => {
  const clean = (t) => String(t || '').replace(/[\[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  function cellText(c) {
    const f = c.querySelector('input:not([type=checkbox]):not([type=radio]), select, textarea');
    if (f && c.children.length <= 2 && !c.querySelector('b, small, span')) return f.tagName === 'SELECT' ? (f.selectedOptions[0]?.text || '') : f.value;
    const cb = c.querySelector('input[type=checkbox]');
    if (cb && !c.innerText.trim()) return cb.checked ? '✓' : '';
    let t = c.innerText.replace(/\s*\n\s*/g, ' ').trim();
    if (f && !t) t = f.tagName === 'SELECT' ? (f.selectedOptions[0]?.text || '') : f.value;
    return t;
  }
  /** 표 하나 → 줄 배열 (칸 합치기는 빈 칸으로 채움) */
  function tableRows(tb) {
    const out = [];
    for (const tr of tb.rows) {
      if (tr.hidden || tr.offsetParent === null && tb.offsetParent !== null) continue;
      const row = [];
      for (const c of tr.cells) { row.push(cellText(c)); for (let i = 1; i < (c.colSpan || 1); i++) row.push(''); }
      if (row.some(v => v !== '')) out.push(row);
    }
    return out;
  }
  /** root 안에 보이는 표들 → [{ name, rows }] */
  function scrape(root, prefix = '') {
    const sheets = [], used = new Set();
    root.querySelectorAll('table').forEach((tb, i) => {
      if (tb.offsetParent === null || tb.closest('.fdrop, .cmodal')) return;
      const rows = tableRows(tb);
      if (rows.length < 2) return;
      const title = tb.dataset.title || tb.closest('.panel, section, details')?.querySelector('.bar strong, summary, h3')?.textContent || tb.id || `표${i + 1}`;
      let name = clean(prefix + title).slice(0, 28) || `표${i + 1}`, n = 2;
      while (used.has(name)) name = clean(prefix + title).slice(0, 25) + ' ' + n++;
      used.add(name); sheets.push({ name, rows });
    });
    return sheets;
  }
  function tab(id, label) {
    const sheets = scrape(document.getElementById('tab-' + id));
    if (!sheets.length) return U.toast('받을 표가 없습니다. 먼저 조회하거나 내용을 채워 주세요.');
    U.download(`${label}_${U.stamp()}`, sheets);
  }
  /** 전체 내보내기: 보이는 탭을 차례로 열어 표를 모음 (한 파일, 탭별 시트) */
  async function all() {
    const cur = document.querySelector('#tabs button.on')?.dataset.tab, sheets = [], used = new Set();
    const btns = [...document.querySelectorAll('#tabs button')].filter(b => !b.hidden && b.offsetParent !== null);
    const cover = document.createElement('div'); cover.className = 'xlcover'; document.body.appendChild(cover);
    try {
      for (const b of btns) {
        cover.textContent = `엑셀로 모으는 중… ${b.textContent.trim()} (${btns.indexOf(b) + 1}/${btns.length})`;
        App.showTab(b.dataset.tab);
        await new Promise(r => setTimeout(r, 1100));
        for (const s of scrape(document.getElementById('tab-' + b.dataset.tab), b.textContent.trim().slice(0, 6) + '-')) {
          let name = s.name, n = 2; while (used.has(name)) name = s.name.slice(0, 26) + ' ' + n++;
          used.add(name); sheets.push({ name, rows: s.rows });
        }
      }
    } finally { cover.remove(); if (cur) App.showTab(cur); }
    if (!sheets.length) return U.toast('받을 표가 없습니다.');
    U.download(`전체_내보내기_${U.stamp()}`, sheets);
    U.toast(`${sheets.length}개 표를 한 파일에 담았습니다. (지도·그래프와, 조회하지 않아 비어 있는 화면은 빠집니다)`);
  }
  return { scrape, tableRows, tab, all, clean };
})();

/* ═════════ ① 저장함 ═════════ */
const Saves = (() => {
  const reg = new Map(), FKEY = 'apt.saveFolders.v1', BASE = '기본';
  let box = null, curTab = null, curFolder = '', list = [];
  const folders = () => { const f = Store.get(FKEY, [BASE]); return f.includes(BASE) ? f : [BASE, ...f]; };
  const esc = (t) => U.esc(t == null ? '' : String(t));
  const when = (t) => { const d = new Date(t); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

  function register(tab, o) {
    if (o.keys) {
      const keys = o.keys;
      o.get = o.get || (() => { const d = {}; keys.forEach(k => { const v = Store.get(k, null); if (v != null) d[k] = v; }); return d; });
      o.set = o.set || ((d) => { keys.forEach(k => { if (d[k] != null) Store.set(k, d[k]); else Store.remove(k); }); sessionStorage.setItem('apt.openTab', tab); U.toast('불러왔습니다. 화면을 다시 엽니다.'); setTimeout(() => location.reload(), 500); });
    }
    reg.set(tab, o);
  }
  const has = (tab) => reg.has(tab);

  function build() {
    box = document.createElement('div'); box.className = 'cmodal'; box.hidden = true;
    box.innerHTML = `<div class="cbox"><div class="bar"><strong data-s="title">저장함</strong><span class="grow"></span><button data-s="close">닫기</button></div>
      <p class="hint" data-s="hint"></p>
      <div class="filters">
        <label>이름 <input data-s="name" placeholder="예: 평촌 84㎡ 비교 (11월)"></label>
        <label>폴더 <select data-s="folder"></select></label>
        <button class="primary" data-s="save">지금 화면 저장</button>
        <span class="sep"></span>
        <button data-s="fnew">+ 새 폴더</button><button data-s="fren">폴더 이름 바꾸기</button><button class="danger" data-s="fdel">폴더 삭제</button>
      </div>
      <div class="chips" data-s="chips" style="margin:10px 0"></div>
      <div class="tablewrap short"><table data-s="table"></table></div></div>`;
    document.body.appendChild(box);
    const q = (k) => box.querySelector(`[data-s="${k}"]`);
    box.addEventListener('click', async (e) => {
      if (e.target === box) return close();
      const k = e.target.dataset.s, id = e.target.closest('tr')?.dataset.id, rec = id && list.find(x => x.id === id);
      if (k === 'close') return close();
      if (k === 'chip') { curFolder = e.target.dataset.f; return render(); }
      if (k === 'fnew') { const n = (prompt('새 폴더 이름') || '').trim(); if (!n) return; if (folders().includes(n)) return U.toast('같은 이름의 폴더가 있습니다.'); Store.set(FKEY, [...folders(), n]); curFolder = n; return render(); }
      if (k === 'fren') {
        if (!curFolder || curFolder === BASE) return U.toast('이름을 바꿀 폴더를 아래에서 먼저 고르세요. (기본 폴더는 바꿀 수 없습니다)');
        const n = (prompt('폴더의 새 이름', curFolder) || '').trim(); if (!n || n === curFolder) return;
        if (folders().includes(n)) return U.toast('같은 이름의 폴더가 있습니다.');
        for (const r of (await Store.saves.all()).filter(x => x.folder === curFolder)) await Store.saves.put({ ...r, folder: n });
        Store.set(FKEY, folders().map(f => (f === curFolder ? n : f))); curFolder = n; return render();
      }
      if (k === 'fdel') {
        if (!curFolder || curFolder === BASE) return U.toast('지울 폴더를 아래에서 먼저 고르세요. (기본 폴더는 지울 수 없습니다)');
        const inside = (await Store.saves.all()).filter(x => x.folder === curFolder);
        if (!confirm(`"${curFolder}" 폴더를 지울까요?` + (inside.length ? `\n안에 있는 저장 ${inside.length}개는 "기본" 폴더로 옮겨집니다.` : ''))) return;
        for (const r of inside) await Store.saves.put({ ...r, folder: BASE });
        Store.set(FKEY, folders().filter(f => f !== curFolder)); curFolder = ''; return render();
      }
      if (k === 'save') {
        const name = q('name').value.trim(); if (!name) return U.toast('저장할 이름을 적어 주세요.');
        await put({ id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), tab: curTab, folder: q('folder').value || BASE, name, t: Date.now() });
        q('name').value = ''; U.toast(`"${name}" 저장했습니다.`); return render();
      }
      if (!rec) return;
      if (k === 'load') {
        if (!confirm(`"${rec.name}" 을(를) 불러올까요?\n지금 화면의 내용은 저장해 둔 내용으로 바뀝니다. 지금 내용이 필요하면 먼저 [지금 화면 저장]을 하세요.`)) return;
        close();
        try { await reg.get(rec.tab).set(rec.data); U.toast(`"${rec.name}" 불러왔습니다.`); } catch (err) { console.error(err); U.toast('불러오지 못했습니다: ' + (err.message || err)); }
      }
      if (k === 'over') { if (!confirm(`"${rec.name}" 에 지금 화면을 덮어쓸까요? 예전 내용은 사라집니다.`)) return; await put({ ...rec, t: Date.now() }); U.toast('덮어썼습니다.'); render(); }
      if (k === 'edit') {
        const n = prompt('이름 바꾸기', rec.name); if (n == null) return;
        const fs = folders(), f = prompt(`폴더 (${fs.join(', ')} 중 하나. 없는 이름을 적으면 새로 만듭니다)`, rec.folder); if (f == null) return;
        const nf = f.trim() || BASE; if (!fs.includes(nf)) Store.set(FKEY, [...fs, nf]);
        await Store.saves.put({ ...rec, name: n.trim() || rec.name, folder: nf }); render();
      }
      if (k === 'xl') { if (!rec.sheets?.length) return U.toast('이 저장에는 표가 없습니다.'); U.download(`${Xl.clean(rec.name)}_${U.stamp()}`, rec.sheets); }
      if (k === 'del') { if (!confirm(`"${rec.name}" 저장을 지울까요? 되돌릴 수 없습니다.`)) return; await Store.saves.del(rec.id); render(); }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && box && !box.hidden) close(); });
  }
  /** 지금 화면 값을 담아 저장 (보이는 표도 함께 담아 두어, 나중에 그 표만 엑셀로 받을 수 있음) */
  async function put(rec) {
    const o = reg.get(rec.tab);
    rec.data = await o.get();
    try { rec.sheets = Xl.scrape(document.getElementById('tab-' + rec.tab)).slice(0, 12); } catch (e) { rec.sheets = []; }
    if (o.note) rec.note = o.note();
    await Store.saves.put(rec);
  }
  async function render() {
    const q = (k) => box.querySelector(`[data-s="${k}"]`), o = reg.get(curTab), fs = folders();
    list = (await Store.saves.all()).filter(x => x.tab === curTab).sort((a, b) => b.t - a.t);
    q('title').textContent = `💾 저장함 — ${o.name}`;
    q('hint').textContent = `${o.hint || '지금 화면을 이름을 붙여 저장해 두고, 나중에 다시 불러옵니다.'} 이 브라우저에 저장되며 백업 파일·코드에도 함께 들어갑니다.`;
    q('folder').innerHTML = fs.map(f => `<option ${f === (curFolder || BASE) ? 'selected' : ''}>${esc(f)}</option>`).join('');
    q('chips').innerHTML = `<button class="${curFolder ? '' : 'on'}" data-s="chip" data-f="">전체 (${list.length})</button>` + fs.map(f => `<button class="${curFolder === f ? 'on' : ''}" data-s="chip" data-f="${esc(f)}">📁 ${esc(f)} (${list.filter(x => x.folder === f).length})</button>`).join('');
    const rows = list.filter(x => !curFolder || x.folder === curFolder);
    q('table').innerHTML = '<thead><tr><th class="l">이름</th><th class="l">폴더</th><th>저장한 때</th><th class="c">관리</th></tr></thead><tbody>' + (rows.length ? rows.map(r =>
      `<tr data-id="${r.id}"><td class="l"><b>${esc(r.name)}</b>${r.note ? `<small>${esc(r.note)}</small>` : ''}</td><td class="l">${esc(r.folder)}</td><td>${when(r.t)}</td>` +
      `<td class="c"><button class="mini primary" data-s="load">불러오기</button> <button class="mini" data-s="over">덮어쓰기</button> <button class="mini" data-s="edit">수정</button> <button class="mini" data-s="xl">엑셀</button> <button class="mini danger" data-s="del">삭제</button></td></tr>`).join('')
      : '<tr><td colspan="4" style="color:var(--sub);padding:18px">아직 저장한 것이 없습니다. 위에 이름을 적고 [지금 화면 저장]을 누르세요.</td></tr>') + '</tbody>';
  }
  function open(tab) { if (!reg.has(tab)) return; if (!box) build(); curTab = tab; box.hidden = false; render(); }
  function close() { if (box) box.hidden = true; }
  /* 백업 파일용 */
  const exportAll = async () => ({ folders: folders(), items: await Store.saves.all() });
  async function importAll(o, merge) {
    if (!o || !Array.isArray(o.items)) return 0;
    if (!merge) for (const r of await Store.saves.all()) await Store.saves.del(r.id);
    for (const r of o.items) if (r && r.id && r.tab) await Store.saves.put(r);
    Store.set(FKEY, [...new Set([...(merge ? folders() : [BASE]), ...(o.folders || [])])]);
    return o.items.length;
  }
  return { register, has, open, exportAll, importAll };
})();

/* ═════════ ③ 크기 조절 ═════════ */
const Sizer = (() => {
  const KEY = 'apt.sizes.v1', ZKEY = 'apt.tabZoom.v1';
  const SEL = '.tablewrap, .kmap, .chartbox, .chart';
  let ro = null, timer = null;
  const keyOf = (tab, el, i) => `${tab}:${el.id || el.querySelector('table[id], canvas[id]')?.id || el.className.split(' ')[0] + i}`;
  function apply(tab) {
    const root = document.getElementById('tab-' + tab); if (!root) return;
    const sizes = Store.get(KEY, {}), z = Store.get(ZKEY, {})[tab] || 1;
    root.style.setProperty('--tz', z);
    root.classList.add('sizable');
    if (!ro && window.ResizeObserver) ro = new ResizeObserver((ents) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const s = Store.get(KEY, {}); let dirty = false;
        for (const en of ents) { const el = en.target, k = el.dataset.sz; if (!k || (!el.style.width && !el.style.height) || el.offsetParent === null) continue;
          const v = { w: el.style.width || '', h: el.style.height || '' }; if (!s[k] || s[k].w !== v.w || s[k].h !== v.h) { s[k] = v; dirty = true; } }
        if (dirty) Store.set(KEY, s);
      }, 400);
    });
    root.querySelectorAll(SEL).forEach((el, i) => {
      if (el.dataset.sz) return;
      const k = keyOf(tab, el, i); el.dataset.sz = k; el.classList.add('sz');
      if (sizes[k]) { if (sizes[k].w) el.style.width = sizes[k].w; if (sizes[k].h) { el.style.height = sizes[k].h; el.style.maxHeight = 'none'; } }
      if (ro) ro.observe(el);
    });
  }
  function zoom(tab, d) {
    const z = Store.get(ZKEY, {}); z[tab] = d === 0 ? 1 : Math.min(2, Math.max(0.6, +((z[tab] || 1) + d).toFixed(2))); Store.set(ZKEY, z);
    document.getElementById('tab-' + tab).style.setProperty('--tz', z[tab]);
    U.toast(`표 글자 크기 ${Math.round(z[tab] * 100)}%`);
  }
  function reset(tab) {
    const s = Store.get(KEY, {}); Object.keys(s).filter(k => k.startsWith(tab + ':')).forEach(k => delete s[k]); Store.set(KEY, s);
    document.getElementById('tab-' + tab).querySelectorAll('[data-sz]').forEach(el => { el.style.width = el.style.height = el.style.maxHeight = ''; });
    zoom(tab, 0);
  }
  return { apply, zoom, reset };
})();

/* ═════════ ④ 역 관리 ═════════ */
const Stations = (() => {
  const KEY = 'apt.stations.v1', OLD = 'apt.hubs.v1';
  const COLORS = ['#ff3b30', '#34c759', '#ffcc00', '#5ac8fa', '#af52de', '#ff9500', '#ff2d55', '#30d158', '#64d2ff', '#bf5af2'];
  // 기본 7개 역 (좌표 고정). 이름·목록은 [역 관리]에서 바꿀 수 있습니다.
  const DEFAULTS = [
    { name: '강남역', lat: 37.497942, lng: 127.027621 },
    { name: '여의도역', lat: 37.521624, lng: 126.924191 },
    { name: '시청역', lat: 37.565715, lng: 126.977088 },
    { name: '광화문역', lat: 37.571026, lng: 126.976669 },
    { name: '판교역', lat: 37.394761, lng: 127.111217 },
    { name: '디지털미디어시티역 (DMC)', lat: 37.577475, lng: 126.900187 },
    { name: '마곡역', lat: 37.560183, lng: 126.825448 },
  ];
  const memo = new Map();          // 검색어 → 좌표 (이번 접속 동안만. 저장하지 않음)
  let box = null, onChange = [];
  function all() {
    let list = Store.get(KEY, null);
    if (!list) {
      const old = Store.get(OLD, {}), custom = Object.keys(old).map(k => old[k]).filter(x => x && x.q);
      list = [...custom.map(x => ({ name: x.name || x.q, q: x.q, on: true })), ...DEFAULTS.map(d => ({ ...d, on: !custom.length }))];
    }
    return list;
  }
  const save = (list) => { Store.set(KEY, list); onChange.forEach(f => { try { f(); } catch (e) { console.error(e); } }); };
  async function locate(st) {
    if (st.lat != null) return { lat: st.lat, lng: st.lng };
    const q = st.q || st.name;
    if (memo.has(q)) return memo.get(q);
    if (!KMap.ready()) return null;
    try {
      await KMap.load();
      const S = kakao.maps.services;
      const p = await new Promise(res => new S.Places().keywordSearch(q, (r, s) => res(s === S.Status.OK && r.length ? { lat: +r[0].y, lng: +r[0].x } : null)));
      memo.set(q, p); return p;
    } catch (e) { console.error(e); return null; }
  }
  /** 체크된 역 목록 [{ name, lat, lng, color }] — 예전 Settings.hubs() 와 같은 모양 */
  async function hubs() {
    const out = [], list = all();
    for (let i = 0; i < list.length; i++) { if (!list[i].on) continue; const p = await locate(list[i]); if (p) out.push({ name: list[i].name, ...p, color: COLORS[i % COLORS.length] }); }
    return out.length ? out : DEFAULTS.slice(0, 3).map((d, i) => ({ ...d, color: COLORS[i] }));
  }
  function html() {
    return `<div class="strows">` + all().map((s, i) => `<div class="strow" data-i="${i}"><label class="inline"><input type="checkbox" data-st="on" ${s.on ? 'checked' : ''}> <b>${U.esc(s.name)}</b></label>
      <small>${s.lat != null ? '기본 역' : '검색어: ' + U.esc(s.q || s.name)}</small><span class="grow"></span>
      <button class="mini" data-st="up" title="위로">▲</button><button class="mini" data-st="down" title="아래로">▼</button><button class="mini danger" data-st="del">삭제</button></div>`).join('') + `</div>
      <div class="filters" style="margin-top:10px"><label>역·기준점 이름 <input data-st="name" placeholder="예: 서울역, 부산 서면역"></label><label>지도 검색어 (비우면 이름으로 찾음) <input data-st="q" placeholder="예: 부산 서면역"></label>
      <button class="primary" data-st="add">+ 추가</button><button data-st="reset">기본 7개로 되돌리기</button></div>
      <p class="hint">체크한 역만 직선거리에 나옵니다. 체크를 끄면 숨김(목록에는 남음), [삭제]는 목록에서 없앱니다. 단지 비교 · 비교 평가 · 입지 분석이 이 목록을 함께 씁니다. 추가한 역의 위치는 저장하지 않고 열 때마다 카카오맵에서 다시 찾습니다.</p>`;
  }
  /** el 안에 역 관리 화면을 그리고 동작을 붙임 */
  function mount(el) {
    const draw = () => { el.innerHTML = html(); };
    draw();
    el.onchange = (e) => { if (e.target.dataset.st !== 'on') return; const l = all(), i = +e.target.closest('.strow').dataset.i; l[i].on = e.target.checked; save(l); };
    el.onclick = (e) => {
      const k = e.target.dataset.st; if (!k || k === 'on') return;
      const l = all(), row = e.target.closest('.strow'), i = row ? +row.dataset.i : -1;
      if (k === 'del') { if (!confirm(`"${l[i].name}" 을(를) 목록에서 지울까요?`)) return; l.splice(i, 1); }
      else if (k === 'up' && i > 0) [l[i - 1], l[i]] = [l[i], l[i - 1]];
      else if (k === 'down' && i < l.length - 1) [l[i + 1], l[i]] = [l[i], l[i + 1]];
      else if (k === 'add') {
        const name = el.querySelector('[data-st="name"]').value.trim(), qv = el.querySelector('[data-st="q"]').value.trim();
        if (!name && !qv) return U.toast('역 이름을 적어 주세요.');
        if (l.some(s => s.name === (name || qv))) return U.toast('이미 있는 이름입니다.');
        l.push({ name: name || qv, q: qv || name, on: true });
      }
      else if (k === 'reset') { if (!confirm('역 목록을 기본 7개로 되돌릴까요? 직접 추가한 역은 사라집니다.')) return; l.length = 0; DEFAULTS.forEach(d => l.push({ ...d, on: true })); }
      else return;
      save(l); draw();
    };
  }
  function open() {
    if (!box) {
      box = document.createElement('div'); box.className = 'cmodal';
      box.innerHTML = '<div class="cbox"><div class="bar"><strong>🚇 역 관리</strong><span class="grow"></span><button data-x>닫기</button></div><div data-body></div></div>';
      document.body.appendChild(box);
      box.addEventListener('click', (e) => { if (e.target === box || e.target.dataset.x != null) box.hidden = true; });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') box.hidden = true; });
    }
    mount(box.querySelector('[data-body]')); box.hidden = false;
  }
  return { all, hubs, mount, open, DEFAULTS, onChange: (f) => onChange.push(f) };
})();

/* ═════════ ⑤ 탭 위쪽 공통 버튼 줄 ═════════ */
const TabTools = (() => {
  const TABS = ['compare', 'eval', 'infra', 'survey', 'map', 'grouping', 'land', 'trends', 'supply', 'supplymap', 'migration', 'market', 'my'];     // 버튼 줄을 붙일 탭
  const SIZED = ['compare', 'eval', 'grouping'], STATION = ['compare', 'eval', 'infra'];
  const done = new Set();
  function attach(tab) {
    const root = document.getElementById('tab-' + tab); if (!root) return;
    const label = document.querySelector(`#tabs button[data-tab="${tab}"]`)?.textContent.trim().replace(/\s*\d+$/, '') || tab;
    if (!done.has(tab)) {
      done.add(tab);
      const bar = document.createElement('div'); bar.className = 'tabtools';
      bar.innerHTML = (Saves.has(tab) ? '<button data-tt="save">💾 저장함</button>' : '') + '<button data-tt="xl">📥 이 탭 엑셀</button>' +
        (STATION.includes(tab) ? '<button data-tt="st">🚇 역 관리</button>' : '') +
        (SIZED.includes(tab) ? '<span class="sep"></span><span class="hint" style="margin:0">표 글자</span><button data-tt="zm" title="표 글자 작게">－</button><button data-tt="zp" title="표 글자 크게">＋</button><button data-tt="zr" title="끌어서 바꾼 크기와 글자 크기를 처음으로">크기 초기화</button><span class="hint" style="margin:0">· 표·지도·그래프 상자는 오른쪽 아래 모서리를 끌어 크기를 바꿉니다</span>' : '');
      bar.onclick = (e) => { const k = e.target.dataset.tt;
        if (k === 'save') Saves.open(tab); if (k === 'xl') Xl.tab(tab, label); if (k === 'st') Stations.open();
        if (k === 'zm') Sizer.zoom(tab, -0.1); if (k === 'zp') Sizer.zoom(tab, 0.1); if (k === 'zr') Sizer.reset(tab); };
      root.insertBefore(bar, root.firstChild);
    }
    if (SIZED.includes(tab)) Sizer.apply(tab);
  }
  /** 탭을 열 때마다 불림 (app.js) */
  const open = (tab) => { if (!TABS.includes(tab)) return; try { attach(tab); if (SIZED.includes(tab)) setTimeout(() => Sizer.apply(tab), 1500); } catch (e) { console.error(e); } };
  return { open };
})();

/* ═════════ ⑥ 직접 만드는 표 (비교 평가 탭의 [표 추가]) ═════════
   행·열 수를 정해 빈 표를 만들고 칸을 직접 채웁니다. 첫 줄은 제목 줄. 저장: Store 의 key (기본 apt.evalTables.v1) */
const UserTables = (() => {
  function mount(el, key) {
    if (!el) return;
    const all = () => Store.get(key, []), save = (l) => Store.set(key, l);
    const draw = () => {
      const list = all();
      el.innerHTML = `<div class="bar"><strong>직접 만든 표</strong><span class="hint" style="margin:0">— 행과 열을 정해 표를 만들고 칸을 눌러 적습니다. 첫 줄은 제목 줄입니다.</span><span class="grow"></span><button class="primary" data-ut="new">+ 표 추가</button></div>` +
        (list.length ? list.map((t, ti) => `<div class="utable" data-ti="${ti}"><div class="filters" style="margin:10px 0 6px"><b>${U.esc(t.name)}</b><span class="grow"></span>
          <button class="mini" data-ut="row+">행 추가</button><button class="mini" data-ut="col+">열 추가</button><button class="mini" data-ut="row-">마지막 행 삭제</button><button class="mini" data-ut="col-">마지막 열 삭제</button>
          <button class="mini" data-ut="ren">이름 바꾸기</button><button class="mini danger" data-ut="del">표 삭제</button></div>
          <div class="tablewrap short"><table data-title="${U.esc(t.name)}"><tbody>${t.cells.map((row, r) => `<tr>${row.map((v, c) => `<${r ? 'td' : 'th'}><input class="utcell" data-r="${r}" data-c="${c}" value="${U.esc(v)}" placeholder="${r ? '' : '제목'}"></${r ? 'td' : 'th'}>`).join('')}</tr>`).join('')}</tbody></table></div></div>`).join('')
          : '<p class="hint">아직 만든 표가 없습니다. [+ 표 추가]를 눌러 보세요. (예: 단지별 장단점 표, 임장 후 점수표)</p>');
      if (typeof Sizer !== 'undefined') Sizer.apply('eval');
    };
    el.onclick = (e) => {
      const k = e.target.dataset.ut; if (!k) return;
      const list = all(), ti = +e.target.closest('.utable')?.dataset.ti, t = list[ti];
      if (k === 'new') {
        const name = (prompt('표 이름', `표 ${list.length + 1}`) || '').trim(); if (!name) return;
        const rows = Math.min(50, Math.max(1, parseInt(prompt('행(가로줄) 수 — 제목 줄 빼고', '4'), 10) || 4)), cols = Math.min(15, Math.max(1, parseInt(prompt('열(세로줄) 수', '4'), 10) || 4));
        list.push({ id: 't' + Date.now(), name, cells: Array.from({ length: rows + 1 }, () => Array(cols).fill('')) });
      } else if (!t) return;
      else if (k === 'row+') t.cells.push(Array(t.cells[0].length).fill(''));
      else if (k === 'col+') t.cells.forEach(r => r.push(''));
      else if (k === 'row-') { if (t.cells.length <= 2) return U.toast('행이 하나뿐입니다.'); if (t.cells[t.cells.length - 1].some(v => v) && !confirm('마지막 행에 적은 내용이 있습니다. 지울까요?')) return; t.cells.pop(); }
      else if (k === 'col-') { if (t.cells[0].length <= 1) return U.toast('열이 하나뿐입니다.'); if (t.cells.some(r => r[r.length - 1]) && !confirm('마지막 열에 적은 내용이 있습니다. 지울까요?')) return; t.cells.forEach(r => r.pop()); }
      else if (k === 'ren') { const n = (prompt('표 이름', t.name) || '').trim(); if (!n) return; t.name = n; }
      else if (k === 'del') { if (!confirm(`"${t.name}" 표를 지울까요? 되돌릴 수 없습니다.`)) return; list.splice(ti, 1); }
      save(list); draw();
    };
    el.onchange = (e) => { const c = e.target; if (!c.classList.contains('utcell')) return; const list = all(), t = list[+c.closest('.utable').dataset.ti]; t.cells[+c.dataset.r][+c.dataset.c] = c.value; save(list); };
    draw();
  }
  return { mount };
})();

/* ── 네이버페이 부동산 링크: 누르면 단지 이름을 복사해 두고 안내 (CONFIG.landLink 가 만든 주소의 #q=단지이름) ── */
const LandLink = (() => {
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* 아래 예전 방식 */ }
    try {
      const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok;
    } catch (e) { return false; }
  }
  const nameOf = (href) => { const m = /fin\.land\.naver\.com[^#]*#q=([^&]*)/.exec(href || ''); return m ? decodeURIComponent(m[1]) : null; };
  async function note(name) {
    if (!name) return;
    const ok = await copy(name);
    U.toast(CONFIG.LAND_SEARCH ? `네이버페이 부동산에서 「${name}」 검색 결과를 엽니다.`
      : ok ? `「${name}」 이름을 복사했습니다 → 네이버페이 부동산 위쪽 검색칸에 붙여넣기(Ctrl+V) 후 Enter` : `네이버페이 부동산 검색칸에 「${name}」 을(를) 입력하세요.`);
  }
  /** 버튼에서 직접 열 때 (window.open 대신) */
  function open(sgg, dong, name) { const url = CONFIG.landLink(sgg, dong, name); note(nameOf(url)); window.open(url, '_blank', 'noopener'); }
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href*="fin.land.naver.com"]'); if (!a) return;
    note(nameOf(a.href));
  }, true);
  return { open, nameOf };
})();
