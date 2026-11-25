/* ─────────────────────────────────────────────────────────
   settings.js — [가이드·설정] 탭의 "탭 설정" 과 "업무지구 설정"
   · 탭을 위쪽 메뉴에 둘지 [더보기]에 넣을지 고르기, 순서 바꾸기 (▲▼ 버튼 — 태블릿에서도 실수가 적습니다). 순서는 전체에서 자유롭게 바뀝니다.
   · [더보기]에 넣은 탭도 누르면 열리고, Ctrl+K 검색으로도 찾습니다. 저장은 기기마다 따로(휴대폰·PC를 다르게 꾸밀 수 있게) 합니다.
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
  // 처음 상태에서 위쪽 메뉴에 보이는 탭 — 나머지는 [더보기] 안에 들어갑니다 (설정 탭은 항상 위쪽)
  const DEFAULT_TOP = ['start', 'yard', 'tracking', 'land', 'survey', 'guide'];
  const nameOf = (btn) => { const t = [...btn.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim(); return t || btn.dataset.tab; };
  const names = () => new Map(defaults.map(d => [d.id, d.name]));
  let moreEl = null, popEl = null, cur = '';
  const curTab = () => { const b = nav().querySelector('button.on'); return b ? b.dataset.tab : cur; };

  /* ── [더보기] 단추와 목록 ── */
  function closePop() { if (popEl) popEl.hidden = true; if (moreEl) moreEl.classList.remove('open'); }
  function fillPop() {
    const nm = names(), c = curTab();
    popEl.innerHTML = order.filter(id => hidden.has(id)).map(id => `<button data-go="${id}" class="${id === c ? 'on' : ''}">${U.esc(nm.get(id) || id)}</button>`).join('');
  }
  function togglePop() {
    if (!popEl.hidden) return closePop();
    fillPop(); popEl.hidden = false; moreEl.classList.add('open');
    const r = moreEl.getBoundingClientRect(), w = popEl.offsetWidth;
    popEl.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
    popEl.style.top = (r.bottom + 6) + 'px';
  }
  function ensureMore() {
    if (moreEl) { nav().appendChild(moreEl); return; }
    moreEl = document.createElement('a');                 // button 이 아닌 이유: 다른 코드가 '#tabs button' 을 탭 단추로만 세기 때문
    moreEl.id = 'tabMore'; moreEl.className = 'tabmore'; moreEl.setAttribute('role', 'button'); moreEl.tabIndex = 0;
    moreEl.onclick = (e) => { e.preventDefault(); togglePop(); };
    moreEl.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePop(); } };
    nav().appendChild(moreEl);
    popEl = document.createElement('div'); popEl.id = 'tabMorePop'; popEl.className = 'tabmorepop'; popEl.hidden = true;
    document.body.appendChild(popEl);
    popEl.onclick = (e) => { const b = e.target.closest('[data-go]'); if (!b) return; closePop(); App.showTab(b.dataset.go); };
    document.addEventListener('click', (e) => { if (!popEl.hidden && !popEl.contains(e.target) && !moreEl.contains(e.target)) closePop(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
    window.addEventListener('resize', closePop);
  }
  /** 지금 보는 탭이 [더보기] 안에 있으면 단추에 그 이름을 보여 주고 강조 */
  function sync(name) {
    if (name) cur = name;
    if (!moreEl) return;
    const n = order.filter(id => hidden.has(id)).length, inMore = hidden.has(cur);
    moreEl.hidden = !n;
    moreEl.classList.toggle('on', inMore);
    moreEl.innerHTML = `${inMore ? U.esc(names().get(cur) || cur) : '더보기'} <small>▾</small>`;
  }

  /* ── 탭 보이기·순서 ── */
  function load() {
    if (!defaults.length) defaults = [...nav().querySelectorAll('button[data-tab]')].map(b => ({ id: b.dataset.tab, name: nameOf(b) }));   // 처음 한 번만 (순서 되돌리기의 기준)
    const prefs = Store.get(TKEY, {});
    const key = (d, i) => (prefs[d.id] && prefs[d.id].o != null ? prefs[d.id].o : i);
    order = defaults.map((d, i) => ({ id: d.id, k: key(d, i), i })).sort((a, b) => a.k - b.k || a.i - b.i).map(x => x.id);
    // 저장한 값이 있으면 그대로, 없으면(처음·새 탭) 기본: DEFAULT_TOP 만 위쪽
    hidden = new Set(defaults.filter(d => d.id !== 'guide' && (prefs[d.id] ? !!prefs[d.id].h : !DEFAULT_TOP.includes(d.id))).map(d => d.id));
  }
  function save() {
    const prefs = {};
    order.forEach((id, i) => { prefs[id] = { o: i, h: hidden.has(id) }; });
    Store.set(TKEY, prefs);
  }
  function apply() {
    const n = nav(); n.querySelectorAll('.tabgrp').forEach(x => x.remove());
    const btns = new Map([...n.querySelectorAll('button[data-tab]')].map(b => [b.dataset.tab, b]));
    order.forEach(id => { const b = btns.get(id); if (b) { n.appendChild(b); b.hidden = false; b.toggleAttribute('data-more', hidden.has(id)); } });
    ensureMore(); sync(curTab());
  }
  function renderTabs() {
    const box = $('tabSettings'); if (!box) return;
    const nm = names(), top = order.filter(id => !hidden.has(id)), more = order.filter(id => hidden.has(id));
    const row = (id, list) => { const k = list.indexOf(id); return `<div class="tabrow" data-id="${id}">
      <label class="inline"><input type="checkbox" data-vis ${hidden.has(id) ? '' : 'checked'} ${id === 'guide' ? 'disabled title="설정 탭은 항상 위쪽 메뉴에 있습니다"' : ''}> ${U.esc(nm.get(id) || id)}</label>
      <span class="grow"></span>
      <button class="mini" data-up ${k === 0 ? 'disabled' : ''} title="위로">▲</button>
      <button class="mini" data-down ${k === list.length - 1 ? 'disabled' : ''} title="아래로">▼</button></div>`; };
    box.innerHTML = `<div class="tabgrph">위쪽 메뉴 (${top.length}개) — 체크 켜짐</div>${top.map(id => row(id, top)).join('')}` +
      `<div class="tabgrph">더보기 (${more.length}개) — 체크 꺼짐</div>${more.length ? more.map(id => row(id, more)).join('') : '<p class="hint" style="margin:4px">없음</p>'}`;
  }
  function initTabs() {
    load(); apply(); renderTabs();
    const box = $('tabSettings'); if (!box) return;
    box.onclick = (e) => {
      const row = e.target.closest('.tabrow'); if (!row) return;
      const id = row.dataset.id, up = e.target.matches('[data-up]');
      if (!up && !e.target.matches('[data-down]')) return;
      const sec = order.filter(x => hidden.has(x) === hidden.has(id)), nb = sec[sec.indexOf(id) + (up ? -1 : 1)];   // 같은 목록(위쪽 메뉴 / 더보기) 안의 바로 위·아래 탭과 자리 바꿈
      if (!nb) return;
      const a = order.indexOf(id), b = order.indexOf(nb); [order[a], order[b]] = [order[b], order[a]];
      save(); apply(); renderTabs();
    };
    box.onchange = (e) => {
      if (!e.target.matches('[data-vis]')) return;
      const id = e.target.closest('.tabrow').dataset.id;
      if (e.target.checked) hidden.delete(id); else hidden.add(id);
      order = order.filter(x => x !== id);                                      // 옮겨 간 목록의 맨 끝에 놓음
      const dest = order.filter(x => hidden.has(x) === hidden.has(id));
      order.splice(dest.length ? order.indexOf(dest[dest.length - 1]) + 1 : order.length, 0, id);
      save(); apply(); renderTabs();
    };
    $('btnTabsReset').onclick = () => { Store.set(TKEY, {}); load(); apply(); renderTabs(); U.toast('메뉴를 처음 상태로 되돌렸습니다.'); };
  }

  /* ── 역 관리 (직선거리 기준 역) — 실제 기능은 js/common.js 의 Stations. 단지 비교·비교 평가·입지 분석이 함께 씁니다 ── */
  const hubs = () => Stations.hubs();
  function initHubs() { const box = $('hubSettings'); if (box) Stations.mount(box); }

  function init() { initTabs(); initHubs(); }
  return { init, hubs, sync };
})();
