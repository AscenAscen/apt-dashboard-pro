"""
kb_weekly.py — KB 주간 시계열 엑셀(kb/*.xlsx)을 대시보드용 data/kb_weekly.json 으로 바꿉니다.

  · 읽는 시트: 이름에 "매매"+"지수" / "전세"+"지수" 가 들어간 시트 (예: 3.매매지수, 4.전세지수). 증감 시트는 건너뜀
  · 표 모양: 2번째 줄 = 지역 이름, A열 = 날짜(주 단위), 나머지 칸 = 지수
  · 지역 이름은 "시도 [시] 구" 로 만들어 중구·동구·서구처럼 겹치는 이름을 구분합니다
  · 저장: 최근 156주(3년) 주간 값 + 최근 150개월 월 평균 값
  · --keep-latest : kb/ 폴더에서 가장 최근 파일만 남기고 나머지 엑셀은 지웁니다 (저장소 용량 관리)

실행: python scripts/kb_weekly.py [--keep-latest]
"""
import datetime as dt
import glob
import json
import os
import re
import sys

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'kb')
OUT = os.path.join(ROOT, 'data', 'kb_weekly.json')
WEEKS, MONTHS = 156, 150

KB_SIDO = {'서울특별시': '서울특별시', '부산광역시': '부산광역시', '대구광역시': '대구광역시', '인천광역시': '인천광역시',
           '(구)광주광역시': '광주광역시', '광주광역시': '광주광역시', '대전광역시': '대전광역시', '울산광역시': '울산광역시',
           '세종특별자치시': '세종특별자치시', '경기도': '경기도', '강원특별자치도': '강원특별자치도', '강원도': '강원특별자치도',
           '충청북도': '충청북도', '충청남도': '충청남도', '전북특별자치도': '전북특별자치도', '전라북도': '전북특별자치도',
           '(구)전라남도': '전라남도', '전라남도': '전라남도', '경상북도': '경상북도', '경상남도': '경상남도', '제주특별자치도': '제주특별자치도'}
SKIP = re.compile(r'^(전국|강북14개구|강남11개구|\d개광역시|수도권|기타지방|제주도|전남광주통합특별시)$')
GU_TAIL = re.compile(r'(남구|북구|동구|서구|중구)$')


def keys_of(head):
    """헤더 한 줄 → 열마다 "시도 [시] 구" 이름 (묶음 열은 None). 대시보드 js/market.js 의 kbwKeys 와 같은 규칙"""
    names = [re.sub(r'\s+', ' ', str(h)).strip() if h is not None else '' for h in head]
    out, sido, city = [], '', ''
    for c, n in enumerate(names):
        key = None
        if c == 0 or not n:
            out.append(None); continue
        if n in KB_SIDO:
            sido, city = KB_SIDO[n], ''; key = sido
        elif SKIP.match(n) or not sido:
            key = None
        elif n.endswith('시') and (names[c + 1] if c + 1 < len(names) else '').endswith('구') and not GU_TAIL.search(n):
            city = n; key = f'{sido} {n}'
        elif n.endswith('시') or n.endswith('군'):
            city = ''; key = f'{sido} {n}'
        else:
            key = f"{sido} {city + ' ' if city else ''}{n}"
        out.append(key)
    return out


def to_ymd(v):
    if isinstance(v, (dt.datetime, dt.date)):
        return v.year * 10000 + v.month * 100 + v.day
    m = re.search(r'((?:19|20)\d{2})\D+(\d{1,2})\D+(\d{1,2})', str(v or ''))
    return int(m[1]) * 10000 + int(m[2]) * 100 + int(m[3]) if m else 0


def read_sheet(wb, pat):
    name = next((n for n in wb.sheetnames if re.search(pat, n) and '증감' not in n), None)
    if not name:
        return None
    rows = list(wb[name].iter_rows(values_only=True))
    r0 = next((i for i, r in enumerate(rows) if i > 0 and r and to_ymd(r[0]) > 19000000), -1)
    if r0 < 2:
        return None
    keys = keys_of(rows[1])
    weekly = {}                                   # 날짜 → {열: 값}
    for r in rows[r0:]:
        d = to_ymd(r[0]) if r else 0
        if not d:
            continue
        weekly[d] = {c: float(r[c]) for c in range(1, min(len(keys), len(r))) if keys[c] and isinstance(r[c], (int, float))}
    return keys, weekly


def build(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    S, R = read_sheet(wb, r'매매.*지수'), read_sheet(wb, r'전세.*지수')
    if not S and not R:
        raise SystemExit(f'{os.path.basename(path)}: "매매지수" / "전세지수" 시트를 찾지 못했습니다.')
    all_days = sorted({d for X in (S, R) if X for d in X[1]})
    weeks = all_days[-WEEKS:]
    months = sorted({d // 100 for d in all_days})[-MONTHS:]
    out = {'file': os.path.basename(path), 'updated': dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).strftime('%Y-%m-%d %H:%M'),
           'base': '2026.1.12=100', 'last': all_days[-1], 'weeks': weeks, 'months': months,
           'keys': [], 'sale': {}, 'rent': {}, 'wsale': {}, 'wrent': {}}
    for kind, X in (('sale', S), ('rent', R)):
        if not X:
            continue
        keys, weekly = X
        by_m = {}
        for d in weekly:
            by_m.setdefault(d // 100, []).append(weekly[d])
        for c, key in enumerate(keys):
            if not key or key in out[kind]:
                continue                          # 같은 이름이 또 나오면 처음 것 유지
            w = [round(weekly.get(d, {}).get(c), 2) if c in weekly.get(d, {}) else None for d in weeks]
            mon = []
            for m in months:
                vals = [v[c] for v in by_m.get(m, []) if c in v]
                mon.append(round(sum(vals) / len(vals), 2) if vals else None)
            if sum(v is not None for v in mon) < 3:
                continue
            out[kind][key], out['w' + kind][key] = mon, w
            if key not in out['keys']:
                out['keys'].append(key)
    return out


def main():
    files = sorted(glob.glob(os.path.join(SRC, '*.xls*')), key=lambda p: (re.search(r'(20\d{6})', os.path.basename(p)) or [None, ''])[1] + str(os.path.getmtime(p)))
    if not files:
        print('kb/ 폴더에 엑셀이 없습니다. 건너뜀'); return
    latest = files[-1]
    data = build(latest)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{os.path.basename(latest)} → data/kb_weekly.json · 지역 {len(data["keys"])}개 · 주간 {len(data["weeks"])}주 · 월 {len(data["months"])}개월 · 기준 {data["last"]} · {os.path.getsize(OUT) // 1024}KB')
    if '--keep-latest' in sys.argv:
        for p in files[:-1]:
            os.remove(p); print('지움:', os.path.basename(p))


if __name__ == '__main__':
    main()
