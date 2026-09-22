import { defineStore } from 'pinia'
import { ref } from 'vue'
import { collection, doc, getDocs, setDoc } from 'firebase/firestore'
import { db, firebaseEnabled } from '../services/firebase.js'
import { useAuthStore } from './authStore.js'

// 전역 사용자 관리(가입자 목록·슈퍼관리자 권한 부여/회수) — 슈퍼관리자 전용
// 화면(UserManagementPanel.vue)에서만 쓴다. users/{uid}의 list는 규칙상
// 슈퍼관리자만 가능하고, role 변경도 "남의" 문서에 한해서만 허용된다
// (firestore.rules 참고 — 본인 role은 여기서도 못 바꾼다, 콘솔에서만).
export const useUserAdminStore = defineStore('userAdmin', () => {
  const users = ref([])
  const loading = ref(false)
  const error = ref('')

  async function refreshUsers() {
    if (!firebaseEnabled || !db) return
    loading.value = true
    error.value = ''
    try {
      const snap = await getDocs(collection(db, 'users'))
      users.value = snap.docs
        .map((d) => ({ uid: d.id, ...d.data() }))
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
    } catch (e) {
      console.warn('[userAdminStore] 사용자 목록 조회 실패', e)
      error.value = '사용자 목록을 불러오지 못했습니다.'
    } finally {
      loading.value = false
    }
  }

  async function setSuperAdmin(uid, isSuperAdmin) {
    const authStore = useAuthStore()
    if (uid === authStore.user?.uid) {
      throw new Error('본인의 권한은 여기서 바꿀 수 없습니다(Firebase 콘솔에서 변경).')
    }
    await setDoc(doc(db, 'users', uid), { role: isSuperAdmin ? 'super_admin' : null }, { merge: true })
    await refreshUsers()
  }

  return { users, loading, error, refreshUsers, setSuperAdmin }
})
