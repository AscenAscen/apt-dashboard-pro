/* ─────────────────────────────────────────────────────────
   survey.js — [전수조사] 탭
   한 지역의 모든 단지·평형을 시세트래킹과 같은 양식의 표로 깔아 놓고,
   호가를 달마다 적어 가격대로 좁힌 뒤 시세트래킹에 담습니다.
   호가·세대수 등 적은 값은 시세트래킹과 같은 곳에 저장됩니다. (Tracking.rec)
   ───────────────────────────────────────────────────────── */
const Survey = (() => {
  const $ = (id) => document.getElementById(id);
  const PAGE = 200;                 // 한 번에 그리는 줄 수
  let regions = [], reg = null, rows = [], view = [], shown = 0;
  const checked = new Set();

  const eok = (v) => (v == null ? '' : String(+(v / 10000).toFixed(4)));
  const toMan = (text) => { const n = parseFloat(String(text).replace(/,/g, '')); return isNaN(n) ? null : Math.round(n * 10000); };
  const month = () => +$('svMonth').value || 0;
  const prevMonth = () => { const ms = Tracking.getMonths(), i = ms.indexOf(month()); return i >= 0 ? ms[i + 1] : undefined; };

  async function init() {
    regions = await Data.regions();
    const sidos = [...new Set(regions.map(r => r[1]))];
    $('svSido').innerHTML = sidos.map(x => `<option>${U.esc(x)}</option>`).join('');
    const saved = Store.get('apt.lastRegion', null);
    if (saved && sidos.includes(saved.sido)) $('svSido').value = saved.sido;
    const fillSgg = (code) => {
      const list = regions.filter(r => r[1] === $('svSido').value);
      $('svSgg').innerHTML = list.map(r => `<option value="${r[0]}">${U.esc(r[2])}</option>`).join('');
      if (code && list.some(r => r[0] === code)) $('svSgg').value = code;
    };
    fillSgg(saved?.code);
    $('svSido').onchange = () => fillSgg();
    $('btnSurvey').onclick = load;
    const now = new Date();
    $('svNewMonth').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    $('btnSvAddMonth').onclick = () => {
      const ym = +($('svNewMonth').value || '').replace('-', '');
      if (!ym) return U.toast('추가할 달을 고르세요.');
      if (!Tracking.addMonth(ym)) return U.toast(`${Tracking.ymLabel(ym)} 은(는) 이미 있습니다. "기록할 달"에서 고르세요.`);
      fillMonths(ym); apply();
      U.toast(`${Tracking.ymLabel(ym)} 기록 칸을 만들었습니다.`);
    };
    $('svMonth').onchange = apply;
    ['svDong', 'svSize', 'svSort', 'svOnlyQuoted', 'svRecent'].forEach(id => { $(id).onchange = apply; });
    let timer;
    ['svFind', 'svMin', 'svMax', 'svYear', 'svHouse'].forEach(id => { $(id).oninput = () => { clearTimeout(timer); timer = setTimeout(apply, 300); }; });
    $('btnSvMore').onclick = () => { shown += PAGE; render(); };
    $('btnSvTrack').onclick = () => {
      const sel = rows.filter(r => checked.has(r.id));
      if (!sel.length) return U.toast('먼저 표에서 단지를 체크하세요.');
      Tracking.add(sel); checked.clear(); render();
    };
    $('btnSvExcel').onclick = excel;
    fillMonths();
  }

  function fillMonths(select) {
    const ms = Tracking.getMonths(), cur = select || month();
    $('svMonth').innerHTML = ms.length ? ms.map(m => `<option value="${m}">${Tracking.ymLabel(m)}</option>`).join('') : '<option value="">(달 추가를 먼저)</option>';
    if (ms.includes(cur)) $('svMonth').value = cur;
  }

  /** 이 지역 모든 단지·평형 불러오기 (2020년 이후 실거래로 전고점·전저점·최근 실거래 계산) */
  async function load() {
    const code = $('svSgg').value;
    reg = regions.find(r => r[0] === code);
    if (!reg) return;
    const btn = $('btnSurvey');
    btn.disabled = true; btn.textContent = '불러오는 중…';
    try {
      const idx = await Data.index(code);
      if (!Object.keys(idx.c).length) {
        $('svBody').hidden = true; $('svEmpty').hidden = false;
        $('svEmpty').innerHTML = `<b>${U.esc(reg[1])} ${U.esc(reg[2])}</b> 은(는) 아직 수집된 데이터가 없습니다.`;
        return;
      }
      Store.set('apt.lastRegion', { sido: reg[1], code });
      const nowY = new Date().getFullYear();
      const data = await Data.loadYears(code, Math.floor(CONFIG.PEAK_FROM / 10000), nowY);
      const map = new Map();
      const get = (key, g) => {
        const id = `${code}|${key}#${g}`;
        if (!map.has(id)) map.set(id, { id, code, sido: reg[1], sgg: reg[2], key, ...Data.parseKey(key), g, buildYear: idx.c[key] || null, sale: null, rent: null, peak: null, trough: null });
        return map.get(id);
      };
      Data.eachTrade(data.sale, null, (key, t) => {
        if (t.direct) return;                                   // 직거래 제외
        const r = get(key, t.g);
        if (!r.sale || t.d >= r.sale.d) r.sale = t;
        if (!r.peak || t.price >= r.peak.price) r.peak = t;
        if (!r.trough || t.price < r.trough.price) r.trough = t;
      });
      Data.eachTrade(data.rent, null, (key, t) => { const r = get(key, t.g); if (!r.rent || t.d >= r.rent.d) r.rent = t; });
      rows = [...map.values()];
      rows.forEach(r => { r.st = { last: r.sale }; });           // 트래킹에 담을 때 쓰는 최근가
      const dongs = [...new Set(rows.map(r => r.dong))].sort((a, b) => a.localeCompare(b, 'ko'));
      $('svDong').innerHTML = '<option value="">전체</option>' + dongs.map(d => `<option>${U.esc(d)}</option>`).join('');
      checked.clear();
      $('svEmpty').hidden = true; $('svBody').hidden = false;
      fillMonths(); apply();
    } finally {
      btn.disabled = false; btn.textContent = '이 지역 모든 단지 불러오기';
    }
  }

  /** 한 줄의 계산값 (만원) */
  function compute(r) {
    const rc = Tracking.rec(r.id) || { quotes: {} };
    const m = month(), q = rc.quotes[m] || {}, p = rc.quotes[prevMonth()] || {};
    const peak = rc.peakO ?? r.peak?.price ?? null, trough = rc.troughO ?? r.trough?.price ?? null;
    const base = q.s ?? r.sale?.price ?? null;                 // 가격대·정렬 기준: 적은 호가, 없으면 최근 실거래
    const sub = (a, b) => (a == null || b == null ? null : a - b);
    const ratio = (s, x) => (s && x ? x / s * 100 : null);
    return { rc, q, peak, trough, base, quoted: q.s != null, band: base ? CONFIG.priceBand(base) : '',
      drop: base && peak ? (base / peak - 1) * 100 : null, rise: base && trough ? (base / trough - 1) * 100 : null,
      sd: sub(q.s, p.s), rd: sub(q.r, p.r), gap: sub(q.s, q.r), gd: sub(sub(q.s, q.r), sub(p.s, p.r)),
      ratio: ratio(q.s, q.r), rtd: sub(ratio(q.s, q.r), ratio(p.s, p.r)) };
  }

  function calcCells(c) {
    const d = (v) => [U.diff(v), U.cls(v)];
    return {
      band: [(c.band || '-') + (c.base && !c.quoted ? ' <span class="star" title="호가가 없어 최근 실거래가 기준">실</span>' : ''), ''],
      drop: [U.pct(c.drop), U.cls(c.drop)], rise: [U.pct(c.rise), U.cls(c.rise)],
      sd: d(c.sd), rd: d(c.rd), gap: [c.gap == null ? '-' : U.price(c.gap), ''], gd: d(c.gd),
      ratio: [c.ratio == null ? '-' : c.ratio.toFixed(1) + '%', ''],
      rtd: [c.rtd == null ? '-' : (c.rtd > 0 ? '+' : '') + c.rtd.toFixed(1) + '%p', U.cls(c.rtd)],
    };
  }

  /** 조건으로 좁히고 정렬 (정렬은 이때 한 번만 — 입력 중에는 줄이 움직이지 않음) */
  function apply() {
    if (!rows.length) return;
    const dong = $('svDong').value, size = $('svSize').value, find = $('svFind').value.trim().toLowerCase();
    const min = parseFloat($('svMin').value), max = parseFloat($('svMax').value), year = parseInt($('svYear').value, 10), house = parseInt($('svHouse').value, 10);
    const onlyQ = $('svOnlyQuoted').checked, recent = $('svRecent').checked;
    const t = new Date(); const from = (t.getFullYear() - 3) * 10000 + (t.getMonth() + 1) * 100 + t.getDate();
    const inSize = (g) => size === 'all' || (size === '59' ? g >= 55 && g < 62 : size === '84' ? g >= 80 && g < 86 : size === 's' ? g < 60 : size === 'm' ? g >= 60 && g <= 85 : g > 85);
    view = rows.filter(r => {
      if (dong && r.dong !== dong) return false;
      if (!inSize(r.g)) return false;
      if (find && !r.name.toLowerCase().includes(find)) return false;
      if (!isNaN(year) && !(r.buildYear >= year)) return false;
      const c = compute(r); r._c = c;
      if (onlyQ && !c.quoted) return false;
      if (recent && !c.quoted && !((r.sale && r.sale.d >= from) || (r.rent && r.rent.d >= from))) return false;
      if (!isNaN(min) && !(c.base >= min * 10000)) return false;
      if (!isNaN(max) && !(c.base != null && c.base <= max * 10000)) return false;
      if (!isNaN(house) && !(parseInt(c.rc.households, 10) >= house)) return false;
      return true;
    });
    const by = $('svSort').value, num = (v, none) => (v == null || isNaN(v) ? none : v);
    const key = {
      name: null,
      price: (r) => -num(r._c.base, -1), priceAsc: (r) => num(r._c.base, 1e12),
      house: (r) => -num(parseInt(r._c.rc.households, 10), -1),
      g: (r) => -r.g, gAsc: (r) => r.g,
      gap: (r) => num(r._c.gap, 1e12), year: (r) => -(r.buildYear || 0),
    }[by];
    view.sort((a, b) => (key ? key(a) - key(b) : 0) || a.name.localeCompare(b.name, 'ko') || a.g - b.g);
    shown = PAGE;
    render();
  }

  function render() {
    const list = view.slice(0, shown), m = month();
    $('svTitle').textContent = `${reg[1]} ${reg[2]} — 단지·평형 ${view.length.toLocaleString()}개` + (view.length !== rows.length ? ` (전체 ${rows.length.toLocaleString()}개 중)` : '');
    const F = Tracking.FIXED, G = Tracking.GROUP;
    const fx = (label, cls = '') => `<th rowspan="2" class="${cls}">${label}</th>`;
    const head = '<thead><tr>' + fx('<input type="checkbox" id="svAll" title="보이는 줄 전체 선택">', 'c') +
      F.map((n, i) => fx(n, [1, 2, 3, 4, 5].includes(i) ? 'l' : '')).join('') +
      (m ? `<th colspan="10" class="grp c">${Tracking.ymLabel(m)} 기록</th>` : '<th class="grp c">먼저 위에서 [달 추가]를 눌러 기록할 달을 만드세요</th>') +
      fx('최근 매매 실거래') + fx('최근 전세 실거래') + fx('지도', 'c') + '</tr><tr>' +
      (m ? G.map((n, i) => `<th class="${[0, 1, 3, 4].includes(i) ? 'in' : ''}${i === 0 ? ' gl' : ''}">${n}${i === 0 || i === 3 ? '(억)' : ''}</th>`).join('') : '<th></th>') + '</tr></thead>';
    const [si, gu] = U.siGu(reg[1], reg[2]);
    const pk = (t) => (t ? `${U.price(t.price)}<small>${U.date(t.d)}</small>` : '-');
    const body = list.map((r, i) => {
      const c = r._c = compute(r), cells = calcCells(c), rc = c.rc;
      const cell = (k, extra = '') => `<td data-c="${k}" class="${cells[k][1]} ${extra}">${cells[k][0]}</td>`;
      const inp = (f, ph = '') => `<input data-f="${f}" value="${U.esc(rc[f] || '')}" placeholder="${ph}">`;
      const over = (f, v, auto) => `<td><input class="num${rc[f] != null ? ' edited' : ''}" data-o="${f}" inputmode="decimal" value="${eok(v)}" placeholder="자동" title="${auto ? `실거래 ${U.price(auto.price)} (${U.date(auto.d)}) · 눌러서 수정, 지우면 자동값` : '실거래 자료 없음 · 직접 입력'}"></td>`;
      const qin = (f, ph, isPrice, first) => `<td class="${first ? 'gl' : ''}"><input class="num" data-q="${f}" inputmode="decimal" value="${isPrice ? eok(c.q[f]) : (c.q[f] ?? '')}" placeholder="${ph}"></td>`;
      const link = rc.link || U.landLink(r.sgg, r.dong, r.name);
      return `<tr data-i="${i}" class="${Tracking.has(r.id) ? 'tracked' : ''}"><td class="c"><input type="checkbox" data-chk="${i}" ${checked.has(r.id) ? 'checked' : ''}></td>` +
        `${cell('band')}<td class="l">${U.esc(si)}</td><td class="l">${U.esc(gu)}</td><td class="l">${U.esc(r.dong)}</td><td class="l">${inp('zone', '생활권')}</td><td class="l name">${U.esc(r.name)}</td>` +
        `<td>${r.buildYear || '-'}</td><td>${r.buildYear ? CONFIG.toAge(r.buildYear) : '-'}</td><td>${inp('households', '직접 입력')}</td><td>${r.g}㎡<small>${rc.pyeong || CONFIG.toPyeong(r.g) + '평'}</small></td><td>${inp('structure', '계/복')}</td><td>${inp('rooms')}</td><td>${inp('baths')}</td>` +
        `<td><a class="btn mini" href="${U.esc(link)}" target="_blank" rel="noopener">열기</a></td>` +
        `${over('peakO', c.peak, r.peak)}${cell('drop')}${over('troughO', c.trough, r.trough)}${cell('rise')}` +
        (m ? qin('s', '예: 14.3', true, true) + qin('sn', '개') + cell('sd') + qin('r', '예: 7.5', true) + qin('rn', '개') + cell('rd') + cell('gap') + cell('gd') + cell('ratio') + cell('rtd') : '<td class="gl"></td>') +
        `<td class="sale">${pk(r.sale)}</td><td class="rent">${pk(r.rent)}</td><td class="c"><button class="mini" data-map="${i}">위치</button></td></tr>`;
    }).join('');
    const table = $('svTable');
    table.innerHTML = head + `<tbody>${body}</tbody>`;
    $('svNote').textContent = view.length > list.length ? `${view.length.toLocaleString()}개 중 ${list.length.toLocaleString()}개를 표시했습니다. 조건으로 좁히거나 [더 보기]를 누르세요. (엑셀에는 좁힌 결과 전체가 들어갑니다)` : (view.length ? '' : '조건에 맞는 단지가 없습니다.');
    $('btnSvMore').hidden = view.length <= list.length;
    table.querySelector('#svAll').onclick = (e) => { list.forEach(r => (e.target.checked ? checked.add(r.id) : checked.delete(r.id))); render(); $('svAll').checked = e.target.checked; };
    const tbody = table.querySelector('tbody');
    tbody.onclick = (e) => {
      const t = e.target;
      if (t.dataset.chk != null) { const r = list[+t.dataset.chk]; t.checked ? checked.add(r.id) : checked.delete(r.id); }
      if (t.dataset.map != null) App.showMap(list[+t.dataset.map]);
    };
    tbody.onchange = (e) => {
      const t = e.target, tr = t.closest('tr');
      if (!tr || t.type === 'checkbox') return;
      const r = list[+tr.dataset.i], rc = Tracking.rec(r.id, true);
      if (t.dataset.f) rc[t.dataset.f] = t.value.trim();
      if (t.dataset.o) {
        const v = toMan(t.value), auto = (t.dataset.o === 'peakO' ? r.peak : r.trough)?.price ?? null;
        if (v == null || v === auto) { delete rc[t.dataset.o]; t.value = eok(auto); t.classList.remove('edited'); }
        else { rc[t.dataset.o] = v; t.classList.add('edited'); }
      }
      if (t.dataset.q) {
        const f = t.dataset.q, m2 = month();
        const q = rc.quotes[m2] = rc.quotes[m2] || {};
        const v = (f === 's' || f === 'r') ? toMan(t.value) : (t.value.trim() === '' || isNaN(parseInt(t.value, 10)) ? null : parseInt(t.value, 10));
        if (v == null) { delete q[f]; t.value = ''; } else q[f] = v;
        if (!Object.keys(q).length) delete rc.quotes[m2];
        if (f === 's' && v != null && Tracking.has(r.id)) rc.lastSale = v;
      }
      const cells = calcCells(r._c = compute(r));               // 계산 칸만 다시 그림
      tr.querySelectorAll('td[data-c]').forEach(td => { const x = cells[td.dataset.c]; if (x) { td.innerHTML = x[0]; td.className = x[1]; } });
      Tracking.save();
    };
  }

  function excel() {
    const sel = view.filter(r => checked.has(r.id));
    const list = sel.length ? sel : view;
    if (!list.length) return U.toast('내려받을 단지가 없습니다.');
    const m = month(), [si, gu] = U.siGu(reg[1], reg[2]), r1 = (v) => (v == null ? '' : +v.toFixed(1));
    const F = Tracking.FIXED.map(n => (n === '구조' ? '구조(계,복)' : n)), G = Tracking.GROUP;
    const tail = ['최근 매매 실거래', '매매 실거래일', '최근 전세 실거래', '전세 실거래일', '가격대 기준'];
    const top = [...F.map(() => ''), ...(m ? [Tracking.ymLabel(m), ...G.slice(1).map(() => '')] : []), ...tail.map(() => '')];
    const out = list.map(r => {
      const c = compute(r), rc = c.rc;
      return [c.band, si, gu, r.dong, rc.zone || '', r.name, r.buildYear || '', r.buildYear ? CONFIG.toAge(r.buildYear) : '', rc.households || '', rc.pyeong || CONFIG.toPyeong(r.g) + '평',
        rc.structure || '', rc.rooms || '', rc.baths || '', rc.link || U.landLink(r.sgg, r.dong, r.name), c.peak ?? '', r1(c.drop), c.trough ?? '', r1(c.rise),
        ...(m ? [c.q.s ?? '', c.q.sn ?? '', c.sd ?? '', c.q.r ?? '', c.q.rn ?? '', c.rd ?? '', c.gap ?? '', c.gd ?? '', r1(c.ratio), r1(c.rtd)] : []),
        r.sale?.price ?? '', U.date(r.sale?.d), r.rent?.price ?? '', U.date(r.rent?.d), c.quoted ? '호가' : (c.base ? '실거래' : '')];
    });
    U.download(`전수조사_${reg[2]}_${m || ''}_${U.stamp()}`, [
      { name: '전수조사', rows: [top, [...F, ...(m ? G : []), ...tail], ...out] },
      { name: '설명', rows: [['항목', '설명'], ['금액 단위', '만원'], ['매매·전세·개수', '기록한 달에 직접 적은 호가와 매물 수'], ['전월 대비', '기록한 달 값 - 바로 앞 기록 달 값'],
        ['가격대', '적은 매매 호가 기준. 호가가 없으면 최근 실거래가 기준(맨 오른쪽 열에 표시)'], ['전고점·전저점', `${String(CONFIG.PEAK_FROM).slice(0, 4)}년 이후 매매 실거래 최고·최저가(직거래 제외). 직접 고친 값이 있으면 그 값`],
        ['실거래 자료', '국토교통부 실거래가 공개시스템']] },
    ], 'xlsx');
  }

  /** 탭을 열 때: 시세트래킹에서 달이 추가됐을 수 있으니 목록 갱신 */
  function open() { fillMonths(); if (rows.length) apply(); }

  return { init, open };
})();
