/* ─────────────────────────────────────────────────────────
   alerts.js — [알림] 탭 : 등록한 단지에 새 실거래가 신고되면 텔레그램으로 알려 줍니다.
   · 단지를 검색해 등록 → 단지마다 매매 / 전세 알림을 켜고 끕니다. (시세트래킹 단지를 한꺼번에 가져오기도 가능)
   · 등록 목록은 Google 로그인으로 Firebase(Firestore)에 저장됩니다. → users/{내 계정}/autosync/alerts
   · 알림을 보내는 쪽은 GitHub Actions (scripts/alerts.py, .github/workflows/alerts.yml).
     실거래 자동 수집이 끝날 때마다 등록 단지에 새 거래가 있는지 보고 텔레그램 봇으로 보냅니다.
     확인한 결과(마지막 확인 시각·보낸 알림 기록)는 users/{내 계정}/autosync/alertstate 에 남고, 이 탭이 읽어서 보여 줍니다.
   · 텔레그램 봇 토큰은 이 화면·코드에 없습니다 (GitHub Secrets 에만 있음).
   · app.js 를 고치지 않으려고, 탭이 보이는 것을 직접 지켜봅니다.
   ───────────────────────────────────────────────────────── */
const Alerts = (() => {
  const root = document.getElementById('tab-alerts');
  if (!root) return {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => U.esc(s);
  const ACTIONS_URL = 'https://github.com/AscenAscen/apt-dashboard-pro/actions/workflows/alerts.yml';
  const MAX_ITEMS = 300;

  let doc = { v: 1, on: 1, items: [] };       // 내가 등록한 단지
  let pub = null;                              // 서버(Actions)가 남긴 확인 결과
  let inited = false, busy = false, msg = '';
  const kinds = { sale: 1, rent: 1 };          // 새로 등록할 때 켜 둘 알림 종류

  const parse = (t) => { try { return JSON.parse(t); } catch (e) { return null; } };
  const nowStr = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const why = (e) => {
    const c = e && e.code;
    if (c === 'permission-denied') return 'Firestore 보안 규칙이 막고 있습니다. (users/내 계정/ 아래 문서를 읽고 쓸 수 있게 규칙을 확인하세요.)';
    if (c === 'unavailable') return '인터넷 연결이 불안정합니다. 잠시 뒤 다시 시도하세요.';
    return (e && e.message) || String(e);
  };

  /* ── Firestore ── */
  async function dref(name) {
    await FbSync.load();
    const u = await FbSync.user();
    if (!u) return null;
    return firebase.firestore().collection('users').doc(u.uid).collection('autosync').doc(name);
  }
  async function readAll() {
    const a = await dref('alerts'); if (!a) return null;
    const s = await dref('alertstate');
    const [da, ds] = await Promise.all([a.get(), s.get()]);
    return { a: da.exists ? parse(da.data().json) : null, p: ds.exists ? parse(ds.data().pub) : null };
  }
  /** 최신 목록을 읽어 고친 뒤 저장 (다른 기기에서 막 고친 것을 덮어쓰지 않게) */
  async function mutate(fn) {
    const a = await dref('alerts'); if (!a) throw new Error('Google 로그인이 필요합니다.');
    const snap = await a.get();
    const cur = (snap.exists && parse(snap.data().json)) || { v: 1, on: 1, items: [] };
    if (!Array.isArray(cur.items)) cur.items = [];
    fn(cur);
    cur.v = 1;
    await a.set({ json: JSON.stringify(cur), updatedAt: new Date().toISOString() });
    doc = cur;
  }

  /* ── 화면 ── */
  function frame() {
    root.innerHTML = `
<style>
  #tab-alerts .al-grid { display: grid; grid-template-columns: minmax(300px, 440px) 1fr; gap: 14px; align-items: start; }
  #tab-alerts .al-grid > .panel { margin-bottom: 0; }
  #tab-alerts h3 { margin: 0 0 8px; font-size: 15px; }
  #tab-alerts td.l, #tab-alerts th.l { text-align: left; }
  #tab-alerts .al-st { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; margin: 6px 0 2px; }
  #tab-alerts .al-pill { display: inline-block; font-size: 12px; padding: 1px 8px; border-radius: 9px; border: 1px solid var(--line); color: var(--sub); }
  #tab-alerts .al-pill.ok { color: #30a46c; border-color: #30a46c; }
  #tab-alerts .al-pill.wait { color: #f2c94c; border-color: #f2c94c; }
  #tab-alerts .al-pill.bad { color: var(--danger); border-color: var(--danger); }
  #tab-alerts .al-row { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin: 8px 0; }
  #tab-alerts .al-row label { white-space: nowrap; }
  #tab-alerts .al-search { position: relative; flex: 1 1 220px; }
  #tab-alerts .al-search input { width: 100%; }
  #tab-alerts .al-err { color: var(--danger); margin: 6px 0; }
  #tab-alerts .al-ok { color: #30a46c; margin: 6px 0; }
  #tab-alerts .al-steps { margin: 6px 0 0; padding-left: 18px; color: var(--sub); font-size: 12px; }
  @media (max-width: 900px) { #tab-alerts .al-grid { grid-template-columns: 1fr; } }
</style>
<div id="alBody"></div>`;
    root.onclick = onClick;
    root.onchange = onChange;
  }

  function loginView(text, btn) {
    $('alBody').innerHTML = `<section class="panel"><h3>🔔 알림</h3><p class="hint">${text}</p>${btn ? `<button class="primary" id="alLogin">Google 로그인</button>` : ''}<div id="alMsg" class="al-err"></div></section>`;
    const b = $('alLogin');
    if (b) b.onclick = async () => {
      b.disabled = true;
      try { await FbSync.signIn(); await refresh(); } catch (e) { b.disabled = false; $('alMsg').textContent = why(e); }
    };
  }

  function lastRunInfo() {
    if (!pub || !pub.lastRun) return { cls: 'wait', text: '서버가 아직 한 번도 확인하지 않았어요' };
    return { cls: 'ok', text: `서버 마지막 확인 ${pub.lastRun}` };
  }

  function view() {
    const items = doc.items || [], watching = new Set((pub && pub.w) || []);
    const info = lastRunInfo();
    const tgBad = pub && pub.tg && pub.tg !== 'ok';
    const rows = items.map(it => {
      const st = watching.has(it.id) ? `<span class="al-pill ok">감시 중</span>` : `<span class="al-pill wait">다음 확인 때 시작</span>`;
      const last = (pub && pub.last && pub.last[it.id]) || '';
      return `<tr data-id="${esc(it.id)}"><td class="l"><b>${esc(it.name)}</b></td><td class="l">${esc(it.sgg)} ${esc(it.dong)}</td>
        <td><input type="checkbox" data-k="sale" ${it.sale ? 'checked' : ''}></td><td><input type="checkbox" data-k="rent" ${it.rent ? 'checked' : ''}></td>
        <td>${st}</td><td>${esc(last)}</td><td><button class="mini danger" data-del>삭제</button></td></tr>`;
    }).join('');
    const log = ((pub && pub.log) || []).slice().reverse().slice(0, 30);
    $('alBody').innerHTML = `
<section class="panel">
  <h3>🔔 텔레그램 알림</h3>
  <p class="hint">등록한 단지에 <b>새 실거래가 신고되면</b> 텔레그램으로 알려 줘요. 국토부 실거래는 계약 후 최대 30일 안에 신고되고, 자동 수집이 2시간마다 돌기 때문에 "거래가 올라온 것"을 알려 주는 방식이에요. (호가 알림은 아님)</p>
  <div class="al-st">
    <span class="al-pill ${info.cls}">${esc(info.text)}</span>
    ${tgBad ? `<span class="al-pill bad">텔레그램 보내기 실패 — Actions 로그 확인</span>` : ''}
    <label><input type="checkbox" id="alOn" ${doc.on ? 'checked' : ''}> 알림 켜기</label>
    <a class="btn" href="${ACTIONS_URL}" target="_blank" rel="noopener">▶ 지금 바로 확인 (GitHub Actions 열기)</a>
  </div>
  <ol class="al-steps"><li>GitHub Actions 가 열리면 오른쪽 <b>Run workflow</b> 를 눌러요.</li><li>새로 등록한 단지는 첫 확인 때 "등록 확인" 메시지가 오고, 그다음 새 거래부터 알려 줘요.</li></ol>
  <div id="alMsg" class="${msg.startsWith('!') ? 'al-err' : 'al-ok'}">${esc(msg.replace(/^!/, ''))}</div>
</section>
<section class="panel">
  <h3>단지 등록</h3>
  <div class="al-row">
    <div class="al-search"><input id="alSearch" type="text" placeholder="단지 이름 검색 (예: 헬리오, 평촌 래미안)" autocomplete="off"></div>
    <label><input type="checkbox" id="alKSale" ${kinds.sale ? 'checked' : ''}> 매매</label>
    <label><input type="checkbox" id="alKRent" ${kinds.rent ? 'checked' : ''}> 전세</label>
    <button id="alImport" title="시세트래킹 탭에 담긴 단지를 모두 알림에 등록합니다">⬇ 시세트래킹 단지 가져오기</button>
  </div>
  <p class="hint">검색해서 단지를 누르면 바로 등록돼요. 등록 단지는 ${MAX_ITEMS}개까지.</p>
</section>
<section class="panel">
  <h3>등록한 단지 <span class="al-pill">${items.length}개</span></h3>
  ${items.length ? `<div class="tablewrap"><table><thead><tr><th class="l">단지</th><th class="l">지역</th><th>매매</th><th>전세</th><th>상태</th><th>마지막 알림</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<p class="empty">아직 등록한 단지가 없어요. 위 검색칸에서 단지를 찾아 눌러 보세요.</p>`}
</section>
<section class="panel">
  <h3>최근 보낸 알림</h3>
  ${log.length ? `<div class="tablewrap short"><table><thead><tr><th class="l">시각</th><th class="l">단지</th><th class="l">내용</th></tr></thead><tbody>${log.map(l => `<tr><td class="l">${esc(l.at)}</td><td class="l">${esc(l.name)}</td><td class="l">${esc(l.text)}</td></tr>`).join('')}</tbody></table></div>`
    : `<p class="hint">아직 보낸 알림이 없어요.</p>`}
</section>`;
    if (typeof Finder !== 'undefined') Finder.attach($('alSearch'), (x) => { $('alSearch').value = ''; add([x]); });
  }

  /* ── 동작 ── */
  async function run(fn, okMsg) {
    if (busy) return; busy = true;
    try { await mutate(fn); msg = okMsg || ''; } catch (e) { msg = '!' + why(e); }
    busy = false; view();
  }
  const mk = (x) => ({ id: `${x.code}|${x.key}`, code: x.code, key: x.key, sido: x.sido || '', sgg: x.sgg || '', dong: x.dong || '', jibun: x.jibun || '', name: x.name || '', sale: kinds.sale ? 1 : 0, rent: kinds.rent ? 1 : 0, at: new Date().toISOString() });

  function add(list) {
    if (!kinds.sale && !kinds.rent) { msg = '!매매·전세 중 하나는 켜 두세요.'; return view(); }
    let added = 0, dup = 0, over = false;
    return run((cur) => {
      const have = new Set(cur.items.map(i => i.id));
      for (const x of list) {
        const it = mk(x);
        if (have.has(it.id)) { dup++; continue; }
        if (cur.items.length >= MAX_ITEMS) { over = true; break; }
        cur.items.push(it); have.add(it.id); added++;
      }
    }, '').then(() => {
      if (msg.startsWith('!')) return;
      msg = over ? `${MAX_ITEMS}개까지만 등록할 수 있어요. (${added}개 등록)` : added ? `${added}개 등록했어요.${dup ? ` (이미 등록된 ${dup}개는 건너뜀)` : ''} 다음 확인 때부터 알려 줘요.` : `이미 등록된 단지예요.`;
      view();
    });
  }

  function importTracking() {
    if (typeof Tracking === 'undefined' || !Tracking.all) { msg = '!시세트래킹 탭을 아직 불러오지 못했어요. 잠시 뒤 다시 눌러 주세요.'; return view(); }
    const seen = new Set(), list = [];
    for (const it of Tracking.all()) {
      if (!it.code || !it.key) continue;
      const id = `${it.code}|${it.key}`;
      if (seen.has(id)) continue; seen.add(id); list.push(it);
    }
    if (!list.length) { msg = '!시세트래킹에 담긴 단지가 없어요.'; return view(); }
    return add(list);
  }

  function onClick(e) {
    if (e.target.closest('#alImport')) return importTracking();
    const del = e.target.closest('[data-del]');
    if (del) {
      const id = del.closest('tr').dataset.id;
      return run((cur) => { cur.items = cur.items.filter(i => i.id !== id); }, '삭제했어요.');
    }
  }
  function onChange(e) {
    const t = e.target;
    if (t.id === 'alOn') return run((cur) => { cur.on = t.checked ? 1 : 0; }, t.checked ? '알림을 켰어요.' : '알림을 껐어요. (꺼 둔 동안의 거래는 켜면 알리지 않고 조용히 넘어가요.)');
    if (t.id === 'alKSale') { kinds.sale = t.checked ? 1 : 0; return; }
    if (t.id === 'alKRent') { kinds.rent = t.checked ? 1 : 0; return; }
    const k = t.dataset && t.dataset.k, tr = t.closest && t.closest('tr[data-id]');
    if (k && tr) { const id = tr.dataset.id; return run((cur) => { const it = cur.items.find(i => i.id === id); if (it) it[k] = t.checked ? 1 : 0; }, ''); }
  }

  async function refresh() {
    if (typeof FbSync === 'undefined' || !FbSync.configured()) return loginView('Google 로그인(Firebase) 설정이 아직 없어요. js/fbconfig.js 를 확인하세요.', false);
    $('alBody').innerHTML = '<p class="hint" style="padding:14px">불러오는 중…</p>';
    let r;
    try { r = await readAll(); } catch (e) { return loginView(`<span class="al-err">${esc(why(e))}</span>`, false); }
    if (!r) return loginView('알림 목록은 내 Google 계정에 저장돼요. 휴대폰·PC 어디서든 같은 목록이 보이려면 로그인이 필요해요.', true);
    doc = r.a || { v: 1, on: 1, items: [] }; if (!Array.isArray(doc.items)) doc.items = [];
    pub = r.p; msg = '';
    view();
  }

  function init() { if (inited) { refresh(); return; } inited = true; frame(); refresh(); }
  new MutationObserver(() => { if (!root.hidden) init(); }).observe(root, { attributes: true, attributeFilter: ['hidden'] });
  if (!root.hidden) init();
  return { init, refresh };
})();
