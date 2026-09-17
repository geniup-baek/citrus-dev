<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { format } from 'date-fns'
import { useFarmStore } from '../stores/farmStore'
import { useLocaleStore } from '../stores/localeStore'
import { useRecommendSettingsStore } from '../stores/recommendSettingsStore'
import { useAppPolicyStore } from '../stores/appPolicyStore'
import { useFarmMembersStore } from '../stores/farmMembersStore'
import { confirm } from '../composables/useConfirm'
import { useIsMobile } from '../composables/useIsMobile'
import { useLightbox } from '../composables/useLightbox'
import { useFilesToPreviews } from '../composables/usePhotoPreviews'
import MobileFilterBar from './MobileFilterBar.vue'
import OverflowMenu from './OverflowMenu.vue'

// 재배동 목록에서 '묘목 보기'로 넘어온 경우, 그 재배동으로 미리 필터링해서 보여준다.
const props = defineProps({
  initialGreenhouseId: { type: String, default: '' },
})

const store = useFarmStore()
const localeStore = useLocaleStore()
const recSettingsStore = useRecommendSettingsStore()
const policyStore = useAppPolicyStore()
const farmMembersStore = useFarmMembersStore()
const editingId = ref('')
const showForm = ref(false)

// 초기화 버튼 — 시스템 관리 모드에서 기능을 "사용"으로 켜고, 이 농장에서 "표시"로 켠 경우에만 노출한다.
const showResetButton = computed(() =>
  policyStore.policy.enableResetFeature && recSettingsStore.settings.showResetButtons,
)

const { isMobile } = useIsMobile()
const formOpen = ref(false) // 폼(추가/편집) 표시 여부 — 토글로 닫으면 추가 폼도 숨긴다
// 편집 대상이 현재 목록에 보일 때만 그 항목 슬롯으로, 아니면 상단 호스트로(텔레포트 대상 null 방지)
const formTarget = computed(() =>
  editingId.value && displayedSeedlings.value.some((s) => s.id === editingId.value)
    ? `#seed-form-slot-${editingId.value}`
    : '#seed-form-top',
)

// ── 성장 기록 인라인 패널 ────────────────────────────────────────────────────
const expandedId = ref('')
const showAddLog = ref(false)
const logNote = ref('')
const logPhotoPreviews = ref([])
const logCompressionReport = ref('')
const { lightboxPhoto, openLightbox, closeLightbox } = useLightbox()
const { filesToPreviews } = useFilesToPreviews('seedlings.compressedReport')

// 성장 기록 편집
const editingLogId = ref('')
const editLogNote = ref('')
const editLogPhotos = ref([])
const editLogNewPreviews = ref([])
const editLogCompressionReport = ref('')

const varieties = computed(() => store.state.appSettings?.seedlingVarieties ?? ['한라봉', '카라향'])

const sortBy = ref('greenhouse')
const sortDir = ref('asc')
const filterGreenhouseId = ref(props.initialGreenhouseId || '')
const filterVariety = ref('')

const isFiltered = computed(() => !!filterGreenhouseId.value || !!filterVariety.value)

// 모바일 필터시트(MobileFilterBar)에 표시할 "적용된 필터" 요약 — 기존 ref 를 그대로 읽고 쓴다.
const seedlingActiveFilters = computed(() => [
  filterGreenhouseId.value && {
    key: 'greenhouse', label: greenhouseName(filterGreenhouseId.value), clear: () => { filterGreenhouseId.value = '' },
  },
  filterVariety.value && {
    key: 'variety', label: filterVariety.value, clear: () => { filterVariety.value = '' },
  },
].filter(Boolean))

function seedlingClearAllFilters() {
  filterGreenhouseId.value = ''
  filterVariety.value = ''
}

function greenhouseName(greenhouseId) {
  return (
    store.state.facilities.find((f) => f.id === greenhouseId)?.name ||
    localeStore.t('common.unknown')
  )
}

const displayedSeedlings = computed(() => {
  let list = [...store.state.seedlings]

  if (filterGreenhouseId.value) {
    list = list.filter((s) => s.greenhouseId === filterGreenhouseId.value)
  }
  if (filterVariety.value) {
    list = list.filter((s) => s.variety === filterVariety.value)
  }

  const dir = sortDir.value === 'asc' ? 1 : -1

  list.sort((a, b) => {
    if (sortBy.value === 'greenhouse') {
      // 재배동 → 열 → 구역(A/B/C) 순으로 정렬
      const byHouse = greenhouseName(a.greenhouseId).localeCompare(greenhouseName(b.greenhouseId))
      if (byHouse !== 0) return dir * byHouse
      const byRow = (Number(a.positionRow) || 0) - (Number(b.positionRow) || 0)
      if (byRow !== 0) return dir * byRow
      return dir * String(a.positionCol || '').localeCompare(String(b.positionCol || ''))
    }
    if (sortBy.value === 'variety') {
      return dir * a.variety.localeCompare(b.variety)
    }
    return dir * a.plantedAt.localeCompare(b.plantedAt)
  })

  return list
})

const rowOptions = Array.from({ length: 30 }, (_, i) => i + 1)
const colOptions = ['A', 'B', 'C']

const form = reactive({
  id: '',
  greenhouseId: '',
  positionRow: '',
  positionCol: '',
  variety: '',
  plantedAt: '',
  rootstock: '',
  notes: '',
})

// ── 일괄 추가 ────────────────────────────────────────────────────────────────
const batchMode = ref(false)
const batch = reactive({
  greenhouseId: '',
  rowFrom: 1,
  rowTo: 27,
  cols: ['A', 'B'],
  variety: '',
  plantedAt: '',
  rootstock: '',
  notes: '',
})

// 농장에서 재배 품종을 지정해 두면 새 묘목 등록 시 그 품종만 고를 수 있다. 지정이 없으면 전체 허용.
const grownVarieties = computed(() => {
  const grown = recSettingsStore.settings.grownVarieties
  if (!grown.length) return varieties.value
  const filtered = varieties.value.filter((v) => grown.includes(v))
  return filtered.length ? filtered : varieties.value
})

// 편집 중인 묘목의 기존 품종이 재배 품종 목록에서 빠졌더라도, 그 값을 계속 선택할 수 있게 포함한다.
const formVarietyOptions = computed(() => {
  if (form.variety && !grownVarieties.value.includes(form.variety)) {
    return [...grownVarieties.value, form.variety]
  }
  return grownVarieties.value
})

// 필터는 재배 품종에서 빠졌어도 기존 데이터에 남아있는 품종은 계속 골라 볼 수 있어야 한다.
const filterVarietyOptions = computed(() => {
  const usedVarieties = store.state.seedlings.map((s) => s.variety).filter(Boolean)
  return [...new Set([...grownVarieties.value, ...usedVarieties])]
})

const batchCount = computed(() => {
  const span = Number(batch.rowTo) - Number(batch.rowFrom) + 1
  return span > 0 ? span * batch.cols.length : 0
})

// 재배동+열+구역이 모두 지정된 경우에만 위치 중복으로 취급한다(위치 미지정 묘목끼리는 중복 아님)
function isDuplicatePosition(greenhouseId, positionRow, positionCol, excludeId) {
  if (!greenhouseId || positionRow === '' || positionRow == null || positionCol === '' || positionCol == null) {
    return false
  }
  return store.state.seedlings.some(
    (s) =>
      s.id !== excludeId &&
      s.greenhouseId === greenhouseId &&
      String(s.positionRow) === String(positionRow) &&
      s.positionCol === positionCol,
  )
}

async function confirmDeleteSeedling(seedling) {
  const logs = (seedling.growthLogs || []).length
  const ok = await confirm({
    message: localeStore.t('confirm.seedling', { name: seedling.variety, logs }),
  })
  if (ok) await store.removeSeedling(seedling.id)
}

// 묘목 전체 삭제 — 관리모드 동작 설정에서 "초기화 버튼: 표시"일 때만 노출된다.
// 화면 필터와 무관하게 이 농장의 묘목을 전부 지운다(확인창에 전체 건수를 그대로 보여준다).
async function resetAllSeedlings() {
  const n = store.state.seedlings.length
  if (!n) return
  const ok = await confirm({
    title: localeStore.t('confirm.resetTitle'),
    message: localeStore.t('confirm.resetSeedlings', { n }),
    confirmLabel: localeStore.t('common.reset'),
  })
  if (!ok) return
  await store.resetSeedlings()
  expandedId.value = ''
  closeForm()
}

function positionText(seedling) {
  if (!seedling.positionRow && !seedling.positionCol) return ''
  const parts = []
  if (seedling.positionRow) parts.push(`${seedling.positionRow}${localeStore.t('seedlings.positionUnit')}`)
  if (seedling.positionCol) parts.push(seedling.positionCol)
  return parts.join(' ')
}

function clearForm() {
  form.id = ''
  form.greenhouseId = store.state.facilities[0]?.id || ''
  form.positionRow = ''
  form.positionCol = ''
  form.variety = grownVarieties.value[0] ?? ''
  form.plantedAt = ''
  form.rootstock = ''
  form.notes = ''
  editingId.value = ''
}

// 필터를 바꿔서 편집 중인 묘목이 목록에서 사라지면, 보이지 않는 항목을 계속 편집하는
// 상태로 남기지 않고 새 묘목 입력 폼으로 되돌린다.
watch(displayedSeedlings, (list) => {
  if (editingId.value && !list.some((s) => s.id === editingId.value)) {
    clearForm()
  }
})

function openAdd() {
  clearForm()
  batchMode.value = false
  showForm.value = true
  formOpen.value = true
}


function clearBatch() {
  batch.greenhouseId = store.state.facilities[0]?.id || ''
  batch.rowFrom = 1
  batch.rowTo = 27
  batch.cols = ['A', 'B']
  batch.variety = grownVarieties.value[0] ?? ''
  batch.plantedAt = ''
  batch.rootstock = ''
  batch.notes = ''
}

// 편집 패널 내부의 새 묘목 추가/일괄 추가 모드 전환 (편집 중인 기존 항목이 있을 때는 표시하지 않음)
function switchMode(mode) {
  const wantBatch = mode === 'batch'
  if (wantBatch === batchMode.value) return
  if (wantBatch) clearBatch()
  else clearForm()
  batchMode.value = wantBatch
}

function toggleBatchCol(col) {
  const i = batch.cols.indexOf(col)
  if (i >= 0) batch.cols.splice(i, 1)
  else batch.cols.push(col)
}

async function saveBatch() {
  const from = Number(batch.rowFrom)
  const to = Number(batch.rowTo)
  if (!batch.greenhouseId || from > to || !batch.cols.length) return

  const payloads = []
  const skipped = []
  for (let row = from; row <= to; row += 1) {
    for (const col of colOptions.filter((c) => batch.cols.includes(c))) {
      if (isDuplicatePosition(batch.greenhouseId, row, col)) {
        skipped.push(`${row}${localeStore.t('seedlings.positionUnit')} ${col}`)
        continue
      }
      payloads.push({
        greenhouseId: batch.greenhouseId,
        positionRow: row,
        positionCol: col,
        variety: batch.variety,
        plantedAt: batch.plantedAt,
        rootstock: batch.rootstock,
        notes: batch.notes,
      })
    }
  }

  if (payloads.length) await store.addSeedlingsBatch(payloads)

  if (skipped.length && !payloads.length) {
    alert(localeStore.t('seedlings.duplicatePositionBatchAll'))
    return
  }
  if (skipped.length) {
    alert(localeStore.t('seedlings.duplicatePositionBatch', { count: skipped.length, positions: skipped.join(', ') }))
  }
  closeForm()
}

function editSeedling(seedling) {
  // 이미 이 묘목 편집 중이면 그대로 둔다(재클릭해도 닫지 않음)
  if (editingId.value === seedling.id) return
  batchMode.value = false
  formOpen.value = true
  expandedId.value = '' // 성장기록 패널과 상호 배타
  form.id = seedling.id
  form.greenhouseId = seedling.greenhouseId
  form.positionRow = seedling.positionRow || ''
  form.positionCol = seedling.positionCol || ''
  form.variety = seedling.variety
  form.plantedAt = seedling.plantedAt
  form.rootstock = seedling.rootstock
  form.notes = seedling.notes
  editingId.value = seedling.id
  showForm.value = true
  scrollToItem(`seed-form-slot-${seedling.id}`)
}

// 모바일에서 편집 시 해당 항목(과 아래 폼)이 보이도록 스크롤
function scrollToItem(slotId) {
  if (!isMobile.value) return
  nextTick(() => {
    const el = document.getElementById(slotId)
    ;(el?.closest('li') ?? el)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

function closeForm() {
  clearForm()
  batchMode.value = false
  showForm.value = false
  formOpen.value = false
}

async function saveSeedling() {
  if (isDuplicatePosition(form.greenhouseId, form.positionRow, form.positionCol, form.id)) {
    alert(localeStore.t('seedlings.duplicatePosition'))
    return
  }
  await store.upsertSeedling({
    id: form.id,
    greenhouseId: form.greenhouseId,
    positionRow: form.positionRow,
    positionCol: form.positionCol,
    variety: form.variety,
    plantedAt: form.plantedAt,
    rootstock: form.rootstock,
    notes: form.notes,
  })
  clearForm()
}

// ── 성장 기록 ────────────────────────────────────────────────────────────────
function logKey(log) {
  return log.id || log.date
}

function formatLogDate(dateStr) {
  try {
    return format(new Date(dateStr), 'MM/dd HH:mm')
  } catch {
    return dateStr
  }
}

function toggleLogPanel(seedling) {
  if (expandedId.value === seedling.id) {
    expandedId.value = ''
    return
  }
  if (editingId.value) clearForm() // 편집 폼과 상호 배타
  formOpen.value = false
  expandedId.value = seedling.id
  showAddLog.value = false
  logNote.value = ''
  logPhotoPreviews.value = []
  logCompressionReport.value = ''
  cancelEditLog()
}

function openAddLog() {
  showAddLog.value = true
}

function cancelAddLog() {
  showAddLog.value = false
  logNote.value = ''
  logPhotoPreviews.value = []
  logCompressionReport.value = ''
}

async function handleLogPhotoChange(event) {
  const files = Array.from(event.target.files || []).slice(0, 5)
  const { previews, report } = await filesToPreviews(files)
  logPhotoPreviews.value = previews
  logCompressionReport.value = report
}

function removeLogPreviewPhoto(id) {
  logPhotoPreviews.value = logPhotoPreviews.value.filter((p) => p.id !== id)
}

async function recordLog(seedling) {
  if (!logNote.value.trim()) return
  let photos
  try {
    photos = await store.savePhotos(logPhotoPreviews.value)
  } catch (e) {
    console.error('[SeedlingsPanel] 사진 업로드 실패', e)
    alert(localeStore.t('common.photoUploadFailed'))
    return
  }
  await store.addSeedlingLog(seedling.id, logNote.value, photos)
  showAddLog.value = false
  logNote.value = ''
  logPhotoPreviews.value = []
  logCompressionReport.value = ''
}

function startEditLog(log) {
  editingLogId.value = logKey(log)
  editLogNote.value = log.note
  editLogPhotos.value = [...(log.photos || [])]
  editLogNewPreviews.value = []
  editLogCompressionReport.value = ''
}

function cancelEditLog() {
  editingLogId.value = ''
  editLogNote.value = ''
  editLogPhotos.value = []
  editLogNewPreviews.value = []
  editLogCompressionReport.value = ''
}

function removeEditExistingPhoto(id) {
  editLogPhotos.value = editLogPhotos.value.filter((p) => p.id !== id)
}

async function handleEditLogPhotoChange(event) {
  const files = Array.from(event.target.files || []).slice(0, 5)
  const { previews, report } = await filesToPreviews(files)
  editLogNewPreviews.value = previews
  editLogCompressionReport.value = report
}

function removeEditNewPhoto(id) {
  editLogNewPreviews.value = editLogNewPreviews.value.filter((p) => p.id !== id)
}

async function saveEditLog(seedling) {
  if (!editingLogId.value || !editLogNote.value.trim()) return
  let uploaded
  try {
    uploaded = await store.savePhotos(editLogNewPreviews.value)
  } catch (e) {
    console.error('[SeedlingsPanel] 사진 업로드 실패', e)
    alert(localeStore.t('common.photoUploadFailed'))
    return
  }
  const photos = [...editLogPhotos.value, ...uploaded]
  await store.updateSeedlingLog(seedling.id, editingLogId.value, {
    note: editLogNote.value,
    photos,
  })
  cancelEditLog()
}

async function deleteLog(seedling, log) {
  const ok = await confirm({ message: '이 생육 기록을 삭제합니다. 되돌릴 수 없습니다.' })
  if (!ok) return
  await store.removeSeedlingLog(seedling.id, logKey(log))
  if (editingLogId.value === logKey(log)) cancelEditLog()
}

clearForm()
</script>

<template>
  <div v-if="lightboxPhoto" class="lightbox-overlay" @click="closeLightbox">
    <img :src="store.photoSrc(lightboxPhoto)" :alt="localeStore.t('seedlings.growthPhoto')" />
  </div>

  <div :class="['page-grid', showForm && formOpen ? 'two-columns' : '']">
    <article>
      <div class="pip-header">
        <div class="pip-actions">
          <button v-if="!showForm && farmMembersStore.canWrite('seedlings')" @click="openAdd">{{ localeStore.t('common.edit') }}</button>
          <template v-else-if="showForm">
            <OverflowMenu v-if="showResetButton && store.state.seedlings.length > 0" title="더보기">
              <button class="danger" type="button" @click="resetAllSeedlings">{{ localeStore.t('common.reset') }}</button>
            </OverflowMenu>
            <button class="ghost" @click="closeForm">{{ localeStore.t('common.exitEdit') }}</button>
          </template>
        </div>
      </div>

      <MobileFilterBar :active="seedlingActiveFilters" :on-reset-all="seedlingClearAllFilters" title="필터">
        <template #always>
          <span class="summary-chip">{{ isFiltered ? localeStore.t('common.filteredCount', { shown: displayedSeedlings.length, total: store.state.seedlings.length }) : localeStore.t('common.totalCount', { n: displayedSeedlings.length }) }}</span>
        </template>
        <span class="filter-sep">|</span>
        <span class="filter-label">{{ localeStore.t('seedlings.sortBy') }}</span>
        <select v-model="sortBy" class="compact-select">
          <option value="greenhouse">{{ localeStore.t('seedlings.sortGreenhouse') }}</option>
          <option value="variety">{{ localeStore.t('seedlings.sortVariety') }}</option>
          <option value="plantedAt">{{ localeStore.t('seedlings.sortPlantedAt') }}</option>
        </select>
        <button
          class="ghost compact-btn"
          type="button"
          :title="sortDir === 'asc' ? localeStore.t('seedlings.ascending') : localeStore.t('seedlings.descending')"
          @click="sortDir = sortDir === 'asc' ? 'desc' : 'asc'"
        >{{ sortDir === 'asc' ? '↑' : '↓' }}</button>
        <span class="filter-sep">|</span>
        <span class="filter-label">{{ localeStore.t('seedlings.filterGreenhouse') }}</span>
        <select v-model="filterGreenhouseId" class="compact-select">
          <option value="">{{ localeStore.t('seedlings.filterAll') }}</option>
          <option v-for="f in store.state.facilities" :key="f.id" :value="f.id">{{ f.name }}</option>
        </select>
        <span class="filter-label">{{ localeStore.t('seedlings.filterVariety') }}</span>
        <select v-model="filterVariety" class="compact-select">
          <option value="">{{ localeStore.t('seedlings.filterAll') }}</option>
          <option v-for="v in filterVarietyOptions" :key="v" :value="v">{{ v }}</option>
        </select>
      </MobileFilterBar>

      <div id="seed-form-top" class="mobile-form-slot"></div>

      <ul class="list clean">
        <li v-for="seedling in displayedSeedlings" :key="seedling.id" class="list-item card-like">
          <div>
            <p class="item-title">{{ seedling.variety }}<template v-if="positionText(seedling)"> · {{ positionText(seedling) }}</template></p>
            <p class="item-meta">
              {{ greenhouseName(seedling.greenhouseId) }} · {{ localeStore.t('seedlings.planted') }} {{ seedling.plantedAt }}
            </p>
            <p class="muted">{{ localeStore.t('seedlings.rootstockLabel') }}: {{ seedling.rootstock || localeStore.t('seedlings.na') }}</p>
            <p class="muted">{{ seedling.notes }}</p>
          </div>
          <div class="row-actions">
            <button :class="{ ghost: expandedId !== seedling.id }" type="button" @click="toggleLogPanel(seedling)">{{ localeStore.t('seedlings.growthLog') }} {{ expandedId === seedling.id ? '▲' : '▼' }}</button>
            <template v-if="showForm && farmMembersStore.canWrite('seedlings')">
              <button :class="{ ghost: editingId !== seedling.id }" @click="editSeedling(seedling)">{{ localeStore.t('common.edit') }}</button>
              <button class="danger" @click="confirmDeleteSeedling(seedling)">{{ localeStore.t('common.delete') }}</button>
            </template>
          </div>

          <!-- 성장 기록 인라인 패널 -->
          <div v-if="expandedId === seedling.id" class="log-panel">
            <div class="row-actions align-start log-history-label">
              <p class="muted" style="margin: 0;">{{ localeStore.t('seedlings.growthHistory') }}</p>
              <button v-if="!showAddLog && farmMembersStore.canWrite('seedlings')" class="ghost compact-btn" type="button" @click="openAddLog">{{ localeStore.t('seedlings.addLogTrigger') }}</button>
            </div>

            <form v-if="showAddLog" class="stack-form" style="margin-bottom: 1rem;" @submit.prevent="recordLog(seedling)">
              <label>{{ localeStore.t('seedlings.growthNote') }}
                <textarea v-model="logNote" required rows="3" />
              </label>
              <label class="step-photo-label">{{ localeStore.t('seedlings.attachPhotos') }}
                <input accept="image/*" multiple type="file" @change="handleLogPhotoChange" />
              </label>
              <p class="muted text-sm">{{ localeStore.t('seedlings.photoLimit') }}</p>
              <p v-if="logCompressionReport" class="muted text-sm">{{ logCompressionReport }}</p>
              <div v-if="logPhotoPreviews.length" class="photo-grid">
                <figure v-for="photo in logPhotoPreviews" :key="photo.id" class="photo-card">
                  <button type="button" class="photo-card-btn" @click="openLightbox(photo)">
                    <img :src="store.photoSrc(photo)" :alt="localeStore.t('seedlings.growthPhoto')" />
                  </button>
                  <button type="button" class="danger photo-card-delete" @click="removeLogPreviewPhoto(photo.id)">{{ localeStore.t('common.delete') }}</button>
                </figure>
              </div>
              <div class="row-actions">
                <button type="submit">{{ localeStore.t('seedlings.addGrowthLog') }}</button>
                <button class="ghost" type="button" @click="cancelAddLog">{{ localeStore.t('common.cancel') }}</button>
              </div>
            </form>

            <ul class="list clean">
              <li v-for="log in (seedling.growthLogs || [])" :key="logKey(log)" class="list-item">
                <!-- 표시 모드 -->
                <template v-if="editingLogId !== logKey(log)">
                  <div class="log-entry">
                    <span class="log-entry-info">
                      <span class="item-meta">{{ formatLogDate(log.date) }}</span>
                    </span>
                    <span v-if="farmMembersStore.canWrite('seedlings')" class="log-entry-actions">
                      <button class="ghost icon-btn" type="button" :title="localeStore.t('common.edit')" :aria-label="localeStore.t('common.edit')" @click="startEditLog(log)">✎</button>
                      <button class="danger icon-btn" type="button" :title="localeStore.t('common.delete')" :aria-label="localeStore.t('common.delete')" @click="deleteLog(seedling, log)">✕</button>
                    </span>
                  </div>
                  <p style="font-size: 0.9rem; white-space: pre-wrap;">{{ log.note }}</p>
                  <div v-if="log.photos?.length" class="photo-grid compact-grid">
                    <figure v-for="photo in log.photos" :key="photo.id" class="photo-card">
                      <button type="button" class="photo-card-btn" @click="openLightbox(photo)">
                        <img :src="store.photoSrc(photo)" :alt="localeStore.t('seedlings.growthPhoto')" />
                      </button>
                    </figure>
                  </div>
                </template>

                <!-- 편집 모드 -->
                <template v-else>
                  <p class="item-meta">{{ formatLogDate(log.date) }}</p>
                  <form class="stack-form" @submit.prevent="saveEditLog(seedling)">
                    <label>{{ localeStore.t('seedlings.growthNote') }}
                      <textarea v-model="editLogNote" required rows="3" />
                    </label>
                    <template v-if="editLogPhotos.length">
                      <p class="muted text-sm">{{ localeStore.t('seedlings.existingPhotos') }}</p>
                      <div class="photo-grid">
                        <figure v-for="photo in editLogPhotos" :key="photo.id" class="photo-card">
                          <button type="button" class="photo-card-btn" @click="openLightbox(photo)">
                            <img :src="store.photoSrc(photo)" :alt="localeStore.t('seedlings.growthPhoto')" />
                          </button>
                          <button type="button" class="danger photo-card-delete" @click="removeEditExistingPhoto(photo.id)">{{ localeStore.t('common.delete') }}</button>
                        </figure>
                      </div>
                    </template>
                    <label class="step-photo-label">{{ localeStore.t('seedlings.attachPhotos') }}
                      <input accept="image/*" multiple type="file" @change="handleEditLogPhotoChange" />
                    </label>
                    <p v-if="editLogCompressionReport" class="muted text-sm">{{ editLogCompressionReport }}</p>
                    <div v-if="editLogNewPreviews.length" class="photo-grid">
                      <figure v-for="photo in editLogNewPreviews" :key="photo.id" class="photo-card">
                        <button type="button" class="photo-card-btn" @click="openLightbox(photo)">
                          <img :src="store.photoSrc(photo)" :alt="localeStore.t('seedlings.growthPhoto')" />
                        </button>
                        <button type="button" class="danger photo-card-delete" @click="removeEditNewPhoto(photo.id)">{{ localeStore.t('common.delete') }}</button>
                      </figure>
                    </div>
                    <div class="row-actions">
                      <button type="submit">{{ localeStore.t('common.change') }}</button>
                      <button class="ghost" type="button" @click="cancelEditLog">{{ localeStore.t('common.cancel') }}</button>
                    </div>
                  </form>
                </template>
              </li>
              <li v-if="!seedling.growthLogs?.length" class="muted text-sm">{{ localeStore.t('seedlings.noGrowthLogs') }}</li>
            </ul>
          </div>
          <div :id="`seed-form-slot-${seedling.id}`" class="mobile-form-slot"></div>
        </li>
        <li v-if="!displayedSeedlings.length" class="muted">{{ localeStore.t('common.noData') }}</li>
      </ul>
    </article>

    <Teleport v-if="showForm && formOpen" :to="formTarget" :disabled="!isMobile">
    <article v-if="showForm && formOpen" class="card">
      <div v-if="!editingId" class="inline-filters" style="margin-bottom: 1rem;">
        <button type="button" :class="{ ghost: batchMode }" @click="switchMode('single')">{{ localeStore.t('seedlings.addTitle') }}</button>
        <button type="button" :class="{ ghost: !batchMode }" @click="switchMode('batch')">{{ localeStore.t('seedlings.batchAdd') }}</button>
      </div>

      <template v-if="batchMode">
      <h3>{{ localeStore.t('seedlings.batchTitle') }}</h3>
      <form class="stack-form" @submit.prevent="saveBatch">
        <label>
          {{ localeStore.t('seedlings.greenhouse') }}
          <select v-model="batch.greenhouseId" required>
            <option v-for="facility in store.state.facilities" :key="facility.id" :value="facility.id">
              {{ facility.name }}
            </option>
          </select>
        </label>
        <label>{{ localeStore.t('seedlings.batchRowRange') }}</label>
        <div class="row-actions">
          <label style="flex: 1;">
            {{ localeStore.t('seedlings.batchRowFrom') }}
            <select v-model.number="batch.rowFrom">
              <option v-for="r in rowOptions" :key="r" :value="r">{{ r }}{{ localeStore.t('seedlings.positionUnit') }}</option>
            </select>
          </label>
          <label style="flex: 1;">
            {{ localeStore.t('seedlings.batchRowTo') }}
            <select v-model.number="batch.rowTo">
              <option v-for="r in rowOptions" :key="r" :value="r">{{ r }}{{ localeStore.t('seedlings.positionUnit') }}</option>
            </select>
          </label>
        </div>
        <label>{{ localeStore.t('seedlings.batchCols') }}</label>
        <div class="row-actions">
          <label v-for="c in colOptions" :key="c" style="display: flex; flex-direction: row; align-items: center; gap: 0.3rem;">
            <input type="checkbox" :checked="batch.cols.includes(c)" @change="toggleBatchCol(c)" />
            {{ c }}
          </label>
        </div>
        <label>
          {{ localeStore.t('seedlings.variety') }}
          <select v-model="batch.variety">
            <option v-for="v in grownVarieties" :key="v" :value="v">{{ v }}</option>
          </select>
        </label>
        <label>
          {{ localeStore.t('seedlings.plantingDate') }}
          <input v-model="batch.plantedAt" required type="date" />
        </label>
        <label>
          {{ localeStore.t('seedlings.rootstock') }}
          <select v-model="batch.rootstock">
            <option value="">{{ localeStore.t('seedlings.na') }}</option>
            <option v-for="r in store.state.appSettings?.rootstockTypes ?? []" :key="r" :value="r">{{ r }}</option>
          </select>
        </label>
        <label>
          {{ localeStore.t('seedlings.notes') }}
          <textarea v-model="batch.notes" rows="3" />
        </label>
        <p class="muted">{{ localeStore.t('seedlings.batchPreview', { count: batchCount }) }}</p>
        <div class="row-actions">
          <button type="submit" :disabled="batchCount === 0">{{ localeStore.t('seedlings.batchSubmit', { count: batchCount }) }}</button>
          <button class="ghost" type="button" @click="clearBatch">{{ localeStore.t('common.reset') }}</button>
        </div>
      </form>
      </template>

      <template v-else>
      <h3>{{ editingId ? localeStore.t('seedlings.editTitle') : localeStore.t('seedlings.addTitle') }}</h3>
      <form class="stack-form" @submit.prevent="saveSeedling">
        <label>
          {{ localeStore.t('seedlings.greenhouse') }}
          <select v-model="form.greenhouseId" required>
            <option v-for="facility in store.state.facilities" :key="facility.id" :value="facility.id">
              {{ facility.name }}
            </option>
          </select>
        </label>
        <label>{{ localeStore.t('seedlings.position') }}</label>
        <div class="row-actions">
          <label style="flex: 1;">
            {{ localeStore.t('seedlings.positionRow') }}
            <select v-model="form.positionRow">
              <option value="">{{ localeStore.t('seedlings.na') }}</option>
              <option v-for="r in rowOptions" :key="r" :value="r">{{ r }}{{ localeStore.t('seedlings.positionUnit') }}</option>
            </select>
          </label>
          <label style="flex: 1;">
            {{ localeStore.t('seedlings.positionCol') }}
            <select v-model="form.positionCol">
              <option value="">{{ localeStore.t('seedlings.na') }}</option>
              <option v-for="c in colOptions" :key="c" :value="c">{{ c }}</option>
            </select>
          </label>
        </div>
        <label>
          {{ localeStore.t('seedlings.variety') }}
          <select v-model="form.variety">
            <option v-for="v in formVarietyOptions" :key="v" :value="v">{{ v }}</option>
          </select>
        </label>
        <label>
          {{ localeStore.t('seedlings.plantingDate') }}
          <input v-model="form.plantedAt" required type="date" />
        </label>
        <label>
          {{ localeStore.t('seedlings.rootstock') }}
          <select v-model="form.rootstock">
            <option value="">{{ localeStore.t('seedlings.na') }}</option>
            <option v-for="r in store.state.appSettings?.rootstockTypes ?? []" :key="r" :value="r">{{ r }}</option>
          </select>
        </label>
        <label>
          {{ localeStore.t('seedlings.notes') }}
          <textarea v-model="form.notes" rows="3" />
        </label>
        <div class="row-actions">
          <button type="submit">{{ editingId ? localeStore.t('common.change') : localeStore.t('common.add') }}</button>
          <button v-if="editingId" class="ghost" type="button" @click="clearForm">{{ localeStore.t('common.cancel') }}</button>
        </div>
      </form>
      </template>
    </article>
    </Teleport>
  </div>
</template>
