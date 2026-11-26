/* ─────────────────────────────────────────────────────────
   fbsync.js — Google 로그인 + Firebase(Firestore) 저장소  (js/autosync.js 가 씀)
   · 한 번 Google 로 로그인하면 그 기기에서는 계속 유지됩니다. QR·GitHub 토큰이 필요 없습니다.
   · 저장 위치: users/{내 계정 id}/autosync/  (meta 1개 + 조각 문서 c0, c1, …)
     - 기록 전체를 JSON 글자로 만든 뒤 25만 글자씩 잘라 조각 문서에 담음 (문서 1개 용량 한계 1MB 때문)
     - meta 의 ver(올릴 때마다 +1)로 "다른 기기가 방금 올렸는지" 확인 (트랜잭션)
   · Firebase 라이브러리는 Google 로그인 동기화를 쓸 때만 그때 내려받습니다 (다른 때는 느려지지 않음).
   ───────────────────────────────────────────────────────── */
const FbSync = (() => {
  const VER = '10.14.1', BASE = `https://www.gstatic.com/firebasejs/${VER}/`, CHUNK = 250000;
  let loadP = null, app = null, auth = null, db = null, authReady = null, onChange = () => {};

  const cfg = () => window.FIREBASE_CONFIG || {};
  const configured = () => { const c = cfg(); return !!(c.apiKey && c.projectId); };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function script(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.async = false;
      s.onload = res; s.onerror = () => rej(new Error('Google(Firebase) 도구를 내려받지 못했습니다. 인터넷 연결을 확인하세요.'));
      document.head.appendChild(s);
    });
  }

  /** Firebase 준비 (처음 한 번만). 로그인 상태가 확인될 때까지 기다림 */
  function load() {
    if (!configured()) return Promise.reject(new Error('Firebase 설정값이 비어 있습니다. js/fbconfig.js 를 채워 주세요.'));
    if (loadP) return loadP;
    loadP = (async () => {
      await script(BASE + 'firebase-app-compat.js');
      await Promise.all([script(BASE + 'firebase-auth-compat.js'), script(BASE + 'firebase-firestore-compat.js')]);
      const c = cfg();
      app = firebase.apps.length ? firebase.app() : firebase.initializeApp({ apiKey: c.apiKey, authDomain: c.authDomain || `${c.projectId}.firebaseapp.com`, projectId: c.projectId, appId: c.appId || undefined });
      auth = firebase.auth(app); db = firebase.firestore(app);
      authReady = new Promise((res) => { let first = true; auth.onAuthStateChanged((u) => { if (first) { first = false; res(u); } try { onChange(u); } catch (e) { console.error(e); } }); });
      auth.getRedirectResult().catch((e) => console.warn('Google 로그인(이동 방식) 결과', e));
      await authReady;
    })().catch((e) => { loadP = null; throw e; });
    return loadP;
  }

  const user = async () => { await load(); await authReady; return auth.currentUser; };
  const current = () => (auth ? auth.currentUser : null);          // 이미 준비됐을 때만 (화면 표시용)
  const setOnChange = (fn) => { onChange = fn || (() => {}); };

  /** Google 로그인. 팝업이 막히는 환경이면 화면 이동 방식으로 */
  async function signIn() {
    await load();
    const p = new firebase.auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
    try { const r = await auth.signInWithPopup(p); return r.user; }
    catch (e) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'].includes(e.code)) { await auth.signInWithRedirect(p); return null; }
      if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') throw new Error('로그인 창이 닫혔습니다. 다시 눌러 주세요.');
      if (e.code === 'auth/unauthorized-domain') throw new Error('이 사이트 주소가 Firebase 의 "승인된 도메인"에 없습니다. 안내의 도메인 추가 단계를 확인하세요.');
      throw e;
    }
  }
  async function signOut() { if (auth) await auth.signOut(); }

  const why = (e) => {
    const c = e && e.code;
    if (c === 'permission-denied') return 'Firestore 보안 규칙이 막고 있습니다. 규칙을 안내대로 붙여 넣었는지 확인하세요.';
    if (c === 'unavailable') return '인터넷 연결이 불안정합니다. 잠시 뒤 다시 시도합니다.';
    if (c === 'failed-precondition' || c === 'not-found') return 'Firestore 데이터베이스가 아직 만들어지지 않았을 수 있습니다. 안내의 데이터베이스 만들기 단계를 확인하세요.';
    return e && e.message ? e.message : String(e);
  };
  const wrap = async (fn) => { try { return await fn(); } catch (e) { if (e && e.conflict) throw e; const n = new Error(why(e)); n.transient = !!e.transient; throw n; } };
  const col = (u) => db.collection('users').doc(u.uid).collection('autosync');

  /** 받기 → { sha: 버전(숫자) 또는 null, doc: 저장된 기록 또는 null } */
  function get(u) {
    return wrap(async () => {
      const base = col(u), m = await base.doc('meta').get();
      if (!m.exists) return { sha: null, doc: null };
      const { ver, n } = m.data();
      const snaps = await Promise.all(Array.from({ length: n }, (_, i) => base.doc('c' + i).get()));
      if (snaps.some(s => !s.exists || s.data().v !== ver)) { const e = new Error('다른 기기가 올리는 중입니다. 잠시 뒤 다시 시도합니다.'); e.transient = true; throw e; }
      const doc = JSON.parse(snaps.map(s => s.data().t).join(''));
      if (!doc || doc.type !== 'apt-autosync' || !doc.data || typeof doc.data !== 'object') throw new Error('저장된 동기화 기록의 형식이 다릅니다.');
      return { sha: ver, doc };
    });
  }

  /** 올리기 (expVer = 받을 때의 버전. 그 사이 다른 기기가 올렸으면 conflict) */
  function put(u, data, expVer, device) {
    return wrap(async () => {
      const doc = { type: 'apt-autosync', v: 1, savedAt: new Date().toISOString(), device, data };
      const text = JSON.stringify(doc), parts = [];
      for (let i = 0; i < text.length; i += CHUNK) parts.push(text.slice(i, i + CHUNK));
      const base = col(u), meta = base.doc('meta');
      await db.runTransaction(async (tx) => {
        const m = await tx.get(meta), cur = m.exists ? m.data().ver : null, oldN = m.exists ? m.data().n : 0;
        if ((cur == null ? null : cur) !== (expVer == null ? null : expVer)) { const e = new Error('다른 기기가 방금 올렸습니다.'); e.conflict = true; throw e; }
        const ver = (cur || 0) + 1;
        parts.forEach((t, i) => tx.set(base.doc('c' + i), { v: ver, t }));
        for (let i = parts.length; i < oldN; i++) tx.delete(base.doc('c' + i));
        tx.set(meta, { ver, n: parts.length, savedAt: doc.savedAt, device });
      });
    });
  }

  return { configured, load, user, current, signIn, signOut, get, put, setOnChange, sleep };
})();
