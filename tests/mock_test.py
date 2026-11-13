#!/usr/bin/env python3
"""
수집기 모의 시험 — 실제 국토부 API 대신 가짜 응답으로 collect.py 를 돌려 봅니다.
사용:  python tests/mock_test.py [결과를 쓸 폴더]
(실제 data 폴더는 건드리지 않습니다)
"""
import os, random, re, sys, tempfile, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
os.environ["MOLIT_API_KEY"] = "TEST+KEY/abc=="
os.environ.setdefault("MAX_CALLS_PER_API", "400")
import collect  # noqa: E402

out = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()
root = os.path.join(out, "repo")
os.makedirs(os.path.join(root, "config"), exist_ok=True)
with open(os.path.join(root, "config", "regions.csv"), "w", encoding="utf-8") as f:
    f.write("code,sido,sigungu,tier\n41173,경기도,안양시 동안구,1\n11110,서울특별시,종로구,1\n47130,경상북도,경주시,2\n")
collect.ROOT, collect.DATA = root, os.path.join(root, "data")
collect.DELAY_SEC = 0
collect.time.sleep = lambda s: None

APTS = [("평촌동", "932-6", "꿈마을라이프", 1992, 84.99, 95000), ("평촌동", "898", "향촌롯데", 1993, 59.76, 82000),
        ("호계동", "1052", "목련두산", 1992, 131.4, 150000), ("비산동", "1185", "평촌래미안푸르지오", 2021, 84.98, 125000)]
state = {"fail": 0, "n": 0}


def fake(url):
    state["n"] += 1
    q = dict(p.split("=") for p in url.split("?")[1].split("&"))
    assert q["serviceKey"] == "TEST%2BKEY%2Fabc%3D%3D", q["serviceKey"]
    if state["fail"] > 0:
        state["fail"] -= 1
        raise TimeoutError("모의 타임아웃")
    ym, page, rent = int(q["DEAL_YMD"]), int(q["pageNo"]), "AptRent" in url
    rnd = random.Random(q["LAWD_CD"] + q["DEAL_YMD"] + str(rent))
    if q["LAWD_CD"] == "47130":
        return "<response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items/><totalCount>0</totalCount></body></response>"
    y, m = divmod(ym, 100)
    trend = 1 + 0.5 * max(0, 1 - abs((y + m / 12) - 2021.8) / 2) - (0.25 if y >= 2023 else 0) + (y - 2020) * 0.03
    items = []
    total = 1203 if (ym == 202106 and not rent) else rnd.randint(3, 9)   # 2021-06 은 페이지 2장 시험
    for i in range(total):
        dong, jibun, name, by, area, base = APTS[rnd.randrange(len(APTS))]
        price = int(base * trend * rnd.uniform(0.95, 1.05) / 100) * 100
        common = "<aptNm>%s</aptNm><umdNm>%s</umdNm><jibun>%s</jibun><buildYear>%d</buildYear><excluUseAr>%s</excluUseAr><floor>%d</floor><dealYear>%d</dealYear><dealMonth>%d</dealMonth><dealDay>%d</dealDay>" % (
            name, dong, jibun, by, area, rnd.randint(1, 20), y, m, rnd.randint(1, 28))
        if rent:
            items.append("<item>%s<deposit>%s</deposit><monthlyRent>%d</monthlyRent></item>" % (common, format(int(price * 0.55), ","), 0 if i % 3 else 50))
        else:
            items.append("<item>%s<dealAmount> %s</dealAmount><cdealType>%s</cdealType><dealingGbn>%s</dealingGbn></item>" % (
                common, format(price if i % 7 else int(price * 0.7), ","), "O" if i % 11 == 10 else " ", "직거래" if i % 7 == 0 else "중개거래"))
    part = items[(page - 1) * 1000: page * 1000]
    return "<response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items>%s</items><numOfRows>1000</numOfRows><pageNo>%d</pageNo><totalCount>%d</totalCount></body></response>" % ("".join(part), page, total)


collect._http_get = fake

print("① 첫 실행(한도 400회) →", collect.run())
s1 = collect.read_json(os.path.join(collect.DATA, "state.json"), {})
assert s1["ptr"]["sale"]["41173"] < 202611, s1
print("② 일시 오류 3번 뒤 복구 →", end=" "); state["fail"] = 3; print(collect.run())
collect.MAX_CALLS_PER_API = 3000
print("③ 이어받기(한도 3000회) →", collect.run())
collect.MAX_CALLS_PER_API = 100000
print("④ 끝까지 →", collect.run())
s = collect.read_json(os.path.join(collect.DATA, "state.json"), {})
assert s["ptr"]["sale"] == {"41173": 200601, "11110": 200601, "47130": 200601}, s["ptr"]["sale"]
assert s["ptr"]["rent"]["41173"] == 201101
y = collect.read_json(collect.year_path("sale", "41173", 2021), {})
n6 = collect.count_month(y, 6)
assert 1000 < n6 < 1203, n6          # 2페이지 모두 받고, 해제거래는 빠짐
assert any(k.endswith("d") for a in y.values() for k in a), "직거래 표시 없음"
r = collect.read_json(collect.year_path("rent", "41173", 2021), {})
assert r and all(not k.endswith("d") for a in r.values() for k in a)
before = open(collect.year_path("sale", "41173", 2026), encoding="utf-8").read()

# ⑤ 장애 상황: 계속 실패 → 중단, 데이터 유지
st = collect.read_json(os.path.join(collect.DATA, "state.json"), {}); st["lastUpdate"] = ""; collect.write_json(os.path.join(collect.DATA, "state.json"), st)
state["fail"] = 10 ** 6; collect.MAX_CONSECUTIVE_FAIL = 3
print("⑤ API 장애 →", collect.run())
state["fail"] = 0
assert open(collect.year_path("sale", "41173", 2026), encoding="utf-8").read() == before
status = collect.read_json(os.path.join(collect.DATA, "status.json"), {})
assert "연속" in status["lastRun"]["stop"], status["lastRun"]

# ⑥ 한도 초과 응답 / 인증키 오류 응답
for body, exc in (("<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</returnAuthMsg><returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>", collect.QuotaExceeded),
                  ("<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>", collect.KeyProblem),
                  ("<html>502 Bad Gateway</html", collect.TempError)):
    try:
        collect._parse(body); raise SystemExit("예외가 나야 함")
    except exc:
        pass
print("⑥ 오류 응답 분류 정상")
print("status:", {k: v for k, v in status["progress"].items()}, "| 빈 지역:", status["emptyRegions"])
print("모든 시험 통과. 결과 폴더:", root)
