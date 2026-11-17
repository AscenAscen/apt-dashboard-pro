#!/usr/bin/env python3
"""
인구 자료 변환 (공급 탭의 '적정 수요선' 용)

  population/ 폴더에 행정안전부 주민등록 인구통계(jumin.mois.go.kr) 에서 내려받은
  '행정기관별 주민등록 인구 및 세대현황' CSV 를 올리면 → data/population.json { 시군구코드: 인구 }

  · 가장 최근에 올린 파일 하나만 씁니다. (CSV, 한글 깨짐(cp949)도 자동 처리)
  · 첫 칸이 '서울특별시 종로구 (1111000000)' 처럼 끝에 10자리 코드가 붙은 형식을 읽습니다.
"""
import csv, glob, io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "population")
OUT = os.path.join(ROOT, "data", "population.json")


def read_text(path):
    raw = open(path, "rb").read()
    for enc in ("utf-8-sig", "cp949", "euc-kr"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def to_int(v):
    s = re.sub(r"[^\d]", "", str(v or ""))
    return int(s) if s else None


def convert(path):
    rows = list(csv.reader(io.StringIO(read_text(path))))
    if not rows:
        raise ValueError("빈 파일입니다.")
    head = rows[0]
    pc = next((i for i, h in enumerate(head) if "총인구수" in h or "총 인구수" in h), None)
    hc = next((i for i, h in enumerate(head) if h.endswith("세대수") and "인구" not in h), None)
    if pc is None:
        raise ValueError("'총인구수' 칸을 찾지 못했습니다. 칸 이름: %s" % head[:6])
    m = re.search(r"(\d{4})년\s*(\d{1,2})월", head[pc])
    ym = int(m.group(1)) * 100 + int(m.group(2)) if m else None
    pop, hh = {}, {}
    for r in rows[1:]:
        if len(r) <= pc:
            continue
        mc = re.search(r"\((\d{10})\)", r[0])
        if not mc:
            continue
        code = mc.group(1)
        if code[5:] != "00000" or code[2:5] == "000":      # 시군구 단위만 (시도·읍면동 줄은 건너뜀)
            continue
        n = to_int(r[pc])
        if n:
            pop[code[:5]] = n
            if hc is not None and len(r) > hc:
                h = to_int(r[hc])
                if h:
                    hh[code[:5]] = h
    if not pop:
        raise ValueError("시군구 인구 줄을 찾지 못했습니다. (시군구 단위로 내려받았는지 확인하세요)")
    return {"ym": ym, "file": os.path.basename(path), "pop": pop, "hh": hh}


def main():
    files = sorted(glob.glob(os.path.join(SRC, "*.csv")), key=os.path.getmtime)
    if not files:
        print("population/ 폴더에 CSV 가 없습니다. (적정 수요선 없이 진행)")
        return 0
    try:
        out = convert(files[-1])
    except Exception as e:
        print("인구 CSV 변환 실패:", e)
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        json.dump({"error": str(e), "file": os.path.basename(files[-1])}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
        return 0
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("인구 변환: %s · %d개 시군구 · 기준 %s" % (out["file"], len(out["pop"]), out["ym"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
