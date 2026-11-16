/* ───────────── 기기 간 동기화 (PC ↔ 휴대폰) ─────────────
   전체 백업 파일을 "나만 보는(비공개) GitHub 저장소"에 올리고 내려받습니다.
   · 올리기: 이 기기의 모든 기록 → 저장소의 sync/apt-backup.json
   · 내려받기: 저장소 파일 → 이 기기의 기록과 합치기(같은 단지는 가져온 값 우선)
   토큰·저장소 이름은 이 기기에만 저장되고 백업 파일에는 들어가지 않습니다. (apt.sync.v1) */
const Sync = (() => {
  const KEY = 'apt.sync.v1', $ = (id) => document.getElementById(id);
  const cfg = () => Store.get(KEY, { repo: '', token: '', path: 'sync/apt-backup.json' });
  const api = (c) => `https://api.github.com/repos/${c.repo}/contents/${c.path.split('/').map(encodeURIComponent).join('/')}`;
  const hdr = (c, raw) => ({ Authorization: `Bearer ${c.token}`, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
  const b64 = (str) => { const bytes = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const say = (t, warn) => { const el = $('syInfo'); if (el) { el.textContent = t; el.className = 'hint' + (warn ? ' warn' : ''); } };

  function readForm() {
    const c = { repo: $('syRepo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, ''), token: $('syToken').value.trim(), path: 'sync/apt-backup.json' };
    if (!/^[\w.-]+\/[\w.-]+$/.test(c.repo)) throw new Error('저장소 이름을 "아이디/저장소이름" 모양으로 적어 주세요. (예: AscenAscen/apt-sync)');
    if (!c.token) throw new Error('토큰을 붙여 넣어 주세요.');
    return c;
  }
  async function pushIt() {
    let c; try { c = readForm(); } catch (e) { return U.toast(e.message); }
    Store.set(KEY, c); say('올리는 중…');
    try {
      let sha;
      const g = await fetch(api(c), { headers: hdr(c) });
      if (g.ok) sha = (await g.json()).sha; else if (g.status !== 404) throw new Error(g.status === 401 || g.status === 403 ? '토큰이 맞지 않거나 권한이 없습니다. (Contents 읽기/쓰기 권한 필요)' : `GitHub 응답 오류 ${g.status}`);
      const o = await Vault.packFull(), body = JSON.stringify(o);
      const r = await fetch(api(c), { method: 'PUT', headers: { ...hdr(c), 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `동기화 ${new Date().toISOString().slice(0, 16)}`, content: b64(body), ...(sha ? { sha } : {}) }) });
      if (!r.ok) throw new Error(`올리기 실패 (${r.status})`);
      say(`올렸습니다. (항목 ${o.count}개 · ${(body.length / 1024).toFixed(0)}KB · ${new Date().toLocaleString('ko-KR')})`); U.toast('동기화: 이 기기의 기록을 올렸습니다.');
    } catch (e) { say(e.message || String(e), true); }
  }
  async function pullIt() {
    let c; try { c = readForm(); } catch (e) { return U.toast(e.message); }
    Store.set(KEY, c); say('내려받는 중…');
    try {
      const r = await fetch(api(c), { headers: hdr(c, true) });
      if (r.status === 404) throw new Error('저장소에 올려 둔 파일이 아직 없습니다. 다른 기기에서 먼저 [올리기]를 눌러 주세요.');
      if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? '토큰이 맞지 않거나 권한이 없습니다.' : `GitHub 응답 오류 ${r.status}`);
      const obj = JSON.parse(await r.text());
      if (obj.type !== 'apt-full') throw new Error('동기화 파일이 아닙니다.');
      if (!confirm(`${obj.savedAt ? obj.savedAt.slice(0, 16).replace('T', ' ') : ''}에 올린 기록(${obj.count}개 항목)을 이 기기 기록과 합칩니다. 계속할까요?\n(같은 단지는 가져온 값이 우선합니다. 합치기 전에 [🛡 전체 백업 저장]을 해 두면 안전합니다.)`)) return say('취소했습니다.');
      await Vault.applyFull(obj, true); say('합쳤습니다. 화면을 새로 고칩니다…'); setTimeout(() => location.reload(), 700);
    } catch (e) { say(e.message || String(e), true); }
  }
  function init() {
    const host = $('trkPlus'); if (!host || $('syRepo')) return;
    const c = cfg();
    host.insertAdjacentHTML('beforeend', `<div class="mrow"><span class="mlabel">기기 동기화 (PC ↔ 휴대폰)</span>
      <label>저장소 <input id="syRepo" placeholder="아이디/저장소이름" style="width:190px" value="${U.esc(c.repo || '')}"></label>
      <label>토큰 <input id="syToken" type="password" placeholder="github_pat_…" style="width:190px" value="${U.esc(c.token || '')}" autocomplete="off"></label>
      <button id="btnSyPush" class="primary" title="이 기기의 기록을 저장소로 올립니다">⬆ 올리기</button><button id="btnSyPull" title="저장소의 기록을 이 기기에 합칩니다">⬇ 내려받아 합치기</button>
      <span class="hint" id="syInfo" style="margin:0"></span></div>
      <details style="margin:0 0 6px 8px"><summary class="hint" style="cursor:pointer">처음 한 번 설정하는 방법</summary>
        <ol class="hint" style="margin:6px 0 0 18px">
          <li>GitHub에서 <b>새 저장소를 비공개(Private)</b>로 만드세요. (이름 예: apt-sync) — 지금 사이트 저장소는 공개라서 거기에 올리면 안 됩니다.</li>
          <li>GitHub 프로필 → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token. Repository access는 <b>방금 만든 저장소 하나만</b>, Permissions → Contents → <b>Read and write</b>.</li>
          <li>만든 토큰(github_pat_…)과 저장소 이름을 위 칸에 넣고 PC에서 [올리기], 휴대폰에서 같은 값을 넣고 [내려받아 합치기].</li>
          <li>토큰은 이 기기에만 저장되고 백업 파일에는 들어가지 않습니다. 기기마다 한 번씩 넣어야 합니다.</li></ol></details>`);
    $('btnSyPush').onclick = pushIt; $('btnSyPull').onclick = pullIt;
  }
  return { init, _b64: b64 };
})();
