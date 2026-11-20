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
  // 탭 묶음 — 메뉴에서 이 순서로 묶어 보여 줍니다. 목록에 없는 새 탭은 '분석' 묶음에 들어갑니다.
  const GROUPS = [
    { k: 'map', name: '지도', tabs: ['start', 'cxmap', 'map', 'supplymap', 'v3d', 'sat'] },
    { k: 'survey', name: '조사', tabs: ['survey', 'count', 'yard', 'tracking', 'land', 'imjang'] },
    { k: 'ana', name: '분석', tabs: ['home', 'search', 'compare', 'eval', 'infra', 'grouping', 'trends', 'supply', 'migration', 'invest', 'market', 'my'] },
    { k: 'set', name: '설정', tabs: ['guide'] },
  ];
  const grpOf = (id) => { const i = GROUPS.findIndex(g => g.tabs.includes(id)); return i < 0 ? 2 : i; };
  /** 같은 묶음끼리 모으기 (묶음 안에서는 내가 정한 순서 그대로) */
  const byGroup = (ids) => ids.map((id, i) => ({ id, i })).sort((a, b) => grpOf(a.id) - grpOf(b.id) || a.i - b.i).map(x => x.id);
  /** 메뉴에 묶음 이름표 붙이기 */
  function groupLabels() {
    const n = nav(); if (!n) return;
    n.querySelectorAll('.tabgrp').forEach(x => x.remove());
    let last = -1;
    [...n.querySelectorAll('button[data-tab]')].forEach(b => {
      if (b.hidden) return;
      const g = grpOf(b.dataset.tab);
      if (g !== last) { const sp = document.createElement('span'); sp.className = 'tabgrp'; sp.textContent = GROUPS[g].name; n.insertBefore(sp, b); last = g; }
    });
  }
  const nameOf = (btn) => { const t = [...btn.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim(); return t || btn.dataset.tab; };

  /* ── 탭 보이기·순서 ── */
  function load() {
    defaults = [...nav().querySelectorAll('button')].map(b => ({ id: b.dataset.tab, name: nameOf(b) }));
    const prefs = Store.get(TKEY, {});
    const key = (d, i) => (prefs[d.id] && prefs[d.id].o != null ? prefs[d.id].o : i);
    order = byGroup(defaults.map((d, i) => ({ id: d.id, k: key(d, i), i })).sort((a, b) => a.k - b.k || a.i - b.i).map(x => x.id));
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
    groupLabels();
    const on = nav().querySelector('button.on');
    if (on && on.hidden) { const first = order.find(id => !hidden.has(id)); if (first) App.showTab(first); }
  }
  function renderTabs() {
    const box = $('tabSettings'); if (!box) return;
    const nm = new Map(defaults.map(d => [d.id, d.name]));
    const first = (i) => i === 0 || grpOf(order[i - 1]) !== grpOf(order[i]), lastIn = (i) => i === order.length - 1 || grpOf(order[i + 1]) !== grpOf(order[i]);
    box.innerHTML = order.map((id, i) => `${first(i) ? `<div class="tabgrph">${GROUPS[grpOf(id)].name}</div>` : ''}<div class="tabrow" data-id="${id}">
      <label class="inline"><input type="checkbox" data-vis ${hidden.has(id) ? '' : 'checked'} ${id === 'guide' ? 'disabled title="설정 탭은 항상 보입니다"' : ''}> ${U.esc(nm.get(id) || id)}</label>
      <span class="grow"></span>
      <button class="mini" data-up ${first(i) ? 'disabled' : ''} title="위(앞)로 — 같은 묶음 안에서">▲</button>
      <button class="mini" data-down ${lastIn(i) ? 'disabled' : ''} title="아래(뒤)로 — 같은 묶음 안에서">▼</button></div>`).join('');
  }
  function initTabs() {
    load(); apply(); renderTabs();
    const box = $('tabSettings'); if (!box) return;
    box.onclick = (e) => {
      const row = e.target.closest('.tabrow'); if (!row) return;
      const id = row.dataset.id, i = order.indexOf(id);
      const same = (j) => j >= 0 && j < order.length && grpOf(order[j]) === grpOf(id);   // 묶음을 넘어가지 않게
      if (e.target.matches('[data-up]') && same(i - 1)) [order[i - 1], order[i]] = [order[i], order[i - 1]];
      else if (e.target.matches('[data-down]') && same(i + 1)) [order[i + 1], order[i]] = [order[i], order[i + 1]];
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
