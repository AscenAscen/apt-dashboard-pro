/* ───────────── 월간 요약 ─────────────
   data/monthly_summary.json (scripts/monthly_summary.py 가 자동 수집 때 만듦) 을 보여줍니다. */
const Monthly = (() => {
  const $ = (id) => document.getElementById(id);
  let J = null, ready = false;
  const lab = (m) => `${String(m).slice(0, 4)}년 ${+String(m).slice(4)}월`;
  const eok = (v) => (v == null ? '-' : (v / 10000).toFixed(2).replace(/\.?0+$/, '') + '억');
  const dif = (v) => (v == null ? '-' : v === 0 ? '0' : `<span class="${v > 0 ? 'up' : 'down'}">${v > 0 ? '+' : '−'}${Math.abs(v / 10000).toFixed(2).replace(/\.?0+$/, '')}억</span>`);
  function render() {
    const m = $('msMonth').value, d = J && J.months[m], out = $('msOut');
    if (!d) { out.innerHTML = '<p class="hint">이 달 요약이 없습니다.</p>'; return; }
    const rg = Object.values(d.regions).filter(r => r.n > 0).sort((a, b) => b.n - a.n).slice(0, 40);
    const tr = (x, kind) => `<tr><td class="l">${U.esc(x.sgg)} ${U.esc(x.dong)} <b>${U.esc(x.name)}</b></td><td>${x.g}㎡</td><td>${eok(x.price)}</td><td>${eok(x.prev)}</td><td class="${kind === 'h' ? 'up' : 'down'}">${x.pct > 0 ? '+' : ''}${x.pct}%</td><td>${U.date(x.d)}</td></tr>`;
    const head = '<thead><tr><th class="l">단지</th><th>평형</th><th>거래가</th><th>직전 기준가</th><th>변화</th><th>거래일</th></tr></thead>';
    out.innerHTML = `<p class="hint">갱신 ${U.esc(J.updated)} · 금액은 평균(만원 단위 자료). 투자금 = 평균 매매가 − 평균 전세가.</p>
      <h4>지역별 (거래 많은 순 40곳)</h4><div class="tablewrap short"><table class="grid"><thead><tr><th class="l">지역</th><th>매매 건수</th><th>84㎡ 매매</th><th>전월 대비</th><th>84㎡ 투자금</th><th>전월 대비</th><th>59㎡ 매매</th><th>59㎡ 투자금</th></tr></thead><tbody>` +
      rg.map(r => `<tr><td class="l">${U.esc(r.name)}</td><td>${r.n}</td><td>${eok(r.s84)}</td><td>${dif(r.ds84)}</td><td>${eok(r.inv84)}</td><td>${dif(r.dinv84)}</td><td>${eok(r.s59)}</td><td>${eok(r.inv59)}</td></tr>`).join('') + '</tbody></table></div>' +
      `<h4>신고가 (${d.highs.length}건, 상승률 큰 순)</h4><div class="tablewrap short"><table class="grid">${head}<tbody>${d.highs.slice(0, 50).map(x => tr(x, 'h')).join('')}</tbody></table></div>` +
      `<h4>급락 거래 (${d.drops.length}건, 직전보다 10%↓)</h4><div class="tablewrap short"><table class="grid">${head}<tbody>${d.drops.slice(0, 50).map(x => tr(x, 'd')).join('')}</tbody></table></div>`;
  }
  async function open() {
    if (!$('msMonth')) return;
    if (!ready) {
      ready = true;
      J = await Data.monthly();
      if (!J || !J.months) { $('msOut').innerHTML = '<p class="hint">아직 월간 요약이 없습니다. 자동 수집이 한 번 돌고 나면 생깁니다. (scripts/monthly_summary.py)</p>'; $('msMonth').innerHTML = ''; return; }
      $('msMonth').innerHTML = Object.keys(J.months).sort().reverse().map(m => `<option value="${m}">${lab(m)}</option>`).join('');
      $('msMonth').onchange = render;
      $('btnMsExcel').onclick = () => {
        const d = J.months[$('msMonth').value]; if (!d) return;
        U.download(`월간요약_${$('msMonth').value}`, [
          { name: '지역별', rows: [['지역', '매매건수', '84㎡매매', '84전월대비', '84투자금', '84투자금변화', '59㎡매매', '59투자금'], ...Object.values(d.regions).map(r => [r.name, r.n, r.s84, r.ds84, r.inv84, r.dinv84, r.s59, r.inv59])] },
          { name: '신고가', rows: [['지역', '동', '단지', '평형', '거래가', '직전최고', '변화%', '거래일'], ...d.highs.map(x => [x.sgg, x.dong, x.name, x.g, x.price, x.prev, x.pct, x.d])] },
          { name: '급락', rows: [['지역', '동', '단지', '평형', '거래가', '직전가', '변화%', '거래일'], ...d.drops.map(x => [x.sgg, x.dong, x.name, x.g, x.price, x.prev, x.pct, x.d])] }], 'xlsx');
      };
    }
    render();
  }
  return { open };
})();
