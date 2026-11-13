/* ─────────────────────────────────────────────────────────
   data.js — 데이터 읽기 + 공통 계산/도구
   (화면과 무관한 기능은 모두 여기 있습니다)

   데이터 파일 구조
     data/regions.json              [[지역코드, 시도, 시군구, 등급], …]
     data/index/{지역코드}.json      { c: {단지키: 건축년도}, y: {sale:[연도…], rent:[연도…]} }
     data/sale/{지역코드}/{연도}.json  { 단지키: { 면적키: [월일,층,금액, 월일,층,금액, …] } }
     data/rent/…                    (전세, 구조 동일)
     단지키 = "동|지번|단지명",  면적키 = 전용면적(끝에 d 가 붙으면 직거래),  금액 단위 = 만원
   ───────────────────────────────────────────────────────── */
const Data = (() => {
  const cache = new Map();

  function getJson(path, fallback) {
    if (!cache.has(path)) {
      cache.set(path, fetch(`${CONFIG.DATA_URL}/${path}`, { cache: 'no-cache' })
        .then(r => (r.ok ? r.json() : fallback))
        .catch(() => fallback));
    }
    return cache.get(path);
  }

  const regions = () => getJson('regions.json', []);
  const status = () => getJson('status.json', null);
  const index = (code) => getJson(`index/${code}.json`, { c: {}, y: { sale: [], rent: [] } });

  /** 한 지역의 여러 해 파일을 읽어 { sale: {연도: 자료}, rent: {…} } 로 돌려줌 */
  async function loadYears(code, fromYear, toYear) {
    const idx = await index(code);
    const out = { sale: {}, rent: {} };
    const jobs = [];
    for (const kind of ['sale', 'rent']) {
      for (const y of idx.y[kind] || []) {
        if (y >= fromYear && y <= toYear) {
          jobs.push(getJson(`${kind}/${code}/${y}.json`, {}).then(d => { out[kind][y] = d; }));
        }
      }
    }
    await Promise.all(jobs);
    return out;
  }

  function parseKey(key) {
    const p = key.split('|');
    return { dong: p[0], jibun: p[1] || '', name: p.slice(2).join('|') };
  }

  /** 연도별 자료에서 거래를 하나씩 꺼내 fn(단지키, 거래) 호출. keyFilter(단지키) 가 false 면 건너뜀 */
  function eachTrade(yearMap, keyFilter, fn) {
    for (const y of Object.keys(yearMap)) {
      const ydata = yearMap[y];
      for (const key in ydata) {
        if (keyFilter && !keyFilter(key)) continue;
        const areas = ydata[key];
        for (const akey in areas) {
          const direct = akey.endsWith('d');
          const area = parseFloat(akey);
          const g = Math.floor(area);
          const flat = areas[akey];
          for (let i = 0; i < flat.length; i += 3) {
            fn(key, { d: y * 10000 + flat[i], area, g, direct, floor: flat[i + 1], price: flat[i + 2] });
          }
        }
      }
    }
  }

  /** 전고점·전저점·등락률 계산. sale/rent = 날짜순 거래 배열 */
  function stats(sale, rent, noDirect) {
    const s = noDirect ? sale.filter(t => !t.direct) : sale;
    const pick = (arr) => {
      const since = arr.filter(t => t.d >= CONFIG.PEAK_FROM);
      let peak = null, trough = null;
      for (const t of since) {
        if (!peak || t.price >= peak.price) peak = t;
        if (!trough || t.price < trough.price) trough = t;
      }
      return { last: arr[arr.length - 1] || null, peak, trough };
    };
    const a = pick(s), b = pick(rent);
    const rate = (x, base) => (x && base ? (x.price / base.price - 1) * 100 : null);
    return {
      last: a.last, peak: a.peak, trough: a.trough,
      drop: rate(a.last, a.peak),          // 전고대비 하락률(%)
      rise: rate(a.last, a.trough),        // 전저대비 상승률(%)
      rentLast: b.last, rentPeak: b.peak, rentTrough: b.trough,
      rentDrop: rate(b.last, b.peak), rentRise: rate(b.last, b.trough),
      ratio: a.last && b.last ? b.last.price / a.last.price * 100 : null,  // 전세가율(%)
    };
  }

  return { regions, status, index, loadYears, parseKey, eachTrade, stats };
})();

/* ───────────── 공통 도구 ───────────── */
const U = {
  esc: (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  /** 만원 → "12억 3,000" */
  price(v) {
    if (v == null) return '-';
    const neg = v < 0; v = Math.abs(Math.round(v));
    const eok = Math.floor(v / 10000), rest = v % 10000;
    const txt = eok ? `${eok}억${rest ? ' ' + rest.toLocaleString() : ''}` : rest.toLocaleString();
    return (neg ? '-' : '') + txt;
  },
  date: (d) => (d ? `${String(d).slice(2, 4)}.${String(d).slice(4, 6)}.${String(d).slice(6, 8)}` : ''),
  pct: (v, digits = 1) => (v == null ? '-' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`),
  cls: (v) => (v == null || v === 0 ? '' : v > 0 ? 'up' : 'down'),
  diff: (v) => (v == null ? '-' : v === 0 ? '0' : `${v > 0 ? '+' : '-'}${U.price(Math.abs(v))}`),
  today: () => { const t = new Date(); return t.getFullYear() * 10000 + (t.getMonth() + 1) * 100 + t.getDate(); },
  /** 시도·시군구 → 엑셀의 "시", "구" */
  siGu(sido, sgg) {
    if (sgg.includes(' ')) { const [si, ...gu] = sgg.split(' '); return [si, gu.join(' ')]; }
    if (/특별시|광역시|특별자치시/.test(sido)) return [sido.replace(/특별자치시|특별시|광역시/, ''), sgg];
    return [sgg, ''];
  },
  landLink: (sgg, dong, name) => CONFIG.landLink(sgg, dong, name),
  toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(U._t); U._t = setTimeout(() => { el.hidden = true; }, 2600);
  },
  /** 엑셀 저장. sheets = [{ name, rows: [[…], …] }] */
  xlsx(filename, sheets) {
    const wb = XLSX.utils.book_new();
    for (const s of sheets) {
      const ws = XLSX.utils.aoa_to_sheet(s.rows);
      const head = s.rows[0] || [];
      ws['!cols'] = head.map((h, i) => ({
        wch: Math.min(40, Math.max(String(h).length * 2, ...s.rows.slice(1, 200).map(r => String(r[i] ?? '').length * 1.3)) + 2),
      }));
      XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
    }
    XLSX.writeFile(wb, filename);
  },
  stamp: () => { const t = new Date(); return `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}`; },
};

/* 브라우저 저장소 (트래킹 목록·그룹핑 표 보관) */
const Store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { U.toast('브라우저 저장에 실패했습니다. 백업 파일로 저장해 두세요.'); return false; }
  },
};
