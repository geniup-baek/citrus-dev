<script setup>
import { ref, computed, nextTick, watch } from 'vue'
import { useTreatmentStore } from '../stores/treatmentStore.js'
import { useRecommendSettingsStore } from '../stores/recommendSettingsStore.js'
import { useFarmStore } from '../stores/farmStore.js'
import { findBestMatchInCache, normalizeBrandKey, searchGroupedFlat } from '../services/pesticide.js'
import { moaColor } from '../services/recommend.js'
import { usePesticideTypes } from '../composables/usePesticideTypes.js'
import { usePesticideInventoryStock } from '../composables/usePesticideInventoryStock.js'
import { useIsMobile } from '../composables/useIsMobile.js'
import { useLocaleStore } from '../stores/localeStore'
import { confirm } from '../composables/useConfirm'
import { useFarmsStore } from '../stores/farmsStore'
import { useAppPolicyStore } from '../stores/appPolicyStore'
import { confirmFilteredExport, downloadCsv, exportFileName, openPrintReport, today } from '../utils/dataExport.js'
import { categoryClass } from '../utils/pesticideBadgeClass.js'
import PesticideLinkResults from './PesticideLinkResults.vue'
import MobileFilterBar from './MobileFilterBar.vue'
import OverflowMenu from './OverflowMenu.vue'

const treatStore    = useTreatmentStore()
const settingsStore = useRecommendSettingsStore()
const farmStore     = useFarmStore()
const localeStore   = useLocaleStore()
const farmsStore    = useFarmsStore()
const policyStore   = useAppPolicyStore()
const { isMobile } = useIsMobile()
const { resolveType: normCat } = usePesticideTypes()
const { inventoryPesticides } = usePesticideInventoryStock()

// 초기화 버튼 — 시스템 관리 모드에서 기능을 "사용"으로 켜고, 이 농장에서 "표시"로 켠 경우에만 노출한다.
const showResetButton = computed(() =>
  policyStore.policy.enableResetFeature && settingsStore.settings.showResetButtons,
)

const showHistoryForm = ref(false)
const editingId     = ref(null)
const fDate     = ref(today())
const fBrand    = ref('')
const fMoa      = ref('')
const fCategory = ref('')
const fMemo     = ref('')
const fMatchSource = ref(null) // 'auto' | null — OpenAPI 자동 연결로 채워졌는지
const formError = ref('')
const saving    = ref(false)

const histFormTarget = computed(() =>
  editingId.value && treatStore.treatments.some(t => t.id === editingId.value)
    ? `#hist-form-slot-${editingId.value}`
    : '#hist-form-top'
)

// ── 방제이력 연도별 필터 ────────────────────────────────────────────────────
const histYear = ref('')
const histUnmatchedOnly = ref(false)

const histYears = computed(() =>
  [...new Set(treatStore.treatments.map(t => t.date?.slice(0, 4)).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a)),
)

const histYearCounts = computed(() => {
  const counts = {}
  for (const t of treatStore.treatments) {
    const y = t.date?.slice(0, 4)
    if (y) counts[y] = (counts[y] || 0) + 1
  }
  return counts
})

const histUnmatchedCount = computed(() => treatStore.treatments.filter(t => !t.moa).length)

const histIsFiltered = computed(() => !!histYear.value || histUnmatchedOnly.value)

// 모바일 필터시트(MobileFilterBar)에 표시할 "적용된 필터" 요약 — 기존 ref 를 그대로 읽고 쓴다.
const histActiveFilters = computed(() => [
  histYear.value && {
    key: 'year', label: `${histYear.value}년 (${histYearCounts.value[histYear.value] ?? 0})`, clear: () => { histYear.value = '' },
  },
  histUnmatchedOnly.value && {
    key: 'unmatched', label: `미연결만 (${histUnmatchedCount.value})`, clear: () => { histUnmatchedOnly.value = false },
  },
].filter(Boolean))

function histClearAllFilters() {
  histYear.value = ''
  histUnmatchedOnly.value = false
}

const filteredTreatments = computed(() => {
  let list = treatStore.treatments
  if (histYear.value) list = list.filter(t => t.date?.startsWith(histYear.value))
  if (histUnmatchedOnly.value) list = list.filter(t => !t.moa)
  return list
})

// 필터 변경으로 편집 중인 이력이 목록에서 사라지면 보이지 않는 항목을 계속 편집하는
// 상태로 남기지 않고 새 기록 입력 폼으로 되돌린다.
watch(filteredTreatments, (list) => {
  if (editingId.value && !list.some(t => t.id === editingId.value)) {
    resetForm()
  }
})

const formMode = ref('single') // 'single' | 'bulk'

function resetForm() {
  editingId.value = null
  formMode.value  = 'single'
  fDate.value     = today()
  fBrand.value    = ''
  fMoa.value      = ''
  fCategory.value = ''
  fMemo.value     = ''
  fMatchSource.value = null
  formError.value = ''
  histLinkId.value      = null
  histLinkQuery.value   = ''
  histLinkResults.value = []
  bulkPasteText.value    = ''
  bulkImportMessage.value = ''
}

function startEdit(t) {
  showHistoryForm.value = true
  editingId.value       = t.id
  formMode.value        = 'single'
  fDate.value           = t.date
  fBrand.value          = t.brandName
  fMoa.value            = t.moa       ?? ''
  fCategory.value       = t.category  ?? ''
  fMemo.value           = t.memo       ?? ''
  fMatchSource.value    = t.matchSource ?? null
  formError.value       = ''
  histLinkId.value      = null
  if (isMobile.value) {
    nextTick(() => {
      const el = document.getElementById(`hist-form-slot-${t.id}`)
      ;(el?.closest('li') ?? el)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
}

async function submitTreatment() {
  formError.value = ''
  if (!fDate.value)  { formError.value = '날짜를 입력하세요.'; return }
  if (!fBrand.value) { formError.value = '농약을 선택하세요.'; return }
  saving.value = true
  const record = {
    date:        fDate.value,
    brandName:   fBrand.value,
    moa:         fMoa.value,
    category:    fCategory.value,
    memo:        fMemo.value.trim(),
    matchSource: fMatchSource.value,
  }
  try {
    if (editingId.value) {
      await treatStore.updateTreatment(editingId.value, record)
    } else {
      await treatStore.addTreatment(record)
    }
    resetForm()
  } catch (e) {
    formError.value = e.message
  } finally {
    saving.value = false
  }
}

async function confirmDeleteTreatment(t) {
  const ok = await confirm({ message: localeStore.t('confirm.treatment', { date: formatDate(t.date), brandName: t.brandName }) })
  if (!ok) return
  if (editingId.value === t.id) resetForm()
  await treatStore.deleteTreatment(t.id)
}

// ── 방제이력 농약정보 연결 (공공데이터 + 농약재고 통합 검색) ───────────────────────
// 공공데이터에 없는 농약(예: 등록 안 된 자재)은 농약재고에 이미 연결해둔 정보로 대신 채울 수 있다.
function findInventoryMatch(brandName) {
  const q = brandName.trim().toLowerCase()
  if (!q) return null
  const list = inventoryPesticides.value
  const exact = list.find(i => i.name.trim().toLowerCase() === q)
  if (exact) return exact
  return list.find(i => {
    const n = i.name.trim().toLowerCase()
    return n.length >= 2 && q.length >= 2 && (n.startsWith(q) || q.startsWith(n))
  }) ?? null
}

function searchTreatmentLinkCandidates(query, pageSize = 10) {
  const q = query.trim()
  if (!q) return []
  const apiList = searchGroupedFlat(q, pageSize).map(r => ({ ...r, matchSourceType: 'api' }))
  const apiBrandKeys = new Set(apiList.map(r => normalizeBrandKey(r.brandName)))
  const ql = q.toLowerCase()
  const invList = inventoryPesticides.value
    .filter(i => i.name.toLowerCase().includes(ql) && !apiBrandKeys.has(normalizeBrandKey(i.name)))
    .map(i => ({
      brandName:      i.name,
      pesticideType:  i.pesticideType || '',
      modeOfAction:   i.actionGroup || '',
      targetPest:     '',
      pestiCode:      `inv-${i.id}`,
      diseaseUseSeq:  '0',
      matchSourceType: 'inventory',
    }))
  return [...apiList, ...invList]
}

// ── 방제이력 농약정보 연결 (폼) ────────────────────────────────────────────────
const formLinkResults = ref([])

function onFormBrandInput(val) {
  fMatchSource.value = null // 직접 입력 중이므로 자동 연결 표시 해제
  formLinkResults.value = searchTreatmentLinkCandidates(val)
}

function applyFormLink(apiItem) {
  fBrand.value = apiItem.brandName
  if (apiItem.pesticideType)                                 fCategory.value = normCat(apiItem.pesticideType)
  if (apiItem.modeOfAction && apiItem.modeOfAction !== '-')  fMoa.value      = apiItem.modeOfAction
  fMatchSource.value = apiItem.matchSourceType === 'inventory' ? 'inventory' : 'auto'
  formLinkResults.value = []
}

// ── 방제이력 농약정보 연결 (목록 항목) ─────────────────────────────────────────
const histLinkId      = ref(null)
const histLinkQuery   = ref('')
const histLinkResults = ref([])

function openHistLink(id) {
  if (histLinkId.value === id) {
    histLinkId.value      = null
    histLinkQuery.value   = ''
    histLinkResults.value = []
    return
  }
  histLinkId.value      = id
  histLinkQuery.value   = ''
  histLinkResults.value = []
}

function searchHistLinkCandidates(query) {
  histLinkResults.value = searchTreatmentLinkCandidates(query, 12)
}

async function applyHistLink(treatment, apiItem) {
  const moa      = (apiItem.modeOfAction && apiItem.modeOfAction !== '-') ? apiItem.modeOfAction : (treatment.moa || '')
  const category = normCat(apiItem.pesticideType) || treatment.category || ''
  await treatStore.updateTreatment(treatment.id, {
    date:        treatment.date,
    brandName:   apiItem.brandName || treatment.brandName,
    moa,
    category,
    memo:        treatment.memo || '',
    matchSource: apiItem.matchSourceType === 'inventory' ? 'inventory' : 'auto',
  })
  histLinkId.value      = null
  histLinkQuery.value   = ''
  histLinkResults.value = []
}

const histRefreshMessage = ref('')

// 아직 농약정보가 연결되지 않은(작용기작이 비어있는) 이력만 브랜드명 기준으로 일괄 연결한다.
// 설정에서 켜면 이미 연결된 이력도 다시 연결(덮어쓰기)한다.
async function refreshAllTreatmentLinks() {
  const overwrite = settingsStore.settings.overwriteLinkedTreatments
  let updated = 0
  for (const t of treatStore.treatments) {
    if (t.moa && !overwrite) continue
    const match = findBestMatchInCache(t.brandName)
    let moa = '', category = '', matchSource = 'auto'
    if (match) {
      moa = (match.modeOfAction && match.modeOfAction !== '-') ? match.modeOfAction : ''
      category = normCat(match.pesticideType) || ''
    } else {
      // 공공데이터에 없으면 농약재고에 연결해둔 정보로 대신 채운다.
      const inv = findInventoryMatch(t.brandName)
      if (inv?.actionGroup) {
        moa = inv.actionGroup
        category = normCat(inv.pesticideType) || ''
        matchSource = 'inventory'
      }
    }
    if (!moa && !category) continue
    await treatStore.updateTreatment(t.id, {
      date:        t.date,
      brandName:   t.brandName,
      moa,
      category,
      memo:        t.memo || '',
      matchSource,
    })
    updated++
  }
  histRefreshMessage.value = updated > 0 ? `${updated}건 정보를 연결했습니다.` : '연결할 항목이 없습니다 (이미 연결된 이력 제외).'
}

function histMatchLabel(t) {
  if (t.matchSource === 'auto')      return '자동'
  if (t.matchSource === 'inventory') return '재고'
  return t.moa ? '직접입력' : '미연결'
}

// 현재 필터(연도·미연결)가 적용된 목록 그대로 CSV로 내려받는다.
async function downloadTreatmentsCsv() {
  const ok = await confirmFilteredExport({
    filtered: histIsFiltered.value,
    shown: filteredTreatments.value.length,
    total: treatStore.treatments.length,
  })
  if (!ok) return

  const rows = [['날짜', '농약명', '분류', '작용기작', '연결', '메모']]
  for (const t of filteredTreatments.value) {
    rows.push([
      t.date,
      t.brandName,
      normCat(t.category) || '',
      t.moa || '',
      histMatchLabel(t),
      t.memo || '',
    ])
  }
  downloadCsv(rows, exportFileName({
    farmName: farmsStore.activeFarm?.name,
    label: '방제이력',
    date: today(),
  }))
}

async function printTreatments() {
  const shown = filteredTreatments.value.length
  const total = treatStore.treatments.length
  const ok = await confirmFilteredExport({ filtered: histIsFiltered.value, shown, total, kind: 'pdf' })
  if (!ok) return

  openPrintReport({
    farmName: farmsStore.activeFarm?.name,
    title: '방제 이력 보고서',
    meta: `${localeStore.t('inventory.reportGeneratedAt', { date: today() })} · 총 ${shown}건${shown < total ? ` (전체 ${total}건 중 필터 적용)` : ''}`,
    headers: ['날짜', '농약명', '분류', '작용기작', '연결', '메모'],
    rows: filteredTreatments.value.map(t => [
      t.date, t.brandName, normCat(t.category) || '', t.moa || '', histMatchLabel(t), t.memo || '',
    ]),
    autoPrint: policyStore.policy.autoOpenPrintDialog,
  })
}

// 방제이력 전체 삭제 — 관리모드 동작 설정에서 "초기화 버튼: 표시"일 때만 노출된다.
async function resetAllTreatments() {
  const n = treatStore.treatments.length
  if (!n) return
  const ok = await confirm({
    title: localeStore.t('confirm.resetTitle'),
    message: localeStore.t('confirm.resetTreatments', { n }),
    confirmLabel: localeStore.t('common.reset'),
  })
  if (!ok) return
  resetForm()
  try {
    await treatStore.replaceAllTreatments([])
    histRefreshMessage.value = `방제이력 ${n}건을 모두 삭제했습니다.`
  } catch (e) {
    console.warn('[TreatmentHistoryPanel] 방제이력 전체 삭제 실패', e)
    histRefreshMessage.value = '삭제에 실패했습니다. 새로고침 후 다시 시도해 주세요.'
  }
}

// ── 방제이력 붙여넣기 일괄추가 ─────────────────────────────────────────────────
// 스프레드시트에서 복사한 "날짜(YYYYMMDD)\t농약명\t비고" 형식 탭 구분 텍스트를 파싱한다.
const bulkPasteText = ref('')
const bulkImporting = ref(false)
const bulkImportMessage = ref('')

function parseBulkDate(raw) {
  const s = raw.trim()
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  const dashed = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return dashed ? s : null
}

function parseBulkTreatmentText(text) {
  const rows = []
  for (const line of text.split('\n')) {
    const cols = line.replace(/\r$/, '').split('\t')
    const date = parseBulkDate(cols[0] || '')
    const nameRaw = (cols[1] || '').trim()
    const memo = (cols[2] || '').trim()
    if (!date || !nameRaw) continue
    rows.push({ date, nameRaw, memo })
  }
  return rows
}

const bulkParsedRows = computed(() => parseBulkTreatmentText(bulkPasteText.value))

// 농약명 뒤에 붙은 설명을 분리한다.
// 1) 괄호 표기: "크레모아(보, 어3)" → 크레모아 / 보, 어3
// 2) 캐시에 등록된 상표명이 접두어로 일치: "수퍼펀치 인축3급보통, 어독성1급" → 수퍼펀치 / 인축3급보통, 어독성1급
// 어느 쪽도 아니면 전체를 그대로 상표명으로 둔다.
function splitBulkTreatmentName(raw) {
  const parenMatch = raw.match(/^(.+?)\s*\(([^)]*)\)\s*$/)
  if (parenMatch) {
    return { brand: parenMatch[1].trim(), extra: parenMatch[2].trim() }
  }
  const match = findBestMatchInCache(raw)
  if (match?.brandName && raw.startsWith(match.brandName) && raw.length > match.brandName.length) {
    const extra = raw.slice(match.brandName.length).trim().replace(/^,\s*/, '')
    return { brand: match.brandName, extra }
  }
  return { brand: raw, extra: '' }
}

function buildBulkTreatmentRecord(row) {
  const { brand } = splitBulkTreatmentName(row.nameRaw)
  const match = findBestMatchInCache(brand)
  const moa = (match?.modeOfAction && match.modeOfAction !== '-') ? match.modeOfAction : ''
  const category = match ? (normCat(match.pesticideType) || '') : ''
  return {
    date:        row.date,
    brandName:   match?.brandName || brand,
    moa,
    category,
    memo:        row.memo.trim(),
    matchSource: match ? 'auto' : null,
  }
}

async function importBulkTreatments() {
  const rows = bulkParsedRows.value
  if (!rows.length) return
  bulkImporting.value = true
  bulkImportMessage.value = ''
  try {
    const records = rows.map(buildBulkTreatmentRecord)
    const matched = records.filter((r) => r.matchSource === 'auto').length
    if (settingsStore.settings.bulkImportMode === 'replace') {
      await treatStore.replaceAllTreatments(records)
      bulkImportMessage.value = `전체 새로 작성됨: ${rows.length}건 (자동 연결 ${matched}건)`
    } else {
      for (const record of records) {
        await treatStore.addTreatment(record, { silent: true })
      }
      if (records.length > 0) farmStore.logChange('방제이력', `일괄 추가 (${records.length}건)`, 'add')
      bulkImportMessage.value = `${rows.length}건 추가됨 (자동 연결 ${matched}건)`
    }
    bulkPasteText.value = ''
  } catch (e) {
    console.warn('[TreatmentHistoryPanel] 방제이력 붙여넣기 실패', e)
    bulkImportMessage.value = '저장에 실패했습니다. 새로고침 후 다시 시도해 주세요.'
  } finally {
    bulkImporting.value = false
  }
}

function formatDate(d) {
  if (!d) return ''
  const [y, m, day] = d.split('-')
  return `${y}.${m}.${day}`
}
</script>

<template>
  <div :class="['page-grid', showHistoryForm ? 'two-columns' : '']">

    <!-- 목록 -->
    <article>
      <div class="pip-header">
        <div class="pip-actions">
          <OverflowMenu v-if="showHistoryForm && treatStore.treatments.length > 0" title="더보기">
            <button
              v-if="showResetButton"
              class="danger"
              type="button"
              @click="resetAllTreatments"
            >{{ localeStore.t('common.reset') }}</button>
            <button class="ghost" type="button" @click="refreshAllTreatmentLinks">
              전체 재연결 ({{ settingsStore.settings.overwriteLinkedTreatments ? '기존 연결도 덮어쓰기' : '미연결만' }})
            </button>
          </OverflowMenu>
          <OverflowMenu v-else-if="treatStore.treatments.length > 0" title="더보기">
            <button class="ghost" type="button" @click="printTreatments">{{ localeStore.t('inventory.printReport') }}</button>
            <button class="ghost" type="button" @click="downloadTreatmentsCsv">{{ localeStore.t('inventory.downloadReport') }}</button>
          </OverflowMenu>
          <button v-if="!showHistoryForm" type="button" @click="showHistoryForm = true">{{ localeStore.t('common.edit') }}</button>
          <button v-else class="ghost" type="button" @click="resetForm(); showHistoryForm = false; histRefreshMessage = ''">{{ localeStore.t('common.exitEdit') }}</button>
        </div>
      </div>
      <p v-if="histRefreshMessage" class="muted text-sm" style="margin: -0.4rem 0 0.6rem;">{{ histRefreshMessage }}</p>
      <MobileFilterBar v-if="histYears.length" :active="histActiveFilters" :on-reset-all="histClearAllFilters" title="필터">
        <template #always>
          <span class="summary-chip">{{ histIsFiltered ? localeStore.t('common.filteredCount', { shown: filteredTreatments.length, total: treatStore.treatments.length }) : localeStore.t('common.totalCount', { n: filteredTreatments.length }) }}</span>
        </template>
        <span class="filter-sep">|</span>
        <!-- 연도 버튼은 개수가 무제한이라 좁은 화면에서 그 자체로 화면을 넘길 수 있다 —
             모바일 시트 안에서는 select 로, 데스크톱에서는 기존 seg-filter 그대로. -->
        <div v-if="!isMobile" class="seg-filter">
          <button
            class="seg-btn"
            :class="{ active: histYear === '' }"
            type="button"
            @click="histYear = ''"
          >전체 ({{ treatStore.treatments.length }})</button>
          <button
            v-for="y in histYears"
            :key="y"
            class="seg-btn"
            :class="{ active: histYear === y }"
            type="button"
            @click="histYear = y"
          >{{ y }}년 ({{ histYearCounts[y] ?? 0 }})</button>
        </div>
        <select v-else v-model="histYear" class="compact-select">
          <option value="">전체 ({{ treatStore.treatments.length }})</option>
          <option v-for="y in histYears" :key="y" :value="y">{{ y }}년 ({{ histYearCounts[y] ?? 0 }})</option>
        </select>
        <button
          class="ghost ap-unmatched-btn"
          :class="{ 'ap-unmatched-active': histUnmatchedOnly }"
          type="button"
          @click="histUnmatchedOnly = !histUnmatchedOnly"
        >미연결만 ({{ histUnmatchedCount }})</button>
      </MobileFilterBar>
      <div id="hist-form-top" class="mobile-form-slot"></div>
      <div v-if="treatStore.treatments.length === 0" class="empty-msg">
        {{ showHistoryForm ? '저장하면 목록에 표시됩니다.' : '기록된 방제 이력이 없습니다.' }}
      </div>
      <div v-else-if="filteredTreatments.length === 0" class="empty-msg">
        {{ histUnmatchedOnly ? '미연결 이력이 없습니다.' : `${histYear}년 방제 이력이 없습니다.` }}
      </div>
      <ul v-else class="list clean">
        <template v-for="(t, i) in filteredTreatments" :key="t.id">
          <li v-if="i === 0 || t.date !== filteredTreatments[i - 1].date" class="hist-date-divider">
            <span>{{ formatDate(t.date) }}</span>
          </li>
          <li class="list-item card-like">
            <div>
              <div class="task-card-top">
                <p class="item-title">{{ t.brandName }}</p>
                <span v-if="t.category" class="cat-badge" :class="categoryClass(t.category)">{{ t.category }}</span>
                <span v-if="t.moa" class="moa-badge" :style="{ background: moaColor(t.moa) }">{{ t.moa }}</span>
                <span v-if="t.matchSource === 'auto'" class="match-badge match-ok">자동</span>
                <span v-if="t.matchSource === 'inventory'" class="match-badge match-ok">재고</span>
              </div>
              <p v-if="t.memo" class="item-meta muted">{{ t.memo }}</p>
            </div>
            <div class="row-actions">
              <template v-if="showHistoryForm">
                <button
                  class="ghost"
                  :class="{ 'link-btn-active': histLinkId === t.id }"
                  type="button"
                  @click="openHistLink(t.id)"
                >{{ t.moa ? '정보 재연결' : '농약정보 연결' }}</button>
                <button :class="{ ghost: editingId !== t.id }" type="button" @click="editingId === t.id ? resetForm() : startEdit(t)">편집</button>
                <button class="danger" type="button" @click="confirmDeleteTreatment(t)">삭제</button>
              </template>
            </div>
            <!-- 농약정보 연결 패널 -->
            <div v-if="histLinkId === t.id" class="link-panel">
              <input
                v-model="histLinkQuery"
                type="text"
                class="link-search-input"
                placeholder="농약명 검색 (공공데이터 + 농약재고)"
                @input="searchHistLinkCandidates(histLinkQuery)"
              />
              <div v-if="histLinkResults.length" class="link-results">
                <PesticideLinkResults :results="histLinkResults" @apply="(r) => applyHistLink(t, r)">
                  <template #badges="{ item: r }">
                    <span v-if="r.pesticideType" class="cat-badge" :class="categoryClass(normCat(r.pesticideType))">{{ normCat(r.pesticideType) }}</span>
                    <span v-if="r.modeOfAction && r.modeOfAction !== '-'" class="moa-badge" :style="{ background: moaColor(r.modeOfAction) }">{{ r.modeOfAction }}</span>
                    <span v-if="r.matchSourceType === 'inventory'" class="match-badge match-ok">재고</span>
                  </template>
                </PesticideLinkResults>
              </div>
              <p v-else-if="histLinkQuery.trim().length > 1" class="muted text-sm" style="padding:0.4rem 0.65rem;">
                검색 결과 없음 — 공공데이터에도 농약재고에도 없습니다. 먼저 정보를 가져오거나 재고에 등록해주세요.
              </p>
            </div>
            <div :id="`hist-form-slot-${t.id}`" class="mobile-form-slot"></div>
          </li>
        </template>
      </ul>
    </article>

    <!-- 폼 -->
    <Teleport v-if="showHistoryForm" :to="histFormTarget" :disabled="!isMobile">
    <article v-if="showHistoryForm" class="card">
      <div v-if="!editingId" class="inline-filters" style="margin-bottom: 1rem;">
        <button :class="{ ghost: formMode !== 'single' }" type="button" @click="formMode = 'single'">새 기록</button>
        <button :class="{ ghost: formMode !== 'bulk' }" type="button" @click="formMode = 'bulk'">붙여넣기 일괄추가</button>
      </div>

      <template v-if="formMode === 'bulk' && !editingId">
        <h2>붙여넣기로 일괄 추가</h2>
        <p class="ap-hint">
          <code>날짜(YYYYMMDD)</code>, <code>농약명</code>, <code>비고</code> 열을 탭으로 구분해 붙여넣으세요 (스프레드시트에서 복사).<br>
          농약명 뒤에 붙은 설명(괄호 또는 등록된 상표명 뒤 텍스트)은 버려지고 비고 열 내용만 사용됩니다.<br>
          현재 설정: <strong>{{ settingsStore.settings.bulkImportMode === 'replace' ? '전체 새로 작성' : '기존 목록에 추가' }}</strong>
          <span v-if="settingsStore.settings.bulkImportMode === 'replace'" class="muted">(붙여넣는 내용으로 방제이력 전체를 대체합니다 — 설정페이지에서 변경 가능)</span>
          <span v-else class="muted">(설정페이지에서 변경 가능)</span>
        </p>
        <textarea
          v-model="bulkPasteText"
          class="ap-textarea"
          rows="8"
          placeholder="20240414	크레모아	손방제"
        ></textarea>
        <div class="ap-input-footer">
          <span v-if="bulkParsedRows.length > 0" class="ap-parse-count">{{ bulkParsedRows.length }}개 항목 인식됨</span>
          <span v-else class="ap-parse-count muted">입력 없음</span>
        </div>
        <div class="row-actions">
          <button type="button" :disabled="bulkImporting || !bulkParsedRows.length" @click="importBulkTreatments">
            {{ bulkImporting ? '처리 중...' : (settingsStore.settings.bulkImportMode === 'replace' ? '전체 새로 작성' : '일괄 추가') }}
          </button>
        </div>
        <p v-if="bulkImportMessage" class="muted text-sm" style="margin-top:0.5rem;">{{ bulkImportMessage }}</p>
      </template>

      <template v-else>
      <h2>{{ editingId ? '이력 편집' : '새 기록' }}</h2>
      <form class="stack-form" @submit.prevent="submitTreatment">
        <label>날짜
          <input type="date" v-model="fDate" required />
        </label>
        <label>농약
          <input
            v-model="fBrand"
            placeholder="상표명 입력 (공공데이터 + 농약재고 검색)"
            autocomplete="off"
            @input="onFormBrandInput($event.target.value)"
          />
        </label>
        <div v-if="formLinkResults.length" class="inv-api-panel">
          <PesticideLinkResults :results="formLinkResults" @apply="applyFormLink">
            <template #badges="{ item: r }">
              <span v-if="r.pesticideType" class="cat-badge" :class="categoryClass(normCat(r.pesticideType))">{{ normCat(r.pesticideType) }}</span>
              <span v-if="r.modeOfAction && r.modeOfAction !== '-'" class="moa-badge" :style="{ background: moaColor(r.modeOfAction) }">{{ r.modeOfAction }}</span>
              <span v-if="r.matchSourceType === 'inventory'" class="match-badge match-ok">재고</span>
            </template>
          </PesticideLinkResults>
        </div>
        <div v-if="fMoa" class="hist-form-info">
          <span class="moa-badge" :style="{ background: moaColor(fMoa) }">{{ fMoa }}</span>
          <span class="cat-badge" :class="categoryClass(fCategory)">{{ fCategory }}</span>
        </div>
        <label>메모
          <input v-model="fMemo" placeholder="희석배수, 날씨, 구역 등 (선택)" />
        </label>
        <p v-if="formError" class="form-error">{{ formError }}</p>
        <div class="row-actions">
          <button type="submit" :disabled="saving">
            {{ saving ? '저장 중...' : (editingId ? '저장' : '기록 추가') }}
          </button>
          <button v-if="editingId" class="ghost" type="button" @click="resetForm">{{ localeStore.t('common.cancel') }}</button>
        </div>
      </form>
      </template>
    </article>
    </Teleport>

  </div>
</template>

<style scoped>
.hist-form-info { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; padding: 0.15rem 0; }
.form-error { font-size: 0.82rem; color: var(--danger, #dc2626); }

.link-btn-active { background: var(--primary) !important; color: var(--primary-ink) !important; border-color: var(--primary) !important; }

.hist-date-divider {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.9rem 0 0.35rem;
  padding: 0;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--muted);
}
.hist-date-divider:first-child { margin-top: 0; }
.hist-date-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--line);
}
.link-panel {
  margin-top: 0.5rem;
  border: 1px solid var(--primary);
  border-radius: var(--radius-control);
  overflow: hidden;
}
.link-search-input {
  width: 100%;
  border: none;
  border-bottom: 1px solid var(--line);
  padding: 0.5rem 0.75rem;
  font-size: 0.88rem;
  background: color-mix(in srgb, var(--primary) 4%, var(--surface));
  outline: none;
  box-sizing: border-box;
}
.link-search-input:focus { background: var(--surface); }
.link-results { max-height: 200px; overflow-y: auto; }

/* OpenAPI 검색 패널 (폼 농약 입력란) — 결과 목록 자체는 PesticideLinkResults.vue가 그린다 */
.inv-api-panel {
  display: flex; flex-direction: column; gap: 0.2rem;
  max-height: 220px; overflow-y: auto;
  border: 1px solid var(--primary); border-radius: var(--radius-control);
  background: var(--bg);
  margin-top: -0.25rem; margin-bottom: 0.25rem;
}
</style>
