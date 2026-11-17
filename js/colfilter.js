/* 엑셀식 열 필터 (전수조사·시세트래킹·시세지도 표 공통)
 *  - 머리글 ▾ : 낮은 순/높은 순 정렬, 값 검색, (모두 선택)·값 목록(개수)·(빈칸), 확인/취소
 *  - 표가 '자료' 기준으로 거르므로, 화면에 다 그리지 않는 표(더 보기)에서도 정확함
 *  - 표마다 따로 기억 (apt.colf.v1)
 *
 *  const F = ColFilter.create({ key, label, cols: () => ({ 열키: { label, get(row) -> 글자, num?(row) -> 숫자 } }),
 *                               onChange, bar: 'elementId', sortSel: 'selectId' })
 *  F.btn('열키')         → 머리글에 넣을 ▾ 버튼 HTML
 *  F.apply(rows, sortFn) → 걸러지고 정렬된 새 배열 (머리글 정렬이 없으면 sortFn 으로 정렬)
 */
const ColFilter = (() => {
  const SKEY = 'apt.colf.v1', BLANK = '(빈칸)';
  const all = {};
  let pop = null, cur = null;
  const store = () => Store.get(SKEY, {}) || {};
  const esc = (s) => U.esc(String(s));

  function popEl() {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.className = 'colpop cfx'; pop.hidden = true; pop.id = 'cfPop';
    document.body.appendChild(pop);
    document.addEventListener('mousedown', (e) => {
      if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('button.colf, button.cfmenu')) pop.hidden = true;
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) pop.hidden = true; });
    document.addEventListener('click', (e) => {                       // 머리글 ▾ 버튼 (어느 표든)
      const b = e.target.closest('button.colf[data-cfk]');
      if (b && all[b.dataset.cfk]) { e.preventDefault(); e.stopPropagation(); all[b.dataset.cfk].open(b.dataset.cf, b); }
      const m = e.target.closest('button.cfmenu[data-cfk]');
      if (m && all[m.dataset.cfk]) { e.preventDefault(); all[m.dataset.cfk].menu(m); }
      const c = e.target.closest('[data-cfclear]');
      if (c && all[c.dataset.cfclear]) { e.preventDefault(); all[c.dataset.cfclear].clear(); }
    }, true);
    return pop;
  }

  function place(anchor) {
    const rc = anchor.getBoundingClientRect();
    pop.hidden = false;
    const h = pop.offsetHeight, w = pop.offsetWidth;
    pop.style.left = Math.max(8, Math.min(rc.left, window.innerWidth - w - 8)) + 'px';
    pop.style.top = Math.max(8, Math.min(rc.bottom + 4, window.innerHeight - h - 8)) + 'px';
  }

  function create(o) {
    const saved = store()[o.key] || {};
    const st = { f: {}, s: saved.s || null };                         // f: 열키 → Set(보일 값),  s: {c: 열키, d: 1 | -1}
    for (const k in saved.f || {}) st.f[k] = new Set(saved.f[k]);
    let pre = [], colsNow = {}, prevSort = null;

    const save = () => {
      const all2 = store(), f = {};
      for (const k in st.f) f[k] = [...st.f[k]];
      all2[o.key] = { f, s: st.s };
      Store.set(SKEY, all2);
    };
    const cols = () => (colsNow = o.cols());
    const val = (col, r) => { const v = col.get(r); return v == null || String(v).trim() === '' || v === '-' ? BLANK : String(v); };
    const test = (r, skip) => {
      for (const k in st.f) {
        if (k === skip) continue;
        const col = colsNow[k];
        if (col && !st.f[k].has(val(col, r))) return false;
      }
      return true;
    };
    const cmpNum = (col, d) => (a, b) => {
      const x = col.num(a), y = col.num(b), nx = x == null || isNaN(x), ny = y == null || isNaN(y);
      if (nx || ny) return nx === ny ? 0 : nx ? 1 : -1;                // 빈칸은 늘 맨 아래
      return (x - y) * d;
    };
    const cmpTxt = (col, d) => (a, b) => {
      const x = val(col, a), y = val(col, b);
      if (x === BLANK || y === BLANK) return x === y ? 0 : x === BLANK ? 1 : -1;
      return x.localeCompare(y, 'ko', { numeric: true }) * d;
    };

    function syncSel() {
      const sel = o.sortSel && document.getElementById(o.sortSel);
      if (!sel) return;
      let opt = sel.querySelector('option[value="__hdr"]');
      if (st.s && colsNow[st.s.c]) {
        if (!opt) { opt = document.createElement('option'); opt.value = '__hdr'; sel.appendChild(opt); }
        opt.textContent = `머리글 정렬 (${colsNow[st.s.c].label} ${st.s.d > 0 ? '낮은 순' : '높은 순'})`;
        if (sel.value !== '__hdr') { prevSort = sel.value; sel.value = '__hdr'; }
      } else if (opt) {
        if (sel.value === '__hdr') sel.value = prevSort || sel.options[0].value;
        opt.remove();
      }
      if (!sel.dataset.cfBound) {                                     // 정렬 목록에서 다른 걸 고르면 머리글 정렬은 해제
        sel.dataset.cfBound = '1';
        sel.addEventListener('change', () => { if (sel.value !== '__hdr' && st.s) { st.s = null; save(); syncSel(); } }, true);
      }
    }

    function bar() {
      const el = o.bar && document.getElementById(o.bar);
      if (!el) return;
      const n = Object.keys(st.f).filter(k => colsNow[k]).length, s = st.s && colsNow[st.s.c];
      const parts = [];
      if (n) parts.push(`필터 <b>${n}개</b> 적용 중 (${Object.keys(st.f).filter(k => colsNow[k]).map(k => esc(colsNow[k].label)).join(', ')})`);
      if (s) parts.push(`머리글 정렬: ${esc(s.label)} ${st.s.d > 0 ? '낮은 순' : '높은 순'}`);
      el.innerHTML = `<button type="button" class="mini cfmenu" data-cfk="${o.key}" title="열을 골라 거르기·정렬">필터 ▾</button>` +
        (parts.length ? `<span class="cfstat">${parts.join(' · ')}</span> <a href="#" data-cfclear="${o.key}">모두 풀기</a>` : '<span class="cfstat hint">머리글의 ▾ 를 누르면 엑셀처럼 거르거나 정렬할 수 있습니다</span>');
      el.classList.toggle('on', parts.length > 0);
    }

    const api = {
      key: o.key,
      btn(k) {
        const on = !!st.f[k], so = st.s && st.s.c === k;
        return `<button type="button" class="colf${on ? ' on' : ''}${so ? ' so' : ''}" data-cfk="${o.key}" data-cf="${k}" title="거르기·정렬">${so ? (st.s.d > 0 ? '▲' : '▼') : '▾'}</button>`;
      },
      active: () => Object.keys(st.f).length > 0 || !!st.s,
      sorting: () => !!st.s,
      apply(rows, sortFn) {
        cols();
        pre = rows;
        let out = rows.filter(r => test(r));
        const s = st.s && colsNow[st.s.c];
        if (s) out = [...out].sort(s.num ? cmpNum(s, st.s.d) : cmpTxt(s, st.s.d));
        else if (sortFn) out = sortFn(out);
        syncSel(); bar();
        return out;
      },
      clear() { st.f = {}; st.s = null; save(); if (pop) pop.hidden = true; o.onChange && o.onChange(); },
      reset() { st.f = {}; save(); },                                   // 지역이 바뀔 때 등 (정렬은 유지)
      menu(anchor) {
        popEl(); cols();
        if (!pop.hidden && cur === 'menu:' + o.key) { pop.hidden = true; return; }
        cur = 'menu:' + o.key;
        pop.innerHTML = `<div class="cfh">거를 열 고르기</div><div class="cflist cfcols">${Object.keys(colsNow).map(k => `<button type="button" class="cfcol${st.f[k] ? ' on' : ''}" data-col="${k}">${esc(colsNow[k].label)}${st.f[k] ? ' ●' : ''}${st.s && st.s.c === k ? (st.s.d > 0 ? ' ▲' : ' ▼') : ''}</button>`).join('')}</div>` +
          `<div class="cfend"><button type="button" data-x="close">닫기</button></div>`;
        pop.onclick = (e) => {
          const b = e.target.closest('[data-col]');
          if (b) return api.open(b.dataset.col, anchor, true);
          if (e.target.dataset.x === 'close') pop.hidden = true;
        };
        pop.oninput = null;
        place(anchor);
      },
      open(k, anchor, force) {
        popEl(); cols();
        const col = colsNow[k];
        if (!col) return;
        if (!force && !pop.hidden && cur === o.key + ':' + k) { pop.hidden = true; return; }
        cur = o.key + ':' + k;
        // 값 목록: 다른 열 필터를 통과한 줄에서 셈 (엑셀과 같음)
        const cnt = new Map(), nums = new Map();
        pre.forEach(r => { if (!test(r, k)) return; const v = val(col, r); cnt.set(v, (cnt.get(v) || 0) + 1); if (col.num && !nums.has(v)) nums.set(v, col.num(r)); });
        if (st.f[k]) st.f[k].forEach(v => { if (!cnt.has(v)) cnt.set(v, 0); });
        let vals = [...cnt.keys()].filter(v => v !== BLANK);
        vals.sort(col.num ? (a, b) => { const x = nums.get(a), y = nums.get(b); return (x == null || isNaN(x) ? 1e15 : x) - (y == null || isNaN(y) ? 1e15 : y) || a.localeCompare(b, 'ko'); }
          : (a, b) => a.localeCompare(b, 'ko', { numeric: true }));
        if (cnt.has(BLANK)) vals.push(BLANK);
        const on = (v) => !st.f[k] || st.f[k].has(v);
        const lo = col.num ? '낮은 순' : '가나다순', hi = col.num ? '높은 순' : '역순';
        const so = st.s && st.s.c === k ? st.s.d : 0;
        const LIM = 1500;
        pop.innerHTML = `<div class="cfh">${esc(col.label)}</div>
          <div class="cfsort"><button type="button" data-sort="1" class="${so > 0 ? 'on' : ''}">↑ ${lo}</button><button type="button" data-sort="-1" class="${so < 0 ? 'on' : ''}">↓ ${hi}</button>${so ? '<button type="button" data-sort="0">정렬 해제</button>' : ''}</div>
          <input type="search" class="cfq" placeholder="값 검색">
          <div class="cflist"><label class="cfall"><input type="checkbox" data-all> (모두 선택)</label>${vals.slice(0, LIM).map(v => `<label${v === BLANK ? ' class="cfblank"' : ''}><input type="checkbox" value="${esc(v)}" ${on(v) ? 'checked' : ''}> <span>${esc(v)}</span> <small>${cnt.get(v)}</small></label>`).join('')}${vals.length > LIM ? `<div class="hint">값이 많아 ${LIM}개까지만 보입니다. 검색으로 좁혀 주세요.</div>` : ''}</div>
          <div class="cfend">${st.f[k] ? '<button type="button" data-x="clear">이 열 필터 지우기</button>' : ''}<button type="button" data-x="cancel">취소</button><button type="button" class="primary" data-x="ok">확인</button></div>`;
        const boxes = () => [...pop.querySelectorAll('.cflist label:not(.cfall) input')];
        const shown = () => boxes().filter(b => b.closest('label').style.display !== 'none');
        const syncAll = () => { const s = shown(), a = pop.querySelector('[data-all]'); a.checked = s.length > 0 && s.every(b => b.checked); a.indeterminate = !a.checked && s.some(b => b.checked); };
        syncAll();
        pop.oninput = (e) => {
          if (!e.target.classList.contains('cfq')) return;
          const q = e.target.value.trim().toLowerCase();
          boxes().forEach(b => { const l = b.closest('label'); l.style.display = !q || l.querySelector('span').textContent.toLowerCase().includes(q) ? '' : 'none'; });
          if (q) shown().forEach(b => { b.checked = true; });               // 엑셀처럼: 검색하면 찾은 값만 체크된 상태
          syncAll();
        };
        pop.onchange = (e) => {
          if (e.target.dataset.all != null) { shown().forEach(b => { b.checked = e.target.checked; }); }
          syncAll();
        };
        pop.onclick = (e) => {
          const t = e.target.closest('button'); if (!t) return;
          if (t.dataset.sort != null) {
            const d = +t.dataset.sort;
            st.s = d ? { c: k, d } : null;
            save(); pop.hidden = true; o.onChange && o.onChange(); return;
          }
          const x = t.dataset.x;
          if (x === 'cancel') { pop.hidden = true; return; }
          if (x === 'clear') { delete st.f[k]; save(); pop.hidden = true; o.onChange && o.onChange(); return; }
          if (x === 'ok') {
            const q = pop.querySelector('.cfq').value.trim();
            const bs = q ? shown() : boxes(), picked = bs.filter(b => b.checked).map(b => b.value);
            if (!q && picked.length === boxes().length && vals.length <= LIM) delete st.f[k];
            else st.f[k] = new Set(picked);
            save(); pop.hidden = true; o.onChange && o.onChange();
          }
        };
        place(anchor);
        const qi = pop.querySelector('.cfq'); if (window.innerWidth > 760) qi.focus();
      },
    };
    all[o.key] = api;
    popEl();
    return api;
  }

  /* 자주 쓰는 값 → 글자 바꾸기 */
  const fmt = {
    eok: (v) => (v == null || isNaN(v) ? '' : +(v / 10000).toFixed(2) + '억'),
    pct: (v) => (v == null || isNaN(v) ? '' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'),
    pctp: (v) => (v == null || isNaN(v) ? '' : (v > 0 ? '+' : '') + v.toFixed(1) + '%p'),
    rat: (v) => (v == null || isNaN(v) ? '' : v.toFixed(1) + '%'),
    diff: (v) => (v == null || isNaN(v) ? '' : (v > 0 ? '+' : '') + (+(v / 10000).toFixed(2)) + '억'),
    n: (v) => (v == null || v === '' || isNaN(+v) ? '' : String(+v)),
  };
  /** 숫자 열 하나 만들기 */
  const numCol = (label, f, kind = 'eok') => ({ label, get: (r) => fmt[kind](f(r)), num: (r) => { const v = f(r); return v == null || v === '' ? null : +v; } });
  const txtCol = (label, f) => ({ label, get: (r) => { const v = f(r); return v == null ? '' : String(v).trim(); } });

  return { create, fmt, numCol, txtCol, BLANK };
})();
