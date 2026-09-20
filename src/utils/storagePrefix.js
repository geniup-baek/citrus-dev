// 이 앱의 모든 localStorage 키가 공유하는 접두어. 운영(main, citrus-collab-2026)과
// 이 브랜치가 배포되는 두 번째 사이트(dev 리모트, citrus-dev-75bea)를 같은 브라우저
// (같은 origin, 예: geniup-baek.github.io)에서 동시에 열어도 로컬 상태(선택한 농장,
// 캐시된 설정 등)가 서로 덮어쓰지 않도록, 배포판마다 이 값을 다르게 둔다.
// Firebase Auth/Firestore 쪽은 프로젝트(apiKey)가 서로 달라 자동으로 분리되지만,
// 이 앱이 직접 쓰는 localStorage 키는 그런 보호가 없어 이 파일로 수동 분리한다.
//
// ⚠ main 브랜치는 'citrus'를 그대로 쓴다 — 병합/리베이스로 이 파일이 되돌아가지
// 않도록 주의(이미 배포되어 사용 중인 쪽의 로컬 데이터를 잃게 만들 수 있다).
export const LS_PREFIX = 'citrus-dev'
