import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  collection, doc, getDoc, getDocs, onSnapshot, setDoc, updateDoc, deleteDoc, deleteField, query, where, writeBatch,
} from 'firebase/firestore'
import { db, firebaseEnabled } from '../services/firebase.js'
import { uuid } from '../utils/uuid.js'
import { DOMAIN_KEYS } from '../utils/farmDataSchema.js'
import { useAuthStore } from './authStore.js'
import { useFarmMembersStore } from './farmMembersStore.js'
import { LS_PREFIX } from '../utils/storagePrefix.js'

const LS_ACTIVE = `${LS_PREFIX}:active-farm`
const LS_MODE = `${LS_PREFIX}:app-mode` // '' | 'farm' | 'admin'. localStorage에 키 자체가 없으면(null) "한 번도 선택한 적 없음"으로 취급한다.
const LOCAL_FARM_ID = 'local' // Firebase 비활성(로컬 전용) 환경에서 쓰는 고정 농장 id

export const useFarmsStore = defineStore('farms', () => {
  const authStore = useAuthStore()
  const farmMembersStore = useFarmMembersStore()

  // 공개 농장이 없다 — 농장은 항상 정확히 1명의 소유자를 가지고, 로그인해야만
  // 접근 가능하다. 그래서 "전체 농장 목록을 열어두고 클라이언트가 필터링"하는
  // 대신, 애초에 서버가 "내가 접근 가능한 농장만" 돌려주는 쿼리 2개를 합친다:
  //   1) ownedFarmsRaw — where('ownerUid','==',내 uid)로 실시간 구독(슈퍼관리자는
  //      필터 없이 전체 구독). firestore.rules가 이 쿼리 자체를 증명 가능하게 허용한다.
  //      구독 전에 claimOwnedFarms()가 "내 이메일로 지정됐지만 아직 주인(uid)이 없는
  //      농장"에 내 uid를 채워 넣는다(슈퍼관리자가 이메일로 농장을 만들기 때문).
  //   2) memberFarmDocs — farmMembersStore.myFarmIds(내가 구성원인 농장 id 목록,
  //      초대 수락 + 후보 id 개별 확인으로 구함)에 있지만 위 1)에 없는 것만 개별 조회.
  const ownedFarmsRaw = ref([])
  const memberFarmDocs = ref([])
  const ownedLoading = ref(true)
  const memberDocsLoading = ref(true)
  const loading = computed(() =>
    ownedLoading.value || memberDocsLoading.value
    || (firebaseEnabled && (authStore.loading || farmMembersStore.myFarmIdsLoading)))
  const initialized = ref(false)
  // 농장 관련 실시간 구독이 거부당했을 때(예: 로그아웃 경합, 소유권 변경) 채워진다.
  // App.vue가 이 값이 있으면 "새로고침해 주세요" 카드를 띄운다.
  const accessError = ref(null)
  function reportAccessError(err) {
    console.warn('[farmsStore] 농장 데이터 접근 거부', err)
    accessError.value = err
  }

  const allFarms = computed(() => {
    const ownedIds = new Set(ownedFarmsRaw.value.map((f) => f.id))
    const extra = memberFarmDocs.value.filter((f) => !ownedIds.has(f.id))
    return [...ownedFarmsRaw.value, ...extra].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  })
  // 화면 전반(선택화면·헤더·라우터 등)에서 쓰는 목록은 삭제된 농장을 제외한다.
  const farms = computed(() => allFarms.value.filter((f) => !f.deletedAt))
  // 삭제(휴지통 보관)된 농장 — 최근 삭제 순으로 정렬. 설정의 "삭제된 농장" 섹션에서만 사용.
  const deletedFarms = computed(() =>
    allFarms.value
      .filter((f) => f.deletedAt)
      .sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || '')),
  )

  const modeLocal = ref(localStorage.getItem(LS_MODE) || '')
  const activeFarmIdLocal = ref(localStorage.getItem(LS_ACTIVE) || '')

  const isAdminMode = computed(() => modeLocal.value === 'admin')

  // 들어갈 농장 결정: 이 기기에 마지막으로 쓰던 농장이 아직 접근 가능하면(로그아웃하기
  // 전까지 유지) 그 농장. 아니면 일반 사용자는 접근 가능한 농장이 정확히 1개일 때 선택
  // 화면 없이 그 농장으로 바로 들어간다 — 선택 화면은 여러 개일 때만 뜬다. 슈퍼관리자는
  // 시스템 관리 진입이 선택 화면에 있어서 마지막 선택이 없으면 항상 선택 화면을 본다.
  const activeFarm = computed(() => {
    if (isAdminMode.value) return null
    const remembered = farms.value.find((f) => f.id === activeFarmIdLocal.value)
    if (remembered) return remembered
    if (!authStore.isSuperAdmin && farms.value.length === 1) return farms.value[0]
    return null
  })

  // 일반 사용자가 접근 가능한 농장이 하나도 없음(아직 초대·소유권이 연결되지 않은 경우 등).
  const noFarmAccess = computed(() =>
    !loading.value && !isAdminMode.value && !authStore.isSuperAdmin && farms.value.length === 0)
  const needsFarmSelect = computed(() =>
    !loading.value && !isAdminMode.value && !activeFarm.value
    && (authStore.isSuperAdmin || farms.value.length > 1))

  let unsubscribeOwned = null
  function subscribeOwnedFarms(uid, isSuperAdmin) {
    unsubscribeOwned?.()
    ownedLoading.value = true
    const q = isSuperAdmin ? collection(db, 'farms') : query(collection(db, 'farms'), where('ownerUid', '==', uid))
    unsubscribeOwned = onSnapshot(q, (snap) => {
      ownedFarmsRaw.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      ownedLoading.value = false
    }, reportAccessError)
  }

  // 슈퍼관리자가 내 이메일로 지정해 둔(ownerEmail) 농장 중 아직 주인이 없는 것에 내 uid를
  // 채운다(소유권 claim). 규칙이 인증된 이메일 일치 + ownerUid만 바뀌는 경우로 제한한다.
  async function claimOwnedFarms(uid, email) {
    if (!email) return
    try {
      const snap = await getDocs(query(collection(db, 'farms'), where('ownerEmail', '==', email.toLowerCase())))
      await Promise.all(snap.docs
        .filter((d) => (d.data().ownerUid ?? null) === null)
        .map((d) => updateDoc(d.ref, { ownerUid: uid })))
    } catch (e) {
      console.warn('[farmsStore] 소유 농장 연결 실패', e)
    }
  }

  async function refreshMemberFarmDocs(farmIds) {
    memberDocsLoading.value = true
    try {
      const snaps = await Promise.all(farmIds.map((id) => getDoc(doc(db, 'farms', id))))
      memberFarmDocs.value = snaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() }))
    } catch (e) {
      console.warn('[farmsStore] 소속 농장 문서 조회 실패', e)
      memberFarmDocs.value = []
    } finally {
      memberDocsLoading.value = false
    }
  }

  async function init() {
    if (initialized.value) return
    initialized.value = true
    farmMembersStore.initGlobal()

    if (!firebaseEnabled || !db) {
      ownedFarmsRaw.value = [{ id: LOCAL_FARM_ID, name: '로컬 농장', logo: '' }]
      activeFarmIdLocal.value = LOCAL_FARM_ID
      ownedLoading.value = false
      memberDocsLoading.value = false
      return
    }

    // 로그인 필수 앱이라, 로그인 상태가 확정된 뒤에야(그리고 로그인/로그아웃/계정
    // 전환마다 다시) 농장 목록 구독을 연다 — 비로그인 상태에선 아예 아무것도
    // 구독하지 않는다(App.vue가 로그인 화면을 띄우므로 필요도 없다).
    watch(
      () => [authStore.loading, authStore.user?.uid, authStore.isSuperAdmin, authStore.needsEmailVerification],
      async ([authLoading, uid, isSuperAdmin, needsVerification]) => {
        if (authLoading) return
        if (!uid || needsVerification) {
          unsubscribeOwned?.()
          ownedFarmsRaw.value = []
          ownedLoading.value = false
          return
        }
        if (!isSuperAdmin) await claimOwnedFarms(uid, authStore.user?.email)
        subscribeOwnedFarms(uid, isSuperAdmin)
      },
      { immediate: true },
    )

    watch(
      () => [farmMembersStore.myFarmIdsLoading, farmMembersStore.myFarmIds],
      ([memberLoading, ids]) => {
        if (memberLoading) { memberDocsLoading.value = true; return }
        if (!ids.length) { memberFarmDocs.value = []; memberDocsLoading.value = false; return }
        refreshMemberFarmDocs(ids)
      },
      { immediate: true, deep: true },
    )
  }

  // 그 이메일로 이미 가입한 계정이 있으면 uid를 찾아 바로 소유자로 연결한다(슈퍼관리자만 users를
  // 조회할 수 있고, 이 함수들도 슈퍼관리자 화면에서만 쓴다). 아직 가입 전이면 null — 그 사람이
  // 가입·로그인할 때 claimOwnedFarms가 연결한다.
  async function findUidByEmail(email) {
    const snap = await getDocs(query(collection(db, 'users'), where('email', '==', email)))
    return snap.docs[0]?.id ?? null
  }

  // 농장 생성은 슈퍼관리자만(규칙). 소유주는 이메일로 지정한다 — 가입 전 이메일도 가능하며,
  // 그 이메일로 가입·로그인하면 자동으로 소유권이 연결된다(claimOwnedFarms). 같은 배치에서
  // 그 이메일의 가입을 허용한다(signupAllowed).
  async function createFarm({ name, logo = '', ownerEmail }) {
    const trimmed = name.trim()
    if (!trimmed) return null
    const email = (ownerEmail || '').trim().toLowerCase()
    if (!email) throw new Error('소유주 이메일을 입력해 주세요.')
    const id = uuid()
    const batch = writeBatch(db)
    batch.set(doc(db, 'farms', id), {
      name: trimmed,
      logo,
      order: farms.value.length,
      createdAt: new Date().toISOString(),
      ownerUid: null,
      ownerEmail: email,
    })
    batch.set(doc(db, 'signupAllowed', email), { farmId: id, at: new Date().toISOString() })
    await batch.commit()
    const uid = await findUidByEmail(email).catch(() => null)
    if (uid) await updateDoc(doc(db, 'farms', id), { ownerUid: uid })
    return id
  }

  async function renameFarm(id, name) {
    const trimmed = name.trim()
    if (!trimmed) return
    await setDoc(doc(db, 'farms', id), { name: trimmed }, { merge: true })
  }

  async function updateFarmLogo(id, logo) {
    await setDoc(doc(db, 'farms', id), { logo: logo || '' }, { merge: true })
  }

  // 소유권 이전(슈퍼관리자용): 새 소유주를 이메일로 지정한다. ownerUid는 비워 두고(null),
  // 새 소유주가 그 이메일로 로그인하면 claim된다 — 그때까지 이전 소유주는 접근 권한이
  // 없다. 규칙상 슈퍼관리자만 소유권(ownerUid·ownerEmail)을 바꿀 수 있다.
  async function updateFarmOwner(id, ownerEmail) {
    const email = (ownerEmail || '').trim().toLowerCase()
    if (!email) throw new Error('소유주 이메일을 입력해 주세요.')
    const batch = writeBatch(db)
    const uid = await findUidByEmail(email).catch(() => null)
    batch.update(doc(db, 'farms', id), { ownerEmail: email, ownerUid: uid })
    batch.set(doc(db, 'signupAllowed', email), { farmId: id, at: new Date().toISOString() })
    await batch.commit()
  }

  // 목록에서만 뺀다(휴지통 보관) — 실제 데이터(farms/{id}/data/*, treatments/*)는 그대로 남아
  // 있어서 "삭제된 농장" 섹션에서 복원하거나 영구 삭제할 수 있다.
  async function deleteFarm(id) {
    if (farms.value.length <= 1) return false // 마지막 농장은 삭제 불가
    if (activeFarm.value?.id === id) return false // 사용 중인 농장은 다른 농장으로 전환 후 삭제
    await setDoc(doc(db, 'farms', id), { deletedAt: new Date().toISOString() }, { merge: true })
    return true
  }

  // 삭제된 농장을 목록으로 되돌린다.
  async function restoreFarm(id) {
    await setDoc(doc(db, 'farms', id), { deletedAt: deleteField() }, { merge: true })
  }

  // 삭제된 농장의 실제 데이터까지 완전히 지운다. 되돌릴 수 없다.
  async function permanentlyDeleteFarm(id) {
    await Promise.all(DOMAIN_KEYS.map((key) => deleteDoc(doc(db, 'farms', id, 'data', key))))
    await deleteDoc(doc(db, 'farms', id, 'data', 'availablePesticide'))
    await deleteDoc(doc(db, 'farms', id, 'data', 'recommendSettings'))
    await deleteDoc(doc(db, 'farms', id, 'data', 'treatments'))
    // farmId가 이 농장으로 붙은(마이그레이션된) 사진도 같이 지운다. farmId가 없는
    // (마이그레이션 안 된) 사진은 원래도 그랬듯 손대지 않는다 — 어느 농장 것인지
    // 확실하지 않은 걸 지우면 다른 농장이 참조 중인 사진을 지울 위험이 있다.
    const photosSnap = await getDocs(query(collection(db, 'photos'), where('farmId', '==', id)))
    await Promise.all(photosSnap.docs.map((d) => deleteDoc(d.ref)))
    await deleteDoc(doc(db, 'farms', id))
  }

  function selectFarm(id) {
    localStorage.setItem(LS_ACTIVE, id)
    localStorage.setItem(LS_MODE, 'farm')
    window.location.hash = '#/' // 선택한 농장의 대시보드로 진입
    window.location.reload()
  }

  function enterAdminMode() {
    localStorage.setItem(LS_MODE, 'admin')
    window.location.hash = '#/settings'
    window.location.reload()
  }

  // 농장 모드/관리자 모드에서 선택 화면으로 되돌아간다. 명시적으로 빈 값을 기록해
  // 다음 로드 때 "한 번도 선택한 적 없음" 자동 연속성 로직이 다시 끼어들지 않게 한다.
  function exitToSelector() {
    localStorage.removeItem(LS_ACTIVE)
    localStorage.setItem(LS_MODE, '')
    window.location.reload()
  }

  return {
    farms, deletedFarms, loading, accessError, reportAccessError,
    activeFarm, isAdminMode, noFarmAccess, needsFarmSelect, farmCount: computed(() => farms.value.length),
    init, createFarm, renameFarm, updateFarmLogo, updateFarmOwner, deleteFarm, restoreFarm, permanentlyDeleteFarm,
    selectFarm, enterAdminMode, exitToSelector,
  }
})
