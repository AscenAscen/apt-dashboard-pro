/* ─────────────────────────────────────────────────────────
   regfix.js — 행정구역 개편으로 바뀐 지역 코드를 "내 기록"에 반영 (접속할 때 한 번, 바뀔 것이 있을 때만)
   · 2026.2.1 화성시 일반구 4개 신설 (41590 → 41591 만세구 · 41593 효행구 · 41595 병점구 · 41597 동탄구)
   · 2026.7.1 전남광주통합특별시 출범 (광주 29xxx · 전남 46xxx → 12xxx)
   · 2026.7.1 인천 개편 (중구 28110 → 제물포구 28125 / 영종구 28155, 동구 28140 → 제물포구, 서구 28260 → 서해구 28275 / 검단구 28290)
   국토부 실거래는 지난 거래까지 새 코드로 다시 매겨 두었으므로, 시세트래킹·전수조사·별칭·지역 조건 등 저장된 기록의 코드도 새 코드로 바꿔야 자료가 이어집니다.
   · 바꾸는 것: 따옴표 안의 단지 ID("29170|동|지번|이름#평형"), 지역 조건("c:29170"), 코드 칸("29170") — 숫자로 저장된 가격 등은 건드리지 않음
   · 나뉜 곳(인천 중구·서구, 화성시)은 동 이름으로 새 구를 고르고, 아직 정할 수 없으면 그대로 두었다가 다음 접속 때 다시 시도
   ───────────────────────────────────────────────────────── */
const RegFix = (() => {
  const SK = 'apt.regfix.v1';
  const ONE = {
    '29110': '12210', '29140': '12240', '29155': '12270', '29170': '12300', '29200': '12330',
    '46110': '12110', '46130': '12130', '46150': '12150', '46170': '12170', '46230': '12190', '46710': '12710', '46720': '12720', '46730': '12730',
    '46770': '12740', '46780': '12750', '46790': '12760', '46800': '12770', '46810': '12780', '46820': '12790', '46830': '12800', '46840': '12810',
    '46860': '12820', '46870': '12830', '46880': '12840', '46890': '12850', '46900': '12860', '46910': '12870',
    '28140': '28125',
  };
  const SPLIT = { '28110': ['28125', '28155'], '28260': ['28275', '28290'], '41590': ['41591', '41593', '41595', '41597'] };
  const NAME = { '28125': '제물포구', '28155': '영종구', '28275': '서해구', '28290': '검단구', '41591': '화성시 만세구', '41593': '화성시 효행구', '41595': '화성시 병점구', '41597': '화성시 동탄구' };
  // 동 이름으로 확실히 정해지는 곳 (행정안전부 변경 내역 기준 법정동)
  const DONGS = {
    '28155': ['운서동', '중산동', '운남동', '운북동', '을왕동', '남북동', '덕교동', '무의동'],
    '28290': ['마전동', '당하동', '원당동', '불로동', '대곡동', '금곡동', '오류동', '왕길동', '백석동', '시천동'],
    '41591': ['우정읍', '향남읍', '남양읍', '마도면', '송산면', '서신면', '팔탄면', '장안면', '양감면'],
    '41593': ['봉담읍', '비봉면', '매송면', '정남면'],
  };
  const DEFAULT = { '28110': '28125', '28260': '28275' };      // 인천은 위 목록에 없으면 나머지 구
  const OLD = [...Object.keys(ONE), ...Object.keys(SPLIT)];
  const OLD_RE = new RegExp(`"(?:c:)?(${OLD.join('|')})(?=["|#])`);
  let known = {};                                                 // 새 코드 → 실거래 자료에 나오는 동 이름들
  let pending = 0;

  function resolve(code, dong) {
    if (ONE[code]) return ONE[code];
    const cands = SPLIT[code]; if (!cands) return null;
    const d = String(dong || '').trim(), d0 = d.split(' ')[0];
    for (const c of cands) if ((DONGS[c] || []).some(x => d === x || d0 === x || d.startsWith(x + ' '))) return c;
    for (const c of cands) if (known[c] && (known[c].has(d) || known[c].has(d0))) return c;
    if (DEFAULT[code]) return DEFAULT[code];
    return null;                                                  // 화성 동 지역: 새 구 자료가 모이면 다음 접속 때 정함
  }
  const dongOfId = (rest) => rest.split('|')[0];

  /* 값 하나 바꾸기 → [새 값, 바뀜?] */
  const CODE_KEYS = new Set(['code', 'c', 'codes', 'sel', 'cur', 'region', 'regionCode', 'lawd']);
  function str(s, exact) {
    let m = /^(\d{5})(\|.*)$/.exec(s);
    if (m && OLD.includes(m[1])) { const nc = resolve(m[1], dongOfId(m[2].slice(1))); if (nc) return [nc + m[2]]; pending++; return [s]; }
    m = /^c:(\d{5})$/.exec(s);
    if (m && OLD.includes(m[1])) return ONE[m[1]] ? ['c:' + ONE[m[1]]] : SPLIT[m[1]].map(c => 'c:' + c);
    if (exact && /^\d{5}$/.test(s) && OLD.includes(s)) return ONE[s] ? [ONE[s]] : SPLIT[s].slice();
    return [s];
  }
  function walk(v, key) {
    if (typeof v === 'string') { const r = str(v, CODE_KEYS.has(key)); return r.length === 1 ? r[0] : v; }   // 여러 구로 나뉘는 값은 목록 안에서만 펼침
    if (Array.isArray(v)) {
      const codeList = v.length > 0 && v.every(x => typeof x === 'string' && /^(c:|[gmp]:)?[^|]*$/.test(x) && (/^\d{5}$/.test(x) || /^[cgmp]:/.test(x)));
      const out = [];
      for (const x of v) {
        if (typeof x === 'string') { for (const y of str(x, codeList)) if (!out.includes(y) || !/^(c:)?\d{5}$/.test(y)) out.push(y); }
        else out.push(walk(x));
      }
      return out;
    }
    if (v && typeof v === 'object') {
      const o = {};
      const ownDong = typeof v.key === 'string' ? dongOfId(v.key) : (v.dong || '');
      for (const [k, x] of Object.entries(v)) {
        let nk = k;
        const m = /^(\d{5})(\|.*)?$/.exec(k);
        if (m && OLD.includes(m[1])) {
          const nc = resolve(m[1], m[2] ? dongOfId(m[2].slice(1)) : ownDong);
          if (nc) nk = nc + (m[2] || ''); else pending++;
        }
        if ((k === 'code' || k === 'c') && typeof x === 'string' && OLD.includes(x)) {
          const nc = resolve(x, ownDong);
          if (nc) { o[nk] = nc; if (NAME[nc] && typeof v.sgg === 'string' && ['중구', '동구', '서구', '화성시'].includes(v.sgg.trim())) o.sgg = NAME[nc]; continue; }
          pending++;
        }
        if (k === 'sgg' && o.sgg) continue;                      // 위에서 새 구 이름으로 바꿈
        o[nk] = walk(x, k);
      }
      return o;
    }
    return v;
  }

  async function loadKnown() {
    const need = [...new Set(Object.values(SPLIT).flat())];
    await Promise.all(need.map(async (c) => {
      try { const idx = await Data.index(c); known[c] = new Set(Object.keys(idx.c || {}).map(k => k.split('|')[0])); } catch (e) { known[c] = new Set(); }
    }));
  }

  /** 접속할 때 한 번: 바뀔 것이 있는 기록만 고침 */
  async function run() {
    let todo = [];
    try {
      for (const k of Store.keys()) {
        if (k === SK) continue;
        const v = Store.get(k, null); if (v == null) continue;
        let raw; try { raw = JSON.stringify(v); } catch (e) { continue; }
        if (OLD_RE.test(raw)) todo.push(k);
      }
    } catch (e) { console.error(e); return { changed: 0 }; }
    if (!todo.length) return { changed: 0 };
    if (todo.some(k => /"(?:c:)?(28110|28260|41590)(?=["|#])/.test(JSON.stringify(Store.get(k, null))))) await loadKnown();
    pending = 0;
    let changed = 0;
    for (const k of todo) {
      const v = Store.get(k, null), nv = walk(v);
      if (JSON.stringify(nv) !== JSON.stringify(v)) { Store.set(k, nv); changed++; }
    }
    const log = Store.get(SK, { runs: [] });
    log.runs = [...(log.runs || []), { t: new Date().toISOString().slice(0, 16).replace('T', ' '), keys: todo.length, changed, pending }].slice(-10);
    Store.set(SK, log);
    if (changed) setTimeout(() => U.toast(`행정구역 개편(광주·전남·인천·화성)으로 바뀐 지역 코드를 내 기록 ${changed}곳에 반영했습니다.`), 1500);
    return { changed, pending };
  }
  return { run, _walk: walk, _resolve: resolve };
})();
