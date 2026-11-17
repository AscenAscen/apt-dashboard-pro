#!/usr/bin/env python3
"""
공급 자료 수집 (공급 탭) — 한국부동산원 청약홈 오픈 API

  1) 분양정보 상세  (ApplyhomeInfoDetailSvc / getAPTLttotPblancDetail) : 단지·공급위치·공급규모·입주예정월·정비사업 여부
  2) 주택형별 정보  (ApplyhomeInfoDetailSvc / getAPTLttotPblancMdl)    : 주택형·공급세대·최고 분양가
  3) 청약 경쟁률    (ApplyhomeInfoCmpetRtSvc / getAPTLttotPblancCmpet) : 1순위 접수 건수 → 경쟁률

  · 키: 실거래 수집과 같은 공공데이터포털 키 (환경변수 MOLIT_API_KEY). 두 서비스에 활용 신청만 되어 있으면 됨
  · 처음 실행: 2020년 이후 공고 전체 / 그다음부터: 최근 공고만 다시 받아 합침 (증분)
  · 결과: data/supply.json (화면용), data/supply_status.json (수집 결과·오류·받은 칸 이름 — 문제 찾기용, 키는 저장 안 함)

  사용:  python scripts/supply.py            (보통)
         python scripts/supply.py --full     (전체 다시 받기)
"""
import json, os, re, sys, time, urllib.parse, urllib.request, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(DATA, "supply.json")
STATUS = os.path.join(DATA, "supply_status.json")
BASE_INFO = "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1"
BASE_CMP = "https://api.odcloud.kr/api/ApplyhomeInfoCmpetRtSvc/v1"
START = "2020-01-01"
PER_PAGE = 1000
DELAY = float(os.environ.get("SUPPLY_DELAY", "0.15"))
MAX_CALLS = int(os.environ.get("SUPPLY_MAX_CALLS", "3000"))
TIMEOUT = 40


class KeyProblem(Exception):
    pass


def service_key():
    key = (os.environ.get("MOLIT_API_KEY") or "").strip()
    if not key:
        raise KeyProblem("MOLIT_API_KEY 가 설정되지 않았습니다. (GitHub → Settings → Secrets 에 등록)")
    return key if "%" in key else urllib.parse.quote(key, safe="")


def http_get(url):
    """테스트에서 바꿔 끼울 수 있도록 분리"""
    req = urllib.request.Request(url, headers={"User-Agent": "apt-dashboard-supply/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
        return res.read().decode("utf-8", errors="replace")


class Api:
    def __init__(self, key):
        self.key, self.calls, self.errors = key, 0, []

    def page(self, base, op, page, cond=None):
        if self.calls >= MAX_CALLS:
            raise RuntimeError("이번 실행 호출 한도(%d) 도달 — 다음 실행 때 이어서 받습니다." % MAX_CALLS)
        q = "page=%d&perPage=%d&returnType=JSON&serviceKey=%s" % (page, PER_PAGE, self.key)
        for k, v in (cond or {}).items():
            q += "&" + urllib.parse.quote("cond[%s]" % k, safe="") + "=" + urllib.parse.quote(str(v), safe="")
        url = "%s/%s?%s" % (base, op, q)
        last = None
        for attempt in range(3):
            if attempt:
                time.sleep(3 * attempt)
            self.calls += 1
            time.sleep(DELAY)
            try:
                txt = http_get(url)
                js = json.loads(txt)
            except Exception as e:                       # 네트워크·형식 오류 → 다시 시도
                last = "%s: %s" % (type(e).__name__, str(e)[:200])
                continue
            if isinstance(js, dict) and "data" in js:
                return js
            msg = json.dumps(js, ensure_ascii=False)[:300]
            code = js.get("code") if isinstance(js, dict) else None
            if (isinstance(code, int) and code <= -400) or re.search(r"(?i)unauthor|not registered|등록되지 않은|인증키", msg):
                raise KeyProblem("API 키 또는 활용 신청 문제: %s" % msg)
            last = "알 수 없는 응답: " + msg
        raise RuntimeError("%s 호출 실패 (page %d): %s" % (op, page, last))

    def all(self, base, op, cond=None, limit_pages=10000):
        rows, page, total = [], 1, None
        while page <= limit_pages:
            js = self.page(base, op, page, cond)
            data = js.get("data") or []
            total = js.get("matchCount", js.get("totalCount", total))
            rows.extend(data)
            if not data or len(data) < PER_PAGE or (total is not None and len(rows) >= int(total)):
                break
            page += 1
        return rows


# ───────────── 값 꺼내기 (칸 이름이 조금 달라도 동작하게) ─────────────
def g(row, *names, default=None):
    for n in names:
        if n in row and row[n] not in (None, ""):
            return row[n]
        for k in row:
            if k.lower() == n.lower() and row[k] not in (None, ""):
                return row[k]
    return default


def num(v):
    if v is None:
        return None
    s = re.sub(r"[^\d.\-]", "", str(v))
    try:
        return float(s) if s not in ("", "-", ".") else None
    except ValueError:
        return None


def ymd(v):
    d = re.sub(r"\D", "", str(v or ""))
    return d[:8] if len(d) >= 8 else ""


def ym(v):
    d = re.sub(r"\D", "", str(v or ""))
    return int(d[:6]) if len(d) >= 6 else None


# ───────────── 주소 → 지역 코드 (data/regions.json) ─────────────
SIDO_ALIAS = {"강원도": "강원특별자치도", "전라북도": "전북특별자치도", "제주도": "제주특별자치도"}


def build_matcher():
    try:
        regions = json.load(open(os.path.join(DATA, "regions.json"), encoding="utf-8"))
    except Exception:
        regions = []
    by_sido = {}
    for r in regions:
        by_sido.setdefault(r[1], []).append(r)
    sidos = list(by_sido)

    def norm_sido(t):
        t = SIDO_ALIAS.get(t, t)
        if t in by_sido:
            return t
        for s in sidos:                                   # "서울" → "서울특별시", 통합 시도 이름도 앞 두 글자로
            if s.startswith(t[:2]):
                return s
        return None

    def match(addr):
        toks = (addr or "").replace(",", " ").split()
        if not toks:
            return None, ""
        sido = norm_sido(toks[0])
        cands = by_sido.get(sido, regions) if sido else regions
        best, blen = None, 0
        for r in cands:
            st = r[2].split()
            if not st:
                continue
            for i in range(1, min(4, len(toks))):
                if toks[i:i + len(st)] == st and len(st) > blen:
                    best, blen, at = r, len(st), i
        if best is None and sido and sido.startswith("세종"):
            best = (by_sido.get(sido) or [None])[0]
            at, blen = 0, 1
        if best is None:
            return None, ""
        rest = toks[at + blen:]
        dong = ""
        if rest and re.search(r"(동|가|읍|면|리)\d*$", rest[0]):
            dong = rest[0]
            if re.search(r"(읍|면)$", dong) and len(rest) > 1 and re.search(r"리$", rest[1]):
                dong += " " + rest[1]
        return best, dong
    return match


def main():
    full = "--full" in sys.argv
    status = {"asOf": datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime("%Y-%m-%d %H:%M"),
              "ok": False, "errors": [], "notes": [], "fields": {}, "sample": {}}
    old = {}
    if os.path.exists(OUT) and not full:
        try:
            for it in json.load(open(OUT, encoding="utf-8")).get("items", []):
                old[it["id"]] = it
        except Exception as e:
            status["notes"].append("기존 supply.json 을 읽지 못해 처음부터 받습니다: %s" % e)
    try:
        api = Api(service_key())
    except KeyProblem as e:
        status["errors"].append(str(e))
        save_status(status)
        print(e)
        return 0

    match = build_matcher()
    items = dict(old)
    first = not old
    since = START
    if old:
        last = max((it.get("pub") or "" for it in old.values()), default="")
        if last:
            d = datetime.date(int(last[:4]), int(last[4:6]), int(last[6:8])) - datetime.timedelta(days=120)
            since = max(START, d.isoformat())
    status["since"] = since
    try:
        # 1) 분양 공고 상세
        rows = api.all(BASE_INFO, "getAPTLttotPblancDetail", {"RCRIT_PBLANC_DE::GTE": since})
        if rows:
            status["fields"]["detail"] = sorted(rows[0].keys())
            status["sample"]["detail"] = {k: rows[0][k] for k in list(rows[0])[:40]}
        new_ids = []
        unmatched = []
        for r in rows:
            hm = str(g(r, "HOUSE_MANAGE_NO", default="")).strip()
            pb = str(g(r, "PBLANC_NO", default=hm)).strip()
            if not hm:
                continue
            iid = "%s|%s" % (hm, pb)
            addr = str(g(r, "HSSPLY_ADRES", default="")).strip()
            reg, dong = match(addr)
            if reg is None:
                unmatched.append(addr)
            prev = items.get(iid, {})
            it = {
                "id": iid, "hm": hm, "pb": pb,
                "nm": str(g(r, "HOUSE_NM", default="")).strip(),
                "c": reg[0] if reg else "", "sd": reg[1] if reg else "", "sg": reg[2] if reg else "", "dg": dong,
                "ad": addr, "pub": ymd(g(r, "RCRIT_PBLANC_DE")), "mv": ym(g(r, "MVN_PREARNGE_YM")),
                "hh": int(num(g(r, "TOT_SUPLY_HSHLDCO", "SUPLY_HSHLDCO")) or 0),
                "reb": 1 if str(g(r, "IMPRMN_BSNS_AT", default="N")).upper().startswith("Y") else 0,
                "bd": str(g(r, "CNSTRCT_ENTRPS_NM", default="")).strip(),
                "ty": str(g(r, "HOUSE_SECD_NM", "HOUSE_DTL_SECD_NM", default="")).strip(),
                "url": str(g(r, "PBLANC_URL", "HMPG_ADRES", default="")).strip(),
                "m": prev.get("m", []), "cr": prev.get("cr"), "cm": prev.get("cm", {}),
            }
            if iid not in items or not prev.get("m"):
                new_ids.append(iid)
            items[iid] = it
        status["newItems"] = len(new_ids)
        status["unmatched"] = len(unmatched)
        if unmatched:
            status["notes"].append("지역을 찾지 못한 주소 %d건 (예: %s)" % (len(unmatched), " / ".join(unmatched[:5])))

        # 2) 주택형별 분양가 — 처음엔 한꺼번에, 그 뒤엔 새 공고만
        want = set(new_ids)
        if want:
            if first or len(want) > 150:
                mrows = api.all(BASE_INFO, "getAPTLttotPblancMdl")
            else:
                mrows = []
                for iid in want:
                    mrows += api.all(BASE_INFO, "getAPTLttotPblancMdl", {"HOUSE_MANAGE_NO::EQ": items[iid]["hm"]})
            if mrows:
                status["fields"]["model"] = sorted(mrows[0].keys())
                status["sample"]["model"] = mrows[0]
            ms = {}
            for r in mrows:
                hm = str(g(r, "HOUSE_MANAGE_NO", default="")).strip()
                pb = str(g(r, "PBLANC_NO", default=hm)).strip()
                iid = "%s|%s" % (hm, pb)
                if iid not in items:
                    continue
                ty = str(g(r, "HOUSE_TY", default="")).strip()
                area = num(re.match(r"[\d.]+", ty).group(0)) if re.match(r"[\d.]+", ty) else num(g(r, "SUPLY_AR"))
                n = int((num(g(r, "SUPLY_HSHLDCO")) or 0) + (num(g(r, "SPSPLY_HSHLDCO")) or 0))
                price = num(g(r, "LTTOT_TOP_AMOUNT"))
                if price and price > 10 ** 7:                    # 원 단위로 왔으면 만원으로
                    price = price / 10000
                ms.setdefault(iid, []).append([ty, round(area, 2) if area else None, n, int(price) if price else None])
            for iid, lst in ms.items():
                items[iid]["m"] = sorted(lst, key=lambda x: (x[1] or 0, x[0]))
            status["models"] = sum(len(v) for v in ms.values())

        # 3) 경쟁률 — 처음엔 한꺼번에, 그 뒤엔 최근 공고(접수 후 경쟁률이 나올 시기)와 아직 없는 것
        today = datetime.date.today()
        recent = [iid for iid, it in items.items() if it.get("pub") and it["pub"] >= (today - datetime.timedelta(days=150)).strftime("%Y%m%d") and it.get("cr") is None]
        crows = []
        if first or full:
            crows = api.all(BASE_CMP, "getAPTLttotPblancCmpet")
        else:
            for iid in recent[:400]:
                crows += api.all(BASE_CMP, "getAPTLttotPblancCmpet", {"HOUSE_MANAGE_NO::EQ": items[iid]["hm"]})
        if crows:
            status["fields"]["cmp"] = sorted(crows[0].keys())
            status["sample"]["cmp"] = crows[0]
        agg = {}
        for r in crows:
            hm = str(g(r, "HOUSE_MANAGE_NO", default="")).strip()
            pb = str(g(r, "PBLANC_NO", default=hm)).strip()
            iid = "%s|%s" % (hm, pb)
            if iid not in items:
                continue
            rank = str(g(r, "SUBSCRPT_RANK_CODE", "SUBSCRPT_RANK", default="1")).strip()
            if rank not in ("1", "01", "1순위"):
                continue
            ty = str(g(r, "HOUSE_TY", "MODEL_NO", default="")).strip()
            a = agg.setdefault(iid, {}).setdefault(ty, [0, 0])
            a[0] = max(a[0], int(num(g(r, "SUPLY_HSHLDCO")) or 0))
            a[1] += int(num(g(r, "REQ_CNT")) or 0)
        for iid, tys in agg.items():
            sup = sum(v[0] for v in tys.values()); req = sum(v[1] for v in tys.values())
            items[iid]["cr"] = round(req / sup, 2) if sup else None
            items[iid]["cm"] = {ty: round(v[1] / v[0], 2) for ty, v in tys.items() if v[0]}
        status["cmp"] = len(agg)
        status["ok"] = True
    except KeyProblem as e:
        status["errors"].append(str(e))
    except Exception as e:
        status["errors"].append("%s: %s" % (type(e).__name__, str(e)[:300]))
    status["calls"] = api.calls
    status["items"] = len(items)
    if items:
        out = {"asOf": status["asOf"], "items": sorted(items.values(), key=lambda x: (x.get("pub") or "", x["id"]))}
        os.makedirs(DATA, exist_ok=True)
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    save_status(status)
    print("공급 수집: 공고 %d건 (새로 %s) · 호출 %d · 오류 %s" % (len(items), status.get("newItems", 0), api.calls, status["errors"] or "없음"))
    return 0                                        # 오류도 상태 파일에 남겨 화면에서 보이게 (실패로 끝내지 않음)


def save_status(st):
    os.makedirs(DATA, exist_ok=True)
    with open(STATUS, "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    sys.exit(main())
