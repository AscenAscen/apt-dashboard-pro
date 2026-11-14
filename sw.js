/* 서비스 워커 — 휴대폰에 앱처럼 설치할 수 있게 해 주고, 인터넷이 끊겨도 화면 틀은 열리게 합니다.
   항상 최신 파일을 먼저 받고(네트워크 우선), 실패했을 때만 저장해 둔 것을 씁니다.
   그래서 GitHub 에 파일을 고쳐 올리면 새로고침만으로 바로 반영됩니다. */
const CACHE = 'apt-dashboard-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;      // 외부(카카오 등)는 건드리지 않음
  const isData = url.pathname.includes('/data/sale/') || url.pathname.includes('/data/rent/') || url.pathname.includes('/data/index/');
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok && !isData) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }   // 실거래 자료는 용량이 커서 저장하지 않음
      return res;
    }).catch(() => caches.match(e.request).then(hit => hit || Response.error()))
  );
});
