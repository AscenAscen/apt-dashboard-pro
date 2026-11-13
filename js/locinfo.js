/* ─────────────────────────────────────────────────────────
   locinfo.js — 입지 정리표 (교통 · 학군 · 환경 · 호재)
   [단지 비교] 와 [입지 분석] 두 탭이 함께 씁니다.
   · 자동: 카카오맵으로 가까운 지하철역·학교·주변 시설·업무지구 거리
   · 직접 입력: 대중교통 시간, 배정 학교, 경사, 호재 등 — 단지별로 브라우저에 저장되어 두 탭에서 같이 보입니다.
   줄을 추가하거나 빼려면 아래 SECTIONS 를 고치면 됩니다.
   ───────────────────────────────────────────────────────── */
const Loc = (() => {
  const KEY = 'apt.loc.v1';
  const memo = new Map();               // 이번 접속 동안만 기억 (카카오 검색 결과는 저장하지 않음)
  const meters = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + 'km' : Math.round(m) + 'm');
  const walk = (m) => Math.max(1, Math.round(m * 1.3 / 67));      // 직선거리 → 도보 분 (추정)
  const idOf = (r) => `${r.code}|${r.key}`;
  const notes = () => Store.get(KEY, {});

  /* 표에 나오는 줄 정의.  auto(a) = 자동 값(HTML),  input = 직접 적는 칸 이름,  select = 고르는 칸 */
  const SECTIONS = [
    { id: 'traffic', name: '🚇 교통', rows: [
      { label: '가까운 지하철역', auto: (a) => (a.subway.length ? a.subway.slice(0, 3).map(s => `<b>${U.esc(s.name)}</b> ${meters(s.m)} <small>도보 약 ${walk(s.m)}분</small>`).join('<br>') : '1.5km 안에 없음') },
      { label: '업무지구 직선거리', auto: (a) => a.hubs.map(h => `${U.esc(h.name.split(' ')[0])} <b>${h.km.toFixed(1)}km</b>`).join(' · ') },
      { label: '강남역 대중교통', input: 'transit', ph: '예: 35분, 환승 1회' },
      { label: '교통 메모', input: 'trafficMemo', ph: '버스, 도로, 신설 노선 등' },
    ] },
    { id: 'school', name: '🏫 학군', rows: [
      { label: '가까운 초등학교', auto: (a) => (a.elem ? `<b>${U.esc(a.elem.name)}</b> ${meters(a.elem.m)} <small>도보 약 ${walk(a.elem.m)}분</small>` : '2km 안에서 찾지 못함') },
      { label: '가까운 중학교', auto: (a) => (a.mid ? `<b>${U.esc(a.mid.name)}</b> ${meters(a.mid.m)} <small>도보 약 ${walk(a.mid.m)}분</small>` : '2km 안에서 찾지 못함') },
      { label: '학원 (1km 안)', auto: (a) => `${a.counts.AC5}곳` },
      { label: '배정 학교', input: 'school', ph: '배정 초·중학교' },
      { label: '학군 메모', input: 'schoolMemo', ph: '학업성취도, 학원가 등' },
    ] },
    { id: 'env', name: '🌳 환경', rows: [
      { label: '주변 시설 (1km 안)', auto: (a) => `대형마트 <b>${a.counts.MT1}</b> · 병원 <b>${a.counts.HP8}</b> · 공원 <b>${a.counts.park}</b>` },
      { label: '경사', select: 'slope', options: ['', '평지', '완만', '가파름'] },
      { label: '환경 메모', input: 'envMemo', ph: '상권, 소음, 주차, 혐오시설 등' },
    ] },
    { id: 'hoje', name: '📌 호재', rows: [
      { label: '호재', input: 'hoje', ph: '교통 신설, 재건축, 개발 계획 등' },
    ] },
  ];

  /** 한 단지의 자동 값 구하기 (카카오맵). 실패하면 예외 */
  async function auto(r) {
    const id = idOf(r);
    if (memo.has(id)) return memo.get(id);
    await KMap.load();
    const pos = await KMap.geocode(r);
    if (!pos) throw new Error('단지 위치를 찾지 못했습니다.');
    const [sw, ac, mt, hp, park, el, mi] = await Promise.all([
      KMap.category('SW8', pos, 1500), KMap.category('AC5', pos, 1000), KMap.category('MT1', pos, 1000), KMap.category('HP8', pos, 1000),
      KMap.keywordCount('공원', pos, 1000), KMap.keyword('초등학교', pos, 2000), KMap.keyword('중학교', pos, 2000),
    ]);
    const pick = (list, re) => { const p = list.find(x => re.test(x.place_name)); return p ? { name: p.place_name, m: +p.distance || KMap.km(pos, { lat: +p.y, lng: +p.x }) * 1000, lat: +p.y, lng: +p.x } : null; };
    const out = {
      pos,
      subway: sw.list.map(p => ({ name: p.place_name, m: +p.distance, lat: +p.y, lng: +p.x })),
      elem: pick(el, /초등학교$/), mid: pick(mi, /중학교$/),
      counts: { AC5: ac.count, MT1: mt.count, HP8: hp.count, park },
      hubs: CONFIG.HUBS.map(h => ({ ...h, km: KMap.km(pos, h) })),
    };
    memo.set(id, out);
    return out;
  }

  /** 입지 정리표 HTML.  cols = [{ r, title, cls, auto(없으면 자동 칸은 안내문) }],  on = 보여 줄 구역 id 목록 */
  function html(cols, on) {
    const saved = notes();
    const head = `<thead><tr><th class="l">항목</th>${cols.map(c => `<th class="${c.cls || ''}">${U.esc(c.title)}</th>`).join('')}</tr></thead>`;
    let body = '';
    for (const sec of SECTIONS) {
      if (on && !on.includes(sec.id)) continue;
      body += `<tr class="group"><td class="l" colspan="${cols.length + 1}">${sec.name}</td></tr>`;
      for (const row of sec.rows) {
        body += `<tr><td class="l">${row.label}${row.auto ? '' : ' <small>직접 입력</small>'}</td>` + cols.map(c => {
          const id = idOf(c.r), v = (saved[id] || {})[row.input || row.select] || '';
          if (row.auto) return `<td>${c.auto ? row.auto(c.auto) : `<small>${c.why || '카카오맵 연결 후 표시'}</small>`}</td>`;
          if (row.select) return `<td><select data-loc="${U.esc(id)}" data-f="${row.select}">${row.options.map(o => `<option ${o === v ? 'selected' : ''} value="${o}">${o || '선택'}</option>`).join('')}</select></td>`;
          return `<td><input class="locin" data-loc="${U.esc(id)}" data-f="${row.input}" value="${U.esc(v)}" placeholder="${row.ph || ''}"></td>`;
        }).join('') + '</tr>';
      }
    }
    return head + `<tbody>${body}</tbody>`;
  }

  /** 표 안의 입력을 저장하도록 연결 */
  function bind(table) {
    table.onchange = (e) => {
      const t = e.target;
      if (!t.dataset.loc) return;
      const all = notes();
      (all[t.dataset.loc] = all[t.dataset.loc] || {})[t.dataset.f] = t.value.trim();
      Store.set(KEY, all);
    };
  }

  /** 표 그리기: 먼저 직접 입력 칸을 보여 주고, 자동 값은 구해지는 대로 채움 */
  async function fill(table, cols, on) {
    const seq = (table._seq = (table._seq || 0) + 1);
    const usable = KMap.ready();
    cols.forEach(c => { c.auto = null; c.why = usable ? '불러오는 중…' : '카카오 키를 넣으면 표시'; });
    table.innerHTML = html(cols, on); bind(table);
    if (!usable) return cols;
    await Promise.all(cols.map(async c => { try { c.auto = await auto(c.r); } catch (e) { c.why = U.esc(e.message || '불러오지 못했습니다'); } }));
    if (table._seq !== seq) return cols;
    const focus = document.activeElement;                 // 입력 중이면 그 칸만은 건드리지 않도록 값 보존
    const typing = table.contains(focus) && focus.dataset.loc ? [focus.dataset.loc, focus.dataset.f, focus.value] : null;
    table.innerHTML = html(cols, on); bind(table);
    if (typing) { const el = table.querySelector(`[data-loc="${CSS.escape(typing[0])}"][data-f="${typing[1]}"]`); if (el) { el.value = typing[2]; el.focus(); } }
    return cols;
  }

  return { SECTIONS, auto, fill, meters, walk };
})();
