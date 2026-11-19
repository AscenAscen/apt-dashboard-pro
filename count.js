/* ─────────────────────────────────────────────────────────
   count.js — [단지 수] 탭 : 원하는 지역에 조건(세대수·평형·연식)에 맞는 아파트 단지가 몇 개인지 셉니다.
   · 자료: data/count.json (scripts/count_summary.py 가 자동 수집 때 만듦)
       기존 단지 = K-apt 단지 기본정보 · 평형 = 2018년 이후 실거래(매매·전세)로 거래된 전용면적 · 분양권 = 청약홈 입주 예정
   · 평형 조건은 "그 평형이 단지에 하나라도 있으면" 셉니다.
   · 탭을 처음 열 때만 자료를 읽습니다(다른 탭 속도에 영향 없음). app.js 를 고치지 않으려고 탭이 보이는 것을 직접 지켜봅니다.
   저장 위치: apt.count.ui.v1 (조건)
   ───────────────────────────────────────────────────────── */
const CountTab = (() => {
  const root = document.getElementById('tab-count');
  if (!root) return {};
  const $ = (id) => document.getElementById(id);
  const UKEY = 'apt.count.ui.v1';
  const F_RENT = 1, F_MIX = 2, F_STAFF = 4, F_PRE = 8, F_REB = 16, F_STAIR = 32, F_HALL = 64;
  const AREA = { all: [0, 999], s: [0, 60], m: [60, 85], l: [85, 999] };
  const AREA_NAME = { all: '전체', s: '소형 (60㎡ 미만)', m: '국평 (60~85㎡)', l: '중대형 (85㎡ 이상)' };
  const AGE = { all: '전체', a5: '5년 이내', a10: '10년 이내', a1020: '10~20년', a20: '20년 이상', a30: '30년 이상' };
  const THIS_Y = new Date().getFullYear();

  let D = null, loading = null, inited = false;
  let ui = { hh: 300, area: 'all', from: '', to: '', age: 'all', pre: true, rebAll: true, rent: false, mixed: true, mx: true, unk: false, sido: '', q: '', sel: '', sort: 'n', lsort: 'hh' };
  let lastList = [], lastRegions = [], lastDongs = [];

  const esc = (s) => U.esc(s);
  const saveUi = () => Store.set(UKEY, ui);
  const reg = (code) => (D && D.R[code]) || ['', ''];

  /* ── 화면 틀 ── */
  function frame() {
    root.innerHTML = `
<style>
  #tab-count .cn-grid { display: grid; grid-template-columns: minmax(300px, 420px) 1fr; gap: 14px; align-items: start; }
  #tab-count .cn-grid > .panel { margin-bottom: 0; }
  #tab-count tr.cn-on td { background: var(--panel2); font-weight: 700; }
  #tab-count tbody tr[data-code], #tab-count tbody tr[data-dong] { cursor: pointer; }
  #tab-count td.l, #tab-count th.l { text-align: left; }
  #tab-count .cn-tag { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 9px; border: 1px solid var(--line); color: var(--sub); margin-left: 4px; }
  #tab-count .cn-tag.pre { color: #e08a1e; border-color: #e08a1e; }
  #tab-count .cn-tag.warn { color: #f2c94c; border-color: #f2c94c; }
  #tab-count .cn-areas { color: var(--sub); font-size: 12px; white-space: normal; max-width: 260px; text-align: left; }
  #tab-count .cn-dongs { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 12px; }
  #tab-count .cn-dongs button { font-size: 13px; }
  #tab-count .cn-dongs button b { margin-left: 4px; }
  #tab-count .cn-dongs button.on { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  #tab-count .filters input.cn-num { width: 74px; }
  #tab-count .checks { flex-wrap: wrap; row-gap: 6px; }
  #tab-count .checks label { white-space: nowrap; }
  #tab-count .filters .row { flex-wrap: wrap; }
  #tab-count .presets { flex-wrap: wrap; }
  @media (max-width: 900px) { #tab-count .cn-grid { grid-template-columns: 1fr; } }
</style>
<section class="panel">
  <div class="filters">
    <label>단지 세대수 (이상)
      <span class="row"><span class="presets" id="cnHhP"><button data-v="300">300</button><button data-v="500">500</button><button data-v="1000">1000</button></span>
      <input type="number" class="cn-num" id="cnHh" min="0" step="50"> 세대</span></label>
    <label>평형 (전용, 그 평형이 있는 단지)
      <span class="row"><span class="presets" id="cnAreaP"><button data-v="all">전체</button><button data-v="s">소형 ~60</button><button data-v="m">국평 60~85</button><button data-v="l">중대형 85~</button></span>
      <input type="number" class="cn-num" id="cnFrom" placeholder="부터" min="0"> ~ <input type="number" class="cn-num" id="cnTo" placeholder="까지" min="0"> ㎡</span></label>
    <label>연식 <select id="cnAge">${Object.entries(AGE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
    <label>시도 <select id="cnSido"><option value="">전국</option></select></label>
    <label>이름 찾기 <input type="search" id="cnQ" placeholder="시군구·동·단지 이름" style="min-width:170px"></label>
  </div>
  <div class="filters" style="margin-top:10px">
    <div class="checks">
      <label><input type="checkbox" id="cnPre"> 분양권(입주 전) 포함</label>
      <label title="재건축·재개발 분양권은 청약홈에 일반분양 세대수만 나와서, 세대수 조건과 관계없이 넣습니다"><input type="checkbox" id="cnRebAll"> 정비사업 분양권은 세대수 무관</label>
      <label><input type="checkbox" id="cnMx"> 주상복합 포함</label>
      <label><input type="checkbox" id="cnMixed"> 분양·임대 혼합 포함</label>
      <label><input type="checkbox" id="cnRent"> 임대 포함</label>
      <label><input type="checkbox" id="cnUnk"> 평형 정보 없는 단지도 포함</label>
    </div>
    <span class="grow"></span>
    <button id="cnReset" class="mini">조건 처음으로</button>
    <button id="cnXl">📥 엑셀</button>
  </div>
  <p class="hint" id="cnAsOf"></p>
</section>
<div class="cards" id="cnCards"></div>
<div class="cn-grid">
  <section class="panel">
    <div class="bar"><strong id="cnLTitle">시군구별 단지 수</strong></div>
    <div class="tablewrap" style="margin-top:8px"><table id="cnRegions"></table></div>
  </section>
  <section class="panel" id="cnRight">
    <p class="empty">왼쪽에서 시군구를 고르면 동별 단지 수와 단지 목록이 나옵니다.</p>
  </section>
</div>
<p class="hint">· 기존 단지: K-apt(공동주택관리정보시스템) 단지 기본정보 · 평형: 2018년 이후 국토부 실거래(매매·전세)에 나온 전용면적 · 분양권: 청약홈 입주 예정 단지.<br>
· 평형 조건은 그 평형이 단지에 하나라도 있으면 셉니다. 거래가 한 번도 없던 평형, 대시보드가 실거래를 모으지 않는 지역의 단지는 "평형 정보 없음"으로 따로 셉니다.<br>
· 재건축·재개발 분양권의 세대수는 일반분양 세대수라 실제 단지보다 적습니다.</p>`;
  }

  /* ── 조건에 맞는지 ── */
  function areaRange() {
    const f = parseFloat(ui.from), t = parseFloat(ui.to);
    if (!isNaN(f) || !isNaN(t)) return [isNaN(f) ? 0 : f, isNaN(t) ? 999 : t + 0.999];
    return AREA[ui.area] || AREA.all;
  }
  function areaOn() { const [a, b] = areaRange(); return !(a <= 0 && b >= 999); }
  function ageOk(r) {
    if (ui.age === 'all') return true;
    const pre = r[6] & F_PRE;
    const y = pre ? THIS_Y : Math.floor(r[4] / 100);
    if (!y) return false;
    const age = THIS_Y - y;
    return { a5: age <= 5, a10: age <= 10, a1020: age > 10 && age <= 20, a20: age > 20, a30: age > 30 }[ui.age];
  }
  /** 0 = 빠짐, 1 = 셈, 2 = 평형 정보 없음(조건에 따라 셈) */
  function test(r) {
    const fl = r[6], pre = fl & F_PRE;
    if (pre && !ui.pre) return 0;
    if ((fl & (F_RENT | F_STAFF)) && !ui.rent) return 0;
    if ((fl & F_MIX) && !ui.mixed) return 0;
    if (r[5] === 'M' && !ui.mx) return 0;
    if (r[5] === 'E') return 0;
    const hhOk = r[3] >= (+ui.hh || 0) || (pre && (fl & F_REB) && ui.rebAll);
    if (!hhOk) return 0;
    if (!ageOk(r)) return 0;
    if (ui.sido && reg(r[0])[0] !== ui.sido) return 0;
    if (ui.q) {
      const [sido, sgg] = reg(r[0]);
      const t = (sido + sgg + r[1] + r[2]).replace(/\s/g, '');
      if (!t.includes(ui.q.replace(/\s/g, ''))) return 0;
    }
    if (areaOn()) {
      if (!r[7].length) return 2;
      const [a, b] = areaRange();
      if (!r[7].some(x => x >= a && x < b)) return 0;
    }
    return 1;
  }

  /* ── 계산·그리기 ── */
  function run() {
    if (!D) return;
    const byCode = new Map();
    let n = 0, nPre = 0, nUnk = 0, hh = 0;
    lastList = [];
    for (const r of D.rows) {
      const t = test(r);
      if (!t) continue;
      let g = byCode.get(r[0]);
      if (!g) { g = { code: r[0], n: 0, pre: 0, unk: 0, hh: 0 }; byCode.set(r[0], g); }
      if (t === 2) { nUnk++; g.unk++; if (!ui.unk) continue; }
      lastList.push(r);
      n++; hh += r[3]; if (r[6] & F_PRE) nPre++;
      g.n++; g.hh += r[3]; if (r[6] & F_PRE) g.pre++;
    }
    lastRegions = [...byCode.values()].filter(g => g.n || g.unk);
    const sorter = { n: (a, b) => b.n - a.n, hh: (a, b) => b.hh - a.hh, name: (a, b) => (reg(a.code).join(' ')).localeCompare(reg(b.code).join(' ')) }[ui.sort] || ((a, b) => b.n - a.n);
    lastRegions.sort(sorter);

    const cond = `${ui.hh}세대 이상 · 평형 ${(ui.from || ui.to) ? `${ui.from || 0}~${ui.to || ''}㎡` : AREA_NAME[ui.area]} · 연식 ${AGE[ui.age]}`;
    $('cnCards').innerHTML = `
      <div class="card"><div class="k">${esc(ui.sido || '전국')} 조건에 맞는 단지</div><div class="v">${n.toLocaleString()}곳</div><div class="s">${esc(cond)}</div></div>
      <div class="card"><div class="k">그중 분양권(입주 전)</div><div class="v">${nPre.toLocaleString()}곳</div><div class="s">${ui.pre ? '포함해서 셈' : '빼고 셈'}</div></div>
      <div class="card"><div class="k">세대수 합계</div><div class="v">${hh.toLocaleString()}세대</div><div class="s">분양권은 공급 세대 기준</div></div>
      <div class="card"><div class="k">평형 정보 없음</div><div class="v">${areaOn() ? nUnk.toLocaleString() + '곳' : '-'}</div><div class="s">${areaOn() ? (ui.unk ? '포함해서 셈' : '빼고 셈 (위 체크로 포함)') : '평형 조건을 걸면 나옵니다'}</div></div>`;

    const th = (k, t) => `<th class="sortable${k === 'name' ? ' l' : ''}" data-s="${k}">${t}${ui.sort === k ? ' ▼' : ''}</th>`;
    $('cnRegions').innerHTML = `<thead><tr>${th('name', '시군구')}${th('n', '단지 수')}<th>분양권</th>${th('hh', '세대수')}${areaOn() ? '<th title="평형 정보가 없어 따로 센 단지">평형 모름</th>' : ''}</tr></thead><tbody>` +
      (lastRegions.length ? lastRegions.map(g => {
        const [sido, sgg] = reg(g.code);
        return `<tr data-code="${esc(g.code)}" class="${ui.sel === g.code ? 'cn-on' : ''}"><td class="l">${esc(sgg || sido)}<small class="hint" style="margin:0 0 0 4px">${esc(sgg ? sido.replace(/특별자치시|특별자치도|특별시|광역시|도$/g, '') : '')}</small></td><td><b>${g.n.toLocaleString()}</b></td><td>${g.pre || ''}</td><td>${g.hh.toLocaleString()}</td>${areaOn() ? `<td>${g.unk || ''}</td>` : ''}</tr>`;
      }).join('') : `<tr><td colspan="5" class="l">조건에 맞는 단지가 없습니다.</td></tr>`) + '</tbody>';
    $('cnLTitle').textContent = `시군구별 단지 수 (${lastRegions.filter(g => g.n).length}곳)`;
    right();
  }

  function right() {
    const box = $('cnRight');
    if (!ui.sel || !D) { box.innerHTML = '<p class="empty">왼쪽에서 시군구를 고르면 동별 단지 수와 단지 목록이 나옵니다.</p>'; return; }
    const [sido, sgg] = reg(ui.sel);
    const list = lastList.filter(r => r[0] === ui.sel);
    const dm = new Map();
    list.forEach(r => { const d = r[1] || '(동 모름)'; dm.set(d, (dm.get(d) || 0) + 1); });
    lastDongs = [...dm.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const dsel = ui.dong && dm.has(ui.dong) ? ui.dong : '';
    const shown = list.filter(r => !dsel || (r[1] || '(동 모름)') === dsel);
    const sorters = {
      hh: (a, b) => b[3] - a[3], year: (a, b) => b[4] - a[4], old: (a, b) => (a[4] || 999999) - (b[4] || 999999),
      name: (a, b) => a[2].localeCompare(b[2]), dong: (a, b) => (a[1] || '').localeCompare(b[1] || '') || b[3] - a[3],
    };
    shown.sort(sorters[ui.lsort] || sorters.hh);
    const sth = (k, t, l) => `<th class="sortable${l ? ' l' : ''}" data-ls="${k}">${t}${ui.lsort === k ? ' ▼' : ''}</th>`;
    box.innerHTML = `
      <div class="bar"><strong>${esc(sido)} ${esc(sgg)} · ${list.length.toLocaleString()}곳</strong><span class="grow"></span>
        <span class="hint" style="margin:0">동을 누르면 그 동만 봅니다</span></div>
      <div class="cn-dongs" id="cnDongs"><button data-d="" class="${dsel ? '' : 'on'}">전체<b>${list.length}</b></button>${lastDongs.map(([d, c]) => `<button data-d="${esc(d)}" class="${dsel === d ? 'on' : ''}">${esc(d)}<b>${c}</b></button>`).join('')}</div>
      <div class="tablewrap"><table id="cnList"><thead><tr>${sth('dong', '동', 1)}${sth('name', '단지명', 1)}${sth('hh', '세대수')}${sth('year', '사용승인·입주')}<th class="l">전용면적(㎡)</th><th></th></tr></thead><tbody>` +
      shown.map((r, i) => {
        const fl = r[6], pre = fl & F_PRE;
        const tags = (pre ? `<span class="cn-tag pre">분양권</span>` : '') + ((fl & F_REB) ? `<span class="cn-tag warn" title="세대수는 일반분양만">정비사업</span>` : '') +
          ((fl & F_RENT) ? '<span class="cn-tag">임대</span>' : '') + ((fl & F_MIX) ? '<span class="cn-tag">혼합</span>' : '') + (r[5] === 'M' ? '<span class="cn-tag">주상복합</span>' : '') +
          ((fl & F_STAIR) ? '<span class="cn-tag">계단식</span>' : (fl & F_HALL) ? '<span class="cn-tag">복도식</span>' : '');
        const ym = r[4] ? `${pre ? '입주 ' : ''}${String(r[4]).slice(0, 4)}.${String(r[4]).slice(4, 6)}` : '';
        const ar = r[7].length ? r[7].map(a => `${a}`).join(' · ') : '<span class="cn-tag warn">평형 정보 없음</span>';
        return `<tr><td class="l">${esc(r[1])}</td><td class="l">${esc(r[2])}${tags}</td><td>${r[3].toLocaleString()}</td><td>${ym}</td><td class="cn-areas">${ar}</td>
          <td><button class="mini" data-nv="${i}" title="네이버페이 부동산에서 찾기">네이버</button></td></tr>`;
      }).join('') + '</tbody></table></div>';
    box._shown = shown;
  }

  /* ── 엑셀 ── */
  function excel() {
    if (!D) return;
    const cond = [['조건', `${ui.hh}세대 이상`, `평형 ${(ui.from || ui.to) ? `${ui.from || 0}~${ui.to || ''}㎡` : AREA_NAME[ui.area]}`, `연식 ${AGE[ui.age]}`, ui.sido || '전국',
      ui.pre ? '분양권 포함' : '분양권 제외', ui.rent ? '임대 포함' : '임대 제외', ui.unk ? '평형 모름 포함' : '평형 모름 제외']];
    const s1 = [['시도', '시군구', '단지 수', '분양권', '세대수 합계', '평형 정보 없음']].concat(
      lastRegions.map(g => { const [a, b] = reg(g.code); return [a, b, g.n, g.pre, g.hh, g.unk]; }));
    const s2 = [['시도', '시군구', '동', '단지명', '구분', '유형', '세대수', '사용승인·입주예정', '전용면적(㎡)']].concat(
      lastList.slice().sort((a, b) => (reg(a[0]).join() + a[1]).localeCompare(reg(b[0]).join() + b[1]) || b[3] - a[3]).map(r => {
        const [a, b] = reg(r[0]), fl = r[6];
        const kind = (fl & F_PRE) ? ((fl & F_REB) ? '분양권(정비사업·일반분양 세대수)' : '분양권') : (fl & F_RENT) ? '임대' : (fl & F_MIX) ? '혼합' : (fl & F_STAFF) ? '사택' : '분양';
        return [a, b, r[1], r[2], kind, r[5] === 'M' ? '주상복합' : '아파트', r[3], r[4] ? `${String(r[4]).slice(0, 4)}.${String(r[4]).slice(4, 6)}` : '', r[7].join(', ')];
      }));
    U.download(`단지수_${ui.sido || '전국'}_${U.stamp()}`, [{ name: '시군구별', rows: cond.concat([[]], s1) }, { name: '단지 목록', rows: s2 }]);
  }

  /* ── 조건 칸 ↔ ui ── */
  function syncInputs() {
    $('cnHh').value = ui.hh;
    document.querySelectorAll('#cnHhP button').forEach(b => b.classList.toggle('on', +b.dataset.v === +ui.hh));
    document.querySelectorAll('#cnAreaP button').forEach(b => b.classList.toggle('on', !ui.from && !ui.to && b.dataset.v === ui.area));
    $('cnFrom').value = ui.from; $('cnTo').value = ui.to;
    $('cnAge').value = ui.age; $('cnSido').value = ui.sido; $('cnQ').value = ui.q;
    $('cnPre').checked = ui.pre; $('cnRebAll').checked = ui.rebAll; $('cnRebAll').disabled = !ui.pre;
    $('cnMx').checked = ui.mx; $('cnMixed').checked = ui.mixed; $('cnRent').checked = ui.rent; $('cnUnk').checked = ui.unk;
  }
  function changed() { saveUi(); syncInputs(); run(); }

  function bind() {
    $('cnHhP').onclick = (e) => { const v = e.target.closest('button')?.dataset.v; if (!v) return; ui.hh = +v; changed(); };
    $('cnHh').onchange = () => { ui.hh = Math.max(0, parseInt($('cnHh').value, 10) || 0); changed(); };
    $('cnAreaP').onclick = (e) => { const v = e.target.closest('button')?.dataset.v; if (!v) return; ui.area = v; ui.from = ''; ui.to = ''; changed(); };
    $('cnFrom').onchange = $('cnTo').onchange = () => { ui.from = $('cnFrom').value; ui.to = $('cnTo').value; changed(); };
    $('cnAge').onchange = () => { ui.age = $('cnAge').value; changed(); };
    $('cnSido').onchange = () => { ui.sido = $('cnSido').value; ui.sel = ''; changed(); };
    let qt = null;
    $('cnQ').oninput = () => { clearTimeout(qt); qt = setTimeout(() => { ui.q = $('cnQ').value.trim(); saveUi(); run(); }, 250); };
    [['cnPre', 'pre'], ['cnRebAll', 'rebAll'], ['cnMx', 'mx'], ['cnMixed', 'mixed'], ['cnRent', 'rent'], ['cnUnk', 'unk']].forEach(([id, k]) => {
      $(id).onchange = () => { ui[k] = $(id).checked; changed(); };
    });
    $('cnReset').onclick = () => { ui = Object.assign(ui, { hh: 300, area: 'all', from: '', to: '', age: 'all', pre: true, rebAll: true, rent: false, mixed: true, mx: true, unk: false, q: '' }); changed(); };
    $('cnXl').onclick = excel;
    $('cnRegions').onclick = (e) => {
      const s = e.target.closest('th[data-s]'); if (s) { ui.sort = s.dataset.s; saveUi(); return run(); }
      const tr = e.target.closest('tr[data-code]'); if (!tr) return;
      ui.sel = tr.dataset.code; ui.dong = ''; saveUi();
      document.querySelectorAll('#cnRegions tr.cn-on').forEach(x => x.classList.remove('cn-on')); tr.classList.add('cn-on');
      right();
      if (window.innerWidth < 900) $('cnRight').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    $('cnRight').onclick = (e) => {
      const d = e.target.closest('#cnDongs button'); if (d) { ui.dong = d.dataset.d; saveUi(); return right(); }
      const ls = e.target.closest('th[data-ls]'); if (ls) { ui.lsort = ls.dataset.ls; saveUi(); return right(); }
      const nv = e.target.closest('button[data-nv]');
      if (nv) { const r = $('cnRight')._shown[+nv.dataset.nv]; if (r) { const [, sgg] = reg(r[0]); LandLink.open(sgg, r[1], r[2]); } }
    };
  }

  /* ── 자료 읽기 ── */
  function load() {
    if (loading) return loading;
    $('cnAsOf').textContent = '단지 자료를 읽는 중…';
    loading = fetch(`${CONFIG.DATA_URL}/count.json`, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null).then(d => {
      if (!d || !d.rows) {
        loading = null;
        $('cnAsOf').innerHTML = '<b>아직 단지 수 자료가 없습니다.</b> GitHub 저장소 → Actions → <b>K-apt 세대수 변환 · 사이트 배포</b> → <b>Run workflow</b> 를 한 번 눌러 주세요. 끝나면(2~3분) 이 화면을 새로고침하세요. (매일 자동 수집 때도 함께 만들어집니다)';
        return;
      }
      D = d;
      const sidos = [...new Set(Object.values(D.R).map(v => v[0]).filter(Boolean))].sort();
      $('cnSido').innerHTML = '<option value="">전국</option>' + sidos.map(s => `<option>${esc(s)}</option>`).join('');
      const mv = String(D.mvFrom || '');
      $('cnAsOf').textContent = `자료 기준 ${D.asOf} · K-apt 파일 ${D.kaptFile || '-'} · 분양권은 ${mv.slice(0, 4)}.${mv.slice(4, 6)} 이후 입주 예정 단지 · 전체 ${D.rows.length.toLocaleString()}곳`;
      syncInputs(); run();
    });
    return loading;
  }

  function init() {
    if (inited) return; inited = true;
    ui = Object.assign(ui, Store.get(UKEY, {}));
    frame(); bind(); syncInputs(); load();
  }

  new MutationObserver(() => { if (!root.hidden) init(); }).observe(root, { attributes: true, attributeFilter: ['hidden'] });
  if (!root.hidden) init();

  return { init };
})();
