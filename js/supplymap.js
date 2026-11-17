/* ─────────────────────────────────────────────────────────
   supplymap.js — [공급지도] 탭 (예전 [공급] 탭을 이름만 바꿔 되살림): 부동산지인 입주물량 엑셀 → 요약 · 공급 그래프 · 공급 지도 · 단지 표
   · 자료 넣기: 부동산지인에서 내려받은 엑셀을 그대로 올림 (칸 이름으로 찾으므로 칸 순서가 바뀌어도 됨)
       같은 시도 자료가 이미 있으면 [바꾸기 / 합치기]를 고름. 입주시기가 바뀐 단지는 표시해 둠.
       자료는 이 브라우저에만 저장 (공개 저장소에 올리지 않음). 전체 백업·코드 내보내기에 함께 들어감.
   · 그래프: 연도별 ↔ 월별, 적정 수요선 = 인구 × 비율(기본 0.5%). 인구는 data/population.json (매월 자동 수집)
   · 지도: 멀리 보면 구별 합계, 가까이 보면 단지 라벨. 라벨 모양은 [🎨 라벨 꾸미기]에서 고름.
       위치는 카카오 주소 검색으로 그때그때 찾고(카카오 정책상 좌표는 저장하지 않음),
       못 찾은 단지를 지도에서 직접 찍은 위치만 저장합니다 (apt.supplyPins.v1).
   저장: apt.supply.v1(자료) · apt.supplyOpts.v1(필터·라벨 설정) · apt.supplyPins.v1(직접 찍은 위치) · apt.supplyStyles.v1(내 스타일)
   ───────────────────────────────────────────────────────── */
const SupplyMap = (() => {
  const $ = (id) => document.getElementById(id);
  const KD = 'apt.supply.v1', KO = 'apt.supplyOpts.v1', KP = 'apt.supplyPins.v1', KS = 'apt.supplyStyles.v1';
  const SMALL = 100;            // 이 세대수 미만 = 소규모 (지도에서 기본 숨김)
  const ZLV = 7;                // 카카오 지도 레벨이 이 값 이상(멀리 봄)이면 구별 합계 라벨
  const CHANGED_DAYS = 120;     // 입주시기 변경 표시를 이 기간 동안 보여 줌
  const KN = ['올해 입주', '내년 입주', '내후년 이후', '입주 완료'];
  // 입주시기 색: 0 올해 · 1 내년 · 2 내후년 이후 · 3 입주 완료  (a = 진한 색, f = 옅은 바탕, t = 옅은 바탕 위 글자)
  const PAL = {
    light: [{ a: '#E24B4A', f: '#FCEBEB', t: '#791F1F' }, { a: '#EF9F27', f: '#FAEEDA', t: '#633806' }, { a: '#7F77DD', f: '#EEEDFE', t: '#3C3489' }, { a: '#888780', f: '#F1EFE8', t: '#5F5E5A' }],
    dark: [{ a: '#F09595', f: '#501313', t: '#F7C1C1' }, { a: '#FAC775', f: '#412402', t: '#FAEEDA' }, { a: '#AFA9EC', f: '#26215C', t: '#CECBF6' }, { a: '#9a9993', f: '#2C2C2A', t: '#B4B2A9' }],
  };
  const SURF = { light: { s: '#FFFFFF', ink: '#2C2C2A', sub: '#5F5E5A', bd: '#D3D1C7' }, dark: { s: '#2C2C2A', ink: '#F1EFE8', sub: '#B4B2A9', bd: '#4a4a47' } };
  const DEF_LABEL = { n: 1, y: 1, h: 1, sty: 'twotone', col: 'period', one: '#1D9E75', size: 'm', byHh: 1, op: 100, rad: 'md', wt: 'b',
    yf: 'dot', hf: 'full', sep: ' · ', shadow: 1, hover: 1, avoid: 1, map: 'auto' };
  const PRESETS = [
    { k: 'modern', name: '모던', v: { sty: 'twotone', col: 'period', map: 'dark' } },
    { k: 'info', name: '정보형', v: { sty: 'card', col: 'period', map: 'light' } },
    { k: 'clean', name: '깔끔', v: { sty: 'mini', col: 'outline', map: 'light' } },
    { k: 'glance', name: '한눈에', v: { sty: 'pin', col: 'period', map: 'dark' } },
  ];
  const STYLES = [['twotone', '투톤'], ['card', '아이콘 카드'], ['pin', '핀'], ['tag', '태그'], ['mini', '미니멀']];
  const DEF = { sido: '', sggs: [], dong: '', noRent: 0, small: 0, view: 'year', ratio: 0.5, mapH: 560, sortK: 'ym', sortD: 1, label: { ...DEF_LABEL } };

  let data = Store.get(KD, { rows: [], files: [] });
  let opts = { ...DEF, ...Store.get(KO, {}) }; opts.label = { ...DEF_LABEL, ...(opts.label || {}) };
  let pins = Store.get(KP, {});
  let regions = [], pop = null, chart = null, map = null, overlays = [], mode = '', pickId = null, geoSeq = 0, inited = false;
  const geoMemo = new Map();      // 주소 → {lat,lng} | null  (이번 접속 동안만)
  const pos = new Map();          // 단지 id → {lat,lng,manual}

  const saveData = () => Store.set(KD, data);
  const saveOpts = () => Store.set(KO, opts);
  const esc = (s) => U.esc(s);
  const fmtN = (n) => (n == null ? '-' : Math.round(n).toLocaleString());

  /* ═══ 이름·날짜 정리 ═══ */
  const clean = (s) => String(s ?? '').replace(/[　 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const nosp = (s) => clean(s).replace(/\s/g, '');
  function sidoShort(s) {
    const t = nosp(s);
    const M = [['충청북', '충북'], ['충청남', '충남'], ['전라북', '전북'], ['전북', '전북'], ['전라남', '전남'], ['경상북', '경북'], ['경상남', '경남'], ['강원', '강원'], ['제주', '제주'], ['세종', '세종'], ['경기', '경기']];
    for (const [a, b] of M) if (t.startsWith(a)) return b;
    return t.slice(0, 2);
  }
  /** 입주시기 → 'YYYY-MM' */
  function toYm(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}`;
    if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; }
    const m = String(v).match(/(\d{4})\D{0,3}(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
    const m2 = String(v).match(/^(\d{4})(\d{2})/);
    return m2 ? `${m2[1]}-${m2[2]}` : '';
  }
  const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, '')); return isFinite(n) ? n : 0; };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const nowYm = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  /** 입주시기 구분 0 올해 · 1 내년 · 2 내후년 이후 · 3 입주 완료 */
  function period(ym) {
    if (!ym) return 2;
    const y = +ym.slice(0, 4), cy = new Date().getFullYear();
    if (ym < nowYm()) return 3;
    return y <= cy ? 0 : y === cy + 1 ? 1 : 2;
  }
  const isRent = (r) => /임대/.test(r.type || '');

  /* ═══ 엑셀 읽기 ═══ */
  const HEAD = { sido: ['시도'], sgg: ['시군구'], dong: ['읍면동', '법정동'], type: ['주택유형', '유형'], name: ['단지명', '아파트명'], addr: ['소재지', '주소'],
    ym: ['입주시기', '입주예정', '입주년월'], hh: ['총세대수', '세대수'], price: ['분양가'], builder: ['시공사', '건설사'] };
  function parseSheet(aoa) {
    const hi = aoa.findIndex(r => r.some(c => nosp(c) === '단지명') && r.some(c => /입주/.test(nosp(c))));
    if (hi < 0) throw new Error('"단지명"과 "입주시기" 칸을 찾지 못했습니다. 부동산지인에서 내려받은 파일이 맞는지 확인하세요.');
    const head = aoa[hi].map(nosp), col = {};
    for (const k in HEAD) col[k] = head.findIndex(h => HEAD[k].some(t => h === t || h.startsWith(t)));
    if (col.sido >= 0 && col.sgg >= 0 && head[col.sido] === head[col.sgg]) col.sgg = -1;
    const out = [];
    for (const r of aoa.slice(hi + 1)) {
      const g = (k) => (col[k] >= 0 ? r[col[k]] : '');
      const name = clean(g('name')); if (!name) continue;
      const addr = clean(g('addr'));
      let sido = clean(g('sido')), sgg = clean(g('sgg')), dong = clean(g('dong'));
      if ((!sido || !sgg) && addr) {            // 시도·시군구 칸이 없으면 주소에서 나눔
        const p = addr.split(' ');
        sido = sido || p[0];
        if (!sgg) { if (/시$/.test(p[1] || '') && /구$/.test(p[2] || '')) { sgg = `${p[1]} ${p[2]}`; dong = dong || p[3] || ''; } else { sgg = p[1] || ''; dong = dong || p[2] || ''; } }
      }
      sido = sidoShort(sido);
      const ym = toYm(g('ym'));
      out.push({ id: `${sido}|${nosp(addr)}|${nosp(name)}`, sido, sgg, dong, type: clean(g('type')) || '아파트', name, addr: addr || `${sido} ${sgg} ${dong}`, ym, hh: Math.round(num(g('hh'))), price: Math.round(num(g('price'))), builder: clean(g('builder')).replace(/^없음$/, '') });
    }
    return out;
  }
  async function readFile(file) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    let last = null;
    for (const nm of wb.SheetNames) {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[nm], { header: 1, raw: true, defval: '' });
      try { const rows = parseSheet(aoa); if (rows.length) return rows; } catch (e) { last = e; }
    }
    throw last || new Error('읽을 수 있는 줄이 없습니다.');
  }
  async function onFiles(e) {
    const files = [...e.target.files]; e.target.value = '';
    for (const f of files) {
      try {
        const rows = await readFile(f);
        const sidos = [...new Set(rows.map(r => r.sido))];
        const has = data.rows.some(r => sidos.includes(r.sido));
        const replace = has ? confirm(`"${f.name}" — ${sidos.join('·')} 자료가 이미 있습니다.\n\n[확인] 바꾸기 — 새 파일로 바꿉니다. (새 파일에 없는 단지는 지움 · 입주시기가 바뀐 단지는 표시)\n[취소] 합치기 — 기존 자료에 더하고, 같은 단지는 새 값으로 고칩니다.`) : false;
        const res = merge(rows, sidos, replace);
        data.files = data.files.filter(x => !x.sidos.every(s => sidos.includes(s)));
        data.files.push({ name: f.name, at: today(), sidos, n: rows.length });
        saveData();
        U.toast(`${f.name}: ${rows.length}개 단지를 넣었습니다.${res.changed ? ` 입주시기 바뀐 단지 ${res.changed}개.` : ''}${res.removed ? ` 빠진 단지 ${res.removed}개 지움.` : ''}`);
      } catch (err) { console.error(err); U.toast(`${f.name}: ${err.message || '파일을 읽지 못했습니다.'}`); }
    }
    if (!opts.sido && data.rows.length) opts.sido = data.rows[0].sido;
    saveOpts(); render();
  }
  function merge(rows, sidos, replace) {
    const old = new Map(data.rows.map(r => [r.id, r]));
    let changed = 0, removed = 0;
    for (const r of rows) {
      const o = old.get(r.id);
      if (o && o.ym && r.ym && o.ym !== r.ym) { r.prev = o.ym; r.chAt = today(); changed++; }
      else if (o && o.prev) { r.prev = o.prev; r.chAt = o.chAt; }
    }
    const ids = new Set(rows.map(r => r.id));
    const keep = data.rows.filter(r => {
      if (ids.has(r.id)) return false;
      if (replace && sidos.includes(r.sido)) { removed++; return false; }
      return true;
    });
    data.rows = [...keep, ...rows];
    return { changed, removed };
  }

  /* ═══ 지역코드 · 인구 ═══ */
  function codesOf(sido, sgg) {
    const s = sidoShort(sido), k = nosp(sgg);
    const inS = regions.filter(r => sidoShort(r[1]) === s);
    let hit = inS.filter(r => nosp(r[2]) === k);
    if (!hit.length) hit = inS.filter(r => nosp(r[2]).startsWith(k));
    if (!hit.length) hit = inS.filter(r => nosp(r[2]).replace('시', '') === k);
    return hit.map(r => r[0]);
  }
  function popOf(codes) {
    if (!pop || !pop.byCode) return null;
    let n = 0;
    for (const c of codes) { const v = pop.byCode[c]; if (!v || v.pop == null) return null; n += v.pop; }
    return codes.length ? n : null;
  }
  /** 지금 고른 범위의 인구 { n, label } (동 단위·자료 없음이면 n=null) */
  /** 지금 고른 시도·시군구 → 지역 코드 (분양가 vs 주변 시세에서도 씀) */
  function scopeCodes() {
    let codes = [];
    if (opts.sggs.length) codes = opts.sggs.flatMap(g => codesOf(opts.sido, g));
    else {
      const sidos = opts.sido ? [opts.sido] : [...new Set(data.rows.map(r => r.sido))];
      codes = regions.filter(r => sidos.includes(sidoShort(r[1]))).map(r => r[0]);
    }
    return [...new Set(codes)];
  }
  function scopePop() {
    if (opts.dong) return { n: null, why: '동 단위는 인구 기준이 없어 수요선을 그리지 않습니다.' };
    let codes = [];
    if (opts.sggs.length) codes = opts.sggs.flatMap(g => codesOf(opts.sido, g));
    else {
      const sidos = opts.sido ? [opts.sido] : [...new Set(data.rows.map(r => r.sido))];
      codes = regions.filter(r => sidos.includes(sidoShort(r[1]))).map(r => r[0]);
    }
    codes = [...new Set(codes)];
    if (!pop) return { n: null, why: '인구 자료가 아직 없습니다. 자동 수집이 한 번 돌면 채워집니다.' };
    const n = popOf(codes);
    return n == null ? { n: null, why: '고른 지역 중 인구 자료가 없는 곳이 있어 수요선을 그리지 않습니다.' } : { n, why: '' };
  }

  /* ═══ 필터 ═══ */
  function rowsF() {
    return data.rows.filter(r => (!opts.sido || r.sido === opts.sido) && (!opts.sggs.length || opts.sggs.includes(r.sgg)) && (!opts.dong || r.dong === opts.dong) && !(opts.noRent && isRent(r)));
  }
  function renderFilters() {
    const sidos = [...new Set(data.rows.map(r => r.sido))].sort();
    if (opts.sido && !sidos.includes(opts.sido)) { opts.sido = ''; opts.sggs = []; opts.dong = ''; }
    $('smSido').innerHTML = `<option value="">전체</option>` + sidos.map(s => `<option${s === opts.sido ? ' selected' : ''}>${esc(s)}</option>`).join('');
    const inS = data.rows.filter(r => (!opts.sido || r.sido === opts.sido) && !(opts.noRent && isRent(r)));
    const cnt = new Map(); inS.forEach(r => cnt.set(r.sgg, (cnt.get(r.sgg) || 0) + 1));
    opts.sggs = opts.sggs.filter(g => cnt.has(g));
    const sggs = [...cnt.keys()].sort((a, b) => a.localeCompare(b, 'ko'));
    $('smSggs').innerHTML = `<button type="button" data-g="" class="${opts.sggs.length ? '' : 'on'}">전체</button>` +
      sggs.map(g => `<button type="button" data-g="${esc(g)}" class="${opts.sggs.includes(g) ? 'on' : ''}">${esc(g)}<small>${cnt.get(g)}</small></button>`).join('');
    const one = opts.sggs.length === 1;
    $('smDongWrap').hidden = !one;
    if (one) {
      const dongs = [...new Set(inS.filter(r => r.sgg === opts.sggs[0]).map(r => r.dong).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
      if (opts.dong && !dongs.includes(opts.dong)) opts.dong = '';
      $('smDong').innerHTML = `<option value="">전체</option>` + dongs.map(d => `<option${d === opts.dong ? ' selected' : ''}>${esc(d)}</option>`).join('');
    } else opts.dong = '';
    $('smNoRent').checked = !!opts.noRent; $('smSmall').checked = !!opts.small;
    $('smRatio').value = opts.ratio;
  }
  function renderFiles() {
    const f = data.files;
    $('smFiles').innerHTML = f.length ? f.map((x, i) => `<span class="spfile"><b>${esc(x.sidos.join('·'))}</b> ${esc(x.at)} 기준 · ${x.n}단지 <button class="mini" data-delf="${i}" title="이 지역 자료 지우기">✕</button></span>`).join('') : '<span class="hint" style="margin:0">아직 올린 자료가 없습니다.</span>';
  }

  /* ═══ 요약 카드 ═══ */
  function renderCards(rows) {
    const cy = new Date().getFullYear(), ny = nowYm();
    const sum = (f) => { const a = rows.filter(f); return { hh: a.reduce((s, r) => s + r.hh, 0), n: a.length }; };
    const a = sum(r => r.ym >= ny && +r.ym.slice(0, 4) === cy), b = sum(r => +r.ym.slice(0, 4) === cy + 1), c = sum(r => +r.ym.slice(0, 4) >= cy + 2);
    const sp = scopePop(), need = sp.n != null ? sp.n * opts.ratio / 100 : null;
    const asOf = data.files.filter(x => !opts.sido || x.sidos.includes(opts.sido)).map(x => x.at).sort().pop() || '-';
    const card = (k, v, s, cls = '') => `<div class="card ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
    const vs = (x) => need ? `<em class="${x > need ? 'up' : 'down'}">수요 대비 ${Math.round(x / need * 100)}%</em>` : '';
    $('smCards').innerHTML = card(`${cy}년 남은 입주`, `${fmtN(a.hh)}세대`, `${a.n}단지 ${vs(a.hh)}`, 'p0') + card(`${cy + 1}년 입주`, `${fmtN(b.hh)}세대`, `${b.n}단지 ${vs(b.hh)}`, 'p1') +
      card(`${cy + 2}년 이후 입주`, `${fmtN(c.hh)}세대`, `${c.n}단지 · 분양 전 물량은 빠져 있음`, 'p2') +
      card('적정 수요 (1년)', need ? `${fmtN(need)}세대` : '-', need ? `인구 ${fmtN(sp.n)}명 × ${opts.ratio}%` : esc(sp.why)) + card('자료 기준일', esc(asOf), `${rows.length}단지 · ${fmtN(rows.reduce((s, r) => s + r.hh, 0))}세대`);
  }

  /* ═══ 공급 그래프 ═══ */
  function renderChart(rows) {
    if (chart) { chart.destroy(); chart = null; }
    const box = $('smChartBox');
    if (!rows.length) { box.innerHTML = '<p class="empty">표시할 자료가 없습니다.</p>'; return; }
    box.innerHTML = '<canvas id="smChart"></canvas>';
    const monthly = opts.view === 'month', ny = nowYm(), cy = new Date().getFullYear();
    const yms = rows.map(r => r.ym).filter(Boolean).sort();
    const keys = [];
    if (monthly) { let [y, m] = yms[0].split('-').map(Number); const [y2, m2] = yms[yms.length - 1].split('-').map(Number); while (y < y2 || (y === y2 && m <= m2)) { keys.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } } }
    else for (let y = +yms[0].slice(0, 4); y <= +yms[yms.length - 1].slice(0, 4); y++) keys.push(String(y));
    const bucket = new Map(keys.map(k => [k, []]));
    rows.forEach(r => { const k = monthly ? r.ym : r.ym.slice(0, 4); if (bucket.has(k)) bucket.get(k).push(r); });
    const vals = keys.map(k => bucket.get(k).reduce((s, r) => s + r.hh, 0));
    const per = (k) => (monthly ? period(k) : (+k < cy ? 3 : +k === cy ? 0 : +k === cy + 1 ? 1 : 2));
    const future = (k) => (monthly ? k > ny : +k > cy);
    const pal = PAL.light;
    const bg = keys.map(k => CK.alpha(pal[per(k)].a, future(k) ? 0.45 : 0.9));
    const sp = scopePop(), need = sp.n != null ? sp.n * opts.ratio / 100 / (monthly ? 12 : 1) : null;
    const sets = [{ type: 'bar', label: '입주 세대수', data: vals, backgroundColor: bg, borderColor: keys.map(k => pal[per(k)].a), borderWidth: keys.map(k => (future(k) ? 1.5 : 0)), borderDash: [4, 3], order: 2 }];
    if (need) sets.push({ type: 'line', label: `적정 수요 (인구×${opts.ratio}%${monthly ? '÷12' : ''})`, data: keys.map(() => need), borderColor: CK.C.text(), borderDash: [6, 5], borderWidth: 1.5, pointRadius: 0, order: 1, ckNoEnd: true });
    const lab = (k) => (monthly ? `${k.slice(2, 4)}.${k.slice(5)}` : `${k}년`);
    chart = new Chart($('smChart'), {
      data: { labels: keys.map(lab), datasets: sets },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: { y: { beginAtZero: true, ticks: { callback: (v) => Number(v).toLocaleString() } }, x: { ticks: { autoSkip: true, maxRotation: 0 } } },
        plugins: { ckCross: true, legend: { position: 'top' },
          tooltip: { callbacks: {
            label: (c) => `${c.dataset.label}: ${Math.round(c.raw).toLocaleString()}세대`,
            afterBody: (items) => { const k = keys[items[0].dataIndex], a = [...bucket.get(k)].sort((x, y) => y.hh - x.hh);
              if (!a.length) return ''; const top = a.slice(0, 8).map(r => `· ${r.name} (${r.sgg}) ${r.hh.toLocaleString()}세대${monthly ? '' : ' · ' + r.ym.slice(2).replace('-', '.')}`);
              return ['', ...top, ...(a.length > 8 ? [`  외 ${a.length - 8}개 단지`] : []), future(k) ? '※ 예정 — 분양 전 물량은 더 늘 수 있음' : ''].filter(x => x !== ''); } } } } },
    });
    $('smChartNote').innerHTML = `흐린 막대 = 아직 입주 전(예정). 먼 미래일수록 분양 전 물량이 빠져 있어 적게 보입니다.${need ? '' : ` · ${esc(sp.why)}`}${pop?.ym ? ` · 인구: ${pop.ym.slice(0, 4)}.${pop.ym.slice(4)} 기준 (행정안전부)` : ''}`;
  }

  /* ═══ 라벨 ═══ */
  const L = () => opts.label;
  const isDarkTheme = () => (getComputedStyle(document.documentElement).getPropertyValue('--scheme').trim() || 'dark') === 'dark';
  const darkMap = () => (L().map === 'auto' ? isDarkTheme() : L().map === 'dark');
  const rgba = (hex, a) => { const h = String(hex).replace('#', ''); if (h.length !== 6) return hex; const n = parseInt(h, 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
  function colorOf(k) {
    const dk = darkMap();
    if (L().col === 'single') { const a = L().one || '#1D9E75'; return { a, f: rgba(a, dk ? 0.28 : 0.14), t: dk ? '#ffffff' : a }; }
    return PAL[dk ? 'dark' : 'light'][k];
  }
  function fmtYm(ym) {
    if (!ym) return '-';
    const [y, m] = ym.split('-');
    return L().yf === 'full' ? `${y}.${m}` : L().yf === 'kor' ? `${y.slice(2)}년 ${+m}월` : `${y.slice(2)}.${m}`;
  }
  const fmtHh = (h) => (L().hf === 'k' ? (h >= 1000 ? `${(h / 1000).toFixed(1)}천` : `${h}`) : L().hf === 'num' ? h.toLocaleString() : `${h.toLocaleString()}세대`);
  const SC = { s: 0.88, m: 1, l: 1.18 };
  const RAD = { sq: '3px', md: '8px', round: '999px' };
  function labelEl(r) {
    const l = L(), dk = darkMap(), S = SURF[dk ? 'dark' : 'light'], c = colorOf(period(r.ym)), out = l.col === 'outline';
    const grow = l.byHh ? 0.92 + Math.min(r.hh, 3000) / 3000 * 0.32 : 1;
    const sc = SC[l.size] * grow, fs = Math.round(12 * sc), op = (l.op ?? 100) / 100, rad = RAD[l.rad] || '8px', wt = l.wt === 'n' ? 400 : 600;
    const surf = rgba(S.s, op), brd = out ? c.a : S.bd;
    const br = l.sep === 'br';
    const join = (a) => a.filter(Boolean).join(br ? '<br>' : esc(l.sep));
    const name = l.n ? esc(r.name) : '', yy = l.y ? esc(fmtYm(r.ym)) : '', hh = l.h ? esc(fmtHh(r.hh)) : '';
    const any = name || yy || hh;
    const el = document.createElement('div');
    el.className = `splbl${l.shadow ? ' sh' : ''}${l.hover ? ' hv' : ''}${any ? '' : ' sp-dot sp-fixed'}`;
    el.style.fontSize = fs + 'px'; el.style.fontWeight = wt;
    const dotR = Math.round((5 + Math.min(r.hh, 3000) / 600) * SC[l.size]);
    const dot = `<span class="spd" style="width:${dotR * 2}px;height:${dotR * 2}px;background:${c.a};border-color:${S.s}"></span>`;
    let h = '';
    if (l.sty === 'twotone') {
      const left = yy ? `<span class="tt-l" style="background:${out ? 'transparent' : c.a};color:${out ? c.a : (dk ? '#1b1b1a' : '#fff')};${out ? `border-right:1px solid ${c.a}` : ''}">${yy}</span>` : '';
      const right = join([name ? `<span style="color:${S.ink}">${name}</span>` : '', hh ? `<span class="tt-b" style="background:${out ? 'transparent' : c.f};color:${out ? c.a : c.t};${out ? `border:1px solid ${c.a}` : ''}">${hh}</span>` : '']);
      h = `<div class="spbox tt" style="background:${surf};border:1px solid ${brd};border-radius:${l.rad === 'sq' ? '4px' : l.rad === 'md' ? '10px' : '999px'}">${left}${right ? `<span class="tt-r">${right}</span>` : ''}</div><div class="spstem" style="background:${c.a}"></div><div class="spfoot" style="background:${c.a};border-color:${S.s}"></div>`;
    } else if (l.sty === 'card') {
      const sub = join([yy ? `${yy} 입주` : '', hh]);
      h = `<div class="spbox cd" style="background:${surf};border:1px solid ${brd};border-radius:${rad === '999px' ? '16px' : rad}"><span class="cd-i" style="background:${out ? 'transparent' : c.f};color:${c.a};${out ? `border:1px solid ${c.a}` : ''}">🏢</span><span>${name ? `<div style="color:${S.ink}">${name}</div>` : ''}${sub ? `<div class="cd-s" style="color:${S.sub}">${sub}</div>` : ''}</span></div><div class="sptail" style="border-top-color:${brd}"></div>`;
    } else if (l.sty === 'pin') {
      const pr = Math.round((14 + Math.min(r.hh, 3000) / 220) * SC[l.size]);
      const inner = hh ? (r.hh >= 1000 ? `${(r.hh / 1000).toFixed(1)}천` : r.hh) : '🏢';
      const cap = join([name, yy]);
      h = `<div class="pinwrap">${cap ? `<div class="pin-c" style="background:${surf};color:${S.ink};border:1px solid ${S.bd};border-radius:${rad === '999px' ? '999px' : '6px'}">${cap}</div>` : ''}<div class="pin-h" style="width:${pr * 2}px;height:${pr * 2}px;background:${out ? S.s : c.a};border:2px solid ${out ? c.a : S.s}"><span style="color:${out ? c.a : (dk ? '#1b1b1a' : '#fff')}">${inner}</span></div></div>`;
    } else if (l.sty === 'tag') {
      const parts = [name ? `<b>${name}</b>` : '', yy, hh].filter(Boolean);
      const sep = br ? '<br>' : `<span class="tg-s">${esc(l.sep.trim() || '·')}</span>`;
      const tbg = out ? surf : (c.f.startsWith('#') ? rgba(c.f, op) : c.f);
      h = `<div class="spbox tg" style="background:${tbg};color:${out ? S.ink : c.t};border:1px solid ${c.a};border-radius:${rad}"><span class="tg-d" style="background:${c.a}"></span><span>${parts.join(sep)}</span></div><div class="sptail" style="border-top-color:${c.a}"></div>`;
    } else {
      h = `<div class="spbox mn">${dot}<span class="mn-t" style="color:${S.ink};background:${rgba(S.s, Math.min(op, 0.82))};border-radius:${rad === '999px' ? '999px' : '4px'}">${join([name, yy, hh])}</span></div>`;
    }
    el.innerHTML = `<div class="spfull">${h}</div><div class="spdotonly">${dot}</div>`;
    el.title = `${r.name} · ${fmtYm(r.ym)} 입주 · ${r.hh.toLocaleString()}세대`;
    return el;
  }
  function guLabelEl(g) {
    const dk = darkMap(), S = SURF[dk ? 'dark' : 'light'], cy = new Date().getFullYear();
    const parts = [0, 1, 2].map(i => { const v = i < 2 ? g.y[cy + i] : Object.keys(g.y).filter(y => +y >= cy + 2).reduce((s, y) => s + g.y[y], 0); return v ? `<span><i style="background:${PAL[dk ? 'dark' : 'light'][i].a}"></i>${String(cy + i).slice(2)}년${i === 2 ? '~' : ''} ${v.toLocaleString()}</span>` : ''; }).filter(Boolean);
    const el = document.createElement('div');
    el.className = `splbl gu${L().shadow ? ' sh' : ''}${L().hover ? ' hv' : ''}`;
    const tot = Object.keys(g.y).reduce((s, y) => s + g.y[y], 0);
    el.innerHTML = `<div class="spfull"><div class="spbox gub" style="background:${rgba(S.s, (L().op ?? 100) / 100)};color:${S.ink};border:1px solid ${S.bd}"><b>${esc(g.name)}</b>${parts.length ? parts.join('') : `<span style="color:${S.sub}">예정 입주 없음</span>`}</div></div>` +
      `<div class="spdotonly"><span class="gus" style="background:${rgba(S.s, 0.92)};color:${tot ? S.ink : S.sub};border:1px solid ${S.bd}">${esc(g.name)}${tot ? ` <b>${tot.toLocaleString()}</b>` : ''}</span></div>`;
    return el;
  }

  /* ═══ 위치 찾기 (이번 접속 동안만 기억) ═══ */
  function addrSearch(q) { const S = kakao.maps.services; return new Promise(res => new S.Geocoder().addressSearch(q, (l, st) => res(st === S.Status.OK && l.length ? { lat: +l[0].y, lng: +l[0].x } : null))); }
  function kwSearch(q) { const S = kakao.maps.services; return new Promise(res => new S.Places().keywordSearch(q, (l, st) => res(st === S.Status.OK && l.length ? { lat: +l[0].y, lng: +l[0].x } : null))); }
  async function locate(r) {
    if (pins[r.id]) return { ...pins[r.id], manual: true };
    if (geoMemo.has(r.id)) return geoMemo.get(r.id);
    let p = r.addr ? await addrSearch(r.addr) : null;
    if (!p) p = await kwSearch(`${r.sgg} ${r.dong} ${r.name}`);
    geoMemo.set(r.id, p);
    return p;
  }
  async function locateAll(rows) {
    const seq = ++geoSeq, todo = rows.filter(r => !pos.has(r.id) || pins[r.id]);
    let done = 0;
    const show = () => { $('smGeo').textContent = todo.length && done < todo.length ? `위치 찾는 중… ${done}/${todo.length}` : ''; };
    show();
    const q = [...todo];
    const worker = async () => { while (q.length) { if (seq !== geoSeq) return; const r = q.shift(); try { const p = await locate(r); if (p) pos.set(r.id, p); else pos.delete(r.id); } catch (e) { console.error(e); } done++; if (done % 10 === 0) show(); } };
    await Promise.all(Array.from({ length: 5 }, worker));
    if (seq === geoSeq) show();
    return seq === geoSeq;
  }

  /* ═══ 지도 ═══ */
  function clearOverlays() { overlays.forEach(o => o.ov.setMap(null)); overlays = []; }
  function mapRows() { return rowsF().filter(r => opts.small || r.hh >= SMALL); }
  async function renderMap(fit) {
    const box = $('smMap');
    box.style.height = opts.mapH + 'px';
    box.classList.toggle('spdark', darkMap());
    if (!KMap.ready()) { box.innerHTML = `<p class="empty">${KMap.needKeyHtml}</p>`; return; }
    try { await KMap.load(); } catch (e) { box.innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
    if (!map) {
      box.innerHTML = '';
      map = KMap.create(box, { lat: 37.5547, lng: 126.9707 }, 8);
      kakao.maps.event.addListener(map, 'zoom_changed', () => { const m = map.getLevel() >= ZLV ? 'gu' : 'apt'; if (m !== mode) drawOverlays(); });
      kakao.maps.event.addListener(map, 'idle', () => avoid());
      kakao.maps.event.addListener(map, 'click', (e) => {
        if (!pickId) return;
        pins[pickId] = { lat: e.latLng.getLat(), lng: e.latLng.getLng() }; Store.set(KP, pins);
        pos.set(pickId, { ...pins[pickId], manual: true }); pickId = null; box.classList.remove('picking');
        U.toast('위치를 저장했습니다.'); drawOverlays(); renderUnfound(); renderTable();
      });
    }
    map.relayout();
    const all = rowsF();
    drawOverlays();
    const ok = await locateAll(all);
    if (!ok) return;
    drawOverlays();
    renderUnfound(); renderTable();
    if (fit) { const pts = mapRows().map(r => pos.get(r.id)).filter(Boolean); if (pts.length) KMap.fit(map, pts); }
  }
  function drawOverlays() {
    if (!map) return;
    clearOverlays();
    mode = map.getLevel() >= ZLV ? 'gu' : 'apt';
    if (mode === 'gu') {
      const groups = new Map();
      rowsF().forEach(r => {
        const p = pos.get(r.id); const k = `${r.sido}|${r.sgg}`;
        if (!groups.has(k)) groups.set(k, { name: r.sgg, y: {}, pts: [] });
        const g = groups.get(k);
        if (p) g.pts.push(p);
        if (r.ym >= nowYm()) { const y = r.ym.slice(0, 4); g.y[y] = (g.y[y] || 0) + r.hh; }
      });
      for (const g of groups.values()) {
        if (!g.pts.length) continue;
        const c = { lat: g.pts.reduce((s, p) => s + p.lat, 0) / g.pts.length, lng: g.pts.reduce((s, p) => s + p.lng, 0) / g.pts.length };
        const el = guLabelEl(g);
        el.onclick = () => { map.setLevel(ZLV - 2); map.setCenter(KMap.LL(c)); };
        const ov = new kakao.maps.CustomOverlay({ position: KMap.LL(c), content: el, yAnchor: 0.5, xAnchor: 0.5, zIndex: 3, clickable: true });
        ov.setMap(map); overlays.push({ ov, el, w: Object.values(g.y).reduce((s, v) => s + v, 0), p: c, gu: 1 });
      }
    } else {
      const sty = L().sty;
      mapRows().forEach(r => {
        const p = pos.get(r.id); if (!p) return;
        const el = labelEl(r);
        el.onclick = (e) => { e.stopPropagation(); showCard(r); };
        const ya = sty === 'mini' ? 0.5 : 1, xa = sty === 'mini' ? 0 : 0.5;
        const ov = new kakao.maps.CustomOverlay({ position: KMap.LL(p), content: el, yAnchor: ya, xAnchor: xa, zIndex: 4 + Math.round(r.hh / 100), clickable: true });
        ov.setMap(map); overlays.push({ ov, el, w: r.hh, p, r });
      });
    }
    legend();
    setTimeout(avoid, 50);
  }
  /** 라벨이 겹치면 세대수가 작은 단지를 점으로 줄임 (라벨 크기는 처음 그릴 때 한 번 재 두고, 위치는 지도 좌표로 계산) */
  function measure() {
    overlays.forEach(o => { if (o.p && o.fw == null) { const f = o.el.querySelector('.spfull'); o.fw = f ? f.offsetWidth : 0; o.fh = f ? f.offsetHeight : 0; } });
  }
  function avoid() {
    if (!overlays.length || !map) return;
    measure();
    const lab = overlays.filter(o => o.p && !o.el.classList.contains('sp-fixed'));
    const on = mode === 'gu' || (L().avoid && (L().n || L().y || L().h));
    const proj = map.getProjection(), mini = mode === 'apt' && L().sty === 'mini', mid = mode === 'gu', placed = [], pad = 2;
    const want = new Map();
    [...lab].sort((a, b) => b.w - a.w).forEach(o => {
      if (!on || !o.fw) { want.set(o, false); return; }
      const pt = proj.containerPointFromCoords(KMap.LL(o.p));
      const b = mini ? { l: pt.x, t: pt.y - o.fh / 2, r: pt.x + o.fw, b: pt.y + o.fh / 2 } : mid ? { l: pt.x - o.fw / 2, t: pt.y - o.fh / 2, r: pt.x + o.fw / 2, b: pt.y + o.fh / 2 } : { l: pt.x - o.fw / 2, t: pt.y - o.fh, r: pt.x + o.fw / 2, b: pt.y };
      const hit = placed.some(p => b.l < p.r + pad && b.r > p.l - pad && b.t < p.b + pad && b.b > p.t - pad);
      want.set(o, hit); if (!hit) placed.push(b);
    });
    // 구별 합계: 줄인 이름표끼리도 겹치면 숨김 (확대하면 다시 보임)
    const hide = new Set();
    if (mid) for (const [o, dot] of want) {
      if (!dot) continue;
      const pt = proj.containerPointFromCoords(KMap.LL(o.p)), w = 14 + o.el.textContent.length * 4, h = 20;
      const b = { l: pt.x - w / 2, t: pt.y - h / 2, r: pt.x + w / 2, b: pt.y + h / 2 };
      if (placed.some(p => b.l < p.r && b.r > p.l && b.t < p.b && b.b > p.t)) hide.add(o); else placed.push(b);
    }
    for (const [o, dot] of want) {
      const hd = hide.has(o);
      if (o.el.classList.contains('sp-dot') !== dot || o.el.classList.contains('sp-hide') !== hd) { o.el.classList.toggle('sp-dot', dot); o.el.classList.toggle('sp-hide', hd); o.ov.setPosition(KMap.LL(o.p)); }
    }
  }
  function legend() {
    const dk = darkMap(), single = L().col === 'single';
    const items = single ? [`<span><i style="background:${L().one}"></i>공급 단지</span>`] : KN.map((k, i) => `<span><i style="background:${PAL[dk ? 'dark' : 'light'][i].a}"></i>${k}</span>`);
    const n = mode === 'apt' ? overlays.length : rowsF().length;
    $('smLegend').innerHTML = `<b>입주시기</b>${items.join('')}<span class="sub">${mode === 'gu' ? '구별 합계 (확대하면 단지별)' : `단지 ${n}개${opts.small ? '' : ` · ${SMALL}세대 미만 숨김`}`}</span>`;
  }
  function showCard(r) {
    const c = colorOf(period(r.ym)), p = pos.get(r.id);
    const ch = r.prev && daysSince(r.chAt) <= CHANGED_DAYS ? `<div class="s">⚠ 입주시기 변경: ${fmtYm(r.prev)} → ${fmtYm(r.ym)} (${r.chAt} 확인)</div>` : '';
    const q = encodeURIComponent(`${r.sgg} ${r.dong} ${r.name}`);
    $('smCard').innerHTML = `<div class="card spcard" style="border-left:4px solid ${c.a};border-radius:0 10px 10px 0">
      <div class="bar"><strong>${esc(r.name)}</strong><span class="spchip" style="background:${c.a}">${KN[period(r.ym)]}</span><span class="grow"></span><button class="mini" data-close>닫기</button></div>
      <div class="s">${esc(r.addr)}</div>
      <div class="spkv"><span>입주시기 <b>${esc(fmtYm(r.ym))}</b></span><span>세대수 <b>${r.hh.toLocaleString()}</b></span><span>분양가(3.3㎡) <b>${r.price ? U.price(r.price) + '만' : '-'}</b></span><span>시공사 <b>${esc(r.builder || '-')}</b></span><span>유형 <b>${esc(r.type)}</b></span></div>${ch}
      <div class="bar" style="margin-top:8px"><a class="btn mini" target="_blank" rel="noopener" href="https://map.kakao.com/?q=${q}">카카오맵</a><a class="btn mini" target="_blank" rel="noopener" href="https://search.naver.com/search.naver?query=${q}">네이버 검색</a>
      <button class="mini" data-pick="${esc(r.id)}">📍 위치 직접 지정</button>${pins[r.id] ? `<button class="mini" data-unpin="${esc(r.id)}">지정 위치 지우기</button>` : ''}${p ? '' : '<span class="hint" style="margin:0">위치를 못 찾았습니다</span>'}</div></div>`;
  }
  const daysSince = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 864e5) : 1e9);
  function startPick(id) {
    pickId = id; $('smMap').classList.add('picking');
    $('smMap').scrollIntoView({ behavior: 'smooth', block: 'center' });
    const r = data.rows.find(x => x.id === id);
    U.toast(`지도에서 "${r ? r.name : ''}" 위치를 누르세요. (Esc 취소)`);
  }
  function renderUnfound() {
    const miss = mapRows().filter(r => !pos.has(r.id));
    $('smUnfound').hidden = !miss.length;
    $('smUnfound').innerHTML = miss.length ? `<b>⚠ 위치를 못 찾은 단지 ${miss.length}개</b> <span class="hint" style="margin:0">— [📍]를 누르고 지도에서 위치를 찍으면 저장됩니다.</span><div class="chips" style="margin-top:6px">${miss.slice(0, 40).map(r => `<button class="mini" data-pick="${esc(r.id)}">📍 ${esc(r.name)} <small>${esc(r.sgg)}</small></button>`).join('')}${miss.length > 40 ? `<span class="hint">외 ${miss.length - 40}개</span>` : ''}</div>` : '';
  }

  /* ═══ 단지 표 ═══ */
  const COLS = [['sgg', '시군구'], ['dong', '읍면동'], ['name', '단지명'], ['ym', '입주시기'], ['hh', '세대수'], ['price', '분양가(3.3㎡)'], ['builder', '시공사'], ['type', '유형'], ['loc', '위치']];
  function renderTable() {
    const rows = rowsF(), k = opts.sortK, d = opts.sortD;
    const val = (r) => (k === 'loc' ? (pos.has(r.id) ? 1 : 0) : r[k]);
    rows.sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'ko')) * d; });
    $('smTable').innerHTML = `<thead><tr>${COLS.map(([c, t]) => `<th data-sort="${c}" class="sortable">${t}${c === k ? (d > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>` +
      rows.map(r => { const ch = r.prev && daysSince(r.chAt) <= CHANGED_DAYS; const c = colorOf(period(r.ym));
        return `<tr data-id="${esc(r.id)}"><td>${esc(r.sgg)}</td><td>${esc(r.dong)}</td><td class="l"><span class="spdotmini" style="background:${c.a}"></span>${esc(r.name)}</td><td>${esc(fmtYm(r.ym))}${ch ? ` <small class="spchg" title="이전 ${esc(r.prev)} · ${esc(r.chAt)} 확인">변경 ← ${esc(fmtYm(r.prev))}</small>` : ''}</td><td class="num">${r.hh.toLocaleString()}</td><td class="num">${r.price ? r.price.toLocaleString() : '-'}</td><td>${esc(r.builder || '-')}</td><td>${esc(r.type)}</td><td>${pos.has(r.id) ? (pins[r.id] ? '📍 직접' : '✓') : (map ? '<span class="warn">못 찾음</span>' : '-')}</td></tr>`; }).join('') + '</tbody>';
    $('smTableCount').textContent = `${rows.length}단지 · ${fmtN(rows.reduce((s, r) => s + r.hh, 0))}세대`;
  }
  function excel() {
    const rows = rowsF().sort((a, b) => a.ym.localeCompare(b.ym));
    U.download(`공급_${U.stamp()}`, [{ name: '공급', rows: [['시도', '시군구', '읍면동', '단지명', '소재지', '입주시기', '총세대수', '분양가(3.3㎡ 만원)', '시공사', '주택유형', '이전 입주시기'], ...rows.map(r => [r.sido, r.sgg, r.dong, r.name, r.addr, r.ym, r.hh, r.price || '', r.builder, r.type, r.prev || ''])] }]);
  }

  /* ═══ 라벨 꾸미기 (서랍) ═══ */
  function seg(k, list) { return `<div class="spseg" data-seg="${k}">${list.map(([v, t]) => `<button type="button" data-v="${v}" class="${String(L()[k]) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</div>`; }
  function renderDrawer() {
    const l = L(), my = Store.get(KS, []);
    const presetOn = (p) => Object.entries(p.v).every(([k, v]) => l[k] === v);
    $('smDrawerBody').innerHTML = `
      <div class="drawsec"><h4>추천 조합</h4><div class="spseg">${PRESETS.map(p => `<button type="button" data-preset="${p.k}" class="${presetOn(p) ? 'on' : ''}">${p.name}</button>`).join('')}</div></div>
      <div class="drawsec"><h4>라벨에 넣을 것</h4>
        <label class="inline"><input type="checkbox" data-k="n" ${l.n ? 'checked' : ''}> 아파트 이름</label>
        <label class="inline"><input type="checkbox" data-k="y" ${l.y ? 'checked' : ''}> 연식(입주시기)</label>
        <label class="inline"><input type="checkbox" data-k="h" ${l.h ? 'checked' : ''}> 세대수</label>
        <span class="hint" style="margin:0;width:100%">셋 다 끄면 색 점만 보입니다. 구별 합계 라벨은 그대로입니다.</span></div>
      <div class="drawsec"><h4>스타일</h4>${seg('sty', STYLES)}</div>
      <div class="drawsec"><h4>색상</h4>${seg('col', [['period', '입주시기별'], ['single', '단일색'], ['outline', '테두리만']])}
        ${l.col === 'single' ? `<label class="inline">색 <input type="color" data-k="one" value="${esc(l.one)}"></label>` : ''}</div>
      <div class="drawsec"><h4>지도 바탕</h4>${seg('map', [['auto', '자동 (배경 테마 따라)'], ['dark', '어둡게'], ['light', '밝게']])}</div>
      <div class="drawsec"><h4>크기</h4>${seg('size', [['s', '작게'], ['m', '보통'], ['l', '크게']])}
        <label class="inline"><input type="checkbox" data-k="byHh" ${l.byHh ? 'checked' : ''}> 세대수가 많을수록 크게</label></div>
      <div class="drawsec"><h4>세부 설정</h4>
        <label class="inline" style="width:100%">배경 투명도 <input type="range" min="40" max="100" step="5" data-k="op" value="${l.op}" style="flex:1"> <b>${l.op}%</b></label>
        <span class="hint" style="margin:0">모서리</span>${seg('rad', [['sq', '각지게'], ['md', '약간'], ['round', '완전 둥글게']])}
        <span class="hint" style="margin:0">글자</span>${seg('wt', [['n', '보통'], ['b', '굵게']])}
        <label>연식 표기 <select data-k="yf"><option value="dot">27.04</option><option value="full">2027.04</option><option value="kor">27년 4월</option></select></label>
        <label>세대수 표기 <select data-k="hf"><option value="full">1,250세대</option><option value="k">1.3천</option><option value="num">1,250</option></select></label>
        <label>구분 기호 <select data-k="sep"><option value=" · ">가운뎃점 ·</option><option value=" | ">세로줄 |</option><option value="br">줄바꿈</option></select></label></div>
      <div class="drawsec"><h4>효과</h4>
        <label class="inline"><input type="checkbox" data-k="shadow" ${l.shadow ? 'checked' : ''}> 그림자</label>
        <label class="inline"><input type="checkbox" data-k="hover" ${l.hover ? 'checked' : ''}> 마우스를 올리면 살짝 커짐</label>
        <label class="inline"><input type="checkbox" data-k="avoid" ${l.avoid ? 'checked' : ''}> 겹치면 작은 단지는 점으로</label></div>
      <div class="drawsec"><h4>내 스타일 (최대 3개)</h4>
        ${my.length ? my.map((s, i) => `<span class="spmy"><button type="button" data-myload="${i}">${esc(s.name)}</button><button class="mini" data-mydel="${i}" title="지우기">✕</button></span>`).join('') : '<span class="hint" style="margin:0">저장한 스타일이 없습니다.</span>'}
        <div class="bar" style="width:100%;margin-top:4px"><input type="text" id="smMyName" placeholder="스타일 이름" maxlength="12" style="flex:1"><button type="button" data-mysave>지금 스타일 저장</button></div>
        <button type="button" data-reset style="margin-top:4px">기본값으로 되돌리기</button></div>
      <div class="drawsec"><h4>지도 크기</h4><label class="inline" style="width:100%">세로 <input type="range" min="320" max="1000" step="20" data-mh value="${opts.mapH}" style="flex:1"> <b>${opts.mapH}px</b></label></div>`;
    $('smDrawerBody').querySelectorAll('select[data-k]').forEach(s => { s.value = l[s.dataset.k]; });
  }
  function setLabel(patch) { Object.assign(opts.label, patch); saveOpts(); renderDrawer(); restyle(); }
  function restyle() { $('smMap').classList.toggle('spdark', darkMap()); drawOverlays(); renderTable(); }
  function initDrawer() {
    const body = $('smDrawerBody');
    body.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const sg = b.closest('[data-seg]');
      if (sg && b.dataset.v != null) return setLabel({ [sg.dataset.seg]: b.dataset.v });
      if (b.dataset.preset) return setLabel({ ...PRESETS.find(p => p.k === b.dataset.preset).v });
      if (b.dataset.myload != null) { const s = Store.get(KS, [])[+b.dataset.myload]; if (s) setLabel({ ...s.v }); return; }
      if (b.dataset.mydel != null) { const a = Store.get(KS, []); a.splice(+b.dataset.mydel, 1); Store.set(KS, a); return renderDrawer(); }
      if (b.hasAttribute('data-mysave')) {
        const a = Store.get(KS, []), name = ($('smMyName').value || '').trim() || `내 스타일 ${a.length + 1}`;
        if (a.length >= 3) return U.toast('내 스타일은 3개까지 저장됩니다. 하나를 지우고 저장하세요.');
        a.push({ name, v: { ...L() } }); Store.set(KS, a); U.toast(`"${name}" 저장했습니다.`); return renderDrawer();
      }
      if (b.hasAttribute('data-reset')) return setLabel({ ...DEF_LABEL });
    };
    body.onchange = (e) => {
      const t = e.target, k = t.dataset.k;
      if (k) setLabel({ [k]: t.type === 'checkbox' ? (t.checked ? 1 : 0) : t.type === 'range' ? +t.value : t.value });
    };
    body.oninput = (e) => {
      const t = e.target;
      if (t.dataset.mh != null) { opts.mapH = +t.value; t.nextElementSibling.textContent = t.value + 'px'; $('smMap').style.height = opts.mapH + 'px'; if (map) map.relayout(); saveOpts(); }
      else if (t.dataset.k === 'op') { t.nextElementSibling.textContent = t.value + '%'; opts.label.op = +t.value; saveOpts(); drawOverlays(); }
    };
    $('btnSmDrawer').onclick = () => { const d = $('smDrawer'); d.hidden = !d.hidden; if (!d.hidden) renderDrawer(); $('btnSmDrawer').classList.toggle('on', !d.hidden); };
    $('btnSmDrawerClose').onclick = () => { $('smDrawer').hidden = true; $('btnSmDrawer').classList.remove('on'); };
  }

  /* ═══ 그리기 ═══ */
  function render(fit = true) {
    const has = data.rows.length > 0;
    $('smEmpty').hidden = has; $('smBody').hidden = !has;
    renderFiles();
    if (!has) return;
    renderFilters();
    const rows = rowsF();
    renderCards(rows);
    $('smView').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.view === opts.view));
    renderChart(rows);
    renderTable();
    if (!$('tab-supplymap').hidden) renderMap(fit);
    if (typeof SupplyCmp !== 'undefined') SupplyCmp.setCodes(scopeCodes(), [opts.sido, ...opts.sggs].filter(Boolean).join(' ') || '전체');
  }

  async function init() {
    if (inited) return; inited = true;
    regions = await Data.regions();
    fetch(`${CONFIG.DATA_URL}/population.json`, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).then(d => { pop = d; if (data.rows.length && !$('tab-supplymap').hidden) { const rows = rowsF(); renderCards(rows); renderChart(rows); } }).catch(() => {});
    $('smFile').onchange = onFiles;
    $('btnSmUpload').onclick = () => $('smFile').click();
    $('btnSmUpload2').onclick = () => $('smFile').click();
    $('smFiles').onclick = (e) => {
      const b = e.target.closest('[data-delf]'); if (!b) return;
      const f = data.files[+b.dataset.delf]; if (!f || !confirm(`${f.sidos.join('·')} 공급 자료를 지울까요?`)) return;
      data.rows = data.rows.filter(r => !f.sidos.includes(r.sido)); data.files.splice(+b.dataset.delf, 1); saveData(); render();
    };
    $('smSido').onchange = () => { opts.sido = $('smSido').value; opts.sggs = []; opts.dong = ''; saveOpts(); render(); };
    $('smSggs').onclick = (e) => {
      const b = e.target.closest('[data-g]'); if (!b) return;
      const g = b.dataset.g;
      if (!g) opts.sggs = []; else opts.sggs = opts.sggs.includes(g) ? opts.sggs.filter(x => x !== g) : [...opts.sggs, g];
      opts.dong = ''; saveOpts(); render();
    };
    $('smDong').onchange = () => { opts.dong = $('smDong').value; saveOpts(); render(); };
    $('smNoRent').onchange = () => { opts.noRent = $('smNoRent').checked ? 1 : 0; saveOpts(); render(false); };
    $('smSmall').onchange = () => { opts.small = $('smSmall').checked ? 1 : 0; saveOpts(); drawOverlays(); renderUnfound(); };
    $('smRatio').onchange = () => { const v = parseFloat($('smRatio').value); opts.ratio = isFinite(v) && v > 0 ? Math.min(5, v) : 0.5; saveOpts(); const rows = rowsF(); renderCards(rows); renderChart(rows); };
    $('smView').onclick = (e) => { const b = e.target.closest('[data-view]'); if (!b) return; opts.view = b.dataset.view; saveOpts(); $('smView').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); renderChart(rowsF()); };
    $('btnSmExcel').onclick = excel;
    $('btnSmFit').onclick = () => { if (!map) return; const pts = mapRows().map(r => pos.get(r.id)).filter(Boolean); if (pts.length) KMap.fit(map, pts); };
    $('smTable').onclick = (e) => {
      const th = e.target.closest('th[data-sort]');
      if (th) { const k = th.dataset.sort; opts.sortD = opts.sortK === k ? -opts.sortD : 1; opts.sortK = k; saveOpts(); return renderTable(); }
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      const r = data.rows.find(x => x.id === tr.dataset.id); if (!r) return;
      showCard(r);
      const p = pos.get(r.id);
      if (p && map) { map.setLevel(4); map.setCenter(KMap.LL(p)); $('smMap').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    };
    const pickClick = (e) => {
      const b = e.target.closest('[data-pick],[data-unpin],[data-close]'); if (!b) return;
      if (b.dataset.pick) startPick(b.dataset.pick);
      else if (b.dataset.unpin) { delete pins[b.dataset.unpin]; Store.set(KP, pins); pos.delete(b.dataset.unpin); geoMemo.delete(b.dataset.unpin); renderMap(false); $('smCard').innerHTML = ''; }
      else $('smCard').innerHTML = '';
    };
    $('smUnfound').onclick = pickClick; $('smCard').onclick = pickClick;
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pickId) { pickId = null; $('smMap').classList.remove('picking'); U.toast('위치 지정을 취소했습니다.'); } });
    initDrawer();
    if (typeof Saves !== 'undefined') Saves.register('supplymap', { name: '공급지도', keys: [KD, KO, KP] });
  }
  function open() { render(!map); if (map) setTimeout(() => map.relayout(), 50); }

  return { init, open };
})();
