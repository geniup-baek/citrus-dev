import { defineStore } from 'pinia'
import { ref } from 'vue'
import { collection, collectionGroup, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth, db, firebaseEnabled } from '../services/firebase.js'
import { useAuthStore } from './authStore.js'
import { useFarmsStore } from './farmsStore.js'

// 전역 사용자 관리(가입자 목록·슈퍼관리자 권한·비활성화/삭제·비밀번호 재설정 메일·
// 계정별 소유/소속 농장) — 슈퍼관리자 전용 화면(UserManagementPanel.vue)에서만 쓴다.
// users/{uid}의 list, 남의 role/disabled 변경, 모든 농장 구성원 조회는 규칙상
// 슈퍼관리자만 가능하다(firestore.rules). 본인 계정은 여기서 바꿀 수 없다.
//
// ⚠ 이 앱엔 백엔드(Admin SDK)가 없어서 다른 사람의 Firebase Auth 계정 자체를 지우거나
// 끌 수는 없다 — 그래서 "비활성화"는 users/{uid}.disabled 플래그 + 규칙의 접근 차단이고,
// "삭제"도 모든 농장 소속 제거 + 영구 비활성화다(인증 계정은 Firebase 콘솔에서 지운다).
export const useUserAdminStore = defineStore('userAdmin', () => {
  const users = ref([])
  const memberships = ref([]) // [{ uid, farmId, permissions }] — 모든 농장의 구성원 문서
  const loading = ref(false)
  const error = ref('')

  async function refreshUsers() {
    if (!firebaseEnabled || !db) return
    loading.value = true
    error.value = ''
    try {
      const [userSnap, memberSnap] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(collectionGroup(db, 'members')),
      ])
      users.value = userSnap.docs
        .map((d) => ({ uid: d.id, ...d.data() }))
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
      memberships.value = memberSnap.docs.map((d) => ({
        uid: d.id,
        farmId: d.ref.parent.parent.id,
        permissions: d.data().permissions || {},
      }))
    } catch (e) {
      console.warn('[userAdminStore] 사용자 목록 조회 실패', e)
      error.value = '사용자 목록을 불러오지 못했습니다.'
    } finally {
      loading.value = false
    }
  }

  function assertNotSelf(uid) {
    if (uid === useAuthStore().user?.uid) throw new Error('본인 계정은 여기서 바꿀 수 없습니다.')
  }

  // 슈퍼관리자 화면이라 farmsStore.farms가 전체 농장(삭제된 것 포함)이다.
  function ownedFarmsOf(uid) {
    const farmsStore = useFarmsStore()
    return [...farmsStore.farms, ...farmsStore.deletedFarms].filter((f) => f.ownerUid === uid)
  }

  function membershipsOf(uid) {
    const farmsStore = useFarmsStore()
    const all = [...farmsStore.farms, ...farmsStore.deletedFarms]
    return memberships.value
      .filter((m) => m.uid === uid)
      .map((m) => ({ ...m, farm: all.find((f) => f.id === m.farmId) || null }))
  }

  async function setSuperAdmin(uid, isSuperAdmin) {
    assertNotSelf(uid)
    await setDoc(doc(db, 'users', uid), { role: isSuperAdmin ? 'super_admin' : null }, { merge: true })
    await refreshUsers()
  }

  async function setDisabled(uid, disabled) {
    assertNotSelf(uid)
    await setDoc(doc(db, 'users', uid), { disabled: !!disabled }, { merge: true })
    await refreshUsers()
  }

  // 모든 농장 구성원 문서를 지우고 영구 비활성화. 소유한 농장이 있으면 막는다 — 소유자가
  // 없는 농장이 생기면 안 되므로 먼저 소유권을 이전해야 한다.
  async function removeAccount(uid) {
    assertNotSelf(uid)
    const owned = ownedFarmsOf(uid)
    if (owned.length) {
      throw new Error(`소유한 농장이 있습니다(${owned.map((f) => f.name).join(', ')}). 먼저 시스템 관리 → 농장에서 소유권을 이전하세요.`)
    }
    await Promise.all(membershipsOf(uid).map((m) => deleteDoc(doc(db, 'farms', m.farmId, 'members', uid))))
    await setDoc(doc(db, 'users', uid), { disabled: true }, { merge: true })
    await refreshUsers()
  }

  // 프로필 문서(users/{uid})까지 지워 목록에서 없앤다. Firebase Auth에서 이미 지운 계정의 찌꺼기를
  // 정리하는 용도 — 인증 계정이 남아 있으면 그 사람이 다시 로그인할 때 프로필이 새로 만들어지고
  // (비활성화 표시 없이) 되살아난다. 규칙상 비활성화된 일반 계정만 지울 수 있다.
  async function removeProfile(uid) {
    assertNotSelf(uid)
    const owned = ownedFarmsOf(uid)
    if (owned.length) {
      throw new Error(`소유한 농장이 있습니다(${owned.map((f) => f.name).join(', ')}). 먼저 시스템 관리 → 농장에서 소유권을 이전하세요.`)
    }
    await Promise.all(membershipsOf(uid).map((m) => deleteDoc(doc(db, 'farms', m.farmId, 'members', uid))))
    await deleteDoc(doc(db, 'users', uid))
    await refreshUsers()
  }

  // 비밀번호를 직접 바꿀 수는 없다(Admin SDK 필요) — 해당 이메일로 재설정 메일을 보낸다.
  async function sendPasswordReset(email) {
    if (!email) throw new Error('이메일이 없는 계정입니다.')
    await sendPasswordResetEmail(auth, email)
  }

  return {
    users, memberships, loading, error, refreshUsers,
    ownedFarmsOf, membershipsOf, setSuperAdmin, setDisabled, removeAccount, removeProfile, sendPasswordReset,
  }
})
