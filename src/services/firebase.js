import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFirestore as getFirestoreLite } from 'firebase/firestore/lite'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseEnabled = Object.values(config).every(Boolean)

const app = firebaseEnabled ? initializeApp(config) : null
const db = app ? getFirestore(app) : null
const auth = app ? getAuth(app) : null

// 일반 firestore(db)는 실시간 리스너(onSnapshot)를 위해 영속 스트림(Write stream)을 쓴다 —
// 이 스트림에는 "한 번에 대기 가능한 쓰기 수" 자체에 내부 한도가 있어, writeBatch로 요청을
// 묶어도(=쓰기 "건수"는 줄여도) 그 스트림을 계속 같이 쓰는 한 대량 복원류 작업에서는 여전히
// "Write stream exhausted maximum allowed queued writes" 오류가 날 수 있다. firestore/lite는
// 같은 API 모양이지만 스트림이 아니라 매 요청마다 일반 HTTP 호출로 끝나므로, 실시간 구독이
// 필요 없는 대량 일괄 쓰기(백업 복원, 사진 이전 등)는 이 인스턴스를 쓴다.
// 주의: 같은 firebase app에 대해 'firestore'(전체)와 'firestore/lite'를 동시에 등록할 수
// 없어(둘 다 같은 컴포넌트 이름을 다투다 "Service firestore/lite is not available" 런타임
// 오류가 난다) — 이름이 다른 별도 앱 인스턴스를 하나 더 만들어 거기에만 lite를 붙인다.
const liteApp = firebaseEnabled ? initializeApp(config, 'bulkWriteLite') : null
const dbLite = liteApp ? getFirestoreLite(liteApp) : null
// liteApp은 별도 앱 인스턴스라 자기 자신의 로그인 세션이 없다(request.auth가 항상
// null) — 소유권 규칙이 붙는 경로(방제이력)에서 이대로면 로그인 상태여도 전부
// 거부된다. authStore가 메인 auth의 로그인 상태가 바뀔 때마다 updateCurrentUser()로
// 같은 사용자를 이 인스턴스에도 반영한다(authStore.js 참고).
const liteAuth = liteApp ? getAuth(liteApp) : null

export { db, dbLite, auth, liteAuth }
