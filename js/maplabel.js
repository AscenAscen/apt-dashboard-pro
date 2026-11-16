/* ─────────────────────────────────────────────────────────
   maplabel.js — 지도 라벨(말풍선) 제어. [시세지도]·[랜드마크] 두 지도가 함께 씁니다.
   · 자동 배치: 단지가 몰린 곳은 라벨이 서로·점과 겹치지 않게 상하좌우로 밀어서 놓고, 멀어지면 가는 연결선을 긋습니다.
   · [라벨 편집 모드]: 라벨을 마우스·손가락으로 끌어 옮김 → 위치가 저장됨. 라벨을 눌러 개별 크기·글자 크기도 조정.
   · 라벨 크기(배율)·글자 크기(px) 슬라이더, [📷 깔끔하게 캡처 모드] (버튼·검색창·탭을 숨기고 지도와 라벨만 남김)
   저장: apt.mapLabel.v1 — 라벨이 점에서 얼마나 떨어졌는지(도 단위 차이)만 저장하고 단지 좌표는 저장하지 않습니다.
   ───────────────────────────────────────────────────────── */
const MapLabel = (() => {
  const KEY = 'apt.mapLabel.v1';
  const DEF = { s: 1, f: 12, ff: '', ds: '', ic: 0, bd: 0 };
  // 라벨 프리셋 — 크기·글자·모양·아이콘을 한 번에 바꿈
  const PRESETS = [{ k: '', name: '(프리셋 고르기)' }, { k: 'report', name: '보고서용 (깔끔·중간 크기)', v: { s: 1.1, f: 14, ds: '', ff: 'pretendard', ic: 0, bd: 1 } },
    { k: 'field', name: '임장용 (크고 진하게·상태 아이콘)', v: { s: 1.3, f: 17, ds: 'fill', ff: '', ic: 1, bd: 1 } }, { k: 'simple', name: '간단히 (작은 글자만)', v: { s: 0.8, f: 11, ds: 'text', ff: '', ic: 0, bd: 0 } }];
  // 글씨체 (무료 글꼴. 고르는 순간에만 인터넷에서 내려받습니다) — 줄을 추가하면 목록에 나옵니다
  const FONTS = [
    { k: '', name: '기본 글씨', fam: 'system-ui, sans-serif' },
    { k: 'pretendard', name: 'Pretendard (프리텐다드)', fam: "'Pretendard', system-ui, sans-serif", css: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css' },
    { k: 'noto', name: 'Noto Sans KR (노토산스)', fam: "'Noto Sans KR', sans-serif", css: 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@500;700&display=swap' },
    { k: 'nanum', name: '나눔고딕', fam: "'Nanum Gothic', sans-serif", css: 'https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@700;800&display=swap' },
    { k: 'gowun', name: '고운돋움', fam: "'Gowun Dodum', sans-serif", css: 'https://fonts.googleapis.com/css2?family=Gowun+Dodum&display=swap' },
    { k: 'dohyeon', name: '도현 (굵은 제목체)', fam: "'Do Hyeon', sans-serif", css: 'https://fonts.googleapis.com/css2?family=Do+Hyeon&display=swap' },
  ];
  // 라벨 모양 — 색·모서리는 css/style.css 의 .mllabel.ds-… 에서 바꿉니다
  const DESIGNS = [{ k: '', name: '기본 (흰 바탕 + 색 띠)' }, { k: 'dark', name: '진한 바탕' }, { k: 'fill', name: '색 채움' }, { k: 'pill', name: '둥근 알약' }, { k: 'line', name: '테두리만' }, { k: 'text', name: '글자만 (상자 없음)' }];
  const loaded = new Set();
  function useFont(k) {
    const f = FONTS.find(x => x.k === k) || FONTS[0];
    if (f.css && !loaded.has(f.k)) { loaded.add(f.k); const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = f.css; document.head.appendChild(l); }
    return f.fam;
  }
  const LINE_GAP = 20;            // 점에서 라벨 가장자리까지 이만큼(px) 넘게 멀어지면 연결선을 긋습니다
  const rd = () => Store.get(KEY, {});
  const wr = (o) => Store.set(KEY, o);

  /* ═══ 순수 계산 (화면 없이도 시험할 수 있게 따로 둠) ═══ */
  const box = (cx, cy, w, h) => ({ l: cx - w / 2, t: cy - h / 2, r: cx + w / 2, b: cy + h / 2 });
  const overlap = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
  const rectGap = (b, x, y) => Math.hypot(Math.max(b.l - x, 0, x - b.r), Math.max(b.t - y, 0, y - b.b));
  /** 라벨 중심 → 점 방향으로 그은 선이 라벨 테두리와 만나는 곳 */
  function edgePoint(cx, cy, w, h, x, y) {
    const dx = x - cx, dy = y - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const k = Math.min(1, Math.min(dx ? (w / 2) / Math.abs(dx) : Infinity, dy ? (h / 2) / Math.abs(dy) : Infinity));
    return { x: cx + dx * k, y: cy + dy * k };
  }
  /**
   * 라벨 자리 정하기.
   * items = [{ id, x, y, w, h, fx?, fy?, order? }]  — x,y = 점의 화면 위치, w,h = 라벨 크기, fx,fy = 손으로 옮겨 둔 라벨 중심(있으면 그대로)
   * 돌려주는 값: Map(id → { x, y, line, manual })  — x,y = 라벨 중심, line = 연결선이 필요한지
   */
  function layout(items, dotR = 8) {
    const out = new Map(), placed = [];
    const dots = items.map(it => ({ id: it.id, b: box(it.x, it.y, dotR * 2, dotR * 2) }));
    const gapOf = (it, x, y) => rectGap(box(x, y, it.w, it.h), it.x, it.y);
    for (const it of items) if (it.fx != null) {
      placed.push(box(it.fx, it.fy, it.w, it.h));
      out.set(it.id, { x: it.fx, y: it.fy, line: gapOf(it, it.fx, it.fy) > LINE_GAP, manual: true });
    }
    const rest = items.filter(it => it.fx == null).sort((a, b) => ((a.order || 0) - (b.order || 0)) || (a.y - b.y) || (a.x - b.x));
    for (const it of rest) {
      const cands = [], g = 4;
      for (let k = 0; k < 5; k++) {
        const dx = dotR + g + it.w / 2 + k * (it.w * 0.2 + it.h * 0.8), dy = dotR + g + it.h / 2 + k * (it.h + 5);
        cands.push([dx, 0], [-dx, 0], [0, -dy], [0, dy], [dx * 0.85, -dy], [dx * 0.85, dy], [-dx * 0.85, -dy], [-dx * 0.85, dy]);
      }
      let best = null;
      for (let i = 0; i < cands.length; i++) {
        const cx = it.x + cands[i][0], cy = it.y + cands[i][1], b = box(cx, cy, it.w, it.h);
        let score = 0;
        for (const p of placed) score += overlap(b, p);
        for (const d of dots) if (d.id !== it.id) score += overlap(b, d.b) * 2;
        score += overlap(b, dots.find(d => d.id === it.id).b) * 4;
        score += i * 0.01;                                  // 같으면 앞 순서(오른쪽 → 왼쪽 → 위 → 아래) 우선
        if (!best || score < best.score) best = { score, cx, cy };
        if (score < 0.05) break;                            // 겹침 없음 → 바로 채택
      }
      placed.push(box(best.cx, best.cy, it.w, it.h));
      out.set(it.id, { x: best.cx, y: best.cy, line: gapOf(it, best.cx, best.cy) > LINE_GAP, manual: false });
    }
    return out;
  }

  /* ═══ 지도에 붙이는 부분 ═══ */
  /**
   * create({ key, map, panel, ctl, onPick })
   *   key   저장 이름 구분 ('land' | 'map')   map 카카오 지도   panel 지도를 담은 패널(캡처 모드에서 전체 화면이 됨)
   *   ctl   조절 막대를 넣을 빈 상자          onPick(item) 라벨·점을 눌렀을 때
   * 돌려주는 값: { set(items), relayout(), setCapture(on) }   items = [{ id, pos:{lat,lng}, text, color, rank, data }]
   */
  function create(o) {
    const { key, map, panel, ctl } = o, LL = KMap.LL;
    const rows = new Map();
    let edit = false, sel = null, cap = false, timer = null, drag = null, adding = false, fade = null;
    const gKey = `${key}:_g`, iKey = (id) => `${key}:${id}`;
    const G = () => ({ ...DEF, ...(rd()[gKey] || {}) });
    const I = (id) => rd()[iKey(id)] || {};
    const setG = (patch) => { const a = rd(); a[gKey] = { ...(a[gKey] || {}), ...patch }; wr(a); };
    function setI(id, patch, del = []) {
      const a = rd(), cur = { ...(a[iKey(id)] || {}), ...patch };
      del.forEach(k => delete cur[k]);
      if (Object.keys(cur).length) a[iKey(id)] = cur; else delete a[iKey(id)];
      wr(a);
    }
    const eff = (id) => { const g = G(), i = I(id); return { s: i.s ?? g.s, f: i.f ?? g.f }; };

    /* ── 조절 막대 ── */
    ctl.classList.add('mlctl');
    ctl.innerHTML = `<label class="inline"><input type="checkbox" data-ml="edit"> 라벨 편집 모드</label>
      <label class="inline">라벨 크기 <input type="range" min="50" max="200" step="5" data-ml="scale"> <b data-ml-v="scale"></b></label>
      <label class="inline">글자 크기 <input type="range" min="8" max="28" step="1" data-ml="font"> <b data-ml-v="font"></b></label>
      <label class="inline">글씨체 <select data-ml="ff">${FONTS.map(f => `<option value="${f.k}">${f.name}</option>`).join('')}</select></label>
      <label class="inline">라벨 모양 <select data-ml="ds">${DESIGNS.map(d => `<option value="${d.k}">${d.name}</option>`).join('')}</select></label>
      <label class="inline">프리셋 <select data-ml="preset">${PRESETS.map(p => `<option value="${p.k}">${p.name}</option>`).join('')}</select></label>
      <label class="inline"><input type="checkbox" data-ml="ic"> 상태 아이콘</label>
      <label class="inline"><input type="checkbox" data-ml="bd"> 하락률 뱃지</label>
      ${o.onAdd ? '<button data-ml="add" title="누른 뒤 지도의 원하는 곳을 한 번 누르면 메모 라벨이 생깁니다">＋ 라벨 추가</button>' : ''}
      <button data-ml="unhide" title="숨긴 라벨을 모두 다시 보이게 합니다">숨긴 라벨 보이기</button>
      <button data-ml="reset" title="손으로 옮긴 라벨을 모두 자동 배치로 되돌립니다">위치 초기화</button>
      <button data-ml="capture" title="버튼·검색창·탭을 숨기고 지도와 라벨만 남깁니다. 끝낼 때는 왼쪽 위 ✕ 또는 Esc">📷 깔끔하게 캡처 모드</button>
      <div class="mlpop" hidden>
        <b data-ml-v="name"></b>
        <label class="inline">이 라벨 크기 <input type="range" min="50" max="250" step="5" data-ml="iscale"> <b data-ml-v="iscale"></b></label>
        <label class="inline">이 라벨 글자 <input type="range" min="8" max="32" step="1" data-ml="ifont"> <b data-ml-v="ifont"></b></label>
        <label class="inline">글자 <input type="text" data-ml="itext" style="width:190px" placeholder="비우면 자동 글자"></label>
        <label class="inline">색 <input type="color" data-ml="icolor"></label>
        <button class="mini" data-ml="ipos">이 라벨 위치 초기화</button>
        <button class="mini danger" data-ml="idel">이 라벨 삭제(숨김)</button>
        <button class="mini" data-ml="iclear">개별 설정 지우기</button>
        <button class="mini" data-ml="iclose">닫기</button>
      </div>
      <p class="hint" data-ml-v="hint" style="margin:6px 0 0" hidden>라벨을 끌어서 옮기세요. 옮기면 점과 라벨 사이에 연결선이 생깁니다. 라벨을 한 번 누르면 그 라벨만 크기를 따로 조정할 수 있습니다.</p>`;
    const q = (k) => ctl.querySelector(`[data-ml="${k}"]`), v = (k) => ctl.querySelector(`[data-ml-v="${k}"]`);
    const exitBtn = document.createElement('button');
    exitBtn.className = 'ml-exit'; exitBtn.textContent = '← 돌아가기'; exitBtn.title = '캡처 모드 끝내기 (Esc 키 또는 뒤로 가기)';
    panel.appendChild(exitBtn);

    function syncCtl() {
      const g = G();
      q('scale').value = Math.round(g.s * 100); v('scale').textContent = Math.round(g.s * 100) + '%';
      q('font').value = g.f; v('font').textContent = g.f + 'px';
      q('ff').value = g.ff || ''; q('ds').value = g.ds || ''; q('ic').checked = !!g.ic; q('bd').checked = !!g.bd; q('preset').value = '';
      q('edit').checked = edit; v('hint').hidden = !edit;
      if (q('add')) q('add').classList.toggle('on', adding);
      const pop = ctl.querySelector('.mlpop'), r = sel && rows.get(sel);
      pop.hidden = !(edit && r);
      if (edit && r) {
        const e = eff(sel);
        v('name').textContent = r.item.text; q('iscale').value = Math.round(e.s * 100); v('iscale').textContent = Math.round(e.s * 100) + '%';
        q('ifont').value = e.f; v('ifont').textContent = e.f + 'px';
        if (document.activeElement !== q('itext')) q('itext').value = I(sel).t || '';
        q('icolor').value = /^#[0-9a-f]{6}$/i.test(I(sel).c || r.item.color || '') ? (I(sel).c || r.item.color) : '#ff3b30';
        q('idel').textContent = r.item.user ? '이 라벨 삭제' : '이 라벨 숨기기';
      }
    }

    /* ── 라벨 한 줄 만들기 ── */
    function build(item) {
      const dotEl = document.createElement('div'); dotEl.className = 'mldot'; dotEl.style.background = item.color || '#ff3b30';
      const el = document.createElement('div'); el.className = 'mllabel'; el.textContent = item.text; el.style.borderLeftColor = item.color || '#ff3b30';
      const dotOv = new kakao.maps.CustomOverlay({ position: LL(item.pos), content: dotEl, xAnchor: 0.5, yAnchor: 0.5, zIndex: 6, clickable: true });
      const lblOv = new kakao.maps.CustomOverlay({ position: LL(item.pos), content: el, xAnchor: 0.5, yAnchor: 0.5, zIndex: 7, clickable: true });
      const line = new kakao.maps.Polyline({ path: [LL(item.pos), LL(item.pos)], strokeWeight: 1.5, strokeColor: item.color || '#ff3b30', strokeOpacity: 0.9 });
      dotOv.setMap(map); lblOv.setMap(map);
      const row = { item, dotEl, el, dotOv, lblOv, line, shown: true, lineOn: false };
      // 지도가 끌려가지 않게 이벤트를 여기서 끊음
      ['mousedown', 'touchstart', 'pointerdown'].forEach(t => { el.addEventListener(t, (e) => e.stopPropagation()); dotEl.addEventListener(t, (e) => e.stopPropagation()); });
      dotEl.addEventListener('click', () => { if (!edit && o.onPick) o.onPick(item); });
      el.addEventListener('pointerdown', (e) => onDown(e, row));
      el.addEventListener('pointermove', (e) => onMove(e, row));
      el.addEventListener('pointerup', (e) => onUp(e, row));
      el.addEventListener('pointercancel', (e) => onUp(e, row, true));
      return row;
    }
    function style(row) {
      const e = eff(row.item.id);
      const g = G(), i = I(row.item.id), col = i.c || row.item.color || '#ff3b30';
      row.el.style.fontSize = e.f + 'px'; row.el.style.transform = `scale(${e.s})`;
      row.el.style.fontFamily = useFont(g.ff || '');
      row.el.className = 'mllabel' + (g.ds ? ' ds-' + g.ds : '');
      row.el.textContent = (g.ic && row.item.icon && !i.t ? row.item.icon + ' ' : '') + (i.t || row.item.text);
      if (g.bd && row.item.badge && !i.t) { const b = document.createElement('span'); b.className = 'mlbadge'; b.textContent = row.item.badge; row.el.appendChild(b); }
      row.el.style.borderLeftColor = row.el.style.borderColor = ''; row.el.style.background = row.el.style.color = '';
      if (g.ds === 'fill') { row.el.style.background = col; row.el.style.borderColor = col; }
      else if (g.ds === 'line' || g.ds === 'pill') row.el.style.borderColor = col;
      else if (g.ds === 'text') row.el.style.color = col;
      else row.el.style.borderLeftColor = col;
      row.dotEl.style.background = col; row.line.setOptions({ strokeColor: col });
      row.el.classList.toggle('hid', !!i.hide);
      row.dotEl.style.width = row.dotEl.style.height = Math.round(12 * e.s) + 'px';
      row.el.classList.toggle('edit', edit); row.el.classList.toggle('sel', edit && sel === row.item.id);
    }

    /* ── 끌어 옮기기 ── */
    const rel = (e) => { const r = map.getNode().getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    function onDown(e, row) {
      if (!edit) { if (o.onPick) o.onPick(row.item); return; }
      e.preventDefault();
      row.el.setPointerCapture(e.pointerId);
      const proj = map.getProjection(), c = proj.containerPointFromCoords(row.lblOv.getPosition()), p = rel(e);
      drag = { id: row.item.id, offX: p.x - c.x, offY: p.y - c.y, sx: p.x, sy: p.y, moved: false };
    }
    function onMove(e, row) {
      if (!drag || drag.id !== row.item.id) return;
      const p = rel(e);
      if (!drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) < 4) return;
      drag.moved = true;
      const proj = map.getProjection(), pt = new kakao.maps.Point(p.x - drag.offX, p.y - drag.offY);
      row.lblOv.setPosition(proj.coordsFromContainerPoint(pt));
      drag.last = pt;
      drawLine(row, pt.x, pt.y);
    }
    function onUp(e, row, cancelled) {
      if (!drag || drag.id !== row.item.id) return;
      const d = drag; drag = null;
      if (cancelled) { relayout(); return; }
      if (!d.moved) { sel = row.item.id; for (const r of rows.values()) style(r); syncCtl(); return; }   // 끌지 않고 눌렀다 뗌 → 선택
      const proj = map.getProjection(), ll = proj.coordsFromContainerPoint(d.last);
      setI(row.item.id, { dy: +(ll.getLat() - row.item.pos.lat).toFixed(7), dx: +(ll.getLng() - row.item.pos.lng).toFixed(7) });
      sel = row.item.id; relayout(); syncCtl();
    }
    /** 점 → 라벨 가장자리 연결선 그리기 (라벨 중심 cx,cy 는 화면 좌표) */
    function drawLine(row, cx, cy) {
      const proj = map.getProjection(), e = eff(row.item.id), w = (row.el.offsetWidth || 60) * e.s, h = (row.el.offsetHeight || 20) * e.s;
      const dot = proj.containerPointFromCoords(LL(row.item.pos));
      if (rectGap(box(cx, cy, w, h), dot.x, dot.y) <= LINE_GAP) { if (row.lineOn) { row.line.setMap(null); row.lineOn = false; } return; }
      const ep = edgePoint(cx, cy, w, h, dot.x, dot.y);
      row.line.setPath([LL(row.item.pos), proj.coordsFromContainerPoint(new kakao.maps.Point(ep.x, ep.y))]);
      if (!row.lineOn) { row.line.setMap(map); row.lineOn = true; }
    }

    /* ── 전체 다시 배치 ── */
    function relayout() {
      if (!rows.size || drag) return;
      const proj = map.getProjection(), lv = map.getLevel(), list = [], vis = new Set();
      let unmeasured = false;
      for (const row of rows.values()) {
        const it = row.item, rank = it.rank || 0;
        const hid = !!I(it.id).hide;                                                  // 숨긴 라벨: 편집 모드에서만 흐리게 보임
        const show = hid ? edit : (edit || !(rank >= 1 && lv >= 10) && !(rank >= 2 && lv >= 8));      // 멀리 보면 낮은 등급 이름표는 숨김
        if (row.dotShown !== (!hid || edit)) { row.dotShown = !hid || edit; row.dotOv.setMap(row.dotShown ? map : null); }
        if (show !== row.shown) { row.lblOv.setMap(show ? map : null); row.shown = show; }
        style(row);
        if (!show) { if (row.lineOn) { row.line.setMap(null); row.lineOn = false; } continue; }
        const e = eff(it.id), dot = proj.containerPointFromCoords(LL(it.pos)), m = I(it.id);
        let w = row.el.offsetWidth, h = row.el.offsetHeight;
        if (!w || !h) { unmeasured = true; w = Math.max(40, it.text.length * e.f * 0.95 + 14); h = e.f * 1.3 + 6; }
        const f = m.dy != null ? proj.containerPointFromCoords(LL({ lat: it.pos.lat + m.dy, lng: it.pos.lng + m.dx })) : null;
        list.push({ id: it.id, x: dot.x, y: dot.y, w: w * e.s, h: h * e.s, fx: f ? f.x : null, fy: f ? f.y : null, order: rank });
        vis.add(it.id);
      }
      const out = layout(list, 8);
      for (const [id, p] of out) {
        const row = rows.get(id);
        row.lblOv.setPosition(proj.coordsFromContainerPoint(new kakao.maps.Point(p.x, p.y)));
        if (p.line) drawLine(row, p.x, p.y); else if (row.lineOn) { row.line.setMap(null); row.lineOn = false; }
      }
      if (unmeasured) setTimeout(relayout, 80);
    }
    const queue = () => { clearTimeout(timer); timer = setTimeout(relayout, 30); };
    kakao.maps.event.addListener(map, 'idle', queue);

    /* ── 항목 바꾸기 ── */
    function set(items) {
      for (const r of rows.values()) { r.dotOv.setMap(null); r.lblOv.setMap(null); r.line.setMap(null); }
      rows.clear();
      if (sel && !items.some(x => x.id === sel)) sel = null;
      for (const it of items) rows.set(it.id, build(it));
      syncCtl(); queue();
    }

    /* ── 캡처 모드 ── */
    function setCapture(on) {
      if (cap === on) return;
      cap = on;
      if (on) { edit = false; sel = null; adding = false; }
      // 버튼은 처음 3초 또렷이 보였다가 흐려지고, 화면을 건드리면 다시 또렷해집니다 (캡처 사진에 거의 안 보이게)
      const wake = () => { exitBtn.classList.remove('dim'); clearTimeout(fade); fade = setTimeout(() => exitBtn.classList.add('dim'), 3000); };
      if (on) { wake(); panel._wake = wake; ['pointermove', 'pointerdown', 'touchstart'].forEach(t => panel.addEventListener(t, wake, { passive: true }));
        try { history.pushState({ mlcap: 1 }, ''); } catch (e) { /* 무시 */ } }
      else { clearTimeout(fade); if (panel._wake) ['pointermove', 'pointerdown', 'touchstart'].forEach(t => panel.removeEventListener(t, panel._wake));
        try { if (history.state && history.state.mlcap) history.back(); } catch (e) { /* 무시 */ } }
      const c = map.getCenter();
      document.body.classList.toggle('map-capture', on);
      panel.classList.toggle('ml-capturing', on);
      if (map._zc) { try { on ? map.removeControl(map._zc) : map.addControl(map._zc, kakao.maps.ControlPosition.RIGHT); } catch (e) { /* 무시 */ } }
      for (const r of rows.values()) style(r);
      syncCtl();
      setTimeout(() => { map.relayout(); map.setCenter(c); relayout(); }, 80);
    }
    exitBtn.onclick = () => setCapture(false);
    exitBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cap) setCapture(false); if (e.key === 'Escape' && adding) { adding = false; syncCtl(); } });
    window.addEventListener('popstate', () => { if (cap) setCapture(false); });          // 휴대폰 [뒤로] 버튼으로도 빠져나옴
    kakao.maps.event.addListener(map, 'click', (ev) => {                                 // [＋ 라벨 추가] 뒤 지도를 누르면 그 자리에 메모 라벨
      if (!adding || !o.onAdd) return;
      adding = false; syncCtl();
      o.onAdd({ lat: ev.latLng.getLat(), lng: ev.latLng.getLng() });
    });

    /* ── 조절 막대 동작 ── */
    ctl.addEventListener('input', (e) => {
      const k = e.target.dataset.ml; if (!k) return;
      const n = +e.target.value;
      if (k === 'scale') setG({ s: n / 100 }); else if (k === 'font') setG({ f: n });
      else if (sel && k === 'iscale') setI(sel, { s: n / 100 }); else if (sel && k === 'ifont') setI(sel, { f: n });
      else if (sel && k === 'itext') { const t = e.target.value.trim(); if (t) setI(sel, { t }); else setI(sel, {}, ['t']); if (o.onEdit) o.onEdit(sel, { t }); }
      else if (sel && k === 'icolor') { setI(sel, { c: e.target.value }); }
      else return;
      for (const r of rows.values()) style(r);        // 슬라이더를 움직이는 즉시 모양을 바꾸고, 위치는 잠시 뒤 다시 계산
      syncCtl(); queue();
    });
    ctl.addEventListener('change', (e) => {
      const k = e.target.dataset.ml;
      if (k === 'preset') { const pr = PRESETS.find(x => x.k === e.target.value); if (pr && pr.v) { setG(pr.v); for (const r of rows.values()) style(r); syncCtl(); queue(); setTimeout(relayout, 900); } return; }
      if (k === 'ic' || k === 'bd') { setG({ [k]: e.target.checked ? 1 : 0 }); for (const r of rows.values()) style(r); queue(); return; }
      if (k === 'ff' || k === 'ds') { setG({ [k]: e.target.value }); for (const r of rows.values()) style(r); queue();
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => setTimeout(relayout, 60)); setTimeout(relayout, 900); }
    });
    ctl.addEventListener('change', (e) => { if (e.target.dataset.ml === 'edit') { edit = e.target.checked; if (!edit) sel = null; for (const r of rows.values()) style(r); syncCtl(); relayout(); } });
    ctl.addEventListener('click', (e) => {
      const k = e.target.dataset.ml; if (!k) return;
      if (k === 'capture') setCapture(true);
      if (k === 'add') { adding = !adding; syncCtl(); if (adding) U.toast('지도에서 라벨을 놓을 곳을 한 번 누르세요. (취소: Esc)'); }
      if (k === 'unhide') { const a = rd(); let n = 0; Object.keys(a).filter(x => x.startsWith(key + ':')).forEach(x => { if (a[x].hide) { delete a[x].hide; n++; if (!Object.keys(a[x]).length) delete a[x]; } }); wr(a); relayout(); U.toast(n ? `숨긴 라벨 ${n}개를 다시 보이게 했습니다.` : '숨긴 라벨이 없습니다.'); }
      if (sel && k === 'idel') {
        const r = rows.get(sel);
        if (r && r.item.user) { if (!confirm('이 메모 라벨을 지울까요?')) return; const id = sel; sel = null; setI(id, {}, ['t', 'c', 's', 'f', 'dy', 'dx', 'hide']); if (o.onDelete) o.onDelete(id); syncCtl(); return; }
        setI(sel, { hide: true }); sel = null; for (const x of rows.values()) style(x); syncCtl(); relayout(); U.toast('라벨을 숨겼습니다. [숨긴 라벨 보이기]로 되살릴 수 있습니다.');
      }
      if (k === 'reset') {
        if (!confirm('손으로 옮긴 라벨 위치를 모두 지우고 자동 배치로 되돌릴까요? (크기 설정은 그대로입니다)')) return;
        const a = rd(); Object.keys(a).filter(x => x.startsWith(key + ':') && !x.endsWith(':_g')).forEach(x => { delete a[x].dy; delete a[x].dx; if (!Object.keys(a[x]).length) delete a[x]; });
        wr(a); relayout();
      }
      if (sel && k === 'ipos') { setI(sel, {}, ['dy', 'dx']); relayout(); }
      if (sel && k === 'iclear') { setI(sel, {}, ['s', 'f']); syncCtl(); relayout(); }
      if (k === 'iclose') { sel = null; for (const r of rows.values()) style(r); syncCtl(); }
    });
    syncCtl();
    return { set, relayout, setCapture };
  }

  return { create, layout, edgePoint, rectGap };
})();
