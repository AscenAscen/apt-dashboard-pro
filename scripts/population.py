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

보완 (2026-11)
  · 응답이 늦어 끊긴 지역은 기다리는 시간을 늘려 두 번 더 시도합니다.
  · 행정구역 개편으로 코드가 바뀐 지역(인천 제물포·영종·서해·검단구, 광주·전남 통합 등)은
    시도별 시군구 목록을 받아 이름으로 찾아 맞춥니다. 실거래 자료는 아직 예전 구역(예: 인천 서구)을 쓰므로
    새 구 인구를 예전 구역에 더해 넣습니다. 못 맞춘 곳과 받은 이름 목록은 population_status.json 에 남깁니다.
"""
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

# ───────────────────────────── 설정 ─────────────────────────────
# 주소가 바뀌면 여기만 고치면 됩니다. 앞의 것부터 차례로 시도합니다.
BASE = "https://apis.data.go.kr/1741000/stdgPpltnHhStus"
OPS = ["selectStdgPpltnHhStus", "getStdgPpltnHhStus", ""]      # 상세기능 이름 후보 ("" = 주소 그대로)
LVS = ["2", "6", "3"]          # 2: 시군구 목록 · 6: 단일 시군구 · 3: 읍면동(합쳐서 씀)
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
    return k if "%" in k else urllib.parse.quote(k, safe="")      # collect.py 와 같은 방식


def ym_add(ym, d):
    y, m = divmod(int(ym[:4]) * 12 + int(ym[4:]) - 1 + d, 12)
    return f"{y}{m + 1:02d}"


class ApiError(Exception):
    pass


def http(url):
    req = urllib.request.Request(url, headers={"User-Agent": "apt-dashboard", "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as r:
            return r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:   # 400 등: 서버가 보낸 오류 문장을 함께 남김
        body = ""
        try:
            body = e.read().decode("utf-8", "replace")
        except Exception:
            pass
        body = re.sub(r"\s+", " ", body)[:300]
        raise ApiError(f"HTTP {e.code} · {body}")


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


def call(url, k, stdg, ym, lv, page=1, reg=True):
    q = {"stdgCd": stdg, "srchFrYm": ym, "srchToYm": ym, "lv": lv, "type": "JSON", "numOfRows": str(ROWS), "pageNo": str(page)}
    if reg:
        q["regSeCd"] = "1"
    body = http(url + "?serviceKey=" + k + "&" + urllib.parse.urlencode(q))
    low = body[:600]
    m = re.search(r"(SERVICE_KEY_IS_NOT_REGISTERED_ERROR|NO_OPENAPI_SERVICE_ERROR|INVALID_REQUEST_PARAMETER_ERROR|LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR|UNREGISTERED_IP_ERROR|SERVICE ERROR|returnAuthMsg>[^<]+)", low)
    if m:
        raise ApiError(m.group(1) + " · " + re.sub(r"\s+", " ", low)[:250])
    rows, _ = items_of(body)
    return rows, body


def probe(k, ym):
    """강남구 하나로 주소·조회 방식을 차례로 시험 → (url, lv, reg) 또는 None. 시험 기록을 함께 돌려줌"""
    log = []
    for op in OPS:
        url = BASE + ("/" + op if op else "")
        for lv in LVS:
            for reg in (True, False):
                try:
                    rows, body = call(url, k, "1168000000", ym, lv, reg=reg)
                    ok = [r for r in rows if pick(r)[2] is not None]
                    log.append({"url": url, "lv": lv, "regSeCd": reg, "rows": len(rows), "usable": len(ok), "head": re.sub(r"\s+", " ", body)[:160]})
                    if ok:
                        return (url, lv, reg), log
                except Exception as e:  # noqa: BLE001
                    msg = str(e)
                    log.append({"url": url, "lv": lv, "regSeCd": reg, "error": msg[:260]})
                    if "NO_OPENAPI_SERVICE_ERROR" in msg or "HTTP 404" in msg:
                        break                          # 이 주소는 없음 → 다음 주소
                    if "SERVICE_KEY_IS_NOT_REGISTERED" in msg or "HTTP 401" in msg or "HTTP 403" in msg:
                        return None, log               # 키 문제 → 더 해 봐야 소용없음
                time.sleep(DELAY_SEC)
    return None, log


def fetch_sgg(way, k, c5, ym):
    """시군구 하나의 인구·세대수 (lv 3 이면 읍면동을 합침)"""
    url, lv, reg = way
    total_p = total_h = 0
    name = ""
    got = False
    for page in range(1, 30):
        rows, _ = call(url, k, c5 + "00000", ym, lv, page, reg)
        for it in rows:
            code, nm, p, h = pick(it)
            if p is None:
                continue
            if lv in ("2", "6"):
                if code and code[:5] != c5:
                    continue
                return {"n": nm or "", "pop": p, "hh": h}
            total_p += p
            total_h += h or 0
            name = name or nm or ""
            got = True
        if len(rows) < ROWS:
            break
        time.sleep(DELAY_SEC)
    return {"n": name, "pop": total_p, "hh": total_h} if got else None


# 예전 구역 코드 → 개편 뒤 새 구 이름 (실거래 자료가 아직 예전 구역을 쓰므로, 새 구 인구를 합쳐 예전 구역에 넣음)
#  · 인천 동구는 제물포구(옛 중구 내륙 + 동구)에 합쳐져 따로 나눌 수 없어 중구 쪽에 함께 넣고, 동구는 0 으로 둡니다.
RENAMED = {
    "28110": ["영종구", "제물포구"],     # 인천 중구
    "28140": [],                         # 인천 동구 → 제물포구(중구 쪽에 포함)
    "28260": ["서해구", "검단구"],       # 인천 서구
}
SIDO_PREFIXES = ["11", "12", "26", "27", "28", "29", "30", "31", "36", "41", "42", "43", "44", "45", "46", "47", "48", "50", "51", "52", "53", "54", "55"]


def nospace(s):
    return re.sub(r"\s+", "", str(s or ""))


def list_sgg(way, k, ym):
    """시도마다 시군구 목록(lv 2)을 받아 [(10자리 코드, 이름 전체, 인구, 세대)] — 개편으로 코드가 바뀐 곳 찾기용"""
    url, _, reg = way
    out = []
    for p in SIDO_PREFIXES:
        try:
            rows, _ = call(url, k, p + "00000000", ym, "2", 1, reg)
        except Exception:  # noqa: BLE001
            continue
        for it in rows:
            code, name, pop, hh = pick(it)
            if pop is None:
                continue
            full = " ".join(str(v) for kk, v in it.items() if re.search(r"(?i)(nm|명)$", str(kk)) and str(v).strip())
            out.append((code or "", full or (name or ""), pop, hh))
        time.sleep(DELAY_SEC)
    return out


def match_renamed(missing, regions, listing):
    """못 받은 예전 코드 → 목록에서 이름으로 찾아 인구 합치기. {코드: {...}}, [못 맞춘 코드]"""
    reg = {r[0]: r for r in regions}
    got, left = {}, []
    for c5 in missing:
        r = reg.get(c5)
        if not r:
            left.append(c5); continue
        sido2 = nospace(r[1])[:2]                       # 예: 광주, 전라 → 이름 비교는 앞 두 글자로
        if c5 in RENAMED:
            names = RENAMED[c5]
            if not names:
                got[c5] = {"n": r[2], "pop": 0, "hh": 0, "note": "제물포구에 합쳐짐 (중구 쪽에 포함)"}
                continue
            hit = [x for x in listing if any(nospace(x[1]).endswith(n) for n in names) and (sido2 in nospace(x[1]) or x[0][:2] == c5[:2])]
        else:
            last = nospace(r[2]).split("시")[-1] if r[2].count(" ") else nospace(r[2])
            hit = [x for x in listing if nospace(x[1]).endswith(nospace(r[2])) or (last and nospace(x[1]).endswith(last))]
            hit = [x for x in hit if sido2 in nospace(x[1]) or x[0][:2] == c5[:2]] or (hit if len(hit) == 1 else [])
            if len(hit) > 1:                            # 같은 이름이 여러 곳(예: 동구) → 시도 이름이 들어간 것만
                hit = [x for x in hit if sido2 in nospace(x[1])][:1]
        if hit:
            got[c5] = {"n": r[2], "pop": sum(x[2] for x in hit), "hh": sum(x[3] or 0 for x in hit), "from": [x[1] for x in hit][:4]}
        else:
            left.append(c5)
    return got, left


def run(force=False):
    st = read_json(STATUS, {})
    today = now().strftime("%Y-%m-%d")
    cur = read_json(OUT, {})
    target = ym_add(now().strftime("%Y%m"), -1)           # 지난달 (말일 집계라 이번 달은 아직 없음)
    manual = os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch"   # [Run workflow] 로 직접 돌리면 언제든 다시 시도
    if not force and cur.get("ym") == target:
        print(f"인구: {target} 자료가 이미 있음 — 건너뜀"); return 0
    if not force and not manual and st.get("lastTry") == today:
        print("인구: 오늘 이미 시도함 — 내일 다시 시도 (Actions 의 Run workflow 로는 바로 다시 시도됨)"); return 0
    k = key()
    if not k:
        write_json(STATUS, {"lastTry": today, "ok": False, "stop": "인증키(MOLIT_API_KEY 또는 POP_API_KEY)가 없습니다."})
        print("인구: 인증키 없음"); return 0

    regions = read_json(os.path.join(DATA, "regions.json"), [])
    codes = sorted({r[0] for r in regions})
    tries = []
    for ym in (target, ym_add(target, -1)):                # 지난달이 아직 없으면 그 전 달
        way, log = probe(k, ym)
        tries.append({"ym": ym, "tests": log})
        if not way:
            if any("SERVICE_KEY" in (t.get("error") or "") or "HTTP 401" in (t.get("error") or "") or "HTTP 403" in (t.get("error") or "") for t in log):
                break
            continue
        by, fails = {}, []
        for c5 in codes:
            try:
                v = fetch_sgg(way, k, c5, ym)
                if v:
                    by[c5] = v
                else:
                    fails.append(c5)
            except Exception as e:  # noqa: BLE001
                fails.append(f"{c5}: {str(e)[:80]}")
            time.sleep(DELAY_SEC)
        # ① 응답이 늦어 끊긴 곳은 기다리는 시간을 늘려 두 번 더
        global TIMEOUT_SEC
        for attempt in (1, 2):
            again = [f.split(":")[0] for f in fails if ":" in f]
            if not again:
                break
            TIMEOUT_SEC = 45 * attempt
            fails = [f for f in fails if ":" not in f]
            for c5 in again:
                try:
                    v = fetch_sgg(way, k, c5, ym)
                    if v:
                        by[c5] = v
                    else:
                        fails.append(c5)
                except Exception as e:  # noqa: BLE001
                    fails.append(f"{c5}: {str(e)[:80]}")
                time.sleep(DELAY_SEC * 3)
        # ② 답이 없는 곳(개편으로 코드가 바뀐 곳)은 시도별 목록에서 이름으로 찾기
        renamed_note, listing_names = {}, []
        plain = [f for f in fails if ":" not in f]
        if plain:
            listing = list_sgg(way, k, ym)
            listing_names = sorted({x[0][:2] + " " + x[1] for x in listing})
            got, left = match_renamed(plain, regions, listing)
            for c5, v in got.items():
                by[c5] = {kk: v[kk] for kk in ("n", "pop", "hh")}
                renamed_note[c5] = v.get("note") or ("이름으로 맞춤: " + ", ".join(v.get("from", [])))
            fails = [f for f in fails if ":" in f] + left
        if by:
            write_json(OUT, {"ym": ym, "updatedAt": now().strftime("%Y-%m-%d %H:%M"),
                             "source": "행정안전부 법정동별 주민등록 인구 및 세대현황", "byCode": dict(sorted(by.items()))})
            st_out = {"lastTry": today, "ok": True, "ym": ym, "regions": len(by), "missing": fails[:60],
                      "url": way[0], "lv": way[1], "regSeCd": way[2], "renamed": renamed_note}
            if fails and listing_names:                 # 못 맞춘 곳이 있으면, 받은 이름 목록을 남겨 다음에 고칠 수 있게
                st_out["apiNames"] = [n for n in listing_names if n[:2] in {str(f)[:2] for f in fails}][:300]
            write_json(STATUS, st_out)
            print(f"인구: {ym} 시군구 {len(by)}곳 저장 (못 받은 곳 {len(fails)})")
            return 0
    errs = " ".join(t.get("error", "") for x in tries for t in x["tests"])
    if "SERVICE_KEY_IS_NOT_REGISTERED" in errs or "HTTP 401" in errs or "HTTP 403" in errs:
        why = "인증키가 이 API 에 등록되지 않았습니다. 공공데이터포털에서 '행정안전부_법정동별(행정동 통반단위) 주민등록 인구 및 세대현황' 활용신청이 승인됐는지 확인하세요. (승인 직후 1~2시간은 안 될 수 있음)"
    elif "NO_OPENAPI_SERVICE_ERROR" in errs:
        why = "API 주소를 찾지 못했습니다. 포털 활용신청 상세 화면의 '요청주소'와 '상세기능'을 알려 주세요."
    else:
        why = "인구 자료를 받지 못했습니다. 아래 tests 의 오류 문장을 확인하세요."
    write_json(STATUS, {"lastTry": today, "ok": False, "stop": why, "tries": tries})
    print("인구: 실패 —", why)
    return 0


if __name__ == "__main__":
    sys.exit(run(force="--force" in sys.argv))
