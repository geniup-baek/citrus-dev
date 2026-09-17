<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { useFarmStore } from '../stores/farmStore'
import { useLocaleStore } from '../stores/localeStore'
import { useRecommendSettingsStore } from '../stores/recommendSettingsStore'
import { confirm } from '../composables/useConfirm'
import { searchGroupedFromFullCache, findBestMatchInCache } from '../services/pesticide.js'
import { moaColor } from '../services/recommend.js'
import { usePesticideTypes } from '../composables/usePesticideTypes.js'
import { useIsMobile } from '../composables/useIsMobile.js'
import { useFarmsStore } from '../stores/farmsStore'
import { useAppPolicyStore } from '../stores/appPolicyStore'
import { useFarmMembersStore } from '../stores/farmMembersStore'
import { confirmFilteredExport, downloadCsv, exportFileName, openPrintReport } from '../utils/dataExport.js'
import { uuid } from '../utils/uuid.js'
import PesticideLinkResults from './PesticideLinkResults.vue'
import MobileFilterBar from './MobileFilterBar.vue'
import OverflowMenu from './OverflowMenu.vue'

const store      = useFarmStore()
const localeStr  = useLocaleStore()
const recSettingsStore = useRecommendSettingsStore()
const farmsStore = useFarmsStore()
const policyStore = useAppPolicyStore()
const farmMembersStore = useFarmMembersStore()
const t          = (key, p) => localeStr.t(key, p)

const CATEGORY = '농약'

// 초기화 버튼 — 시스템 관리 모드에서 기능을 "사용"으로 켜고, 이 농장에서 "표시"로 켠 경우에만 노출한다.
const showResetButton = computed(() =>
  policyStore.policy.enableResetFeature && recSettingsStore.settings.showResetButtons,
)

const { typeNames: pesticideTypes, resolveType } = usePesticideTypes()
const { isMobile } = useIsMobile()

const formTarget = computed(() =>
  editingId.value && displayedItems.value.some(i => i.id === editingId.value)
    ? `#pip-form-slot-${editingId.value}`
    : '#pip-form-top'
)

function scrollToItem(slotId) {
  if (!isMobile.value) return
  nextTick(() => {
    const el = document.getElementById(slotId)
    ;(el?.closest('li') ?? el)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

const showForm     = ref(false)
const formMode     = ref('single') // 'single' | 'bulk'
const editingId    = ref('')
const expandedId   = ref('')
const showAddTxn   = ref(false)
const sortBy       = ref('name')
const sortDir      = ref('asc')
const unmatchedOnly = ref(false)
const outOfStockOnly = ref(false)
const EXPIRY_SOON  = 30

const form = reactive({
  id: '', name: '', pesticideType: '살충제',
  actionGroup: '', productName: '', notes: '',
  matchSource: '', // 'auto' — 공공데이터에서 골라 채운 경우
})

const txnForm = reactive({
  type: '입고', volume: '', expiryDate: '', amount: '', note: '', date: '',
})

const editingTxnId = ref('')
const editTxnForm  = reactive({
  type: '입고', volume: '', expiryDate: '', amount: '', note: '', date: '',
})

// 입출고 일자는 <input type="date">(YYYY-MM-DD)로 다루고 저장은 ISO로 한다.
// 정오로 만들어 두면 표준시가 달라도 같은 날짜로 되돌아온다.
function todayInput() {
  return format(new Date(), 'yyyy-MM-dd')
}

function toDateInput(iso) {
  try { return format(new Date(iso), 'yyyy-MM-dd') } catch { return '' }
}

function toIsoDate(value) {
  const [y, m, d] = String(value || '').split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(y, m - 1, d, 12).toISOString()
}

// ── 농약 종류 뱃지 ────────────────────────────────────────────────────────────
const categoryClass = (cat) => ({
  '살균제': 'cat-fungicide',
  '살비제': 'cat-miticide',
  '살충제': 'cat-insecticide',
}[cat] ?? '')

// ── OpenAPI 상표명 검색 ───────────────────────────────────────────────────────

const invMatchResults = ref([])

// 목록(SVC01)은 같은 상표명이 대상 병해충 수만큼 레코드로 나뉘어 있으므로,
// 상표명 기준으로 묶어서 한 줄만 보여준다(병해충은 요약해서 함께 표시).
function pestSummary(group) {
  const shown = group.targetPests.slice(0, 3).join(', ')
  const rest = group.targetPests.length - 3
  return rest > 0 ? `${shown} 외 ${rest}종` : shown
}

function onNameInput() {
  form.matchSource = '' // 이름을 직접 고치는 중이므로 자동 연결 표시를 해제한다
  const q = form.name.trim()
  if (!q) { invMatchResults.value = []; return }
  const result = searchGroupedFromFullCache({ pestName: q, page: 1, pageSize: 10 })
  invMatchResults.value = result?.list ?? []
}

function applyInvMatch(apiItem) {
  form.name = apiItem.brandName
  if (apiItem.pesticideType) {
    const mapped = resolveType(apiItem.pesticideType)
    if (pesticideTypes.value.includes(mapped)) form.pesticideType = mapped
  }
  if (apiItem.modeOfActions?.[0]) form.actionGroup = apiItem.modeOfActions[0]
  if (apiItem.name)                form.productName = apiItem.name
  form.matchSource = 'auto'
  invMatchResults.value = []
}

// ── 목록 항목 농약정보 연결 ───────────────────────────────────────────────────
const linkingItemId = ref(null)
const linkQuery     = ref('')
const linkResults   = ref([])

function openLink(itemId) {
  if (linkingItemId.value === itemId) {
    linkingItemId.value = null
    linkQuery.value     = ''
    linkResults.value   = []
    return
  }
  expandedId.value    = ''   // 입출고 패널과 상호 배타
  linkingItemId.value = itemId
  linkQuery.value     = ''
  linkResults.value   = []
}

function searchLinkCandidates(query) {
  if (!query.trim()) { linkResults.value = []; return }
  const result = searchGroupedFromFullCache({ pestName: query.trim(), page: 1, pageSize: 12 })
  linkResults.value = result?.list ?? []
}

async function applyLink(item, apiItem) {
  const mappedType = resolveType(apiItem.pesticideType)
  await store.upsertInventoryItem({
    id:            item.id,
    name:          apiItem.brandName || item.name,
    category:      CATEGORY,
    pesticideType: pesticideTypes.value.includes(mappedType) ? mappedType : (item.pesticideType || ''),
    actionGroup:   apiItem.modeOfActions?.[0] || (item.actionGroup || ''),
    productName:   apiItem.name || item.productName || '',
    matchSource:   'auto',
    notes:         item.notes || '',
  })
  linkingItemId.value = null
  linkQuery.value     = ''
  linkResults.value   = []
}

// ── 로트 계산 ─────────────────────────────────────────────────────────────────
function lotsOf(item) {
  const map = new Map()
  for (const tx of item.txns || []) {
    const key = `${tx.volume} ${tx.expiryDate}`
    if (!map.has(key)) map.set(key, { volume: tx.volume, expiryDate: tx.expiryDate, quantity: 0 })
    map.get(key).quantity += tx.type === '사용' ? -Number(tx.amount || 0) : Number(tx.amount || 0)
  }
  return [...map.values()]
    .filter(l => l.quantity !== 0)
    .sort((a, b) =>
      (a.expiryDate || '9999-12-31').localeCompare(b.expiryDate || '9999-12-31') ||
      a.volume.localeCompare(b.volume),
    )
}

function volumeOptions(item) {
  return [...new Set((item.txns || []).map(tx => tx.volume).filter(Boolean))]
}

// 재고가 하나도 없으면 '사용'으로 뺄 것이 없어 입력 자체가 의미 없다.
function cannotRecordUse(item) {
  return txnForm.type === '사용' && stockVolumeOptions(item).length === 0
}

// '사용'은 없는 재고에서 뺄 수 없으므로, 현재 남아 있는 로트에서만 고르게 한다.
function stockVolumeOptions(item) {
  return [...new Set(lotsOf(item).map(l => l.volume))]
}

function stockExpiryOptions(item, volume) {
  return lotsOf(item).filter(l => l.volume === volume)
}

// 입력한 날짜가 뒤죽박죽이어도 이력은 최신순으로 보이게 한다.
function sortedTxns(item) {
  return [...(item.txns || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
}

function expiryStatus(dateStr) {
  if (!dateStr) return ''
  const d = parseISO(dateStr)
  if (Number.isNaN(d.getTime())) return ''
  const diff = differenceInCalendarDays(d, new Date())
  if (diff < 0) return 'expired'
  if (diff <= EXPIRY_SOON) return 'soon'
  return ''
}

function earliestExpiry(item) {
  const dates = lotsOf(item).map(l => l.expiryDate).filter(Boolean)
  return dates.length ? dates.sort()[0] : '9999-12-31'
}

function expiringLotCount(item) {
  return lotsOf(item).filter(l => expiryStatus(l.expiryDate) !== '').length
}

function lotText(lot) {
  return t('inventory.lotLabel', {
    volume: lot.volume,
    expiry: lot.expiryDate || t('inventory.noExpiry'),
    quantity: lot.quantity,
  })
}

// 입출고 일자는 사용자가 직접 지정할 수 있으므로 시각은 의미가 없어 날짜만 보여준다.
function formatTxnDate(dateStr) {
  try { return format(new Date(dateStr), 'yyyy-MM-dd') } catch { return dateStr }
}

// ── 목록 ─────────────────────────────────────────────────────────────────────
const displayedItems = computed(() => {
  const list = store.state.inventory
    .filter(i => i.category === CATEGORY)
    .filter(i => !unmatchedOnly.value || !i.actionGroup)
    .filter(i => !outOfStockOnly.value || lotsOf(i).length === 0)
    .sort((a, b) => {
      const va = sortBy.value === 'expiry' ? earliestExpiry(a) : a.name
      const vb = sortBy.value === 'expiry' ? earliestExpiry(b) : b.name
      return sortDir.value === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
    })
  return list
})

const summary = computed(() => {
  const items = store.state.inventory.filter(i => i.category === CATEGORY)
  return {
    total:         displayedItems.value.length,
    categoryTotal: items.length,
    expiring:      displayedItems.value.reduce((s, i) => s + expiringLotCount(i), 0),
    unmatched:     items.filter(i => !i.actionGroup).length,
    outOfStock:    items.filter(i => lotsOf(i).length === 0).length,
  }
})

const isFiltered = computed(() => unmatchedOnly.value || outOfStockOnly.value)

// 모바일 필터시트(MobileFilterBar)에 표시할 "적용된 필터" 요약 — 기존 ref 를
// 그대로 읽고 쓴다. 시트/데스크톱 인라인 어느 쪽에서도 같은 상태를 가리킨다.
const activeFilters = computed(() => [
  unmatchedOnly.value && {
    key: 'unmatched',
    label: `미연결만 (${summary.value.unmatched})`,
    clear: () => { unmatchedOnly.value = false },
  },
  outOfStockOnly.value && {
    key: 'oos',
    label: `재고없음 (${summary.value.outOfStock})`,
    clear: () => { outOfStockOnly.value = false },
  },
].filter(Boolean))

function clearAllFilters() {
  unmatchedOnly.value = false
  outOfStockOnly.value = false
}

// ── 폼 ───────────────────────────────────────────────────────────────────────
function clearForm() {
  Object.assign(form, {
    id: '', name: '',
    pesticideType: pesticideTypes.value[0] ?? '살충제',
    actionGroup: '', productName: '', notes: '', matchSource: '',
  })
  editingId.value      = ''
  formMode.value       = 'single'
  invMatchResults.value = []
  bulkPasteText.value    = ''
  bulkImportMessage.value = ''
}

// 필터 변경으로 편집 중인 품목이 목록에서 사라지면 보이지 않는 항목을 계속 편집하는
// 상태로 남기지 않고 새 품목 입력 폼으로 되돌린다.
watch(displayedItems, (list) => {
  if (editingId.value && !list.some((i) => i.id === editingId.value)) {
    clearForm()
  }
})

function openAdd() { clearForm(); showForm.value = true }

function editItem(item) {
  if (editingId.value === item.id) return
  expandedId.value = ''
  Object.assign(form, {
    id:            item.id,
    name:          item.name,
    pesticideType: item.pesticideType || pesticideTypes.value[0] || '살충제',
    actionGroup:   item.actionGroup  || '',
    productName:   item.productName  || '',
    notes:         item.notes        || '',
    matchSource:   item.matchSource  || '',
  })
  editingId.value  = item.id
  formMode.value   = 'single'
  showForm.value   = true
  scrollToItem(`pip-form-slot-${item.id}`)
}

function closeForm() {
  clearForm()
  showForm.value      = false
  expandedId.value    = ''
  linkingItemId.value = null
  linkQuery.value     = ''
  linkResults.value   = []
}

async function saveItem() {
  await store.upsertInventoryItem({
    id:            form.id || undefined,
    name:          form.name,
    category:      CATEGORY,
    pesticideType: form.pesticideType,
    actionGroup:   form.actionGroup,
    productName:   form.productName,
    matchSource:   form.matchSource,
    notes:         form.notes,
  })
  clearForm()
}

// ── 붙여넣기 일괄추가 (상품명 / 용량 / 유효기간 / 수량 / 비고) ───────────────────
const bulkPasteText = ref('')
const bulkImporting = ref(false)
const bulkImportMessage = ref('')

// 유효기간은 YYYY-MM-DD, YYYY/MM/DD, YYYYMMDD 세 형식을 모두 허용한다.
function parseBulkInventoryDate(raw) {
  const s = raw.trim()
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  const separated = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/)
  return separated ? `${separated[1]}-${separated[2]}-${separated[3]}` : ''
}

function parseBulkInventoryText(text) {
  const rows = []
  for (const line of text.split('\n')) {
    const cols = line.replace(/\r$/, '').split('\t')
    const name = (cols[0] || '').trim()
    const volume = (cols[1] || '').trim()
    const expiryDate = parseBulkInventoryDate(cols[2] || '')
    const amount = Number((cols[3] || '').trim())
    const note = (cols[4] || '').trim()
    if (!name || !volume || !amount || amount <= 0) continue
    rows.push({ name, volume, expiryDate, amount, note })
  }
  return rows
}

const bulkParsedRows = computed(() => parseBulkInventoryText(bulkPasteText.value))

// 같은 상품명이 이미 목록에 있으면 그 품목에 새 로트(입고)만 추가하고,
// 없으면 OpenAPI 캐시로 자동 연결을 시도하며 새 품목을 만든 뒤 입고를 기록한다.
async function importBulkInventory() {
  const rows = bulkParsedRows.value
  if (!rows.length) return
  bulkImporting.value = true
  bulkImportMessage.value = ''
  let addedItems = 0
  try {
    if (recSettingsStore.settings.bulkImportMode === 'replace') {
      const existingIds = store.state.inventory.filter((i) => i.category === CATEGORY).map((i) => i.id)
      for (const id of existingIds) {
        await store.removeInventoryItem(id)
      }
    }
    for (const row of rows) {
      const existing = store.state.inventory.find((i) => i.category === CATEGORY && i.name === row.name)
      let itemId = existing?.id
      if (!itemId) {
        itemId = uuid()
        const match = findBestMatchInCache(row.name)
        const mappedType = match ? resolveType(match.pesticideType) : ''
        await store.upsertInventoryItem({
          id: itemId,
          name: row.name,
          category: CATEGORY,
          pesticideType: (mappedType && pesticideTypes.value.includes(mappedType)) ? mappedType : (pesticideTypes.value[0] ?? '살충제'),
          actionGroup: (match?.modeOfAction && match.modeOfAction !== '-') ? match.modeOfAction : '',
          productName: match?.name || '',
          matchSource: match ? 'auto' : '',
          notes: row.note,
        })
        addedItems++
      } else if (row.note && !existing.notes?.includes(row.note)) {
        // 이미 있는 품목이면 비고와 같은 문구가 메모에 없을 때만 이어붙인다.
        existing.notes = existing.notes ? `${existing.notes}\n${row.note}` : row.note
        await store.upsertInventoryItem({ id: itemId, notes: existing.notes })
      }
      await store.addInventoryTxn(itemId, {
        type: '입고', volume: row.volume, expiryDate: row.expiryDate, amount: row.amount, note: '',
      })
    }
    const prefix = recSettingsStore.settings.bulkImportMode === 'replace' ? '전체 새로 작성됨: ' : ''
    bulkImportMessage.value = `${prefix}${rows.length}건 입고 처리됨 (신규 품목 ${addedItems}개)`
    bulkPasteText.value = ''
  } finally {
    bulkImporting.value = false
  }
}

// 농약재고 전체 삭제 — 관리모드 동작 설정에서 "초기화 버튼: 표시"일 때만 노출된다.
async function resetAllItems() {
  const ids = store.state.inventory.filter((i) => i.category === CATEGORY).map((i) => i.id)
  if (!ids.length) return
  const ok = await confirm({
    title: t('confirm.resetTitle'),
    message: t('confirm.resetPesticideInventory', { n: ids.length }),
    confirmLabel: t('common.reset'),
  })
  if (!ok) return
  for (const id of ids) {
    await store.removeInventoryItem(id)
  }
  closeForm()
}

async function deleteItem(item) {
  const txns = (item.txns || []).length
  const ok = await confirm({ message: t('confirm.inventoryItem', { name: item.name, txns }) })
  if (!ok) return
  await store.removeInventoryItem(item.id)
  if (expandedId.value === item.id) expandedId.value = ''
}

// ── 입출고 ───────────────────────────────────────────────────────────────────
// 입출고 패널을 열어도 편집모드(showForm)는 유지한다 — 그래야 목록의 '입·출고' 버튼이 남아
// 다시 눌러 닫을 수 있다. 대신 품목 추가/수정 폼 열은 패널이 열려 있는 동안 감춘다.
function toggleExpand(item) {
  if (expandedId.value === item.id) { expandedId.value = ''; return }
  if (editingId.value) clearForm()
  linkingItemId.value = null
  expandedId.value    = item.id
  showAddTxn.value    = false
  Object.assign(txnForm, { type: '입고', volume: '', expiryDate: '', amount: '', note: '', date: todayInput() })
  cancelEditTxn()
}

function openAddTxn() {
  showAddTxn.value = true
}

function cancelAddTxn() {
  showAddTxn.value = false
}

// 입고↔사용 전환 시 규격·유효기간 입력 방식이 바뀌므로(자유 입력 ↔ 재고 선택) 값을 다시 잡는다.
function setTxnType(item, type) {
  if (txnForm.type === type) return
  txnForm.type = type
  txnForm.volume = ''
  txnForm.expiryDate = ''
  if (type === '사용') {
    const [firstVolume] = stockVolumeOptions(item)
    if (firstVolume) selectTxnVolume(item, firstVolume)
  }
}

// 규격을 고르면 그 규격에 남아 있는 유효기간만 남으므로 첫 로트를 기본으로 잡아준다.
function selectTxnVolume(item, volume) {
  txnForm.volume = volume
  txnForm.expiryDate = stockExpiryOptions(item, volume)[0]?.expiryDate ?? ''
}

async function recordTxn(item) {
  const amount = Number(txnForm.amount)
  if (!txnForm.volume.trim() || !amount || amount <= 0) return
  await store.addInventoryTxn(item.id, {
    type: txnForm.type, volume: txnForm.volume.trim(),
    expiryDate: txnForm.expiryDate, amount, note: txnForm.note,
    date: toIsoDate(txnForm.date),
  })
  txnForm.amount = ''
  txnForm.note   = ''
}

function txnKey(txn) { return txn.id || txn.date }

function startEditTxn(txn) {
  editingTxnId.value = txnKey(txn)
  Object.assign(editTxnForm, {
    type:       txn.type === '사용' ? '사용' : '입고',
    volume:     txn.volume     || '',
    expiryDate: txn.expiryDate || '',
    amount:     txn.amount,
    note:       txn.note       || '',
    date:       toDateInput(txn.date) || todayInput(),
  })
}

function cancelEditTxn() {
  editingTxnId.value = ''
  Object.assign(editTxnForm, { volume: '', expiryDate: '', amount: '', note: '', date: '' })
}

async function saveEditTxn(item) {
  const amount = Number(editTxnForm.amount)
  if (!editTxnForm.volume.trim() || !amount || amount <= 0) return
  // type은 넘기지 않는다 — 입고/사용 구분은 편집 대상이 아니다.
  await store.updateInventoryTxn(item.id, editingTxnId.value, {
    volume: editTxnForm.volume.trim(),
    expiryDate: editTxnForm.expiryDate, amount, note: editTxnForm.note,
    date: toIsoDate(editTxnForm.date),
  })
  cancelEditTxn()
}

async function deleteTxn(item, txn) {
  const ok = await confirm({ message: '이 입출고 기록을 삭제합니다. 되돌릴 수 없습니다.' })
  if (!ok) return
  await store.removeInventoryTxn(item.id, txnKey(txn))
  if (editingTxnId.value === txnKey(txn)) cancelEditTxn()
}

// ── CSV 다운로드 ──────────────────────────────────────────────────────────────
function statusText(dateStr) {
  const s = expiryStatus(dateStr)
  if (s === 'expired') return t('inventory.expired')
  if (s === 'soon')    return t('inventory.expiringSoon')
  return ''
}

async function downloadReport() {
  const ok = await confirmFilteredExport({
    filtered: isFiltered.value,
    shown: summary.value.total,
    total: summary.value.categoryTotal,
    kind: 'csv',
  })
  if (!ok) return

  const headers = [
    t('pesticideInventory.name'), t('pesticideInventory.pesticideType'),
    t('pesticideInventory.actionGroup'), t('pesticideInventory.productName'),
    t('inventory.volume'), t('inventory.expiryDate'),
    t('inventory.amount'), t('inventory.reportStatus'), t('inventory.notes'),
  ]
  const rows = [headers]
  for (const item of [...displayedItems.value].sort((a, b) => a.name.localeCompare(b.name))) {
    const base = [item.name, item.pesticideType || '', item.actionGroup || '', item.productName || '']
    const lots = lotsOf(item)
    if (lots.length) {
      for (const lot of lots)
        rows.push([...base, lot.volume, lot.expiryDate || '', lot.quantity, statusText(lot.expiryDate), item.notes || ''])
    } else {
      rows.push([...base, '', '', 0, '', item.notes || ''])
    }
  }
  downloadCsv(rows, exportFileName({
    farmName: farmsStore.activeFarm?.name,
    label: '농약재고',
    date: format(new Date(), 'yyyy-MM-dd'),
  }))
}

// ── PDF/인쇄 ────────────────────────────────────────────────────────────────
function rowClass(status) {
  if (status === 'expired') return 'row-expired'
  if (status === 'soon') return 'row-soon'
  return ''
}

async function printReport() {
  const ok = await confirmFilteredExport({
    filtered: isFiltered.value,
    shown: summary.value.total,
    total: summary.value.categoryTotal,
    kind: 'pdf',
  })
  if (!ok) return

  const today = format(new Date(), 'yyyy-MM-dd')
  const items = [...displayedItems.value].sort((a, b) => a.name.localeCompare(b.name))
  const headers = [
    t('pesticideInventory.name'), t('pesticideInventory.pesticideType'),
    t('pesticideInventory.actionGroup'), t('pesticideInventory.productName'),
    t('inventory.volume'), t('inventory.expiryDate'),
    t('inventory.amount'), t('inventory.reportStatus'), t('inventory.notes'),
  ]

  const rows = []
  for (const item of items) {
    const base = [item.name, item.pesticideType || '', item.actionGroup || '', item.productName || '']
    const lots = lotsOf(item)
    if (lots.length) {
      for (const lot of lots) {
        rows.push({
          cells: [...base, lot.volume, lot.expiryDate || '—', lot.quantity, statusText(lot.expiryDate), item.notes || ''],
          cls: rowClass(expiryStatus(lot.expiryDate)),
        })
      }
    } else {
      rows.push([...base, '', '—', 0, '', item.notes || ''])
    }
  }

  const summaryText = summary.value.expiring
    ? ` · ${t('inventory.summaryExpiring', { count: summary.value.expiring })}`
    : ''

  openPrintReport({
    farmName: farmsStore.activeFarm?.name,
    title: t('pesticideInventory.reportTitle'),
    meta: `${t('inventory.reportGeneratedAt', { date: today })} · ${t('inventory.summaryTotal', { count: summary.value.total })}${summaryText}`,
    headers,
    rows,
    autoPrint: policyStore.policy.autoOpenPrintDialog,
  })
}
</script>

<template>
  <div :class="['page-grid', showForm && !expandedId ? 'two-columns' : '']">
    <!-- ── 목록 열 ─────────────────────────────────────────────── -->
    <article>
      <!-- 헤더: 액션 -->
      <div class="pip-header">
        <div class="pip-actions">
          <OverflowMenu v-if="!showForm" title="더보기">
            <button class="ghost" type="button" :disabled="!summary.total" @click="printReport">{{ t('inventory.printReport') }}</button>
            <button class="ghost" type="button" :disabled="!summary.total" @click="downloadReport">{{ t('inventory.downloadReport') }}</button>
          </OverflowMenu>
          <OverflowMenu v-else-if="showResetButton && summary.categoryTotal > 0" title="더보기">
            <button class="danger" type="button" @click="resetAllItems">{{ t('common.reset') }}</button>
          </OverflowMenu>
          <button v-if="!showForm && farmMembersStore.canWrite('inventory')" type="button" @click="openAdd">{{ t('common.edit') }}</button>
          <button v-else-if="showForm" class="ghost" type="button" @click="closeForm">{{ t('common.exitEdit') }}</button>
        </div>
      </div>

      <!-- 요약 + 정렬 + 필터 -->
      <MobileFilterBar :active="activeFilters" :on-reset-all="clearAllFilters" title="필터">
        <template #always>
          <span class="summary-chip">{{ isFiltered ? t('common.filteredCount', { shown: summary.total, total: summary.categoryTotal }) : t('common.totalCount', { n: summary.total }) }}</span>
          <span v-if="summary.expiring" class="summary-chip chip-danger">{{ t('inventory.summaryExpiring', { count: summary.expiring }) }}</span>
        </template>
        <span class="filter-sep">|</span>
        <span class="filter-label">{{ t('inventory.sortBy') }}</span>
        <select v-model="sortBy" class="compact-select">
          <option value="name">{{ t('pesticideInventory.sortName') }}</option>
          <option value="expiry">{{ t('inventory.sortExpiry') }}</option>
        </select>
        <button class="ghost compact-btn" type="button" @click="sortDir = sortDir === 'asc' ? 'desc' : 'asc'">{{ sortDir === 'asc' ? '↑' : '↓' }}</button>
        <span class="filter-sep">|</span>
        <button
          class="ghost ap-unmatched-btn"
          :class="{ 'ap-unmatched-active': unmatchedOnly }"
          type="button"
          @click="unmatchedOnly = !unmatchedOnly"
        >미연결만 ({{ summary.unmatched }})</button>
        <button
          class="ghost ap-unmatched-btn"
          :class="{ 'ap-unmatched-active': outOfStockOnly }"
          type="button"
          @click="outOfStockOnly = !outOfStockOnly"
        >재고없음 ({{ summary.outOfStock }})</button>
      </MobileFilterBar>

      <!-- 품목 목록 -->
      <div id="pip-form-top" class="mobile-form-slot"></div>
      <div v-if="displayedItems.length === 0" class="empty-msg">
        {{ unmatchedOnly ? '미연결 품목이 없습니다.' : outOfStockOnly ? '재고 없는 품목이 없습니다.' : (showForm ? '저장하면 목록에 표시됩니다.' : '농약 재고 품목이 없습니다. 추가 버튼으로 등록하세요.') }}
      </div>
      <ul v-else class="list clean">
        <li v-for="item in displayedItems" :key="item.id" class="list-item card-like">
          <div>
            <div class="task-card-top">
              <p class="item-title">{{ item.name }}</p>
              <span v-if="item.pesticideType" class="cat-badge" :class="categoryClass(item.pesticideType)">{{ item.pesticideType }}</span>
              <span v-if="item.actionGroup" class="moa-badge" :style="{ background: moaColor(item.actionGroup) }">{{ item.actionGroup }}</span>
              <span v-if="item.matchSource === 'auto'" class="match-badge match-ok">자동</span>
            </div>
            <p v-if="item.productName" class="item-meta">{{ item.productName }}</p>

            <p class="muted log-history-label">{{ t('inventory.currentStock') }}</p>
            <ul class="list clean compact">
              <li
                v-for="lot in lotsOf(item)"
                :key="lot.volume + lot.expiryDate"
                class="item-meta inventory-lot"
              >
                {{ lotText(lot) }}
                <span v-if="expiryStatus(lot.expiryDate) === 'expired'" class="pill danger">{{ t('inventory.expired') }}</span>
                <span v-else-if="expiryStatus(lot.expiryDate) === 'soon'" class="pill danger">{{ t('inventory.expiringSoon') }}</span>
              </li>
              <li v-if="!lotsOf(item).length" class="muted">{{ t('inventory.noStock') }}</li>
            </ul>

            <p v-if="item.notes" class="muted">{{ item.notes }}</p>
          </div>

          <div class="row-actions">
            <button :class="{ ghost: expandedId !== item.id }" type="button" @click="toggleExpand(item)">{{ t('inventory.inOut') }} {{ expandedId === item.id ? '▲' : '▼' }}</button>
            <template v-if="showForm && farmMembersStore.canWrite('inventory')">
              <button
                class="ghost"
                :class="{ 'link-btn-active': linkingItemId === item.id }"
                type="button"
                @click="openLink(item.id)"
              >{{ item.actionGroup ? '정보 재연결' : '농약정보 연결' }}</button>
              <button :class="{ ghost: editingId !== item.id }" type="button" @click="editItem(item)">{{ t('common.edit') }}</button>
              <button class="danger" type="button" @click="deleteItem(item)">{{ t('common.delete') }}</button>
            </template>
          </div>

          <!-- 농약정보 연결 패널 -->
          <div v-if="linkingItemId === item.id" class="link-panel">
            <input
              v-model="linkQuery"
              type="text"
              class="link-search-input"
              placeholder="농약명 검색 (공공데이터)"
              @input="searchLinkCandidates(linkQuery)"
            />
            <div v-if="linkResults.length" class="link-results">
              <PesticideLinkResults :results="linkResults" :item-key="(r) => r.key" @apply="(r) => applyLink(item, r)">
                <template #badges="{ item: r }">
                  <span v-if="r.pesticideType" class="cat-badge" :class="categoryClass(resolveType(r.pesticideType))">{{ resolveType(r.pesticideType) }}</span>
                  <span v-if="r.modeOfActions?.[0]" class="moa-badge" :style="{ background: moaColor(r.modeOfActions[0]) }">{{ r.modeOfActions[0] }}</span>
                </template>
                <template #pest="{ item: r }">{{ pestSummary(r) }}</template>
              </PesticideLinkResults>
            </div>
            <p v-else-if="linkQuery.trim().length > 1" class="muted text-sm" style="padding:0.4rem 0;">
              검색 결과 없음 — 공공데이터 농약정보를 먼저 가져와야 합니다.
            </p>
          </div>

          <div :id="`pip-form-slot-${item.id}`" class="mobile-form-slot"></div>

          <!-- 입출고 패널 -->
          <div v-if="expandedId === item.id" class="log-panel">
            <div class="row-actions align-start log-history-label">
              <p class="muted" style="margin: 0;">{{ t('inventory.history') }}</p>
              <button v-if="!showAddTxn && farmMembersStore.canWrite('inventory')" class="ghost compact-btn" type="button" @click="openAddTxn">{{ t('inventory.addTxnTrigger') }}</button>
            </div>

            <form v-if="showAddTxn" class="stack-form" style="margin-bottom: 1rem;" @submit.prevent="recordTxn(item)">
              <div class="inline-filters">
                <button type="button" :class="{ ghost: txnForm.type !== '입고' }" @click="setTxnType(item, '입고')">{{ t('inventory.stockIn') }}</button>
                <button type="button" :class="{ ghost: txnForm.type !== '사용' }" @click="setTxnType(item, '사용')">{{ t('inventory.stockOut') }}</button>
              </div>
              <!-- 뺄 재고가 없으면 입력할 것이 없으므로 안내만 남긴다. -->
              <p v-if="cannotRecordUse(item)" class="muted text-sm">{{ t('inventory.noStockForUse') }}</p>

              <template v-else>
              <div class="row-actions txn-fields">
                <!-- 사용은 남아 있는 로트에서만 고르고, 입고는 새 로트를 만들 수 있어야 하므로 자유 입력이다. -->
                <template v-if="txnForm.type === '사용'">
                  <label class="txn-field-grow">{{ t('inventory.volume') }}
                    <select :value="txnForm.volume" @change="selectTxnVolume(item, $event.target.value)">
                      <option value="">{{ t('inventory.selectLot') }}</option>
                      <option v-for="v in stockVolumeOptions(item)" :key="v" :value="v">{{ v }}</option>
                    </select>
                  </label>
                  <label class="txn-field-grow">{{ t('inventory.expiryDate') }}
                    <select v-model="txnForm.expiryDate" :disabled="!txnForm.volume">
                      <option
                        v-for="lot in stockExpiryOptions(item, txnForm.volume)"
                        :key="lot.expiryDate"
                        :value="lot.expiryDate"
                      >{{ lot.expiryDate || t('inventory.noExpiry') }} ({{ lot.quantity }})</option>
                    </select>
                  </label>
                </template>
                <template v-else>
                  <label class="txn-field-grow">{{ t('inventory.volume') }}
                    <input v-model="txnForm.volume" type="text" :list="`vol-${item.id}`" :placeholder="t('inventory.volumePlaceholder')" />
                    <datalist :id="`vol-${item.id}`">
                      <option v-for="v in volumeOptions(item)" :key="v" :value="v" />
                    </datalist>
                  </label>
                  <label class="txn-field-grow">{{ t('inventory.expiryDate') }}
                    <input v-model="txnForm.expiryDate" type="date" />
                  </label>
                </template>
                <label class="txn-field-amount">{{ t('inventory.amount') }}
                  <input v-model="txnForm.amount" type="number" min="0" step="any" />
                </label>
              </div>
              <label>{{ txnForm.type === '사용' ? t('inventory.stockOutDate') : t('inventory.stockInDate') }}
                <input v-model="txnForm.date" type="date" />
              </label>
              <input v-model="txnForm.note" type="text" :placeholder="t('inventory.txnNote')" />
              </template>
              <!-- 취소는 재고가 없어 입력란이 숨겨진 경우에도 필요하므로 항상 둔다. -->
              <div class="row-actions">
                <button v-if="!cannotRecordUse(item)" type="submit">{{ t('inventory.record') }}</button>
                <button class="ghost" type="button" @click="cancelAddTxn">{{ t('common.cancel') }}</button>
              </div>
            </form>

            <ul class="list clean compact">
              <li v-for="txn in sortedTxns(item)" :key="txnKey(txn)" class="list-item">
                <div v-if="editingTxnId !== txnKey(txn)" class="log-entry">
                  <span class="log-entry-info">
                    <span class="pill" :class="txn.type === '사용' ? 'danger' : ''">{{ txn.type }}</span>
                    <span class="inventory-txn-amount">{{ txn.type === '사용' ? '−' : '+' }}{{ txn.amount }}</span>
                    <span class="item-meta">{{ txn.volume }} · {{ txn.expiryDate || t('inventory.noExpiry') }}</span>
                    <span class="item-meta">{{ formatTxnDate(txn.date) }}</span>
                    <span v-if="txn.note" class="muted">{{ txn.note }}</span>
                  </span>
                  <span v-if="farmMembersStore.canWrite('inventory')" class="log-entry-actions">
                    <button class="ghost icon-btn" type="button" :title="t('common.edit')" :aria-label="t('common.edit')" @click="startEditTxn(txn)">✎</button>
                    <button class="danger icon-btn" type="button" :title="t('common.delete')" :aria-label="t('common.delete')" @click="deleteTxn(item, txn)">✕</button>
                  </span>
                </div>
                <form v-else class="stack-form" @submit.prevent="saveEditTxn(item)">
                  <!-- 입고/사용 구분은 편집으로 바꾸지 않는다(재고 계산이 뒤집힌다) — 표시만 한다. -->
                  <div class="inline-filters">
                    <span class="pill" :class="txn.type === '사용' ? 'danger' : ''">{{ txn.type }}</span>
                  </div>
                  <div class="row-actions txn-fields">
                    <input v-model="editTxnForm.volume" class="txn-field-grow" type="text" :placeholder="t('inventory.volume')" />
                    <input v-model="editTxnForm.expiryDate" class="txn-field-grow" type="date" />
                    <input v-model="editTxnForm.amount" class="txn-field-amount" type="number" min="0" step="any" />
                  </div>
                  <label>{{ editTxnForm.type === '사용' ? t('inventory.stockOutDate') : t('inventory.stockInDate') }}
                    <input v-model="editTxnForm.date" type="date" />
                  </label>
                  <input v-model="editTxnForm.note" type="text" :placeholder="t('inventory.txnNote')" />
                  <div class="row-actions">
                    <button type="submit">{{ t('common.change') }}</button>
                    <button class="ghost" type="button" @click="cancelEditTxn">{{ t('common.cancel') }}</button>
                  </div>
                </form>
              </li>
              <li v-if="!item.txns?.length" class="muted">{{ t('inventory.noHistory') }}</li>
            </ul>
          </div>
        </li>
      </ul>
    </article>

    <!-- ── 폼 열 (입출고 패널이 열려 있는 동안에는 감춘다) ──────────── -->
    <Teleport v-if="showForm && !expandedId" :to="formTarget" :disabled="!isMobile">
    <article class="card">
      <div v-if="!editingId" class="inline-filters" style="margin-bottom: 1rem;">
        <button :class="{ ghost: formMode !== 'single' }" type="button" @click="formMode = 'single'">품목 추가</button>
        <button :class="{ ghost: formMode !== 'bulk' }" type="button" @click="formMode = 'bulk'">붙여넣기 일괄추가</button>
      </div>

      <template v-if="formMode === 'bulk' && !editingId">
        <h2>붙여넣기로 일괄 추가</h2>
        <p class="ap-hint">
          <code>상품명</code>, <code>용량</code>, <code>유효기간</code>, <code>수량</code>, <code>비고</code> 열을 탭으로 구분해 붙여넣으세요 (스프레드시트에서 복사). 유효기간은 <code>YYYY-MM-DD</code>, <code>YYYY/MM/DD</code>, <code>YYYYMMDD</code> 모두 가능합니다.<br>
          같은 상품명이 이미 있으면 새 로트(입고)만 추가되고, 없으면 공공데이터 정보를 자동 연결해 새 품목을 만듭니다.
          비고는 품목 메모에 들어가며, 이미 있는 품목이면 같은 문구가 메모에 없을 때만 이어붙입니다.<br>
          현재 설정: <strong>{{ recSettingsStore.settings.bulkImportMode === 'replace' ? '전체 새로 작성' : '기존 목록에 추가' }}</strong>
          <span v-if="recSettingsStore.settings.bulkImportMode === 'replace'" class="muted">(붙여넣는 내용으로 농약재고 전체를 대체합니다 — 설정페이지에서 변경 가능)</span>
          <span v-else class="muted">(설정페이지에서 변경 가능)</span>
        </p>
        <textarea
          v-model="bulkPasteText"
          class="ap-textarea"
          rows="8"
          placeholder="근사미	300ml	2026-10-31	1	"
        ></textarea>
        <div class="ap-input-footer">
          <span v-if="bulkParsedRows.length > 0" class="ap-parse-count">{{ bulkParsedRows.length }}개 항목 인식됨</span>
          <span v-else class="ap-parse-count muted">입력 없음</span>
        </div>
        <div class="row-actions">
          <button type="button" :disabled="bulkImporting || !bulkParsedRows.length" @click="importBulkInventory">
            {{ bulkImporting ? '처리 중...' : (recSettingsStore.settings.bulkImportMode === 'replace' ? '전체 새로 작성' : '일괄 추가') }}
          </button>
        </div>
        <p v-if="bulkImportMessage" class="muted text-sm" style="margin-top:0.5rem;">{{ bulkImportMessage }}</p>
      </template>

      <template v-else>
      <h2>{{ editingId ? t('inventory.editItem') : t('inventory.addItem') }}</h2>
      <form class="stack-form" @submit.prevent="saveItem">
        <label>{{ t('pesticideInventory.name') }}
          <input v-model="form.name" required type="text" :placeholder="t('pesticideInventory.namePlaceholder')" @input="onNameInput" />
        </label>
        <div v-if="invMatchResults.length" class="inv-api-panel">
          <PesticideLinkResults :results="invMatchResults" :item-key="(r) => r.key" @apply="applyInvMatch">
            <template #badges="{ item: r }">
              <span v-if="r.pesticideType" class="cat-badge" :class="categoryClass(resolveType(r.pesticideType))">{{ resolveType(r.pesticideType) }}</span>
              <span v-if="r.modeOfActions?.[0]" class="moa-badge" :style="{ background: moaColor(r.modeOfActions[0]) }">{{ r.modeOfActions[0] }}</span>
            </template>
            <template #pest="{ item: r }">{{ pestSummary(r) }}</template>
          </PesticideLinkResults>
        </div>
        <label>{{ t('pesticideInventory.pesticideType') }}
          <select v-model="form.pesticideType">
            <option v-for="tp in pesticideTypes" :key="tp" :value="tp">{{ tp }}</option>
          </select>
        </label>
        <label>{{ t('pesticideInventory.actionGroup') }}
          <input v-model="form.actionGroup" type="text" :placeholder="t('pesticideInventory.actionGroupPlaceholder')" />
        </label>
        <label>{{ t('pesticideInventory.productName') }}
          <input v-model="form.productName" type="text" :placeholder="t('pesticideInventory.productNamePlaceholder')" />
        </label>
        <label>{{ t('inventory.notes') }}
          <textarea v-model="form.notes" rows="2" />
        </label>
        <div class="row-actions">
          <button type="submit">{{ editingId ? t('common.change') : t('common.add') }}</button>
          <button v-if="editingId" class="ghost" type="button" @click="clearForm">{{ t('common.cancel') }}</button>
        </div>
      </form>
      <p class="muted text-sm">{{ t('inventory.inOut') }}로 규격·유효기간별 재고를 등록·관리합니다.</p>
      </template>
    </article>
    </Teleport>
  </div>
</template>

<style scoped>

/* 입출고 입력줄 — 입력 요소는 기본 폭(≈170px)이 있어 그대로 두면 좁은 화면에서 칸을 넘친다.
   칸 너비에 맞춰 줄이고(min-width: 0), 자리가 모자라면 다음 줄로 넘긴다. */
.txn-fields > label {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}
.txn-fields input,
.txn-fields select {
  width: 100%;
  min-width: 0;
}
.txn-field-grow { flex: 1 1 9rem; }
.txn-field-amount { flex: 0 1 5.5rem; }

/* OpenAPI search panel */
.inv-api-panel {
  display: flex; flex-direction: column; gap: 0.2rem;
  max-height: 220px; overflow-y: auto;
  border: 1px solid var(--primary); border-radius: 0.45rem;
  background: var(--bg);
  margin-top: -0.25rem; margin-bottom: 0.25rem;
}
/* 농약정보 연결 버튼 */
.link-btn-active { background: var(--primary) !important; color: var(--primary-ink) !important; border-color: var(--primary) !important; }

/* 농약정보 연결 패널 */
.link-panel {
  margin-top: 0.5rem;
  border: 1px solid var(--primary);
  border-radius: 0.5rem;
  overflow: hidden;
}
.link-search-input {
  width: 100%;
  border: none;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  padding: 0.45rem 0.7rem;
  font-size: 0.85rem;
  font-family: inherit;
  background: var(--bg);
  outline: none;
  box-sizing: border-box;
}
.link-search-input:focus { background: var(--surface); }
.link-results { max-height: 200px; overflow-y: auto; }
</style>
