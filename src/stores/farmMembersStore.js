import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, arrayUnion, runTransaction,
} from 'firebase/firestore'
import { db, firebaseEnabled } from '../services/firebase.js'
import { useAuthStore } from './authStore.js'
import { PERMISSION_DOMAINS, canAccessFarm, canReadFarmDomain, canWriteFarmDomain } from '../utils/farmAccess.js'

// 사람이 말로 전달하거나(카톡 등) 손으로 입력하기 쉽게 8자, 헷갈리기 쉬운 0/O/1/I/L 제외.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function generateInviteCode() {
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return code
}

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

  // ⚠ farms/{farmId}/members 컬렉션그룹을 내 uid로 직접 걸러 찾는 방식(where('uid',
  // '==',내 uid))을 시도했으나 실측으로 거부됨을 확인했다 — firestore.rules의
  // members list 규칙에 있는 isOwner(farmId) 항이 문서마다 다른 farmId(경로)에
  // 의존해서, Firestore가 "쿼리 결과 전체에 대해 증명 가능"을 판단할 때 그 항
  // 때문에 전체를 증명 불가로 본다(다른 항이 uid로 이미 걸려 있어도 소용없음).
  // 그래서 users/{uid}.memberFarmIds는 "후보" 목록으로 남겨둔다(구성원에서
  // 빠졌는데 아직 안 지워졌을 수 있음) — 실제로 그 농장의 members/{uid} 문서가
  // 지금도 있는지 하나씩 확인해서만 반영한다. 구성원 변경이 잦지 않은 앱이라
  // 로그인 시점 1회 확인이면 충분하다(다른 농장별 스토어처럼 실시간 구독까지는 안 함).
  async function refreshMyFarmIds() {
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
      () => [authStore.loading, authStore.user?.uid],
      ([loading]) => {
        if (loading) return
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
  const inviteCodeRefs = ref([]) // 발급된 초대 코드 목록(소유자용)
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
    inviteCodeRefs.value = []
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
      onSnapshot(collection(db, 'farms', farmId, 'inviteCodeRefs'), (snap) => {
        inviteCodeRefs.value = snap.docs
          .map((d) => ({ code: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      }, (err) => console.warn('[farmMembersStore] 초대 코드 목록 구독 실패', err))
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
  function canWrite(domain) {
    return canWriteFarmDomain(
      activeFarm.value,
      domain,
      { uid: authStore.user?.uid, isSuperAdmin: authStore.isSuperAdmin, member: myMembership.value },
    )
  }

  // ── 소유자 액션 ──────────────────────────────────────────────────────────
  async function createInviteCode(permissions) {
    const farmId = activeFarmId.value
    if (!farmId) return null
    const code = generateInviteCode()
    const createdAt = new Date().toISOString()
    const createdBy = authStore.user?.uid || null
    await setDoc(doc(db, 'inviteCodes', code), { farmId, permissions, createdAt, createdBy })
    await setDoc(doc(db, 'farms', farmId, 'inviteCodeRefs', code), { permissions, createdAt })
    return code
  }

  async function revokeInviteCode(code) {
    const farmId = activeFarmId.value
    if (!farmId) return
    await deleteDoc(doc(db, 'inviteCodes', code)).catch(() => {})
    await deleteDoc(doc(db, 'farms', farmId, 'inviteCodeRefs', code))
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

  // ── 구성원 액션(참여) ────────────────────────────────────────────────────
  // 활성 농장 여부와 무관하게(농장 선택 화면에서) 호출된다.
  // "코드에 claimedBy 표시" + "멤버 문서 생성"을 하나의 트랜잭션으로 묶어서, 같은
  // 코드로 동시에 참여를 시도해도 정확히 한 명만 성공한다(Firestore 트랜잭션의
  // 낙관적 동시성 제어 + firestore.rules의 claimedBy 체크가 같이 막아줌).
  async function joinFarmWithCode(code) {
    const uid = authStore.user?.uid
    if (!uid) throw new Error('로그인이 필요합니다.')
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) throw new Error('코드를 입력해 주세요.')

    const codeRef = doc(db, 'inviteCodes', trimmed)
    let farmId
    try {
      farmId = await runTransaction(db, async (transaction) => {
        const codeSnap = await transaction.get(codeRef)
        if (!codeSnap.exists()) throw new Error('유효하지 않은 코드입니다.')
        const data = codeSnap.data()
        if (data.claimedBy) throw new Error('이미 사용된 코드입니다.')
        transaction.update(codeRef, { claimedBy: uid, claimedAt: new Date().toISOString() })
        // uid는 문서 id와 중복이지만 규칙(members create)이 이 값을 request.auth.uid와
        // 같도록 강제해 둔다 — 문서만 보고도(예: 관리자 콘솔) 소유자를 바로 알 수 있다.
        transaction.set(doc(db, 'farms', data.farmId, 'members', uid), {
          uid,
          permissions: data.permissions,
          email: authStore.user.email || '',
          displayName: authStore.user.displayName || '',
          joinedAt: new Date().toISOString(),
          joinedViaCode: trimmed,
        })
        return data.farmId
      })
    } catch (e) {
      // 트랜잭션이 규칙에 막혀 거부되면(예: 경합에서 진 쪽) permission-denied로
      // 온다 — 사용자에게는 "이미 사용됨"이 더 정확한 설명이다.
      if (e.code === 'permission-denied') throw new Error('이미 사용된 코드입니다.')
      throw e
    }

    await updateDoc(doc(db, 'users', uid), { memberFarmIds: arrayUnion(farmId) })
    await deleteDoc(codeRef).catch(() => {})
    await refreshMyFarmIds()
    return farmId
  }

  return {
    myFarmIds, myFarmIdsLoading, initGlobal,
    activeFarmId, isOwnerOfActiveFarm, members, myMembership, myPermissions, inviteCodeRefs, perFarmLoading,
    hasFullAccess, ready,
    init, canRead, canWrite,
    createInviteCode, revokeInviteCode, updateMemberPermissions, removeMember, joinFarmWithCode,
    emptyPermissions,
  }
})
