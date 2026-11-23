#!/usr/bin/env python3
"""K-apt 전국 단지 엑셀 → 단지별 세대수 (data/kapt/{지역코드}.json)

kapt/ 폴더에 공공데이터포털의 "국토교통부_공동주택 단지 면적 정보"(K-apt) 엑셀을 올리면
GitHub 이 자동으로 이 스크립트를 돌려, 실거래 단지(data/names.json)와 짝지어 세대수를 적습니다.
사이트는 이 파일로 시세트래킹·전수조사의 비어 있는 세대수를 자동으로 채웁니다. (직접 적은 값이 우선)

짝짓는 방법 (2026.11 보강 — 확실한 단계부터 차례로, 함수 choose 참고):
  1. 같은 지번 + 이름이 같거나 포함            2. 같은 동에서 이름이 똑같음
  3. 같은 지번에 단지가 하나뿐(이름이 바뀐 단지)  4. 같은 동에서 이름 포함 + 연식이 맞음
  5. 한 단지가 실거래에서 여러 이름으로 나뉜 경우(1·2·3단지, 미륭·미성·삼호 등) → 모두에 단지 전체 세대수 (끝에 'g' 표시)
  6. 동 이름이 다르게 적힌 경우: 같은 시군구에서 이름이 똑같은 단지 하나
  · 이름 비교 전에: 표기 통일(e편한·IPARK·SK뷰·LG 등), 앞에 붙은 동네 이름 떼기, '제2·2차·2단지' → 2
  · 번호가 어긋나면 다른 단지('원마을10단지' ≠ '원마을1단지'), 임대는 임대끼리
  확실하지 않으면(후보가 여럿) 채우지 않습니다.
사용법:  python scripts/kapt_file.py [엑셀파일] [--keep-latest]
"""
import glob, json, os, re, sys, datetime as dt
from collections import defaultdict
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data'); OUTDIR = os.path.join(DATA, 'kapt'); SRC = os.path.join(ROOT, 'kapt')
SIDO_ALIAS = {'전남광주통합특별시': ['전남', '광주']}      # 행정구역 통합으로 바뀐 이름 → 예전 시도 (둘 다 시도)
# 2026년에 새로 생긴 구 → 실거래 자료가 아직 쓰는 예전 구 (같은 동 이름으로 찾으므로 여러 개여도 됨)
NEW_GU = {('인천', '검단구'): ['서구'], ('인천', '서해구'): ['서구'], ('인천', '영종구'): ['중구'], ('인천', '제물포구'): ['중구', '동구']}
SIDO = {'전라북도': '전북', '전북특별자치도': '전북', '전라남도': '전남', '경상북도': '경북', '경상남도': '경남', '충청북도': '충북', '충청남도': '충남'}

def sido_key(s):
    s = re.sub(r'\s', '', str(s or ''))
    return SIDO.get(s, s[:2])

def sido_keys(s):
    s2 = re.sub(r'\s', '', str(s or ''))
    return SIDO_ALIAS.get(s2) or [sido_key(s2)]

def sgg_keys(sgg):
    """'수원시 장안구' → {'수원시장안구', '수원장안구', '장안구'} / '강남구' → {'강남구'}"""
    s = str(sgg or '').strip(); flat = s.replace(' ', ''); ks = {flat}
    parts = s.split()
    if len(parts) == 2:
        ks.add(parts[0].rstrip('시') + parts[1]); ks.add(parts[1])
    elif flat.endswith('시'):
        ks.add(flat[:-1])                       # '화성시' → '화성' (K-apt 는 '화성만세구' 처럼 새 구 이름을 씀)
    return ks

def kapt_sgg_keys(sgg):
    """K-apt 시군구 → 찾아볼 이름들. '화성만세구' → ['화성만세구', '화성'] (새로 생긴 구는 시로 찾기)"""
    s = re.sub(r'\s', '', str(sgg or '')); out = [s]
    m = re.match(r'^(.{2,}?)(..구)$', s)
    if m: out.append(m.group(1))
    if ' ' in str(sgg or ''): out.append(str(sgg).split()[-1])
    return out

def norm(n):
    n = str(n or '').lower()
    n = re.sub(r'e-?편한세상', '이편한세상', n); n = re.sub(r'i-?park', '아이파크', n); n = n.replace('맨숀', '맨션')
    n = n.replace('에스케이', 'sk').replace('엘지', 'lg').replace('지에스', 'gs').replace('엘에이치', 'lh')   # 영문 회사 이름 한글 표기 통일
    n = re.sub(r'sk-?view', 'sk뷰', n); n = re.sub(r'the-?sharp', '더샵', n)
    n = re.sub(r'\s|아파트|apt|[·\-_.,]', '', n)
    return n

def base(n):
    return norm(re.sub(r'\(.*?\)', '', str(n or '')))

def num(v):
    try: return int(float(str(v).replace(',', '')))
    except Exception: return None

def read_rows(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    for ws in wb.worksheets:
        ws.reset_dimensions()                    # K-apt 엑셀은 크기 정보가 잘못 적혀 있어 그대로 읽으면 1줄만 읽힘
        head, idx = None, {}
        for r in ws.iter_rows(values_only=True):
            cells = [str(c).strip() if c is not None else '' for c in r]
            if head is None:
                j = ' '.join(cells)
                if '단지명' in j and '세대수' in j:
                    head = cells
                    def col(*names, exact=False):
                        for nm in names:
                            for i, c in enumerate(cells):
                                if (c == nm) if exact else (nm in c): return i
                        return None
                    idx = {'sido': col('시도', exact=True), 'sgg': col('시군구', exact=True), 'emd': col('읍면동', '법정동', '읍면', exact=True),
                           'ri': col('동리', '리', exact=True), 'name': col('단지명'), 'hh': col('세대수'), 'dongs': col('동수'), 'code': col('단지코드'),
                           'addr': col('법정동주소', '지번주소', '주소'), 'corr': col('복도유형', exact=True),
                           'use': col('사용승인일', exact=True)}
                continue
            g = lambda k: cells[idx[k]] if idx.get(k) is not None and idx[k] < len(cells) else ''
            if not g('name') or num(g('hh')) is None: continue
            yield {'sido': g('sido'), 'sgg': g('sgg'), 'emd': g('emd'), 'ri': g('ri'), 'name': g('name'), 'hh': num(g('hh')),
                   'dongs': num(g('dongs')), 'code': g('code'), 'addr': g('addr'), 'corr': g('corr'),
                   'year': (int(g('use')[:4]) if g('use')[:4].isdigit() else None)}
        if head: return

def jibuns(a):
    """'…이촌동 300-62,…이촌동 300-23 …' → {'300-62', '300-23'} (여러 필지가 쉼표로 이어진 경우 모두)"""
    return {j.rstrip('-') for j in re.findall(r'(?:동|가|리|로)\s+(산?\d+(?:-\d*)?)', str(a or ''))}

def parse_addr(a):
    """'서울특별시 강남구 역삼동 123-4' → (시도, 시군구, 동, 지번)"""
    t = str(a or '').split()
    if len(t) < 3: return None
    sido = t[0]; rest = t[1:]
    sgg = [x for x in rest if re.search(r'(시|군|구)$', x)][:2]
    after = rest[len(sgg):]
    dong = next((x for x in after if re.search(r'(동|가|리|읍|면|로)$', x) and not re.match(r'^\d', x)), '')
    jib = next((x for x in after if re.match(r'^(산)?\d+(-\d*)?$', x)), '').rstrip('-')
    return sido, ' '.join(sgg), dong, jib.replace('산', '')

# ───────── 짝짓기 도구 (2026.11 보강) ─────────
def stems(*places):
    """동·시군구 이름에서 단지 이름 앞에 자주 붙는 말 뽑기: '이촌동' → '이촌', '금호동1가' → '금호', '수원시 장안구' → '수원','장안'"""
    out = set()
    for p in places:
        for w in str(p or '').split():
            w = re.sub(r'\d+가$', '', w)
            if len(w) >= 3: out.add(w.lower())                     # '송천동' 통째로도 (송천동현대 → 현대)
            w = re.sub(r'(동|가|리|읍|면|구|시|군)$', '', w)
            w = re.sub(r'\d+$', '', w)
            if len(w) >= 2: out.add(w.lower())
    return out

def key_name(n, st=()):
    """비교용 이름: 표기 통일 + 앞에 붙은 동네 이름 떼기 + 차수 숫자만 남기기 ('제2'·'2차'·'2단지' → '2')"""
    n = norm(n)
    n = re.sub(r'제(\d)', r'\1', n)
    n = re.sub(r'(\d+)(차|단지)', r'\1', n)
    for t in sorted(st, key=len, reverse=True):
        if n.startswith(t) and len(n) - len(t) >= 2: n = n[len(t):]; break
    return n

def rel(a, b):
    """두 비교용 이름의 관계: 3=같음, 2=한쪽이 다른 쪽을 포함(3글자 이상), 0=다름
       번호는 빼고 비교합니다 (번호가 맞는지는 num_ok 가 따로 봄: '두산2.3차' ↔ '두산3')"""
    a, b = re.sub(r'\d+', '', a or ''), re.sub(r'\d+', '', b or '')
    if len(a) < 2 or len(b) < 2: return 0
    if a == b: return 3 if len(a) >= 3 else 2                    # '한신'·'현대'처럼 짧은 이름은 같아도 '같은 단지'로 확신하지 않음
    if min(len(a), len(b)) >= 3 and (a in b or b in a): return 2
    return 0

def digits(a):
    return set(re.findall(r'\d+', str(a or '')))

def tdigits(b):
    """실거래 이름의 번호: 괄호 밖 숫자 + 괄호 속 'n단지·n차' (괄호 속 동 번호·블록 번호는 무시)"""
    b = str(b or '')
    out = digits(re.sub(r'\(.*?\)', '', b))
    for p in re.findall(r'\((.*?)\)', b): out |= set(re.findall(r'(\d+)\s*(?:단지|차)', p))
    return out

def num_ok(a, b):
    """번호가 서로 어긋나지 않는지: '원마을10단지' ↔ '원마을1단지' 는 X, '스타힐스1단지2단지' ↔ '스타힐스2단지' 는 O"""
    da, db = digits(a), tdigits(b)
    return not da or not db or da <= db or db <= da

is_rent = lambda n: '임대' in str(n or '')
nm_of = lambda k: k.split('|', 2)[2]
jb_of = lambda k: k.split('|')[1]

def choose(r, cands, years, jibs, st):
    """K-apt 한 줄 → 실거래 단지키 고르기. (단계, [키]) — 단계 숫자가 작을수록 확실. 못 고르면 (None, [])"""
    kr = is_rent(r['name'])
    same = [k for k in cands if is_rent(nm_of(k)) == kr]          # 임대는 임대끼리, 분양은 분양끼리
    if same: cands = same
    kn = key_name(base(r['name']), st); kf = key_name(r['name'], st)
    def R(k):
        t = nm_of(k)
        if not num_ok(r['name'], t): return 0
        v = max(rel(kn, key_name(base(t), st)), rel(kf, key_name(t, st)),
                rel(key_name(base(r['name'])), key_name(base(t))), rel(key_name(r['name']), key_name(t)))   # 동네 이름을 뗀 것·안 뗀 것 중 나은 쪽
        return min(v, 2) if bool(kd) != bool(tdigits(t)) else v     # 한쪽에만 번호가 있으면 '같음'이 아니라 '포함'으로
    yr = r.get('year')
    yok = lambda k, d=1: (not yr or not years.get(k) or abs(years[k] - yr) <= d)   # 연식이 맞는지 (d년 차이까지)
    kd = digits(r['name'])
    bn = lambda k: key_name(base(nm_of(k)), st)                    # 괄호 뺀 이름
    fn = lambda k: key_name(nm_of(k), st)                          # 괄호까지 넣은 이름
    def paren_hit(k):                                              # 괄호 속 이름이 K-apt 이름에 들어 있음: '은행마을(태평)' ↔ '계산은행마을태평'
        return any(len(norm(p)) >= 2 and norm(p) in kf for p in re.findall(r'\((.*?)\)', nm_of(k)))
    def one(ks):
        """후보들이 한 단지로 볼 수 있으면 그 키들, 아니면 None"""
        if len({fn(k) for k in ks}) == 1: return ks
        if kd:                                                     # 번호가 똑같은 단지 하나 ('래미안삼성1차103단지' 등)
            m = [k for k in ks if tdigits(nm_of(k)) == kd]
            if m and len({fn(k) for k in m}) == 1: return m
        p = [k for k in ks if paren_hit(k)]
        if p and len({fn(k) for k in p}) == 1: return p
        b = {bn(k) for k in ks}                                    # 괄호만 다른 같은 단지(동 번호 표시 등) — K-apt 이름이 더 자세하면 다른 단지일 수 있어 제외
        if len(b) == 1:
            h = b.pop()
            if kn == h or kn in h: return ks
        return None
    pj = [k for k in cands if jb_of(k) in jibs]                    # 같은 지번(필지)
    if len(pj) > 1:                                                # 한 필지에 여러 단지면 번호가 어긋나는 단지는 뺌 ('용암2' ≠ '용암주공1단지')
        pj = [k for k in pj if num_ok(r['name'], nm_of(k))] or pj
    # 0단계: K-apt 이름에 번호가 여럿('두산2.3차', '한양2,3,4차') → 그 번호들의 단지를 함께
    if len(kd) >= 2:
        g = [k for k in cands if R(k) >= 2 and tdigits(nm_of(k)) and tdigits(nm_of(k)) <= kd and yok(k, 2)]
        if len(g) >= 2 and len({re.sub(r'\d+', '', bn(k)) for k in g}) == 1: return 5, g
    # 1단계: 같은 지번 + 이름이 같거나 포함
    a = [k for k in pj if R(k) >= 2]
    if a:
        best = max(R(k) for k in a); a = one([k for k in a if R(k) == best])
        # K-apt 이름에만 번호가 있으면('DMC SK VIEW 2단지' ↔ 실거래 'DMCSKVIEW') 단지 일부일 수 있음 → 이름이 똑같은 K-apt 줄이 있으면 그쪽이 이기도록 낮은 단계로
        if a: return (3 if best < 3 and kd and not any(tdigits(nm_of(k)) for k in a) else 1), a
    # 2단계: 같은 동에서 이름이 똑같음
    b = [k for k in cands if R(k) == 3 and yok(k, 3)]              # 이름이 똑같으면 연식은 3년 차이까지 (신축은 실거래 연식과 K-apt 사용승인일이 2~3년 다를 때가 많음)
    b = one(b) if b else None
    if b: return 2, b
    # 3단계: 같은 지번에 단지가 하나뿐 (이름이 달라도 — 예: 이름이 바뀐 단지)
    if len(pj) == 1 and yok(pj[0], 3): return 3, pj
    # 4단계: 같은 동에서 이름이 포함 관계 + 연식이 맞음
    c = [k for k in cands if R(k) == 2 and yok(k)]
    c1 = one(c) if c else None
    if c1: return 4, c1
    # 5단계: 한 단지가 실거래에서 여러 이름으로 나뉜 경우 (예: e편한세상신촌 → 1·2·3·4단지, 월계시영 → 미륭·미성·삼호3)
    #        같은 지번 묶음 전체가 연식이 맞으면 단지 전체 세대수를 함께 적음
    if 2 <= len(pj) <= 10 and yr and all(years.get(k) and abs(years[k] - yr) <= 1 for k in pj):
        return 5, pj
    #        이름 묶음: 'DMC파크뷰자이' ↔ 'DMC파크뷰자이1단지'~'5단지' 처럼 뒤의 번호만 다른 단지들 (지번이 달라도)
    c = [k for k in cands if R(k) >= 2 and yok(k)]
    if 2 <= len(c) <= 10:
        heads = {re.sub(r'\d+', '', key_name(base(nm_of(k)), st)) for k in c}
        h = heads.pop() if len(heads) == 1 else ''
        kn0 = re.sub(r'\d+', '', kn)
        if h and len(h) >= 3 and (kn0 == h or kn0 in h): return 5, c           # K-apt 이름이 묶음 이름과 같거나 더 짧을 때만
    if 2 <= len(pj) <= 10 and all(R(k) >= 2 for k in pj): return 5, pj
    return None, []

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    files = args or sorted(glob.glob(os.path.join(SRC, '*.xlsx')), key=os.path.getmtime)
    if not files: print('kapt/ 폴더에 엑셀이 없습니다.'); return
    path = files[-1]
    regions = json.load(open(os.path.join(DATA, 'regions.json'), encoding='utf-8'))
    names = json.load(open(os.path.join(DATA, 'names.json'), encoding='utf-8'))['r']
    rmap = {}
    for code, sido, sgg, *_ in regions:
        for k in sgg_keys(sgg): rmap.setdefault((sido_key(sido), k), code)
    bydong = defaultdict(lambda: defaultdict(list))   # code → 동 → [키]
    for code, keys in names.items():
        for k in keys: bydong[code][k.split('|')[0]].append(k)
    hits = defaultdict(dict); seen = defaultdict(lambda: defaultdict(set)); rows = 0; nocode = 0; nomatch = []
    lv = defaultdict(dict); stat = defaultdict(int); ycache = {}
    def yearsOf(kc):
        """단지키 → 건축년도 (data/index/{지역}.json)"""
        out = {}
        for k, c in kc.items():
            if c not in ycache:
                try: ycache[c] = json.load(open(os.path.join(DATA, 'index', c + '.json'), encoding='utf-8')).get('c', {})
                except Exception: ycache[c] = {}
            y = ycache[c].get(k)
            if y: out[k] = int(y)
        return out
    for r in read_rows(path):
        rows += 1
        jib = ''; jibs = jibuns(r['addr'])
        if r['addr']:
            p = parse_addr(r['addr'].split(',')[0])
            if p:
                jib = p[3]
                if not r['sgg']: r['sgg'] = p[1]
                if not r['emd'] and not r['ri']: r['emd'] = p[2]
        codes = []
        for sk in sido_keys(r['sido']):
            names_ = kapt_sgg_keys(r['sgg']) + NEW_GU.get((sk, re.sub(r'\s', '', str(r['sgg'] or ''))), [])
            for k in names_:
                c = rmap.get((sk, k))
                if c and c not in codes: codes.append(c)
            if codes: break
        if not codes: nocode += 1; continue
        cands = []
        for code in codes:
            for d in {r['emd'] or '', r['ri'] or '', f"{r['emd'] or ''} {r['ri'] or ''}".strip()}:
                if d: cands += [(code, k) for k in bydong[code].get(d, [])]
        kc = dict((k, c) for c, k in cands); cands = [k for c, k in cands]
        if not cands: nomatch.append(f"{r['sgg']} {r['emd']} {r['name']}"); continue
        st = stems(r['emd'], r['ri'], r['sgg'])
        lvl, pick = choose(r, cands, yearsOf(kc), jibs, st)
        if not pick:                                                # 동 이름이 서로 다르게 적힌 경우: 같은 시군구 전체에서 이름이 똑같은 단지 하나
            allc = [(c, k) for c in codes for ks in bydong[c].values() for k in ks]
            kc2 = dict((k, c) for c, k in allc); yrs2 = yearsOf(kc2); kn = key_name(base(r['name']))     # 동네 이름은 떼지 않음 (양촌휴먼시아 ≠ 양곡휴먼시아)
            ex = [k for c, k in allc if key_name(base(nm_of(k))) == kn and len(kn) >= 5 and num_ok(r['name'], nm_of(k))
                  and is_rent(nm_of(k)) == is_rent(r['name']) and (not r.get('year') or not yrs2.get(k) or abs(yrs2[k] - r['year']) <= 1)]
            if len(ex) == 1: lvl, pick, kc = 6, ex, kc2
        if not pick: nomatch.append(f"{r['sgg']} {r['emd']} {r['name']}"); continue
        stat[lvl] += 1
        for k in pick:
            code = kc[k]
            cur = lv[code].get(k)
            if cur is not None and cur < lvl: continue                 # 더 확실한 짝이 이미 있음
            if cur is None or lvl < cur: seen[code][k] = set(); lv[code][k] = lvl
            seen[code][k].add(r['hh'])
            hits[code][k] = [r['hh'], r['dongs'] or 0, r['code'] or '', r['corr'] or ''] + (['g'] if lvl == 5 else [])
    matched = 0
    os.makedirs(OUTDIR, exist_ok=True)
    # 예전 엑셀로 만든 짝은 버리고 새로 만듦 (짝짓기 규칙이 바뀌면 틀린 짝이 남지 않도록). K-apt API 로 받은 자료(raw 가 있는 파일)는 그대로 합침
    for f in glob.glob(os.path.join(OUTDIR, '*.json')):
        code = os.path.basename(f)[:-5]
        if code in hits: continue
        try: old = json.load(open(f, encoding='utf-8'))
        except Exception: continue
        if 'file' in old and 'raw' not in old:
            old['m'] = {}; json.dump(old, open(f, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    for code, m in hits.items():
        m = {k: v for k, v in m.items() if len(seen[code][k]) == 1}          # 서로 다른 세대수로 겹치면 버림
        f = os.path.join(OUTDIR, f'{code}.json'); old = {}
        if os.path.exists(f):
            try: old = json.load(open(f, encoding='utf-8'))
            except Exception: old = {}
        if not m and not old: continue
        om = old.get('m', {}) if 'raw' in old else {}
        om.update(m); old['m'] = om; old['file'] = os.path.basename(path)
        with open(f, 'w', encoding='utf-8') as fp: json.dump(old, fp, ensure_ascii=False, separators=(',', ':'))
        matched += len(m)
    st = {'updated': dt.datetime.now().strftime('%Y-%m-%d %H:%M'), 'file': os.path.basename(path), 'rows': rows, 'matched': matched,
          'regions': len(hits), 'noRegion': nocode, 'unmatched': len(nomatch), 'sample': nomatch[:30],
          'byStep': {str(k): v for k, v in sorted(stat.items())}}
    json.dump(st, open(os.path.join(DATA, 'kapt_file_status.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f"엑셀 {rows}행 → 세대수 연결 {matched}개 단지 ({len(hits)}개 지역) · 지역 못 찾음 {nocode} · 짝 못 지음 {len(nomatch)}")
    if '--keep-latest' in sys.argv:
        for f in files[:-1]:
            try: os.remove(f)
            except Exception: pass

if __name__ == '__main__': main()
