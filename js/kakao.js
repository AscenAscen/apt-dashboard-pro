/* ─────────────────────────────────────────────────────────
   kakao.js — 카카오맵 공통 도구 (지도 불러오기, 주소→좌표, 거리, 선·원·점 그리기, 주변 장소 찾기)
   js/config.js 의 KAKAO_JS_KEY 에 카카오 JavaScript 키를 넣어야 동작합니다.
   카카오 정책상 검색 결과(좌표 등)는 저장하지 않고, 화면을 여는 동안에만 기억합니다.
   ───────────────────────────────────────────────────────── */
const KMap = (() => {
  let loading = null;
  const geoMemo = new Map();          // 이번 접속 동안만 기억

  const ready = () => !!CONFIG.KAKAO_JS_KEY;
  const needKeyHtml = '카카오맵을 쓰려면 <b>js/config.js</b> 의 <b>KAKAO_JS_KEY</b> 에 카카오 JavaScript 키를 넣어 주세요. (README 의 "카카오맵 연결" 참고)';

  /** 카카오 지도 SDK 불러오기 (한 번만) */
  function load() {
    if (!ready()) return Promise.reject(new Error('카카오 JavaScript 키가 설정되지 않았습니다.'));
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(CONFIG.KAKAO_JS_KEY)}&libraries=services&autoload=false`;
        s.onload = () => { try { kakao.maps.load(() => resolve(kakao)); } catch (e) { reject(e); } };
        s.onerror = () => { loading = null; reject(new Error('카카오맵을 불러오지 못했습니다. 키와 등록한 사이트 주소(도메인)를 확인하세요.')); };
        document.head.appendChild(s);
      });
    }
    return loading;
  }

  const LL = (p) => new kakao.maps.LatLng(p.lat, p.lng);

  /** 단지 → 좌표 {lat, lng, exact}. 지번 주소 → 단지명 검색 → 동 주소 순으로 시도 */
  async function geocode(r) {
    const id = `${r.code}|${r.key}`;
    if (geoMemo.has(id)) return geoMemo.get(id);
    await load();
    const S = kakao.maps.services;
    const addr = (q) => new Promise(res => new S.Geocoder().addressSearch(q, (list, st) => res(st === S.Status.OK && list.length ? { lat: +list[0].y, lng: +list[0].x } : null)));
    const word = (q) => new Promise(res => new S.Places().keywordSearch(q, (list, st) => res(st === S.Status.OK && list.length ? { lat: +list[0].y, lng: +list[0].x } : null)));
    let p = r.jibun ? await addr(`${r.sido} ${r.sgg} ${r.dong} ${r.jibun}`) : null, exact = true;
    if (!p) p = await word(`${r.sgg} ${r.dong} ${r.name}`);
    if (!p) { p = await addr(`${r.sido} ${r.sgg} ${r.dong}`); exact = false; }
    if (p) { p.exact = exact; geoMemo.set(id, p); }
    return p;
  }

  /** 두 좌표 사이 직선거리(km) */
  function km(a, b) {
    const rad = Math.PI / 180;
    const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  }

  /** 지도 만들기 */
  function create(el, center, level = 5) {
    const map = new kakao.maps.Map(el, { center: LL(center), level });
    map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
    return map;
  }

  /** 점 + 이름표. color 기본 빨강. 돌려받은 값의 remove() 로 지움 */
  function dot(map, p, label, color = '#ff3b30') {
    const el = document.createElement('div');
    el.className = 'kdot';
    el.innerHTML = `<i style="background:${color}"></i>${label ? `<span>${U.esc(label)}</span>` : ''}`;
    const ov = new kakao.maps.CustomOverlay({ position: LL(p), content: el, yAnchor: 0.5, xAnchor: 0, zIndex: 5 });
    ov.setMap(map);
    return { remove: () => ov.setMap(null) };
  }

  /** 점선 + 가운데 거리 표시 */
  function line(map, a, b, color = '#ff3b30', text) {
    const pl = new kakao.maps.Polyline({ path: [LL(a), LL(b)], strokeWeight: 3, strokeColor: color, strokeOpacity: 0.9, strokeStyle: 'shortdash' });
    pl.setMap(map);
    const d = km(a, b);
    const el = document.createElement('div');
    el.className = 'klabel';
    el.textContent = text || `${d.toFixed(1)}km`;
    const ov = new kakao.maps.CustomOverlay({ position: LL({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }), content: el, yAnchor: 0.5, zIndex: 4 });
    ov.setMap(map);
    return { km: d, remove: () => { pl.setMap(null); ov.setMap(null); } };
  }

  /** 반경 원 (radius: m) */
  function circle(map, p, radius, color = '#4f9cff', fill = 0.08) {
    const c = new kakao.maps.Circle({ center: LL(p), radius, strokeWeight: 2, strokeColor: color, strokeOpacity: 0.9, strokeStyle: 'dashed', fillColor: color, fillOpacity: fill });
    c.setMap(map);
    return { remove: () => c.setMap(null) };
  }

  /** 여러 좌표가 한눈에 들어오게 지도 범위 맞추기 */
  function fit(map, points) {
    const b = new kakao.maps.LatLngBounds();
    points.forEach(p => b.extend(LL(p)));
    map.setBounds(b, 60, 60, 60, 60);
  }

  /** 반경 안 카테고리 장소 수와 가까운 순 목록(최대 15개) */
  function category(code, p, radius) {
    const S = kakao.maps.services;
    return new Promise(res => new S.Places().categorySearch(code, (list, st, page) => {
      if (st === S.Status.OK) res({ count: page.totalCount, list });
      else res({ count: 0, list: [] });
    }, { location: LL(p), radius, sort: S.SortBy.DISTANCE }));
  }

  /** 키워드로 가까운 장소 찾기 */
  function keyword(q, p, radius) {
    const S = kakao.maps.services;
    return new Promise(res => new S.Places().keywordSearch(q, (list, st) => res(st === S.Status.OK ? list : []), { location: LL(p), radius, sort: S.SortBy.DISTANCE }));
  }

  /** 키워드로 찾은 장소 수 (반경 안) */
  function keywordCount(q, p, radius) {
    const S = kakao.maps.services;
    return new Promise(res => new S.Places().keywordSearch(q, (list, st, page) => res(st === S.Status.OK ? page.totalCount : 0), { location: LL(p), radius }));
  }

  return { ready, needKeyHtml, load, geocode, km, create, dot, line, circle, fit, category, keyword, keywordCount, LL };
})();
