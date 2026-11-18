#!/usr/bin/env python3
"""
인구 이동 수집 ([인구이동] 탭) — 통계청 KOSIS 국내인구이동통계 (월)

  1) 시군구별 이동자수   : 시군구마다 총전입 · 총전출 · 순이동 (월별)
  2) 시도 간 이동        : 전출 시도 → 전입 시도 이동자 수 (월별)

  · 키: GitHub Secrets 의 KOSIS_API_KEY (KOSIS 공유서비스 인증키). 코드·저장소에는 키를 넣지 않습니다.
  · 처음: 최근 36개월 / 그다음: 최근 4개월만 다시 받아 합침 (늦게 고쳐지는 값 반영)
  · 결과: data/migration.json (화면용), data/migration_status.json (받은 통계표·항목 이름·예시·오류 — 문제 찾기용)
  · 통계표 번호는 아래 후보를 차례로 시도합니다. 항목은 번호가 아니라 이름(총전입·총전출·순이동)으로 찾습니다.

  사용:  KOSIS_API_KEY=... python scripts/migration.py          (보통)
         KOSIS_API_KEY=... python scripts/migration.py --full   (36개월 다시)
"""
import datetime, json, os, re, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(DATA, "migration.json")
STATUS = os.path.join(DATA, "migration_status.json")
BASE = "https://kosis.kr/openapi/Param/statisticsParameterData.do"
SGG_TABLES = [("101", "DT_1B26001_A01"), ("101", "DT_1B26001")]          # 시군구별 이동자수 (월)
OD_TABLES = [("101", "DT_1B26003_A01"), ("101", "DT_1B26003")]            # 전출지/전입지(시도)별 이동자수 (월)
FULL_MONTHS, RECENT_MONTHS, CHUNK = 36, 4, 3                              # 한 번에 3개월씩 (요청당 4만 칸 한도)
TIMEOUT = 60
DELAY = 0.4
# 인천 행정구역 개편: 새 구 → 실거래 자료가 쓰는 예전 구 (인구 수집기와 같은 규칙)
INCHEON_NEW = {"영종구": "28110", "제물포구": "28110", "서해구": "28260", "검단구": "28260"}
SIDO_SHORT = {"서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구", "인천광역시": "인천", "광주광역시": "광주", "대전광역시": "대전",
              "울산광역시": "울산", "세종특별자치시": "세종", "경기도": "경기", "강원도": "강원", "강원특별자치도": "강원", "충청북도": "충북",
              "충청남도": "충남", "전라북도": "전북", "전북특별자치도": "전북", "전라남도": "전남", "경상북도": "경북", "경상남도": "경남",
              "제주도": "제주", "제주특별자치도": "제주", "전남광주통합특별시": "전남"}


def http_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "apt-dashboard-migration/1.0"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read().decode("utf-8", errors="replace")


class KosisError(Exception):
    pass


def call(key, org, tbl, start, end, objs):
    q = {"method": "getList", "apiKey": key, "orgId": org, "tblId": tbl, "itmId": "ALL", "format": "json", "jsonVD": "Y",
         "prdSe": "M", "startPrdDe": str(start), "endPrdDe": str(end)}
    for i, v in enumerate(objs, 1):
        q["objL%d" % i] = v
    url = BASE + "?" + urllib.parse.urlencode(q)
    last = None
    for attempt in range(3):
        if attempt:
            time.sleep(4 * attempt)
        try:
            txt = http_get(url)
        except Exception as e:  # noqa: BLE001
            last = "%s: %s" % (type(e).__name__, str(e)[:160])
            continue
        time.sleep(DELAY)
        try:
            js = json.loads(txt)
        except ValueError:
            last = "JSON 아님: " + txt[:200]
            continue
        if isinstance(js, dict) and (js.get("err") or js.get("errMsg")):
            msg = "%s %s" % (js.get("err", ""), js.get("errMsg", ""))
            if re.search(r"인증|apiKey|키", msg):
                raise KosisError("KOSIS 인증키 문제(유효기간·등록 확인): " + msg.strip())
            raise KosisError(msg.strip())
        if isinstance(js, list):
            return js
        last = "알 수 없는 응답: " + str(js)[:200]
    raise RuntimeError(last or "응답 없음")


def ym_add(ym, n):
    y, m = divmod(ym, 100)
    m += n
    while m < 1:
        m += 12; y -= 1
    while m > 12:
        m -= 12; y += 1
    return y * 100 + m


def month_list(last, n):
    return [ym_add(last, -k) for k in range(n - 1, -1, -1)]


def num(v):
    s = re.sub(r"[^\d\-.]", "", str(v or ""))
    try:
        return int(float(s)) if s not in ("", "-", ".") else None
    except ValueError:
        return None


def kind_of(item_name):
    n = re.sub(r"\s", "", item_name or "")
    if "순이동" in n and "률" not in n:
        return "net"
    if "총전입" in n or n in ("전입", "전입자수"):
        return "in"
    if "총전출" in n or n in ("전출", "전출자수"):
        return "out"
    return None


def fetch_table(key, cands, months, objs, st, tag):
    """후보 통계표를 차례로 시도해 months 기간 줄을 모두 받음"""
    errs = []
    for org, tbl in cands:
        rows, ok = [], True
        for i in range(0, len(months), CHUNK):
            ms = months[i:i + CHUNK]
            try:
                rows += call(key, org, tbl, ms[0], ms[-1], objs)
            except KosisError as e:
                if "인증키" in str(e):
                    raise
                errs.append("%s: %s" % (tbl, e)); ok = False; break
            except Exception as e:  # noqa: BLE001
                errs.append("%s %s~%s: %s" % (tbl, ms[0], ms[-1], str(e)[:160])); ok = False; break
        if ok and rows:
            st["tables"][tag] = {"orgId": org, "tblId": tbl, "name": rows[0].get("TBL_NM", ""),
                                 "items": sorted({r.get("ITM_NM", "") for r in rows}),
                                 "sample": rows[:3], "rows": len(rows)}
            return rows
    st["errors"] += errs
    return []


def main():
    full = "--full" in sys.argv
    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9)))
    st = {"asOf": now.strftime("%Y-%m-%d %H:%M"), "ok": False, "errors": [], "notes": [], "tables": {}}
    key = (os.environ.get("KOSIS_API_KEY") or "").strip()
    if not key:
        st["errors"].append("KOSIS_API_KEY 가 설정되지 않았습니다. (GitHub → Settings → Secrets and variables → Actions 에 등록)")
        save(STATUS, st, indent=1); print(st["errors"][0]); return 0
    try:
        regions = json.load(open(os.path.join(DATA, "regions.json"), encoding="utf-8"))
    except Exception:
        regions = []
    reg = {r[0]: r for r in regions}
    old = {}
    if os.path.exists(OUT) and not full:
        try:
            old = json.load(open(OUT, encoding="utf-8"))
        except Exception:
            old = {}
    # 공표는 보통 다음 달 말 → 지난달까지 시도, 없으면 그 전 달
    last = ym_add(now.year * 100 + now.month, -1)
    n = RECENT_MONTHS if old.get("months") else FULL_MONTHS
    months = month_list(last, n + 1)          # 한 달 더 앞까지 (아직 공표 안 된 달은 비어서 옴)
    try:
        # ① 시군구별
        rows = fetch_table(key, SGG_TABLES, months, ["ALL"], st, "sgg")
        sgg, unmatched = {}, {}
        # KOSIS 지역 번호는 통계청 행정구역분류(경기 31 등)라 실거래 법정동 코드(경기 41)와 다를 수 있음
        #  → 시도 줄(2자리)에서 시도 이름을 알아내고, '시도 이름 + 구 이름' 으로 실거래 지역과 맞춤
        sido_nm = {}
        for r in rows:
            c = re.sub(r"\D", "", str(r.get("C1", "")))
            if len(c) == 2:
                sido_nm[c] = str(r.get("C1_NM", "")).strip()
        ns = lambda s: re.sub(r"\s", "", str(s or ""))
        short2 = lambda s: SIDO_SHORT.get(s, re.sub(r"(특별자치시|특별자치도|특별시|광역시|도)$", "", s)[:2])
        memo = {}

        def to_code(c5, nm):
            if (c5, nm) in memo:
                return memo[(c5, nm)]
            nm0 = ns(nm)
            sd = sido_nm.get(c5[:2], "")
            code = None
            if c5 in reg and ns(reg[c5][2]).endswith(nm0):                       # 번호가 같고 이름도 맞으면 그대로
                code = c5
            elif short2(sd) == "인천" and nm0 in INCHEON_NEW:
                code = INCHEON_NEW[nm0]
            else:
                exact = [x for x in regions if ns(x[2]) == nm0 or (x[2].split() and x[2].split()[-1] == nm0)]   # '서구'가 '강서구'에 걸리지 않게 정확히
                cand = exact or [x for x in regions if ns(x[2]).endswith(nm0)]
                if sd:
                    sdc = [x for x in cand if short2(x[1]) == short2(sd) or (short2(sd) in ("전남", "광주") and short2(x[1]) in ("전남", "광주"))]
                    cand = sdc or cand
                if len(cand) == 1:
                    code = cand[0][0]
                elif len(cand) > 1 and nm0.startswith(("광주",)):             # 전남광주통합 '광주동구' 형태
                    code = next((x[0] for x in cand if short2(x[1]) == "광주"), None)
            memo[(c5, nm)] = code
            return code

        for r in rows:
            k = kind_of(r.get("ITM_NM"))
            c = re.sub(r"\D", "", str(r.get("C1", "")))
            ym = num(r.get("PRD_DE"))
            v = num(r.get("DT"))
            if not k or not ym or v is None or len(c) < 4:
                continue
            nm = str(r.get("C1_NM", "")).strip()
            nm1 = re.sub(r"^광주(?=(동구|서구|남구|북구|광산구)$)", "", nm)        # '광주동구' → '동구' (시도는 광주로)
            code = to_code(c[:5], nm1 if nm1 != nm else nm)
            if nm1 != nm and code is None:
                cand = [x for x in regions if short2(x[1]) == "광주" and ns(x[2]) == nm1]
                code = cand[0][0] if cand else None
            if not code:
                unmatched[c[:5]] = nm
                continue
            d = sgg.setdefault(code, {}).setdefault(ym, {"in": 0, "out": 0, "net": 0})
            d[k] += v                                  # 새 구 여러 개 → 예전 구 하나로 합침
        got = sorted({ym for d in sgg.values() for ym in d})
        if not got:
            raise RuntimeError("시군구 자료를 하나도 읽지 못했습니다 (통계표·항목 이름 확인 필요)")
        # ② 시도 간
        od_rows = fetch_table(key, OD_TABLES, months, ["ALL", "ALL"], st, "od")
        od = {}
        for r in od_rows:
            ym = num(r.get("PRD_DE")); v = num(r.get("DT"))
            a = re.sub(r"\D", "", str(r.get("C1", ""))); b = re.sub(r"\D", "", str(r.get("C2", "")))
            an, bn = str(r.get("C1_NM", "")).strip(), str(r.get("C2_NM", "")).strip()
            if not ym or not v or a[:2] == "00" or b[:2] == "00" or an == bn or "전국" in (an + bn) or "계" in (an, bn):
                continue
            od.setdefault(ym, {})[(an, bn)] = v
        # 합치기 (예전 자료 + 새로 받은 달)
        old_m = old.get("months", [])
        all_m = sorted(set(old_m) | set(got))[-60:]
        out_sgg = {}
        for code in set(old.get("sgg", {})) | set(sgg):
            prev = old.get("sgg", {}).get(code, {})
            arr = {k: [] for k in ("in", "out", "net")}
            for ym in all_m:
                cur = sgg.get(code, {}).get(ym)
                for k in arr:
                    if cur is not None:
                        arr[k].append(cur[k])
                    elif ym in old_m and prev.get(k) and old_m.index(ym) < len(prev[k]):
                        arr[k].append(prev[k][old_m.index(ym)])
                    else:
                        arr[k].append(None)
            out_sgg[code] = arr
        od_all = {str(k): v for k, v in (old.get("od") or {}).items()}
        for ym, flows in od.items():
            od_all[str(ym)] = [[a, b, n] for (a, b), n in sorted(flows.items(), key=lambda x: -x[1])]
        od_all = {k: od_all[k] for k in sorted(od_all)[-36:]}
        out = {"asOf": st["asOf"], "months": all_m, "sgg": out_sgg, "od": od_all,
               "source": "통계청 KOSIS 국내인구이동통계 (주민등록 전입신고 기준)"}
        save(OUT, out)
        st.update({"ok": True, "months": [all_m[0], all_m[-1]] if all_m else [], "regions": len(out_sgg),
                   "newMonths": got, "odMonths": len(od_all)})
        if unmatched:
            st["notes"].append("지역을 못 맞춘 KOSIS 코드 %d개: %s" % (len(unmatched), ", ".join("%s %s" % kv for kv in list(unmatched.items())[:30])))
        missing = [c for c in reg if c not in out_sgg]
        if missing:
            st["notes"].append("자료가 없는 실거래 지역 %d개: %s" % (len(missing), ", ".join(missing[:30])))
    except KosisError as e:
        st["errors"].append(str(e))
    except Exception as e:  # noqa: BLE001
        st["errors"].append("%s: %s" % (type(e).__name__, str(e)[:300]))
    save(STATUS, st, indent=1)
    print("인구이동 수집:", "성공" if st["ok"] else "실패", st.get("months"), st["errors"] or "")
    return 0


def save(path, obj, indent=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=indent, separators=None if indent else (",", ":"))


if __name__ == "__main__":
    sys.exit(main())
