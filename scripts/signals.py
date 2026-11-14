#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
시장 신호 만들기 → data/signals.json   (API 호출 없음. 이미 받아 둔 실거래 파일만 읽습니다)

  · 지역별 월별 매매·전세 거래 건수, ㎡당 매매가 중앙값   → 히트맵, 지역 온도 점수
  · 최근 90일 신고가 비율                                  → 지역 온도 점수
  · 최근 30일 신고가 거래 / 급락 거래 목록                 → 알림판

신고가  = 같은 단지·같은 평형의 2020년 이후 최고가를 넘긴 거래 (앞선 거래가 3건 이상 있을 때만, 직거래 제외)
급락    = 같은 단지·같은 평형의 바로 앞 거래(1년 이내)보다 10% 이상 싸게 팔린 거래 (직거래 제외)
숫자를 바꾸려면 아래 "설정"만 고치면 됩니다.
"""
import datetime as dt
import json
import os
import statistics

# ───────────── 설정 ─────────────
MONTHS = 16            # 몇 달치를 담을지 (히트맵 12달 + 온도 계산용 여유)
PEAK_FROM_YEAR = 2020  # 신고가를 따지는 시작 연도
MIN_PRIOR = 3          # 앞선 거래가 이만큼 있어야 신고가로 인정
DROP_RATE = 0.10       # 급락 기준 (10%)
DROP_WITHIN_DAYS = 365 # 바로 앞 거래가 이 기간 안에 있을 때만 급락으로 봄
ALERT_DAYS = 30        # 알림판에 담는 기간
PER_REGION = 5         # 알림판에 지역마다 담는 최대 건수
# ────────────────────────────────

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")


def _read(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _ymd(d):
    return d.year * 10000 + d.month * 100 + d.day


def _to_date(n):
    try:
        return dt.date(n // 10000, n // 100 % 100, n % 100)
    except ValueError:
        return None


def month_list(today, count):
    out, y, m = [], today.year, today.month
    for _ in range(count):
        out.append(y * 100 + m)
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out[::-1]


def build(regions, today, state=None, data_dir=None):
    """regions = [{code, sido, sgg, tier}], state = 수집 상태(어디까지 받았는지). → 저장한 지역 수"""
    global DATA
    if data_dir:
        DATA = data_dir
    months = month_list(today, MONTHS)
    pos = {ym: i for i, ym in enumerate(months)}
    hi = _ymd(today)
    d30, d90 = _ymd(today - dt.timedelta(days=ALERT_DAYS)), _ymd(today - dt.timedelta(days=90))
    ptr = ((state or {}).get("ptr") or {}).get("sale") or {}
    out, highs, drops = {}, [], []

    for r in regions:
        code = r["code"]
        trades = {}                       # (단지키, 평형) → [(날짜, 금액)]  2020년 이후 매매, 직거래 제외
        v, rv = [0] * MONTHS, [0] * MONTHS
        ppm = [[] for _ in range(MONTHS)]  # 달별 ㎡당 가격 목록
        found = False
        for y in range(PEAK_FROM_YEAR, today.year + 1):
            ydata = _read(os.path.join(DATA, "sale", code, "%d.json" % y), None)
            if not ydata:
                continue
            found = True
            for key, areas in ydata.items():
                for akey, flat in areas.items():
                    direct = akey.endswith("d")
                    try:
                        area = float(akey[:-1] if direct else akey)
                    except ValueError:
                        continue
                    g = int(area)
                    for i in range(0, len(flat) - 2, 3):
                        d, price = y * 10000 + flat[i], flat[i + 2]
                        if d > hi or not price:
                            continue
                        k = pos.get(d // 100)
                        if k is not None:
                            v[k] += 1
                            if not direct and area > 0:
                                ppm[k].append(price / area)
                        if not direct:
                            trades.setdefault((key, g), []).append((d, price))
        for y in sorted({months[0] // 100, today.year, today.year - 1}):
            ydata = _read(os.path.join(DATA, "rent", code, "%d.json" % y), None)
            if not ydata:
                continue
            for areas in ydata.values():
                for flat in areas.values():
                    for i in range(0, len(flat) - 2, 3):
                        k = pos.get((y * 10000 + flat[i]) // 100)
                        if k is not None and y * 10000 + flat[i] <= hi:
                            rv[k] += 1
        if not found:
            continue

        n90 = nh90 = 0
        rh, rd = [], []
        for (key, g), arr in trades.items():
            arr.sort()
            peak, count, prev = 0, 0, None
            for d, price in arr:
                is_high = count >= MIN_PRIOR and price > peak
                if d > d90:
                    n90 += 1
                    if is_high:
                        nh90 += 1
                if d > d30:
                    parts = key.split("|")
                    name = "|".join(parts[2:])
                    if is_high:
                        rh.append([code, parts[0], name, g, price, d, peak])
                    elif prev and price <= prev[1] * (1 - DROP_RATE):
                        a, b = _to_date(prev[0]), _to_date(d)
                        if a and b and (b - a).days <= DROP_WITHIN_DAYS:
                            rd.append([code, parts[0], name, g, price, d, prev[1], prev[0]])
                if price > peak:
                    peak = price
                count += 1
                prev = (d, price)
        rh.sort(key=lambda x: -x[4])
        rd.sort(key=lambda x: x[4] / x[6])
        highs += rh[:PER_REGION]
        drops += rd[:PER_REGION]

        p = ptr.get(code)
        out[code] = {
            "v": v, "rv": rv,
            "p": [round(statistics.median(x)) if len(x) >= 5 else None for x in ppm],   # 거래 5건 미만인 달은 비움
            "n90": n90, "nh90": nh90,
            "full": bool(p and p <= PEAK_FROM_YEAR * 100 + 1),     # 2020년부터 다 받았는지
        }

    body = {"asOf": today.isoformat(), "months": months, "regions": out, "highs": highs, "drops": drops,
            "rule": {"minPrior": MIN_PRIOR, "dropRate": DROP_RATE, "alertDays": ALERT_DAYS}}
    path = os.path.join(DATA, "signals.json")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(body, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)
    return len(out)
