/* ─────────────────────────────────────────────────────────
   home.js — [최근 거래] 탭 (첫 화면)
   지역별 최근 1개월 거래 현황. 순서: 서울 → 수도권(경기·인천) → 광역시 (→ 그 외 지역은 체크 시)
   자료: data/summary.json (자동 수집 때마다 새로 만들어짐)
   ───────────────────────────────────────────────────────── */
const Home = (() => {
  const $ = (id) => document.getElementById(id);
  // 묶음 순서와 이름. 순서를 바꾸려면 이 줄의 순서만 바꾸면 됩니다.
  const GROUPS = [
    { name: '서울', test: (sido) => sido.startsWith('서울') },
    { name: '수도권 (경기·인천)', test: (sido) => sido.startsWith('경기') || sido.startsWith('인천') },
    { name: '광역시', test: (sido) => /^(부산|대구|광주|대전|울산)/.test(sido) },
    { name: '그 외 지역', test: () => true, extra: true },
  ];
  let rows = [], sort = { col: 's', dir: -1 }, info = null;

  const COLS = [
    { id: 'name', label: '지역', cls: 'l', val: r => r.name },
    { id: 's', label: '매매 (최근 1개월)', val: r => r.s },
    { id: 'sp', label: '직전 1개월', val: r => r.sp },
    { id: 'chg', label: '증감', val: r => r.chg ?? -9999 },
    { id: 'r', label: '전세 (최근 1개월)', val: r => r.r },
    { id: 'avg', label: '매매 평균가', val: r => r.avg ?? -1 },
    { id: 'top', label: '최고가 거래', cls: 'l', val: r => (r.top ? r.top[3] : -1) },
  ];

  async function init() {
    const [regions, sum] = await Promise.all([Data.regions(), Data.summary()]);
    $('homeAll').onchange = render;
    if (!sum) {
      $('homeTable').parentElement.hidden = true;
      $('homeEmpty').hidden = false;
      $('homeEmpty').innerHTML = '거래 현황 요약이 아직 없습니다.<br>다음 자동 수집(매일 새벽 4시·오후 1시경)이 끝나면 표시됩니다. 바로 보려면 GitHub Actions 에서 [Run workflow] 를 누르세요.';
      return;
    }
    info = sum;
    $('homeTitle').textContent = `최근 1개월 거래 현황 (${sum.asOf} 기준, 계약일 기준 최근 ${sum.days}일)`;
    rows = regions.filter(r => sum.regions[r[0]]).map(r => {
      const v = sum.regions[r[0]];
      return { code: r[0], sido: r[1], sgg: r[2], name: `${U.siGu(r[1], r[2]).filter(Boolean).join(' ')}`, ...v,
        chg: v.sp ? (v.s / v.sp - 1) * 100 : null, group: GROUPS.findIndex(g => g.test(r[1])) };
    });
    render();
  }

  function render() {
    const showExtra = $('homeAll').checked;
    const col = COLS.find(c => c.id === sort.col);
    const head = '<thead><tr>' + COLS.map(c => `<th class="sortable ${c.cls || ''}" data-col="${c.id}">${c.label}${sort.col === c.id ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('') + '</tr></thead>';
    let body = '';
    GROUPS.forEach((g, gi) => {
      if (g.extra && !showExtra) return;
      const list = rows.filter(r => r.group === gi).sort((a, b) => {
        const x = col.val(a), y = col.val(b);
        return (typeof x === 'string' ? x.localeCompare(y, 'ko') : x - y) * sort.dir || b.s - a.s;
      });
      if (!list.length) return;
      const s = list.reduce((t, r) => t + r.s, 0), sp = list.reduce((t, r) => t + r.sp, 0), rr = list.reduce((t, r) => t + r.r, 0);
      const chg = sp ? (s / sp - 1) * 100 : null;
      body += `<tr class="group"><td class="l">${g.name} <small>${list.length}개 지역</small></td><td>${s.toLocaleString()}</td><td>${sp.toLocaleString()}</td>` +
        `<td class="${U.cls(chg)}">${U.pct(chg, 0)}</td><td>${rr.toLocaleString()}</td><td></td><td></td></tr>`;
      body += list.map(r => `<tr class="reg" data-code="${r.code}"><td class="l">${U.esc(r.name)}</td><td class="sale">${r.s.toLocaleString()}</td><td>${r.sp.toLocaleString()}</td>` +
        `<td class="${U.cls(r.chg)}">${U.pct(r.chg, 0)}</td><td class="rent">${r.r.toLocaleString()}</td><td>${r.avg ? U.price(r.avg) : '-'}</td>` +
        `<td class="l">${r.top ? `${U.esc(r.top[0])} ${U.esc(r.top[1])} ${r.top[2]}㎡ <b>${U.price(r.top[3])}</b><small>${U.date(r.top[4])}</small>` : '-'}</td></tr>`).join('');
    });
    const table = $('homeTable');
    table.innerHTML = head + `<tbody>${body}</tbody>`;
    table.querySelectorAll('th.sortable').forEach(th => {
      th.onclick = () => { sort = { col: th.dataset.col, dir: sort.col === th.dataset.col ? -sort.dir : (th.dataset.col === 'name' ? 1 : -1) }; render(); };
    });
    table.querySelector('tbody').onclick = (e) => {
      const tr = e.target.closest('tr.reg');
      if (tr) { App.showTab('search'); Search.openRegion(tr.dataset.code); }
    };
  }

  return { init };
})();
