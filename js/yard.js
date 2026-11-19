/* ─────────────────────────────────────────────────────────
   yard.js — [앞마당] 탭 : 앞마당 단지를 모아 두고, 매달 평형별·가격대별 1등을 뽑는 작업대
   · ① 1등 뽑기  : 평형 그룹(59·74·84…)을 고르면 내가 적은 매매 호가로 가격대 칸(기본 1억)을 나누고, 칸마다 🥇 1등을 지정 (달별 저장)
   · ② 조사 기록 : 조사한 날짜(회차)마다 매매·전세 호가와 매물 수를 적음 → 과거 가격 추적, 두 조사 비교
   · ③ 1등 기록  : 달별로 가격대마다 누가 1등이었는지
   · 시세트래킹·랜드마크·시세그룹핑과 따로 저장합니다. 시세트래킹으로는 [트래킹 담기]로 보낼 때만 넘어갑니다.
   · 가격대 기준 = 기준 조사 날짜까지 내가 적은 가장 최근 매매 호가 (그 조사에 안 적은 단지는 바로 앞 조사 값을 이어 씀)
   · 탭을 처음 열 때만 화면을 만듭니다. app.js 를 고치지 않으려고 탭이 보이는 것을 직접 지켜봅니다. (단지 수 탭과 같은 방식)
   저장 위치: apt.yard.v1 단지 · apt.yardSurveys.v1 조사 기록 · apt.yardPicks.v1 1등 기록 · apt.yardOpts.v1 평형 그룹·가격대 폭 · apt.yardUi.v1 화면 상태
   금액은 모두 만원 단위로 저장하고, 화면에는 억으로 보여 줍니다.
   ───────────────────────────────────────────────────────── */
const Yard = (() => {
  const root = document.getElementById('tab-yard');
  if (!root) return {};
  const $ = (id) => document.getElementById(id);
  const KEY = 'apt.yard.v1', SKEY = 'apt.yardSurveys.v1', PKEY = 'apt.yardPicks.v1', OKEY = 'apt.yardOpts.v1', UKEY = 'apt.yardUi.v1';
  const DEF_GROUPS = [{ k: '59', min: 55, max: 65 }, { k: '74', min: 66, max: 79 }, { k: '84', min: 80, max: 89 }];
  const THIS_Y = new Date().getFullYear();
  const esc = (s) => U.esc(s);

  let cx = {}, sv = {}, picks = {}, opts = {}, ui = {};
  let inited = false, regions = null, checked = new Set(), closed = new Set(), echecked = new Set(), hist = null, seq = 0;

  /* ═════════ 저장 ═════════ */
  function loadState() {
    cx = Store.get(KEY, {}); sv = Store.get(SKEY, {}); picks = Store.get(PKEY, {});
    const o = Store.get(OKEY, {});
    opts = { groups: Array.isArray(o.groups) && o.groups.length ? o.groups : DEF_GROUPS.map(g => ({ ...g })), step: +o.step > 0 ? +o.step : 1 };
    const u = Store.get(UKEY, {});
    ui = Object.assign({ sub: 'pick', grp: '84', ym: thisYm(), step: null, sort: 's', onlyPick: false, esid: '', egrp: '', esgg: '', onlyEmpty: false, ca: '', cb: '', csort: 'up', rgrp: '84', rfrom: '', rto: '' }, u);
    if (!opts.groups.some(g => g.k === ui.grp)) ui.grp = opts.groups[opts.groups.length - 1].k;
    if (!opts.groups.some(g => g.k === ui.rgrp)) ui.rgrp = ui.grp;
  }
  let savedAt = null;
  function mark(ok) {
    savedAt = new Date();
    const el = document.getElementById('ydSaved'); if (!el) return;
    el.textContent = ok === false ? '⚠ 저장 실패 — 앞마당 파일로 저장해 두세요' : `✓ 저장됨 ${String(savedAt.getHours()).padStart(2, '0')}:${String(savedAt.getMinutes()).padStart(2, '0')}`;
    el.classList.toggle('bad', ok === false);
  }
  const put = (k, v) => { const ok = Store.set(k, v); mark(ok !== false); return ok; };
  const saveCx = () => put(KEY, cx);
  const saveSv = () => put(SKEY, sv);
  const savePk = () => put(PKEY, picks);
  const saveOpts = () => put(OKEY, opts);
  const saveUi = () => Store.set(UKEY, ui);
  const locked = () => { if (typeof Vault !== 'undefined' && Vault.isLocked()) { U.toast('잠금 상태입니다. 오른쪽 위 [잠금]을 풀면 고칠 수 있습니다.'); return true; } return false; };

  /* ═════════ 작은 도구 ═════════ */
  function thisYm() { const t = new Date(); return t.getFullYear() * 100 + t.getMonth() + 1; }
  const today = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  const ymOf = (date) => +String(date).slice(0, 7).replace('-', '');
  const ymLabel = (ym) => `${String(ym).slice(0, 4)}년 ${+String(ym).slice(4)}월`;
  const ymShort = (ym) => `${String(ym).slice(0, 4)}-${String(ym).slice(4)}`;
  const dShort = (date) => (String(date).slice(0, 4) === String(THIS_Y) ? String(date).slice(5) : String(date).slice(2));
  const eok = (v) => (v == null ? '-' : String(+(v / 10000).toFixed(2)));
  const eokIn = (v) => (v == null ? '' : String(+(v / 10000).toFixed(4)));
  const toMan = (t) => { const s = String(t ?? '').trim().replace(/,/g, ''); if (s === '') return null; const n = Number(s); return isNaN(n) || n < 0 ? NaN : Math.round(n * 10000); };
  const cidOf = (x) => `${x.code}|${x.key}`;
  const stepMan = () => Math.round((ui.step || opts.step) * 10000);
  const bandLo = (s, st = stepMan()) => Math.floor(s / st) * st;
  function bandLabel(lo, hi) {
    const st = hi - lo;
    if (st === 10000) return `${lo / 10000}억대`;
    return `${+(lo / 10000).toFixed(2)}~${+(hi / 10000).toFixed(2)}억`;
  }
  const bandRange = (lo, hi) => (hi - lo === 10000 ? `${(lo / 10000).toFixed(1)}~${(hi / 10000 - 0.1).toFixed(1)}억` : `${+(lo / 10000).toFixed(2)}억 이상 ${+(hi / 10000).toFixed(2)}억 미만`);
  const groupOf = (g) => opts.groups.find(x => g >= x.min && g <= x.max) || null;
  const grpName = (k) => `${k}`;

  /** 앞마당의 평형 줄들 (단지 × 평형) */
  function allRows() {
    const out = [];
    for (const cid of Object.keys(cx)) {
      const c = cx[cid];
      for (const g of c.gs || []) { if (c.hide && c.hide.includes(g)) continue; const gr = groupOf(g); if (gr) out.push({ id: `${cid}#${g}`, cid, code: c.code, key: c.key, sido: c.sido, sgg: c.sgg, dong: c.dong, jibun: c.jibun, name: c.name, g, grp: gr.k }); }
    }
    return out;
  }
  /** 조사 회차 (날짜 오름차순) */
  const surveysAsc = () => Object.keys(sv).map(id => ({ id, ...sv[id] })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.t || 0) - (b.t || 0)));
  const surveysDesc = () => surveysAsc().reverse();
  /** 기준 회차(sid)까지 적은 가장 최근 값 → { s, r, n, date, sid } (sid 가 비면 전체에서 가장 최근). before=true 면 sid 보다 앞 회차만 */
  function valueAt(rowId, sid, before) {
    const list = surveysAsc();
    let end = list.length - 1;
    if (sid) { const i = list.findIndex(s => s.id === sid); if (i >= 0) end = before ? i - 1 : i; }
    for (let i = end; i >= 0; i--) { const q = list[i].q?.[rowId]; if (q && (q.s != null || q.r != null)) return { s: q.s ?? null, r: q.r ?? null, n: q.n ?? null, date: list[i].date, sid: list[i].id }; }
    return null;
  }
  /** 그 값보다 앞에 적은 매매 호가 (지난 대비 계산용) */
  function prevOf(rowId, v) { return v ? valueAt(rowId, v.sid, true) : null; }

  /* ═════════ 화면 틀 ═════════ */
  function frame() {
    root.innerHTML = `
    <section class="panel yd-head">
      <div class="bar"><strong>🏡 앞마당</strong><span class="hint" style="margin:0" id="ydStatus"></span><span class="grow"></span>
        <span class="yd-remind" id="ydRemind" hidden></span>
        <span class="yd-saved" id="ydSaved" title="호가·픽·1등·메모는 입력하는 순간 이 브라우저에 자동 저장됩니다">✓ 자동 저장 중</span>
        <button id="ydSave" title="지금 상태를 이 브라우저에 저장 (입력할 때마다 자동으로도 저장됩니다)">💾 저장</button>
        <button id="ydExport" title="앞마당 단지·호가 기록·픽·1등 기록·설정을 파일 하나로 내려받기">📤 앞마당 파일 저장</button>
        <button id="ydImport" title="다른 기기에서 저장한 앞마당 파일 불러오기">📥 앞마당 파일 불러오기</button><input type="file" id="ydImportFile" accept=".json,application/json" hidden>
        <button id="ydOpts">⚙ 평형·가격대 설정</button></div>
      <div class="filters">
        <label class="findlab">🔎 전국 단지 검색 <input type="search" id="ydFind" placeholder="단지 이름 (예: 평촌 꿈마을)" autocomplete="off" style="min-width:260px"></label>
        <button id="ydManual" title="검색에 없는 단지(신축·분양권·소규모)를 직접 적어서 추가">✏ 직접 추가</button>
        <span class="yd-sep"></span>
        <label>시/도 <select id="ydRSido"></select></label>
        <label>시/군/구 <select id="ydRSgg"></select></label>
        <label>읍/면/동 <select id="ydRDong"><option value="">전체</option></select></label>
        <label>세대수 <span class="row"><input id="ydRHh" class="num" inputmode="numeric" value="300" style="width:70px"> 세대 이상</span></label>
        <label class="row" style="flex-direction:row;align-items:center;padding-bottom:7px"><input type="checkbox" id="ydRUnk"> 세대수 모르는 단지도</label>
        <div><span class="hint" style="margin:0">추가할 평형</span><div class="row yd-rgrp" id="ydRGrp"></div></div>
        <button id="ydRAdd">📍 지역 단지 한꺼번에 추가</button>
      </div>
      <div class="yd-found" id="ydFound" hidden></div>
    </section>
    <div class="presets yd-subs" id="ydSubs"><button data-s="pick">① 1등 뽑기</button><button data-s="survey">② 조사 기록</button><button data-s="record">③ 1등 기록</button></div>
    <div id="ydEmpty" class="panel empty" hidden></div>
    <section class="panel" id="ydPick" hidden></section>
    <section class="panel" id="ydSurvey" hidden></section>
    <section class="panel" id="ydRecord" hidden></section>
    <div id="ydMenu" class="yd-menu" hidden></div>
    <div class="modal" id="ydModal" hidden><div class="modalbox" id="ydModalBox"></div></div>`;
  }

  function status() {
    const n = Object.keys(cx).length, last = surveysDesc()[0], all = allRows();
    const rows = all.filter(r => r.grp === ui.grp), bands = new Set();
    rows.forEach(r => { const v = valueAt(r.id, ''); if (v?.s != null) bands.add(bandLo(v.s)); });
    const pk = picks[ui.ym]?.[ui.grp] || {}, done = [...bands].filter(lo => pk[lo]).length;
    $('ydStatus').textContent = `단지 ${n}개 · 픽 ${all.filter(r => picked(r.id)).length}개 · 최근 입력 ${last ? last.date : '없음'} · ${ymLabel(ui.ym)} ${grpName(ui.grp)}㎡ 1등 ${bands.size}칸 중 ${done}칸`;
  }
  function show() {
    document.querySelectorAll('#ydSubs button').forEach(b => b.classList.toggle('on', b.dataset.s === ui.sub));
    const empty = !Object.keys(cx).length;
    $('ydEmpty').hidden = !empty;
    if (empty) $('ydEmpty').innerHTML = '아직 앞마당 단지가 없습니다.<br>위에서 단지를 검색해 고르거나, 지역을 골라 <b>[📍 지역 단지 한꺼번에 추가]</b>를 누르세요.';
    ['pick', 'survey', 'record'].forEach(s => { $('yd' + s[0].toUpperCase() + s.slice(1)).hidden = empty || ui.sub !== s; });
    hideMenu();
    if (!empty) { if (ui.sub === 'pick') renderPick(); else if (ui.sub === 'survey') renderSurvey(); else renderRecord(); }
    status();
    remind();
  }

  /* ═════════ 단지 추가·빼기 ═════════ */
  /** 검색한 단지 추가. gsAll = 그 단지의 모든 평형, chosen = 고른 평형 (고르지 않은 평형은 숨겨 둠 → 나중에 [평형 저장]으로 바꿀 수 있음) */
  function addOne(x, gsAll, chosen) {
    if (locked()) return;
    const cid = cidOf(x);
    if (cx[cid]) return U.toast(`${x.name} 은(는) 이미 앞마당에 있습니다.`);
    if (!chosen?.length) return U.toast('추가할 평형을 하나 이상 고르세요.');
    const gs = [...new Set([...(gsAll || []), ...chosen])].sort((a, b) => a - b);
    const hide = gs.filter(g => !chosen.includes(g));
    cx[cid] = { code: x.code, key: x.key, sido: x.sido, sgg: x.sgg, dong: x.dong, jibun: x.jibun, name: x.name, gs, ...(hide.length ? { hide } : {}), t: Date.now(), memo: '' };
    saveCx();
    const inGrp = chosen.filter(g => groupOf(g));
    const back = surveysAsc().some(s => Object.keys(s.q || {}).some(id => id.startsWith(cid + '#')));
    U.toast(`${x.name} ${chosen.join('·')}㎡ 를 앞마당에 추가했습니다.${back ? ' 예전에 적은 호가 기록도 그대로 살아났습니다.' : ''}${inGrp.length < chosen.length ? ' (평형 그룹 밖 평형은 표에 안 보입니다 — ⚙ 설정에서 그룹을 늘릴 수 있습니다)' : ''}`);
    if (inGrp.length && !inGrp.some(g => groupOf(g).k === ui.grp)) { ui.grp = groupOf(inGrp[inGrp.length - 1]).k; saveUi(); }
    show(); foundBox();
  }
  /** 이미 있는 단지의 평형 바꾸기 */
  function setGs(cid, chosen) {
    if (locked()) return;
    const c = cx[cid]; if (!c) return;
    if (!chosen.length) return U.toast('평형을 하나 이상 고르세요. 단지를 빼려면 [목록에서 지우기]를 누르세요.');
    c.gs = [...new Set([...(c.gs || []), ...chosen])].sort((a, b) => a - b);
    const hide = c.gs.filter(g => !chosen.includes(g));
    if (hide.length) c.hide = hide; else delete c.hide;
    [...checked].forEach(id => { if (id.startsWith(cid + '#') && !chosen.includes(+id.split('#')[1])) checked.delete(id); });
    saveCx(); show(); foundBox();
    U.toast(`${c.name} 평형을 ${chosen.join('·')}㎡ 로 저장했습니다.`);
  }

  /** 평형 체크 칸 + 빠른 선택 (검색 결과 줄 공용). list = [{ g, n, old }], on = 체크할 평형 Set */
  function gsPicker(list, on, extra = '') {
    return `<div class="yd-gspick"><span class="hint" style="margin:0">평형 고르기</span>
      <span class="yd-quick">빠른 선택: ${opts.groups.map(g => `<button type="button" class="mini" data-q="${esc(g.k)}" title="전용 ${g.min}~${g.max}㎡">${esc(g.k)}</button>`).join('')}<button type="button" class="mini" data-q="*">전체</button><button type="button" class="mini" data-q="-">해제</button></span>
      <span class="yd-gsl">${list.map(a => `<label class="yd-gs ${a.old ? 'old' : ''}"><input type="checkbox" value="${a.g}" ${on.has(a.g) ? 'checked' : ''}> ${a.g}㎡<small>${CONFIG.toPyeong(a.g)}평${a.n != null ? ` · ${a.n}건` : ''}${a.old ? ' · 5년 전 거래' : ''}</small></label>`).join('') || '<span class="hint" style="margin:0">평형 정보가 없습니다</span>'}</span>${extra}</div>`;
  }
  function gsPickerEvents(host, onChange) {
    host.querySelectorAll('[data-q]').forEach(b => { b.onclick = () => {
      const q = b.dataset.q, gr = opts.groups.find(g => g.k === q);
      host.querySelectorAll('.yd-gs input').forEach(i => { const g = +i.value; if (q === '*') i.checked = true; else if (q === '-') i.checked = false; else if (gr && g >= gr.min && g <= gr.max) i.checked = true; });
      onChange();
    }; });
    host.querySelectorAll('.yd-gs input').forEach(i => { i.onchange = onChange; });
  }
  const chosenOf = (host) => [...host.querySelectorAll('.yd-gs input:checked')].map(i => +i.value);

  /* ── 검색 결과 줄: [＋ 앞마당에 추가] / ✓ 앞마당에 있음 [표에서 보기] [목록에서 지우기] ── */
  let found = null;
  async function foundBox(x) {
    if (x) found = { x, list: null };
    const el = $('ydFound'); if (!el) return;
    if (!found) { el.hidden = true; return; }
    const f = found, cid = cidOf(f.x), c = cx[cid];
    el.hidden = false;
    const where = `${esc(f.x.sido)} ${esc(f.x.sgg)} ${esc(f.x.dong)}`;
    el.className = 'yd-found' + (c ? ' in' : '');
    el.innerHTML = `<div class="bar" style="margin:0"><span>${c ? '✓ ' : ''}<b>${esc(f.x.name)}</b> <small>${where}</small>${c ? ' · <b class="yd-inmk">앞마당에 있음</b>' : ''}</span><span class="grow"></span>` +
      (c ? '<button data-fd="go">표에서 보기</button><button data-fd="del" class="danger">목록에서 지우기</button>' : '') + '<button data-fd="x" class="mini" title="닫기">✕</button></div><div id="ydFoundPick"><p class="hint" style="margin:6px 0 0">평형을 확인하는 중…</p></div>';
    el.onclick = (e) => {
      const k = e.target.closest('[data-fd]')?.dataset.fd; if (!k) return;
      if (k === 'x') { found = null; return foundBox(); }
      if (k === 'go') return goToCx(cid);
      if (k === 'del') return askRemoveCx(cid);
      if (k === 'add') return addOne(f.x, (f.list || []).map(a => a.g), chosenOf(el));
      if (k === 'save') return setGs(cid, chosenOf(el));
    };
    if (!f.list) { try { f.list = (await Finder.areas(f.x.code, f.x.key)).list; } catch (e) { console.error(e); f.list = []; } }
    if (found !== f || !$('ydFoundPick')) return;
    const list = [...f.list]; (c?.gs || []).forEach(g => { if (!list.some(a => a.g === g)) list.push({ g, n: null }); }); list.sort((a, b) => a.g - b.g);
    const on = new Set(c ? (c.gs || []).filter(g => !(c.hide || []).includes(g)) : []);       // 새 단지는 아무것도 체크하지 않음
    const pick = $('ydFoundPick');
    pick.innerHTML = list.length ? gsPicker(list, on, `<span class="grow"></span>${c ? '<button data-fd="save" class="primary" id="ydFoundBtn">평형 저장</button>' : '<button data-fd="add" class="primary" id="ydFoundBtn" disabled>＋ 앞마당에 추가</button>'}`)
      : '<p class="hint" style="margin:6px 0 0">이 단지는 거래 자료가 없어 평형을 알 수 없습니다. [✏ 직접 추가]로 평형을 적어 추가하세요.</p>';
    const sync = () => { const b = $('ydFoundBtn'); if (!b) return; const n = chosenOf(pick).length;
      if (c) b.textContent = `평형 저장 (${n}개)`; else { b.disabled = !n; b.textContent = n ? `＋ 고른 평형 ${n}개 앞마당에 추가` : '＋ 평형을 고르세요'; } };
    gsPickerEvents(pick, sync); sync();
  }
  /** 표에서 그 단지 줄로 이동해 잠깐 강조 */
  let goTo = null;
  function goToCx(cid) {
    const c = cx[cid]; if (!c) return;
    const gs = (c.gs || []).filter(g => !(c.hide || []).includes(g) && groupOf(g));
    if (!gs.length) return U.toast('이 단지는 지금 평형 그룹에 맞는 평형이 없어 표에 안 보입니다. ⚙ 설정에서 그룹을 늘려 보세요.');
    if (!gs.some(g => groupOf(g).k === ui.grp)) ui.grp = groupOf(gs.find(g => groupOf(g).k === '84') || gs[gs.length - 1]).k;
    ui.sub = 'pick'; saveUi(); goTo = cid; show();
  }
  function flashGoTo() {
    if (!goTo) return;
    const cid = goTo; goTo = null;
    const trs = [...document.querySelectorAll(`#ydTable tr[data-id^="${CSS.escape(cid)}#"]`)];
    if (!trs.length) return U.toast('필터나 "픽한 단지만 보기" 때문에 표에 안 보입니다. 위의 [모두 풀기]를 눌러 보세요.');
    trs.forEach(tr => { tr.closest('tbody')?.classList.remove('yd-closed'); tr.classList.add('yd-flash'); setTimeout(() => tr.classList.remove('yd-flash'), 2600); });
    trs[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  /** 검색 목록에 이미 추가한 단지 ✓ 표시 */
  function markDrop() {
    const box = $('ydFind')?.parentElement?.querySelector('.fdrop'); if (!box || box.dataset.ydw) return;
    box.dataset.ydw = '1';
    const keyOf = (name, where) => `${name}|${where}`;
    new MutationObserver(() => {
      const have = new Set(Object.values(cx).map(c => keyOf(c.name, `${c.sido} ${c.sgg} ${c.dong}`)));
      const none = box.querySelector('p');
      if (none && !box.querySelector('button[data-i]') && /결과가 없습니다/.test(none.textContent) && !box.querySelector('.yd-man')) {
        none.insertAdjacentHTML('afterend', '<button type="button" class="yd-man">✏ 검색에 없는 단지 직접 추가</button>');
        box.querySelector('.yd-man').onclick = () => { box.hidden = true; openManual(null, $('ydFind').value.trim()); };
      }
      box.querySelectorAll('button[data-i]').forEach(b => {
        if (b.querySelector('.yd-in-mark')) return;
        const name = b.querySelector('b')?.textContent || '', where = (b.querySelector('small')?.textContent || '').split(' · ')[0].trim();
        if (have.has(keyOf(name, where))) b.querySelector('b').insertAdjacentHTML('afterend', ' <span class="yd-in-mark">✓ 앞마당</span>');
      });
    }).observe(box, { childList: true });
  }

  async function fillRegion(level) {
    if (!regions) regions = await Data.regions();
    if (level <= 0) {
      const sidos = [...new Set(regions.map(r => r[1]))], last = Store.get('apt.lastRegion', null);
      $('ydRSido').innerHTML = sidos.map(s => `<option>${esc(s)}</option>`).join('');
      if (last && sidos.includes(last.sido)) $('ydRSido').value = last.sido;
    }
    if (level <= 1) {
      const list = regions.filter(r => r[1] === $('ydRSido').value), last = Store.get('apt.lastRegion', null);
      $('ydRSgg').innerHTML = list.map(r => `<option value="${r[0]}">${esc(r[2])}</option>`).join('');
      if (last && list.some(r => r[0] === last.code)) $('ydRSgg').value = last.code;
    }
    const code = $('ydRSgg').value, idx = await Data.index(code);
    if (code !== $('ydRSgg').value) return;
    const dongs = [...new Set(Object.keys(idx.c).map(k => Data.parseKey(k).dong))].sort((a, b) => a.localeCompare(b, 'ko'));
    $('ydRDong').innerHTML = '<option value="">전체</option>' + dongs.map(d => `<option>${esc(d)}</option>`).join('');
  }

  async function addRegion() {
    if (locked()) return;
    const code = $('ydRSgg').value, reg = regions?.find(r => r[0] === code); if (!reg) return;
    const dong = $('ydRDong').value, min = parseInt($('ydRHh').value, 10) || 0, unk = $('ydRUnk').checked;
    const grs = opts.groups.filter(g => $('ydRGrp').querySelector(`input[value="${CSS.escape(g.k)}"]`)?.checked);
    if (!grs.length) return U.toast('추가할 평형(59·74·84)을 하나 이상 체크하세요.');
    const inSel = (g) => grs.some(x => g >= x.min && g <= x.max);
    const btn = $('ydRAdd'); btn.disabled = true; btn.textContent = '단지를 찾는 중…';
    try {
      const [idx, kp, data] = await Promise.all([Data.index(code), Data.kapt(code), Data.loadYears(code, THIS_Y - 8, THIS_Y)]);
      const gs = new Map();
      for (const kind of ['sale', 'rent']) Data.eachTrade(data[kind], null, (key, t) => { if (!gs.has(key)) gs.set(key, new Set()); gs.get(key).add(t.g); });
      const cand = Object.keys(idx.c).filter(key => {
        const p = Data.parseKey(key); if (dong && p.dong !== dong) return false;
        if (![...(gs.get(key) || [])].some(inSel)) return false;
        const hh = kp.m[key]?.[0]; return hh ? hh >= min : unk;
      });
      const fresh = cand.filter(key => !cx[`${code}|${key}`]);
      const where = `${reg[1]} ${reg[2]}${dong ? ' ' + dong : ''}`;
      if (!fresh.length) return U.toast(cand.length ? `${where}의 조건에 맞는 ${cand.length}개 단지는 이미 모두 앞마당에 있습니다.` : `${where}에 조건(세대수 ${min} 이상, 평형 ${grs.map(g => g.k).join('·')})에 맞는 단지가 없습니다.`);
      if (!confirm(`${where}에서 세대수 ${min}세대 이상${unk ? '(모르는 단지 포함)' : ''} 단지 ${fresh.length}개를 앞마당에 추가할까요? (평형 ${grs.map(g => g.k).join('·')})` + (cand.length > fresh.length ? `\n(${cand.length - fresh.length}개는 이미 있어서 건너뜁니다)` : ''))) return;
      const now = Date.now();
      fresh.forEach(key => { const p = Data.parseKey(key), all = [...gs.get(key)].sort((a, b) => a - b), hide = all.filter(g => !inSel(g));
        cx[`${code}|${key}`] = { code, key, sido: reg[1], sgg: reg[2], dong: p.dong, jibun: p.jibun, name: p.name, gs: all, ...(hide.length ? { hide } : {}), t: now, memo: '' }; });
      saveCx(); Store.set('apt.lastRegion', { sido: reg[1], code });
      U.toast(`${where} 단지 ${fresh.length}개를 앞마당에 추가했습니다.`);
      show();
    } finally { btn.disabled = false; btn.textContent = '📍 지역 단지 한꺼번에 추가'; }
  }

  /** 단지 통째로 빼기 (조사 기록·1등 기록은 남음 → 다시 추가하면 살아남) */
  function removeCx(cids, ask = true) {
    if (locked() || !cids.length) return;
    const names = cids.map(c => cx[c]?.name).filter(Boolean);
    if (ask && !Vault.sure(`${names.length}개 단지를 앞마당 목록에서 지웁니다: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ' …' : ''}\n(적어 둔 호가 기록은 남아서, 다시 추가하면 그대로 살아납니다)`, names.length >= 5)) return;
    cids.forEach(c => delete cx[c]);
    checked.forEach(id => { if (cids.includes(id.split('#')[0])) checked.delete(id); });
    saveCx(); show(); foundBox();
    U.toast(`${names.length}개 단지를 목록에서 지웠습니다. 다시 추가하면 예전 기록이 살아납니다.`);
  }
  /** [목록에서 지우기] — 이 평형만 / 단지 통째로. id = 평형 줄(단지#평형) 또는 단지(cid) */
  function askRemove(id) {
    if (locked()) return;
    const hasG = id.includes('#'), cid = hasG ? id.split('#')[0] : id, g = hasG ? +id.split('#')[1] : null, c = cx[cid]; if (!c) return;
    const shownGs = (c.gs || []).filter(x => !(c.hide || []).includes(x));
    const box = modal(`<div class="bar"><strong>${esc(c.name)} — 목록에서 지우기</strong><span class="grow"></span><button data-close>✕</button></div>
      ${hasG && shownGs.length > 1 ? `<label class="row" style="gap:8px"><input type="radio" name="ydRm" value="g" checked> ${g}㎡ 평형만 지우기</label>` : ''}
      <label class="row" style="gap:8px"><input type="radio" name="ydRm" value="all" ${hasG && shownGs.length > 1 ? '' : 'checked'}> 단지 통째로 지우기 <small class="hint" style="margin:0">(모든 평형 ${(c.gs || []).join('·')}㎡)</small></label>
      <p class="hint" style="margin:0">앞마당 목록에서만 지워집니다. 적어 둔 호가 기록은 남아서, 다시 추가하면 그대로 살아납니다. 다른 탭에는 영향이 없습니다.</p>
      <div class="bar"><span class="grow"></span><button data-close>취소</button><button class="primary danger-fill" id="ydRmOk">목록에서 지우기</button></div>`);
    box.querySelector('#ydRmOk').onclick = () => {
      const all = box.querySelector('input[name="ydRm"]:checked').value === 'all';
      closeModal();
      if (all) return removeCx([cid], false);
      c.hide = [...new Set([...(c.hide || []), g])]; checked.delete(id); saveCx(); show(); foundBox();
      U.toast(`${c.name} ${g}㎡ 를 목록에서 지웠습니다. 단지를 다시 검색하면 [지운 평형 다시 보이기]가 나옵니다.`);
    };
  }
  const askRemoveCx = (cid) => askRemove(cid);

  /* ═════════ 픽 (후보 표시) — 평형별, 1등과 별개 ═════════ */
  const picked = (id) => { const p = id.split('#'); return !!cx[p[0]]?.pick?.[p[1]]; };
  function setPick(ids, on) {
    if (locked()) return false;
    ids.forEach(id => { const [cid, g] = id.split('#'), c = cx[cid]; if (!c) return; c.pick = c.pick || {}; if (on) c.pick[g] = 1; else delete c.pick[g]; if (!Object.keys(c.pick).length) delete c.pick; });
    saveCx(); return true;
  }

  /* ═════════ 시세트래킹으로 보내기 (버튼을 누를 때만) ═════════ */
  const sent = (id) => { const p = id.split('#'); return cx[p[0]]?.sent?.[p[1]] || null; };
  async function toTracking(ids) {
    ids = [...new Set(ids)];
    const man = ids.filter(id => cx[id.split('#')[0]]?.manual);
    if (man.length) { ids = ids.filter(id => !man.includes(id)); U.toast(`직접 추가한 단지 ${man.length}개는 실거래 자료가 없어 시세트래킹에 담지 않았습니다.`); }
    if (!ids.length) return;
    const rows = ids.map(id => { const p = Kit.parseId(id), c = cx[`${p.code}|${p.key}`] || {}; return { ...p, sido: c.sido, sgg: c.sgg, dong: c.dong ?? p.dong, jibun: c.jibun ?? p.jibun, name: c.name ?? p.name }; });
    await Real.load(rows);
    Tracking.add(rows.map(r => { const rl = Real.get(r.id) || {}; return { ...r, buildYear: rl.buildYear, st: { last: rl.sale } }; }));
    const d = today();
    ids.forEach(id => { const [cid, g] = id.split('#'), c = cx[cid]; if (c) { c.sent = c.sent || {}; c.sent[g] = d; } });   // 앞마당에만 남기는 "보냄" 표시
    saveCx(); show();
  }

  /* ═════════ 호가 입력 → 오늘 조사 회차에 자동 기록 ═════════ */
  function todaySid(create) {
    const d = today(), s = surveysDesc().find(x => x.date === d);
    if (s || !create) return s?.id || '';
    const id = 's' + Date.now().toString(36);
    sv[id] = { date: d, memo: '', auto: true, t: Date.now(), q: {} };
    saveSv();
    return id;
  }

  /* ═════════ ① 1등 뽑기 ═════════ */
  const NEW_DAYS = 7;
  let F = null;
  const T = (label, f) => ColFilter.txtCol(label, f), N = (label, f, k) => ColFilter.numCol(label, f, k);
  const PCOLS = () => ({
    pick: T('픽', r => (picked(r.id) ? '✔ 픽' : '미픽')), first: T('1등', r => (r.isFirst ? '🥇 1등' : '')),
    name: T('단지명', r => r.name), sgg: T('시군구', r => r.sgg), dong: T('동', r => r.dong),
    area: { label: '평형', get: r => `${r.g}㎡ (${CONFIG.toPyeong(r.g)}평)`, num: r => r.g },
    s: N('매매 호가', r => r.s), r: N('전세 호가', r => r.rr), gap: N('투자금', r => r.gap), chg: N('지난 대비', r => r.chg, 'diff'),
    by: N('연식', r => r.by || null, 'n'), hh: N('세대수', r => r.hh || null, 'n'), sale: N('최근 실거래', r => r.rl.sale?.price ?? null),
    drop: N('전고 대비', r => r.drop, 'pct'), rise: N('전저 대비', r => r.rise, 'pct'), memo: T('메모', r => cx[r.cid]?.memo || ''),
    sent: T('트래킹', r => (sent(r.id) ? '트래킹에 보냄' : '')),
  });
  const PF = () => F || (F = ColFilter.create({ key: 'yard', cols: PCOLS, bar: 'ydCfBar', sortSel: 'ydSort', onChange: () => renderPick() }));

  async function renderPick() {
    const my = ++seq, el = $('ydPick'), st = stepMan();
    const inGrp = allRows().filter(r => r.grp === ui.grp);
    if (!el.innerHTML) el.innerHTML = '<p class="hint">불러오는 중…</p>';
    await Real.load(inGrp);
    if (my !== seq) return;
    const now = Date.now(), pk = (picks[ui.ym] || {})[ui.grp] || {};
    let rows = inGrp.map(r => {
      const v = valueAt(r.id, ''), p = prevOf(r.id, v), rl = Real.get(r.id) || {};
      const s = v?.s ?? null, rr = v?.r ?? null;
      const peak = rl.peak?.price ?? null, trough = rl.trough?.price ?? null, base = s ?? rl.sale?.price ?? null;
      const lo = s != null ? bandLo(s, st) : null;
      return { ...r, v, p, rl, s, rr, gap: s != null && rr != null ? s - rr : null, chg: s != null && p?.s != null ? s - p.s : null,
        lo, plo: p?.s != null ? bandLo(p.s, st) : null, isFirst: lo != null && pk[lo]?.id === r.id, fresh: !v && now - (cx[r.cid]?.t || 0) < NEW_DAYS * 864e5,
        drop: base && peak ? (base / peak - 1) * 100 : null, rise: base && trough ? (base / trough - 1) * 100 : null, by: rl.buildYear || cx[r.cid]?.by || null, hh: rl.hh || cx[r.cid]?.hh || null, manual: !!cx[r.cid]?.manual };
    });
    const total = rows.length;
    if (ui.onlyPick) rows = rows.filter(r => picked(r.id));
    const sorter = { s: (a, b) => (a.s ?? 1e12) - (b.s ?? 1e12) || a.name.localeCompare(b.name, 'ko'), by: (a, b) => (b.by || 0) - (a.by || 0), hh: (a, b) => (b.hh || 0) - (a.hh || 0), gap: (a, b) => (a.gap ?? 1e12) - (b.gap ?? 1e12), chg: (a, b) => (b.chg ?? -1e12) - (a.chg ?? -1e12), name: (a, b) => a.name.localeCompare(b.name, 'ko'), pick: (a, b) => picked(b.id) - picked(a.id) || (a.s ?? 1e12) - (b.s ?? 1e12) }[ui.sort] || null;
    const preF = rows, sortFn = (list) => (sorter ? [...list].sort(sorter) : list);
    rows = PF().apply(rows, sortFn);          // 엑셀식 열 필터 + 정렬 (정렬은 가격대 칸 안에서만 의미가 있음)
    const bands = new Map(), none = [], fresh = [];
    rows.forEach(r => { if (r.lo != null) { if (!bands.has(r.lo)) bands.set(r.lo, []); bands.get(r.lo).push(r); } else (r.fresh ? fresh : none).push(r); });
    const los = [...bands.keys()].sort((a, b) => a - b);
    const stepNow = ui.step || opts.step;

    const head = `<div class="filters yd-ctl">
        <div><span class="hint" style="margin:0">평형</span><div class="presets" id="ydGrp">${opts.groups.map(g => `<button data-g="${esc(g.k)}" class="${g.k === ui.grp ? 'on' : ''}" title="전용 ${g.min}~${g.max}㎡">${esc(g.k)}</button>`).join('')}</div></div>
        <div><span class="hint" style="margin:0">가격대 폭</span><div class="presets" id="ydStep">${[0.5, 1, 2].map(v => `<button data-v="${v}" class="${v === stepNow ? 'on' : ''}">${v}억</button>`).join('')}<input id="ydStepIn" class="num" inputmode="decimal" style="width:56px" placeholder="직접" value="${[0.5, 1, 2].includes(stepNow) ? '' : stepNow}"></div></div>
        <label>1등 저장 달 <input type="month" id="ydYm" value="${ymShort(ui.ym)}"></label>
        <label class="row" style="flex-direction:row;align-items:center;padding-bottom:7px;gap:6px"><input type="checkbox" id="ydOnlyPick" ${ui.onlyPick ? 'checked' : ''}> 픽한 단지만 보기</label>
        <label>칸 안 정렬 <select id="ydSort">${[['s', '호가 낮은 순'], ['pick', '픽 먼저'], ['by', '신축순'], ['hh', '세대수 많은 순'], ['gap', '투자금 적은 순'], ['chg', '지난 대비 오른 순'], ['name', '단지명순']].map(([k, t]) => `<option value="${k}" ${ui.sort === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <span class="grow"></span>
        <button id="ydPickAllTrk" title="이 달에 지정한 1등(모든 평형)을 시세트래킹에 담기">🥇 ${ymLabel(ui.ym)} 1등 전체 트래킹 담기</button>
        <button id="ydPickXl">📥 엑셀</button>
      </div>
      <div class="cfbar" id="ydCfBar"></div>`;

    const H = (k, label, cls = '') => `<th class="${cls}">${label}${PF().btn(k)}</th>`;
    const COLS = 17;
    const rowHtml = (r) => {
      const isPk = picked(r.id), c = cx[r.cid] || {}, sd = sent(r.id);
      const moved = r.plo != null && r.lo != null && r.plo !== r.lo ? `<span class="tag yd-move" title="지난 입력(${esc(r.p.date)})에는 ${bandLabel(r.plo, r.plo + st)}">${bandLabel(r.plo, r.plo + st)}→${bandLabel(r.lo, r.lo + st)} ${r.lo > r.plo ? '⤴' : '⤵'}</span>` : '';
      const old = r.v && r.v.date !== today() ? `<small class="yd-when" title="${esc(r.v.date)}에 적은 값">${esc(dShort(r.v.date))}</small>` : '';
      return `<tr data-id="${esc(r.id)}" class="${isPk ? 'yd-pk' : 'yd-grey'}${r.isFirst ? ' yd-picked' : ''}"><td class="c"><input type="checkbox" data-chk ${checked.has(r.id) ? 'checked' : ''}></td>` +
        `<td class="c"><button class="yd-tick ${isPk ? 'on' : ''}" data-pk title="${isPk ? '픽 끄기' : '후보로 픽'}">${isPk ? '✔' : '○'}</button></td>` +
        `<td class="c">${r.lo == null ? '' : `<button class="yd-medal ${r.isFirst ? 'on' : ''}" data-first title="${r.isFirst ? '1등 지정 풀기' : '이 가격대 1등으로 지정'}">${r.isFirst ? '🥇' : '○'}</button>`}</td>` +
        `<td class="l yd-nm"><button class="yd-x" data-rm title="목록에서 지우기">✕</button>${isPk ? '<b class="yd-ck">✔</b>' : ''}<a href="#" data-hist>${esc(r.name)}</a>${r.manual ? ' <span class="tag yd-manual" title="검색에 없어 직접 추가한 단지">직접</span>' : ''} <small>${esc(r.sgg)} ${esc(r.dong)}</small>${moved}</td>` +
        `<td>${r.g}㎡<small>${CONFIG.toPyeong(r.g)}평</small></td>` +
        `<td class="yd-in"><input class="num" inputmode="decimal" data-f="s" value="${eokIn(r.s)}" placeholder="억">${old}</td><td class="yd-in"><input class="num" inputmode="decimal" data-f="r" value="${eokIn(r.rr)}" placeholder="억"></td>` +
        `<td data-gap>${eok(r.gap)}</td>` +
        `<td class="${U.cls(r.chg)}">${r.chg == null ? '-' : (r.chg > 0 ? '▲' : r.chg < 0 ? '▼' : '') + (r.chg ? eok(Math.abs(r.chg)) : '0')}</td>` +
        `<td>${r.by || '-'}${r.by ? `<small>${r.by > THIS_Y ? '입주 예정' : CONFIG.toAge(r.by) + '년차'}</small>` : ''}</td><td>${r.hh ? r.hh.toLocaleString() : '-'}</td>` +
        `<td>${r.rl.sale ? `${eok(r.rl.sale.price)}<small>${U.date(r.rl.sale.d)}</small>` : '-'}</td>` +
        `<td class="${U.cls(r.drop)}">${U.pct(r.drop, 0)}</td><td class="${U.cls(r.rise)}">${U.pct(r.rise, 0)}</td>` +
        `<td class="l"><input class="wide yd-memo" data-memo value="${esc(c.memo || '')}" placeholder="메모"></td>` +
        `<td class="c">${r.manual ? '<span class="yd-sent" title="직접 추가한 단지는 실거래 자료가 없어 시세트래킹에 담지 않습니다">-</span>' : sd ? `<span class="yd-sent" title="${esc(sd)}에 시세트래킹으로 보냄">트래킹에 보냄</span>` : '<button class="mini" data-trk>담기</button>'}</td>` +
        `<td class="c"><button class="mini" data-menu title="가격 이력·네이버·3D·위성지도">⋯</button></td></tr>`;
    };
    const section = (k, title, list, extraCls = '') => {
      const isClosed = closed.has(`${ui.grp}|${k}`);
      return `<tbody data-lo="${k}" class="${isClosed ? 'yd-closed' : ''}"><tr class="yd-band ${extraCls}"><td colspan="${COLS}"><span class="yd-tw">${isClosed ? '▶' : '▼'}</span> ${title}</td></tr>` + list.map(rowHtml).join('') + '</tbody>';
    };
    const bandHtml = (lo) => {
      const list = bands.get(lo), hi = lo + st, p = pk[lo], pn = p ? (cx[p.id.split('#')[0]]?.name || p.name || '') : '';
      return section(lo, `<b>${bandLabel(lo, hi)}</b> <small>(${bandRange(lo, hi)})</small> · ${list.length}개 · 픽 ${list.filter(r => picked(r.id)).length}개` +
        `<span class="yd-pickname">${p ? `🥇 1등: <b>${esc(pn)}</b> ${p.id.split('#')[1]}㎡` : '<span class="hint" style="margin:0">🥇 1등: 아직 안 고름</span>'}</span>`, list);
    };
    const table = rows.length ? `<div class="tablewrap yd-table"><table id="ydTable"><thead><tr><th class="c"><input type="checkbox" id="ydChkAll" title="보이는 단지 모두 체크"></th>` +
      H('pick', '픽', 'c') + H('first', '1등', 'c') + H('name', '단지명', 'l') + H('area', '평형') + H('s', '매매(억)') + H('r', '전세(억)') + H('gap', '투자금') + H('chg', '지난 대비') +
      H('by', '연식') + H('hh', '세대수') + H('sale', '최근 실거래') + H('drop', '전고 대비') + H('rise', '전저 대비') + H('memo', '메모', 'l') + H('sent', '트래킹', 'c') + '<th></th></tr></thead>' +
      (fresh.length ? section('fresh', `<b>🆕 새로 추가한 단지 · 호가 입력 필요</b> (${fresh.length}개)`, fresh.sort((a, b) => a.name.localeCompare(b.name, 'ko')), 'yd-new') : '') +
      los.map(bandHtml).join('') +
      (none.length ? section('none', `<b>미입력</b> · 호가를 아직 안 적은 ${none.length}개`, none.sort((a, b) => a.name.localeCompare(b.name, 'ko')), 'yd-none') : '') +
      '</table></div>'
      : `<p class="empty">${total ? (ui.onlyPick ? '픽한 단지가 없습니다. ○ 를 눌러 후보를 픽하거나 "픽한 단지만 보기"를 끄세요.' : '필터에 맞는 단지가 없습니다. 위의 [모두 풀기]를 눌러 보세요.') : `앞마당 단지 중 ${esc(ui.grp)}㎡ 그룹(전용 ${groupOf0(ui.grp)})에 맞는 평형이 없습니다. 다른 평형 버튼을 눌러 보세요.`}</p>`;
    el.innerHTML = head + table +
      `<div class="bar yd-bulk" id="ydBulk" ${checked.size ? '' : 'hidden'}><b id="ydBulkN">체크한 ${checked.size}개</b><button id="ydBulkPk">✔ 픽 켜기</button><button id="ydBulkUnpk">픽 끄기</button><button id="ydBulkTrk">트래킹 담기</button><button id="ydBulkDel" class="danger">목록에서 지우기</button><button id="ydBulkClr">선택 해제</button></div>` +
      `<p class="hint">매매·전세 칸에 억 단위로 적으면 <b>오늘 날짜로 자동 기록</b>되고, 칸을 벗어나면 가격대 칸으로 옮겨집니다. 옆의 작은 날짜는 그날 적은 값이라는 뜻입니다.<br>픽(○/✔) = 후보 표시, 픽 안 한 줄은 회색입니다. 🥇 1등은 가격대마다 하나이고, 1등을 고르면 픽도 켜집니다. 머리글 ▾ 로 엑셀처럼 거르고 정렬할 수 있습니다.</p>`;
    PF().apply(preF, sortFn);                 // 필터 안내 줄(ydCfBar)을 그린 뒤 한 번 더 채움
    pickEvents(rows);
    status();
    flashGoTo();
  }
  const groupOf0 = (k) => { const g = opts.groups.find(x => x.k === k); return g ? `${g.min}~${g.max}㎡` : ''; };

  let dirty = false;
  function pickEvents(rows) {
    const set = (fn) => { fn(); saveUi(); renderPick(); };
    $('ydGrp').onclick = (e) => { const g = e.target.closest('button')?.dataset.g; if (g) set(() => { ui.grp = g; checked.clear(); }); };
    $('ydStep').onclick = (e) => { const v = e.target.closest('button')?.dataset.v; if (v) set(() => { ui.step = +v; }); };
    $('ydStepIn').onchange = (e) => { const v = Number(e.target.value); if (!(v > 0 && v <= 20)) return U.toast('0.1~20 사이 억 단위로 적어 주세요. (예: 1.5)'); set(() => { ui.step = Math.round(v * 100) / 100; }); };
    $('ydYm').onchange = (e) => { const ym = +String(e.target.value).replace('-', ''); if (ym) set(() => { ui.ym = ym; }); };
    $('ydOnlyPick').onchange = (e) => set(() => { ui.onlyPick = e.target.checked; });
    $('ydSort').onchange = (e) => { if (e.target.value === '__hdr') return; set(() => { ui.sort = e.target.value; }); };
    $('ydPickXl').onclick = () => pickExcel(rows);
    $('ydPickAllTrk').onclick = () => {
      const ids = Object.values(picks[ui.ym] || {}).flatMap(g => Object.values(g).map(p => p.id));
      if (!ids.length) return U.toast(`${ymLabel(ui.ym)}에 지정한 1등이 없습니다.`);
      toTracking(ids);
    };
    const bulk = (fn) => () => { if (!checked.size) return; fn([...checked]); };
    $('ydBulkPk').onclick = bulk(ids => { if (setPick(ids, true)) { checked.clear(); renderPick(); } });
    $('ydBulkUnpk').onclick = bulk(ids => { if (setPick(ids, false)) { checked.clear(); renderPick(); } });
    $('ydBulkTrk').onclick = bulk(ids => { checked.clear(); toTracking(ids); });
    $('ydBulkDel').onclick = bulk(ids => removeCx([...new Set(ids.map(id => id.split('#')[0]))]));
    $('ydBulkClr').onclick = () => { checked.clear(); renderPick(); };
    const tb = $('ydTable');
    if (!tb) return;
    $('ydChkAll').onchange = (e) => { tb.querySelectorAll('tbody:not(.yd-closed) tr[data-id]').forEach(tr => { if (e.target.checked) checked.add(tr.dataset.id); else checked.delete(tr.dataset.id); }); renderPick(); };
    tb.onclick = (e) => {
      if (e.target.closest('button.colf')) return;
      const band = e.target.closest('tr.yd-band');
      if (band) { const k = `${ui.grp}|${band.parentElement.dataset.lo}`; if (closed.has(k)) closed.delete(k); else closed.add(k); band.parentElement.classList.toggle('yd-closed'); band.querySelector('.yd-tw').textContent = band.parentElement.classList.contains('yd-closed') ? '▶' : '▼'; return; }
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      const id = tr.dataset.id, r = rows.find(x => x.id === id); if (!r) return;
      if (e.target.closest('[data-hist]')) { e.preventDefault(); return openHist(id); }
      if (e.target.closest('[data-pk]')) { if (setPick([id], !picked(id))) renderPick(); return; }
      if (e.target.closest('[data-first]')) {
        if (locked()) return;
        const g = ((picks[ui.ym] = picks[ui.ym] || {})[ui.grp] = picks[ui.ym][ui.grp] || {});
        if (g[r.lo]?.id === id) delete g[r.lo]; else { g[r.lo] = { id, hi: r.lo + stepMan(), name: r.name }; if (!picked(id)) setPick([id], true); }
        if (!Object.keys(g).length) delete picks[ui.ym][ui.grp];
        if (!Object.keys(picks[ui.ym]).length) delete picks[ui.ym];
        savePk(); return renderPick();
      }
      if (e.target.closest('[data-trk]')) return toTracking([id]);
      if (e.target.closest('[data-rm]')) return askRemove(id);
      if (e.target.closest('[data-menu]')) return showMenu(e.target.closest('[data-menu]'), id);
    };
    tb.onchange = (e) => {
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      const id = tr.dataset.id;
      if (e.target.dataset.chk != null) { if (e.target.checked) checked.add(id); else checked.delete(id); return bulkBar(); }
      if (e.target.dataset.memo != null) { if (locked()) return; const c = cx[id.split('#')[0]]; if (c) { c.memo = e.target.value.trim(); saveCx(); tb.querySelectorAll(`tr[data-id^="${CSS.escape(id.split('#')[0])}#"] input[data-memo]`).forEach(i => { i.value = c.memo; }); } return; }
      const f = e.target.dataset.f; if (!f) return;
      const r = rows.find(x => x.id === id);
      if (locked()) { e.target.value = eokIn(f === 's' ? r?.s : r?.rr); return; }
      const v = toMan(e.target.value);
      if (Number.isNaN(v)) { U.toast('숫자만 억 단위로 적어 주세요. (예: 6.3)'); e.target.value = eokIn(f === 's' ? r?.s : r?.rr); return; }
      if (v != null && v > 0 && v < 1000) U.toast('억 단위로 적었는지 확인하세요. (예: 6억 3천 → 6.3)');
      const cur = sv[todaySid(true)]; cur.q = cur.q || {};
      const q = cur.q[id] || {};
      if (v == null) delete q[f]; else q[f] = v;
      if (Object.keys(q).length) cur.q[id] = q; else delete cur.q[id];
      saveSv();
      const nv = valueAt(id, ''), gap = nv?.s != null && nv?.r != null ? nv.s - nv.r : null;
      tr.querySelector('[data-gap]').textContent = eok(gap);
      dirty = true;                                   // 칸을 벗어나면 가격대 칸으로 다시 정리
    };
    tb.addEventListener('keydown', (e) => {         // 매매 → (Tab/Enter) 전세 → (Tab/Enter) 다음 줄 매매 로 이어서 입력
      const f = e.target.dataset?.f; if (!f || e.shiftKey || (e.key !== 'Tab' && e.key !== 'Enter')) return;
      const trs = [...tb.querySelectorAll('tbody:not(.yd-closed) tr[data-id]')], i = trs.indexOf(e.target.closest('tr'));
      const next = f === 's' ? trs[i]?.querySelector('input[data-f="r"]') : trs[i + 1]?.querySelector('input[data-f="s"]');
      if (!next) return;
      e.preventDefault(); e.target.dispatchEvent(new Event('change', { bubbles: true })); next.focus(); next.select();
    });
    tb.addEventListener('focusout', (e) => {
      if (!dirty) return;
      const next = e.relatedTarget;
      if (next && tb.contains(next) && next.matches('input[data-f]')) return;   // 매매 → 전세처럼 입력칸끼리 옮길 때는 기다림
      dirty = false; setTimeout(renderPick, 0);
    });
  }
  function bulkBar() { const b = $('ydBulk'); if (!b) return; b.hidden = !checked.size; $('ydBulkN').textContent = `체크한 ${checked.size}개`; }

  function pickExcel(rows) {
    const st = stepMan();
    const sheet1 = [['가격대', '픽', '1등', '시도', '시군구', '동', '단지', '전용㎡', '평형 그룹', '매매 호가(만원)', '호가 적은 날', '전세 호가(만원)', '투자금(만원)', '지난 대비(만원)', '연식', '세대수', '최근 실거래(만원)', '실거래일', '전고 대비(%)', '전저 대비(%)', '트래킹', '메모']];
    [...rows].sort((a, b) => (a.lo ?? 1e12) - (b.lo ?? 1e12) || (a.s ?? 0) - (b.s ?? 0)).forEach(r => sheet1.push([r.lo == null ? '미입력' : bandLabel(r.lo, r.lo + st), picked(r.id) ? '픽' : '', r.isFirst ? '1등' : '', r.sido, r.sgg, r.dong, r.name, r.g, r.grp,
      r.s ?? '', r.v?.date || '', r.rr ?? '', r.gap ?? '', r.chg ?? '', r.by || '', r.hh || '', r.rl.sale?.price ?? '', r.rl.sale ? U.date(r.rl.sale.d) : '', r.drop == null ? '' : +r.drop.toFixed(1), r.rise == null ? '' : +r.rise.toFixed(1), sent(r.id) ? '트래킹에 보냄' : '', cx[r.cid]?.memo || '']));
    const sheet2 = [['달', '평형 그룹', '가격대', '1등 단지', '전용㎡', '지역']];
    Object.entries(picks[ui.ym] || {}).forEach(([gk, g]) => Object.keys(g).map(Number).sort((a, b) => a - b).forEach(lo => { const p = g[lo], c = cx[p.id.split('#')[0]] || {}; sheet2.push([ymLabel(ui.ym), gk, bandLabel(lo, p.hi), c.name || p.name || '', +p.id.split('#')[1], `${c.sgg || ''} ${c.dong || ''}`.trim()]); }));
    U.download(`앞마당_${ui.grp}_1등뽑기_${U.stamp()}`, [{ name: `${ui.grp} 가격대별`, rows: sheet1 }, { name: `${ymLabel(ui.ym)} 1등`, rows: sheet2 }]);
  }

  /* ── ⋯ 메뉴 ── */
  function showMenu(btn, id) {
    const m = $('ydMenu'), r = btn.getBoundingClientRect(), c = cx[id.split('#')[0]] || {};
    m.innerHTML = (c.manual ? '<button data-m="edit">✏ 정보 고치기</button>' : '') + `<button data-m="hist">📈 가격 이력</button><button data-m="naver">네이버 부동산</button>${typeof View3D !== 'undefined' ? '<button data-m="v3d">3D로 보기</button>' : ''}${$('tab-sat') ? '<button data-m="sat">위성지도</button>' : ''}`;
    m.hidden = false;
    m.style.top = (window.scrollY + r.bottom + 4) + 'px'; m.style.left = Math.max(8, window.scrollX + r.right - 170) + 'px';
    m.onclick = (e) => {
      const k = e.target.dataset.m; if (!k) return; hideMenu();
      if (k === 'hist') openHist(id);
      if (k === 'naver') LandLink.open(c.sgg, c.dong, c.name);
      if (k === 'v3d') { App.showTab('v3d'); View3D.show({ code: c.code, key: c.key, sido: c.sido, sgg: c.sgg, dong: c.dong, jibun: c.jibun, name: c.name }); }
      if (k === 'sat') openSat(c);
      if (k === 'edit') openManual(id.split('#')[0]);
    };
  }
  function hideMenu() { const m = $('ydMenu'); if (m) m.hidden = true; }
  async function openSat(c) {
    App.showTab('sat');
    try { await navigator.clipboard.writeText(`${c.sgg} ${c.dong} ${c.name}`); U.toast(`「${c.sgg} ${c.dong} ${c.name}」을(를) 복사했습니다. 위성지도 검색칸에 붙여넣기(Ctrl+V) 하세요.`); }
    catch (e) { U.toast(`위성지도 검색칸에 「${c.name}」을(를) 입력하세요.`); }
  }

  /* ═════════ ② 조사 기록 ═════════ */
  function renderSurvey() {
    const el = $('ydSurvey'), list = surveysDesc();
    if (ui.esid && !sv[ui.esid]) ui.esid = '';
    if (!ui.esid) ui.esid = list[0]?.id || '';
    const cur = sv[ui.esid];
    const chips = list.map(s => `<button data-sid="${s.id}" class="${s.id === ui.esid ? 'on' : ''}" title="${esc(s.date)}${s.memo ? ' · ' + esc(s.memo) : ''}">${esc(dShort(s.date))}${s.memo ? ` <small>${esc(s.memo)}</small>` : s.auto ? ' <small>(1등 뽑기에서 입력)</small>' : ''}</button>`).join('');
    let html = `<div class="bar"><strong>조사 회차</strong><span class="grow"></span><button id="ydSNew" class="primary">+ 새 조사</button><button id="ydSEdit" ${cur ? '' : 'disabled'}>회차 수정</button><button id="ydSDel" class="danger" ${cur ? '' : 'disabled'}>회차 삭제</button><button id="ydSXl" ${list.length ? '' : 'disabled'}>📥 전체 조사 엑셀</button></div>` +
      `<div class="chips yd-chips">${chips || '<span class="hint" style="margin:0">아직 조사 회차가 없습니다. [+ 새 조사]를 눌러 오늘 조사를 시작하세요.</span>'}</div>`;
    if (cur) html += entryHtml(cur) + compareHtml();
    el.innerHTML = html;
    surveyEvents();
    if (cur) { fillEntry(); fillCompare(); }
  }

  function entryRows() {
    return allRows().filter(r => (!ui.egrp || r.grp === ui.egrp) && (!ui.esgg || r.sgg === ui.esgg))
      .sort((a, b) => a.sido.localeCompare(b.sido, 'ko') || a.sgg.localeCompare(b.sgg, 'ko') || a.dong.localeCompare(b.dong, 'ko') || a.name.localeCompare(b.name, 'ko') || a.g - b.g);
  }
  function entryHtml(cur) {
    const all = allRows(), n = all.filter(r => cur.q?.[r.id]?.s != null || cur.q?.[r.id]?.r != null).length;
    const sggs = [...new Set(all.map(r => r.sgg))].sort((a, b) => a.localeCompare(b, 'ko'));
    return `<div class="yd-sec"><div class="bar"><strong>📝 ${esc(cur.date)}${cur.memo ? ' · ' + esc(cur.memo) : ''}</strong><span class="hint" style="margin:0" id="ydECount">입력 ${n} / ${all.length} 평형</span></div>
      <div class="filters">
        <label>평형 <select id="ydEGrp"><option value="">전체</option>${opts.groups.map(g => `<option value="${esc(g.k)}" ${g.k === ui.egrp ? 'selected' : ''}>${esc(g.k)}</option>`).join('')}</select></label>
        <label>시/군/구 <select id="ydESgg"><option value="">전체</option>${sggs.map(s => `<option ${s === ui.esgg ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
        <label class="row" style="flex-direction:row;align-items:center;padding-bottom:7px"><input type="checkbox" id="ydEOnly" ${ui.onlyEmpty ? 'checked' : ''}> 아직 안 적은 평형만</label>
        <span class="grow"></span>
        <button id="ydESame" title="체크한 평형에 바로 앞 조사 값을 그대로 넣습니다 (빈칸만)">지난 조사와 같음 (체크)</button>
      </div>
      <div class="tablewrap yd-table"><table id="ydETable"></table></div>
      <p class="hint">가격은 억 단위(예: 6.3), 매물은 개수입니다. 칸을 고치면 바로 저장됩니다. Tab 키로 다음 칸으로 넘어가며 적을 수 있습니다.</p></div>`;
  }
  function fillEntry() {
    const cur = sv[ui.esid]; if (!cur) return;
    let rows = entryRows();
    const rowState = rows.map(r => ({ r, q: cur.q?.[r.id] || {}, pv: valueAt(r.id, ui.esid, true) }));
    const vis = ui.onlyEmpty ? rowState.filter(x => x.q.s == null && x.q.r == null) : rowState;
    $('ydETable').innerHTML = `<thead><tr><th class="c"><input type="checkbox" id="ydEChkAll"></th><th class="l">단지</th><th>평형</th><th>매매(억)</th><th>전세(억)</th><th>매물</th><th>지난 조사 매매 / 전세</th><th>변동</th></tr></thead><tbody>` +
      (vis.length ? vis.map(({ r, q, pv }) => `<tr data-id="${esc(r.id)}" class="${picked(r.id) ? 'yd-pk' : 'yd-grey'}"><td class="c"><input type="checkbox" data-chk ${echecked.has(r.id) ? 'checked' : ''}></td>` +
        `<td class="l">${picked(r.id) ? '<b class="yd-ck">✔</b>' : ''}<a href="#" data-hist>${esc(r.name)}</a> <small>${esc(r.sgg)} ${esc(r.dong)}</small></td><td>${r.g}㎡<small>${esc(r.grp)}</small></td>` +
        `<td><input class="num" inputmode="decimal" data-f="s" value="${eokIn(q.s)}" placeholder="억"></td><td><input class="num" inputmode="decimal" data-f="r" value="${eokIn(q.r)}" placeholder="억"></td><td><input class="num" inputmode="numeric" data-f="n" value="${q.n ?? ''}" placeholder="개" style="width:50px"></td>` +
        `<td>${pv ? `${eok(pv.s)} / ${eok(pv.r)}<small>${esc(dShort(pv.date))}</small>` : '<small>없음</small>'}</td><td data-chg class="${U.cls(chgOf(q, pv))}">${chgText(q, pv)}</td></tr>`).join('')
        : `<tr><td colspan="8" class="empty" style="padding:20px">${ui.onlyEmpty ? '모든 평형을 적었습니다. 👍' : '보여 줄 평형이 없습니다.'}</td></tr>`) + '</tbody>';
  }
  const chgOf = (q, pv) => (q.s != null && pv?.s != null ? q.s - pv.s : null);
  function chgText(q, pv) {
    const d = chgOf(q, pv); if (d == null) return q.s == null ? '<small>미입력</small>' : '-';
    return d === 0 ? '-' : `${d > 0 ? '▲' : '▼'}${eok(Math.abs(d))} <small>${U.pct(d / pv.s * 100, 1)}</small>`;
  }
  function entryCount() {
    const cur = sv[ui.esid], all = allRows(); if (!cur || !$('ydECount')) return;
    $('ydECount').textContent = `입력 ${all.filter(r => cur.q?.[r.id]?.s != null || cur.q?.[r.id]?.r != null).length} / ${all.length} 평형`;
  }

  function compareHtml() {
    const list = surveysDesc();
    if (list.length < 2) return '<div class="yd-sec"><div class="bar"><strong>📊 두 조사 비교</strong></div><p class="hint">조사 회차가 2개 이상 생기면 여기서 비교할 수 있습니다.</p></div>';
    if (!sv[ui.ca]) ui.ca = list[0].id;
    if (!sv[ui.cb] || ui.cb === ui.ca) ui.cb = list.find(s => s.id !== ui.ca).id;
    const opt = (cur) => list.map(s => `<option value="${s.id}" ${s.id === cur ? 'selected' : ''}>${esc(s.date)}${s.memo ? ' · ' + esc(s.memo) : ''}</option>`).join('');
    return `<div class="yd-sec"><div class="filters"><strong style="align-self:center">📊 두 조사 비교</strong>
      <label>나중 조사 <select id="ydCA">${opt(ui.ca)}</select></label><label>이전 조사 <select id="ydCB">${opt(ui.cb)}</select></label>
      <label>평형 <select id="ydCGrp"><option value="">전체</option>${opts.groups.map(g => `<option value="${esc(g.k)}" ${g.k === ui.egrp ? 'selected' : ''}>${esc(g.k)}</option>`).join('')}</select></label>
      <label>정렬 <select id="ydCSort">${[['up', '오른 순'], ['down', '내린 순'], ['pct', '변동률 큰 순'], ['name', '단지명순']].map(([k, t]) => `<option value="${k}" ${ui.csort === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <span class="grow"></span><button id="ydCXl">📥 비교 엑셀</button></div>
      <div class="tablewrap yd-table short"><table id="ydCTable"></table></div>
      <p class="hint">각 조사 날짜까지 적은 가장 최근 값으로 비교합니다. 작은 날짜는 그 회차에 안 적어서 앞 조사 값을 쓴 것입니다. 가격대는 지금 가격대 폭(${ui.step || opts.step}억) 기준입니다.</p></div>`;
  }
  let cmpRows = [];
  function fillCompare() {
    if (!$('ydCTable')) return;
    const st = stepMan(), A = sv[ui.ca], B = sv[ui.cb];
    const grp = $('ydCGrp').value;
    cmpRows = allRows().filter(r => !grp || r.grp === grp).map(r => {
      const a = valueAt(r.id, ui.ca), b = valueAt(r.id, ui.cb);
      const d = a?.s != null && b?.s != null ? a.s - b.s : null;
      return { r, a, b, d, pct: d != null ? d / b.s * 100 : null, la: a?.s != null ? bandLo(a.s, st) : null, lb: b?.s != null ? bandLo(b.s, st) : null };
    }).filter(x => x.a?.s != null || x.b?.s != null);
    const so = { up: (x, y) => (y.d ?? -1e12) - (x.d ?? -1e12), down: (x, y) => (x.d ?? 1e12) - (y.d ?? 1e12), pct: (x, y) => Math.abs(y.pct ?? 0) - Math.abs(x.pct ?? 0), name: (x, y) => x.r.name.localeCompare(y.r.name, 'ko') }[ui.csort];
    cmpRows.sort(so);
    const cell = (v, s) => (v?.s != null ? `${eok(v.s)}${v.sid !== s ? `<small>${esc(dShort(v.date))}</small>` : ''}` : '-');
    $('ydCTable').innerHTML = `<thead><tr><th class="l">단지</th><th>평형</th><th>${esc(B.date)}</th><th>${esc(A.date)}</th><th>변동</th><th>변동률</th><th class="l">가격대</th></tr></thead><tbody>` +
      (cmpRows.length ? cmpRows.map(x => `<tr data-id="${esc(x.r.id)}"><td class="l"><a href="#" data-hist>${esc(x.r.name)}</a> <small>${esc(x.r.sgg)} ${esc(x.r.dong)}</small></td><td>${x.r.g}㎡</td><td>${cell(x.b, ui.cb)}</td><td>${cell(x.a, ui.ca)}</td>` +
        `<td class="${U.cls(x.d)}">${x.d == null ? '-' : x.d === 0 ? '0' : (x.d > 0 ? '▲' : '▼') + eok(Math.abs(x.d))}</td><td class="${U.cls(x.pct)}">${U.pct(x.pct)}</td>` +
        `<td class="l">${x.la == null || x.lb == null ? '' : x.la === x.lb ? bandLabel(x.la, x.la + st) : `${bandLabel(x.lb, x.lb + st)}→${bandLabel(x.la, x.la + st)} ${x.la > x.lb ? '⤴' : '⤵'}`}</td></tr>`).join('')
        : '<tr><td colspan="7" class="empty" style="padding:20px">두 조사에 적은 값이 없습니다.</td></tr>') + '</tbody>';
  }

  function surveyEvents() {
    const el = $('ydSurvey');
    el.querySelector('.yd-chips').onclick = (e) => { const s = e.target.closest('button[data-sid]')?.dataset.sid; if (s) { ui.esid = s; echecked.clear(); saveUi(); renderSurvey(); } };
    $('ydSNew').onclick = newSurvey;
    $('ydSEdit').onclick = editSurvey;
    $('ydSDel').onclick = () => {
      const cur = sv[ui.esid]; if (!cur || locked()) return;
      const n = Object.keys(cur.q || {}).length;
      if (!Vault.sure(`${cur.date}${cur.memo ? ' · ' + cur.memo : ''} 조사 회차를 삭제합니다.${n ? `\n이 회차에 적은 ${n}개 평형의 호가가 모두 지워집니다.` : ''}`, n > 0)) return;
      delete sv[ui.esid]; ui.esid = ''; saveSv(); saveUi(); show();
    };
    $('ydSXl').onclick = surveyExcel;
    if (!sv[ui.esid]) return;
    $('ydEGrp').onchange = (e) => { ui.egrp = e.target.value; saveUi(); fillEntry(); };
    $('ydESgg').onchange = (e) => { ui.esgg = e.target.value; saveUi(); fillEntry(); };
    $('ydEOnly').onchange = (e) => { ui.onlyEmpty = e.target.checked; saveUi(); fillEntry(); };
    $('ydESame').onclick = () => {
      if (locked()) return;
      if (!echecked.size) return U.toast('먼저 표 왼쪽 칸을 체크하세요. (지난 조사와 값이 같은 평형)');
      const cur = sv[ui.esid]; cur.q = cur.q || {}; let n = 0;
      echecked.forEach(id => { const pv = valueAt(id, ui.esid, true); if (!pv) return; const q = cur.q[id] || {};
        let ch = false; ['s', 'r', 'n'].forEach(f => { if (q[f] == null && pv[f] != null) { q[f] = pv[f]; ch = true; } }); if (ch) { cur.q[id] = q; n++; } });
      saveSv(); echecked.clear(); fillEntry(); entryCount(); fillCompare();
      U.toast(n ? `${n}개 평형에 지난 조사 값을 넣었습니다.` : '넣을 값이 없습니다. (이미 적었거나 지난 조사 값이 없음)');
    };
    const tb = $('ydETable');
    $('ydETable').onclick = (e) => { if (e.target.closest('[data-hist]')) { e.preventDefault(); openHist(e.target.closest('tr').dataset.id); } };
    tb.onchange = (e) => {
      if (e.target.id === 'ydEChkAll') { tb.querySelectorAll('tbody tr[data-id]').forEach(tr => { if (e.target.checked) echecked.add(tr.dataset.id); else echecked.delete(tr.dataset.id); tr.querySelector('[data-chk]').checked = e.target.checked; }); return; }
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      const id = tr.dataset.id;
      if (e.target.dataset.chk != null) { if (e.target.checked) echecked.add(id); else echecked.delete(id); return; }
      const f = e.target.dataset.f; if (!f) return;
      const cur = sv[ui.esid]; if (!cur) return;
      if (locked()) { e.target.value = f === 'n' ? (cur.q?.[id]?.n ?? '') : eokIn(cur.q?.[id]?.[f]); return; }
      let v;
      if (f === 'n') { const t = e.target.value.trim(); v = t === '' ? null : parseInt(t, 10); if (t !== '' && (isNaN(v) || v < 0)) { U.toast('매물 수는 숫자로 적어 주세요.'); e.target.value = ''; return; } }
      else { v = toMan(e.target.value); if (Number.isNaN(v)) { U.toast('숫자만 억 단위로 적어 주세요. (예: 6.3)'); e.target.value = ''; return; } if (v != null && v > 0 && v < 1000) U.toast('억 단위로 적었는지 확인하세요. (예: 6억 3천 → 6.3)'); }
      cur.q = cur.q || {};
      const q = cur.q[id] || {};
      if (v == null) delete q[f]; else q[f] = v;
      if (Object.keys(q).length) cur.q[id] = q; else delete cur.q[id];
      saveSv();
      const pv = valueAt(id, ui.esid, true), c = tr.querySelector('[data-chg]');
      c.className = U.cls(chgOf(q, pv)); c.innerHTML = chgText(q, pv);
      entryCount();
      fillCompare();          // 아래 두 조사 비교표도 바로 맞춤
    };
    if ($('ydCTable')) {
      $('ydCA').onchange = (e) => { ui.ca = e.target.value; saveUi(); fillCompare(); };
      $('ydCB').onchange = (e) => { ui.cb = e.target.value; saveUi(); fillCompare(); };
      $('ydCGrp').onchange = fillCompare;
      $('ydCSort').onchange = (e) => { ui.csort = e.target.value; saveUi(); fillCompare(); };
      $('ydCXl').onclick = compareExcel;
      $('ydCTable').onclick = (e) => { if (e.target.closest('[data-hist]')) { e.preventDefault(); openHist(e.target.closest('tr').dataset.id); } };
    }
  }

  function modal(html, wide) {
    const box = $('ydModalBox'); box.className = 'modalbox' + (wide ? '' : ' yd-small'); box.onclick = null; box.oninput = null; box.innerHTML = html;
    $('ydModal').hidden = false;
    $('ydModal').onclick = (e) => { if (e.target.id === 'ydModal' || e.target.closest('[data-close]')) closeModal(); };
    return box;
  }
  function closeModal() { $('ydModal').hidden = true; if (hist?.chart) { hist.chart.destroy(); } hist = null; }

  function newSurvey() {
    if (locked()) return;
    const box = modal(`<div class="bar"><strong>새 조사 만들기</strong><span class="grow"></span><button data-close>✕</button></div>
      <label class="yd-field">조사 날짜 <input type="date" id="ydNDate" value="${today()}"></label>
      <label class="yd-field">메모 <input id="ydNMemo" placeholder="예: 평촌 2차 임장, 네이버 매물 확인"></label>
      <label class="row" style="gap:6px"><input type="checkbox" id="ydNPre"> 바로 앞 조사 값을 미리 채워 두기 <small class="hint" style="margin:0">(바뀐 단지만 고치면 됨)</small></label>
      <div class="bar"><span class="grow"></span><button data-close>취소</button><button class="primary" id="ydNOk">만들기</button></div>`);
    box.querySelector('#ydNOk').onclick = () => {
      const date = $('ydNDate').value; if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return U.toast('조사 날짜를 고르세요.');
      const id = 's' + Date.now().toString(36), q = {};
      if ($('ydNPre').checked) allRows().forEach(r => { const pv = valueAt(r.id, null); if (pv && pv.date <= date) q[r.id] = { ...(pv.s != null ? { s: pv.s } : {}), ...(pv.r != null ? { r: pv.r } : {}), ...(pv.n != null ? { n: pv.n } : {}) }; });
      sv[id] = { date, memo: $('ydNMemo').value.trim(), t: Date.now(), q };
      saveSv(); ui.esid = id; ui.sub = 'survey'; saveUi(); closeModal(); show();
      U.toast(`${date} 조사를 만들었습니다. 표에 호가를 적으세요.`);
    };
  }
  function editSurvey() {
    const cur = sv[ui.esid]; if (!cur || locked()) return;
    const box = modal(`<div class="bar"><strong>조사 회차 수정</strong><span class="grow"></span><button data-close>✕</button></div>
      <label class="yd-field">조사 날짜 <input type="date" id="ydNDate" value="${esc(cur.date)}"></label>
      <label class="yd-field">메모 <input id="ydNMemo" value="${esc(cur.memo || '')}"></label>
      <div class="bar"><span class="grow"></span><button data-close>취소</button><button class="primary" id="ydNOk">저장</button></div>`);
    box.querySelector('#ydNOk').onclick = () => {
      const date = $('ydNDate').value; if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return U.toast('조사 날짜를 고르세요.');
      cur.date = date; cur.memo = $('ydNMemo').value.trim(); saveSv(); closeModal(); show();
    };
  }

  function surveyExcel() {
    const list = surveysAsc(), rows = allRows().sort((a, b) => a.sgg.localeCompare(b.sgg, 'ko') || a.name.localeCompare(b.name, 'ko') || a.g - b.g);
    const head = ['시도', '시군구', '동', '단지', '전용㎡', '평형 그룹', ...list.flatMap(s => [`${s.date} 매매(만원)`, `${s.date} 전세(만원)`, `${s.date} 매물`])];
    const body = rows.filter(r => list.some(s => s.q?.[r.id])).map(r => [r.sido, r.sgg, r.dong, r.name, r.g, r.grp, ...list.flatMap(s => { const q = s.q?.[r.id] || {}; return [q.s ?? '', q.r ?? '', q.n ?? '']; })]);
    U.download(`앞마당_조사기록_${U.stamp()}`, [{ name: '조사 기록', rows: [head, ...body] },
      { name: '조사 회차', rows: [['조사 날짜', '메모', '적은 평형 수'], ...list.map(s => [s.date, s.memo || '', Object.keys(s.q || {}).length])] }]);
  }
  function compareExcel() {
    const st = stepMan(), A = sv[ui.ca], B = sv[ui.cb]; if (!A || !B) return;
    U.download(`앞마당_조사비교_${B.date}_${A.date}`, [{ name: '두 조사 비교', rows: [['시군구', '동', '단지', '전용㎡', `${B.date} 매매(만원)`, '값 적은 날', `${A.date} 매매(만원)`, '값 적은 날', '변동(만원)', '변동률(%)', `${B.date} 가격대`, `${A.date} 가격대`],
      ...cmpRows.map(x => [x.r.sgg, x.r.dong, x.r.name, x.r.g, x.b?.s ?? '', x.b?.date || '', x.a?.s ?? '', x.a?.date || '', x.d ?? '', x.pct == null ? '' : +x.pct.toFixed(1), x.lb == null ? '' : bandLabel(x.lb, x.lb + st), x.la == null ? '' : bandLabel(x.la, x.la + st)])] }]);
  }

  /* ═════════ ③ 1등 기록 ═════════ */
  function renderRecord() {
    const el = $('ydRecord');
    const months = Object.keys(picks).map(Number).filter(ym => picks[ym]?.[ui.rgrp]).sort((a, b) => a - b);
    const allMonths = Object.keys(picks).map(Number).sort((a, b) => a - b);
    let from = +ui.rfrom || 0, to = +ui.rto || 0;
    if (!allMonths.includes(from)) from = allMonths[Math.max(0, allMonths.length - 6)] || 0;
    if (!allMonths.includes(to)) to = allMonths[allMonths.length - 1] || 0;
    const ms = allMonths.filter(m => m >= from && m <= to);
    const bands = new Map();
    ms.forEach(m => Object.entries(picks[m]?.[ui.rgrp] || {}).forEach(([lo, p]) => { if (!bands.has(+lo)) bands.set(+lo, p.hi); }));
    const los = [...bands.keys()].sort((a, b) => a - b);
    const nameOf = (p) => cx[p.id.split('#')[0]]?.name || p.name || '';
    el.innerHTML = `<div class="filters yd-ctl">
        <div><span class="hint" style="margin:0">평형</span><div class="presets" id="ydRGrp">${opts.groups.map(g => `<button data-g="${esc(g.k)}" class="${g.k === ui.rgrp ? 'on' : ''}">${esc(g.k)}</button>`).join('')}</div></div>
        <label>기간 <span class="row"><select id="ydRFrom">${allMonths.map(m => `<option value="${m}" ${m === from ? 'selected' : ''}>${ymShort(m)}</option>`).join('')}</select> ~ <select id="ydRTo">${allMonths.map(m => `<option value="${m}" ${m === to ? 'selected' : ''}>${ymShort(m)}</option>`).join('')}</select></span></label>
        <span class="grow"></span><button id="ydRXl" ${allMonths.length ? '' : 'disabled'}>📥 1등 기록 엑셀</button></div>` +
      (!allMonths.length ? '<p class="empty">아직 지정한 1등이 없습니다. <b>① 1등 뽑기</b>에서 가격대마다 ○ 를 눌러 1등을 고르세요.</p>'
        : !los.length ? `<p class="empty">이 기간에 ${esc(ui.rgrp)}㎡ 그룹의 1등 기록이 없습니다.</p>`
          : `<div class="tablewrap yd-table"><table id="ydRTable"><thead><tr><th class="l">가격대</th>${ms.map(m => `<th class="c">${ymShort(m)}</th>`).join('')}</tr></thead><tbody>` +
            los.map(lo => `<tr><td class="l"><b>${bandLabel(lo, bands.get(lo))}</b></td>` + ms.map((m, i) => {
              const p = picks[m]?.[ui.rgrp]?.[lo], prevM = ms[i - 1], pp = prevM ? picks[prevM]?.[ui.rgrp]?.[lo] : null;
              const changed = p && i > 0 && (!pp || pp.id !== p.id);
              return `<td class="c ${p ? 'yd-rc' : ''}" ${p ? `data-id="${esc(p.id)}"` : ''}>${p ? `<a href="#">${esc(nameOf(p))}</a><small>${p.id.split('#')[1]}㎡</small>${changed ? ' <span class="yd-chg" title="지난달과 1등이 바뀜">●</span>' : ''}` : '<span class="hint" style="margin:0">-</span>'}</td>`;
            }).join('') + '</tr>').join('') + '</tbody></table></div><p class="hint">● = 지난달과 1등이 바뀐 칸 · 단지명을 누르면 가격 이력이 열립니다. 가격대는 1등을 지정할 때의 폭으로 기록됩니다.</p>');
    $('ydRGrp').onclick = (e) => { const g = e.target.closest('button')?.dataset.g; if (g) { ui.rgrp = g; saveUi(); renderRecord(); } };
    if ($('ydRFrom')) { $('ydRFrom').onchange = (e) => { ui.rfrom = +e.target.value; saveUi(); renderRecord(); }; $('ydRTo').onchange = (e) => { ui.rto = +e.target.value; saveUi(); renderRecord(); }; }
    $('ydRXl').onclick = () => {
      const rows = [['달', '평형 그룹', '가격대', '1등 단지', '전용㎡', '시군구', '동', '지난달과 바뀜']];
      allMonths.forEach((m, i) => Object.entries(picks[m] || {}).forEach(([gk, g]) => Object.keys(g).map(Number).sort((a, b) => a - b).forEach(lo => {
        const p = g[lo], c = cx[p.id.split('#')[0]] || {}, pp = i > 0 ? picks[allMonths[i - 1]]?.[gk]?.[lo] : null;
        rows.push([ymShort(m), gk, bandLabel(lo, p.hi), c.name || p.name || '', +p.id.split('#')[1], c.sgg || '', c.dong || '', i > 0 && (!pp || pp.id !== p.id) ? '바뀜' : '']);
      })));
      U.download(`앞마당_1등기록_${U.stamp()}`, [{ name: '달별 1등', rows }]);
    };
    const t = $('ydRTable'); if (t) t.onclick = (e) => { const td = e.target.closest('td[data-id]'); if (td) { e.preventDefault(); openHist(td.dataset.id); } };
  }

  /* ═════════ 단지 가격 이력 창 ═════════ */
  async function openHist(rowId) {
    const p = Kit.parseId(rowId), cid = `${p.code}|${p.key}`, c = cx[cid] || { code: p.code, key: p.key, name: p.name, dong: p.dong, jibun: p.jibun, sgg: '', sido: '', gs: [p.g] };
    const gs = [...new Set([...(c.gs || []), p.g])].sort((a, b) => a - b);
    let g = p.g;
    const box = modal(`<div class="bar"><strong id="ydHTitle">${esc(c.name)}</strong><span class="hint" style="margin:0" id="ydHInfo">${esc(c.sgg)} ${esc(c.dong)}</span><span class="grow"></span><button data-close>✕ 닫기</button></div>
      <div class="bar"><span class="hint" style="margin:0">평형</span><div class="presets" id="ydHG">${gs.map(x => `<button data-g="${x}">${x}㎡${groupOf(x) ? '' : ' <small>(그룹 밖)</small>'}</button>`).join('')}</div>
        <span class="grow"></span><span id="ydHTrk"></span><button id="ydHNaver">네이버 부동산</button>${typeof View3D !== 'undefined' ? '<button id="ydH3d">3D</button>' : ''}${$('tab-sat') ? '<button id="ydHSat">위성지도</button>' : ''}</div>
      <div class="yd-chart"><canvas id="ydHChart"></canvas></div>
      <div class="tablewrap short"><table id="ydHTable"></table></div>
      <p class="hint">선 = 내가 조사한 호가(매매·전세), 점 = 실거래(매매, 직거래 제외). 가격대는 지금 가격대 폭(${ui.step || opts.step}억) 기준입니다.</p>`, true);
    hist = { cid, chart: null };
    $('ydHNaver').onclick = () => LandLink.open(c.sgg, c.dong, c.name);
    if ($('ydH3d')) $('ydH3d').onclick = () => { closeModal(); App.showTab('v3d'); View3D.show({ code: c.code, key: c.key, sido: c.sido, sgg: c.sgg, dong: c.dong, jibun: c.jibun, name: c.name }); };
    if ($('ydHSat')) $('ydHSat').onclick = () => { closeModal(); openSat(c); };
    $('ydHG').onclick = (e) => { const x = e.target.closest('button')?.dataset.g; if (x) { g = +x; draw(); } };
    async function draw() {
      const id = `${cid}#${g}`, my = hist;
      box.querySelectorAll('#ydHG button').forEach(b => b.classList.toggle('on', +b.dataset.g === g));
      $('ydHTrk').innerHTML = (cx[cid] ? `<button id="ydHPk" class="${picked(id) ? 'on' : ''}">${picked(id) ? '✔ 픽 켜짐' : '○ 픽 하기'}</button> ` : '') + (c.manual ? '' : sent(id) ? `<span class="yd-sent">트래킹에 보냄 (${esc(sent(id))})</span>` : '<button id="ydHTrkB">트래킹 담기</button>');
      if ($('ydHTrkB')) $('ydHTrkB').onclick = async () => { await toTracking([id]); draw(); };
      if ($('ydHPk')) $('ydHPk').onclick = () => { if (setPick([id], !picked(id))) { draw(); if (ui.sub === 'pick') renderPick(); } };
      await Real.load([{ id, code: c.code, key: c.key }]);
      const rl = Real.get(id) || {};
      const by = rl.buildYear || c.by, hh = rl.hh || c.hh;
      $('ydHInfo').textContent = `${c.sgg || ''} ${c.dong || ''}${by ? ` · ${by}년` : ''}${hh ? ` · ${(+hh).toLocaleString()}세대` : ''}${c.manual ? ' · 직접 추가' : ''}`;
      const entries = surveysAsc().filter(s => s.q?.[id] && (s.q[id].s != null || s.q[id].r != null)).map(s => ({ ...s.q[id], date: s.date, memo: s.memo || '' }));
      const st = stepMan(), gk = groupOf(g)?.k;
      $('ydHTable').innerHTML = `<thead><tr><th>조사 날짜</th><th>매매(억)</th><th>전세(억)</th><th>투자금</th><th>매물</th><th>가격대</th><th class="c">그달 1등</th><th class="l">조사 메모</th></tr></thead><tbody>` +
        (entries.length ? [...entries].reverse().map(x => { const won = gk && Object.values(picks[ymOf(x.date)]?.[gk] || {}).some(pk => pk.id === id);
          return `<tr><td>${esc(x.date)}</td><td class="sale">${eok(x.s)}</td><td>${eok(x.r)}</td><td>${x.s != null && x.r != null ? eok(x.s - x.r) : '-'}</td><td>${x.n ?? '-'}</td><td>${x.s != null ? bandLabel(bandLo(x.s, st), bandLo(x.s, st) + st) : '-'}</td><td class="c">${won ? '🥇' : ''}</td><td class="l">${esc(x.memo)}</td></tr>`; }).join('')
          : '<tr><td colspan="8" class="empty" style="padding:18px">이 평형은 아직 조사 기록이 없습니다. ② 조사 기록에서 호가를 적으면 여기에 쌓입니다.</td></tr>') + '</tbody>';
      // 그래프: 조사 호가(선) + 실거래(점). 실거래는 첫 조사 1년 전부터 (조사 기록이 없으면 최근 3년)
      const toT = (date) => new Date(date + 'T00:00:00').getTime(), dT = (d) => new Date(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100).getTime();
      const firstY = entries.length ? +entries[0].date.slice(0, 4) - 1 : THIS_Y - 3;
      const tr = await Data.complexTrades(c.code, c.key, g, firstY, THIS_Y);
      if (hist !== my) return;
      const since = entries.length ? toT(entries[0].date) - 365 * 864e5 : toT(`${THIS_Y - 3}-01-01`);
      const css = getComputedStyle(document.documentElement), col = (v, d) => (css.getPropertyValue(v).trim() || d);
      const cs = col('--accent', '#4f9cff'), cr = col('--rent', '#f5a742'), ct = col('--sub', '#9aa0a9');
      const data = {
        datasets: [
          { label: '매매 호가', data: entries.filter(x => x.s != null).map(x => ({ x: toT(x.date), y: x.s / 10000 })), borderColor: cs, backgroundColor: cs, showLine: true, borderWidth: 2.5, pointRadius: 4, tension: 0 },
          { label: '전세 호가', data: entries.filter(x => x.r != null).map(x => ({ x: toT(x.date), y: x.r / 10000 })), borderColor: cr, backgroundColor: cr, showLine: true, borderWidth: 2, borderDash: [5, 4], pointRadius: 3, tension: 0 },
          { label: '실거래(매매)', data: tr.sale.filter(t => !t.direct && dT(t.d) >= since).map(t => ({ x: dT(t.d), y: t.price / 10000 })), borderColor: 'transparent', backgroundColor: ct, pointStyle: 'rectRot', pointRadius: 4, showLine: false },
        ] };
      if (hist.chart) hist.chart.destroy();
      if (typeof Chart === 'undefined') return;
      hist.chart = new Chart($('ydHChart'), { type: 'scatter', data, options: { responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { labels: { color: col('--text', '#eee') } }, tooltip: { callbacks: { label: (it) => `${it.dataset.label}: ${(+it.parsed.y).toFixed(2)}억 (${new Date(it.parsed.x).toISOString().slice(0, 10)})` } } },
        scales: { x: { type: 'linear', ticks: { color: ct, maxTicksLimit: 8, callback: (v) => { const d = new Date(v); return `${String(d.getFullYear()).slice(2)}.${String(d.getMonth() + 1).padStart(2, '0')}`; } }, grid: { color: 'rgba(128,128,128,.15)' } },
          y: { ticks: { color: ct, callback: (v) => v + '억' }, grid: { color: 'rgba(128,128,128,.15)' } } } } });
    }
    draw();
  }

  /* ═════════ 평형·가격대 설정 ═════════ */
  function openOpts() {
    let groups = opts.groups.map(g => ({ ...g }));
    const box = modal('<div id="ydOBody"></div>');
    const draw = () => {
      box.querySelector('#ydOBody').innerHTML = `<div class="bar"><strong>⚙ 평형·가격대 설정</strong><span class="grow"></span><button data-close>✕</button></div>
        <p class="hint" style="margin-top:0">평형 그룹 = 전용면적 범위로 묶습니다. 범위가 겹치면 앞쪽 그룹이 먼저입니다.</p>
        <table class="yd-otable"><thead><tr><th class="l">그룹 이름</th><th>전용㎡ 부터</th><th>까지</th><th></th></tr></thead><tbody>${groups.map((g, i) => `<tr data-i="${i}"><td class="l"><input data-f="k" value="${esc(g.k)}" style="width:70px"></td><td><input class="num" data-f="min" value="${g.min}" style="width:60px"></td><td><input class="num" data-f="max" value="${g.max}" style="width:60px"></td><td><button class="mini danger" data-del>삭제</button></td></tr>`).join('')}</tbody></table>
        <div class="bar" style="margin-top:8px"><button id="ydOAdd">+ 평형 그룹 추가</button></div>
        <label class="yd-field">가격대 폭 기본값 <span class="row"><input id="ydOStep" class="num" inputmode="decimal" value="${opts.step}" style="width:70px"> 억</span></label>
        <div class="bar"><button id="ydOReset">기본값으로</button><span class="grow"></span><button data-close>취소</button><button class="primary" id="ydOSave">저장</button></div>`;
    };
    draw();
    box.oninput = (e) => { const tr = e.target.closest('tr[data-i]'); if (!tr) return; const g = groups[+tr.dataset.i], f = e.target.dataset.f; g[f] = f === 'k' ? e.target.value.trim() : Number(e.target.value); };
    box.onclick = (e) => {
      if (e.target.dataset.del != null) { if (groups.length <= 1) return U.toast('평형 그룹은 하나 이상 있어야 합니다.'); groups.splice(+e.target.closest('tr').dataset.i, 1); draw(); }
      if (e.target.id === 'ydOAdd') { const last = groups[groups.length - 1]; groups.push({ k: String((last?.max || 89) + 12), min: (last?.max || 89) + 1, max: (last?.max || 89) + 20 }); draw(); }
      if (e.target.id === 'ydOReset') { groups = DEF_GROUPS.map(g => ({ ...g })); draw(); box.querySelector('#ydOStep').value = 1; }
      if (e.target.id === 'ydOSave') {
        if (locked()) return;
        const names = new Set();
        for (const g of groups) {
          if (!g.k) return U.toast('그룹 이름을 적어 주세요.');
          if (names.has(g.k)) return U.toast(`그룹 이름 "${g.k}"이(가) 겹칩니다.`); names.add(g.k);
          if (!(g.min > 0) || !(g.max >= g.min)) return U.toast(`"${g.k}" 그룹의 면적 범위를 확인하세요. (부터 ≤ 까지)`);
        }
        const step = Number(box.querySelector('#ydOStep').value);
        if (!(step > 0 && step <= 20)) return U.toast('가격대 폭은 0.1~20 억 사이로 적어 주세요.');
        opts = { groups: groups.map(g => ({ k: g.k, min: +g.min, max: +g.max })), step: Math.round(step * 100) / 100 };
        saveOpts(); ui.step = null;
        if (!opts.groups.some(g => g.k === ui.grp)) ui.grp = opts.groups[opts.groups.length - 1].k;
        if (!opts.groups.some(g => g.k === ui.rgrp)) ui.rgrp = ui.grp;
        if (ui.egrp && !opts.groups.some(g => g.k === ui.egrp)) ui.egrp = '';
        saveUi(); closeModal(); drawRGrp(); show(); foundBox(); U.toast('평형·가격대 설정을 저장했습니다.');
      }
    };
  }

  /* ═════════ 검색에 없는 단지 직접 추가 / 정보 고치기 ═════════ */
  async function openManual(editCid, preName) {
    if (locked()) return;
    if (!regions) regions = await Data.regions();
    const c = editCid ? cx[editCid] : null;
    let gs = c ? [...(c.gs || [])].filter(g => !(c.hide || []).includes(g)) : [];
    const sidos = [...new Set(regions.map(r => r[1]))];
    const sido0 = c?.sido || $('ydRSido').value || sidos[0];
    const box = modal(`<div class="bar"><strong>${c ? '✏ 직접 추가한 단지 정보 고치기' : '✏ 검색에 없는 단지 직접 추가'}</strong><span class="grow"></span><button data-close>✕</button></div>
      <p class="hint" style="margin:0">신축·분양권·소규모처럼 검색에 없는 단지를 적어 넣습니다. 실거래 자료가 없어서 최근 실거래·전고점·전저점은 "-"로 나오고, 시세트래킹에는 담지 않습니다.</p>
      <label class="yd-field">단지명 (필수) <input id="ydMName" value="${esc(c?.name || preName || '')}" placeholder="예: 평촌 OO 센트럴"></label>
      <div class="row" style="gap:8px;flex-wrap:wrap"><label class="yd-field">시/도 <select id="ydMSido" ${c ? 'disabled' : ''}>${sidos.map(s => `<option ${s === sido0 ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
        <label class="yd-field">시/군/구 <select id="ydMSgg" ${c ? 'disabled' : ''}></select></label>
        <label class="yd-field">동 <input id="ydMDong" value="${esc(c?.dong || '')}" placeholder="예: 평촌동" style="width:110px" ${c ? 'disabled' : ''}></label></div>
      <div class="yd-field">평형 (하나 이상)
        <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:4px">${opts.groups.map(g => `<button type="button" class="mini" data-mq="${esc(g.k)}">+${esc(g.k)}</button>`).join('')}
          <input id="ydMG" class="num" inputmode="decimal" placeholder="직접 ㎡" style="width:80px"><button type="button" class="mini" id="ydMGAdd">추가</button></div>
        <div class="row yd-mgs" id="ydMGs" style="gap:6px;flex-wrap:wrap;margin-top:6px"></div></div>
      <div class="row" style="gap:8px;flex-wrap:wrap"><label class="yd-field">세대수 (선택) <input id="ydMHh" class="num" inputmode="numeric" value="${c?.hh || ''}" style="width:90px"></label>
        <label class="yd-field">입주(예정) 연도 (선택) <input id="ydMBy" class="num" inputmode="numeric" value="${c?.by || ''}" placeholder="예: 2027" style="width:90px"></label></div>
      <div class="bar"><span class="grow"></span><button data-close>취소</button><button class="primary" id="ydMOk">${c ? '저장' : '추가'}</button></div>`);
    const fillSgg = () => {
      const list = regions.filter(r => r[1] === $('ydMSido').value), want = c ? c.code : $('ydRSgg').value;
      $('ydMSgg').innerHTML = list.map(r => `<option value="${r[0]}" ${r[0] === want ? 'selected' : ''}>${esc(r[2])}</option>`).join('');
    };
    fillSgg(); $('ydMSido').onchange = fillSgg;
    const drawGs = () => { $('ydMGs').innerHTML = gs.length ? gs.sort((a, b) => a - b).map(g => `<span class="tag yd-mg">${g}㎡ <button type="button" data-mx="${g}" title="빼기">✕</button></span>`).join('') : '<span class="hint" style="margin:0">아직 고른 평형이 없습니다</span>'; };
    drawGs();
    const addG = (g) => { g = Math.round(+g); if (!(g >= 10 && g <= 400)) return U.toast('전용면적을 10~400㎡ 사이로 적어 주세요. (예: 84)'); if (!gs.includes(g)) gs.push(g); drawGs(); };
    box.onclick = (e) => {
      const q = e.target.dataset.mq; if (q) return addG(+q);
      const x = e.target.dataset.mx; if (x) { gs = gs.filter(g => g !== +x); return drawGs(); }
      if (e.target.id === 'ydMGAdd') { addG($('ydMG').value); $('ydMG').value = ''; }
    };
    $('ydMG').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addG(e.target.value); e.target.value = ''; } };
    $('ydMOk').onclick = () => {
      const name = $('ydMName').value.trim(), hh = parseInt($('ydMHh').value, 10) || null, by = parseInt($('ydMBy').value, 10) || null;
      if (!name) return U.toast('단지명을 적어 주세요.');
      if (/[|#]/.test(name)) return U.toast('단지명에는 | 나 # 를 쓸 수 없습니다.');
      if (!gs.length) return U.toast('평형을 하나 이상 넣어 주세요. (+59 · +74 · +84 버튼 또는 직접 ㎡)');
      if (by && (by < 1960 || by > THIS_Y + 10)) return U.toast('입주 연도를 확인해 주세요. (예: 2027)');
      if (c) {
        c.name = name; c.hh = hh; c.by = by; c.gs = [...gs].sort((a, b) => a - b); delete c.hide;
        saveCx(); closeModal(); show(); return U.toast(`${name} 정보를 고쳤습니다.`);
      }
      const code = $('ydMSgg').value, reg = regions.find(r => r[0] === code), dong = $('ydMDong').value.trim().replace(/[|#]/g, '');
      if (!reg) return U.toast('시/군/구를 고르세요.');
      const key = `${dong}|직접|${name}`, cid = `${code}|${key}`;
      if (cx[cid]) return U.toast('같은 이름의 직접 추가 단지가 이미 있습니다.');
      cx[cid] = { code, key, sido: reg[1], sgg: reg[2], dong, jibun: '', name, gs: [...gs].sort((a, b) => a - b), manual: true, hh, by, t: Date.now(), memo: '' };
      saveCx(); closeModal();
      const inGrp = gs.filter(g => groupOf(g));
      if (inGrp.length && !inGrp.some(g => groupOf(g).k === ui.grp)) { ui.grp = groupOf(inGrp[inGrp.length - 1]).k; saveUi(); }
      ui.sub = 'pick'; saveUi(); show();
      U.toast(`${name} 을(를) 직접 추가했습니다. 표의 "🆕 새로 추가한 단지"에서 호가를 적으세요.`);
    };
  }

  /* ═════════ 저장 · 앞마당 파일 ═════════ */
  const FKEY = 'apt.yardFile.v1', REMIND_DAYS = 14;
  function saveAll() {
    const ok = [Store.set(KEY, cx), Store.set(SKEY, sv), Store.set(PKEY, picks), Store.set(OKEY, opts), Store.set(UKEY, ui)].every(v => v !== false);
    mark(ok);
    U.toast(ok ? '앞마당을 저장했습니다. (입력할 때마다 자동으로도 저장됩니다)' : '브라우저 저장에 실패했습니다. [📤 앞마당 파일 저장]으로 파일을 받아 두세요.');
  }
  function remind() {
    const el = $('ydRemind'); if (!el) return;
    const last = Store.get(FKEY, 0), n = Object.keys(cx).length;
    const days = last ? Math.floor((Date.now() - last) / 864e5) : null;
    el.hidden = !n || (days != null && days < REMIND_DAYS);
    el.textContent = days == null ? '💡 파일 저장 권장' : `💡 파일 저장 ${days}일 전`;
    el.title = days == null ? '앞마당 파일을 아직 저장한 적이 없습니다. 브라우저 기록을 지우면 사라질 수 있으니 [📤 앞마당 파일 저장]으로 받아 두세요.' : `앞마당 파일을 저장한 지 ${days}일 지났습니다. [📤 앞마당 파일 저장]을 권장합니다.`;
  }
  function exportFile() {
    const data = { type: 'apt-yard', v: 1, savedAt: new Date().toISOString(), cx, sv, picks, opts };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `앞마당_${U.stamp()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    Store.set(FKEY, Date.now()); remind();
    U.toast(`앞마당 파일을 저장했습니다. (단지 ${Object.keys(cx).length}개 · 조사 ${Object.keys(sv).length}회)`);
  }
  async function importFile(file) {
    let d;
    try { d = JSON.parse(await file.text()); } catch (e) { return U.toast('파일을 읽지 못했습니다. 앞마당 파일(.json)이 맞는지 확인하세요.'); }
    if (!d || d.type !== 'apt-yard' || typeof d.cx !== 'object') return U.toast('앞마당 파일이 아닙니다. [📤 앞마당 파일 저장]으로 만든 파일을 골라 주세요.');
    const info = `단지 ${Object.keys(d.cx || {}).length}개 · 조사 ${Object.keys(d.sv || {}).length}회 · ${String(d.savedAt || '').slice(0, 10)} 저장`;
    const merge = Object.keys(cx).length ? confirm(`앞마당 파일을 불러옵니다 (${info}).\n\n[확인] 합치기 — 지금 기록과 파일 기록을 모두 살립니다. 같은 칸이 겹치면 파일 값을 씁니다.\n[취소] 바꾸기 — 지금 앞마당을 지우고 파일 내용으로 바꿉니다.`) : false;
    if (!merge && Object.keys(cx).length && !confirm('지금 앞마당 기록을 지우고 파일 내용으로 바꿀까요? 되돌릴 수 없습니다.')) return;
    if (merge) {
      for (const [k, v] of Object.entries(d.cx || {})) { const o = cx[k] || {}; cx[k] = { ...o, ...v, pick: { ...(o.pick || {}), ...(v.pick || {}) }, sent: { ...(o.sent || {}), ...(v.sent || {}) } };
        if (!Object.keys(cx[k].pick).length) delete cx[k].pick; if (!Object.keys(cx[k].sent).length) delete cx[k].sent; }
      for (const [k, v] of Object.entries(d.sv || {})) { const o = sv[k]; sv[k] = o ? { ...o, ...v, q: { ...(o.q || {}), ...(v.q || {}) } } : v; }
      for (const [ym, g] of Object.entries(d.picks || {})) { picks[ym] = picks[ym] || {}; for (const [gk, bands] of Object.entries(g)) picks[ym][gk] = { ...(picks[ym][gk] || {}), ...bands }; }
    } else {
      cx = d.cx || {}; sv = d.sv || {}; picks = d.picks || {};
      if (d.opts && Array.isArray(d.opts.groups) && d.opts.groups.length) opts = d.opts;
    }
    saveAll(); loadState(); checked.clear(); show(); foundBox();
    U.toast(`앞마당 파일을 ${merge ? '합쳤습니다' : '불러왔습니다'}. (${info})`);
  }

  function drawRGrp() {
    const el = $('ydRGrp'); if (!el) return;
    const keep = new Set([...el.querySelectorAll('input:checked')].map(i => i.value));
    el.innerHTML = opts.groups.map(g => `<label class="row" style="gap:3px"><input type="checkbox" value="${esc(g.k)}" ${keep.has(g.k) ? 'checked' : ''}>${esc(g.k)}</label>`).join('');
  }

  /* ═════════ 시작 ═════════ */
  function init() {
    if (inited) return; inited = true;
    loadState();
    frame();
    Finder.attach($('ydFind'), (x) => { foundBox(x); });
    markDrop();
    $('ydSave').onclick = saveAll;
    $('ydExport').onclick = exportFile;
    $('ydImport').onclick = () => { if (!locked()) $('ydImportFile').click(); };
    $('ydImportFile').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); };
    $('ydRSido').onchange = () => fillRegion(1);
    $('ydRSgg').onchange = () => fillRegion(2);
    $('ydRAdd').onclick = addRegion;
    $('ydManual').onclick = () => openManual(null, $('ydFind').value.trim());
    drawRGrp();
    $('ydOpts').onclick = openOpts;
    $('ydSubs').onclick = (e) => { const s = e.target.closest('button')?.dataset.s; if (s) { ui.sub = s; saveUi(); show(); } };
    document.addEventListener('click', (e) => { if (!e.target.closest('#ydMenu') && !e.target.closest('[data-menu]')) hideMenu(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('ydModal').hidden) closeModal(); });
    fillRegion(0).catch(console.error);
    show(); remind();
  }
  function open() { if (!inited) init(); else { loadState(); show(); remind(); } }
  /** 백업·코드 가져오기 뒤에 다시 읽기 (vault.js) */
  function reload() { if (inited) { loadState(); if (!root.hidden) show(); } }

  new MutationObserver(() => { if (!root.hidden) open(); else { hideMenu(); } }).observe(root, { attributes: true, attributeFilter: ['hidden'] });
  if (!root.hidden) open();

  return { open, reload, has: (cid) => !!Store.get(KEY, {})[cid] };
})();
