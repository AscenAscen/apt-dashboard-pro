/* ─────────────────────────────────────────────────────────
   survey.js — [전수조사] 탭
   ① 내 조사 기록: 어느 지역(시/군/구 → 동)을 언제 조사했는지 조회, 이름·메모·완료 표시, 지난 조사와 비교
   ② 조사 화면: 한 지역의 모든 단지·평형을 시세트래킹과 같은 양식으로 깔아 놓고 호가를 달마다 적음
      → 가격대 등으로 좁히고 정렬 → 후보 표시 → 시세트래킹에 담기
   호가·세대수·상태 등 적은 값은 시세트래킹과 같은 곳에 저장됩니다. (Tracking.rec)
   ───────────────────────────────────────────────────────── */
const Survey = (() => {
  const $ = (id) => document.getElementById(id);
  const PAGE = 200, MKEY = 'apt.surveyMeta.v1';
  let regions = [], regMap = new Map(), reg = null, rows = [], view = [], base = [], shown = 0;
  const checked = new Set(), openGu = new Set();
  let ui = Store.get('apt.svUi', { info: false });
  let cmpLast = null;

  const eok = (v) => (v == null ? '' : String(+(v / 10000).toFixed(4)));
  const eokT = (v) => (v == null ? '-' : +(v / 10000).toFixed(2) + '억');
  const toMan = (text) => { const n = parseFloat(String(text).replace(/,/g, '')); return isNaN(n) ? null : Math.round(n * 10000); };
  const month = () => +$('svMonth').value || 0;
  const prevMonth = () => { const ms = Tracking.getMonths(), i = ms.indexOf(month()); return i >= 0 ? ms[i + 1] : undefined; };
  const ymText = (ym) => `${String(ym).slice(0, 4)}-${String(ym).slice(4)}`;
  const meta = () => Store.get(MKEY, {});
  const parseId = (id) => { const rest = id.slice(6), h = rest.lastIndexOf('#'), key = rest.slice(0, h); return { code: id.slice(0, 5), key, g: +rest.slice(h + 1), ...Data.parseKey(key) }; };
  const regName = (code) => { const r = regMap.get(code); return r ? U.siGu(r[1], r[2]).filter(Boolean).join(' ') : code; };

  async function init() {
    regions = await Data.regions();
    regMap = new Map(regions.map(r => [r[0], r]));
    const sidos = [...new Set(regions.map(r => r[1]))];
    $('svSido').innerHTML = sidos.map(x => `<option>${U.esc(x)}</option>`).join('');
    const saved = Store.get('apt.lastRegion', null);
    if (saved && sidos.includes(saved.sido)) $('svSido').value = saved.sido;
    fillSgg(saved?.code);
    $('svSido').onchange = () => fillSgg();
    $('btnSurvey').onclick = () => load();
    const now = new Date();
    $('svNewMonth').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    $('btnSvAddMonth').onclick = () => {
      const ym = +($('svNewMonth').value || '').replace('-', '');
      if (!ym) return U.toast('추가할 달을 고르세요.');
      if (!Tracking.addMonth(ym)) return U.toast(`${Tracking.ymLabel(ym)} 은(는) 이미 있습니다. "기록할 달"에서 고르세요.`);
      fillMonths(ym); apply(); U.toast(`${Tracking.ymLabel(ym)} 기록 칸을 만들었습니다.`);
    };
    $('svMonth').onchange = apply;
    $('svStatus').innerHTML = '<option value="*">전체</option>' + Tracking.STATUSES.map(s => `<option value="${s}">${s || '(상태 없음)'}</option>`).join('');
    ['svDong', 'svSize', 'svSort', 'svZone', 'svStatus', 'svOnlyQuoted', 'svUnfilled', 'svCand', 'svRecent'].forEach(id => { $(id).onchange = apply; });
    let timer;
    ['svFind', 'svMin', 'svMax', 'svYear', 'svHouse'].forEach(id => { $(id).oninput = () => { clearTimeout(timer); timer = setTimeout(apply, 300); }; });
    $('btnSvMore').onclick = () => { shown += PAGE; render(); };
    $('btnSvInfo').onclick = () => { ui.info = !ui.info; Store.set('apt.svUi', ui); render(); };
    $('btnSvTrack').onclick = () => {
      const sel = rows.filter(r => checked.has(r.id));
      if (!sel.length) return U.toast('먼저 표에서 단지를 체크하세요.');
      Tracking.add(sel); checked.clear(); render();
    };
    $('btnSvSame').onclick = sameAsLast;
    $('btnSvSeen').onclick = () => { rows.forEach(r => { const rc = Tracking.rec(r.id); if (rc && r.sale) rc.seenSale = r.sale.d; }); Tracking.save(); render(); U.toast('새 거래 표시를 지웠습니다.'); };
    $('btnSvExcel').onclick = excel;
    $('btnSvPaste').onclick = () => { if (!rows.length) return U.toast('먼저 지역을 불러오세요.'); if (!month()) return U.toast('먼저 [달 추가]로 기록할 달을 만드세요.'); $('pasteText').value = ''; $('pasteResult').textContent = ''; $('pastePreviewWrap').hidden = true; $('pasteApply').disabled = true; pastePlan = []; $('pasteModal').hidden = false; $('pasteText').focus(); };
    $('pasteClose').onclick = () => { $('pasteModal').hidden = true; };
    $('pasteApply').onclick = pasteApply;
    $('pasteCheck').onclick = pastePreview;
    $('pasteText').oninput = () => { $('pasteApply').disabled = true; };
    // 조사 기록
    ['svhRegion', 'svhFrom', 'svhTo'].forEach(id => { $(id).onchange = renderHistory; });
    $('btnSvhExcel').onclick = historyExcel;
    $('svcRegion').onchange = () => fillCompare();
    $('svcDong').onchange = () => fillCompare(true);
    $('btnSvCompare').onclick = compare;
    $('btnSvcExcel').onclick = compareExcel;
    fillMonths(); renderHistory();
  }

  function fillSgg(code) {
    const list = regions.filter(r => r[1] === $('svSido').value);
    $('svSgg').innerHTML = list.map(r => `<option value="${r[0]}">${U.esc(r[2])}</option>`).join('');
    if (code && list.some(r => r[0] === code)) $('svSgg').value = code;
  }
  function fillMonths(select) {
    const ms = Tracking.getMonths(), cur = select || month();
    $('svMonth').innerHTML = ms.length ? ms.map(m => `<option value="${m}">${Tracking.ymLabel(m)}</option>`).join('') : '<option value="">(달 추가를 먼저)</option>';
    if (ms.includes(cur)) $('svMonth').value = cur;
  }

  /* ═════════════ ① 내 조사 기록 ═════════════ */
  /** 적어 둔 호가를 (지역, 동, 달) 로 모음 → Map "code|dong|ym" → { code, dong, ym, list:[{id,name,g,q,rec}] } */
  function collect() {
    const out = new Map();
    for (const { id, rec } of Tracking.allRecords()) {
      const p = parseId(id);
      for (const m of Object.keys(rec.quotes || {})) {
        const q = rec.quotes[m];
        if (q.s == null && q.r == null) continue;
        const k = `${p.code}|${p.dong}|${m}`;
        if (!out.has(k)) out.set(k, { code: p.code, dong: p.dong, ym: +m, list: [] });
        out.get(k).list.push({ id, name: p.name, g: p.g, q, rec, at: (rec.qt || {})[m] || '' });
      }
    }
    return out;
  }
  const summarize = (list) => { const s = list.map(x => x.q.s).filter(v => v != null); return { n: list.length, avg: s.length ? s.reduce((a, b) => a + b, 0) / s.length : null, at: list.map(x => x.at).sort().pop() || '' }; };

  function renderHistory() {
    const data = [...collect().values()];
    const codes = [...new Set(data.map(d => d.code))].sort((a, b) => regName(a).localeCompare(regName(b), 'ko'));
    const keep = (sel, opts) => { const v = sel.value; sel.innerHTML = opts; if ([...sel.options].some(o => o.value === v)) sel.value = v; };
    keep($('svhRegion'), '<option value="">전체 지역</option>' + codes.map(c => `<option value="${c}">${U.esc(regName(c))}</option>`).join(''));
    keep($('svcRegion'), codes.map(c => `<option value="${c}">${U.esc(regName(c))}</option>`).join(''));
    fillCompare(true);
    const fr = +($('svhFrom').value || '').replace('-', '') || 0, to = +($('svhTo').value || '').replace('-', '') || 999999, rc = $('svhRegion').value;
    const list = data.filter(d => (!rc || d.code === rc) && d.ym >= fr && d.ym <= to);
    $('svHistCount').textContent = data.length ? `조사한 지역 ${codes.length}곳 · 달 ${new Set(data.map(d => d.ym)).size}개` : '';
    const table = $('svHist');
    if (!list.length) { table.innerHTML = `<tbody><tr><td class="c" style="color:var(--sub);padding:22px">${data.length ? '조건에 맞는 조사 기록이 없습니다.' : '아직 조사 기록이 없습니다. 아래에서 지역을 불러와 호가를 적으면 여기에 쌓입니다.'}</td></tr></tbody>`; return; }
    const mt = meta(), gus = new Map();
    for (const d of list) { const k = `${d.code}|${d.ym}`; if (!gus.has(k)) gus.set(k, { code: d.code, ym: d.ym, dongs: [] }); gus.get(k).dongs.push(d); }
    const order = [...gus.values()].sort((a, b) => b.ym - a.ym || regName(a.code).localeCompare(regName(b.code), 'ko'));
    const edit = (key, f, ph) => `<input data-meta="${U.esc(key)}" data-f="${f}" value="${U.esc((mt[key] || {})[f] || '')}" placeholder="${ph}">`;
    const done = (key) => `<input type="checkbox" data-done="${U.esc(key)}" ${(mt[key] || {}).done ? 'checked' : ''} title="조사 끝냄 표시">`;
    let body = '';
    for (const gu of order) {
      const gk = `${gu.code}|${gu.ym}`, mk = `${gu.code}||${gu.ym}`, s = summarize(gu.dongs.flatMap(d => d.list)), isOpen = openGu.has(gk);
      body += `<tr class="gu${(mt[mk] || {}).done ? ' done' : ''}"><td class="l"><button class="mini" data-toggle="${gk}">${isOpen ? '▼' : '▶'}</button> <b>${U.esc(regName(gu.code))}</b></td><td class="c">${Tracking.ymLabel(gu.ym)}</td>` +
        `<td>${s.n}개 <small>동 ${gu.dongs.length}곳</small></td><td>${eokT(s.avg)}</td><td class="c">${s.at ? s.at.slice(2).replace(/-/g, '.') : '-'}</td><td class="l">${edit(mk, 'name', '조사 이름')}</td><td class="l">${edit(mk, 'memo', '메모')}</td><td class="c">${done(mk)}</td>` +
        `<td class="c"><button class="mini" data-open="${gu.code}||${gu.ym}">열기</button> <button class="mini" data-cmp="${gu.code}||${gu.ym}">비교</button></td></tr>`;
      if (isOpen) for (const d of gu.dongs.sort((a, b) => a.dong.localeCompare(b.dong, 'ko'))) {
        const dk = `${d.code}|${d.dong}|${d.ym}`, ds = summarize(d.list);
        body += `<tr class="dong${(mt[dk] || {}).done ? ' done' : ''}"><td class="l">　　${U.esc(d.dong)}</td><td class="c">${Tracking.ymLabel(d.ym)}</td><td>${ds.n}개</td><td>${eokT(ds.avg)}</td><td class="c">${ds.at ? ds.at.slice(2).replace(/-/g, '.') : '-'}</td>` +
          `<td class="l">${edit(dk, 'name', '조사 이름')}</td><td class="l">${edit(dk, 'memo', '메모')}</td><td class="c">${done(dk)}</td>` +
          `<td class="c"><button class="mini" data-open="${dk}">열기</button> <button class="mini" data-cmp="${dk}">비교</button></td></tr>`;
      }
    }
    table.innerHTML = '<thead><tr><th class="l">지역 (▶ 를 누르면 동별로 펼쳐짐)</th><th class="c">조사한 달</th><th>입력한 단지</th><th>평균 매매 호가</th><th class="c">마지막 입력일</th><th class="l">조사 이름</th><th class="l">메모</th><th class="c">완료</th><th class="c">보기</th></tr></thead><tbody>' + body + '</tbody>';
    table.onclick = (e) => {
      const t = e.target;
      if (t.dataset.toggle) { openGu.has(t.dataset.toggle) ? openGu.delete(t.dataset.toggle) : openGu.add(t.dataset.toggle); renderHistory(); }
      if (t.dataset.open) { const [code, dong, ym] = t.dataset.open.split('|'); openSurvey(code, dong, +ym); }
      if (t.dataset.cmp) { const [code, dong, ym] = t.dataset.cmp.split('|'); startCompare(code, dong, +ym); }
    };
    table.onchange = (e) => {
      const t = e.target, all = meta();
      if (t.dataset.meta) { (all[t.dataset.meta] = all[t.dataset.meta] || {})[t.dataset.f] = t.value.trim(); Store.set(MKEY, all); }
      if (t.dataset.done) { (all[t.dataset.done] = all[t.dataset.done] || {}).done = t.checked; Store.set(MKEY, all); t.closest('tr').classList.toggle('done', t.checked); }
    };
  }

  /** 조사 기록에서 [열기]: 그 지역·동·달의 조사 화면으로 */
  async function openSurvey(code, dong, ym) {
    const r = regMap.get(code); if (!r) return;
    $('svSido').value = r[1]; fillSgg(code);
    await load(true);
    fillMonths(ym);
    $('svDong').value = dong || ''; $('svOnlyQuoted').checked = true; $('svUnfilled').checked = false; $('svCand').checked = false; $('svRecent').checked = false;
    ['svFind', 'svMin', 'svMax', 'svYear', 'svHouse'].forEach(id => { $(id).value = ''; });
    $('svSize').value = 'all'; $('svZone').value = ''; $('svStatus').value = '*';
    apply();
    $('svBody').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function historyExcel() {
    const fr = +($('svhFrom').value || '').replace('-', '') || 0, to = +($('svhTo').value || '').replace('-', '') || 999999, rc = $('svhRegion').value;
    const list = [...collect().values()].filter(d => (!rc || d.code === rc) && d.ym >= fr && d.ym <= to);
    if (!list.length) return U.toast('내려받을 조사 기록이 없습니다.');
    const head = ['시', '구', '동', '단지명', '전용㎡', '평형', '상태', '매매(만원)', '매매 개수', '전세(만원)', '전세 개수', '매-전(만원)', '전세가율(%)', '세대수', '생활권', '메모', '입력일'];
    const sheets = [...new Set(list.map(d => d.ym))].sort((a, b) => b - a).map(ym => ({
      name: ymText(ym), rows: [head].concat(list.filter(d => d.ym === ym).flatMap(d => {
        const r = regMap.get(d.code), [si, gu] = r ? U.siGu(r[1], r[2]) : ['', ''];
        return d.list.map(x => [si, gu, d.dong, x.name, x.g, x.rec.pyeong || CONFIG.toPyeong(x.g) + '평', x.rec.status || '', x.q.s ?? '', x.q.sn ?? '', x.q.r ?? '', x.q.rn ?? '',
          x.q.s != null && x.q.r != null ? x.q.s - x.q.r : '', x.q.s && x.q.r ? +(x.q.r / x.q.s * 100).toFixed(1) : '', x.rec.households || '', x.rec.zone || '', x.rec.memo || '', x.at]);
      }).sort((a, b) => (b[7] || 0) - (a[7] || 0))),
    }));
    U.download(`전수조사_기록_${U.stamp()}`, sheets, 'xlsx');
  }

  /* ── 지난 조사와 비교 ── */
  function fillCompare(keepDong) {
    const code = $('svcRegion').value, data = [...collect().values()].filter(d => d.code === code);
    if (!keepDong) $('svcDong').value = '';
    const dv = $('svcDong').value, dongs = [...new Set(data.map(d => d.dong))].sort((a, b) => a.localeCompare(b, 'ko'));
    $('svcDong').innerHTML = '<option value="">구 전체</option>' + dongs.map(d => `<option>${U.esc(d)}</option>`).join('');
    if (dongs.includes(dv)) $('svcDong').value = dv;
    const dong = $('svcDong').value, ms = [...new Set(data.filter(d => !dong || d.dong === dong).map(d => d.ym))].sort((a, b) => b - a);
    const opts = ms.map(m => `<option value="${m}">${Tracking.ymLabel(m)}</option>`).join('');
    const a = $('svcA').value, b = $('svcB').value;
    $('svcA').innerHTML = opts; $('svcB').innerHTML = opts;
    $('svcB').value = ms.includes(+b) ? b : (ms[0] || '');
    $('svcA').value = ms.includes(+a) && a !== $('svcB').value ? a : (ms[1] || ms[0] || '');
  }
  function startCompare(code, dong, ym) {
    $('svcRegion').value = code; fillCompare(); $('svcDong').value = dong || ''; fillCompare(true);
    const ms = [...$('svcB').options].map(o => +o.value);
    $('svcB').value = ym; const older = ms.filter(m => m < ym)[0];
    if (!older) return U.toast('비교할 이전 조사가 없습니다. 같은 지역을 두 달 이상 조사해야 비교할 수 있습니다.');
    $('svcA').value = older; compare();
  }

  function compare() {
    const code = $('svcRegion').value, dong = $('svcDong').value, A = +$('svcA').value, B = +$('svcB').value;
    if (!code || !A || !B) return U.toast('비교할 조사 기록이 없습니다.');
    if (A === B) return U.toast('서로 다른 두 달을 고르세요.');
    const [a, b] = A < B ? [A, B] : [B, A];
    const map = new Map();
    for (const { id, rec } of Tracking.allRecords()) {
      const p = parseId(id);
      if (p.code !== code || (dong && p.dong !== dong)) continue;
      const qa = rec.quotes?.[a], qb = rec.quotes?.[b];
      if (!qa && !qb) continue;
      map.set(id, { dong: p.dong, name: p.name, g: p.g, a: qa || {}, b: qb || {} });
    }
    const sub = (x, y) => (x == null || y == null ? null : y - x);
    const list = [...map.values()].map(r => ({ ...r, ds: sub(r.a.s, r.b.s), dr: sub(r.a.r, r.b.r), dn: sub(r.a.sn, r.b.sn),
      ga: sub(r.a.r, r.a.s), gb: sub(r.b.r, r.b.s), note: r.a.s == null && r.a.r == null ? '새로 조사' : r.b.s == null && r.b.r == null ? '이번에 빠짐' : '' }));
    list.forEach(r => { r.dg = r.ga == null || r.gb == null ? null : r.gb - r.ga; });
    list.sort((x, y) => (x.ds == null) - (y.ds == null) || Math.abs(y.ds || 0) - Math.abs(x.ds || 0) || x.name.localeCompare(y.name, 'ko'));
    const both = list.filter(r => r.ds != null);
    const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
    const up = both.filter(r => r.ds > 0).length, down = both.filter(r => r.ds < 0).length, same = both.length - up - down;
    const dAvg = avg(both.map(r => r.ds)), rAvg = avg(list.filter(r => r.dr != null).map(r => r.dr)), nSum = list.filter(r => r.dn != null).reduce((s, r) => s + r.dn, 0);
    const scope = `${regName(code)}${dong ? ' ' + dong : ''}`;
    cmpLast = { scope, a, b, list };
    const card = (k, v, s2 = '', cls = '') => `<div class="card"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="s">${s2}</div></div>`;
    $('svcCards').innerHTML = card(`${scope} · ${Tracking.ymLabel(a)} → ${Tracking.ymLabel(b)}`, `${both.length}개 비교`, `전체 ${list.length}개 중 두 달 모두 매매 호가를 적은 단지`) +
      card('매매 호가', `<span class="up">상승 ${up}</span> · <span class="down">하락 ${down}</span>`, `그대로 ${same}개`) +
      card('평균 매매 변동', dAvg == null ? '-' : U.diff(Math.round(dAvg)), '두 달 모두 적은 단지 기준', U.cls(dAvg)) +
      card('평균 전세 변동', rAvg == null ? '-' : U.diff(Math.round(rAvg)), '', U.cls(rAvg)) +
      card('매물 수 변동', list.some(r => r.dn != null) ? (nSum > 0 ? '+' : '') + nSum + '개' : '-', '두 달 모두 매물 수를 적은 단지 합계');
    const pr = (v) => (v == null ? '-' : eokT(v)), df = (v) => `<td class="${U.cls(v)}">${U.diff(v)}</td>`;
    $('svcTable').innerHTML = `<thead><tr><th class="l">동</th><th class="l">단지명</th><th>평형</th><th>매매 ${a % 100}월</th><th>매매 ${b % 100}월</th><th>변동</th><th>전세 ${a % 100}월</th><th>전세 ${b % 100}월</th><th>변동</th><th>매물 수</th><th>투자금 ${a % 100}월</th><th>투자금 ${b % 100}월</th><th>변동</th><th class="l">비고</th></tr></thead><tbody>` +
      list.map(r => `<tr><td class="l">${U.esc(r.dong)}</td><td class="l"><b>${U.esc(r.name)}</b></td><td>${r.g}㎡</td><td>${pr(r.a.s)}</td><td>${pr(r.b.s)}</td>${df(r.ds)}<td>${pr(r.a.r)}</td><td>${pr(r.b.r)}</td>${df(r.dr)}` +
        `<td>${r.a.sn ?? '-'} → ${r.b.sn ?? '-'}</td><td>${pr(r.ga)}</td><td>${pr(r.gb)}</td>${df(r.dg)}<td class="l">${r.note ? `<span class="tag">${r.note}</span>` : ''}</td></tr>`).join('') + '</tbody>';
    $('svcTable').parentElement.hidden = false;
  }

  function compareExcel() {
    if (!cmpLast) return U.toast('먼저 [비교하기]를 눌러 주세요.');
    const { scope, a, b, list } = cmpLast;
    U.download(`전수조사_비교_${scope.replace(/\s+/g, '')}_${a}-${b}`, [{ name: '비교', rows: [['동', '단지명', '전용㎡', `매매 ${ymText(a)}`, `매매 ${ymText(b)}`, '매매 변동', `전세 ${ymText(a)}`, `전세 ${ymText(b)}`, '전세 변동', `매물 수 ${ymText(a)}`, `매물 수 ${ymText(b)}`, `투자금 ${ymText(a)}`, `투자금 ${ymText(b)}`, '투자금 변동', '비고'],
      ...list.map(r => [r.dong, r.name, r.g, r.a.s ?? '', r.b.s ?? '', r.ds ?? '', r.a.r ?? '', r.b.r ?? '', r.dr ?? '', r.a.sn ?? '', r.b.sn ?? '', r.ga ?? '', r.gb ?? '', r.dg ?? '', r.note])] },
      { name: '설명', rows: [['항목', '설명'], ['금액 단위', '만원'], ['변동', '최근 달 - 이전 달'], ['투자금', '매매 - 전세']] }], 'xlsx');
  }

  /* ═════════════ ② 조사 화면 ═════════════ */
  /** 이 지역 모든 단지·평형 불러오기 (2020년 이후 실거래로 전고점·전저점·최근 실거래 계산) */
  async function load(quiet) {
    const code = $('svSgg').value;
    reg = regMap.get(code);
    if (!reg) return;
    const btn = $('btnSurvey');
    btn.disabled = true; btn.textContent = '불러오는 중…';
    try {
      const idx = await Data.index(code);
      if (!Object.keys(idx.c).length) {
        rows = []; $('svBody').hidden = true; $('svEmpty').hidden = false;
        $('svEmpty').innerHTML = `<b>${U.esc(reg[1])} ${U.esc(reg[2])}</b> 은(는) 아직 수집된 데이터가 없습니다.`;
        return;
      }
      Store.set('apt.lastRegion', { sido: reg[1], code });
      const nowY = new Date().getFullYear();
      const [data, kp] = await Promise.all([Data.loadYears(code, Math.floor(CONFIG.PEAK_FROM / 10000), nowY), Data.kapt(code)]);
      const map = new Map();
      const get = (key, g) => {
        const id = `${code}|${key}#${g}`;
        if (!map.has(id)) map.set(id, { id, code, sido: reg[1], sgg: reg[2], key, ...Data.parseKey(key), g, buildYear: idx.c[key] || null, hh: kp.m[key]?.[0] || null, sale: null, rent: null, peak: null, trough: null });
        return map.get(id);
      };
      Data.eachTrade(data.sale, null, (key, t) => {
        if (t.direct) return;                                   // 직거래 제외
        const r = get(key, t.g);
        if (!r.sale || t.d >= r.sale.d) r.sale = t;
        if (!r.peak || t.price >= r.peak.price) r.peak = t;
        if (!r.trough || t.price < r.trough.price) r.trough = t;
      });
      Data.eachTrade(data.rent, null, (key, t) => { const r = get(key, t.g); if (!r.rent || t.d >= r.rent.d) r.rent = t; });
      // 실거래에는 없지만 예전에 호가를 적어 둔 단지도 목록에 넣음
      for (const { id } of Tracking.allRecords()) { if (id.startsWith(code + '|') && !map.has(id)) { const p = parseId(id); get(p.key, p.g); } }
      rows = [...map.values()];
      let touched = false;
      rows.forEach(r => {
        r.st = { last: r.sale };                                // 트래킹에 담을 때 쓰는 최근가
        const rc = Tracking.rec(r.id);
        if (rc && r.sale && !rc.seenSale && Object.keys(rc.quotes || {}).length) { rc.seenSale = r.sale.d; touched = true; }   // 처음 본 거래는 "새 거래"가 아님
      });
      if (touched) Tracking.save();
      const dongs = [...new Set(rows.map(r => r.dong))].sort((a, b) => a.localeCompare(b, 'ko'));
      $('svDong').innerHTML = '<option value="">전체</option>' + dongs.map(d => `<option>${U.esc(d)}</option>`).join('');
      checked.clear();
      $('svEmpty').hidden = true; $('svBody').hidden = false;
      fillMonths(); if (!quiet) apply();
    } finally {
      btn.disabled = false; btn.textContent = '이 지역 모든 단지 불러오기';
    }
  }

  /** 한 줄의 계산값 (만원) */
  function compute(r) {
    const rc = Tracking.rec(r.id) || { quotes: {} };
    const m = month(), q = rc.quotes[m] || {}, p = rc.quotes[prevMonth()] || {};
    const peak = rc.peakO ?? r.peak?.price ?? null, trough = rc.troughO ?? r.trough?.price ?? null;
    const bs = q.s ?? r.sale?.price ?? null;                    // 가격대·정렬 기준: 적은 호가, 없으면 최근 실거래
    const sub = (a, b) => (a == null || b == null ? null : a - b);
    const ratio = (s, x) => (s && x ? x / s * 100 : null);
    return { rc, q, peak, trough, base: bs, quoted: q.s != null, band: bs ? CONFIG.priceBand(bs) : '',
      drop: bs && peak ? (bs / peak - 1) * 100 : null, rise: bs && trough ? (bs / trough - 1) * 100 : null,
      askGap: q.s != null && r.sale ? q.s - r.sale.price : null,
      isNew: !!(rc.seenSale && r.sale && r.sale.d > rc.seenSale),
      sd: sub(q.s, p.s), rd: sub(q.r, p.r), gap: sub(q.s, q.r), gd: sub(sub(q.s, q.r), sub(p.s, p.r)),
      ratio: ratio(q.s, q.r), rtd: sub(ratio(q.s, q.r), ratio(p.s, p.r)) };
  }

  function calcCells(c, r) {
    const d = (v) => [U.diff(v), U.cls(v)];
    return {
      band: [(c.band || '-') + (c.base && !c.quoted ? ' <span class="star" title="호가가 없어 최근 실거래가 기준">실</span>' : ''), ''],
      drop: [U.pct(c.drop), U.cls(c.drop)], rise: [U.pct(c.rise), U.cls(c.rise)],
      ask: [c.askGap == null ? '-' : `${U.diff(c.askGap)}<small>${U.pct(c.askGap / r.sale.price * 100)}</small>`, U.cls(c.askGap)],
      sd: d(c.sd), rd: d(c.rd), gap: [c.gap == null ? '-' : U.price(c.gap), ''], gd: d(c.gd),
      ratio: [c.ratio == null ? '-' : c.ratio.toFixed(1) + '%', ''],
      rtd: [c.rtd == null ? '-' : (c.rtd > 0 ? '+' : '') + c.rtd.toFixed(1) + '%p', U.cls(c.rtd)],
    };
  }

  /** 조건으로 좁히고 정렬 (정렬은 이때 한 번만 — 입력 중에는 줄이 움직이지 않음) */
  function apply() {
    if (!rows.length) return;
    const dong = $('svDong').value, size = $('svSize').value, find = $('svFind').value.trim().toLowerCase();
    const min = parseFloat($('svMin').value), max = parseFloat($('svMax').value), year = parseInt($('svYear').value, 10), house = parseInt($('svHouse').value, 10);
    const onlyQ = $('svOnlyQuoted').checked, unfilled = $('svUnfilled').checked, cand = $('svCand').checked, recent = $('svRecent').checked, st = $('svStatus').value;
    const t = new Date(); const from = (t.getFullYear() - 3) * 10000 + (t.getMonth() + 1) * 100 + t.getDate();
    const inSize = (g) => size === 'all' || (size === '59' ? g >= 55 && g < 62 : size === '84' ? g >= 80 && g < 86 : size === 's' ? g < 60 : size === 'm' ? g >= 60 && g <= 85 : g > 85);
    // 생활권 목록 (이 지역에서 적어 둔 값)
    const zones = [...new Set(rows.map(r => (Tracking.rec(r.id) || {}).zone).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
    const zv = $('svZone').value;
    $('svZone').innerHTML = '<option value="">전체</option>' + zones.map(z => `<option>${U.esc(z)}</option>`).join('');
    const zone = zones.includes(zv) ? ($('svZone').value = zv) : '';
    // 진행 상황의 기준이 되는 묶음: 동·평형·최근 거래 조건까지만 적용
    base = rows.filter(r => {
      if (dong && r.dong !== dong) return false;
      if (!inSize(r.g)) return false;
      const c = compute(r); r._c = c;
      const hasAny = Object.keys(c.rc.quotes || {}).length > 0;
      if (recent && !hasAny && !((r.sale && r.sale.d >= from) || (r.rent && r.rent.d >= from))) return false;
      return true;
    });
    view = base.filter(r => {
      const c = r._c;
      if (find && !Alias.hit(r.code, r.key, r.name, '', find)) return false;
      if (!isNaN(year) && !(r.buildYear >= year)) return false;
      if (zone && c.rc.zone !== zone) return false;
      if (st !== '*' && (c.rc.status || '') !== st) return false;
      if (onlyQ && !c.quoted) return false;
      if (unfilled && c.quoted) return false;
      if (cand && !c.rc.cand) return false;
      if (!isNaN(min) && !(c.base >= min * 10000)) return false;
      if (!isNaN(max) && !(c.base != null && c.base <= max * 10000)) return false;
      if (!isNaN(house) && !((parseInt(c.rc.households, 10) || r.hh) >= house)) return false;
      return true;
    });
    const by = $('svSort').value, num = (v, none) => (v == null || isNaN(v) ? none : v);
    const key = {
      name: null,
      price: (r) => -num(r._c.base, -1), priceAsc: (r) => num(r._c.base, 1e12),
      house: (r) => -num(parseInt(r._c.rc.households, 10) || r.hh, -1),
      g: (r) => -r.g, gAsc: (r) => r.g,
      gap: (r) => num(r._c.gap, 1e12), year: (r) => -(r.buildYear || 0),
      chg: (r) => -Math.abs(num(r._c.sd, 0)), ask: (r) => -num(r._c.askGap, -1e12),
    }[by];
    if (by === 'zone') view.sort((a, b) => (a._c.rc.zone || '힣').localeCompare(b._c.rc.zone || '힣', 'ko') || a.name.localeCompare(b.name, 'ko') || a.g - b.g);
    else view.sort((a, b) => (key ? key(a) - key(b) : 0) || a.name.localeCompare(b.name, 'ko') || a.g - b.g);
    shown = PAGE;
    render();
  }

  function progress() {
    const m = month(), fresh = rows.filter(r => r._c ? r._c.isNew : compute(r).isNew).length;
    const dong = $('svDong').value;
    $('svProgress').innerHTML = m && base.length ? `${dong || '이 지역'} ${Tracking.ymLabel(m)} 입력 <b>${base.filter(r => (Tracking.rec(r.id)?.quotes?.[m] || {}).s != null).length}</b> / ${base.length}개` : '';
    $('btnSvSeen').hidden = !fresh;
    const out = [];
    if (fresh) out.push(`호가를 적어 둔 단지 중 <b>${fresh}곳</b>에 새 매매 실거래가 있습니다. 표에서 <span class="tag">새 거래</span> 표시를 확인하세요.`);
    const bk = Vault.remindText(Tracking.allRecords().length);
    if (bk) out.push(bk);
    $('svNotice').hidden = !out.length;
    $('svNotice').innerHTML = out.map(x => `<div>${x}</div>`).join('');
    $('svNotice').onclick = (e) => { if (e.target.dataset.act === 'backup') Vault.copyCode(); };
  }

  function render() {
    const list = view.slice(0, shown), m = month();
    $('svTitle').textContent = `${reg[1]} ${reg[2]} — 단지·평형 ${view.length.toLocaleString()}개` + (view.length !== rows.length ? ` (전체 ${rows.length.toLocaleString()}개 중)` : '');
    $('btnSvInfo').textContent = ui.info ? '단지 정보 접기' : '단지 정보 펼치기';
    const G = Tracking.GROUP;
    const fx = (label, cls = '') => `<th rowspan="2" class="${cls}">${label}</th>`;
    const head = `<thead><tr>${fx('<input type="checkbox" id="svAll" title="보이는 줄 전체 선택">', 'c')}${fx('후보', 'c')}${fx('상태')}${fx('가격대')}${fx('시', 'l')}${fx('구', 'l')}${fx('동', 'l')}${fx('생활권', 'l info')}${fx('단지명', 'l name')}` +
      `${fx('연식')}${fx('연차')}${fx('세대수')}${fx('평형')}${fx('구조', 'info')}${fx('방', 'info')}${fx('화', 'info')}${fx('링크')}${fx('전고점')}${fx('전고 대비 하락률')}${fx('전저점')}${fx('전저 대비 상승률')}${fx('호가-실거래')}` +
      (m ? `<th colspan="10" class="grp c">${Tracking.ymLabel(m)} 기록</th>` : '<th class="grp c">먼저 위에서 [달 추가]를 눌러 기록할 달을 만드세요</th>') +
      fx('최근 매매 실거래') + fx('최근 전세 실거래') + fx('메모', 'l') + fx('지도', 'c') + '</tr><tr>' +
      (m ? G.map((n, i) => `<th class="${[0, 1, 3, 4].includes(i) ? 'in' : ''}${i === 0 ? ' gl' : ''}">${n}${i === 0 || i === 3 ? '(억)' : ''}</th>`).join('') : '<th></th>') + '</tr></thead>';
    const [si, gu] = U.siGu(reg[1], reg[2]);
    const pk = (t) => (t ? `${U.price(t.price)}<small>${U.date(t.d)}</small>` : '-');
    const body = list.map((r, i) => {
      const c = r._c = compute(r), cells = calcCells(c, r), rc = c.rc;
      const cell = (k, extra = '') => `<td data-c="${k}" class="${cells[k][1]} ${extra}">${cells[k][0]}</td>`;
      const inp = (f, ph = '', cls = '') => `<input class="${cls}" data-f="${f}" value="${U.esc(rc[f] || '')}" placeholder="${ph}">`;
      const over = (f, v, auto) => `<td><input class="num${rc[f] != null ? ' edited' : ''}" data-o="${f}" inputmode="decimal" value="${eok(v)}" placeholder="자동" title="${auto ? `실거래 ${U.price(auto.price)} (${U.date(auto.d)}) · 눌러서 수정, 지우면 자동값` : '실거래 자료 없음 · 직접 입력'}"></td>`;
      const qin = (f, ph, isPrice, first) => `<td class="${first ? 'gl' : ''}"><input class="num" data-m="${m}" data-q="${f}" inputmode="decimal" value="${isPrice ? eok(c.q[f]) : (c.q[f] ?? '')}" placeholder="${ph}"></td>`;
      const link = rc.link || U.landLink(r.sgg, r.dong, r.name);
      return `<tr data-i="${i}" class="${Tracking.has(r.id) ? 'tracked' : ''}${c.isNew ? ' newtrade' : ''}"><td class="c"><input type="checkbox" data-chk="${i}" ${checked.has(r.id) ? 'checked' : ''}></td>` +
        `<td class="c"><button class="mini cand${rc.cand ? ' on' : ''}" data-cand="${i}" title="후보로 표시">${rc.cand ? '★' : '☆'}</button></td>` +
        `<td><select data-f="status" class="st">${Tracking.STATUSES.map(s => `<option ${s === (rc.status || '') ? 'selected' : ''} value="${s}">${s || '-'}</option>`).join('')}</select></td>` +
        `${cell('band')}<td class="l">${U.esc(si)}</td><td class="l">${U.esc(gu)}</td><td class="l">${U.esc(r.dong)}</td><td class="l info">${inp('zone', '생활권')}</td>` +
        `<td class="l name">${U.esc(r.name)}${c.isNew ? ' <span class="tag">새 거래</span>' : ''}</td>` +
        `<td>${r.buildYear || '-'}</td><td>${r.buildYear ? CONFIG.toAge(r.buildYear) : '-'}</td><td>${inp('households', r.hh ? String(r.hh) : '직접 입력')}</td><td>${r.g}㎡<small>${U.esc(rc.pyeong || CONFIG.toPyeong(r.g) + '평')}</small></td><td class="info">${inp('structure', '계/복')}</td><td class="info">${inp('rooms')}</td><td class="info">${inp('baths')}</td>` +
        `<td><a class="btn mini" href="${U.esc(link)}" target="_blank" rel="noopener">열기</a></td>` +
        `${over('peakO', c.peak, r.peak)}${cell('drop')}${over('troughO', c.trough, r.trough)}${cell('rise')}${cell('ask')}` +
        (m ? qin('s', '예: 14.3', true, true) + qin('sn', '개') + cell('sd') + qin('r', '예: 7.5', true) + qin('rn', '개') + cell('rd') + cell('gap') + cell('gd') + cell('ratio') + cell('rtd') : '<td class="gl"></td>') +
        `<td class="sale">${pk(r.sale)}</td><td class="rent">${pk(r.rent)}</td><td class="l">${inp('memo', '메모', 'memo')}</td><td class="c"><button class="mini" data-map="${i}">위치</button></td></tr>`;
    }).join('');
    const table = $('svTable');
    table.className = ui.info ? '' : 'hideinfo';
    table.innerHTML = head + `<tbody>${body}</tbody>`;
    $('svNote').textContent = view.length > list.length ? `${view.length.toLocaleString()}개 중 ${list.length.toLocaleString()}개를 표시했습니다. 조건으로 좁히거나 [더 보기]를 누르세요. (엑셀에는 좁힌 결과 전체가 들어갑니다)` : (view.length ? '' : '조건에 맞는 단지가 없습니다.');
    $('btnSvMore').hidden = view.length <= list.length;
    progress();
    table.querySelector('#svAll').onclick = (e) => { list.forEach(r => (e.target.checked ? checked.add(r.id) : checked.delete(r.id))); render(); $('svAll').checked = e.target.checked; };
    const tbody = table.querySelector('tbody');
    tbody.onclick = (e) => {
      const t = e.target;
      if (t.dataset.chk != null) { const r = list[+t.dataset.chk]; t.checked ? checked.add(r.id) : checked.delete(r.id); }
      if (t.dataset.map != null) App.showMap(list[+t.dataset.map]);
      if (t.dataset.cand != null) { const rc = Tracking.rec(list[+t.dataset.cand].id, true); rc.cand = !rc.cand; Tracking.save(); t.textContent = rc.cand ? '★' : '☆'; t.classList.toggle('on', rc.cand); }
    };
    tbody.onchange = (e) => {
      const t = e.target, tr = t.closest('tr');
      if (!tr || t.type === 'checkbox') return;
      const r = list[+tr.dataset.i], rc = Tracking.rec(r.id, true);
      if (t.dataset.f) rc[t.dataset.f] = t.value.trim();
      if (t.dataset.o) {
        const v = toMan(t.value), auto = (t.dataset.o === 'peakO' ? r.peak : r.trough)?.price ?? null;
        if (v == null || v === auto) { delete rc[t.dataset.o]; t.value = eok(auto); t.classList.remove('edited'); }
        else { rc[t.dataset.o] = v; t.classList.add('edited'); }
      }
      if (t.dataset.q) {
        const f = t.dataset.q, m2 = +t.dataset.m || month();     // 칸을 그릴 때의 달에 저장 (달을 바꾸는 순간에도 엉뚱한 달에 들어가지 않게)
        const q = rc.quotes[m2] = rc.quotes[m2] || {};
        const v = (f === 's' || f === 'r') ? toMan(t.value) : (t.value.trim() === '' || isNaN(parseInt(t.value, 10)) ? null : parseInt(t.value, 10));
        if (v == null) { delete q[f]; t.value = ''; } else { q[f] = v; (rc.qt = rc.qt || {})[m2] = Tracking.sameDay(); if (r.sale && !rc.seenSale) rc.seenSale = r.sale.d; }
        if (!Object.keys(q).length) delete rc.quotes[m2];
        if (f === 's' && v != null && Tracking.has(r.id)) rc.lastSale = v;
      }
      const cells = calcCells(r._c = compute(r), r);             // 계산 칸만 다시 그림
      tr.querySelectorAll('td[data-c]').forEach(td => { const x = cells[td.dataset.c]; if (x) { td.innerHTML = x[0]; td.className = x[1]; } });
      Tracking.save(); progress();
      if (t.dataset.q) renderHistory();
    };
  }

  /** 지난 기록과 같음 — 체크한 단지에만 적용 */
  function sameAsLast() {
    const m = month(), p = prevMonth();
    if (!m || !p) return U.toast('복사할 지난 기록이 없습니다. (고른 달보다 앞선 기록 달이 있어야 합니다)');
    const sel = view.filter(r => checked.has(r.id));
    if (!sel.length) return U.toast('먼저 표에서 단지를 체크하세요. (전수조사에서는 체크한 단지에만 적용합니다)');
    let n = 0;
    for (const r of sel) {
      const rc = Tracking.rec(r.id, true);
      if (!rc.quotes[p] || (rc.quotes[m] && (rc.quotes[m].s != null || rc.quotes[m].r != null))) continue;
      rc.quotes[m] = { ...rc.quotes[p] }; (rc.qt = rc.qt || {})[m] = Tracking.sameDay(); n++;
    }
    Tracking.save(); apply(); renderHistory();
    U.toast(n ? `${n}개 단지에 ${Tracking.ymLabel(p)} 값을 넣었습니다.` : '채울 단지가 없습니다. (이미 적었거나 지난 기록이 없음)');
  }

  /** 엑셀 붙여넣기: 단지명 / 전용㎡ / 매매(억) / 전세(억) / 매매 개수 / 전세 개수
      ① [미리보기]로 줄마다 어느 단지에 들어갈지·이상한 값이 없는지 먼저 확인 → ② [넣기] */
  let pastePlan = [];
  function pasteParse() {
    const m = month(), pm = prevMonth(), lines = $('pasteText').value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const norm = (s) => String(s).replace(/\s+/g, '').toLowerCase();
    const byName = new Map();
    rows.forEach(r => { [norm(r.name), ...Alias.of(r.code, r.key).split(',').map(norm).filter(Boolean)].forEach(k => { if (!byName.has(k)) byName.set(k, []); byName.get(k).push(r); }); });
    const dong = $('svDong').value, plan = [], used = new Set();
    for (const line of lines) {
      const c = line.split(/\t|,| {2,}/).map(x => x.trim());
      const nameKey = norm(c[0] || '');
      if (!nameKey || /단지명|아파트명/.test(c[0])) continue;                    // 제목 줄은 건너뜀
      let cand = byName.get(nameKey) || [...byName.entries()].filter(([k]) => k.includes(nameKey) || nameKey.includes(k)).flatMap(([, v]) => v);
      cand = [...new Set(cand)];
      if (dong) cand = cand.filter(r => r.dong === dong);
      const a = (c[1] || '').replace(/㎡|m2/gi, '');
      if (/평/.test(a)) { const py = parseInt(a, 10); cand = cand.filter(r => CONFIG.toPyeong(r.g) === py); }
      else if (a && !isNaN(parseFloat(a))) cand = cand.filter(r => r.g === Math.floor(parseFloat(a)));
      const p = { text: `${c[0]}${c[1] ? ' ' + c[1] : ''}`, s: toMan(c[2] || ''), r: toMan(c[3] || ''), sn: parseInt(c[4], 10), rn: parseInt(c[5], 10), err: '', warn: [] };
      const names = new Set(cand.map(r => r.key));
      if (!cand.length) p.err = '단지를 찾지 못함 (이름을 확인하거나 별칭을 등록하세요)';
      else if (cand.length !== 1 || names.size !== 1) p.err = `여러 개와 맞음 — 평형을 적어 주세요 (${[...new Set(cand.map(r => `${r.name} ${r.g}㎡`))].slice(0, 4).join(', ')})`;
      else if (p.s == null && p.r == null) p.err = '가격이 없음';
      else {
        const r = p.row = cand[0], rc = Tracking.rec(r.id) || { quotes: {} }, old = rc.quotes[m] || {}, last = rc.quotes[pm] || {};
        if (used.has(r.id)) p.warn.push('같은 단지가 두 번 나옴 (아래 줄 값이 남음)');
        used.add(r.id);
        const big = (v) => v != null && (v < 3000 || v > 2000000);
        if (big(p.s) || big(p.r)) p.warn.push('금액 단위 확인 (억 단위로 적어야 함. 예: 9.5)');
        if (p.s != null && p.r != null && p.r >= p.s) p.warn.push('전세가 매매보다 비쌈');
        if (p.s != null && last.s && Math.abs(p.s / last.s - 1) > 0.2) p.warn.push(`지난 기록(${Kit.eok(last.s)})과 20% 넘게 차이`);
        if (p.s != null && r.sale && Math.abs(p.s / r.sale.price - 1) > 0.3) p.warn.push(`최근 실거래(${Kit.eok(r.sale.price)})와 30% 넘게 차이`);
        if ((p.s != null && old.s != null && old.s !== p.s) || (p.r != null && old.r != null && old.r !== p.r)) p.warn.push(`이미 적은 값을 바꿈 (${old.s != null ? '매매 ' + Kit.eok(old.s) : ''}${old.r != null ? ' 전세 ' + Kit.eok(old.r) : ''})`);
      }
      plan.push(p);
    }
    return plan;
  }
  function pastePreview() {
    if (!$('pasteText').value.trim()) return U.toast('붙여 넣은 내용이 없습니다.');
    pastePlan = pasteParse();
    const ok = pastePlan.filter(p => !p.err), warn = ok.filter(p => p.warn.length), bad = pastePlan.filter(p => p.err);
    $('pasteResult').innerHTML = `<b>${Tracking.ymLabel(month())}</b> 기록에 넣을 줄 <b>${ok.length}개</b>` + (warn.length ? ` (그중 확인 필요 <b class="rent">${warn.length}개</b>)` : '') + (bad.length ? ` · 넣지 못하는 줄 <b class="up">${bad.length}개</b>` : '') +
      (ok.length ? ' — 표를 확인하고 <b>[넣기]</b>를 누르세요.' : '');
    $('pastePreview').innerHTML = '<thead><tr><th class="c">상태</th><th class="l">붙여 넣은 줄</th><th class="l">들어갈 단지</th><th>매매</th><th>전세</th><th>매물(매/전)</th><th class="l">확인할 점</th></tr></thead><tbody>' +
      pastePlan.map(p => `<tr><td class="c">${p.err ? '❌' : p.warn.length ? '⚠️' : '✅'}</td><td class="l">${U.esc(p.text)}</td><td class="l">${p.row ? `${U.esc(p.row.dong)} ${U.esc(p.row.name)} ${p.row.g}㎡` : '-'}</td>` +
        `<td>${Kit.eok(p.s)}</td><td>${Kit.eok(p.r)}</td><td>${isNaN(p.sn) ? '-' : p.sn} / ${isNaN(p.rn) ? '-' : p.rn}</td><td class="l ${p.err ? 'up' : 'rent'}">${U.esc(p.err || p.warn.join(' · '))}</td></tr>`).join('') + '</tbody>';
    $('pastePreviewWrap').hidden = !pastePlan.length;
    $('pasteApply').disabled = !ok.length;
  }
  function pasteApply() {
    const m = month(), skipWarn = $('pasteSkipWarn').checked;
    let ok = 0;
    for (const p of pastePlan) {
      if (p.err || (skipWarn && p.warn.length)) continue;
      const rc = Tracking.rec(p.row.id, true), q = rc.quotes[m] = rc.quotes[m] || {};
      if (p.s != null) q.s = p.s; if (p.r != null) q.r = p.r; if (!isNaN(p.sn)) q.sn = p.sn; if (!isNaN(p.rn)) q.rn = p.rn;
      (rc.qt = rc.qt || {})[m] = Tracking.sameDay(); ok++;
    }
    Tracking.save(); apply(); renderHistory();
    const left = pastePlan.length - ok;
    pastePlan = []; $('pasteApply').disabled = true;
    if (!left) { $('pasteModal').hidden = true; U.toast(`${ok}개 단지의 호가를 넣었습니다.`); }
    else $('pasteResult').innerHTML = `<b>${ok}개</b>를 넣었습니다. 넣지 않은 ${left}줄은 위 표에서 확인해 고친 뒤 다시 [미리보기]를 누르세요.`;
  }

  function excel() {
    const sel = view.filter(r => checked.has(r.id));
    const list = sel.length ? sel : view;
    if (!list.length) return U.toast('내려받을 단지가 없습니다.');
    const m = month(), [si, gu] = U.siGu(reg[1], reg[2]), r1 = (v) => (v == null ? '' : +v.toFixed(1));
    const F = Tracking.FIXED.map(n => (n === '구조' ? '구조(계,복)' : n)), G = Tracking.GROUP;
    const tail = ['호가-실거래', '최근 매매 실거래', '매매 실거래일', '최근 전세 실거래', '전세 실거래일', '가격대 기준', '상태', '후보', '메모'];
    const top = [...F.map(() => ''), ...(m ? [Tracking.ymLabel(m), ...G.slice(1).map(() => '')] : []), ...tail.map(() => '')];
    const out = list.map(r => {
      const c = compute(r), rc = c.rc;
      return [c.band, si, gu, r.dong, rc.zone || '', r.name, r.buildYear || '', r.buildYear ? CONFIG.toAge(r.buildYear) : '', rc.households || r.hh || '', rc.pyeong || CONFIG.toPyeong(r.g) + '평',
        rc.structure || '', rc.rooms || '', rc.baths || '', rc.link || U.landLink(r.sgg, r.dong, r.name), c.peak ?? '', r1(c.drop), c.trough ?? '', r1(c.rise),
        ...(m ? [c.q.s ?? '', c.q.sn ?? '', c.sd ?? '', c.q.r ?? '', c.q.rn ?? '', c.rd ?? '', c.gap ?? '', c.gd ?? '', r1(c.ratio), r1(c.rtd)] : []),
        c.askGap ?? '', r.sale?.price ?? '', U.date(r.sale?.d), r.rent?.price ?? '', U.date(r.rent?.d), c.quoted ? '호가' : (c.base ? '실거래' : ''), rc.status || '', rc.cand ? '후보' : '', rc.memo || ''];
    });
    U.download(`전수조사_${reg[2]}_${m || ''}_${U.stamp()}`, [
      { name: '전수조사', rows: [top, [...F, ...(m ? G : []), ...tail], ...out] },
      { name: '설명', rows: [['항목', '설명'], ['금액 단위', '만원'], ['매매·전세·개수', '기록한 달에 직접 적은 호가와 매물 수'], ['전월 대비', '기록한 달 값 - 바로 앞 기록 달 값'],
        ['가격대', '적은 매매 호가 기준. 호가가 없으면 최근 실거래가 기준("가격대 기준" 열에 표시)'], ['호가-실거래', '적은 매매 호가 - 최근 매매 실거래가'],
        ['전고점·전저점', `${String(CONFIG.PEAK_FROM).slice(0, 4)}년 이후 매매 실거래 최고·최저가(직거래 제외). 직접 고친 값이 있으면 그 값`], ['실거래 자료', '국토교통부 실거래가 공개시스템']] },
    ], 'xlsx');
  }

  /** 탭을 열 때 / 백업을 불러온 뒤: 달 목록과 조사 기록 갱신 */
  function open() { if (!regions.length) return; fillMonths(); renderHistory(); if (rows.length) apply(); }

  return { init, open };
})();
