/* ─────────────────────────────────────────────────────────
   app.js — 시작, 탭 전환, 지도 창, 데이터 상태 표시
   ───────────────────────────────────────────────────────── */
const App = (() => {
  const $ = (id) => document.getElementById(id);

  function showTab(name) {
    document.querySelectorAll('.tab').forEach(el => { el.hidden = el.id !== 'tab-' + name; });
    TabTools.open(name);
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    if (name === 'tracking') Tracking.open();
    if (name === 'map') PriceMap.open();
    if (name === 'eval') Eval.open();
    if (name === 'survey') Survey.open();
    if (name === 'market') Market.open();
    if (name === 'invest') Invest.open();
    if (name === 'my') My.open();
    if (name === 'land') Land.open();
    if (name === 'imjang') Imjang.open();
    if (name === 'guide') Guide.open();
    if (name === 'grouping') My.pivot();
    if (name === 'supply') Supply.open();
  }

  /** 지도 창 열기. 단지 정보(code, key, sido, sgg, dong, jibun, name)가 있으면 됩니다.
      카카오 키가 있으면 카카오맵, 없거나 실패하면 구글 지도로 보여 줍니다. */
  let modalMap = null, modalDot = null, mapSeq = 0;
  async function showMap(r) {
    const addr = `${r.sido} ${r.sgg} ${r.dong} ${r.jibun || ''}`.trim();
    const q = encodeURIComponent(`${r.sgg} ${r.dong} ${r.name}`);
    const seq = ++mapSeq;
    $('mapTitle').textContent = `${r.name} — ${addr}`;
    $('mapNaver').href = `https://map.naver.com/p/search/${q}`;
    $('mapKakao').hidden = true; $('mapFrame').hidden = false;
    $('mapKakaoLink').href = `https://map.kakao.com/?q=${q}`;
    $('mapLand').href = U.landLink(r.sgg, r.dong, r.name);
    $('mapModal').hidden = false;
    const google = () => { $('mapKakao').hidden = true; $('mapFrame').hidden = false; $('mapFrame').src = `https://maps.google.com/maps?q=${encodeURIComponent(addr)}&z=16&hl=ko&output=embed`; };
    if (!KMap.ready()) return google();
    try {
      $('mapFrame').hidden = true; $('mapKakao').hidden = false;
      await KMap.load();
      const pos = await KMap.geocode(r);
      if (seq !== mapSeq) return;
      if (!pos) return google();
      if (!modalMap) modalMap = KMap.create($('mapKakao'), pos, 4);
      modalMap.relayout(); modalMap.setLevel(4); modalMap.setCenter(KMap.LL(pos));
      if (modalDot) modalDot.remove();
      modalDot = KMap.dot(modalMap, pos, r.name);
    } catch (e) { console.error(e); if (seq === mapSeq) google(); }
  }
  function closeMap() { mapSeq++; $('mapModal').hidden = true; $('mapFrame').src = 'about:blank'; }

  async function showStatus() {
    const s = await Data.status();
    const el = $('status');
    if (!s) { el.textContent = '아직 수집된 데이터가 없습니다. README 의 설정을 마치면 자동으로 채워집니다.'; el.classList.add('warn'); return; }
    const p = (k) => { const x = s.progress?.[k]; return x && x.total ? Math.floor(x.done / x.total * 100) : 0; };
    let text = `데이터 기준 ${s.updatedAt} · 수집률 매매 ${p('sale')}% / 전세 ${p('rent')}%`;
    const stop = s.lastRun?.stop || '';
    if (stop.startsWith('인증키')) { text += ` · ⚠ ${stop}`; el.classList.add('warn'); }
    if (s.emptyRegions?.length) { text += ` · ⚠ 자료 없는 지역 ${s.emptyRegions.length}곳`; el.title = '지역코드 변경 의심: ' + s.emptyRegions.join(', '); }
    el.textContent = text;
  }

  /* ── 접속 비밀번호 (js/config.js 의 PASSWORD_HASH) ── */
  async function sha(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('apt-dashboard:' + text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function gate() {
    const making = location.hash === '#pw';             // 주소 뒤에 #pw → 비밀번호 만들기 화면
    const hash = CONFIG.PASSWORD_HASH || '';
    if (!making && (!hash || Store.get('apt.unlock', '') === hash)) return Promise.resolve();
    document.body.classList.add('locked');
    $('lock').hidden = false;
    $('lockInput').focus();
    if (making) {
      $('lockTitle').textContent = '비밀번호 만들기';
      $('lockBtn').textContent = '만들기';
      $('lockMsg').textContent = '사용할 비밀번호를 입력하고 [만들기]를 누르세요.';
    }
    return new Promise((resolve) => {
      $('lockForm').onsubmit = async (e) => {
        e.preventDefault();
        const value = $('lockInput').value;
        if (!value) return;
        const h = await sha(value);
        if (making) {
          $('lockOut').hidden = false;
          $('lockOut').value = `PASSWORD_HASH: '${h}',`;
          $('lockOut').select();
          $('lockMsg').textContent = "위 한 줄을 복사해 js/config.js 의 PASSWORD_HASH: '', 줄과 바꿔 넣고 저장(Commit)하세요.";
          return;
        }
        if (h !== hash) { $('lockMsg').textContent = '비밀번호가 맞지 않습니다.'; $('lockInput').select(); return; }
        Store.set('apt.unlock', hash);
        $('lock').hidden = true;
        document.body.classList.remove('locked');
        resolve();
      };
    });
  }

  /* ── 배경 테마 고르기 (색은 css/style.css 맨 위 [data-theme=…] 에서 정함) ── */
  function initTheme() {
    const sel = $('themeSel');
    sel.value = Store.get('apt.theme', '');
    sel.onchange = () => {
      Store.set('apt.theme', sel.value);
      location.reload();        // 그래프 색까지 한 번에 맞추기 위해 화면을 다시 엶 (적어 둔 값은 모두 저장돼 있음)
    };
  }

  async function init() {
    initTheme();
    await gate();
    document.querySelectorAll('#tabs button').forEach(b => { b.onclick = () => showTab(b.dataset.tab); });
    $('mapClose').onclick = closeMap;
    $('mapModal').onclick = (e) => { if (e.target.id === 'mapModal') closeMap(); };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMap(); const sd = $('spDrawer'); if (sd && !sd.hidden) { sd.hidden = true; $('btnSpDrawer')?.classList.remove('on'); } ['realModal', 'codeModal', 'pasteModal'].forEach(id => { $(id).hidden = true; }); document.body.classList.remove('imjang-mode'); } });
    Guide.init();
    Tracking.init(); if (typeof TrkPlus !== "undefined") TrkPlus.init(); if (typeof Sync !== "undefined") Sync.init(); if (typeof CxView !== "undefined") CxView.init(); if (typeof CK !== "undefined") CK.init();
    QLog.check();              // 지금 상태를 기준으로 삼아, 이후에 고친 호가만 이력에 남김
    Vault.init();
    Grouping.init();
    Survey.init();
    Trends.init();
    Compare.init();
    Infra.init();
    Home.init();
    Market.init(); Imjang.init(); PriceMap.init(); Supply.init(); if (typeof PmArea !== "undefined") PmArea.init(); Eval.init();
    await Search.init();
    await Promise.all([My.init(), Land.init()]);
    Settings.init();           // 탭 순서·보이기, 업무지구 — 다른 탭이 모두 준비된 뒤에 적용해야 첫 화면이 바뀌어도 안전합니다
    // 저장함: 값이 Store 에 그대로 들어 있는 탭들 (단지 비교·입지 분석·비교 평가·시세지도는 각 파일에서 등록)
    Saves.register('survey', { name: '전수조사', keys: ['apt.survey.v1', 'apt.surveyMeta.v1'], hint: '전수조사에 적은 호가 기록 전체를 통째로 저장합니다. 불러오면 지금의 전수조사 기록 전체가 저장 당시 내용으로 바뀌니, 먼저 지금 화면도 저장해 두세요.' });
    Saves.register('grouping', { name: '시세그룹핑', keys: ['apt.grouping.v1'], hint: '그룹핑 판(생활권·가격대·배치) 전체를 저장합니다.' });
    const xa = $('btnXlAll'); if (xa) xa.onclick = () => Xl.all();
    showStatus();
    const back = sessionStorage.getItem('apt.openTab');       // 저장함에서 불러온 뒤 다시 열린 경우 그 탭으로
    if (back) { sessionStorage.removeItem('apt.openTab'); if (document.querySelector(`#tabs button[data-tab="${back}"]`)) showTab(back); }
    else { const cur = document.querySelector('#tabs button.on')?.dataset.tab; if (cur) TabTools.open(cur); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  // 휴대폰 홈 화면에 앱처럼 설치할 수 있게 (PWA)
  if ('serviceWorker' in navigator) window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  return { showMap, showTab };
})();
