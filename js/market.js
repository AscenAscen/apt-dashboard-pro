/* ─────────────────────────────────────────────────────────
   market.js — [시장 신호] 탭
   · 신고가·급락 알림판, 지역 온도 점수, 히트맵  ← data/signals.json (자동 수집 때 계산)
   · 가격지수 흐름: 한국부동산원 R-ONE (data/rone.json) + KB 시세 엑셀(직접 올림, 이 브라우저에만 저장)
   온도 점수 공식은 js/config.js 의 TEMP 에서 바꿉니다.
   ───────────────────────────────────────────────────────── */
const Market = (() => {
  const $ = (id) => document.getElementById(id);
  const KBKEY = 'apt.kb.v1', KBWKEY = 'apt.kbw.v1';
  const SHORT = { 서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천', 광주광역시: '광주', 대전광역시: '대전', 울산광역시: '울산', 세종특별자치시: '세종',
    경기도: '경기', 강원특별자치도: '강원', 강원도: '강원', 충청북도: '충북', 충청남도: '충남', 전북특별자치도: '전북', 전라북도: '전북', 전라남도: '전남', 경상북도: '경북', 경상남도: '경남', 제주특별자치도: '제주' };
  const SCOPES = [['pin', '📌 핀한 지역'], ['seoul', '서울'], ['gg', '경기·인천'], ['metro', '광역시·세종'], ['etc', '그 외 지역'], ['all', '전체']];
  let regions = [], sig = null, rone = null, kind = 'highs', chart = null, opened = false, roneMap = null, kbBook = null;

  const inScope = (r, sc) => {
    const s = SHORT[r[1]] || r[1];
    if (sc === 'pin') return Pins.has(r[0]);
    if (sc === 'seoul') return s === '서울';
    if (sc === 'gg') return s === '경기' || s === '인천';
    if (sc === 'metro') return ['부산', '대구', '광주', '대전', '울산', '세종'].includes(s);
    if (sc === 'etc') return !['서울', '경기', '인천', '부산', '대구', '광주', '대전', '울산', '세종'].includes(s);
    return true;
  };
  const scoped = () => regions.filter(r => sig?.regions[r[0]] && inScope(r, $('mkScope').value));
  const avg = (a) => { const v = a.filter(x => x != null); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
  const clamp = (v) => Math.max(-1, Math.min(1, v));

  /** 지역 온도 점수 (0~100, 50 = 보통). 이번 달(맨 끝)은 신고가 덜 끝나 계산에서 뺌 */
  function temp(x) {
    const T = CONFIG.TEMP, n = x.v.length - 1;
    const v3 = avg(x.v.slice(n - 3, n)), v12 = avg(x.v.slice(Math.max(0, n - 15), n - 3));
    if (!v12) return null;
    const vol = v3 / v12 - 1;
    const p3 = avg(x.p.slice(n - 3, n)), p0 = avg(x.p.slice(n - 6, n - 3));
    const price = p3 && p0 ? p3 / p0 - 1 : null;
    const high = x.n90 >= 10 ? x.nh90 / x.n90 : null;
    let score = 50 + T.vol * clamp(vol);
    if (price != null) score += T.price * clamp(price / T.priceFull);
    if (high != null) score += T.high * clamp(high / T.highFull - 1);
    return { score: Math.max(0, Math.min(100, Math.round(score))), vol, price, high, v3 };
  }

  async function init() {
    $('mkScope').innerHTML = SCOPES.map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
    $('mkScope').value = Store.get('apt.mkScope', Pins.list().length ? 'pin' : 'seoul');
    $('mkScope').onchange = () => { Store.set('apt.mkScope', $('mkScope').value); render(); };
    $('mkKind').onclick = (e) => { const k = e.target.dataset.k; if (!k) return; kind = k; $('mkKind').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === k)); alerts(); };
    $('mkMetric').onchange = heat;
    ['mkIdxRegion', 'mkIdxNames', 'mkIdxKind', 'mkIdxSpan', 'mkIdxBase', 'kbwShow', 'kbwNames'].forEach(id => { $(id).onchange = indexChart; });
    $('btnMkExcel').onclick = excel;
    $('mkAlert').onclick = (e) => { const tr = e.target.closest('tr[data-code]'); if (tr) { App.showTab('search'); Search.openRegion(tr.dataset.code); } };
    $('kbwFile').onchange = kbwRead;
    $('btnKbwClear').onclick = () => { if (!confirm('올려 둔 KB 주간 자료를 지울까요?')) return; Store.remove(KBWKEY); kbwFill(); indexChart(); };
    $('kbFile').onchange = kbRead;
    $('kbSheet').onchange = kbPickSheet;
    $('kbCol').onchange = () => { const kb = Store.get(KBKEY, null); if (kb) { kb.sel = $('kbCol').value; Store.set(KBKEY, kb); } indexChart(); };
    $('btnKbClear').onclick = () => { if (!confirm('올려 둔 KB 자료를 지울까요?')) return; Store.remove(KBKEY); kbBook = null; $('kbSheet').innerHTML = ''; kbFill(); indexChart(); };
  }

  async function open() {
    if (!opened) {
      opened = true;
      [regions, sig, rone] = await Promise.all([Data.regions(), Data.signals(), Data.rone()]);
      kbFill(); kbwFill();
    }
    render();
  }

  function render() {
    const has = !!sig && Object.keys(sig.regions).length > 0;
    $('mkEmpty').hidden = has; $('mkBody').hidden = !has;
    if (!has) return;
    const list = scoped(), part = list.filter(r => !sig.regions[r[0]].full).length;
    $('mkAsOf').textContent = `자료 기준 ${sig.asOf} · ${list.length}개 지역`;
    $('mkWarn').hidden = !part && list.length > 0;
    $('mkWarn').innerHTML = !list.length ? ($('mkScope').value === 'pin' ? '핀한 지역이 없습니다. [실거래 조회]에서 <b>📌 이 지역 핀</b>을 누르거나, 위에서 다른 범위를 고르세요.' : '이 범위에는 아직 수집된 지역이 없습니다.')
      : `<b>수집 중 · 참고용</b> — ${list.length}개 지역 중 ${part}곳은 2020년 이후 자료를 아직 다 받지 못했습니다. 그 지역의 신고가·온도 점수는 실제와 다를 수 있습니다. (표에 <span class="tag prov">수집 중</span> 표시)`;
    alerts(); temps(); heat(); fillIndexRegions(); indexChart();
  }

  /* ── 신고가·급락 알림판 ── */
  function alerts() {
    const map = new Map(scoped().map(r => [r[0], r]));
    const list = (sig[kind] || []).filter(x => map.has(x[0]));
    const high = kind === 'highs';
    list.sort((a, b) => (high ? b[4] / (b[6] || b[4]) - a[4] / (a[6] || a[4]) : a[4] / a[6] - b[4] / b[6]));
    $('mkAlertNote').textContent = `${list.length}건`;
    $('mkAlert').innerHTML = `<thead><tr><th class="l">지역</th><th class="l">단지</th><th>평형</th><th>거래가</th><th class="c">거래일</th><th>${high ? '직전 최고가' : '바로 앞 거래'}</th><th>차이</th></tr></thead><tbody>` +
      (list.length ? list.slice(0, 300).map(x => {
        const r = map.get(x[0]), pct = x[6] ? (x[4] / x[6] - 1) * 100 : null;
        return `<tr data-code="${x[0]}"><td class="l">${U.esc(r[2])} ${U.esc(x[1])}${sig.regions[x[0]].full ? '' : ' <span class="tag prov">수집 중</span>'}</td><td class="l">${U.esc(x[2])}</td><td>${x[3]}㎡<small>${CONFIG.toPyeong(x[3])}평</small></td>` +
          `<td class="sale">${U.price(x[4])}</td><td class="c">${U.date(x[5])}${Kit.badge(x[5])}</td><td>${U.price(x[6])}${x[7] ? `<small>${U.date(x[7])}</small>` : ''}</td><td class="${U.cls(pct)}">${U.pct(pct)}<small>${U.diff(x[4] - x[6])}</small></td></tr>`;
      }).join('') : `<tr><td colspan="7" style="color:var(--sub);padding:20px">최근 30일에 해당하는 거래가 없습니다.</td></tr>`) + '</tbody>';
  }

  /* ── 지역 온도 점수 ── */
  function tempRows() {
    return scoped().map(r => ({ r, x: sig.regions[r[0]], t: temp(sig.regions[r[0]]) })).filter(o => o.t).sort((a, b) => b.t.score - a.t.score);
  }
  function temps() {
    const rows = tempRows();
    $('mkTemp').innerHTML = '<thead><tr><th class="l">지역</th><th class="l" style="min-width:170px">온도 점수</th><th>거래량<small>최근 3개월 월평균</small></th><th>거래량 변화</th><th>가격 변화</th><th>신고가 비율</th><th>12개월 거래량</th></tr></thead><tbody>' +
      (rows.length ? rows.map(({ r, x, t }) => `<tr><td class="l">${U.esc(SHORT[r[1]] || r[1])} ${U.esc(r[2])}${x.full ? '' : ' <span class="tag prov">수집 중</span>'}</td>` +
        `<td class="l"><div class="tbar"><i style="width:${t.score}%;background:${heatColor((t.score - 50) / 50)}"></i><b>${t.score}</b> <small>${CONFIG.tempLabel(t.score)}</small></div></td>` +
        `<td>${t.v3.toFixed(0)}건</td><td class="${U.cls(t.vol)}">${U.pct(t.vol * 100, 0)}</td><td class="${U.cls(t.price)}">${t.price == null ? '-' : U.pct(t.price * 100)}</td>` +
        `<td>${t.high == null ? '<small>거래 적음</small>' : (t.high * 100).toFixed(0) + '%'}<small>${x.nh90}/${x.n90}건</small></td><td>${Kit.spark(x.v.slice(-13, -1))}</td></tr>`).join('')
        : '<tr><td colspan="7" style="color:var(--sub);padding:20px">점수를 계산할 만큼 자료가 쌓인 지역이 없습니다.</td></tr>') + '</tbody>';
  }
  function excel() {
    const rows = tempRows();
    if (!rows.length) return U.toast('내려받을 내용이 없습니다.');
    U.download(`지역온도_${U.stamp()}`, [{ name: '온도 점수', rows: [['시도', '시군구', '온도 점수', '구분', '최근 3개월 월평균 거래', '거래량 변화(%)', '가격 변화(%)', '신고가 비율(%)', '2020년 이후 수집 완료'],
      ...rows.map(({ r, x, t }) => [r[1], r[2], t.score, CONFIG.tempLabel(t.score), +t.v3.toFixed(1), +(t.vol * 100).toFixed(1), t.price == null ? '' : +(t.price * 100).toFixed(2), t.high == null ? '' : +(t.high * 100).toFixed(1), x.full ? 'O' : '수집 중'])] }]);
  }

  /* ── 히트맵 ── */
  /** -1(파랑) ~ 0 ~ +1(빨강) → 색 */
  function heatColor(v) {
    if (v == null || isNaN(v)) return 'transparent';
    const a = Math.min(1, Math.abs(v));
    return v >= 0 ? `rgba(255,92,92,${(0.12 + a * 0.6).toFixed(2)})` : `rgba(79,156,255,${(0.12 + a * 0.6).toFixed(2)})`;
  }
  const norm = (s) => String(s).replace(/[^가-힣0-9A-Za-z]/g, '');
  /** 우리 지역 → R-ONE 지역 이름 찾기 (예: 경기도 / 안양시 동안구 → "경기>안양시>동안구") */
  function roneName(reg, kindKey) {
    if (!rone || !rone[kindKey]) return null;
    roneMap = roneMap || {};
    const ck = kindKey + reg[0];
    if (ck in roneMap) return roneMap[ck];
    const short = SHORT[reg[1]] || reg[1], sgg = norm(reg[2]);
    const cand = Object.keys(rone[kindKey]).filter(n => { const x = norm(n); return x.endsWith(sgg) && (x.includes(short) || x.includes(norm(reg[1]))); })
      .sort((a, b) => a.length - b.length);
    return (roneMap[ck] = cand[0] || null);
  }
  function heat() {
    const metric = $('mkMetric').value, list = scoped();
    const isRone = metric === 'rs' || metric === 'rr', rk = metric === 'rs' ? 'sale' : 'rent';
    let months = sig.months.slice(-12), rows = [];
    const mom = (arr) => arr.map((v, i) => (i && v != null && arr[i - 1] ? (v / arr[i - 1] - 1) * 100 : null));
    if (isRone) {
      if (!rone || !Object.keys(rone[rk] || {}).length) { $('mkHeatNote').innerHTML = 'R-ONE 자료가 아직 없습니다. <b>가이드·설정 → 점검</b>에서 상태를 확인하세요.'; $('mkHeat').innerHTML = ''; return; }
      const all = new Set(); list.forEach(r => { const n = roneName(r, rk); if (n) rone[rk][n].forEach(([ym]) => all.add(ym)); });
      months = [...all].sort((a, b) => a - b).slice(-12);
      rows = list.map(r => { const n = roneName(r, rk); if (!n) return null; const m = new Map(rone[rk][n]); const ext = [...all].sort((a, b) => a - b).slice(-13).map(ym => m.get(ym) ?? null); return { r, vals: mom(ext).slice(-months.length), kind: 'pct', full: 0.8 }; }).filter(Boolean);
      $('mkHeatNote').textContent = `한국부동산원 아파트 ${rk === 'sale' ? '매매' : '전세'}가격지수의 전월 대비 변동률(%)입니다. 빨강 = 상승, 파랑 = 하락. (기준 ${rone.asOf})`;
    } else if (metric === 'p') {
      rows = list.map(r => { const x = sig.regions[r[0]]; return { r, vals: mom(x.p.slice(-13)), kind: 'pct', full: 4, part: !x.full }; });
      $('mkHeatNote').textContent = '그 달에 거래된 아파트의 ㎡당 가격 중앙값이 전달보다 얼마나 변했는지(%)입니다. 그 달에 어떤 집이 팔렸느냐에 따라 출렁이므로 흐름만 보세요. 거래 5건 미만인 달은 비워 둡니다. 맨 오른쪽(이번 달)은 집계 중입니다.';
    } else {
      rows = list.map(r => { const x = sig.regions[r[0]]; return { r, vals: x[metric].slice(-12), kind: 'cnt', part: !x.full }; });
      $('mkHeatNote').textContent = `${metric === 'v' ? '매매' : '전세'} 거래 건수입니다. 색이 진할수록 그 지역의 12개월 중 거래가 많았던 달입니다. 맨 오른쪽(이번 달)은 신고가 덜 끝나 적게 보입니다.`;
    }
    $('mkHeat').innerHTML = '<thead><tr><th class="l">지역</th>' + months.map((m, i) => `<th>${Kit.ymText(m)}${!isRone && i === months.length - 1 ? '<small>집계 중</small>' : ''}</th>`).join('') + '</tr></thead><tbody>' +
      (rows.length ? rows.map(o => {
        const max = Math.max(1, ...o.vals.filter(v => v != null));
        return `<tr><td class="l">${U.esc(SHORT[o.r[1]] || o.r[1])} ${U.esc(o.r[2])}${o.part ? ' <span class="tag prov">수집 중</span>' : ''}</td>` + o.vals.map(v => (v == null ? '<td class="none">·</td>'
          : o.kind === 'cnt' ? `<td style="background:rgba(79,156,255,${(v / max * 0.7).toFixed(2)})">${v.toLocaleString()}</td>` : `<td style="background:${heatColor(v / o.full)}">${v > 0 ? '+' : ''}${v.toFixed(o.full < 1 ? 2 : 1)}</td>`)).join('') + '</tr>';
      }).join('') : `<tr><td colspan="${months.length + 1}" style="color:var(--sub);padding:20px">보여 줄 지역이 없습니다.</td></tr>`) + '</tbody>';
  }

  /* ── 가격지수 흐름 (R-ONE + KB) ── */
  function fillIndexRegions() {
    const cur = $('mkIdxRegion').value, list = scoped();
    $('mkIdxRegion').innerHTML = '<option value="">(R-ONE 지역 고르기)</option>' + list.map(r => `<option value="${r[0]}">${U.esc(SHORT[r[1]] || r[1])} ${U.esc(r[2])}</option>`).join('');
    $('mkIdxRegion').value = list.some(r => r[0] === cur) ? cur : (list[0]?.[0] || '');
    // R-ONE 에 있는 지역 이름을 그대로 고르기 (전국·시도·권역 포함). 여러 개를 Ctrl/⌘ 로 함께 고를 수 있음
    const names = [...new Set([...Object.keys(rone?.sale || {}), ...Object.keys(rone?.rent || {})])].sort((a, b) => a.split('>').length - b.split('>').length || a.localeCompare(b, 'ko'));
    const keep = new Set([...$('mkIdxNames').selectedOptions].map(o => o.value));
    $('mkIdxNames').innerHTML = names.map(n => `<option value="${U.esc(n)}" ${keep.has(n) ? 'selected' : ''}>${U.esc(n.replace(/>/g, ' '))}</option>`).join('');
  }
  function indexChart() {
    const css = getComputedStyle(document.documentElement), col = (n) => css.getPropertyValue(n).trim();
    const reg = regions.find(r => r[0] === $('mkIdxRegion').value), sets = [], notes = [];
    const toX = (ym, day = 15) => Math.floor(ym / 100) * 12 + (ym % 100 - 1) + day / 31;
    const want = $('mkIdxKind').value, span = +$('mkIdxSpan').value, rebase = $('mkIdxBase').checked;
    const kinds = [['sale', '매매지수', '--accent'], ['rent', '전세지수', '--rent']].filter(k => want === 'both' || want === k[0]);
    const nowYm = new Date().getFullYear() * 100 + new Date().getMonth() + 1, fromYm = span ? (Math.floor(nowYm / 100) * 12 + nowYm % 100 - 1 - span) : 0;
    const cut = (arr) => { const a = arr.filter(([ym]) => !span || Math.floor(ym / 100) * 12 + ym % 100 - 1 >= fromYm); const b0 = a[0]?.[1]; return a.map(([ym, v]) => ({ x: toX(ym), y: rebase && b0 ? +(v / b0 * 100).toFixed(2) : v })); };
    const picked = [...$('mkIdxNames').selectedOptions].map(o => o.value), PAL = ['#ff9500', '#af52de', '#5ac8fa', '#ff2d55', '#ffcc00', '#30d158', '#64d2ff', '#bf5af2'];
    let pi = 0;
    if (rone) for (const n of picked) for (const [k, name] of kinds) {             // 직접 고른 지역들
      if (!rone[k]?.[n]) continue; const c = PAL[pi++ % PAL.length];
      sets.push({ label: `${n.replace(/>/g, ' ')} ${name}`, data: cut(rone[k][n]), borderColor: c, backgroundColor: c, borderWidth: 2, pointRadius: 0, tension: 0.2, borderDash: k === 'rent' ? [6, 3] : [] });
    }
    if (reg && rone) {
      for (const [k, name, c] of kinds) {
        const n = roneName(reg, k);
        if (n && !picked.includes(n)) sets.push({ label: `R-ONE ${name} (${n})`, data: cut(rone[k][n]), borderColor: col(c), backgroundColor: col(c), borderWidth: 2, pointRadius: 0, tension: 0.2 });
      }
      if (rebase) notes.push('기간의 첫 달을 100으로 맞춰 견줍니다');
      if (!sets.length) notes.push(`R-ONE 에서 "${reg[2]}" 지역을 찾지 못했습니다. (R-ONE 은 시·구 단위 일부만 제공합니다)`);
    } else if (!rone) notes.push('R-ONE 자료가 아직 없습니다. 점검 화면(가이드·설정)에서 상태를 볼 수 있습니다.');
    const kbw = Store.get(KBWKEY, null);
    if (kbw && $('kbwShow').checked) {                                          // KB 주간 지수 (월 평균)
      const KP = ['#34c759', '#ffd60a', '#0a84ff', '#ff6482', '#bf5af2', '#ff9f0a'], names = [];
      if (reg) { const k = `${reg[1]} ${reg[2]}`; if (kbw.keys.includes(k)) names.push(k); }
      for (const o of $('kbwNames').selectedOptions) if (!names.includes(o.value)) names.push(o.value);
      let ki = 0;
      for (const n of names) for (const [k, name] of kinds) {
        const arr = kbw[k]?.[n]; if (!arr) continue;
        const pts = kbw.months.map((m, i) => [m, arr[i]]).filter(x => x[1] != null), c = KP[ki++ % KP.length];
        sets.push({ label: `KB ${name} (${n})`, data: cut(pts), borderColor: c, backgroundColor: c, borderWidth: 2, pointRadius: 0, tension: 0.2, borderDash: [2, 3] });
      }
      notes.push(`KB 주간 자료: ${kbw.file} (${kbw.at} 올림, 기준 ${kbw.last})`);
      if (reg && !kbw.keys.includes(`${reg[1]} ${reg[2]}`)) notes.push(`KB 에서 "${reg[2]}" 지역을 찾지 못했습니다 (위 KB 지역 목록에서 직접 고를 수 있습니다)`);
    }
    const kb = Store.get(KBKEY, null);
    if (kb && kb.sel && kb.cols[kb.sel]) {
      sets.push({ label: `KB ${kb.sheet} · ${kb.sel}`, data: kb.cols[kb.sel].map(([d, v]) => ({ x: toX(Math.floor(d / 100), d % 100), y: v })), borderColor: col('--c3') || '#34c759', backgroundColor: col('--c3') || '#34c759', borderWidth: 2, pointRadius: 0, tension: 0.2, borderDash: [5, 3] });
      notes.push(`KB 자료: ${kb.file} (${kb.at} 올림)`);
    }
    $('mkIdxNote').textContent = notes.join(' · ');
    if (chart) chart.destroy();
    chart = new Chart($('mkIdxChart'), { type: 'line', data: { datasets: sets },
      options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'nearest', intersect: false },
        scales: { x: { type: 'linear', ticks: { color: col('--sub'), callback: (v) => `${String(Math.floor(v / 12)).slice(2)}.${String(Math.floor(v % 12) + 1).padStart(2, '0')}`, stepSize: 6 }, grid: { color: col('--line') } },
          y: { ticks: { color: col('--sub') }, grid: { color: col('--line') } } },
        plugins: { legend: { labels: { color: col('--text') } }, tooltip: { callbacks: { title: (items) => { const v = items[0].parsed.x; return `${Math.floor(v / 12)}년 ${Math.floor(v % 12) + 1}월`; } } } } } });
  }

  /* ── KB 엑셀: 날짜가 세로, 지역이 가로로 놓인 표를 읽음 ── */
  const isDate = (v) => v instanceof Date || (typeof v === 'number' && v > 30000 && v < 60000) || (typeof v === 'string' && /^\s*(19|20)\d{2}\s*[.\-\/년]\s*\d{1,2}/.test(v));
  function toYmd(v) {
    if (v instanceof Date) return v.getFullYear() * 10000 + (v.getMonth() + 1) * 100 + v.getDate();
    if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 864e5)); return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); }
    const m = String(v).match(/((?:19|20)\d{2})\D+(\d{1,2})(?:\D+(\d{1,2}))?/);
    return m ? +m[1] * 10000 + +m[2] * 100 + (+m[3] || 15) : 0;
  }
  function kbRead(e) {
    const file = e.target.files[0];
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        kbBook = { file: file.name, wb: XLSX.read(fr.result, { type: 'array', cellDates: true }) };
        const names = kbBook.wb.SheetNames;
        $('kbSheet').innerHTML = names.map(n => `<option>${U.esc(n)}</option>`).join('');
        const guess = names.find(n => /매매/.test(n) && /아파트|APT/i.test(n)) || names.find(n => /매매/.test(n)) || names[0];
        $('kbSheet').value = guess;
        kbPickSheet();
      } catch (err) { console.error(err); U.toast('엑셀 파일을 읽지 못했습니다: ' + (err.message || err)); }
    };
    fr.readAsArrayBuffer(file);
    e.target.value = '';
  }
  function kbPickSheet() {
    if (!kbBook) return;
    const sheet = $('kbSheet').value, rows = XLSX.utils.sheet_to_json(kbBook.wb.Sheets[sheet], { header: 1, raw: true, defval: null });
    const r0 = rows.findIndex((r, i) => i > 0 && r && isDate(r[0]));
    if (r0 < 1) return U.toast('이 시트에서 날짜 줄을 찾지 못했습니다. 다른 시트를 골라 보세요. (첫 열이 날짜인 표여야 합니다)');
    const head = rows.slice(0, r0), width = Math.max(...rows.slice(0, r0 + 3).map(r => (r || []).length)), cols = {};
    const data = rows.slice(r0).filter(r => r && isDate(r[0])).slice(-130);
    for (let c = 1; c < width; c++) {
      let name = '';
      for (const h of head) { const v = h?.[c]; if (typeof v === 'string' && v.trim()) name = v.replace(/\s+/g, ' ').trim(); }
      if (!name) continue;
      const series = data.map(r => [toYmd(r[0]), typeof r[c] === 'number' ? +r[c].toFixed(3) : null]).filter(x => x[0] && x[1] != null);
      if (series.length < 3) continue;
      let key = name, k = 2; while (cols[key]) key = `${name} (${k++})`;
      cols[key] = series;
    }
    if (!Object.keys(cols).length) return U.toast('이 시트에서 숫자 열을 찾지 못했습니다.');
    const old = Store.get(KBKEY, null), t = new Date();
    const kb = { file: kbBook.file, sheet, at: `${t.getMonth() + 1}/${t.getDate()}`, cols, sel: old?.sel && cols[old.sel] ? old.sel : Object.keys(cols)[0] };
    if (!Store.set(KBKEY, kb)) return;
    kbFill(); indexChart();
    U.toast(`KB 자료 ${Object.keys(cols).length}개 지역(열)을 읽었습니다.`);
  }
  function kbFill() {
    const kb = Store.get(KBKEY, null);
    $('kbCol').innerHTML = kb ? Object.keys(kb.cols).map(n => `<option>${U.esc(n)}</option>`).join('') : '';
    if (kb) { $('kbCol').value = kb.sel; if (!kbBook) $('kbSheet').innerHTML = `<option>${U.esc(kb.sheet)}</option>`; }
    $('btnKbClear').hidden = !kb;
  }

  /* ── KB 주간 시계열 (3.매매지수 · 4.전세지수): 날짜 세로 · 지역 가로 → 월 평균 지수 ── */
  const KB_SIDO = { 서울특별시: '서울특별시', 부산광역시: '부산광역시', 대구광역시: '대구광역시', 인천광역시: '인천광역시', '(구)광주광역시': '광주광역시', 대전광역시: '대전광역시', 울산광역시: '울산광역시',
    세종특별자치시: '세종특별자치시', 경기도: '경기도', 강원특별자치도: '강원특별자치도', 충청북도: '충청북도', 충청남도: '충청남도', 전북특별자치도: '전북특별자치도', '(구)전라남도': '전라남도',
    경상북도: '경상북도', 경상남도: '경상남도', 제주특별자치도: '제주특별자치도' };
  /** 헤더(구분 줄)로 열마다 "시도 [시] 구" 이름을 만듦. 중구·동구·서구처럼 이름이 겹쳐도 시도·시 단위로 구분됨. 묶음 열(전국·6개광역시 등)은 null */
  function kbwKeys(head) {
    const out = []; let sido = '', city = '';
    const names = head.map(h => (h == null ? '' : String(h).replace(/\s+/g, ' ').trim()));
    for (let c = 0; c < names.length; c++) {
      const n = names[c]; let key = null;
      if (c === 0 || !n) { out.push(null); continue; }
      if (KB_SIDO[n]) { sido = KB_SIDO[n]; city = ''; key = sido; }
      else if (/^(전국|강북14개구|강남11개구|\d개광역시|수도권|기타지방|제주도|전남광주통합특별시)$/.test(n)) key = null;
      else if (!sido) key = null;
      else if (/시$/.test(n) && /구$/.test(names[c + 1] || '') && !/(남구|북구|동구|서구|중구)$/.test(n)) { city = n; key = `${sido} ${n}`; }
      else if (/시$|군$/.test(n)) { city = ''; key = `${sido} ${n}`; }
      else key = `${sido} ${city ? city + ' ' : ''}${n}`;
      out.push(key);
    }
    return out;
  }
  function kbwSheet(wb, re) {
    const name = wb.SheetNames.find(n => re.test(n) && !/증감/.test(n));
    if (!name) return null;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
    const r0 = rows.findIndex((r, i) => i > 0 && r && isDate(r[0]));
    if (r0 < 2) return null;
    const keys = kbwKeys(rows[1] || rows[r0 - 1]), byM = new Map();     // 월 → 열별 [합, 개수]
    for (const r of rows.slice(r0)) {
      if (!r || !isDate(r[0])) continue;
      const m = Math.floor(toYmd(r[0]) / 100); if (!m) continue;
      let a = byM.get(m); if (!a) byM.set(m, a = []);
      for (let c = 1; c < keys.length; c++) if (keys[c] && typeof r[c] === 'number') { const x = a[c] || (a[c] = [0, 0]); x[0] += r[c]; x[1]++; }
    }
    return { keys, byM };
  }
  function kbwParse(wb, file) {
    const S = kbwSheet(wb, /매매.*지수/), R = kbwSheet(wb, /전세.*지수/);
    if (!S && !R) return null;
    const MAXM = 150;                                                      // 최근 12.5년까지만 저장 (용량)
    const months = [...new Set([...(S?.byM.keys() || []), ...(R?.byM.keys() || [])])].sort((a, b) => a - b).slice(-MAXM);
    const out = { file, at: (() => { const t = new Date(); return `${t.getMonth() + 1}/${t.getDate()}`; })(), months, last: months[months.length - 1], sale: {}, rent: {}, keys: [] };
    for (const [k, X] of [['sale', S], ['rent', R]]) if (X) X.keys.forEach((key, c) => {
      if (!key) return;
      const arr = months.map(m => { const x = X.byM.get(m)?.[c]; return x ? +(x[0] / x[1]).toFixed(2) : null; });
      if (arr.filter(v => v != null).length < 3) return;
      if (out[k][key]) return;                                              // 같은 이름이 또 나오면 처음 것을 유지
      out[k][key] = arr; if (!out.keys.includes(key)) out.keys.push(key);
    });
    return out;
  }
  function kbwRead(e) {
    const file = e.target.files[0]; if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const wb = XLSX.read(fr.result, { type: 'array', cellDates: true }), kb = kbwParse(wb, file.name);
        if (!kb) return U.toast('"3.매매지수" / "4.전세지수" 시트를 찾지 못했습니다. KB 주간 시계열 파일이 맞는지 확인해 주세요.');
        if (!Store.set(KBWKEY, kb)) return;
        kbwFill(); indexChart();
        U.toast(`KB 주간 자료 ${kb.keys.length}개 지역을 월 평균으로 저장했습니다. (기준 ${kb.last})`);
      } catch (err) { console.error(err); U.toast('엑셀 파일을 읽지 못했습니다: ' + (err.message || err)); }
    };
    fr.readAsArrayBuffer(file); e.target.value = '';
  }
  function kbwFill() {
    const kb = Store.get(KBWKEY, null), keep = new Set([...$('kbwNames').selectedOptions].map(o => o.value));
    $('kbwNames').innerHTML = kb ? kb.keys.map(n => `<option value="${U.esc(n)}" ${keep.has(n) ? 'selected' : ''}>${U.esc(n)}</option>`).join('') : '';
    $('btnKbwClear').hidden = !kb;
    if (kb) {
      const have = new Set(kb.keys), miss = regions.filter(r => !have.has(`${r[1]} ${r[2]}`)).length;
      $('kbwNote').textContent = `${kb.file} · 지역 ${kb.keys.length}개 · 월 평균 ${kb.months.length}개월 (기준 ${kb.last}) · 이 대시보드 지역 중 KB 에서 못 찾은 곳 ${miss}곳 (KB 는 주요 시·구만 제공해 군 단위는 없습니다). KB 지수는 2026.1.12 = 100 기준이라 R-ONE 과 견줄 때는 [첫 달 = 100] 을 켜세요.`;
    }
  }

  /** 다른 탭(리포트)에서 쓰는: 지역코드 → 온도 점수 */
  async function tempOf(code) {
    sig = sig || await Data.signals();
    const x = sig?.regions[code];
    return x ? { ...temp(x), full: x.full } : null;
  }
  return { init, open, tempOf };
})();
