/* ─────────────────────────────────────────────────────────
   autosync.js — 자동 동기화 (PC ↔ 휴대폰): 시세트래킹 + 앞마당 기록 + 지도 라벨(설정·짧은 이름·숨김·강조)
   · 저장소·토큰은 기존 [올리기/내려받기] 동기화(js/sync.js)와 같은 값을 씀 (나만 보는 비공개 GitHub 저장소)
   · 파일: 그 저장소의 sync/apt-autosync.json  (기존 전체 백업 파일 sync/apt-backup.json 과 따로)
   · 열 때 · 다른 앱 보다가 돌아올 때 · 5분마다 → 받아서 합침 / 고치면 30초 뒤 → 받아서 합친 뒤 올림
   · 합치는 방법: 지난번 동기화 때의 기록(기준)과 비교해서, 바뀐 쪽 값을 씀 → 한쪽에서 지운 단지는 다른 쪽에서도 지워짐
     두 기기가 같은 칸을 고쳤으면 나중에 동기화한 쪽 값이 남음 (처음 연결할 때만 저장소 쪽 값 우선)
   · 휴대폰 연결: PC 에서 QR 을 띄우고 휴대폰 카메라로 찍으면 저장소·토큰이 자동으로 들어감
   이 기기에만 저장 (백업 파일에 안 들어감): autosync.cfg (켜기/끄기), autosync.base (지난번 동기화 기준)
   ───────────────────────────────────────────────────────── */
const AutoSync = (() => {
  const $ = (id) => document.getElementById(id);
  const CFG = 'autosync.cfg', BASE = 'autosync.base', PATH = 'sync/apt-autosync.json', GH = 'apt.sync.v1';
  const TRK = ['apt.tracking.v1', 'apt.folders.v1', 'apt.trkMonths.v1', 'apt.survey.v1'];     // 시세트래킹이 한꺼번에 저장하는 값
  const TRK_ETC = ['apt.trkPins.v1'];                                                          // 고정한 폴더
  const YARD = ['apt.yard.v1', 'apt.yardSurveys.v1', 'apt.yardPicks.v1', 'apt.yardOpts.v1'];   // 앞마당
  const LBL = ['apt.labels.v1', 'apt.labelEdits.v1', 'apt.labelPresets.v1'];                  // 지도 라벨 설정·짧은 이름·숨김·강조 (js/labelkit.js)
  const KEYS = [...TRK, ...TRK_ETC, ...YARD, ...LBL];
  const DELAY = 30000, POLL = 10000, REMOTE_EVERY = 5 * 60000, MIN_GAP = 15000;
  let cfg = { on: 1, last: 0 }, busy = false, again = false, lastTry = 0, err = '', dirtyTimer = null, retryTimer = null, localHash = '', inited = false;

  const gh = () => Store.get(GH, { repo: '', token: '', path: 'sync/apt-backup.json' }) || {};
  const ready = () => { const c = gh(); return !!(c.repo && c.token); };
  const saveCfg = () => Store.set(CFG, cfg);

  /* ── 글자 ↔ base64 (한글 안전) ── */
  function b64(str) { const bytes = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s), ch => ch.charCodeAt(0)));
  const b64url = (str) => b64(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64url = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return unb64(s); };

  /* ── 비교 · 합치기 ── */
  function stable(v) {
    if (v === undefined) return '~';
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v);
  }
  const same = (a, b) => stable(a) === stable(b);
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const isIdArr = (a) => a.every(x => isObj(x) && x.id != null);
  const isPrimArr = (a) => a.every(x => x == null || typeof x !== 'object');
  /** 세 갈래 합치기: b = 지난번 기준, l = 이 기기, r = 저장소. preferRemote = 둘 다 고쳤을 때 저장소 값 */
  function m3(b, l, r, pr, d = 0) {
    const sl = stable(l), sr = stable(r);
    if (sl === sr) return l;
    const sb = stable(b);
    if (sl === sb) return r;                       // 이 기기는 그대로 → 저장소 쪽 변경 (지운 것 포함)
    if (sr === sb) return l;                       // 저장소는 그대로 → 이 기기 변경
    if (l === undefined) return r;                 // 한쪽은 지우고 한쪽은 고침 → 고친 쪽을 살림
    if (r === undefined) return l;
    if (Array.isArray(l) && Array.isArray(r)) {
      const ba = Array.isArray(b) ? b : [];
      if (isIdArr(l) && isIdArr(r)) return byId(ba, l, r, pr, d);
      if (isPrimArr(l) && isPrimArr(r)) return asSet(ba, l, r);
      return pr ? r : l;
    }
    if (isObj(l) && isObj(r) && d < 6) {
      const bo = isObj(b) ? b : {}, out = {};
      for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) { const v = m3(bo[k], l[k], r[k], pr, d + 1); if (v !== undefined) out[k] = v; }
      return out;
    }
    return pr ? r : l;
  }
  function byId(b, l, r, pr, d) {
    const bm = new Map(b.filter(isObj).map(x => [x.id, x])), lm = new Map(l.map(x => [x.id, x])), rm = new Map(r.map(x => [x.id, x]));
    const ids = [...l.map(x => x.id), ...r.map(x => x.id).filter(id => !lm.has(id))], out = [];
    for (const id of ids) { const v = m3(bm.get(id), lm.get(id), rm.get(id), pr, d + 1); if (v !== undefined) out.push(v); }
    return out;
  }
  function asSet(b, l, r) {
    const k = stable, bs = new Set(b.map(k)), ls = new Set(l.map(k)), rs = new Set(r.map(k));
    const out = l.filter(x => !(bs.has(k(x)) && !rs.has(k(x))));            // 저장소에서 지운 것 빼기
    r.forEach(x => { if (!bs.has(k(x)) && !ls.has(k(x))) out.push(x); });   // 저장소에서 새로 생긴 것 더하기
    return out;
  }

  /* ── 이 기기 기록 읽기 · 바꾸기 ── */
  function readLocal() { const o = {}; KEYS.forEach(k => { const v = Store.get(k, undefined); if (v !== undefined && v !== null) o[k] = v; }); return o; }
  function editing() {
    const a = document.activeElement;
    return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !!a.closest('#tab-tracking, #tab-yard, #tab-survey');
  }
  function applyLocal(m) {
    const cur = readLocal(), chg = (keys) => keys.some(k => !same(m[k], cur[k]));
    const put = (k) => { if (m[k] === undefined) Store.remove(k); else Store.set(k, m[k]); };
    let n = 0;
    if (chg(TRK)) {                                 // 시세트래킹은 화면에 들고 있는 값까지 한 번에 바꿈
      Tracking.importAll({ items: m['apt.tracking.v1'] || [], folders: m['apt.folders.v1'] || ['기본'], months: m['apt.trkMonths.v1'] ?? null, survey: m['apt.survey.v1'] || {} }, false);
      n++;
    }
    if (chg(TRK_ETC)) { TRK_ETC.forEach(put); n++; }
    if (chg(YARD)) { YARD.forEach(put); if (typeof Yard !== 'undefined' && Yard.reload) Yard.reload(); n++; }
    if (chg(LBL)) { LBL.forEach(put); if (typeof LabelKit !== 'undefined') LabelKit.reload(); n++; }
    if (n) U.toast('☁ 다른 기기에서 고친 시세트래킹·앞마당·지도 라벨 기록을 받아 왔습니다.');
  }

  /* ── GitHub ── */
  const api = (c) => `https://api.github.com/repos/${c.repo}/contents/${PATH}`;
  const hdr = (c, raw) => ({ Authorization: `Bearer ${c.token}`, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
  const why = (s) => (s === 401 || s === 403 ? '토큰이 맞지 않거나 권한이 없습니다. (Contents 읽기/쓰기 필요)' : s === 404 ? '저장소를 찾지 못했습니다. 저장소 이름과 토큰 권한을 확인하세요.' : `GitHub 응답 오류 ${s}`);
  async function getRemote(c) {
    const r = await fetch(api(c), { headers: hdr(c), cache: 'no-store' });
    if (r.status === 404) {                         // 파일이 없는지, 저장소가 없는지 구분
      const rr = await fetch(`https://api.github.com/repos/${c.repo}`, { headers: hdr(c), cache: 'no-store' });
      if (!rr.ok) throw new Error(why(rr.status));
      return { sha: null, doc: null };
    }
    if (!r.ok) throw new Error(why(r.status));
    const j = await r.json();
    let text;
    if (j.content && j.encoding === 'base64') text = unb64(j.content.replace(/\s/g, ''));
    else { const r2 = await fetch(api(c), { headers: hdr(c, true), cache: 'no-store' }); if (!r2.ok) throw new Error(why(r2.status)); text = await r2.text(); }
    const doc = JSON.parse(text);
    if (!doc || doc.type !== 'apt-autosync' || !isObj(doc.data)) throw new Error('저장소의 동기화 파일 형식이 다릅니다.');
    return { sha: j.sha, doc };
  }
  async function putRemote(c, data, sha) {
    const doc = { type: 'apt-autosync', v: 1, savedAt: new Date().toISOString(), device: deviceName(), data };
    const r = await fetch(api(c), { method: 'PUT', headers: { ...hdr(c), 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ message: `자동 동기화 ${doc.savedAt.slice(0, 16)} (${doc.device})`, content: b64(JSON.stringify(doc)), ...(sha ? { sha } : {}) }) });
    if (r.status === 409 || r.status === 422) { const e = new Error('다른 기기가 방금 올렸습니다.'); e.conflict = true; throw e; }
    if (!r.ok) throw new Error(why(r.status));
  }
  const deviceName = () => (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? '휴대폰' : 'PC');

  /* ── 동기화 한 번 ── */
  async function sync() {
    if (!ready() || !cfg.on) return show();
    if (busy) { again = true; return; }
    if (editing()) return later(15000);             // 칸에 적는 중이면 잠시 뒤에
    busy = true; lastTry = Date.now(); show('busy');
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const c = gh();
        const { sha, doc } = await getRemote(c);
        const base = Store.get(BASE, null), local = readLocal(), remote = doc ? doc.data : null;
        let merged = remote ? m3(base || undefined, local, remote, !base) : local;
        if (!same(merged, local)) {
          if (editing()) { busy = false; return later(15000); }
          applyLocal(merged);
          merged = readLocal();                     // 시세트래킹이 정리(normalize)한 값 그대로
        }
        if (!remote || !same(merged, remote)) {
          try { await putRemote(c, merged, sha); } catch (e) { if (e.conflict && attempt < 2) continue; throw e; }
        }
        Store.set(BASE, merged);
        localHash = stable(merged);
        cfg.last = Date.now(); saveCfg(); err = '';
        break;
      }
    } catch (e) { err = e.message || String(e); console.error('자동 동기화', e); }
    finally {
      busy = false; show();
      if (again) { again = false; setTimeout(sync, 500); }
    }
  }
  function later(ms) { clearTimeout(retryTimer); retryTimer = setTimeout(sync, ms); show(); }
  const syncSoon = () => { if (Date.now() - lastTry > MIN_GAP) sync(); };

  /* ── 상태 표시 (화면 위 버튼) ── */
  function ago(t) {
    if (!t) return '';
    const s = Math.round((Date.now() - t) / 1000);
    return s < 60 ? '방금' : s < 3600 ? `${Math.floor(s / 60)}분 전` : s < 86400 ? `${Math.floor(s / 3600)}시간 전` : `${Math.floor(s / 86400)}일 전`;
  }
  function show(state) {
    const b = $('btnAutoSync'); if (!b) return;
    let t, cls = '';
    if (!ready()) t = '☁ 동기화 설정';
    else if (!cfg.on) t = '☁ 자동 동기화 꺼짐';
    else if (state === 'busy' || busy) t = '⏳ 동기화 중…';
    else if (err) { t = '⚠ 동기화 실패'; cls = 'bad'; }
    else if (dirtyTimer) t = '☁ 고친 내용 곧 올림';
    else t = `☁ 동기화됨 · ${ago(cfg.last) || '아직'}`;
    b.textContent = t; b.className = 'hbtn' + (cls ? ' ' + cls : '');
    b.title = err ? `실패 이유: ${err} (눌러서 확인)` : '시세트래킹·앞마당 자동 동기화 (눌러서 설정)';
    if ($('asModal') && !$('asModal').hidden) renderModal();
  }

  /* ── 설정 창 ── */
  function modal() {
    let m = $('asModal');
    if (m) return m;
    m = document.createElement('div'); m.className = 'modal'; m.id = 'asModal'; m.hidden = true;
    m.innerHTML = `<div class="modalbox" style="width:min(560px,100%);max-height:90vh;overflow:auto">
      <div class="bar"><strong>☁ 자동 동기화 · 시세트래킹 + 앞마당</strong><span class="grow"></span><button id="asClose">닫기</button></div>
      <p id="asState" class="hint" style="margin:6px 0"></p>
      <div class="bar"><label class="inline"><input type="checkbox" id="asOn"> 자동 동기화 켜기</label><span class="grow"></span><button id="asNow" class="primary">지금 동기화</button></div>
      <details id="asSetup" style="margin:10px 0"><summary><b>저장소 · 토큰</b> <span class="hint" style="margin:0">(처음 한 번)</span></summary>
        <div class="bar" style="margin-top:8px;flex-wrap:wrap;gap:6px">
          <label>저장소 <input id="asRepo" placeholder="아이디/저장소이름" style="width:200px"></label>
          <label>토큰 <input id="asToken" type="password" placeholder="github_pat_…" style="width:200px" autocomplete="off"></label>
          <button id="asSave">저장하고 연결</button></div>
        <ol class="hint" style="margin:6px 0 0 18px">
          <li>GitHub에서 <b>새 저장소를 비공개(Private)</b>로 만듭니다. (이름 예: apt-sync) — 지금 사이트 저장소는 공개라서 거기에 쓰면 안 됩니다.</li>
          <li>GitHub 오른쪽 위 프로필 → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token</li>
          <li>Repository access: <b>Only select repositories</b> → 방금 만든 저장소 하나만 · Permissions → <b>Contents: Read and write</b> → Generate</li>
          <li>나온 토큰(github_pat_…)과 저장소 이름(아이디/저장소이름)을 위 칸에 넣고 <b>저장하고 연결</b></li>
          <li>휴대폰은 아래 <b>📱 휴대폰 연결 QR</b>을 찍으면 끝입니다.</li></ol>
        <p class="hint">시세트래킹 탭 아래의 [⬆ 올리기 / ⬇ 내려받아 합치기]와 같은 저장소·토큰을 씁니다. 이미 넣어 두셨다면 그대로 연결됩니다.</p>
      </details>
      <div class="bar"><button id="asQr">📱 휴대폰 연결 QR 보기</button><span class="hint" style="margin:0">PC에서 띄우고 휴대폰 카메라로 찍으세요</span></div>
      <div id="asQrBox" hidden style="text-align:center;margin:10px 0"></div>
      <p class="hint" style="margin-top:10px">· 열 때, 다른 앱을 보다가 돌아올 때, 5분마다 받아 오고 / 고치면 30초 뒤 올립니다.<br>
        · 한쪽에서 지운 단지는 다른 기기에서도 지워집니다. 두 기기에서 같은 칸을 고치면 나중에 동기화한 쪽 값이 남습니다.<br>
        · 토큰은 이 기기에만 저장되고 백업 파일에도 들어가지 않습니다. 기기를 남에게 빌려줄 땐 자동 동기화를 꺼 두세요.</p>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.hidden = true; });
    $('asClose').onclick = () => { m.hidden = true; };
    $('asOn').onchange = () => { cfg.on = $('asOn').checked ? 1 : 0; saveCfg(); show(); if (cfg.on) sync(); };
    $('asNow').onclick = () => { if (!ready()) { $('asSetup').open = true; return U.toast('먼저 저장소와 토큰을 넣어 주세요.'); } sync(); };
    $('asSave').onclick = () => {
      const repo = $('asRepo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, ''), token = $('asToken').value.trim();
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return U.toast('저장소 이름을 "아이디/저장소이름" 모양으로 적어 주세요. (예: AscenAscen/apt-sync)');
      if (!token) return U.toast('토큰을 붙여 넣어 주세요.');
      Store.set(GH, { ...gh(), repo, token, path: 'sync/apt-backup.json' });
      const sr = $('syRepo'), stk = $('syToken'); if (sr) sr.value = repo; if (stk) stk.value = token;     // 시세트래킹 탭의 칸도 같이
      cfg.on = 1; saveCfg(); U.toast('저장했습니다. 동기화를 시작합니다.'); sync();
    };
    $('asQr').onclick = qr;
    return m;
  }
  function renderModal() {
    const c = gh();
    $('asOn').checked = !!cfg.on;
    if (document.activeElement !== $('asRepo')) $('asRepo').value = c.repo || '';
    if (document.activeElement !== $('asToken')) $('asToken').value = c.token || '';
    $('asState').innerHTML = !ready() ? '아직 연결되지 않았습니다. 아래 <b>저장소 · 토큰</b>을 먼저 넣어 주세요.'
      : `연결된 저장소: <b>${U.esc(c.repo)}</b> · ${busy ? '동기화 중…' : err ? `<span class="warn">실패: ${U.esc(err)}</span>` : `마지막 동기화 ${ago(cfg.last) || '아직 없음'}`}`;
  }
  function openModal() { const m = modal(); renderModal(); if (!ready()) $('asSetup').open = true; m.hidden = false; }

  /* ── 휴대폰 연결 QR (주소 뒤 #sync=… 에 저장소·토큰을 담음. 주소의 # 뒤는 서버로 가지 않음) ── */
  let qrP = null;
  function loadQr() {
    if (window.qrcode) return Promise.resolve();
    return qrP || (qrP = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
      s.onload = res; s.onerror = () => { qrP = null; rej(new Error('QR 도구를 불러오지 못했습니다. 인터넷 연결을 확인하세요.')); };
      document.head.appendChild(s);
    }));
  }
  async function qr() {
    if (!ready()) { $('asSetup').open = true; return U.toast('먼저 저장소와 토큰을 넣어 주세요.'); }
    const box = $('asQrBox');
    if (!box.hidden) { box.hidden = true; box.innerHTML = ''; return; }
    try {
      await loadQr();
      const c = gh(), url = location.origin + location.pathname + '#sync=' + b64url(JSON.stringify({ r: c.repo, t: c.token }));
      const q = qrcode(0, 'M'); q.addData(url); q.make();
      box.innerHTML = `<div style="display:inline-block;background:#fff;padding:12px;border-radius:10px">${q.createSvgTag({ cellSize: 5, margin: 2 })}</div>
        <p class="hint">휴대폰 기본 카메라로 찍고 나온 주소를 열면 → "연결할까요?"에서 확인. 이 QR에는 토큰이 들어 있으니 다른 사람에게 보여 주지 마세요.</p>
        <button class="mini" id="asQrHide">QR 숨기기</button>`;
      box.hidden = false;
      $('asQrHide').onclick = () => { box.hidden = true; box.innerHTML = ''; };
    } catch (e) { U.toast(e.message || String(e)); }
  }
  /** QR 로 연 주소(#sync=…)면 이 기기에 저장소·토큰을 넣음 */
  function takeHash() {
    const m = location.hash.match(/^#sync=([A-Za-z0-9_-]+)/); if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);          // 주소에서 토큰 지우기
    try {
      const o = JSON.parse(unb64url(m[1]));
      if (!o || !o.r || !o.t) throw new Error();
      if (!confirm(`이 기기를 동기화 저장소 ${o.r} 에 연결할까요?\n시세트래킹·앞마당 기록이 다른 기기와 자동으로 맞춰집니다.\n(이 기기의 기록은 지워지지 않고 합쳐집니다)`)) return;
      Store.set(GH, { ...gh(), repo: o.r, token: o.t, path: 'sync/apt-backup.json' });
      cfg.on = 1; saveCfg();
      U.toast('동기화를 연결했습니다. 기록을 맞추는 중…');
    } catch (e) { U.toast('QR 연결 정보가 올바르지 않습니다. PC에서 QR을 다시 띄워 주세요.'); }
  }

  /* ── 시작 ── */
  function init() {
    if (inited) return; inited = true;
    cfg = Object.assign({ on: 1, last: 0 }, Store.get(CFG, {}) || {});
    if (!$('btnAutoSync')) {
      const b = document.createElement('button'); b.id = 'btnAutoSync'; b.className = 'hbtn';
      const anchor = $('btnHealth');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(b, anchor.nextSibling); else document.querySelector('header.top')?.appendChild(b);
      b.onclick = openModal;
    }
    takeHash();
    localHash = stable(readLocal());
    show();
    // 고친 내용 살피기 (10초마다) → 30초 뒤 올림
    setInterval(() => {
      if (!ready() || !cfg.on || busy || dirtyTimer) return;
      if (stable(readLocal()) !== localHash) { dirtyTimer = setTimeout(() => { dirtyTimer = null; sync(); }, DELAY); show(); }
    }, POLL);
    // 저장소 살피기 (보고 있을 때 5분마다), 상태 글자 새로 고침
    setInterval(() => { if (document.visibilityState === 'visible' && ready() && cfg.on && Date.now() - lastTry > REMOTE_EVERY) sync(); else show(); }, 60000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncSoon();
      else if (dirtyTimer) { clearTimeout(dirtyTimer); dirtyTimer = null; sync(); }         // 화면을 떠나기 전에 바로 올림
    });
    window.addEventListener('focus', syncSoon);
    if (ready() && cfg.on) setTimeout(sync, 1500);
  }
  return { init, sync, open: openModal, _m3: m3 };
})();
