/* ─────────────────────────────────────────────────────────
   supply.js — [공급] 탭 (청약홈): 입주 물량(막대 + 적정 수요선) · 입주 단지 지도 · 입주 예정 표
   (분양가 vs 주변 시세는 [공급지도] 탭으로 옮김 → js/supplycmp.js)
   자료: data/supply.json (scripts/supply.py · 매주 자동), data/population.json (scripts/population.py · 매월 자동)
         주변 시세는 실거래 파일(data/sale)로 화면에서 계산
   ───────────────────────────────────────────────────────── */
const Supply = (() => {
  const $ = (id) => document.getElementById(id);
  const SK = 'apt.supplyApi.v1';                          // ([공급지도] 탭의 apt.supply.v1 과 겹치지 않게)
  const DEMAND = 0.005;                                    // 적정 수요 = 인구 × 0.5% (1년)
  let st = {}, items = [], status = null, pop = null, K = null;
  let chart = null, map = null, marks = [], labs = [], f1 = null, rows1 = [], drawn = false;
  const geo = new Map();                                    // 이번 접속 동안만 기억 (카카오 정책)
  const eok = (v) => (v == null ? '-' : (v / 10000).toFixed(2) + '억');
  const nowYm = () => { const t = new Date(); return t.getFullYear() * 100 + t.getMonth() + 1; };
  const ymTxt = (m) => (m ? `${Math.floor(m / 100)}.${String(m % 100).padStart(2, '0')}` : '-');
  const save = () => Store.set(SK, st);
  const DEF = () => ({ regs: ['g:seoul'], unit: 'y', noReb: false, period: null });

  /* ── 지역 ── */
  const codes = () => new Set(st.regs.flatMap(t => K.codesOf(t)));
  const perKey = (mv) => { const y = Math.floor(mv / 100); return st.unit === 'h' ? `${y}-${mv % 100 <= 6 ? 1 : 2}` : String(y); };
  const perLabel = (k) => (k.includes('-') ? `${k.slice(0, 4)} ${k.endsWith('1') ? '상' : '하'}반기` : `${k}년`);
  const perEnd = (k) => (k.includes('-') ? +k.slice(0, 4) * 100 + (k.endsWith('1') ? 6 : 12) : +k * 100 + 12);
  const perStart = (k) => (k.includes('-') ? +k.slice(0, 4) * 100 + (k.endsWith('1') ? 1 : 7) : +k * 100 + 1);
  const inScope = () => { const cs = codes(); return items.filter(it => it.c && cs.has(it.c) && !(st.noReb && it.reb)); };
  function siGu(it) { const r = K.reg(it.c); return r ? U.siGu(r[1], r[2]) : [it.sd, it.sg]; }

  /* ── ② 입주 물량 ── */
  function drawBars() {
    const list = inScope().filter(it => it.mv);
    const y0 = Math.floor(nowYm() / 100) - 2, y1 = Math.floor(nowYm() / 100) + 5;
    const keys = [];
    for (let y = y0; y <= y1; y++) { if (st.unit === 'h') keys.push(`${y}-1`, `${y}-2`); else keys.push(String(y)); }
    const sum = new Map(keys.map(k => [k, { hh: 0, n: 0, reb: 0 }]));
    list.forEach(it => { const k = perKey(it.mv); const s = sum.get(k); if (s) { s.hh += it.hh; s.n++; if (it.reb) s.reb += it.hh; } });
    // 뒤쪽 빈 기간은 잘라냄
    let last = keys.length - 1; while (last > 0 && !sum.get(keys[last]).hh && perStart(keys[last]) > nowYm()) last--;
    const ks = keys.slice(0, Math.max(last + 1, keys.indexOf(String(Math.floor(nowYm() / 100))) + 2));
    const cs = [...codes()];
    const pk = pop && pop.pop ? cs.filter(c => pop.pop[c]) : [];
    const people = pk.reduce((t, c) => t + pop.pop[c], 0);
    const full = pk.length === cs.length && people > 0;
    const demand = full ? people * DEMAND / (st.unit === 'h' ? 2 : 1) : null;
    const now = nowYm();
    const C = CK.C.sale(), Q = CK.C.quote(), G = CK.alpha(CK.C.sub(), 0.45);
    const col = ks.map(k => {
      const base = perEnd(k) < now ? G : perStart(k) <= now + 100 ? C : Q;
      return st.period && st.period !== k ? CK.alpha(base.startsWith('#') ? base : '#999999', 0.25) : base;
    });
    const data = ks.map(k => sum.get(k).hh);
    $('spBarTitle').textContent = `입주 물량 · ${st.unit === 'h' ? '반기별' : '연도별'}${st.period ? ' · ' + perLabel(st.period) + ' 선택' : ''}`;
    $('spPeriodClear').hidden = !st.period;
    const ds = [{ type: 'bar', data, backgroundColor: col, borderRadius: { topLeft: 4, topRight: 4 }, maxBarThickness: 46, order: 2 }];
    if (demand) ds.push({ type: 'line', data: ks.map(() => demand), borderColor: CK.C.text(), borderDash: [6, 5], borderWidth: 1.5, pointRadius: 0, order: 1, label: '적정 수요' });
    const meta = { ks, sum, demand };
    if (chart) { chart.data.labels = ks.map(perLabel); chart.data.datasets = ds; chart.$m = meta; chart.update('none'); }
    else {
      chart = new Chart($('spBarChart'), {
        data: { labels: ks.map(perLabel), datasets: ds },
        options: {
          maintainAspectRatio: false, animation: false,
          scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { maxTicksLimit: 5, callback: (v) => v.toLocaleString() } } },
          plugins: {
            legend: { display: false },
            tooltip: { filter: (c) => c.dataset.type === 'bar', callbacks: { label: (c) => { const m = chart.$m, s = m.sum.get(m.ks[c.dataIndex]); return `${s.n}개 단지 · ${s.hh.toLocaleString()}세대${s.reb ? ` (정비사업 ${s.reb.toLocaleString()})` : ''}${m.demand ? ` · 적정 대비 ${Math.round(s.hh / m.demand * 100)}%` : ''}`; } } },
          },
          onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
          onClick: (e, els) => { const el = els.find(x => x.datasetIndex === 0) || els[0]; if (!el) return; const k = chart.$m.ks[el.index]; st.period = st.period === k ? null : k; save(); refresh(); },
        },
      });
      chart.$m = meta;
    }
    const y = Math.floor(now / 100);
    const show = st.unit === 'h' ? ks.filter(k => perEnd(k) >= now).slice(0, 4) : [String(y), String(y + 1), String(y + 2)];
    $('spSummary').innerHTML = show.map(k => { const s = sum.get(k) || { hh: 0, n: 0 }; const r = demand ? s.hh / demand * 100 : null;
      return `<span class="spsumi"><b>${perLabel(k)}</b> ${s.hh.toLocaleString()}세대 <small>${s.n}곳</small>${r == null ? '' : ` <em class="${r > 120 ? 'over' : r < 80 ? 'under' : ''}">적정 대비 ${Math.round(r)}%${r > 120 ? ' 과잉' : r < 80 ? ' 부족' : ''}</em>`}</span>`; }).join('') +
      (demand ? `<span class="hint" style="margin:0">적정 수요 ${Math.round(demand).toLocaleString()}세대 = 인구 ${people.toLocaleString()}명 × 0.5%${st.unit === 'h' ? ' ÷ 2' : ''} (${pop.ym ? ymTxt(pop.ym) + ' 기준' : ''})</span>`
        : `<span class="hint" style="margin:0">적정 수요선은 인구 자료가 있어야 보입니다${pop && pop.pop ? ' (고른 지역 중 인구 자료가 없는 곳이 있음)' : ''}.</span>` + (pop && pop.pop ? '' : POPHELP));
  }

  const POPHELP = '<span class="hint" style="margin:0;flex-basis:100%">인구는 실거래 자동 수집 때 한 달에 한 번 행정안전부 자료로 받습니다 (data/population_status.json 에서 결과 확인).</span>';

  /* ── ③ 지도 / ④ 입주 예정 표 ── */
  function listRows() {
    const now = nowYm();
    let l = inScope();
    if (st.period) l = l.filter(it => it.mv && perKey(it.mv) === st.period);
    else l = l.filter(it => it.mv && it.mv >= now);
    return l.sort((a, b) => a.mv - b.mv || b.hh - a.hh);
  }
  function cols1() {
    const N = ColFilter.numCol, T = ColFilter.txtCol;
    return {
      si: T('시', it => siGu(it)[0]), gu: T('구', it => siGu(it)[1]), dong: T('동', it => it.dg), name: T('단지', it => it.nm),
      mv: { label: '입주 예정', get: it => ymTxt(it.mv), num: it => it.mv }, hh: N('세대수', it => it.hh, 'n'),
      reb: T('정비사업', it => (it.reb ? '정비사업' : '일반')), bd: T('시공사', it => it.bd),
      pub: { label: '공고일', get: it => (it.pub ? `${it.pub.slice(0, 4)}.${it.pub.slice(4, 6)}` : ''), num: it => +it.pub || null },
      cr: N('1순위 경쟁률', it => it.cr, 'n'),
    };
  }
  const F1 = () => f1 || (f1 = ColFilter.create({ key: 'sup1', cols: cols1, bar: 'spCfBar1', onChange: drawList }));
  function drawList() {
    const l = F1().apply(rows1);
    const tot = l.reduce((t, it) => t + it.hh, 0);
    $('spListTitle').textContent = `${st.period ? perLabel(st.period) + ' ' : ''}입주 예정 단지 (${l.length.toLocaleString()}곳 · ${tot.toLocaleString()}세대)`;
    $('spEmpty1').hidden = l.length > 0; $('spEmpty1').textContent = rows1.length ? '필터에 맞는 단지가 없습니다.' : '고른 지역·기간에 입주 예정 단지가 없습니다.';
    const b = (k) => F1().btn(k), c = cols1();
    const th = (k, cls = '') => `<th class="${cls}">${c[k].label}${b(k)}</th>`;
    $('spTable1').innerHTML = `<thead><tr>${th('si', 'l')}${th('gu', 'l')}${th('dong', 'l')}${th('name', 'l name')}${th('mv')}${th('hh')}${th('reb')}${th('bd', 'l')}${th('pub')}${th('cr')}</tr></thead><tbody>` +
      l.map(it => { const [si, gu] = siGu(it);
        return `<tr data-id="${U.esc(it.id)}"><td class="l">${U.esc(si)}</td><td class="l">${U.esc(gu)}</td><td class="l">${U.esc(it.dg)}</td><td class="l name">${it.url ? `<a href="${U.esc(it.url)}" target="_blank" rel="noopener">${U.esc(it.nm)}</a>` : U.esc(it.nm)}</td>` +
          `<td>${ymTxt(it.mv)}</td><td>${it.hh.toLocaleString()}</td><td>${it.reb ? '<span class="tg low">정비사업</span>' : '-'}</td><td class="l">${U.esc(it.bd)}</td><td>${it.pub ? it.pub.slice(0, 4) + '.' + it.pub.slice(4, 6) : '-'}</td><td>${it.cr == null ? '-' : it.cr.toFixed(1) + ':1'}</td></tr>`; }).join('') + '</tbody>';
    cards($('spCards1'), $('spTable1'), l.map(it => ({ title: it.nm, url: it.url, sub: `${siGu(it).filter(Boolean).join(' ')} ${it.dg}`, kv: [['입주', ymTxt(it.mv)], ['세대', it.hh.toLocaleString()], ['정비사업', it.reb ? '예' : '-'], ['경쟁률', it.cr == null ? '-' : it.cr.toFixed(1) + ':1']] })));
    Supply._l1 = l;
  }
  async function drawMap() {
    if (!drawn && $('tab-supply').hidden) return;
    const msg = $('spMapMsg');
    if (!KMap.ready()) { msg.innerHTML = KMap.needKeyHtml; $('spMap').hidden = true; return; }
    const l = (Supply._l1 || rows1).slice(0, 150);
    try { await KMap.load(); } catch (e) { msg.textContent = e.message; return; }
    drawn = true;
    if (!map) {
      map = KMap.create($('spMap'), { lat: 37.55, lng: 126.98 }, 8);
      const tidy = () => { LabelKit.stage('supply', map.getLevel()); LabelKit.declutter(labs); };
      kakao.maps.event.addListener(map, 'idle', tidy); kakao.maps.event.addListener(map, 'zoom_changed', tidy);
    } else map.relayout();
    marks.forEach(m => m.setMap(null)); marks = []; labs = [];
    const S = kakao.maps.services, gc = new S.Geocoder(), now = nowYm();
    const find = (it) => new Promise(res => {
      if (geo.has(it.id)) return res(geo.get(it.id));
      gc.addressSearch(it.ad.replace(/\s*(일원|일대|외\s*\d+필지).*$/, ''), (r, s) => {
        if (s === S.Status.OK && r.length) { const p = { lat: +r[0].y, lng: +r[0].x }; geo.set(it.id, p); return res(p); }
        new S.Places().keywordSearch(`${it.sg} ${it.nm}`, (r2, s2) => { const p = s2 === S.Status.OK && r2.length ? { lat: +r2[0].y, lng: +r2[0].x } : null; geo.set(it.id, p); res(p); });
      });
    });
    const pts = [];
    msg.textContent = l.length ? `단지 위치 찾는 중… (0/${l.length})` : '지도에 표시할 단지가 없습니다.';
    for (let i = 0; i < l.length; i++) {
      const it = l[i], p = await find(it);
      if (i % 10 === 9) msg.textContent = `단지 위치 찾는 중… (${i + 1}/${l.length})`;
      if (!p) continue;
      pts.push(p);
      const el = document.createElement('div');                 // 단지 라벨 (모양은 오른쪽 위 🏷 라벨)
      LabelKit.render(el, 'supply', { id: 'sp:' + it.id, name: it.nm, ym: it.mv, hh: it.hh });
      LabelKit.bind(el, 'supply', 'sp:' + it.id, () => map);
      el.title = `${it.nm} · ${it.hh.toLocaleString()}세대 · 입주 ${ymTxt(it.mv)}`;
      el.onclick = () => { const tr = document.querySelector(`#spTable1 tr[data-id="${CSS.escape(it.id)}"]`); if (tr) { tr.scrollIntoView({ behavior: 'smooth', block: 'center' }); tr.classList.add('flash'); setTimeout(() => tr.classList.remove('flash'), 1500); } U.toast(el.title); };
      const ov = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(p.lat, p.lng), content: el, yAnchor: 1, xAnchor: 0.5, clickable: true, zIndex: 3 });
      ov.setMap(map); marks.push(ov); labs.push({ el, ov, w: it.hh, it });
    }
    if (pts.length) KMap.fit(map, pts);
    setTimeout(() => { LabelKit.stage('supply', map.getLevel()); LabelKit.declutter(labs); }, 120);
    msg.textContent = l.length ? `${pts.length}곳 표시${l.length > pts.length ? ` (위치를 못 찾은 곳 ${l.length - pts.length})` : ''}${(Supply._l1 || rows1).length > 150 ? ' · 많아서 앞쪽 150곳만' : ''} · 라벨 색 = 입주 시기 (🏷 라벨에서 바꿈)` : '지도에 표시할 단지가 없습니다.';
  }

  /* 휴대폰: 표 대신 카드 */
  function cards(box, table, list) {
    const narrow = window.innerWidth <= 760;
    table.closest('.tablewrap').hidden = narrow; box.hidden = !narrow;
    if (!narrow) return;
    box.innerHTML = list.slice(0, 300).map(x => `<div class="hmrc"><div class="hmrc1">${x.url ? `<a href="${U.esc(x.url)}" target="_blank" rel="noopener">${U.esc(x.title)}</a>` : `<b>${U.esc(x.title)}</b>`} <small>${U.esc(x.sub)}</small></div>` +
      `<div class="hmrc2">${x.kv.map(([k, v]) => `<span>${k} <b>${U.esc(v)}</b></span>`).join('')}</div></div>`).join('');
  }

  function excel() {
    const l = Supply._l1 || [], c = cols1(), ks = Object.keys(c);
    const rows = [ks.map(k => c[k].label), ...l.map(r => ks.map(k => c[k].get(r)))];
    U.download(`공급_입주예정_${U.stamp()}`, [{ name: '입주예정', rows }]);
  }

  /* ── 고르는 줄 ── */
  function syncControls() {
    document.querySelectorAll('#spUnit button').forEach(b => b.classList.toggle('on', b.dataset.u === st.unit));
    $('spNoReb').checked = st.noReb;
    $('spChips').innerHTML = st.regs.map(t => `<span class="hmchip">${U.esc(K.tokLabel(t))}<button data-rm="${t}" title="빼기">✕</button></span>`).join('') || '<span class="hint" style="margin:0">지역을 추가하세요</span>';
    $('spCondSum').textContent = [st.regs.map(K.tokLabel).join(', ') || '지역 없음', st.unit === 'h' ? '반기별' : '연도별', st.noReb ? '정비사업 제외' : ''].filter(Boolean).join(' · ');
  }
  function regPop() {
    const pop = $('spRegPop'), regions = K.regions();
    const sidoList = [...new Set(regions.map(r => r[1]))], cur = pop.dataset.p || '';
    const subs = cur ? regions.filter(r => (cur.startsWith('m:') ? (K.metroOf(r) === cur.slice(2) || K.cityOf(r) === cur.slice(2)) : r[1] === cur)) : [];
    const on = (t) => (st.regs.includes(t) ? ' on' : '');
    pop.innerHTML = `<div class="hmpr"><span class="hmk">묶음</span>${Object.entries(K.GRP).map(([k, v]) => `<button class="mini${on('g:' + k)}" data-tok="g:${k}">${v}</button>`).join('')}</div>` +
      `<div class="hmpr"><span class="hmk">광역시</span>${K.METRO.map(m => `<button class="mini${on('m:' + m)}" data-tok="m:${m}">${m}</button>`).join('')}</div>` +
      `<div class="hmpr"><span class="hmk">중소도시</span>${K.CITY.map(m => `<button class="mini${on('m:' + m)}" data-tok="m:${m}">${m}</button>`).join('')}</div>` +
      `<div class="hmpr"><span class="hmk">구 고르기</span><select id="spGuSel"><option value="">시·도 / 도시 고르기</option>` +
      sidoList.map(s => `<option value="${U.esc(s)}"${cur === s ? ' selected' : ''}>${U.esc(K.shortSido(s))}</option>`).join('') +
      [...K.METRO, ...K.CITY].filter(m => regions.some(r => K.metroOf(r) === m || K.cityOf(r) === m)).map(m => `<option value="m:${m}"${cur === 'm:' + m ? ' selected' : ''}>${m} (구별)</option>`).join('') + '</select></div>' +
      (subs.length ? `<div class="hmpr hmgus">${subs.map(r => `<label class="inline"><input type="checkbox" data-gu="${r[0]}"${st.regs.includes('c:' + r[0]) ? ' checked' : ''}> ${U.esc(K.tokLabel('c:' + r[0]))}</label>`).join('')}</div>` : '') +
      '<div class="hmpr" style="justify-content:flex-end"><button class="mini" data-close="1">닫기</button></div>';
  }
  const regChanged = () => { st.period = null; save(); regPop(); refresh(); };

  function refresh() {
    syncControls();
    drawBars();
    rows1 = listRows(); drawList(); drawMap();
  }

  function setup() {
    const err = status && status.errors && status.errors.length ? status.errors : null;
    $('spBody').hidden = !!(!items.length);
    const box = $('spSetup');
    box.hidden = items.length > 0 && !err;
    if (box.hidden) return;
    box.innerHTML = items.length
      ? `<div class="bar"><strong>⚠️ 마지막 공급 자료 수집에 문제가 있었습니다</strong></div><p class="hint">${err.map(U.esc).join('<br>')}</p><p class="hint">예전에 받은 자료로 화면을 보여 줍니다. 위 내용을 캡처해 보내 주시면 고쳐 드립니다.</p>`
      : `<div class="bar"><strong>공급 자료가 아직 없습니다</strong></div>
        <ol class="spsteps">
          <li>공공데이터포털에서 <b>청약홈 분양정보 조회 서비스</b>, <b>청약홈 청약접수 경쟁률 조회 서비스</b> 활용 신청 (실거래와 같은 키)</li>
          <li>GitHub 저장소 → <b>Actions</b> → <b>공급 자료 수집 (청약홈)</b> → <b>Run workflow</b></li>
          <li>처음에는 2020년 이후 공고를 모두 받느라 수십 분 걸립니다. 초록 체크가 뜨면 이 화면을 새로고침(Ctrl+Shift+R)</li>
        </ol>${err ? `<p class="hint">마지막 수집 기록 (${U.esc(status.asOf || '')}): ${err.map(U.esc).join('<br>')}</p>` : ''}`;
  }

  async function init() {
    if ($('spMap')) {
      LabelKit.mount('supply', { el: $('spMap') });
      LabelKit.on('supply', () => { labs.forEach(x => LabelKit.render(x.el, 'supply', { id: 'sp:' + x.it.id, name: x.it.nm, ym: x.it.mv, hh: x.it.hh })); if (map) setTimeout(() => { LabelKit.stage('supply', map.getLevel()); LabelKit.declutter(labs); }, 30); });
    }
    K = Home.kit;
    await K.regReady();
    let saved = Store.get(SK, null);
    if (!saved) {                                           // 예전 버전은 apt.supply.v1 에 설정을 같이 저장했음 → 설정 칸만 옮겨 옴
      const old = Store.get('apt.supply.v1', {}) || {};
      saved = {}; ['regs', 'unit', 'noReb'].forEach(k => { if (old[k] != null) saved[k] = old[k]; });
    }
    st = Object.assign(DEF(), saved);
    const [sp, ss, pp] = await Promise.all([Data.json('supply.json', null), Data.json('supply_status.json', null), Data.json('population.json', null)]);
    items = (sp && sp.items) || []; status = ss;
    pop = null;                                             // 인구: 자동 수집 형식 { ym, byCode: { 코드: { pop } } } (예전 CSV 형식 { pop: { 코드: 인구 } } 도 읽음)
    if (pp && pp.byCode) { pop = { ym: +pp.ym || null, pop: {} }; for (const c in pp.byCode) if (pp.byCode[c] && pp.byCode[c].pop) pop.pop[c] = pp.byCode[c].pop; }
    else if (pp && pp.pop) pop = pp;
    $('spInfo').textContent = items.length
      ? `자료 기준 ${sp.asOf || '-'} · 청약홈 분양 공고 ${items.length.toLocaleString()}건 (2020.02~) · 세대수는 일반분양 기준${pop ? ` · 인구 ${ymTxt(pop.ym)} 기준` : ''}`
      : '';
    setup();
    if (window.innerWidth <= 760) $('spCond').open = false;

    $('spUnit').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.unit = b.dataset.u; st.period = null; save(); refresh(); };
    $('spNoReb').onchange = () => { st.noReb = $('spNoReb').checked; save(); refresh(); };
    $('spPeriodClear').onclick = () => { st.period = null; save(); refresh(); };
    $('spChips').onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { st.regs = st.regs.filter(t => t !== b.dataset.rm); regChanged(); } };
    $('spAddReg').onclick = () => { const p = $('spRegPop'); p.hidden = !p.hidden; if (!p.hidden) regPop(); };
    $('spRegPop').onclick = (e) => {
      const t = e.target.closest('[data-tok]');
      if (t) { const k = t.dataset.tok; st.regs = k === 'g:all' ? ['g:all'] : st.regs.includes(k) ? st.regs.filter(x => x !== k) : [...st.regs.filter(x => x !== 'g:all'), k]; regChanged(); return; }
      if (e.target.closest('[data-close]')) $('spRegPop').hidden = true;
    };
    $('spRegPop').onchange = (e) => {
      if (e.target.id === 'spGuSel') { $('spRegPop').dataset.p = e.target.value; regPop(); return; }
      const gc = e.target.dataset.gu;
      if (gc) { const t = 'c:' + gc; st.regs = e.target.checked ? [...st.regs.filter(x => x !== 'g:all' && x !== t), t] : st.regs.filter(x => x !== t); regChanged(); }
    };
    document.addEventListener('mousedown', (e) => { const p = $('spRegPop'); if (!p.hidden && !p.contains(e.target) && e.target.id !== 'spAddReg') p.hidden = true; });
    $('spExcel1').onclick = excel;
    // 탭이 처음 보일 때 지도 그리기 (숨긴 상태에서는 지도 크기를 잴 수 없음)
    new MutationObserver(() => { if (!$('tab-supply').hidden && items.length) { drawn = true; setTimeout(drawMap, 50); } }).observe($('tab-supply'), { attributes: true, attributeFilter: ['hidden'] });
    if (items.length) refresh();
    else syncControls();
  }

  return { init, _st: () => st };
})();
