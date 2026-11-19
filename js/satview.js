/* ─────────────────────────────────────────────────────────
   satview.js — [위성지도] 탭
   · 위성지도는 satellite.html 을 탭 안에 창(iframe)으로 끼워 넣어 띄웁니다. (3D 탭과 같은 방식)
     → 위성지도 코드가 다른 탭의 화면·카카오맵·3D 와 섞이지 않고, 저장 중에 문제가 생겨도 다른 탭은 그대로입니다.
   · 위성지도 창은 이 탭을 처음 열 때만 만듭니다(다른 탭 속도에 영향 없음).
     PC 에서는 탭을 나가도 그대로 두고, 태블릿·휴대폰에서는 탭을 나가면 정리해 메모리를 돌려줍니다.
   · app.js 를 고치지 않으려고, 탭이 보이고 숨는 것(hidden)을 직접 지켜봅니다.
   ───────────────────────────────────────────────────────── */
const SatView = (() => {
  const tab = document.getElementById('tab-sat');
  if (!tab) return {};
  const host = document.getElementById('satHost');
  const touchy = () => window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  let frame = null;

  function fit() {
    if (!frame) return;
    const top = host.getBoundingClientRect().top;
    frame.style.height = Math.max(560, window.innerHeight - Math.max(0, top) - 16) + 'px';
  }
  function load() {
    if (frame) { fit(); if (frame.contentWindow) frame.contentWindow.postMessage({ to: 'sat', type: 'shown' }, location.origin); return; }
    frame = document.createElement('iframe');
    frame.title = '위성지도';
    frame.src = 'satellite.html';
    frame.style.cssText = 'display:block;width:100%;height:600px;border:0;border-radius:10px;background:#0b0b0b';
    host.appendChild(frame);
    requestAnimationFrame(fit);
  }
  function unload() {
    if (!frame) return;
    frame.src = 'about:blank'; frame.remove(); frame = null;
  }

  new MutationObserver(() => { if (!tab.hidden) load(); else if (touchy()) unload(); })
    .observe(tab, { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('resize', () => { if (!tab.hidden) fit(); });
  if (!tab.hidden) load();

  return { load, unload };
})();
