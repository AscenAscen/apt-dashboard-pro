/* ─────────────────────────────────────────────────────────
   guide.js — [가이드·설정] 탭
   글자 크기 · 점검(자료가 잘 들어오는지) · 월간 리포트(인쇄/PDF) · 단지 별칭 관리 · 호가 수정 이력
   ───────────────────────────────────────────────────────── */
const Guide = (() => {
  const $ = (id) => document.getElementById(id);

  /* ── 글자 크기 ── */
  function applyFont() { document.documentElement.style.setProperty('--zoom', Store.get('apt.font', '1')); }

  /* ── 점검 ── */
  async function health() {
    Data.refresh();                                  // 상태 파일을 새로 받음
    const [st, sig, ex, regs] = await Promise.all([Data.status(), Data.signals(), Data.extraStatus(), Data.regions()]);
    const rows = [], add = (ok, name, text) => rows.push([ok, name, text]);
    const days = (text) => { const d = new Date(String(text).replace(' ', 'T')); return isNaN(d) ? null : Math.floor((Date.now() - d.getTime()) / 864e5); };
    if (!st) add('bad', '실거래 자동 수집', '상태 파일(data/status.json)이 없습니다. 아직 한 번도 수집되지 않았거나 Actions 가 실패했습니다.');
    else {
      const old = days(st.updatedAt), p = (k) => { const x = st.progress?.[k]; return x && x.total ? `${Math.floor(x.done / x.total * 100)}%` : '0%'; };
      const pri = (k) => { const x = st.progress?.[k]; return x && x.priorityTotal ? `${Math.floor(x.priorityDone / x.priorityTotal * 100)}%` : '-'; };
      add(old != null && old > 2 ? 'warn' : 'ok', '실거래 자동 수집', `마지막 갱신 ${U.esc(st.updatedAt)}${old != null && old > 2 ? ` — <b>${old}일 전</b>입니다. GitHub → Actions 에서 실행이 멈췄는지 확인하세요.` : ''}`);
      add('ok', '수집률', `매매 ${p('sale')} / 전세 ${p('rent')} (전체 20년 기준) · 주요 지역 2020년 이후: 매매 ${pri('sale')} / 전세 ${pri('rent')}`);
      const lr = st.lastRun || {};
      add(String(lr.stop || '').startsWith('인증키') ? 'bad' : lr.failed ? 'warn' : 'ok', '마지막 실행', `호출 매매 ${lr.calls?.sale ?? 0} / 전세 ${lr.calls?.rent ?? 0}번 · 저장 ${lr.savedMonths ?? 0}달 · 실패 ${lr.failed ?? 0}건 · ${lr.minutes ?? 0}분` + (lr.stop ? ` · 멈춘 이유: ${U.esc(lr.stop)}` : ''));
      if (st.emptyRegions?.length) add('warn', `자료 없는 지역 ${st.emptyRegions.length}곳`, `행정구역이 바뀌어 지역코드가 달라졌을 수 있습니다: ${U.esc(st.emptyRegions.join(', '))}`);
      if (lr.warnings?.length) add('warn', `경고 ${lr.warnings.length}건`, lr.warnings.slice(0, 5).map(U.esc).join('<br>'));
    }
    if (!sig) add('warn', '시장 신호', '아직 없습니다. 새 수집기(collect.py · signals.py)가 한 번 돌면 생깁니다.');
    else { const n = Object.keys(sig.regions).length, full = Object.values(sig.regions).filter(x => x.full).length; add(full < n ? 'warn' : 'ok', '시장 신호', `기준 ${sig.asOf} · ${n}개 지역 (2020년 이후 수집 완료 ${full}곳) · 신고가 ${sig.highs.length}건 / 급락 ${sig.drops.length}건`); }
    if (!ex) add('warn', '단지 정보(세대수) · R-ONE', '아직 없습니다. 새 수집기(extra.py)가 한 번 돌면 생깁니다.');
    else {
      const k = ex.kapt || {}, r = ex.rone || {};
      add(k.error || /오류|인증키|승인/.test(k.stop || '') ? 'bad' : (k.regionsDone || 0) < (k.regionsTotal || 0) ? 'warn' : 'ok', '단지 정보 (세대수)',
        k.error ? U.esc(k.error) : `지역 ${k.regionsDone ?? 0}/${k.regionsTotal ?? 0} 완료 · 세대수 연결 ${(k.matched ?? 0).toLocaleString()}/${(k.complexes ?? 0).toLocaleString()}단지` + (k.stop ? ` · ${U.esc(k.stop)}` : '') + (k.warnings?.length ? `<br><small>${k.warnings.slice(0, 3).map(U.esc).join('<br>')}</small>` : ''));
      add(r.error ? (/없어 건너뜀/.test(r.error) ? 'warn' : 'bad') : 'ok', 'R-ONE 통계', r.error ? U.esc(r.error) : `기준 ${U.esc(r.asOf || '-')} · ` + ['sale', 'rent'].map(x => (r.tables?.[x] ? `${x === 'sale' ? '매매' : '전세'}지수 ${r.tables[x].regions}개 지역 (${U.esc(r.tables[x].name || r.tables[x].id)})` : `${x === 'sale' ? '매매' : '전세'}지수 없음`)).join(' · '));
    }
    add(CONFIG.KAKAO_JS_KEY ? 'ok' : 'warn', '카카오 지도 키', CONFIG.KAKAO_JS_KEY ? '설정됨 (지도가 안 보이면 카카오디벨로퍼스의 사이트 도메인 등록을 확인)' : 'js/config.js 에 KAKAO_JS_KEY 가 비어 있습니다.');
    let bytes = 0; try { for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key.startsWith('apt.')) bytes += (key.length + localStorage.getItem(key).length) * 2; } } catch (e) { /* 무시 */ }
    const recs = Tracking.allRecords(), bk = Store.get('apt.lastBackup', 0), bd = bk ? Math.floor((Date.now() - bk) / 864e5) : null;
    add(bytes > 4e6 ? 'warn' : 'ok', '내 기록', `시세트래킹 ${Tracking.all().length}개 · 전수조사 기록 ${recs.filter(x => !x.tracked).length}개 · 기록한 달 ${Tracking.getMonths().length}개 · 저장 공간 ${(bytes / 1048576).toFixed(2)}MB 사용 (브라우저 한도 약 5~10MB)`);
    add(bd == null || bd > 14 ? 'warn' : 'ok', '마지막 백업', bd == null ? '아직 백업한 적이 없습니다. 시세트래킹 → 관리에서 백업 파일을 받아 두세요.' : `${bd}일 전`);
    add('ok', '지역 목록', `${regs.length}개 시군구`);
    const icon = { ok: '✅', warn: '⚠️', bad: '❌' };
    $('hcTable').innerHTML = '<thead><tr><th class="c">상태</th><th class="l">항목</th><th class="l">내용</th></tr></thead><tbody>' + rows.map(([ok, n, t]) => `<tr><td class="c">${icon[ok]}</td><td class="l"><b>${n}</b></td><td class="l" style="white-space:normal">${t}</td></tr>`).join('') + '</tbody>';
  }

  /* ── 별칭 · 수정 이력 ── */
  async function aliasTable() {
    const regs = await Kit.regions(), list = Alias.all();
    $('alTable').innerHTML = '<thead><tr><th class="l">지역</th><th class="l">단지</th><th class="l">별칭</th><th class="c">관리</th></tr></thead><tbody>' +
      (list.length ? list.map((a, i) => { const p = Data.parseKey(a.key); return `<tr><td class="l">${U.esc(regs.get(a.code)?.[2] || a.code)} ${U.esc(p.dong)}</td><td class="l">${U.esc(p.name)}</td><td class="l">${U.esc(a.a)}</td><td class="c"><button class="mini" data-edit="${i}">고치기</button></td></tr>`; }).join('')
        : '<tr><td colspan="4" style="color:var(--sub);padding:16px">등록한 별칭이 없습니다.</td></tr>') + '</tbody>';
    $('alTable').onclick = (e) => { const i = e.target.dataset.edit; if (i == null) return; const a = list[+i]; if (Alias.ask(a.code, a.key, Data.parseKey(a.key).name)) aliasTable(); };
  }
  function logTable() {
    const log = QLog.all();
    $('logTable').innerHTML = '<thead><tr><th class="c">고친 때</th><th class="l">단지</th><th>기록 달</th><th>항목</th><th>전</th><th>후</th></tr></thead><tbody>' +
      (log.length ? log.map(x => { if (x.bulk) return `<tr><td class="c">${U.esc(x.t)}</td><td class="l" colspan="5">한꺼번에 ${x.bulk}칸이 바뀜 (백업 불러오기 등)</td></tr>`;
        const p = Kit.parseId(x.id), money = x.f === 's' || x.f === 'r', show = (v) => (v == null ? '<small>지움</small>' : money ? Kit.eok(v) : v);
        return `<tr><td class="c">${U.esc(x.t)}</td><td class="l">${U.esc(p.dong)} ${U.esc(p.name)} ${p.g}㎡</td><td>${Kit.ymText(x.ym)}</td><td>${QLog.NAMES[x.f] || x.f}</td><td>${show(x.a)}</td><td><b>${show(x.b)}</b></td></tr>`; }).join('')
        : '<tr><td colspan="6" style="color:var(--sub);padding:16px">고친 기록이 없습니다.</td></tr>') + '</tbody>';
  }

  /* ── 월간 리포트 ── */
  function fillReport() {
    const ms = Tracking.getMonths(), folders = Tracking.exportAll().folders || [];
    $('rpMonth').innerHTML = ms.length ? ms.map(m => `<option value="${m}">${Tracking.ymLabel(m)}</option>`).join('') : '<option value="">(기록한 달 없음)</option>';
    $('rpFolder').innerHTML = '<option value="">전체</option>' + folders.map(f => `<option>${U.esc(f)}</option>`).join('');
  }
  async function report() {
    const ym = +$('rpMonth').value, folder = $('rpFolder').value;
    if (!ym) return U.toast('시세트래킹에서 먼저 [시세 추가]로 달을 만들고 호가를 적어 주세요.');
    const ms = Tracking.getMonths(), prev = ms[ms.indexOf(ym) + 1] || null;
    const list = (await Kit.records(true)).filter(x => !folder || (x.rec.folders || []).includes(folder));
    if (!list.length) return U.toast('리포트에 담을 단지가 없습니다.');
    const btn = $('btnReport'); btn.disabled = true; btn.textContent = '만드는 중…';
    try {
      await Real.load(list);
      const rows = list.map(x => {
        const q = x.rec.quotes?.[ym] || {}, p = (prev && x.rec.quotes?.[prev]) || {}, rl = Real.get(x.id) || {};
        const d = (a, b) => (a != null && b != null ? a - b : null);
        return { x, q, p, rl, sd: d(q.s, p.s), rd: d(q.r, p.r), gap: d(q.s, q.r), ratio: q.s && q.r ? q.r / q.s * 100 : null, sp: q.s != null && p.s ? (q.s / p.s - 1) * 100 : null };
      }).sort((a, b) => `${a.x.sgg}${a.x.dong}${a.x.name}`.localeCompare(`${b.x.sgg}${b.x.dong}${b.x.name}`, 'ko') || a.x.g - b.x.g);
      const withS = rows.filter(r => r.q.s != null), moved = rows.filter(r => r.sd != null);
      const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
      const up = moved.filter(r => r.sd > 0), down = moved.filter(r => r.sd < 0);
      const card = (k, v, s = '', cls = '') => `<div class="card"><div class="k">${k}</div><div class="v ${cls}">${v}</div><div class="s">${s}</div></div>`;
      const sp = avg(moved.map(r => r.sp)), ratio = avg(rows.filter(r => r.ratio != null).map(r => r.ratio));
      const top = (arr, n) => arr.slice(0, n).map(r => `<li><b>${U.esc(r.x.name)}</b> ${r.x.g}㎡ — ${Kit.eok(r.p.s)} → ${Kit.eok(r.q.s)} <span class="${U.cls(r.sd)}">(${U.diff(r.sd)}, ${U.pct(r.sp)})</span></li>`).join('') || '<li class="hint">없음</li>';
      const temps = [];
      for (const code of [...new Set(list.map(x => x.code))].slice(0, 12)) { const t = await Market.tempOf(code); if (t && t.score != null) temps.push({ name: list.find(x => x.code === code).sgg, t }); }
      const visits = (typeof Imjang !== 'undefined' ? Imjang.all() : []).filter(v => (v.n.date || '').replace('-', '').slice(0, 6) === String(ym) && (!folder || v.it.folders.includes(folder)));
      const t = new Date();
      $('report').innerHTML = `<h2>${Tracking.ymLabel(ym)} 시세 리포트${folder ? ` — ${U.esc(folder)}` : ''}</h2>
        <p class="hint">만든 날 ${t.getFullYear()}.${t.getMonth() + 1}.${t.getDate()} · 호가는 직접 조사해 적은 값, 실거래는 국토교통부 실거래가 공개자료${prev ? ` · 비교 기준 ${Tracking.ymLabel(prev)}` : ''}</p>
        <div class="cards">${[
          card('단지', `${rows.length}개`, `이번 달 매매 호가를 적은 단지 ${withS.length}개`),
          card('매매 호가 평균 변동', sp == null ? '-' : U.pct(sp), moved.length ? `평균 ${U.diff(Math.round(avg(moved.map(r => r.sd))))} · 비교 가능 ${moved.length}개` : '지난달 기록과 견줄 단지가 없습니다', U.cls(sp)),
          card('오른 단지 / 내린 단지', `${up.length} / ${down.length}`, `그대로 ${moved.length - up.length - down.length}개`),
          card('평균 전세가율', ratio == null ? '-' : ratio.toFixed(1) + '%', '매매·전세 호가를 모두 적은 단지 기준'),
        ].join('')}</div>
        <h3>많이 오른 단지</h3><ul>${top([...up].sort((a, b) => b.sp - a.sp), 5)}</ul>
        <h3>많이 내린 단지</h3><ul>${top([...down].sort((a, b) => a.sp - b.sp), 5)}</ul>
        ${temps.length ? `<h3>지역 온도 점수</h3><ul>${temps.map(o => `<li><b>${U.esc(o.name)}</b> ${o.t.score}점 (${CONFIG.tempLabel(o.t.score)}) — 거래량 ${U.pct(o.t.vol * 100, 0)}, 가격 ${o.t.price == null ? '-' : U.pct(o.t.price * 100)}${o.t.full ? '' : ' · 수집 중(참고용)'}</li>`).join('')}</ul>` : ''}
        <h3>단지별 시세</h3>
        <table><thead><tr><th class="l">단지</th><th>평형</th><th>매매 호가</th><th>전월 대비</th><th>전세 호가</th><th>전월 대비</th><th>갭</th><th>전세가율</th><th>매물 (매/전)</th><th>최근 실거래</th><th class="l">상태 · 메모</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td class="l">${U.esc(r.x.sgg)} ${U.esc(r.x.dong)} <b>${U.esc(r.x.name)}</b></td><td>${r.x.g}㎡</td><td>${Kit.eok(r.q.s)}</td><td class="${U.cls(r.sd)}">${U.diff(r.sd)}</td><td>${Kit.eok(r.q.r)}</td><td class="${U.cls(r.rd)}">${U.diff(r.rd)}</td>` +
          `<td>${r.gap == null ? '-' : Kit.eok(r.gap)}</td><td>${r.ratio == null ? '-' : r.ratio.toFixed(0) + '%'}</td><td>${r.q.sn ?? '-'} / ${r.q.rn ?? '-'}</td><td>${r.rl.sale ? `${Kit.eok(r.rl.sale.price)} <small>${U.date(r.rl.sale.d)}</small>` : '-'}</td>` +
          `<td class="l" style="white-space:normal">${U.esc([r.x.rec.status, r.x.rec.memo].filter(Boolean).join(' · '))}</td></tr>`).join('')}</tbody></table>
        ${visits.length ? `<h3>이번 달 임장 기록</h3><ul>${visits.map(v => `<li><b>${U.esc(v.it.name)}</b> ${v.it.g}㎡ (${U.esc(v.n.date)}) — 총점 ${v.t ?? '-'}점${v.n.memo ? ` · ${U.esc(v.n.memo)}` : ''}</li>`).join('')}</ul>` : ''}`;
      $('report').hidden = false; $('btnPrint').hidden = false;
    } finally { btn.disabled = false; btn.textContent = '리포트 만들기'; }
  }

  function init() {
    applyFont();
    $('fontSel').value = Store.get('apt.font', '1');
    $('fontSel').onchange = () => { Store.set('apt.font', $('fontSel').value); applyFont(); };
    $('btnHealth').onclick = () => health().then(() => U.toast('다시 확인했습니다.'));
    $('btnLogClear').onclick = () => { if (confirm('호가 수정 이력을 모두 지울까요? (적어 둔 호가는 그대로입니다)')) { QLog.clear(); logTable(); } };
    $('btnReport').onclick = () => report().catch(e => { console.error(e); U.toast('리포트를 만들지 못했습니다: ' + (e.message || e)); });
    $('btnPrint').onclick = () => { document.body.classList.add('printing'); window.print(); };
    window.addEventListener('afterprint', () => document.body.classList.remove('printing'));
  }
  function open() { health(); aliasTable(); logTable(); fillReport(); }
  return { init, open, applyFont };
})();
