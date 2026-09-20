// 농장 데이터의 기본값·정규화 + Firestore 문서 분할 지도 — state를 전혀 참조하지 않는
// 순수 함수만 모아둔다(init/loadLocal/onSnapshot/restoreBackup 등 "외부에서 들어온 데이터를
// 안전한 모양으로 맞추는" 지점에서 공통으로 쓰인다).
//
// farmStore.js·farmStore/*.js(issues.js·inventory.js·usageGuides.js·scheduler.js·backup.js)뿐
// 아니라 farmsStore.js(농장 완전 삭제)·services/adminBackup.js(관리자 백업)처럼 farmStore 묶음
// 바깥에서도 "농장 데이터가 어느 문서에 나뉘어 있는지"를 알아야 하는 코드가 있어 여기(utils/)에
// 둔다 — src/utils/changeLogUtils.js가 treatmentStore.js 때문에 옮겨진 것과 같은 이유.
import {
  annualTaskTemplates,
  defaultAncillaries,
  defaultAppSettings,
  defaultFacilities,
  defaultIssues,
  defaultScheduleRules,
  defaultSeedlings,
  defaultTasks,
  defaultInventory,
  defaultUsageGuides,
} from '../data/defaults'
import { uuid } from './uuid.js'
import { LS_PREFIX } from './storagePrefix.js'

export function farmStorageKey(farmId) {
  return `${LS_PREFIX}-farm-${farmId}-v1`
}

// ── Firestore 문서 분할 지도 ──────────────────────────────────────────────────
// 농장 데이터는 예전엔 farms/{farmId}/data/farmData 문서 하나에 전부 들어있었다.
// 지금은 아래 키마다 farms/{farmId}/data/{key} 문서를 따로 둔다 — 항목 하나를 고칠 때
// 문서 전체(다른 모든 항목 + 변경 이력)를 통째로 다시 쓰지 않게 하기 위함이다
// (Firestore 1 MiB 한도 여유, undefined 값 하나가 전체 저장을 막는 사고의 파급 범위 축소,
// 실시간 구독이 실제로 바뀐 부분에만 반응하도록 하는 목적 모두 포함).
//
// 각 함수는 "그 문서 자신의 저장된 데이터(or 구버전 통합 문서, or null)"를 받아 자신이
// 담당하는 state 필드만 정규화해 돌려준다 — 이 반환 객체의 키 목록이 곧 그 문서가
// 실제로 어떤 state 필드를 담는지의 유일한 근거다(domainFields가 여기서 뽑아낸다).
export const DOMAIN_SYNC = {
  facilities: (d) => ({
    facilities: Array.isArray(d?.facilities) ? d.facilities : [...defaultFacilities],
  }),
  ancillaries: (d) => ({
    ancillaries: Array.isArray(d?.ancillaries) ? d.ancillaries : [...defaultAncillaries],
  }),
  seedlings: (d) => ({
    seedlings: Array.isArray(d?.seedlings) ? d.seedlings : [...defaultSeedlings],
  }),
  tasks: (d) => ({
    tasks: Array.isArray(d?.tasks) ? d.tasks : [...defaultTasks],
    scheduleRules: (Array.isArray(d?.scheduleRules) ? d.scheduleRules : [...defaultScheduleRules]).map(normalizeRule),
    scheduleSettings: normalizeScheduleSettings(d?.scheduleSettings),
    notifications: d?.notifications && typeof d.notifications === 'object' ? d.notifications : {},
    // 계절 작업(annualTaskTemplates)과 달리 앱 고정 데이터가 아니라 농장에서 직접 만들어
    // 쓰는 체크리스트 템플릿이라 여기(농장 데이터)에 저장한다.
    checklistTemplates: Array.isArray(d?.checklistTemplates) ? d.checklistTemplates : [],
  }),
  issues: (d) => ({
    issues: (Array.isArray(d?.issues) ? d.issues : [...defaultIssues]).map(normalizeIssue),
  }),
  inventory: (d) => ({
    inventory: (Array.isArray(d?.inventory) ? d.inventory : [...defaultInventory]).map(normalizeInventoryItem),
  }),
  usageGuides: (d) => ({
    usageGuides: (Array.isArray(d?.usageGuides) ? d.usageGuides : [...defaultUsageGuides]).map(normalizeUsageGuide),
  }),
  changeLog: (d) => ({
    changeLog: Array.isArray(d?.changeLog) ? d.changeLog : [],
  }),
}

export const DOMAIN_KEYS = Object.keys(DOMAIN_SYNC)

// 이 문서(key)가 실제로 담고 있는 state 필드 이름 목록. Firestore에 쓸 때 state에서
// 어떤 필드를 뽑아 담을지 여기서 결정한다(정규화 함수와 같은 소스라 어긋날 일이 없다).
export function domainFields(key) {
  return Object.keys(DOMAIN_SYNC[key](null))
}

// ── 농장별 데이터 (facilities…notifications) ─────────────────────────────────
// annualTaskTemplates는 앱에 고정된 상수라 Firestore에 저장하지 않는다(정규화 시에도
// 저장된 값을 무시하고 항상 최신 상수로 채운다) — 이전엔 매번 그대로 다시 저장되던 죽은 데이터였다.
export function createDefaultFarmData() {
  const merged = {}
  DOMAIN_KEYS.forEach((key) => Object.assign(merged, DOMAIN_SYNC[key](null)))
  merged.annualTaskTemplates = [...annualTaskTemplates]
  merged.updatedAt = new Date().toISOString()
  return merged
}

export function normalizeFarmData(data) {
  const merged = {}
  DOMAIN_KEYS.forEach((key) => Object.assign(merged, DOMAIN_SYNC[key](data)))
  merged.annualTaskTemplates = [...annualTaskTemplates]
  merged.updatedAt = data?.updatedAt || new Date().toISOString()
  return merged
}

// ── 공통(농장 무관) 분류·항목 설정 ─────────────────────────────────────────────
export function normalizeAppSettings(data) {
  const defaults = { ...defaultAppSettings }
  const stored = data && typeof data === 'object' ? data : {}
  const merged = { ...defaults, ...stored }
  const storedCats = Array.isArray(stored.taskCategories) ? stored.taskCategories : []
  merged.taskCategories = [...new Set([...defaults.taskCategories, ...storedCats])]
  const storedRootstocks = Array.isArray(stored.rootstockTypes) ? stored.rootstockTypes : []
  merged.rootstockTypes = [...new Set([...defaults.rootstockTypes, ...storedRootstocks])]
  const storedEquipment = Array.isArray(stored.equipmentTypes) ? stored.equipmentTypes : []
  merged.equipmentTypes = [...new Set([...defaults.equipmentTypes, ...storedEquipment])]
  // pesticideTypes: migrate old string[] → {name, abbr}[] and merge with defaults
  const defPesti = defaults.pesticideTypes
  const normPesti = v => typeof v === 'string' ? { name: v, abbr: '' } : v
  const storedPestiRaw = Array.isArray(stored.pesticideTypes) ? stored.pesticideTypes : []
  const storedPesti = storedPestiRaw.map(normPesti)
  if (storedPesti.length === 0) {
    merged.pesticideTypes = defPesti
  } else {
    const defAbbrMap = new Map(defPesti.map(p => [p.name, p.abbr]))
    const storedNames = new Set(storedPesti.map(p => p.name))
    merged.pesticideTypes = [
      ...storedPesti.map(p => ({ ...p, abbr: p.abbr || defAbbrMap.get(p.name) || '' })),
      ...defPesti.filter(p => !storedNames.has(p.name)),
    ]
  }
  return merged
}

export function normalizeIssue(issue) {
  return {
    ...issue,
    resolutionSteps: Array.isArray(issue?.resolutionSteps) ? issue.resolutionSteps : [],
    photos: Array.isArray(issue?.photos) ? issue.photos : [],
  }
}

export function normalizeUsageGuide(guide) {
  return {
    ...guide,
    steps: (Array.isArray(guide?.steps) ? guide.steps : []).map((s) => ({
      ...s,
      photos: Array.isArray(s?.photos) ? s.photos : [],
    })),
  }
}

export function normalizeInventoryItem(item) {
  // 로트(규격+유효기간) 기반: 현재 재고는 txns로부터 계산하므로 품목엔 메타 + txns만 보관한다.
  // 구버전(품목당 단일 수량/단위) 데이터는 unit→규격, expiryDate→유효기간으로 이전한다.
  const fallbackVolume = item?.unit || '기본'
  const fallbackExpiry = item?.expiryDate || ''
  const txns = (Array.isArray(item?.txns) ? item.txns : []).map((t) => ({
    id: t.id || uuid(),
    date: t.date || new Date().toISOString(),
    type: t.type === '사용' ? '사용' : '입고',
    volume: t.volume || fallbackVolume,
    expiryDate: t.expiryDate || fallbackExpiry,
    amount: Math.abs(Number(t.amount) || 0),
    note: t.note || '',
  }))
  return {
    id: item?.id,
    name: item?.name || '',
    category: item?.category === '농약' ? '농약' : '비료',
    pesticideType: item?.pesticideType || '',
    actionGroup: item?.actionGroup || '',
    productName: item?.productName || '',
    matchSource: item?.matchSource === 'auto' ? 'auto' : '', // 공공데이터로 연결된 품목 표시
    notes: item?.notes || '',
    txns,
  }
}

export function normalizeRule(rule) {
  return {
    ...rule,
    interval: Math.max(1, Number(rule?.interval || 1)),
    dayOfWeek: Math.max(1, Math.min(7, Number(rule?.dayOfWeek || 1))),
    dayOfMonth: Math.max(1, Math.min(31, Number(rule?.dayOfMonth || 1))),
    enabled: rule?.enabled !== false,
  }
}

export function normalizeScheduleSettings(settings) {
  return {
    generationDays: Math.max(1, Math.min(180, Number(settings?.generationDays || 21))),
    duplicatePolicy: ['rule-and-date', 'title-and-date', 'allow'].includes(settings?.duplicatePolicy)
      ? settings.duplicatePolicy
      : 'rule-and-date',
  }
}
