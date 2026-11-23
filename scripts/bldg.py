#!/usr/bin/env python3
"""건축물대장(국토교통부_건축HUB_건축물대장정보 서비스) → 단지별 세대수·용적률·건폐율 (data/bldg/{지역코드}.json)

· 실거래 단지(data/names.json)의 주소(시군구 · 동 · 지번)로 건축물대장을 조회합니다. 이름이 달라도 지번으로 바로 연결됩니다.
· 1) 총괄표제부(getBrRecapTitleInfo)를 먼저 보고, 없으면 2) 표제부(getBrTitleInfo)에서 공동주택 동들의 세대수를 더합니다.
· 하루 호출 한도가 있어서 매일 조금씩 받습니다. 순서: 세대수가 비어 있는 단지 → 나머지(용적률용).
  한 번 받은 지번은 RECHECK_DAYS 일 동안 다시 묻지 않습니다. 새 단지는 실거래 수집 때 names.json 에 생기면 자동으로 차례가 옵니다.
· 인증키: GitHub Secret 의 MOLIT_API_KEY (실거래 수집과 같은 키 — 공공데이터포털 키는 계정당 하나)
· 법정동코드: data/bjd.json (동 이름 → 법정동코드). 2026년 행정구역 개편으로 새로 생긴 구는 예전 코드로도 시도합니다.

결과 모양  data/bldg/{지역코드}.json
  { "asOf": "YYYY-MM-DD", "m": { 단지키: [세대수, 용적률(%), 건폐율(%), 동수, 출처("r"=총괄표제부 | "t"=표제부)] } }
  용적률·건폐율이 대장에 0 으로 적혀 있으면(오래된 단지에 많음) 0 그대로 둡니다 → 화면에는 표시하지 않음.

사용법:  python scripts/bldg.py            (환경변수 BLDG_MAX_CALLS 로 1회 호출 수 조절, 기본 9000)
"""
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(DATA, "bldg")
STATE = os.path.join(DATA, "bldg_state.json")
STATUS = os.path.join(DATA, "bldg_status.json")
BASE = "https://apis.data.go.kr/1613000/BldRgstHubService/"
MAX_CALLS = int(os.environ.get("BLDG_MAX_CALLS") or 9000)       # 이번 실행에서 쓸 최대 호출 수 (개발계정 하루 한도 안쪽)
MAX_MINUTES = float(os.environ.get("BLDG_MAX_MINUTES") or 150)    # 너무 오래 돌지 않게
RECHECK_DAYS = 365                                                # 받은 지번을 다시 확인하는 주기
KST = dt.timezone(dt.timedelta(hours=9))


class Quota(Exception): pass
class KeyProblem(Exception): pass
class Temp(Exception): pass


def load(path, fallback):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return fallback


def save(path, obj, compact=True):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        if compact: json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        else: json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def service_key():
    key = (os.environ.get("MOLIT_API_KEY") or "").strip()
    if not key:
        raise KeyProblem("MOLIT_API_KEY 가 설정되지 않았습니다. (GitHub → Settings → Secrets)")
    return key if "%" in key else urllib.parse.quote(key, safe="")


def http_get(url):
    """테스트에서 바꿔 끼울 수 있도록 분리"""
    req = urllib.request.Request(url, headers={"User-Agent": "apt-dashboard-bldg/1.0", "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=30) as res:
        return res.read().decode("utf-8", errors="replace")


def parse(body):
    """→ (items, totalCount). 오류면 예외"""
    t = body.strip()
    if not t.startswith("{"):                                     # 포털 게이트웨이 오류는 XML 로 옴
        low = t[:400]
        m = re.search(r"<returnReasonCode>(\d+)<", low)
        code = m.group(1) if m else ""
        if code == "22" or "LIMITED" in low.upper(): raise Quota(low[:120])
        if code in ("20", "30", "31", "32") or "NOT_REGISTERED" in low.upper(): raise KeyProblem(low[:160])
        raise Temp(low[:120].replace("\n", " "))
    j = json.loads(t)
    r = j.get("response") or {}
    h = r.get("header") or {}
    rc = str(h.get("resultCode") or "")
    if rc in ("03",): return [], 0
    if rc == "22": raise Quota(h.get("resultMsg"))
    if rc in ("20", "30", "31", "32"): raise KeyProblem("%s (코드 %s)" % (h.get("resultMsg"), rc))
    if rc not in ("00", "000"): raise Temp("%s (코드 %s)" % (h.get("resultMsg"), rc))
    b = r.get("body") or {}
    items = (b.get("items") or {})
    items = items.get("item") if isinstance(items, dict) else []
    if isinstance(items, dict): items = [items]
    return items or [], int(b.get("totalCount") or 0)


class Api:
    def __init__(self, budget):
        self.key = service_key(); self.calls = 0; self.budget = budget; self.errors = 0

    def get(self, op, sgg, bjd, plat, bun, ji, rows=100):
        if self.calls >= self.budget: raise Quota("이번 실행 호출 한도(%d) 도달" % self.budget)
        url = "%s%s?serviceKey=%s&sigunguCd=%s&bjdongCd=%s&platGbCd=%s&bun=%s&ji=%s&numOfRows=%d&pageNo=1&_type=json" % (
            BASE, op, self.key, sgg, bjd, plat, bun, ji, rows)
        last = None
        for i in range(3):
            self.calls += 1
            try:
                return parse(http_get(url))
            except (Quota, KeyProblem):
                raise
            except (Temp, urllib.error.URLError, TimeoutError, ValueError, ConnectionError) as e:
                last = e; self.errors += 1; time.sleep(1.5 * (i + 1))
        raise Temp(str(last))


# ───────── 주소 → 조회값 ─────────
def split_jibun(j):
    """'316' → ('0','0316','0000') / '69-1' → ('0','0069','0001') / '산69-1' → ('1',…) / 블록 번호 등은 None"""
    m = re.fullmatch(r"(산)?(\d+)(?:-(\d+))?", (j or "").strip())
    if not m: return None
    return ("1" if m.group(1) else "0", m.group(2).zfill(4), (m.group(3) or "0").zfill(4))


def num(v):
    try: return float(str(v).replace(",", ""))
    except (TypeError, ValueError): return 0.0


def norm(n):
    n = str(n or "").lower()
    n = re.sub(r"e-?편한세상", "이편한세상", n); n = re.sub(r"i-?park", "아이파크", n)
    return re.sub(r"\s|아파트|apt|[()·\-_.,]|제\d+동|\d+동", "", n)


def pick_recap(items, name):
    """총괄표제부가 여럿이면 이름이 가장 비슷한 것, 그다음 세대수가 큰 것"""
    items = [it for it in items if int(num(it.get("hhldCnt"))) > 0] or items
    if not items: return None
    nn = norm(name)
    def score(it):
        b = norm(it.get("bldNm"))
        return (1 if b and (b in nn or nn in b) else 0, num(it.get("hhldCnt")))
    return max(items, key=score)


def from_title(items, name):
    """표제부(동별) → 공동주택 동들의 세대수 합. 이름이 맞는 동이 있으면 그 동들만"""
    homes = [it for it in items if "공동주택" in (it.get("mainPurpsCdNm") or "") or "아파트" in (it.get("etcPurps") or "")]
    homes = [it for it in homes if int(num(it.get("hhldCnt"))) > 0]
    if not homes: return None
    nn = norm(name)
    named = [it for it in homes if norm(it.get("bldNm")) and (norm(it.get("bldNm")) in nn or nn in norm(it.get("bldNm")))]
    use = named or homes
    hh = int(sum(num(it.get("hhldCnt")) for it in use))
    vl = max(num(it.get("vlRat")) for it in use); bc = max(num(it.get("bcRat")) for it in use)
    return [hh, round(vl, 1), round(bc, 1), len(use), "t"]


def lookup(api, sgg, bjd, jb, name):
    plat, bun, ji = jb
    items, total = api.get("getBrRecapTitleInfo", sgg, bjd, plat, bun, ji, 20)
    it = pick_recap(items, name) if total else None
    if it and int(num(it.get("hhldCnt"))) > 0:
        vl = num(it.get("vlRat"))
        if not vl and num(it.get("platArea")) > 0 and num(it.get("vlRatEstmTotArea")) > 0:     # 용적률 칸이 비었으면 (용적률 산정 연면적 ÷ 대지면적)
            vl = num(it.get("vlRatEstmTotArea")) / num(it.get("platArea")) * 100
        return [int(num(it.get("hhldCnt"))), round(vl, 1), round(num(it.get("bcRat")), 1), int(num(it.get("mainBldCnt"))), "r"]
    items, total = api.get("getBrTitleInfo", sgg, bjd, plat, bun, ji, 100)
    return from_title(items, name) if total else None


# ───────── 실행 ─────────
def main():
    t0 = time.time()
    today = dt.datetime.now(KST).date()
    regions = load(os.path.join(DATA, "regions.json"), [])
    names = (load(os.path.join(DATA, "names.json"), {}) or {}).get("r", {})
    bjd = load(os.path.join(DATA, "bjd.json"), {})
    tab, alias = bjd.get("c", {}), bjd.get("alias", {})
    state = load(STATE, {"done": {}, "mode": {}})
    done, mode = state.setdefault("done", {}), state.setdefault("mode", {})   # done: "지역|동|지번" → 받은 날짜, mode: 새 지역코드 → 통한 방식
    tier = {r[0]: r[3] if len(r) > 3 else 2 for r in regions}

    # 할 일 목록: 지번 하나에 단지키 여러 개(분양·임대 등)가 있을 수 있음 → 지번 단위로 한 번만 조회
    jobs = {}
    for code, keys in names.items():
        try: kp = load(os.path.join(DATA, "kapt", code + ".json"), {}).get("m", {})
        except AttributeError: kp = {}
        for k in keys:
            dong, jib, nm = k.split("|", 2)
            jb = split_jibun(jib)
            if not jb: continue
            jid = "%s|%s|%s" % (code, dong, jib)
            last = done.get(jid)
            if last and (today - dt.date.fromisoformat(last)).days < RECHECK_DAYS: continue
            j = jobs.setdefault(jid, {"id": jid, "code": code, "dong": dong, "jb": jb, "keys": [], "need": False})
            j["keys"].append(k)
            if not (kp.get(k) and kp[k][0]): j["need"] = True
    order = sorted(jobs.values(), key=lambda j: (not j["need"], tier.get(j["code"], 2), j["code"]))
    print("[건축물대장] 할 일 %d개 지번 (세대수 빈 단지 %d) · 이번 실행 최대 %d회 호출" % (
        len(order), sum(1 for j in order if j["need"]), MAX_CALLS))

    status = load(STATUS, {})
    stop = ""; got = nores = skipped = 0; touched = {}
    try:
        api = Api(MAX_CALLS)
    except KeyProblem as e:
        status.update({"updatedAt": dt.datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "stop": "오류: " + str(e)})
        save(STATUS, status, False); print(e); return

    def tries(code, dong):
        """(시군구코드, 법정동코드) 후보: 지역코드 그대로 → 새 구는 (새 코드 + 예전 동코드) → (예전 코드 + 예전 동코드)"""
        out = []
        if dong in tab.get(code, {}): out.append((code, tab[code][dong]))
        for old in alias.get(code, []):
            if dong in tab.get(old, {}):
                b = tab[old][dong]
                out += [(code, b), (old, b)]
        m = mode.get(code)                                        # 이 지역에서 통했던 방식을 먼저
        if m == "old": out.sort(key=lambda x: x[0] == code)
        seen, uniq = set(), []
        for x in out:
            if x not in seen: seen.add(x); uniq.append(x)
        return uniq

    try:
        for j in order:
            if (time.time() - t0) / 60 > MAX_MINUTES: stop = "시간 한도(%d분) 도달" % MAX_MINUTES; break
            code = j["code"]; cands = tries(code, j["dong"])
            if not cands: skipped += 1; done[j["id"]] = today.isoformat(); continue
            res = None
            for sgg, b in cands:
                res = lookup(api, sgg, b, j["jb"], j["keys"][0].split("|", 2)[2])
                if res:
                    if sgg != code: mode[code] = "old"
                    elif code in alias: mode[code] = "new"
                    break
            done[j["id"]] = today.isoformat()
            if not res: nores += 1; continue
            got += 1
            m = touched.setdefault(code, load(os.path.join(OUT, code + ".json"), {}).get("m", {}))
            for k in j["keys"]: m[k] = res
    except Quota as e:
        stop = "호출 한도: %s" % e
    except KeyProblem as e:
        stop = "오류(인증키): %s" % e
    except Temp as e:
        stop = "일시 오류로 중단: %s" % e

    os.makedirs(OUT, exist_ok=True)
    for code, m in touched.items():
        save(os.path.join(OUT, code + ".json"), {"asOf": today.isoformat(), "m": m})
    save(STATE, state)
    have = 0
    for f in os.listdir(OUT):
        if f.endswith(".json"): have += len(load(os.path.join(OUT, f), {}).get("m", {}))
    left = sum(1 for j in order if j["id"] not in done or done[j["id"]] != today.isoformat())
    status = {"updatedAt": dt.datetime.now(KST).strftime("%Y-%m-%d %H:%M"), "calls": api.calls, "errors": api.errors,
              "found": got, "noRecord": nores, "noCode": skipped, "left": max(0, left), "complexes": have,
              "jibunsDone": len(done), "stop": stop}
    save(STATUS, status, False)
    print("[건축물대장] 호출 %d회 · 찾음 %d · 대장 없음 %d · 동코드 없음 %d · 남은 지번 %d · 전체 %d개 단지%s" % (
        api.calls, got, nores, skipped, max(0, left), have, (" · " + stop) if stop else ""))
    if stop.startswith("오류(인증키)"): sys.exit(1)


if __name__ == "__main__":
    main()
