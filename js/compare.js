/* ─────────────────────────────────────────────────────────
   compare.js — [단지 비교] 탭
   단지 2개까지 시세 흐름을 한 그래프에 겹쳐 보고, 비교표(가격·등락·강남역 거리)를 보여 줍니다.
   ───────────────────────────────────────────────────────── */
const Compare = (() => {
  const $ = (id) => document.getElementById(id);
  const NAMES = ['A', 'B'], COLORS = ['--accent', '--rent'];
  let regions = [], chart = null, kmap = null, shapes = [], placeSeq = 0;
  const slots = [];   // { el, idx(단지 색인), areas }

  const dateText = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const toNum = (text) => +text.replace(/-/g, '');

  async function init() {
    regions = await Data.regions();
    const sidos = [...new Set(regions.map(r => r[1]))];
    const saved = Store.get('apt.lastRegion', null);
    document.querySelectorAll('#tab-compare .slot').forEach((el, i) => {
      const s = { el, i, idx: { c: {} }, q: (c) => el.querySelector(c) };
      slots.push(s);
      s.q('.cSido').innerHTML = sidos.map(x => `<option>${U.esc(x)}</option>`).join('');
      if (saved && sidos.includes(saved.sido)) s.q('.cSido').value = saved.sido;
      s.q('.cSido').onchange = () => fillSgg(s);
      s.q('.cSgg').onchange = () => fillApt(s, true);
      s.q('.cFind').oninput = () => fillApt(s, false);
      s.q('.cApt').onchange = () => fillArea(s);
      fillSgg(s, saved?.code);
    });
    setPreset(5);
    $('cmpPresets').onclick = (e) => { const y = +e.target.dataset.y; if (y) { setPreset(y); if (!$('cmpBody').hidden) run(); } };
    $('cmpFrom').onchange = $('cmpTo').onchange = () => { markPreset(0); if (!$('cmpBody').hidden) run(); };
    $('cmpKind').onchange = $('cmpMode').onchange = () => { if (!$('cmpBody').hidden) run(); };
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

  /** 월평균 [{x, y, n}] */
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
      const kind = $('cmpKind').value, nowY = new Date().getFullYear();
      const peakY = Math.floor(CONFIG.PEAK_FROM / 10000);
      const res = [];
      for (const s of picked) {
        const code = s.q('.cSgg').value, key = s.q('.cApt').value, g = +s.q('.cArea').value;
        const reg = regions.find(r => r[0] === code);
        const tr = await Data.complexTrades(code, key, g, Math.min(Math.floor(a / 10000), peakY), nowY);
        const sale = tr.sale.filter(t => !t.direct);
        const main = (kind === 'sale' ? sale : tr.rent).filter(t => t.d >= a && t.d <= b);
        res.push({ s, code, key, g, sido: reg[1], sgg: reg[2], ...Data.parseKey(key), buildYear: s.idx.c[key] || null,
          main, mon: monthly(main), st: Data.stats(sale, tr.rent, false) });
      }
      $('cmpEmpty').hidden = true; $('cmpBody').hidden = false;
      draw(res, kind);
      table(res, kind, a, b);
      place(res);
    } catch (e) {
      console.error(e); U.toast('비교 중 오류가 났습니다: ' + (e.message || e));
    } finally {
      btn.disabled = false; btn.textContent = '비교하기';
    }
  }

  function draw(res, kind) {
    const css = getComputedStyle(document.documentElement), col = (n) => css.getPropertyValue(n).trim();
    const mode = $('cmpMode').value;
    const toX = (d) => new Date(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100).getTime();
    const sets = [];
    res.forEach(r => {
      const c = col(COLORS[r.s.i]), label = `${NAMES[r.s.i]} ${r.name} ${r.g}㎡`;
      if (mode !== 'point') sets.push({ label: label + ' (월평균)', data: r.mon, borderColor: c, backgroundColor: c, showLine: true, borderWidth: 2.5, pointRadius: 2, tension: 0.15 });
      if (mode !== 'month') sets.push({ label: label + ' (실거래)', data: r.main.map(t => ({ x: toX(t.d), y: t.price / 10000, t })), backgroundColor: c + (mode === 'both' ? '66' : ''), borderColor: 'transparent', pointRadius: 2.5, pointStyle: r.s.i ? 'rect' : 'circle' });
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
        },
        plugins: {
          legend: { labels: { color: col('--text'), usePointStyle: true } },
          tooltip: { callbacks: { label: (c) => (c.raw.t ? `${c.dataset.label} ${U.price(c.raw.t.price)} · ${U.date(c.raw.t.d)} · ${c.raw.t.floor}층` : `${c.dataset.label} ${U.price(Math.round(c.raw.y * 10000))} · ${String(c.raw.ym).slice(2, 4)}.${String(c.raw.ym).slice(4)} · ${c.raw.n}건`) } },
        },
      },
    });
    const kname = kind === 'sale' ? '매매' : '전세';
    $('cmpCards').innerHTML = res.map(r => {
      const last = r.mon[r.mon.length - 1], first = r.mon[0];
      const chg = last && first && r.mon.length > 1 ? (last.y / first.y - 1) * 100 : null;
      return `<div class="card"><div class="k">${NAMES[r.s.i]} · ${U.esc(r.name)} ${r.g}㎡ · ${kname}</div><div class="v ${r.s.i ? 'rent' : 'sale'}">${last ? U.price(Math.round(last.y * 10000)) : '-'}</div><div class="s">기간 중 <span class="${U.cls(chg)}">${U.pct(chg)}</span> · ${r.main.length}건</div></div>`;
    }).join('') + (res.length === 2 && res[0].mon.length && res[1].mon.length
      ? (() => { const x = res[0].mon[res[0].mon.length - 1].y, y = res[1].mon[res[1].mon.length - 1].y; return `<div class="card"><div class="k">최근 월평균 차이 (A - B)</div><div class="v">${U.diff(Math.round((x - y) * 10000))}</div><div class="s">A 가 B 의 ${(x / y * 100).toFixed(0)}%</div></div>`; })() : '');
  }

  /* ── 비교표 ── */
  function table(res, kind, a, b) {
    const rowsDef = [
      ['위치', r => `${U.esc(r.sgg)} ${U.esc(r.dong)} <button class="mini" data-map="${r.s.i}">지도</button>`],
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
    ];
    $('cmpTable').innerHTML = '<thead><tr><th class="l">항목</th>' + res.map(r => `<th class="${r.s.i ? 'rent' : 'sale'}">${NAMES[r.s.i]} · ${U.esc(r.name)}</th>`).join('') + '</tr></thead><tbody>' +
      rowsDef.map(([name, fn]) => `<tr><td class="l">${name}</td>${res.map(r => `<td>${fn(r)}</td>`).join('')}</tr>`).join('') + '</tbody>';
    $('cmpTable').onclick = (e) => { const i = e.target.dataset.map; if (i != null) App.showMap(res.find(r => r.s.i === +i)); };
    $('cmpNote').textContent = `기간: ${U.date(a)} ~ ${U.date(b)}`;
  }

  /* ── 카카오맵: 단지 위치(빨간 점), 단지 간·강남역까지 직선거리(점선), 대중교통 접근성 카드 ── */
  async function place(res) {
    const seq = ++placeSeq, hub = CONFIG.HUB, msg = $('cmpMapMsg'), cards = $('cmpTransit');
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
      shapes.push(KMap.dot(kmap, r.pos, `${NAMES[r.s.i]} ${r.name}`, '#ff3b30'));
      const l = KMap.line(kmap, r.pos, hub, '#ff3b30'); r.hubKm = l.km; shapes.push(l);
    });
    let between = null;
    if (ok.length === 2) { between = KMap.line(kmap, ok[0].pos, ok[1].pos, '#1c1c1e'); shapes.push(between); }
    kmap.relayout();
    KMap.fit(kmap, [hub, ...ok.map(r => r.pos)]);

    // 대중교통 카드: ODsay 키가 있으면 자동, 없으면 직접 입력(브라우저에 저장)
    const manual = Store.get('apt.transit.v1', {});
    cards.innerHTML = ok.map(r => `<div class="card" data-id="${U.esc(r.code + '|' + r.key)}"><div class="k">${NAMES[r.s.i]} · ${U.esc(r.name)}</div>
      <div class="v big" data-t>…</div>
      <div class="s">${hub.name}까지 직선 ${r.hubKm.toFixed(1)}km${r.pos.exact ? '' : ' (동 중심 기준)'}</div>
      <div class="s" style="margin-top:6px"><a class="btn mini" target="_blank" rel="noopener" href="https://map.kakao.com/link/from/${encodeURIComponent(r.name)},${r.pos.lat},${r.pos.lng}/to/${encodeURIComponent(hub.name)},${hub.lat},${hub.lng}">카카오맵 길찾기</a></div></div>`).join('') +
      (between ? `<div class="card"><div class="k">단지 간 직선거리 (A ↔ B)</div><div class="v big">${between.km.toFixed(1)}km</div><div class="s">${hub.name}까지 거리 차이 ${Math.abs(ok[0].hubKm - ok[1].hubKm).toFixed(1)}km</div></div>` : '');
    for (const r of ok) {
      const card = cards.querySelector(`[data-id="${CSS.escape(r.code + '|' + r.key)}"]`), slot = card.querySelector('[data-t]');
      const t = await KMap.transit(r.pos, hub);
      if (seq !== placeSeq) return;
      if (t) { slot.innerHTML = `${t.minutes}분 <small>환승 ${t.transfers}회</small>`; continue; }
      const m = manual[r.code + '|' + r.key] || {};
      slot.classList.remove('big');
      slot.innerHTML = `<input data-k="min" inputmode="numeric" placeholder="분" value="${U.esc(m.min ?? '')}"> 분 · 환승 <input data-k="tr" inputmode="numeric" placeholder="회" value="${U.esc(m.tr ?? '')}"> 회`;
      card.insertAdjacentHTML('beforeend', `<div class="s">${CONFIG.ODSAY_KEY ? '자동 계산에 실패했습니다. ' : ''}길찾기에서 확인한 시간을 적어 두면 저장됩니다.</div>`);
    }
    cards.onchange = (e) => {
      const card = e.target.closest('[data-id]');
      if (!card || !e.target.dataset.k) return;
      const all = Store.get('apt.transit.v1', {});
      (all[card.dataset.id] = all[card.dataset.id] || {})[e.target.dataset.k] = e.target.value.trim();
      Store.set('apt.transit.v1', all);
    };
  }

  const isCapital = (r) => /^(서울|경기|인천)/.test(r.sido);

  return { init };
})();
