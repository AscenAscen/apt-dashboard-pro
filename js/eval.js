/* ─────────────────────────────────────────────────────────
   eval.js — [비교 평가] 탭 (수도권 · 지방 이원화)
   · 단지 4개까지 열로 놓고, 항목을 행으로 비교합니다.
   · 기준 자동 선택: 모두 수도권(서울·경기·인천)이면 수도권 비교, 모두 지방이면 지방 비교. (섞이면 버튼으로 고름)
     - 수도권: 3대 업무지구 직선거리, 강남역 대중교통(추정), 학군(초·중 도보), 환경(백화점·마트·병원·스타벅스)
     - 지방: 강남역 대신 도심 기준점(검색어) 거리, 인구·생활권 순위·단지 순위, 연식·세대수·구/군 입주 물량, 전고점·현재가
   · 자동 값은 ✎ 로 고치면 📌 고정됩니다. 직접 입력 칸은 바로 고칠 수 있고, 항목 이름 변경·항목 추가·단지 빼기 가능.
   · 저장: 입지 값은 [apt.loc.v1](단지 비교·입지 분석과 공유), 현재가는 [apt.cmpPrice.v1](단지 비교와 공유), 표 구성은 [apt.eval.v1].
   ───────────────────────────────────────────────────────── */
const Eval = (() => {
  const $ = (id) => document.getElementById(id);
  const KEY = 'apt.eval.v1', LOC = 'apt.loc.v1', PKEY = 'apt.cmpPrice.v1';
  const MAX = 4, NAMES = ['A', 'B', 'C', 'D'], CLS = ['sale', 'rent', 'c3', 'c4'];
  const RULE = { dept: 5000, mart: 3000, hosp: 5000, star: 2000 };      // "주변에 있음"으로 보는 거리(m)
  const CAP = /^(서울|경기|인천)/;
  const idOf = (c) => `${c.code}|${c.key}`;                              // 입지 메모 번호 (단지 비교와 같음)
  const cid = (c) => `${c.code}|${c.key}#${c.g}`;                        // 가격 번호 (단지 비교와 같음)
  const state = () => Store.get(KEY, { list: [], mode: 'auto', custom: [], labels: {} });
  const save = (s) => Store.set(KEY, s);
  const notes = () => Store.get(LOC, {});
  const setNote = (id, k, v) => {
    const a = Store.get(LOC, {}); a[id] = a[id] || {};
    if (v === null || v === '' || v === undefined) delete a[id][k]; else a[id][k] = v;
    if (!Object.keys(a[id]).length) delete a[id];
    Store.set(LOC, a);
  };
  const esc = U.esc;
  const plain = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent.replace(/\s+/g, ' ').trim(); };
  const near = (p) => (p ? `<b>${esc(p.name)}</b> ${Loc.meters(p.m)} <small>도보 약 ${Loc.walk(p.m)}분</small>` : null);
  /** 직선거리 → 대중교통 시간 추정 (시속 20km, 환승·대기 5분 가정). 실제 길찾기 값이 아니므로 직접 고칠 수 있게 둠 */
  const transitEst = (km) => Math.round(km * 1.4 / 20 * 60 + 5);

  /* ── 항목 정의 ──
     scope: 'metro' | 'local' | 'both'.  kind: auto(자동·✎ 고치기) | check(자동 + 있음/없음) | input(직접) | est(직접 입력, 비면 추정 표시) | links | price(현재가) */
  const ROWS = [
    { group: '📍 위치' },
    { k: 'hub', kind: 'auto', scope: 'metro', label: '3대 업무지구 직선거리', auto: (a) => a.loc.hubs.map(h => `${esc(h.name.split(' ')[0])} <b>${h.km.toFixed(1)}km</b>`).join(' · ') },
    { k: 'anchor', kind: 'input', scope: 'local', label: '도심 기준점 (검색어)', ph: '예: 부산 서면역, 천안 터미널' },
    { k: 'anchorKm', kind: 'auto', scope: 'local', label: '기준점까지 직선거리', auto: (a) => (a.anchorKm == null ? '<small>기준점 검색어를 적으면 계산</small>' : `<b>${a.anchorKm.toFixed(1)}km</b> <small>${esc(a.anchorName)}</small>`) },
    { group: '🚇 교통' },
    { k: 'transit', kind: 'est', scope: 'both', label: null, est: (a, t) => transitEst(t.km), ph: '예: 35분, 환승 1회' },
    { group: '🏫 학군' },
    { k: 'elem', kind: 'auto', scope: 'both', label: '초등학교 (도보 거리)', auto: (a) => near(a.loc.elem) || '2km 안에서 찾지 못함' },
    { k: 'mid', kind: 'auto', scope: 'both', label: '중학교 (도보 거리)', auto: (a) => near(a.loc.mid) || '2km 안에서 찾지 못함' },
    { k: 'achv', kind: 'input', scope: 'both', label: '중학교 학업성취도 (%)', ph: '예: 95' },
    { k: 'achvLinks', kind: 'links', scope: 'both', label: '학업성취도 확인' },
    { group: '🌳 환경' },
    { k: 'dept', kind: 'check', scope: 'both', label: '백화점', auto: (a) => near(a.loc.dept) || '5km 안에 없음' },
    { k: 'mart', kind: 'check', scope: 'both', label: '대형마트', auto: (a) => near(a.loc.mart) || '3km 안에 없음' },
    { k: 'hosp', kind: 'check', scope: 'both', label: '병원 (종합병원)', auto: (a) => near(a.loc.hosp) || '5km 안에 없음' },
    { k: 'star', kind: 'check', scope: 'both', label: '스타벅스', auto: (a) => near(a.loc.star) || '2km 안에 없음' },
    { group: '🏘 단지 · 인구 · 물량', scope: 'local' },
    { k: 'pop', kind: 'input', scope: 'local', label: '인구 (시·광역시 규모, 명)', ph: '예: 1050000' },
    { k: 'rankArea', kind: 'input', scope: 'local', label: '해당 생활권 순위', ph: '직접 입력' },
    { k: 'rankApt', kind: 'input', scope: 'local', label: '단지 순위', ph: '직접 입력' },
    { k: 'buildYear', kind: 'auto', scope: 'local', label: '연식', auto: (a) => (a.buildYear ? `${a.buildYear}년` : '-') },
    { k: 'hh', kind: 'auto', scope: 'local', label: '세대수', auto: (a) => (a.hh ? a.hh.toLocaleString() + '세대' : '-') },
    { k: 'supply', kind: 'input', scope: 'local', label: '소속 구/군 최근 입주 물량 (세대)', ph: '직접 입력 (공공 입주 자료 연결 전)' },
    { group: '💰 가격', scope: 'local' },
    { k: 'peak', kind: 'auto', scope: 'local', label: '전고점 (2020년~ 실거래 최고가)', auto: (a) => (a.peak ? `${U.price(a.peak.price)} <small>${U.date(a.peak.d)}</small>` : '-') },
    { k: 'cur', kind: 'price', scope: 'local', label: '현재가격 (직접 입력, 억)' },
    { k: 'drop', kind: 'auto', scope: 'local', label: '현재가 기준 전고점 대비', auto: (a, _t, cur) => (a.peak && cur ? `<b class="${U.cls(((cur / a.peak.price) - 1) * 100)}">${U.pct((cur / a.peak.price - 1) * 100)}</b>` : '<small>현재가를 적으면 계산</small>') },
  ];
  const LABEL = { transit: { metro: '강남역까지 대중교통 (추정 → 직접 고침)', local: '도심 기준점까지 대중교통 (추정 → 직접 고침)' } };

  /* ── 단지 한 칸의 자동 값 (카카오맵·실거래) ── */
  const cache = new Map();
  function autoOf(c) {
    const note = notes()[idOf(c)] || {};
    const k = cid(c) + '|' + (note.anchor || '');
    if (cache.has(k)) return cache.get(k);
    const p = (async () => {
      const loc = await Loc.auto(c);                                       // 지하철·학교·마트·병원·스타벅스 거리, 업무지구 거리
      const [idx, kp, tr] = await Promise.all([Data.index(c.code), Data.kapt(c.code), Data.complexTrades(c.code, c.key, c.g, 2020, new Date().getFullYear())]);
      const peak = Data.stats(tr.sale, tr.rent, true).peak;
      let anchorKm = null, anchorName = '';
      if (note.anchor) {
        const hit = (await KMap.keyword(note.anchor, loc.pos, 30000))[0];
        if (hit) { anchorKm = KMap.km(loc.pos, { lat: +hit.y, lng: +hit.x }); anchorName = hit.place_name; }
      }
      return { loc, peak, buildYear: idx.c[c.key] || null, hh: kp.m[c.key]?.[0] || null, anchorKm, anchorName };
    })();
    cache.set(k, p);
    p.catch(() => cache.delete(k));
    return p;
  }

  /** 수도권/지방 기준 정하기 */
  function modeOf(s) {
    if (s.mode !== 'auto') return s.mode;
    if (!s.list.length) return 'metro';
    const flags = s.list.map(c => CAP.test(c.sido));
    return flags.every(Boolean) ? 'metro' : flags.every(x => !x) ? 'local' : 'metro';
  }

  /* ── 그리기 ── */
  let seq = 0;
  async function draw() {
    const my = ++seq, s = state(), mode = modeOf(s), cols = s.list;
    document.querySelectorAll('#evMode button').forEach(b => b.classList.toggle('on', b.dataset.m === s.mode));
    const flags = cols.map(c => CAP.test(c.sido));
    $('evModeNote').textContent = !cols.length ? '' : (s.mode === 'auto' && flags.length > 1 && flags.some(x => x) && flags.some(x => !x))
      ? '수도권과 지방이 섞였습니다. 기준을 버튼으로 골라 보세요. (지금은 수도권 기준)'
      : mode === 'metro' ? '수도권 비교 기준 (강남역·3대 업무지구 거리 중심)' : '지방 비교 기준 (도심 기준점·인구·순위·입주 물량 중심)';
    $('evEmpty').hidden = cols.length > 0;
    $('evTable').hidden = !cols.length;
    if (!cols.length) { $('evTable').innerHTML = ''; return; }

    const ready = KMap.ready();
    const autos = await Promise.all(cols.map(c => (ready ? autoOf(c).catch(() => null) : Promise.resolve(null))));
    const areas = await Promise.all(cols.map(c => Finder.areas(c.code, c.key).catch(() => ({ html: '' }))));
    if (my !== seq) return;

    const rows = [...ROWS, ...s.custom.map(c => ({ k: c.k, kind: 'input', scope: c.scope, label: c.label, ph: '' }))]
      .filter(r => r.group ? (!r.scope || r.scope === mode) : (r.scope === 'both' || r.scope === mode || r.scope === undefined));

    const label = (r) => s.labels[r.k] || (LABEL[r.k] ? LABEL[r.k][mode] : r.label) || r.label;
    const head = `<thead><tr><th class="l">항목</th>${cols.map((c, i) => `<th class="${CLS[i]}">${NAMES[i]} · ${esc(c.name)}
      <div class="evhead"><select data-area="${i}">${(areas[i].list || []).map(a => `<option value="${a.g}" ${a.g === c.g ? 'selected' : ''}>${a.g}㎡ · ${a.n}건</option>`).join('') || `<option value="${c.g}">${c.g}㎡</option>`}</select>
      <button class="mini danger" data-rm="${i}" title="이 단지 빼기">✕</button></div>
      <small>${esc(c.sgg)} ${esc(c.dong)}</small></th>`).join('')}</tr></thead>`;

    let body = '';
    for (const r of rows) {
      if (r.group) { body += `<tr class="group"><td class="l" colspan="${cols.length + 1}">${r.group}</td></tr>`; continue; }
      const custom = s.custom.some(c => c.k === r.k);
      body += `<tr><td class="l"><span class="rowlab" data-lab="${r.k}" title="눌러서 항목 이름 바꾸기">${esc(label(r))}</span>${custom ? ` <button class="mini danger" data-custom-rm="${r.k}" title="이 항목 빼기">✕</button>` : ''}</td>` +
        cols.map((c, i) => `<td>${cell(r, c, autos[i], mode)}</td>`).join('') + '</tr>';
    }
    $('evTable').innerHTML = head + `<tbody>${body}</tbody>`;
    $('evTable').className = 'cmp loc ev';
  }

  /** 칸 하나의 내용 */
  function cell(r, c, a, mode) {
    const id = idOf(c), n = notes()[id] || {};
    if (r.kind === 'links') return ['아실', '호갱노노'].map((t, i) => `<a class="btn mini" target="_blank" rel="noopener" href="${i ? 'https://hogangnono.com' : 'https://asil.kr/asil/index.jsp'}">${t}</a>`).join(' ');
    if (r.kind === 'input') return `<input class="locin" data-loc="${esc(id)}" data-f="${r.k}" value="${esc(n[r.k] || '')}" placeholder="${esc(r.ph || '')}">`;
    if (r.kind === 'price') {
      const p = Store.get(PKEY, {})[cid(c)]?.p;
      return `<input class="locin num" inputmode="decimal" data-cur="${esc(cid(c))}" value="${p == null ? '' : +(p / 10000).toFixed(4)}" placeholder="예: 15.3">`;
    }
    if (!a) return '<small>카카오 연결 후 표시</small>';
    if (r.kind === 'est') {
      const gang = a.loc.hubs.find(h => h.name.includes('강남')) || a.loc.hubs[0];
      const km = mode === 'metro' ? (gang ? gang.km : null) : a.anchorKm;
      const est = km == null ? null : r.est(a, { km });
      const v = n[r.k] || '';
      return `<input class="locin" data-loc="${esc(id)}" data-f="${r.k}" value="${esc(v)}" placeholder="${est != null ? '추정 ' + est + '분' : esc(r.ph)}">` +
        (v === '' && est != null ? ` <small>추정 ${est}분</small>` : '');
    }
    const ov = n['ov_' + r.k];
    const cur = Store.get(PKEY, {})[cid(c)]?.p;          // 만원
    const auto =r.kind === 'check' ? ((a.loc[r.k] && a.loc[r.k].m <= RULE[r.k]) ? '<span class="up">✓ 있음</span> ' : '<span class="down">✗ 반경 밖</span> ') + r.auto(a) : r.auto(a, c, cur ?? null);
    const autoText = plain(auto);
    if (ov) return `<div class="ovbox"><input class="locin" data-loc="${esc(id)}" data-f="ov_${r.k}" value="${esc(ov)}"><button class="pin" data-unpin="${r.k}" data-loc="${esc(id)}" title="📌 직접 고친 값입니다. 누르면 자동 값으로 되돌립니다">📌</button></div><small class="autoval">자동: ${auto}</small>`;
    return `${auto} <button class="pin off" data-edit="${r.k}" data-loc="${esc(id)}" data-auto="${esc(autoText)}" title="값을 직접 고치고 📌 고정합니다">✎</button>`;
  }

  /* ── 단지 넣기 ── */
  async function addCol(x) {
    const s = state();
    if (s.list.length >= MAX) return U.toast(`비교는 ${MAX}개까지입니다. 한 칸을 빼고 넣으세요.`);
    const ar = await Finder.areas(x.code, x.key);
    const g = ar.best ?? ar.list[0]?.g ?? 84;
    if (s.list.some(c => cid(c) === `${x.code}|${x.key}#${g}`)) return U.toast('이미 넣은 단지입니다.');
    s.list.push({ code: x.code, key: x.key, g, name: x.name, dong: x.dong, jibun: x.jibun, sido: x.sido, sgg: x.sgg });
    save(s); draw();
  }

  function init() {
    // 기준 버튼
    $('evMode').onclick = (e) => { const m = e.target.dataset.m; if (!m) return; const s = state(); s.mode = m; save(s); draw(); };
    // 전국 검색
    Finder.attach($('evNat'), (x) => { addCol(x); $('evNat').value = ''; });
    // 항목 추가
    $('evAddRow').onclick = () => {
      const label = (prompt('추가할 항목 이름 (예: 학원가 거리, 재건축 연한)') || '').trim();
      if (!label) return;
      const s = state();
      const k = 'x' + Date.now().toString(36);
      s.custom.push({ k, label, scope: $('evAddScope').value });
      save(s); draw();
    };
    $('evReset').onclick = () => {
      if (!confirm('비교 표에서 단지를 모두 빼고 직접 추가한 항목도 지울까요?\n(단지별로 적어 둔 입지 값은 지우지 않습니다)')) return;
      const s = state(); s.list = []; s.custom = []; s.labels = {}; save(s); draw();
    };
    // 표 안의 입력 저장
    $('evTable').onchange = (e) => {
      const t = e.target;
      if (t.dataset.cur) {
        const all = Store.get(PKEY, {}), v = parseFloat(String(t.value).replace(/,/g, ''));
        if (isNaN(v) || v <= 0) delete all[t.dataset.cur]; else all[t.dataset.cur] = { p: Math.round(v * 10000) };
        Store.set(PKEY, all); return draw();
      }
      if (t.dataset.area != null) {
        const i = +t.dataset.area, s = state(), c = s.list[i];
        const g = +t.value;
        if (s.list.some((x, j) => j !== i && x.code === c.code && x.key === c.key && x.g === g)) { U.toast('같은 단지의 같은 평형이 이미 있습니다.'); return draw(); }
        c.g = g; save(s); return draw();
      }
      if (!t.dataset.loc) return;
      const f = t.dataset.f;
      if (f.startsWith('ov_') && !t.value.trim()) setNote(t.dataset.loc, f, null);
      else setNote(t.dataset.loc, f, t.value.trim());
      draw();
    };
    // 자동 값 고치기 · 📌 · 이름 바꾸기 · 단지 빼기
    $('evTable').onclick = (e) => {
      const t = e.target.closest('[data-edit],[data-unpin],[data-lab],[data-rm],[data-custom-rm]');
      if (!t) return;
      const s = state();
      if (t.dataset.rm != null) { s.list.splice(+t.dataset.rm, 1); save(s); return draw(); }
      if (t.dataset.customRm) { s.custom = s.custom.filter(c => c.k !== t.dataset.customRm); save(s); return draw(); }
      if (t.dataset.lab) {
        const k = t.dataset.lab, row = ROWS.find(r => r.k === k) || s.custom.find(c => c.k === k) || {};
        const cur = s.labels[k] || (LABEL[k] ? LABEL[k].metro : row.label) || row.label || '';
        const v = prompt('항목 이름을 바꿉니다. (비우면 기본 이름으로 돌아갑니다)', cur);
        if (v == null) return;
        if (v.trim()) s.labels[k] = v.trim(); else delete s.labels[k];
        if (row.k && s.custom.some(c => c.k === k)) s.custom.forEach(c => { if (c.k === k) c.label = v.trim() || c.label; });
        save(s); return draw();
      }
      if (t.dataset.unpin) { setNote(t.dataset.loc, 'ov_' + t.dataset.unpin, null); return draw(); }
      if (t.dataset.edit) {
        setNote(t.dataset.loc, 'ov_' + t.dataset.edit, t.dataset.auto || '-');
        draw();
        const inp = $('evTable').querySelector(`input[data-loc="${CSS.escape(t.dataset.loc)}"][data-f="ov_${t.dataset.edit}"]`);
        if (inp) { inp.focus(); inp.select(); }
      }
    };
  }

  function open() { draw(); }
  return { init, open };
})();
