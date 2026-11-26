/* ─────────────────────────────────────────────────────────
   compare2.js — [비교] 탭 : 비교 양식을 골라 단지 1~4개를 한 장으로 비교하고 PPT 로 내려받기
   · 양식 = "항목 줄" 목록. [✎ 양식 편집]에서 화면으로 줄을 추가·삭제·순서 변경·이름 변경 (코드 수정 없음)
       줄 종류:  자동(계산해서 채움) · 직접 입력 · 긴 글(+ 자동 초안)   /  모든 칸에 ✔ 표시를 켜고 끌 수 있음
       처음 들어 있는 양식: 입지 비교 · 빈 양식
   · 단지: 전국 단지 검색(Finder)으로 1~4개, 평형은 단지마다 따로. (기존 [비교 평가]·[단지 비교] 탭은 그대로 둡니다)
   · 지도: 카카오맵에 단지 마커(1~4) + 기준점. 마커를 누르면 기준점까지 화살표와 직선거리,
           마커를 누른 뒤 다른 마커나 지도의 한 지점을 누르면 그 사이 거리 화살표.
   · 기준점: 강남역 기본 / 시청 · 여의도 · 구디 · 가디 · DMC · 판교 · 잠실 / 지도를 눌러 직접 지정
   · 자동 값: 카카오맵(Loc.auto) + 실거래·K-apt + 시세트래킹 + 공급지도. 값 옆 ✎ 로 고치면 📌 고정
   · PPT: 맑은 고딕, 표·글은 PowerPoint 에서 그대로 고칠 수 있음. 지도 칸 = 직접 캡처한 사진(붙여넣기) 또는 배경 없는 약도
   저장 위치: apt.cmp2.v1 (양식·적은 값·저장한 세트 — 백업·자동 동기화에 들어갑니다) · apt.cmp2Ui.v1 (화면 설정, 이 기기만)
   카카오 정책상 좌표·지도 사진은 저장하지 않습니다. (열 때마다 다시 찾음)
   ───────────────────────────────────────────────────────── */
let _pptx2P = null;
function needPptx2() {
  if (typeof PptxGenJS !== 'undefined') return Promise.resolve();
  if (!_pptx2P) _pptx2P = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'lib/pptxgen.bundle.js';
    s.onload = () => res(); s.onerror = () => { _pptx2P = null; rej(new Error('PPT 기능(lib/pptxgen.bundle.js)을 불러오지 못했습니다. 파일이 lib 폴더에 올라갔는지 확인하세요.')); };
    document.head.appendChild(s);
  });
  return _pptx2P;
}

const Cmp2 = (() => {
  const root = document.getElementById('tab-cmp2');
  if (!root) return {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => U.esc(s);
  const KEY = 'apt.cmp2.v1', UKEY = 'apt.cmp2Ui.v1', MAX = 4;
  const COLORS = ['#e60012', '#0033ff', '#111111', '#12a150'];       // 단지 1~4 색 (화면)
  const PCOL = ['E60012', '0033FF', '000000', '12A150'];             // (PPT)
  const REFS = [
    { id: 'gangnam', name: '강남역', lat: 37.497942, lng: 127.027621 },
    { id: 'cityhall', name: '시청', lat: 37.565715, lng: 126.977088 },
    { id: 'yeouido', name: '여의도', lat: 37.521624, lng: 126.924191 },
    { id: 'gudi', name: '구디 (구로디지털단지)', q: '구로디지털단지역' },
    { id: 'gadi', name: '가디 (가산디지털단지)', q: '가산디지털단지역' },
    { id: 'dmc', name: 'DMC', lat: 37.577475, lng: 126.900187 },
    { id: 'pangyo', name: '판교', lat: 37.394761, lng: 127.111217 },
    { id: 'jamsil', name: '잠실', q: '잠실역' },
  ];

  /* ═════════ 자동 항목 목록 (양식 편집에서 고르는 것) ═════════ */
  const near = (p) => (p ? `${p.name} ${Loc.meters(p.m)} (도보 약 ${Loc.walk(p.m)}분)` : null);
  const L = (a, f) => (a && a.loc ? f(a.loc) : null);                // 카카오 값이 아직 없으면 null → "불러오는 중"
  const AUTO = {
    dist: { name: '기준점까지 직선거리', get: (a, c, x) => (x.km[cid(c)] == null ? null : `${x.km[cid(c)].toFixed(1)}km (직선)`) },
    subway: { name: '가까운 지하철역', get: (a) => L(a, l => (l.subway.length ? l.subway.slice(0, 2).map(s => `${s.name} ${Loc.meters(s.m)} (도보 약 ${Loc.walk(s.m)}분)`).join('\n') : '1.5km 안에 없음')) },
    elem: { name: '가까운 초등학교', get: (a) => L(a, l => near(l.elem) || '2km 안에서 찾지 못함') },
    mid: { name: '가까운 중학교', get: (a) => L(a, l => near(l.mid) || '2km 안에서 찾지 못함') },
    academy: { name: '학원 수 (1km 안)', get: (a) => L(a, l => `${l.counts.AC5}곳`) },
    fac: { name: '주변 시설 (1km 안 마트·병원·공원)', get: (a) => L(a, l => `마트 ${l.counts.MT1} · 병원 ${l.counts.HP8} · 공원 ${l.counts.park}`) },
    mart: { name: '가까운 대형마트', get: (a) => L(a, l => near(l.mart) || '3km 안에서 찾지 못함') },
    dept: { name: '가까운 백화점', get: (a) => L(a, l => near(l.dept) || '5km 안에서 찾지 못함') },
    hosp: { name: '가까운 종합병원', get: (a) => L(a, l => near(l.hosp) || '5km 안에서 찾지 못함') },
    star: { name: '가까운 스타벅스', get: (a) => L(a, l => near(l.star) || '2km 안에 없음') },
    hh: { name: '세대수', get: (a) => (a && a.hh ? `${a.hh.toLocaleString()}세대` : '-') },
    struct: { name: '구조 (계단식/복도식)', get: (a) => (a && a.struct) || '-' },
    by: { name: '연식', get: (a) => (a && a.by ? `${a.by}년` : '-') },
    rooms: { name: '방/화장실 (시세트래킹에 있는 단지)', get: (a) => (a && a.rooms) || '-' },
    supply: { name: '주변 입주 예정 물량 (같은 시, 12개월)', get: (a) => (a && a.supply) || '공급지도에 입주물량 엑셀을 올리면 표시' },
  };

  const DEF_FORMS = () => [
    { id: 'f_loc', name: '입지 비교', rows: [
      { id: 'r_dist', label: '위치 (기준점까지)', type: 'auto', src: 'dist' },
      { id: 'r_sub', label: '교통 · 가까운 역', type: 'auto', src: 'subway' },
      { id: 'r_tr', label: '교통 · 기준점까지 시간', type: 'input', route: 1 },
      { id: 'r_el', label: '학군 · 초등학교', type: 'auto', src: 'elem' },
      { id: 'r_mi', label: '학군 · 중학교', type: 'auto', src: 'mid' },
      { id: 'r_ac', label: '학군 · 학업성취도', type: 'input' },
      { id: 'r_fac', label: '환경 · 주변 시설', type: 'auto', src: 'fac' },
      { id: 'r_env', label: '환경 · 메모', type: 'input' },
      { id: 'r_think', label: '생각', type: 'long' }] },
    { id: 'f_blank', name: '빈 양식', rows: [
      { id: 'r_a1', label: '항목 1', type: 'input' },
      { id: 'r_think2', label: '생각', type: 'long' }] },
  ];

  /* ═════════ 상태 ═════════ */
  let S = null, ui = {}, inited = false, seq = 0, mapSeq = 0, saveTimer = null, editing = false;
  const cust = { pos: null };                                         // 지도에서 찍은 기준점 (좌표라서 저장하지 않음)
  const refMemo = new Map(), posCache = new Map(), autos = new Map(), areaMemo = new Map();
  const img = { map: null };                                          // 지도 캡처 사진 (저장하지 않음)
  let kmap = null, pickRef = false, lastCtx = null;
  let mkList = [], autoArr = [], measureObjs = [], measuring = false, mA = null, curRp = null, fitKey = '';

  const cid = (c) => `${c.code}|${c.key}#${c.g}`;
  const loadState = () => {
    const v = Store.get(KEY, null) || {};
    S = { forms: Array.isArray(v.forms) && v.forms.length ? v.forms : DEF_FORMS(), vals: v.vals && typeof v.vals === 'object' ? v.vals : {}, longs: v.longs && typeof v.longs === 'object' ? v.longs : {}, sets: Array.isArray(v.sets) ? v.sets : [] };
  };
  const persist = () => { Store.set(KEY, S); const el = $('c2Saved'); if (el) { el.textContent = '✓ 자동 저장'; } };
  const loadUi = () => {
    const u = Store.get(UKEY, null) || {};
    ui = { formId: u.formId || 'f_loc', ref: u.ref || 'gangnam', items: Array.isArray(u.items) ? u.items.slice(0, MAX) : [], sketch: u.sketch === 0 ? 0 : 1, names: u.names ? 1 : 0, arrowOff: Array.isArray(u.arrowOff) ? u.arrowOff : [] };
    if (!S.forms.some(f => f.id === ui.formId)) ui.formId = S.forms[0].id;
    if (ui.ref === 'custom' && !cust.pos) ui.ref = 'gangnam';
  };
  const saveUi = () => Store.set(UKEY, ui);
  const form = () => S.forms.find(f => f.id === ui.formId) || S.forms[0];
  const locked = () => { if (typeof Vault !== 'undefined' && Vault.isLocked()) { U.toast('잠금 상태입니다. 오른쪽 위 [잠금]을 풀면 고칠 수 있습니다.'); return true; } return false; };
  const newId = (p) => p + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  const curRef = () => (ui.ref === 'custom' ? { id: 'custom', name: '지도에서 찍은 지점' } : REFS.find(r => r.id === ui.ref) || REFS[0]);
  const longKey = () => `${form().id}|${ui.items.map(cid).sort().join(',')}`;
  const valOf = (id, k) => (S.vals[id] || {})[k];
  function setVal(id, k, v) {
    const o = (S.vals[id] = S.vals[id] || {});
    if (v === undefined || v === null || v === '' || v === false) delete o[k]; else o[k] = v;
    if (!Object.keys(o).length) delete S.vals[id];
    persist();
  }

  /* ═════════ 위치·자동 값 ═════════ */
  async function posOf(c) {
    const id = cid(c);
    if (posCache.has(id)) return posCache.get(id);
    if (!KMap.ready()) return null;
    try { await KMap.load(); const p = await KMap.geocode(c); if (p) posCache.set(id, p); return p || null; } catch (e) { return null; }
  }
  async function refPos() {
    const r = curRef();
    if (r.id === 'custom') return cust.pos;
    if (r.lat != null) return { lat: r.lat, lng: r.lng };
    if (refMemo.has(r.id)) return refMemo.get(r.id);
    if (!KMap.ready()) return null;
    try {
      await KMap.load();
      const Sv = kakao.maps.services;
      const p = await new Promise(res => new Sv.Places().keywordSearch(r.q, (l, st) => res(st === Sv.Status.OK && l.length ? { lat: +l[0].y, lng: +l[0].x } : null)));
      if (p) refMemo.set(r.id, p);
      return p;
    } catch (e) { return null; }
  }
  function supplyText(c) {
    const sp = Store.get('apt.supply.v1', null), rows = sp && Array.isArray(sp.rows) ? sp.rows : [];
    if (!rows.length) return '';
    const city = String(c.sgg || '').split(/\s+/)[0], sido2 = String(c.sido || '').slice(0, 2), now = new Date(), a = now.getFullYear() * 12 + now.getMonth(), b = a + 12;
    let hh = 0, n = 0;
    for (const r of rows) {
      if (!r.ym || !r.hh || !String(r.sgg || '').startsWith(city) || (r.sido && sido2 && !String(r.sido).startsWith(sido2))) continue;
      const [y, m] = String(r.ym).split('-').map(Number), t = y * 12 + (m || 1) - 1;
      if (t < a || t > b) continue;
      hh += +r.hh; n++;
    }
    return `${city} 향후 12개월 ${hh.toLocaleString()}세대 (${n}단지)`;
  }
  function autoOf(c) {
    const id = cid(c);
    if (autos.has(id)) return autos.get(id);
    const p = (async () => {
      let loc = null, idx = null, kp = null;
      if (KMap.ready()) { try { loc = await Loc.auto(c); } catch (e) { loc = null; } }
      try { [idx, kp] = await Promise.all([Data.index(c.code), Data.kapt(c.code)]); } catch (e) { /* 자료 없음 */ }
      const k = kp && kp.m ? kp.m[c.key] : null;
      const tr = (typeof Tracking !== 'undefined' && Tracking.all ? Tracking.all() : []).filter(t => t.code === c.code && t.key === c.key).sort((a, b) => Math.abs((a.g || 0) - c.g) - Math.abs((b.g || 0) - c.g));
      const t = tr[0] && Math.abs((tr[0].g || 0) - c.g) < 2 ? tr[0] : null;
      const out = { loc, by: (idx && idx.c && idx.c[c.key]) || (t && +t.buildYear) || null, hh: k ? k[0] : (t && +t.households) || null, struct: (k && k[3]) || (t && t.structure) || '', rooms: t && t.rooms ? `${t.rooms}/${t.baths || '-'}` : '', supply: supplyText(c) };
      if (KMap.ready() && !loc) autos.delete(id);                     // 카카오 값 실패 → 다음에 다시 시도
      return out;
    })();
    autos.set(id, p);
    return p;
  }
  async function buildCtx() {
    const rp = await refPos(), items = ui.items.slice();
    const list = await Promise.all(items.map(c => autoOf(c).catch(() => null)));
    const poss = await Promise.all(items.map(c => posOf(c)));
    const x = { rp, refName: curRef().name, km: {}, a: {}, pos: {} };
    items.forEach((c, i) => { const id = cid(c); x.a[id] = list[i]; x.pos[id] = poss[i]; x.km[id] = rp && poss[i] ? KMap.km(poss[i], rp) : null; });
    return x;
  }
  const emptyCtx = () => ({ rp: null, refName: curRef().name, km: {}, a: {}, pos: {}, loading: true });
  const routeUrl = (c, x) => { const p = x.pos[cid(c)]; return p && x.rp ? `https://map.kakao.com/link/from/${encodeURIComponent(c.name)},${p.lat},${p.lng}/to/${encodeURIComponent(x.refName)},${x.rp.lat},${x.rp.lng}` : null; };
  const specOf = (c, x) => {                                          // "24평(복 3/1)"
    const a = x.a[cid(c)] || {}, st = /복도/.test(a.struct || '') ? '복' : /계단/.test(a.struct || '') ? '계' : '';
    const inner = [st, a.rooms && a.rooms !== '-' ? a.rooms : ''].filter(Boolean).join(' ');
    return `${CONFIG.toPyeong(c.g)}평${inner ? `(${inner})` : ''}`;
  };
  const cellText = (row, c, x) => {                                   // 화면·PPT 공통 글자
    const id = cid(c), ov = valOf(id, row.id);
    if (row.type === 'input') return ov || '';
    if (ov) return ov;
    const src = AUTO[row.src];
    return src ? src.get(x.a[id], c, x) : '';
  };

  /* ═════════ 화면 뼈대 ═════════ */
  function frame() {
    root.innerHTML = `
    <section class="panel c2-bar"><div class="c2-forms" id="c2Forms"></div><span class="grow"></span><span class="c2-saved" id="c2Saved">✓ 자동 저장</span>
      <button id="c2EditBtn">✎ 양식 편집</button><button class="primary" id="c2Ppt">📊 PPT 다운로드</button></section>
    <section class="panel c2-editor" id="c2Editor" hidden></section>
    <section class="panel filters c2-pick">
      <label class="findlab">🔎 단지 검색 <input type="search" id="c2Nat" placeholder="단지 이름이나 별칭 (고르면 칸이 추가됩니다, 1~4개)" autocomplete="off"></label>
      <label>기준점 <select id="c2Ref"></select></label>
      <button id="c2PickRef" title="누른 뒤 지도에서 한 지점을 누르면 그곳이 기준점이 됩니다">🖱 지도에서 지정</button>
      <span class="grow"></span>
      <label>저장한 세트 <select id="c2Sets"></select></label>
      <button id="c2SaveSet">💾 저장</button><button id="c2LoadSet">📂 불러오기</button><button id="c2DelSet" class="danger">삭제</button>
    </section>
    <div class="c2-grid">
      <section class="panel c2-mapbox"><h3>지도 <small id="c2MapHint"></small></h3>
        <div class="c2-mapwrap"><div id="c2Map" class="c2-map"></div><div id="c2MapMsg" class="c2-mapmsg"></div></div>
        <div id="c2Legend" class="c2-legend"></div>
        <div class="c2-mapctl"><button id="c2ArrowAll">화살표 전체 끄기</button><button id="c2Measure" title="누른 뒤 출발할 단지나 지도 위 한 지점, 그다음 도착 지점을 누르면 거리 화살표">📏 거리재기</button><button id="c2ClrArrow">측정 지우기</button><button id="c2Fit">한눈에 보기</button></div>
        <div class="c2-mapctl"><label class="inline"><input type="checkbox" id="c2Names" ${ui.names ? 'checked' : ''}> 지도에 이름표 표시</label><label class="inline"><input type="checkbox" id="c2Sketch" ${ui.sketch ? 'checked' : ''}> 사진이 없으면 PPT 에 약도(점·화살표·거리) 넣기</label></div>
        <div id="c2Cap"></div></section>
      <section class="panel c2-tbox"><div class="tablewrap"><table id="c2Table" class="cmp c2-table"></table></div>
        <p class="hint">✎ 자동 값을 고치면 📌 이 붙고, 📌 을 누르면 자동 값으로 돌아갑니다. 칸 오른쪽 ✔ 는 PPT 에 노란 체크로 들어갑니다. 거리는 직선거리입니다. 교통 시간은 [🔗 길찾기]에서 카카오맵으로 확인해 직접 적으세요.</p></section>
    </div>`;
    drawForms(); drawRefSelect(); drawSets(); drawCap();
    Finder.attach($('c2Nat'), (x) => { addItem(x); $('c2Nat').value = ''; });
  }
  const drawForms = () => {
    $('c2Forms').innerHTML = S.forms.map(f => `<button data-form="${esc(f.id)}" class="${f.id === ui.formId ? 'on' : ''}">${esc(f.name)}</button>`).join('') + '<button data-newform="1" title="새 양식 만들기">+ 새 양식</button>';
  };
  const drawRefSelect = () => {
    $('c2Ref').innerHTML = REFS.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('') + (cust.pos ? '<option value="custom">지도에서 찍은 지점</option>' : '');
    $('c2Ref').value = ui.ref;
  };
  const drawSets = () => {
    $('c2Sets').innerHTML = S.sets.length ? S.sets.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('') : '<option value="">(저장한 세트 없음)</option>';
  };
  function drawCap() {
    const el = $('c2Cap'); if (!el) return;
    el.innerHTML = `<div class="c2-slot${img.map ? ' has' : ''}" id="c2Slot" tabindex="0" title="클릭한 뒤 Ctrl+V 로 붙여넣기 · 사진을 끌어 놓기 · 두 번 눌러 파일 고르기">` +
      (img.map ? `<img src="${img.map.data}" alt="지도 캡처"><button class="mini c2-x" data-delimg="1" title="사진 지우기">✕</button>`
        : '<div class="c2-ph"><b>PPT 용 지도 사진 칸</b><span>지도를 화면 캡처(Win+Shift+S)한 뒤 여기를 눌러 <kbd>Ctrl</kbd>+<kbd>V</kbd><br>(사진은 저장되지 않고 PPT 에만 들어갑니다)</span></div>') + '</div><input type="file" id="c2File" accept="image/*" hidden>';
  }

  /* ═════════ 표 ═════════ */
  const keepFocus = (fn) => {
    const a = document.activeElement, keep = a && root.contains(a) && (a.dataset.v != null || a.dataset.long != null) ? [a.dataset.v, a.dataset.long, a.dataset.cid, a.value, a.selectionStart] : null;
    fn();
    if (!keep) return;
    const sel = keep[1] != null ? `[data-long="${CSS.escape(keep[1])}"]` : `[data-v="${CSS.escape(keep[0])}"][data-cid="${CSS.escape(keep[2])}"]`;
    const el = root.querySelector(sel); if (el) { el.value = keep[3]; el.focus(); try { el.setSelectionRange(keep[4], keep[4]); } catch (e) { /* 무시 */ } }
  };
  function cellHtml(row, c, x) {
    const id = cid(c), ov = valOf(id, row.id), ck = valOf(id, 'ck_' + row.id);
    const ckb = `<button class="c2-ck${ck ? ' on' : ''}" data-ck="${esc(row.id)}" data-cid="${esc(id)}" title="체크(✔) — PPT 에 노란 체크로 들어갑니다">✔</button>`;
    if (row.type === 'input') {
      const url = row.route ? routeUrl(c, x) : null;
      return `<input class="c2-in" data-v="${esc(row.id)}" data-cid="${esc(id)}" value="${esc(ov || '')}" placeholder="직접 입력">${row.route ? (url ? ` <a class="btn mini" target="_blank" rel="noopener" href="${url}">🔗 길찾기</a>` : ' <small>(단지 위치를 찾으면 길찾기 버튼이 생깁니다)</small>') : ''}${ckb}`;
    }
    const src = AUTO[row.src], auto = src ? src.get(x.a[id], c, x) : null, autoTxt = auto == null ? '' : auto;
    if (ov) return `<div class="c2-ov"><input class="c2-in" data-v="${esc(row.id)}" data-cid="${esc(id)}" value="${esc(ov)}"><button class="c2-pin" data-unpin="${esc(row.id)}" data-cid="${esc(id)}" title="📌 직접 고친 값입니다. 누르면 자동 값으로 되돌립니다">📌</button></div><small class="c2-auto">자동: ${esc(autoTxt || '-')}</small>${ckb}`;
    const shown = !src ? '<small>(없는 자동 항목 — 양식 편집에서 바꾸세요)</small>' : auto == null ? `<small>${x.loading ? '불러오는 중…' : KMap.ready() ? '위치를 찾지 못했습니다' : '카카오 키를 넣으면 표시'}</small>` : `<span class="c2-t">${esc(auto)}</span>`;
    return `${shown}${auto != null ? ` <button class="c2-pin off" data-edit="${esc(row.id)}" data-cid="${esc(id)}" data-auto="${esc(autoTxt)}" title="값을 직접 고치고 📌 고정합니다">✎</button>` : ''}${ckb}`;
  }
  async function areasOf(c) {
    const k = `${c.code}|${c.key}`;
    if (!areaMemo.has(k)) areaMemo.set(k, Finder.areas(c.code, c.key).catch(() => ({ list: [] })));
    return areaMemo.get(k);
  }
  function tableHtml(x, areas) {
    const f = form(), items = ui.items;
    if (!items.length) return '<tbody><tr><td class="c2-empty">위 검색창에서 단지를 고르면 칸이 추가됩니다. (1~4개)</td></tr></tbody>';
    const head = `<thead><tr><th class="l c2-corner">${esc(f.name)}</th>${items.map((c, i) => `<th class="c2-h" style="background:${COLORS[i]};color:#fff"><div class="c2-hn">${i + 1}. ${esc(c.name)}</div>
      <div class="c2-hs">${esc(specOf(c, x))}</div><div class="evhead"><select data-area="${i}">${((areas[i] && areas[i].list) || []).map(a => `<option value="${a.g}" ${a.g === c.g ? 'selected' : ''}>${a.g}㎡ (${CONFIG.toPyeong(a.g)}평)</option>`).join('') || `<option value="${c.g}">${c.g}㎡</option>`}</select>
      <button class="mini danger" data-rm="${i}" title="이 단지 빼기">✕</button></div><small>${esc(c.sgg)} ${esc(c.dong)}</small></th>`).join('')}</tr></thead>`;
    const lk = longKey(), longs = S.longs[lk] || {};
    const body = f.rows.map(r => r.type === 'long'
      ? `<tr class="c2-long"><td class="l"><span class="rowlab">${esc(r.label)}</span></td><td colspan="${items.length}"><textarea class="c2-ta" data-long="${esc(r.id)}" rows="5" placeholder="직접 쓰거나 [자동 초안]을 누르세요">${esc(longs[r.id] || '')}</textarea>
          <div class="c2-tabtn"><button data-draft="${esc(r.id)}">✨ 자동 초안 (숫자로 계산한 문장)</button></div></td></tr>`
      : `<tr><td class="l"><span class="rowlab">${esc(r.label)}</span></td>${items.map(c => `<td class="c2-c">${cellHtml(r, c, x)}</td>`).join('')}</tr>`).join('');
    return head + `<tbody>${body}</tbody>`;
  }
  async function paint() {
    const my = ++seq;
    keepFocus(() => { $('c2Table').innerHTML = tableHtml(emptyCtx(), []); });
    const areas = await Promise.all(ui.items.map(areasOf));
    const x = await buildCtx();
    if (my !== seq) return;
    lastCtx = x;
    keepFocus(() => { $('c2Table').innerHTML = tableHtml(x, areas); });
  }

  /* ═════════ 단지 넣기·빼기 ═════════ */
  async function addItem(x) {
    if (locked()) return;
    if (ui.items.length >= MAX) return U.toast(`비교는 ${MAX}개까지입니다. 한 칸을 빼고 넣으세요.`);
    const ar = await Finder.areas(x.code, x.key).catch(() => ({ list: [] }));
    const g = ar.best ?? (ar.list[0] && ar.list[0].g) ?? 84;
    const item = { id: `${x.code}|${x.key}#${g}`, code: x.code, key: x.key, g, name: x.name, dong: x.dong, jibun: x.jibun, sido: x.sido, sgg: x.sgg };
    if (ui.items.some(c => cid(c) === item.id)) return U.toast('이미 넣은 단지입니다.');
    ui.items.push(item); saveUi(); paint(); renderMap();
  }
  function changeItems() { ui.arrowOff = (ui.arrowOff || []).filter(id => ui.items.some(c => cid(c) === id)); saveUi(); paint(); renderMap(); }

  /* ═════════ 자동 초안 ═════════ */
  function makeDraft(x) {
    const items = ui.items, out = [], f = form();
    const nm = (c) => `${items.indexOf(c) + 1}번 ${c.name}`;
    const withKm = items.filter(c => x.km[cid(c)] != null).sort((a, b) => x.km[cid(a)] - x.km[cid(b)]);
    if (withKm.length > 1) out.push(`${x.refName}까지 직선거리는 ${withKm.map(c => `${nm(c)} ${x.km[cid(c)].toFixed(1)}km`).join(' < ')} 순입니다.`);
    else if (withKm.length === 1) out.push(`${nm(withKm[0])}은(는) ${x.refName}까지 직선 ${x.km[cid(withKm[0])].toFixed(1)}km 입니다.`);
    const sub = items.map(c => { const s = x.a[cid(c)] && x.a[cid(c)].loc && x.a[cid(c)].loc.subway[0]; return s && s.m <= 500 ? `${nm(c)}(${s.name} ${Loc.meters(s.m)})` : null; }).filter(Boolean);
    if (sub.length) out.push(`역에서 500m 이내(역세권): ${sub.join(', ')}.`);
    const by = items.filter(c => x.a[cid(c)] && x.a[cid(c)].by).sort((a, b) => x.a[cid(b)].by - x.a[cid(a)].by);
    if (by.length > 1) out.push(`연식은 ${nm(by[0])}(${x.a[cid(by[0])].by}년)이 가장 새롭습니다.`);
    const hh = items.filter(c => x.a[cid(c)] && x.a[cid(c)].hh).sort((a, b) => x.a[cid(b)].hh - x.a[cid(a)].hh);
    if (hh.length > 1) out.push(`세대수는 ${nm(hh[0])}(${x.a[cid(hh[0])].hh.toLocaleString()}세대)이 가장 큽니다.`);
    const sc = items.map(c => [c, f.rows.filter(r => valOf(cid(c), 'ck_' + r.id)).length]).filter(v => v[1] > 0).sort((a, b) => b[1] - a[1]);
    if (sc.length) out.push(`✔ 표시가 가장 많은 단지: ${nm(sc[0][0])} (${sc[0][1]}개).`);
    return out.length ? out.join('\n') : '자동으로 만들 숫자가 아직 없습니다. 단지를 고르고 카카오맵이 연결되면 채워집니다.';
  }

  /* ═════════ 지도 ═════════ */
  const clearList = (l) => { l.forEach(o => o.remove()); l.length = 0; };
  const lerp = (a, b, t) => ({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
  const offIds = () => ui.arrowOff || [];
  /** 화면에서 a→b 선이 향하는 각도(도, 오른쪽 = 0). 지도 투영을 먼저 쓰고, 안 되면 메르카토르 계산 */
  function screenAngle(a, b) {
    try {
      const pr = kmap.getProjection(), pa = pr.containerPointFromCoords(KMap.LL(a)), pb = pr.containerPointFromCoords(KMap.LL(b));
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      if (isFinite(dx) && isFinite(dy) && Math.hypot(dx, dy) > 2) return Math.atan2(dy, dx) * 180 / Math.PI;
    } catch (e) { /* 아래 계산으로 */ }
    const my = (q) => Math.log(Math.tan(Math.PI / 4 + q.lat * Math.PI / 360));
    return Math.atan2(-(my(b) - my(a)), (b.lng - a.lng) * Math.PI / 180) * 180 / Math.PI;
  }
  /** 굵은 색 선 + 흰 테두리 + 직접 그린 화살촉 + 색 알약 거리 글자. shrink: 선이 도착점 몇 % 앞에서 끝날지 (기준점에서 화살촉이 뭉치지 않게) */
  function makeArrow(a, b, color, text, opt = {}) {
    const LLf = KMap.LL, e = lerp(a, b, opt.shrink == null ? 0.93 : opt.shrink), ang = screenAngle(a, e);
    const mkLine = (weight, col, op, z) => { const pl = new kakao.maps.Polyline({ path: [LLf(a), LLf(e)], strokeWeight: weight, strokeColor: col, strokeOpacity: op, strokeStyle: 'solid', zIndex: z }); pl.setMap(kmap); return pl; };
    const outline = mkLine(8, '#ffffff', 0.95, 2), line = mkLine(4.5, color, 1, 3);
    const ov = (pos, el, z) => { const o = new kakao.maps.CustomOverlay({ position: LLf(pos), content: el, xAnchor: 0.5, yAnchor: 0.5, zIndex: z }); o.setMap(kmap); return o; };
    const headEl = document.createElement('div'); headEl.className = 'c2-head';
    headEl.innerHTML = `<svg width="26" height="26" viewBox="-13 -13 26 26" style="transform:rotate(${ang}deg)"><path d="M12 0 L-8 -9 L-3 0 L-8 9 Z" fill="${color}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>`;
    const head = ov(e, headEl, 5);
    const pillEl = document.createElement('div'); pillEl.className = 'c2-pill'; pillEl.style.background = color; pillEl.textContent = text;
    const pill = ov(lerp(a, e, opt.t == null ? 0.5 : opt.t), pillEl, 6);
    return {
      remove() { outline.setMap(null); line.setMap(null); head.setMap(null); pill.setMap(null); },
      dim(on) { try { outline.setOptions({ strokeOpacity: on ? 0.2 : 0.95 }); line.setOptions({ strokeOpacity: on ? 0.25 : 1 }); } catch (err) { /* 옵션 변경 미지원이면 선은 그대로 */ } headEl.style.opacity = pillEl.style.opacity = on ? 0.25 : 1; },
    };
  }
  const highlight = (i) => autoArr.forEach(a => a.dim(i != null && a.i !== i));
  function hint() {
    const h = $('c2MapHint'); if (!h) return;
    h.textContent = pickRef ? '기준점으로 삼을 곳을 지도에서 한 번 누르세요'
      : measuring ? (mA ? '📏 시작점 지정됨 — 도착할 단지나 지도 위 한 지점을 누르세요' : '📏 거리재기: 출발할 단지나 지도 위 한 지점을 누르세요')
        : '마커를 누르면 그 단지 화살표가 꺼지고 켜집니다';
  }
  function drawLegend() {
    const el = $('c2Legend'); if (!el) return;
    const off = offIds();
    el.innerHTML = ui.items.length ? `<div class="c2-lgh">기준점: <b>${esc(curRef().name)}</b> <small>(직선거리 · 체크를 끄면 그 단지 화살표를 숨김)</small></div>` +
      ui.items.map((c, i) => { const p = posCache.get(cid(c)), d = p && curRp ? KMap.km(p, curRp) : null;
        return `<label class="c2-lg" data-i="${i}"><input type="checkbox" data-arrow="${i}" ${off.includes(cid(c)) ? '' : 'checked'}><b style="background:${COLORS[i]}">${i + 1}</b><span class="c2-lgn">${esc(c.name)}</span><span class="c2-lgk">${d == null ? '-' : d.toFixed(1) + 'km'}</span></label>`; }).join('') : '';
    const btn = $('c2ArrowAll'); if (btn) btn.textContent = ui.items.some(c => !off.includes(cid(c))) ? '화살표 전체 끄기' : '화살표 전체 켜기';
  }
  /** 켜 둔 단지마다 기준점까지 화살표 (단지가 늘면 늘어나고, 빼면 줄어듦) */
  function drawArrows() {
    clearList(autoArr);
    if (kmap && curRp) {
      const off = offIds();
      ui.items.forEach((c, i) => {
        const p = posCache.get(cid(c)); if (!p || off.includes(cid(c))) return;
        const a = makeArrow(p, curRp, COLORS[i], `${KMap.km(p, curRp).toFixed(1)}km`, { t: [0.34, 0.5, 0.66, 0.42][i] }); a.i = i; autoArr.push(a);
      });
    }
    mkList.forEach(m => { if (m.idx != null) m.el.classList.toggle('off', offIds().includes(cid(ui.items[m.idx]))); });
    drawLegend();
  }
  function toggleArrow(i, on) {
    const id = cid(ui.items[i]), off = new Set(offIds()), nowOn = on == null ? off.has(id) : on;
    if (nowOn) off.delete(id); else off.add(id);
    ui.arrowOff = [...off]; saveUi(); drawArrows();
  }
  function toggleAll() { const anyOn = ui.items.some(c => !offIds().includes(cid(c))); ui.arrowOff = anyOn ? ui.items.map(cid) : []; saveUi(); drawArrows(); }
  function clearMeasure() { clearList(measureObjs); mA = null; hint(); }
  function measurePoint(p) {
    if (!mA) {
      mA = p;
      const d = document.createElement('div'); d.className = 'c2-adot';
      const o = new kakao.maps.CustomOverlay({ position: KMap.LL(p), content: d, xAnchor: 0.5, yAnchor: 0.5, zIndex: 7 }); o.setMap(kmap);
      measureObjs.push({ remove: () => o.setMap(null) }); hint(); return;
    }
    measureObjs.push(makeArrow(mA, p, '#444444', `${KMap.km(mA, p).toFixed(1)}km`, { shrink: 1, t: 0.5 })); mA = null; hint();
  }
  function onMarker(i) {
    if (pickRef) return;
    const p = posCache.get(cid(ui.items[i])); if (!p) return;
    if (measuring) return measurePoint(p);
    toggleArrow(i);
  }
  async function renderMap(force) {
    const my = ++mapSeq, msg = $('c2MapMsg'), box = $('c2Map');
    if (!msg || !box) return;
    const say = (html) => { msg.innerHTML = html; msg.hidden = !html; };
    clearList(mkList); clearList(autoArr); clearList(measureObjs); mA = null; hint();
    if (!ui.items.length) { fitKey = ''; drawLegend(); say('단지를 고르면 지도에 표시됩니다.'); return; }
    if (!KMap.ready()) { drawLegend(); say(KMap.needKeyHtml); return; }
    say('지도를 불러오는 중…');
    let poss, rp;
    try { await KMap.load(); poss = await Promise.all(ui.items.map(posOf)); rp = await refPos(); } catch (e) { if (my === mapSeq) { drawLegend(); say(esc(e.message || String(e))); } return; }
    if (my !== mapSeq) return;
    const ok = poss.filter(Boolean);
    if (!ok.length) { drawLegend(); say('단지 위치를 찾지 못했습니다.'); return; }
    say('');
    curRp = rp;
    if (!kmap) {
      kmap = KMap.create(box, rp || ok[0], 7);
      kakao.maps.event.addListener(kmap, 'click', (ev) => {
        const p = { lat: ev.latLng.getLat(), lng: ev.latLng.getLng() };
        if (pickRef) { pickRef = false; $('c2PickRef').classList.remove('on'); cust.pos = p; ui.ref = 'custom'; saveUi(); drawRefSelect(); hint(); paint(); renderMap(true); return; }
        if (measuring) measurePoint(p);
      });
    }
    const mk = (pos, html, cls, idx, onClick) => {
      const el = document.createElement('div'); el.className = 'c2-mk ' + (cls || ''); el.innerHTML = html;
      if (onClick) el.onclick = (e) => { e.stopPropagation(); onClick(); };
      if (idx != null) { el.onmouseenter = () => highlight(idx); el.onmouseleave = () => highlight(null); }
      const ov = new kakao.maps.CustomOverlay({ position: KMap.LL(pos), content: el, xAnchor: 0.5, yAnchor: 0.5, zIndex: 8, clickable: true });
      ov.setMap(kmap);
      return { el, idx, remove: () => ov.setMap(null) };
    };
    if (rp) mkList.push(mk(rp, `<b class="ref">★</b><span>${esc(curRef().name)}</span>`, 'refmk'));
    ui.items.forEach((c, i) => {
      const p = poss[i]; if (!p) return;
      const rev = rp && rp.lng >= p.lng;                               // 이름표는 화살표 반대쪽에
      mkList.push(mk(p, `<b style="background:${COLORS[i]}">${i + 1}</b>${ui.names ? `<span class="${rev ? 'rev' : ''}">${esc(c.name)}</span>` : ''}`, '', i, () => onMarker(i)));
    });
    kmap.relayout();
    const key = ui.items.map(cid).join(',') + '|' + ui.ref + (cust.pos && ui.ref === 'custom' ? cust.pos.lat + ',' + cust.pos.lng : '');
    if (force || key !== fitKey) { KMap.fit(kmap, [...(rp ? [rp] : []), ...ok]); fitKey = key; }   // 단지·기준점이 바뀔 때만 한눈에 맞춤 (직접 움직인 화면은 그대로)
    drawArrows();
  }

  /* ═════════ 지도 사진 (붙여넣기·끌어놓기·파일) ═════════ */
  function fitImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => {
        const k = Math.min(1, 1600 / im.naturalWidth), cv = document.createElement('canvas');
        cv.width = Math.round(im.naturalWidth * k); cv.height = Math.round(im.naturalHeight * k);
        const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(im, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url); res({ data: cv.toDataURL('image/png'), w: cv.width, h: cv.height });
      };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('사진을 읽지 못했습니다.')); };
      im.src = url;
    });
  }
  async function putImage(file) {
    if (!file || !/^image\//.test(file.type || 'image/png')) return U.toast('사진 파일만 넣을 수 있습니다.');
    try { img.map = await fitImage(file); drawCap(); } catch (e) { U.toast(e.message || '사진을 넣지 못했습니다.'); }
  }

  /* ═════════ 양식 편집 ═════════ */
  function drawEditor() {
    const ed = $('c2Editor'); if (!ed) return;
    ed.hidden = !editing; $('c2EditBtn').classList.toggle('on', editing);
    if (!editing) return;
    const f = form();
    ed.innerHTML = `<h3>양식 편집 <small>줄 이름·종류를 고치면 바로 저장됩니다</small></h3>
      <div class="filters"><label>양식 이름 <input id="c2FName" value="${esc(f.name)}"></label>
        <button data-ed="copyform">이 양식 복사</button><button data-ed="delform" class="danger">이 양식 삭제</button><span class="grow"></span><button data-ed="close" class="primary">닫기</button></div>
      <div class="c2-edrows">${f.rows.map((r, i) => `<div class="c2-edrow" data-i="${i}">
        <button class="mini" data-ed="up" title="위로">▲</button><button class="mini" data-ed="down" title="아래로">▼</button>
        <input class="c2-edlab" data-edf="label" value="${esc(r.label)}" placeholder="줄 이름">
        <select data-edf="type"><option value="auto" ${r.type === 'auto' ? 'selected' : ''}>자동 값</option><option value="input" ${r.type === 'input' ? 'selected' : ''}>직접 입력</option><option value="long" ${r.type === 'long' ? 'selected' : ''}>긴 글</option></select>
        ${r.type === 'auto' ? `<select data-edf="src">${Object.keys(AUTO).map(k => `<option value="${k}" ${r.src === k ? 'selected' : ''}>${esc(AUTO[k].name)}</option>`).join('')}</select>` : ''}
        ${r.type === 'input' ? `<label class="inline"><input type="checkbox" data-edf="route" ${r.route ? 'checked' : ''}> 🔗 길찾기 버튼</label>` : ''}
        <button class="mini danger" data-ed="delrow" title="이 줄 삭제">✕</button></div>`).join('')}</div>
      <div class="filters"><button data-ed="addrow">+ 줄 추가</button><span class="hint" style="margin:0">자동 값은 카카오맵·실거래·시세트래킹·공급지도 자료로 채워지고, 칸마다 ✎ 로 고칠 수 있습니다.</span></div>`;
  }
  function mutForm(fn) { if (locked()) return; fn(form()); persist(); drawForms(); drawEditor(); paint(); }
  function onEditorClick(e) {
    const b = e.target.closest('[data-ed]'); if (!b) return;
    const k = b.dataset.ed, row = b.closest('.c2-edrow'), i = row ? +row.dataset.i : -1;
    if (k === 'close') { editing = false; return drawEditor(); }
    if (k === 'addrow') return mutForm(f => f.rows.splice(Math.max(0, f.rows.findIndex(r => r.type === 'long') < 0 ? f.rows.length : f.rows.findIndex(r => r.type === 'long')), 0, { id: newId('r'), label: '새 항목', type: 'input' }));
    if (k === 'up') return mutForm(f => { if (i > 0) [f.rows[i - 1], f.rows[i]] = [f.rows[i], f.rows[i - 1]]; });
    if (k === 'down') return mutForm(f => { if (i < f.rows.length - 1) [f.rows[i + 1], f.rows[i]] = [f.rows[i], f.rows[i + 1]]; });
    if (k === 'delrow') { if (!confirm(`"${form().rows[i].label}" 줄을 지울까요? (적어 둔 값은 남아 있어 줄을 다시 만들면 보이지 않습니다)`)) return; return mutForm(f => f.rows.splice(i, 1)); }
    if (k === 'copyform') { if (locked()) return; const f = form(), nf = { id: newId('f'), name: f.name + ' (복사)', rows: f.rows.map(r => ({ ...r, id: newId('r') })) }; S.forms.push(nf); ui.formId = nf.id; saveUi(); persist(); drawForms(); drawEditor(); paint(); return; }
    if (k === 'delform') {
      if (S.forms.length <= 1) return U.toast('양식은 하나 이상 있어야 합니다.');
      if (locked() || !confirm(`"${form().name}" 양식을 삭제할까요?`)) return;
      S.forms = S.forms.filter(f => f.id !== ui.formId); ui.formId = S.forms[0].id; saveUi(); persist(); drawForms(); drawEditor(); paint();
    }
  }
  function onEditorChange(e) {
    const t = e.target;
    if (t.id === 'c2FName') return mutForm(f => { f.name = t.value.trim() || f.name; });
    const k = t.dataset.edf; if (!k) return;
    const i = +t.closest('.c2-edrow').dataset.i;
    mutForm(f => {
      const r = f.rows[i];
      if (k === 'label') r.label = t.value.trim() || r.label;
      else if (k === 'type') { r.type = t.value; if (r.type === 'auto' && !r.src) r.src = 'dist'; if (r.type !== 'input') delete r.route; }
      else if (k === 'src') r.src = t.value;
      else if (k === 'route') { if (t.checked) r.route = 1; else delete r.route; }
    });
  }

  /* ═════════ 세트 (단지 목록 저장) ═════════ */
  function saveSet() {
    if (locked()) return;
    if (!ui.items.length) return U.toast('저장할 단지가 없습니다.');
    const name = (prompt('저장할 이름 (예: 수도권 앞마당 비교)', ui.items.map(c => c.name).join(' · ').slice(0, 30)) || '').trim();
    if (!name) return;
    const prev = S.sets.find(s => s.name === name), id = prev ? prev.id : newId('s');
    const set = { id, name, formId: ui.formId, ref: ui.ref === 'custom' ? 'gangnam' : ui.ref, items: ui.items.map(c => ({ ...c })) };
    if (prev) S.sets[S.sets.indexOf(prev)] = set; else S.sets.push(set);
    persist(); drawSets(); $('c2Sets').value = id; U.toast(`"${name}" 을(를) 저장했습니다. (단지 목록과 적은 글만 저장 — 지도 좌표는 저장하지 않습니다)`);
  }
  function loadSet() {
    const s = S.sets.find(v => v.id === $('c2Sets').value); if (!s) return U.toast('불러올 세트를 고르세요.');
    ui.items = (s.items || []).slice(0, MAX).map(c => ({ ...c, id: cid(c) }));
    if (S.forms.some(f => f.id === s.formId)) ui.formId = s.formId;
    ui.ref = REFS.some(r => r.id === s.ref) ? s.ref : 'gangnam';
    ui.arrowOff = []; saveUi(); drawForms(); drawRefSelect(); drawEditor(); paint(); renderMap();
  }
  function delSet() {
    const s = S.sets.find(v => v.id === $('c2Sets').value); if (!s || locked() || !confirm(`"${s.name}" 세트를 삭제할까요?`)) return;
    S.sets = S.sets.filter(v => v !== s); persist(); drawSets();
  }

  /* ═════════ PPT ═════════ */
  async function exportPptx() {
    if (!ui.items.length) return U.toast('비교할 단지를 먼저 고르세요.');
    const btn = $('c2Ppt'); btn.disabled = true; btn.textContent = '만드는 중…';
    try {
      await needPptx2();
      const x = await buildCtx(), f = form(), items = ui.items, n = items.length;
      const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE';
      const F = 'Malgun Gothic', BK = '000000', GR = '595959', slide = pptx.addSlide(); slide.background = { color: 'FFFFFF' };
      slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.12, w: 13.333, h: 0.72, fill: { color: BK }, line: { color: BK, width: 0 } });
      slide.addText(`★ ${f.name} ★`, { x: 0.3, y: 0.12, w: 12.7, h: 0.72, fontFace: F, fontSize: 28, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle' });
      // ── 왼쪽: 지도 칸 (사진 > 약도)
      const MX = 0.25, MY = 1.05, MW = 4.7, MH = 6.1;
      slide.addShape(pptx.ShapeType.rect, { x: MX, y: MY, w: MW, h: MH, fill: { color: 'FFFFFF' }, line: { color: BK, width: 1.5 } });
      slide.addText('지도', { x: MX, y: MY + 0.02, w: MW, h: 0.4, fontFace: F, fontSize: 16, bold: true, color: BK, align: 'center', valign: 'middle' });
      const AX = MX + 0.1, AY = MY + 0.5, AW = MW - 0.2, AH = MH - 0.6;
      if (img.map) {
        const r = Math.min(AW / img.map.w, AH / img.map.h), iw = img.map.w * r, ih = img.map.h * r;
        slide.addImage({ data: img.map.data, x: AX + (AW - iw) / 2, y: AY + (AH - ih) / 2, w: iw, h: ih });
      } else if (ui.sketch && items.some(c => x.pos[cid(c)])) sketch(pptx, slide, x, AX, AY, AW, AH, F);
      else {
        slide.addShape(pptx.ShapeType.rect, { x: AX, y: AY, w: AW, h: AH, fill: { color: 'F7F7F7' }, line: { color: 'A6A6A6', width: 0.75, dashType: 'dash' } });
        slide.addText('지도 캡처를\n여기에 붙여넣기', { x: AX, y: AY, w: AW, h: AH, fontFace: F, fontSize: 14, color: '7F7F7F', align: 'center', valign: 'middle' });
      }
      // ── 오른쪽: 표
      const TX = 5.1, TW = 8.0, LW = 1.7, CW = (TW - LW) / n, TY = 1.05, AVAIL = 7.12 - TY, HEADH = 0.75;
      const bd = { type: 'solid', pt: 1.25, color: BK };
      const longs = S.longs[longKey()] || {};
      // 글자 수로 칸 높이를 미리 계산해서 표가 슬라이드 아래로 넘치지 않게 글자 크기를 줄임
      const wIn = (t, pt) => [...String(t)].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 1.0 : 0.56) * pt / 72, 0);
      const linesOf = (t, pt, w) => String(t || '').split('\n').reduce((n2, ln) => n2 + Math.max(1, Math.ceil(wIn(ln, pt) / Math.max(0.3, w - 0.14))), 0);
      const plan = (fs) => {
        const out = []; let total = HEADH, longIdx = -1;
        f.rows.forEach((r, ri) => {
          if (r.type === 'long') { const txt = (longs[r.id] || '').trim(), sz = Math.min(fs, 11); out.push({ h: Math.max(1.1, linesOf(txt, sz, CW * n) * sz * 1.3 / 72 + 0.2), sz }); longIdx = ri; }
          else {
            const ln = Math.max(linesOf(r.label, fs + 1, LW), ...items.map(c => linesOf((valOf(cid(c), 'ck_' + r.id) ? '✔ ' : '') + (cellText(r, c, x) || ''), fs, CW)));
            out.push({ h: Math.max(0.4, ln * fs * 1.3 / 72 + 0.14), sz: fs });
          }
          total += out[out.length - 1].h;
        });
        return { out, total, longIdx };
      };
      let fs = n <= 3 ? 11 : 10, pl = plan(fs);
      while (pl.total > AVAIL && fs > 6.5) { fs -= 0.5; pl = plan(fs); }
      if (pl.total < AVAIL && pl.longIdx >= 0) pl.out[pl.longIdx].h += Math.min(AVAIL - pl.total, 1.2);      // 남는 높이는 긴 글 칸에
      const hdr = [{ text: '', options: { border: { type: 'none' } } }, ...items.map((c, i) => ({
        text: [{ text: c.name, options: { bold: true, fontSize: fs + 2, breakLine: true } }, { text: specOf(c, x), options: { bold: true, fontSize: fs + 1 } }],
        options: { fill: { color: PCOL[i] }, color: 'FFFFFF', align: 'center', valign: 'middle', border: bd, fontFace: F } }))];
      const rowsP = [hdr], hs = [HEADH];
      f.rows.forEach((r, ri) => {
        const lab = { text: r.label, options: { bold: true, fontSize: fs + 1, align: 'center', valign: 'middle', fill: { color: 'F2F2F2' }, border: bd, fontFace: F } };
        if (r.type === 'long') {
          rowsP.push([lab, { text: (longs[r.id] || '').trim(), options: { colspan: n, fontSize: pl.out[ri].sz, align: 'left', valign: 'top', border: bd, fontFace: F, fill: { color: 'F7F7F7' } } }]);
        } else {
          rowsP.push([lab, ...items.map(c => {
            const t = cellText(r, c, x) || '', ck = valOf(cid(c), 'ck_' + r.id);
            const runs = [...(ck ? [{ text: '✔ ', options: { color: 'FFC000', bold: true, fontSize: fs + 3, fontFace: 'Segoe UI Symbol' } }] : []), { text: t, options: { fontSize: fs, bold: r.type === 'auto' && r.src === 'dist' } }];
            return { text: runs, options: { align: 'center', valign: 'middle', border: bd, fontFace: F } };
          })]);
        }
        hs.push(pl.out[ri].h);
      });
      slide.addTable(rowsP, { x: TX, y: TY, w: TW, colW: [LW, ...items.map(() => CW)], rowH: hs, fontFace: F, color: BK, margin: 0.04 });
      slide.addText(`기준점: ${x.refName} (직선거리) · 자료: 카카오맵 · 국토교통부 실거래 · K-apt · 직접 입력 · ${new Date().toISOString().slice(0, 10).replace(/-/g, '.')} 작성`, { x: 0.25, y: 7.2, w: 12.8, h: 0.25, fontFace: F, fontSize: 8, color: GR });
      const fname = `비교_${f.name.replace(/[\\/:*?"<>|\s]+/g, '')}_${new Date().toISOString().slice(0, 10)}.pptx`;
      await pptx.writeFile({ fileName: fname });
      U.toast(`${fname} 을(를) 내려받았습니다.${img.map || (ui.sketch && items.some(c => x.pos[cid(c)])) ? '' : ' (지도 칸은 비어 있습니다 — PPT 에서 붙여넣으세요)'}`);
    } catch (e) { console.error(e); U.toast('PPT 를 만들지 못했습니다: ' + (e.message || e)); }
    finally { btn.disabled = false; btn.textContent = '📊 PPT 다운로드'; }
  }
  /** 배경 없는 약도: 단지·기준점을 점으로, 단지→기준점을 화살표와 거리로 (모두 PowerPoint 도형이라 고칠 수 있음) */
  function sketch(pptx, slide, x, AX, AY, AW, AH, F) {
    const pts = [];
    if (x.rp) pts.push({ ref: true, name: x.refName, p: x.rp });
    ui.items.forEach((c, i) => { const p = x.pos[cid(c)]; if (p) pts.push({ i, name: c.name, p }); });
    const lat0 = pts.reduce((s, q) => s + q.p.lat, 0) / pts.length, kx = Math.cos(lat0 * Math.PI / 180);
    const xs = pts.map(q => q.p.lng * kx), ys = pts.map(q => -q.p.lat);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, 1e-4), spanY = Math.max(maxY - minY, 1e-4), padX = 0.9, padY = 0.55;
    const s = Math.min((AW - padX * 2) / spanX, (AH - padY * 2) / spanY);
    const offX = AX + (AW - spanX * s) / 2, offY = AY + (AH - spanY * s) / 2;
    pts.forEach((q, k) => { q.x = offX + (xs[k] - minX) * s; q.y = offY + (ys[k] - minY) * s; });
    slide.addShape(pptx.ShapeType.rect, { x: AX, y: AY, w: AW, h: AH, fill: { color: 'FAFAFA' }, line: { color: 'D0D0D0', width: 0.75, dashType: 'dash' } });
    const ref = pts.find(q => q.ref), off = ui.arrowOff || [];
    if (ref) pts.filter(q => !q.ref && !off.includes(cid(ui.items[q.i]))).forEach(q => {
      const dx = ref.x - q.x, dy = ref.y - q.y, L = Math.hypot(dx, dy) || 1, sx = q.x + dx / L * 0.14, sy = q.y + dy / L * 0.14, ex = ref.x - dx / L * 0.2, ey = ref.y - dy / L * 0.2;
      const w = Math.abs(ex - sx), h = Math.abs(ey - sy), opt = { x: Math.min(sx, ex), y: Math.min(sy, ey), w, h, line: { color: PCOL[q.i], width: 2.5, endArrowType: 'triangle' } };
      if (ex < sx) opt.flipH = true;
      if (ey < sy) opt.flipV = true;
      slide.addShape(pptx.ShapeType.line, opt);
      const d = KMap.km(q.p, ref.p), t = [0.34, 0.5, 0.66, 0.42][q.i] || 0.5, mx = sx + (ex - sx) * t, my = sy + (ey - sy) * t;
      slide.addText(`${d.toFixed(1)}km`, { x: mx - 0.4, y: my - 0.12, w: 0.8, h: 0.24, shape: pptx.ShapeType.roundRect, wrap: false, margin: 0, fontFace: F, fontSize: 10, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', fill: { color: PCOL[q.i] }, line: { color: 'FFFFFF', width: 1 } });
    });
    const placed = [];
    pts.forEach(q => {
      if (q.ref) { slide.addShape(pptx.ShapeType.star5, { x: q.x - 0.15, y: q.y - 0.15, w: 0.3, h: 0.3, fill: { color: 'FFC000' }, line: { color: '000000', width: 1 } }); }
      else slide.addShape(pptx.ShapeType.ellipse, { x: q.x - 0.14, y: q.y - 0.14, w: 0.28, h: 0.28, fill: { color: PCOL[q.i] }, line: { color: 'FFFFFF', width: 1 } });
      if (!q.ref) slide.addText(String(q.i + 1), { x: q.x - 0.14, y: q.y - 0.14, w: 0.28, h: 0.28, fontFace: F, fontSize: 9, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle', margin: 0 });
      const right = q.x < AX + AW / 2, tw = 1.7;
      let ly = q.y - 0.14;                                              // 이름표끼리 겹치면 아래로 밀기
      for (let tries = 0; tries < 6 && placed.some(r => r.right === right && Math.abs(r.y - ly) < 0.27 && Math.abs(r.x - q.x) < tw); tries++) ly += 0.28;
      placed.push({ right, y: ly, x: q.x });
      slide.addText(q.name, { x: right ? q.x + 0.2 : q.x - 0.2 - tw, y: ly, w: tw, h: 0.28, fontFace: F, fontSize: q.ref ? 11 : 10, bold: true, color: q.ref ? '000000' : PCOL[q.i], align: right ? 'left' : 'right', valign: 'middle', margin: 0 });
    });
  }

  /* ═════════ 연결 ═════════ */
  function wire() {
    root.addEventListener('change', (e) => {
      const t = e.target;
      if (t.closest('#c2Editor')) return onEditorChange(e);
      if (t.id === 'c2Ref') { ui.ref = t.value; saveUi(); paint(); renderMap(); return; }
      if (t.id === 'c2Sketch') { ui.sketch = t.checked ? 1 : 0; saveUi(); return; }
      if (t.id === 'c2Names') { ui.names = t.checked ? 1 : 0; saveUi(); renderMap(); return; }
      if (t.dataset.arrow != null) { toggleArrow(+t.dataset.arrow, t.checked); return; }
      if (t.id === 'c2File') { const f = t.files && t.files[0]; t.value = ''; if (f) putImage(f); return; }
      if (t.dataset.area != null) {
        const i = +t.dataset.area, c = ui.items[i], g = +t.value;
        if (ui.items.some((v, j) => j !== i && v.code === c.code && v.key === c.key && v.g === g)) { U.toast('같은 단지의 같은 평형이 이미 있습니다.'); return paint(); }
        c.g = g; c.id = cid(c); return changeItems();
      }
      if (t.dataset.v != null && t.dataset.cid) {
        if (locked()) return paint();
        const empty = !t.value.trim(); setVal(t.dataset.cid, t.dataset.v, empty ? '' : t.value.trim());
        if (empty && t.closest('.c2-ov')) paint();
      }
    });
    root.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.long != null) {
        if (locked()) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { const k = longKey(), o = (S.longs[k] = S.longs[k] || {}); if (t.value.trim()) o[t.dataset.long] = t.value; else delete o[t.dataset.long]; if (!Object.keys(o).length) delete S.longs[k]; persist(); }, 400);
      }
    });
    root.addEventListener('focusin', (e) => { const t = e.target; if ((t.dataset.v != null || t.dataset.long != null || t.id === 'c2FName') && typeof Vault !== 'undefined' && Vault.isLocked()) { t.blur(); locked(); } });
    root.addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest('#c2Editor')) return onEditorClick(e);
      const fb = t.closest('[data-form]');
      if (fb) { ui.formId = fb.dataset.form; saveUi(); drawForms(); drawEditor(); return paint(); }
      if (t.closest('[data-newform]')) { if (locked()) return; const nf = { id: newId('f'), name: '새 양식', rows: [{ id: newId('r'), label: '항목 1', type: 'input' }, { id: newId('r'), label: '생각', type: 'long' }] }; S.forms.push(nf); ui.formId = nf.id; persist(); saveUi(); editing = true; drawForms(); drawEditor(); return paint(); }
      if (t.closest('#c2EditBtn')) { editing = !editing; return drawEditor(); }
      if (t.closest('#c2Ppt')) return exportPptx();
      if (t.closest('#c2SaveSet')) return saveSet();
      if (t.closest('#c2LoadSet')) return loadSet();
      if (t.closest('#c2DelSet')) return delSet();
      if (t.closest('#c2ClrArrow')) return clearMeasure();
      if (t.closest('#c2ArrowAll')) return toggleAll();
      if (t.closest('#c2Fit')) return renderMap(true);
      if (t.closest('#c2Measure')) { if (!kmap) return U.toast('지도가 아직 준비되지 않았습니다. 단지를 먼저 고르세요.'); measuring = !measuring; pickRef = false; $('c2PickRef').classList.remove('on'); mA = null; $('c2Measure').classList.toggle('on', measuring); if (!measuring) clearMeasure(); hint(); return; }
      if (t.closest('#c2PickRef')) { if (!kmap) return U.toast('지도가 아직 준비되지 않았습니다. 단지를 먼저 고르세요.'); pickRef = !pickRef; measuring = false; mA = null; $('c2Measure').classList.remove('on'); hint(); $('c2PickRef').classList.toggle('on', pickRef); U.toast(pickRef ? '지도에서 기준점으로 삼을 곳을 한 번 누르세요.' : '기준점 지정을 취소했습니다.'); return; }
      const rm = t.closest('[data-rm]'); if (rm) { if (locked()) return; ui.items.splice(+rm.dataset.rm, 1); return changeItems(); }
      const ck = t.closest('[data-ck]'); if (ck) { if (locked()) return; const on = !valOf(ck.dataset.cid, 'ck_' + ck.dataset.ck); setVal(ck.dataset.cid, 'ck_' + ck.dataset.ck, on ? '1' : ''); ck.classList.toggle('on', on); return; }
      const ed = t.closest('[data-edit]');
      if (ed) { if (locked()) return; setVal(ed.dataset.cid, ed.dataset.edit, ed.dataset.auto || '-'); paint().then(() => { const el = root.querySelector(`[data-v="${CSS.escape(ed.dataset.edit)}"][data-cid="${CSS.escape(ed.dataset.cid)}"]`); if (el) { el.focus(); el.select(); } }); return; }
      const up = t.closest('[data-unpin]'); if (up) { if (locked()) return; setVal(up.dataset.cid, up.dataset.unpin, ''); return paint(); }
      const dr = t.closest('[data-draft]');
      if (dr) {
        if (locked()) return;
        const ta = root.querySelector(`[data-long="${CSS.escape(dr.dataset.draft)}"]`); if (!ta) return;
        if (ta.value.trim() && !confirm('이미 적은 글이 있습니다. 자동 초안으로 바꿀까요?')) return;
        const run = async () => { const x = lastCtx || await buildCtx(); ta.value = makeDraft(x); ta.dispatchEvent(new Event('input', { bubbles: true })); };
        return run();
      }
      if (t.closest('[data-delimg]')) { img.map = null; return drawCap(); }
      const sl = t.closest('#c2Slot'); if (sl) sl.focus();
    });
    root.addEventListener('dblclick', (e) => { if (e.target.closest('#c2Slot') && !e.target.closest('[data-delimg]')) { const f = $('c2File'); if (f) f.click(); } });
    root.addEventListener('dragover', (e) => { const s = e.target.closest('#c2Slot'); if (s) { e.preventDefault(); s.classList.add('over'); } });
    root.addEventListener('dragleave', (e) => { const s = e.target.closest('#c2Slot'); if (s) s.classList.remove('over'); });
    root.addEventListener('drop', (e) => { const s = e.target.closest('#c2Slot'); if (!s) return; e.preventDefault(); s.classList.remove('over'); const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) putImage(f); });
    root.addEventListener('mouseover', (e) => { const r = e.target.closest('.c2-lg'); if (r) highlight(+r.dataset.i); });
    root.addEventListener('mouseout', (e) => { if (e.target.closest('.c2-lg')) highlight(null); });
    document.addEventListener('paste', (e) => {                         // Ctrl+V: 이 탭이 보이고 글 입력 중이 아닐 때만 사진으로 받음
      if (root.hidden || !inited) return;
      const a = document.activeElement; if (a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'checkbox'))) return;
      const it = [...(e.clipboardData?.items || [])].find(v => v.kind === 'file' && /^image\//.test(v.type)); if (!it) return;
      e.preventDefault(); putImage(it.getAsFile());
    });
    if (typeof Stations !== 'undefined' && Stations.onChange) Stations.onChange(() => { autos.clear(); });
  }

  async function open() {
    if (!inited) { loadState(); loadUi(); inited = true; frame(); wire(); }
    paint();
    renderMap().then(() => { if (kmap) kmap.relayout(); });
  }
  const reload = () => {
    if (!inited) return;
    loadState(); if (!S.forms.some(f => f.id === ui.formId)) ui.formId = S.forms[0].id;
    drawForms(); drawSets(); drawEditor(); if (!root.hidden) paint();
  };
  return { open, reload, _state: () => S, _ui: () => ui, _ctx: () => lastCtx };
})();
