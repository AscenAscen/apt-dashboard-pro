#!/usr/bin/env python3
"""K-apt 전국 단지 엑셀 → 단지별 세대수 (data/kapt/{지역코드}.json)

kapt/ 폴더에 공공데이터포털의 "국토교통부_공동주택 단지 면적 정보"(K-apt) 엑셀을 올리면
GitHub 이 자동으로 이 스크립트를 돌려, 실거래 단지(data/names.json)와 짝지어 세대수를 적습니다.
사이트는 이 파일로 시세트래킹·전수조사의 비어 있는 세대수를 자동으로 채웁니다. (직접 적은 값이 우선)

짝짓는 방법: 같은 시·구·동 안에서 단지 이름(띄어쓰기·'아파트'·괄호 무시)이 같거나 한쪽이 다른 쪽을 포함하면 같은 단지.
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
                           'addr': col('법정동주소', '지번주소', '주소')}
                continue
            g = lambda k: cells[idx[k]] if idx.get(k) is not None and idx[k] < len(cells) else ''
            if not g('name') or num(g('hh')) is None: continue
            yield {'sido': g('sido'), 'sgg': g('sgg'), 'emd': g('emd'), 'ri': g('ri'), 'name': g('name'), 'hh': num(g('hh')),
                   'dongs': num(g('dongs')), 'code': g('code'), 'addr': g('addr')}
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
        n1, b1 = norm(r['name']), base(r['name'])
        pick = []
        nm = lambda k: k.split('|', 2)[2]
        pj = [k for k in cands if k.split('|')[1] in jibs]                 # 같은 지번(필지)
        if len(pj) == 1: pick = pj
        elif pj:
            close = [k for k in pj if min(len(b1), len(base(nm(k)))) >= 2 and (b1 in base(nm(k)) or base(nm(k)) in b1 or b1[:3] == base(nm(k))[:3])]
            pick = close or (pj if len(pj) <= 2 else [])
        if not pick:
            ex = [k for k in cands if n1 and n1 in (norm(k.split('|', 2)[2]), base(k.split('|', 2)[2])) or (b1 and b1 == base(k.split('|', 2)[2]))]
            if ex: pick = ex
            else:
                pick = [k for k in cands if min(len(b1), len(base(k.split('|', 2)[2]))) >= 3 and (b1 in base(k.split('|', 2)[2]) or base(k.split('|', 2)[2]) in b1)]
        if not pick or len({base(k.split('|', 2)[2]) for k in pick}) > 1: nomatch.append(f"{r['sgg']} {r['emd']} {r['name']}"); continue
        for k in pick:
            code = kc[k]
            seen[code][k].add(r['hh'])
            hits[code][k] = [r['hh'], r['dongs'] or 0, r['code'] or '']
    matched = 0
    os.makedirs(OUTDIR, exist_ok=True)
    for code, m in hits.items():
        m = {k: v for k, v in m.items() if len(seen[code][k]) == 1}          # 서로 다른 세대수로 겹치면 버림
        if not m: continue
        f = os.path.join(OUTDIR, f'{code}.json'); old = {}
        if os.path.exists(f):
            try: old = json.load(open(f, encoding='utf-8'))
            except Exception: old = {}
        om = old.get('m', {}); om.update(m); old['m'] = om; old['file'] = os.path.basename(path)
        with open(f, 'w', encoding='utf-8') as fp: json.dump(old, fp, ensure_ascii=False, separators=(',', ':'))
        matched += len(m)
    st = {'updated': dt.datetime.now().strftime('%Y-%m-%d %H:%M'), 'file': os.path.basename(path), 'rows': rows, 'matched': matched,
          'regions': len(hits), 'noRegion': nocode, 'unmatched': len(nomatch), 'sample': nomatch[:30]}
    json.dump(st, open(os.path.join(DATA, 'kapt_file_status.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f"엑셀 {rows}행 → 세대수 연결 {matched}개 단지 ({len(hits)}개 지역) · 지역 못 찾음 {nocode} · 짝 못 지음 {len(nomatch)}")
    if '--keep-latest' in sys.argv:
        for f in files[:-1]:
            try: os.remove(f)
            except Exception: pass

if __name__ == '__main__': main()
