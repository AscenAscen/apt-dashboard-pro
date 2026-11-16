/* ─────────────────────────────────────────────────────────
   tracking.js — [시세트래킹] 탭  (+ 전수조사 탭과 함께 쓰는 기록 저장소)
   · 매매·전세·매물 수는 직접 확인한 가격을 적습니다 (억 단위, 예: 14.3).
   · [시세 추가] → 새 달의 칸 묶음이 맨 앞에 생기고 예전 기록은 오른쪽으로 밀려 쌓입니다.
   · 전고점·전저점은 실거래로 자동 기입, 눌러서 수정 가능.
   · 폴더(한 단지를 여러 폴더에 담을 수 있음), 상태·메모, 입력 진행 상황, 새 실거래 알림, 카드 입력 화면.
   ───────────────────────────────────────────────────────── */
const Tracking = (() => {
  const $ = (id) => document.getElementById(id);
  const KEY = 'apt.tracking.v1', FKEY = 'apt.folders.v1', MKEY = 'apt.trkMonths.v1', SKEY = 'apt.survey.v1', BASE = '기본', PINKEY = 'apt.trkPins.v1';   // 상태 값(it.status)은 지우지 않고 화면에서만 숨김
  // 엑셀의 열 이름 (순서를 바꾸려면 여기서)
  const FIXED = ['가격대', '시', '구', '동', '생활권', '단지명', '연식', '연차', '세대수', '평형', '구조', '방', '화', '링크', '전고점', '전고 대비 하락률', '전저점', '전저 대비 상승률'];
  const GROUP = ['매매', '매매 개수', '전월 대비', '전세', '전세 개수', '전월 대비', '매-전(투자금)', '전월 대비', '전세가율', '전월 대비'];
  const STATUSES = ['', '관심', '임장 예정', '임장 완료', '매수 후보', '제외'];
  // 트래킹에 담거나 뺄 때 함께 옮겨 다니는 값
  const CARRY = ['households', 'structure', 'rooms', 'baths', 'link', 'zone', 'pyeong', 'peakO', 'troughO', 'quotes', 'qt', 'status', 'memo', 'cand', 'seenSale', 'seenRent'];

  let items = Store.get(KEY, []);
  let folders = Store.get(FKEY, [BASE]);
  let months = Store.get(MKEY, null);          // 기록한 달 목록, 최신이 앞 [202611, 202610, …]
  let survey = Store.get(SKEY, {});            // 전수조사에서 적었지만 아직 담지 않은 단지의 기록 { id: {…} }
  const real = new Map();                       // id → { sale, rent, peak, trough } (실거래)
  const CKEY = 'apt.trkChecked.v1';
  const checked = new Set(Store.get(CKEY, []));   // 체크한 단지 (새로고침해도 유지)
  let curFolder = Store.get('apt.curFolder', '');
  let ui = Store.get('apt.trkUi', { info: false, card: null });

  function normalize() {
    for (const it of items) {
      it.quotes = it.quotes || {}; it.qt = it.qt || {};
      if (!Array.isArray(it.folders) || !it.folders.length) it.folders = [it.folder || BASE];
      it.folder = it.folders[0];
      for (const f of it.folders) if (!folders.includes(f)) folders.push(f);
    }
    if (!folders.includes(BASE)) folders.unshift(BASE);
    if (!Array.isArray(months)) months = [...new Set(items.flatMap(it => Object.keys(it.quotes).map(Number)))];
    months = [...new Set(months)].sort((a, b) => b - a);
    if (curFolder && !folders.includes(curFolder)) curFolder = '';
  }
  normalize();

  const save = () => { Store.set(KEY, items); Store.set(FKEY, folders); Store.set(MKEY, months); Store.set(SKEY, survey); const b = $('trackCount'); if (b) b.textContent = items.length; if (typeof QLog !== 'undefined') QLog.check(); };
  const all = () => items;
  const pyeong = (it) => it.pyeong || CONFIG.toPyeong(it.g) + '평';
  const link = (it) => it.link || U.landLink(it.sgg, it.dong, it.name);
  const ymLabel = (ym) => `${Math.floor(ym / 100)}년 ${ym % 100}월`;
  const thisMonth = () => { const t = new Date(); return t.getFullYear() * 100 + t.getMonth() + 1; };
  const today = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  const eok = (v) => (v == null ? '' : String(+(v / 10000).toFixed(4)));           // 만원 → 억 글자
  const toMan = (text) => { const n = parseFloat(String(text).replace(/,/g, '')); return isNaN(n) ? null : Math.round(n * 10000); };

  /** [실거래 조회]·[전수조사] 등에서 넘어온 단지를 지금 보고 있는 폴더에 추가 */
  function add(rows, toFolder, silent) {
    const folder = toFolder || curFolder || BASE;
    if (toFolder && !folders.includes(toFolder)) folders.push(toFolder);
    let n = 0;
    for (const r of rows) {
      const old = items.find(it => it.id === r.id);
      if (old) { if (!old.folders.includes(folder) && (curFolder || toFolder)) { old.folders.push(folder); n++; } continue; }
      const it = { id: r.id, code: r.code, sido: r.sido, sgg: r.sgg, dong: r.dong, jibun: r.jibun, key: r.key, name: r.name,
        g: r.g, buildYear: r.buildYear, households: '', structure: '', rooms: '', baths: '', link: '', zone: '', pyeong: '',
        folders: [folder], folder, quotes: {}, qt: {}, status: '', memo: '', lastSale: r.st?.last?.price ?? null };
      const sv = survey[r.id];
      if (sv) { CARRY.forEach(f => { if (sv[f] != null && sv[f] !== '') it[f] = sv[f]; }); delete survey[r.id]; }   // 전수조사에서 적은 값 이어받기
      items.push(it); n++;
    }
    if (n && !months.length) months = [thisMonth()];          // 처음 담을 때 이번 달 칸을 바로 만듦
    save(); fillSelects();
    if (!silent) U.toast(n ? `${n}개 단지를 [${folder}] 폴더에 담았습니다.` : '이미 담겨 있는 단지입니다.');
    if (n) fillHH(items.filter(it => rows.some(r => r.id === it.id)), true);
    return n;
  }
  /* ── 폴더 관리 (도구 서랍의 폴더 표 · 위 버튼 공용) ── */
  function renameFolder(cur) {
    if (!cur) return U.toast('이름을 바꿀 폴더를 먼저 고르세요.');
    if (cur === BASE) return U.toast('[기본] 폴더는 이름을 바꿀 수 없습니다.');
    const name = (prompt('폴더 이름', cur) || '').trim();
    if (!name || name === cur) return;
    if (folders.includes(name)) return U.toast('같은 이름의 폴더가 있습니다.');
    folders[folders.indexOf(cur)] = name;
    items.forEach(it => { it.folders = it.folders.map(f => (f === cur ? name : f)); it.folder = it.folders[0]; });
    const pins = Store.get(PINKEY, []); if (pins.includes(cur)) Store.set(PINKEY, pins.map(f => (f === cur ? name : f)));
    if (curFolder === cur) { curFolder = name; Store.set('apt.curFolder', name); }
    save(); fillSelects(); render();
  }
  function deleteFolder(cur) {
    if (!cur) return U.toast('삭제할 폴더를 먼저 고르세요.');
    if (cur === BASE) return U.toast('[기본] 폴더는 삭제할 수 없습니다.');
    const inside = items.filter(it => it.folders.includes(cur)), only = inside.filter(it => it.folders.length === 1).length;
    if (!Vault.sure(`[${cur}] 폴더를 삭제합니다.` + (inside.length ? `\n안에 있는 ${inside.length}개 단지는 지워지지 않습니다.` + (only ? ` (다른 폴더에 없는 ${only}개는 [기본] 폴더로 옮겨집니다)` : '') : ''), inside.length >= 3)) return;
    items.forEach(it => { it.folders = it.folders.filter(f => f !== cur); if (!it.folders.length) it.folders = [BASE]; it.folder = it.folders[0]; });
    folders = folders.filter(f => f !== cur);
    Store.set(PINKEY, Store.get(PINKEY, []).filter(f => f !== cur));
    if (curFolder === cur) { curFolder = ''; Store.set('apt.curFolder', ''); }
    save(); fillSelects(); render();
  }
  function moveFolder(f, d) {
    const i = folders.indexOf(f), j = i + d; if (i < 0 || j < 0 || j >= folders.length) return;
    [folders[i], folders[j]] = [folders[j], folders[i]]; save(); fillSelects();
  }
  function pinFolder(f) { const p = Store.get(PINKEY, []); Store.set(PINKEY, p.includes(f) ? p.filter(x => x !== f) : [...p, f]); fillSelects(); }
  function pickFolder(f) { curFolder = f; Store.set('apt.curFolder', f); checked.clear(); fillSelects(); render(); }

  /** 한 단지의 빈 칸(세대수·구조·방·화)을 자동 값으로 채움 → 채운 칸 수. 자동으로 채운 칸은 it.af 에 표시 */
  function autoFill(it, kp) {
    const k = kp && kp.m ? kp.m[it.key] : null;
    const a = Kit.autoInfo({ hh: k ? k[0] : null, corr: k ? k[3] : null, g: it.g, buildYear: it.buildYear });
    let n = 0;
    for (const f of ['households', 'structure', 'rooms', 'baths']) {
      if (!String(it[f] || '').trim() && a[f]) { it[f] = a[f]; it.af = { ...(it.af || {}), [f]: 1 }; if (f === 'households') it.hhAuto = 1; n++; }
    }
    return n;
  }
  /** 세대수 자동 채우기: K-apt 자료(data/kapt)로 비어 있는 칸만. 직접 적은 값은 건드리지 않음 → 채운 개수 */
  async function fillHH(list, quiet) {
    let n = 0;
    for (const code of new Set((list || items).map(it => it.code))) {
      const kp = await Data.kapt(code);
      (list || items).filter(it => it.code === code).forEach(it => { n += autoFill(it, kp); });
    }
    if (n) { save(); render(); }
    if (!quiet) U.toast(n ? `세대수·구조·방·화 ${n}칸을 자동으로 채웠습니다. (연한 글씨 = 자동, 방·화는 평형으로 추정한 값 · 고치면 직접 적은 값이 됩니다)` : '새로 채울 칸이 없습니다. (자료에 없는 단지는 직접 적어 주세요)');
    return n;
  }

  /** 다른 화면(단지 요약)에서 한 칸 고치기: 메모·생활권·세대수 등 */
  function setField(id, f, v) { const it = items.find(x => x.id === id); if (!it) return false; it[f] = v; if (f === 'households') delete it.hhAuto; save(); render(); return true; }

  /** 다른 탭(시세지도)에서 호가 적기: patch = { s, r } (만원, null 이면 지움) */
  function setQuote(id, ym, patch) {
    const it = items.find(x => x.id === id); if (!it) return false;
    if (!months.includes(ym)) { months.push(ym); months.sort((a, b) => b - a); }
    const q = it.quotes[ym] = { ...(it.quotes[ym] || {}) };
    for (const f of ['s', 'r']) if (f in patch) { if (patch[f] == null) delete q[f]; else q[f] = patch[f]; }
    it.qt = it.qt || {}; it.qt[ym] = Date.now();
    save(); return true;
  }
  /** 폴더에서 빼기. 그 폴더에만 있던 단지면 시세트래킹에서 지움 → 'deleted' */
  function removeFrom(id, folder) {
    const it = items.find(x => x.id === id); if (!it) return null;
    it.folders = it.folders.filter(f => f !== folder);
    if (!it.folders.length) { items = items.filter(x => x !== it); checked.delete(id); save(); fillSelects(); return 'deleted'; }
    save(); fillSelects(); return 'removed';
  }
  /** 시세트래킹 표에서 이 단지를 찾아 보여 줌 (필터를 풀고 그 줄로 이동·깜빡임) */
  function focus(id) {
    const it = items.find(x => x.id === id); if (!it) return;
    if (curFolder && !it.folders.includes(curFolder)) { curFolder = ''; Store.set('apt.curFolder', ''); }
    ['trkRegion', 'trkBand', 'trkShow'].forEach(k => { $(k).value = ''; });
    fillSelects(); render();
    const i = visible().indexOf(it), tr = document.querySelector(`#trkTable tr[data-i="${i}"]`) || document.querySelector(`#trkCards [data-i="${i}"]`);
    if (tr) { tr.scrollIntoView({ behavior: 'smooth', block: 'center' }); tr.classList.add('flash'); setTimeout(() => tr.classList.remove('flash'), 2500); }
  }

  function init() {
    // 전국 단지 검색 → 평형 고르기 → 지금 보는 폴더에 추가
    let found = null;
    let foundAr = null;                            // 고른 단지의 평형 자료 (실거래가 있는 평형)
    /** 고른 평형 값. 직접 입력이면 실거래 평형과 1.5㎡ 이내로 맞추고, 없으면 입력값 그대로 */
    const curArea = () => {
      const v = $('trkFindArea').value;
      if (v !== '__custom') return +v || null;
      const typed = parseFloat($('trkFindCustom').value);
      if (!(typed > 0)) return null;
      const near = (foundAr?.list || []).reduce((best, a) => (Math.abs(a.g - typed) <= 1.5 && (!best || Math.abs(a.g - typed) < Math.abs(best.g - typed)) ? a : best), null);
      return near ? near.g : typed;
    };
    const syncCustom = () => { $('trkFindCustom').hidden = $('trkFindArea').value !== '__custom'; };
    $('trkFindArea').onchange = syncCustom;
    let staged = [];                              // 여러 개 골라 담을 대기 목록 [{id, name, g, rec}]
    const renderStaged = () => {
      $('trkStaged').innerHTML = staged.map((s, i) => `<span class="tag">${U.esc(s.name)} ${s.g}㎡ <button class="mini" data-unstage="${i}" title="대기 목록에서 빼기">✕</button></span>`).join('') || '<span class="hint" style="margin:0">아직 없음</span>';
      $('btnTrkStageAll').disabled = !staged.length;
      $('btnTrkStageAll').textContent = `대기 ${staged.length}개 한꺼번에 추가`;
    };
    $('btnTrkStage').onclick = async () => {
      const g = curArea();
      if (!found || !g) return U.toast('단지 이름을 검색해 고른 뒤 평형을 선택하세요.');
      const id = `${found.code}|${found.key}#${g}`;
      if (staged.some(s => s.id === id)) return U.toast('이미 대기 목록에 있습니다.');
      const idx = await Data.index(found.code), last = found.areas?.lastSale(g);
      staged.push({ id, name: found.name, g, rec: { id, code: found.code, sido: found.sido, sgg: found.sgg, dong: found.dong, jibun: found.jibun, key: found.key, name: found.name, g,
        buildYear: idx.c[found.key] || '', st: { last } } });
      renderStaged();
    };
    $('btnTrkStageAll').onclick = () => {
      if (!staged.length) return;
      add(staged.map(s => s.rec)); staged = []; renderStaged(); render();
    };
    $('trkStaged').onclick = (e) => { const b = e.target.closest('button[data-unstage]'); if (!b) return; staged.splice(+b.dataset.unstage, 1); renderStaged(); };
    renderStaged();
    // 체크 일괄 선택 / 해제
    if ($('btnTrkSelAll')) $('btnTrkSelAll').onclick = () => { visible().forEach(it => checked.add(it.id)); autoReal(); render(); };
    $('btnTrkSelNone').onclick = () => { checked.clear(); render(); };
    Finder.attach($('trkFind'), async (x) => {
      found = x; foundAr = null; $('trkFindArea').innerHTML = '<option>불러오는 중…</option>';
      const a = await Finder.areas(x.code, x.key);
      if (found !== x) return;
      found.areas = a;
      foundAr = a;
      $('trkFindArea').innerHTML = (a.html || '') + '<option value="__custom">직접 입력 (㎡)</option>';
      $('trkFindArea').value = a.best != null ? a.best : '__custom';   // 실거래 평형이 없으면 직접 입력으로
      syncCustom();
    });
    // 실거래 조회 패널: 체크한 단지(없으면 지금 보이는 단지)를 아래에서 기간 골라 보기
    $('btnTrkTrades').onclick = () => {
      const sel = visible().filter(it => checked.has(it.id));
      const list = sel.length ? sel : visible();
      if (!list.length) return U.toast('보이는 단지가 없습니다.');
      TradePanel.get('tpTrack', { collapsible: true }).open(list, '시세트래킹 실거래');
      $('btnTrkGoTrades').hidden = false;
    };
    $('btnTrkGoTrades').onclick = () => $('tpTrack').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('btnTrkFindTrades').onclick = () => {            // 담지 않고 바로 실거래 보기
      const g = curArea();
      if (!found || !g) return U.toast('단지 이름을 검색해 고른 뒤 평형을 선택하세요.');
      TradePanel.get('tpTrack', { collapsible: true }).open([{ id: `${found.code}|${found.key}#${g}`, code: found.code, sido: found.sido, sgg: found.sgg, dong: found.dong, jibun: found.jibun, key: found.key, name: found.name, g }], `${found.name} 실거래`);
      $('btnTrkGoTrades').hidden = false;
    };
    $('btnTrkFindAdd').onclick = async () => {
      const g = curArea();
      if (!found || !g) return U.toast('단지 이름을 검색해 고른 뒤 평형을 선택하세요.');
      const idx = await Data.index(found.code), last = found.areas?.lastSale(g);
      add([{ id: `${found.code}|${found.key}#${g}`, code: found.code, sido: found.sido, sgg: found.sgg, dong: found.dong, jibun: found.jibun, key: found.key, name: found.name, g,
        buildYear: idx.c[found.key] || '', st: { last } }]);
      render();
    };

    const now = new Date();
    $('trkNewMonth').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    $('btnTrkAddMonth').onclick = () => {
      const ym = +($('trkNewMonth').value || '').replace('-', '');
      if (!ym) return U.toast('추가할 달을 고르세요.');
      if (!addMonth(ym)) return U.toast(`${ymLabel(ym)} 칸은 이미 있습니다.`);
      render(); U.toast(`${ymLabel(ym)} 시세 칸을 추가했습니다. 매매·전세 가격을 적어 주세요.`);
    };
    ['trkRegion', 'trkBand', 'trkShow', 'trkSort'].forEach(id => { $(id).onchange = () => { checked.clear(); render(); }; });
    $('trkFolders').onchange = (e) => { if (e.target.matches('select.fmore') && e.target.value) pickFolder(e.target.value); };
    $('trkFolders').onclick = (e) => {
      const pin = e.target.closest('[data-pin]');
      if (pin) { e.stopPropagation(); const f = pin.dataset.pin, p = Store.get(PINKEY, []); Store.set(PINKEY, p.includes(f) ? p.filter(x => x !== f) : [...p, f]); fillSelects(); return; }
      const b = e.target.closest('button[data-folder]'); if (!b) return; curFolder = b.dataset.folder; Store.set('apt.curFolder', curFolder); checked.clear(); fillSelects(); render(); };
    $('btnTrkLoad').onclick = () => load(true);
    $('btnTrkExcel').onclick = excel;
    $('btnTrkTradesDl').onclick = downloadTrades;
    $('btnTrkInfo').onclick = () => { ui.info = !ui.info; Store.set('apt.trkUi', ui); render(); };
    $('btnTrkCard').onclick = () => { ui.card = !cardMode(); Store.set('apt.trkUi', ui); render(); };
    $('btnTrkSame').onclick = sameAsLast;
    $('realClose').onclick = () => { $('realModal').hidden = true; };
    $('realModal').onclick = (e) => { if (e.target.id === 'realModal') $('realModal').hidden = true; };
    $('btnFolderNew').onclick = () => {
      const name = (prompt('새 폴더 이름 (예: 평촌 앞마당)') || '').trim();
      if (!name) return;
      if (!folders.includes(name)) folders.push(name);
      curFolder = name; Store.set('apt.curFolder', name); save(); fillSelects(); render();
    };
    $('btnFolderRename').onclick = () => renameFolder(curFolder);
    $('btnFolderDelete').onclick = () => deleteFolder(curFolder);
    const move = (mode) => {
      const to = $('trkMoveTo').value;
      if (!checked.size) return U.toast('먼저 표에서 단지를 체크하세요.');
      items.forEach(it => {
        if (!checked.has(it.id)) return;
        if (mode === 'add') { if (!it.folders.includes(to)) it.folders.push(to); }
        else if (mode === 'move') it.folders = [to];
        else { it.folders = it.folders.filter(f => f !== curFolder); if (!it.folders.length) it.folders = [BASE]; }
        it.folder = it.folders[0];
      });
      const n = checked.size; checked.clear(); save(); fillSelects(); render();
      U.toast(mode === 'add' ? `${n}개 단지를 [${to}] 폴더에도 담았습니다.` : mode === 'move' ? `${n}개 단지를 [${to}] 폴더로 옮겼습니다.` : `${n}개 단지를 이 폴더에서 뺐습니다.`);
    };
    $('btnTrkAddTo').onclick = () => move('add');
    $('btnTrkMove').onclick = () => move('move');
    $('btnTrkOut').onclick = () => { if (!curFolder) return U.toast('폴더를 고른 상태에서만 뺄 수 있습니다.'); move('out'); };
    $('btnTrkDelete').onclick = () => {
      if (!checked.size) return U.toast('삭제할 단지를 체크하세요.');
      if (!Vault.sure(`선택한 ${checked.size}개 단지를 시세트래킹에서 삭제합니다.\n(적어 둔 가격 기록은 전수조사 탭에 그대로 남습니다)`, checked.size >= 3)) return;
      items.filter(it => checked.has(it.id)).forEach(it => { const keep = {}; CARRY.forEach(f => { if (it[f] != null && it[f] !== '') keep[f] = it[f]; }); survey[it.id] = keep; });
      items = items.filter(it => !checked.has(it.id)); checked.clear(); save(); fillSelects(); render();
    };
    for (const id of [...checked]) if (!items.some(it => it.id === id)) checked.delete(id);   // 삭제된 단지의 체크는 정리
    if (window.innerWidth < 760) $('trkManage').open = false;
    autoReal();                                   // 새로고침 후 체크돼 있던 단지의 실거래를 다시 읽어 전고점·전저점 채움
    save(); fillSelects();
  }

  function fillSelects() {
    const chg = (list) => { const v = list.map(it => compute(it).groups[0]?.sd).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const chip = (name, label, list) => { const c = chg(list); return `<button data-folder="${U.esc(name)}" class="${name === curFolder ? 'on' : ''}">${U.esc(label)} <b>${list.length}</b>${!c ? '' : ` <small class="${U.cls(c)}">${c > 0 ? '+' : ''}${(c / 10000).toFixed(2)}억</small>`}</button>`; };
    const pins = Store.get(PINKEY, []), counts = new Map(folders.map(f => [f, items.filter(it => it.folders.includes(f))]));
    const pinBtn = (f) => `<span class="pin${pins.includes(f) ? ' on' : ''}" data-pin="${U.esc(f)}" title="${pins.includes(f) ? '고정 풀기' : '앞에 고정'}">📌</span>`;
    const chipF = (f) => chip(f, f, counts.get(f)).replace('</button>', pinBtn(f) + '</button>');
    const box = $('trkFolders');
    const draw = (list) => {
      const rest = folders.filter(f => !list.includes(f));
      box.innerHTML = chip('', '전체', items) + list.map(chipF).join('') +
        (rest.length ? `<select class="fmore" title="칩에 안 보이는 폴더"><option value="">폴더 더보기 (${rest.length}) ▾</option>${rest.map(f => `<option value="${U.esc(f)}">${U.esc(f)} (${counts.get(f).length})</option>`).join('')}</select>` : '');
    };
    // 1) 고정 → 단지 있는 폴더 → 지금 폴더 순으로 칩. 2) 한 줄을 넘으면 고정·지금 폴더만 칩으로 남기고 나머지는 목록으로
    const order = [...folders].sort((a, b) => (pins.includes(b) - pins.includes(a)));
    draw(order.filter(f => pins.includes(f) || f === curFolder || counts.get(f).length));
    const first = box.querySelector('button');
    if (first && box.scrollHeight > first.offsetHeight * 1.7) draw(order.filter(f => pins.includes(f) || f === curFolder));
    $('trkMoveTo').innerHTML = folders.map(x => `<option>${U.esc(x)}</option>`).join('');
    const cur = $('trkRegion').value, inF = items.filter(it => !curFolder || it.folders.includes(curFolder));
    const names = [...new Set(inF.map(it => `${it.sido} ${it.sgg}`))].sort((a, b) => a.localeCompare(b, 'ko'));
    const zc = (z) => inF.filter(it => CONFIG.zoneOf(it.sido) === z).length;
    $('trkRegion').innerHTML = '<option value="">전체</option><optgroup label="권역">' + CONFIG.ZONES.map(z => `<option value="z:${z}">${z} (${zc(z)})</option>`).join('') + '</optgroup>' +
      (names.length ? '<optgroup label="시·구">' + names.map(n => `<option>${U.esc(n)}</option>`).join('') + '</optgroup>' : '');
    $('trkRegion').value = cur && (cur.startsWith('z:') || names.includes(cur)) ? cur : '';
    const curB = $('trkBand').value, bands = new Map();
    inF.forEach(it => { const b = compute(it).band; if (b) bands.set(b, (bands.get(b) || 0) + 1); });
    const bl = [...bands.keys()].sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0));
    $('trkBand').innerHTML = '<option value="">전체</option>' + bl.map(b => `<option value="${b}">${b} (${bands.get(b)})</option>`).join('');
    $('trkBand').value = bands.has(curB) ? curB : '';
  }

  const inScope = () => {
    const reg = $('trkRegion').value, band = $('trkBand').value;
    return items.filter(it => (!curFolder || it.folders.includes(curFolder)) &&
      (!reg || (reg.startsWith('z:') ? CONFIG.zoneOf(it.sido) === reg.slice(2) : `${it.sido} ${it.sgg}` === reg)) && (!band || compute(it).band === band));
  };
  const isNew = (it) => { const rl = real.get(it.id); return !!rl && ((rl.sale && it.seenSale && rl.sale.d > it.seenSale) || (rl.rent && it.seenRent && rl.rent.d > it.seenRent)); };

  /** 화면에 보일 단지: 폴더·지역·상태·보기 조건 → 정렬 */
  function visible() {
    const show = $('trkShow').value, sort = $('trkSort').value, m0 = months[0];
    let list = inScope();
    const c = new Map(list.map(it => [it.id, compute(it)]));
    if (show === 'empty') list = list.filter(it => m0 && it.quotes[m0]?.s == null);
    if (show === 'down') list = list.filter(it => c.get(it.id).groups[0]?.sd < 0);
    if (show === 'rentup') list = list.filter(it => c.get(it.id).groups[0]?.rd > 0);
    if (show === 'new') list = list.filter(isNew);
    if (show === 'gap') list = list.filter(it => { const x = gapPct(c.get(it.id)); return x != null && Math.abs(x) >= GAPLIM; });
    const num = (v, none) => (v == null || isNaN(v) ? none : v);
    const key = { price: (it) => -num(c.get(it.id).base, -1), up: (it) => -num(c.get(it.id).groups[0]?.sd, -1e12), down: (it) => num(c.get(it.id).groups[0]?.sd, 1e12),
      diff: (it) => -num(c.get(it.id).askGap, -1e12), gappct: (it) => -num(Math.abs(gapPct(c.get(it.id)) ?? NaN), -1), name: () => 0 }[sort];
    if (key) list = [...list].sort((a, b) => key(a) - key(b) || a.name.localeCompare(b.name, 'ko') || a.g - b.g);
    return list;
  }

  /** 실거래 읽기 — 최근 매매·전세 실거래, 전고점·전저점. popup=true 면 결과 창을 띄움 */
  async function load(popup, only) {
    const scope = inScope(), picked = popup ? scope.filter(it => checked.has(it.id)) : [];
    const list = only || (picked.length ? picked : scope);            // 체크한 단지가 있으면 그 단지만 (없으면 지금 범위 전체)
    if (!list.length) { if (popup) U.toast('불러올 단지가 없습니다.'); return; }
    if (popup && picked.length) U.toast(`체크한 ${picked.length}개 단지만 불러옵니다.`);
    const btn = $('btnTrkLoad');
    btn.disabled = true; btn.textContent = '불러오는 중…';
    try {
      const nowY = new Date().getFullYear();
      for (const code of new Set(list.map(it => it.code))) {
        if (popup) Data.refresh(code);                       // 버튼을 누를 때마다 최신 파일을 다시 받음
        const [data, kp] = await Promise.all([Data.loadYears(code, Math.floor(CONFIG.PEAK_FROM / 10000), nowY), Data.kapt(code)]);
        const mine = list.filter(it => it.code === code);
        mine.forEach(it => autoFill(it, kp));   // 세대수·구조·방·화 자동 채움 (비어 있을 때만)
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
        for (const it of mine) {
          const b = bucket.get(it.id); real.set(it.id, b);
          if (b.sale && !it.lastSale) it.lastSale = b.sale.price;
          if (b.sale && !it.seenSale) it.seenSale = b.sale.d;      // 처음 본 거래는 "새 거래"로 치지 않음
          if (b.rent && !it.seenRent) it.seenRent = b.rent.d;
        }
      }
      save();
    } finally {
      btn.disabled = false; btn.textContent = '실거래 불러오기';
    }
    if (!popup && $('tab-tracking').contains(document.activeElement) && document.activeElement.matches('input:not([type=checkbox])')) return;   // 입력 중이면 다시 그리지 않음
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

  const selCnt = () => { const n = items.filter(it => checked.has(it.id)).length, sc = $('trkSelCount'); if (sc) sc.textContent = `${n}개`; };
  const GAPLIM = 10;   // 호가가 최근 실거래와 이 % 이상 벌어지면 강조
  const gapPct = (c) => (c.askGap != null && c.realSale ? c.askGap / c.realSale.price * 100 : null);

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
      askGap: firstSale != null && rl.sale ? firstSale - rl.sale.price : null,       // 호가 - 최근 실거래
      groups, realSale: rl.sale || null, realRent: rl.rent || null };
  }

  /** 계산되는 칸들: { 칸이름: [내용, 색] } — 입력할 때마다 이 칸들만 다시 그림 */
  function calcCells(c) {
    const d = (v) => [U.diff(v), U.cls(v)];
    const out = { band: [c.band || '-', ''], drop: [U.pct(c.drop), U.cls(c.drop)], rise: [U.pct(c.rise), U.cls(c.rise)],
      ask: [c.askGap == null ? '-' : `${U.diff(c.askGap)}<small>${c.realSale ? U.pct(c.askGap / c.realSale.price * 100) : ''}</small>`, U.cls(c.askGap) + (gapPct(c) != null && Math.abs(gapPct(c)) >= GAPLIM ? ' gapbig' : '')] };
    c.groups.forEach((g, k) => {
      out['sd' + k] = d(g.sd); out['rd' + k] = d(g.rd);
      out['gap' + k] = [g.gap == null ? '-' : U.price(g.gap), '']; out['gd' + k] = d(g.gd);
      out['ratio' + k] = [g.ratio == null ? '-' : g.ratio.toFixed(1) + '%', ''];
      out['rtd' + k] = [g.rtd == null ? '-' : (g.rtd > 0 ? '+' : '') + g.rtd.toFixed(1) + '%p', U.cls(g.rtd)];
    });
    return out;
  }

  /** 입력 한 칸 저장 (표·카드 공통).  t = 입력 요소, it = 단지 */
  function applyInput(t, it) {
    if (t.dataset.f) { it[t.dataset.f] = t.value.trim(); if (t.dataset.f === 'households') delete it.hhAuto; if (it.af) delete it.af[t.dataset.f]; }
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
      if (v == null) { delete q[f]; t.value = ''; } else { q[f] = v; (it.qt = it.qt || {})[m] = today(); }
      if (!Object.keys(q).length) delete it.quotes[m];
    }
    const c = compute(it);
    if (c.base) it.lastSale = c.base;
    save();
    return c;
  }

  const cardMode = () => (ui.card == null ? window.innerWidth < 760 : ui.card);

  /** 체크된 단지 중 실거래를 아직 읽지 않은 단지만 조용히 읽어서 전고점·전저점을 자동으로 채움 */
  function autoReal() {
    const need = items.filter(it => checked.has(it.id) && !real.has(it.id));
    if (need.length) load(false, need).catch(() => {});
  }

  function render() {
    Store.set(CKEY, [...checked]);                                   // 체크 상태 기억
    selCnt();
    const list = visible(), scope = inScope(), m0 = months[0];
    $('trkEmpty').hidden = items.length > 0;
    $('trkNoMonth').hidden = !(items.length && !months.length);
    const card = cardMode();
    $('trkTable').parentElement.hidden = !items.length || card;
    $('trkCards').hidden = !items.length || !card;
    $('btnTrkCard').textContent = card ? '표로 보기' : '카드로 입력';
    $('btnTrkInfo').textContent = ui.info ? '단지 정보 접기' : '단지 정보 펼치기';
    $('btnTrkInfo').hidden = card;
    const done = m0 ? scope.filter(it => it.quotes[m0]?.s != null).length : 0;
    $('trkProgress').innerHTML = m0 && scope.length ? `${ymLabel(m0)} 입력 <b>${done}</b> / ${scope.length}개` + (list.length !== scope.length ? ` · 표시 ${list.length}개` : '') : '';
    notices(scope);
    if (card) return renderCards(list);

    const fx = (label, cls = '') => `<th rowspan="2" class="${cls}">${label}</th>`;
    const head = `<thead><tr>${fx('<input type="checkbox" id="trkAll">', 'c')}${fx('가격대')}${fx('시', 'l')}${fx('구', 'l')}${fx('동', 'l')}${fx('생활권', 'l info')}${fx('단지명', 'l name')}` +
      `${fx('연식')}${fx('연차')}${fx('세대수', 'info')}${fx('평형')}${fx('구조', 'info')}${fx('방', 'info')}${fx('화', 'info')}${fx('링크', 'info')}` +
      `${fx('전고점')}${fx('전고 대비 하락률')}${fx('전저점')}${fx('전저 대비 상승률')}${fx('호가-실거래')}` +
      months.map((m, k) => `<th colspan="10" class="grp c">${ymLabel(m)}${k === 0 ? ' · 최신' : ''} <button class="mini" data-delmonth="${m}" title="이 달 기록 삭제">×</button></th>`).join('') +
      fx('메모', 'l') + fx('지도', 'c') + '</tr><tr>' +
      months.map(() => GROUP.map((n, i) => `<th class="${[0, 1, 3, 4].includes(i) ? 'in' : ''}${i === 0 ? ' gl' : ''}">${n}${i === 0 || i === 3 ? '(억)' : ''}</th>`).join('')).join('') + '</tr></thead>';

    const inp = (it, f, cls = '', ph = '') => `<input class="${cls}" data-f="${f}" value="${U.esc(it[f] || '')}" placeholder="${ph}">`;
    const body = list.map((it, i) => {
      const c = compute(it), cells = calcCells(c);
      const [si, gu] = U.siGu(it.sido, it.sgg);
      const cell = (k, extra = '') => `<td data-c="${k}" class="${cells[k][1]} ${extra}">${cells[k][0]}</td>`;
      const over = (f, v, auto) => `<td><input class="num${it[f] != null ? ' edited' : ''}" data-o="${f}" inputmode="decimal" value="${eok(v)}" placeholder="자동" title="${auto ? `실거래 ${U.price(auto.price)} (${U.date(auto.d)}) · 눌러서 수정, 지우면 자동값` : '실거래 자료 없음 · 직접 입력'}"></td>`;
      const qin = (m, f, ph, isPrice, first) => { const v = (it.quotes[m] || {})[f]; return `<td class="${first ? 'gl' : ''}"><input class="num" data-m="${m}" data-q="${f}" inputmode="decimal" value="${isPrice ? eok(v) : (v ?? '')}" placeholder="${ph}"></td>`; };
      return `<tr data-i="${i}" class="${isNew(it) ? 'newtrade' : ''}"><td class="c"><input type="checkbox" data-chk="${i}" ${checked.has(it.id) ? 'checked' : ''}></td>` +
        `${cell('band')}<td class="l">${U.esc(si)}</td><td class="l">${U.esc(gu)}</td><td class="l">${U.esc(it.dong)}</td><td class="l info">${inp(it, 'zone', '', '생활권')}</td>` +
        `<td class="l name" title="${U.esc(it.folders.join(', '))}"><a href="#" class="cxlink" data-cx="${U.esc(it.id)}" title="단지 한 장 요약">${U.esc(it.name)}</a>${isNew(it) ? ' <span class="tag">새 거래</span>' : ''}</td>` +
        `<td>${it.buildYear || '-'}</td><td>${it.buildYear ? CONFIG.toAge(it.buildYear) : '-'}</td><td class="info">${inp(it, 'households', it.hhAuto || it.af?.households ? 'auto' : '', '직접 입력')}</td><td>${it.g}㎡<small>${U.esc(pyeong(it))}</small></td><td class="info">${inp(it, 'structure', it.af?.structure ? 'auto' : '', '계/복')}</td><td class="info">${inp(it, 'rooms', it.af?.rooms ? 'auto' : '')}</td><td class="info">${inp(it, 'baths', it.af?.baths ? 'auto' : '')}</td>` +
        `<td class="info">${inp(it, 'link', 'wide', '직접 입력')} <a class="btn mini" href="${U.esc(link(it))}" target="_blank" rel="noopener">열기</a></td>` +
        `${over('peakO', c.peak, c.peakAuto)}${cell('drop')}${over('troughO', c.trough, c.troughAuto)}${cell('rise')}${cell('ask')}` +
        months.map((m, k) => qin(m, 's', '예: 14.3', true, true) + qin(m, 'sn', '개') + cell('sd' + k) + qin(m, 'r', '예: 7.5', true) + qin(m, 'rn', '개') + cell('rd' + k) + cell('gap' + k) + cell('gd' + k) + cell('ratio' + k) + cell('rtd' + k)).join('') +
        `<td class="l">${inp(it, 'memo', 'memo', '메모')}</td><td class="c"><button class="mini" data-map="${i}">위치</button></td></tr>`;
    }).join('');
    const table = $('trkTable');
    table.className = ui.info ? '' : 'hideinfo';
    table.innerHTML = head + `<tbody>${body}</tbody>`;
    table.querySelector('#trkAll').onclick = (e) => { list.forEach(it => (e.target.checked ? checked.add(it.id) : checked.delete(it.id))); autoReal(); render(); $('trkAll').checked = e.target.checked; };
    table.querySelector('thead').onclick = (e) => {
      const m = +e.target.dataset.delmonth;
      if (!m) return;
      const n = items.filter(it => it.quotes[m]).length + Object.values(survey).filter(r => r.quotes && r.quotes[m]).length;
      if (!Vault.sure(`${ymLabel(m)} 기록을 삭제합니다.` + (n ? `\n${n}개 단지에 적어 둔 이 달의 가격이 모두 지워집니다. (전수조사 기록 포함)` : ''), n > 0)) return;
      months = months.filter(x => x !== m); items.forEach(it => { delete it.quotes[m]; }); Object.values(survey).forEach(r => { if (r.quotes) delete r.quotes[m]; });
      save(); fillSelects(); render();
    };
    const tbody = table.querySelector('tbody');
    tbody.onclick = (e) => {
      const t = e.target;
      if (t.dataset.chk != null) { const it = list[+t.dataset.chk]; t.checked ? checked.add(it.id) : checked.delete(it.id); autoReal(); selCnt(); }
      if (t.dataset.map != null) App.showMap(list[+t.dataset.map]);
    };
    tbody.onchange = (e) => {
      const t = e.target, tr = t.closest('tr');
      if (!tr || t.type === 'checkbox') return;
      const cells = calcCells(applyInput(t, list[+tr.dataset.i]));          // 계산 칸만 다시 그림 (입력 중인 칸은 그대로)
      tr.querySelectorAll('td[data-c]').forEach(td => { const x = cells[td.dataset.c]; if (x) { td.innerHTML = x[0]; td.className = x[1]; } });
      progressOnly();
    };
  }

  function progressOnly() {
    const scope = inScope(), m0 = months[0];
    if (m0 && scope.length) $('trkProgress').innerHTML = `${ymLabel(m0)} 입력 <b>${scope.filter(it => it.quotes[m0]?.s != null).length}</b> / ${scope.length}개`;
  }

  /** 카드 입력 화면 (휴대폰용): 단지 하나가 카드 한 장, 최신 달만 입력 */
  function renderCards(list) {
    const m0 = months[0], p0 = months[1];
    const box = $('trkCards');
    if (!m0) { box.innerHTML = ''; return; }
    box.innerHTML = list.map((it, i) => {
      const c = compute(it), q = it.quotes[m0] || {}, p = it.quotes[p0] || {}, g = c.groups[0];
      const qin = (f, ph, isPrice) => `<input class="num" data-m="${m0}" data-q="${f}" inputmode="decimal" value="${isPrice ? eok(q[f]) : (q[f] ?? '')}" placeholder="${ph}">`;
      return `<div class="tcard${isNew(it) ? ' newtrade' : ''}" data-i="${i}">
        <div class="thead"><label><input type="checkbox" data-chk="${i}" ${checked.has(it.id) ? 'checked' : ''}> <b>${U.esc(it.name)}</b> ${it.g}㎡ <small>${U.esc(pyeong(it))}</small></label> <a href="#" class="cxlink mini" data-cx="${U.esc(it.id)}" title="단지 한 장 요약">요약</a>
</div>
        <div class="tsub">${U.esc(it.sgg)} ${U.esc(it.dong)}${it.buildYear ? ` · ${it.buildYear}년` : ''}${p0 ? ` · 지난 기록 매매 ${p.s != null ? eok(p.s) + '억' : '-'} / 전세 ${p.r != null ? eok(p.r) + '억' : '-'}` : ''}</div>
        <div class="tgrid"><label>매매(억) ${qin('s', '예: 14.3', true)}</label><label>매물 수 ${qin('sn', '개')}</label><label>전세(억) ${qin('r', '예: 7.5', true)}</label><label>매물 수 ${qin('rn', '개')}</label></div>
        <div class="tcalc" data-calc>${cardCalc(c, g)}</div>
        <div class="tfoot"><input data-f="memo" class="memo" value="${U.esc(it.memo || '')}" placeholder="메모"><a class="btn mini" href="${U.esc(link(it))}" target="_blank" rel="noopener">네이버에서 보기</a><button class="mini" data-map="${i}">위치</button></div>
      </div>`;
    }).join('') || '<p class="empty">조건에 맞는 단지가 없습니다.</p>';
    box.onclick = (e) => {
      const t = e.target;
      if (t.dataset.chk != null) { const it = list[+t.dataset.chk]; t.checked ? checked.add(it.id) : checked.delete(it.id); autoReal(); selCnt(); }
      if (t.dataset.map != null) App.showMap(list[+t.dataset.map]);
    };
    box.onchange = (e) => {
      const t = e.target, el = t.closest('.tcard');
      if (!el || t.type === 'checkbox') return;
      const c = applyInput(t, list[+el.dataset.i]);
      el.querySelector('[data-calc]').innerHTML = cardCalc(c, c.groups[0]);
      progressOnly();
    };
  }
  function cardCalc(c, g) {
    const x = (label, v, cls = '') => `<span>${label} <b class="${cls}">${v}</b></span>`;
    return x('전월 대비', g ? U.diff(g.sd) : '-', g ? U.cls(g.sd) : '') + x('투자금', g && g.gap != null ? U.price(g.gap) : '-') + x('전세가율', g && g.ratio != null ? g.ratio.toFixed(0) + '%' : '-') +
      x('전고 대비', U.pct(c.drop), U.cls(c.drop)) + x('최근 실거래', c.realSale ? `${U.price(c.realSale.price)} (${U.date(c.realSale.d)})` : '-');
  }

  /** 표 위 알림: 이번 달 칸 만들기 제안, 새 실거래, 백업 알림 */
  function notices(scope) {
    const out = [], tm = thisMonth();
    if (items.length && months.length && !months.includes(tm)) out.push(`${ymLabel(tm)} 시세 칸이 아직 없습니다. <button class="mini" data-act="month">${tm % 100}월 칸 만들기</button>`);
    const fresh = scope.filter(isNew);
    if (fresh.length) {
      out.push(`<b>새 실거래 ${fresh.length}곳</b> — ` + fresh.slice(0, 6).map(it => {
        const rl = real.get(it.id), c = compute(it), s = rl.sale && rl.sale.d > it.seenSale ? rl.sale : null, r = rl.rent && rl.rent.d > it.seenRent ? rl.rent : null;
        const flag = s && c.peakAuto && s.d === c.peakAuto.d && s.price === c.peakAuto.price ? ' <span class="tag up">신고가</span>' : (s && c.groups[0]?.s != null && s.price < c.groups[0].s ? ' <span class="tag">호가보다 낮음</span>' : '');
        return `${U.esc(it.name)} ${it.g}㎡ ${s ? `매매 ${U.price(s.price)}(${U.date(s.d)})${flag}` : ''}${s && r ? ', ' : ''}${r ? `전세 ${U.price(r.price)}(${U.date(r.d)})` : ''}`;
      }).join(' · ') + (fresh.length > 6 ? ' …' : '') + ` <button class="mini" data-act="seen">확인했음</button> <button class="mini" data-act="shownew">이 단지만 보기</button>`);
    }
    const bk = Vault.remindText(items.length + Object.keys(survey).length);
    if (bk) out.push(bk);
    const box = $('trkNotice');
    box.hidden = !out.length;
    box.innerHTML = out.map(x => `<div>${x}</div>`).join('');
    box.onclick = (e) => {
      const a = e.target.dataset.act;
      if (a === 'month') { addMonth(tm); render(); }
      if (a === 'seen') { scope.forEach(it => { const rl = real.get(it.id); if (rl?.sale) it.seenSale = rl.sale.d; if (rl?.rent) it.seenRent = rl.rent.d; }); save(); if ($('trkShow').value === 'new') $('trkShow').value = ''; render(); }
      if (a === 'shownew') { $('trkShow').value = 'new'; render(); }
      if (a === 'backup') Vault.copyCode();
    };
  }

  /** 지난 기록과 같음: 최신 달이 비어 있는 단지에 바로 앞 기록을 복사 */
  function sameAsLast() {
    const m0 = months[0], p0 = months[1];
    if (!m0 || !p0) return U.toast('복사할 지난 기록이 없습니다. (달이 두 개 이상 있어야 합니다)');
    const sel = visible().filter(it => checked.has(it.id));
    const target = (sel.length ? sel : visible()).filter(it => it.quotes[p0] && it.quotes[m0]?.s == null && it.quotes[m0]?.r == null);
    if (!target.length) return U.toast('채울 단지가 없습니다. (이미 적었거나 지난 기록이 없음)');
    if (!sel.length && !confirm(`체크한 단지가 없습니다.\n지금 보이는 단지 중 아직 안 적은 ${target.length}개에 ${ymLabel(p0)} 값을 그대로 넣을까요?`)) return;
    target.forEach(it => { it.quotes[m0] = { ...it.quotes[p0] }; (it.qt = it.qt || {})[m0] = today(); });
    save(); fillSelects(); render();
    U.toast(`${target.length}개 단지에 ${ymLabel(p0)} 값을 넣었습니다.`);
  }

  /** 시세트래킹 표 엑셀 (기록한 달이 오른쪽으로 이어짐) */
  function excel() {
    const sel = visible().filter(it => checked.has(it.id));
    const list = sel.length ? sel : visible();
    if (!list.length) return U.toast('내려받을 단지가 없습니다.');
    const r1 = (v) => (v == null ? '' : +v.toFixed(1));
    const tail = ['호가-실거래', '최근 매매 실거래', '매매 실거래일', '최근 전세 실거래', '전세 실거래일', '메모', '폴더'];
    const top = [...FIXED.map(() => ''), ...months.flatMap(m => [ymLabel(m), ...GROUP.slice(1).map(() => '')]), ...tail.map(() => '')];
    const head = [...FIXED.map(n => (n === '구조' ? '구조(계,복)' : n)), ...months.flatMap(() => GROUP), ...tail];
    const rows = list.map(it => {
      const c = compute(it), [si, gu] = U.siGu(it.sido, it.sgg);
      return { sort: c.base || 0, row: [c.band, si, gu, it.dong, it.zone, it.name, it.buildYear || '', it.buildYear ? CONFIG.toAge(it.buildYear) : '', it.households, pyeong(it),
        it.structure, it.rooms, it.baths, link(it), c.peak ?? '', r1(c.drop), c.trough ?? '', r1(c.rise),
        ...c.groups.flatMap(g => [g.s ?? '', g.sn ?? '', g.sd ?? '', g.r ?? '', g.rn ?? '', g.rd ?? '', g.gap ?? '', g.gd ?? '', r1(g.ratio), r1(g.rtd)]),
        c.askGap ?? '', c.realSale?.price ?? '', U.date(c.realSale?.d), c.realRent?.price ?? '', U.date(c.realRent?.d), it.memo || '', it.folders.join(', ')] };
    }).sort((a, b) => b.sort - a.sort).map(x => x.row);
    U.download(`시세트래킹_${curFolder ? curFolder.replace(/[\\/:*?"<>|]/g, '_') + '_' : ''}${U.stamp()}`, [
      { name: '시세트래킹', rows: [top, head, ...rows] },
      { name: '설명', rows: [['항목', '설명'], ['금액 단위', '만원'], ['매매·전세·개수', '그 달에 직접 적은 가격과 매물 수'],
        ['전월 대비', '그 달 값 - 바로 앞 기록(오른쪽 묶음) 값'], ['매-전(투자금)', '매매 - 전세'], ['전세가율', '전세 ÷ 매매 × 100 (%)'],
        ['전고점·전저점', `${String(CONFIG.PEAK_FROM).slice(0, 4)}년 이후 매매 실거래 최고가·최저가(직거래 제외). 직접 고친 값이 있으면 그 값`],
        ['전고 대비 하락률·전저 대비 상승률', '가장 최근에 적은 매매가(없으면 최근 실거래가) 기준 (%)'], ['호가-실거래', '가장 최근에 적은 매매 호가 - 최근 매매 실거래가'],
        ['최근 매매·전세 실거래', '가장 최근 실거래가와 계약일 (매매는 직거래 제외)'], ['실거래 자료', '국토교통부 실거래가 공개시스템']] },
    ], 'xlsx');
  }

  /** 담아 둔 단지의 전체 실거래 내역 (최대 20년) 내려받기 */
  async function downloadTrades() {
    const sel = visible().filter(it => checked.has(it.id));
    const list = sel.length ? sel : visible();
    if (!list.length) return U.toast('내려받을 단지가 없습니다.');
    const btn = $('btnTrkTradesDl');
    btn.disabled = true; btn.textContent = '불러오는 중…';
    try {
      const nowY = new Date().getFullYear();
      const rows = [['구분', '시', '구', '동', '단지명', '전용㎡', '평형', '계약일', '금액(만원)', '층', '비고']];
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

  /** 탭을 열 때: 표를 그리고, 전고점·전저점·새 거래 확인을 위해 실거래를 조용히 읽음 */
  function open() { fillSelects(); render(); if (inScope().some(it => !real.has(it.id))) load(false); }

  /** 다른 탭(그래프)에서 쓰는: 이 단지에 적어 둔 가격 기록 [{ym, s, r}] */
  function quotesOf(id) {
    const it = rec(id);
    return it && it.quotes ? Object.keys(it.quotes).map(Number).sort((a, b) => a - b).map(ym => ({ ym, s: it.quotes[ym].s ?? null, r: it.quotes[ym].r ?? null })) : [];
  }

  /* ── 전수조사 탭·백업과 함께 쓰는 기능 ── */
  /** 단지 기록 꺼내기: 트래킹에 담긴 단지면 그 기록, 아니면 전수조사 기록. create=true 면 없을 때 새로 만듦 */
  function rec(id, create) {
    const it = items.find(x => x.id === id);
    if (it) return it;
    if (!survey[id] && create) survey[id] = { quotes: {}, qt: {} };
    if (survey[id]) { survey[id].quotes = survey[id].quotes || {}; survey[id].qt = survey[id].qt || {}; }
    return survey[id] || null;
  }
  const has = (id) => items.some(x => x.id === id);
  const getMonths = () => months;
  function addMonth(ym) {
    if (!ym || months.includes(ym)) return false;
    months.push(ym); months.sort((a, b) => b - a); save(); return true;
  }
  /** 가격을 적어 둔 모든 기록 [{ id, rec, tracked }] (트래킹 + 전수조사) */
  const allRecords = () => [...items.map(it => ({ id: it.id, rec: it, tracked: true })), ...Object.keys(survey).map(id => ({ id, rec: rec(id), tracked: false }))];

  /** 두 기록 합치기: b 의 값이 있으면 a 에 덮어씀 (달별 가격은 칸 단위로 합침) */
  function mergeRec(a, b) {
    for (const f of CARRY) {
      if (f === 'quotes' || f === 'qt') continue;
      if (b[f] != null && b[f] !== '') a[f] = b[f];
    }
    a.quotes = a.quotes || {}; a.qt = a.qt || {};
    for (const m of Object.keys(b.quotes || {})) a.quotes[m] = { ...(a.quotes[m] || {}), ...b.quotes[m] };
    for (const m of Object.keys(b.qt || {})) if (!a.qt[m] || b.qt[m] > a.qt[m]) a.qt[m] = b.qt[m];
    if (Array.isArray(b.folders)) a.folders = [...new Set([...(a.folders || []), ...b.folders])];
    return a;
  }
  const exportAll = () => ({ items, folders, months, survey });
  /** 백업·코드 불러오기.  merge=true 면 지금 기록과 합치고, false 면 통째로 바꿈 */
  function importAll(obj, merge) {
    const inItems = Array.isArray(obj.items) ? obj.items : [], inSurvey = obj.survey || {};
    if (!merge) { items = inItems; folders = obj.folders || [BASE]; months = obj.months || null; survey = inSurvey; }
    else {
      for (const n of inItems) {
        const old = items.find(it => it.id === n.id);
        if (old) { mergeRec(old, n); continue; }
        if (survey[n.id]) { const local = survey[n.id]; delete survey[n.id]; items.push(mergeRec(mergeRec({ ...n, quotes: {}, qt: {} }, local), n)); }
        else items.push(n);
      }
      for (const id of Object.keys(inSurvey)) {
        const old = items.find(it => it.id === id);
        if (old) mergeRec(old, inSurvey[id]); else survey[id] = mergeRec(survey[id] || { quotes: {}, qt: {} }, inSurvey[id]);
      }
      folders = [...new Set([...folders, ...(obj.folders || [])])];
      months = [...new Set([...(months || []), ...(obj.months || []), ...items.flatMap(it => Object.keys(it.quotes || {}).map(Number)), ...Object.values(survey).flatMap(r => Object.keys(r.quotes || {}).map(Number))])];
    }
    normalize(); real.clear(); checked.clear(); if (typeof QLog !== 'undefined') QLog.reset(); save(); fillSelects(); render();
    return items.length;
  }

  const ext = () => ({ get items() { return items; }, checked, folders, get months() { return months; }, real, save, render, compute, gapPct, GAPLIM, ymLabel, pyeong, folderList: () => folders, setFolders: (f) => { folders = f; Store.set(FKEY, folders); if (!folders.includes(curFolder)) { curFolder = ''; Store.set('apt.curFolder', ''); } fillSelects(); render(); } });
  return { ext, init, add, fillHH, setField, setQuote, removeFrom, focus, renameFolder, deleteFolder, moveFolder, pinFolder, pickFolder, folderList: () => folders, folderCount: (f) => items.filter(it => it.folders.includes(f)).length, curFolder: () => curFolder, checkedIds: () => [...checked], all, open, pyeong, quotesOf, rec, has, save, getMonths, addMonth, ymLabel, allRecords, exportAll, importAll, sameDay: today, FIXED, GROUP, STATUSES };
})();
