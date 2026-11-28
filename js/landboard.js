/* ─────────────────────────────────────────────────────────
   landboard.js — [랜드마크] 탭의 "판" (지도 대신 시군구 칸에 대표 단지 가격을 채워 보여 줌)
   · S(대표) 등급 랜드마크만 보여 줍니다. 칸마다 지역명 / 단지명·평형 / 최근 실거래가 + 거래일.
   · 한 시군구에 S 단지가 여러 개면 최근 실거래가가 가장 높은 단지가 칸에 보이고 +N 표시.
   · 칸 위치·묶음은 아래 METRO / LOCAL 목록에서 바꿉니다: c('칸에 보일 이름', '시도 줄임말', '시군구(여러 개면 [..])', 열, 줄)
   · 색 구간(억 단위)은 화면의 [색 구간]에서 바꾸며 이 브라우저에 저장됩니다 (apt.landboard.v1).
   ───────────────────────────────────────────────────────── */
const LandBoard = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => U.esc(s);
  const BKEY = 'apt.landboard.v1';
  const SIDO = { 서울: '서울특별시', 인천: '인천광역시', 경기: '경기도', 대전: '대전광역시', 대구: '대구광역시', 부산: '부산광역시', 울산: '울산광역시', 광주: '광주광역시',
    충북: '충청북도', 충남: '충청남도', 전북: '전북특별자치도', 경북: '경상북도', 경남: '경상남도', 강원: '강원특별자치도' };
  // 칸 = [보이는 이름, 시도, 시군구(여러 개면 한 칸에 묶음), 열, 줄]   ← 열은 1칸 = 1, 줄은 1줄 = 23px (칸 하나는 3줄)
  const c = (n, s, g, col, row) => ({ n, s: SIDO[s], g: [].concat(g), col, row });
  const METRO = [
    c('의정부', '경기', '의정부시', 7, 0), c('도봉구', '서울', '도봉구', 7, 3),
    c('파주', '경기', '파주시', 2, 6), c('강북구', '서울', '강북구', 6, 6), c('성북구', '서울', '성북구', 7, 6), c('노원구', '서울', '노원구', 8, 6),
    c('일산 서구', '경기', '고양시 일산서구', 1, 9), c('일산 동구', '경기', '고양시 일산동구', 2, 9), c('고양 덕양', '경기', '고양시 덕양구', 3, 9),
    c('종로구', '서울', '종로구', 6, 9), c('중구', '서울', '중구', 7, 9), c('동대문구', '서울', '동대문구', 8, 9), c('중랑구', '서울', '중랑구', 9, 9), c('남양주', '경기', '남양주시', 11, 9),
    c('은평구', '서울', '은평구', 4, 10), c('서대문구', '서울', '서대문구', 5, 10), c('구리', '경기', '구리시', 10, 10),
    c('마포구', '서울', '마포구', 6, 12), c('용산구', '서울', '용산구', 7, 12), c('성동구', '서울', '성동구', 8, 12), c('광진구', '서울', '광진구', 9, 12),
    c('김포', '경기', '김포시', 3, 15), c('송파구', '서울', '송파구', 10, 15), c('강동구', '서울', '강동구', 11, 15), c('하남', '경기', '하남시', 12, 15),
    c('강서구', '서울', '강서구', 4, 16), c('양천구', '서울', '양천구', 5, 16), c('영등포구', '서울', '영등포구', 6, 16), c('동작구', '서울', '동작구', 7, 16), c('서초구', '서울', '서초구', 8, 16), c('강남구', '서울', '강남구', 9, 16),
    c('인천 검단', '인천', '검단구', 0, 18), c('인천 서해', '인천', '서해구', 1, 18), c('계양구', '인천', '계양구', 2, 18),
    c('성남 수정', '경기', '성남시 수정구', 10, 18), c('성남 중원', '경기', '성남시 중원구', 11, 18), c('광주', '경기', '광주시', 12, 18),
    c('부천', '경기', ['부천시 원미구', '부천시 소사구', '부천시 오정구'], 4, 19), c('구로구', '서울', '구로구', 5, 19), c('금천구', '서울', '금천구', 6, 19), c('관악구', '서울', '관악구', 7, 19),
    c('인천 영종', '인천', '영종구', 0, 21), c('인천 제물포', '인천', '제물포구', 1, 21), c('부평구', '인천', '부평구', 2, 21), c('성남 분당', '경기', '성남시 분당구', 10, 21),
    c('광명', '경기', '광명시', 5, 22), c('안양 만안', '경기', '안양시 만안구', 6, 22), c('안양 동안', '경기', '안양시 동안구', 7, 22), c('과천', '경기', '과천시', 8, 22),
    c('미추홀구', '인천', '미추홀구', 0, 24), c('남동구', '인천', '남동구', 1, 24), c('용인 수지', '경기', '용인시 수지구', 10, 24),
    c('안산 단원', '경기', '안산시 단원구', 5, 25), c('안산 상록', '경기', '안산시 상록구', 6, 25), c('군포', '경기', '군포시', 7, 25), c('의왕', '경기', '의왕시', 8, 25),
    c('용인 기흥', '경기', '용인시 기흥구', 11, 26), c('용인 처인', '경기', '용인시 처인구', 12, 26),
    c('연수구', '인천', '연수구', 0, 27), c('시흥', '경기', '시흥시', 2, 27),
    c('화성', '경기', ['화성시 동탄구', '화성시 만세구', '화성시 효행구', '화성시 병점구'], 6, 28), c('수원 권선', '경기', '수원시 권선구', 7, 28), c('수원 장안', '경기', '수원시 장안구', 8, 28),
    c('수원 영통', '경기', '수원시 영통구', 9, 28), c('수원 팔달', '경기', '수원시 팔달구', 10, 28), c('이천', '경기', '이천시', 12, 29),
    c('평택', '경기', '평택시', 2, 31), c('오산', '경기', '오산시', 3, 31), c('안성', '경기', '안성시', 7, 32)];
  const LOCAL = [
    c('청주 흥덕', '충북', '청주시 흥덕구', 5, 0), c('청주 청원', '충북', '청주시 청원구', 6, 0), c('천안 서북', '충남', '천안시 서북구', 4, 0),
    c('원주', '강원', '원주시', 9, 2),
    c('천안 동남', '충남', '천안시 동남구', 4, 3), c('청주 서원', '충북', '청주시 서원구', 5, 3), c('청주 상당', '충북', '청주시 상당구', 6, 3),
    c('대전 유성', '대전', '유성구', 5, 6), c('대전 대덕', '대전', '대덕구', 6, 6), c('대전 서구', '대전', '서구', 5, 9), c('대전 동구', '대전', '동구', 6, 9), c('대전 중구', '대전', '중구', 6, 12),
    c('구미', '경북', '구미시', 7, 13), c('포항 북구', '경북', '포항시 북구', 10, 11), c('포항 남구', '경북', '포항시 남구', 10, 14),
    c('전주 덕진', '전북', '전주시 덕진구', 1, 14), c('전주 완산', '전북', '전주시 완산구', 1, 17),
    c('대구 서구', '대구', '서구', 4, 16), c('대구 북구', '대구', '북구', 5, 16), c('대구 중구', '대구', '중구', 6, 16), c('대구 동구', '대구', '동구', 7, 16),
    c('대구 달성군', '대구', '달성군', 3, 20), c('대구 달서구', '대구', '달서구', 4, 20), c('대구 남구', '대구', '남구', 5, 20), c('대구 수성구', '대구', '수성구', 6, 20),
    c('울산 중구', '울산', '중구', 9, 18), c('울산 북구', '울산', '북구', 10, 18), c('울산 울주군', '울산', '울주군', 8, 22), c('울산 남구', '울산', '남구', 9, 22), c('울산 동구', '울산', '동구', 10, 22),
    c('광주 광산구', '광주', '광산구', 0, 22), c('광주 북구', '광주', '북구', 1, 22), c('광주 서구', '광주', '서구', 0, 25), c('광주 동구', '광주', '동구', 1, 25), c('광주 남구', '광주', '남구', 1, 28),
    c('창원 의창', '경남', '창원시 의창구', 4, 24), c('김해', '경남', '김해시', 5, 24), c('부산 북구', '부산', '북구', 6, 24),
    c('마산회원', '경남', '창원시 마산회원구', 3, 27), c('창원 성산', '경남', '창원시 성산구', 4, 27), c('부산 강서구', '부산', '강서구', 5, 27), c('부산 사상구', '부산', '사상구', 6, 27), c('부산 진구', '부산', '부산진구', 7, 27),
    c('마산합포', '경남', '창원시 마산합포구', 3, 30), c('창원 진해', '경남', '창원시 진해구', 4, 30), c('부산 사하구', '부산', '사하구', 6, 30), c('부산 중구', '부산', '중구', 7, 30),
    c('부산 서구', '부산', '서구', 6, 33), c('부산 영도구', '부산', '영도구', 7, 33),
    c('부산 동래구', '부산', '동래구', 8, 25), c('부산 금정구', '부산', '금정구', 9, 25), c('부산 기장군', '부산', '기장군', 10, 25),
    c('부산 연제구', '부산', '연제구', 8, 28), c('부산 수영구', '부산', '수영구', 9, 28), c('부산 동구', '부산', '동구', 8, 31), c('부산 해운대구', '부산', '해운대구', 9, 31), c('부산 남구', '부산', '남구', 8, 34)];

  const COLORS = ['#696b9b', '#9933ff', '#6699ff', '#a9d18e', '#ffd966', '#ff9966', '#ff99ff', '#ff2b00'];    // 낮은 가격 → 높은 가격
  const BOARDS = {
    metro: { title: '수도권 랜드마크', cols: 13, cells: METRO, bounds: [4, 6, 8, 10, 12, 16, 20] },
    local: { title: '지방 랜드마크', cols: 11, cells: LOCAL, bounds: [3, 4, 5, 6, 7, 9, 11] },
  };
  const DEF_BOUNDS = { metro: BOARDS.metro.bounds.slice(), local: BOARDS.local.bounds.slice() };
  const STALE_DAYS = 183;                                    // 이보다 오래된 실거래는 날짜를 붉게

  let cur = 'metro', selCell = -1, zoom = 1, wired = false, last = null, infos = [], cellOf = { metro: new Map(), local: new Map() }, missing = [], codeReady = false;

  const CSS = `
  .lbwrap { overflow: auto; border: 1px solid var(--line); border-radius: 8px; background: #fff; padding: 0 0 14px; }
  .lbwrap .bhead { display: flex; align-items: center; gap: 16px; background: #ccff66; color: #111; padding: 6px 14px; margin: 14px 14px 12px; min-width: min-content; }
  .lbwrap .bhead b { font-size: 20px; flex: 1; text-align: center; letter-spacing: 1px; }
  .lbwrap .bhead small { color: #333; white-space: nowrap; }
  .lbwrap .legend { display: flex; flex-wrap: wrap; gap: 3px; margin: 0 14px 10px; font-size: 11px; color: #111; }
  .lbwrap .legend span { padding: 1px 8px; border: 1px solid #111; min-width: 54px; text-align: center; }
  .lbwrap .grid { display: grid; margin: 0 14px; grid-auto-rows: 23px; width: max-content; }
  .lbwrap .cell { border: 1px solid #111; background: #fff; color: #111; display: grid; grid-template-rows: 23px 23px 23px; cursor: pointer; min-width: 0; font-size: 12px; margin: 0 -1px -1px 0; }
  .lbwrap .cell:hover { outline: 2px solid #2563eb; outline-offset: -2px; z-index: 2; }
  .lbwrap .cell.sel { outline: 3px solid #2563eb; outline-offset: -3px; z-index: 3; }
  .lbwrap .cell .r1 { display: flex; align-items: center; justify-content: center; gap: 4px; font-weight: 600; padding: 0 4px; white-space: nowrap; overflow: hidden; }
  .lbwrap .cell .r2 { display: flex; align-items: center; justify-content: center; gap: 3px; padding: 0 4px; font-size: 11px; min-width: 0; }
  .lbwrap .cell .r2 span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .lbwrap .cell .r2 small { color: #555; flex: none; font-size: 10px; }
  .lbwrap .cell .r3 { display: flex; align-items: center; justify-content: center; gap: 5px; font-weight: 700; white-space: nowrap; overflow: hidden; }
  .lbwrap .cell .r3 i { font-style: normal; font-weight: 400; font-size: 10px; opacity: .85; }
  .lbwrap .cell .r3 i.old { color: #ff0000; font-weight: 700; opacity: 1; background: rgba(255,255,255,.85); padding: 0 3px; border-radius: 3px; }
  .lbwrap .cell .plus { background: #111; color: #fff; border-radius: 8px; font-size: 10px; padding: 0 5px; font-weight: 700; }
  .lbwrap .cell.empty { border-color: #bbb; color: #999; cursor: default; }
  .lbwrap .cell.empty:hover { outline: 0; }
  .lbwrap .cell.empty .r3 { background: #f1f1f1; font-weight: 400; font-size: 11px; color: #aaa; }
  .lbbands { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; margin: 6px 0; }
  .lbbands input { width: 62px; }
  .lbbands .sw { display: inline-block; width: 14px; height: 14px; border: 1px solid #888; vertical-align: -2px; margin-right: 3px; }
  #lbCell tr[data-id] { cursor: pointer; }`;

  const eok = (v) => String(+(v / 10000).toFixed(2));
  const pyeong = (g) => CONFIG.toPyeong(g) + '평';
  const ymdDate = (d) => new Date(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100);
  const fmtDate = (d) => { const y = Math.floor(d / 10000), m = Math.floor(d / 100) % 100, dd = d % 100; return y === new Date().getFullYear() ? `${m}/${dd}` : `${String(y).slice(2)}.${m}/${dd}`; };
  const isOld = (d) => (Date.now() - ymdDate(d).getTime()) / 86400000 > STALE_DAYS;
  const bandOf = (b, v) => { const i = b.bounds.findIndex(x => v / 10000 <= x); return i < 0 ? b.bounds.length : i; };
  const ink = (hex) => { const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, bl = n & 255; return (0.299 * r + 0.587 * g + 0.114 * bl) < 140 ? '#fff' : '#111'; };

  async function prepare() {                                 // 칸 ↔ 지역코드 연결 (처음 한 번)
    if (codeReady) return;
    const regions = await Data.regions();
    const codeOf = new Map(regions.map(r => [r[1] + '|' + r[2], r[0]]));
    for (const k of Object.keys(BOARDS)) BOARDS[k].cells.forEach((cell, i) => {
      cell.codes = cell.g.map(g => codeOf.get(cell.s + '|' + g)).filter(Boolean);
      if (cell.codes.length !== cell.g.length) missing.push(`${cell.n}`);
      cell.codes.forEach(cd => cellOf[k].set(cd, i));
    });
    const saved = Store.get(BKEY, null);
    if (saved) for (const k of ['metro', 'local']) if (Array.isArray(saved[k]) && saved[k].length === 7) BOARDS[k].bounds = saved[k];
    if (!document.getElementById('lbStyle')) { const st = document.createElement('style'); st.id = 'lbStyle'; st.textContent = CSS; document.head.appendChild(st); }
    codeReady = true;
  }

  const inCell = (k, i) => infos.filter(x => cellOf[k].get(x.l.code) === i).sort((a, b) => (b.sale ? b.sale.price : -1) - (a.sale ? a.sale.price : -1));   // 가격 높은 단지가 칸의 대표

  function legend(b) {
    const bs = b.bounds, out = [];
    for (let i = 0; i <= bs.length; i++) {
      const txt = i === bs.length ? `${bs[i - 1]}억~` : i === 0 ? `~${bs[0]}억` : `${bs[i - 1]}~${bs[i]}억`;
      out.push(`<span style="background:${COLORS[i]};color:${ink(COLORS[i])}">${txt}</span>`);
    }
    return out.reverse().join('');
  }

  function drawBoard() {
    const b = BOARDS[cur];
    const newest = infos.reduce((m, x) => Math.max(m, x.sale ? x.sale.d : 0), 0);
    const cells = b.cells.map((cell, i) => {
      const list = inCell(cur, i), top = list[0];
      const style = `grid-column:${cell.col + 1};grid-row:${cell.row + 1} / span 3`;
      if (!top) return `<div class="cell empty" style="${style}" title="${esc(cell.n)} — S 단지 없음"><div class="r1">${esc(cell.n)}</div><div class="r2"></div><div class="r3">미등록</div></div>`;
      const p = top.sale, extra = list.length - 1, bg = p ? COLORS[bandOf(b, p.price)] : '#eee';
      const price = p ? `${eok(p.price)}억 <i class="${isOld(p.d) ? 'old' : ''}">${fmtDate(p.d)}</i>` : '<span style="font-weight:400;color:#777">거래 없음</span>';
      return `<div class="cell${selCell === i ? ' sel' : ''}" data-i="${i}" style="${style}" title="${esc(top.l.name)} ${pyeong(top.l.g)} (${top.l.g}㎡)${p ? ` · 실거래 ${p.price.toLocaleString()}만원 · ${p.d}` : ''}">
        <div class="r1">${esc(cell.n)}${extra ? `<span class="plus">+${extra}</span>` : ''}</div>
        <div class="r2"><span>${esc(top.l.name)}</span><small>${pyeong(top.l.g)}</small></div>
        <div class="r3" style="background:${bg};color:${ink(bg)}">${price}</div></div>`;
    }).join('');
    let st = null; try { st = window.__lbStatus; } catch (e) { /* 무시 */ }
    $('lbHost').innerHTML = `
      <div class="bhead"><b>${esc(b.title)}</b><small>최근 실거래 기준${newest ? ' · 가장 최근 거래 ' + fmtDate(newest) : ''}${st && st.updatedAt ? ' · 자료 갱신 ' + esc(st.updatedAt) : ''}</small></div>
      <div class="legend">${legend(b)}</div>
      <div class="grid" style="grid-template-columns:repeat(${b.cols},128px);zoom:${zoom}">${cells}</div>`;
    $('lbHost').querySelectorAll('.cell[data-i]').forEach(el => el.onclick = () => { selCell = +el.dataset.i; drawBoard(); drawCell(); });
  }

  function drawCell() {
    const box = $('lbCell'), b = BOARDS[cur], cell = b.cells[selCell];
    if (!cell) { box.hidden = true; return; }
    const list = inCell(cur, selCell);
    box.hidden = false;
    box.innerHTML = `<div class="bar"><strong>${esc(cell.n)} — S(대표) 단지 ${list.length}개</strong><span class="hint" style="margin:0">줄을 누르면 아래 카드에 자세히 나옵니다 · 칸에는 최근 실거래가 가장 높은 단지가 보입니다</span></div>
      <div class="tablewrap short"><table><thead><tr><th class="l">단지</th><th>평형</th><th>최근 실거래</th><th>거래일</th><th>층</th><th>전고점</th><th>전고 대비</th></tr></thead><tbody>${list.map(x => {
        const p = x.sale, pk = x.peak, dr = p && pk ? (p.price / pk.price - 1) * 100 : null;
        return `<tr data-id="${esc(x.l.id)}"><td class="l"><b>${esc(x.l.name)}</b><small> ${esc(x.l.sgg || '')} ${esc(x.l.dong || '')}</small></td><td>${x.l.g}㎡<small>${pyeong(x.l.g)}</small></td>
          <td>${p ? eok(p.price) + '억' : '-'}</td><td>${p ? fmtDate(p.d) : '-'}</td><td>${p ? p.floor : '-'}</td><td>${pk ? eok(pk.price) + '억' : '-'}</td>
          <td class="${dr == null ? '' : U.cls(dr)}">${dr == null ? '-' : U.pct(dr)}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    box.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { const x = infos.find(i => i.l.id === tr.dataset.id); if (x && last?.onPick) last.onPick(x.l); });
    if (list[0] && last?.onPick) last.onPick(list[0].l);
  }

  function drawBands() {
    const box = $('lbBandBox');
    box.innerHTML = `<div class="bar"><strong>색 구간 설정</strong><span class="hint" style="margin:0">억 단위, 작은 값부터 · 저장하면 이 브라우저에 기억합니다</span></div>` + ['metro', 'local'].map(k => `
      <div class="lbbands"><b style="min-width:62px">${k === 'metro' ? '수도권' : '지방'}</b>${BOARDS[k].bounds.map((v, i) => `<span><i class="sw" style="background:${COLORS[i]}"></i>~<input type="number" step="0.5" min="0" data-k="${k}" data-i="${i}" value="${v}">억</span>`).join('')}<span><i class="sw" style="background:${COLORS[7]}"></i>그 이상</span></div>`).join('') +
      `<div class="lbbands"><button id="lbSave" class="primary">저장</button><button id="lbReset">처음 값으로</button><span id="lbBMsg" class="hint"></span></div>`;
    $('lbSave').onclick = () => {
      const nb = { metro: [], local: [] };
      box.querySelectorAll('input[data-k]').forEach(el => { nb[el.dataset.k][+el.dataset.i] = parseFloat(el.value); });
      for (const k of ['metro', 'local']) if (nb[k].some(x => !(x >= 0)) || nb[k].some((x, i) => i && x <= nb[k][i - 1])) { $('lbBMsg').textContent = '구간이 작은 값부터 커지는지 확인해 주세요.'; return; }
      BOARDS.metro.bounds = nb.metro; BOARDS.local.bounds = nb.local; Store.set(BKEY, nb); $('lbBMsg').textContent = '저장했어요.'; drawBoard();
    };
    $('lbReset').onclick = () => { BOARDS.metro.bounds = DEF_BOUNDS.metro.slice(); BOARDS.local.bounds = DEF_BOUNDS.local.slice(); Store.remove(BKEY); drawBands(); drawBoard(); };
  }

  function setBoard(k) { cur = k; selCell = -1; $('lbMetro').classList.toggle('primary', k === 'metro'); $('lbLocal').classList.toggle('primary', k === 'local'); drawBoard(); drawCell(); }
  function setZoom(z) { zoom = Math.max(0.5, Math.min(1.6, +z.toFixed(2))); $('lbZoomTxt').textContent = Math.round(zoom * 100) + '%'; drawBoard(); }
  function wire() {
    if (wired) return; wired = true;
    $('lbMetro').onclick = () => setBoard('metro');
    $('lbLocal').onclick = () => setBoard('local');
    $('lbBands').onclick = () => { const b = $('lbBandBox'); b.hidden = !b.hidden; if (!b.hidden) drawBands(); };
    $('lbZoomIn').onclick = () => setZoom(zoom + 0.1);
    $('lbZoomOut').onclick = () => setZoom(zoom - 0.1);
    $('lbMetro').classList.add('primary');
  }

  /** list = Land.all() (모든 등급). 이 중 S 만 판에 올립니다.  opts.onPick(랜드마크) = 칸·줄을 눌렀을 때,  opts.info(랜드마크) = Real 요약 */
  async function draw(list, opts) {
    await prepare(); wire(); last = opts || null;
    infos = list.filter(l => l.grade === 'S').map(l => { const rl = Real.get(l.id) || {}; return { l, rl, sale: rl.sale || null, peak: rl.peak || null }; });
    try { window.__lbStatus = await Data.status(); } catch (e) { /* 무시 */ }
    const nm = infos.filter(x => cellOf.metro.get(x.l.code) != null).length, nl = infos.filter(x => cellOf.local.get(x.l.code) != null).length;
    const orphans = infos.filter(x => cellOf.metro.get(x.l.code) == null && cellOf.local.get(x.l.code) == null);
    $('lbMsg').innerHTML = infos.length
      ? `S(대표) ${infos.length}개 → 수도권 판 <b>${nm}</b> · 지방 판 <b>${nl}</b>${orphans.length ? ` · 칸 없음 <b>${orphans.length}</b> (아래 표)` : ''} · 칸을 누르면 자세히 · 빨간 날짜는 ${Math.round(STALE_DAYS / 30.5)}개월보다 오래된 실거래`
      : 'S(대표) 등급으로 등록한 단지가 아직 없습니다. 아래 목록에서 등급을 S로 바꾸면 이 판에 채워집니다.';
    $('lbOrph').hidden = !orphans.length;
    if (orphans.length) $('lbOrph').innerHTML = `<div class="bar"><strong>판에 칸이 없는 S 단지 (${orphans.length}개)</strong></div><div class="tablewrap short"><table><thead><tr><th class="l">지역</th><th class="l">단지</th><th>평형</th><th>최근 실거래</th><th>거래일</th></tr></thead><tbody>${orphans.map(x => `<tr data-id="${esc(x.l.id)}" style="cursor:pointer"><td class="l">${esc(x.l.sido || '')} ${esc(x.l.sgg || '')}</td><td class="l">${esc(x.l.name)}</td><td>${x.l.g}㎡</td><td>${x.sale ? eok(x.sale.price) + '억' : '-'}</td><td>${x.sale ? fmtDate(x.sale.d) : '-'}</td></tr>`).join('')}</tbody></table></div>`;
    $('lbOrph').querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { const x = infos.find(i => i.l.id === tr.dataset.id); if (x && last?.onPick) last.onPick(x.l); });
    drawBoard(); drawCell();
  }

  return { draw };
})();
