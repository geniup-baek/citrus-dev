import { defineStore } from 'pinia'
import { nextTick, reactive, watch } from 'vue'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db, firebaseEnabled } from '../services/firebase.js'
import { useFarmsStore } from './farmsStore.js'

const LEGACY_LS_KEY = 'citrus:recommend-settings' // 농장 분리 이전 통합 키 (1회 이전용)
const PREF_LS_KEY = 'citrus:recommend-prefs' // 공통(농장 무관) 동작 설정 — 기기 로컬

function policyLsKey(farmId) {
  return `citrus:recommend-policy:${farmId}`
}

// 농약 사용 "정책" — 농장마다 다를 수 있어 농장별로 저장(Firestore 공유 + 농장별 로컬 캐시).
const FARM_POLICY_DEFAULTS = {
  moaConflictDays: 60,
  enforceMaxApplications: true,
  maxApplicationsPerYear: 3,
  preferPesticideMaxApplications: true,
  excludeToxicGrades: ['고독성', '맹독성'],
  excludeFishToxicGrades: ['Ⅰ급'],
  overwriteLinkedTreatments: false, // 방제이력 전체 재연결 시 이미 연결된 이력도 다시 연결할지 여부
  bulkImportMode: 'append', // 'append' | 'replace' — 붙여넣기 일괄추가 시 기존 목록에 더할지, 전체를 새로 작성할지
  showResetButtons: false, // 이 농장의 목록 편집모드(방제이력·농약재고·가용농약·재배동·시설장비·묘목·비료재고·작업·문제)에 "초기화" 버튼을 노출할지 여부
  showChangeLogDeleteButtons: false, // 이 농장의 "변경 이력" 탭에 개별/전체 삭제 버튼을 노출할지 여부
  grownVarieties: [], // 이 농장에서 실제로 재배하는 묘목 품종(복수). 비어 있으면 전체 품종을 제한 없이 표시
}

// 순수 "동작" 설정 — 기기/앱 전역 동작이라 농장과 무관하며, 기기 로컬에만 저장한다(동기화 없음).
// 기기 간에도 동일하게 적용돼야 하는 동작 설정(PDF 출력·초기화 기능 등)은 appPolicyStore에 있다.
const COMMON_PREF_DEFAULTS = {
  skipCachedPesticideDetails: true, // 농약 상세정보 전체 가져오기 시 이미 캐시된 항목은 건너뛸지 여부
}

const DEFAULTS = { ...FARM_POLICY_DEFAULTS, ...COMMON_PREF_DEFAULTS }
const POLICY_KEYS = Object.keys(FARM_POLICY_DEFAULTS)
const PREF_KEYS = Object.keys(COMMON_PREF_DEFAULTS)

function pick(obj, keys) {
  const out = {}
  keys.forEach((k) => { if (obj?.[k] !== undefined) out[k] = obj[k] })
  return out
}

export const useRecommendSettingsStore = defineStore('recommendSettings', () => {
  // 구버전(농장 분리 이전, 그리고 한때 시스템 공통정책이었던 시절) 설정 — 마이그레이션 fallback용으로만 읽는다.
  let legacy = {}
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_LS_KEY) ?? '{}') } catch {}

  let savedPrefs = {}
  try { savedPrefs = JSON.parse(localStorage.getItem(PREF_LS_KEY) ?? '{}') } catch {}

  // 표면은 하나의 반응형 객체로 유지한다 — 화면 바인딩(v-model="settings.X")은 변경할 필요가 없다.
  const settings = reactive({
    ...DEFAULTS,
    ...pick(legacy, PREF_KEYS),
    ...savedPrefs,
  })

  let initialized = false
  let activeFarmId = null
  let policyDebounce = null
  let applyingRemotePolicy = false

  // 동작 설정(공통, 기기 로컬)은 항상 로컬에 즉시 저장 — 농장과 무관하므로 초기화 전에도 안전하게 동작한다.
  watch(() => pick(settings, PREF_KEYS), (v) => {
    try { localStorage.setItem(PREF_LS_KEY, JSON.stringify(v)) } catch {}
  }, { deep: true })

  function persistPolicyLocal() {
    if (!activeFarmId) return
    try { localStorage.setItem(policyLsKey(activeFarmId), JSON.stringify(pick(settings, POLICY_KEYS))) } catch {}
  }

  function schedulePolicyFirestoreWrite() {
    if (!firebaseEnabled || !db || !activeFarmId) return
    clearTimeout(policyDebounce)
    policyDebounce = setTimeout(async () => {
      try {
        await setDoc(
          doc(db, 'farms', activeFarmId, 'data', 'recommendSettings'),
          pick(settings, POLICY_KEYS),
          { merge: true },
        )
      } catch (e) {
        console.warn('[recommendSettingsStore] Firestore write failed, will retry on next change.', e)
      }
    }, 500)
  }

  // 정책 설정(농장별) 변경 감지 → 로컬+Firestore 저장. 단, 원격 스냅샷을 반영하는 동안에는
  // 되돌려 쓰지 않도록 applyingRemotePolicy 가드를 둔다(무한 왕복 방지).
  watch(() => pick(settings, POLICY_KEYS), () => {
    if (applyingRemotePolicy) return
    persistPolicyLocal()
    schedulePolicyFirestoreWrite()
  }, { deep: true })

  function init(farmId) {
    if (initialized) return
    initialized = true
    activeFarmId = farmId

    let localPolicy = {}
    try { localPolicy = JSON.parse(localStorage.getItem(policyLsKey(farmId)) ?? '{}') } catch {}

    applyingRemotePolicy = true
    Object.assign(settings, pick({ ...FARM_POLICY_DEFAULTS, ...pick(legacy, POLICY_KEYS), ...localPolicy }, POLICY_KEYS))
    nextTick(() => { applyingRemotePolicy = false })

    if (firebaseEnabled && db) {
      onSnapshot(
        doc(db, 'farms', farmId, 'data', 'recommendSettings'),
        (snap) => {
          applyingRemotePolicy = true
          if (snap.exists()) {
            Object.assign(settings, pick({ ...FARM_POLICY_DEFAULTS, ...snap.data() }, POLICY_KEYS))
            persistPolicyLocal()
          } else if (Object.keys(pick(legacy, POLICY_KEYS)).length) {
            // 구버전 통합 설정에 정책값이 남아 있으면 새 농장별 문서로 1회 승격 저장한다.
            schedulePolicyFirestoreWrite()
          }
          nextTick(() => { applyingRemotePolicy = false })
        },
        (err) => useFarmsStore().reportAccessError(err),
      )
    }
  }

  function reset() { Object.assign(settings, DEFAULTS) }

  function restoreSettings(data) { Object.assign(settings, { ...DEFAULTS, ...data }) }

  return { settings, init, reset, restoreSettings }
})
