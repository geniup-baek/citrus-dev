<script setup>
import { computed, onMounted, ref } from 'vue'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { useFarmStore } from '../stores/farmStore'
import { useLocaleStore } from '../stores/localeStore'
import { useTreatmentStore } from '../stores/treatmentStore'
import { useRecommendSettingsStore } from '../stores/recommendSettingsStore'
import { useAvailablePesticideStore } from '../stores/availablePesticideStore'
import { useFarmsStore } from '../stores/farmsStore'
import { db, firebaseEnabled } from '../services/firebase'
import { DOMAIN_KEYS } from '../utils/farmDataSchema.js'
import { exportAllFarmsBackup, isValidAllFarmsBackup, allFarmsBackupSummary, restoreAllFarmsBackup } from '../services/adminBackup.js'

const store = useFarmStore()
const localeStore = useLocaleStore()
const treatStore = useTreatmentStore()
const recSettingsStore = useRecommendSettingsStore()
const apStore = useAvailablePesticideStore()
const farmsStore = useFarmsStore()

// ── 저장공간 사용 현황 ────────────────────────────────────────────────────────
const LOCAL_STORAGE_QUOTA_BYTES = 5 * 1024 * 1024 // 브라우저마다 다르나 보수적으로 5MB 가정
const FIRESTORE_QUOTA_BYTES = 1024 * 1024 * 1024  // Firebase 무료(Spark) 플랜 저장용량 1GiB

function byteSize(value) {
  return new Blob([JSON.stringify(value ?? null)]).size
}

function formatBytes(bytes) {
  if (!bytes) return '0KB'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`
}

const localStorageBytes = ref(0)

function refreshLocalStorageUsage() {
  let bytes = 0
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    bytes += (key?.length ?? 0) + (localStorage.getItem(key)?.length ?? 0)
  }
  localStorageBytes.value = bytes
}

const localStoragePercent = computed(() =>
  Math.min(100, Math.round((localStorageBytes.value / LOCAL_STORAGE_QUOTA_BYTES) * 100)),
)

const firestoreLoading = ref(false)
const firestoreUsage = ref(null) // { total, breakdown: [{ label, bytes }] }
const firestoreUsageError = ref('')

// 농장 데이터는 이제 문서 하나(farmData)가 아니라 도메인별 문서 8개로 나뉘어 있다
// (src/utils/farmDataSchema.js의 DOMAIN_SYNC 참고) — 합쳐서 "농장 데이터" 한 항목으로 센다.
async function farmDataBytes(farmId) {
  let bytes = 0
  for (const key of DOMAIN_KEYS) {
    const snap = await getDoc(doc(db, 'farms', farmId, 'data', key))
    if (snap.exists()) bytes += byteSize(snap.data())
  }
  return bytes
}

// farmId 필터 없이 photos 컬렉션 전체를 훑으면(농장별 소유권 규칙이 걸린 뒤로는)
// 규칙이 거부한다 — 반드시 이 농장에 귀속된(farmId가 이 농장인) 사진만 조회한다.
// farmId가 아직 없는(마이그레이션 안 된) 사진은 이 집계에서 빠진다 — 어차피
// "추정치"로 표시되는 화면이라 허용 가능한 오차로 본다.
async function farmPhotoBytes(farmId) {
  const snap = await getDocs(query(collection(db, 'photos'), where('farmId', '==', farmId)))
  let bytes = 0
  snap.forEach((d) => { bytes += byteSize(d.data()) })
  return bytes
}

async function refreshFirestoreUsage() {
  if (!firebaseEnabled || !db) return
  firestoreLoading.value = true
  firestoreUsageError.value = ''
  try {
    if (farmsStore.isAdminMode) {
      const breakdown = []
      // 삭제(휴지통 보관)된 농장도 실제로는 데이터가 그대로 남아 있어 용량을 차지하므로 함께 집계한다.
      for (const farm of [...farmsStore.farms, ...farmsStore.deletedFarms]) {
        let farmBytes = await farmDataBytes(farm.id)
        for (const docPath of [
          ['farms', farm.id, 'data', 'availablePesticide'],
          ['farms', farm.id, 'data', 'recommendSettings'],
        ]) {
          const snap = await getDoc(doc(db, ...docPath))
          if (snap.exists()) farmBytes += byteSize(snap.data())
        }
        const treatSnap = await getDocs(collection(db, 'farms', farm.id, 'treatments'))
        treatSnap.forEach((d) => { farmBytes += byteSize(d.data()) })
        farmBytes += await farmPhotoBytes(farm.id)
        breakdown.push({ label: `농장: ${farm.name}${farm.deletedAt ? ' (삭제됨)' : ''}`, bytes: farmBytes })
      }

      for (const [label, docPath] of [
        ['분류·항목 설정(공통)', ['shared', 'appSettings']],
      ]) {
        const snap = await getDoc(doc(db, ...docPath))
        breakdown.push({ label, bytes: snap.exists() ? byteSize(snap.data()) : 0 })
      }
      for (const [label, colPath] of [
        ['공공데이터 캐시(공통, 농약·병해충 정보)', ['sharedCache']],
      ]) {
        const snap = await getDocs(collection(db, ...colPath))
        let bytes = 0
        snap.forEach((d) => { bytes += byteSize(d.data()) })
        breakdown.push({ label, bytes })
      }

      firestoreUsage.value = { total: breakdown.reduce((s, b) => s + b.bytes, 0), breakdown }
      return
    }

    const farmId = farmsStore.activeFarm?.id
    if (!farmId) return
    const breakdown = [
      { label: '농장 데이터(재배동·작업·재고 등)', bytes: await farmDataBytes(farmId) },
    ]

    for (const [label, docPath] of [
      ['가용농약', ['farms', farmId, 'data', 'availablePesticide']],
      ['농약추천 정책', ['farms', farmId, 'data', 'recommendSettings']],
      ['분류·항목 설정(공통)', ['shared', 'appSettings']],
    ]) {
      const snap = await getDoc(doc(db, ...docPath))
      breakdown.push({ label, bytes: snap.exists() ? byteSize(snap.data()) : 0 })
    }

    for (const [label, colPath] of [
      ['방제이력', ['farms', farmId, 'treatments']],
      ['공공데이터 캐시(공통, 농약·병해충 정보)', ['sharedCache']],
    ]) {
      const snap = await getDocs(collection(db, ...colPath))
      let bytes = 0
      snap.forEach((d) => { bytes += byteSize(d.data()) })
      breakdown.push({ label, bytes })
    }
    breakdown.push({ label: '사진', bytes: await farmPhotoBytes(farmId) })

    firestoreUsage.value = { total: breakdown.reduce((s, b) => s + b.bytes, 0), breakdown }
  } catch (e) {
    console.warn('[StorageBackupPanel] 사용량 계산 실패', e)
    firestoreUsageError.value = '사용량을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.'
  } finally {
    firestoreLoading.value = false
  }
}

const firestorePercent = computed(() =>
  firestoreUsage.value ? Math.min(100, Math.round((firestoreUsage.value.total / FIRESTORE_QUOTA_BYTES) * 100)) : 0,
)

onMounted(refreshLocalStorageUsage)

// ── 백업 / 복원 (현재 활성 농장 + 공통 설정 기준) ─────────────────────────────
const backupMessage = ref('')
const restoreError = ref('')
const pendingRestore = ref(null)
const restoreInput = ref(null)
const restoring = ref(false)
const exporting = ref(false)

const datasetLabels = {
  facilities: () => localeStore.t('nav.facilities'),
  ancillaries: () => localeStore.t('nav.ancillary'),
  seedlings: () => localeStore.t('nav.seedlings'),
  tasks: () => localeStore.t('nav.tasks'),
  scheduleRules: () => localeStore.t('settings.backupRules'),
  issues: () => localeStore.t('nav.issues'),
  inventory: () => '재고',
  usageGuides: () => localeStore.t('nav.usageGuides'),
  checklistTemplates: () => '체크리스트 템플릿',
  treatments: () => '방제기록',
  availablePesticides: () => '가용농약',
  changeLog: () => '변경 이력',
}

function extendedSummary(payload) {
  const base = store.backupSummary(payload)
  base.treatments = Array.isArray(payload?.data?.treatments) ? payload.data.treatments.length : 0
  const ap = payload?.data?.availablePesticide
  base.availablePesticides = Array.isArray(ap?.availableList) ? ap.availableList.length : 0
  return base
}

const currentCounts = computed(() => {
  const base = store.backupSummary(store.exportBackup())
  base.treatments = treatStore.treatments.length
  base.availablePesticides = apStore.availableList.length
  return base
})

async function exportBackup() {
  exporting.value = true
  try {
    const payload = await store.exportBackupWithPhotos()
    payload.data.treatments = treatStore.treatments
    payload.data.recommendSettings = { ...recSettingsStore.settings }
    payload.data.availablePesticide = apStore.exportData()
    payload.farm = { id: farmsStore.activeFarm?.id, name: farmsStore.activeFarm?.name }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `citrus-backup-${(farmsStore.activeFarm?.name || 'farm')}-${payload.exportedAt.slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    restoreError.value = ''
    backupMessage.value = localeStore.t('settings.backupExported', { date: payload.exportedAt.slice(0, 10) })
  } finally {
    exporting.value = false
  }
}

async function handleRestoreFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return

  backupMessage.value = ''
  restoreError.value = ''
  pendingRestore.value = null

  try {
    const payload = JSON.parse(await file.text())
    if (!store.isValidBackup(payload)) {
      restoreError.value = localeStore.t('settings.restoreInvalid')
      return
    }
    pendingRestore.value = { payload, summary: extendedSummary(payload) }
  } catch {
    restoreError.value = localeStore.t('settings.restoreInvalid')
  }
}

function cancelRestore() {
  pendingRestore.value = null
}

async function confirmRestore() {
  if (!pendingRestore.value) return
  restoring.value = true
  try {
    const { payload } = pendingRestore.value
    await store.restoreBackup(payload)
    if (Array.isArray(payload.data?.treatments)) {
      await treatStore.replaceAllTreatments(payload.data.treatments)
    }
    if (payload.data?.recommendSettings) {
      recSettingsStore.restoreSettings(payload.data.recommendSettings)
    }
    if (payload.data?.availablePesticide) {
      apStore.restoreData(payload.data.availablePesticide)
    }
    pendingRestore.value = null
    backupMessage.value = localeStore.t('settings.restoreDone')
  } finally {
    restoring.value = false
  }
}

// ── 전체 백업/복원 (시스템 관리 모드 전용: 모든 농장 + 공통 데이터) ───────────────
const adminExporting = ref(false)
const adminBackupMessage = ref('')
const adminRestoreError = ref('')
const pendingAdminRestore = ref(null)
const adminRestoring = ref(false)
const adminRestoreInput = ref(null)

async function exportAllBackup() {
  adminExporting.value = true
  adminBackupMessage.value = ''
  adminRestoreError.value = ''
  try {
    const payload = await exportAllFarmsBackup()
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `citrus-backup-all-${payload.exportedAt.slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    let message = localeStore.t('settings.backupExported', { date: payload.exportedAt.slice(0, 10) })
    const skipped = payload.skippedFarmNames ?? []
    const failed = payload.failedFarmNames ?? []
    if (skipped.length) message += ` (접근 권한 없어 제외됨: ${skipped.join(', ')})`
    if (failed.length) message += ` (오류로 제외됨: ${failed.join(', ')})`
    adminBackupMessage.value = message
  } catch (e) {
    console.warn('[StorageBackupPanel] 전체 백업 실패', e)
    adminRestoreError.value = '전체 백업에 실패했습니다. 새로고침 후 다시 시도해 주세요.'
  } finally {
    adminExporting.value = false
  }
}

async function handleAdminRestoreFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return

  adminBackupMessage.value = ''
  adminRestoreError.value = ''
  pendingAdminRestore.value = null

  try {
    const payload = JSON.parse(await file.text())
    if (!isValidAllFarmsBackup(payload)) {
      adminRestoreError.value = localeStore.t('settings.restoreInvalid')
      return
    }
    pendingAdminRestore.value = { payload, summary: allFarmsBackupSummary(payload) }
  } catch {
    adminRestoreError.value = localeStore.t('settings.restoreInvalid')
  }
}

function cancelAdminRestore() {
  pendingAdminRestore.value = null
}

async function confirmAdminRestore() {
  if (!pendingAdminRestore.value) return
  adminRestoring.value = true
  try {
    const result = await restoreAllFarmsBackup(pendingAdminRestore.value.payload)
    pendingAdminRestore.value = null
    const failed = result?.failedFarmNames ?? []
    adminBackupMessage.value = failed.length
      ? `${localeStore.t('settings.restoreDone')} (실패한 농장: ${failed.join(', ')})`
      : localeStore.t('settings.restoreDone')
  } catch (e) {
    console.warn('[StorageBackupPanel] 전체 복원 실패', e)
    adminRestoreError.value = '복원 중 오류가 발생했습니다. 일부만 반영됐을 수 있습니다 — 다시 시도해 주세요.'
  } finally {
    adminRestoring.value = false
  }
}
</script>

<template>
  <div class="sub-card settings-storage">
    <div class="settings-group-head">
      <h3>저장공간 사용 현황</h3>
    </div>
    <p class="muted settings-group-hint">
      이 기기의 로컬 저장소와 Firebase 저장용량을 대략적으로 확인합니다
      ({{ farmsStore.isAdminMode ? '전체 농장 + 공통 데이터 기준' : '현재 농장 기준' }}).
    </p>

    <div class="storage-block">
      <div class="storage-block-head">
        <span>로컬 저장소 (이 기기)</span>
        <span class="muted">{{ formatBytes(localStorageBytes) }} 사용 중 (추정치)</span>
      </div>
      <div class="storage-bar"><div class="storage-bar-fill" :style="{ width: localStoragePercent + '%' }"></div></div>
    </div>

    <div v-if="firebaseEnabled" class="storage-block">
      <div class="storage-block-head">
        <span>Firebase 저장용량 (팀 공유)</span>
        <button class="ghost compact-btn" type="button" :disabled="firestoreLoading" @click="refreshFirestoreUsage">
          {{ firestoreLoading ? '확인 중...' : (firestoreUsage ? '새로고침' : '확인') }}
        </button>
      </div>
      <template v-if="firestoreUsage">
        <div class="storage-bar"><div class="storage-bar-fill" :style="{ width: firestorePercent + '%' }"></div></div>
        <p class="muted text-sm" style="margin: 0.3rem 0 0.5rem;">
          {{ formatBytes(firestoreUsage.total) }} / 1GiB 사용 중 (무료 플랜 기준, 추정치)
        </p>
        <ul class="list clean compact storage-breakdown">
          <li v-for="b in firestoreUsage.breakdown" :key="b.label" class="item-meta">
            {{ b.label }} <span class="muted">{{ formatBytes(b.bytes) }}</span>
          </li>
        </ul>
      </template>
      <p v-else class="muted text-sm">확인 버튼을 누르면 조회합니다 (사진·캐시 데이터가 많으면 몇 초 걸릴 수 있습니다).</p>
      <p v-if="firestoreUsageError" class="settings-error">{{ firestoreUsageError }}</p>
    </div>
  </div>

  <!-- 시스템 관리 모드: 전체 농장 + 공통 데이터 백업/복원 -->
  <div v-if="farmsStore.isAdminMode" class="sub-card settings-backup">
    <div class="settings-group-head">
      <h3>전체 백업 (모든 농장 + 공통 데이터)</h3>
    </div>
    <p class="muted settings-group-hint">
      등록된 모든 농장의 데이터와 분류·항목 설정을 한 파일로 백업/복원합니다. 사진 본문은 포함되지 않습니다(농장별 백업에서 개별적으로 백업하세요).
    </p>

    <div class="row-actions settings-backup-actions">
      <button type="button" :disabled="adminExporting" @click="exportAllBackup">{{ adminExporting ? '내보내는 중...' : '전체 백업' }}</button>
      <button class="ghost" type="button" @click="adminRestoreInput?.click()">전체 복원</button>
      <input ref="adminRestoreInput" accept="application/json,.json" type="file" hidden @change="handleAdminRestoreFile" />
    </div>

    <p v-if="adminBackupMessage" class="muted settings-backup-msg">{{ adminBackupMessage }}</p>
    <p v-if="adminRestoreError" class="settings-error">{{ adminRestoreError }}</p>

    <div v-if="pendingAdminRestore" class="restore-preview">
      <p class="restore-preview-title">복원 대상 미리보기</p>
      <div class="backup-counts">
        <span class="pill">농장 {{ pendingAdminRestore.summary.farmCount }}개</span>
        <span v-for="f in pendingAdminRestore.summary.farms" :key="f.id" class="pill">{{ f.name }} · 방제기록 {{ f.treatments }}</span>
        <span v-if="pendingAdminRestore.summary.hasAppSettings" class="pill">{{ localeStore.t('settings.backupSettingsIncluded') }}</span>
        <span v-if="pendingAdminRestore.summary.manualPesticides" class="pill">직접등록 농약 {{ pendingAdminRestore.summary.manualPesticides }}</span>
      </div>
      <p class="settings-error">{{ localeStore.t('settings.restoreWarning') }}</p>
      <div class="row-actions">
        <button class="danger" type="button" :disabled="adminRestoring" @click="confirmAdminRestore">{{ adminRestoring ? '복원 중...' : localeStore.t('settings.restoreRun') }}</button>
        <button class="ghost" type="button" @click="cancelAdminRestore">{{ localeStore.t('common.cancel') }}</button>
      </div>
    </div>
  </div>

  <!-- 농장 모드: 현재 농장 데이터만 백업/복원 -->
  <div v-else class="sub-card settings-backup">
    <div class="settings-group-head">
      <h3>{{ localeStore.t('settings.backupTitle') }}</h3>
    </div>
    <p class="muted settings-group-hint">{{ localeStore.t('settings.backupDesc') }} (현재 농장: {{ farmsStore.activeFarm?.name }})</p>

    <div class="backup-counts">
      <span v-for="(labelFn, key) in datasetLabels" :key="key" class="pill">
        {{ localeStore.t('settings.backupCount', { label: labelFn(), count: currentCounts[key] }) }}
      </span>
      <span v-if="currentCounts.settings" class="pill">{{ localeStore.t('settings.backupSettingsIncluded') }}</span>
    </div>

    <div class="row-actions settings-backup-actions">
      <button type="button" :disabled="exporting" @click="exportBackup">{{ exporting ? '내보내는 중...' : localeStore.t('settings.backupExport') }}</button>
      <button class="ghost" type="button" @click="restoreInput?.click()">{{ localeStore.t('settings.backupImport') }}</button>
      <input ref="restoreInput" accept="application/json,.json" type="file" hidden @change="handleRestoreFile" />
    </div>

    <p v-if="backupMessage" class="muted settings-backup-msg">{{ backupMessage }}</p>
    <p v-if="restoreError" class="settings-error">{{ restoreError }}</p>

    <div v-if="pendingRestore" class="restore-preview">
      <p class="restore-preview-title">{{ localeStore.t('settings.restorePreviewTitle') }}</p>
      <div class="backup-counts">
        <span v-for="(labelFn, key) in datasetLabels" :key="key" class="pill">
          {{ localeStore.t('settings.backupCount', { label: labelFn(), count: pendingRestore.summary[key] }) }}
        </span>
        <span v-if="pendingRestore.summary.photos" class="pill">{{ localeStore.t('settings.backupPhotos', { count: pendingRestore.summary.photos }) }}</span>
        <span v-if="pendingRestore.summary.settings" class="pill">{{ localeStore.t('settings.backupSettingsIncluded') }}</span>
      </div>
      <p class="settings-error">{{ localeStore.t('settings.restoreWarning') }}</p>
      <div class="row-actions">
        <button class="danger" type="button" :disabled="restoring" @click="confirmRestore">{{ restoring ? '복원 중...' : localeStore.t('settings.restoreRun') }}</button>
        <button class="ghost" type="button" :disabled="restoring" @click="cancelRestore">{{ localeStore.t('common.cancel') }}</button>
      </div>
    </div>
  </div>
</template>
