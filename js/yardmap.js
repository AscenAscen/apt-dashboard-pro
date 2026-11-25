/* ─────────────────────────────────────────────────────────
   yardmap.js — [앞마당] 탭 : 내가 확보한 앞마당 "지역"을 한눈에 보는 판
   · 권역(서울·경기·인천·광역시·50만 이상·50만 미만)별로 지역 박스를 늘어놓습니다. (예전 [앞마당] 탭은 [1등뽑기]로 이름이 바뀌었습니다)
   · 박스를 한 번 누르면 켜짐(색)/꺼짐(회색), 두 번 누르거나 길게 누르면 그 지역의 랜드마크·시세트래킹 단지를 옆 창에 보여 줍니다.
   · 박스 하나 = 행정구역(시군구) 하나. 지역코드는 data/regions.json 에서 시도+이름으로 찾습니다. (자료에 없는 지역 = "자료 없음")
   · [✎ 편집]: 박스를 누르면 급지 색이 돌아가며 바뀌고, ✕ 로 지웁니다. [+ 지역 추가]로 한 달에 하나씩 늘립니다.
   · 열 제목의 인구(만 명)는 data/population.json 으로 자동 계산하고, 자료가 모자라면 처음 넣어 둔 값을 씁니다.
   저장 위치: apt.yardmap.v1 (지역 구성·켜짐 상태·급지 색 — 자동 동기화·백업에 들어갑니다) · apt.yardmapUi.v1 (접힘 상태, 이 기기만)
   ───────────────────────────────────────────────────────── */
const YardMap = (() => {
  const root = document.getElementById('tab-yardmap');
  if (!root) return {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => U.esc(s);
  const KEY = 'apt.yardmap.v1', UKEY = 'apt.yardmapUi.v1';
  const DBL = 400, LONG = 550;                       // 두 번 누르기 간격 · 길게 누르기 시간 (ms)
  const SIDO = { 서울: '서울특별시', 경기: '경기도', 인천: '인천광역시', 부산: '부산광역시', 대구: '대구광역시', 광주: '광주광역시', 대전: '대전광역시', 울산: '울산광역시',
    경남: '경상남도', 충북: '충청북도', 충남: '충청남도', 전북: '전북특별자치도', 경북: '경상북도', 강원: '강원특별자치도', 세종: '세종특별자치시', 전남: '전라남도', 제주: '제주특별자치도' };
  // 급지 색 (박스 테두리·켜졌을 때 색) — 이미지의 빨강·노랑·초록·파랑·보라
  const TIERS = [{ k: '', name: '색 없음', c: '' }, { k: 'r', name: '빨강', c: '#e5484d' }, { k: 'y', name: '노랑', c: '#f5a524' }, { k: 'g', name: '초록', c: '#30a46c' },
    { k: 'b', name: '파랑', c: '#3e63dd' }, { k: 'p', name: '보라', c: '#8e4ec6' }];
  const GC = { '#c00000': '#d6453d', '#ffc000': '#e0a21a', '#00b050': '#2f9e6b', '#0070c0': '#3b72d9', '#7030a0': '#8453b8' };   // 권역 제목 막대: 채도 낮춘 색
  const tierC = (k) => (TIERS.find(t => t.k === k) || TIERS[0]).c;

  /* ═════════ 처음 구성 (보내 주신 판 그대로 — 행정구역 기준) ═════════ */
  const bid = (sido, sgg) => `${sido}|${sgg}`;
  const B = (s, g, o = {}) => ({ id: bid(SIDO[s], g), sido: SIDO[s], sgg: g, name: o.n || g, t: o.t || '', on: o.on ? 1 : 0, city: o.city || '', pop: o.pop || 0 });
  /** 50만 미만에 새로 넣은 후보 (꺼진 상태로 시작) */
  const EXTRA_SMALL = () => [['제주', '제주시', 48], ['경북', '경산시', 26], ['경북', '경주시', 24], ['경남', '거제시', 23], ['강원', '강릉시', 21], ['충북', '충주시', 21],
    ['제주', '서귀포시', 18], ['충남', '당진시', 17], ['충남', '서산시', 17], ['경북', '안동시', 15]].map(x => B(x[0], x[1], { pop: x[2] }));
  function seed() {
    const seoul = [['강남구', 'r', 1], ['서초구', 'r', 1], ['용산구', 'r', 1], ['송파구', 'r'], ['성동구', 'y'], ['양천구', 'y'], ['광진구', 'y'], ['마포구', 'y'],
      ['종로구', 'g'], ['영등포구', 'g'], ['강동구', 'g'], ['동작구', 'g'], ['중구', 'g'], ['서대문구', 'b'], ['강서구', 'b'], ['동대문구', 'b'], ['은평구', 'b'], ['성북구', 'b'], ['관악구', 'b'],
      ['노원구', 'p'], ['구로구', 'p'], ['중랑구', 'p'], ['금천구', 'p'], ['강북구', 'p'], ['도봉구', 'p']].map(x => B('서울', x[0], { t: x[1], on: x[2] }));
    const gg = [['과천시', 'r', 1], ['성남시 분당구', 'y'], ['성남시 수정구', 'g', 1], ['하남시', 'b'], ['안양시 동안구', 'p'], ['광명시', 'p'], ['성남시 중원구', 'p'], ['화성시 동탄구', 'p'],
      ['구리시', 'p'], ['수원시 영통구', 'p'], ['용인시 수지구', 'p', 1], ['의왕시', 'p'], ['수원시 팔달구'], ['안양시 만안구'],
      ['부천시 원미구'], ['고양시 덕양구'], ['군포시'], ['부천시 소사구'], ['안산시 단원구'], ['수원시 장안구'], ['고양시 일산동구'], ['용인시 기흥구'], ['수원시 권선구'], ['부천시 오정구'],
      ['안산시 상록구'], ['고양시 일산서구'], ['남양주시'], ['시흥시'],
      ['김포시'], ['광주시'], ['의정부시'], ['용인시 처인구'], ['파주시'], ['평택시'], ['오산시'], ['양평군'], ['양주시'], ['이천시'], ['안성시'], ['여주시'], ['포천시'], ['동두천시']]
      .map(x => B('경기', x[0], { t: x[1], on: x[2] }));
    const L = (s, names, on = []) => names.map(n => B(s, n, { on: on.includes(n) }));
    const cb = (s, city, prefix, list, on = []) => list.map(n => B(s, `${prefix} ${n}`, { n, city, on: on.includes(n) }));
    return [
      { id: 'seoul', name: '서울', color: '#c00000', col: 0, pre: '11', pop: 938, boxes: seoul },
      { id: 'gyeonggi', name: '경기', color: '#ffc000', col: 1, pre: '41', pop: 1363, rows: 14, boxes: gg },
      { id: 'incheon', name: '인천', color: '#ffc000', col: 2, pre: '28', pop: 300, boxes: L('인천', ['연수구', '서해구', '부평구', '남동구', '제물포구', '계양구', '미추홀구', '영종구', '검단구', '강화군']) },
      { id: 'busan', name: '부산', color: '#00b050', col: 3, pre: '26', pop: 328, boxes: L('부산', ['수영구', '해운대구', '동래구', '연제구', '남구', '서구', '금정구', '강서구', '동구', '부산진구', '기장군', '북구', '사하구', '영도구', '사상구', '중구']) },
      { id: 'daegu', name: '대구', color: '#00b050', col: 4, pre: '27', pop: 237, boxes: L('대구', ['수성구', '중구', '남구', '서구', '달서구', '동구', '북구', '달성군']) },
      { id: 'daejeon', name: '대전', color: '#00b050', col: 4, pre: '30', pop: 144, boxes: L('대전', ['유성구', '서구', '중구', '동구', '대덕구'], ['유성구']) },
      { id: 'gwangju', name: '광주', color: '#00b050', col: 5, pre: '29', pop: 141, boxes: L('광주', ['동구', '남구', '서구', '광산구', '북구']) },
      { id: 'ulsan', name: '울산', color: '#00b050', col: 5, pre: '31', pop: 110, boxes: L('울산', ['남구', '중구', '북구', '울주군', '동구'], ['남구', '북구']) },
      { id: 'big', name: '50만 이상', color: '#0070c0', col: 6, boxes: [
        ...cb('경남', '창원', '창원시', ['성산구', '의창구', '마산회원구', '마산합포구', '진해구']),
        ...cb('충북', '청주', '청주시', ['흥덕구', '상당구', '청원구', '서원구'], ['흥덕구', '서원구']),
        ...cb('충남', '천안', '천안시', ['서북구', '동남구']),
        ...cb('전북', '전주', '전주시', ['덕진구', '완산구']),
        B('경남', '김해시', { pop: 53 })],
      cities: { 창원: { pop: 100 }, 청주: { pop: 85 }, 천안: { pop: 65 }, 전주: { pop: 64 } } },
      { id: 'small', name: '50만 미만', color: '#7030a0', col: 7, boxes: [
        ...cb('경북', '포항', '포항시', ['남구', '북구']),
        B('경북', '구미시', { pop: 40 }), B('세종', '세종시', { pop: 38 }), B('강원', '원주시', { pop: 36 }), B('경남', '양산시', { pop: 35 }), B('충남', '아산시', { pop: 35 }),
        B('경남', '진주시', { pop: 34 }), B('강원', '춘천시', { pop: 28 }), B('전남', '순천시', { pop: 27 }), B('전남', '여수시', { pop: 27 }), B('전북', '익산시', { pop: 26 }), B('전북', '군산시', { pop: 25 }), ...EXTRA_SMALL()],
      cities: { 포항: { pop: 49 } } },
    ];
  }

  /* ═════════ 상태 ═════════ */
  let st = null, ui = {}, regsAll = [], regs = new Map(), popData = null;
  let inited = false, edit = false;
  const load = () => {
    const s = Store.get(KEY, null);
    if (!(s && Array.isArray(s.groups) && s.groups.length)) return { v: 2, groups: seed() };
    if ((s.v || 1) < 2) {                                   // 예전에 저장한 판에도 새 후보(50만 미만)를 꺼진 상태로 덧붙임
      const g = s.groups.find(x => x.id === 'small');
      if (g) EXTRA_SMALL().forEach(b => { if (!g.boxes.some(x => x.id === b.id)) g.boxes.push(b); });
      s.v = 2; Store.set(KEY, s);
    }
    return s;
  };
  const save = () => Store.set(KEY, st);
  const saveUi = () => Store.set(UKEY, ui);
  const locked = () => { if (typeof Vault !== 'undefined' && Vault.isLocked()) { U.toast('잠금 상태입니다. 오른쪽 위 [잠금]을 풀면 고칠 수 있습니다.'); return true; } return false; };
  const all = () => st.groups.flatMap(g => g.boxes.map(b => ({ b, g })));
  const find = (id) => all().find(x => x.b.id === id);
  const codeOf = (b) => regs.get(bid(b.sido, b.sgg)) || null;
  const isOpen = (g) => (ui.open && ui.open[g.id] != null ? !!ui.open[g.id] : (window.innerWidth > 760 || g.boxes.some(b => b.on)));

  /* ═════════ 인구 (만 명) ═════════ */
  /** 코드가 pre 로 시작하는 지역이 모두 인구 자료에 있을 때만 합계 (모자라면 null → 처음 넣어 둔 값 사용) */
  function popSum(pre) {
    if (!pre || !popData || !popData.byCode) return null;
    const rs = regsAll.filter(r => String(r[0]).startsWith(pre));
    if (!rs.length || !rs.every(r => popData.byCode[r[0]] && popData.byCode[r[0]].pop)) return null;
    return Math.round(rs.reduce((s, r) => s + popData.byCode[r[0]].pop, 0) / 10000);
  }
  const popOf = (o) => popSum(o.pre) ?? (o.pop || null);
  const rawPop = (b) => { const c = codeOf(b); return (c && popData?.byCode?.[c]?.pop) || 0; };
  /** 박스 옆 인구는 처음에 인구를 넣어 둔 박스(50만 미만 도시)만 보여 줌. 자료가 있으면 자료 값 */
  const boxPop = (b) => (b.pop ? (rawPop(b) ? Math.round(rawPop(b) / 10000) : b.pop) : null);
  /** 도시 묶음(창원·청주…)의 인구: 묶인 구의 인구를 더함 (하나라도 자료가 없으면 처음 넣어 둔 값) */
  const cityPop = (g, name) => {
    const bs = g.boxes.filter(x => x.city === name), v = bs.map(rawPop);
    return bs.length && v.every(Boolean) ? Math.round(v.reduce((a, c) => a + c, 0) / 10000) : (g.cities && g.cities[name] ? g.cities[name].pop : null) || null;
  };

  /* ═════════ 화면 ═════════ */
  function boxHtml(b) {
    const c = tierC(b.t), has = !!codeOf(b), p = b.city ? null : boxPop(b);
    return `<button class="ym-b${b.on ? ' on' : ''}${has ? '' : ' nodata'}${edit ? ' ed' : ''}" data-id="${esc(b.id)}" ${c ? `style="--tc:${c}"` : ''} title="${esc(b.sido + ' ' + b.sgg)}${has ? '' : ' — 지역 자료에 없는 곳입니다 (단지가 연결되지 않습니다)'}">` +
      `<span class="ym-n">${esc(b.name)}</span>${p ? `<small class="ym-p">(${p})</small>` : ''}${edit ? '<span class="ym-x" data-del title="이 지역 빼기">✕</span>' : ''}</button>`;
  }
  function boxesHtml(g) {
    const out = [], cities = new Set();
    for (let i = 0; i < g.boxes.length; i++) {
      const b = g.boxes[i];
      if (!b.city) { out.push(boxHtml(b)); continue; }
      if (cities.has(b.city)) continue;
      cities.add(b.city);
      const list = g.boxes.filter(x => x.city === b.city), cp = cityPop(g, b.city);
      out.push(`<div class="ym-city"><div class="ym-cl"><b>${esc(b.city)}</b>${cp ? `<small>(${cp})</small>` : ''}</div><div class="ym-cb">${list.map(boxHtml).join('')}</div></div>`);
    }
    return out.join('');
  }
  function groupHtml(g) {
    const on = g.boxes.filter(b => b.on).length, p = popOf(g), open = isOpen(g);
    return `<section class="ym-grp${open ? ' open' : ''}" data-g="${esc(g.id)}" style="--gc:${GC[g.color] || g.color}">
      <header class="ym-gh" data-gh><span class="ym-gt"><b>${esc(g.name)}</b>${p ? ` <span>(${p.toLocaleString()})</span>` : ''}</span><span class="ym-gc">(${on} / ${g.boxes.length})</span><i class="ym-chev">▾</i></header>
      <div class="ym-gb${g.rows ? ' multi' : ''}" ${g.rows ? `style="--rows:${g.rows}"` : ''}>${boxesHtml(g)}</div></section>`;
  }
  function renderBoard() {
    const cols = [...new Set(st.groups.map(g => g.col))].sort((a, b) => a - b);
    $('ymBoard').innerHTML = cols.map(c => {
      const gs = st.groups.filter(g => g.col === c);
      return `<div class="ym-col${gs.some(g => g.rows) ? ' wide' : ''}">${gs.map(groupHtml).join('')}</div>`;
    }).join('');
    const a = all(), on = a.filter(x => x.b.on).length;
    $('ymSum').textContent = `확보 ${on}곳 / 전체 ${a.length}곳`;
  }
  function render() {
    root.innerHTML = `<section class="panel ym-panel">
      <div class="bar"><strong>🏡 앞마당</strong><span class="hint" style="margin:0" id="ymSum"></span><span class="grow"></span>
        <button id="ymAddBtn">＋ 지역 추가</button><button id="ymEdit" class="${edit ? 'on' : ''}">✎ 편집${edit ? ' 끝내기' : ''}</button><button id="ymReset" title="처음 구성(보내 주신 판)으로 되돌립니다">처음 구성으로</button></div>
      <p class="hint ym-help">${edit ? '편집 중: 박스를 누르면 <b>급지 색</b>이 돌아가며 바뀌고, <b>✕</b> 로 지웁니다.' : '박스를 <b>한 번</b> 누르면 켜짐/꺼짐(색/회색), <b>두 번</b> 누르거나 <b>길게</b> 누르면 그 지역의 랜드마크·시세트래킹 단지를 보여 줍니다.'}</p>
      <div id="ymAdd" class="ym-add" hidden></div>
      <div class="ym-board" id="ymBoard"></div></section>
      <aside id="ymDetail" class="ym-detail" hidden><div class="ym-dh"><b id="ymDt"></b><span class="grow"></span><button class="mini" id="ymDx">✕ 닫기</button></div><div id="ymDb"></div></aside>`;
    renderBoard();
  }

  /* ═════════ 동작 ═════════ */
  let pend = null, press = null, lpFired = false;
  function toggle(id) {
    const x = find(id); if (!x || locked()) return;
    x.b.on = x.b.on ? 0 : 1; save(); renderBoard();
  }
  const flush = () => { if (pend) { clearTimeout(pend.timer); const p = pend; pend = null; toggle(p.id); } };       // 다른 박스를 누르면 앞 박스는 바로 반영
  function cycleTier(id) {
    const x = find(id); if (!x || locked()) return;
    const i = TIERS.findIndex(t => t.k === x.b.t); x.b.t = TIERS[(i + 1) % TIERS.length].k; save(); renderBoard();
  }
  function removeBox(id) {
    const x = find(id); if (!x || locked()) return;
    if (!confirm(`${x.b.name} 을(를) 앞마당 판에서 뺄까요? (단지·시세 기록은 그대로 남습니다)`)) return;
    x.g.boxes = x.g.boxes.filter(b => b.id !== id); save(); renderBoard();
  }

  /** 두 번 누르기: 지역의 랜드마크·시세트래킹 단지 */
  const grade = (k) => (typeof CONFIG !== 'undefined' && CONFIG.GRADES.find(g => g.k === k)) || { k, name: k };
  function priceOf(x) {
    const q = typeof Kit !== 'undefined' ? Kit.quote(x.rec || x) : null, rl = typeof Real !== 'undefined' ? Real.get(x.id) : null;
    return { s: q?.s ?? rl?.sale?.price ?? null, r: q?.r ?? rl?.rent?.price ?? null, real: q?.s == null && !!rl?.sale };
  }
  const eok = (v) => (v == null ? '-' : Kit.eok(v));
  let lastOpen = 0;
  async function openDetail(id) {
    const x = find(id); if (!x) return;
    lastOpen = Date.now();
    const { b } = x, code = codeOf(b), box = $('ymDb');
    $('ymDt').textContent = `${b.name}${b.city ? ` (${b.city})` : ''} · ${x.g.name}`;
    $('ymDetail').hidden = false;
    if (!code) { box.innerHTML = '<p class="hint">이 지역은 아직 지역 자료에 없습니다. (세종 등은 자동 수집에 추가해야 단지가 연결됩니다)</p>'; return; }
    box.innerHTML = '<p class="hint">불러오는 중…</p>';
    const lm = (typeof Land !== 'undefined' ? Land.all() : []).filter(l => l.code === code);
    const tr = (typeof Tracking !== 'undefined' ? Tracking.all() : []).filter(it => it.code === code);
    try { await Real.load([...lm, ...tr].map(v => ({ id: v.id, code: v.code, key: v.key, g: v.g }))); } catch (e) { console.error(e); }
    if ($('ymDetail').hidden || $('ymDt').textContent.indexOf(b.name) !== 0) return;
    const py = (g) => `${g}㎡`;
    const lmRows = lm.map(l => { const p = priceOf(l); return `<tr><td>${esc(grade(l.grade).name || l.grade)}</td><td class="l">${esc(l.name)}</td><td class="l">${esc(l.dong || '')}</td><td>${py(l.g)}</td><td>${eok(p.s)}${p.real ? '<small class="ym-real">실</small>' : ''}</td><td>${eok(p.r)}</td></tr>`; }).join('');
    const trRows = tr.slice().sort((a, c) => (a.dong || '').localeCompare(c.dong || '', 'ko') || (a.name || '').localeCompare(c.name || '', 'ko')).map(it => {
      const rec = typeof Tracking.rec === 'function' ? (Tracking.rec(it.id) || it) : it, p = priceOf({ id: it.id, rec });
      const ld = typeof Land !== 'undefined' && Land.leadOf && p.s ? Land.leadOf({ id: it.id, code: it.code, s: p.s }) : null;
      return `<tr><td class="l">${esc(it.name)}</td><td class="l">${esc(it.dong || '')}</td><td>${py(it.g)}</td><td>${eok(p.s)}${p.real ? '<small class="ym-real">실</small>' : ''}</td><td>${eok(p.r)}</td><td title="${ld ? esc(ld.name) : ''}">${ld ? ld.pct.toFixed(0) + '%' : '-'}</td></tr>`;
    }).join('');
    box.innerHTML = `<div class="ym-sec"><b>★ 랜드마크 ${lm.length}개</b> <button class="mini" data-go="land">랜드마크 탭 ▸</button></div>` +
      (lm.length ? `<div class="tablewrap"><table class="ym-t"><thead><tr><th>등급</th><th class="l">단지</th><th class="l">동</th><th>평형</th><th>매매</th><th>전세</th></tr></thead><tbody>${lmRows}</tbody></table></div>`
        : '<p class="hint">이 지역에 등록한 랜드마크가 없습니다. 랜드마크 탭에서 추가하세요.</p>') +
      `<div class="ym-sec"><b>⭐ 시세트래킹 ${tr.length}개</b> <button class="mini" data-go="tracking">시세트래킹 탭 ▸</button></div>` +
      (tr.length ? `<div class="tablewrap"><table class="ym-t"><thead><tr><th class="l">단지</th><th class="l">동</th><th>평형</th><th>매매</th><th>전세</th><th title="같은 지역 랜드마크 매매가 대비 %">랜드마크 대비</th></tr></thead><tbody>${trRows}</tbody></table></div>`
        : '<p class="hint">이 지역에 담은 시세트래킹 단지가 없습니다.</p>') +
      '<p class="hint">가격은 적어 둔 호가가 먼저, 없으면 최근 실거래(<small class="ym-real">실</small>)입니다.</p>';
  }

  /* ── 지역 추가 ── */
  function addForm() {
    const box = $('ymAdd'); if (!box.hidden) { box.hidden = true; return; }
    const sidos = [...new Set(regsAll.map(r => r[1]))], have = new Set(all().map(x => x.b.id));
    box.innerHTML = `<div class="filters">
      <label>시도 <select id="ymSido">${sidos.map(s => `<option>${esc(s)}</option>`).join('')}</select></label>
      <label>시군구 <select id="ymSgg"></select></label>
      <label>넣을 곳 <select id="ymGrp">${st.groups.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}</select></label>
      <label>급지 색 <select id="ymTier">${TIERS.map(t => `<option value="${t.k}">${t.name}</option>`).join('')}</select></label>
      <label class="inline"><input type="checkbox" id="ymOn" checked> 바로 켜기</label>
      <button id="ymAddOk" class="primary">추가</button><button id="ymAddX">닫기</button></div>`;
    box.hidden = false;
    const fill = () => { $('ymSgg').innerHTML = regsAll.filter(r => r[1] === $('ymSido').value).map(r => `<option value="${esc(r[2])}" ${have.has(bid(r[1], r[2])) ? 'disabled' : ''}>${esc(r[2])}${have.has(bid(r[1], r[2])) ? ' (이미 있음)' : ''}</option>`).join(''); };
    $('ymSido').onchange = fill; fill();
    $('ymAddX').onclick = () => { box.hidden = true; };
    $('ymAddOk').onclick = () => {
      if (locked()) return;
      const sido = $('ymSido').value, sgg = $('ymSgg').value; if (!sgg) return U.toast('시군구를 골라 주세요.');
      if (have.has(bid(sido, sgg))) return U.toast('이미 판에 있는 지역입니다.');
      const g = st.groups.find(x => x.id === $('ymGrp').value) || st.groups[0];
      g.boxes.push({ id: bid(sido, sgg), sido, sgg, name: sgg, t: $('ymTier').value, on: $('ymOn').checked ? 1 : 0, city: '', pop: 0 });
      save(); renderBoard(); box.hidden = true; U.toast(`${sgg} 을(를) ${g.name} 칸에 추가했습니다.`);
    };
  }

  /* ── 연결 ── */
  function wire() {
    root.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('.ym-b'); if (!el || edit) return;
      lpFired = false; clearTimeout(press?.t);
      press = { x: e.clientX, y: e.clientY, t: setTimeout(() => { lpFired = true; press = null; flush(); openDetail(el.dataset.id); try { if (navigator.vibrate) navigator.vibrate(12); } catch (er) { /* 무시 */ } }, LONG) };
    });
    root.addEventListener('pointermove', (e) => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) { clearTimeout(press.t); press = null; } });
    ['pointerup', 'pointercancel'].forEach(t => root.addEventListener(t, () => { if (press) { clearTimeout(press.t); press = null; } }));
    root.addEventListener('contextmenu', (e) => { if (e.target.closest('.ym-b')) e.preventDefault(); });          // 휴대폰에서 길게 눌러도 메뉴가 뜨지 않게
    root.addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest('#ymAddBtn')) return addForm();
      if (t.closest('#ymEdit')) { edit = !edit; flush(); render(); return; }
      if (t.closest('#ymReset')) { if (locked() || !confirm('처음 구성(보내 주신 판)으로 되돌릴까요? 지금 켜 둔 상태와 추가한 지역이 사라집니다.')) return; st = { v: 1, groups: seed() }; save(); render(); return; }
      if (t.closest('#ymDx')) { $('ymDetail').hidden = true; return; }
      const go = t.closest('[data-go]'); if (go) { App.showTab(go.dataset.go); return; }
      const gh = t.closest('[data-gh]');
      if (gh) { const g = st.groups.find(x => x.id === gh.parentElement.dataset.g); if (g) { ui.open = ui.open || {}; ui.open[g.id] = !isOpen(g); saveUi(); gh.parentElement.classList.toggle('open', ui.open[g.id]); } return; }
      const el = t.closest('.ym-b'); if (!el) return;
      const id = el.dataset.id;
      if (lpFired) { lpFired = false; return; }                                       // 길게 눌러 창이 열렸으면 짧은 누름은 무시
      if (edit) { if (t.closest('[data-del]')) removeBox(id); else cycleTier(id); return; }
      const now = Date.now();
      if (pend && pend.id === id && now - pend.t < DBL) { clearTimeout(pend.timer); pend = null; openDetail(id); return; }      // 두 번 누름
      flush();
      pend = { id, t: now, timer: setTimeout(() => { const p = pend; pend = null; if (p) toggle(p.id); }, DBL) };           // 한 번 누름: 두 번째가 안 오면 켜고 끔
    });
    // 브라우저가 알려 주는 '더블클릭'도 인식 — 컴퓨터 설정이 느린 더블클릭이라 위 간격을 넘겨도 단지 창이 열리게 함
    root.addEventListener('dblclick', (e) => {
      const el = e.target.closest('.ym-b'); if (!el || edit || e.target.closest('[data-del]')) return;
      clearTimeout(pend?.timer); pend = null;
      if (Date.now() - lastOpen < 700) return;                                        // 위에서 이미 열었으면 건너뜀
      openDetail(el.dataset.id);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('ymDetail') && !$('ymDetail').hidden) $('ymDetail').hidden = true; });
  }

  async function open() {
    try {                                              // 지역·인구 자료를 먼저 받아 두고 그린다 (처음 그릴 때 "자료 없음"이 깜빡이지 않게)
      const [r, p] = await Promise.all([Data.regions(), Data.json('population.json', null)]);
      regsAll = r || []; regs = new Map(regsAll.map(x => [bid(x[1], x[2]), x[0]])); popData = p;
    } catch (e) { console.error(e); }
    if (!inited) { st = load(); ui = Store.get(UKEY, {}) || {}; inited = true; wire(); render(); }
    else renderBoard();
  }
  const reload = () => { st = load(); if (inited) renderBoard(); };
  return { open, reload };
})();
