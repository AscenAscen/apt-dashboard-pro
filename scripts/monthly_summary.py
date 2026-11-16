#!/usr/bin/env python3
"""월간 요약 만들기 — data/sale·rent 의 실거래 자료로 지난달(와 이번 달 현재까지)의 요약을 data/monthly_summary.json 에 적습니다.
  · 지역별: 매매 건수, 전용 84·59㎡ 평균 매매가·전세가, 투자금(매매-전세), 전월 대비 변화
  · 신고가: 그 달 거래 중 같은 단지·평형의 이전 모든 거래(직거래 제외)보다 비싼 것
  · 급락: 그 달 거래가 같은 단지·평형의 직전 거래보다 10% 이상 싼 것
사용법:  python scripts/monthly_summary.py            (지난달 + 이번 달)
         python scripts/monthly_summary.py --month 202610
금액은 만원 단위입니다."""
import argparse, json, os, sys, datetime as dt
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
OUT = os.path.join(DATA, 'monthly_summary.json')
KEEP_MONTHS, TOP = 12, 150
SIZES = {'84': (80, 87), '59': (55, 63)}

def load(kind, code):
    d, res = os.path.join(DATA, kind, code), {}
    if not os.path.isdir(d): return res
    for f in sorted(os.listdir(d)):
        if f.endswith('.json'):
            try: res[int(f[:-5])] = json.load(open(os.path.join(d, f), encoding='utf-8'))
            except Exception: pass
    return res

def trades(ymap):
    """(날짜, 단지키, 면적㎡, 직거래?, 가격) 을 날짜순으로"""
    out = []
    for y, ydata in ymap.items():
        for key, areas in ydata.items():
            for ak, flat in areas.items():
                direct, area = ak.endswith('d'), float(ak.rstrip('d'))
                for i in range(0, len(flat), 3):
                    out.append((y * 10000 + flat[i], key, area, direct, flat[i + 2]))
    out.sort()
    return out

def bucket(area):
    for k, (lo, hi) in SIZES.items():
        if lo <= area < hi: return k
    return None

def avg(v): return round(sum(v) / len(v)) if v else None

def prev_month(m):
    y, mm = divmod(m, 100)
    return (y - 1) * 100 + 12 if mm == 1 else m - 1

def region_stats(sale, rent, month):
    s = {k: [] for k in SIZES}; r = {k: [] for k in SIZES}; n = 0
    for d, key, area, direct, price in sale:
        if d // 100 != month or direct: continue
        n += 1; b = bucket(area)
        if b: s[b].append(price)
    for d, key, area, direct, price in rent:
        if d // 100 != month: continue
        b = bucket(area)
        if b: r[b].append(price)
    o = {'n': n}
    for k in SIZES:
        o['s' + k], o['r' + k] = avg(s[k]), avg(r[k])
        o['inv' + k] = o['s' + k] - o['r' + k] if o['s' + k] and o['r' + k] else None
    return o

def summarize(months, regions):
    res = {m: {'regions': {}, 'highs': [], 'drops': []} for m in months}
    for code, sido, sgg, *_ in regions:
        sale = trades(load('sale', code)); rent = trades(load('rent', code))
        if not sale: continue
        last = {}                      # (단지키, 평형) → [최고가, 직전가]
        by_month = {}
        for d, key, area, direct, price in sale:
            if direct: continue
            m = d // 100; k = (key, int(area)); st = last.get(k)
            if m in res and st:
                dong, jibun, *nm = key.split('|'); name = '|'.join(nm)
                if price > st[0]:
                    res[m]['highs'].append({'code': code, 'sgg': f'{sido} {sgg}', 'dong': dong, 'name': name, 'g': int(area), 'price': price, 'prev': st[0], 'd': d, 'pct': round((price / st[0] - 1) * 100, 1)})
                if price <= st[1] * 0.9:
                    res[m]['drops'].append({'code': code, 'sgg': f'{sido} {sgg}', 'dong': dong, 'name': name, 'g': int(area), 'price': price, 'prev': st[1], 'd': d, 'pct': round((price / st[1] - 1) * 100, 1)})
            if st: st[0] = max(st[0], price); st[1] = price
            else: last[k] = [price, price]
        for m in months:
            res[m]['regions'][code] = {'name': f'{sido} {sgg}', **region_stats(sale, rent, m)}
    for m in months:
        res[m]['highs'] = sorted(res[m]['highs'], key=lambda x: -x['pct'])[:TOP]
        res[m]['drops'] = sorted(res[m]['drops'], key=lambda x: x['pct'])[:TOP]
    return res

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--month', type=int, action='append'); a = ap.parse_args()
    now = dt.date.today(); cur = now.year * 100 + now.month
    targets = a.month or [prev_month(cur), cur]
    regions = json.load(open(os.path.join(DATA, 'regions.json'), encoding='utf-8'))
    need = sorted(set(targets) | {prev_month(m) for m in targets})
    res = summarize(need, regions)
    old = {}
    if os.path.exists(OUT):
        try: old = json.load(open(OUT, encoding='utf-8')).get('months', {})
        except Exception: old = {}
    for m in targets:
        pm = prev_month(m)
        for code, row in res[m]['regions'].items():       # 전월 대비
            p = res[pm]['regions'].get(code) or {}
            for k in ('s84', 's59', 'inv84', 'inv59'):
                row['d' + k] = row[k] - p[k] if row.get(k) is not None and p.get(k) is not None else None
        old[str(m)] = {'regions': res[m]['regions'], 'highs': res[m]['highs'], 'drops': res[m]['drops']}
    keep = sorted(old, reverse=True)[:KEEP_MONTHS]
    out = {'updated': dt.datetime.now().strftime('%Y-%m-%d %H:%M'), 'unit': '만원', 'months': {m: old[m] for m in keep}}
    with open(OUT, 'w', encoding='utf-8') as f: json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print('저장:', OUT, ', '.join(f"{m}: 신고가 {len(old[m]['highs'])} 급락 {len(old[m]['drops'])}" for m in keep[:2]))

if __name__ == '__main__': main()
