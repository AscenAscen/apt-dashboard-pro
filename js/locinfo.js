/* ─────────────────────────────────────────────────────────
   locinfo.js — 입지 정리표 (교통 · 학군 · 환경 · 호재)
   [단지 비교] 와 [입지 분석] 두 탭이 함께 씁니다. ([시세지도]·[임장] 에서도 요약으로 보입니다)
   · 자동: 카카오맵으로 가까운 지하철역·학교·마트·백화점·종합병원·스타벅스·업무지구 거리
   · 자동 값 옆 ✎ 를 누르면 값을 직접 고칠 수 있고, 고친 값은 📌 고정되어 새로 불러와도 덮어쓰지 않습니다. (📌 을 누르면 자동 값으로 복귀)
   · 직접 입력: 대중교통 시간, 배정 학교, 학업성취도, 경사, 호재 등 — 단지별로 브라우저에 저장됩니다.
   · 항목 이름은 눌러서 바꿀 수 있습니다. (예: "강남역 대중교통" → "KTX역까지 소요 시간")
   줄을 추가하거나 빼려면 아래 SECTIONS 를 고치면 됩니다.
   ───────────────────────────────────────────────────────── */
const Loc = (() => {
  const KEY = 'apt.loc.v1';
  const memo = new Map();               // 이번 접속 동안만 기억 (카카오 검색 결과는 저장하지 않음)
  const meters = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + 'km' : Math.round(m) + 'm');
  const walk = (m) => Math.max(1, Math.round(m * 1.3 / 67));      // 직선거리 → 도보 분 (추정: 직선거리 × 1.3 ÷ 분당 67m)
  const idOf = (r) => `${r.code}|${r.key}`;
  const notes = () => Store.get(KEY, {});
  const rowKey = (row) => row.key || row.input || row.select;
  const near = (p) => (p ? `<b>${U.esc(p.name)}</b> ${meters(p.m)} <small>도보 약 ${walk(p.m)}분</small>` : null);

  /* 표에 나오는 줄 정의.  key = 저장·이름 바꾸기용 이름,  auto(a) = 자동 값(HTML),  input = 직접 적는 칸 이름,  select = 고르는 칸,  links = 바로가기 버튼 */
  const SECTIONS = [
    { id: 'traffic', name: '🚇 교통', rows: [
      { key: 'subway', label: '가까운 지하철역', auto: (a) => (a.subway.length ? a.subway.slice(0, 3).map(s => `<b>${U.esc(s.name)}</b> ${meters(s.m)} <small>도보 약 ${walk(s.m)}분</small>`).join('<br>') : '1.5km 안에 없음') },
      { key: 'hubs', label: '업무지구 직선거리', auto: (a) => a.hubs.map(h => `${U.esc(h.name.split(' ')[0])} <b>${h.km.toFixed(1)}km</b>`).join(' · ') },
      { input: 'transit', label: '강남역 대중교통', ph: '예: 35분, 환승 1회' },
      { input: 'trafficMemo', label: '교통 메모', ph: '버스, 도로, 신설 노선 등' },
    ] },
    { id: 'school', name: '🏫 학군', rows: [
      { key: 'elem', label: '가까운 초등학교', auto: (a) => near(a.elem) || '2km 안에서 찾지 못함' },
      { key: 'mid', label: '가까운 중학교', auto: (a) => near(a.mid) || '2km 안에서 찾지 못함' },
      { key: 'academy', label: '학원 (1km 안)', auto: (a) => `${a.counts.AC5}곳` },
      { input: 'achv', label: '중학교 학업성취도 (%)', ph: '예: 95' },
      { key: 'schoolLinks', label: '학업성취도 확인', links: [{ t: '아실', u: 'https://asil.kr/asil/index.jsp' }, { t: '호갱노노', u: 'https://hogangnono.com' }] },
      { input: 'school', label: '배정 학교', ph: '배정 초·중학교' },
      { input: 'schoolMemo', label: '학군 메모', ph: '학원가 등' },
    ] },
    { id: 'env', name: '🌳 환경', rows: [
      { key: 'fac', label: '주변 시설 (1km 안)', auto: (a) => `대형마트 <b>${a.counts.MT1}</b> · 병원 <b>${a.counts.HP8}</b> · 공원 <b>${a.counts.park}</b>` },
      { key: 'mart', label: '가까운 대형마트', auto: (a) => near(a.mart) || '3km 안에서 찾지 못함' },
      { key: 'dept', label: '가까운 백화점', auto: (a) => near(a.dept) || '5km 안에서 찾지 못함' },
      { key: 'hosp', label: '가까운 종합병원', auto: (a) => near(a.hosp) || '5km 안에서 찾지 못함' },
      { key: 'star', label: '가까운 스타벅스', auto: (a) => near(a.star) || '2km 안에 없음' },
      { select: 'slope', label: '경사', options: ['', '평지', '완만', '가파름'] },
      { input: 'envMemo', label: '환경 메모', ph: '상권, 소음, 주차, 혐오시설 등' },
    ] },
    { id: 'hoje', name: '📌 호재', rows: [
      { input: 'hoje', label: '호재', ph: '교통 신설, 재건축, 개발 계획 등' },
    ] },
  ];

  /** 한 단지의 자동 값 구하기 (카카오맵). 실패하면 예외 */
  async function auto(r) {
    const id = idOf(r);
    if (memo.has(id)) return memo.get(id);
    await KMap.load();
    const pos = await KMap.geocode(r);
    if (!pos) throw new Error('단지 위치를 찾지 못했습니다.');
    const [sw, ac, mt, hp, park, el, mi, mart, dept, star, gen, hubs] = await Promise.all([
      KMap.category('SW8', pos, 1500), KMap.category('AC5', pos, 1000), KMap.category('MT1', pos, 1000), KMap.category('HP8', pos, 1000),
      KMap.keywordCount('공원', pos, 1000), KMap.keyword('초등학교', pos, 2000), KMap.keyword('중학교', pos, 2000),
      KMap.category('MT1', pos, 3000), KMap.keyword('백화점', pos, 5000), KMap.keyword('스타벅스', pos, 2000), KMap.keyword('종합병원', pos, 5000),
      Settings.hubs(),
    ]);
    const dist = (p) => +p.distance || KMap.km(pos, { lat: +p.y, lng: +p.x }) * 1000;
    const pick = (list, ok) => { const p = list.find(x => ok(x)); return p ? { name: p.place_name, m: dist(p), lat: +p.y, lng: +p.x } : null; };
    const out = {
      pos,
      subway: sw.list.map(p => ({ name: p.place_name, m: +p.distance, lat: +p.y, lng: +p.x })),
      elem: pick(el, p => /초등학교$/.test(p.place_name)), mid: pick(mi, p => /중학교$/.test(p.place_name)),
      mart: pick(mart.list, () => true),
      dept: pick(dept, p => /백화점/.test(p.category_name || '') && !/주차|입구|정류장|셔틀|택시/.test(p.place_name)),
      star: pick(star, p => /^스타벅스/.test(p.place_name) && !/주차/.test(p.place_name)),
      hosp: pick(gen, p => /종합병원/.test(p.category_name || '') || (/(병원|의료원)$/.test(p.place_name) && !/의원|치과|한의원|요양|동물|정신/.test(p.place_name))),
      counts: { AC5: ac.count, MT1: mt.count, HP8: hp.count, park },
      hubs: hubs.map(h => ({ ...h, km: KMap.km(pos, h) })),
    };
    memo.set(id, out);
    return out;
  }

  const plain = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent.replace(/\s+/g, ' ').trim(); };

  /** 입지 정리표 HTML.  cols = [{ r, title, cls, auto(없으면 자동 칸은 안내문) }],  on = 보여 줄 구역 id 목록 */
  function html(cols, on) {
    const saved = notes(), labels = saved._labels || {};
    const head = `<thead><tr><th class="l">항목</th>${cols.map(c => `<th class="${c.cls || ''}">${U.esc(c.title)}</th>`).join('')}</tr></thead>`;
    let body = '';
    for (const sec of SECTIONS) {
      if (on && !on.includes(sec.id)) continue;
      body += `<tr class="group"><td class="l" colspan="${cols.length + 1}">${sec.name}</td></tr>`;
      for (const row of sec.rows) {
        const k = rowKey(row);
        body += `<tr><td class="l"><span class="rowlab" data-lab="${k}" title="눌러서 항목 이름 바꾸기">${U.esc(labels[k] || row.label)}</span>${row.auto || row.links ? '' : ' <small>직접 입력</small>'}</td>` + cols.map(c => {
          const id = idOf(c.r), mine = saved[id] || {};
          if (row.links) return `<td class="linkrow">${row.links.map(l => `<a class="btn mini" target="_blank" rel="noopener" href="${l.u}">${l.t}</a>`).join('')}</td>`;
          if (row.auto) {
            const autoH = c.auto ? row.auto(c.auto) : `<small>${c.why || '카카오맵 연결 후 표시'}</small>`, ov = mine['ov_' + k];
            if (ov != null && ov !== '') return `<td class="ovc"><div class="ovbox"><input class="locin" data-loc="${U.esc(id)}" data-f="ov_${k}" value="${U.esc(ov)}">` +
              `<button class="pin" data-unpin="${k}" data-loc="${U.esc(id)}" title="📌 직접 고친 값입니다. 누르면 자동 값으로 되돌립니다">📌</button></div><small class="autoval">자동: ${autoH}</small></td>`;
            return `<td class="ovc">${autoH} <button class="pin off" data-edit="${k}" data-loc="${U.esc(id)}" title="값을 직접 고치고 📌 고정합니다">✎</button></td>`;
          }
          const v = mine[row.input || row.select] || '';
          if (row.select) return `<td><select data-loc="${U.esc(id)}" data-f="${row.select}">${row.options.map(o => `<option ${o === v ? 'selected' : ''} value="${o}">${o || '선택'}</option>`).join('')}</select></td>`;
          return `<td><input class="locin" data-loc="${U.esc(id)}" data-f="${row.input}" value="${U.esc(v)}" placeholder="${row.ph || ''}"></td>`;
        }).join('') + '</tr>';
      }
    }
    return head + `<tbody>${body}</tbody>`;
  }

  /** 표 안의 입력·버튼을 저장하도록 연결 */
  function bind(table) {
    const redraw = () => { const x = table._ctx; if (x) { table.innerHTML = html(x.cols, x.on); } };
    table.onchange = (e) => {
      const t = e.target;
      if (!t.dataset.loc) return;
      const all = notes(), mine = (all[t.dataset.loc] = all[t.dataset.loc] || {});
      if (t.dataset.f.startsWith('ov_') && !t.value.trim()) { delete mine[t.dataset.f]; Store.set(KEY, all); redraw(); return; }     // 비우면 📌 해제
      mine[t.dataset.f] = t.value.trim();
      Store.set(KEY, all);
    };
    table.onclick = (e) => {
      const t = e.target.closest('[data-edit],[data-unpin],[data-lab]');
      if (!t) return;
      const all = notes();
      if (t.dataset.lab) {                                               // 항목 이름 바꾸기
        const k = t.dataset.lab, row = SECTIONS.flatMap(s => s.rows).find(r => rowKey(r) === k);
        const cur = (all._labels || {})[k] || row.label;
        const v = prompt(`항목 이름을 바꿉니다. (비우면 "${row.label}" 로 되돌아갑니다)`, cur);
        if (v == null) return;
        const lb = (all._labels = all._labels || {});
        if (v.trim() && v.trim() !== row.label) lb[k] = v.trim(); else delete lb[k];
        Store.set(KEY, all); redraw(); bind(table); return;
      }
      const id = t.dataset.loc, mine = (all[id] = all[id] || {});
      if (t.dataset.unpin) { delete mine['ov_' + t.dataset.unpin]; Store.set(KEY, all); redraw(); bind(table); U.toast('자동 값으로 되돌렸습니다.'); return; }
      const k = t.dataset.edit, col = (table._ctx?.cols || []).find(c => idOf(c.r) === id), row = SECTIONS.flatMap(s => s.rows).find(r => rowKey(r) === k);
      const text = col && col.auto && row ? plain(row.auto(col.auto)) : '';
      mine['ov_' + k] = text || '-';
      Store.set(KEY, all); redraw(); bind(table);
      const inp = table.querySelector(`input[data-loc="${CSS.escape(id)}"][data-f="ov_${k}"]`); if (inp) { inp.focus(); inp.select(); }
    };
  }

  /** 표 그리기: 먼저 직접 입력 칸을 보여 주고, 자동 값은 구해지는 대로 채움 */
  async function fill(table, cols, on) {
    const seq = (table._seq = (table._seq || 0) + 1);
    const usable = KMap.ready();
    cols.forEach(c => { c.auto = null; c.why = usable ? '불러오는 중…' : '카카오 키를 넣으면 표시'; });
    table._ctx = { cols, on };
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

  /** 한 단지의 입지 메모 요약 (직접 입력 + 직접 고친 값). r = { code, key }.  [시세지도]·[임장] 에서 읽기용으로 보여 줌 */
  function summary(r) {
    const all = notes(), n = all[idOf(r)] || {}, L = all._labels || {};
    const defs = SECTIONS.flatMap(s => s.rows).filter(x => !x.links);
    const parts = [];
    for (const row of defs) {
      const k = rowKey(row), v = row.auto ? n['ov_' + k] : n[k];
      if (v && v !== '-') parts.push(`<b>${U.esc(L[k] || row.label)}</b> ${U.esc(v)}${k === 'achv' && !/%/.test(v) ? '%' : ''}`);
    }
    return parts.length ? `<div class="locsum"><b style="color:var(--text)">입지 메모</b> &nbsp;${parts.join(' &nbsp;·&nbsp; ')}</div>`
      : '<div class="locsum"><small>입지 메모가 없습니다. [단지 비교]·[입지 분석] 탭의 "입지 비교" 표에 적으면 여기에도 보입니다.</small></div>';
  }

  return { SECTIONS, auto, fill, meters, walk, summary };
})();
