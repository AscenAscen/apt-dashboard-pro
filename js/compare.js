/* ─────────────────────────────────────────────────────────
   compare.js — [단지 비교] 탭
   단지 2개까지: 시세 그래프 겹쳐 보기 + 호가 흐름 + 수익률 + 지도·직선거리 + 입지 비교 + 월별 실거래 비교표
   화면에 보일 항목은 "표시 항목 고르기"에서 켜고 끕니다. (아래 OPTIONS 에 줄을 추가/삭제하면 목록이 바뀝니다)
   ───────────────────────────────────────────────────────── */
const Compare = (() => {
  const $ = (id) => document.getElementById(id);
  const NAMES = ['A', 'B'], COLORS = ['--accent', '--rent'];
  const OKEY = 'apt.cmpOpts.v1';
  // 표시 항목 목록: [저장 이름, 화면 이름, 처음 값]
  const OPTIONS = [
    ['@', '그래프'], ['vol', '거래 건수 막대', true], ['peak', '전고·전저 표시', true],
    ['@', '거래 걸러내기'], ['noDirect', '직거래 숨김', true], ['noLow', '1~3층 제외', false],
    ['@', '아래에 보일 표'], ['quote', '호가 흐름과 투자금', true], ['ret', '수익률 표', true], ['map', '지도와 직선거리', true], ['basic', '기본 비교표', true], ['monthly', '월별 실거래 비교표', true],
    ['@', '입지 비교 항목'], ['traffic', '교통', true], ['school', '학군', true], ['env', '환경', true], ['hoje', '호재', true],
  ];
  let regions = [], chart = null, kmap = null, shapes = [], placeSeq = 0, last = null;
  const slots = [];
  let opt = {};

  const dateText = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const toNum = (text) => +text.replace(/-/g, '');
  const eokText = (v) => +(v / 10000).toFixed(2) + '억';

  async function init() {
    // 표시 항목 체크 상자
    const saved = Store.get(OKEY, {});
    OPTIONS.forEach(([k, , def]) => { if (k !== '@') opt[k] = saved[k] ?? def; });
    $('cmpOpts').innerHTML = OPTIONS.map(([k, name]) => (k === '@' ? `<div class="ogroup">${name}</div>` : `<label><input type="checkbox" data-k="${k}" ${opt[k] ? 'checked' : ''}> ${name}</label>`)).join('');
    $('cmpOpts').onchange = (e) => { const k = e.target.dataset.k; if (!k) return; opt[k] = e.target.checked; Store.set(OKEY, opt); if (last) run(); };

    regions = await Data.regions();
    const sidos = [...new Set(regions.map(r => r[1]))];
    const savedReg = Store.get('apt.lastRegion', null);
    document.querySelectorAll('#tab-compare .slot').forEach((el, i) => {
      const s = { el, i, idx: { c: {} }, q: (c) => el.querySelector(c) };
      slots.push(s);
      s.q('.cSido').innerHTML = sidos.map(x => `<option>${U.esc(x)}</option>`).join('');
      if (savedReg && sidos.includes(savedReg.sido)) s.q('.cSido').value = savedReg.sido;
      s.q('.cSido').onchange = () => fillSgg(s);
      s.q('.cSgg').onchange = () => fillApt(s, true);
      s.q('.cFind').oninput = () => fillApt(s, false);
      s.q('.cApt').onchange = () => fillArea(s);
      fillSgg(s, savedReg?.code);
    });
    setPreset(5);
    $('cmpPresets').onclick = (e) => { const y = +e.target.dataset.y; if (y) { setPreset(y); if (last) run(); } };
    $('cmpFrom').onchange = $('cmpTo').onchange = () => { markPreset(0); if (last) run(); };
    $('cmpKind').onchange = $('cmpMode').onchange = () => { if (last) run(); };
    $('btnCompare').onclick = run;
  }

  function markPreset(y) { $('cmpPresets').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.y === y)); }
  function setPreset(y) {
    const now = new Date();
    $('cmpTo').value = dateText(now);
    $('cmpFrom').value = dateText(new Date(now.getFullYear() - y, now.getMonth(), now.getDate()));
    $('cmpFrom').min = $('cmpTo').min = dateText(new Date(now.getFullYear() - 20, now.getMonth(), now.getDate()));
    $('cmpFrom').max = $('cmpTo').max = dateText(now);
    markPreset(y);
  }

  function fillSgg(s, code) {
    const list = regions.filter(r => r[1] === s.q('.cSido').value);
    s.q('.cSgg').innerHTML = list.map(r => `<option value="${r[0]}">${U.esc(r[2])}</option>`).join('');
    if (code && list.some(r => r[0] === code)) s.q('.cSgg').value = code;
    fillApt(s, true);
  }

  async function fillApt(s, reload) {
    const code = s.q('.cSgg').value;
    if (reload) { s.idx = await Data.index(code); if (code !== s.q('.cSgg').value) return; }
    const find = s.q('.cFind').value.trim().toLowerCase();
    const keys = Object.keys(s.idx.c).map(k => ({ k, ...Data.parseKey(k) }))
      .filter(x => !find || x.name.toLowerCase().includes(find) || x.dong.includes(find))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    s.q('.cApt').innerHTML = `<option value="">${keys.length ? `선택하세요 (${keys.length}개)` : (Object.keys(s.idx.c).length ? '검색 결과 없음' : '수집된 자료 없음')}</option>` +
      keys.slice(0, 800).map(x => `<option value="${U.esc(x.k)}">${U.esc(x.name)} (${U.esc(x.dong)})</option>`).join('');
    if (find && keys.length === 1) s.q('.cApt').value = keys[0].k;
    fillArea(s);
  }

  /** 고른 단지의 평형 목록 (거래가 많은 평형이 기본) */
  async function fillArea(s) {
    const code = s.q('.cSgg').value, key = s.q('.cApt').value, sel = s.q('.cArea');
    if (!key) { sel.innerHTML = ''; return; }
    sel.innerHTML = '<option>불러오는 중…</option>';
    const y = new Date().getFullYear();
    let tr = await Data.complexTrades(code, key, null, y - 5, y);
    if (!tr.sale.length && !tr.rent.length) tr = await Data.complexTrades(code, key, null, y - 20, y);
    if (key !== s.q('.cApt').value) return;
    const cnt = new Map();
    [...tr.sale, ...tr.rent].forEach(t => cnt.set(t.g, (cnt.get(t.g) || 0) + 1));
    const best = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0];
    sel.innerHTML = [...cnt.keys()].sort((a, b) => a - b).map(g => `<option value="${g}">${g}㎡ (${CONFIG.toPyeong(g)}평) · ${cnt.get(g)}건</option>`).join('');
    if (best) sel.value = best[0];
  }

  /** 월평균 [{x, y, n, ym}] */
  function monthly(arr) {
    const m = new Map();
    for (const t of arr) { const ym = Math.floor(t.d / 100); const v = m.get(ym) || [0, 0]; v[0] += t.price; v[1]++; m.set(ym, v); }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([ym, v]) => ({ x: new Date(Math.floor(ym / 100), ym % 100 - 1, 15).getTime(), y: v[0] / v[1] / 10000, n: v[1], ym }));
  }

  async function run() {
    let a = toNum($('cmpFrom').value || ''), b = toNum($('cmpTo').value || '');
    if (!a || !b) return U.toast('시작일과 종료일을 고르세요.');
    if (a > b) [a, b] = [b, a];
    const picked = slots.filter(s => s.q('.cApt').value && s.q('.cArea').value && !isNaN(+s.q('.cArea').value));
    if (!picked.length) return U.toast('비교할 단지를 고르세요. (단지와 평형까지)');
    const btn = $('btnCompare');
    btn.disabled = true; btn.textContent = '불러오는 중…';
    try {
      const kind = $('cmpKind').value, nowY = new Date().getFullYear(), peakY = Math.floor(CONFIG.PEAK_FROM / 10000);
      const keep = (t) => !(opt.noLow && t.floor >= 1 && t.floor <= 3);
      const res = [];
      for (const s of picked) {
        const code = s.q('.cSgg').value, key = s.q('.cApt').value, g = +s.q('.cArea').value;
        const reg = regions.find(r => r[0] === code);
        const tr = await Data.complexTrades(code, key, g, Math.min(Math.floor(a / 10000), peakY), nowY);
        const sale = tr.sale.filter(t => keep(t) && !(opt.noDirect && t.direct)), rent = tr.rent.filter(keep);
        const inP = (t) => t.d >= a && t.d <= b;
        res.push({ s, i: s.i, id: `${code}|${key}#${g}`, code, key, g, sido: reg[1], sgg: reg[2], ...Data.parseKey(key), buildYear: s.idx.c[key] || null,
          sale, rent, saleP: sale.filter(inP), rentP: rent.filter(inP),
          main: (kind === 'sale' ? sale : rent).filter(inP), st: Data.stats(sale.filter(t => !t.direct), rent, false) });
      }
      res.forEach(r => { r.mon = monthly(r.main); r.monAll = monthly(kind === 'sale' ? r.sale : r.rent); });
      last = res;
      $('cmpEmpty').hidden = true; $('cmpBody').hidden = false;
      document.querySelectorAll('#cmpBody [data-opt]').forEach(el => {
        const k = el.dataset.opt;
        el.hidden = k === 'loc' ? !(opt.traffic || opt.school || opt.env || opt.hoje) : !opt[k];
      });
      draw(res, kind);
      if (opt.quote) quoteTable(res);
      if (opt.ret) returnTable(res, kind, a);
      if (opt.basic) basicTable(res, kind, a, b);
      if (opt.monthly) monthlyTable(res);
      if (opt.traffic || opt.school || opt.env || opt.hoje) {
        Loc.fill($('cmpLoc'), res.map(r => ({ r, title: `${NAMES[r.i]} · ${r.name}`, cls: r.i ? 'rent' : 'sale' })), ['traffic', 'school', 'env', 'hoje'].filter(k => opt[k]));
      }
      if (opt.map) place(res);
    } catch (e) {
      console.error(e); U.toast('비교 중 오류가 났습니다: ' + (e.message || e));
    } finally {
      btn.disabled = false; btn.textContent = '비교하기';
    }
  }

  /* ── 그래프 ── */
  function draw(res, kind) {
    const css = getComputedStyle(document.documentElement), col = (n) => css.getPropertyValue(n).trim();
    const mode = $('cmpMode').value;
    const toX = (d) => new Date(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100).getTime();
    const sets = [], marks = [];
    let maxN = 1;
    res.forEach(r => {
      const c = col(COLORS[r.i]), label = `${NAMES[r.i]} ${r.name} ${r.g}㎡`;
      if (mode !== 'point') sets.push({ label: label + ' (월평균)', data: r.mon, borderColor: c, backgroundColor: c, showLine: true, borderWidth: 2.5, pointRadius: 2, tension: 0.15, yAxisID: 'y', order: 1 });
      if (mode !== 'month') sets.push({ label: label + ' (실거래)', data: r.main.map(t => ({ x: toX(t.d), y: t.price / 10000, t })), backgroundColor: c + (mode === 'both' ? '66' : ''), borderColor: 'transparent', pointRadius: 2.5, pointStyle: r.i ? 'rect' : 'circle', yAxisID: 'y', order: 2 });
      if (opt.vol && r.mon.length) {
        maxN = Math.max(maxN, ...r.mon.map(p => p.n));
        sets.push({ type: 'bar', label: `${NAMES[r.i]} 거래 건수`, data: r.mon.map(p => ({ x: p.x, y: p.n, ym: p.ym })), backgroundColor: c + '55', barThickness: 3, yAxisID: 'y2', order: 3 });
      }
      if (opt.peak && r.main.length) {      // 기간 안의 최고·최저 거래
        const hi = r.main.reduce((p, t) => (t.price >= p.price ? t : p)), lo = r.main.reduce((p, t) => (t.price < p.price ? t : p));
        marks.push({ x: toX(hi.d), y: hi.price / 10000, text: `${NAMES[r.i]} 전고 ${eokText(hi.price)}`, c, up: true }, { x: toX(lo.d), y: lo.price / 10000, text: `${NAMES[r.i]} 전저 ${eokText(lo.price)}`, c, up: false });
      }
    });
    const xs = sets.flatMap(d => d.data.map(p => p.x));
    const shortSpan = xs.length && Math.max(...xs) - Math.min(...xs) < 400 * 864e5;
    if (chart) chart.destroy();
    chart = new Chart($('cmpChart'), {
      type: 'scatter', data: { datasets: sets },
      options: {
        maintainAspectRatio: false, animation: false,
        scales: {
          x: { type: 'linear', ticks: { color: col('--sub'), maxTicksLimit: 12, callback: (v) => { const d = new Date(v); const ym = `${String(d.getFullYear()).slice(2)}.${String(d.getMonth() + 1).padStart(2, '0')}`; return shortSpan ? `${ym}.${String(d.getDate()).padStart(2, '0')}` : ym; } }, grid: { color: col('--line') } },
          y: { ticks: { color: col('--sub'), callback: (v) => v + '억' }, grid: { color: col('--line') } },
          y2: { display: false, beginAtZero: true, max: maxN * 5 },      // 막대가 아래쪽 1/5 만 차지하게
        },
        plugins: {
          legend: { labels: { color: col('--text'), usePointStyle: true, filter: (it, d) => d.datasets[it.datasetIndex].type !== 'bar' } },
          tooltip: { callbacks: { label: (c) => (c.dataset.type === 'bar' ? `${c.dataset.label} ${c.raw.y}건 · ${String(c.raw.ym).slice(2, 4)}.${String(c.raw.ym).slice(4)}` : c.raw.t ? `${c.dataset.label} ${U.price(c.raw.t.price)} · ${U.date(c.raw.t.d)} · ${c.raw.t.floor}층` : `${c.dataset.label} ${U.price(Math.round(c.raw.y * 10000))} · ${String(c.raw.ym).slice(2, 4)}.${String(c.raw.ym).slice(4)} · ${c.raw.n}건`) } },
        },
      },
      plugins: [{   // 전고·전저 표시
        id: 'peakMarks',
        afterDatasetsDraw(ch) {
          const ctx = ch.ctx, X = ch.scales.x, Y = ch.scales.y;
          ctx.save(); ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center';
          for (const m of marks) {
            const px = X.getPixelForValue(m.x), py = Y.getPixelForValue(m.y);
            ctx.fillStyle = m.c; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            const w = ctx.measureText(m.text).width + 10, tx = Math.min(Math.max(px, ch.chartArea.left + w / 2), ch.chartArea.right - w / 2), ty = m.up ? py - 14 : py + 20;
            ctx.fillStyle = '#000c'; ctx.fillRect(tx - w / 2, ty - 11, w, 16);
            ctx.fillStyle = '#fff'; ctx.fillText(m.text, tx, ty + 1);
          }
          ctx.restore();
        },
      }],
    });
    const kname = kind === 'sale' ? '매매' : '전세';
    $('cmpCards').innerHTML = res.map(r => {
      const lastP = r.mon[r.mon.length - 1], first = r.mon[0];
      const chg = lastP && first && r.mon.length > 1 ? (lastP.y / first.y - 1) * 100 : null;
      return `<div class="card"><div class="k">${NAMES[r.i]} · ${U.esc(r.name)} ${r.g}㎡ · ${kname}</div><div class="v ${r.i ? 'rent' : 'sale'}">${lastP ? U.price(Math.round(lastP.y * 10000)) : '-'}</div><div class="s">기간 중 <span class="${U.cls(chg)}">${U.pct(chg)}</span> · ${r.main.length}건</div></div>`;
    }).join('') + (res.length === 2 && res[0].mon.length && res[1].mon.length
      ? (() => { const x = res[0].mon[res[0].mon.length - 1].y, y = res[1].mon[res[1].mon.length - 1].y; return `<div class="card"><div class="k">최근 월평균 차이 (A - B)</div><div class="v">${U.diff(Math.round((x - y) * 10000))}</div><div class="s">A 가 B 의 ${(x / y * 100).toFixed(0)}%</div></div>`; })() : '');
  }

  const th = (res) => '<thead><tr><th class="l">항목</th>' + res.map(r => `<th class="${r.i ? 'rent' : 'sale'}">${NAMES[r.i]} · ${U.esc(r.name)} ${r.g}㎡</th>`).join('') + '</tr></thead>';
  const rowsHtml = (res, defs) => '<tbody>' + defs.map(([name, fn]) => `<tr><td class="l">${name}</td>${res.map(r => `<td>${fn(r)}</td>`).join('')}</tr>`).join('') + '</tbody>';

  /* ── 호가 흐름과 투자금 (시세트래킹·전수조사에 적은 값) ── */
  function quoteTable(res) {
    const flow = (r, f) => {
      const rc = Tracking.rec(r.id); if (!rc) return null;
      const ms = Object.keys(rc.quotes).map(Number).sort((a, b) => a - b).filter(m => rc.quotes[m][f] != null);
      return ms.length ? { ms, vals: ms.map(m => rc.quotes[m][f]) } : null;
    };
    const show = (r, f) => {
      const x = flow(r, f);
      if (!x) return '<small>적어 둔 호가 없음</small>';
      const lastV = x.vals[x.vals.length - 1];
      return `<b>${eokText(lastV)}</b>` + (x.vals.length > 1 ? ` <small>(${x.vals.map(v => +(v / 10000).toFixed(2)).join(' → ')})</small>` : '') + `<br><small>${x.ms.map(m => `${String(m).slice(2, 4)}.${String(m).slice(4)}`).join(' → ')}</small>`;
    };
    $('cmpQuote').innerHTML = th(res) + rowsHtml(res, [
      ['매매 호가', r => show(r, 's')],
      ['전세 호가', r => show(r, 'r')],
      ['투자금 (매-전)', r => { const s = flow(r, 's'), x = flow(r, 'r'); return s && x ? `<b>${U.price(s.vals[s.vals.length - 1] - x.vals[x.vals.length - 1])}</b>` : (r.st.last && r.st.rentLast ? `${U.price(r.st.last.price - r.st.rentLast.price)} <small>실거래 기준</small>` : '-'); }],
      ['트래킹', r => (Tracking.has(r.id) ? '★ 담겨 있음' : `<button class="mini" data-track="${r.i}">시세트래킹에 담기</button>`)],
    ]);
    $('cmpQuote').onclick = (e) => { const i = e.target.dataset.track; if (i == null) return; const r = res.find(x => x.i === +i); Tracking.add([r]); quoteTable(res); };
  }

  /* ── 수익률 표: 과거 시점 월평균 → 최근 월평균 ── */
  function returnTable(res, kind, a) {
    const at = (r, ym) => {      // 그 달에서 가장 가까운 월평균 (앞뒤 3개월 안)
      let best = null;
      for (const p of r.monAll) { const gap = Math.abs((Math.floor(p.ym / 100) * 12 + p.ym % 100) - (Math.floor(ym / 100) * 12 + ym % 100)); if (gap <= 3 && (!best || gap < best.gap)) best = { ...p, gap }; }
      return best;
    };
    const now = new Date(), back = (y) => (now.getFullYear() - y) * 100 + now.getMonth() + 1;
    const cell = (r, ym) => {
      const cur = r.monAll[r.monAll.length - 1], old = at(r, ym);
      if (!cur || !old || old.ym === cur.ym) return '-';
      const pct = (cur.y / old.y - 1) * 100;
      return `<span class="${U.cls(pct)}"><b>${U.pct(pct)}</b></span> <small>${eokText(old.y * 10000)} → ${eokText(cur.y * 10000)}</small>`;
    };
    $('cmpRet').innerHTML = th(res) + rowsHtml(res, [
      [`최근 월평균 (${kind === 'sale' ? '매매' : '전세'})`, r => { const c = r.monAll[r.monAll.length - 1]; return c ? `<b>${eokText(c.y * 10000)}</b> <small>${String(c.ym).slice(2, 4)}.${String(c.ym).slice(4)}</small>` : '-'; }],
      ['1년 전 대비', r => cell(r, back(1))], ['3년 전 대비', r => cell(r, back(3))], ['5년 전 대비', r => cell(r, back(5))],
      ['조회 시작 시점 대비', r => cell(r, Math.floor(a / 100))],
    ]);
  }

  /* ── 기본 비교표 ── */
  function basicTable(res, kind, a, b) {
    $('cmpTable').innerHTML = th(res) + rowsHtml(res, [
      ['위치', r => `${U.esc(r.sgg)} ${U.esc(r.dong)} <button class="mini" data-map="${r.i}">지도</button>`],
      ['연식', r => (r.buildYear ? `${r.buildYear}년 (${CONFIG.toAge(r.buildYear)}년차)` : '-')],
      ['평형', r => `전용 ${r.g}㎡ (${CONFIG.toPyeong(r.g)}평)`],
      [`기간 내 ${kind === 'sale' ? '매매' : '전세'} 건수`, r => r.main.length + '건'],
      ['기간 최고가 / 최저가', r => (r.main.length ? `${U.price(Math.max(...r.main.map(t => t.price)))} / ${U.price(Math.min(...r.main.map(t => t.price)))}` : '-')],
      ['최근 매매 실거래', r => (r.st.last ? `${U.price(r.st.last.price)}<small>${U.date(r.st.last.d)}</small>` : '-')],
      ['전고점 (2020년~)', r => (r.st.peak ? `${U.price(r.st.peak.price)}<small>${U.date(r.st.peak.d)}</small>` : '-')],
      ['전고 대비', r => `<span class="${U.cls(r.st.drop)}">${U.pct(r.st.drop)}</span>`],
      ['전저점 (2020년~)', r => (r.st.trough ? `${U.price(r.st.trough.price)}<small>${U.date(r.st.trough.d)}</small>` : '-')],
      ['전저 대비', r => `<span class="${U.cls(r.st.rise)}">${U.pct(r.st.rise)}</span>`],
      ['최근 전세 실거래', r => (r.st.rentLast ? `${U.price(r.st.rentLast.price)}<small>${U.date(r.st.rentLast.d)}</small>` : '-')],
      ['전세가율 / 매-전', r => (r.st.ratio == null ? '-' : `${r.st.ratio.toFixed(0)}% / ${U.price(r.st.last.price - r.st.rentLast.price)}`)],
    ]);
    $('cmpTable').onclick = (e) => { const i = e.target.dataset.map; if (i != null) App.showMap(res.find(r => r.i === +i)); };
    $('cmpNote').textContent = `기간: ${U.date(a)} ~ ${U.date(b)}` + (opt.noDirect ? ' · 직거래 숨김' : '') + (opt.noLow ? ' · 1~3층 제외' : '');
  }

  /* ── 월별 실거래 비교표: 달(세로) × 단지별 매매·전세(가로) ── */
  function monthlyTable(res) {
    const yms = new Set();
    res.forEach(r => [...r.saleP, ...r.rentP].forEach(t => yms.add(Math.floor(t.d / 100))));
    const list = [...yms].sort((a, b) => b - a);
    const cell = (arr, ym, cls) => arr.filter(t => Math.floor(t.d / 100) === ym).sort((x, y) => y.d - x.d)
      .map(t => `<div>${t.d % 100}일 <b class="${cls}">${(t.price / 10000).toFixed(2)}억</b><small>${t.floor}층${t.direct ? ' · 직' : ''}</small></div>`).join('') || '<small>·</small>';
    $('cmpMonthly').innerHTML = '<thead><tr><th>연월</th>' + res.map(r => `<th class="sale">${NAMES[r.i]} ${U.esc(r.name)} 매매</th>`).join('') + res.map(r => `<th class="rent">${NAMES[r.i]} ${U.esc(r.name)} 전세</th>`).join('') + '</tr></thead><tbody>' +
      (list.length ? list.map(ym => `<tr><td class="ym">${String(ym).slice(2, 4)}.${String(ym).slice(4)}</td>` + res.map(r => `<td>${cell(r.saleP, ym, 'sale')}</td>`).join('') + res.map(r => `<td>${cell(r.rentP, ym, 'rent')}</td>`).join('') + '</tr>').join('')
        : `<tr><td colspan="${res.length * 2 + 1}" style="color:var(--sub);padding:20px">기간 안에 거래가 없습니다.</td></tr>`) + '</tbody>';
  }

  const isCapital = (r) => /^(서울|경기|인천)/.test(r.sido);

  /* ── 카카오맵: 단지 위치(빨간 점), 단지 간·강남역까지 직선거리(점선) ── */
  async function place(res) {
    const seq = ++placeSeq, hub = CONFIG.HUB, msg = $('cmpMapMsg'), cards = $('cmpDist');
    const say = (html) => { msg.innerHTML = html; msg.hidden = false; cards.innerHTML = ''; shapes.forEach(x => x.remove()); shapes = []; };
    const cap = res.filter(isCapital);
    if (!KMap.ready()) return say(KMap.needKeyHtml);
    if (!cap.length) return say('서울·경기·인천 단지를 고르면 지도와 거리가 표시됩니다.');
    try {
      await KMap.load();
      for (const r of cap) r.pos = await KMap.geocode(r);
    } catch (e) { return say(U.esc(e.message || String(e))); }
    if (seq !== placeSeq) return;
    const ok = cap.filter(r => r.pos);
    if (!ok.length) return say('단지 위치를 찾지 못했습니다.');
    msg.hidden = true;
    if (!kmap) kmap = KMap.create($('cmpMap'), hub, 8);
    shapes.forEach(x => x.remove()); shapes = [];
    shapes.push(KMap.dot(kmap, hub, hub.name, '#1c1c1e'));
    ok.forEach(r => {
      shapes.push(KMap.dot(kmap, r.pos, `${NAMES[r.i]} ${r.name}`, '#ff3b30'));
      const l = KMap.line(kmap, r.pos, hub, '#ff3b30'); r.hubKm = l.km; shapes.push(l);
    });
    let between = null;
    if (ok.length === 2) { between = KMap.line(kmap, ok[0].pos, ok[1].pos, '#1c1c1e'); shapes.push(between); }
    kmap.relayout();
    KMap.fit(kmap, [hub, ...ok.map(r => r.pos)]);
    cards.innerHTML = ok.map(r => `<div class="card"><div class="k">${NAMES[r.i]} · ${U.esc(r.name)} → ${hub.name}</div><div class="v">${r.hubKm.toFixed(1)}km</div>` +
      `<div class="s">직선거리${r.pos.exact ? '' : ' (동 중심 기준)'} · <a class="btn mini" target="_blank" rel="noopener" href="https://map.kakao.com/link/from/${encodeURIComponent(r.name)},${r.pos.lat},${r.pos.lng}/to/${encodeURIComponent(hub.name)},${hub.lat},${hub.lng}">카카오맵 길찾기</a></div></div>`).join('') +
      (between ? `<div class="card"><div class="k">단지 간 직선거리 (A ↔ B)</div><div class="v">${between.km.toFixed(1)}km</div><div class="s">${hub.name}까지 거리 차이 ${Math.abs(ok[0].hubKm - ok[1].hubKm).toFixed(1)}km</div></div>` : '');
  }

  return { init };
})();
