<script setup>
import { ref, computed, watch } from 'vue'
import { useRecommendSettingsStore } from '../stores/recommendSettingsStore.js'
import { useAvailablePesticideStore, parsePurchaseText } from '../stores/availablePesticideStore.js'
import { moaColor } from '../services/recommend.js'
import {
  searchGroupedFlat, formatPreHarvest, formatMaxApplications,
  TOXIC_GRADES, FISH_TOXIC_GRADES, formatFishToxic, formatFishToxicBadge,
} from '../services/pesticide.js'
import { usePesticideTypes } from '../composables/usePesticideTypes.js'
import { usePesticideInventoryStock } from '../composables/usePesticideInventoryStock.js'
import { useIsMobile } from '../composables/useIsMobile.js'
import { useLocaleStore } from '../stores/localeStore'
import { confirm } from '../composables/useConfirm'
import { useFarmsStore } from '../stores/farmsStore'
import { useAppPolicyStore } from '../stores/appPolicyStore'
import { useFarmMembersStore } from '../stores/farmMembersStore'
import { confirmFilteredExport, downloadCsv, exportFileName, openPrintReport, today } from '../utils/dataExport.js'
import { categoryClass, toxicClass, fishToxicClass } from '../utils/pesticideBadgeClass.js'
import PesticideLinkResults from './PesticideLinkResults.vue'
import MobileFilterBar from './MobileFilterBar.vue'
import OverflowMenu from './OverflowMenu.vue'

const settingsStore = useRecommendSettingsStore()
const apStore       = useAvailablePesticideStore()
const localeStore   = useLocaleStore()
const farmsStore    = useFarmsStore()
const policyStore   = useAppPolicyStore()
const farmMembersStore = useFarmMembersStore()
const { resolveType: normCat, typeNames: pesticideTypes } = usePesticideTypes()
const { inventoryPesticides, inventoryStockMap, inStockPesticides, stockLotLabel } = usePesticideInventoryStock()
const { isMobile } = useIsMobile()

const categoryClassFor = (cat) => categoryClass(normCat(cat))

// 초기화 버튼 — 시스템 관리 모드에서 기능을 "사용"으로 켜고, 이 농장에서 "표시"로 켠 경우에만 노출한다.
const showResetButton = computed(() =>
  policyStore.policy.enableResetFeature && settingsStore.settings.showResetButtons,
)

const apInputText    = ref('')
const apFilter        = ref('')
const apSourceFilter  = ref('all')   // 'all' | 'purchase' | 'inventory'
// '미연결'(matchSource 없음)과 '수동'(matchSource === 'manual')은 한 항목이 동시에 만족할 수
// 없으므로, 함께 켜서 결과가 항상 0건이 되는 상태를 만들지 않는다(한쪽을 켜면 다른 쪽을 끈다).
const apUnmatchedOnly = ref(false)
const apManualOnly   = ref(false)

function toggleApUnmatchedOnly() {
  apUnmatchedOnly.value = !apUnmatchedOnly.value
  if (apUnmatchedOnly.value) apManualOnly.value = false
}

function toggleApManualOnly() {
  apManualOnly.value = !apManualOnly.value
  if (apManualOnly.value) apUnmatchedOnly.value = false
}
const apEditMode     = ref(false)
const matchingItemId = ref(null)   // 수동 연결 패널이 열린 아이템 id
const matchQuery     = ref('')
const matchResults   = ref([])
const apBuilding     = ref(false)
const manualEditId   = ref(null)   // 직접 입력/수정 패널이 열린 아이템 id
const manualEditForm = ref({
  category: '', moa: '', targetPests: '',
  preHarvestDays: '', maxApplications: '', ingredient: '', manufacturer: '', toxicName: '', fishToxic: '',
})
const apRefreshMessage = ref('')

const manualEditItem = computed(() =>
  manualEditId.value ? apStore.availableList.find(p => p.id === manualEditId.value) ?? null : null,
)
const apFormTarget = computed(() => {
  if (manualEditId.value && filteredApList.value.some(p => p.id === manualEditId.value)) {
    return `#ap-form-slot-${manualEditId.value}`
  }
  return apStore.availableList.length > 0 ? '#ap-form-top-list' : '#ap-form-top-empty'
})

const apFormMode = ref('single') // 'single' | 'bulk'

function closeApEdit() {
  apEditMode.value     = false
  matchingItemId.value = null
  matchQuery.value     = ''
  matchResults.value   = []
  manualEditId.value   = null
  apFormMode.value     = 'single'
  apRefreshMessage.value = ''
  newApBrand.value       = ''
  newApForm.value        = ''
  newApVolume.value      = ''
  newApLinkResults.value = []
  newApMessage.value     = ''
  apBulkAppendText.value = ''
}

async function refreshAllPesticideInfo() {
  apBuilding.value = true
  let updated = 0
  let filled = 0
  try {
    updated = apStore.refreshAllFromCache()
    filled = await apStore.fillToxicityFromShared()
  } finally {
    apBuilding.value = false
  }
  const parts = []
  if (updated > 0) parts.push(`${updated}개 항목 정보를 갱신했습니다.`)
  if (filled > 0) parts.push(`독성정보 ${filled}건을 추가로 가져왔습니다.`)
  apRefreshMessage.value = parts.length ? parts.join(' ') : '갱신할 항목이 없습니다 (수동 연결 항목 제외).'
}

// 재고반영 — 구입가능농약 입력은 그대로 둔 채, 농약재고(재고농약 카테고리)의 현재 상태만
// 다시 반영해 목록을 새로 만든다. 재고를 새로 등록·수정·삭제한 뒤 목록에 즉시 반영할 때 쓴다.
async function applyInventoryToApList() {
  apBuilding.value = true
  let filled = 0
  try {
    apStore.buildList(inStockPesticides.value)
    filled = await apStore.fillToxicityFromShared()
  } finally {
    apBuilding.value = false
  }
  const parts = ['현재 재고를 반영했습니다.']
  if (filled > 0) parts.push(`독성정보 ${filled}건을 추가로 가져왔습니다.`)
  apRefreshMessage.value = parts.join(' ')
}

// 가용농약 전체 초기화 — 관리모드 동작 설정에서 "초기화 버튼: 표시"일 때만 노출된다.
const apHasData = computed(() => apStore.availableList.length > 0 || !!apStore.purchaseInput)

async function resetAvailablePesticides() {
  if (!apHasData.value) return
  const ok = await confirm({
    title: localeStore.t('confirm.resetTitle'),
    message: localeStore.t('confirm.resetAvailablePesticides', { n: apStore.availableList.length }),
    confirmLabel: localeStore.t('common.reset'),
  })
  if (!ok) return
  apStore.clearAll()
  matchingItemId.value   = null
  matchQuery.value       = ''
  matchResults.value     = []
  manualEditId.value     = null
  apRefreshMessage.value = '가용농약 목록을 초기화했습니다.'
}

const parsedCount = computed(() => parsePurchaseText(apInputText.value).length)

const apStats = computed(() => {
  const total   = apStore.availableList.length
  const matched = apStore.availableList.filter(p => p.matchSource).length
  const manual  = apStore.availableList.filter(p => p.matchSource === 'manual').length
  return { total, matched, unmatched: total - matched, manual }
})

const apIsFiltered = computed(() =>
  apSourceFilter.value !== 'all' || apUnmatchedOnly.value || apManualOnly.value || !!apFilter.value.trim(),
)

// 모바일 필터시트(MobileFilterBar)에 표시할 "적용된 필터" 요약 — 기존 ref 를 그대로 읽고 쓴다.
const apActiveFilters = computed(() => [
  apSourceFilter.value === 'purchase' && {
    key: 'source', label: `구입가능 (${apSourceCounts.value.purchase})`, clear: () => { apSourceFilter.value = 'all' },
  },
  apSourceFilter.value === 'inventory' && {
    key: 'source', label: `재고 (${apSourceCounts.value.inventory})`, clear: () => { apSourceFilter.value = 'all' },
  },
  apUnmatchedOnly.value && {
    key: 'unmatched', label: `미연결만 (${apStats.value.unmatched})`, clear: () => { apUnmatchedOnly.value = false },
  },
  apManualOnly.value && {
    key: 'manual', label: `수동만 (${apStats.value.manual})`, clear: () => { apManualOnly.value = false },
  },
  apFilter.value.trim() && {
    key: 'text', label: `"${apFilter.value.trim()}"`, clear: () => { apFilter.value = '' },
  },
].filter(Boolean))

function apClearAllFilters() {
  apSourceFilter.value = 'all'
  apUnmatchedOnly.value = false
  apManualOnly.value = false
  apFilter.value = ''
}

// '재고'는 재고에 실제로 있는 항목 전체(구입가능 목록과 겹치는 'both' 포함),
// '구입가능'은 구입 가능한 항목 전체('both' 포함) — 둘은 서로 배타적이지 않다.
const apSourceCounts = computed(() => ({
  purchase: apStore.availableList.filter(p => p.source === 'purchase' || p.source === 'both').length,
  inventory: apStore.availableList.filter(p => p.source === 'inventory' || p.source === 'both').length,
}))

const filteredApList = computed(() => {
  let list = apStore.availableList
  if (apSourceFilter.value === 'purchase') list = list.filter(p => p.source === 'purchase' || p.source === 'both')
  else if (apSourceFilter.value === 'inventory') list = list.filter(p => p.source === 'inventory' || p.source === 'both')
  if (apUnmatchedOnly.value) list = list.filter(p => !p.matchSource)
  if (apManualOnly.value) list = list.filter(p => p.matchSource === 'manual')
  const q = apFilter.value.trim().toLowerCase()
  if (q) list = list.filter(p =>
    p.brandName.toLowerCase().includes(q) ||
    normCat(p.category).includes(q) ||
    p.moa.toLowerCase().includes(q) ||
    p.targetPests.some(t => t.toLowerCase().includes(q)),
  )
  return [...list].sort((a, b) => a.brandName.localeCompare(b.brandName, 'ko'))
})

// 필터 변경으로 직접 입력/수정 중인 항목이 목록에서 사라지면 보이지 않는 항목을 계속
// 편집하는 상태로 남기지 않는다.
watch(filteredApList, (list) => {
  if (manualEditId.value && !list.some(p => p.id === manualEditId.value)) {
    manualEditId.value = null
  }
})

function matchLabel(src) {
  if (src === 'api')       return '자동'
  if (src === 'manual')    return '수동'
  if (src === 'inventory') return '재고'
  return '미연결'
}

const AP_SOURCE_LABEL = { purchase: '구입가능', inventory: '재고', both: '구입가능·재고' }

// 현재 필터(출처·미연결·수동·검색어)가 적용된 목록 그대로 CSV로 내려받는다.
async function downloadApListCsv() {
  const ok = await confirmFilteredExport({
    filtered: apIsFiltered.value,
    shown: filteredApList.value.length,
    total: apStats.value.total,
  })
  if (!ok) return

  const rows = [[
    '상표명', '형태', '용량', '출처', '연결', '분류', '작용기작',
    '대상 병해충', '수확 전 일수', '최대 사용 횟수', '독성', '어독성', '주성분', '제조사',
  ]]
  for (const p of filteredApList.value) {
    rows.push([
      p.brandName,
      p.form || '',
      p.volume || '',
      AP_SOURCE_LABEL[p.source] ?? '',
      matchLabel(p.matchSource),
      normCat(p.category) || '',
      p.moa || '',
      (p.targetPests || []).join(' / '),
      formatPreHarvest(p.preHarvestDays),
      formatMaxApplications(p.maxApplications),
      p.toxicName || '',
      formatFishToxic(p.fishToxic),
      p.ingredient || '',
      p.manufacturer || '',
    ])
  }
  downloadCsv(rows, exportFileName({
    farmName: farmsStore.activeFarm?.name,
    label: '가용농약',
    date: today(),
  }))
}

async function printApList() {
  const shown = filteredApList.value.length
  const total = apStats.value.total
  const ok = await confirmFilteredExport({ filtered: apIsFiltered.value, shown, total, kind: 'pdf' })
  if (!ok) return

  // 인쇄 지면이 좁아 CSV보다 열을 줄인다(형태·용량은 상표명에 붙이고, 주성분·제조사는 제외).
  openPrintReport({
    farmName: farmsStore.activeFarm?.name,
    title: '가용농약 목록',
    meta: `${localeStore.t('inventory.reportGeneratedAt', { date: today() })} · 총 ${shown}종${shown < total ? ` (전체 ${total}종 중 필터 적용)` : ''}`,
    headers: ['농약명', '출처', '분류', '작용기작', '대상 병해충', '수확 전 일수', '최대 사용 횟수', '독성', '어독성'],
    rows: filteredApList.value.map(p => [
      [p.brandName, p.form ? `(${p.form})` : '', p.volume].filter(Boolean).join(' '),
      AP_SOURCE_LABEL[p.source] ?? '',
      normCat(p.category) || '',
      p.moa || '',
      (p.targetPests || []).join(', '),
      formatPreHarvest(p.preHarvestDays),
      formatMaxApplications(p.maxApplications),
      p.toxicName || '',
      formatFishToxic(p.fishToxic),
    ]),
    autoPrint: policyStore.policy.autoOpenPrintDialog,
  })
}

async function buildApList() {
  apStore.savePurchaseInput(apInputText.value)
  apBuilding.value = true
  try {
    apStore.buildList(inStockPesticides.value)
    await fillApToxicity()
  } finally { apBuilding.value = false }
}

// 목록을 만든 직후, 독성이 비어 있는 항목은 공유 캐시에서 상세정보를 끌어와 채운다.
async function fillApToxicity() {
  const filled = await apStore.fillToxicityFromShared()
  apRefreshMessage.value = filled > 0 ? `독성정보 ${filled}건을 추가로 가져왔습니다.` : ''
}

// 붙여넣기 일괄추가(설정 > 동작 > 붙여넣기 일괄추가 방식): 'append'는 새로 입력한 내용만
// 기존 구입가능농약 텍스트에 더하고, 'replace'는 텍스트 전체를 붙여넣은 내용으로 대체한다(기존 동작).
const apBulkIsAppend    = computed(() => settingsStore.settings.bulkImportMode === 'append')
const apBulkAppendText  = ref('')
const apBulkAppendCount = computed(() => parsePurchaseText(apBulkAppendText.value).length)
const apBulkCurrentCount = computed(() => apBulkIsAppend.value ? apBulkAppendCount.value : parsedCount.value)

async function buildApListAppend() {
  const merged = [apStore.purchaseInput.trim(), apBulkAppendText.value.trim()].filter(Boolean).join('\n')
  apBuilding.value = true
  try {
    apStore.savePurchaseInput(merged)
    apStore.buildList(inStockPesticides.value)
    await fillApToxicity()
  } finally {
    apBuilding.value = false
  }
  apBulkAppendText.value = ''
}

async function submitApBulk() {
  if (apBulkIsAppend.value) await buildApListAppend()
  else await buildApList()
}

// ── 가용농약 새 항목 단일 추가 (구입가능농약 입력 텍스트에 한 줄 추가 후 재작성) ──────
const newApBrand       = ref('')
const newApForm        = ref('')
const newApVolume      = ref('')
const newApLinkResults = ref([])
const newApMessage     = ref('')

function onNewApBrandInput(val) {
  newApMessage.value = ''
  const q = val.trim()
  if (!q) { newApLinkResults.value = []; return }
  newApLinkResults.value = searchGroupedFlat(q, 10)
}

function applyNewApLink(apiItem) {
  newApBrand.value = apiItem.brandName
  newApLinkResults.value = []
}

async function submitNewApItem() {
  const brand = newApBrand.value.trim()
  if (!brand) return
  const formPart = newApForm.value.trim()
  const volPart   = newApVolume.value.trim()
  const formSuffix = formPart ? `(${formPart})` : ''
  const volSuffix   = volPart ? `-${volPart}` : ''
  const segment = `${brand}${formSuffix}${volSuffix}`
  const existing = apInputText.value.trim()
  apInputText.value = existing ? `${existing}\n${segment}` : segment
  await buildApList()
  newApMessage.value = `"${brand}" 추가됨`
  newApBrand.value  = ''
  newApForm.value   = ''
  newApVolume.value = ''
  newApLinkResults.value = []
}

function openManualMatch(itemId) {
  manualEditId.value = null
  if (matchingItemId.value === itemId) {
    matchingItemId.value = null
    matchQuery.value = ''
    matchResults.value = []
    return
  }
  matchingItemId.value = itemId
  matchQuery.value = ''
  matchResults.value = []
}

function searchApiCandidates(query) {
  const q = query.trim()
  if (!q) { matchResults.value = []; return }
  matchResults.value = searchGroupedFlat(q, 12)
}

function applyMatch(itemId, apiItem) {
  apStore.applyManualMatch(itemId, apiItem)
  matchingItemId.value = null
  matchQuery.value = ''
  matchResults.value = []
}

async function confirmDeleteAp(item) {
  const ok = await confirm({ message: localeStore.t('confirm.availablePesticide', { brandName: item.brandName }) })
  if (!ok) return
  apStore.removeFromList(item.id)
}

function openManualEdit(item) {
  matchingItemId.value = null
  matchQuery.value = ''
  matchResults.value = []
  if (manualEditId.value === item.id) {
    manualEditId.value = null
    return
  }
  manualEditId.value = item.id
  manualEditForm.value = {
    // 저장값은 OpenAPI 원본 표기('살균' 등)일 수 있어, 드롭다운 선택지와 같은 표시명으로 맞춘다.
    category:        normCat(item.category) || '',
    moa:             item.moa || '',
    targetPests:     (item.targetPests || []).join(', '),
    preHarvestDays:  item.preHarvestDays || '',
    maxApplications: item.maxApplications || '',
    ingredient:      item.ingredient || '',
    manufacturer:    item.manufacturer || '',
    toxicName:       item.toxicName || '',
    fishToxic:       item.fishToxic || '',
  }
}

function saveManualEdit(item) {
  const f = manualEditForm.value
  apStore.updateManualInfo(item.id, {
    category:        f.category.trim(),
    moa:             f.moa.trim(),
    targetPests:     f.targetPests.split(',').map(s => s.trim()).filter(Boolean),
    preHarvestDays:  f.preHarvestDays.trim(),
    maxApplications: f.maxApplications.trim(),
    ingredient:      f.ingredient.trim(),
    manufacturer:    f.manufacturer.trim(),
    toxicName:       f.toxicName,
    fishToxic:       f.fishToxic,
  })
  manualEditId.value = null
}

// apStore.init()은 App.vue에서 전역으로 한 번 호출되며, Firestore 동기화 시점에 따라
// purchaseInput이 마운트 이후에 채워질 수 있으므로 값을 반응형으로 동기화한다.
watch(() => apStore.purchaseInput, (v) => { apInputText.value = v }, { immediate: true })
</script>

<template>
  <section :class="['page-grid', apEditMode ? 'two-columns' : '']">
    <article>

    <div class="pip-header">
      <div class="pip-actions">
        <OverflowMenu
          v-if="apEditMode && ((showResetButton && apHasData) || apStore.availableList.length > 0 || inventoryPesticides.length > 0)"
          title="더보기"
        >
          <button
            v-if="showResetButton && apHasData"
            class="danger"
            type="button"
            @click="resetAvailablePesticides"
          >{{ localeStore.t('common.reset') }}</button>
          <button v-if="apStore.availableList.length > 0" class="ghost" type="button" @click="refreshAllPesticideInfo">
            전체 재연결
          </button>
          <button v-if="inventoryPesticides.length > 0" class="ghost" type="button" @click="applyInventoryToApList">
            재고반영
          </button>
        </OverflowMenu>
        <OverflowMenu v-else-if="apStore.availableList.length > 0" title="더보기">
          <button class="ghost" type="button" @click="printApList">{{ localeStore.t('inventory.printReport') }}</button>
          <button class="ghost" type="button" @click="downloadApListCsv">{{ localeStore.t('inventory.downloadReport') }}</button>
        </OverflowMenu>
        <button v-if="!apEditMode && farmMembersStore.canWrite('treatments')" type="button" @click="apEditMode = true">{{ localeStore.t('common.edit') }}</button>
        <button v-else-if="apEditMode" class="ghost" type="button" @click="closeApEdit">{{ localeStore.t('common.exitEdit') }}</button>
      </div>
    </div>
    <p v-if="apRefreshMessage" class="muted text-sm" style="margin: -0.4rem 0 0.6rem;">{{ apRefreshMessage }}</p>

    <!-- 재고농약 표시 -->
    <div class="ap-inv-row">
      <span class="ap-inv-label">재고농약</span>
      <span v-if="inventoryPesticides.length > 0" class="pill ap-inv-pill">{{ inventoryPesticides.length }}종</span>
      <span v-else class="muted text-sm">없음 (재고 메뉴에서 농약 카테고리 항목 추가)</span>
      <span v-if="inventoryPesticides.length > 0" class="ap-inv-names">
        {{ inventoryPesticides.map(i => i.name).slice(0, 5).join(' · ') }}{{ inventoryPesticides.length > 5 ? ' 외 ' + (inventoryPesticides.length - 5) + '종' : '' }}
      </span>
    </div>

    <!-- 가용농약 목록 -->
    <template v-if="apStore.availableList.length > 0">
      <MobileFilterBar :active="apActiveFilters" :on-reset-all="apClearAllFilters" title="필터">
        <template #always>
          <span class="summary-chip">{{ apIsFiltered ? localeStore.t('common.filteredCount', { shown: filteredApList.length, total: apStats.total }) : localeStore.t('common.totalCount', { n: filteredApList.length }) }}</span>
        </template>
        <span class="filter-sep">|</span>
        <div class="seg-filter">
          <button class="seg-btn" :class="{ active: apSourceFilter === 'all' }"       @click="apSourceFilter = 'all'">전체 ({{ apStats.total }})</button>
          <button class="seg-btn" :class="{ active: apSourceFilter === 'purchase' }"  @click="apSourceFilter = 'purchase'">구입가능 ({{ apSourceCounts.purchase }})</button>
          <button class="seg-btn" :class="{ active: apSourceFilter === 'inventory' }" @click="apSourceFilter = 'inventory'">재고 ({{ apSourceCounts.inventory }})</button>
        </div>
        <button
          class="ghost ap-unmatched-btn"
          :class="{ 'ap-unmatched-active': apUnmatchedOnly }"
          @click="toggleApUnmatchedOnly"
        >미연결만 ({{ apStats.unmatched }})</button>
        <button
          class="ghost ap-unmatched-btn"
          :class="{ 'ap-unmatched-active': apManualOnly }"
          @click="toggleApManualOnly"
        >수동만 ({{ apStats.manual }})</button>
        <input
          v-model="apFilter"
          type="text"
          class="ap-filter-input"
          placeholder="필터 (농약명, 분류, 작용기작, 병해충)"
        />
      </MobileFilterBar>

      <div id="ap-form-top-list" class="mobile-form-slot"></div>

      <div class="ap-list">
        <div v-for="item in filteredApList" :key="item.id" class="ap-card">
          <!-- 카드 메인 -->
          <div class="ap-card-body">
            <div class="ap-card-name-row">
              <span class="ap-brand">{{ item.brandName }}</span>
              <span v-if="item.form"   class="ap-form">({{ item.form }})</span>
              <span v-if="item.volume" class="ap-vol">{{ item.volume }}</span>
            </div>
            <div class="ap-card-badges">
              <span v-if="item.category" class="cat-badge" :class="categoryClassFor(item.category)">
                {{ normCat(item.category) }}
              </span>
              <span v-if="item.moa" class="moa-badge" :style="{ background: moaColor(item.moa) }">
                {{ item.moa }}
              </span>
              <span v-if="item.toxicName" class="toxic-badge" :class="toxicClass(item.toxicName)">
                {{ item.toxicName }}
              </span>
              <span v-if="item.fishToxic" class="toxic-badge" :class="fishToxicClass(item.fishToxic)">
                {{ formatFishToxicBadge(item.fishToxic) }}
              </span>
              <span
                class="source-badge"
                :class="{ 'src-purchase': item.source === 'purchase', 'src-inv': item.source === 'inventory', 'src-both': item.source === 'both' }"
              >
                {{ item.source === 'both' ? '구입+재고' : item.source === 'purchase' ? '구입가능' : '재고' }}
              </span>
              <span class="match-badge" :class="item.matchSource ? 'match-ok' : 'match-none'">
                {{ matchLabel(item.matchSource) }}
              </span>
            </div>
            <div v-if="item.targetPests.length" class="ap-pests">
              {{ item.targetPests.join(' · ') }}
            </div>
            <div v-if="item.preHarvestDays" class="ap-safety">
              {{ formatPreHarvest(item.preHarvestDays) }} · {{ formatMaxApplications(item.maxApplications) }}
            </div>
            <div v-if="item.ingredient" class="ap-ingredient">{{ item.ingredient }}</div>
            <div v-if="inventoryStockMap[item.brandName]?.length" class="ap-stock-row">
              재고
              <span
                v-for="lot in inventoryStockMap[item.brandName]"
                :key="`${lot.vol}-${lot.expiry}`"
                class="ap-stock-lot"
              >{{ stockLotLabel(lot) }}</span>
            </div>
          </div>

          <!-- 카드 액션 -->
          <div v-if="apEditMode && farmMembersStore.canWrite('treatments')" class="ap-card-actions">
            <button
              class="ghost"
              :class="{ 'link-btn-active': matchingItemId === item.id }"
              @click="openManualMatch(item.id)"
            >{{ item.matchSource === 'manual' ? '연결 변경' : (item.matchSource ? '수동 재연결' : '수동 연결') }}</button>
            <button
              v-if="item.matchSource === 'manual'"
              class="ghost"
              @click="apStore.clearManualMatch(item.id)"
            >연결 해제</button>
            <button
              class="ghost"
              :class="{ 'link-btn-active': manualEditId === item.id }"
              @click="openManualEdit(item)"
            >{{ item.matchSource ? '정보 수정' : '직접 입력' }}</button>
            <button class="danger" @click="confirmDeleteAp(item)">삭제</button>
          </div>

          <!-- 수동 연결 패널 -->
          <div v-if="matchingItemId === item.id" class="match-panel">
            <input
              type="text"
              v-model="matchQuery"
              placeholder="농약명 검색 (공공데이터)"
              class="match-search-input"
              @input="searchApiCandidates(matchQuery)"
            />
            <div v-if="matchResults.length" class="match-results">
              <PesticideLinkResults :results="matchResults" @apply="(r) => applyMatch(item.id, r)">
                <template #badges="{ item: r }">
                  <span class="cat-badge" :class="categoryClassFor(r.pesticideType)">{{ normCat(r.pesticideType) }}</span>
                  <span class="moa-badge" :style="{ background: moaColor(r.modeOfAction) }">{{ r.modeOfAction }}</span>
                </template>
              </PesticideLinkResults>
            </div>
            <p v-else-if="matchQuery.trim().length > 1" class="muted text-sm" style="padding:0.5rem 0;">
              검색 결과 없음 — 공공데이터가 없거나 농약정보를 먼저 가져와야 합니다.
            </p>
          </div>

          <div :id="`ap-form-slot-${item.id}`" class="mobile-form-slot"></div>
        </div>

        <p v-if="filteredApList.length === 0" class="empty-msg small">필터 결과 없음</p>
      </div>
    </template>
    <div v-else class="empty-msg">
      구입가능농약을 입력하거나 재고를 추가한 후 '목록 작성'을 눌러주세요.
      <div id="ap-form-top-empty" class="mobile-form-slot"></div>
    </div>

    </article>

    <!-- 편집 패널: 직접 입력/수정 중이면 해당 항목 폼, 아니면 구입가능농약 입력 폼 -->
    <Teleport v-if="apEditMode" :to="apFormTarget" :disabled="!isMobile">
    <article v-if="apEditMode" class="card">
      <template v-if="manualEditItem">
        <h2>{{ manualEditItem.brandName }} {{ manualEditItem.matchSource ? '정보 수정' : '직접 입력' }}</h2>
        <div class="manual-edit-grid">
          <label>분류
            <select v-model="manualEditForm.category">
              <option value="">선택 안 함</option>
              <!-- 농장 분류 목록에 없는 값(공공데이터의 기타 용도 등)도 선택 상태가 유지되도록 함께 노출한다. -->
              <option
                v-if="manualEditForm.category && !pesticideTypes.includes(manualEditForm.category)"
                :value="manualEditForm.category"
              >{{ manualEditForm.category }}</option>
              <option v-for="tp in pesticideTypes" :key="tp" :value="tp">{{ tp }}</option>
            </select>
          </label>
          <label>작용기작
            <input v-model="manualEditForm.moa" type="text" placeholder="예: 4a, 나1" />
          </label>
          <label>대상 병해충
            <input v-model="manualEditForm.targetPests" type="text" placeholder="쉼표로 구분 (예: 귤굴나방, 진딧물)" />
          </label>
          <label>수확 전 일수
            <input v-model="manualEditForm.preHarvestDays" type="text" placeholder="예: 14" />
          </label>
          <label>최대 사용 횟수
            <input v-model="manualEditForm.maxApplications" type="text" placeholder="예: 3" />
          </label>
          <label>독성 등급
            <select v-model="manualEditForm.toxicName">
              <option value="">선택 안 함</option>
              <option v-for="g in TOXIC_GRADES" :key="g" :value="g">{{ g }}</option>
            </select>
          </label>
          <label>어독성 등급
            <select v-model="manualEditForm.fishToxic">
              <option value="">선택 안 함</option>
              <option v-for="g in FISH_TOXIC_GRADES" :key="g" :value="g">{{ formatFishToxic(g) }}</option>
            </select>
          </label>
          <label>성분
            <input v-model="manualEditForm.ingredient" type="text" />
          </label>
          <label>제조사
            <input v-model="manualEditForm.manufacturer" type="text" />
          </label>
        </div>
        <div class="row-actions">
          <button type="button" @click="saveManualEdit(manualEditItem)">저장</button>
          <button class="ghost" type="button" @click="manualEditId = null">취소</button>
        </div>
      </template>
      <template v-else>
        <div class="inline-filters" style="margin-bottom: 1rem;">
          <button :class="{ ghost: apFormMode !== 'single' }" type="button" @click="apFormMode = 'single'">새 항목 추가</button>
          <button :class="{ ghost: apFormMode !== 'bulk' }" type="button" @click="apFormMode = 'bulk'">붙여넣기 일괄추가</button>
        </div>

        <template v-if="apFormMode === 'single'">
          <h2>새 항목 추가</h2>
          <form class="stack-form" @submit.prevent="submitNewApItem">
            <label>상표명
              <input
                v-model="newApBrand"
                placeholder="상표명 입력 (공공데이터 검색)"
                autocomplete="off"
                @input="onNewApBrandInput($event.target.value)"
              />
            </label>
            <div v-if="newApLinkResults.length" class="inv-api-panel">
              <PesticideLinkResults :results="newApLinkResults" @apply="applyNewApLink">
                <template #badges="{ item: r }">
                  <span v-if="r.pesticideType" class="cat-badge" :class="categoryClassFor(r.pesticideType)">{{ normCat(r.pesticideType) }}</span>
                  <span v-if="r.modeOfAction && r.modeOfAction !== '-'" class="moa-badge" :style="{ background: moaColor(r.modeOfAction) }">{{ r.modeOfAction }}</span>
                </template>
              </PesticideLinkResults>
            </div>
            <label>형태 <span class="muted">(선택)</span>
              <input v-model="newApForm" placeholder="예: 액상, 수화제" />
            </label>
            <label>용량 <span class="muted">(선택)</span>
              <input v-model="newApVolume" placeholder="예: 500ml" />
            </label>
            <div class="row-actions">
              <button type="submit" :disabled="!newApBrand.trim()">추가</button>
            </div>
          </form>
          <p v-if="newApMessage" class="muted text-sm" style="margin-top:0.5rem;">{{ newApMessage }}</p>
        </template>

        <template v-else>
        <h2>{{ apBulkIsAppend ? '붙여넣기로 일괄 추가' : '구입가능농약 입력' }}</h2>
        <p class="ap-hint">
          <code>상표명(형태)-용량</code> 형식, 줄바꿈으로 구분. 유사 농약은 <code>/</code>로 연결.<br>
          예) <code>만수무강(액상)-500ml</code> &nbsp;|&nbsp; <code>겔럭시(유)-200ml/올스타/오쏘도</code><br>
          현재 설정: <strong>{{ apBulkIsAppend ? '기존 목록에 추가' : '전체 새로 작성' }}</strong>
          <span v-if="apBulkIsAppend" class="muted">(붙여넣은 항목만 기존 구입가능농약 목록에 더해집니다 — 설정페이지에서 변경 가능)</span>
          <span v-else class="muted">(이 내용이 구입가능농약 전체 목록을 대체합니다 — 설정페이지에서 변경 가능)</span>
        </p>
        <textarea
          v-if="apBulkIsAppend"
          v-model="apBulkAppendText"
          class="ap-textarea"
          placeholder="새로 추가할 항목만 입력하세요..."
          rows="6"
        ></textarea>
        <textarea
          v-else
          v-model="apInputText"
          class="ap-textarea"
          placeholder="여기에 붙여넣기..."
          rows="6"
        ></textarea>
        <div class="ap-input-footer">
          <span v-if="apBulkCurrentCount > 0" class="ap-parse-count">{{ apBulkCurrentCount }}개 항목 인식됨</span>
          <span v-else class="ap-parse-count muted">입력 없음</span>
        </div>
        <div class="ap-build-row">
          <button
            :disabled="apBuilding || (apBulkIsAppend ? !apBulkAppendText.trim() : !apInputText.trim())"
            @click="submitApBulk"
          >
            {{ apBuilding ? '처리 중...' : (apBulkIsAppend ? '일괄 추가' : '목록 작성') }}
          </button>
          <span v-if="apStats.total > 0" class="ap-stats">
            {{ apStats.total }}개 &nbsp;·&nbsp; 연결 {{ apStats.matched }} &nbsp;·&nbsp; 미연결 {{ apStats.unmatched }}
          </span>
        </div>
        </template>
      </template>
    </article>
    </Teleport>
  </section>
</template>

<style scoped>
.link-btn-active { background: var(--primary) !important; color: var(--primary-ink) !important; border-color: var(--primary) !important; }

/* OpenAPI 검색 패널 (새 항목 추가 폼) */
.inv-api-panel {
  display: flex; flex-direction: column; gap: 0.2rem;
  max-height: 220px; overflow-y: auto;
  border: 1px solid var(--primary); border-radius: var(--radius-control);
  background: var(--bg);
  margin-top: -0.25rem; margin-bottom: 0.25rem;
}

.ap-inv-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0.6rem 0;
  font-size: 0.83rem;
}
.ap-inv-label { font-weight: 600; font-size: 0.82rem; color: var(--muted); }
.ap-inv-pill { font-size: 0.75rem; }
.ap-inv-names { font-size: 0.78rem; color: var(--muted); }

.ap-build-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.1rem;
  flex-wrap: wrap;
}
.ap-stats { font-size: 0.8rem; color: var(--muted); }

.ap-filter-input {
  flex: 1;
  min-width: 160px;
  font-size: 0.83rem;
  padding: 0.3rem 0.6rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--bg);
  color: var(--text);
}

.ap-list { display: flex; flex-direction: column; gap: 0.55rem; }

.ap-card {
  background: var(--bg-soft);
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  padding: 0.7rem 0.9rem;
}
.ap-card-body { margin-bottom: 0.45rem; }
.ap-card-name-row {
  display: flex;
  align-items: baseline;
  gap: 0.3rem;
  flex-wrap: wrap;
  margin-bottom: 0.3rem;
}
.ap-brand { font-weight: 600; font-size: 0.9rem; }
.ap-form  { font-size: 0.78rem; color: var(--muted); }
.ap-vol   { font-size: 0.78rem; color: var(--muted); }
.ap-card-badges {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-wrap: wrap;
  margin-bottom: 0.25rem;
}
.ap-pests     { font-size: 0.78rem; color: var(--muted); margin-bottom: 0.15rem; }
.ap-safety    { font-size: 0.78rem; color: var(--muted); }
.ap-ingredient { font-size: 0.75rem; color: var(--muted); margin-top: 0.1rem; font-style: italic; }
.ap-stock-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.2rem;
  font-size: 0.75rem;
  color: var(--muted);
  flex-wrap: wrap;
}
.ap-stock-lot {
  background: var(--tone-green-bg);
  color: var(--tone-green-text);
  border: 1px solid var(--tone-green-border);
  border-radius: 999px;
  padding: 0.08rem 0.5rem;
  font-size: 0.72rem;
  font-weight: 600;
}

.ap-card-actions {
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
}

.source-badge {
  font-size: 0.72rem;
  font-weight: 600;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  border: 1px solid;
}
.src-purchase { background: var(--tone-green-bg); color: var(--tone-green-text); border-color: var(--tone-green-border); }
.src-inv      { background: var(--tone-blue-bg); color: var(--tone-blue-text); border-color: var(--tone-blue-border); }
.src-both     { background: var(--tone-purple-bg); color: var(--tone-purple-text); border-color: var(--tone-purple-border); }

.match-panel {
  margin-top: 0.6rem;
  padding-top: 0.6rem;
  border-top: 1px dashed var(--line);
}
.match-search-input {
  width: 100%;
  box-sizing: border-box;
  font-size: 0.85rem;
  padding: 0.4rem 0.65rem;
  border: 1px solid var(--primary);
  border-radius: var(--radius-control);
  background: var(--bg);
  color: var(--text);
  margin-bottom: 0.4rem;
}
.match-search-input:focus { outline: none; }
.match-results {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-height: 240px;
  overflow-y: auto;
}

.manual-edit-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}
.manual-edit-grid label {
  font-size: 0.78rem;
  color: var(--muted);
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.empty-msg.small { padding: 0.75rem; text-align: left; }
</style>
