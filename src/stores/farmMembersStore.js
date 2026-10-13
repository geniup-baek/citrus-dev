import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  collection, doc, getDoc, getDocs, updateDoc, deleteDoc, onSnapshot, arrayUnion, query, where, writeBatch,
} from 'firebase/firestore'
import { db, firebaseEnabled } from '../services/firebase.js'
import { useAuthStore } from './authStore.js'
import { uuid } from '../utils/uuid.js'
import { PERMISSION_DOMAINS, canAccessFarm, canReadFarmDomain, canUseFeature, canWriteFarmDomain } from '../utils/farmAccess.js'

const EMAIL_PATTERN = /^[^@/\s]+@[^@/\s]+\.[^@/\s]+$/

function emptyPermissions() {
  const p = {}
  for (const domain of PERMISSION_DOMAINS) p[domain] = { read: false, write: false }
  return p
}

export const useFarmMembersStore = defineStore('farmMembers', () => {
  const authStore = useAuthStore()

  // ── 전역(농장 무관): 내가 구성원으로 속한 농장 목록 ───────────────────────────
  const myFarmIds = ref([])
  const myFarmIdsLoading = ref(true)
  let globalInitialized = false

  // farms/{farmId}/members 컬렉션그룹을 내 uid로 걸러 찾는 방식(where('uid','==',내 uid))은
  // 처음 시도했을 때 거부됐다. 원인은 컬렉션그룹 쿼리용 {path=**} 규칙이 없어서였을
  // 가능성이 크지만(firestore.rules의 members 주석 참고) 일반 구성원 쪽은 끝까지
  // 확인하지 못했다. 그래서 users/{uid}.memberFarmIds는 "후보" 목록으로 남겨둔다(구성원에서
  // 빠졌는데 아직 안 지워졌을 수 있음) — 실제로 그 농장의 members/{uid} 문서가 지금도
  // 있는지 하나씩 확인해서만 반영한다. 구성원 변경이 잦지 않은 앱이라 로그인 시점 1회
  // 확인이면 충분하다(다른 농장별 스토어처럼 실시간 구독까지는 안 함).
  async function refreshMyFarmIds() {
    // 내 이메일로 온 초대를 먼저 수락(구성원 문서 생성)한 뒤 후보 목록을 확인한다.
    await claimInvitations()
    const uid = authStore.user?.uid
    if (!firebaseEnabled || !db || !uid) {
      myFarmIds.value = []
      myFarmIdsLoading.value = false
      return
    }
    myFarmIdsLoading.value = true
    try {
      const userSnap = await getDoc(doc(db, 'users', uid))
      const candidates = Array.isArray(userSnap.data()?.memberFarmIds) ? userSnap.data().memberFarmIds : []
      const verified = []
      for (const farmId of candidates) {
        const memberSnap = await getDoc(doc(db, 'farms', farmId, 'members', uid))
        if (memberSnap.exists()) verified.push(farmId)
      }
      myFarmIds.value = verified
    } catch (e) {
      console.warn('[farmMembersStore] 구성원 농장 목록 확인 실패', e)
      myFarmIds.value = []
    } finally {
      myFarmIdsLoading.value = false
    }
  }

  function initGlobal() {
    if (globalInitialized) return
    globalInitialized = true
    if (!firebaseEnabled || !db) {
      myFarmIdsLoading.value = false
      return
    }
    // authStore.loading은 앱 시작 시 딱 한 번만 true→false로 바뀐다(그 뒤로는 계속
    // false) — 그것만 지켜보면, 처음엔 비로그인 상태로 그 전이가 끝나버린 뒤 나중에
    // 로그인해도(로그아웃 상태→로그인) 다시 안 불린다. uid도 함께 지켜봐서 로그인/
    // 로그아웃/계정 전환마다 다시 확인한다.
    watch(
      () => [authStore.loading, authStore.user?.uid, authStore.needsEmailVerification],
      ([loading, , needsVerification]) => {
        if (loading) return
        if (needsVerification) { myFarmIds.value = []; myFarmIdsLoading.value = false; return }
        refreshMyFarmIds()
      },
      { immediate: true },
    )
  }

  // ── 농장별: 구성원 목록(소유자용) / 내 권한(구성원용) ─────────────────────────
  const activeFarmId = ref(null)
  const activeFarm = ref(null) // farmsStore가 넘겨준 농장 문서 그대로 — canRead/canWrite 판단에 씀
  const isOwnerOfActiveFarm = ref(false)
  const members = ref([]) // 소유자·슈퍼관리자일 때만 채워짐(구성원 전체 목록)
  const myMembership = ref(null) // 내 members/{uid} 문서(구성원일 때)
  const invitations = ref([]) // 아직 수락하지 않은 이메일 초대 목록(소유자용)
  // 내 권한 문서 구독이 첫 응답을 받기 전까지 true — router 가드가 이 값이 false가
  // 될 때까지 기다려서, 아직 권한을 확인 못 한 걸 "권한 없음"으로 오판해 쫓아내지
  // 않게 한다(소유자·슈퍼관리자는 canRead/canWrite가 이 값과 무관하게 먼저 통과됨).
  const perFarmLoading = ref(true)
  let perFarmInitialized = null

  function init(farmId, farm) {
    if (perFarmInitialized === farmId) return
    perFarmInitialized = farmId
    activeFarmId.value = farmId
    activeFarm.value = farm || null
    isOwnerOfActiveFarm.value = !!(authStore.user?.uid && farm?.ownerUid === authStore.user.uid)
    members.value = []
    myMembership.value = null
    invitations.value = []
    perFarmLoading.value = true
    if (!firebaseEnabled || !db) { perFarmLoading.value = false; return }

    const uid = authStore.user?.uid
    if (uid) {
      onSnapshot(doc(db, 'farms', farmId, 'members', uid), (snap) => {
        myMembership.value = snap.exists() ? snap.data() : null
        perFarmLoading.value = false
      }, (err) => {
        console.warn('[farmMembersStore] 내 권한 구독 실패', err)
        perFarmLoading.value = false
      })
    } else {
      perFarmLoading.value = false
    }

    if (isOwnerOfActiveFarm.value || authStore.isSuperAdmin) {
      onSnapshot(collection(db, 'farms', farmId, 'members'), (snap) => {
        members.value = snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
      }, (err) => console.warn('[farmMembersStore] 구성원 목록 구독 실패', err))
      onSnapshot(collection(db, 'farms', farmId, 'invitations'), (snap) => {
        invitations.value = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      }, (err) => console.warn('[farmMembersStore] 초대 목록 구독 실패', err))
    }
  }

  const myPermissions = computed(() => myMembership.value?.permissions || null)

  // 소유자·슈퍼관리자면 도메인별 권한 확인 없이 항상 전체 접근 — farmStore.js 등이
  // "이 농장은 문서 시딩/구독을 도메인별로 걸러야 하는지"를 판단하는 데 쓴다
  // (구성원만 걸러야 하고, 이 경우는 걸러선 안 됨).
  const hasFullAccess = computed(() =>
    canAccessFarm(activeFarm.value, { uid: authStore.user?.uid, isSuperAdmin: authStore.isSuperAdmin }))

  // 다른 농장별 스토어(farmStore/treatmentStore/...)가 "내 권한 확인이 끝났는지"를
  // 기다리는 용도. hasFullAccess면 애초에 기다릴 필요가 없어 즉시 끝난 것으로 본다.
  function ready() {
    if (hasFullAccess.value || !perFarmLoading.value) return Promise.resolve()
    return new Promise((resolve) => {
      const unwatch = watch(perFarmLoading, (loading) => {
        if (!loading) { unwatch(); resolve() }
      })
    })
  }

  function canRead(domain) {
    return canReadFarmDomain(
      activeFarm.value,
      domain,
      { uid: authStore.user?.uid, isSuperAdmin: authStore.isSuperAdmin, member: myMembership.value },
    )
  }
  // 설정 화면 기능(changeLog/behavior/backup) 사용 권한 — 화면 단위 UI 판단.
  function canUse(feature, mode = 'read') {
    return canUseFeature(
      activeFarm.value,
      feature,
      mode,
      { uid: authStore.user?.uid, isSuperAdmin: authStore.isSuperAdmin, member: myMembership.value },
    )
  }
  function canWrite(domain) {
    return canWriteFarmDomain(
      activeFarm.value,
      domain,
      { uid: authStore.user?.uid, isSuperAdmin: authStore.isSuperAdmin, member: myMembership.value },
    )
  }

  // ── 소유자 액션 ──────────────────────────────────────────────────────────
  // 농장종사자를 이메일로 초대한다(농장주·슈퍼관리자). 초대 문서 + 농장 쪽 미러 +
  // 가입 허용 표시를 한 배치로 쓴다. 안내메일 발송은 호출자(UI)가 inviteMail 서비스로
  // 이어서 한다. 그 이메일로 가입·로그인하면 claimInvitations()가 구성원으로 연결한다.
  async function inviteWorker(emailInput, permissions) {
    const farmId = activeFarmId.value
    if (!farmId) throw new Error('농장이 선택되지 않았습니다.')
    const email = (emailInput || '').trim().toLowerCase()
    if (!EMAIL_PATTERN.test(email)) throw new Error('이메일 형식이 올바르지 않습니다.')
    if (members.value.some((m) => (m.email || '').toLowerCase() === email)) throw new Error('이미 이 농장의 구성원입니다.')
    if (invitations.value.some((i) => i.email === email)) throw new Error('이미 초대한 이메일입니다. 초대 목록에서 안내메일을 다시 보낼 수 있습니다.')
    const id = uuid()
    const createdAt = new Date().toISOString()
    const data = { email, farmId, permissions, invitedBy: authStore.user?.uid || null, createdAt }
    const batch = writeBatch(db)
    batch.set(doc(db, 'invitations', id), data)
    batch.set(doc(db, 'farms', farmId, 'invitations', id), data)
    batch.set(doc(db, 'signupAllowed', email), { farmId, at: createdAt })
    await batch.commit()
    return email
  }

  async function revokeInvitation(invitation) {
    const farmId = activeFarmId.value
    if (!farmId) return
    const batch = writeBatch(db)
    batch.delete(doc(db, 'invitations', invitation.id))
    batch.delete(doc(db, 'farms', farmId, 'invitations', invitation.id))
    await batch.commit()
  }

  async function updateMemberPermissions(memberUid, permissions) {
    const farmId = activeFarmId.value
    if (!farmId) return
    await updateDoc(doc(db, 'farms', farmId, 'members', memberUid), { permissions })
  }

  async function removeMember(memberUid) {
    const farmId = activeFarmId.value
    if (!farmId) return
    await deleteDoc(doc(db, 'farms', farmId, 'members', memberUid))
  }

  // ── 구성원 액션(초대 수락) ───────────────────────────────────────────────
  // 로그인(인증된 이메일)할 때마다 내 이메일로 온 초대를 구성원 문서로 바꾼다. 초대 문서의
  // farmId·permissions를 그대로 옮기며(규칙이 일치를 검사), 수락한 초대와 농장 쪽 미러는
  // 같은 배치에서 지운다. 한 건이 실패(예: 이미 구성원)해도 나머지는 계속 처리한다.
  async function claimInvitations() {
    const uid = authStore.user?.uid
    const email = (authStore.user?.email || '').toLowerCase()
    if (!firebaseEnabled || !db || !uid || !email) return
    try {
      const snap = await getDocs(query(collection(db, 'invitations'), where('email', '==', email)))
      for (const inv of snap.docs) {
        const data = inv.data()
        try {
          const batch = writeBatch(db)
          batch.set(doc(db, 'farms', data.farmId, 'members', uid), {
            uid,
            permissions: data.permissions,
            email: authStore.user.email,
            displayName: authStore.user.displayName || '',
            joinedAt: new Date().toISOString(),
            joinedViaInvitation: inv.id,
          })
          batch.delete(inv.ref)
          batch.delete(doc(db, 'farms', data.farmId, 'invitations', inv.id))
          await batch.commit()
          await updateDoc(doc(db, 'users', uid), { memberFarmIds: arrayUnion(data.farmId) })
        } catch (e) {
          console.warn('[farmMembersStore] 초대 수락 실패', inv.id, e)
        }
      }
    } catch (e) {
      console.warn('[farmMembersStore] 초대 목록 조회 실패', e)
    }
  }

  return {
    myFarmIds, myFarmIdsLoading, initGlobal,
    activeFarmId, isOwnerOfActiveFarm, members, myMembership, myPermissions, invitations, perFarmLoading,
    hasFullAccess, ready,
    init, canRead, canWrite, canUse,
    inviteWorker, revokeInvitation, updateMemberPermissions, removeMember, claimInvitations,
    emptyPermissions,
  }
})
