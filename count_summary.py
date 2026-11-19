#!/usr/bin/env python3
"""[단지 수] 탭 자료 만들기 — 전국 아파트 단지를 한 파일로 정리합니다.

결과: data/count.json
  { asOf, kaptFile, mvFrom, R: {지역코드: [시도, 시군구]},
    rows: [[지역코드, 동, 단지명, 세대수, 연월, 유형, 표시, [전용면적…]], …] }
  · 연월   : 기존 단지 = 사용승인 연월(YYYYMM), 분양권 = 입주 예정 연월
  · 유형   : A 아파트 · M 주상복합 · E 그 밖 (연립·도시형 등)
  · 표시   : 1 임대 · 2 혼합(분양+임대) · 4 사택·관사 · 8 분양권(입주 전) · 16 정비사업(세대수는 일반분양만) · 32 계단식 · 64 복도식
  · 전용면적: 그 단지에서 2018년 이후 매매·전세로 거래된 전용면적(㎡, 소수점 버림). 분양권은 청약홈 주택형 면적.
              비어 있으면 "평형 정보 없음"

자료
  · 기존 단지  : kapt/ 폴더의 K-apt 단지 기본정보 엑셀 (가장 최근 파일)
  · 평형       : data/sale, data/rent 의 실거래 (단지 짝짓기: 같은 동 + 같은 지번 → 이름이 가장 비슷한 단지)
  · 분양권     : data/supply.json (청약홈) 중 입주 예정 연월이 이번 달 이후인 것. K-apt 에 이미 같은 이름이 있으면 뺌
다른 탭의 자료(data/kapt/*.json 등)는 건드리지 않습니다.

사용법: python scripts/count_summary.py   (자동 수집 때 함께 실행됩니다)
"""
import datetime as dt
import glob
import json
import os
import re
import zlib
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kapt_file as KF  # noqa: E402  (시도·시군구 이름 맞추기, 주소 읽기, 단지 이름 다듬기를 그대로 씀)

ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, 'data')
SRC = os.path.join(ROOT, 'kapt')
OUT = os.path.join(DATA, 'count.json')
FROM_Y = 2018


def num(v):
    try:
        return int(float(str(v).replace(',', '').strip()))
    except Exception:
        return None


def read_kapt(path):
    """K-apt 엑셀 → 단지 목록 (필요한 칸만)"""
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    for ws in wb.worksheets:
        ws.reset_dimensions()
        idx = None
        for r in ws.iter_rows(values_only=True):
            cells = [str(c).strip() if c is not None else '' for c in r]
            if idx is None:
                if '단지명' in cells and '세대수' in cells:
                    def col(*names):
                        for nm in names:
                            if nm in cells:
                                return cells.index(nm)
                        return None
                    idx = {'sido': col('시도'), 'sgg': col('시군구'), 'emd': col('읍면', '읍면동', '법정동'), 'ri': col('동리', '리'),
                           'code': col('단지코드'), 'name': col('단지명'), 'kind': col('단지분류'), 'addr': col('법정동주소'),
                           'sale': col('분양형태'), 'use': col('사용승인일'), 'hh': col('세대수'), 'corr': col('복도유형')}
                continue
            g = lambda k: cells[idx[k]] if idx.get(k) is not None and idx[k] < len(cells) else ''
            if not g('name'):
                continue
            yield {k: g(k) for k in idx}
        if idx:
            return


def sim(a, b):
    """두 이름이 얼마나 비슷한지 (0~1). 가장 긴 공통 부분 / 짧은 쪽 길이"""
    a, b = KF.base(a), KF.base(b)
    if not a or not b:
        return 0
    if a == b:
        return 1
    best = 0
    for i in range(len(a)):
        for j in range(i + best + 1, len(a) + 1):
            if a[i:j] in b:
                best = j - i
            else:
                break
    return best / min(len(a), len(b))


def main():
    files = sorted(glob.glob(os.path.join(SRC, '*.xlsx')), key=os.path.getmtime)
    if not files:
        print('kapt/ 폴더에 K-apt 엑셀이 없습니다.')
        return
    path = files[-1]
    regions = json.load(open(os.path.join(DATA, 'regions.json'), encoding='utf-8'))
    names = json.load(open(os.path.join(DATA, 'names.json'), encoding='utf-8'))['r']
    R = {code: [sido, sgg] for code, sido, sgg, *_ in regions}
    rmap = {}
    for code, sido, sgg, *_ in regions:
        for k in KF.sgg_keys(sgg):
            rmap.setdefault((KF.sido_key(sido), k), code)
    bydong = defaultdict(lambda: defaultdict(list))
    for code, keys in names.items():
        for k in keys:
            bydong[code][k.split('|')[0]].append(k)

    # ── 실거래 전용면적 (단지키별) ──
    areas = defaultdict(lambda: defaultdict(set))       # 지역코드 → 단지키 → {면적}
    for kind in ('sale', 'rent'):
        for d in glob.glob(os.path.join(DATA, kind, '*')):
            code = os.path.basename(d)
            for f in glob.glob(os.path.join(d, '*.json')):
                y = os.path.basename(f)[:4]
                if not y.isdigit() or int(y) < FROM_Y:
                    continue
                try:
                    yd = json.load(open(f, encoding='utf-8'))
                except Exception:
                    continue
                for key, ar in yd.items():
                    for ak in ar:
                        try:
                            areas[code][key].add(int(float(ak.rstrip('d'))))
                        except ValueError:
                            pass

    rows, R_extra = [], {}
    stat = {'kapt': 0, 'noRegion': 0, 'withAreas': 0, 'jibun': 0, 'name': 0, 'p300': 0, 'p300areas': 0}
    seen_names = defaultdict(set)                         # 지역코드 → {이름} (분양권 중복 빼기)
    this_ym = int(dt.date.today().strftime('%Y%m'))

    for r in read_kapt(path):
        stat['kapt'] += 1
        hh = num(r['hh']) or 0
        p = KF.parse_addr(r['addr'].split(',')[0]) if r['addr'] else None
        jibs = KF.jibuns(r['addr'])
        if p and p[3]:
            jibs.add(p[3])
        emd, ri = r['emd'], r['ri']
        if not emd and not ri and p:
            emd = p[2]
        codes = []
        for sk in KF.sido_keys(r['sido']):
            for k in KF.kapt_sgg_keys(r['sgg']) + KF.NEW_GU.get((sk, re.sub(r'\s', '', r['sgg'])), []):
                c = rmap.get((sk, k))
                if c and c not in codes:
                    codes.append(c)
            if codes:
                break
        if codes:
            code = codes[0]
        else:
            stat['noRegion'] += 1
            code = 'x' + str(zlib.crc32((r['sido'] + r['sgg']).encode()) % 100000)
            R_extra[code] = [r['sido'], r['sgg']]
        dong_disp = (ri if (ri and not emd) else (f'{emd} {ri}'.strip() if ri and emd and emd.endswith(('읍', '면')) else (emd or ri)))

        # ── 실거래 단지와 짝짓기 → 전용면적 ──
        got = set()
        cands = []
        for c in codes:
            for d in {emd, ri, f'{emd} {ri}'.strip()}:
                if d:
                    cands += [(c, k) for k in bydong[c].get(d, [])]
        if cands:
            nm = lambda k: k.split('|', 2)[2]
            pj = [(c, k) for c, k in cands if k.split('|')[1] in jibs]
            pick = []
            if pj:
                sc = sorted(((sim(r['name'], nm(k)), c, k) for c, k in pj), reverse=True)
                if len(pj) == 1 or sc[0][0] >= 0.5:
                    top = sc[0][0]
                    pick = [(c, k) for s, c, k in sc if s >= top - 1e-9 or (len(pj) <= 2 and s >= 0.5)]
                    stat['jibun'] += 1
            if not pick:
                sc = sorted(((sim(r['name'], nm(k)), c, k) for c, k in cands), reverse=True)
                if sc and sc[0][0] >= 0.8 and (len(sc) == 1 or sc[1][0] < sc[0][0] or KF.base(nm(sc[0][2])) == KF.base(nm(sc[1][2]))):
                    top = sc[0][0]
                    pick = [(c, k) for s, c, k in sc if s >= top - 1e-9 and KF.base(nm(k)) == KF.base(nm(sc[0][2]))]
                    stat['name'] += 1
            for c, k in pick:
                got |= areas[c].get(k, set())
        if got:
            stat['withAreas'] += 1
        if hh >= 300:
            stat['p300'] += 1
            if got:
                stat['p300areas'] += 1

        kind = r['kind']
        typ = 'M' if '주상복합' in kind else ('A' if kind in ('아파트', '') else 'E')
        flags = 0
        sale = r['sale']
        if sale == '임대':
            flags |= 1
        elif sale == '혼합':
            flags |= 2
        elif '사택' in sale or '관사' in sale:
            flags |= 4
        if '계단' in r['corr']:
            flags |= 32
        elif '복도' in r['corr']:
            flags |= 64
        use = re.sub(r'\D', '', r['use'])[:6]
        rows.append([code, dong_disp, r['name'], hh, int(use) if len(use) == 6 else 0, typ, flags, sorted(got)])
        seen_names[code].add(KF.base(r['name']))

    # ── 분양권 (입주 전) ──
    nsup = 0
    try:
        sup = json.load(open(os.path.join(DATA, 'supply.json'), encoding='utf-8')).get('items', [])
    except Exception:
        sup = []
    done = set()
    fut = [it for it in sup if (it.get('mv') or 0) >= this_ym and it.get('c')]
    def dong_of(it):
        if it.get('dg'):
            return it['dg']
        m = re.search(r'\(([^()]*?(?:동|읍|면|리|가))\)', str(it.get('ad') or ''))
        if m:
            return m.group(1).split(',')[0].strip()
        pa = KF.parse_addr(it.get('ad'))
        return pa[2] if pa else ''
    main_ = [it for it in fut if '사전청약' not in str(it.get('nm') or '')]
    def has_main(it):        # 사전청약 뒤에 본청약 공고가 이미 나온 단지면 사전청약 줄은 뺌 (같은 지역·동, 세대수 비슷)
        h = int(it.get('hh') or 0)
        return any(str(o.get('c')) == str(it.get('c')) and dong_of(o) == dong_of(it) and abs(int(o.get('hh') or 0) - h) <= max(30, h * 0.1) for o in main_)
    for it in fut:
        mv = it.get('mv') or 0
        code = str(it.get('c') or '')
        nmx = str(it.get('nm') or '')
        if '사전청약' in nmx and has_main(it):
            continue
        bkey = KF.base(nmx)
        if (code, bkey) in done or bkey in seen_names.get(code, set()):
            continue
        done.add((code, bkey))
        dong = dong_of(it)
        if code not in R:
            R_extra[code] = [it.get('sd') or '', it.get('sg') or '']
        ar = sorted({int(float(m[1])) for m in (it.get('m') or []) if len(m) > 1 and m[1]})
        flags = 8 | (16 if it.get('reb') else 0) | (1 if '임대' in nmx else 0)
        ty = str(it.get('ty') or '')
        typ = 'A' if ty in ('APT', '') else ('M' if '주상' in ty else 'E')
        rows.append([code, dong, nmx, int(it.get('hh') or 0), int(mv), typ, flags, ar])
        nsup += 1

    R.update(R_extra)
    used = {r[0] for r in rows}
    out = {'asOf': dt.datetime.now().strftime('%Y-%m-%d %H:%M'), 'kaptFile': os.path.basename(path), 'mvFrom': this_ym,
           'R': {c: v for c, v in R.items() if c in used}, 'rows': rows}
    with open(OUT, 'w', encoding='utf-8') as fp:
        json.dump(out, fp, ensure_ascii=False, separators=(',', ':'))
    pct = lambda a, b: f'{a / b * 100:.1f}%' if b else '-'
    print(f"K-apt {stat['kapt']}단지 (지역 못 찾음 {stat['noRegion']}) · 평형 연결 {stat['withAreas']} ({pct(stat['withAreas'], stat['kapt'])}) "
          f"· 300세대 이상 {stat['p300']} 중 평형 연결 {stat['p300areas']} ({pct(stat['p300areas'], stat['p300'])}) "
          f"· 지번 짝 {stat['jibun']} / 이름 짝 {stat['name']} · 분양권 {nsup} → {OUT} ({os.path.getsize(OUT) // 1024}KB)")


if __name__ == '__main__':
    main()
