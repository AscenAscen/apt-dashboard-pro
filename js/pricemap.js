/* ─────────────────────────────────────────────────────────
   pricemap.js — [시세지도] 탭
   시세트래킹에 담은 단지를 카카오맵에 올리고, 라벨에 단지명과 가격(매매·전세·매-전·전세가율)을 보여 줍니다.
   · 가격은 적어 둔 호가가 먼저, 호가가 없는 단지만 최근 실거래로 대신하며 라벨에 '·실' 이 붙습니다(주황색).
   · 라벨 겹침 방지, 끌어서 옮기기, 크기 조절, 캡처 모드는 js/maplabel.js 가 맡습니다.
   · 단지 좌표는 저장하지 않고 열 때마다 다시 찾습니다.
   ───────────────────────────────────────────────────────── */
const PriceMap = (() => {
  const $ = (id) => document.getElementById(id);
  const SKEY = 'apt.pmOpts.v1';
  let map = null, ctrl = null, inited = false, seq = 0;
  let byId = new Map();

  const eok = (v) => (v == null ? '-' : +(v / 10000).toFixed(2) + '억');

  function fillFolders() {
    const folders = Tracking.exportAll().folders || [], cur = $('pmFolder').value || Store.get(SKEY, {}).folder || '';
    $('pmFolder').innerHTML = '<option value="">시세트래킹 전체</option>' + folders.map(f => `<option>${U.esc(f)}</option>`).join('');
    if (folders.includes(cur)) $('pmFolder').value = cur;
  }
  const saveOpts = () => Store.set(SKEY, { folder: $('pmFolder').value, show: $('pmShow').value, name: $('pmName').value });

  /** 라벨에 쓸 글자 */
  function textOf(r, dup) {
    const mode = $('pmShow').value, nm = $('pmName').value;
    const sfx = dup ? ` ${CONFIG.toPyeong(r.g)}평` : '';
    let val = '', real = false;
    if (mode === 's') { val = eok(r.s); real = r.s != null && !r.sQ; }
    else if (mode === 'r') { val = eok(r.r); real = r.r != null && !r.rQ; }
    else if (mode === 'gap') { val = r.gap == null ? '-' : eok(r.gap); real = r.gap != null && !(r.sQ && r.rQ); }
    else if (mode === 'ratio') { val = r.ratio == null ? '-' : r.ratio.toFixed(0) + '%'; real = r.ratio != null && !(r.sQ && r.rQ); }
    if (mode === 'none' || nm === 'name') return { text: r.name + sfx, real: false };
    const tail = val + (real ? '·실' : '');
    return { text: nm === 'val' ? tail : `${r.name}${sfx} ${tail}`, real };
  }

  function card(r) {
    const c = (k, v, s = '', cls = '') => `<div class="card"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="s">${s}</div></div>`;
    const rl = r.rl || {};
    $('pmCard').innerHTML = [
      c('단지', U.esc(r.name), `${U.esc(r.sgg)} ${U.esc(r.dong)} · ${r.g}㎡(${CONFIG.toPyeong(r.g)}평)${r.hh ? ` · ${r.hh.toLocaleString()}세대` : ''}`),
      c('매매', r.s == null ? '-' : U.price(r.s), r.sQ ? `적어 둔 호가 (${Kit.ymText(r.q.ym)})` : (rl.sale ? `최근 실거래 ${U.date(rl.sale.d)}` : ''), 'sale'),
      c('전세', r.r == null ? '-' : U.price(r.r), r.rQ ? '적어 둔 호가' : (rl.rent ? `최근 실거래 ${U.date(rl.rent.d)}` : ''), 'rent'),
      c('전세가율 · 매-전', r.ratio == null ? '-' : r.ratio.toFixed(0) + '%', r.gap == null ? '' : '투자금 ' + U.price(r.gap)),
      c('전고 대비', U.pct(r.drop), rl.peak ? `전고점 ${U.price(rl.peak.price)} (${U.date(rl.peak.d)})` : '', U.cls(r.drop)),
    ].join('') + `<div style="grid-column:1/-1">${typeof Loc !== 'undefined' ? Loc.summary(r) : ''}</div>`;
  }

  async function draw() {
    const my = ++seq, msg = $('pmMapMsg'), folder = $('pmFolder').value;
    const say = (html) => { msg.innerHTML = html; msg.hidden = false; };
    saveOpts();
    let list = await Kit.records(true);
    if (folder) list = list.filter(x => (x.rec.folders || []).includes(folder));
    $('pmEmpty').hidden = list.length > 0; $('pmBody').hidden = !list.length;
    if (!list.length) return;
    if (!KMap.ready()) return say(KMap.needKeyHtml);
    say(`가격을 불러오는 중… (${list.length}개 단지)`);
    await Real.load(list);
    if (my !== seq) return;
    const rows = list.map(My.calc);
    byId = new Map(rows.map(r => [r.id, r]));
    try {
      await KMap.load();
      let n = 0;
      const queue = [...rows];
      await Promise.all(Array.from({ length: 4 }, async () => {       // 4개씩 동시에 위치 찾기
        while (queue.length) { const r = queue.shift(); r.pos = await KMap.geocode(r); if (my !== seq) return; say(`단지 위치를 찾는 중… (${++n}/${rows.length})`); }
      }));
    } catch (e) { return say(U.esc(e.message || String(e))); }
    if (my !== seq) return;
    const ok = rows.filter(r => r.pos);
    if (!ok.length) return say('단지 위치를 찾지 못했습니다.');
    msg.hidden = true;
    if (!map) {
      map = KMap.create($('pmMap'), ok[0].pos, 7);
      ctrl = MapLabel.create({ key: 'map', map, panel: $('pmPanel'), ctl: $('pmCtl'), onPick: (it) => card(byId.get(it.id)) });
    }
    const cnt = new Map(); ok.forEach(r => cnt.set(`${r.code}|${r.key}`, (cnt.get(`${r.code}|${r.key}`) || 0) + 1));
    const items = ok.map(r => {
      const t = textOf(r, cnt.get(`${r.code}|${r.key}`) > 1);
      return { id: r.id, pos: r.pos, text: t.text, color: t.real ? '#f5a742' : '#4f9cff', rank: 0 };
    });
    map.relayout();
    ctrl.set(items);
    if (ok.length > 1) KMap.fit(map, ok.map(r => r.pos)); else { map.setCenter(KMap.LL(ok[0].pos)); map.setLevel(5); }
    $('pmCount').textContent = `${ok.length}개 단지` + (ok.length < rows.length ? ` (위치를 못 찾은 ${rows.length - ok.length}개 제외)` : '');
    if (!$('pmCard').innerHTML) card(ok[0]);
  }

  function init() {
    const o = Store.get(SKEY, {});
    if (o.show) $('pmShow').value = o.show;
    if (o.name) $('pmName').value = o.name;
    $('pmFolder').onchange = draw;
    $('pmShow').onchange = $('pmName').onchange = () => { saveOpts(); if (map) draw(); };
    $('btnPmRefresh').onclick = draw;
    inited = true;
  }
  function open() { if (!inited) return; fillFolders(); draw(); }
  return { init, open };
})();
