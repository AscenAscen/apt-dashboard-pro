/* ─────────────────────────────────────────────────────────
   trades.js — 선택한 단지들의 실거래(매매·전세)를 기간을 골라 보는 패널
   · [실거래 조회] 탭의 "선택 단지 실거래 조회", "이 단지 실거래 조회"
   · [시세트래킹] 탭의 "선택 단지 실거래 조회"
   두 곳 모두 같은 패널을 씁니다. 화면 아래에 열리고, 기간(시작~끝 월)·매매/전세/직거래 를 바꿔 다시 볼 수 있습니다.
   최대 12개 단지. 그래프는 매매 = 동그라미, 전세 = 마름모, 단지마다 색이 다릅니다.
   ───────────────────────────────────────────────────────── */
const TradePanel = (() => {
  const PAL = ['#4f9cff', '#ff9500', '#34c759', '#af52de', '#ff3b30', '#5ac8fa', '#ffcc00', '#ff2d55', '#64d2ff', '#bf5af2', '#30d158', '#ac8e68'];
  const MAX = 12;
  const ymInt = (v) => +String(v || '').replace('-', '');
  const ymText = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const inst = new Map();

  function create(host, opts = {}) {
    const collapsible = !!opts.collapsible;
    host.innerHTML = `<div class="bar"><strong data-tp="title"></strong><span class="grow"></span><button data-tp="close">${collapsible ? '숨기기 ▲' : '닫기 ✕'}</button><button data-tp="expand" hidden aria-expanded="false">펼치기 ▼</button></div>
      <div data-tp="body">
      <div class="filters">
        <div class="presets" data-tp="presets"><button data-y="1">1년</button><button data-y="3">3년</button><button data-y="5">5년</button><button data-y="10">10년</button><button data-y="20">전체</button></div>
        <label>시작 <input type="month" data-tp="from"></label>
        <label>끝 <input type="month" data-tp="to"></label>
        <div class="checks"><label><input type="checkbox" data-tp="sale" checked> 매매</label><label><input type="checkbox" data-tp="rent" checked> 전세</label><label><input type="checkbox" data-tp="direct" checked> 직거래 포함</label></div>
        <button data-tp="csv">엑셀(CSV) 내려받기</button>
      </div>
      <p class="hint" data-tp="note"></p>
      <div class="cards" data-tp="cards"></div>
      <div class="chartbox tall"><canvas data-tp="chart"></canvas></div>
      <div class="tablewrap"><table class="tp" data-tp="table"></table></div>
      </div>`;
    const q = (s) => host.querySelector(`[data-tp="${s}"]`);
    let items = [], trades = [], chart = null, seq = 0;
    let armed = false, armT = null;          // 숨기기 두 번 누르기 상태
    const body = q('body'), hideBtn = q('close'), expandBtn = q('expand');
    /** 접힘 상태 바꾸기: 접으면 제목 한 줄만 남고, 펼치면 차트·표가 다시 보임 */
    function setCollapsed(on) {
      if (!collapsible) return;
      clearTimeout(armT); armed = false;
      body.hidden = on;
      hideBtn.hidden = on; hideBtn.textContent = '숨기기 ▲';
      expandBtn.hidden = !on; expandBtn.setAttribute('aria-expanded', String(!on));
      if (!on && chart) setTimeout(() => chart && chart.resize(), 0);
    }

    const range = () => {
      let a = ymInt(q('from').value), b = ymInt(q('to').value);
      if (!a || !b) return null;
      if (a > b) [a, b] = [b, a];
      return [a, b];
    };
    function setPreset(y) {
      const now = new Date();
      q('to').value = ymText(now);
      q('from').value = ymText(new Date(now.getFullYear() - y, now.getMonth(), 1));
      q('presets').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.y === y));
    }

    async function load() {
      const r = range(); if (!r || !items.length) return;
      const my = ++seq, [a, b] = r;
      q('note').textContent = '실거래를 불러오는 중…';
      const parts = await Promise.all(items.map(it => Data.complexTrades(it.code, it.key, it.g, Math.floor(a / 100), Math.floor(b / 100))));
      if (my !== seq) return;
      const inR = (t) => { const ym = Math.floor(t.d / 100); return ym >= a && ym <= b; };
      trades = [];
      items.forEach((it, i) => {
        parts[i].sale.filter(inR).forEach(t => trades.push({ ...t, kind: 'sale', it }));
        parts[i].rent.filter(inR).forEach(t => trades.push({ ...t, kind: 'rent', it }));
      });
      draw();
    }

    function selected() {
      const wantSale = q('sale').checked, wantRent = q('rent').checked, direct = q('direct').checked;
      return trades.filter(t => (t.kind === 'sale' ? wantSale : wantRent) && (direct || !t.direct)).sort((x, y) => x.d - y.d);
    }

    function draw() {
      const sel = selected(), r = range();
      const nSale = sel.filter(t => t.kind === 'sale').length, nRent = sel.length - nSale;
      q('note').textContent = r ? `${items.length}개 단지 · ${Math.floor(r[0] / 100)}.${String(r[0] % 100).padStart(2, '0')} ~ ${Math.floor(r[1] / 100)}.${String(r[1] % 100).padStart(2, '0')} · 매매 ${nSale}건 · 전세 ${nRent}건` : '';
      // 단지별 요약 카드
      const stat = (arr) => {
        if (!arr.length) return '<small>거래 없음</small>';
        const last = arr[arr.length - 1];
        const mx = arr.reduce((m, t) => (t.price > m.price ? t : m)), mn = arr.reduce((m, t) => (t.price < m.price ? t : m));
        return `${arr.length}건 · 최근 <b>${U.price(last.price)}</b> <small>${U.date(last.d)}</small><br><small>최고 ${U.price(mx.price)} · 최저 ${U.price(mn.price)}</small>`;
      };
      q('cards').innerHTML = items.map((it, i) => {
        const c = PAL[i % PAL.length];
        return `<div class="card"><div class="k"><span class="tpdot" style="background:${c}"></span> ${U.esc(it.name)} ${it.g}㎡(${CONFIG.toPyeong(it.g)}평)</div>
          <div class="s" style="text-align:left"><span class="sale">매매</span> ${stat(sel.filter(t => t.it === it && t.kind === 'sale'))}<br><span class="rent">전세</span> ${stat(sel.filter(t => t.it === it && t.kind === 'rent'))}</div></div>`;
      }).join('') || '<p class="hint">단지가 없습니다.</p>';

      // 그래프
      if (chart) { chart.destroy(); chart = null; }
      if (typeof Chart !== 'undefined') {
        const toX = (d) => new Date(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100).getTime();
        const datasets = [];
        items.forEach((it, i) => {
          const c = PAL[i % PAL.length], label = `${it.name} ${it.g}㎡`;
          const sale = sel.filter(t => t.it === it && t.kind === 'sale'), rent = sel.filter(t => t.it === it && t.kind === 'rent');
          if (sale.length) datasets.push({ label: `${label} 매매`, data: sale.map(t => ({ x: toX(t.d), y: t.price / 10000, t })), backgroundColor: c, borderColor: c, pointRadius: 3.5, pointHitRadius: 8, showLine: false });
          if (rent.length) datasets.push({ label: `${label} 전세`, data: rent.map(t => ({ x: toX(t.d), y: t.price / 10000, t })), backgroundColor: 'transparent', borderColor: c, borderWidth: 2, pointStyle: 'rectRot', pointRadius: 4, pointHitRadius: 8, showLine: false });
        });
        const css = getComputedStyle(document.documentElement), col = (n) => css.getPropertyValue(n).trim();
        chart = new Chart(q('chart'), {
          type: 'scatter',
          data: { datasets },
          options: {
            maintainAspectRatio: false, animation: false,
            scales: {
              x: { type: 'linear', ticks: { color: col('--sub'), maxTicksLimit: 10, callback: (v) => { const d = new Date(v); return `${String(d.getFullYear()).slice(2)}.${String(d.getMonth() + 1).padStart(2, '0')}`; } }, grid: { color: col('--line') } },
              y: { ticks: { color: col('--sub'), callback: (v) => v + '억' }, grid: { color: col('--line') } },
            },
            plugins: {
              legend: { labels: { color: col('--text'), usePointStyle: true, boxWidth: 8 } },
              tooltip: { callbacks: { label: (c) => `${c.dataset.label} ${U.price(c.raw.t.price)} · ${U.date(c.raw.t.d)} · ${c.raw.t.floor}층` } },
            },
          },
        });
      }

      // 거래 내역 표 (최신순)
      const rows = [...sel].reverse();
      q('table').innerHTML = '<thead><tr><th class="c">구분</th><th class="c">계약일</th><th class="l">단지</th><th>전용㎡</th><th>층</th><th>금액</th><th class="l">비고</th></tr></thead><tbody>' +
        rows.map(t => `<tr><td class="c ${t.kind === 'sale' ? 'sale' : 'rent'}">${t.kind === 'sale' ? '매매' : '전세'}</td><td class="c">${U.date(t.d)}</td><td class="l">${U.esc(t.it.name)}</td><td>${t.area}</td><td>${t.floor}</td><td>${U.price(t.price)}</td><td class="l">${t.direct ? '직거래 ' : ''}${Kit.badge(t.d)}</td></tr>`).join('') +
        (rows.length ? '' : '<tr><td colspan="7" class="c">선택한 기간에 거래가 없습니다.</td></tr>') + '</tbody>';
    }

    function csv() {
      const sel = selected();
      const lines = [['구분', '계약일', '단지', '동', '전용㎡', '층', '금액(만원)', '직거래'], ...[...sel].reverse().map(t => [
        t.kind === 'sale' ? '매매' : '전세', t.d, t.it.name, t.it.dong, t.area, t.floor, t.price, t.direct ? 'Y' : ''])];
      const text = lines.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
      a.download = `실거래_${items.length}개단지_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    host.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tp === 'expand') return setCollapsed(false);
      if (b.dataset.tp === 'close' && collapsible) {       // 시세트래킹: 한 번 더 눌러야 숨김 (2초 안에)
        if (!armed) { armed = true; b.textContent = '한 번 더 누르면 숨김'; armT = setTimeout(() => { armed = false; b.textContent = '숨기기 ▲'; }, 2000); return; }
        return setCollapsed(true);
      }
      if (b.dataset.tp === 'close') { host.hidden = true; if (chart) { chart.destroy(); chart = null; } return; }
      if (b.dataset.tp === 'csv') return csv();
      const y = +b.dataset.y;
      if (y) { setPreset(y); load(); }
    };
    q('from').onchange = q('to').onchange = () => { q('presets').querySelectorAll('button').forEach(b => b.classList.remove('on')); load(); };
    q('sale').onchange = q('rent').onchange = q('direct').onchange = () => { if (trades.length || items.length) draw(); };

    /** 단지 목록을 받아 패널을 열고 기간 기본값(5년)으로 조회 */
    function open(list, title) {
      items = list.slice(0, MAX).map(x => ({ id: x.id, code: x.code, key: x.key, g: x.g, name: x.name, dong: x.dong || '', sido: x.sido || '', sgg: x.sgg || '' }));
      if (!items.length) return U.toast('단지를 먼저 고르세요.');
      q('title').textContent = `${title || '실거래 조회'} · ${items.length}개` + (list.length > MAX ? ` (앞 ${MAX}개만 표시)` : '');
      if (!q('from').value || !q('to').value) setPreset(5);
      host.hidden = false;
      setCollapsed(false);                      // 새로 조회하면 항상 펼쳐서 보여 줌
      load();
      host.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return { open };
  }

  /** 화면 칸 id 로 패널을 한 번만 만들고 돌려줌 */
  function get(id, opts) {
    if (!inst.has(id)) inst.set(id, create(document.getElementById(id), opts));
    return inst.get(id);
  }
  return { get };
})();
