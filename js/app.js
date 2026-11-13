/* ─────────────────────────────────────────────────────────
   app.js — 시작, 탭 전환, 지도 창, 데이터 상태 표시
   ───────────────────────────────────────────────────────── */
const App = (() => {
  const $ = (id) => document.getElementById(id);

  function showTab(name) {
    document.querySelectorAll('.tab').forEach(el => { el.hidden = el.id !== 'tab-' + name; });
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    if (name === 'tracking') Tracking.open();
  }

  /** 지도 창 열기. 단지 정보(sido, sgg, dong, jibun, name)가 있으면 됩니다 */
  function showMap(r) {
    const addr = `${r.sido} ${r.sgg} ${r.dong} ${r.jibun || ''}`.trim();
    const q = encodeURIComponent(`${r.sgg} ${r.dong} ${r.name}`);
    $('mapTitle').textContent = `${r.name} — ${addr}`;
    $('mapFrame').src = `https://maps.google.com/maps?q=${encodeURIComponent(addr)}&z=16&hl=ko&output=embed`;
    $('mapNaver').href = `https://map.naver.com/p/search/${q}`;
    $('mapKakao').href = `https://map.kakao.com/?q=${q}`;
    $('mapLand').href = U.landLink(r.sgg, r.dong, r.name);
    $('mapModal').hidden = false;
  }
  function closeMap() { $('mapModal').hidden = true; $('mapFrame').src = 'about:blank'; }

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

  async function init() {
    await gate();
    document.querySelectorAll('#tabs button').forEach(b => { b.onclick = () => showTab(b.dataset.tab); });
    $('mapClose').onclick = closeMap;
    $('mapModal').onclick = (e) => { if (e.target.id === 'mapModal') closeMap(); };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMap(); });
    Tracking.init();
    Grouping.init();
    Trends.init();
    await Search.init();
    showStatus();
  }

  document.addEventListener('DOMContentLoaded', init);
  return { showMap, showTab };
})();
