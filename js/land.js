/* ─────────────────────────────────────────────────────────
   land.js — [대장 지도] 탭
   · 지역 대표(대장) 단지를 직접 골라 등급(S/A/B)을 매기고 지도에 표시
   · 점을 누르면 단지 카드(가격·전고 대비·추세), 지도를 멀리 보면 낮은 등급 이름표는 숨김
   · 대장 대비 격차: 내 단지(시세트래킹)가 대장보다 얼마나 싼지
   등급 이름·색은 js/config.js 의 GRADES 에서 바꿉니다. 좌표는 저장하지 않고 열 때마다 다시 찾습니다.
   ───────────────────────────────────────────────────────── */
const Land = (() => {
  const $ = (id) => document.getElementById(id);
  const KEY = 'apt.land.v1';
  let map = Store.get(KEY, {});        // { 단지번호: { grade, name, sido, sgg, dong, jibun, t } }
  let regions = [], idx = { c: {} }, kmap = null, shapes = [], seq = 0, inited = false;
  const grade = (k) => CONFIG.GRADES.find(g => g.k === k) || CONFIG.GRADES[CONFIG.GRADES.length - 1];
  const rank = (k) => { const i = CONFIG.GRADES.findIndex(g => g.k === k); return i < 0 ? 99 : i; };
  const save = () => Store.set(KEY, map);
  const all = () => Object.keys(map).map(id => ({ ...Kit.parseId(id), ...map[id] })).sort((a, b) => rank(a.grade) - rank(b.grade) || a.name.localeCompare(b.name, 'ko'));
  /** 대장의 지금 가격: 적어 둔 매매 호가 → 없으면 최근 실거래 */
  function price(l) {
    const q = Kit.quote(Tracking.rec(l.id)), rl = Real.get(l.id);
    return q?.s != null ? { v: q.s, quoted: true, p: q.p?.s ?? null } : rl?.sale ? { v: rl.sale.price, quoted: false, p: null } : null;
  }
  /** 같은 시군구에서 등급이 가장 높은 대장과 견준 값 (내 분석 탭의 "대장 대비" 칸) */
  function leadOf(row) {
    if (!row.s) return null;
    const cand = all().filter(l => l.code === row.code && l.id !== row.id).map(l => ({ l, p: price(l) })).filter(x => x.p).sort((a, b) => rank(a.l.grade) - rank(b.l.grade) || b.p.v - a.p.v)[0];
    return cand ? { name: cand.l.name, price: cand.p.v, pct: row.s / cand.p.v * 100 } : null;
  }

  function add(r, g) {
    if (map[r.id]) { map[r.id].grade = g; save(); U.toast('이미 등록된 단지입니다. 등급만 바꿨습니다.'); }
    else { map[r.id] = { grade: g, name: r.name, sido: r.sido, sgg: r.sgg, dong: r.dong, jibun: r.jibun, t: Date.now() }; save(); U.toast(`${r.name} 을(를) ${grade(g).name} 등급으로 등록했습니다.`); }
    render();
  }

  /* ── 등록 칸 ── */
  function fillSgg(code) {
    const list = regions.filter(r => r[1] === $('ldSido').value);
    $('ldSgg').innerHTML = list.map(r => `<option value="${r[0]}">${U.esc(r[2])}</option>`).join('');
    if (code && list.some(r => r[0] === code)) $('ldSgg').value = code;
    fillApt(true);
  }
  async function fillApt(reload) {
    const code = $('ldSgg').value;
    if (reload) { idx = await Data.index(code); if (code !== $('ldSgg').value) return; }
    const find = $('ldFind').value.trim();
    const keys = Object.keys(idx.c).map(k => ({ k, ...Data.parseKey(k) })).filter(x => Alias.hit(code, x.k, x.name, x.dong, find)).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    $('ldApt').innerHTML = `<option value="">${keys.length ? `선택하세요 (${keys.length}개)` : (Object.keys(idx.c).length ? '검색 결과 없음' : '수집된 자료 없음')}</option>` +
      keys.slice(0, 800).map(x => `<option value="${U.esc(x.k)}">${U.esc(x.name)} (${U.esc(x.dong)})</option>`).join('');
    if (find && keys.length === 1) $('ldApt').value = keys[0].k;
    fillArea();
  }
  async function fillArea() {
    const code = $('ldSgg').value, key = $('ldApt').value, sel = $('ldArea');
    if (!key) { sel.innerHTML = ''; return; }
    const y = new Date().getFullYear();
    let tr = await Data.complexTrades(code, key, null, y - 5, y);
    if (!tr.sale.length && !tr.rent.length) tr = await Data.complexTrades(code, key, null, y - 20, y);
    if (key !== $('ldApt').value) return;
    const cnt = new Map();
    [...tr.sale, ...tr.rent].forEach(t => cnt.set(t.g, (cnt.get(t.g) || 0) + 1));
    const best = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0];
    sel.innerHTML = [...cnt.keys()].sort((a, b) => a - b).map(g => `<option value="${g}">${g}㎡ (${CONFIG.toPyeong(g)}평) · ${cnt.get(g)}건</option>`).join('');
    if (best) sel.value = best[0];
  }

  /* ── 화면 ── */
  async function render() {
    const list = all();
    $('ldEmpty').hidden = list.length > 0; $('ldBody').hidden = !list.length;
    const tr = Tracking.all().filter(it => !map[it.id]);
    $('ldFromTrack').innerHTML = tr.length ? tr.map(it => `<option value="${U.esc(it.id)}">${U.esc(it.name)} ${it.g}㎡</option>`).join('') : '<option value="">(담은 단지 없음)</option>';
    if (!list.length) return;
    await Real.load(list);
    const sidos = [...new Set(list.map(l => l.sido))], cur = $('ldRegion').value;
    $('ldRegion').innerHTML = '<option value="">전체</option>' + sidos.map(s => `<option>${U.esc(s)}</option>`).join('');
    if (sidos.includes(cur)) $('ldRegion').value = cur;
    $('ldLegend').innerHTML = CONFIG.GRADES.map(g => `<span style="color:${g.color}">●</span> ${U.esc(g.name)}`).join(' &nbsp; ') + ' · 지도를 멀리 보면 낮은 등급 이름은 숨겨집니다';
    table(list);
    const b = $('ldBase').value;
    $('ldBase').innerHTML = list.map(l => `<option value="${U.esc(l.id)}">[${l.grade}] ${U.esc(l.sgg)} ${U.esc(l.name)} ${l.g}㎡</option>`).join('');
    if (map[b]) $('ldBase').value = b;
    gap();
    draw();
  }

  function info(l) {
    const p = price(l), rl = Real.get(l.id) || {}, peak = rl.peak?.price;
    return { p, rl, drop: p && peak ? (p.v / peak - 1) * 100 : null };
  }
  function table(list) {
    $('ldTable').innerHTML = '<thead><tr><th>등급</th><th class="l">지역</th><th class="l">단지</th><th>평형</th><th>지금 가격</th><th>최근 실거래</th><th>전고점</th><th>전고 대비</th><th>12개월 실거래</th><th>세대수</th><th class="c">관리</th></tr></thead><tbody>' +
      list.map(l => { const x = info(l); return `<tr data-id="${U.esc(l.id)}"><td><select class="st" data-grade>${CONFIG.GRADES.map(g => `<option value="${g.k}" ${g.k === l.grade ? 'selected' : ''}>${g.k}</option>`).join('')}</select></td>` +
        `<td class="l">${U.esc(l.sgg)} ${U.esc(l.dong)}</td><td class="l"><b style="color:${grade(l.grade).color}">●</b> ${U.esc(l.name)}</td><td>${l.g}㎡<small>${CONFIG.toPyeong(l.g)}평</small></td>` +
        `<td class="sale">${x.p ? U.price(x.p.v) + (x.p.quoted ? '' : ' <span class="star">실</span>') : '-'}</td><td>${x.rl.sale ? `${U.price(x.rl.sale.price)}<small>${U.date(x.rl.sale.d)}${Kit.badge(x.rl.sale.d)}</small>` : '-'}</td>` +
        `<td>${x.rl.peak ? `${U.price(x.rl.peak.price)}<small>${U.date(x.rl.peak.d)}</small>` : '-'}</td><td class="${U.cls(x.drop)}">${U.pct(x.drop)}</td><td>${Kit.spark(x.rl.mon || [])}</td><td>${x.rl.hh ? x.rl.hh.toLocaleString() : '-'}</td>` +
        `<td class="c"><button class="mini" data-track>${Tracking.has(l.id) ? '★' : '트래킹 담기'}</button> <button class="mini danger" data-del>빼기</button></td></tr>`; }).join('') + '</tbody>';
  }
  function excel() {
    const list = all();
    U.download(`대장단지_${U.stamp()}`, [{ name: '대장 단지', rows: [['등급', '시도', '시군구', '동', '단지', '전용㎡', '지금 가격(만원)', '호가 여부', '최근 실거래(만원)', '전고점(만원)', '전고 대비(%)', '세대수'],
      ...list.map(l => { const x = info(l); return [l.grade, l.sido, l.sgg, l.dong, l.name, l.g, x.p?.v ?? '', x.p ? (x.p.quoted ? '호가' : '실거래') : '', x.rl.sale?.price ?? '', x.rl.peak?.price ?? '', x.drop == null ? '' : +x.drop.toFixed(1), x.rl.hh || '']; })] }]);
  }

  /* ── 대장 대비 격차 ── */
  async function gap() {
    const base = all().find(l => l.id === $('ldBase').value), vs = $('ldVs').value;
    if (!base) { $('ldGap').innerHTML = ''; return; }
    let mine = (await Kit.records(true)).filter(x => x.id !== base.id && (vs === 'all' || (vs === 'sido' ? x.sido === base.sido : x.code === base.code)));
    await Real.load(mine);
    const bp = price(base);
    const rows = mine.map(x => { const r = My.calc(x), q = r.q; return { r, pct: bp && r.s ? r.s / bp.v * 100 : null, diff: bp && r.s ? bp.v - r.s : null,
      prev: bp?.p && q?.p?.s ? bp.p - q.p.s : null }; }).sort((a, b) => (b.r.s || 0) - (a.r.s || 0));
    $('ldGap').innerHTML = `<thead><tr><th class="l">단지</th><th>평형</th><th>내 단지 가격</th><th>대장 가격<small>${U.esc(base.name)} ${base.g}㎡</small></th><th>격차 (대장 − 내 단지)</th><th>대장 대비</th><th>지난 기록의 격차</th><th>격차 변화</th></tr></thead><tbody>` +
      (rows.length ? rows.map(({ r, pct, diff, prev }) => { const chg = prev != null && diff != null ? diff - prev : null;
        return `<tr><td class="l">${U.esc(r.sgg)} ${U.esc(r.dong)} <b>${U.esc(r.name)}</b></td><td>${r.g}㎡<small>${CONFIG.toPyeong(r.g)}평</small></td><td class="sale">${r.s == null ? '-' : U.price(r.s) + (r.sQ ? '' : ' <span class="star">실</span>')}</td>` +
          `<td>${bp ? U.price(bp.v) + (bp.quoted ? '' : ' <span class="star">실</span>') : '-'}</td><td>${diff == null ? '-' : U.diff(diff)}</td><td><b>${pct == null ? '-' : pct.toFixed(0) + '%'}</b></td>` +
          `<td>${prev == null ? '<small>지난 호가 없음</small>' : U.diff(prev)}</td><td class="${U.cls(chg)}">${chg == null ? '-' : U.diff(chg) + `<small>${chg > 0 ? '벌어짐' : chg < 0 ? '좁혀짐' : ''}</small>`}</td></tr>`; }).join('')
        : '<tr><td colspan="8" style="color:var(--sub);padding:20px">견줄 내 단지가 없습니다. 시세트래킹에 단지를 담거나 "견줄 단지" 범위를 넓혀 보세요.</td></tr>') + '</tbody>';
  }

  /* ── 지도 ── */
  function card(l) {
    const x = info(l), q = Kit.quote(Tracking.rec(l.id));
    const c = (k, v, s = '', cls = '') => `<div class="card"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="s">${s}</div></div>`;
    $('ldCard').innerHTML = [
      c(`<b style="color:${grade(l.grade).color}">●</b> ${U.esc(grade(l.grade).name)}`, U.esc(l.name), `${U.esc(l.sgg)} ${U.esc(l.dong)} · ${l.g}㎡(${CONFIG.toPyeong(l.g)}평)${x.rl.hh ? ` · ${x.rl.hh.toLocaleString()}세대` : ''}`),
      c('지금 가격', x.p ? U.price(x.p.v) : '-', x.p ? (x.p.quoted ? `적어 둔 호가 (${Kit.ymText(q.ym)})` : '최근 실거래 기준') : '', 'sale'),
      c('최근 실거래', x.rl.sale ? U.price(x.rl.sale.price) : '-', x.rl.sale ? `${U.date(x.rl.sale.d)} · ${x.rl.sale.floor}층 ${Kit.badge(x.rl.sale.d)}` : ''),
      c('전고 대비', U.pct(x.drop), x.rl.peak ? `전고점 ${U.price(x.rl.peak.price)} (${U.date(x.rl.peak.d)})` : '', U.cls(x.drop)),
      c('12개월 실거래 흐름', Kit.spark(x.rl.mon || [], 130, 30), `최근 90일 매매 ${x.rl.n90 ?? 0}건 · <button class="mini" data-open="${U.esc(l.id)}">실거래 그래프</button>`),
    ].join('');
  }
  async function draw() {
    const my = ++seq, msg = $('ldMapMsg'), sido = $('ldRegion').value;
    const list = all().filter(l => !sido || l.sido === sido);
    const say = (html) => { msg.innerHTML = html; msg.hidden = false; };
    if (!KMap.ready()) return say(KMap.needKeyHtml);
    say(`단지 위치를 찾는 중… (0/${list.length})`);
    try {
      await KMap.load();
      let n = 0;
      for (const l of list) { l.pos = await KMap.geocode(l); if (my !== seq) return; say(`단지 위치를 찾는 중… (${++n}/${list.length})`); }
    } catch (e) { return say(U.esc(e.message || String(e))); }
    const ok = list.filter(l => l.pos);
    if (!ok.length) return say('단지 위치를 찾지 못했습니다.');
    msg.hidden = true;
    if (!kmap) {
      kmap = KMap.create($('ldMap'), ok[0].pos, 7);
      const zoom = () => { const lv = kmap.getLevel(); $('ldMap').dataset.zoom = lv >= 10 ? 'far' : lv >= 8 ? 'mid' : 'near'; };
      kakao.maps.event.addListener(kmap, 'zoom_changed', zoom); zoom();
    }
    shapes.forEach(x => x.remove()); shapes = [];
    ok.forEach(l => { const p = price(l); shapes.push(KMap.dot(kmap, l.pos, `${l.name}${p ? ' ' + Kit.eok(p.v, 1) : ''}`, grade(l.grade).color, { cls: 'g' + rank(l.grade), onClick: () => card(l) })); });
    kmap.relayout();
    if (ok.length > 1) KMap.fit(kmap, ok.map(l => l.pos)); else { kmap.setCenter(KMap.LL(ok[0].pos)); kmap.setLevel(5); }
    $('ldMap').dataset.zoom = kmap.getLevel() >= 10 ? 'far' : kmap.getLevel() >= 8 ? 'mid' : 'near';
    if (!$('ldCard').innerHTML) card(ok[0]);
  }

  async function init() {
    regions = await Data.regions();
    const sidos = [...new Set(regions.map(r => r[1]))], last = Store.get('apt.lastRegion', null);
    $('ldSido').innerHTML = sidos.map(s => `<option>${U.esc(s)}</option>`).join('');
    if (last && sidos.includes(last.sido)) $('ldSido').value = last.sido;
    $('ldGrade').innerHTML = CONFIG.GRADES.map(g => `<option value="${g.k}">${U.esc(g.name)}</option>`).join('');
    $('ldSido').onchange = () => fillSgg();
    $('ldSgg').onchange = () => fillApt(true);
    $('ldFind').oninput = () => fillApt(false);
    $('ldApt').onchange = fillArea;
    $('btnLdAdd').onclick = () => {
      const code = $('ldSgg').value, key = $('ldApt').value, g = +$('ldArea').value, reg = regions.find(r => r[0] === code);
      if (!key || !g) return U.toast('단지와 평형을 고르세요.');
      add({ id: `${code}|${key}#${g}`, sido: reg[1], sgg: reg[2], ...Data.parseKey(key) }, $('ldGrade').value);
    };
    $('btnLdAddTrack').onclick = () => { const it = Tracking.all().find(x => x.id === $('ldFromTrack').value); if (!it) return U.toast('시세트래킹에 담은 단지가 없습니다.'); add(it, $('ldGrade').value); };
    $('ldRegion').onchange = () => { $('ldCard').innerHTML = ''; draw(); };
    $('ldBase').onchange = $('ldVs').onchange = gap;
    $('btnLdExcel').onclick = excel;
    $('ldTable').onchange = (e) => { const id = e.target.closest('tr')?.dataset.id; if (id && e.target.dataset.grade != null) { map[id].grade = e.target.value; save(); render(); } };
    $('ldTable').onclick = (e) => {
      const id = e.target.closest('tr')?.dataset.id; if (!id) return;
      if (e.target.dataset.del != null) { if (!confirm(`${map[id].name} 을(를) 대장 목록에서 뺄까요?`)) return; delete map[id]; save(); $('ldCard').innerHTML = ''; render(); }
      if (e.target.dataset.track != null && !Tracking.has(id)) { const l = all().find(x => x.id === id), rl = Real.get(id); Tracking.add([{ ...l, buildYear: rl?.buildYear, st: { last: rl?.sale } }]); render(); }
    };
    $('ldCard').onclick = async (e) => {
      const id = e.target.dataset.open; if (!id) return;
      const l = Kit.parseId(id);
      App.showTab('search'); await Search.openRegion(l.code);
      U.toast('목록에서 단지명을 검색해 누르면 그래프가 열립니다.');
      const f = document.getElementById('listFilter'); if (f) { f.value = l.name; f.dispatchEvent(new Event('input')); }
    };
    fillSgg(last?.code);
    inited = true;
  }
  const open = () => { if (inited) render(); };
  const reload = () => { map = Store.get(KEY, {}); };
  return { init, open, all, leadOf, reload };
})();
