/* ───────────── 시세트래킹 도구 모음 ─────────────
   상태 흐름 · 일괄 편집 · 전수조사 점검(중복·누락) · 호가 변동 이력 · 호가-실거래 괴리 */
const TrkPlus = (() => {
  const $ = (id) => document.getElementById(id);
  const FLOW = ['', '관심', '임장 예정', '임장 완료', '매수 후보', '제외'];
  let T = null;

  // 화면 배치는 index.html 에 있음: 상태 칩(#tpFlow) · 선택 막대(#trkSelBar) · 오른쪽 도구 서랍(#trkDrawer)

  const modal = () => {
    let m = $('tpModal');
    if (!m) {
      m = document.createElement('div'); m.className = 'modal'; m.id = 'tpModal'; m.hidden = true;
      m.innerHTML = '<div class="modalbox" style="max-height:88vh;overflow:auto"><div class="bar"><strong id="tpTitle"></strong><span class="grow"></span><button id="tpClose">닫기</button></div><div id="tpBody"></div></div>';
      document.body.appendChild(m);
      $('tpClose').onclick = () => { m.hidden = true; };
    }
    return m;
  };
  const show = (title, body) => { const m = modal(); $('tpTitle').textContent = title; $('tpBody').innerHTML = body; m.hidden = false; };

  const flow = () => {};   // 상태 기능은 화면에서 뺐습니다 (값은 그대로 보관)
  function selbar() {
    const n = T.items.filter(it => T.checked.has(it.id)).length;
    $('trkSelBar').hidden = !n;
    if (!n) $('tpBulk').hidden = true;
  }
  function drawer(open) {
    const d = $('trkDrawer'); d.hidden = open == null ? !d.hidden : !open;
    $('btnTrkDrawer').classList.toggle('on', !d.hidden);
  }
  function apply() {
    const picked = T.items.filter(it => T.checked.has(it.id));
    if (!picked.length) return U.toast('먼저 표에서 단지를 체크하세요.');
    const st = '*', zone = $('tpZone').value.trim(), memo = $('tpMemo').value.trim();
    if (!zone && !memo) return U.toast('생활권이나 메모를 적어 주세요.');
    for (const it of picked) {
      if (st !== '*') it.status = st;
      if (zone) it.zone = zone;
      if (memo) it.memo = it.memo ? `${it.memo} / ${memo}` : memo;
    }
    T.save(); T.render(); flow();
    $('tpApplyInfo').textContent = `${picked.length}개 단지에 적용했습니다.`;
    U.toast(`${picked.length}개 단지를 한꺼번에 고쳤습니다.`);
  }

  async function check() {
    const out = [], key = (it) => `${it.code}|${it.key}#${it.g}`;
    const seen = new Map();
    for (const it of T.items) { const k = key(it); (seen.get(k) || seen.set(k, []).get(k)).push(it); }
    const dup = [...seen.values()].filter(a => a.length > 1);
    const nm = new Map();
    for (const it of T.items) { const k = `${it.sgg}|${it.dong}|${it.name}|${it.g}`; (nm.get(k) || nm.set(k, []).get(k)).push(it); }
    const dup2 = [...nm.values()].filter(a => new Set(a.map(x => x.key)).size > 1);
    const m0 = T.months[0];
    const noQuote = m0 ? T.items.filter(it => it.quotes[m0]?.s == null) : [];
    const noPrice = T.items.filter(it => !Object.values(it.quotes).some(q => q && (q.s != null || q.r != null)));
    const li = (a) => a.map(it => `<li>${U.esc(it.sgg)} ${U.esc(it.dong)} ${U.esc(it.name)} ${it.g}㎡ <small>(${U.esc(it.folders.join(', '))})</small></li>`).join('');
    let h = `<p class="hint">담은 단지 ${T.items.length}개 점검 결과</p>`;
    h += `<h4>같은 단지·평형이 중복 (${dup.length})</h4>` + (dup.length ? `<ul>${dup.map(a => li([a[0]]) ).join('')}</ul>` : '<p class="hint">없음</p>');
    h += `<h4>이름은 같은데 단지 코드가 다른 경우 (${dup2.length})</h4>` + (dup2.length ? `<ul>${dup2.map(a => li([a[0]])).join('')}</ul>` : '<p class="hint">없음</p>');
    h += `<h4>${m0 ? T.ymLabel(m0) : '최신 달'} 매매 호가가 비어 있음 (${noQuote.length})</h4>` + (noQuote.length ? `<ul>${li(noQuote.slice(0, 80))}</ul>` : '<p class="hint">없음</p>');
    h += `<h4>호가를 한 번도 적지 않음 (${noPrice.length})</h4>` + (noPrice.length ? `<ul>${li(noPrice.slice(0, 80))}</ul>` : '<p class="hint">없음</p>');
    h += '<h4>평형 누락 (같은 단지의 다른 평형이 거래되는데 담지 않음)</h4><div id="tpMiss" class="hint">확인 중…</div>';
    show('전수조사 중복·누락 점검', h);
    const byCx = new Map();
    for (const it of T.items) (byCx.get(`${it.code}|${it.key}`) || byCx.set(`${it.code}|${it.key}`, []).get(`${it.code}|${it.key}`)).push(it);
    const miss = [];
    for (const [k, arr] of [...byCx].slice(0, 60)) {
      try {
        const ar = await Finder.areas(arr[0].code, arr[0].key);
        const have = new Set(arr.map(x => x.g));
        const lack = (ar.list || []).filter(a => a.n >= 3 && !have.has(a.g)).slice(0, 4);
        if (lack.length) miss.push(`<li>${U.esc(arr[0].dong)} ${U.esc(arr[0].name)} — 안 담은 평형: ${lack.map(a => `${a.g}㎡(${a.n}건)`).join(', ')}</li>`);
      } catch (e) { /* 다음 단지로 */ }
    }
    const el = $('tpMiss'); if (el) el.innerHTML = miss.length ? `<ul>${miss.join('')}</ul>` : '없음';
  }

  function hist() {
    const picked = T.items.filter(it => T.checked.has(it.id));
    if (!picked.length) return U.toast('먼저 표에서 단지를 체크하세요.');
    const log = QLog.all();
    let h = '';
    for (const it of picked.slice(0, 12)) {
      const ms = [...T.months].sort((a, b) => a - b).filter(m => it.quotes[m] && (it.quotes[m].s != null || it.quotes[m].r != null));
      let ps = null, pr = null;
      const rows = ms.map(m => {
        const q = it.quotes[m], ds = q.s != null && ps != null ? q.s - ps : null, dr = q.r != null && pr != null ? q.r - pr : null;
        if (q.s != null) ps = q.s; if (q.r != null) pr = q.r;
        const at = it.qt && it.qt[m] ? U.date(it.qt[m]) : '';
        return `<tr><td>${T.ymLabel(m)}</td><td>${q.s != null ? U.price(q.s) : '-'}</td><td class="${U.cls(ds)}">${ds != null ? U.diff(ds) : '-'}</td><td>${q.r != null ? U.price(q.r) : '-'}</td><td class="${U.cls(dr)}">${dr != null ? U.diff(dr) : '-'}</td></tr>`;
      }).reverse();
      const edits = log.filter(x => x.id === it.id).slice(0, 8).map(x => `<li>${U.esc(x.t)} · ${T.ymLabel(x.ym)} ${QLog.NAMES[x.f] || x.f}: ${x.a == null ? '(빈칸)' : U.price(x.a)} → ${x.b == null ? '(지움)' : U.price(x.b)}</li>`).join('');
      h += `<h4>${U.esc(it.dong)} ${U.esc(it.name)} ${it.g}㎡</h4>` + (rows.length ? `<table class="tbl"><thead><tr><th>달</th><th>매매 호가</th><th>변동</th><th>전세 호가</th><th>변동</th></tr></thead><tbody>${rows.join('')}</tbody></table>` : '<p class="hint">적은 호가가 없습니다.</p>') + (edits ? `<p class="hint">고친 기록</p><ul>${edits}</ul>` : '');
    }
    if (picked.length > 12) h += `<p class="hint">앞의 12개만 보여 드립니다.</p>`;
    show('호가 변동 이력', h);
  }

  function init() {
    if (typeof Tracking === 'undefined' || !Tracking.ext || !$('trkSelBar') || T) return;
    T = Tracking.ext();
    $('btnFolderClean').onclick = () => {
      const fs = T.folderList(), empty = fs.filter(f => f !== '기본' && !T.items.some(it => it.folders.includes(f)));
      if (!empty.length) return U.toast('비어 있는 폴더가 없습니다.');
      if (!confirm(`단지가 없는 폴더 ${empty.length}개를 지울까요?\n${empty.join(', ')}\n(단지가 들어 있는 폴더는 건드리지 않습니다)`)) return;
      T.setFolders(fs.filter(f => !empty.includes(f))); U.toast(`빈 폴더 ${empty.length}개를 정리했습니다.`);
    };
    $('btnTpBulk').onclick = () => { $('tpBulk').hidden = !$('tpBulk').hidden; };
    $('btnTpApply').onclick = apply;
    $('btnTpCheck').onclick = check;
    $('btnTpHist').onclick = hist;
    $('btnTpGap').onclick = () => { $('trkShow').value = 'gap'; T.checked.clear(); T.render(); drawer(false); };
    $('btnTrkDrawer').onclick = () => drawer();
    $('btnTrkDrawerClose').onclick = () => drawer(false);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('trkDrawer').hidden && $('tpModal')?.hidden !== false) drawer(false); });
    const watch = (el, fn, opt) => el && new MutationObserver(fn).observe(el, opt || { childList: true, characterData: true, subtree: true });
    watch($('trkSelCount'), selbar);
    watch($('btnTrkStageAll'), () => { $('trkStageRow').hidden = $('btnTrkStageAll').disabled; }, { attributes: true, attributeFilter: ['disabled'] });
    $('trkStageRow').hidden = $('btnTrkStageAll').disabled;
    flow(); selbar();
  }
  return { init, flow, drawer };
})();
