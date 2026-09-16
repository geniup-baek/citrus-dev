import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  collection, doc, getDoc, getDocs, onSnapshot, setDoc, deleteDoc, deleteField,
} from 'firebase/firestore'
import { db, firebaseEnabled } from '../services/firebase.js'
import { uuid } from '../utils/uuid.js'
import { DOMAIN_KEYS } from '../utils/farmDataSchema.js'
import { useAuthStore } from './authStore.js'

const LS_ACTIVE = 'citrus:active-farm'
const LS_MODE = 'citrus:app-mode' // '' | 'farm' | 'admin'. localStorage에 키 자체가 없으면(null) "한 번도 선택한 적 없음"으로 취급한다.
const LOCAL_FARM_ID = 'local' // Firebase 비활성(로컬 전용) 환경에서 쓰는 고정 농장 id

// 기존 단일 농장 데이터를 다중 농장 구조로 1회 이전한다.
// - shared/farmData(appSettings 제외) → farms/main/data/farmData
// - shared/farmData.appSettings      → shared/appSettings (공통)
// - shared/availablePesticide        → farms/main/data/availablePesticide
// - treatments/*                     → farms/main/treatments/*
// 기존 문서는 안전을 위해 삭제하지 않고 그대로 둔다.
async function migrateLegacyIfNeeded() {
  const metaRef = doc(db, 'shared', 'appMeta')
  const metaSnap = await getDoc(metaRef)
  if (metaSnap.exists() && metaSnap.data()?.multiFarmMigratedV1) return

  const legacySnap = await getDoc(doc(db, 'shared', 'farmData'))
  if (!legacySnap.exists()) {
    // 이전할 기존 데이터가 없는 완전히 새로운 환경 — 가드만 세우고 종료.
    await setDoc(metaRef, { multiFarmMigratedV1: true }, { merge: true })
    return
  }

  const legacyData = legacySnap.data()
  const { appSettings, ...farmDataRest } = legacyData

  const farmId = 'main'
  await setDoc(doc(db, 'farms', farmId), {
    name: '농장 1',
    logo: '',
    order: 0,
    createdAt: new Date().toISOString(),
  })
  await setDoc(doc(db, 'farms', farmId, 'data', 'farmData'), farmDataRest, { merge: true })
  if (appSettings && typeof appSettings === 'object') {
    await setDoc(doc(db, 'shared', 'appSettings'), appSettings, { merge: true })
  }

  const apSnap = await getDoc(doc(db, 'shared', 'availablePesticide'))
  if (apSnap.exists()) {
    await setDoc(doc(db, 'farms', farmId, 'data', 'availablePesticide'), apSnap.data(), { merge: true })
  }

  const treatSnap = await getDocs(collection(db, 'treatments'))
  for (const d of treatSnap.docs) {
    await setDoc(doc(db, 'farms', farmId, 'treatments', d.id), d.data())
  }

  await setDoc(metaRef, { multiFarmMigratedV1: true }, { merge: true })
}

export const useFarmsStore = defineStore('farms', () => {
  const authStore = useAuthStore()
  const allFarms = ref([]) // 삭제(휴지통 보관) 포함 전체 농장 문서
  const loading = ref(true)
  const initialized = ref(false)
  const migrationError = ref(null)

  // 화면 전반(선택화면·헤더·라우터 등)에서 쓰는 목록은 삭제된 농장을 제외한다.
  const farms = computed(() => allFarms.value.filter((f) => !f.deletedAt))
  // 삭제(휴지통 보관)된 농장 — 최근 삭제 순으로 정렬. 설정의 "삭제된 농장" 섹션에서만 사용.
  const deletedFarms = computed(() =>
    allFarms.value
      .filter((f) => f.deletedAt)
      .sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || '')),
  )

  // localStorage에 키가 아예 없으면(null) "한 번도 선택한 적 없음" — 기존 단일 농장
  // 사용자를 위한 최초 1회 자동 연속성 판단에 쓰인다. 이후로는 항상 명시적인 값('', 'farm', 'admin')을 갖는다.
  const everChosen = localStorage.getItem(LS_MODE) !== null
  const modeLocal = ref(localStorage.getItem(LS_MODE) || '')
  const activeFarmIdLocal = ref(localStorage.getItem(LS_ACTIVE) || '')

  const isAdminMode = computed(() => modeLocal.value === 'admin')

  const activeFarm = computed(() => {
    if (isAdminMode.value) return null
    return farms.value.find((f) => f.id === activeFarmIdLocal.value) || null
  })

  // 마이그레이션이 실패했는데 농장이 0개로 보이면 "새 농장 만들기"를 띄우지 않는다 —
  // 기존 데이터가 남아있는 채로 새 빈 농장을 만들게 되는 혼란을 막기 위함. 새로고침 재시도를 유도한다.
  const needsFarmCreate = computed(() => !loading.value && !migrationError.value && !isAdminMode.value && farms.value.length === 0)
  const needsFarmSelect = computed(() => !loading.value && !isAdminMode.value && farms.value.length > 0 && !activeFarm.value)

  async function init() {
    if (initialized.value) return
    initialized.value = true

    if (!firebaseEnabled || !db) {
      allFarms.value = [{ id: LOCAL_FARM_ID, name: '로컬 농장', logo: '' }]
      activeFarmIdLocal.value = LOCAL_FARM_ID
      loading.value = false
      return
    }

    try {
      await migrateLegacyIfNeeded()
    } catch (e) {
      console.warn('[farmsStore] 마이그레이션 실패', e)
      migrationError.value = e
      loading.value = false
      return // 농장 목록 구독을 시작하지 않는다 — 불완전한 상태로 UI가 진행되지 않도록.
    }

    onSnapshot(collection(db, 'farms'), (snap) => {
      allFarms.value = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

      // 최초 1회 자동 연속성: 한 번도 모드를 선택한 적 없고 농장이 단 하나뿐이면
      // 선택화면 없이 그 농장 모드로 바로 진입한다(기존 단일 농장 사용자 무중단 전환).
      if (!everChosen && !modeLocal.value && farms.value.length === 1) {
        activeFarmIdLocal.value = farms.value[0].id
        modeLocal.value = 'farm'
        localStorage.setItem(LS_ACTIVE, farms.value[0].id)
        localStorage.setItem(LS_MODE, 'farm')
      }

      loading.value = false
    })
  }

  async function createFarm({ name, logo = '', pin = '' }) {
    const trimmed = name.trim()
    if (!trimmed) return null
    const id = uuid()
    // 만든 사람이 로그인 상태일 때만 소유자가 정해진다. 비로그인(시스템 관리 PIN)
    // 생성은 지금까지처럼 소유자 없는 농장으로 남는다 — 아직 아무것도 강제하지 않는다.
    const ownerUid = authStore.user?.uid || null
    await setDoc(doc(db, 'farms', id), {
      name: trimmed,
      logo,
      pin: pin.trim(),
      order: farms.value.length,
      createdAt: new Date().toISOString(),
      ownerUid,
      visibility: ownerUid ? 'private' : 'public',
    })
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

  // PIN은 선택 항목이며 실제 인증이 아니라 실수로 다른 농장에 들어가는 것을 막는
  // 가벼운 안전장치다(이 앱은 별도 로그인 없이 모두가 같은 Firestore를 공유한다).
  async function updateFarmPin(id, pin) {
    await setDoc(doc(db, 'farms', id), { pin: pin.trim() }, { merge: true })
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
    const treatSnap = await getDocs(collection(db, 'farms', id, 'treatments'))
    await Promise.all(treatSnap.docs.map((d) => deleteDoc(d.ref)))
    // farmData는 구버전(단일 문서) 잔재, 나머지는 도메인별 신버전 문서(src/utils/farmDataSchema.js의
    // DOMAIN_SYNC) — 마이그레이션 시점과 무관하게 둘 다 지운다(둘 중 하나만 있을 수도 있어서).
    await Promise.all(
      ['farmData', ...DOMAIN_KEYS].map((key) => deleteDoc(doc(db, 'farms', id, 'data', key))),
    )
    await deleteDoc(doc(db, 'farms', id, 'data', 'availablePesticide'))
    await deleteDoc(doc(db, 'farms', id, 'data', 'recommendSettings'))
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
    farms, deletedFarms, loading, migrationError, activeFarm, isAdminMode, needsFarmCreate, needsFarmSelect,
    init, createFarm, renameFarm, updateFarmLogo, updateFarmPin, deleteFarm, restoreFarm, permanentlyDeleteFarm,
    selectFarm, enterAdminMode, exitToSelector,
  }
})
