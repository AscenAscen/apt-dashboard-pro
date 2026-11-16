#!/usr/bin/env python3
"""단지 요약 파일 만들기 — '비슷한 단지 찾기'가 빠르게 돌도록 단지·평형마다 한 줄씩 정리합니다.
결과: data/cx/{시도코드 2자리}.json  { updated, cols, rows: [[지역코드, 단지키, 평형㎡, 연식, 세대수, 최근매매, 최근매매일, 최근전세, 전고점, 1년매매건수], …] }
  · 최근 매매·전고점은 직거래를 뺀 값, 전고점은 2020년 이후 최고가
  · 최근 전세는 1년 안의 가장 최근 전세 거래 (없으면 null)
  · 1년 동안 매매가 한 건도 없고 2년 안에도 없는 평형은 뺌 (거래가 끊긴 평형)
  · 세대수는 data/kapt/{지역}.json (K-apt 엑셀·API) 에서
사용법: python scripts/cx_summary.py   (자동 수집 때 함께 실행됩니다)"""
import json, os, datetime as dt
from collections import defaultdict
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data'); OUT = os.path.join(DATA, 'cx')
FROM_Y = 2020
COLS = ['code', 'key', 'g', 'year', 'hh', 'sale', 'saleD', 'rent', 'peak', 'n12']

def load(kind, code):
    d, res = os.path.join(DATA, kind, code), {}
    if not os.path.isdir(d): return res
    for f in os.listdir(d):
        if f.endswith('.json') and f[:4].isdigit() and int(f[:4]) >= FROM_Y:
            try: res[int(f[:4])] = json.load(open(os.path.join(d, f), encoding='utf-8'))
            except Exception: pass
    return res

def each(ymap):
    for y, yd in ymap.items():
        for key, areas in yd.items():
            for ak, flat in areas.items():
                direct, g = ak.endswith('d'), int(float(ak.rstrip('d')))
                for i in range(0, len(flat), 3):
                    yield key, g, direct, y * 10000 + flat[i], flat[i + 2]

def main():
    regions = json.load(open(os.path.join(DATA, 'regions.json'), encoding='utf-8'))
    today = dt.date.today(); d12 = int((today - dt.timedelta(days=365)).strftime('%Y%m%d')); d24 = int((today - dt.timedelta(days=730)).strftime('%Y%m%d'))
    by_sido = defaultdict(list)
    for code, *_ in regions:
        sale = load('sale', code)
        if not sale: continue
        rent = load('rent', code)
        try: years = json.load(open(os.path.join(DATA, 'index', code + '.json'), encoding='utf-8')).get('c', {})
        except Exception: years = {}
        try: hh = json.load(open(os.path.join(DATA, 'kapt', code + '.json'), encoding='utf-8')).get('m', {})
        except Exception: hh = {}
        s = {}                                               # (키, 평형) → [최근일, 최근가, 전고점, 1년건수]
        for key, g, direct, d, p in each(sale):
            if direct: continue
            x = s.setdefault((key, g), [0, None, 0, 0])
            if d > x[0]: x[0], x[1] = d, p
            if p > x[2]: x[2] = p
            if d >= d12: x[3] += 1
        r = {}
        for key, g, direct, d, p in each(rent):
            if d < d12: continue
            x = r.get((key, g))
            if not x or d > x[0]: r[(key, g)] = (d, p)
        for (key, g), (d, p, peak, n12) in s.items():
            if d < d24: continue
            h = hh.get(key)
            by_sido[code[:2]].append([code, key, g, years.get(key) or None, (h[0] if h else None), p, d, (r.get((key, g)) or (0, None))[1], peak, n12])
    os.makedirs(OUT, exist_ok=True)
    up = dt.datetime.now().strftime('%Y-%m-%d %H:%M'); n = 0
    for sd, rows in by_sido.items():
        with open(os.path.join(OUT, sd + '.json'), 'w', encoding='utf-8') as f:
            json.dump({'updated': up, 'cols': COLS, 'rows': rows}, f, ensure_ascii=False, separators=(',', ':'))
        n += len(rows)
    print(f'단지 요약 저장: {len(by_sido)}개 시도 · {n}개 단지·평형')

if __name__ == '__main__': main()
