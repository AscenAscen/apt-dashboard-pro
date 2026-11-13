/* ─────────────────────────────────────────────────────────
   vault.js — 내 기록 지키기
   · 기기 사이 옮기기: [코드로 내보내기] → 긴 글자를 복사해 다른 기기의 [코드 가져오기] 에 붙여 넣기 (덮어쓰지 않고 합침)
   · 백업 파일 저장·불러오기, 마지막 백업 시점과 알림
   · 잠금: 켜면 적어 둔 값을 고칠 수 없음 (남에게 화면을 보여 줄 때)
   · 큰 삭제는 "삭제" 를 직접 입력해야 진행
   기록은 모두 이 브라우저에만 저장됩니다. 다른 사람이 접속해도 내 기록은 보이지 않고 바뀌지 않습니다.
   ───────────────────────────────────────────────────────── */
const Vault = (() => {
  const $ = (id) => document.getElementById(id);
  const BK = 'apt.lastBackup', REMIND_DAYS = 14;
  // 함께 옮기는 그 밖의 저장 항목 (시세그룹핑 표, 입지 메모, 조사 이름·메모, 대중교통 메모)
  const EXTRA = ['apt.grouping.v1', 'apt.loc.v1', 'apt.surveyMeta.v1'];
  let locked = Store.get('apt.lock', false);

  /* ── 묶기 / 풀기 ── */
  function pack() {
    const extra = {};
    EXTRA.forEach(k => { const v = Store.get(k, null); if (v) extra[k] = v; });
    return { type: 'apt-tracking', v: 2, savedAt: new Date().toISOString(), ...Tracking.exportAll(), extra };
  }
  function apply(obj, merge) {
    if (!obj || obj.type !== 'apt-tracking' || !Array.isArray(obj.items)) throw new Error('형식이 맞지 않습니다.');
    (obj.items || []).forEach(it => { it.quotes = it.quotes || {}; });
    const extra = obj.extra || (obj.grouping ? { 'apt.grouping.v1': obj.grouping } : {});
    for (const k of Object.keys(extra)) {
      const cur = Store.get(k, null);
      if (!cur || !merge) Store.set(k, extra[k]);
      else if (k === 'apt.grouping.v1') { const names = new Set(cur.boards.map(b => b.name)); cur.boards.push(...extra[k].boards.filter(b => !names.has(b.name))); Store.set(k, cur); }
      else { for (const id of Object.keys(extra[k])) cur[id] = { ...(cur[id] || {}), ...extra[k][id] }; Store.set(k, cur); }   // 단지별 메모는 칸 단위로 합침
    }
    const n = Tracking.importAll(obj, merge);
    if (typeof Grouping !== 'undefined') Grouping.reload();
    if (typeof Survey !== 'undefined') Survey.open();
    return n;
  }
  const askMerge = () => confirm('지금 기록과 합칠까요?\n\n[확인] 합치기 — 양쪽 기록을 모두 살립니다. 같은 칸이 겹치면 가져온 값을 씁니다.\n[취소] 바꾸기 — 지금 기록을 지우고 가져온 것으로 바꿉니다.');
  const hasData = () => Tracking.all().length + Tracking.allRecords().length > 0;

  const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (text) => Uint8Array.from(atob(text), c => c.charCodeAt(0));
  async function toCode(obj) {
    const raw = new TextEncoder().encode(JSON.stringify(obj));
    if (window.CompressionStream) {
      const buf = await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
      return 'APT2:' + b64(new Uint8Array(buf));          // 압축해서 짧게
    }
    return 'APT1:' + b64(raw);
  }
  async function fromCode(text) {
    const t = text.replace(/\s+/g, '');
    if (t.startsWith('APT2:')) {
      const buf = await new Response(new Blob([unb64(t.slice(5))]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      return JSON.parse(new TextDecoder().decode(buf));
    }
    if (t.startsWith('APT1:')) return JSON.parse(new TextDecoder().decode(unb64(t.slice(5))));
    throw new Error('코드가 아닙니다.');
  }

  /* ── 마지막 백업 시점 ── */
  const touch = () => { Store.set(BK, Date.now()); showInfo(); };
  const days = () => { const t = Store.get(BK, 0); return t ? Math.floor((Date.now() - t) / 864e5) : null; };
  function showInfo() {
    const d = days(), text = d == null ? '아직 백업한 적이 없습니다' : d === 0 ? '마지막 백업: 오늘' : `마지막 백업: ${d}일 전`;
    document.querySelectorAll('.bkinfo').forEach(el => { el.textContent = text; el.classList.toggle('warn', d == null || d >= REMIND_DAYS); });
  }
  /** 백업 알림 문구 (필요 없으면 빈 글자).  count = 기록 수 */
  function remindText(count) {
    const d = days();
    if (count < 3 || (d != null && d < REMIND_DAYS)) return '';
    return `${d == null ? '아직 백업한 적이 없습니다.' : `마지막 백업이 ${d}일 전입니다.`} 기록은 이 브라우저에만 있어서, 브라우저 기록을 지우면 사라집니다. <button class="mini" data-act="backup">지금 코드로 내보내기</button>`;
  }

  /* ── 코드 창 ── */
  function openModal(mode, text) {
    $('codeTitle').textContent = mode === 'out' ? '코드로 내보내기' : '코드 가져오기';
    $('codeHelp').innerHTML = mode === 'out'
      ? '아래 글자가 내 기록 전체입니다. <b>복사</b>해서 카카오톡 "나에게 보내기" 등으로 다른 기기에 보낸 뒤, 그 기기의 <b>코드 가져오기</b>에 붙여 넣으세요.'
      : '다른 기기에서 <b>코드로 내보내기</b>로 복사한 글자를 아래에 붙여 넣고 <b>가져오기</b>를 누르세요.';
    $('codeText').value = text || ''; $('codeText').readOnly = mode === 'out';
    $('codeCopy').hidden = mode !== 'out'; $('codeApply').hidden = mode !== 'in';
    $('codeModal').hidden = false;
    if (mode === 'out') $('codeText').select(); else $('codeText').focus();
  }
  async function copyCode() {
    if (!hasData()) return U.toast('내보낼 기록이 없습니다.');
    const code = await toCode(pack());
    openModal('out', code);
    try { await navigator.clipboard.writeText(code); U.toast(`복사했습니다. (${code.length.toLocaleString()}자) 다른 기기의 [코드 가져오기]에 붙여 넣으세요.`); } catch (e) { /* 창에서 직접 복사 */ }
    touch();
  }
  async function applyCode() {
    try {
      const obj = await fromCode($('codeText').value);
      const merge = hasData() ? askMerge() : false;
      const n = apply(obj, merge);
      $('codeModal').hidden = true;
      U.toast(`가져왔습니다. (시세트래킹 단지 ${n}개)`);
    } catch (e) { console.error(e); U.toast('코드를 읽을 수 없습니다. 처음부터 끝까지 모두 붙여 넣었는지 확인하세요.'); }
  }

  /* ── 백업 파일 ── */
  function backupFile() {
    const blob = new Blob([JSON.stringify(pack(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `실거래대시보드_백업_${U.stamp()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    touch();
  }
  async function restoreFile(e) {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      const n = apply(obj, hasData() ? askMerge() : false);
      U.toast(`백업을 불러왔습니다. (시세트래킹 단지 ${n}개)`);
    } catch (err) { console.error(err); U.toast('백업 파일을 읽을 수 없습니다.'); }
  }

  /** 큰 삭제 확인.  strong=true 면 "삭제" 를 직접 입력해야 진행 */
  function sure(message, strong) {
    if (!strong) return confirm(message + '\n\n계속할까요?');
    return (prompt(message + '\n\n되돌릴 수 없습니다. 진행하려면 아래에 "삭제" 라고 입력하세요.') || '').trim() === '삭제';
  }

  /* ── 잠금: 적어 둔 값 고치기 막기 ── */
  const PROTECT = '#trkTable input:not([type=checkbox]), #trkTable select, #trkCards input:not([type=checkbox]), #trkCards select, #svTable input:not([type=checkbox]), #svTable select, #svHist input, table.loc input, table.loc select, #grpTable textarea, #grpTable input, #cmpDist input';
  const BUTTONS = '#btnTrkAddMonth, #btnTrkSame, #btnTrkDelete, #btnTrkMove, #btnTrkAddTo, #btnTrkOut, #btnFolderNew, #btnFolderRename, #btnFolderDelete, [data-delmonth], #btnSvAddMonth, #btnSvSame, #btnSvPaste, #btnSvTrack, #btnAddTrackSel, #btnDetailTrack, [data-vault=in], [data-vault=restore], #btnGrpNew, #btnGrpRename, #btnGrpDelete, #btnGrpAuto, #btnGrpAddZone, #btnGrpBands, #grpResults button, #grpTable button, [data-track], [data-cand], #svHist [data-done]';
  function showLock() {
    document.body.classList.toggle('readonly', locked);
    const b = $('btnLock'); if (b) { b.textContent = locked ? '🔒 잠금 켜짐' : '🔓 잠금'; b.classList.toggle('on', locked); b.title = locked ? '적어 둔 값을 고칠 수 없는 상태입니다. 누르면 풀립니다.' : '누르면 적어 둔 값을 고칠 수 없게 잠급니다.'; }
  }
  function initLock() {
    const block = (e) => { e.preventDefault(); e.stopPropagation(); U.toast('잠금 상태입니다. 오른쪽 위 [잠금]을 눌러 풀어 주세요.'); };
    document.addEventListener('beforeinput', (e) => { if (locked && e.target.matches && e.target.matches(PROTECT)) block(e); }, true);
    document.addEventListener('mousedown', (e) => { if (locked && e.target.matches && e.target.matches('select') && e.target.matches(PROTECT)) block(e); }, true);
    document.addEventListener('keydown', (e) => { if (locked && e.key !== 'Tab' && e.target.matches && e.target.matches('select') && e.target.matches(PROTECT)) block(e); }, true);
    document.addEventListener('click', (e) => { if (locked && e.target.closest && e.target.closest(BUTTONS)) block(e); }, true);
    $('btnLock').onclick = () => { locked = !locked; Store.set('apt.lock', locked); showLock(); U.toast(locked ? '잠갔습니다. 적어 둔 값을 고칠 수 없습니다.' : '잠금을 풀었습니다.'); };
    showLock();
  }

  function init() {
    initLock();
    document.querySelectorAll('[data-vault]').forEach(b => {
      const act = b.dataset.vault;
      if (act === 'out') b.onclick = copyCode;
      if (act === 'in') b.onclick = () => openModal('in', '');
      if (act === 'file') b.onclick = backupFile;
      if (act === 'restore') b.onclick = () => $('vaultFile').click();
    });
    $('vaultFile').onchange = restoreFile;
    $('codeClose').onclick = () => { $('codeModal').hidden = true; };
    $('codeCopy').onclick = async () => { $('codeText').select(); try { await navigator.clipboard.writeText($('codeText').value); U.toast('복사했습니다.'); } catch (e) { document.execCommand('copy'); } };
    $('codeApply').onclick = applyCode;
    showInfo();
  }

  return { init, sure, remindText, copyCode, touch, isLocked: () => locked };
})();
