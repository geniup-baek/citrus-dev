import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { endOfMonth, endOfWeek, isBefore, isSameDay, parseISO, startOfDay, startOfMonth, startOfWeek } from 'date-fns'
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore'
import { db, firebaseEnabled } from '../services/firebase'
import { defaultAppSettings } from '../data/defaults'
import {
  createDefaultFarmData, normalizeAppSettings, normalizeFarmData, farmStorageKey,
  DOMAIN_SYNC, DOMAIN_KEYS, domainFields,
} from '../utils/farmDataSchema.js'
import { createChangeLogActions } from './farmStore/changeLog.js'
import { createRevertActions } from './farmStore/revert.js'
import { createPhotoActions } from './farmStore/photos.js'
import { createFacilityActions } from './farmStore/facilities.js'
import { createAncillaryActions } from './farmStore/ancillaries.js'
import { createSeedlingActions } from './farmStore/seedlings.js'
import { createTaskActions } from './farmStore/tasks.js'
import { createSchedulerActions } from './farmStore/scheduler.js'
import { createIssueActions } from './farmStore/issues.js'
import { createUsageGuideActions } from './farmStore/usageGuides.js'
import { createInventoryActions } from './farmStore/inventory.js'
import { createBackupActions } from './farmStore/backup.js'
import { useFarmsStore } from './farmsStore.js'
import { useFarmMembersStore } from './farmMembersStore.js'
import { LS_PREFIX } from '../utils/storagePrefix.js'

// 이 파일은 스토어의 배관(초기화·저장·구독)과 각 도메인 모듈을 엮는 역할만 한다.
// 실제 CRUD 로직은 ./farmStore/*.js에 도메인별로 나뉘어 있다 — 전체 구조는
// MAINTENANCE.md의 "스토어 지도"와 src/stores/farmStore/ 폴더의 파일 목록을 참고.
//
// 농장 데이터는 farms/{farmId}/data/{도메인키} 문서로 나뉘어 저장된다(도메인 목록은
// src/utils/farmDataSchema.js의 DOMAIN_SYNC 참고) — 예전엔 farmData 문서 하나에 전부 있었다.

const APP_SETTINGS_LS_KEY = `${LS_PREFIX}:app-settings` // 공통(농장 무관) 분류·항목 설정
const ACTOR_NAME_LS_KEY = `${LS_PREFIX}:actor-name` // 이 기기에서 변경 이력에 표시할 이름(기기별 로컬 저장, 서버 동기화 안 함)

export const useFarmStore = defineStore('farm', () => {
  const initialized = ref(false)
  const state = ref({ ...createDefaultFarmData(), appSettings: { ...defaultAppSettings } })
  let unsubscribers = []
  let appSettingsUnsub = null
  let activeFarmId = null

  // 이 기기에서 변경 이력에 표시할 이름(로그인 없이 기기별로 로컬에만 저장, 농장 데이터와 별도)
  const actorName = ref('')
  try {
    actorName.value = localStorage.getItem(ACTOR_NAME_LS_KEY) || ''
  } catch {
    /* noop */
  }

  function setActorName(name) {
    actorName.value = (name || '').trim()
    try {
      localStorage.setItem(ACTOR_NAME_LS_KEY, actorName.value)
    } catch {
      /* noop */
    }
  }

  const today = computed(() => new Date())
  const weekStart = computed(() => startOfWeek(today.value, { weekStartsOn: 1 }))
  const weekEnd = computed(() => endOfWeek(today.value, { weekStartsOn: 1 }))
  const monthStart = computed(() => startOfMonth(today.value))
  const monthEnd = computed(() => endOfMonth(today.value))

  const openIssues = computed(() =>
    state.value.issues.filter((issue) => issue.status !== '해결'),
  )

  const taskSummary = computed(() => {
    const counts = { '예정': 0, '진행중': 0, '완료': 0 }
    state.value.tasks.forEach((task) => {
      counts[task.status] += 1
    })
    return counts
  })

  // 작업 보드의 "오늘 미완료"와 동일한 기준: 오늘이 마감이거나 이미 마감이 지난(기한 초과)
  // 미완료 작업까지 포함한다 — 마감일이 정확히 오늘인 작업만 세면 대시보드 숫자가
  // 작업 보드보다 항상 작게 보이는 문제가 있었다.
  const tasksToday = computed(() => {
    const todayStart = startOfDay(today.value)
    return state.value.tasks.filter((task) => {
      const due = parseISO(task.dueDate)
      return isSameDay(due, today.value) || isBefore(due, todayStart)
    })
  })

  // 작업 보드의 기간 필터와 동일하게, 기간 이전이 마감이라도 미완료 작업은 계속 포함한다
  // (기한을 넘긴 작업이 '이번 주 우선 작업' 목록에서 사라지지 않도록).
  const tasksThisWeek = computed(() =>
    state.value.tasks.filter((task) => {
      const due = parseISO(task.dueDate)
      const inRange = due >= weekStart.value && due <= weekEnd.value
      const carriedOver = due < weekStart.value && task.status !== '완료'
      return inRange || carriedOver
    }),
  )

  const tasksThisMonth = computed(() =>
    state.value.tasks.filter((task) => {
      const due = parseISO(task.dueDate)
      const inRange = due >= monthStart.value && due <= monthEnd.value
      const carriedOver = due < monthStart.value && task.status !== '완료'
      return inRange || carriedOver
    }),
  )

  // 로컬(오프라인 폴백/로컬 전용 모드) 캐시는 지금도 농장 데이터 전체를 문서 하나 분량으로
  // 묶어 저장한다 — localStorage엔 1 MiB 같은 문서 용량 한도가 없고, 기기 하나짜리라
  // Firestore처럼 동시 쓰기 충돌도 없으므로 굳이 나눌 이유가 없다.
  function persistLocal() {
    if (!activeFarmId) return
    const { appSettings, ...farmData } = state.value
    localStorage.setItem(farmStorageKey(activeFarmId), JSON.stringify(farmData))
    localStorage.setItem(APP_SETTINGS_LS_KEY, JSON.stringify(appSettings))
  }

  // 도메인 키(farmDataSchema.js의 DOMAIN_SYNC 참고)마다 독립적으로 디바운스한다 — 재배동을
  // 수정한 직후 작업을 수정해도 서로의 예약된 저장을 취소하지 않는다.
  const firestoreDebounceTimers = {}

  function scheduleFirestoreWriteForDomain(key) {
    if (!firebaseEnabled || !db || !activeFarmId) return
    clearTimeout(firestoreDebounceTimers[key])
    firestoreDebounceTimers[key] = setTimeout(async () => {
      try {
        const payload = {}
        domainFields(key).forEach((field) => { payload[field] = state.value[field] })
        payload.updatedAt = state.value.updatedAt
        const ref = doc(db, 'farms', activeFarmId, 'data', key)
        await setDoc(ref, payload, { merge: true })
      } catch (e) {
        console.warn(`[farmStore] Firestore 저장 실패(${key} 문서), 다음 변경 때 다시 시도합니다.`, e)
      }
    }, 500)
  }

  let appSettingsDebounceTimer = null

  function scheduleAppSettingsWrite() {
    if (!firebaseEnabled || !db) return
    clearTimeout(appSettingsDebounceTimer)
    appSettingsDebounceTimer = setTimeout(async () => {
      try {
        await setDoc(doc(db, 'shared', 'appSettings'), state.value.appSettings, { merge: true })
      } catch (e) {
        console.warn('[farmStore] appSettings Firestore write failed, will retry on next change.', e)
      }
    }, 500)
  }

  // 도메인 모듈이 데이터를 바꾼 뒤 호출한다. domainKeys로 실제 바뀐 문서만 지정하면
  // 그 문서(들)만 Firestore에 쓴다 — changeLog는 거의 모든 변경에 함께 남으므로 항상 포함한다.
  // domainKeys를 생략하면 changeLog만(예: 이력 자체를 지우는 동작), 'all'이면 전체 문서를 쓴다.
  async function persist(domainKeys) {
    state.value.updatedAt = new Date().toISOString()
    persistLocal()
    const keys = new Set(['changeLog'])
    const list = domainKeys === 'all' ? DOMAIN_KEYS : Array.isArray(domainKeys) ? domainKeys : [domainKeys]
    list.filter(Boolean).forEach((key) => keys.add(key))
    keys.forEach((key) => scheduleFirestoreWriteForDomain(key))
    photoActions.gcOrphanPhotos()
  }

  // ── 변경 이력(감사 로그) ──────────────────────────────────────────────────────
  const { logChange, facilityNameById } = createChangeLogActions(state, actorName)

  // ── 사진 분산 저장 ───────────────────────────────────────────────────────────
  const photoActions = createPhotoActions(state, persist, () => activeFarmId)

  function loadLocal() {
    const raw = localStorage.getItem(farmStorageKey(activeFarmId))
    const rawSettings = localStorage.getItem(APP_SETTINGS_LS_KEY)

    let farmData = null
    try { farmData = raw ? JSON.parse(raw) : null } catch { farmData = null }
    let appSettings = null
    try { appSettings = rawSettings ? JSON.parse(rawSettings) : null } catch { appSettings = null }

    state.value = {
      ...normalizeFarmData(farmData),
      appSettings: normalizeAppSettings(appSettings),
    }
    if (!raw) persistLocal()
  }

  let appSettingsInitialized = false

  // 분류·항목(appSettings)은 모든 농장이 공유하는 문서라 농장 선택과 무관하다.
  // 시스템 관리 모드에는 활성 농장이 없어 init(farmId)가 호출되지 않으므로,
  // 그 화면에서도 실시간 데이터를 읽을 수 있도록 별도로 구독한다(App.vue에서 무조건 호출).
  function initAppSettings() {
    if (appSettingsInitialized) return
    appSettingsInitialized = true
    if (!firebaseEnabled || !db) return
    const appSettingsRef = doc(db, 'shared', 'appSettings')
    appSettingsUnsub = onSnapshot(
      appSettingsRef,
      (snapshot) => {
        state.value.appSettings = normalizeAppSettings(snapshot.exists() ? snapshot.data() : null)
      },
      (err) => console.warn('[farmStore] appSettings 구독 실패', err),
    )
  }

  // 이 농장이 아직 신버전(도메인별) 문서로 옮겨지지 않았으면 한 번만 옮긴다.
  // - 완전 신규 농장(구버전 문서도 없음): 각 문서를 기본값으로 새로 만든다.
  // - 기존 농장(구버전 farmData 문서 있음): 그 데이터를 도메인별로 나눠 옮겨 쓴다.
  // 구버전 farmData 문서는 안전을 위해 지우지 않고 그대로 남겨둔다(farmsStore.js의 기존
  // 마이그레이션 관례와 동일 — 되돌아갈 여지를 남겨둔다).
  async function ensureFarmDocumentsExist(farmId) {
    const facilitiesSnap = await getDoc(doc(db, 'farms', farmId, 'data', 'facilities'))
    if (facilitiesSnap.exists()) return // 이미 신버전으로 옮겨진 농장

    const legacySnap = await getDoc(doc(db, 'farms', farmId, 'data', 'farmData'))
    const legacy = legacySnap.exists() ? legacySnap.data() : null
    const now = new Date().toISOString()

    await Promise.all(
      DOMAIN_KEYS.map((key) => {
        const payload = DOMAIN_SYNC[key](legacy)
        payload.updatedAt = now
        return setDoc(doc(db, 'farms', farmId, 'data', key), payload)
      }),
    )
  }

  // farmId: 활성 농장 id. farmsStore에서 결정되어 App.vue가 넘겨준다.
  async function init(farmId) {
    if (initialized.value) {
      return
    }
    activeFarmId = farmId

    if (firebaseEnabled && db) {
      const farmMembersStore = useFarmMembersStore()
      // 권한이 제한된 구성원은 자기 권한 확인(farmMembersStore.ready())이 끝날
      // 때까지 기다린 뒤, 읽기 권한이 있는 도메인만 구독한다 — 그러지 않으면
      // 권한 없는 도메인 구독이 전부 거부되어 read-only 구성원이 애초에 볼 수
      // 있는 도메인조차 못 불러온다(문서 시딩도 마찬가지 이유로 건너뜀).
      await farmMembersStore.ready()
      const readableKeys = farmMembersStore.hasFullAccess
        ? DOMAIN_KEYS
        : DOMAIN_KEYS.filter((key) => farmMembersStore.canRead(key))

      // 구독하지 않는(=읽을 권한이 없는) 도메인은 state의 기본 예시 데이터(신규 농장
      // 시연용 샘플)가 그대로 남아있게 된다 — 대시보드처럼 권한과 무관하게 항상 보이는
      // 화면에서 "가짜 데이터가 실제인 것처럼" 보이면 안 되므로 빈 배열로 비운다.
      if (readableKeys.length < DOMAIN_KEYS.length) {
        const emptyOverrides = {}
        DOMAIN_KEYS.filter((key) => !readableKeys.includes(key)).forEach((key) => { emptyOverrides[key] = [] })
        state.value = { ...state.value, ...emptyOverrides }
      }

      if (farmMembersStore.hasFullAccess) {
        await ensureFarmDocumentsExist(farmId)
      }

      // 신버전 문서들을 각각 구독한다. 최초 로드 때 (읽기 권한이 있는 것) 전부 한 번씩
      // 도착한 뒤에야 "사진 참조 스냅샷 기준점 잡기 + 인라인 사진 이전"을 한 번
      // 수행한다(하나만 보고 판단하면 아직 안 들어온 다른 문서의 사진 참조를 놓칠 수
      // 있다). 권한이 제한된 구성원은 이 하우스키핑을 건너뛴다 — 농장을 처음
      // 준비하는 소유자·슈퍼관리자의 몫이다.
      const loadedKeys = new Set()
      let firstSyncDone = readableKeys.length === 0 || !farmMembersStore.hasFullAccess

      readableKeys.forEach((key) => {
        const ref = doc(db, 'farms', farmId, 'data', key)
        const unsub = onSnapshot(
          ref,
          async (snapshot) => {
            const normalized = DOMAIN_SYNC[key](snapshot.exists() ? snapshot.data() : null)
            state.value = { ...state.value, ...normalized }
            persistLocal()

            if (!snapshot.exists() && farmMembersStore.canWrite(key)) {
              // ensureFarmDocumentsExist가 먼저 만들어두므로 정상 경로에선 거의 없지만,
              // 문서가 구독 시작 이후 지워지는 등의 예외 상황에 대한 안전망이다. 쓰기
              // 권한이 없으면 이 자가치유 쓰기도 거부되므로 시도하지 않는다.
              await persist(key)
            }

            if (!firstSyncDone) {
              loadedKeys.add(key)
              if (loadedKeys.size === readableKeys.length) {
                firstSyncDone = true
                photoActions.resetKnownPhotoIds()
                await photoActions.migrateInlinePhotos()
              }
            }
          },
          (err) => useFarmsStore().reportAccessError(err),
        )
        unsubscribers.push(unsub)
      })
    } else {
      loadLocal()
      photoActions.resetKnownPhotoIds()
      await schedulerActions.runTaskScheduler({
        daysAhead: state.value.scheduleSettings.generationDays,
        duplicatePolicy: state.value.scheduleSettings.duplicatePolicy,
        persist: true,
      })
    }

    initialized.value = true
  }

  function cleanup() {
    unsubscribers.forEach((unsub) => {
      if (typeof unsub === 'function') unsub()
    })
    unsubscribers = []
    if (typeof appSettingsUnsub === 'function') {
      appSettingsUnsub()
      appSettingsUnsub = null
    }
  }

  async function updateAppSettings(payload) {
    state.value.appSettings = { ...state.value.appSettings, ...payload }
    try { localStorage.setItem(APP_SETTINGS_LS_KEY, JSON.stringify(state.value.appSettings)) } catch {}
    scheduleAppSettingsWrite()
  }

  // ── 도메인 모듈 조립 ─────────────────────────────────────────────────────────
  // 모든 도메인 모듈이 공유하는 컨텍스트. logChange/facilityNameById는 changeLog.js,
  // photoCache 등은 photos.js에서 만든 것을 그대로 넘긴다.
  const ctx = {
    state,
    persist,
    logChange,
    facilityNameById,
    photoCache: photoActions.photoCache,
    savePhotos: photoActions.savePhotos,
    currentReferencedPhotoIds: photoActions.currentReferencedPhotoIds,
    migrateInlinePhotos: photoActions.migrateInlinePhotos,
    appSettingsLsKey: APP_SETTINGS_LS_KEY,
    scheduleAppSettingsWrite,
    getFarmId: () => activeFarmId,
  }

  const facilityActions = createFacilityActions(ctx)
  const ancillaryActions = createAncillaryActions(ctx)
  const seedlingActions = createSeedlingActions(ctx)
  const taskActions = createTaskActions(ctx)
  const schedulerActions = createSchedulerActions(ctx)
  const issueActions = createIssueActions(ctx)
  const usageGuideActions = createUsageGuideActions(ctx)
  const inventoryActions = createInventoryActions(ctx)
  const backupActions = createBackupActions(ctx)

  // 되돌리기는 위 도메인 모듈들의 upsert/update 함수를 그대로 호출해야 하므로,
  // 전부 만들어진 뒤 마지막에 registry로 묶어 넘긴다(순환 참조 회피).
  const revertActions = createRevertActions(state, persist, {
    upsertFacility: facilityActions.upsertFacility,
    upsertAncillary: ancillaryActions.upsertAncillary,
    upsertSeedling: seedlingActions.upsertSeedling,
    upsertTask: taskActions.upsertTask,
    upsertChecklistTemplate: taskActions.upsertChecklistTemplate,
    upsertIssue: issueActions.upsertIssue,
    upsertUsageGuide: usageGuideActions.upsertUsageGuide,
    upsertInventoryItem: inventoryActions.upsertInventoryItem,
    updateTaskLog: taskActions.updateTaskLog,
    updateChecklistItem: taskActions.updateChecklistItem,
    updateSeedlingLog: seedlingActions.updateSeedlingLog,
    updateIssueResolutionStep: issueActions.updateIssueResolutionStep,
    updateUsageGuideStep: usageGuideActions.updateUsageGuideStep,
    updateInventoryTxn: inventoryActions.updateInventoryTxn,
  })

  return {
    firebaseEnabled,
    initialized,
    state,
    openIssues,
    taskSummary,
    tasksToday,
    tasksThisWeek,
    tasksThisMonth,
    init,
    initAppSettings,
    cleanup,
    photoSrc: photoActions.photoSrc,
    savePhotos: photoActions.savePhotos,
    updateAppSettings,
    ...facilityActions,
    ...ancillaryActions,
    ...seedlingActions,
    ...taskActions,
    ...schedulerActions,
    ...issueActions,
    ...usageGuideActions,
    ...inventoryActions,
    ...backupActions,
    actorName,
    setActorName,
    logChange,
    ...revertActions,
  }
})
