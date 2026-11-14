#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
추가 자료 수집기 — 실거래 수집(collect.py)이 끝난 뒤 자동으로 이어서 실행됩니다.
여기서 오류가 나도 실거래 수집에는 영향을 주지 않습니다.

  1) 단지 정보 (세대수·동수·단지코드)  — 공공데이터포털 "공동주택 단지 목록 / 기본 정보" API
       · 인증키: 실거래와 같은 MOLIT_API_KEY 를 그대로 씁니다 (포털에서 활용신청만 되어 있으면 됨)
       · 결과: data/kapt/{지역코드}.json   { m: {단지키: [세대수, 동수, 단지코드]}, raw: {...} }
  2) R-ONE 통계 (한국부동산원 아파트 매매·전세 가격지수, 월간)
       · 인증키: RONE_API_KEY (GitHub Secrets). 없으면 이 부분만 건너뜁니다.
       · 결과: data/rone.json          { sale: {지역이름: [[연월, 지수], …]}, rent: {…} }

진행 상황과 오류는 data/extra_status.json 에 적히고, 사이트의 [가이드·설정 → 점검] 에서 볼 수 있습니다.
혼자 시험해 보기:  python scripts/extra.py --check
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
MAX_MINUTES = 20                 # 한 번 실행에 쓰는 최대 시간(분)
KAPT_DAILY_MAX = 8000            # 하루 단지 정보 호출 수 (포털 일일 트래픽 10,000 보다 적게)
KAPT_REFRESH_DAYS = 180          # 이 기간이 지나면 그 지역 단지 정보를 다시 받음
DELAY_SEC = 0.15
TIMEOUT_SEC = 20
RONE_FROM_YM = 202001            # 가격지수를 받는 시작 연월
RONE_PAGE = 1000

# 주소가 바뀌면 여기만 고치면 됩니다. 앞의 것부터 차례로 시도하고, 되는 주소를 기억해 둡니다.
KAPT_LIST_URLS = [
    "https://apis.data.go.kr/1613000/AptListService3/getSigunguAptList3",
    "https://apis.data.go.kr/1613000/AptListService2/getSigunguAptList",
]
KAPT_INFO_URLS = [
    "https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4",
    "https://apis.data.go.kr/1613000/AptBasisInfoServiceV3/getAphusBassInfoV3",
    "https://apis.data.go.kr/1613000/AptBasisInfoService1/getAphusBassInfo",
]
RONE_URL = "https://www.reb.or.kr/r-one/openapi/"
# 가격지수 통계표 번호. 비워 두면 통계표 목록에서 이름으로 찾아 씁니다. (찾은 번호는 로그와 extra_status.json 에 남음)
RONE_TABLES = {"sale": os.environ.get("RONE_SALE_TBL", ""), "rent": os.environ.get("RONE_RENT_TBL", "")}
RONE_NAMES = {"sale": "매매가격지수", "rent": "전세가격지수"}
RONE_SKIP_WORDS = ("규모", "연령", "실거래", "수급", "중위", "평균", "단위", "㎡", "계절", "전망", "변동", "증감", "분위", "소득", "비율")
# ────────────────────────────────────────────────────────────────

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
KST = dt.timezone(dt.timedelta(hours=9))


class Stop(Exception):
    """오늘은 그만 (한도 초과·키 문제 등)"""


def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def http_get(url):
    """테스트에서 바꿔 끼울 수 있도록 분리"""
    req = urllib.request.Request(url, headers={"User-Agent": "apt-dashboard-collector/1.0", "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as res:
        return res.read().decode("utf-8", errors="replace")


def _get(url, tries=2):
    last = None
    for i in range(tries + 1):
        try:
            return http_get(url)
        except Exception as e:                     # 타임아웃·일시 오류 → 잠깐 쉬고 다시
            code = getattr(e, "code", None)
            if code == 429:
                raise Stop("오늘 호출 한도 초과(HTTP 429)")
            if code in (401, 403):
                raise Stop("인증키가 이 API 에 승인되지 않았습니다(HTTP %s). 포털에서 활용신청 상태를 확인하세요." % code)
            last = e
            time.sleep(1 + i * 2)
    raise RuntimeError("%s: %s" % (type(last).__name__, last))


# ═════════════════════════ 1) 단지 정보 ═════════════════════════
def _portal_key():
    key = (os.environ.get("MOLIT_API_KEY") or "").strip()
    return key if "%" in key else urllib.parse.quote(key, safe="")


def parse_portal(body):
    """공공데이터포털 응답(JSON 또는 XML) → (items[dict], totalCount)"""
    text = body.lstrip()
    if text.startswith("{"):
        obj = json.loads(text)
        res = obj.get("response", obj)
        head = res.get("header") or {}
        code = str(head.get("resultCode", "00"))
        if code == "22":
            raise Stop("오늘 호출 한도 초과")
        if code in ("20", "30", "31", "32"):
            raise Stop("인증키 문제: %s (코드 %s)" % (head.get("resultMsg", ""), code))
        if code not in ("00", "000", "0", "03"):
            raise RuntimeError("%s (코드 %s)" % (head.get("resultMsg", ""), code))
        b = res.get("body") or {}
        items = b.get("items", b.get("item"))
        if isinstance(items, dict):
            items = items.get("item", items)
        if isinstance(items, dict):
            items = [items]
        items = [x for x in (items or []) if isinstance(x, dict)]
        try:
            total = int(b.get("totalCount") or len(items))
        except (TypeError, ValueError):
            total = len(items)
        return items, total
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        low = text[:300].lower()
        if "limited" in low or "quota" in low or "too many" in low:
            raise Stop("오늘 호출 한도 초과")
        if "unauthorized" in low or "forbidden" in low or "not registered" in low:
            raise Stop("인증키가 이 API 에 승인되지 않았습니다: " + text[:80])
        raise RuntimeError("알 수 없는 응답: " + text[:100].replace("\n", " "))
    code = (root.findtext(".//returnReasonCode") or root.findtext(".//resultCode") or "").strip()
    msg = (root.findtext(".//returnAuthMsg") or root.findtext(".//resultMsg") or "").strip()
    if code == "22":
        raise Stop("오늘 호출 한도 초과")
    if code in ("20", "30", "31", "32"):
        raise Stop("인증키 문제: %s (코드 %s)" % (msg, code))
    if code not in ("", "00", "000", "0", "03"):
        raise RuntimeError("%s (코드 %s)" % (msg, code))
    items = [{c.tag: (c.text or "").strip() for c in it} for it in root.iter("item")]
    try:
        total = int((root.findtext(".//totalCount") or "").strip() or len(items))
    except ValueError:
        total = len(items)
    return items, total


class Kapt:
    def __init__(self, state):
        self.state = state
        self.calls = 0
        self.key = _portal_key()

    def _call(self, kind, urls, params):
        """되는 주소를 찾아 기억해 두고 호출"""
        saved = self.state.get(kind + "Url")
        order = ([saved] if saved in urls else []) + [u for u in urls if u != saved]
        last = None
        for url in order:
            q = "&".join("%s=%s" % (k, urllib.parse.quote(str(v), safe="")) for k, v in params.items())
            self.calls += 1
            try:
                out = parse_portal(_get("%s?serviceKey=%s&%s" % (url, self.key, q)))
            except Stop:
                raise
            except Exception as e:
                last = e
                if saved == url:
                    raise                           # 원래 되던 주소면 일시 오류로 보고 다른 주소는 찾지 않음
                continue
            if self.state.get(kind + "Url") != url:
                self.state[kind + "Url"] = url
                print("[단지정보] %s 주소 확인: %s" % ("목록" if kind == "list" else "기본정보", url))
            time.sleep(DELAY_SEC)
            return out
        raise RuntimeError("쓸 수 있는 주소를 찾지 못했습니다 (%s)" % last)

    def list(self, code):
        out, page = [], 1
        while True:
            items, total = self._call("list", KAPT_LIST_URLS, {"sigunguCode": code, "pageNo": page, "numOfRows": 1000})
            out += items
            if not items or len(out) >= total or page >= 20:
                return out
            page += 1

    def info(self, kapt_code):
        items, _ = self._call("info", KAPT_INFO_URLS, {"kaptCode": kapt_code})
        return items[0] if items else {}


_JIBUN = re.compile(r"^(산)?\d+(-\d+)?$")


def split_addr(addr, name):
    """'부산광역시 사하구 괴정동 258 괴정 경성스마트W아파트' → ('괴정동', '258')"""
    tokens = (addr or "").split()
    for i, t in enumerate(tokens):
        if _JIBUN.match(t) and i > 0:
            return tokens[i - 1], t.replace("산", "")
        if t == "산" and i + 1 < len(tokens) and _JIBUN.match(tokens[i + 1]) and i > 0:
            return tokens[i - 1], tokens[i + 1]
    return "", ""


def norm_name(s):
    s = re.sub(r"\(.*?\)", "", s or "")
    s = re.sub(r"[\s\-·,.]", "", s)
    return re.sub(r"아파트$", "", s).lower()


def _int(v):
    try:
        return int(float(str(v).replace(",", "")))
    except (TypeError, ValueError):
        return 0


def match(raw, keys):
    """raw = {단지코드: [이름, 동, 지번, 세대수, 동수]}, keys = 실거래 단지키("동|지번|단지명") 목록
       → {단지키: [세대수, 동수, 단지코드]}.  ① 동+지번 ② 같은 동 안에서 이름 ③ 지역 전체에서 하나뿐인 이름"""
    by_jibun, by_name, by_name_dong = {}, {}, {}
    for kc, (name, dong, jibun, hh, dc) in raw.items():
        if not hh:
            continue
        val = [hh, dc, kc]
        if dong and jibun:
            by_jibun.setdefault((dong, jibun), []).append(val)
        n = norm_name(name)
        if n:
            by_name.setdefault(n, []).append(val)
            by_name_dong.setdefault((dong, n), []).append(val)
    out = {}
    for key in keys:
        p = key.split("|")
        if len(p) < 3:
            continue
        dong, jibun, n = p[0].split()[-1], p[1], norm_name("|".join(p[2:]))
        hit = by_jibun.get((dong, jibun)) or by_name_dong.get((dong, n))
        if not hit:
            cand = by_name.get(n) or []
            hit = cand if len(cand) == 1 else None
        if hit and len(hit) == 1:
            out[key] = hit[0]
        elif hit:                                    # 같은 지번에 여러 단지 → 이름이 같은 것
            same = [v for v in hit if norm_name(raw[v[2]][0]) == n]
            if len(same) == 1:
                out[key] = same[0]
    return out


def run_kapt(regions, state, deadline, today, status):
    if not (os.environ.get("MOLIT_API_KEY") or "").strip():
        status["kapt"]["error"] = "MOLIT_API_KEY 없음"
        return
    daily = state.get("kaptDaily") or {}
    if daily.get("date") != today.isoformat():
        daily = {"date": today.isoformat(), "n": 0}
    api = Kapt(state)
    done = state.setdefault("kaptDone", {})          # 지역코드 → 다 받은 날짜
    order = sorted(regions, key=lambda r: (r["tier"], r["code"]))
    stop = ""
    try:
        for r in order:
            code = r["code"]
            idx = read_json(os.path.join(DATA, "index", code + ".json"), {}).get("c") or {}
            if not idx:
                continue                              # 실거래가 아직 없는 지역은 나중에
            path = os.path.join(DATA, "kapt", code + ".json")
            cur = read_json(path, {"raw": {}, "m": {}})
            raw = cur.get("raw") or {}
            fresh = done.get(code) and (today - dt.date.fromisoformat(done[code])).days < KAPT_REFRESH_DAYS
            if not fresh:
                if time.time() > deadline or daily["n"] + api.calls >= KAPT_DAILY_MAX:
                    stop = "시간·호출 한도까지 진행 (다음 실행에 이어서)"
                    break
                todo = [x for x in api.list(code) if (x.get("kaptCode") or "").strip() and x["kaptCode"].strip() not in raw]
                complete = True
                for x in todo:
                    if time.time() > deadline or daily["n"] + api.calls >= KAPT_DAILY_MAX:
                        complete, stop = False, "시간·호출 한도까지 진행 (다음 실행에 이어서)"
                        break
                    kc = x["kaptCode"].strip()
                    try:
                        info = api.info(kc)
                    except Stop:
                        raise
                    except Exception as e:
                        status["kapt"].setdefault("warnings", []).append("%s %s: %s" % (code, kc, e))
                        complete = False
                        continue
                    name = (info.get("kaptName") or x.get("kaptName") or "").strip()
                    dong, jibun = split_addr(info.get("kaptAddr") or "", name)
                    if not dong:
                        dong = (x.get("as4") or x.get("as3") or "").strip()
                    raw[kc] = [name, dong, jibun, _int(info.get("kaptdaCnt")), _int(info.get("kaptDongCnt"))]
                if complete:
                    done[code] = today.isoformat()
            m = match(raw, idx.keys())
            if m != cur.get("m") or raw != cur.get("raw"):
                write_json(path, {"m": m, "raw": raw, "n": len(m), "total": len(idx)})
            if stop:
                break
    except Stop as e:
        stop = str(e)
    except Exception as e:
        stop = "오류: %s: %s" % (type(e).__name__, e)
    daily["n"] += api.calls
    state["kaptDaily"] = daily
    with_data = [r for r in regions if os.path.exists(os.path.join(DATA, "index", r["code"] + ".json"))]
    matched = total = 0
    for r in with_data:
        k = read_json(os.path.join(DATA, "kapt", r["code"] + ".json"), None)
        if k:
            matched += k.get("n", 0)
            total += k.get("total", 0)
    status["kapt"].update({"calls": api.calls, "regionsDone": sum(1 for r in with_data if done.get(r["code"])), "regionsTotal": len(with_data),
                           "matched": matched, "complexes": total, "stop": stop})
    status["kapt"]["warnings"] = status["kapt"].get("warnings", [])[:20]
    print("[단지정보] 호출 %d번 · 지역 %d/%d 완료 · 세대수 연결 %d/%d단지%s" % (
        api.calls, status["kapt"]["regionsDone"], len(with_data), matched, total, (" · " + stop) if stop else ""))


# ═════════════════════════ 2) R-ONE 통계 ═════════════════════════
def rone_rows(body, name):
    """R-ONE 응답 → (rows, total). 자료가 없으면 ([], 0)"""
    try:
        obj = json.loads(body)
    except ValueError:
        raise RuntimeError("JSON 이 아닌 응답: " + body[:100].replace("\n", " "))
    if name not in obj:
        res = obj.get("RESULT") or {}
        code, msg = str(res.get("CODE", "")), str(res.get("MESSAGE", ""))
        if "200" in code or "해당하는 데이터가 없습니다" in msg:
            return [], 0
        if "인증키" in msg or "290" in code or "300" in code:
            raise Stop("R-ONE 인증키 문제: %s %s" % (code, msg))
        if "337" in code or "제한" in msg:
            raise Stop("R-ONE 호출 한도 초과: %s" % msg)
        raise RuntimeError("R-ONE 오류: %s %s" % (code, msg or body[:100]))
    total, rows = 0, []
    for part in obj[name]:
        if "head" in part:
            for h in part["head"]:
                if "list_total_count" in h:
                    total = _int(h["list_total_count"])
        if "row" in part:
            rows = part["row"] or []
    return rows, total or len(rows)


def rone_get(op, key, **params):
    params.update({"KEY": key, "Type": "json"})
    q = "&".join("%s=%s" % (k, urllib.parse.quote(str(v), safe="")) for k, v in params.items())
    out = rone_rows(_get("%s%s.do?%s" % (RONE_URL, op, q)), op)
    time.sleep(DELAY_SEC)
    return out


def rone_all(op, key, max_pages=60, **params):
    rows, page = [], 1
    while page <= max_pages:
        got, total = rone_get(op, key, pIndex=page, pSize=RONE_PAGE, **params)
        rows += got
        if not got or len(rows) >= total:
            break
        page += 1
    return rows


def pick_table(tables, word):
    """통계표 목록에서 '(월) 매매가격지수_아파트' 같은 표를 고름 → (번호, 이름, 후보들)"""
    cand = []
    for t in tables:
        name = str(t.get("STATBL_NM") or "")
        if word in name and "아파트" in name and "월" in name and not any(w in name for w in RONE_SKIP_WORDS):
            if str(t.get("DTACYCLE_CD") or "MM") in ("MM", ""):
                cand.append((len(name), name, str(t.get("STATBL_ID") or "")))
    cand.sort()
    return (cand[0][2], cand[0][1], [c[1] for c in cand[:6]]) if cand else ("", "", [])


_YM = re.compile(r"(\d{4})\D{0,2}(\d{1,2})")


def row_ym(row):
    v = str(row.get("WRTTIME_IDTFR_ID") or "")
    if len(v) >= 6 and v[:6].isdigit():
        return int(v[:6])
    m = _YM.search(str(row.get("WRTTIME_DESC") or ""))
    return int(m.group(1)) * 100 + int(m.group(2)) if m else 0


def run_rone(state, today, status):
    key = (os.environ.get("RONE_API_KEY") or "").strip()
    st = status["rone"]
    if not key:
        st["error"] = "RONE_API_KEY 가 없어 건너뜀 (README 의 'R-ONE 키 넣기' 참고)"
        print("[R-ONE] " + st["error"])
        return
    if state.get("roneDate") == today.isoformat() and os.path.exists(os.path.join(DATA, "rone.json")):
        st.update(state.get("roneInfo") or {})
        return                                        # 하루에 한 번만
    try:
        ids = dict(RONE_TABLES)
        names = {}
        if not (ids["sale"] and ids["rent"]):
            tables = rone_all("SttsApiTbl", key)
            for kind in ("sale", "rent"):
                if not ids[kind]:
                    ids[kind], names[kind], cand = pick_table(tables, RONE_NAMES[kind])
                    print("[R-ONE] %s 통계표: %s %s (후보: %s)" % (RONE_NAMES[kind], ids[kind] or "못 찾음", names.get(kind, ""), " / ".join(cand)))
        out = {"asOf": today.isoformat(), "tables": {}, "sale": {}, "rent": {}}
        for kind in ("sale", "rent"):
            if not ids[kind]:
                continue
            rows = rone_all("SttsApiTblData", key, STATBL_ID=ids[kind], DTACYCLE_CD="MM", START_WRTTIME=RONE_FROM_YM)
            items = {}
            for row in rows:
                items[str(row.get("ITM_NM") or "")] = items.get(str(row.get("ITM_NM") or ""), 0) + 1
            want = "지수" if "지수" in items else (max(items, key=items.get) if items else "")
            series = {}
            for row in rows:
                if str(row.get("ITM_NM") or "") != want:
                    continue
                ym, name = row_ym(row), str(row.get("CLS_FULLNM") or row.get("CLS_NM") or "").strip()
                try:
                    val = round(float(row.get("DTA_VAL")), 2)
                except (TypeError, ValueError):
                    continue
                if ym and name:
                    series.setdefault(name, {})[ym] = val
            out[kind] = {n: sorted(v.items()) for n, v in series.items()}
            out["tables"][kind] = {"id": ids[kind], "name": names.get(kind, ""), "item": want, "regions": len(series)}
            print("[R-ONE] %s: %d줄 → 지역 %d곳 (항목: %s)" % (RONE_NAMES[kind], len(rows), len(series), want or "-"))
        if out["sale"] or out["rent"]:
            write_json(os.path.join(DATA, "rone.json"), out)
            state["roneDate"] = today.isoformat()
            state["roneInfo"] = {"asOf": out["asOf"], "tables": out["tables"]}
            st.update(state["roneInfo"])
        else:
            st["error"] = "가격지수 통계표를 찾지 못했습니다. Actions 로그의 [R-ONE] 줄을 확인하세요."
    except Stop as e:
        st["error"] = str(e)
    except Exception as e:
        st["error"] = "%s: %s" % (type(e).__name__, e)
    if st.get("error"):
        print("[R-ONE] " + st["error"])


# ═════════════════════════ 실행 ═════════════════════════
def run(regions):
    """collect.py 가 실거래 수집을 마친 뒤 부릅니다."""
    today = dt.datetime.now(KST).date()
    spath = os.path.join(DATA, "extra_state.json")
    state = read_json(spath, {})
    status = {"updatedAt": dt.datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "kapt": {}, "rone": {}}
    deadline = time.time() + MAX_MINUTES * 60
    try:
        run_rone(state, today, status)
    except Exception as e:
        status["rone"]["error"] = "%s: %s" % (type(e).__name__, e)
    try:
        run_kapt(regions, state, deadline, today, status)
    except Exception as e:
        status["kapt"]["error"] = "%s: %s" % (type(e).__name__, e)
        print("[단지정보] 오류:", status["kapt"]["error"])
    write_json(spath, state)
    write_json(os.path.join(DATA, "extra_status.json"), status)
    return status


def check():
    """키가 되는지 한 번씩만 불러 봄"""
    state = {}
    try:
        api = Kapt(state)
        items = api.list("11110")
        print("[정상] 단지 목록 API: 종로구 %d단지" % len(items))
        if items:
            info = api.info(items[0]["kaptCode"].strip())
            print("[정상] 단지 기본정보 API: %s · 세대수 %s · 주소 %s" % (info.get("kaptName"), info.get("kaptdaCnt"), info.get("kaptAddr")))
    except Exception as e:
        print("[오류] 단지 정보 API: %s: %s" % (type(e).__name__, e))
    key = (os.environ.get("RONE_API_KEY") or "").strip()
    if not key:
        print("[건너뜀] R-ONE: RONE_API_KEY 없음")
        return 0
    try:
        tables = rone_all("SttsApiTbl", key)
        for kind in ("sale", "rent"):
            tid, name, cand = pick_table(tables, RONE_NAMES[kind])
            print("[정상] R-ONE %s 통계표: %s %s (후보: %s)" % (RONE_NAMES[kind], tid or "못 찾음", name, " / ".join(cand)))
    except Exception as e:
        print("[오류] R-ONE: %s: %s" % (type(e).__name__, e))
    return 0


if __name__ == "__main__":
    if "--check" in sys.argv:
        sys.exit(check())
    import collect
    run(collect.load_regions())
