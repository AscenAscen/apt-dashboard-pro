/* ───────────── 그래프 공통 모양 (모든 탭의 그래프가 함께 씀) ─────────────
   · 색: 매매 주황 · 전세 청록 · 내 호가 파랑 (css 의 --c-sale/--c-rent/--c-quote)
   · 글꼴·격자·말풍선(툴팁)·범례 모양을 한 곳에서 정함
   · 덧그리기: ckPeak(전고점 점선+이름표) · ckCross(마우스 세로선) · ckEnd({unit, dec} 선 끝 값 이름표) · ckBand(두 선 사이 색칠)
   · 도구: ma(3개월 평균선) · range(1년/3년/전체 버튼) · spark(작은 추세선 SVG) */
const CK = (() => {
  const v = (n, d) => (getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d);
  const C = { sale: () => v('--c-sale', '#d95926'), rent: () => v('--c-rent', '#199e70'), quote: () => v('--c-quote', '#3987e5'),
    text: () => v('--text', '#f2f3f5'), sub: () => v('--sub', '#9aa0a9'), line: () => v('--line', '#2a2c31'), panel: () => v('--panel', '#101113') };
  const alpha = (hex, a) => { const h = String(hex).replace('#', ''); if (h.length !== 6) return hex; const n = parseInt(h, 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };

  function theme() {
    if (typeof Chart === 'undefined') return;
    const D = Chart.defaults;
    D.font.family = "'Pretendard', 'Noto Sans KR', system-ui, sans-serif"; D.font.size = 12;
    D.color = C.sub(); D.borderColor = alpha(C.line().startsWith('#') ? C.line() : '#2a2c31', .8);
    D.animation = false;
    D.elements.line.borderWidth = 2; D.elements.line.tension = 0.25;
    D.elements.point.radius = 2.5; D.elements.point.hoverRadius = 5; D.elements.point.hitRadius = 8;
    D.elements.bar.borderRadius = 4;
    D.plugins.legend.labels.usePointStyle = true; D.plugins.legend.labels.boxWidth = 8; D.plugins.legend.labels.boxHeight = 8; D.plugins.legend.labels.color = C.text(); D.plugins.legend.labels.padding = 14;
    const TT = { backgroundColor: 'rgba(15,17,22,.94)', borderColor: '#3a404c', borderWidth: 1, padding: 10, cornerRadius: 10,
      titleColor: '#f0efec', bodyColor: '#d6d9df', boxPadding: 4, usePointStyle: true, caretSize: 5 };
    for (const k in TT) D.plugins.tooltip[k] = TT[k];
    D.scale.grid.color = alpha(C.line().startsWith('#') ? C.line() : '#2a2c31', .55); D.scale.grid.tickLength = 0;
    if (D.scale.border) D.scale.border.display = false; D.scale.ticks.color = C.sub(); D.scale.ticks.padding = 6;
  }

  /* ── 덧그리기 ── */
  const plugin = {
    id: 'ck',
    afterDatasetsDraw(ch) {
      const o = ch.options.plugins || {}, ctx = ch.ctx, X = ch.scales.x, Y = ch.scales.y, A = ch.chartArea;
      if (!X || !Y) return;
      ctx.save();
      // 두 선 사이 색칠 (투자금): ckBand = { from: 매매 데이터셋 번호, to: 전세 데이터셋 번호, color, label }
      if (o.ckBand) {
        const a = ch.getDatasetMeta(o.ckBand.from), b = ch.getDatasetMeta(o.ckBand.to);
        if (a && b && !a.hidden && !b.hidden && a.data.length && b.data.length) {
          const pa = a.data.filter(p => !p.skip && isFinite(p.y)), pb = b.data.filter(p => !p.skip && isFinite(p.y));
          if (pa.length > 1 && pb.length > 1) {
            ctx.beginPath(); pa.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); [...pb].reverse().forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath();
            ctx.fillStyle = o.ckBand.color || alpha(C.quote(), .13); ctx.fill();
            if (o.ckBand.label) { const k = Math.floor(pa.length * .7), q = pb[Math.min(pb.length - 1, k)], p = pa[k];
              ctx.font = '700 12px ' + Chart.defaults.font.family; ctx.fillStyle = C.text(); ctx.textAlign = 'center'; ctx.fillText(o.ckBand.label, p.x, (p.y + q.y) / 2 + 4); }
          }
        }
      }
      // 전고점 등 가로 점선 + 이름표: ckPeak = [{ y, text, color }]
      for (const pk of o.ckPeak || []) {
        if (pk.y == null) continue;
        const py = Y.getPixelForValue(pk.y); if (py < A.top || py > A.bottom) continue;
        ctx.setLineDash([6, 5]); ctx.strokeStyle = pk.color || '#e5484d'; ctx.globalAlpha = .85; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(A.left, py); ctx.lineTo(A.right, py); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        ctx.font = '600 11px ' + Chart.defaults.font.family; ctx.textAlign = 'right'; ctx.fillStyle = C.text(); ctx.fillText(pk.text, A.right - 4, py - 5);
      }
      // 선 끝 값 이름표: ckEnd = true (또는 { fmt }) — 선으로 그린 데이터셋만
      if (o.ckEnd) {
        const dec = o.ckEnd.dec ?? 2, unit = o.ckEnd.unit || '', fmt = (y) => (+y).toFixed(dec) + unit;   // 옵션 안에 함수를 넣으면 Chart.js 가 실행해 버려서 숫자로만 받음
        const used = [];
        ch.data.datasets.forEach((ds, i) => {
          const m = ch.getDatasetMeta(i); if (m.hidden || ds.ckNoEnd || !(ds.showLine || m.type === 'line' || ds.type === 'line')) return;
          const pts = m.data.filter(p => !p.skip && isFinite(p.y)); if (!pts.length) return;
          const p = pts[pts.length - 1], raw = ds.data[m.data.indexOf(p)], val = raw && typeof raw === 'object' ? raw.y : raw;
          let y = p.y; while (used.some(u => Math.abs(u - y) < 13)) y += 13; used.push(y);
          ctx.font = '700 11px ' + Chart.defaults.font.family; ctx.textAlign = 'right'; ctx.fillStyle = C.text();
          ctx.fillText(`${ds.endLabel || ''}${ds.endLabel ? ' ' : ''}${fmt(val)}`, Math.min(p.x, A.right) - 6, y - 7);
        });
      }
      ctx.restore();
    },
    afterDraw(ch) {   // 마우스 세로선: ckCross = true
      const o = ch.options.plugins || {}; if (!o.ckCross) return;
      const act = ch.tooltip && ch.tooltip.getActiveElements ? ch.tooltip.getActiveElements() : [];
      if (!act.length) return;
      const x = act[0].element.x, A = ch.chartArea, ctx = ch.ctx;
      ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = C.sub(); ctx.globalAlpha = .7; ctx.beginPath(); ctx.moveTo(x, A.top); ctx.lineTo(x, A.bottom); ctx.stroke(); ctx.restore();
    },
  };

  /** 3개월 이동평균선. pts = [{x(ms 또는 소수 연도), y}], unit = 'ms' | 'year' */
  function ma(pts, unit = 'ms', days = 91) {
    const w = unit === 'ms' ? days * 864e5 / 2 : days / 365 / 2, s = [...pts].sort((a, b) => a.x - b.x), out = [];
    if (s.length < 4) return [];
    const step = Math.max(1, Math.floor(s.length / 120));
    for (let i = 0; i < s.length; i += step) { const x = s[i].x, ys = s.filter(p => Math.abs(p.x - x) <= w).map(p => p.y); out.push({ x, y: ys.reduce((a, b) => a + b, 0) / ys.length }); }
    return out;
  }
  /** 1년/3년/전체 버튼. key 별로 고른 값을 기억. onChange(years|null) */
  function range(el, key, onChange) {
    const K = 'apt.ckRange.v1', all = Store.get(K, {}), cur = all[key] ?? 0;
    el.innerHTML = [[1, '1년'], [3, '3년'], [0, '전체']].map(([y, t]) => `<button type="button" class="ckr${y === cur ? ' on' : ''}" data-y="${y}">${t}</button>`).join('');
    el.onclick = (e) => { const b = e.target.closest('[data-y]'); if (!b) return; const a = Store.get(K, {}); a[key] = +b.dataset.y; Store.set(K, a);
      el.querySelectorAll('.ckr').forEach(x => x.classList.toggle('on', x === b)); onChange(+b.dataset.y || null); };
    return cur || null;
  }
  /** 작은 추세선 (숫자 칸 옆) */
  function spark(vals, w = 84, h = 26) {
    const a = vals.filter(x => x != null && isFinite(x)); if (a.length < 2) return '';
    const mn = Math.min(...a), mx = Math.max(...a), pts = a.map((y, i) => `${(i / (a.length - 1) * w).toFixed(1)},${(h - 3 - (y - mn) / (mx - mn || 1) * (h - 6)).toFixed(1)}`).join(' ');
    return `<svg class="ckspark" aria-hidden="true" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  }
  function init() { if (typeof Chart === 'undefined') return; Chart.register(plugin); theme(); }
  return { C, alpha, theme, init, ma, range, spark };
})();
