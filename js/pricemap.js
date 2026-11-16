/* ─────────────────────────────────────────────────────────
   pricemap.js — [시세지도] 탭
   시세트래킹에 담은 단지를 카카오맵에 올리고, 라벨에 단지명과 가격(매매·전세·매-전·전세가율)을 보여 줍니다.
   · 가격은 적어 둔 호가가 먼저, 호가가 없는 단지만 최근 실거래로 대신하며 라벨에 '·실' 이 붙습니다(주황색).
   · 라벨 겹침 방지, 끌어서 옮기기, 크기 조절, 캡처 모드는 js/maplabel.js 가 맡습니다.
   · 단지 좌표는 저장하지 않고 열 때마다 다시 찾습니다.
   ───────────────────────────────────────────────────────── */
const PriceMap = (() => {
  const $ = (id) => document.getElementById(id);
  const SKEY = 'apt.pmOpts.v1', UKEY = 'apt.pmLabels.v1', XKEY = 'apt.pmExtra.v1', SENT = '(직접 추가·전수조사 단지)';
  const LAND = 'apt.land.v1';                                  // 랜드마크 탭 목록 (☆ 과 같은 목록)
  const LKEY = 'apt.pmLandmarks.v1';                           // 예전 지도 전용 ☆ 목록 (한 번 옮긴 뒤 비움)
  const DKEY = 'apt.pmDirect.v1';                              // 직접 추가한 단지
  const HKEY = 'apt.pmHidden.v1', MCKEY = 'apt.pmChecked.v1', TCKEY = 'apt.trkChecked.v1';   // 지도에서 숨김 · 지도에서 체크 · 시세트래킹 체크
  const SIZE = 'apt.pmSize.v1';                                // 지도 크기 { w: 가로 %, h: 세로 px }
  const VIEWS = [['all', '전체'], ['trk', '시세트래킹'], ['lm', '랜드마크'], ['sent', '전수조사 선택'], ['mine', '직접 추가'], ['chk', '내가 선택']];
  let view = 'all', lastRows = [], notFound = '', countBase = 0;
  let baseItems = [], pick = null;     // pick: 검색으로 고른 단지 (아직 추가 전)
  const userItems = () => Store.get(UKEY, []).map(u => ({ id: u.id, pos: { lat: u.lat, lng: u.lng }, text: u.text, color: u.color || '#8e8e93', rank: 0, user: true }));
  let map = null, ctrl = null, inited = false, seq = 0;
  let byId = new Map();

  const eok = (v) => (v == null ? '-' : +(v / 10000).toFixed(2) + '억');

  function fillFolders() {
    const folders = Tracking.exportAll().folders || [], cur = $('pmFolder').value || Store.get(SKEY, {}).folder || '';
    const sent = Store.get(XKEY, []).length + Store.get(DKEY, []).length;
    $('pmFolder').innerHTML = '<option value="">시세트래킹 전체' + (sent ? ' + 전수조사에서 보낸 단지' : '') + '</option>' + folders.map(f => `<option>${U.esc(f)}</option>`).join('') + (sent ? `<option>${SENT}</option>` : '');
    if (folders.includes(cur) || (sent && cur === SENT)) $('pmFolder').value = cur;
    $('btnPmClearSent').hidden = !sent;
    const ms = Tracking.getMonths().slice().sort((a, b) => b - a), cm = $('pmMonth').value || Store.get(SKEY, {}).month || '';
    $('pmMonth').innerHTML = '<option value="">최신 호가</option>' + ms.map(m => `<option value="${m}">${Kit.ymText(m)}</option>`).join('');
    if (ms.map(String).includes(String(cm))) $('pmMonth').value = cm;
  }
  const saveOpts = () => Store.set(SKEY, { folder: $('pmFolder').value, show: $('pmShow').value, name: $('pmName').value, month: $('pmMonth').value, view });
  const setOf = (k) => new Set(Store.get(k, []));
  const landMap = () => Store.get(LAND, {});
  const landSet = () => new Set(Object.keys(landMap()));
  /** ☆: 랜드마크 탭과 같은 목록(apt.land.v1)에 넣거나 뺌. 탭이 열려 있어도 바로 맞춰짐 */
  function toggleLand(row, on) {
    const m = landMap();
    if (on) { if (!m[row.id]) m[row.id] = { grade: CONFIG.GRADES[0].k, name: row.name, sido: row.sido || '', sgg: row.sgg || '', dong: row.dong || '', jibun: row.jibun || '', t: Date.now() }; }
    else delete m[row.id];
    Store.set(LAND, m); if (typeof Land !== 'undefined') Land.reload();
  }
  const toggleSet = (k, id, on) => { const s = setOf(k); on ? s.add(id) : s.delete(id); Store.set(k, [...s]); };
  const labelHidden = (id) => !!(Store.get('apt.mapLabel.v1', {})[`map:${id}`] || {}).hide;
  /** 라벨만 숨기기: 지도 라벨 저장값의 hide 표시를 켜거나 끔 (숨긴 라벨 보이기 버튼과 같은 값) */
  function setLabelHidden(id, on) {
    const a = Store.get('apt.mapLabel.v1', {}), k = `map:${id}`;
    if (on) a[k] = { ...(a[k] || {}), hide: true };
    else if (a[k]) { delete a[k].hide; if (!Object.keys(a[k]).length) delete a[k]; }
    Store.set('apt.mapLabel.v1', a);
  }
  function fillViews() { $('pmViews').innerHTML = VIEWS.map(([k, n]) => `<button class="${k === view ? 'primary' : ''}" data-view="${k}">${n}</button>`).join(''); }
  /** 지도만 다시 그림 (위치·가격은 다시 찾지 않음). 지도에서 숨긴 단지는 뺌 */
  function refreshMap() {
    const hid = setOf(HKEY), vis = baseItems.filter(i => !hid.has(i.id)).length;
    if (ctrl) ctrl.set([...baseItems.filter(i => !hid.has(i.id)), ...userItems()]);
    $('pmCount').textContent = `${vis}개 단지 표시 중` + (baseItems.length - vis ? ` (지도에서 숨긴 ${baseItems.length - vis}개)` : '') + notFound;
  }
  /** 개별 단지 목록: 체크(지도 전용 선택), 지도 보이기, 라벨 보이기, ★ 랜드마크 */
  function renderList() {
    const mc = setOf(MCKEY), hid = setOf(HKEY), lm = landSet(), sent = setOf(XKEY), mine = setOf(DKEY);
    $('pmListTable').innerHTML = '<thead><tr><th>체크</th><th>지도</th><th>라벨</th><th>★</th><th class="l">단지</th><th>평형</th><th class="l">출처</th></tr></thead><tbody>' +
      lastRows.map(r => `<tr><td><input type="checkbox" data-mc="${U.esc(r.id)}" ${mc.has(r.id) ? 'checked' : ''}></td>` +
        `<td><input type="checkbox" data-mh="${U.esc(r.id)}" ${!hid.has(r.id) ? 'checked' : ''} ${r.pos ? '' : 'disabled'} title="끄면 지도에서 빠집니다"></td>` +
        `<td><input type="checkbox" data-pl="${U.esc(r.id)}" ${!labelHidden(r.id) ? 'checked' : ''} ${r.pos ? '' : 'disabled'} title="끄면 이 단지의 라벨만 숨깁니다"></td>` +
        `<td><button class="mini" data-lm="${U.esc(r.id)}" title="랜드마크로 지정하거나 해제">${lm.has(r.id) ? '★' : '☆'}</button></td>` +
        `<td class="l">${U.esc(r.name)}${r.pos ? '' : ' <small>(위치 없음)</small>'}</td><td>${r.g}㎡</td>` +
        `<td class="l">${[r.tracked ? '시세트래킹' : '', sent.has(r.id) ? '전수조사' : '', mine.has(r.id) ? '직접 추가' : '', lm.has(r.id) ? '랜드마크' : ''].filter(Boolean).join(' · ') || '-'}</td></tr>`).join('') + '</tbody>';
  }

  /** 라벨에 쓸 글자 */
  function textOf(r, dup) {
    const mode = $('pmShow').value, nm = $('pmName').value;
    const sfx = dup ? ` ${CONFIG.toPyeong(r.g)}평` : '';
    let val = '', real = false;
    if (mode === 's') { val = eok(r.s); real = r.s != null && !r.sQ; }
    else if (mode === 'r') { val = eok(r.r); real = r.r != null && !r.rQ; }
    else if (mode === 'gap') { val = r.gap == null ? '-' : eok(r.gap); real = r.gap != null && !(r.sQ && r.rQ); }
    else if (mode === 'ratio') { val = r.ratio == null ? '-' : r.ratio.toFixed(0) + '%'; real = r.ratio != null && !(r.sQ && r.rQ); }
    if (mode === 'none' || nm === 'name') return { text: r.name + sfx, real: false };
    const tail = val + (real ? '·실' : '');
    return { text: nm === 'val' ? tail : `${r.name}${sfx} ${tail}`, real };
  }

  function card(r) {
    const c = (k, v, s = '', cls = '') => `<div class="card"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="s">${s}</div></div>`;
    const rl = r.rl || {};
    $('pmCard').innerHTML = [
      c('단지', U.esc(r.name), `${U.esc(r.sgg)} ${U.esc(r.dong)} · ${r.g}㎡(${CONFIG.toPyeong(r.g)}평)${r.hh ? ` · ${r.hh.toLocaleString()}세대` : ''}`),
      c('매매', r.s == null ? '-' : U.price(r.s), r.sQ ? `적어 둔 호가 (${Kit.ymText(r.q.ym)})` : (rl.sale ? `최근 실거래 ${U.date(rl.sale.d)}` : ''), 'sale'),
      c('전세', r.r == null ? '-' : U.price(r.r), r.rQ ? '적어 둔 호가' : (rl.rent ? `최근 실거래 ${U.date(rl.rent.d)}` : ''), 'rent'),
      c('전세가율 · 매-전', r.ratio == null ? '-' : r.ratio.toFixed(0) + '%', r.gap == null ? '' : '투자금 ' + U.price(r.gap)),
      c('전고 대비', U.pct(r.drop), rl.peak ? `전고점 ${U.price(rl.peak.price)} (${U.date(rl.peak.d)})` : '', U.cls(r.drop)),
    ].join('') + `<div style="grid-column:1/-1">${typeof Loc !== 'undefined' ? Loc.summary(r) : ''}</div>`;
  }

  async function draw() {
    const my = ++seq, msg = $('pmMapMsg'), folder = $('pmFolder').value;
    const say = (html) => { msg.innerHTML = html; msg.hidden = false; };
    saveOpts();
    const sentIds = new Set(Store.get(XKEY, []));
    let list = await Kit.records(true);                                                       // 시세트래킹 단지
    const have = new Set(list.map(x => x.id)), regs = await Kit.regions();
    const oldL = Store.get(LKEY, []);                           // 예전 지도 전용 ☆ 목록 → 랜드마크 탭 목록으로 한 번 옮김
    if (oldL.length) {
      const m = landMap();
      oldL.forEach(id => { if (!m[id]) { const q = Kit.parseId(id), reg = regs.get(q.code); m[id] = { grade: CONFIG.GRADES[0].k, name: q.name, sido: reg?.[1] || '', sgg: reg?.[2] || '', dong: q.dong, jibun: q.jibun, t: Date.now() }; } });
      Store.set(LAND, m); Store.set(LKEY, []); if (typeof Land !== 'undefined') Land.reload();
    }
    const mineIds = setOf(DKEY), lmSet = landSet();
    for (const id of new Set([...sentIds, ...mineIds, ...lmSet])) if (!have.has(id)) {                    // + 전수조사에서 보낸 단지·랜드마크 (호가는 전수조사에 적은 값)
      const q = Kit.parseId(id), reg = regs.get(q.code);
      list.push({ ...q, sido: reg?.[1] || '', sgg: reg?.[2] || '', rec: Tracking.rec(id) || { quotes: {} }, tracked: false });
    }
    if (folder === SENT) list = list.filter(x => sentIds.has(x.id) || mineIds.has(x.id));
    else if (folder) list = list.filter(x => x.tracked && (x.rec.folders || []).includes(folder));
    $('pmEmpty').hidden = list.length > 0; $('pmBody').hidden = !list.length;
    if (!list.length) return;
    const mcSet = setOf(MCKEY), tcSet = setOf(TCKEY);
    if (view === 'trk') list = list.filter(x => x.tracked);
    else if (view === 'lm') list = list.filter(x => lmSet.has(x.id));
    else if (view === 'sent') list = list.filter(x => sentIds.has(x.id));
    else if (view === 'mine') list = list.filter(x => mineIds.has(x.id));
    else if (view === 'chk') list = list.filter(x => mcSet.has(x.id) || tcSet.has(x.id));
    if (!list.length) { baseItems = []; lastRows = []; renderList(); refreshMap(); $('pmCount').textContent = ''; return say('이 보기에 해당하는 단지가 없습니다.'); }
    if (!KMap.ready()) return say(KMap.needKeyHtml);
    say(`가격을 불러오는 중… (${list.length}개 단지)`);
    await Real.load(list);
    if (my !== seq) return;
    const rows = list.map(My.calc), ym = $('pmMonth').value;
    if (ym) rows.forEach(r => {                       // 기준 달을 고르면 그 달에 적은 호가로 (없으면 최근 실거래로 대신하고 '·실' 표시)
      const q = r.rec?.quotes?.[ym] || {}, rl = r.rl || {};
      r.s = q.s ?? rl.sale?.price ?? null; r.sQ = q.s != null; r.r = q.r ?? rl.rent?.price ?? null; r.rQ = q.r != null;
      r.gap = r.s != null && r.r != null ? r.s - r.r : null; r.ratio = r.s && r.r ? r.r / r.s * 100 : null;
    });
    byId = new Map(rows.map(r => [r.id, r]));
    try {
      await KMap.load();
      let n = 0;
      const queue = [...rows];
      await Promise.all(Array.from({ length: 4 }, async () => {       // 4개씩 동시에 위치 찾기
        while (queue.length) { const r = queue.shift(); r.pos = await KMap.geocode(r); if (my !== seq) return; say(`단지 위치를 찾는 중… (${++n}/${rows.length})`); }
      }));
    } catch (e) { return say(U.esc(e.message || String(e))); }
    if (my !== seq) return;
    const ok = rows.filter(r => r.pos);
    if (!ok.length) return say('단지 위치를 찾지 못했습니다.');
    msg.hidden = true;
    if (!map) {
      applySize();
      map = KMap.create($('pmMap'), ok[0].pos, 7);
      ctrl = MapLabel.create({ key: 'map', map, panel: $('pmPanel'), ctl: $('pmCtl'), onPick: (it) => { if (!it.user) card(byId.get(it.id)); },
        onAdd: (pos) => {                             // [＋ 라벨 추가] → 지도를 누른 자리에 메모 라벨
          const text = (prompt('라벨에 적을 글자 (예: GTX-A 예정역, 학원가, 재개발 구역)') || '').trim(); if (!text) return;
          const l = Store.get(UKEY, []); l.push({ id: 'u:' + Date.now().toString(36), lat: +pos.lat.toFixed(6), lng: +pos.lng.toFixed(6), text }); Store.set(UKEY, l);
          ctrl.set([...baseItems, ...userItems()]);
        },
        onDelete: (id) => { Store.set(UKEY, Store.get(UKEY, []).filter(u => u.id !== id)); ctrl.set([...baseItems, ...userItems()]); } });
    }
    const cnt = new Map(); ok.forEach(r => cnt.set(`${r.code}|${r.key}`, (cnt.get(`${r.code}|${r.key}`) || 0) + 1));
    const items = ok.map(r => {
      const t = textOf(r, cnt.get(`${r.code}|${r.key}`) > 1);
      return { id: r.id, pos: r.pos, text: t.text, color: t.real ? '#f5a742' : '#4f9cff', rank: 0 };
    });
    map.relayout();
    baseItems = items;
    lastRows = rows;
    renderList();
    refreshMap();
    const hidNow = setOf(HKEY), shownRows = ok.filter(r => !hidNow.has(r.id));
    notFound = ok.length < rows.length ? ` · 위치를 못 찾은 ${rows.length - ok.length}개 제외` : '';
    $('pmTable').innerHTML = '<thead><tr><th class="l">지역</th><th class="l">단지</th><th>평형</th><th>매매</th><th>매매 기준</th><th>전세</th><th>전세 기준</th><th>매-전</th><th>전세가율</th><th>전고 대비</th><th>구분</th></tr></thead><tbody>' +
      shownRows.map(r => `<tr><td class="l">${U.esc(r.sgg)} ${U.esc(r.dong)}</td><td class="l">${U.esc(r.name)}</td><td>${r.g}㎡</td><td>${r.s == null ? '-' : U.price(r.s)}</td><td>${r.s == null ? '' : r.sQ ? '호가' : '실거래'}</td><td>${r.r == null ? '-' : U.price(r.r)}</td><td>${r.r == null ? '' : r.rQ ? '호가' : '실거래'}</td>` +
        `<td>${r.gap == null ? '-' : U.price(r.gap)}</td><td>${r.ratio == null ? '-' : r.ratio.toFixed(0) + '%'}</td><td>${U.pct(r.drop)}</td><td>${r.tracked ? '시세트래킹' : '전수조사'}</td></tr>`).join('') + '</tbody>';
    if (ok.length > 1) KMap.fit(map, ok.map(r => r.pos)); else { map.setCenter(KMap.LL(ok[0].pos)); map.setLevel(5); }
    refreshMap();
    if (!$('pmCard').innerHTML) card(ok[0]);
  }

  /* ── 단지 직접 추가: 검색해서 고른 단지를 XKEY 목록(지도에 올라가는 추가 단지)에 넣습니다 ── */
  async function pickComplex(x) {
    pick = x;
    const ar = await Finder.areas(x.code, x.key);
    const list = ar.list.length ? ar.list : [{ g: 84, n: 0 }];
    $('pmAddArea').innerHTML = list.map(a => `<option value="${a.g}" ${a.g === ar.best ? 'selected' : ''}>${a.g}㎡ (${CONFIG.toPyeong(a.g)}평)${a.n ? ` · ${a.n}건` : ''}</option>`).join('');
    $('btnPmAdd').disabled = false;
    $('pmAddHint').textContent = `${x.name} 선택됨. 평형을 고른 뒤 [지도에 추가]를 누르세요.`;
  }
  function addPicked() {
    if (!pick) return;
    const g = +$('pmAddArea').value, id = `${pick.code}|${pick.key}#${g}`;
    const cur = Store.get(DKEY, []);
    if (cur.includes(id) || Store.get(XKEY, []).includes(id)) return U.toast('이미 지도에 올라간 단지·평형입니다.');
    Store.set(DKEY, [...cur, id]);
    U.toast(`${pick.name} ${CONFIG.toPyeong(g)}평을 지도에 추가했습니다.`);
    pick = null; $('pmAddFind').value = ''; $('btnPmAdd').disabled = true;
    $('pmAddHint').textContent = '시세트래킹에 없는 단지도 골라서 지도에 올릴 수 있습니다.';
    fillFolders(); renderAdded(); draw();
  }
  /** 추가한 단지는 접어 두고, 한 줄 요약(개수)만 보여 줍니다. 펼치면 목록 */
  function renderAdded() {
    const ids = Store.get(DKEY, []), box = $('pmAddedBox');
    box.hidden = !ids.length;
    $('pmAddedSum').textContent = `직접 추가한 단지 ${ids.length}개 (눌러서 보기·빼기)`;
    $('pmAdded').innerHTML = ids.map(id => { const q = Kit.parseId(id); return `<span style="border:1px solid var(--line);border-radius:12px;padding:1px 4px 1px 8px;font-size:12px;white-space:nowrap">${U.esc(q.name)} ${CONFIG.toPyeong(q.g)}평 <button class="mini" data-rm="${U.esc(id)}" title="지도에서 빼기">✕</button></span>`; }).join('');
  }

  function init() {
    const o = Store.get(SKEY, {});
    Finder.attach($('pmAddFind'), pickComplex);
    $('btnPmAdd').onclick = addPicked;
    $('pmAddFind').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    $('pmAdded').onclick = (e) => {
      const id = e.target.closest('button[data-rm]')?.dataset.rm; if (!id) return;
      Store.set(DKEY, Store.get(DKEY, []).filter(x => x !== id));
      fillFolders(); renderAdded(); draw();
    };
    renderAdded();
    if (o.show) $('pmShow').value = o.show;
    if (o.name) $('pmName').value = o.name;
    if (o.view) view = o.view;
    fillViews();
    $('pmViews').onclick = (e) => { const b = e.target.closest('button[data-view]'); if (!b) return; view = b.dataset.view; fillViews(); draw(); };
    $('pmListTable').onchange = (e) => {
      const t = e.target;
      if (t.dataset.mc != null) { toggleSet(MCKEY, t.dataset.mc, t.checked); if (view === 'chk') return draw(); return renderList(); }
      if (t.dataset.mh != null) { toggleSet(HKEY, t.dataset.mh, !t.checked); renderList(); return refreshMap(); }
      if (t.dataset.pl != null) { setLabelHidden(t.dataset.pl, !t.checked); return refreshMap(); }
    };
    $('pmListTable').onclick = (e) => { const id = e.target.closest('button[data-lm]')?.dataset.lm; if (id == null) return; const row = lastRows.find(r => r.id === id) || { id, ...Kit.parseId(id) }; toggleLand(row, !landSet().has(id)); draw(); };
    $('btnPmMapAllOn').onclick = () => { const s = setOf(HKEY); lastRows.forEach(r => s.delete(r.id)); Store.set(HKEY, [...s]); renderList(); refreshMap(); };
    $('btnPmMapAllOff').onclick = () => { const s = setOf(HKEY); lastRows.forEach(r => { if (r.pos) s.add(r.id); }); Store.set(HKEY, [...s]); renderList(); refreshMap(); };
    $('pmFolder').onchange = $('pmMonth').onchange = draw;
    $('btnPmClearSent').onclick = () => { if (!confirm('직접 추가·전수조사에서 보낸 단지를 시세지도에서 모두 뺄까요? (원래 기록은 그대로입니다)')) return; Store.set(XKEY, []); Store.set(DKEY, []); fillFolders(); renderAdded(); draw(); };
    // 저장함: 라벨 위치·모양·메모 라벨·보낸 단지·표시 설정을 통째로 (예: "2026-11 평촌 지도")
    Saves.register('map', { name: '시세지도', hint: '라벨 위치·크기·글씨체·모양, 직접 추가한 메모 라벨, 표시 설정(폴더·기준 달)을 저장합니다. 달마다 한 번씩 저장해 두면 그때의 지도를 다시 볼 수 있습니다.',
      note: () => `${$('pmFolder').value || '전체'} · ${$('pmMonth').selectedOptions[0]?.text || '최신 호가'} · ${$('pmCount').textContent}`,
      get: () => { const all = Store.get('apt.mapLabel.v1', {}), mine = {}; Object.keys(all).filter(k => k.startsWith('map:')).forEach(k => { mine[k] = all[k]; });
        return { opts: Store.get(SKEY, {}), labels: mine, user: Store.get(UKEY, []), sent: Store.get(XKEY, []), dir: Store.get(DKEY, []), size: Store.get(SIZE, {}), hid: Store.get(HKEY, []), chk: Store.get(MCKEY, []) }; },
      set: (d) => { const all = Store.get('apt.mapLabel.v1', {}); Object.keys(all).filter(k => k.startsWith('map:')).forEach(k => delete all[k]); Object.assign(all, d.labels || {});
        Store.set('apt.mapLabel.v1', all); Store.set(SKEY, d.opts || {}); Store.set(UKEY, d.user || []); Store.set(XKEY, d.sent || []); Store.set(DKEY, d.dir || []); Store.set(SIZE, d.size || {}); Store.set(HKEY, d.hid || []); Store.set(MCKEY, d.chk || []);
        sessionStorage.setItem('apt.openTab', 'map'); setTimeout(() => location.reload(), 400); } });
    $('pmShow').onchange = $('pmName').onchange = () => { saveOpts(); if (map) draw(); };
    $('btnPmRefresh').onclick = draw;
    // 지도 크기: 가로(40~100%)·세로(300~900px) 슬라이더. 바꿀 때마다 지도와 라벨 위치를 다시 맞춤
    $('pmMapW').oninput = () => setSize({ w: +$('pmMapW').value });
    $('pmMapH').oninput = () => setSize({ h: +$('pmMapH').value });
    $('btnPmSize').onclick = () => { Store.set(SIZE, {}); applySize(); };
    applySize();
    inited = true;
  }
  /** 지도 크기 저장값을 화면에 적용 (저장값이 없으면 CSS 기본 크기) */
  function applySize() {
    const s = Store.get(SIZE, {}), el = $('pmMap');
    if (!el) return;
    const w = s.w ?? 100;
    el.style.width = w + '%'; el.style.margin = '0 auto';
    el.style.height = s.h ? s.h + 'px' : '';
    const h = Math.round(s.h || el.getBoundingClientRect().height || 500);
    $('pmMapW').value = w; $('pmMapWV').textContent = w + '%';
    $('pmMapH').value = Math.min(900, Math.max(300, h)); $('pmMapHV').textContent = h + 'px';
    if (map) { map.relayout(); setTimeout(() => { if (ctrl) ctrl.relayout(); }, 120); }   // 지도 크기가 바뀌면 라벨 위치도 다시 맞춤
  }
  function setSize(patch) { Store.set(SIZE, { ...Store.get(SIZE, {}), ...patch }); applySize(); }
  function open() { if (!inited) return; fillFolders(); renderAdded(); draw(); }
  /** 전수조사 탭에서 체크한 단지를 지도로 보냄. 새로 들어간 개수를 돌려줌 */
  function send(ids) { const cur = new Set(Store.get(XKEY, [])), before = cur.size; ids.forEach(id => cur.add(id)); Store.set(XKEY, [...cur]); return cur.size - before; }
  return { init, open, send };
})();
