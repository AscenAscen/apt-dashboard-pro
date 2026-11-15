/* ─────────────────────────────────────────────────────────
   settings.js — [가이드·설정] 탭의 "탭 설정" 과 "업무지구 설정"
   · 탭 보이기/숨기기, 탭 순서 바꾸기 (▲▼ 버튼 — 태블릿에서도 실수가 적습니다)
   · 업무지구(기준점) 이름과 검색어 바꾸기. 좌표는 저장하지 않고 열 때마다 카카오맵으로 다시 찾습니다.
   저장 위치: apt.tabs.v1, apt.hubs.v1  (백업 파일·코드에 함께 들어갑니다)
   ───────────────────────────────────────────────────────── */
const Settings = (() => {
  const $ = (id) => document.getElementById(id);
  const TKEY = 'apt.tabs.v1', HKEY = 'apt.hubs.v1';
  const HUB_COLORS = ['#ff3b30', '#34c759', '#ffcc00', '#5ac8fa', '#af52de', '#ff9500'];
  let defaults = [];            // [{ id, name }] 화면이 처음 만들어진 순서
  let order = [];               // 지금 순서 [id, …]
  let hidden = new Set();

  const nav = () => $('tabs');
  const nameOf = (btn) => { const t = [...btn.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim(); return t || btn.dataset.tab; };

  /* ── 탭 보이기·순서 ── */
  function load() {
    defaults = [...nav().querySelectorAll('button')].map(b => ({ id: b.dataset.tab, name: nameOf(b) }));
    const prefs = Store.get(TKEY, {});
    const key = (d, i) => (prefs[d.id] && prefs[d.id].o != null ? prefs[d.id].o : i);
    order = defaults.map((d, i) => ({ id: d.id, k: key(d, i), i })).sort((a, b) => a.k - b.k || a.i - b.i).map(x => x.id);
    hidden = new Set(defaults.filter(d => prefs[d.id]?.h && d.id !== 'guide').map(d => d.id));     // 설정 탭은 숨길 수 없음
  }
  function save() {
    const prefs = {};
    order.forEach((id, i) => { prefs[id] = { o: i, h: hidden.has(id) }; });
    Store.set(TKEY, prefs);
  }
  function apply() {
    const btns = new Map([...nav().querySelectorAll('button')].map(b => [b.dataset.tab, b]));
    order.forEach(id => { const b = btns.get(id); if (b) { nav().appendChild(b); b.hidden = hidden.has(id); } });
    const on = nav().querySelector('button.on');
    if (on && on.hidden) { const first = order.find(id => !hidden.has(id)); if (first) App.showTab(first); }
  }
  function renderTabs() {
    const box = $('tabSettings'); if (!box) return;
    const nm = new Map(defaults.map(d => [d.id, d.name]));
    box.innerHTML = order.map((id, i) => `<div class="tabrow" data-id="${id}">
      <label class="inline"><input type="checkbox" data-vis ${hidden.has(id) ? '' : 'checked'} ${id === 'guide' ? 'disabled title="설정 탭은 항상 보입니다"' : ''}> ${U.esc(nm.get(id) || id)}</label>
      <span class="grow"></span>
      <button class="mini" data-up ${i === 0 ? 'disabled' : ''} title="위(앞)로">▲</button>
      <button class="mini" data-down ${i === order.length - 1 ? 'disabled' : ''} title="아래(뒤)로">▼</button></div>`).join('');
  }
  function initTabs() {
    load(); apply(); renderTabs();
    const box = $('tabSettings'); if (!box) return;
    box.onclick = (e) => {
      const row = e.target.closest('.tabrow'); if (!row) return;
      const id = row.dataset.id, i = order.indexOf(id);
      if (e.target.matches('[data-up]') && i > 0) [order[i - 1], order[i]] = [order[i], order[i - 1]];
      else if (e.target.matches('[data-down]') && i < order.length - 1) [order[i + 1], order[i]] = [order[i], order[i + 1]];
      else return;
      save(); apply(); renderTabs();
    };
    box.onchange = (e) => {
      if (!e.target.matches('[data-vis]')) return;
      const id = e.target.closest('.tabrow').dataset.id;
      if (e.target.checked) hidden.delete(id); else hidden.add(id);
      save(); apply(); renderTabs();
    };
    $('btnTabsReset').onclick = () => { Store.set(TKEY, {}); load(); apply(); renderTabs(); U.toast('탭 순서와 보이기를 처음 상태로 되돌렸습니다.'); };
  }

  /* ── 업무지구(기준점) ── */
  const custom = () => { const o = Store.get(HKEY, {}); return Object.keys(o).sort((a, b) => +a.slice(1) - +b.slice(1)).map(k => o[k]).filter(x => x && x.name && x.q); };
  let hubMemo = null;
  /** 업무지구 목록 [{ name, lat, lng, color }]. 직접 정한 게 없으면 config.js 의 HUBS. 좌표는 이번 접속 동안만 기억 */
  async function hubs() {
    const list = custom();
    if (!list.length || !KMap.ready()) return CONFIG.HUBS;
    if (hubMemo) return hubMemo;
    try {
      await KMap.load();
      const S = kakao.maps.services;
      const out = [];
      for (let i = 0; i < list.length; i++) {
        const p = await new Promise(res => new S.Places().keywordSearch(list[i].q, (r, st) => res(st === S.Status.OK && r.length ? { lat: +r[0].y, lng: +r[0].x } : null)));
        if (p) out.push({ name: list[i].name, ...p, color: HUB_COLORS[i % HUB_COLORS.length] });
      }
      hubMemo = out.length ? out : CONFIG.HUBS;
    } catch (e) { console.error(e); hubMemo = CONFIG.HUBS; }
    return hubMemo;
  }

  let hubDraft = [];
  function renderHubs() {
    const box = $('hubSettings'); if (!box) return;
    box.innerHTML = hubDraft.map((h, i) => `<div class="hubrow" data-i="${i}">
      <label>이름 <input data-f="name" value="${U.esc(h.name)}" placeholder="예: 서면 (부산 도심)"></label>
      <label>지도 검색어 <input data-f="q" value="${U.esc(h.q)}" placeholder="예: 부산 서면역"></label>
      <button class="mini danger" data-del>빼기</button></div>`).join('') || '<p class="hint">직접 정한 업무지구가 없습니다. 지금은 config.js 의 기본값(강남역·여의도역·광화문역)을 씁니다.</p>';
  }
  function initHubs() {
    const box = $('hubSettings'); if (!box) return;
    hubDraft = custom().map(x => ({ ...x }));
    renderHubs();
    box.oninput = (e) => { const row = e.target.closest('.hubrow'); if (row && e.target.dataset.f) hubDraft[+row.dataset.i][e.target.dataset.f] = e.target.value; };
    box.onclick = (e) => { const row = e.target.closest('.hubrow'); if (row && e.target.matches('[data-del]')) { hubDraft.splice(+row.dataset.i, 1); renderHubs(); } };
    $('btnHubAdd').onclick = () => { if (hubDraft.length >= 6) return U.toast('업무지구는 6개까지 둘 수 있습니다.'); hubDraft.push({ name: '', q: '' }); renderHubs(); };
    $('btnHubSave').onclick = () => {
      const list = hubDraft.map(h => ({ name: h.name.trim(), q: h.q.trim() })).filter(h => h.q);
      list.forEach(h => { if (!h.name) h.name = h.q; });
      const o = {}; list.forEach((h, i) => { o['h' + i] = h; });
      Store.set(HKEY, o);
      U.toast('저장했습니다. 화면을 다시 불러옵니다.'); setTimeout(() => location.reload(), 700);
    };
    $('btnHubReset').onclick = () => { Store.set(HKEY, {}); U.toast('기본 업무지구로 되돌립니다. 화면을 다시 불러옵니다.'); setTimeout(() => location.reload(), 700); };
  }

  function init() { initTabs(); initHubs(); }
  return { init, hubs };
})();
