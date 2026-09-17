import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db, dbLite, firebaseEnabled } from '../services/firebase.js'
import {
  collection, query, orderBy, onSnapshot,
  addDoc, deleteDoc, doc, updateDoc, Timestamp,
} from 'firebase/firestore'
import { doc as liteDoc, collection as liteCollection, writeBatch as liteWriteBatch } from 'firebase/firestore/lite'
import { useFarmStore } from './farmStore.js'
import { useFarmsStore } from './farmsStore.js'
import { useFarmMembersStore } from './farmMembersStore.js'
import { diffFields, formatFieldDiff, snapshotForRevert } from '../utils/changeLogUtils.js'

function treatmentLabel(record) {
  return [record?.date, record?.brandName].filter(Boolean).join(' ')
}

const TREATMENT_FIELD_LABELS = { date: '날짜', brandName: '농약', moa: '계통', category: '구분', memo: '메모' }

function lsKey(farmId) {
  return `citrus:treatments:${farmId}`
}

function sortDesc(arr) {
  return [...arr].sort((a, b) => {
    if (b.date !== a.date) return b.date.localeCompare(a.date)
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
  })
}

export const useTreatmentStore = defineStore('treatment', () => {
  const treatments = ref([])
  const ready = ref(false)
  const initialized = ref(false)
  let activeFarmId = null

  function saveLS(arr) {
    if (!activeFarmId) return
    try { localStorage.setItem(lsKey(activeFarmId), JSON.stringify(arr)) } catch {}
  }

  function collectionRef() {
    return collection(db, 'farms', activeFarmId, 'treatments')
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
      const q = query(collectionRef(), orderBy('date', 'desc'))
      onSnapshot(
        q,
        (snap) => {
          treatments.value = snap.docs.map(d => ({ id: d.id, ...d.data() }))
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
    if (firebaseEnabled && db) {
      await addDoc(collectionRef(), {
        ...record,
        createdAt: Timestamp.now().toDate().toISOString(),
      })
    } else {
      const item = {
        ...record,
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        createdAt: new Date().toISOString(),
      }
      treatments.value = sortDesc([item, ...treatments.value])
      saveLS(treatments.value)
    }
    if (!silent) useFarmStore().logChange('방제이력', treatmentLabel(record), 'add')
  }

  async function updateTreatment(id, record) {
    const before = treatments.value.find(t => t.id === id)
    if (firebaseEnabled && db) {
      await updateDoc(doc(db, 'farms', activeFarmId, 'treatments', id), record)
    } else {
      treatments.value = sortDesc(
        treatments.value.map(t => t.id === id ? { ...t, ...record } : t),
      )
      saveLS(treatments.value)
    }
    const fields = diffFields(before, record, TREATMENT_FIELD_LABELS)
    useFarmStore().logChange('방제이력', treatmentLabel(record), 'update', formatFieldDiff(fields), { refId: id, fields })
  }

  async function replaceAllTreatments(records) {
    const prevCount = treatments.value.length
    if (firebaseEnabled && dbLite) {
      // writeBatch(일반 db)도 실시간 리스너용 영속 Write 스트림을 같이 쓰기 때문에, 대량
      // 교체에서는 배치로 건수를 줄여도 그 스트림 자체의 "대기 가능한 쓰기 수" 한도에 걸려
      // "Write stream exhausted maximum allowed queued writes" 오류가 났다(백업 복원의 사진
      // 복원에서도 같은 문제가 있었다 — farmStore/backup.js 참고, 실측으로 확인됨).
      // firestore/lite는 스트림이 아니라 매 커밋마다 일반 HTTP 요청으로 끝나므로 그 한도가
      // 적용되지 않는다.
      const BATCH_SIZE = 400 // Firestore 배치 한도(500)보다 여유 있게
      for (let i = 0; i < treatments.value.length; i += BATCH_SIZE) {
        const batch = liteWriteBatch(dbLite)
        for (const t of treatments.value.slice(i, i + BATCH_SIZE)) {
          batch.delete(liteDoc(dbLite, 'farms', activeFarmId, 'treatments', t.id))
        }
        await batch.commit()
      }
      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = liteWriteBatch(dbLite)
        for (const r of records.slice(i, i + BATCH_SIZE)) {
          const data = Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'id'))
          batch.set(liteDoc(liteCollection(dbLite, 'farms', activeFarmId, 'treatments')), data)
        }
        await batch.commit()
      }
    } else {
      treatments.value = sortDesc(
        records.map((r, i) => ({ ...r, id: r.id || `restored-${Date.now()}-${i}` })),
      )
      saveLS(treatments.value)
    }
    if (records.length === 0) {
      if (prevCount > 0) useFarmStore().logChange('방제이력', `전체 초기화 (${prevCount}건)`, 'delete')
    } else {
      useFarmStore().logChange('방제이력', `일괄 교체 (${records.length}건)`, 'update')
    }
  }

  async function deleteTreatment(id) {
    const target = treatments.value.find(t => t.id === id)
    if (firebaseEnabled && db) {
      await deleteDoc(doc(db, 'farms', activeFarmId, 'treatments', id))
    } else {
      treatments.value = treatments.value.filter(t => t.id !== id)
      saveLS(treatments.value)
    }
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
