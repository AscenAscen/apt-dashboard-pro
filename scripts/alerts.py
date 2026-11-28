#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
등록 단지 새 실거래 → 텔레그램 알림
=================================================
GitHub Actions(.github/workflows/alerts.yml)가 실거래 자동 수집이 끝날 때마다 실행합니다. (직접 실행할 필요 없음)

하는 일
  1) Firebase(Firestore)에서 [알림] 탭에 등록한 단지 목록을 읽음   users/{계정}/autosync/alerts
  2) 단지마다 data/sale · data/rent 의 최근 거래(계약일 기준 최근 120일)를 읽어, 지난번 확인 때 없던 거래를 찾음
  3) 새 거래가 있으면 텔레그램 봇으로 보냄 (처음 등록한 단지는 "등록 확인" 메시지 한 번 → 그다음 새 거래부터)
  4) 확인한 결과를 Firestore 에 남김   users/{계정}/autosync/alertstate  ([알림] 탭이 읽어서 보여 줌)

필요한 GitHub Secrets (저장소 Settings → Secrets and variables → Actions)
  TELEGRAM_BOT_TOKEN        텔레그램 봇 토큰
  TELEGRAM_CHAT_ID          내 chat ID
  FIREBASE_SERVICE_ACCOUNT  Firebase 서비스 계정 키(JSON 파일 내용 전체)

안전장치
  - 같은 거래를 두 번 알리지 않음 (거래마다 "알린 개수"를 기록해 둠)
  - 텔레그램 보내기에 실패한 단지는 기록을 갱신하지 않아서 다음 실행 때 다시 시도
  - 알림을 꺼 둔 동안의 거래는 켤 때 한꺼번에 알리지 않고 조용히 넘어감
  - 이상하게 많은 거래(한 번에 30건 초과)가 잡히면 최근 일부만 보여 주고 건수만 알려 줌
  - 비밀 값(토큰·키)은 로그에 찍지 않음

사용:  python scripts/alerts.py            실제 발송
       python scripts/alerts.py --dry-run  텔레그램으로 보내지 않고 화면에만 출력 (Firestore 에는 쓰지 않음)
"""
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
KST = dt.timezone(dt.timedelta(hours=9))

WINDOW_DAYS = 120        # 이 기간 안에 계약된 거래만 봄 (신고는 계약 후 최대 30일 안에 이뤄짐)
MAX_NEW_SHOWN = 12       # 한 단지·한 종류에서 자세히 보여 줄 최대 거래 수
MAX_NEW_BULK = 30        # 이보다 많이 잡히면 이상 상황으로 보고 건수만 알림
MAX_LOG = 50             # 보낸 알림 기록 보관 수
TG_LIMIT = 3800          # 텔레그램 글자 수 제한(4096)보다 조금 작게
KIND_NAME = {"sale": "매매", "rent": "전세"}


# ───────────────────────── 표시 형식 ─────────────────────────
def won(m):
    """만원 → '12억 3,000만'"""
    eok, rest = divmod(int(m), 10000)
    if eok and rest:
        return f"{eok}억 {rest:,}만"
    if eok:
        return f"{eok}억"
    return f"{rest:,}만"


def area_text(area):
    direct = str(area).endswith("d")
    try:
        a = float(str(area).rstrip("d"))
    except ValueError:
        return str(area)
    py = round(a * 1.33 / 3.3058)       # 화면(js/config.js)의 평형 계산과 같은 식
    return f"{a:g}㎡({py}평)" + (" 직거래" if direct else "")


def trade_line(kind, e):
    d = e["date"]
    return f"[{KIND_NAME[kind]}] {area_text(e['area'])} · {e['floor']}층 · {d.month}/{d.day} 계약 · {won(e['price'])}"


# ───────────────────────── 실거래 읽기 ─────────────────────────
_file_cache = {}


def load_year(kind, code, year):
    path = os.path.join(DATA, kind, code, f"{year}.json")
    if path not in _file_cache:
        try:
            with open(path, encoding="utf-8") as f:
                _file_cache[path] = json.load(f)
        except (OSError, ValueError):
            _file_cache[path] = {}
    return _file_cache[path]


def recent_trades(kind, code, key, today):
    """{거래키: {n, date, area, floor, price}} — 계약일이 최근 WINDOW_DAYS 일 이내인 거래.
    같은 날·층·가격·평형이 여러 건이면 n 에 개수를 셈."""
    out = {}
    for y in (today.year, today.year - 1):
        areas = load_year(kind, code, y).get(key) or {}
        for area, arr in areas.items():
            for i in range(0, len(arr) - 2, 3):
                md, floor, price = arr[i], arr[i + 1], arr[i + 2]
                try:
                    day = dt.date(y, md // 100, md % 100)
                except (ValueError, TypeError):
                    continue
                if (today - day).days > WINDOW_DAYS or day > today + dt.timedelta(days=1):
                    continue
                k = f"{day:%Y%m%d}|{area}|{floor}|{price}"
                ent = out.get(k)
                if ent is None:
                    out[k] = {"n": 1, "date": day, "area": area, "floor": floor, "price": price}
                else:
                    ent["n"] += 1
    return out


# ───────────────────────── 핵심: 새 거래 찾기 ─────────────────────────
def process(doc, state, today, send, log_time):
    """
    doc    : [알림] 탭에서 저장한 목록 {on, items:[{id, code, key, name, sgg, dong, sale, rent}]}
    state  : 지난번 확인 결과 {c: {"단지id|종류": {"t": {거래키: 개수}}}, log: [...]}  (이 함수가 고쳐서 돌려줌)
    send   : 텔레그램 보내기 함수 send(text) → True/False
    반환   : (state, 보낸 메시지 수, 실패 수)
    """
    on = bool(doc.get("on", 1))
    items = [it for it in doc.get("items", []) if it.get("code") and it.get("key")]
    c = state.setdefault("c", {})
    log = state.setdefault("log", [])
    last = state.setdefault("last", {})
    watched_ids, keep, seen = [], set(), set()
    sent = failed = 0
    welcome = []                                  # 처음 등록돼 기준만 잡은 단지
    cutoff = (today - dt.timedelta(days=WINDOW_DAYS + 2)).strftime("%Y%m%d")

    for it in items:
        iid = f"{it['code']}|{it['key']}"
        if iid in seen or not (it.get("sale") or it.get("rent")):     # 같은 단지 중복, 매매·전세 둘 다 꺼진 단지는 건너뜀
            continue
        seen.add(iid)
        head = f"🏢 {it.get('name', '')}  ({it.get('sgg', '')} {it.get('dong', '')})".replace("( ", "(")
        lines, summary, commits, newly = [], [], [], []
        for kind in ("sale", "rent"):
            if not it.get(kind):
                continue
            sid = f"{iid}|{kind}"
            keep.add(sid)
            cur = recent_trades(kind, it["code"], it["key"], today)
            st = c.get(sid)
            if st is None:                                         # 처음 보는 단지·종류 → 기준만 잡음 (알리지 않음)
                c[sid] = {"t": {k: e["n"] for k, e in cur.items()}}
                newest = sorted(cur.values(), key=lambda e: e["date"], reverse=True)[:1]
                newly.append((kind, newest))
                continue
            prev = st.get("t", {})
            new = []
            for k, e in cur.items():
                extra = e["n"] - prev.get(k, 0)
                if extra > 0:
                    new.append((e, extra))
            commits.append((sid, cur))
            if not new:
                continue
            new.sort(key=lambda x: x[0]["date"], reverse=True)
            total = sum(x[1] for x in new)
            summary.append(f"{KIND_NAME[kind]} {total}건")
            if total > MAX_NEW_BULK:
                lines.append(f"[{KIND_NAME[kind]}] 한꺼번에 {total}건이 신고됐어요.")
            shown = 0
            for e, extra in new:                                   # 똑같은 거래(같은 날·층·가격)가 여러 건이면 한 줄에 "×N건"
                if shown >= MAX_NEW_SHOWN:
                    break
                lines.append(trade_line(kind, e) + (f" ×{extra}건" if extra > 1 else "")); shown += 1
            if len(new) > shown:
                lines.append(f"… 외 {sum(x[1] for x in new[shown:])}건")
        watched_ids.append(iid)

        if newly:
            welcome.append((head, newly))

        if lines:
            text = "🔔 새 실거래 신고\n" + head + "\n" + "\n".join(lines)
            ok = True
            if on:
                ok = send(text)
                if ok:
                    sent += 1
                else:
                    failed += 1
            if ok:
                if on:
                    log.append({"at": log_time, "id": iid, "name": it.get("name", ""), "text": " · ".join(summary)})
                    last[iid] = log_time
                for sid, cur in commits:
                    commit(c, sid, cur)
        else:
            for sid, cur in commits:                                # 새 거래가 없어도 기록은 맞춰 둠
                commit(c, sid, cur)

    # 처음 등록한 단지 확인 메시지
    if welcome and on:
        parts = ["✅ 알림 등록 확인", "아래 단지는 앞으로 새 실거래가 신고되면 알려 드려요."]
        for head, newly in welcome:
            parts.append("")
            parts.append(head)
            for kind, newest in newly:
                if newest:
                    parts.append("  최근 " + trade_line(kind, newest[0]))
                else:
                    parts.append(f"  [{KIND_NAME[kind]}] 최근 {WINDOW_DAYS}일 안 거래 없음")
        for chunk in split_text("\n".join(parts)):
            if send(chunk):
                sent += 1
            else:
                failed += 1
    # 등록 확인 실패 시 기준을 되돌려 다음에 다시 안내할 수도 있으나, 거래 알림이 아니므로 그대로 둠

    # 정리: 목록에서 지웠거나 끈 알림의 기록 삭제, 오래된 거래키 삭제
    for sid in list(c.keys()):
        if sid not in keep:
            del c[sid]
            continue
        t = c[sid].get("t", {})
        for k in [k for k in t if k[:8] < cutoff]:
            del t[k]
    for iid in list(last.keys()):
        if iid not in watched_ids:
            del last[iid]
    del log[:-MAX_LOG]
    state["w"] = watched_ids
    return state, sent, failed


def commit(c, sid, cur):
    """지금 보이는 거래를 '알린 것'으로 기록 (한 번 본 거래는 줄지 않음 → 사라졌다 다시 나타나도 두 번 알리지 않음)"""
    t = c.setdefault(sid, {"t": {}}).setdefault("t", {})
    for k, e in cur.items():
        t[k] = max(t.get(k, 0), e["n"])


def split_text(text, limit=TG_LIMIT):
    out, buf = [], ""
    for line in text.split("\n"):
        if buf and len(buf) + len(line) + 1 > limit:
            out.append(buf); buf = line
        else:
            buf = f"{buf}\n{line}" if buf else line
    if buf:
        out.append(buf)
    return out


# ───────────────────────── 텔레그램 ─────────────────────────
def make_sender(token, chat_id, dry):
    def send(text):
        if dry:
            print("─── [미리보기: 텔레그램으로 보낼 내용] ───")
            print(text)
            print("────────────────────────────")
            return True
        for chunk in split_text(text):
            body = urllib.parse.urlencode({"chat_id": chat_id, "text": chunk, "disable_web_page_preview": "true"}).encode()
            req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=body)
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    r.read()
            except urllib.error.HTTPError as e:                       # 주소에 토큰이 들어 있으므로 오류 내용만 찍음
                try:
                    desc = json.loads(e.read().decode("utf-8", "ignore")).get("description", "")
                except Exception:
                    desc = ""
                print(f"텔레그램 보내기 실패: HTTP {e.code} {desc}")
                return False
            except Exception as e:
                print(f"텔레그램 보내기 실패: {type(e).__name__}")
                return False
            time.sleep(0.4)
        return True
    return send


# ───────────────────────── Firestore (REST) ─────────────────────────
class Fs:
    def __init__(self, info):
        from google.oauth2 import service_account
        from google.auth.transport.requests import AuthorizedSession
        cred = service_account.Credentials.from_service_account_info(info, scopes=["https://www.googleapis.com/auth/datastore"])
        self.s = AuthorizedSession(cred)
        self.base = f"https://firestore.googleapis.com/v1/projects/{info['project_id']}/databases/(default)/documents"

    def uids(self):
        out, token = [], None
        while True:
            params = {"showMissing": "true", "pageSize": "300"}
            if token:
                params["pageToken"] = token
            r = self.s.get(f"{self.base}/users", params=params, timeout=30)
            if r.status_code == 404:
                return out
            r.raise_for_status()
            j = r.json()
            out += [d["name"].rsplit("/", 1)[1] for d in j.get("documents", [])]
            token = j.get("nextPageToken")
            if not token:
                return out

    def get(self, uid, name, field):
        r = self.s.get(f"{self.base}/users/{uid}/autosync/{name}", timeout=30)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        v = (r.json().get("fields") or {}).get(field, {}).get("stringValue")
        return json.loads(v) if v else None

    def put(self, uid, name, values):
        params = [("updateMask.fieldPaths", k) for k in values]
        body = {"fields": {k: {"stringValue": v} for k, v in values.items()}}
        r = self.s.patch(f"{self.base}/users/{uid}/autosync/{name}", params=params, json=body, timeout=30)
        r.raise_for_status()


# ───────────────────────── 실행 ─────────────────────────
def main():
    dry = "--dry-run" in sys.argv
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    sa = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "").strip()
    if not dry and (not token or not chat):
        print("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 가 비어 있습니다. GitHub Secrets 를 확인하세요.")
        return 1
    if not sa:
        print("FIREBASE_SERVICE_ACCOUNT 가 비어 있습니다. Firebase 서비스 계정 키(JSON)를 GitHub Secrets 에 넣어 주세요.")
        return 1
    try:
        info = json.loads(sa)
        fs = Fs(info)
    except Exception as e:
        print(f"FIREBASE_SERVICE_ACCOUNT 를 읽지 못했습니다 ({type(e).__name__}). JSON 파일 내용 전체를 그대로 붙여 넣었는지 확인하세요.")
        return 1

    now = dt.datetime.now(KST)
    today = now.date()
    stamp = now.strftime("%m-%d %H:%M")
    send = make_sender(token, chat, dry)
    try:
        uids = fs.uids()
    except Exception as e:
        print(f"Firestore 에 접속하지 못했습니다 ({type(e).__name__}: {e}). 서비스 계정 키와 Firestore 가 만들어져 있는지 확인하세요.")
        return 1

    total_sent = total_fail = users = 0
    for uid in uids:
        doc = fs.get(uid, "alerts", "json")
        if not doc:
            continue
        users += 1
        state = fs.get(uid, "alertstate", "json") or {}
        state, sent, failed = process(doc, state, today, send, stamp)
        total_sent += sent
        total_fail += failed
        print(f"계정 {users}: 등록 {len(doc.get('items', []))}개 · 보낸 메시지 {sent}건 · 실패 {failed}건" + ("" if doc.get("on", 1) else " · 알림 꺼짐(조용히 기록만)"))
        if dry:
            continue
        pub = {"v": 1, "lastRun": now.strftime("%Y-%m-%d %H:%M"), "w": state.get("w", []), "last": state.get("last", {}),
               "log": state.get("log", [])[-30:], "tg": "ok" if not failed else "fail"}
        body = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
        if len(body.encode("utf-8")) > 950000:
            print("경고: 기록이 너무 커서 오래된 거래 기록을 줄입니다.")
            for v in state.get("c", {}).values():
                t = v.get("t", {})
                for k in sorted(t)[: len(t) // 2]:
                    del t[k]
            body = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
        fs.put(uid, "alertstate", {"json": body, "pub": json.dumps(pub, ensure_ascii=False, separators=(",", ":"))})
    if not users:
        print("등록된 알림 목록이 없습니다. (대시보드 [알림] 탭에서 단지를 등록하세요)")
    print(f"끝: 보낸 메시지 {total_sent}건, 실패 {total_fail}건")
    return 1 if total_fail else 0


if __name__ == "__main__":
    sys.exit(main())
