/* ─────────────────────────────────────────────────────────
   migration.js — [인구이동] 탭: 시군구 순이동 지도 · 월별 순이동 그래프(+입주 물량) · 시도 간 이동 · 순위표
   자료: data/migration.json (scripts/migration.py · 매주 KOSIS 확인), data/population.json (순이동률), data/supply.json (입주 물량)
   저장: apt.migration.v1 (지역 · 기간 · 기준 월 · 고른 지역)
   ───────────────────────────────────────────────────────── */
const Migration = (() => {
  const $ = (id) => document.getElementById(id);
  const SK = 'apt.migration.v1';
  const C_IN = '#d95926', C_OUT = '#3987e5';               // 순유입 주황 / 순유출 파랑
  let st = {}, K = null, mg = null, status = null, pop = {}, sup = [], f = null, chart1 = null, chart2 = null, map = null, marks = [], rows = [];
  const geo = new Map();                                     // 이번 접속 동안만 (카카오 정책)
  const save = () => Store.set(SK, st);
  const DEF = () => ({ regs: ['g:seoul'], per: 3, ym: null, sel: null });
  const ymTxt = (m) => `${String(m).slice(0, 4)}.${String(m).slice(4, 6)}`;
  const fmt = (v) => (v == null ? '-' : (v > 0 ? '+' : '') + Math.round(v).toLocaleString());
  const visible = () => !$('tab-migration').hidden;

  /* ── 자료 꺼내기 ── */
  // KOSIS 는 수원·성남·고양·용인·안양·안산·부천을 일반구 없이 '시'로만 줌 → 구 코드를 시 코드로 바꿔서 봄 (mg.alias)
  const al = (c) => (mg.alias && mg.alias[c]) || c;
  const codes = () => [...new Set(st.regs.flatMap(t => K.codesOf(t)).map(al))].filter(c => mg.sgg[c]);
  const regOf = (c) => K.reg(c) || (mg.names && mg.names[c] ? [c, mg.names[c][0], mg.names[c][1]] : null);
  const gusOf = (c) => (mg.alias ? Object.keys(mg.alias).filter(g => mg.alias[g] === c) : []).concat(c);
  const lastYm = () => st.ym && mg.months.includes(st.ym) ? st.ym : (() => {   // 값이 있는 가장 최근 달
    for (let i = mg.months.length - 1; i >= 0; i--) if (Object.values(mg.sgg).some(s => s.net[i] != null)) return mg.months[i];
    return mg.months[mg.months.length - 1];
  })();
  function sumOf(code, kind, endYm, n) {
    const s = mg.sgg[code]; if (!s) return null;
    const j = mg.months.indexOf(endYm); if (j < 0) return null;
    let t = 0, got = 0;
    for (let i = Math.max(0, j - n + 1); i <= j; i++) if (s[kind][i] != null) { t += s[kind][i]; got++; }
    return got ? t : null;
  }
  const popOf = (c) => { const t = gusOf(c).reduce((s, g) => s + ((pop[g] && pop[g].pop) || 0), 0); return t || null; };
  function label(c) { const r = regOf(c); if (!r) return c; const [si, gu] = U.siGu(r[1], r[2]); return [si, gu].filter(Boolean).join(' '); }

  /* ── 요약 ── */
  function drawSummary(cs, end) {
    const n = st.per, prevEnd = mg.months[mg.months.indexOf(end) - n];
    const tot = (k, e) => cs.reduce((t, c) => t + (sumOf(c, k, e, n) || 0), 0);
    const net = tot('net', end), inn = tot('in', end), out = tot('out', end), prev = prevEnd ? tot('net', prevEnd) : null;
    const people = cs.reduce((t, c) => t + (popOf(c) || 0), 0);
    const rate = people ? net / people * 100 : null;
    const ranked = cs.map(c => [c, sumOf(c, 'net', end, n)]).filter(x => x[1] != null).sort((a, b) => b[1] - a[1]);
    const per = n === 1 ? ymTxt(end) : `${ymTxt(mg.months[Math.max(0, mg.months.indexOf(end) - n + 1)])}~${ymTxt(end)} (${n}개월)`;
    $('mgSum').innerHTML =
      `<div class="mgst"><div class="k">순이동 · ${per}</div><div class="v ${net >= 0 ? 'pos' : 'neg'}">${fmt(net)}<small>명</small></div><div class="s">${prev == null ? '' : `직전 같은 기간 ${fmt(prev)}명`}</div></div>` +
      `<div class="mgst"><div class="k">인구 대비 순이동률</div><div class="v ${rate >= 0 ? 'pos' : 'neg'}">${rate == null ? '-' : (rate > 0 ? '+' : '') + rate.toFixed(2) + '%'}</div><div class="s">${people ? `인구 ${people.toLocaleString()}명 기준` : '인구 자료 없음'}</div></div>` +
      `<div class="mgst"><div class="k">전입 / 전출</div><div class="v">${Math.round(inn).toLocaleString()} <small>/ ${Math.round(out).toLocaleString()}</small></div><div class="s">읍면동 경계를 넘은 이동 (주민등록 기준)</div></div>` +
      `<div class="mgst"><div class="k">가장 많이 들어온 곳 / 나간 곳</div><div class="s2">${ranked.length ? `<b class="pos">▲ ${U.esc(label(ranked[0][0]))} ${fmt(ranked[0][1])}</b><br><b class="neg">▼ ${U.esc(label(ranked[ranked.length - 1][0]))} ${fmt(ranked[ranked.length - 1][1])}</b>` : '-'}</div></div>`;
  }

  /* ── 지도: 시군구마다 원 (크기 = 순이동 규모, 색 = 유입/유출) ── */
  async function drawMap(cs, end) {
    if (!visible()) return;
    const msg = $('mgMapMsg');
    if (!KMap.ready()) { msg.innerHTML = KMap.needKeyHtml; $('mgMap').hidden = true; return; }
    try { await KMap.load(); } catch (e) { msg.textContent = e.message; return; }
    if (!map) map = KMap.create($('mgMap'), { lat: 36.4, lng: 127.8 }, 12); else map.relayout();
    marks.forEach(m => m.setMap(null)); marks = [];
    const S = kakao.maps.services, gc = new S.Geocoder();
    const list = cs.slice(0, 160);
    const vals = list.map(c => sumOf(c, 'net', end, st.per) || 0), mx = Math.max(1, ...vals.map(Math.abs));
    const find = (c) => new Promise(res => {
      if (geo.has(c)) return res(geo.get(c));
      const r = regOf(c); if (!r) return res(null);
      gc.addressSearch(`${r[1]} ${r[2]}`, (rs, s) => { const p = s === S.Status.OK && rs.length ? { lat: +rs[0].y, lng: +rs[0].x } : null; geo.set(c, p); res(p); });
    });
    const pts = [];
    msg.textContent = list.length ? `지역 위치 찾는 중… (0/${list.length})` : '고른 지역에 자료가 없습니다.';
    for (let i = 0; i < list.length; i++) {
      const c = list[i], p = await find(c); if (!p) continue;
      if (i % 10 === 9) msg.textContent = `지역 위치 찾는 중… (${i + 1}/${list.length})`;
      pts.push(p);
      const v = vals[i], sz = Math.round(16 + 46 * Math.sqrt(Math.abs(v) / mx));
      const el = document.createElement('div');
      el.className = 'mgdot ' + (v >= 0 ? 'pos' : 'neg') + (st.sel === c ? ' on' : '');
      el.style.width = el.style.height = sz + 'px';
      el.innerHTML = `<span>${U.esc((regOf(c) || [, , ''])[2].split(' ').pop())}<br><b>${fmt(v)}</b></span>`;
      el.title = `${label(c)} 순이동 ${fmt(v)}명`;
      el.onclick = () => { st.sel = st.sel === c ? null : c; save(); refresh(true); };
      const ov = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(p.lat, p.lng), content: el, yAnchor: 0.5, xAnchor: 0.5, zIndex: Math.round(Math.abs(v)) });
      ov.setMap(map); marks.push(ov);
    }
    if (pts.length) KMap.fit(map, pts);
    msg.textContent = `${pts.length}개 지역 · 원 크기 = 순이동 규모 · 주황 = 들어온 사람이 많음, 파랑 = 나간 사람이 많음 · 원을 누르면 그 지역 그래프${cs.length > 160 ? ' · 지역이 많아 160곳까지만' : ''}`;
  }

  /* ── 월별 순이동 + 입주 물량 ── */
  function drawCharts(cs) {
    const target = st.sel && cs.includes(st.sel) ? [st.sel] : cs;
    const ms = mg.months.slice(-36);
    const off = mg.months.length - ms.length;
    const net = ms.map((_, i) => { let t = 0, got = 0; target.forEach(c => { const v = mg.sgg[c].net[off + i]; if (v != null) { t += v; got++; } }); return got ? t : null; });
    const ma = net.map((_, i) => { const w = net.slice(Math.max(0, i - 11), i + 1).filter(v => v != null); return w.length >= 6 ? w.reduce((a, b) => a + b, 0) / w.length : null; });
    $('mgChartTitle').textContent = `월별 순이동 · ${st.sel && cs.includes(st.sel) ? label(st.sel) : `고른 지역 합계 (${cs.length}곳)`}`;
    $('mgSelClear').hidden = !(st.sel && cs.includes(st.sel));
    const labels = ms.map(ymTxt);
    const ds = [{ type: 'bar', label: '순이동', data: net, backgroundColor: net.map(v => (v >= 0 ? C_IN : C_OUT)), borderRadius: 3, maxBarThickness: 18, order: 2 },
      { type: 'line', label: '12개월 평균', data: ma, borderColor: CK.C.text(), borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, order: 1, spanGaps: true }];
    const opt = (yt) => ({ maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 12, autoSkip: true } }, y: { title: { display: true, text: yt }, ticks: { callback: (v) => v.toLocaleString(), maxTicksLimit: 5 } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.dataset.label} ${c.raw == null ? '-' : fmt(c.raw)}${yt}` } } } });
    if (chart1) { chart1.data.labels = labels; chart1.data.datasets = ds; chart1.update('none'); } else chart1 = new Chart($('mgChart1'), { data: { labels, datasets: ds }, options: opt('명') });
    // 입주 물량 (청약홈 · 일반분양 기준) — 같은 달 축
    const tset = new Set(target.flatMap(gusOf));
    const hh = ms.map(m => sup.filter(it => it.c && tset.has(it.c) && it.mv === m).reduce((t, it) => t + (it.hh || 0), 0));
    const ds2 = [{ type: 'bar', label: '입주', data: hh, backgroundColor: CK.alpha(CK.C.sub(), 0.55), borderRadius: 3, maxBarThickness: 18 }];
    $('mgChart2Wrap').hidden = !sup.length;
    if (sup.length) { if (chart2) { chart2.data.labels = labels; chart2.data.datasets = ds2; chart2.update('none'); } else chart2 = new Chart($('mgChart2'), { data: { labels, datasets: ds2 }, options: opt('세대') }); }
  }

  /* ── 시도 간 이동 ── */
  const short2 = (s) => (K.shortSido(s) || s).slice(0, 2);
  function drawOd(cs, end) {
    const box = $('mgOd'), od = mg.od || {};
    const sidos = [...new Set(cs.map(c => (regOf(c) || [])[1]).filter(Boolean))];
    if (!Object.keys(od).length || !sidos.length) { box.innerHTML = '<p class="hint">시도 간 이동 자료가 없습니다.</p>'; return; }
    const want = $('mgOdSido').value && sidos.includes($('mgOdSido').value) ? $('mgOdSido').value : sidos[0];
    $('mgOdSido').innerHTML = sidos.map(s => `<option value="${U.esc(s)}"${s === want ? ' selected' : ''}>${U.esc(K.shortSido(s))}</option>`).join('');
    $('mgOdSido').parentElement.hidden = sidos.length < 2;
    const me = short2(want);
    const match = (nm) => short2(nm) === me || (['광주', '전남'].includes(me) && /전남광주/.test(nm));
    const j = mg.months.indexOf(end), ms = mg.months.slice(Math.max(0, j - st.per + 1), j + 1).map(String);
    const inF = new Map(), outF = new Map();
    ms.forEach(m => (od[m] || []).forEach(([a, b, n]) => { if (match(b) && !match(a)) inF.set(a, (inF.get(a) || 0) + n); if (match(a) && !match(b)) outF.set(b, (outF.get(b) || 0) + n); }));
    const all = new Set([...inF.keys(), ...outF.keys()]);
    const nets = [...all].map(s => [s, (inF.get(s) || 0) - (outF.get(s) || 0), inF.get(s) || 0, outF.get(s) || 0]).sort((a, b) => b[1] - a[1]);
    const mx = Math.max(1, ...nets.map(x => Math.abs(x[1])));
    const row = ([s, n, i, o]) => `<div class="mgodr"><span class="nm">${U.esc(K.shortSido(s) || s)}</span><span class="bar"><i class="${n >= 0 ? 'pos' : 'neg'}" style="width:${Math.round(Math.abs(n) / mx * 100)}%"></i></span><b class="${n >= 0 ? 'pos' : 'neg'}">${fmt(n)}</b><small>들어옴 ${i.toLocaleString()} · 나감 ${o.toLocaleString()}</small></div>`;
    const ins = nets.filter(x => x[1] > 0).slice(0, 8), outs = nets.filter(x => x[1] < 0).reverse().slice(0, 8);
    box.innerHTML = `<div class="mgodc"><h4>${U.esc(K.shortSido(want))}(으)로 <span class="pos">더 많이 들어온</span> 곳</h4>${ins.map(row).join('') || '<p class="hint">없음</p>'}</div>` +
      `<div class="mgodc"><h4>${U.esc(K.shortSido(want))}에서 <span class="neg">더 많이 나간</span> 곳</h4>${outs.map(row).join('') || '<p class="hint">없음</p>'}</div>`;
  }

  /* ── 순위표 ── */
  function cols() {
    const N = ColFilter.numCol, T = ColFilter.txtCol;
    return {
      si: T('시', r => r.si), gu: T('구', r => r.gu),
      net: N('순이동', r => r.net, 'n'), rate: N('순이동률(%)', r => r.rate, 'n'), inn: N('전입', r => r.inn, 'n'), out: N('전출', r => r.out, 'n'),
      prev: N('직전 같은 기간 순이동', r => r.prev, 'n'), chg: N('직전 대비 변화', r => (r.prev == null || r.net == null ? null : r.net - r.prev), 'n'),
      y12: N('12개월 순이동', r => r.y12, 'n'), pop: N('인구', r => r.pop, 'n'),
    };
  }
  const F = () => f || (f = ColFilter.create({ key: 'mig', cols, bar: 'mgCfBar', onChange: drawTable }));
  function buildRows(cs, end) {
    const n = st.per, prevEnd = mg.months[mg.months.indexOf(end) - n];
    rows = cs.map(c => {
      const r = regOf(c) || [c, '', ''], [si, gu] = U.siGu(r[1], r[2]);
      const net = sumOf(c, 'net', end, n), p = popOf(c);
      const j = mg.months.indexOf(end), sp = mg.sgg[c].net.slice(Math.max(0, j - 11), j + 1);
      return { c, si, gu, net, inn: sumOf(c, 'in', end, n), out: sumOf(c, 'out', end, n), prev: prevEnd ? sumOf(c, 'net', prevEnd, n) : null, y12: sumOf(c, 'net', end, 12), pop: p, rate: p && net != null ? net / p * 100 : null, sp };
    });
  }
  function drawTable() {
    const l = F().apply(rows, (x) => [...x].sort((a, b) => (b.net ?? -1e12) - (a.net ?? -1e12)));
    const b = (k) => F().btn(k), c = cols();
    const th = (k, cls = '') => `<th class="${cls}">${c[k].label}${b(k)}</th>`;
    $('mgTitle').textContent = `지역별 순이동 순위 (${l.length}곳 · ${st.per === 1 ? '1개월' : st.per + '개월 합계'})`;
    $('mgTable').innerHTML = `<thead><tr>${th('si', 'l')}${th('gu', 'l')}${th('net')}${th('rate')}${th('inn')}${th('out')}${th('prev')}${th('chg')}${th('y12')}<th>12개월 흐름</th>${th('pop')}</tr></thead><tbody>` +
      l.map(r => `<tr data-c="${r.c}" class="click${st.sel === r.c ? ' on' : ''}"><td class="l">${U.esc(r.si)}</td><td class="l">${U.esc(r.gu)}</td><td class="${r.net >= 0 ? 'pos' : 'neg'}"><b>${fmt(r.net)}</b></td><td class="${r.rate >= 0 ? 'pos' : 'neg'}">${r.rate == null ? '-' : (r.rate > 0 ? '+' : '') + r.rate.toFixed(2) + '%'}</td>` +
        `<td>${r.inn == null ? '-' : r.inn.toLocaleString()}</td><td>${r.out == null ? '-' : r.out.toLocaleString()}</td><td>${fmt(r.prev)}</td><td class="${U.cls(r.prev == null || r.net == null ? null : r.net - r.prev)}">${r.prev == null || r.net == null ? '-' : fmt(r.net - r.prev)}</td>` +
        `<td class="${r.y12 >= 0 ? 'pos' : 'neg'}">${fmt(r.y12)}</td><td class="spk">${CK.spark(r.sp.map(v => v ?? 0), 80, 20)}</td><td>${r.pop ? r.pop.toLocaleString() : '-'}</td></tr>`).join('') + '</tbody>';
    Migration._l = l;
  }
  function excel() {
    const l = Migration._l || [], c = cols(), ks = Object.keys(c);
    U.download(`인구이동_${st.per}개월_${ymTxt(lastYm())}`, [{ name: '인구이동', rows: [ks.map(k => c[k].label), ...l.map(r => ks.map(k => { const v = c[k].num ? c[k].num(r) : c[k].get(r); return k === 'rate' && v != null ? +v.toFixed(2) : v ?? ''; }))] }]);
  }

  /* ── 지역 고르기 (최근 거래·공급 탭과 같은 방식) ── */
  function regPop() {
    const p = $('mgRegPop'), regions = K.regions(), cur = p.dataset.p || '';
    const sidoList = [...new Set(regions.map(r => r[1]))];
    const subs = cur ? regions.filter(r => (cur.startsWith('m:') ? (K.metroOf(r) === cur.slice(2) || K.cityOf(r) === cur.slice(2)) : r[1] === cur)) : [];
    const on = (t) => (st.regs.includes(t) ? ' on' : '');
    p.innerHTML = `<div class="hmpr"><span class="hmk">묶음</span>${Object.entries(K.GRP).map(([k, v]) => `<button class="mini${on('g:' + k)}" data-tok="g:${k}">${v}</button>`).join('')}</div>` +
      `<div class="hmpr"><span class="hmk">광역시</span>${K.METRO.map(m => `<button class="mini${on('m:' + m)}" data-tok="m:${m}">${m}</button>`).join('')}</div>` +
      `<div class="hmpr"><span class="hmk">중소도시</span>${K.CITY.map(m => `<button class="mini${on('m:' + m)}" data-tok="m:${m}">${m}</button>`).join('')}</div>` +
      `<div class="hmpr"><span class="hmk">구 고르기</span><select id="mgGuSel"><option value="">시·도 / 도시 고르기</option>` +
      sidoList.map(s => `<option value="${U.esc(s)}"${cur === s ? ' selected' : ''}>${U.esc(K.shortSido(s))}</option>`).join('') +
      [...K.METRO, ...K.CITY].filter(m => regions.some(r => K.metroOf(r) === m || K.cityOf(r) === m)).map(m => `<option value="m:${m}"${cur === 'm:' + m ? ' selected' : ''}>${m} (구별)</option>`).join('') + '</select></div>' +
      (subs.length ? `<div class="hmpr hmgus">${subs.map(r => `<label class="inline"><input type="checkbox" data-gu="${r[0]}"${st.regs.includes('c:' + r[0]) ? ' checked' : ''}> ${U.esc(K.tokLabel('c:' + r[0]))}</label>`).join('')}</div>` : '') +
      '<div class="hmpr" style="justify-content:flex-end"><button class="mini" data-close="1">닫기</button></div>';
  }
  const regChanged = () => { save(); regPop(); refresh(); };

  function sync() {
    $('mgChips').innerHTML = st.regs.map(t => `<span class="hmchip">${U.esc(K.tokLabel(t))}<button data-rm="${t}" title="빼기">✕</button></span>`).join('') || '<span class="hint" style="margin:0">지역을 추가하세요</span>';
    document.querySelectorAll('#mgPer button').forEach(b => b.classList.toggle('on', +b.dataset.p === st.per));
    const end = lastYm();
    $('mgMonth').innerHTML = mg.months.slice().reverse().map(m => `<option value="${m}"${m === end ? ' selected' : ''}>${ymTxt(m)}</option>`).join('');
    $('mgCondSum').textContent = [st.regs.map(K.tokLabel).join(', ') || '지역 없음', st.per === 1 ? '1개월' : `${st.per}개월 합계`, `${ymTxt(end)} 기준`].join(' · ');
  }

  function refresh(keepMap) {
    if (!mg) return;
    sync();
    const cs = codes(), end = lastYm();
    drawSummary(cs, end);
    drawCharts(cs);
    drawOd(cs, end);
    buildRows(cs, end); drawTable();
    if (!keepMap || !map) drawMap(cs, end); else drawMap(cs, end);
  }

  function setup() {
    const err = status && status.errors && status.errors.length ? status.errors : null;
    const has = !!(mg && mg.months && mg.months.length);
    $('mgBody').hidden = !has;
    const box = $('mgSetup'); box.hidden = has && !err;
    if (box.hidden) return;
    box.innerHTML = has
      ? `<div class="bar"><strong>⚠️ 마지막 인구이동 수집에 문제가 있었습니다</strong></div><p class="hint">${err.map(U.esc).join('<br>')}</p><p class="hint">예전에 받은 자료로 보여 줍니다. 이 내용을 캡처해 보내 주시면 고쳐 드립니다.</p>`
      : `<div class="bar"><strong>인구이동 자료가 아직 없습니다</strong></div>
        <ol class="spsteps">
          <li>KOSIS 공유서비스에서 인증키 발급 (마이페이지 → 활용신청현황)</li>
          <li>GitHub 저장소 → <b>Settings → Secrets and variables → Actions → New repository secret</b> → 이름 <b>KOSIS_API_KEY</b>, 값에 인증키</li>
          <li>GitHub → <b>Actions</b> → <b>인구이동 수집 (KOSIS)</b> → <b>Run workflow</b> (처음엔 3년 치를 받느라 몇 분 걸립니다)</li>
          <li>초록 체크가 뜨면 이 화면을 새로고침 (Ctrl+Shift+R)</li>
        </ol>${err ? `<p class="hint">마지막 수집 기록 (${U.esc(status.asOf || '')}): ${err.map(U.esc).join('<br>')}</p>` : ''}`;
  }

  async function init() {
    if (!$('tab-migration')) return;
    K = Home.kit;
    await K.regReady();
    st = Object.assign(DEF(), Store.get(SK, {}) || {});
    const [m, s, p, sp] = await Promise.all([Data.json('migration.json', null), Data.json('migration_status.json', null), Data.json('population.json', null), Data.json('supply.json', null)]);
    mg = m && m.months && m.months.length ? m : null; status = s;
    pop = (p && p.byCode) || {}; sup = (sp && sp.items) || [];
    $('mgInfo').textContent = mg ? `자료 기준 ${mg.asOf || '-'} · ${mg.source || '통계청 KOSIS 국내인구이동통계'} · ${ymTxt(mg.months[0])}~${ymTxt(lastYm())}` : '';
    setup();
    if (window.innerWidth <= 760) $('mgCond').open = false;
    $('mgPer').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.per = +b.dataset.p; save(); refresh(); };
    $('mgMonth').onchange = () => { st.ym = +$('mgMonth').value; save(); refresh(); };
    $('mgSelClear').onclick = () => { st.sel = null; save(); refresh(true); };
    $('mgOdSido').onchange = () => drawOd(codes(), lastYm());
    $('mgChips').onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { st.regs = st.regs.filter(t => t !== b.dataset.rm); st.sel = null; regChanged(); } };
    $('mgAddReg').onclick = () => { const p = $('mgRegPop'); p.hidden = !p.hidden; if (!p.hidden) regPop(); };
    $('mgRegPop').onclick = (e) => {
      const t = e.target.closest('[data-tok]');
      if (t) { const k = t.dataset.tok; st.regs = k === 'g:all' ? ['g:all'] : st.regs.includes(k) ? st.regs.filter(x => x !== k) : [...st.regs.filter(x => x !== 'g:all'), k]; st.sel = null; regChanged(); return; }
      if (e.target.closest('[data-close]')) $('mgRegPop').hidden = true;
    };
    $('mgRegPop').onchange = (e) => {
      if (e.target.id === 'mgGuSel') { $('mgRegPop').dataset.p = e.target.value; regPop(); return; }
      const g = e.target.dataset.gu;
      if (g) { const t = 'c:' + g; st.regs = e.target.checked ? [...st.regs.filter(x => x !== 'g:all' && x !== t), t] : st.regs.filter(x => x !== t); st.sel = null; regChanged(); }
    };
    document.addEventListener('mousedown', (e) => { const p = $('mgRegPop'); if (!p.hidden && !p.contains(e.target) && e.target.id !== 'mgAddReg') p.hidden = true; });
    $('mgTable').onclick = (e) => { const tr = e.target.closest('tr[data-c]'); if (!tr || e.target.closest('button.colf')) return; st.sel = st.sel === tr.dataset.c ? null : tr.dataset.c; save(); refresh(true); $('mgChart1').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    $('mgExcel').onclick = excel;
    new MutationObserver(() => { if (visible() && mg) setTimeout(() => drawMap(codes(), lastYm()), 50); }).observe($('tab-migration'), { attributes: true, attributeFilter: ['hidden'] });
    if (mg) refresh();
  }
  return { init, _st: () => st };
})();
