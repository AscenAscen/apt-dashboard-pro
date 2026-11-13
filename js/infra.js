/* ─────────────────────────────────────────────────────────
   infra.js — [입지 분석] 탭 (카카오맵)
   ① 반경 500m·1km 인프라 개수   ② 3대 업무지구 직선거리
   ③ 지도 + 로드뷰 나란히 보기    ④ 가장 가까운 초등학교 연결
   항목·기준점은 js/config.js 의 INFRA, HUBS 에서 바꿉니다.
   ───────────────────────────────────────────────────────── */
const Infra = (() => {
  const $ = (id) => document.getElementById(id);
  let regions = [], idx = { c: {} };
  let map = null, rv = null, rvClient = null, shapes = [], cur = null, hybrid = false, rvLayer = false, seq = 0;

  async function init() {
    regions = await Data.regions();
    const sidos = [...new Set(regions.map(r => r[1]))];
    $('inSido').innerHTML = sidos.map(x => `<option>${U.esc(x)}</option>`).join('');
    const saved = Store.get('apt.lastRegion', null);
    if (saved && sidos.includes(saved.sido)) $('inSido').value = saved.sido;
    fillSgg(saved?.code);
    $('inSido').onchange = () => fillSgg();
    $('inSgg').onchange = () => fillApt(true);
    $('inFind').oninput = () => fillApt(false);
    $('btnInfra').onclick = run;
    $('inView').onclick = (e) => { if (e.target.dataset.v && cur) view(e.target.dataset.v); };
    $('inHybrid').onclick = () => {
      if (!map) return;
      hybrid = !hybrid;
      map.setMapTypeId(hybrid ? kakao.maps.MapTypeId.HYBRID : kakao.maps.MapTypeId.ROADMAP);
      $('inHybrid').textContent = hybrid ? '일반 지도' : '위성 지도';
    };
    $('inRvLayer').onclick = () => {
      if (!map) return;
      rvLayer = !rvLayer;
      if (rvLayer) map.addOverlayMapTypeId(kakao.maps.MapTypeId.ROADVIEW); else map.removeOverlayMapTypeId(kakao.maps.MapTypeId.ROADVIEW);
      $('inRvLayer').textContent = rvLayer ? '로드뷰 도로 숨기기' : '로드뷰 도로 표시';
    };
  }

  function fillSgg(code) {
    const list = regions.filter(r => r[1] === $('inSido').value);
    $('inSgg').innerHTML = list.map(r => `<option value="${r[0]}">${U.esc(r[2])}</option>`).join('');
    if (code && list.some(r => r[0] === code)) $('inSgg').value = code;
    fillApt(true);
  }

  async function fillApt(reload) {
    const code = $('inSgg').value;
    if (reload) { idx = await Data.index(code); if (code !== $('inSgg').value) return; }
    const find = $('inFind').value.trim().toLowerCase();
    const keys = Object.keys(idx.c).map(k => ({ k, ...Data.parseKey(k) }))
      .filter(x => !find || x.name.toLowerCase().includes(find) || x.dong.includes(find))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    $('inApt').innerHTML = `<option value="">${keys.length ? `선택하세요 (${keys.length}개)` : (Object.keys(idx.c).length ? '검색 결과 없음' : '수집된 자료 없음')}</option>` +
      keys.slice(0, 800).map(x => `<option value="${U.esc(x.k)}">${U.esc(x.name)} (${U.esc(x.dong)})</option>`).join('');
    if (find && keys.length === 1) $('inApt').value = keys[0].k;
  }

  const clear = () => { shapes.forEach(x => x.remove()); shapes = []; };
  const meters = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + 'km' : Math.round(m) + 'm');

  async function run() {
    const code = $('inSgg').value, key = $('inApt').value;
    if (!key) return U.toast('단지를 고르세요.');
    const fail = (html) => { $('inBody').hidden = true; $('inEmpty').hidden = false; $('inEmpty').innerHTML = html; };
    if (!KMap.ready()) return fail(KMap.needKeyHtml);
    const reg = regions.find(r => r[0] === code);
    const r = { code, key, sido: reg[1], sgg: reg[2], ...Data.parseKey(key) };
    const btn = $('btnInfra'), my = ++seq;
    btn.disabled = true; btn.textContent = '분석 중…';
    try {
      await KMap.load();
      const pos = await KMap.geocode(r);
      if (!pos) return fail('단지 위치를 찾지 못했습니다.');
      $('inEmpty').hidden = true; $('inBody').hidden = false;
      $('inTitle').textContent = `${r.sgg} ${r.dong} ${r.name}` + (pos.exact ? '' : ' (동 중심 위치)');
      if (!map) {
        map = KMap.create($('inMap'), pos, 5);
        kakao.maps.event.addListener(map, 'click', (e) => road({ lat: e.latLng.getLat(), lng: e.latLng.getLng() }));
        rv = new kakao.maps.Roadview($('inRoad'));
        rvClient = new kakao.maps.RoadviewClient();
      }
      cur = { r, pos, infra: [], school: null };
      road(pos);

      // ① 인프라: 항목마다 500m·1km 두 번 검색
      const rows = [];
      for (const it of CONFIG.INFRA) {
        const [a, b] = await Promise.all([KMap.category(it.code, pos, 500), KMap.category(it.code, pos, 1000)]);
        rows.push({ ...it, n500: a.count, n1000: b.count, list: b.list });
      }
      if (my !== seq) return;
      cur.infra = rows;
      $('inScore').innerHTML = rows.map(x => `<div class="card"><div class="k">${x.icon} ${x.name}</div><div class="v">${x.n500}<small>/ 500m</small> · ${x.n1000}<small>/ 1km</small></div>` +
        `<div class="s">${x.list[0] ? `${U.esc(x.list[0].place_name)} ${meters(+x.list[0].distance)}` : '1km 안에 없음'}</div></div>`).join('');
      $('inTable').innerHTML = '<thead><tr><th class="l">항목</th><th>500m 안</th><th>1km 안</th><th class="l">가까운 곳 (직선거리)</th></tr></thead><tbody>' +
        rows.map(x => `<tr><td class="l">${x.icon} ${x.name}</td><td>${x.n500}개</td><td>${x.n1000}개</td><td class="l">${x.list.slice(0, 4).map(p => `${U.esc(p.place_name)} ${meters(+p.distance)}`).join(' · ') || '-'}</td></tr>`).join('') + '</tbody>';

      // ② 업무지구
      const hubs = CONFIG.HUBS.map(h => ({ ...h, km: KMap.km(pos, h) }));
      const near = hubs.reduce((a, b) => (b.km < a.km ? b : a));
      $('inHubs').innerHTML = hubs.map(h => `<div class="card"><div class="k"><span style="color:${h.color}">●</span> ${U.esc(h.name)}</div><div class="v">${h.km.toFixed(1)}km</div><div class="s">${h === near ? '<b class="up">가장 가까운 업무지구</b>' : '&nbsp;'}</div></div>`).join('');
      cur.hubs = hubs;

      // ④ 가장 가까운 초등학교
      const schools = (await KMap.keyword('초등학교', pos, 2000)).filter(p => /초등학교$/.test(p.place_name));
      if (my !== seq) return;
      const sc = schools[0];
      cur.school = sc ? { name: sc.place_name, lat: +sc.y, lng: +sc.x, m: +sc.distance || KMap.km(pos, { lat: +sc.y, lng: +sc.x }) * 1000 } : null;
      $('inSchool').innerHTML = cur.school
        ? `<div class="card"><div class="k">가장 가까운 초등학교</div><div class="v">${U.esc(cur.school.name)}</div><div class="s">직선 ${meters(cur.school.m)} · 걸어서 약 ${Math.max(1, Math.round(cur.school.m * 1.3 / 67))}분 (추정)</div></div>` +
          `<div class="card"><div class="k">통학로 확인</div><div class="s" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px"><button class="mini" data-rv="apt">단지 쪽 로드뷰</button><button class="mini" data-rv="mid">중간 지점 로드뷰</button><button class="mini" data-rv="school">학교 쪽 로드뷰</button></div></div>`
        : '<div class="card"><div class="k">가장 가까운 초등학교</div><div class="v">-</div><div class="s">2km 안에서 찾지 못했습니다.</div></div>';
      $('inSchool').onclick = (e) => {
        const v = e.target.dataset.rv, s = cur.school;
        if (!v || !s) return;
        view('school');
        road(v === 'apt' ? pos : v === 'school' ? s : { lat: (pos.lat + s.lat) / 2, lng: (pos.lng + s.lng) / 2 });
      };
      view('infra');
    } catch (e) {
      console.error(e); fail(U.esc(e.message || String(e)));
    } finally {
      btn.disabled = false; btn.textContent = '분석하기';
    }
  }

  /** 지도에 그릴 내용 바꾸기: infra | hubs | school */
  function view(name) {
    if (!map || !cur) return;
    document.querySelectorAll('#inView button').forEach(b => b.classList.toggle('on', b.dataset.v === name));
    clear();
    const { pos, r } = cur;
    map.relayout();
    shapes.push(KMap.dot(map, pos, r.name, '#ff3b30'));
    if (name === 'infra') {
      shapes.push(KMap.circle(map, pos, 1000, '#4f9cff', 0.05), KMap.circle(map, pos, 500, '#ff3b30', 0.08));
      const colors = { SW8: '#34c759', SC4: '#ffcc00', MT1: '#af52de', HP8: '#5ac8fa', AC5: '#8e8e93' };
      for (const x of cur.infra) for (const p of x.list.slice(0, x.code === 'SW8' || x.code === 'SC4' || x.code === 'MT1' ? 8 : 0)) {
        shapes.push(KMap.dot(map, { lat: +p.y, lng: +p.x }, `${x.icon} ${p.place_name}`, colors[x.code] || '#888'));
      }
      const d = 0.0105;   // 약 1.1km 범위가 보이게
      KMap.fit(map, [{ lat: pos.lat + d, lng: pos.lng }, { lat: pos.lat - d, lng: pos.lng }, { lat: pos.lat, lng: pos.lng + d * 1.25 }, { lat: pos.lat, lng: pos.lng - d * 1.25 }]);
    }
    if (name === 'hubs') {
      for (const h of cur.hubs) {
        shapes.push(KMap.dot(map, h, h.name, h.color), KMap.line(map, pos, h, h.color), KMap.circle(map, h, 5000, h.color, 0.04), KMap.circle(map, h, 10000, h.color, 0.02));
      }
      KMap.fit(map, [pos, ...cur.hubs]);
    }
    if (name === 'school') {
      if (!cur.school) { U.toast('가까운 초등학교를 찾지 못했습니다.'); return; }
      const s = cur.school;
      shapes.push(KMap.dot(map, s, '🏫 ' + s.name, '#ffcc00'), KMap.line(map, pos, s, '#ffcc00', `직선 ${meters(s.m)}`));
      KMap.fit(map, [pos, s]);
    }
  }

  /** ③ 로드뷰를 그 위치로 */
  function road(p) {
    const msg = $('inRoadMsg');
    rvClient.getNearestPanoId(KMap.LL(p), 100, (panoId) => {
      if (panoId == null) { msg.hidden = false; msg.textContent = '이 위치 근처(100m)에는 로드뷰가 없습니다. 지도에서 큰길 쪽을 눌러 보세요.'; return; }
      msg.hidden = true;
      rv.setPanoId(panoId, KMap.LL(p));
    });
  }

  return { init };
})();
