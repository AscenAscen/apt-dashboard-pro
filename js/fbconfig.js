/* ─────────────────────────────────────────────────────────
   fbconfig.js — Google 로그인 동기화(Firebase) 설정값
   · Firebase 콘솔에서 만든 "웹 앱"의 설정값 4개를 아래 따옴표 안에 붙여 넣으세요.
     (안내: 프로젝트 설정 → 일반 → 내 앱 → SDK 설정 및 구성 → 구성)
   · 이 값들은 비밀번호가 아니라 "주소" 같은 값이라 공개 저장소에 올려도 괜찮습니다.
     내 기록은 Firestore 보안 규칙(내 계정만 읽고 쓰기)으로 지켜집니다.
   · 비워 두면 Google 로그인 동기화 단추가 "설정 필요"로 보이고, 예전 GitHub 방식은 그대로 쓸 수 있습니다.
   ───────────────────────────────────────────────────────── */
window.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBXHxMFdJier5BoocDLfgR7cDTBQkNm_Zk',
  authDomain: 'apt-dashboard-pro.firebaseapp.com',     // 비워 두면 projectId 로 자동 계산 (프로젝트아이디.firebaseapp.com)
  projectId: 'apt-dashboard-pro',
  appId: '1:405314521959:web:18be08542d2da5cdccfdc2',
};
