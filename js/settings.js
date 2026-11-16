/* ─────────────────────────────────────────────────────────
   settings.js — [가이드·설정] 탭의 "탭 설정" 과 "업무지구 설정"
   · 탭 보이기/숨기기, 탭 순서 바꾸기 (▲▼ 버튼 — 태블릿에서도 실수가 적습니다)
   · 업무지구(기준점) 이름과 검색어 바꾸기. 좌표는 저장하지 않고 열 때마다 카카오맵으로 다시 찾습니다.
   저장 위치: apt.tabs.v1, apt.hubs.v1  (백업 파일·코드에 함께 들어갑니다)
   ───────────────────────────────────────────────────────── */
const Settings = (() => {
  const $ = (id) => document.getElementById(id);
  const TKEY = 'apt.tabs.v1';
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

  /* ── 역 관리 (직선거리 기준 역) — 실제 기능은 js/common.js 의 Stations. 단지 비교·비교 평가·입지 분석이 함께 씁니다 ── */
  const hubs = () => Stations.hubs();
  function initHubs() { const box = $('hubSettings'); if (box) Stations.mount(box); }

  function init() { initTabs(); initHubs(); }
  return { init, hubs };
})();
