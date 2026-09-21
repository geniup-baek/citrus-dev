import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db, firebaseEnabled } from '../services/firebase.js'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { useFarmStore } from './farmStore.js'
import { useFarmsStore } from './farmsStore.js'
import { useFarmMembersStore } from './farmMembersStore.js'
import { diffFields, formatFieldDiff, snapshotForRevert } from '../utils/changeLogUtils.js'
import { LS_PREFIX } from '../utils/storagePrefix.js'
import { uuid } from '../utils/uuid.js'

function treatmentLabel(record) {
  return [record?.date, record?.brandName].filter(Boolean).join(' ')
}

const TREATMENT_FIELD_LABELS = { date: '날짜', brandName: '농약', moa: '계통', category: '구분', memo: '메모' }

function lsKey(farmId) {
  return `${LS_PREFIX}:treatments:${farmId}`
}

function sortDesc(arr) {
  return [...arr].sort((a, b) => {
    if (b.date !== a.date) return b.date.localeCompare(a.date)
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
  })
}

// farms/{farmId}/data/treatments 문서 하나에 배열로 저장한다(다른 도메인 스토어
// availablePesticideStore.js·recommendSettingsStore.js와 같은 방식 — farmStore.js의
// DOMAIN_SYNC와는 별개로 이 스토어가 독립적으로 문서를 관리한다). 예전엔 레코드마다
// 문서를 따로 두는 컬렉션이었는데, 방제이력은 다른 도메인과 달리 상한이 없어서
// 세션마다 읽기 비용이 기록 수만큼 그대로 늘어났다 — 배열 문서로 통일해 다른
// 도메인과 같은 상한(withinDomainArrayCap, firestore.rules)의 보호를 받게 했다.
export const useTreatmentStore = defineStore('treatment', () => {
  const treatments = ref([])
  const ready = ref(false)
  const initialized = ref(false)
  let activeFarmId = null
  let writeDebounce = null

  function saveLS(arr) {
    if (!activeFarmId) return
    try { localStorage.setItem(lsKey(activeFarmId), JSON.stringify(arr)) } catch {}
  }

  function docRef() {
    return doc(db, 'farms', activeFarmId, 'data', 'treatments')
  }

  function scheduleWrite() {
    if (!firebaseEnabled || !db || !activeFarmId) return
    clearTimeout(writeDebounce)
    writeDebounce = setTimeout(async () => {
      try {
        await setDoc(docRef(), { treatments: treatments.value, updatedAt: new Date().toISOString() }, { merge: true })
      } catch (e) {
        console.warn('[treatmentStore] Firestore 저장 실패, 다음 변경 때 다시 시도합니다.', e)
      }
    }, 500)
  }

  async function init(farmId) {
    if (initialized.value) return
    initialized.value = true
    activeFarmId = farmId

    if (firebaseEnabled && db) {
      const farmMembersStore = useFarmMembersStore()
      await farmMembersStore.ready()
      if (!farmMembersStore.hasFullAccess && !farmMembersStore.canRead('treatments')) {
        // 방제이력 읽기 권한이 없는 구성원 — 구독을 시도하면 거부되므로 애초에
        // 시도하지 않는다. 빈 목록으로 남고, ready만 true로 만들어 화면이 계속
        // "불러오는 중"에 머물지 않게 한다.
        ready.value = true
        return
      }
      onSnapshot(
        docRef(),
        (snap) => {
          treatments.value = sortDesc(Array.isArray(snap.data()?.treatments) ? snap.data().treatments : [])
          saveLS(treatments.value)
          ready.value = true
        },
        (err) => useFarmsStore().reportAccessError(err),
      )
    } else {
      try {
        const raw = localStorage.getItem(lsKey(activeFarmId))
        if (raw) treatments.value = sortDesc(JSON.parse(raw))
      } catch {}
      ready.value = true
    }
  }

  async function addTreatment(record, { silent = false } = {}) {
    const item = { ...record, id: uuid(), createdAt: new Date().toISOString() }
    treatments.value = sortDesc([item, ...treatments.value])
    saveLS(treatments.value)
    scheduleWrite()
    if (!silent) useFarmStore().logChange('방제이력', treatmentLabel(record), 'add')
  }

  async function updateTreatment(id, record) {
    const before = treatments.value.find(t => t.id === id)
    treatments.value = sortDesc(
      treatments.value.map(t => t.id === id ? { ...t, ...record } : t),
    )
    saveLS(treatments.value)
    scheduleWrite()
    const fields = diffFields(before, record, TREATMENT_FIELD_LABELS)
    useFarmStore().logChange('방제이력', treatmentLabel(record), 'update', formatFieldDiff(fields), { refId: id, fields })
  }

  async function replaceAllTreatments(records) {
    const prevCount = treatments.value.length
    treatments.value = sortDesc(
      records.map((r) => ({ ...r, id: r.id || uuid() })),
    )
    saveLS(treatments.value)
    scheduleWrite()
    if (records.length === 0) {
      if (prevCount > 0) useFarmStore().logChange('방제이력', `전체 초기화 (${prevCount}건)`, 'delete')
    } else {
      useFarmStore().logChange('방제이력', `일괄 교체 (${records.length}건)`, 'update')
    }
  }

  async function deleteTreatment(id) {
    const target = treatments.value.find(t => t.id === id)
    treatments.value = treatments.value.filter(t => t.id !== id)
    saveLS(treatments.value)
    scheduleWrite()
    if (target) {
      useFarmStore().logChange('방제이력', treatmentLabel(target), 'delete', '', { snapshot: snapshotForRevert(target) })
    }
  }

  // 변경 이력의 "방제이력" 항목을 되돌린다. entity가 farmStore가 아니라 이 스토어 소속이라
  // SettingsView에서 entity로 분기해 이 함수를 부른다(farmStore.revertChangeLogEntry와 대응).
  async function revertTreatmentLogEntry(entry) {
    if (entry.action === 'update') {
      if (!entry.refId || !entry.fields) return { ok: false, reason: '되돌릴 정보가 없습니다.' }
      if (!treatments.value.some((t) => t.id === entry.refId)) {
        return { ok: false, reason: '이미 삭제된 항목이라 되돌릴 수 없습니다.' }
      }
      const patch = {}
      for (const [key, field] of Object.entries(entry.fields)) {
        patch[key] = field.from
      }
      await updateTreatment(entry.refId, patch)
      return { ok: true }
    }
    if (entry.action === 'delete') {
      if (!entry.snapshot) return { ok: false, reason: '되돌릴 정보가 저장되어 있지 않습니다.' }
      const rest = Object.fromEntries(
        Object.entries(entry.snapshot).filter(([k]) => k !== 'id' && k !== 'createdAt'),
      )
      await addTreatment(rest)
      return { ok: true }
    }
    return { ok: false, reason: '이 종류의 기록은 되돌리기를 지원하지 않습니다.' }
  }

  return {
    treatments, ready, init, addTreatment, updateTreatment, deleteTreatment, replaceAllTreatments,
    revertTreatmentLogEntry,
  }
})
