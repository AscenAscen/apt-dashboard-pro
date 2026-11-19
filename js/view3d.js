/* ─────────────────────────────────────────────────────────
   view3d.js — [3D] 탭 (브이월드 3D 지도 + 카카오 로드뷰)
   · 3D 지도는 3d.html 을 탭 안에 창(iframe)으로 끼워 넣어 띄웁니다.
     → 3D 라이브러리가 다른 탭의 화면·카카오맵과 섞이지 않고, 3D 쪽에 문제가 생겨도 다른 탭은 그대로입니다.
   · 3D 창은 이 탭을 처음 열 때만 만듭니다(다른 탭 속도에 영향 없음).
     PC 에서는 탭을 나가도 그대로 두고, 태블릿·휴대폰에서는 탭을 나가면 정리해 메모리를 돌려줍니다.
   · 브이월드 인증키: js/config.js 의 VWORLD_KEY, 없으면 이 탭에서 직접 입력(이 브라우저에만 저장)
   · 단지 위치: 다른 탭과 같이 카카오 주소 검색(KMap.geocode)을 그때그때 씀. 좌표는 저장하지 않음.
     단, [위치 고치기]로 직접 찍은 위치는 내가 정한 값이라 저장합니다.
   저장 위치 (모두 3D 전용 이름): apt.v3d.recent.v1 최근 본 단지 · apt.v3d.fix.v1 고친 위치 · apt.v3d.key 직접 넣은 키 · apt.v3d.ui.v1 화면 설정
   ───────────────────────────────────────────────────────── */
const View3D = (() => {
  const $ = (id) => document.getElementById(id);
  const RKEY = 'apt.v3d.recent.v1', FKEY = 'apt.v3d.fix.v1', KKEY = 'apt.v3d.key', UKEY = 'apt.v3d.ui.v1';
  const RECENT_MAX = 10;
  const VIEW_NAME = { top: '위에서', tilt: '비스듬히', eye: '눈높이' };
  const touchy = () => window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  let inited = false, frame = null, frameReady = false, waitTimer = null;
  let cur = null, pos = null;          // 지금 보는 단지 { code, key, sido, sgg, dong, jibun, name } 과 위치 { lat, lng, exact, fixed }
  let ui = { view: 'tilt', split: '7', build: true };
  let rv = null, rvClient = null, seq = 0, spinning = false, fixing = false;

  const key = () => String((typeof CONFIG !== 'undefined' && CONFIG.VWORLD_KEY) || Store.get(KKEY, '') || '').trim();
  const idOf = (r) => `${r.code}|${r.key}`;
  const post = (o) => { if (frame && frame.contentWindow) frame.contentWindow.postMessage(Object.assign({ to: 'v3d' }, o), location.origin); };
  const saveUi = () => Store.set(UKEY, ui);

  /* ── 화면 상태 표시 ── */
  function note(text, warn) { const el = $('v3Note'); if (!el) return; el.textContent = text || ''; el.classList.toggle('warn', !!warn); }
  function cover(html) { const el = $('v3Cover'); if (!el) return; el.innerHTML = html || ''; el.hidden = !html; }

  /* ── 인증키가 없을 때 안내 ── */
  function keyPanel() {
    cover(`<div class="v3-key">
      <b>브이월드 인증키를 넣어 주세요</b>
      <ol>
        <li><a href="https://www.vworld.kr" target="_blank" rel="noopener">vworld.kr</a> 에 회원가입하고 로그인합니다.</li>
        <li>오픈API → 인증키 발급에서 서비스 URL 에 <code>${U.esc(location.origin)}</code> 를 넣고, <b>WebGL 3D</b> 를 체크해 신청합니다.</li>
        <li>발급된 키를 아래 칸에 붙여 넣고 [저장]을 누릅니다.</li>
      </ol>
      <div class="filters"><input id="v3KeyIn" placeholder="예: 1A2B3C4D-…" autocomplete="off" style="min-width:300px"><button class="primary" id="v3KeySave">저장</button></div>
      <p class="hint">키는 이 브라우저에만 저장됩니다. 모든 기기에서 쓰려면 <b>js/config.js</b> 의 <b>VWORLD_KEY</b> 에 넣으세요. (README 의 "브이월드 3D 연결" 참고)</p></div>`);
    $('v3KeySave').onclick = () => {
      const v = $('v3KeyIn').value.trim();
      if (!/^[A-Za-z0-9-]{10,60}$/.test(v)) return U.toast('키 모양이 맞지 않습니다. 브이월드에서 받은 키를 그대로 붙여 넣으세요.');
      Store.set(KKEY, v); cover(''); unload(); load();
    };
  }

  /* ── 3D 창 만들기·정리 ── */
  function load() {
    if (frame) return;
    if (!key()) return keyPanel();
    frameReady = false;
    frame = document.createElement('iframe');
    frame.className = 'v3-frame';
    frame.title = '3D 지도';
    frame.setAttribute('allow', 'fullscreen');
    frame.src = `3d.html?k=${encodeURIComponent(key())}`;
    $('v3Map').appendChild(frame);
    note('3D 지도를 불러오는 중…');
    clearTimeout(waitTimer);
    waitTimer = setTimeout(() => { if (!frameReady) note('3D 지도가 늦게 뜨고 있습니다. 계속 안 뜨면 인증키와 키에 등록한 사이트 주소를 확인하세요.', true); }, 25000);
  }
  function unload() {
    clearTimeout(waitTimer);
    if (frame) { frame.src = 'about:blank'; frame.remove(); }
    frame = null; frameReady = false; spinning = false; fixing = false; syncBtns();
  }

  /* ── 3D 창에서 온 쪽지 ── */
  function onMessage(e) {
    if (e.origin !== location.origin || !e.data || e.data.from !== 'v3d' || !frame || e.source !== frame.contentWindow) return;
    const d = e.data;
    if (d.type === 'ready') {
      frameReady = true; clearTimeout(waitTimer); note('');
      post({ type: 'build', on: ui.build });
      if (cur && pos) go();
      return;
    }
    if (d.type === 'error') {
      note(d.text || '3D 지도에 문제가 생겼습니다.', true);
      if (d.code === 'nokey') keyPanel();
      return;
    }
    if (d.type === 'spin') { spinning = !!d.on; return syncBtns(); }
    if (d.type === 'picked') return picked(d.lat, d.lng);
    if (d.type === 'captured') return saveImage(d);
  }

  /* ── 단지 열기 (검색·최근 본 단지·다른 탭의 [3D] 버튼) ── */
  async function show(r) {
    if (!r || !r.code || !r.key) return;
    if (!inited) init();
    cur = { code: r.code, key: r.key, sido: r.sido, sgg: r.sgg, dong: r.dong, jibun: r.jibun || '', name: r.name };
    addRecent(cur);
    $('v3Title').textContent = `${cur.sgg || ''} ${cur.dong || ''} ${cur.name}`.trim();
    const my = ++seq;
    pos = null; syncBtns();
    const fix = Store.get(FKEY, {})[idOf(cur)];
    if (fix) pos = { lat: fix.lat, lng: fix.lng, exact: true, fixed: true };
    else {
      if (!KMap.ready()) { note('단지 위치를 찾으려면 카카오 키가 필요합니다. (js/config.js 의 KAKAO_JS_KEY)', true); return; }
      note('단지 위치를 찾는 중…');
      try { pos = await KMap.geocode(cur); } catch (e) { console.error(e); pos = null; }
      if (my !== seq) return;
      if (!pos) { note('단지 위치를 찾지 못했습니다. [📍 위치 고치기]로 3D 지도에서 직접 찍어 주세요.', true); syncBtns(); load(); return; }
    }
    syncBtns();
    note(pos.fixed ? '직접 고친 위치로 보여 줍니다.' : pos.exact ? '' : '정확한 주소를 못 찾아 동 중심으로 보여 줍니다. 단지가 아니면 [📍 위치 고치기]를 눌러 주세요.', !pos.fixed && !pos.exact);
    load();
    if (frameReady) go();
    road();
  }
  function go() { if (cur && pos) post({ type: 'goto', lat: pos.lat, lng: pos.lng, name: cur.name, view: ui.view, heading: 0 }); }

  /* ── 최근 본 단지 ── */
  function addRecent(r) {
    const list = Store.get(RKEY, []).filter(x => idOf(x) !== idOf(r));
    list.unshift(r);
    Store.set(RKEY, list.slice(0, RECENT_MAX));
    renderRecent();
  }
  function renderRecent() {
    const box = $('v3Recent'); if (!box) return;
    const list = Store.get(RKEY, []);
    box.innerHTML = list.length
      ? '<span class="hint" style="margin:0">최근 본 단지</span>' + list.map((x, i) => `<button data-i="${i}" class="${cur && idOf(cur) === idOf(x) ? 'on' : ''}" title="${U.esc(`${x.sido || ''} ${x.sgg || ''} ${x.dong || ''}`)}">${U.esc(x.name)}<small>${U.esc(x.sgg || '')}</small></button>`).join('') + '<button data-clear class="mini" title="최근 본 단지 목록 비우기">비우기</button>'
      : '';
  }

  /* ── 위치 고치기 ── */
  function picked(lat, lng) {
    fixing = false; syncBtns();
    if (!cur) return;
    const all = Store.get(FKEY, {});
    all[idOf(cur)] = { lat: +lat.toFixed(6), lng: +lng.toFixed(6), name: cur.name };
    Store.set(FKEY, all);
    pos = { lat: all[idOf(cur)].lat, lng: all[idOf(cur)].lng, exact: true, fixed: true };
    note('위치를 고쳐 저장했습니다. 다음에 열 때도 이 위치로 보여 줍니다.');
    syncBtns(); go(); road();
  }
  function unfix() {
    if (!cur) return;
    const all = Store.get(FKEY, {}); delete all[idOf(cur)]; Store.set(FKEY, all);
    U.toast('고친 위치를 지우고 원래(카카오 주소 검색) 위치로 돌아갑니다.');
    show(cur);
  }

  /* ── 카카오 로드뷰 ── */
  async function road() {
    const msg = $('v3RoadMsg');
    if (ui.split === '0') return;
    if (!pos) { msg.hidden = false; msg.textContent = '단지를 고르면 로드뷰가 나옵니다.'; return; }
    if (!KMap.ready()) { msg.hidden = false; msg.innerHTML = KMap.needKeyHtml; return; }
    try {
      await KMap.load();
      if (!rv) { rv = new kakao.maps.Roadview($('v3Road')); rvClient = new kakao.maps.RoadviewClient(); }
      const p = pos;
      rvClient.getNearestPanoId(KMap.LL(p), 150, (panoId) => {
        if (p !== pos) return;
        if (panoId == null) { msg.hidden = false; msg.textContent = '단지 근처(150m)에 로드뷰가 없습니다. 단지 안이나 새로 생긴 길은 로드뷰가 없을 수 있습니다.'; return; }
        msg.hidden = true;
        rv.setPanoId(panoId, KMap.LL(p));
        setTimeout(() => { try { rv.relayout(); } catch (e) { /* 무시 */ } }, 50);
      });
    } catch (e) { console.error(e); msg.hidden = false; msg.textContent = '로드뷰를 불러오지 못했습니다.'; }
  }

  /* ── 화면 저장 (PNG) — 아래에 단지 이름·시점·날짜·출처를 붙임 ── */
  function saveImage(d) {
    if (d.error) return U.toast(d.error);
    const img = new Image();
    img.onload = () => {
      const bar = 44, c = document.createElement('canvas');
      c.width = img.width; c.height = img.height + bar;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      g.fillStyle = '#111'; g.fillRect(0, img.height, c.width, bar);
      const now = new Date(), day = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
      g.fillStyle = '#fff'; g.font = 'bold 18px "Malgun Gothic", sans-serif'; g.textBaseline = 'middle';
      g.fillText(`${cur ? cur.name : ''}  ·  ${VIEW_NAME[ui.view] || ''}  ·  ${day}`, 14, img.height + bar / 2);
      g.fillStyle = '#aaa'; g.font = '13px "Malgun Gothic", sans-serif'; g.textAlign = 'right';
      g.fillText('3D 지도: 브이월드(국토교통부) · 참고용', c.width - 14, img.height + bar / 2);
      const a = document.createElement('a');
      a.href = c.toDataURL('image/png');
      a.download = `3D_${(cur ? cur.name : '지도').replace(/[\\/:*?"<>|\s]+/g, '_')}_${day.replace(/\./g, '')}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      U.toast('3D 화면을 그림 파일로 저장했습니다.');
    };
    img.onerror = () => U.toast('화면을 그림으로 만들지 못했습니다. 윈도우 캡처(Win+Shift+S)를 써 주세요.');
    img.src = d.dataUrl;
  }

  /* ── 브이월드 사이트 / 네이버 부동산 ── */
  async function openVworld() {
    const text = cur ? `${cur.sido || ''} ${cur.sgg || ''} ${cur.dong || ''} ${cur.jibun || ''}`.replace(/\s+/g, ' ').trim() : '';
    if (text) { try { await navigator.clipboard.writeText(text); U.toast(`주소(${text})를 복사했습니다. 브이월드 검색칸에 붙여넣기(Ctrl+V) 하세요. 일조·조망 분석은 브이월드 사이트의 [분석] 메뉴에 있습니다.`); } catch (e) { /* 무시 */ } }
    window.open('https://map.vworld.kr', '_blank', 'noopener');
  }

  /* ── 버튼 모양 맞추기 ── */
  function syncBtns() {
    document.querySelectorAll('#v3Views button').forEach(b => b.classList.toggle('on', b.dataset.v === ui.view));
    document.querySelectorAll('#v3Split button').forEach(b => b.classList.toggle('on', b.dataset.s === ui.split));
    const sp = $('v3Spin'); if (sp) { sp.classList.toggle('on', spinning); sp.textContent = spinning ? '⏸ 회전 멈춤' : '🔄 자동 회전'; }
    const fx = $('v3Fix'); if (fx) { fx.classList.toggle('on', fixing); fx.textContent = fixing ? '📍 누르기 취소' : '📍 위치 고치기'; }
    const un = $('v3Unfix'); if (un) un.hidden = !(pos && pos.fixed);
    const bd = $('v3Build'); if (bd) { bd.classList.toggle('on', !ui.build); bd.textContent = ui.build ? '🏢 건물 숨기기' : '🏢 건물 보이기'; }
    const wrap = $('v3Split2'); if (wrap) wrap.dataset.split = ui.split;
    renderRecent();
  }

  function init() {
    if (inited) return; inited = true;
    ui = Object.assign(ui, Store.get(UKEY, {}));
    window.addEventListener('message', onMessage);
    Finder.attach($('v3Find'), (x) => show(x));
    $('v3Recent').onclick = (e) => {
      if (e.target.closest('[data-clear]')) { Store.set(RKEY, []); return renderRecent(); }
      const b = e.target.closest('button[data-i]'); if (!b) return;
      const x = Store.get(RKEY, [])[+b.dataset.i]; if (x) show(x);
    };
    $('v3Views').onclick = (e) => { const v = e.target.closest('button')?.dataset.v; if (!v) return; ui.view = v; saveUi(); syncBtns(); post({ type: 'view', view: v }); };
    $('v3Left').onclick = () => post({ type: 'turn', deg: -45 });
    $('v3Right').onclick = () => post({ type: 'turn', deg: 45 });
    $('v3North').onclick = () => post({ type: 'north' });
    $('v3Spin').onclick = () => post({ type: 'spin', on: !spinning });
    $('v3Build').onclick = () => { ui.build = !ui.build; saveUi(); syncBtns(); post({ type: 'build', on: ui.build }); };
    $('v3Fix').onclick = () => {
      if (!frameReady) return U.toast('3D 지도가 뜬 뒤에 눌러 주세요.');
      fixing = !fixing; syncBtns(); post({ type: 'fix', on: fixing });
      if (fixing) U.toast('3D 지도에서 단지 가운데를 한 번 누르세요.');
    };
    $('v3Unfix').onclick = unfix;
    $('v3Shot').onclick = () => { if (!frameReady || !cur) return U.toast('단지를 고르고 3D 지도가 뜬 뒤에 눌러 주세요.'); post({ type: 'capture' }); };
    $('v3Vworld').onclick = openVworld;
    $('v3Naver').onclick = () => { if (cur) LandLink.open(cur.sgg, cur.dong, cur.name); else U.toast('먼저 단지를 고르세요.'); };
    $('v3Split').onclick = (e) => { const s = e.target.closest('button')?.dataset.s; if (!s) return; ui.split = s; saveUi(); syncBtns(); if (s !== '0') { road(); setTimeout(() => { try { rv && rv.relayout(); } catch (x) { /* 무시 */ } }, 80); } };
    $('v3Reload').onclick = () => { unload(); load(); };
    syncBtns();
  }

  /** 탭을 열 때 (app.js) */
  function open() {
    init();
    load();
    if (!cur) { const last = Store.get(RKEY, [])[0]; if (last) show(last); }
    else road();
  }
  /** 다른 탭으로 갈 때 (app.js) — 회전을 멈추고, 태블릿·휴대폰이면 3D 창을 정리 */
  function leave() {
    if (!frame) return;
    if (spinning) post({ type: 'spin', on: false });
    if (fixing) { fixing = false; post({ type: 'fix', on: false }); }
    if (touchy()) unload();
    syncBtns();
  }

  return { init, open, leave, show };
})();
