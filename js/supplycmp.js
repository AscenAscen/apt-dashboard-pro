/* ─────────────────────────────────────────────────────────
   supplycmp.js — 분양가 vs 주변 시세 ([공급지도] 탭 아래쪽, [공급] 탭에서 옮겨 옴)
   · 분양가·경쟁률: data/supply.json (청약홈, scripts/supply.py 가 매주 자동 수집)
   · 주변 시세: 실거래 파일로 화면에서 계산 (같은 동/구 · 비슷한 평형 ±3㎡ · 최근 12개월 매매, 직거래 제외)
   · 지역: [공급지도] 위쪽에서 고른 시도·시군구를 그대로 따름 (SupplyMap 이 setCodes 로 알려 줌)
   저장: apt.supplyCmp.v1 (공고 기간·비교 범위·비교 대상·평형)
   ───────────────────────────────────────────────────────── */
const SupplyCmp = (() => {
  const $ = (id) => document.getElementById(id);
  const SK = 'apt.supplyCmp.v1';
  let st = { pubYears: 2, scope: 'dong', age: 'new', py: '' };
  let items = null, codes = [], label = '', rows = [], open = new Set(), f = null, seq = 0, K = null, ready = false, wanted = false, lastKey = '';
  const eok = (v) => (v == null ? '-' : (v / 10000).toFixed(2) + '억');
  const nowYm = () => { const t = new Date(); return t.getFullYear() * 100 + t.getMonth() + 1; };
  const ymTxt = (m) => (m ? `${Math.floor(m / 100)}.${String(m % 100).padStart(2, '0')}` : '-');
  const norm = (s) => String(s || '').replace(/\s|\(.*?\)|아파트/g, '');
  function siGu(it) { const r = K && K.reg(it.c); return r ? U.siGu(r[1], r[2]) : [it.sd, it.sg]; }
  const visible = () => { const t = $('tab-supplymap'); return t && !t.hidden; };

  async function load() {
    if (items) return items;
    const sp = await Data.json('supply.json', null);
    items = (sp && sp.items) || [];
    return items;
  }

  /** [공급지도] 에서 지역이 바뀔 때마다 부름 */
  function setCodes(cs, lb) {
    codes = cs || []; label = lb || '';
    wanted = true;
    if (visible()) build();
  }

  async function build(force) {
    if (!ready) return;
    const key = codes.join(',') + JSON.stringify(st);
    if (!force && key === lastKey) return;                  // 같은 조건이면 다시 계산하지 않음
    lastKey = key;
    const my = ++seq;
    await load();
    $('bcScope').textContent = label ? `· ${label}` : '';
    if (!items.length) { rows = []; draw(); $('bcEmpty').textContent = '청약홈 공급 자료가 아직 없습니다. [공급] 탭 안내대로 첫 수집을 한 번 실행해 주세요.'; return; }
    const cs = new Set(codes);
    const from = String(Math.floor(nowYm() / 100) - st.pubYears) + String(nowYm() % 100).padStart(2, '0') + '01';
    const l = items.filter(it => it.c && cs.has(it.c) && it.pub && (st.pubYears >= 7 || it.pub >= from) && it.m && it.m.length);
    const need = [...new Set(l.map(it => it.c))];
    $('bcEmpty').hidden = false; $('bcEmpty').textContent = need.length ? `주변 실거래 불러오는 중… (0/${need.length} 지역)` : '';
    const sale = await K.sale(need, (i, n) => { if (my === seq) $('bcEmpty').textContent = `주변 실거래 불러오는 중… (${i}/${n} 지역)`; });
    if (my !== seq) return;
    const t = new Date(), since = (t.getFullYear() - 1) * 10000 + (t.getMonth() + 1) * 100 + t.getDate();
    const minYear = t.getFullYear() - 10;
    const out = [];
    for (const it of l) {
      const m = sale.get(it.c) || new Map(), mt = K.meta(it.c) || { by: {} };
      for (const [ty, area, n, price] of it.m) {
        if (!area || !price) continue;
        const pc = Home.pyClass(area);
        if (st.py && pc !== st.py) continue;
        const comp = [];
        m.forEach(o => {
          if (Math.abs(o.area - area) > 3) return;
          const p = Data.parseKey(o.key);
          if (st.scope === 'dong' && p.dong !== it.dg) return;
          if (norm(p.name) && norm(it.nm).includes(norm(p.name))) return;            // 자기 단지(입주 뒤 거래) 빼기
          const by = mt.by[o.key];
          if (st.age === 'new' && !(by && by >= minYear)) return;
          const tr = o.tr.filter(x => x.d >= since && !x.direct);
          if (!tr.length) return;
          comp.push({ name: p.name, dong: p.dong, area: o.area, by, avg: tr.reduce((a, x) => a + x.price, 0) / tr.length, n: tr.length, last: tr[tr.length - 1] });
        });
        const avg = comp.length ? comp.reduce((a, x) => a + x.avg, 0) / comp.length : null;
        out.push({ rid: `${it.id}#${ty}`, it, ty, area, n, price, pc, comp, avg, diff: avg ? (price / avg - 1) * 100 : null, cr: it.cm ? it.cm[ty] ?? null : null });
      }
    }
    rows = out;
    draw();
  }

  function cols() {
    const N = ColFilter.numCol, T = ColFilter.txtCol;
    return {
      si: T('시', r => siGu(r.it)[0]), gu: T('구', r => siGu(r.it)[1]), dong: T('동', r => r.it.dg), name: T('단지', r => r.it.nm),
      ty: { label: '주택형', get: r => `${r.ty.replace(/^0+/, '')} (${CONFIG.toPyeong(r.area)}평)`, num: r => r.area }, pc: T('평형 구분', r => Home.pyName(r.pc)),
      pub: { label: '공고일', get: r => (r.it.pub ? `${r.it.pub.slice(0, 4)}.${r.it.pub.slice(4, 6)}` : ''), num: r => +r.it.pub || null },
      mv: { label: '입주 예정', get: r => ymTxt(r.it.mv), num: r => r.it.mv },
      price: N('분양가', r => r.price), avg: N('주변 시세', r => r.avg), diff: N('주변 대비', r => r.diff, 'pct'),
      cnt: N('비교 단지', r => r.comp.length, 'n'), cr: N('경쟁률', r => r.cr, 'n'),
    };
  }
  const F = () => f || (f = ColFilter.create({ key: 'sup2', cols, bar: 'bcCfBar', onChange: draw }));
  function draw() {
    const l = F().apply(rows, (x) => [...x].sort((a, b) => (b.it.pub || '').localeCompare(a.it.pub || '') || a.it.nm.localeCompare(b.it.nm, 'ko') || a.area - b.area));
    $('bcEmpty').hidden = l.length > 0;
    if (!l.length && items && items.length) $('bcEmpty').textContent = rows.length ? '필터에 맞는 주택형이 없습니다.' : '고른 지역·기간에 청약홈 분양 공고가 없습니다.';
    const b = (k) => F().btn(k), c = cols();
    const th = (k, cls = '') => `<th class="${cls}">${c[k].label}${b(k)}</th>`;
    $('bcTable').innerHTML = !l.length ? '' : `<thead><tr>${th('si', 'l')}${th('gu', 'l')}${th('dong', 'l')}${th('name', 'l name')}${th('ty')}${th('pc')}${th('pub')}${th('mv')}${th('price')}${th('avg')}${th('diff')}${th('cnt')}${th('cr')}</tr></thead><tbody>` +
      l.map(r => { const [si, gu] = siGu(r.it), weak = r.comp.length < 3;
        let h = `<tr data-r="${U.esc(r.rid)}" class="click${weak ? ' old' : ''}"><td class="l">${U.esc(si)}</td><td class="l">${U.esc(gu)}</td><td class="l">${U.esc(r.it.dg)}</td><td class="l name">${r.it.url ? `<a href="${U.esc(r.it.url)}" target="_blank" rel="noopener">${U.esc(r.it.nm)}</a>` : U.esc(r.it.nm)}</td>` +
          `<td>${U.esc(r.ty.replace(/^0+/, ''))}<small>${CONFIG.toPyeong(r.area)}평</small></td><td>${Home.pyName(r.pc)}</td><td>${r.it.pub ? r.it.pub.slice(2, 4) + '.' + r.it.pub.slice(4, 6) : '-'}</td><td>${ymTxt(r.it.mv)}</td>` +
          `<td class="sale"><b>${eok(r.price)}</b></td><td>${eok(r.avg)}</td><td class="${U.cls(r.diff)}">${r.diff == null ? '-' : U.pct(r.diff)}</td><td>${r.comp.length}${weak ? ' <small>비교 부족</small>' : ''} ${r.comp.length ? (open.has(r.rid) ? '▴' : '▾') : ''}</td><td>${r.cr == null ? '-' : r.cr.toFixed(1) + ':1'}</td></tr>`;
        if (open.has(r.rid) && r.comp.length) h += `<tr class="hmsub"><td colspan="13">${r.comp.slice().sort((a, b) => b.avg - a.avg).map(x => `<span>${U.esc(x.dong)} ${U.esc(x.name)} ${Math.round(x.area)}㎡ · 평균 <b>${eok(x.avg)}</b> (${x.n}건, 최근 ${U.date(x.last.d)}) · ${x.by || '-'}년</span>`).join('<br>')}</td></tr>`;
        return h; }).join('') + '</tbody>';
    // 휴대폰: 카드
    const narrow = window.innerWidth <= 760;
    $('bcTable').closest('.tablewrap').hidden = narrow; $('bcCards').hidden = !narrow;
    if (narrow) $('bcCards').innerHTML = l.slice(0, 300).map(r => `<div class="hmrc"><div class="hmrc1"><b>${U.esc(r.it.nm)} ${U.esc(r.ty.replace(/^0+/, ''))}</b> <small>${U.esc(siGu(r.it).filter(Boolean).join(' '))} ${U.esc(r.it.dg)} · 공고 ${r.it.pub ? r.it.pub.slice(0, 4) + '.' + r.it.pub.slice(4, 6) : '-'}</small></div>` +
      `<div class="hmrc2"><span>분양가 <b>${eok(r.price)}</b></span><span>주변 <b>${eok(r.avg)}</b></span><span>주변 대비 <b class="${U.cls(r.diff)}">${r.diff == null ? '-' : U.pct(r.diff)}</b></span><span>비교 <b>${r.comp.length}곳</b></span><span>경쟁률 <b>${r.cr == null ? '-' : r.cr.toFixed(1) + ':1'}</b></span></div></div>`).join('');
    SupplyCmp._l = l;
  }

  function excel() {
    const l = SupplyCmp._l || [], c = cols(), ks = Object.keys(c);
    const out = [ks.map(k => c[k].label), ...l.map(r => ks.map(k => { if (k === 'price' || k === 'avg') { const v = c[k].num(r); return v == null ? '' : +(v / 10000).toFixed(2); } if (k === 'diff') { const v = c[k].num(r); return v == null ? '' : +v.toFixed(1); } return c[k].get(r); }))];
    U.download(`공급지도_분양가비교_${U.stamp()}`, [{ name: '분양가비교', rows: out }]);
  }
  function sync() {
    $('bcPubYears').value = String(st.pubYears);
    document.querySelectorAll('#bcScopeSeg button').forEach(b => b.classList.toggle('on', b.dataset.s === st.scope));
    document.querySelectorAll('#bcAge button').forEach(b => b.classList.toggle('on', b.dataset.a === st.age));
    document.querySelectorAll('#bcPy button').forEach(b => b.classList.toggle('on', b.dataset.p === st.py));
  }
  const save = () => { Store.set(SK, st); sync(); build(); };

  function init() {
    if (!$('bcTable')) return;
    K = Home.kit;
    st = Object.assign(st, Store.get(SK, {}) || {});
    sync();
    $('bcPubYears').onchange = () => { st.pubYears = +$('bcPubYears').value; save(); };
    $('bcScopeSeg').onclick = (e) => { const b = e.target.closest('button'); if (b) { st.scope = b.dataset.s; save(); } };
    $('bcAge').onclick = (e) => { const b = e.target.closest('button'); if (b) { st.age = b.dataset.a; save(); } };
    $('bcPy').onclick = (e) => { const b = e.target.closest('button'); if (b) { st.py = b.dataset.p; save(); } };
    $('bcTable').onclick = (e) => { const tr = e.target.closest('tr[data-r]'); if (!tr || e.target.closest('button.colf, a')) return; const id = tr.dataset.r; open.has(id) ? open.delete(id) : open.add(id); draw(); };
    $('bcExcel').onclick = excel;
    ready = true;
    // [공급지도] 탭이 처음 보일 때 계산 (무거워서 미리 하지 않음)
    new MutationObserver(() => { if (visible() && wanted) build(); }).observe($('tab-supplymap'), { attributes: true, attributeFilter: ['hidden'] });
    K.regReady().then(() => { if (visible() && wanted) build(); });
  }
  return { init, setCodes, _st: () => st };
})();
