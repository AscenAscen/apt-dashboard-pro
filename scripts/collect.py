#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
국토교통부 아파트 실거래가(매매·전세) 수집기
=================================================
GitHub Actions 가 하루 2번 이 파일을 실행합니다. (직접 실행할 필요 없음)

하는 일
  1) [갱신]   최근 달(이번 달·지난달)의 실거래를 다시 받아 최신 상태로 유지
  2) [과거수집] 아직 받지 못한 과거 달을 최근 → 과거 순서로 조금씩 채움 (최대 20년)

안정장치 (국토부 API 가 불안정해도 데이터가 망가지지 않도록)
  - 하루 호출 한도를 넘지 않게 "1회 실행당 최대 호출 수" 를 제한
  - 한 번에 1건씩 천천히 호출 (호출 사이 0.3초 쉼)
  - 실패하면 3번까지 간격을 늘려가며 재시도
  - 연속으로 계속 실패하면(=API 장애) 그날은 즉시 중단하고 다음 실행 때 이어서
  - 응답이 비정상적으로 적으면(기존보다 급감) 기존 데이터를 덮어쓰지 않음
  - 어디까지 받았는지 data/state.json 에 기록 → 항상 이어받기

설정은 아래 "설정" 부분의 숫자만 바꾸면 됩니다.
"""
import csv
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

# ───────────────────────────── 설정 ─────────────────────────────
def _env_int(name, default):
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default

MAX_CALLS_PER_API = _env_int("MAX_CALLS_PER_API", 4000)  # 1회 실행당 API별 최대 호출 수 (하루 2회 실행 → 8,000)
MAX_MINUTES = _env_int("MAX_MINUTES", 150)               # 1회 실행 최대 시간(분)
DELAY_SEC = 0.3                                          # 호출 사이 쉬는 시간(초)
RETRY = 3                                                # 실패 시 재시도 횟수
TIMEOUT_SEC = 30
MAX_CONSECUTIVE_FAIL = 8                                 # 연속 실패 시 중단 기준
ROWS_PER_PAGE = 1000
START_YM = {"sale": 200601, "rent": 201101}              # 수집 시작 연월 (매매 2006~, 전월세 2011~ 제공)
PRIORITY_FROM_YM = 202001                                # 이 연월 이후를 먼저 수집 (전고점/전저점 계산용)

API_URL = {
    "sale": "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev",
    "rent": "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
}
# ────────────────────────────────────────────────────────────────

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
KST = dt.timezone(dt.timedelta(hours=9))


class QuotaExceeded(Exception):
    """오늘 호출 한도 초과 → 해당 API 는 오늘 그만"""


class KeyProblem(Exception):
    """인증키 문제 → 전체 중단"""


class TempError(Exception):
    """일시 오류 → 재시도"""


# ───────────────────────── 파일 입출력 ─────────────────────────
def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_text_atomic(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    os.replace(tmp, path)


def write_json(path, obj, by_line=False):
    """by_line=True 이면 최상위 키마다 한 줄 → git 변경분이 작아짐"""
    if by_line and isinstance(obj, dict):
        lines = [
            json.dumps(k, ensure_ascii=False) + ":" + json.dumps(obj[k], ensure_ascii=False, separators=(",", ":"))
            for k in sorted(obj)
        ]
        text = "{\n" + ",\n".join(lines) + "\n}\n"
    else:
        text = json.dumps(obj, ensure_ascii=False, indent=1) + "\n"
    write_text_atomic(path, text)


def year_path(kind, code, year):
    return os.path.join(DATA, kind, code, "%d.json" % year)


def load_regions():
    rows = []
    with open(os.path.join(ROOT, "config", "regions.csv"), encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            code = (r.get("code") or "").strip()
            if len(code) == 5 and code.isdigit():
                rows.append({"code": code, "sido": r["sido"].strip(), "sgg": r["sigungu"].strip(),
                             "tier": int((r.get("tier") or "2").strip() or 2)})
    return rows


# ───────────────────────── API 호출 ─────────────────────────
def _service_key():
    key = (os.environ.get("MOLIT_API_KEY") or "").strip()
    if not key:
        raise KeyProblem("MOLIT_API_KEY 가 설정되지 않았습니다. (GitHub → Settings → Secrets 에 등록)")
    # 공공데이터포털의 Encoding 키(% 포함)는 그대로, Decoding 키는 인코딩해서 사용
    return key if "%" in key else urllib.parse.quote(key, safe="")


def _http_get(url):
    """테스트에서 바꿔 끼울 수 있도록 분리"""
    req = urllib.request.Request(url, headers={"User-Agent": "apt-dashboard-collector/1.0", "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as res:
        return res.read().decode("utf-8", errors="replace")


def _parse(body):
    """→ (items[dict], totalCount). 오류면 예외."""
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        low = body[:300].lower()
        if "limited" in low or "quota" in low or "too many" in low:
            raise QuotaExceeded(body[:100])
        if "unauthorized" in low or "forbidden" in low or "not registered" in low:
            raise KeyProblem(body[:100])
        raise TempError("XML 아님: " + body[:100].replace("\n", " "))

    if root.tag == "OpenAPI_ServiceResponse":  # 포털 게이트웨이 오류
        code = (root.findtext(".//returnReasonCode") or "").strip()
        msg = (root.findtext(".//returnAuthMsg") or root.findtext(".//errMsg") or "").strip()
        if code == "22":
            raise QuotaExceeded(msg)
        if code in ("20", "30", "31", "32"):
            raise KeyProblem("%s (코드 %s)" % (msg, code))
        raise TempError("%s (코드 %s)" % (msg, code))

    rc = (root.findtext("header/resultCode") or "").strip()
    msg = (root.findtext("header/resultMsg") or "").strip()
    if rc in ("03",):  # 데이터 없음
        return [], 0
    if rc == "22":
        raise QuotaExceeded(msg)
    if rc in ("20", "30", "31", "32"):
        raise KeyProblem("%s (코드 %s)" % (msg, rc))
    if rc not in ("00", "000"):
        raise TempError("%s (코드 %s)" % (msg, rc))

    items = [{c.tag: (c.text or "").strip() for c in it} for it in root.iter("item")]
    try:
        total = int((root.findtext("body/totalCount") or "0").strip() or 0)
    except ValueError:
        total = len(items)
    return items, total


class Api:
    def __init__(self):
        self.key = _service_key()
        self.calls = {"sale": 0, "rent": 0}
        self.closed = {}  # kind → 이유 (한도 도달 등)

    def available(self, kind):
        return kind not in self.closed

    def _one(self, kind, code, ym, page):
        if self.calls[kind] >= MAX_CALLS_PER_API:
            self.closed[kind] = "1회 실행 한도(%d) 도달" % MAX_CALLS_PER_API
            raise QuotaExceeded(self.closed[kind])
        url = "%s?serviceKey=%s&LAWD_CD=%s&DEAL_YMD=%d&pageNo=%d&numOfRows=%d" % (
            API_URL[kind], self.key, code, ym, page, ROWS_PER_PAGE)
        last = None
        for attempt in range(RETRY + 1):
            if attempt:
                time.sleep(2 ** attempt * 2)  # 4초, 8초, 16초
            self.calls[kind] += 1
            time.sleep(DELAY_SEC)
            try:
                return _parse(_http_get(url))
            except QuotaExceeded as e:
                self.closed[kind] = "일일 호출 한도 초과: %s" % e
                raise
            except KeyProblem:
                raise
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    self.closed[kind] = "일일 호출 한도 초과(HTTP 429)"
                    raise QuotaExceeded(self.closed[kind])
                if e.code in (401, 403):
                    raise KeyProblem("HTTP %d — 인증키 또는 활용신청 상태를 확인하세요" % e.code)
                last = TempError("HTTP %d" % e.code)
            except TempError as e:
                last = e
            except Exception as e:  # 타임아웃, 연결 끊김 등
                last = TempError("%s: %s" % (type(e).__name__, e))
        raise last

    def month(self, kind, code, ym):
        """한 지역·한 달 전체(페이지 모두) → items"""
        items, page = [], 1
        while True:
            got, total = self._one(kind, code, ym, page)
            items.extend(got)
            if not got or len(items) >= total or page >= 50:
                return items
            page += 1


# ───────────────────────── 변환/저장 ─────────────────────────
def _num(s):
    s = (s or "").replace(",", "").strip()
    try:
        return int(float(s))
    except ValueError:
        return None


def to_records(kind, items):
    """API 항목 → [(단지키, 면적키, 월일, 층, 금액만원)], {단지키: 건축년도}"""
    recs, built = [], {}
    for it in items:
        if kind == "sale":
            if (it.get("cdealType") or "").strip():      # 해제(취소)된 거래 제외
                continue
            price = _num(it.get("dealAmount"))
        else:
            if (_num(it.get("monthlyRent")) or 0) > 0:   # 월세 제외 → 전세만
                continue
            price = _num(it.get("deposit"))
        name = (it.get("aptNm") or "").strip()
        month, day = _num(it.get("dealMonth")), _num(it.get("dealDay"))
        try:
            area = float(it.get("excluUseAr") or 0)
        except ValueError:
            area = 0
        if not name or not price or not month or not day or area <= 0:
            continue
        key = "%s|%s|%s" % ((it.get("umdNm") or "").strip(), (it.get("jibun") or "").strip(), name)
        akey = ("%.2f" % area).rstrip("0").rstrip(".")
        if kind == "sale" and "직" in (it.get("dealingGbn") or ""):
            akey += "d"                                   # 직거래 표시
        recs.append((key, akey, month * 100 + day, _num(it.get("floor")) or 0, price))
        by = _num(it.get("buildYear"))
        if by:
            built[key] = by
    return recs, built


def count_month(ydata, month):
    n = 0
    for areas in ydata.values():
        for flat in areas.values():
            n += sum(1 for i in range(0, len(flat), 3) if flat[i] // 100 == month)
    return n


def merge_month(ydata, month, recs):
    """ydata = {단지키: {면적키: [월일,층,금액, 월일,층,금액, ...]}} 에서 해당 월을 통째로 교체"""
    for key in list(ydata):
        areas = ydata[key]
        for akey in list(areas):
            flat = areas[akey]
            kept = []
            for i in range(0, len(flat), 3):
                if flat[i] // 100 != month:
                    kept.extend(flat[i:i + 3])
            if kept:
                areas[akey] = kept
            else:
                del areas[akey]
        if not areas:
            del ydata[key]
    for key, akey, mmdd, floor, price in recs:
        ydata.setdefault(key, {}).setdefault(akey, []).extend((mmdd, floor, price))
    for areas in ydata.values():
        for akey, flat in areas.items():
            tri = sorted(tuple(flat[i:i + 3]) for i in range(0, len(flat), 3))
            areas[akey] = [v for t in tri for v in t]


def save_month(kind, code, ym, items, warnings, is_update):
    year, month = divmod(ym, 100)
    recs, built = to_records(kind, items)
    path = year_path(kind, code, year)
    ydata = read_json(path, {})
    old_n = count_month(ydata, month)
    # 안전장치: 갱신인데 응답이 비정상적으로 줄었으면 덮어쓰지 않음
    if is_update and ((old_n >= 5 and not recs) or (old_n >= 20 and len(recs) < old_n * 0.5)):
        warnings.append("%s %s %d: 응답 %d건(기존 %d건) → 기존 유지" % (kind, code, ym, len(recs), old_n))
        return False
    before = json.dumps(ydata, sort_keys=True)
    merge_month(ydata, month, recs)
    if ydata and json.dumps(ydata, sort_keys=True) != before:
        write_json(path, ydata, by_line=True)
    # 지역 색인(단지 목록·보유 연도)
    ipath = os.path.join(DATA, "index", code + ".json")
    idx = read_json(ipath, {"c": {}, "y": {"sale": [], "rent": []}})
    changed = False
    for k, by in built.items():
        if idx["c"].get(k) != by:
            idx["c"][k] = by
            changed = True
    if ydata and year not in idx["y"][kind]:
        idx["y"][kind] = sorted(set(idx["y"][kind]) | {year})
        changed = True
    if changed:
        write_json(ipath, idx)
    return True


# ───────────────────────── 작업 계획 ─────────────────────────
def ym_add(ym, delta):
    y, m = divmod(ym, 100)
    n = y * 12 + (m - 1) + delta
    return (n // 12) * 100 + n % 12 + 1


def ym_range_desc(hi, lo):
    ym = hi
    while ym >= lo:
        yield ym
        ym = ym_add(ym, -1)


def months_between(lo, hi):
    return (hi // 100 - lo // 100) * 12 + (hi % 100 - lo % 100) + 1


def update_tasks(regions, state, today, cur):
    """오늘 다시 받을 (최근 달) 목록 — 매일 무조건 전부 받지 않고 주기를 나눔"""
    offsets_by_tier = {1: [0, -1], 2: []}        # 주요지역: 이번 달·지난달 매일
    if today.weekday() == 0:                     # 월요일: 그 외 지역도 이번 달·지난달
        offsets_by_tier[2] = [0, -1]
    if today.day in (1, 15):                     # 1일·15일: 2~3달 전도 (늦은 신고·해제 반영)
        offsets_by_tier[1] = offsets_by_tier[1] + [-2, -3]
        offsets_by_tier[2] = offsets_by_tier[2] + [-2, -3]
    tasks = []
    for r in regions:
        for off in offsets_by_tier.get(r["tier"], []):
            ym = ym_add(cur, off)
            for kind in ("sale", "rent"):
                ptr = state["ptr"][kind].get(r["code"])
                if ptr and ptr <= ym:            # 이미 받은 달만 갱신 (안 받은 달은 과거수집이 처리)
                    tasks.append((kind, r["code"], ym))
    return tasks


def backfill_tasks(regions, state, cur):
    """과거수집 순서: 주요지역 2020~ → 그 외 2020~ → 주요지역 전체 → 그 외 전체 (각각 최근 달부터)"""
    for tier, floor_ym in ((1, PRIORITY_FROM_YM), (2, PRIORITY_FROM_YM), (1, 0), (2, 0)):
        group = [r for r in regions if r["tier"] == tier]
        for ym in ym_range_desc(cur, max(floor_ym, min(START_YM.values()))):
            for r in group:
                for kind in ("sale", "rent"):
                    if ym < START_YM[kind]:
                        continue
                    ptr = state["ptr"][kind].get(r["code"])
                    if ptr is None or ym < ptr:
                        yield (kind, r["code"], ym)


# ───────────────────────── 실행 ─────────────────────────
def run():
    now = dt.datetime.now(KST)
    today = now.date()
    cur = today.year * 100 + today.month
    t0 = time.time()
    regions = load_regions()
    write_json(os.path.join(DATA, "regions.json"), [[r["code"], r["sido"], r["sgg"], r["tier"]] for r in regions])

    spath = os.path.join(DATA, "state.json")
    state = read_json(spath, {})
    state.setdefault("ptr", {})
    state["ptr"].setdefault("sale", {})
    state["ptr"].setdefault("rent", {})

    log = {"saved": 0, "failed": 0, "warnings": [], "stop": ""}
    try:
        api = Api()
    except KeyProblem as e:
        print("[중단]", e)
        return 1

    consecutive = 0
    blocked = set()  # 이번 실행에서 실패한 (종류, 지역) → 순서 유지를 위해 더 과거로 내려가지 않음

    def do(kind, code, ym, is_update):
        """→ True 계속 / False 전체 중단"""
        nonlocal consecutive
        if not api.available(kind) or (kind, code) in blocked:
            return True
        try:
            items = api.month(kind, code, ym)
        except QuotaExceeded:
            return api.available("sale") or api.available("rent")
        except KeyProblem as e:
            log["stop"] = "인증키 문제: %s" % e
            return False
        except TempError as e:
            log["failed"] += 1
            consecutive += 1
            blocked.add((kind, code))
            if len(log["warnings"]) < 50:
                log["warnings"].append("%s %s %d 실패: %s" % (kind, code, ym, e))
            if consecutive >= MAX_CONSECUTIVE_FAIL:
                log["stop"] = "연속 %d회 실패 → API 장애로 판단, 다음 실행 때 이어서 진행" % consecutive
                return False
            return True
        consecutive = 0
        if save_month(kind, code, ym, items, log["warnings"], is_update):
            log["saved"] += 1
        if not is_update:
            state["ptr"][kind][code] = ym
        return True

    def time_left():
        if time.time() - t0 > MAX_MINUTES * 60:
            log["stop"] = log["stop"] or "실행 시간 한도(%d분) 도달" % MAX_MINUTES
            return False
        return True

    ok = True
    # 1) 최근 달 갱신 (하루 1번)
    if state.get("lastUpdate") != today.isoformat():
        done_all = True
        for kind, code, ym in update_tasks(regions, state, today, cur):
            if not time_left() or not (ok := do(kind, code, ym, True)):
                done_all = False
                break
            if not api.available(kind):
                done_all = False
        if done_all:
            state["lastUpdate"] = today.isoformat()

    # 2) 과거수집
    n = 0
    if ok:
        for kind, code, ym in backfill_tasks(regions, state, cur):
            if not (api.available("sale") or api.available("rent")):
                break
            if not time_left() or not do(kind, code, ym, False):
                break
            n += 1
            if n % 200 == 0:
                write_json(spath, state)  # 중간 저장
                print("  … 과거수집 %d건 진행 (호출: 매매 %d, 전세 %d)" % (n, api.calls["sale"], api.calls["rent"]))

    write_json(spath, state)

    # 3) 대시보드용 상태 파일
    progress = {}
    for kind in ("sale", "rent"):
        total = len(regions) * months_between(START_YM[kind], cur)
        done = sum(months_between(max(p, START_YM[kind]), cur) for c, p in state["ptr"][kind].items()
                   if any(r["code"] == c for r in regions))
        prio_total = len([r for r in regions if r["tier"] == 1]) * months_between(PRIORITY_FROM_YM, cur)
        prio_done = sum(months_between(max(state["ptr"][kind].get(r["code"], cur + 1), PRIORITY_FROM_YM), cur)
                        for r in regions if r["tier"] == 1 and state["ptr"][kind].get(r["code"]))
        progress[kind] = {"done": done, "total": total, "priorityDone": min(prio_done, prio_total), "priorityTotal": prio_total}
    empty = []
    for r in regions:
        p = state["ptr"]["sale"].get(r["code"])
        if p and months_between(p, cur) >= 12 and not read_json(os.path.join(DATA, "index", r["code"] + ".json"), {}).get("c"):
            empty.append("%s %s(%s)" % (r["sido"], r["sgg"], r["code"]))
    write_json(os.path.join(DATA, "status.json"), {
        "updatedAt": dt.datetime.now(KST).strftime("%Y-%m-%d %H:%M"),
        "lastUpdate": state.get("lastUpdate", ""),
        "progress": progress,
        "lastRun": {"calls": api.calls, "savedMonths": log["saved"], "failed": log["failed"],
                    "stop": log["stop"], "closed": api.closed, "warnings": log["warnings"][:50]},
        "emptyRegions": empty,  # 1년치 이상 받았는데 단지가 0개 → 지역코드 변경 의심
    })
    print("[완료] 저장 %d달, 실패 %d건, 호출 매매 %d / 전세 %d" % (log["saved"], log["failed"], api.calls["sale"], api.calls["rent"]))
    for k, v in api.closed.items():
        print("  -", k, ":", v)
    if log["stop"]:
        print("  - 중단 사유:", log["stop"])
    for w in log["warnings"][:20]:
        print("  ! " + w)
    # 인증키 문제만 '실패'로 표시 (메일 알림). 그 외에는 다음 실행 때 자동으로 이어서 진행.
    return 1 if log["stop"].startswith("인증키") else 0


def check():
    """인증키 시험: 서울 종로구 지난달 1건 조회"""
    today = dt.datetime.now(KST).date()
    ym = ym_add(today.year * 100 + today.month, -1)
    try:
        api = Api()
        for kind, label in (("sale", "매매"), ("rent", "전월세")):
            items, total = api._one(kind, "11110", ym, 1)
            print("[정상] %s API: 종로구 %d → %d건" % (label, ym, total))
        return 0
    except Exception as e:
        print("[오류] %s: %s" % (type(e).__name__, e))
        return 1


if __name__ == "__main__":
    sys.exit(check() if "--check" in sys.argv else run())
