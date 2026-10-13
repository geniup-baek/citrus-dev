import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateCurrentUser,
  updatePassword,
  updateProfile,
} from 'firebase/auth'
import { doc, getDoc, setDoc, terminate } from 'firebase/firestore'
import { auth, db, firebaseEnabled, liteAuth } from '../services/firebase.js'
import { LS_PREFIX } from '../utils/storagePrefix.js'

const DOC_COLLECTION = 'users'
// farmsStore.js가 쓰는 것과 같은 키(순환 참조를 피하려고 여기서 상수만 다시 씀) —
// 로그아웃 시 "마지막으로 쓰던 농장" 기억을 지워서, 로그아웃하기 전까지만 유지된다는
// 요구사항을 지키고 다음에 다른 계정으로 로그인했을 때 남의 농장 선택이 남지 않게 한다.
const LS_ACTIVE = `${LS_PREFIX}:active-farm`
const LS_MODE = `${LS_PREFIX}:app-mode`

const ERROR_MESSAGES = {
  'auth/email-already-in-use': '이미 가입된 이메일입니다. 로그인하거나, 비밀번호를 모르면 "비밀번호를 잊으셨나요?"로 재설정하세요.',
  'auth/invalid-email': '이메일 형식이 올바르지 않습니다.',
  'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
  'auth/wrong-password': '이메일 또는 비밀번호가 올바르지 않습니다.',
  'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.',
  'auth/user-not-found': '이메일 또는 비밀번호가 올바르지 않습니다.',
  'auth/email-not-invited': '초대받은 이메일만 가입할 수 있습니다. 슈퍼관리자나 농장주에게 이 이메일로 초대를 요청하세요.',
  'auth/too-many-requests': '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
}

function messageFor(err) {
  return ERROR_MESSAGES[err?.code] || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
}

// role·disabled는 여기서 절대 쓰지 않는다 — role은 콘솔에서 수동으로만, disabled는
// 슈퍼관리자가 사용자 관리 화면에서만 바꾼다(firestore.rules의 users/{uid} update
// 규칙도 이 둘이 그대로 유지될 때만 본인 쓰기를 허용한다).
// 반환값({ role, disabled })으로 isSuperAdmin 판단과 비활성화 계정 차단에 쓴다.
async function ensureUserDoc(fbUser) {
  if (!db) return null
  const ref = doc(db, DOC_COLLECTION, fbUser.uid)
  const snap = await getDoc(ref)
  const profile = { email: fbUser.email || '', displayName: fbUser.displayName || '' }
  if (snap.exists()) {
    await setDoc(ref, profile, { merge: true })
    return { role: snap.data()?.role || null, disabled: snap.data()?.disabled === true }
  }
  await setDoc(ref, { ...profile, createdAt: new Date().toISOString() })
  return { role: null, disabled: false }
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null) // { uid, email, displayName } | null
  const role = ref(null)
  // 슈퍼관리자가 비활성화한 계정 — 로그인은 되지만 앱은 쓸 수 없다(App.vue가 차단 화면을
  // 띄우고, firestore.rules의 isDisabled()가 서버에서도 접근을 막는다).
  const isDisabled = ref(false)
  const loading = ref(true)
  const error = ref('')
  let initialized = false

  const isLoggedIn = computed(() => !!user.value)
  const isSuperAdmin = computed(() => isLoggedIn.value && role.value === 'super_admin')
  // 이메일 인증이 안 끝난 계정은 앱을 못 쓴다(App.vue가 인증 안내 화면을 띄운다) — 이메일로
  // 초대·소유권을 인정하는 규칙들이 인증된 이메일만 받기 때문이다. 슈퍼관리자(콘솔에서 만든
  // 계정)는 인증 메일 절차 없이 쓴다.
  const needsEmailVerification = computed(() =>
    isLoggedIn.value && !user.value.emailVerified && !isSuperAdmin.value)

  // liteAuth(dbLite가 쓰는 별도 앱 인스턴스)는 자기 세션이 없다 — 메인 로그인 상태를
  // 그대로 복사해 붙인다. firebase.js의 liteAuth 주석 참고.
  async function syncLiteAuth(fbUser) {
    if (!liteAuth) return
    try {
      await updateCurrentUser(liteAuth, fbUser || null)
    } catch (e) {
      console.warn('[authStore] liteAuth 동기화 실패', e)
    }
  }

  function init() {
    if (initialized) return
    initialized = true
    if (!firebaseEnabled || !auth) {
      loading.value = false
      return
    }
    onAuthStateChanged(auth, async (fbUser) => {
      await syncLiteAuth(fbUser)
      if (fbUser) {
        user.value = { uid: fbUser.uid, email: fbUser.email, displayName: fbUser.displayName, emailVerified: fbUser.emailVerified }
        try {
          const profile = await ensureUserDoc(fbUser)
          role.value = profile?.role ?? null
          isDisabled.value = !!profile?.disabled
        } catch (e) {
          console.warn('[authStore] users 문서 갱신 실패', e)
          role.value = null
          isDisabled.value = false
        }
      } else {
        user.value = null
        role.value = null
        isDisabled.value = false
      }
      loading.value = false
    })
  }

  // 가입은 슈퍼관리자·농장주가 미리 등록한 이메일(signupAllowed/{email})만 허용한다. 이건 가입
  // 화면의 1차 차단(UX)일 뿐 — 클라이언트만으로는 Firebase Auth 가입 자체를 막을 수 없어서
  // 우회해 만든 계정도 있을 수 있지만, 그런 계정은 초대·소유권이 없어 아무 데이터도 못 본다.
  async function signUp(email, password, displayName) {
    error.value = ''
    try {
      const normalized = email.trim().toLowerCase()
      const allowed = await getDoc(doc(db, 'signupAllowed', normalized)).then((s) => s.exists()).catch(() => false)
      if (!allowed) {
        error.value = ERROR_MESSAGES['auth/email-not-invited']
        return false
      }
      const cred = await createUserWithEmailAndPassword(auth, normalized, password)
      if (displayName) await updateProfile(cred.user, { displayName })
      await sendEmailVerification(cred.user).catch((e) => console.warn('[authStore] 인증 메일 발송 실패', e))
      return true
    } catch (e) {
      error.value = messageFor(e)
      return false
    }
  }

  async function resendVerification() {
    error.value = ''
    try {
      await sendEmailVerification(auth.currentUser)
      return true
    } catch (e) {
      error.value = messageFor(e)
      return false
    }
  }

  // 메일의 링크를 누른 뒤 "인증 완료" — 사용자 정보를 다시 읽고 토큰을 강제로 갱신해야
  // 규칙(request.auth.token.email_verified)이 새 값을 본다.
  async function refreshVerification() {
    error.value = ''
    try {
      await auth.currentUser.reload()
      await auth.currentUser.getIdToken(true)
      user.value = { ...user.value, emailVerified: auth.currentUser.emailVerified }
      if (!auth.currentUser.emailVerified) error.value = '아직 인증되지 않았습니다. 메일의 링크를 눌렀는지 확인해 주세요.'
      return auth.currentUser.emailVerified
    } catch (e) {
      error.value = messageFor(e)
      return false
    }
  }

  async function signIn(email, password) {
    error.value = ''
    try {
      await signInWithEmailAndPassword(auth, email, password)
      return true
    } catch (e) {
      error.value = messageFor(e)
      return false
    }
  }

  async function signOutUser() {
    error.value = ''
    try {
      // 로그아웃 직전에 Firestore 실시간 구독을 전부 끊는다 — 안 그러면 로그아웃 순간부터
      // 새로고침될 때까지 열려 있던 구독이 권한 거부(permission-denied) 에러를 콘솔에 쏟아낸다.
      // 어차피 아래에서 새로고침하므로 terminate된 db를 다시 쓸 일은 없다.
      await terminate(db).catch(() => {})
      await signOut(auth)
      // 로그인이 필수인 앱이라, 로그아웃하면 "마지막으로 쓰던 농장" 기억도 같이
      // 지운다 — 로그아웃 전까지만 유지되어야 하고, 다음에 다른 계정으로 로그인해도
      // 이전 계정의 농장 선택이 남아있으면 안 된다.
      localStorage.removeItem(LS_ACTIVE)
      localStorage.setItem(LS_MODE, '')
      // 이 앱은 상태 전환마다 항상 새로고침한다(farmsStore의 selectFarm/enterAdminMode/
      // exitToSelector와 동일한 관례) — 로그아웃을 새로고침 없이 진행 중인 화면에서
      // 그대로 두면, 실시간 구독이 조용히 거부되고 그 뒤의 수정이 로컬에만 남아
      // 다음 새로고침 때 사라진다.
      window.location.reload()
      return true
    } catch (e) {
      error.value = messageFor(e)
      return false
    }
  }

  async function resetPassword(email) {
    error.value = ''
    try {
      await sendPasswordResetEmail(auth, email)
      return true
    } catch (e) {
      error.value = messageFor(e)
      return false
    }
  }

  // 비밀번호 변경(로그인된 상태). updatePassword()는 "최근에 로그인했음"을 요구해서
  // (auth/requires-recent-login), 현재 비밀번호로 먼저 재인증한 뒤 바꾼다 — 그래서
  // 세션이 오래됐어도 갑자기 에러가 나지 않고, 자연스럽게 "현재 비밀번호" 입력을 받는
  // 흐름이 된다.
  async function changePassword(currentPassword, newPassword) {
    error.value = ''
    try {
      const cred = EmailAuthProvider.credential(auth.currentUser.email, currentPassword)
      await reauthenticateWithCredential(auth.currentUser, cred)
      await updatePassword(auth.currentUser, newPassword)
      return true
    } catch (e) {
      error.value = messageFor(e)
      return false
    }
  }

  return {
    user, role, isDisabled, loading, error, isLoggedIn, isSuperAdmin, needsEmailVerification,
    init, signUp, resendVerification, refreshVerification, signIn, signOutUser, resetPassword, changePassword,
  }
})
