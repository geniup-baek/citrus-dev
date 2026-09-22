import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateCurrentUser,
  updatePassword,
  updateProfile,
} from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, db, firebaseEnabled, liteAuth } from '../services/firebase.js'

const DOC_COLLECTION = 'users'

const ERROR_MESSAGES = {
  'auth/email-already-in-use': '이미 가입된 이메일입니다.',
  'auth/invalid-email': '이메일 형식이 올바르지 않습니다.',
  'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
  'auth/wrong-password': '이메일 또는 비밀번호가 올바르지 않습니다.',
  'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.',
  'auth/user-not-found': '이메일 또는 비밀번호가 올바르지 않습니다.',
  'auth/too-many-requests': '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
}

function messageFor(err) {
  return ERROR_MESSAGES[err?.code] || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
}

// role은 여기서 절대 쓰지 않는다 — 콘솔에서 수동으로만 부여한다(firestore.rules의
// users/{uid} update 규칙도 role 값이 그대로 유지될 때만 쓰기를 허용한다).
// 반환값(기존 role)으로 isSuperAdmin 판단에 쓴다.
async function ensureUserDoc(fbUser) {
  if (!db) return null
  const ref = doc(db, DOC_COLLECTION, fbUser.uid)
  const snap = await getDoc(ref)
  const profile = { email: fbUser.email || '', displayName: fbUser.displayName || '' }
  if (snap.exists()) {
    await setDoc(ref, profile, { merge: true })
    return snap.data()?.role || null
  }
  await setDoc(ref, { ...profile, createdAt: new Date().toISOString() })
  return null
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null) // { uid, email, displayName } | null
  const role = ref(null)
  const loading = ref(true)
  const error = ref('')
  let initialized = false

  const isLoggedIn = computed(() => !!user.value)
  const isSuperAdmin = computed(() => isLoggedIn.value && role.value === 'super_admin')

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
        user.value = { uid: fbUser.uid, email: fbUser.email, displayName: fbUser.displayName }
        try {
          role.value = await ensureUserDoc(fbUser)
        } catch (e) {
          console.warn('[authStore] users 문서 갱신 실패', e)
          role.value = null
        }
      } else {
        user.value = null
        role.value = null
      }
      loading.value = false
    })
  }

  async function signUp(email, password, displayName) {
    error.value = ''
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password)
      if (displayName) await updateProfile(cred.user, { displayName })
      return true
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
      await signOut(auth)
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
    user, role, loading, error, isLoggedIn, isSuperAdmin,
    init, signUp, signIn, signOutUser, resetPassword, changePassword,
  }
})
