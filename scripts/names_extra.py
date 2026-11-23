#!/usr/bin/env python3
"""실거래가 아직 없는 단지 목록 → data/names_extra.json  (검색·홈 지도·단지 지도에 함께 보이도록)

전국 단지 목록(data/names.json)은 실거래가 한 번이라도 있는 단지로만 만들어집니다.
그래서 막 입주했거나 입주 전인 신축, 거래가 거의 없는 단지는 검색·지도에 안 보였습니다. 이 파일이 그 빈 곳을 채웁니다.

  1) K-apt 단지 엑셀(kapt/ 폴더)에서 실거래 단지와 짝이 안 지어진 단지
       · 같은 동·같은 지번에 실거래 단지가 이미 있으면 뺌 (이름만 다른 같은 단지일 가능성이 큼)
  2) 청약홈 분양 공고(data/supply.json) 중 최근 2년 안에 입주했거나 입주 예정인 단지
       · 같은 시군구에 이름이 같은(띄어쓰기·'아파트'·괄호 무시) 실거래 단지가 있으면 뺌
  · 임대·사택·관사·기숙사는 뺍니다 (사고팔 수 없는 단지)
  · 실거래가 생겨 names.json 에 들어오면 다음 실행 때 자동으로 빠집니다.

결과: { asOf, n, r: { 지역코드: { 단지키: [세대수, 연식 또는 입주연월(YYYYMM), 출처, 주소] } } }
      출처: 'k' = K-apt (세대수=전체) · 's' = 청약홈 + K-apt 세대수 · 's1' = 청약홈만 (세대수=일반분양 세대수라 실제보다 적음)
      단지키 = "동|지번|단지명" (names.json 과 같은 모양, 청약홈 단지는 지번이 비어 있을 수 있음)
사용법: python scripts/names_extra.py   (매일 건축물대장 수집 때 함께 실행)
"""
import datetime as dt
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kapt_file as KF  # noqa: E402  (엑셀 읽기·주소 풀기·이름 다듬기를 그대로 씀)

SKIP = re.compile(r"임대|사택|관사|기숙사|합숙소")
KST = dt.timezone(dt.timedelta(hours=9))


def load(p, fb):
    try:
        with open(p, encoding="utf-8") as f: return json.load(f)
    except (OSError, ValueError): return fb


def main():
    regions = load(os.path.join(DATA, "regions.json"), [])
    names = (load(os.path.join(DATA, "names.json"), {}) or {}).get("r", {})
    if not names: print("names.json 이 없어 건너뜁니다."); return
    rmap = {}
    for code, sido, sgg, *_ in regions:
        for k in KF.sgg_keys(sgg): rmap.setdefault((KF.sido_key(sido), k), code)
    have_key = {c: set(ks) for c, ks in names.items()}
    have_jib = {c: {tuple(k.split("|")[:2]) for k in ks} for c, ks in names.items()}       # (동, 지번)
    have_nm = {c: {KF.base(k.split("|", 2)[2]) for k in ks} for c, ks in names.items()}   # 다듬은 이름
    out, stat = {}, {"k": 0, "s": 0, "skipK": 0, "skipS": 0}

    def code_of(sido, sgg):
        for sk in KF.sido_keys(sido):
            for k in KF.kapt_sgg_keys(sgg) + KF.NEW_GU.get((sk, re.sub(r"\s", "", str(sgg or ""))), []):
                c = rmap.get((sk, k))
                if c: return c
        return None

    def add(code, key, val, src):
        nm = key.split("|", 2)[2]
        if key in have_key.get(code, ()) or KF.base(nm) in have_nm.get(code, ()):
            stat["skip" + src.upper()] += 1; return
        out.setdefault(code, {})[key] = val; stat[src] += 1
        have_nm.setdefault(code, set()).add(KF.base(nm))                # K-apt·청약홈에 같은 단지가 둘 다 있으면 한 번만

    kj, kn = {}, {}                                                 # K-apt 세대수: (지역, 동, 지번) · (지역, 다듬은 이름) → 세대수 (청약홈 단지에 씀)
    # 1) K-apt
    files = sorted(glob.glob(os.path.join(ROOT, "kapt", "*.xlsx")), key=os.path.getmtime)
    if files:
        for r in KF.read_rows(files[-1]):
            if SKIP.search(r["name"] or ""): continue
            p = KF.parse_addr(r["addr"].split(",")[0]) if r["addr"] else None
            dong = (r["emd"] + " " + r["ri"]).strip() if r["emd"] and r["ri"] else (r["ri"] or r["emd"] or (p[2] if p else ""))
            jib = p[3] if p else ""
            code = code_of(r["sido"], r["sgg"] or (p[1] if p else ""))
            if not code or not dong: continue
            if r["hh"]: kj[(code, dong, jib)] = r["hh"]; kn[(code, KF.base(r["name"]))] = r["hh"]
            if jib and (dong, jib) in have_jib.get(code, ()):            # 같은 필지에 실거래 단지가 있음 → 같은 단지로 봄
                stat["skipK"] += 1; continue
            name = re.sub(r"\s+", "", r["name"]).replace("아파트", "") or r["name"]
            add(code, "%s|%s|%s" % (dong, jib, name), [r["hh"] or 0, r.get("year") or 0, "k", (r["addr"] or "").split(",")[0].strip()], "k")
    else:
        print("kapt/ 폴더에 엑셀이 없어 K-apt 부분은 건너뜁니다.")

    # 2) 청약홈 (최근 2년 입주 ~ 입주 예정)
    sup = (load(os.path.join(DATA, "supply.json"), {}) or {}).get("items", [])
    now = dt.datetime.now(KST); cut = (now.year - 2) * 100 + now.month
    for it in sup:
        nm, mv = str(it.get("nm") or "").strip(), int(it.get("mv") or 0)
        if not nm or mv < cut or SKIP.search(nm) or (it.get("ty") or "APT") != "APT": continue
        code = it.get("c") if it.get("c") in names or any(r[0] == it.get("c") for r in regions) else code_of(it.get("sd"), it.get("sg"))
        if not code: continue
        ad = str(it.get("ad") or "")
        m = re.search(r"\(([^()]*?(동|가|리))\)", ad)                    # 도로명 주소 끝의 (지묘동)
        dong = it.get("dg") or (m.group(1) if m else "")
        jm = re.search(r"(?:동|가|리)\s+(산?\d+(?:-\d+)?)", ad)
        name = re.sub(r"\s+", "", nm); jib = jm.group(1) if jm else ""
        hh = kj.get((code, dong, jib)) or kn.get((code, KF.base(nm))) or 0      # 입주한 단지는 K-apt 의 전체 세대수
        add(code, "%s|%s|%s" % (dong, jib, name), [hh or int(it.get("hh") or 0), mv, "s" if hh else "s1", ad], "s")

    n = sum(len(v) for v in out.values())
    res = {"asOf": now.strftime("%Y-%m-%d"), "n": n, "r": out}
    tmp = os.path.join(DATA, "names_extra.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f: json.dump(res, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, os.path.join(DATA, "names_extra.json"))
    print("[실거래 없는 단지] %d곳 추가 (K-apt %d · 청약홈 %d) · 이미 있어서 뺀 것 K-apt %d · 청약홈 %d" % (
        n, stat["k"], stat["s"], stat["skipK"], stat["skipS"]))


if __name__ == "__main__":
    main()
