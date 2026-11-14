/* ─────────────────────────────────────────────────────────
   imjang.js — [임장] 탭
   시세트래킹에 담은 단지마다 체크리스트 점수(1~5점)와 메모, 방문일을 남깁니다.
   [임장 모드]를 켜면 휴대폰에서 한 단지씩 크게 보며 적을 수 있습니다.
   체크 항목은 js/config.js 의 IMJANG 에서 바꿉니다.
   ───────────────────────────────────────────────────────── */
const Imjang = (() => {
  const $ = (id) => document.getElementById(id);
  const KEY = 'apt.imjang.v1';
  let notes = Store.get(KEY, {});      // { 단지번호: { sc: {항목: 점수}, memo, date } }
  let list = [], cur = null, inited = false;
  const save = () => Store.set(KEY, notes);
  const note = (id, create) => { if (!notes[id] && create) notes[id] = { sc: {}, memo: '', date: '' }; return notes[id] || { sc: {}, memo: '', date: '' }; };
  /** 총점(100점 만점): 점수를 매긴 항목만 평균 */
  function total(n) {
    const v = CONFIG.IMJANG.map(c => n.sc?.[c.k]).filter(x => x);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 20) : null;
  }
  const thisMonth = () => { const t = new Date(); return t.getFullYear() * 100 + t.getMonth() + 1; };
  const today = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

  function fill() {
    const folders = Tracking.exportAll().folders || [], f = $('imFolder').value;
    $('imFolder').innerHTML = '<option value="">전체</option>' + folders.map(x => `<option>${U.esc(x)}</option>`).join('');
    if (folders.includes(f)) $('imFolder').value = f;
    list = Tracking.all().filter(it => !$('imFolder').value || it.folders.includes($('imFolder').value)).sort((a, b) => `${a.sgg}${a.dong}${a.name}`.localeCompare(`${b.sgg}${b.dong}${b.name}`, 'ko') || a.g - b.g);
    $('imApt').innerHTML = list.map(it => `<option value="${U.esc(it.id)}">${total(note(it.id)) != null ? '✔ ' : ''}${U.esc(it.dong)} ${U.esc(it.name)} ${it.g}㎡</option>`).join('');
    if (cur && list.some(it => it.id === cur.id)) $('imApt').value = cur.id;
    cur = list.find(it => it.id === $('imApt').value) || list[0] || null;
    const has = list.length > 0;
    $('imEmpty').hidden = has; $('imForm').hidden = !has; $('imListPanel').hidden = !has;
  }

  function show() {
    if (!cur) return;
    const n = note(cur.id), q = cur.quotes?.[thisMonth()] || {};
    $('imApt').value = cur.id;
    $('imTitle').textContent = `${cur.name} · ${cur.g}㎡ (${Tracking.pyeong(cur)})`;
    const i = list.indexOf(cur);
    $('imSub').textContent = `${cur.sgg} ${cur.dong} · ${cur.buildYear ? cur.buildYear + '년식 · ' : ''}${cur.households ? cur.households + '세대 · ' : ''}${i + 1} / ${list.length}`;
    $('imMap').href = `https://map.kakao.com/?q=${encodeURIComponent(`${cur.sgg} ${cur.dong} ${cur.name}`)}`;
    $('imLand').href = cur.link || U.landLink(cur.sgg, cur.dong, cur.name);
    $('imDate').value = n.date || '';
    $('imStatus').value = cur.status || '';
    $('imSale').value = q.s != null ? +(q.s / 10000).toFixed(4) : '';
    $('imRent').value = q.r != null ? +(q.r / 10000).toFixed(4) : '';
    $('imMemo').value = n.memo || '';
    $('imChecks').innerHTML = CONFIG.IMJANG.map(c => `<div class="imrow" data-k="${c.k}"><div class="imname"><b>${U.esc(c.name)}</b><small>${U.esc(c.tip || '')}</small></div>` +
      `<div class="imbtns">${[1, 2, 3, 4, 5].map(v => `<button data-v="${v}" class="${n.sc?.[c.k] === v ? 'on' : ''}">${v}</button>`).join('')}</div></div>`).join('');
    score();
  }
  function score() {
    const t = total(note(cur.id));
    $('imTotal').innerHTML = t == null ? '<small>점수를 눌러 매겨 보세요 (1 나쁨 ~ 5 좋음)</small>' : `총점 <b>${t}</b><small> / 100</small>`;
  }
  function move(step) { const i = list.indexOf(cur); cur = list[(i + step + list.length) % list.length]; show(); window.scrollTo({ top: 0 }); }

  function table() {
    const rows = list.map(it => ({ it, n: note(it.id), t: total(note(it.id)) })).filter(x => x.t != null || x.n.memo || x.n.date).sort((a, b) => (b.t ?? -1) - (a.t ?? -1));
    $('imTable').innerHTML = '<thead><tr><th class="l">단지</th><th>평형</th><th class="c">방문일</th><th>총점</th>' + CONFIG.IMJANG.map(c => `<th>${U.esc(c.name)}</th>`).join('') + '<th>상태</th><th class="l">메모</th></tr></thead><tbody>' +
      (rows.length ? rows.map(({ it, n, t }) => `<tr data-id="${U.esc(it.id)}"><td class="l">${U.esc(it.dong)} <b>${U.esc(it.name)}</b></td><td>${it.g}㎡</td><td class="c">${U.esc(n.date || '-')}</td><td><b>${t ?? '-'}</b></td>` +
        CONFIG.IMJANG.map(c => `<td>${n.sc?.[c.k] || '·'}</td>`).join('') + `<td>${U.esc(it.status || '-')}</td><td class="l">${U.esc((n.memo || '').slice(0, 60))}${(n.memo || '').length > 60 ? '…' : ''}</td></tr>`).join('')
        : `<tr><td colspan="${CONFIG.IMJANG.length + 6}" style="color:var(--sub);padding:20px">아직 남긴 임장 기록이 없습니다.</td></tr>`) + '</tbody>';
  }
  function excel() {
    const rows = Tracking.all().map(it => ({ it, n: note(it.id) })).filter(x => total(x.n) != null || x.n.memo || x.n.date);
    if (!rows.length) return U.toast('내려받을 임장 기록이 없습니다.');
    U.download(`임장기록_${U.stamp()}`, [{ name: '임장 기록', rows: [['시도', '시군구', '동', '단지', '전용㎡', '방문일', '총점', ...CONFIG.IMJANG.map(c => c.name), '상태', '메모'],
      ...rows.map(({ it, n }) => [it.sido, it.sgg, it.dong, it.name, it.g, n.date || '', total(n) ?? '', ...CONFIG.IMJANG.map(c => n.sc?.[c.k] || ''), it.status || '', n.memo || ''])] }]);
  }
  function setMode(on) {
    document.body.classList.toggle('imjang-mode', on);
    $('btnImExit').hidden = !on;
    if (on) window.scrollTo({ top: 0 });
  }

  function init() {
    $('imStatus').innerHTML = Tracking.STATUSES.map(s => `<option value="${s}">${s || '(상태 없음)'}</option>`).join('');
    $('imFolder').onchange = () => { cur = null; fill(); show(); table(); };
    $('imApt').onchange = () => { cur = list.find(it => it.id === $('imApt').value); show(); };
    $('btnImPrev').onclick = () => move(-1);
    $('btnImNext').onclick = () => move(1);
    $('btnImMode').onclick = () => setMode(true);
    $('btnImExit').onclick = () => { setMode(false); table(); };
    $('btnImExcel').onclick = excel;
    $('imChecks').onclick = (e) => {
      const v = +e.target.dataset.v, row = e.target.closest('.imrow');
      if (!v || !row || !cur || Vault.isLocked()) return;
      const n = note(cur.id, true);
      if (n.sc[row.dataset.k] === v) delete n.sc[row.dataset.k]; else n.sc[row.dataset.k] = v;       // 같은 점수를 다시 누르면 지움
      if (!n.date) { n.date = today(); $('imDate').value = n.date; }
      save(); row.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.v === n.sc[row.dataset.k])); score(); table();
    };
    $('imMemo').onchange = () => { if (!cur) return; note(cur.id, true).memo = $('imMemo').value.trim(); save(); table(); };
    $('imDate').onchange = () => { if (!cur) return; note(cur.id, true).date = $('imDate').value; save(); table(); };
    $('imStatus').onchange = () => { if (!cur) return; cur.status = $('imStatus').value; Tracking.save(); table(); };
    const quote = (el, f) => () => {
      if (!cur) return;
      const ym = thisMonth(), v = parseFloat(el.value);
      Tracking.addMonth(ym);
      const q = cur.quotes[ym] = cur.quotes[ym] || {};
      if (isNaN(v)) delete q[f]; else { q[f] = Math.round(v * 10000); (cur.qt = cur.qt || {})[ym] = today(); }
      if (!Object.keys(q).length) delete cur.quotes[ym];
      Tracking.save();
    };
    $('imSale').onchange = quote($('imSale'), 's');
    $('imRent').onchange = quote($('imRent'), 'r');
    $('imTable').onclick = (e) => { const id = e.target.closest('tr')?.dataset.id; if (!id) return; cur = list.find(it => it.id === id) || cur; show(); $('imForm').scrollIntoView({ behavior: 'smooth' }); };
    inited = true;
  }
  function open() { if (!inited) return; fill(); show(); table(); }
  const reload = () => { notes = Store.get(KEY, {}); };
  const all = () => Tracking.all().map(it => ({ it, n: note(it.id), t: total(note(it.id)) })).filter(x => x.t != null || x.n.memo || x.n.date);
  return { init, open, reload, all };
})();
