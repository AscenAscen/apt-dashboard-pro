#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
시군구 인구 수집기 — [공급] 탭의 "적정 수요선"(인구 × 0.5%)에 씁니다.
GitHub Actions 가 실거래 수집 때 함께 실행합니다. (직접 실행할 필요 없음)

  · 자료: 행정안전부 "법정동별(행정동 통반단위) 주민등록 인구 및 세대현황" (공공데이터포털, 무료)
  · 인증키: 실거래와 같은 MOLIT_API_KEY 를 그대로 씁니다. (포털 키는 계정당 하나라 같은 키입니다)
           다른 키를 쓰고 싶으면 GitHub Secrets 에 POP_API_KEY 를 넣으면 그 키를 먼저 씁니다.
  · 한 달에 한 번만 받습니다. 이미 지난달 자료가 있으면 아무것도 하지 않고 끝납니다.
  · 실패해도 실거래 수집에는 영향이 없습니다. (다음 실행 때 다시 시도, 하루 한 번까지만)

결과
  data/population.json         { ym, updatedAt, byCode: { 지역코드: { n: 이름, pop: 인구, hh: 세대수 } } }
  data/population_status.json  마지막 시도 결과 (오류가 나면 이유와 응답 일부가 적힘)

혼자 시험해 보기:  MOLIT_API_KEY=... python scripts/population.py --force
"""
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

# ───────────────────────────── 설정 ─────────────────────────────
# 주소가 바뀌면 여기만 고치면 됩니다. 앞의 것부터 차례로 시도합니다.
POP_URLS = [
    "https://apis.data.go.kr/1741000/stdgPpltnHhStus/selectStdgPpltnHhStus",
    "https://apis.data.go.kr/1741000/stdgPpltnHhStus",
]
TIMEOUT_SEC = 25
DELAY_SEC = 0.2
ROWS = 100
# ────────────────────────────────────────────────────────────────

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(DATA, "population.json")
STATUS = os.path.join(DATA, "population_status.json")
KST = dt.timezone(dt.timedelta(hours=9))


def now():
    return dt.datetime.now(KST)


def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def key():
    k = (os.environ.get("POP_API_KEY") or os.environ.get("MOLIT_API_KEY") or "").strip()
    return urllib.parse.unquote(k) if "%" in k else k


def ym_add(ym, d):
    y, m = divmod(int(ym[:4]) * 12 + int(ym[4:]) - 1 + d, 12)
    return f"{y}{m + 1:02d}"


def http(url):
    req = urllib.request.Request(url, headers={"User-Agent": "apt-dashboard"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as r:
        return r.read().decode("utf-8", "replace")


# ── 응답 읽기 (JSON 이든 XML 이든, 칸 이름이 무엇이든 최대한 알아서 찾음) ──
def items_of(body):
    body = body.strip()
    if body.startswith("{") or body.startswith("["):
        obj = json.loads(body)
        found = []

        def walk(o):
            if isinstance(o, list) and o and all(isinstance(x, dict) for x in o):
                found.append(o)
            if isinstance(o, dict):
                for v in o.values():
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)
        walk(obj)
        # 가장 긴 목록 = 자료 목록. 한 건이면 dict 로 오는 경우도 있음
        if found:
            return max(found, key=len), obj
        single = []

        def walk2(o):
            if isinstance(o, dict):
                if any(re.search(r"(?i)nmpr|ppltn|인구", str(k)) for k in o):
                    single.append(o)
                for v in o.values():
                    walk2(v)
        walk2(obj)
        return single, obj
    root = ET.fromstring(body)
    rows = []
    for it in root.iter("item"):
        rows.append({c.tag: (c.text or "").strip() for c in it})
    return rows, {"xml_root": root.tag, "resultMsg": (root.findtext(".//resultMsg") or root.findtext(".//returnAuthMsg") or "")}


def num(v):
    try:
        return int(float(str(v).replace(",", "").strip()))
    except Exception:
        return None


def pick(item):
    """한 줄에서 지역코드(10자리), 이름, 총인구, 세대수 찾기"""
    code = name = pop = hh = None
    for k, v in item.items():
        s = str(v).strip()
        lk = str(k).lower()
        if code is None and re.fullmatch(r"\d{10}", s) and ("cd" in lk or "code" in lk or "코드" in lk):
            code = s
        if pop is None and (re.search(r"tot.*(nmpr|ppltn|pop)", lk) or lk in ("totnmprcnt", "총인구수")):
            pop = num(v)
        if hh is None and (re.search(r"(hh|hshld|세대)(cnt|수)?$", lk) or lk in ("hhcnt", "세대수")) and "nmpr" not in lk:
            hh = num(v)
        if name is None and re.search(r"(sgg|signgu|시군구).*(nm|명)", lk):
            name = s
    if code is None:
        for v in item.values():
            s = str(v).strip()
            if re.fullmatch(r"\d{10}", s):
                code = s
                break
    return code, name, pop, hh


def fetch_sido(url, k, sd, ym):
    """시도 하나의 시군구 목록"""
    out, page = [], 1
    while True:
        q = {"serviceKey": k, "stdgCd": f"{sd}00000000", "srchFrYm": ym, "srchToYm": ym,
             "lv": "2", "regSeCd": "1", "type": "JSON", "numOfRows": str(ROWS), "pageNo": str(page)}
        body = http(url + "?" + urllib.parse.urlencode(q, safe=""))
        rows, meta = items_of(body)
        if page == 1 and not rows:
            return None, body[:400]
        out.extend(rows)
        if len(rows) < ROWS or page >= 20:
            return out, body[:400]
        page += 1
        time.sleep(DELAY_SEC)


def run(force=False):
    st = read_json(STATUS, {})
    today = now().strftime("%Y-%m-%d")
    cur = read_json(OUT, {})
    target = ym_add(now().strftime("%Y%m"), -1)           # 지난달 (말일 집계라 이번 달은 아직 없음)
    if not force and cur.get("ym") == target:
        print(f"인구: {target} 자료가 이미 있음 — 건너뜀"); return 0
    if not force and st.get("lastTry") == today:
        print("인구: 오늘 이미 시도함 — 내일 다시 시도"); return 0
    k = key()
    if not k:
        write_json(STATUS, {"lastTry": today, "ok": False, "stop": "인증키(MOLIT_API_KEY 또는 POP_API_KEY)가 없습니다."})
        print("인구: 인증키 없음"); return 0

    regions = read_json(os.path.join(DATA, "regions.json"), [])
    codes = {r[0] for r in regions}
    sidos = sorted({c[:2] for c in codes})
    tried, last_err = [], ""
    for ym in (target, ym_add(target, -1)):                # 지난달이 아직 없으면 그 전 달
        for url in POP_URLS:
            by, samples, fail = {}, [], 0
            for sd in sidos:
                try:
                    rows, head = fetch_sido(url, k, sd, ym)
                except Exception as e:  # noqa: BLE001
                    rows, head = None, f"{type(e).__name__}: {e}"
                if rows is None:
                    fail += 1
                    last_err = head
                    if fail >= 3 and not by:
                        break
                    continue
                for it in rows:
                    code, name, pop, hh = pick(it)
                    if not samples:
                        samples.append(it)
                    if not code or pop is None:
                        continue
                    c5 = code[:5]
                    if c5.endswith("000"):                 # 시도 합계 줄은 건너뜀
                        continue
                    by[c5] = {"n": name or "", "pop": pop, "hh": hh}
                time.sleep(DELAY_SEC)
            tried.append({"url": url, "ym": ym, "regions": len(by), "fail": fail})
            if by:
                matched = sum(1 for c in by if c in codes)
                # 일반구가 있는 시(수원시 등)는 시 전체 합계도 만들어 둠 (예: 41110 = 41111+41113+…)
                sums = {}
                for c, v in by.items():
                    parent = c[:4] + "0"
                    if parent != c and parent not in by:
                        s = sums.setdefault(parent, {"n": "", "pop": 0, "hh": 0})
                        s["pop"] += v["pop"] or 0
                        s["hh"] += v["hh"] or 0
                for c, v in sums.items():
                    by.setdefault(c, v)
                write_json(OUT, {"ym": ym, "updatedAt": now().strftime("%Y-%m-%d %H:%M"),
                                 "source": "행정안전부 주민등록 인구 및 세대현황", "byCode": dict(sorted(by.items()))})
                write_json(STATUS, {"lastTry": today, "ok": True, "ym": ym, "regions": len(by), "matched": matched,
                                    "url": url, "sample": samples[:1]})
                print(f"인구: {ym} 시군구 {len(by)}곳 저장 (지역 목록과 맞은 곳 {matched})")
                return 0
    write_json(STATUS, {"lastTry": today, "ok": False, "stop": "인구 자료를 받지 못했습니다. 활용신청이 승인됐는지, 주소가 바뀌지 않았는지 확인하세요.",
                        "tried": tried, "response": last_err[:400]})
    print("인구: 실패 —", last_err[:200])
    return 0


if __name__ == "__main__":
    sys.exit(run(force="--force" in sys.argv))
