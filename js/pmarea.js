/* ───────────── 시세지도: 영역 그리기 ─────────────
   지도에서 점을 눌러 다각형을 그리면, 그 안에 들어온 단지가 자동으로 한 묶음이 됩니다. (단지 수·평균 매매가·평균 전세가율)
   저장: apt.pmAreas.v1 = [{ id, name, color, pts: [[lat,lng], …] }] */
const PmArea = (() => {
  const KEY = 'apt.pmAreas.v1', COLORS = ['#ff3b30', '#34c759', '#007aff', '#ff9500', '#af52de', '#5ac8fa', '#ffcc00'];
  const $ = (id) => document.getElementById(id);
  let map = null, getRows = () => [], drawing = false, pts = [], tmp = null, shapes = [], wired = false;
  const areas = () => Store.get(KEY, []);

  /** 점이 다각형 안에 있는지 (ray casting). poly = [[lat,lng],…] */
  function inside(lat, lng, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [yi, xi] = poly[i], [yj, xj] = poly[j];
      if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  const members = (a) => getRows().filter(r => r.pos && inside(r.pos.lat, r.pos.lng, a.pts));

  function drawShapes() {
    shapes.forEach(s => s.setMap(null)); shapes = [];
    if (!map) return;
    for (const a of areas()) {
      const poly = new kakao.maps.Polygon({ path: a.pts.map(p => KMap.LL({ lat: p[0], lng: p[1] })), strokeWeight: 2, strokeColor: a.color, strokeOpacity: .9, fillColor: a.color, fillOpacity: .15 });
      poly.setMap(map); shapes.push(poly);
    }
  }
  function list() {
    const box = $('paList'); if (!box) return;
    const as = areas();
    if (!as.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<table class="grid"><thead><tr><th class="l">영역</th><th>단지 수</th><th>평균 매매가</th><th>평균 전세가율</th><th class="l">단지</th><th></th></tr></thead><tbody>' + as.map(a => {
      const m = members(a), ss = m.filter(r => r.s != null), rt = m.filter(r => r.ratio != null);
      const avg = ss.length ? Kit.eok(ss.reduce((x, r) => x + r.s, 0) / ss.length) : '-', ar = rt.length ? (rt.reduce((x, r) => x + r.ratio, 0) / rt.length).toFixed(0) + '%' : '-';
      return `<tr><td class="l"><span style="color:${a.color}">■</span> <b>${U.esc(a.name)}</b></td><td>${m.length}</td><td>${avg}</td><td>${ar}</td><td class="l"><small>${m.slice(0, 12).map(r => U.esc(r.name)).join(', ')}${m.length > 12 ? ' …' : ''}</small></td>` +
        `<td><button class="mini" data-pa="ren" data-id="${a.id}">이름</button><button class="mini danger" data-pa="del" data-id="${a.id}">삭제</button></td></tr>`;
    }).join('') + '</tbody></table>';
  }
  function setDrawing(on) {
    drawing = on; pts = [];
    if (tmp) { tmp.setMap(null); tmp = null; }
    $('btnPaDraw').hidden = on; $('btnPaDone').hidden = !on; $('btnPaCancel').hidden = !on;
    $('paHint').textContent = on ? '지도에서 영역 모서리를 차례로 누르세요. (3곳 이상) 끝나면 [그리기 완료]' : '';
  }
  function addPoint(lat, lng) {
    if (!drawing) return;
    pts.push([lat, lng]);
    const path = pts.map(p => KMap.LL({ lat: p[0], lng: p[1] }));
    if (!tmp) { tmp = new kakao.maps.Polyline({ path, strokeWeight: 2, strokeColor: '#ff3b30', strokeOpacity: .9 }); tmp.setMap(map); } else tmp.setPath(path);
    $('paHint').textContent = `${pts.length}곳 찍음 — 3곳 이상이면 [그리기 완료]를 누르세요.`;
  }
  function finish(name) {
    if (pts.length < 3) return U.toast('모서리를 3곳 이상 눌러 주세요.');
    const as = areas(), nm = (name || prompt('이 영역의 이름 (예: 평촌 학원가, 역세권)', `영역 ${as.length + 1}`) || '').trim();
    if (!nm) return;
    as.push({ id: 'a' + Date.now().toString(36), name: nm, color: COLORS[as.length % COLORS.length], pts: pts.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)]) });
    Store.set(KEY, as); setDrawing(false); drawShapes(); list();
  }
  function attach(m, rowsFn) {
    getRows = rowsFn;
    if (map !== m) { map = m; wired = false; shapes = []; }
    if (!wired) {
      wired = true;
      kakao.maps.event.addListener(map, 'click', (ev) => { if (drawing && ev && ev.latLng) addPoint(ev.latLng.getLat(), ev.latLng.getLng()); });
    }
    drawShapes(); list();
  }
  function init() {
    if (!$('btnPaDraw')) return;
    $('btnPaDraw').onclick = () => { if (!map) return U.toast('지도가 뜬 다음에 눌러 주세요.'); setDrawing(true); };
    $('btnPaCancel').onclick = () => setDrawing(false);
    $('btnPaDone').onclick = () => finish();
    $('paList').onclick = (e) => {
      const b = e.target.closest('button[data-pa]'); if (!b) return;
      const as = areas(), a = as.find(x => x.id === b.dataset.id); if (!a) return;
      if (b.dataset.pa === 'del') { if (!confirm(`'${a.name}' 영역을 지울까요?`)) return; Store.set(KEY, as.filter(x => x !== a)); }
      else { const n = (prompt('영역 이름', a.name) || '').trim(); if (!n) return; a.name = n; Store.set(KEY, as); }
      drawShapes(); list();
    };
  }
  return { init, attach, refresh: list, inside, _add: addPoint, _start: () => setDrawing(true), _rows: () => getRows(), _finish: finish };
})();
