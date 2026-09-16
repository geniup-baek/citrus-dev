import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, db, firebaseEnabled } from '../services/firebase.js'

// 로그인 자체는 아직 아무것도 강제하지 않는 부가 기능이다(농장 접근 방식은 그대로
// PIN 기반). users/{uid} 문서는 이후 단계(농장 소유권·권한)에서 쓸 신원의 그릇만
// 지금 만들어 둔다 — 지금은 프로필(email/표시 이름) 저장 용도뿐이다.
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

async function ensureUserDoc(fbUser) {
  if (!db) return
  const ref = doc(db, DOC_COLLECTION, fbUser.uid)
  const snap = await getDoc(ref)
  const profile = { email: fbUser.email || '', displayName: fbUser.displayName || '' }
  if (snap.exists()) {
    await setDoc(ref, profile, { merge: true })
  } else {
    await setDoc(ref, { ...profile, createdAt: new Date().toISOString() })
  }
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null) // { uid, email, displayName } | null
  const loading = ref(true)
  const error = ref('')
  let initialized = false

  const isLoggedIn = computed(() => !!user.value)

  function init() {
    if (initialized) return
    initialized = true
    if (!firebaseEnabled || !auth) {
      loading.value = false
      return
    }
    onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        user.value = { uid: fbUser.uid, email: fbUser.email, displayName: fbUser.displayName }
        try {
          await ensureUserDoc(fbUser)
        } catch (e) {
          console.warn('[authStore] users 문서 갱신 실패', e)
        }
      } else {
        user.value = null
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

  return { user, loading, error, isLoggedIn, init, signUp, signIn, signOutUser, resetPassword }
})
