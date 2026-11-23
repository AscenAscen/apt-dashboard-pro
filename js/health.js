/* ─────────────────────────────────────────────────────────
   health.js — 수집 상태판
   위쪽 줄의 신호등 버튼(🟢/🟡/🔴)을 누르면, 자동 수집기마다 마지막 성공 시각 · 문제 · 고치는 법 · GitHub 바로가기를 한 화면에.
   자료: data/status.json · extra_status.json · kapt_file_status.json · kb_weekly.json · population_status.json
         supply_status.json · migration_status.json · signals.json · names.json
   ───────────────────────────────────────────────────────── */
const Health = (() => {
  const $ = (id) => document.getElementById(id);
  const ICON = { ok: '🟢', info: '🔵', warn: '🟡', bad: '🔴' };
  const RANK = { ok: 0, info: 0, warn: 1, bad: 2 };
  let last = null;

  /* GitHub 저장소 주소 (사이트 주소에서 알아냄: ○○.github.io/저장소이름) */
  function repo() {
    if (CONFIG.GITHUB_REPO) return 'https://github.com/' + CONFIG.GITHUB_REPO;
    const h = location.hostname;
    if (!h.endsWith('.github.io')) return null;
    const seg = location.pathname.split('/').filter(Boolean)[0];
    return `https://github.com/${h.split('.')[0]}/${seg || h}`;
  }
  const wf = (file) => (repo() ? `${repo()}/actions/workflows/${file}` : null);

  /* 시각 → 몇 시간/일 전 */
  function parseTime(t) {
    if (t == null || t === '') return null;
    const s = String(t);
    if (/^\d{8}$/.test(s)) return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
    if (/^\d{6}$/.test(s)) return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, 1);
    const d = new Date(s.replace(' ', 'T'));
    return isNaN(d) ? null : d;
  }
  const hoursAgo = (t) => { const d = parseTime(t); return d ? (Date.now() - d.getTime()) / 36e5 : null; };
  function ago(t) {
    const h = hoursAgo(t); if (h == null) return '-';
    if (h < 1) return '방금';
    if (h < 24) return `${Math.floor(h)}시간 전`;
    return `${Math.floor(h / 24)}일 전`;
  }
  const ym = (v) => (v ? `${String(v).slice(0, 4)}.${String(v).slice(4, 6)}` : '-');
  const worse = (a, b) => (RANK[b] > RANK[a] ? b : a);
  /** 나이로 상태: okH 이내 정상, warnH 이내 주의, 그 뒤 문제 */
  const byAge = (h, okH, warnH) => (h == null ? 'warn' : h <= okH ? 'ok' : h <= warnH ? 'warn' : 'bad');

  /* ── 수집기마다 상태 만들기 ── */
  async function collect(fresh) {
    if (fresh) Data.refreshStatus();                 // 상태 파일만 새로 받음 (예전에는 받아 둔 자료를 전부 지워 names.json 등을 두 번 받았음)
    const j = (f) => Data.json(f, null).catch(() => null);
    const [st, ex, kf, kb, pop, sup, mig, sig, nm] = await Promise.all([Data.status(), Data.extraStatus(), Data.kaptFile(), Data.kbWeekly(),
      j('population_status.json'), j('supply_status.json'), j('migration_status.json'), Data.signals(), Data.names()]);
    const items = [];
    const add = (o) => items.push(Object.assign({ issues: [], fix: [], notes: [] }, o));

    /* 1. 실거래 (2시간마다) */
    if (!st) add({ id: 'sale', name: '실거래 자동 수집', every: '2시간마다', lv: 'bad', wf: wf('update.yml'), sum: '상태 파일이 없습니다', issues: ['data/status.json 이 없습니다. 한 번도 수집되지 않았거나 Actions 가 실패했습니다.'], fix: ['GitHub → Actions → 「실거래가 자동 수집」에서 빨간 ❌ 가 있는지 확인'] });
    else {
      const h = hoursAgo(st.updatedAt), lr = st.lastRun || {};
      const pct = (k) => { const x = st.progress?.[k]; return x && x.total ? Math.floor(x.done / x.total * 100) : 0; };
      let lv = byAge(h, 6, 48); const o = { id: 'sale', name: '실거래 자동 수집', every: '2시간마다', wf: wf('update.yml'), when: st.updatedAt,
        sum: `${ago(st.updatedAt)} · 수집률 매매 ${pct('sale')}% / 전세 ${pct('rent')}%`, issues: [], fix: [], notes: [] };
      if (lv !== 'ok') { o.issues.push(`마지막 갱신이 ${ago(st.updatedAt)}입니다 (보통 2시간마다).`); o.fix.push('GitHub → Actions 에서 실행이 멈췄거나 실패했는지 확인 → 실패면 Re-run all jobs'); }
      if (String(lr.stop || '').startsWith('인증키')) { lv = 'bad'; o.issues.push('국토부 인증키 문제: ' + lr.stop); o.fix.push('공공데이터포털 → 마이페이지 → 인증키 유효기간 확인 → GitHub Secrets 의 MOLIT_API_KEY 갱신'); }
      else if (lr.stop) o.notes.push('멈춘 이유: ' + lr.stop);
      if (lr.failed) { lv = worse(lv, 'warn'); o.issues.push(`마지막 실행에서 실패 ${lr.failed}건`); }
      if (st.emptyRegions?.length) {
        lv = worse(lv, 'warn');
        o.issues.push(`실거래 자료가 없는 지역 ${st.emptyRegions.length}곳 — 행정구역 개편으로 지역코드가 바뀐 것으로 보입니다: ${st.emptyRegions.join(', ')}`);
        o.fix.push('지역코드 표(data/regions.json)를 새 코드로 맞춰야 합니다 — 이 화면을 캡처해 보내 주세요.');
      }
      (lr.warnings || []).slice(0, 5).forEach(w => o.notes.push(w));
      if (lr.closed) o.notes.push('이번 실행: ' + Object.entries(lr.closed).map(([k, v]) => `${k === 'sale' ? '매매' : '전세'} ${v}`).join(' · '));
      o.lv = lv; add(o);
    }

    /* 2. 시장 신호 · 전국 단지 이름 (실거래 수집 때 함께) */
    if (sig) { const n = Object.keys(sig.regions || {}).length; add({ id: 'sig', name: '시장 신호 (신고가·급락)', every: '실거래 수집 때', wf: wf('update.yml'), when: sig.asOf, lv: byAge(hoursAgo(sig.asOf), 48, 24 * 7), sum: `${ago(sig.asOf)} · ${n}개 지역 · 신고가 ${(sig.highs || []).length}건` }); }
    else add({ id: 'sig', name: '시장 신호 (신고가·급락)', every: '실거래 수집 때', wf: wf('update.yml'), lv: 'warn', sum: '아직 없음', issues: ['signals.json 이 없습니다.'] });
    add(nm ? { id: 'names', name: '전국 단지 이름 (Ctrl+K 검색)', every: '실거래 수집 때', wf: wf('update.yml'), when: nm.asOf, lv: byAge(hoursAgo(nm.asOf), 48, 24 * 7), sum: `${ago(nm.asOf)} · ${(nm.n || 0).toLocaleString()}단지` }
      : { id: 'names', name: '전국 단지 이름 (Ctrl+K 검색)', every: '실거래 수집 때', wf: wf('update.yml'), lv: 'warn', sum: '없음 — 단지 검색이 안 됩니다', issues: ['names.json 이 없습니다.'] });

    /* 3. 인구 (매월, 실거래 수집 안에서) */
    if (!pop) add({ id: 'pop', name: '인구 (행정안전부)', every: '매월', wf: wf('update.yml'), lv: 'warn', sum: '아직 없음', issues: ['population_status.json 이 없습니다.'] });
    else {
      const want = (() => { const d = new Date(); d.setMonth(d.getMonth() - 2); return d.getFullYear() * 100 + d.getMonth() + 1; })();
      const miss = pop.missing || [], timeout = miss.filter(x => /timed out|timeout/i.test(x)), none = miss.filter(x => !/timed out|timeout/i.test(x));
      let lv = !pop.ok ? 'bad' : +pop.ym >= want ? 'ok' : 'warn';
      const o = { id: 'pop', name: '인구 (행정안전부)', every: '매월', wf: wf('update.yml'), when: pop.lastTry, sum: `${ym(pop.ym)} 기준 · ${pop.regions || 0}개 지역`, issues: [], fix: [], notes: [] };
      if (!pop.ok) o.issues.push('마지막 시도가 실패했습니다' + (pop.error ? ': ' + pop.error : ''));
      if (none.length) { lv = worse(lv, 'warn'); o.issues.push(`인구가 비어 있는 지역 ${none.length}곳 (행정구역 개편 의심): ${none.join(', ')}`); }
      if (timeout.length) { lv = worse(lv, 'warn'); o.issues.push(`응답이 늦어 못 받은 지역 ${timeout.length}곳 — 다음 달 수집 때 다시 시도합니다: ${timeout.map(x => x.split(':')[0]).join(', ')}`); }
      o.lv = lv; add(o);
    }

    /* 4. 공급 (청약홈 · 매주 월) */
    if (!sup) add({ id: 'sup', name: '공급 (청약홈)', every: '매주 월요일', wf: wf('supply.yml'), lv: 'warn', sum: '아직 없음', issues: ['supply_status.json 이 없습니다.'], fix: ['GitHub → Actions → 「공급 자료 수집 (청약홈)」→ Run workflow'] });
    else {
      let lv = sup.ok === false ? 'bad' : byAge(hoursAgo(sup.asOf), 24 * 8, 24 * 15);
      const o = { id: 'sup', name: '공급 (청약홈)', every: '매주 월요일', wf: wf('supply.yml'), when: sup.asOf, sum: ago(sup.asOf), issues: (sup.errors || []).slice(), fix: [], notes: (sup.notes || []).slice() };
      if (o.issues.length) lv = worse(lv, sup.ok === false ? 'bad' : 'warn');
      if (o.issues.some(x => /인증|키/.test(x))) o.fix.push('GitHub Secrets 의 청약홈 인증키(공공데이터포털) 유효기간 확인');
      o.lv = lv; add(o);
    }

    /* 5. 인구이동 (KOSIS · 매주 화) */
    if (!mig) add({ id: 'mig', name: '인구이동 (KOSIS)', every: '매주 화요일', wf: wf('migration.yml'), lv: 'warn', sum: '아직 없음', issues: ['migration_status.json 이 없습니다.'], fix: ['GitHub → Actions → 「인구이동 수집 (KOSIS)」→ Run workflow'] });
    else {
      let lv = !mig.ok ? 'bad' : byAge(hoursAgo(mig.asOf), 24 * 8, 24 * 15);
      const o = { id: 'mig', name: '인구이동 (KOSIS)', every: '매주 화요일', wf: wf('migration.yml'), when: mig.asOf,
        sum: mig.ok ? `${ago(mig.asOf)} · ${mig.months ? ym(mig.months[1]) : '-'}까지 · ${mig.regions || 0}개 지역` : ago(mig.asOf), issues: (mig.errors || []).slice(), fix: [], notes: [] };
      (mig.notes || []).forEach(n => (/자료가 없는 실거래 지역/.test(n) ? o.issues : o.notes).push(n));
      if (o.issues.length && lv === 'ok') lv = 'warn';
      if (o.issues.some(x => /KOSIS_API_KEY|인증키/.test(x))) o.fix.push('GitHub Secrets 에 KOSIS_API_KEY 가 있는지, KOSIS 인증키 유효기간이 지나지 않았는지 확인');
      o.lv = lv; add(o);
    }

    /* 6. 단지 세대수 (K-apt 엑셀 · 올릴 때) / K-apt API · R-ONE (실거래 수집 때) */
    add(kf ? { id: 'kaptf', name: '세대수 (K-apt 엑셀)', every: '엑셀 올릴 때', wf: wf('kapt.yml'), when: kf.updated, lv: kf.matched ? 'ok' : 'warn',
      sum: `${kf.file} · 세대수 연결 ${(kf.matched || 0).toLocaleString()}단지`, notes: kf.unmatched ? [`짝을 못 지은 엑셀 ${kf.unmatched.toLocaleString()}행 (빌라·임대 등이 많음)`] : [] }
      : { id: 'kaptf', name: '세대수 (K-apt 엑셀)', every: '엑셀 올릴 때', wf: wf('kapt.yml'), lv: 'warn', sum: '아직 없음', fix: ['공공데이터포털에서 K-apt 단지 기본정보 엑셀을 받아 저장소 kapt 폴더에 올리기'] });
    /* 6-2. 건축물대장 (매일 새벽, scripts/bldg.py) */
    const bs = await Data.bldgStatus().catch(() => null);
    if (bs) {
      const h = hoursAgo(bs.updatedAt), bad = /인증키|오류/.test(bs.stop || '') && !/한도/.test(bs.stop || '');
      add({ id: 'bldg', name: '세대수·용적률 (건축물대장)', every: '매일 새벽', wf: wf('bldg.yml'), when: bs.updatedAt,
        lv: bad ? 'bad' : byAge(h, 30, 72),
        sum: `${ago(bs.updatedAt)} · ${(bs.complexes || 0).toLocaleString()}단지${bs.left ? ` · 남은 지번 ${bs.left.toLocaleString()}곳 (매일 조금씩 받는 중)` : ' · 전체 완료'}`,
        issues: bad ? [bs.stop] : (h != null && h > 30 ? [`마지막 수집이 ${ago(bs.updatedAt)}입니다 (보통 매일).`] : []),
        fix: bad ? ['공공데이터포털에서 "건축HUB_건축물대장정보 서비스" 활용신청이 승인 상태인지 확인', 'GitHub → Actions → 「건축물대장 세대수·용적률 수집」 실행 기록 확인'] : [],
        notes: bs.stop && !bad ? [bs.stop] : [] });
    } else add({ id: 'bldg', name: '세대수·용적률 (건축물대장)', every: '매일 새벽', wf: wf('bldg.yml'), lv: 'info', sum: '아직 첫 수집 전', notes: ['GitHub → Actions → 「건축물대장 세대수·용적률 수집」 → Run workflow 로 바로 시작할 수 있습니다.'] });
    if (ex) {
      const k = ex.kapt || {}, r = ex.rone || {};
      if (k.stop && /폐기|NO_OPENAPI/.test(k.stop)) add({ id: 'kapt', name: '단지 정보 API (K-apt)', every: '실거래 수집 때', wf: wf('update.yml'), when: ex.updatedAt, lv: kf && kf.matched ? 'info' : 'warn',
        sum: kf && kf.matched ? 'API 가 폐기됨 — 세대수는 K-apt 엑셀로 대신 채우는 중 (문제 없음)' : 'API 가 폐기됨', notes: [k.stop] });
      else if (k.error || /오류|인증키|승인/.test(k.stop || '')) add({ id: 'kapt', name: '단지 정보 API (K-apt)', every: '실거래 수집 때', wf: wf('update.yml'), when: ex.updatedAt, lv: 'warn', sum: '오류', issues: [k.error || k.stop] });
      add({ id: 'rone', name: '한국부동산원 지수 (R-ONE)', every: '실거래 수집 때', wf: wf('update.yml'), when: r.asOf, lv: r.error ? (/건너뜀/.test(r.error) ? 'warn' : 'bad') : byAge(hoursAgo(r.asOf), 24 * 3, 24 * 14),
        sum: r.error ? '오류' : `${ago(r.asOf)} · ${Object.keys(r.tables || {}).map(x => (x === 'sale' ? '매매' : '전세') + ' ' + r.tables[x].regions + '곳').join(' · ')}`, issues: r.error ? [r.error] : [] });
    }

    /* 7. KB 주간 (엑셀 올릴 때) */
    const kbL = Store.get('apt.kbw.v1', null), kbU = kbL && kbL.weeks && (!kb || kbL.last > kb.last) ? kbL : kb;
    add(kbU ? { id: 'kb', name: 'KB 주간 시계열', every: '엑셀 올릴 때', wf: wf('kb.yml'), when: kbU.last, lv: byAge(hoursAgo(kbU.last), 24 * 14, 24 * 30),
      sum: `${String(kbU.last).slice(0, 4)}-${String(kbU.last).slice(4, 6)}-${String(kbU.last).slice(6, 8)} 주 기준 (${ago(kbU.last)})`, fix: byAge(hoursAgo(kbU.last), 24 * 14, 24 * 30) === 'ok' ? [] : ['KB부동산 데이터허브에서 주간 시계열 엑셀을 받아 저장소 kb 폴더에 올리기'] }
      : { id: 'kb', name: 'KB 주간 시계열', every: '엑셀 올릴 때', wf: wf('kb.yml'), lv: 'warn', sum: '아직 없음' });

    /* 8. 행정구역 개편 → 내 기록 코드 바꾸기 (js/regfix.js) */
    const rf = Store.get('apt.regfix.v1', null), rl = rf && rf.runs && rf.runs[rf.runs.length - 1];
    if (rl && rl.pending) add({ id: 'regfix', name: '내 기록 지역 코드 (행정구역 개편)', every: '접속할 때', when: rl.t, lv: 'info',
      sum: `화성시 등 새 구를 아직 정하지 못한 기록 ${rl.pending}건 — 새 구 실거래 자료가 모이면 다음 접속 때 저절로 바뀝니다`,
      notes: ['광주·전남·인천·화성의 지역 코드가 2026년에 바뀌어, 저장된 기록(시세트래킹·전수조사 등)의 코드를 접속할 때 새 코드로 바꿉니다.'] });

    last = items;
    return items;
  }

  /* ── 위쪽 신호등 버튼 ── */
  function badge(items) {
    const b = $('btnHealth'); if (!b) return;
    const bad = items.filter(x => x.lv === 'bad').length, warn = items.filter(x => x.lv === 'warn').length;
    b.className = 'hbtn ' + (bad ? 'bad' : warn ? 'warn' : 'ok');
    b.innerHTML = bad ? `🔴 수집 문제 ${bad}` : warn ? `🟡 확인 필요 ${warn}` : '🟢 수집 정상';
    b.title = '자동 수집 상태 보기 — ' + items.map(x => `${ICON[x.lv]} ${x.name}`).join(' / ');
  }

  /* ── 상태판 창 ── */
  function modal() {
    let m = $('hModal'); if (m) return m;
    m = document.createElement('div'); m.className = 'modal'; m.id = 'hModal'; m.hidden = true;
    m.innerHTML = `<div class="modalbox hbox"><div class="hhead"><b>수집 상태판</b><span id="hTime" class="hint" style="margin:0"></span><span class="grow"></span>
      <button id="hReload" class="mini">새로 확인</button><button id="hClose">닫기 ✕</button></div>
      <p class="hint" id="hSum" style="margin:4px 0 10px"></p><div id="hList"></div>
      <p class="hint">🟢 정상 · 🔵 참고 (문제 아님) · 🟡 확인 필요 · 🔴 문제. 카드를 누르면 자세한 내용이 열립니다. 「GitHub에서 보기」는 그 수집기의 실행 기록 화면으로 갑니다.</p></div>`;
    document.body.appendChild(m);
    $('hClose').onclick = () => { m.hidden = true; };
    $('hReload').onclick = () => open(true);
    m.addEventListener('click', (e) => { if (e.target === m) m.hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !m.hidden) m.hidden = true; });
    return m;
  }
  function render(items) {
    const ord = [...items].sort((a, b) => RANK[b.lv] - RANK[a.lv]);
    const bad = items.filter(x => x.lv === 'bad').length, warn = items.filter(x => x.lv === 'warn').length;
    $('hSum').textContent = bad ? `문제 ${bad}개, 확인 필요 ${warn}개가 있습니다. 위에서부터 확인하세요.` : warn ? `확인할 것이 ${warn}개 있습니다. 나머지는 정상입니다.` : '모든 자동 수집이 정상입니다.';
    $('hTime').textContent = ' · ' + new Date().toLocaleString('ko-KR', { hour12: false });
    const li = (arr) => arr.map(x => `<li>${U.esc(x)}</li>`).join('');
    $('hList').innerHTML = ord.map(x => {
      const more = x.issues.length || x.fix.length || x.notes.length;
      return `<details class="hcard ${x.lv}"${x.lv === 'bad' || (x.lv === 'warn' && x.issues.length) ? ' open' : ''}>
        <summary><span class="hi">${ICON[x.lv]}</span><span class="hn"><b>${U.esc(x.name)}</b><small>${U.esc(x.every)}${x.when ? ' · 마지막 ' + U.esc(String(x.when)) : ''}</small></span><span class="hs">${U.esc(x.sum)}</span>${more ? '<span class="hm">▾</span>' : ''}</summary>
        ${x.issues.length ? `<div class="hsec"><b>문제</b><ul>${li(x.issues)}</ul></div>` : ''}
        ${x.fix.length ? `<div class="hsec"><b>이렇게 하세요</b><ul>${li(x.fix)}</ul></div>` : ''}
        ${x.notes.length ? `<div class="hsec sub"><b>참고</b><ul>${li(x.notes)}</ul></div>` : ''}
        ${x.wf ? `<div class="hsec"><a href="${x.wf}" target="_blank" rel="noopener">GitHub에서 실행 기록 보기 →</a></div>` : ''}
      </details>`;
    }).join('');
  }
  async function open(force) {
    const m = modal(); m.hidden = false;
    if (!last || force) { $('hList').innerHTML = '<p class="hint">확인 중…</p>'; await collect(true); badge(last); }
    render(last);
  }

  /** 가이드·설정 → 점검 표에 넣을 줄 (공급·인구·인구이동) */
  async function guideRows() {
    const items = last || await collect();
    const map = { ok: 'ok', info: 'ok', warn: 'warn', bad: 'bad' };
    return items.filter(x => ['pop', 'sup', 'mig'].includes(x.id)).map(x => [map[x.lv], x.name, U.esc(x.sum) + (x.issues.length ? '<br><small>' + x.issues.map(U.esc).join('<br>') + '</small>' : '')]);
  }

  async function init() {
    const b = $('btnHealth'); if (!b) return;
    b.onclick = () => open(false);
    b.textContent = '수집 상태';
    /* 첫 화면이 다 뜬 뒤(약 5초 후, 브라우저가 한가할 때) 조용히 확인 → 접속 직후의 다운로드 경쟁을 피함 */
    await new Promise(res => setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(res, { timeout: 5000 }) : res()), 5000));
    try { badge(await collect()); } catch (e) { console.error(e); b.textContent = '수집 상태'; }
  }
  return { init, open, collect, guideRows };
})();
