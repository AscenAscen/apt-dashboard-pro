/* ─────────────────────────────────────────────────────────
   tracking.js — [시세트래킹] 탭
   담아 둔 단지를 브라우저에 저장하고, 기준월 시세를 계산해 표·엑셀로 보여 줍니다.
   엑셀 열 순서는 js/config.js 의 TRACKING_COLUMNS 에서 바꿉니다.
   ───────────────────────────────────────────────────────── */
const Tracking = (() => {
  const $ = (id) => document.getElementById(id);
  const KEY = 'apt.tracking.v1';
  let items = Store.get(KEY, []);
  const calc = new Map();      // id → 계산된 시세
  const checked = new Set();

  const save = () => { Store.set(KEY, items); $('trackCount').textContent = items.length; };
  const all = () => items;
  const pyeong = (it) => it.pyeong || CONFIG.toPyeong(it.g) + '평';
  const link = (it) => it.link || U.landLink(it.sgg, it.dong, it.name);

  /** [실거래 조회]에서 넘어온 단지를 목록에 추가 */
  function add(rows) {
    let n = 0;
    for (const r of rows) {
      if (items.some(it => it.id === r.id)) continue;
      items.push({ id: r.id, code: r.code, sido: r.sido, sgg: r.sgg, dong: r.dong, jibun: r.jibun, key: r.key, name: r.name,
        g: r.g, buildYear: r.buildYear, households: '', structure: '', rooms: '', baths: '', link: '', zone: '', pyeong: '',
        lastSale: r.st?.last?.price ?? null });
      n++;
    }
    save();
    U.toast(n ? `${n}개 단지를 시세트래킹에 담았습니다.` : '이미 담겨 있는 단지입니다.');
    fillRegions();
  }

  function init() {
    // 기준월: 최근 36개월 (기본 = 지난달. 이번 달은 신고가 덜 끝나 거래가 적습니다)
    const now = new Date(); const opts = [];
    for (let i = 0; i < 36; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = d.getFullYear() * 100 + d.getMonth() + 1;
      opts.push(`<option value="${ym}" ${i === 1 ? 'selected' : ''}>${d.getFullYear()}년 ${d.getMonth() + 1}월</option>`);
    }
    $('trkMonth').innerHTML = opts.join('');
    $('trkRegion').onchange = render;
    $('btnTrkLoad').onclick = load;
    $('btnTrkExcel').onclick = excel;
    $('btnTrkBackup').onclick = backup;
    $('btnTrkRestore').onclick = () => $('trkFile').click();
    $('trkFile').onchange = restore;
    $('btnTrkDelete').onclick = () => {
      if (!checked.size) return U.toast('삭제할 단지를 체크하세요.');
      if (!confirm(`선택한 ${checked.size}개 단지를 트래킹에서 삭제할까요?`)) return;
      items = items.filter(it => !checked.has(it.id)); checked.clear(); save(); fillRegions(); render();
    };
    save(); fillRegions();
  }

  function fillRegions() {
    const cur = $('trkRegion').value;
    const names = [...new Set(items.map(it => `${it.sido} ${it.sgg}`))].sort((a, b) => a.localeCompare(b, 'ko'));
    $('trkRegion').innerHTML = '<option value="">전체</option>' + names.map(n => `<option>${U.esc(n)}</option>`).join('');
    if (names.includes(cur)) $('trkRegion').value = cur;
  }

  const visible = () => { const reg = $('trkRegion').value; return items.filter(it => !reg || `${it.sido} ${it.sgg}` === reg); };
  const ymAdd = (ym, d) => { const n = Math.floor(ym / 100) * 12 + (ym % 100 - 1) + d; return Math.floor(n / 12) * 100 + n % 12 + 1; };

  /** 기준월 시세 계산 */
  async function load() {
    const list = visible();
    if (!list.length) return render();
    const ym = +$('trkMonth').value, prev = ymAdd(ym, -1);
    const low = ymAdd(prev, -CONFIG.TRACKING_LOOKBACK_MONTHS);
    $('btnTrkLoad').disabled = true; $('btnTrkLoad').textContent = '불러오는 중…';
    try {
      for (const code of new Set(list.map(it => it.code))) {
        const data = await Data.loadYears(code, Math.min(Math.floor(low / 100), Math.floor(CONFIG.PEAK_FROM / 10000)), Math.floor(ym / 100));
        const mine = list.filter(it => it.code === code);
        const keys = new Set(mine.map(it => it.key));
        const bucket = new Map(mine.map(it => [it.id, { sale: [], rent: [] }]));
        for (const kind of ['sale', 'rent']) {
          Data.eachTrade(data[kind], k => keys.has(k), (key, t) => {
            const b = bucket.get(`${code}|${key}#${t.g}`);
            if (b && !(kind === 'sale' && t.direct)) b[kind].push(t);
          });
        }
        for (const it of mine) {
          const b = bucket.get(it.id);
          // 해당 월 평균가. 없으면 그 이전 가장 최근 거래
          const value = (arr, m) => {
            const inM = arr.filter(t => Math.floor(t.d / 100) === m);
            if (inM.length) return { v: Math.round(inM.reduce((s, t) => s + t.price, 0) / inM.length), n: inM.length, fb: false };
            const before = arr.filter(t => Math.floor(t.d / 100) < m && Math.floor(t.d / 100) >= low).sort((a, b2) => a.d - b2.d).pop();
            return before ? { v: before.price, n: 0, fb: true } : { v: null, n: 0, fb: false };
          };
          const s = value(b.sale, ym), sp = value(b.sale, prev), r = value(b.rent, ym), rp = value(b.rent, prev);
          const sub = (a, c) => (a == null || c == null ? null : a - c);
          const gap = sub(s.v, r.v), gapP = sub(sp.v, rp.v);
          const ratio = s.v && r.v ? r.v / s.v * 100 : null, ratioP = sp.v && rp.v ? rp.v / sp.v * 100 : null;
          // 전고점·전저점: 2020년(설정값) 이후 ~ 기준월까지의 매매 실거래 최고·최저 (직거래 제외)
          let peak = null, trough = null;
          for (const t of b.sale) {
            if (t.d < CONFIG.PEAK_FROM || Math.floor(t.d / 100) > ym) continue;
            if (!peak || t.price >= peak.price) peak = t;
            if (!trough || t.price < trough.price) trough = t;
          }
          const rate = (base) => (s.v && base ? (s.v / base.price - 1) * 100 : null);
          calc.set(it.id, { ym, peak: peak?.price ?? null, peakD: peak?.d, trough: trough?.price ?? null, troughD: trough?.d, drop: rate(peak), rise: rate(trough), sale: s.v, saleN: s.n, saleFb: s.fb, saleDiff: sub(s.v, sp.v), rent: r.v, rentN: r.n, rentFb: r.fb, rentDiff: sub(r.v, rp.v),
            gap, gapDiff: sub(gap, gapP), ratio, ratioDiff: sub(ratio, ratioP) });
          if (s.v) it.lastSale = s.v;
        }
      }
      save();
    } finally {
      $('btnTrkLoad').disabled = false; $('btnTrkLoad').textContent = '시세 불러오기';
    }
    render();
  }

  /** 엑셀·화면 공통: 한 단지의 열 값 */
  function rowValues(it) {
    const c = calc.get(it.id) || {};
    const [si, gu] = U.siGu(it.sido, it.sgg);
    const r1 = (v) => (v == null ? '' : +v.toFixed(1));
    return {
      '가격대': c.sale ? CONFIG.priceBand(c.sale) : '', '시': si, '구': gu, '동': it.dong, '단지명': it.name,
      '연식': it.buildYear || '', '연차': it.buildYear ? CONFIG.toAge(it.buildYear) : '', '세대수': it.households, '평형': pyeong(it),
      '구조(계,복)': it.structure, '방': it.rooms, '화': it.baths, '링크': link(it),
      '매매': c.sale ?? '', '매매개수': c.saleN ?? '', '전월대비 매매': c.saleDiff ?? '',
      '전세': c.rent ?? '', '전세개수': c.rentN ?? '', '전월대비전세': c.rentDiff ?? '',
      '매-전': c.gap ?? '', '전월대비 매-전': c.gapDiff ?? '', '전세가율': r1(c.ratio), '전월대비 전세가율': r1(c.ratioDiff),
      '전고점': c.peak ?? '', '전고대비': r1(c.drop), '전저점': c.trough ?? '', '전저대비': r1(c.rise),
    };
  }

  function render() {
    const list = visible();
    $('trkEmpty').hidden = items.length > 0;
    $('trkTable').parentElement.hidden = !items.length;
    const inp = (it, f, cls = '', ph = '') => `<input class="${cls}" data-id="${U.esc(it.id)}" data-f="${f}" value="${U.esc(it[f] || '')}" placeholder="${ph}">`;
    const money = (v, fb) => (v == null ? '-' : U.price(v) + (fb ? '<span class="star">*</span>' : ''));
    const pk = (v, d) => (v == null ? '-' : `${U.price(v)}<small>${U.date(d)}</small>`);
    const dcell = (v) => `<td class="${U.cls(v)}">${U.diff(v)}</td>`;
    const head = '<thead><tr><th class="c"><input type="checkbox" id="trkAll"></th><th class="l">생활권</th><th>가격대</th><th class="l">시</th><th class="l">구</th><th class="l">동</th><th class="l">단지명</th>' +
      '<th>연식</th><th>연차</th><th>세대수</th><th>평형</th><th>구조</th><th>방</th><th>화</th><th>링크</th>' +
      '<th>매매</th><th>개수</th><th>전월대비</th><th>전고점</th><th>전고대비</th><th>전저점</th><th>전저대비</th><th>전세</th><th>개수</th><th>전월대비</th><th>매-전</th><th>전월대비</th><th>전세가율</th><th>전월대비</th><th class="c">지도</th></tr></thead>';
    const body = list.map((it, i) => {
      const v = rowValues(it), c = calc.get(it.id) || {};
      return `<tr><td class="c"><input type="checkbox" data-chk="${i}" ${checked.has(it.id) ? 'checked' : ''}></td>` +
        `<td class="l">${inp(it, 'zone', '', '생활권')}</td><td>${v['가격대'] || '-'}</td><td class="l">${U.esc(v['시'])}</td><td class="l">${U.esc(v['구'])}</td><td class="l">${U.esc(it.dong)}</td><td class="l">${U.esc(it.name)}</td>` +
        `<td>${v['연식'] || '-'}</td><td>${v['연차'] === '' ? '-' : v['연차']}</td><td>${inp(it, 'households')}</td><td>${inp(it, 'pyeong', '', pyeong(it))}</td><td>${inp(it, 'structure', '', '계/복')}</td><td>${inp(it, 'rooms')}</td><td>${inp(it, 'baths')}</td>` +
        `<td>${inp(it, 'link', 'wide', '직접 입력')} <a class="btn mini" href="${U.esc(link(it))}" target="_blank" rel="noopener">열기</a></td>` +
        `<td class="sale">${money(c.sale, c.saleFb)}</td><td>${c.saleN ?? '-'}</td>${dcell(c.saleDiff)}` +
        `<td>${pk(c.peak, c.peakD)}</td><td class="${U.cls(c.drop)}">${U.pct(c.drop)}</td><td>${pk(c.trough, c.troughD)}</td><td class="${U.cls(c.rise)}">${U.pct(c.rise)}</td>` +
        `<td class="rent">${money(c.rent, c.rentFb)}</td><td>${c.rentN ?? '-'}</td>${dcell(c.rentDiff)}` +
        `<td>${c.gap == null ? '-' : U.price(c.gap)}</td>${dcell(c.gapDiff)}` +
        `<td>${c.ratio == null ? '-' : c.ratio.toFixed(1) + '%'}</td><td class="${U.cls(c.ratioDiff)}">${c.ratioDiff == null ? '-' : (c.ratioDiff > 0 ? '+' : '') + c.ratioDiff.toFixed(1) + '%p'}</td>` +
        `<td class="c"><button class="mini" data-map="${i}">위치</button></td></tr>`;
    }).join('');
    const table = $('trkTable');
    table.innerHTML = head + `<tbody>${body}</tbody>`;
    table.querySelector('#trkAll').onclick = (e) => { list.forEach(it => (e.target.checked ? checked.add(it.id) : checked.delete(it.id))); render(); $('trkAll').checked = e.target.checked; };
    table.querySelector('tbody').onclick = (e) => {
      const t = e.target;
      if (t.dataset.chk != null) { const it = list[+t.dataset.chk]; t.checked ? checked.add(it.id) : checked.delete(it.id); }
      if (t.dataset.map != null) App.showMap(list[+t.dataset.map]);
    };
    table.querySelector('tbody').onchange = (e) => {
      const t = e.target;
      if (!t.dataset.f) return;
      const it = items.find(x => x.id === t.dataset.id);
      if (it) { it[t.dataset.f] = t.value.trim(); save(); }
    };
  }

  function excel() {
    const sel = visible().filter(it => checked.has(it.id));
    const list = sel.length ? sel : visible();
    if (!list.length) return U.toast('내려받을 단지가 없습니다.');
    if (!list.some(it => calc.has(it.id))) return U.toast('먼저 [시세 불러오기]를 눌러 주세요.');
    const cols = CONFIG.TRACKING_COLUMNS;
    const rowsOut = list.map(rowValues).sort((a, b) => (b['매매'] || 0) - (a['매매'] || 0)).map(v => cols.map(c => v[c] ?? ''));
    const ym = $('trkMonth').value;
    U.xlsx(`시세트래킹_${ym}_${U.stamp()}.xlsx`, [
      { name: `시세트래킹 ${ym}`, rows: [cols, ...rowsOut] },
      { name: '설명', rows: [['항목', '설명'], ['금액 단위', '만원'], ['매매·전세', '기준월 실거래 평균가 (거래가 없으면 이전 최근 실거래가)'],
        ['매매개수·전세개수', '기준월 실거래 건수'], ['전월대비', '기준월 값 - 전월 값'], ['전세가율', '전세 ÷ 매매 × 100 (%)'], ['전고점·전저점', `${String(CONFIG.PEAK_FROM).slice(0, 4)}년 이후 기준월까지 매매 실거래 최고가·최저가 (직거래 제외)`], ['전고대비·전저대비', '기준월 매매가가 전고점·전저점 대비 몇 % 인지'], ['기준월', ym], ['자료', '국토교통부 실거래가 공개시스템']] },
    ]);
  }

  function backup() {
    const blob = new Blob([JSON.stringify({ type: 'apt-tracking', savedAt: new Date().toISOString(), items, grouping: Store.get('apt.grouping.v1', null) }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `시세트래킹_백업_${U.stamp()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function restore(e) {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      if (obj.type !== 'apt-tracking' || !Array.isArray(obj.items)) throw new Error();
      const merge = items.length && confirm('지금 목록에 합칠까요?\n[확인] 합치기  /  [취소] 백업 내용으로 바꾸기');
      items = merge ? [...items, ...obj.items.filter(n => !items.some(it => it.id === n.id))] : obj.items;
      if (obj.grouping && (!Store.get('apt.grouping.v1', null) || !merge)) { Store.set('apt.grouping.v1', obj.grouping); Grouping.reload(); }
      save(); fillRegions(); render();
      U.toast(`백업을 불러왔습니다. (단지 ${items.length}개)`);
    } catch (err) { U.toast('백업 파일을 읽을 수 없습니다.'); }
  }

  /** 탭을 열 때 호출 */
  function open() { render(); if (visible().some(it => !calc.has(it.id))) load(); }

  return { init, add, all, open, pyeong };
})();
