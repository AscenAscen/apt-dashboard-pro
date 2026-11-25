/* ─────────────────────────────────────────────────────────
   pricemap.js — [시세지도] 탭 = 시세트래킹에 담긴 단지를 지도로 보는 화면
   · 단지가 들어오는 길은 시세트래킹 하나. 지도에서 추가한 단지는 시세트래킹 '지도 추가' 폴더에 담김
   · 필터: 폴더 칩 · 권역 · 금액대 (시세트래킹과 같은 기준)
   · ★ 랜드마크 층: 켜면 랜드마크 탭 단지를 회색 ★ 라벨로 겹쳐 보여 줌 (가격 없음)
   · 라벨을 누르면 작은 창에서 이번 달 호가를 바로 적음 → 시세트래킹에 저장
   · 가격은 적어 둔 호가가 먼저, 없으면 최근 실거래로 대신하며 라벨에 '·실' 이 붙습니다(주황색).
   · 라벨 겹침 방지·끌어 옮기기·크기·캡처 모드는 js/maplabel.js (🎨 꾸미기 서랍 안)
   ───────────────────────────────────────────────────────── */
const PriceMap = (() => {
  const $ = (id) => document.getElementById(id);
  const SKEY = 'apt.pmOpts.v1', UKEY = 'apt.pmLabels.v1', XKEY = 'apt.pmExtra.v1';
  const LAND = 'apt.land.v1';                                  // 랜드마크 탭 목록
  const LKEY = 'apt.pmLandmarks.v1';                           // 예전 지도 전용 ☆ 목록 (한 번 옮긴 뒤 비움)
  const DKEY = 'apt.pmDirect.v1';                              // 예전 '직접 추가' 목록 (지도 추가 폴더로 옮긴 뒤 보관만)
  const HKEY = 'apt.pmHidden.v1', TCKEY = 'apt.trkChecked.v1';  // 지도에서 숨김 · 시세트래킹 체크
  const SIZE = 'apt.pmSize.v1', MIG = 'apt.pmMigrated.v1', PINKEY = 'apt.trkPins.v1';
  const MAPF = '지도 추가';                                     // 지도에서 추가한 단지가 담기는 폴더
  let lastRows = [], notFound = '';
  let baseItems = [], pick = null;
  const userItems = () => Store.get(UKEY, []).map(u => ({ id: u.id, pos: { lat: u.lat, lng: u.lng }, text: u.text, color: u.color || '#8e8e93', rank: 0, user: true }));
  let map = null, ctrl = null, inited = false, seq = 0, lmRows = [];
  let byId = new Map();

  const eok = (v) => (v == null ? '-' : +(v / 10000).toFixed(2) + '억');
  const opts = () => Store.get(SKEY, {});
  const saveOpts = () => Store.set(SKEY, { ...opts(), folder: $('pmFolder').value, zone: $('pmZone').value, band: $('pmBand').value, show: $('pmShow').value, name: $('pmName').value, month: $('pmMonth').value, lm: $('pmLm').checked ? 1 : 0, sub: $('pmSub').value });
  const setOf = (k) => new Set(Store.get(k, []));
  const landMap = () => Store.get(LAND, {});
  const landSet = () => new Set(Object.keys(landMap()));
  function toggleLand(row, on) {
    const m = landMap();
    if (on) { if (!m[row.id]) m[row.id] = { grade: CONFIG.GRADES[0].k, name: row.name, sido: row.sido || '', sgg: row.sgg || '', dong: row.dong || '', jibun: row.jibun || '', t: Date.now() }; }
    else delete m[row.id];
    Store.set(LAND, m); if (typeof Land !== 'undefined') Land.reload();
  }
  const toggleSet = (k, id, on) => { const s = setOf(k); on ? s.add(id) : s.delete(id); Store.set(k, [...s]); };
  const labelHidden = (id) => !!(Store.get('apt.mapLabel.v1', {})[`map:${id}`] || {}).hide;
  function setLabelHidden(id, on) {
    const a = Store.get('apt.mapLabel.v1', {}), k = `map:${id}`;
    if (on) a[k] = { ...(a[k] || {}), hide: true };
    else if (a[k]) { delete a[k].hide; if (!Object.keys(a[k]).length) delete a[k]; }
    Store.set('apt.mapLabel.v1', a);
  }

  /** 폴더 칩 (시세트래킹과 같은 규칙: 빈 폴더 숨김 · 📌 고정 · +n 더보기) + 기준 달 */
  function fillFolders() {
    const all = Tracking.all ? Tracking.all() : [], folders = Tracking.folderList(), cur = $('pmFolder').value || opts().folder || '';
    const valid = !cur || folders.includes(cur), f0 = valid ? cur : '';
    $('pmFolder').innerHTML = '<option value=""></option>' + folders.map(f => `<option>${U.esc(f)}</option>`).join('');
    $('pmFolder').value = f0;
    const pins = Store.get(PINKEY, []), cnt = (f) => all.filter(it => it.folders.includes(f)).length;
    const chip = (v, label, n) => `<button data-pf="${U.esc(v)}" class="${v === f0 ? 'on' : ''}">${U.esc(label)} <b>${n}</b></button>`;
    const order = [...folders].sort((a, b) => (pins.includes(b) - pins.includes(a))), box = $('pmFolders');
    const draw1 = (list) => {
      const rest = folders.filter(f => !list.includes(f));
      box.innerHTML = chip('', '전체', all.length) + list.map(f => chip(f, f, cnt(f))).join('') +
        (rest.length ? `<select class="fmore"><option value="">폴더 더보기 (${rest.length}) ▾</option>${rest.map(f => `<option value="${U.esc(f)}">${U.esc(f)} (${cnt(f)})</option>`).join('')}</select>` : '');
    };
    draw1(order.filter(f => pins.includes(f) || f === f0 || cnt(f)));          // 한 줄을 넘으면 고정·지금 폴더만 칩으로
    const first = box.querySelector('button');
    if (first && box.offsetParent && box.scrollHeight > first.offsetHeight * 1.7) draw1(order.filter(f => pins.includes(f) || f === f0));
    const ms = Tracking.getMonths().slice().sort((a, b) => b - a), cm = $('pmMonth').value || opts().month || '';
    $('pmMonth').innerHTML = '<option value="">최신 호가</option>' + ms.map(m => `<option value="${m}">${Kit.ymText(m)}</option>`).join('');
    if (ms.map(String).includes(String(cm))) $('pmMonth').value = cm;
  }
  /** 지도만 다시 그림 (위치·가격은 다시 찾지 않음). 지도에서 숨긴 단지는 뺌 */
  function refreshMap() {
    const hid = setOf(HKEY), vis = baseItems.filter(i => !hid.has(i.id) && !i.lm).length, nlm = baseItems.filter(i => i.lm).length;
    if (ctrl) ctrl.set([...baseItems.filter(i => !hid.has(i.id)), ...userItems()]);
    const nh = baseItems.filter(i => hid.has(i.id)).length;
    $('pmCount').textContent = `· ${vis}개 단지 표시 중` + (nlm ? ` + 랜드마크 ${nlm}개` : '') + (nh ? ` (지도에서 숨긴 ${nh}개)` : '') + notFound;
  }
  /** 단지 목록 (서랍): 지도 보이기 · 라벨 보이기 · ★ 랜드마크 */
  function renderList() {
    const hid = setOf(HKEY), lm = landSet();
    $('pmListTable').innerHTML = '<thead><tr><th>지도</th><th>라벨</th><th>★</th><th class="l">단지</th><th>평형</th></tr></thead><tbody>' +
      lastRows.map(r => `<tr><td><input type="checkbox" data-mh="${U.esc(r.id)}" ${!hid.has(r.id) ? 'checked' : ''} ${r.pos ? '' : 'disabled'} title="끄면 지도에서 빠집니다"></td>` +
        `<td><input type="checkbox" data-pl="${U.esc(r.id)}" ${!labelHidden(r.id) ? 'checked' : ''} ${r.pos ? '' : 'disabled'} title="끄면 이 단지의 라벨만 숨깁니다"></td>` +
        `<td><button class="mini" data-lm="${U.esc(r.id)}" title="랜드마크로 지정하거나 해제">${lm.has(r.id) ? '★' : '☆'}</button></td>` +
        `<td class="l">${U.esc(r.name)}${r.pos ? '' : ' <small>(위치 없음)</small>'}</td><td>${r.g}㎡</td></tr>`).join('') + '</tbody>';
  }

  /** 라벨에 쓸 글자 */
  const C_S = '#d95926', C_R = '#199e70';                       // 매매 주황 · 전세 청록 (그래프와 같은 색)
  const eokS = (v) => (v == null ? '-' : +(v / 10000).toFixed(2) + '억');
  /** 라벨 내용: text(한 줄, 예전 모양) + name·lines·sub·compact(말풍선 카드·두 값 모드) */
  function labelOf(r, dup) {
    const mode = $('pmShow').value, nm = $('pmName').value, base = textOf(r, dup);
    const name = nm === 'val' ? '' : r.name + (dup ? ` ${CONFIG.toPyeong(r.g)}평` : '');
    const S = { label: '매', val: eokS(r.s), col: C_S, real: r.s != null && !r.sQ }, R = { label: '전', val: eokS(r.r), col: C_R, real: r.r != null && !r.rQ };
    if (mode === 'none' || nm === 'name') return { ...base };
    if (mode === 'sr' || mode === 'srg') {
      const lines = mode === 'sr' ? [S, R] : [{ ...S, label: '', big: true }, { ...R, label: '전세', big: false }];
      let sub = '';
      if (mode === 'srg') { const sb = $('pmSub').value, g = r.gap == null ? '-' : eokS(r.gap), rt = r.ratio == null ? '-' : r.ratio.toFixed(0) + '%';
        sub = sb === 'g' ? `투자금 ${g}` : sb === 'r' ? `전세가율 ${rt}` : `투자금 ${g} · ${rt}`; }
      const text = `${name} 매 ${S.val}${S.real ? '·실' : ''} / 전 ${R.val}${R.real ? '·실' : ''}`.trim();
      return { text, real: S.real, name, lines, sub, compact: [{ val: S.val.replace('억', ''), col: C_S }, { val: R.val.replace('억', ''), col: C_R }] };
    }
    const one = mode === 's' ? S : mode === 'r' ? R : mode === 'gap' ? { label: '투자금', val: r.gap == null ? '-' : eokS(r.gap), col: '#3987e5', real: r.gap != null && !(r.sQ && r.rQ) }
      : { label: '전세가율', val: r.ratio == null ? '-' : r.ratio.toFixed(0) + '%', col: '#3987e5', real: r.ratio != null && !(r.sQ && r.rQ) };
    return { ...base, name, lines: [{ ...one, label: mode === 's' || mode === 'r' ? '' : one.label }], compact: [{ val: one.val, col: one.col }] };
  }
  /** 전고 대비 하락률 · 전저 대비 상승률 (시세트래킹 표와 같은 기준: 직접 고친 전고점·전저점 우선) */
  function rates(r) {
    const rl = r.rl || {}, rec = r.rec || {};
    const peak = rec.peakO ?? rl.peak?.price ?? null, trough = rec.troughO ?? rl.trough?.price ?? null;
    return { drop: r.s != null && peak ? (r.s / peak - 1) * 100 : null, rise: r.s != null && trough ? (r.s / trough - 1) * 100 : null };
  }
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

  /* ── 라벨을 누르면 나오는 작은 창 ── */
  const curYm = () => { const ms = Tracking.getMonths(); if (ms.length) return Math.max(...ms); const t = new Date(); return t.getFullYear() * 100 + t.getMonth() + 1; };
  const inEok = (v) => (v == null ? '' : String(+(v / 10000).toFixed(4)));
  const toMan = (t) => { const n = parseFloat(String(t).replace(/,/g, '')); return t === '' || isNaN(n) ? null : Math.round(n * 10000); };
  function closePop() { $('pmPop').hidden = true; $('pmPop').innerHTML = ''; }
  function popup(it) {
    const box = $('pmPop');
    if (it.lm) {
      const L = lmRows.find(x => x.id === it.lm); if (!L) return;
      box.innerHTML = `<div class="pphead"><b>★ ${U.esc(L.name)}</b> <small>${CONFIG.toPyeong(L.g)}평 · 랜드마크</small><span class="grow"></span><button class="mini" data-pp="close">✕</button></div>
        <p class="hint" style="margin:6px 0">랜드마크는 기준점이라 가격 라벨이 없습니다. 시세트래킹에 담으면 <b>${MAPF}</b> 폴더에 들어가 가격 라벨이 생깁니다.</p>
        <div class="bar"><button class="primary" data-pp="lmadd" data-id="${U.esc(L.id)}">시세트래킹에 담기</button></div>`;
      box.hidden = false; return;
    }
    const r = byId.get(it.id); if (!r) return;
    card(r);
    const ym = curYm(), q = (r.rec && r.rec.quotes && r.rec.quotes[ym]) || {}, rl = r.rl || {}, inMap = (r.rec.folders || []).includes(MAPF);
    box.innerHTML = `<div class="pphead"><b>${U.esc(r.name)}</b> <small>${r.g}㎡ (${CONFIG.toPyeong(r.g)}평) · ${U.esc(r.sgg)} ${U.esc(r.dong)}</small><span class="grow"></span><button class="mini" data-pp="close">✕</button></div>
      <div class="ppgrid"><span>최근 매매 실거래</span><b>${rl.sale ? `${U.price(rl.sale.price)} <small>${U.date(rl.sale.d)}</small>` : '-'}</b>
        <span>최근 전세 실거래</span><b>${rl.rent ? `${U.price(rl.rent.price)} <small>${U.date(rl.rent.d)}</small>` : '-'}</b>
        <span>전고점 대비</span><b class="${U.cls(r.drop)}">${U.pct(r.drop)}${rl.peak ? ` <small>(전고 ${U.price(rl.peak.price)})</small>` : ''}</b></div>
      <div class="ppin"><span class="hint" style="margin:0">${Kit.ymText(ym)} 호가 (억)</span>
        <label>매매 <input id="ppS" inputmode="decimal" value="${inEok(q.s)}" placeholder="예: 7.5"></label>
        <label>전세 <input id="ppR" inputmode="decimal" value="${inEok(q.r)}" placeholder="예: 4.2"></label>
        <button class="primary" data-pp="save" data-id="${U.esc(r.id)}">저장</button></div>
      <div class="bar"><button data-cx="${U.esc(r.id)}">단지 요약</button><button data-pp="table" data-id="${U.esc(r.id)}">시세트래킹 표에서 보기</button><button data-pp="hide" data-id="${U.esc(r.id)}">지도에서 숨기기</button>${inMap ? `<button data-pp="out" data-id="${U.esc(r.id)}">${MAPF} 폴더에서 빼기</button>` : ''}</div>`;
    box.hidden = false;
    setTimeout(() => { const s = $('ppS'); if (s && !s.value) s.focus(); }, 30);
  }
  async function popAct(e) {
    const b = e.target.closest('button[data-pp]'); if (!b) return;
    const act = b.dataset.pp, id = b.dataset.id;
    if (act === 'close') return closePop();
    if (act === 'save') {
      const s = toMan($('ppS').value), r = toMan($('ppR').value);
      if (($('ppS').value && s == null) || ($('ppR').value && r == null)) return U.toast('숫자로 적어 주세요. 예: 7.5');
      Tracking.setQuote(id, curYm(), { s, r }); U.toast('호가를 저장했습니다. (시세트래킹에도 반영)'); closePop(); fillFolders(); return draw();
    }
    if (act === 'table') { closePop(); if (typeof App !== 'undefined' && App.showTab) App.showTab('tracking'); setTimeout(() => Tracking.focus(id), 250); return; }
    if (act === 'hide') { toggleSet(HKEY, id, true); closePop(); renderList(); return refreshMap(); }
    if (act === 'out') {
      const only = (Tracking.rec(id)?.folders || []).length <= 1;
      if (only && !confirm(`이 단지는 '${MAPF}' 폴더에만 있어서, 빼면 시세트래킹에서도 지워집니다. 계속할까요?`)) return;
      Tracking.removeFrom(id, MAPF); closePop(); fillFolders(); return draw();
    }
    if (act === 'lmadd') {
      const L = lmRows.find(x => x.id === id); if (!L) return;
      Tracking.add([L], MAPF, true); U.toast(`${L.name}을(를) 시세트래킹 '${MAPF}' 폴더에 담았습니다.`); closePop(); fillFolders(); return draw();
    }
  }

  async function draw() {
    const my = ++seq, msg = $('pmMapMsg'), folder = $('pmFolder').value, zone = $('pmZone').value;
    const say = (html) => { msg.innerHTML = html; msg.hidden = false; };
    saveOpts(); closePop();
    let list = await Kit.records(true);                                     // 시세트래킹 단지만
    const regs = await Kit.regions();
    const oldL = Store.get(LKEY, []);
    if (oldL.length) {
      const m = landMap();
      oldL.forEach(id => { if (!m[id]) { const q = Kit.parseId(id), reg = regs.get(q.code); m[id] = { grade: CONFIG.GRADES[0].k, name: q.name, sido: reg?.[1] || '', sgg: reg?.[2] || '', dong: q.dong, jibun: q.jibun, t: Date.now() }; } });
      Store.set(LAND, m); Store.set(LKEY, []); if (typeof Land !== 'undefined') Land.reload();
    }
    const total = list.length;
    if (folder) list = list.filter(x => (x.rec.folders || []).includes(folder));
    if (zone) list = list.filter(x => CONFIG.zoneOf(x.sido) === zone);
    const have = new Set(list.map(x => x.id));
    lmRows = !$('pmLm').checked ? [] : Object.entries(landMap()).filter(([id]) => !have.has(id)).map(([id, v]) => { const q = Kit.parseId(id), reg = regs.get(q.code); return { ...q, sido: v.sido || reg?.[1] || '', sgg: v.sgg || reg?.[2] || '', name: v.name || q.name }; })
      .filter(x => !zone || CONFIG.zoneOf(x.sido) === zone);
    $('pmEmpty').hidden = total > 0; $('pmBody').hidden = !total;
    if (!total) return;
    if (!list.length && !lmRows.length) { baseItems = []; lastRows = []; renderList(); refreshMap(); $('pmBand').innerHTML = '<option value="">전체</option>'; return say('이 조건에 해당하는 단지가 없습니다. 폴더·권역을 바꿔 보세요.'); }
    if (!KMap.ready()) return say(KMap.needKeyHtml);
    say(`가격을 불러오는 중… (${list.length}개 단지)`);
    await Real.load(list);
    if (my !== seq) return;
    let rows = list.map(My.calc), ym = $('pmMonth').value;
    if (ym) rows.forEach(r => {                       // 기준 달을 고르면 그 달에 적은 호가로 (없으면 최근 실거래로 대신하고 '·실' 표시)
      const q = r.rec?.quotes?.[ym] || {}, rl = r.rl || {};
      r.s = q.s ?? rl.sale?.price ?? null; r.sQ = q.s != null; r.r = q.r ?? rl.rent?.price ?? null; r.rQ = q.r != null;
      r.gap = r.s != null && r.r != null ? r.s - r.r : null; r.ratio = r.s && r.r ? r.r / r.s * 100 : null;
    });
    // 금액대: 지금 조건의 단지로 목록을 만들고 고른 값으로 거름
    const bands = new Map(); rows.forEach(r => { if (r.s != null) { const b = CONFIG.priceBand(r.s); bands.set(b, (bands.get(b) || 0) + 1); } });
    const curB = $('pmBand').value || opts().band || '', bl = [...bands.keys()].sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0));
    $('pmBand').innerHTML = '<option value="">전체</option>' + bl.map(b => `<option value="${b}">${b} (${bands.get(b)})</option>`).join('');
    $('pmBand').value = bands.has(curB) ? curB : '';
    if ($('pmBand').value) rows = rows.filter(r => r.s != null && CONFIG.priceBand(r.s) === $('pmBand').value);
    byId = new Map(rows.map(r => [r.id, r]));
    const geo = [...rows, ...lmRows];
    try {
      await KMap.load();
      let n = 0;
      const queue = [...geo];
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (queue.length) { const r = queue.shift(); r.pos = await KMap.geocode(r); if (my !== seq) return; say(`단지 위치를 찾는 중… (${++n}/${geo.length})`); }
      }));
    } catch (e) { return say(U.esc(e.message || String(e))); }
    if (my !== seq) return;
    const ok = rows.filter(r => r.pos), okL = lmRows.filter(r => r.pos);
    if (!ok.length && !okL.length) return say('단지 위치를 찾지 못했습니다.');
    msg.hidden = true;
    const first = (ok[0] || okL[0]).pos;
    if (!map) {
      applySize();
      map = KMap.create($('pmMap'), first, 7);
      LabelKit.mount('map', { el: $('pmMap'), host: $('pmMap').parentElement, move: () => { if (ctrl) ctrl.setEdit(!ctrl.isEdit()); }, ext: () => { drawer(true); setTimeout(() => $('pmCtl').scrollIntoView({ behavior: 'smooth', block: 'center' }), 60); } });
      ctrl = MapLabel.create({ key: 'map', map, panel: $('pmPanel'), ctl: $('pmCtl'), onEdit: (on) => LabelKit.moveState('map', on),
        onPreset: (k) => { if (k === 'field') { $('pmShow').value = 'sr'; $('pmSubWrap').hidden = true; saveOpts(); setTimeout(draw, 50); } },   // 임장용 = 매매 + 전세
        onPick: (it) => { if (!it.user) popup(it); },
        onAdd: (pos) => {
          const text = (prompt('라벨에 적을 글자 (예: GTX-A 예정역, 학원가, 재개발 구역)') || '').trim(); if (!text) return;
          const l = Store.get(UKEY, []); l.push({ id: 'u:' + Date.now().toString(36), lat: +pos.lat.toFixed(6), lng: +pos.lng.toFixed(6), text }); Store.set(UKEY, l);
          ctrl.set([...baseItems, ...userItems()]);
        },
        onDelete: (id) => { Store.set(UKEY, Store.get(UKEY, []).filter(u => u.id !== id)); ctrl.set([...baseItems, ...userItems()]); } });
      const mp = $('pmCtl').querySelector('.mlpop');            // 편집 모드에서 라벨을 고르면 개별 조정 막대가 서랍 안에 열리므로 서랍도 엶
      if (mp) new MutationObserver(() => { if (!mp.hidden) drawer(true); }).observe(mp, { attributes: true, attributeFilter: ['hidden'] });
    }
    const hot = setOf(TCKEY);
    const cnt = new Map(); ok.forEach(r => cnt.set(`${r.code}|${r.key}`, (cnt.get(`${r.code}|${r.key}`) || 0) + 1));
    const items = ok.map(r => {
      const t = labelOf(r, cnt.get(`${r.code}|${r.key}`) > 1), rt = rates(r);
      return { id: r.id, ck: `${r.code}|${r.key}`, pos: r.pos, text: t.text, name: t.name, lines: t.lines, sub: t.sub, compact: t.compact, drop: rt.drop, rise: rt.rise,
        color: t.real ? '#f5a742' : '#4f9cff', rank: hot.has(r.id) ? 1 : 0, cls: hot.has(r.id) ? 'mlhot' : '' };
    }).concat(okL.map(L => ({ id: 'lm:' + L.id, lm: L.id, pos: L.pos, text: `★ ${L.name}`, color: '#8e8e93', rank: -1, cls: 'mllm' })));
    map.relayout();
    baseItems = items;
    lastRows = rows;
    if (typeof PmArea !== 'undefined') PmArea.attach(map, () => lastRows);
    renderList();
    const hidNow = setOf(HKEY), shownRows = ok.filter(r => !hidNow.has(r.id));
    side(shownRows); legend();
    notFound = ok.length < rows.length ? ` · 위치를 못 찾은 ${rows.length - ok.length}개 제외` : '';
    tblRows = shownRows; drawTable();
    const pts = [...ok, ...okL].map(r => r.pos);
    if (pts.length > 1) KMap.fit(map, pts); else { map.setCenter(KMap.LL(pts[0])); map.setLevel(5); }
    refreshMap();
    if (!$('pmCard').innerHTML && ok[0]) card(ok[0]);
  }

  /* ── 지도 아래 표 (엑셀식 열 필터는 표에만 적용 — 지도 라벨은 그대로) ── */
  let tblRows = [], pf = null;
  function pmCols() {
    const N = ColFilter.numCol, T = ColFilter.txtCol;
    return {
      reg: T('지역', (r) => `${r.sgg} ${r.dong}`), name: T('단지', (r) => r.name), area: { label: '평형', get: (r) => `${r.g}㎡`, num: (r) => r.g },
      s: N('매매', (r) => r.s), sQ: T('매매 기준', (r) => (r.s == null ? '' : r.sQ ? '호가' : '실거래')),
      r: N('전세', (r) => r.r), rQ: T('전세 기준', (r) => (r.r == null ? '' : r.rQ ? '호가' : '실거래')),
      gap: N('매-전', (r) => r.gap), ratio: N('전세가율', (r) => r.ratio, 'rat'), drop: N('전고 대비', (r) => r.drop, 'pct'),
      folder: T('폴더', (r) => (r.rec.folders || []).join(', ')),
    };
  }
  const PF = () => pf || (pf = ColFilter.create({ key: 'pm', cols: pmCols, bar: 'pmCfBar', onChange: drawTable }));
  function drawTable() {
    const list = PF().apply(tblRows), b = (k) => PF().btn(k);
    $('pmTable').innerHTML = `<thead><tr><th class="l">지역${b('reg')}</th><th class="l">단지${b('name')}</th><th>평형${b('area')}</th><th>매매${b('s')}</th><th>매매 기준${b('sQ')}</th><th>전세${b('r')}</th><th>전세 기준${b('rQ')}</th><th>매-전${b('gap')}</th><th>전세가율${b('ratio')}</th><th>전고 대비${b('drop')}</th><th class="l">폴더${b('folder')}</th></tr></thead><tbody>` +
      list.map(r => `<tr><td class="l">${U.esc(r.sgg)} ${U.esc(r.dong)}</td><td class="l">${U.esc(r.name)}</td><td>${r.g}㎡</td><td>${r.s == null ? '-' : U.price(r.s)}</td><td>${r.s == null ? '' : r.sQ ? '호가' : '실거래'}</td><td>${r.r == null ? '-' : U.price(r.r)}</td><td>${r.r == null ? '' : r.rQ ? '호가' : '실거래'}</td>` +
        `<td>${r.gap == null ? '-' : U.price(r.gap)}</td><td>${r.ratio == null ? '-' : r.ratio.toFixed(0) + '%'}</td><td>${U.pct(r.drop)}</td><td class="l">${U.esc((r.rec.folders || []).join(', '))}</td></tr>`).join('') +
      (tblRows.length && !list.length ? '<tr><td colspan="11" class="hint">필터에 맞는 단지가 없습니다.</td></tr>' : '') + '</tbody>';
  }

  /* ── 단지 추가: 검색해서 고른 단지를 시세트래킹 '지도 추가' 폴더에 담음 ── */
  async function pickComplex(x) {
    pick = x;
    const ar = await Finder.areas(x.code, x.key);
    const list = ar.list.length ? ar.list : [{ g: 84, n: 0 }];
    $('pmAddArea').innerHTML = list.map(a => `<option value="${a.g}" ${a.g === ar.best ? 'selected' : ''}>${a.g}㎡ (${CONFIG.toPyeong(a.g)}평)${a.n ? ` · ${a.n}건` : ''}</option>`).join('');
    $('btnPmAdd').disabled = false;
    $('pmAddHint').textContent = `${x.name} 선택됨. 평형을 고른 뒤 [지도에 추가]를 누르세요.`;
  }
  async function addPicked() {
    if (!pick) return;
    const g = +$('pmAddArea').value, id = `${pick.code}|${pick.key}#${g}`, regs = await Kit.regions(), reg = regs.get(pick.code);
    const row = { ...Kit.parseId(id), ...pick, id, g, sido: pick.sido || reg?.[1] || '', sgg: pick.sgg || reg?.[2] || '' };
    const n = Tracking.add([row], MAPF, true);
    U.toast(n ? `${pick.name} ${CONFIG.toPyeong(g)}평을 시세트래킹 '${MAPF}' 폴더에 담고 지도에 올렸습니다.` : '이미 지도 추가 폴더에 있는 단지·평형입니다.');
    toggleSet(HKEY, id, false);
    pick = null; $('pmAddFind').value = ''; $('btnPmAdd').disabled = true;
    $('pmAddHint').innerHTML = `추가한 단지는 시세트래킹의 <b>${MAPF}</b> 폴더에 담겨, 표에서 호가를 적을 수 있습니다.`;
    fillFolders(); draw();
  }
  /** 예전 '직접 추가'·'전수조사에서 보낸' 단지를 시세트래킹 '지도 추가' 폴더로 한 번 옮김 (예전 목록은 지우지 않고 보관) */
  async function migrate() {
    if (Store.get(MIG, 0)) return 0;
    const ids = [...new Set([...Store.get(DKEY, []), ...Store.get(XKEY, [])])];
    if (!ids.length) { Store.set(MIG, Date.now()); return 0; }
    const regs = await Kit.regions();
    const rows = ids.map(id => { const q = Kit.parseId(id), reg = regs.get(q.code); return { ...q, sido: reg?.[1] || '', sgg: reg?.[2] || '' }; });
    try { Store.set('apt.pmMigrateBackup.v1', { at: Date.now(), direct: Store.get(DKEY, []), sent: Store.get(XKEY, []) }); } catch (e) { /* 보관 실패해도 계속 */ }
    const n = Tracking.add(rows, MAPF, true);
    Store.set(MIG, Date.now());
    U.toast(`예전에 지도에 직접 추가·전수조사에서 보낸 단지 ${ids.length}개를 시세트래킹 '${MAPF}' 폴더로 옮겼습니다.`);
    return n;
  }

  /** 범례 카드 (지도 왼쪽 아래 · 캡처에도 남음) */
  function legend() {
    const mode = $('pmShow').value, two = mode === 'sr' || mode === 'srg', it = (dot, t) => `<span><i style="background:${dot}"></i>${t}</span>`;
    $('pmLegend').innerHTML = '<b>범례</b>' + (two ? it(C_S, '매매') + it(C_R, '전세') : it('#4f9cff', '내가 적은 호가') + it('#f5a742', '최근 실거래로 대신')) +
      (two ? '<span><em class="sil">실</em> 호가 없어 실거래로 대신</span>' : '') + '<span><em class="hotbox"></em> 시세트래킹에서 체크</span>' +
      '<span><em style="color:#2f6fed;font-style:normal;font-weight:800">▼</em> 전고 대비 · <em style="color:#e5484d;font-style:normal;font-weight:800">▲</em> 전저 대비</span>' +
      ($('pmLm').checked ? '<span>★ 랜드마크</span>' : '');
  }
  /** 오른쪽 단지 목록: 전고 대비 많이 빠진 순, 누르면 그 단지로 이동 */
  function side(rows) {
    const list = rows.map(r => ({ r, ...rates(r) })).sort((a, b) => (a.drop ?? 1e9) - (b.drop ?? 1e9));
    $('pmSideList').innerHTML = list.map(({ r, drop, rise }) => `<button type="button" class="pmsi" data-go="${U.esc(r.id)}"><span class="l"><b>${U.esc(r.name)}</b><small>${CONFIG.toPyeong(r.g)}평${r.buildYear ? ` · ${r.buildYear}년` : ''}${r.hh ? ` · ${r.hh.toLocaleString()}세대` : ''}</small></span>` +
      `<span class="r"><b>${r.s == null ? '-' : eokS(r.s)}</b><small>${drop == null ? '' : `<em class="dn">▼${Math.abs(drop).toFixed(1)}%</em>`}${rise == null ? '' : ` <em class="up">▲${Math.abs(rise).toFixed(0)}%</em>`}</small></span></button>`).join('') || '<p class="hint">표시할 단지가 없습니다.</p>';
  }
  function drawer(open) { const d = $('pmDrawer'); d.hidden = open == null ? !d.hidden : !open; $('btnPmDrawer').classList.toggle('on', !d.hidden); }
  function init() {
    const o = opts();
    Finder.attach($('pmAddFind'), pickComplex);
    $('btnPmAdd').onclick = addPicked;
    $('pmAddFind').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    if (o.show) $('pmShow').value = o.show;
    if (o.name) $('pmName').value = o.name;
    $('pmZone').value = o.zone || '';
    $('pmLm').checked = !!o.lm;                                    // 랜드마크 층: 처음엔 꺼짐
    $('pmFolders').onchange = (e) => { if (e.target.matches('select.fmore') && e.target.value) { $('pmFolder').value = e.target.value; fillFolders(); draw(); } };
    $('pmFolders').onclick = (e) => {
      const b = e.target.closest('button[data-pf]'); if (!b) return;
      $('pmFolder').value = b.dataset.pf; fillFolders(); draw();
    };
    $('pmListTable').onchange = (e) => {
      const t = e.target;
      if (t.dataset.mh != null) { toggleSet(HKEY, t.dataset.mh, !t.checked); renderList(); return refreshMap(); }
      if (t.dataset.pl != null) { setLabelHidden(t.dataset.pl, !t.checked); return refreshMap(); }
    };
    $('pmListTable').onclick = (e) => { const id = e.target.closest('button[data-lm]')?.dataset.lm; if (id == null) return; const row = lastRows.find(r => r.id === id) || { id, ...Kit.parseId(id) }; toggleLand(row, !landSet().has(id)); renderList(); if ($('pmLm').checked) draw(); };
    $('btnPmMapAllOn').onclick = () => { const s = setOf(HKEY); lastRows.forEach(r => s.delete(r.id)); Store.set(HKEY, [...s]); renderList(); refreshMap(); };
    $('btnPmMapAllOff').onclick = () => { const s = setOf(HKEY); lastRows.forEach(r => { if (r.pos) s.add(r.id); }); Store.set(HKEY, [...s]); renderList(); refreshMap(); };
    $('pmMonth').onchange = $('pmZone').onchange = $('pmBand').onchange = $('pmLm').onchange = draw;
    $('pmShow').onchange = $('pmName').onchange = () => { saveOpts(); if (map) draw(); };
    $('pmPreset').onchange = () => {
      const v = $('pmPreset').value, sel = $('pmCtl').querySelector('[data-ml="preset"]'); if (!v || !sel) return;
      sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); setTimeout(() => { $('pmPreset').value = ''; }, 50);
    };
    $('btnPmDrawer').onclick = () => drawer();
    $('btnPmDrawerClose').onclick = () => drawer(false);
    $('pmPop').onclick = popAct;
    $('pmSideList').onclick = (e) => {
      const b = e.target.closest('[data-go]'); if (!b || !map) return;
      const r = lastRows.find(x => x.id === b.dataset.go); if (!r || !r.pos) return;
      map.setCenter(KMap.LL(r.pos)); if (map.getLevel() > 4) map.setLevel(4);
      setTimeout(() => { const el = [...document.querySelectorAll('#pmMap .mllabel')].find(x => x.textContent.includes(r.name)); if (el) { el.classList.add('flashlbl'); setTimeout(() => el.classList.remove('flashlbl'), 2200); } }, 500);
    };
    const subVis = () => { $('pmSubWrap').hidden = $('pmShow').value !== 'srg'; };
    $('pmSub').value = opts().sub || 'gr'; subVis();
    $('pmSub').onchange = () => { saveOpts(); if (map) draw(); };
    $('pmShow').addEventListener('change', subVis);
    $('pmPop').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('#ppS, #ppR')) $('pmPop').querySelector('[data-pp="save"]')?.click(); });
    document.addEventListener('keydown', (e) => { if (e.key !== 'Escape' || document.querySelector('.ml-capturing')) return; if (!$('pmPop').hidden) closePop(); else if (!$('pmDrawer').hidden) drawer(false); });
    // 저장함: 라벨 위치·모양·메모 라벨·표시 설정을 통째로 (예: "2026-11 평촌 지도")
    Saves.register('map', { name: '시세지도', hint: '라벨 위치·크기·글씨체·모양, 직접 추가한 메모 라벨, 표시 설정(폴더·권역·기준 달)을 저장합니다. 달마다 한 번씩 저장해 두면 그때의 지도를 다시 볼 수 있습니다.',
      note: () => `${$('pmZone').value ? $('pmZone').value + ' · ' : ''}${$('pmFolder').value || '전체'} · ${$('pmMonth').selectedOptions[0]?.text || '최신 호가'} ${$('pmCount').textContent}`,
      get: () => { const all = Store.get('apt.mapLabel.v1', {}), mine = {}; Object.keys(all).filter(k => k.startsWith('map:')).forEach(k => { mine[k] = all[k]; });
        return { opts: Store.get(SKEY, {}), labels: mine, user: Store.get(UKEY, []), size: Store.get(SIZE, {}), hid: Store.get(HKEY, []) }; },
      set: (d) => { const all = Store.get('apt.mapLabel.v1', {}); Object.keys(all).filter(k => k.startsWith('map:')).forEach(k => delete all[k]); Object.assign(all, d.labels || {});
        Store.set('apt.mapLabel.v1', all); Store.set(SKEY, d.opts || {}); Store.set(UKEY, d.user || []); Store.set(SIZE, d.size || {}); Store.set(HKEY, d.hid || []);
        if (d.sent && d.sent.length) Store.set(XKEY, [...new Set([...Store.get(XKEY, []), ...d.sent])]);
        if (d.dir && d.dir.length) Store.set(DKEY, [...new Set([...Store.get(DKEY, []), ...d.dir])]);
        if ((d.sent && d.sent.length) || (d.dir && d.dir.length)) Store.set(MIG, 0);          // 예전 저장본의 단지는 다시 지도 추가 폴더로 옮김
        sessionStorage.setItem('apt.openTab', 'map'); setTimeout(() => location.reload(), 400); } });
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
  async function open() { if (!inited) return; await migrate(); fillFolders(); draw(); }
  /** (예전 호환) 전수조사에서 지도로 보내기 → 이제는 시세트래킹 '지도 추가' 폴더에 담음 */
  async function send(ids) { const regs = await Kit.regions(); return Tracking.add(ids.map(id => { const q = Kit.parseId(id), reg = regs.get(q.code); return { ...q, sido: reg?.[1] || '', sgg: reg?.[2] || '' }; }), MAPF, true); }
  return { init, open, send, MAPF };
})();
