<script setup>
import { computed, nextTick, reactive, ref } from 'vue'
import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { useFarmStore } from '../stores/farmStore'
import { useLocaleStore } from '../stores/localeStore'
import { useRecommendSettingsStore } from '../stores/recommendSettingsStore'
import { confirm } from '../composables/useConfirm'
import { useIsMobile } from '../composables/useIsMobile'
import { useFarmsStore } from '../stores/farmsStore'
import { useAppPolicyStore } from '../stores/appPolicyStore'
import { useFarmMembersStore } from '../stores/farmMembersStore'
import { downloadCsv, exportFileName, openPrintReport } from '../utils/dataExport.js'
import MobileFilterBar from './MobileFilterBar.vue'
import OverflowMenu from './OverflowMenu.vue'

const store = useFarmStore()
const farmsStore = useFarmsStore()
const localeStore = useLocaleStore()
const recSettingsStore = useRecommendSettingsStore()
const policyStore = useAppPolicyStore()
const farmMembersStore = useFarmMembersStore()

const { isMobile } = useIsMobile()

const CATEGORY = '비료'

// 초기화 버튼 — 시스템 관리 모드에서 기능을 "사용"으로 켜고, 이 농장에서 "표시"로 켠 경우에만 노출한다.
const showResetButton = computed(() =>
  policyStore.policy.enableResetFeature && recSettingsStore.settings.showResetButtons,
)

const showForm = ref(false)
const editingId = ref('')
const expandedId = ref('')
const showAddTxn = ref(false)

const formOpen = ref(false) // 폼(추가/편집) 표시 여부 — 토글로 닫으면 추가 폼도 숨긴다
// 편집 대상이 현재 목록에 보일 때만 그 항목 슬롯으로, 아니면 항상 존재하는 상단 호스트로(텔레포트 대상 null 방지)
const formTarget = computed(() =>
  editingId.value && displayedItems.value.some((i) => i.id === editingId.value)
    ? `#inv-form-slot-${editingId.value}`
    : '#inv-form-top',
)

const sortBy = ref('name')
const sortDir = ref('asc')

const EXPIRY_SOON_DAYS = 30

const form = reactive({
  id: '',
  name: '',
  notes: '',
})

const txnForm = reactive({
  type: '입고',
  volume: '',
  expiryDate: '',
  amount: '',
  note: '',
})

// 입출고 이력 편집
const editingTxnId = ref('')
const editTxnForm = reactive({
  type: '입고',
  volume: '',
  expiryDate: '',
  amount: '',
  note: '',
})

// ── 로트(규격+유효기간) 계산 ─────────────────────────────────────────────────
// 현재 재고는 입출고 이력(txns)으로부터 로트별로 합산해 계산한다.
function lotsOf(item) {
  const map = new Map()
  for (const t of item.txns || []) {
    const key = `${t.volume} ${t.expiryDate}`
    if (!map.has(key)) {
      map.set(key, { volume: t.volume, expiryDate: t.expiryDate, quantity: 0 })
    }
    map.get(key).quantity += t.type === '사용' ? -Number(t.amount || 0) : Number(t.amount || 0)
  }
  return [...map.values()]
    .filter((lot) => lot.quantity !== 0)
    .sort(
      (a, b) =>
        (a.expiryDate || '9999-12-31').localeCompare(b.expiryDate || '9999-12-31') ||
        a.volume.localeCompare(b.volume),
    )
}

function volumeOptions(item) {
  return [...new Set((item.txns || []).map((t) => t.volume).filter(Boolean))]
}

// ── 상태 판정 ────────────────────────────────────────────────────────────────
function expiryStatus(dateStr) {
  if (!dateStr) return ''
  const d = parseISO(dateStr)
  if (Number.isNaN(d.getTime())) return ''
  const diff = differenceInCalendarDays(d, new Date())
  if (diff < 0) return 'expired'
  if (diff <= EXPIRY_SOON_DAYS) return 'soon'
  return ''
}

function earliestExpiry(item) {
  const dates = lotsOf(item)
    .map((lot) => lot.expiryDate)
    .filter(Boolean)
  return dates.length ? dates.sort()[0] : '9999-12-31'
}

function expiringLotCount(item) {
  return lotsOf(item).filter((lot) => expiryStatus(lot.expiryDate) !== '').length
}

function lotText(lot) {
  return localeStore.t('inventory.lotLabel', {
    volume: lot.volume,
    expiry: lot.expiryDate || localeStore.t('inventory.noExpiry'),
    quantity: lot.quantity,
  })
}

// ── 목록 ─────────────────────────────────────────────────────────────────────
const displayedItems = computed(() => {
  const list = store.state.inventory
    .filter((item) => item.category === CATEGORY)
    .sort((a, b) => {
      const va = sortBy.value === 'expiry' ? earliestExpiry(a) : a.name
      const vb = sortBy.value === 'expiry' ? earliestExpiry(b) : b.name
      return sortDir.value === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
    })
  return list
})

const summary = computed(() => {
  const items = store.state.inventory.filter((i) => i.category === CATEGORY)
  return {
    total: items.length,
    expiring: items.reduce((sum, item) => sum + expiringLotCount(item), 0),
  }
})

// 모바일 필터시트(MobileFilterBar)에 표시할 "적용된 필터" 요약 — 여기엔 켜고 끄는
// 필터가 없어(정렬만 있음) 항상 빈 배열이지만, 시트 자체는 정렬 컨트롤을 담는 데 쓴다.
const invActiveFilters = computed(() => [])
function invClearAllFilters() {
  sortBy.value = 'name'
  sortDir.value = 'asc'
}

// ── 품목 폼 ──────────────────────────────────────────────────────────────────
function clearForm() {
  form.id = ''
  form.name = ''
  form.notes = ''
  editingId.value = ''
}

function openAdd() {
  clearForm()
  showForm.value = true
  formOpen.value = true
}


function editItem(item) {
  // 이미 이 품목 편집 중이면 그대로 둔다(재클릭해도 닫지 않음)
  if (editingId.value === item.id) return
  expandedId.value = '' // 입출고 패널과 상호 배타
  formOpen.value = true
  form.id = item.id
  form.name = item.name
  form.notes = item.notes || ''
  editingId.value = item.id
  showForm.value = true
  scrollToItem(`inv-form-slot-${item.id}`)
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
  showForm.value = false
  formOpen.value = false
  expandedId.value = ''
}

async function saveItem() {
  await store.upsertInventoryItem({
    id: form.id || undefined,
    name: form.name,
    category: CATEGORY,
    notes: form.notes,
  })
  clearForm()
}

async function deleteItem(item) {
  const txns = (item.txns || []).length
  const ok = await confirm({ message: localeStore.t('confirm.inventoryItem', { name: item.name, txns }) })
  if (!ok) return
  await store.removeInventoryItem(item.id)
  if (expandedId.value === item.id) expandedId.value = ''
}

// 비료재고 전체 삭제 — 관리모드 동작 설정에서 "초기화 버튼: 표시"일 때만 노출된다.
async function resetAllItems() {
  const n = summary.value.total
  if (!n) return
  const ok = await confirm({
    title: localeStore.t('confirm.resetTitle'),
    message: localeStore.t('confirm.resetInventory', { n }),
    confirmLabel: localeStore.t('common.reset'),
  })
  if (!ok) return
  await store.resetInventoryCategory(CATEGORY)
  closeForm()
}

// ── 입출고 ───────────────────────────────────────────────────────────────────
function toggleExpand(item) {
  if (expandedId.value === item.id) {
    expandedId.value = ''
  } else {
    if (editingId.value) clearForm() // 편집 폼과 상호 배타
    formOpen.value = false
    expandedId.value = item.id
    showAddTxn.value = false
    txnForm.type = '입고'
    txnForm.volume = ''
    txnForm.expiryDate = ''
    txnForm.amount = ''
    txnForm.note = ''
    cancelEditTxn()
  }
}

function openAddTxn() {
  showAddTxn.value = true
}

function cancelAddTxn() {
  showAddTxn.value = false
}

async function recordTxn(item) {
  const amount = Number(txnForm.amount)
  if (!txnForm.volume.trim() || !amount || amount <= 0) return
  await store.addInventoryTxn(item.id, {
    type: txnForm.type,
    volume: txnForm.volume.trim(),
    expiryDate: txnForm.expiryDate,
    amount,
    note: txnForm.note,
  })
  txnForm.amount = ''
  txnForm.note = ''
}

async function deleteTxn(item, txn) {
  const ok = await confirm({ message: '이 입출고 기록을 삭제합니다. 되돌릴 수 없습니다.' })
  if (!ok) return
  await store.removeInventoryTxn(item.id, txnKey(txn))
  if (editingTxnId.value === txnKey(txn)) cancelEditTxn()
}

function txnKey(txn) {
  return txn.id || txn.date
}

function startEditTxn(txn) {
  editingTxnId.value = txnKey(txn)
  editTxnForm.type = txn.type === '사용' ? '사용' : '입고'
  editTxnForm.volume = txn.volume || ''
  editTxnForm.expiryDate = txn.expiryDate || ''
  editTxnForm.amount = txn.amount
  editTxnForm.note = txn.note || ''
}

function cancelEditTxn() {
  editingTxnId.value = ''
  editTxnForm.volume = ''
  editTxnForm.expiryDate = ''
  editTxnForm.amount = ''
  editTxnForm.note = ''
}

async function saveEditTxn(item) {
  const amount = Number(editTxnForm.amount)
  if (!editTxnForm.volume.trim() || !amount || amount <= 0) return
  await store.updateInventoryTxn(item.id, editingTxnId.value, {
    type: editTxnForm.type,
    volume: editTxnForm.volume.trim(),
    expiryDate: editTxnForm.expiryDate,
    amount,
    note: editTxnForm.note,
  })
  cancelEditTxn()
}

function formatTxnDate(dateStr) {
  try {
    return format(new Date(dateStr), 'MM/dd HH:mm')
  } catch {
    return dateStr
  }
}

// ── 재고 현황 보고서(CSV) 다운로드 ───────────────────────────────────────────
function statusText(dateStr) {
  const s = expiryStatus(dateStr)
  if (s === 'expired') return localeStore.t('inventory.expired')
  if (s === 'soon') return localeStore.t('inventory.expiringSoon')
  return ''
}

function downloadReport() {
  const headers = [
    localeStore.t('inventory.name'),
    localeStore.t('inventory.volume'),
    localeStore.t('inventory.expiryDate'),
    localeStore.t('inventory.amount'),
    localeStore.t('inventory.reportStatus'),
    localeStore.t('inventory.notes'),
  ]
  const rows = [headers]
  const items = [...displayedItems.value].sort((a, b) => a.name.localeCompare(b.name))

  for (const item of items) {
    const lots = lotsOf(item)
    if (lots.length) {
      for (const lot of lots) {
        rows.push([item.name, lot.volume, lot.expiryDate || '', lot.quantity, statusText(lot.expiryDate), item.notes || ''])
      }
    } else {
      rows.push([item.name, '', '', 0, '', item.notes || ''])
    }
  }

  const today = format(new Date(), 'yyyy-MM-dd')
  downloadCsv(rows, exportFileName({
    farmName: farmsStore.activeFarm?.name,
    label: localeStore.t('inventory.reportFileName'),
    date: today,
  }))
}

// ── 재고 현황 보고서(PDF/인쇄) ───────────────────────────────────────────────
function rowClass(status) {
  if (status === 'expired') return 'row-expired'
  if (status === 'soon') return 'row-soon'
  return ''
}

function printReport() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const items = [...displayedItems.value].sort((a, b) => a.name.localeCompare(b.name))
  const headers = [
    localeStore.t('inventory.name'),
    localeStore.t('inventory.volume'),
    localeStore.t('inventory.expiryDate'),
    localeStore.t('inventory.amount'),
    localeStore.t('inventory.reportStatus'),
    localeStore.t('inventory.notes'),
  ]

  const rows = []
  for (const item of items) {
    const lots = lotsOf(item)
    if (lots.length) {
      for (const lot of lots) {
        rows.push({
          cells: [item.name, lot.volume, lot.expiryDate || '—', lot.quantity, statusText(lot.expiryDate), item.notes || ''],
          cls: rowClass(expiryStatus(lot.expiryDate)),
        })
      }
    } else {
      rows.push([item.name, '', '—', 0, '', item.notes || ''])
    }
  }

  const expiringText = summary.value.expiring
    ? ` · ${localeStore.t('inventory.summaryExpiring', { count: summary.value.expiring })}`
    : ''

  openPrintReport({
    farmName: farmsStore.activeFarm?.name,
    title: localeStore.t('inventory.reportTitle'),
    meta: `${localeStore.t('inventory.reportGeneratedAt', { date: today })} · ${localeStore.t('common.totalCount', { n: summary.value.total })}${expiringText}`,
    headers,
    rows,
    autoPrint: policyStore.policy.autoOpenPrintDialog,
  })
}

clearForm()
</script>

<template>
  <div :class="['page-grid', showForm && formOpen ? 'two-columns' : '']">
    <article>
      <div class="pip-header">
        <div class="pip-actions">
          <OverflowMenu v-if="!showForm" title="더보기">
            <button class="ghost" type="button" :disabled="!summary.total" @click="printReport">{{ localeStore.t('inventory.printReport') }}</button>
            <button class="ghost" type="button" :disabled="!summary.total" @click="downloadReport">{{ localeStore.t('inventory.downloadReport') }}</button>
          </OverflowMenu>
          <OverflowMenu v-else-if="showResetButton && summary.total > 0" title="더보기">
            <button class="danger" type="button" @click="resetAllItems">{{ localeStore.t('common.reset') }}</button>
          </OverflowMenu>
          <button v-if="!showForm && farmMembersStore.canWrite('inventory')" type="button" @click="openAdd">{{ localeStore.t('common.edit') }}</button>
          <button v-else-if="showForm" class="ghost" type="button" @click="closeForm">{{ localeStore.t('common.exitEdit') }}</button>
        </div>
      </div>

      <MobileFilterBar :active="invActiveFilters" :on-reset-all="invClearAllFilters" title="필터">
        <template #always>
          <span class="summary-chip">{{ localeStore.t('common.totalCount', { n: summary.total }) }}</span>
          <span v-if="summary.expiring" class="summary-chip chip-danger">{{ localeStore.t('inventory.summaryExpiring', { count: summary.expiring }) }}</span>
        </template>
        <span class="filter-sep">|</span>
        <span class="filter-label">{{ localeStore.t('inventory.sortBy') }}</span>
        <select v-model="sortBy" class="compact-select">
          <option value="name">{{ localeStore.t('inventory.sortName') }}</option>
          <option value="expiry">{{ localeStore.t('inventory.sortExpiry') }}</option>
        </select>
        <button
          class="ghost compact-btn"
          type="button"
          @click="sortDir = sortDir === 'asc' ? 'desc' : 'asc'"
        >{{ sortDir === 'asc' ? '↑' : '↓' }}</button>
      </MobileFilterBar>

      <div id="inv-form-top" class="mobile-form-slot"></div>

      <ul class="list clean">
        <li v-for="item in displayedItems" :key="item.id" class="list-item card-like">
          <div>
            <div class="task-card-top">
              <p class="item-title">{{ item.name }}</p>
            </div>

            <!-- 로트별 현재 재고 -->
            <p class="muted log-history-label">{{ localeStore.t('inventory.currentStock') }}</p>
            <ul class="list clean compact">
              <li v-for="lot in lotsOf(item)" :key="lot.volume + lot.expiryDate" class="item-meta inventory-lot">
                {{ lotText(lot) }}
                <span v-if="expiryStatus(lot.expiryDate) === 'expired'" class="pill danger">{{ localeStore.t('inventory.expired') }}</span>
                <span v-else-if="expiryStatus(lot.expiryDate) === 'soon'" class="pill danger">{{ localeStore.t('inventory.expiringSoon') }}</span>
              </li>
              <li v-if="!lotsOf(item).length" class="muted">{{ localeStore.t('inventory.noStock') }}</li>
            </ul>

            <p v-if="item.notes" class="muted">{{ item.notes }}</p>
          </div>

          <div class="row-actions">
            <button :class="{ ghost: expandedId !== item.id }" type="button" @click="toggleExpand(item)">{{ localeStore.t('inventory.inOut') }} {{ expandedId === item.id ? '▲' : '▼' }}</button>
            <template v-if="showForm && farmMembersStore.canWrite('inventory')">
              <button :class="{ ghost: editingId !== item.id }" type="button" @click="editItem(item)">{{ localeStore.t('common.edit') }}</button>
              <button class="danger" type="button" @click="deleteItem(item)">{{ localeStore.t('common.delete') }}</button>
            </template>
          </div>

          <!-- 입출고 패널 -->
          <div v-if="expandedId === item.id" class="log-panel">
            <div class="row-actions align-start log-history-label">
              <p class="muted" style="margin: 0;">{{ localeStore.t('inventory.history') }}</p>
              <button v-if="!showAddTxn && farmMembersStore.canWrite('inventory')" class="ghost compact-btn" type="button" @click="openAddTxn">{{ localeStore.t('inventory.addTxnTrigger') }}</button>
            </div>

            <form v-if="showAddTxn" class="stack-form" style="margin-bottom: 1rem;" @submit.prevent="recordTxn(item)">
              <div class="inline-filters">
                <button type="button" :class="{ ghost: txnForm.type !== '입고' }" @click="txnForm.type = '입고'">{{ localeStore.t('inventory.stockIn') }}</button>
                <button type="button" :class="{ ghost: txnForm.type !== '사용' }" @click="txnForm.type = '사용'">{{ localeStore.t('inventory.stockOut') }}</button>
              </div>
              <div class="row-actions">
                <label style="flex: 1;">{{ localeStore.t('inventory.volume') }}
                  <input v-model="txnForm.volume" type="text" :list="`vol-${item.id}`" :placeholder="localeStore.t('inventory.volumePlaceholder')" />
                  <datalist :id="`vol-${item.id}`">
                    <option v-for="v in volumeOptions(item)" :key="v" :value="v" />
                  </datalist>
                </label>
                <label style="flex: 1;">{{ localeStore.t('inventory.expiryDate') }}
                  <input v-model="txnForm.expiryDate" type="date" />
                </label>
                <label style="width: 5.5rem;">{{ localeStore.t('inventory.amount') }}
                  <input v-model="txnForm.amount" type="number" min="0" step="any" />
                </label>
              </div>
              <input v-model="txnForm.note" type="text" :placeholder="localeStore.t('inventory.txnNote')" />
              <div class="row-actions">
                <button type="submit">{{ localeStore.t('inventory.record') }}</button>
                <button class="ghost" type="button" @click="cancelAddTxn">{{ localeStore.t('common.cancel') }}</button>
              </div>
            </form>

            <ul class="list clean compact">
              <li v-for="txn in item.txns" :key="txnKey(txn)" class="list-item">
                <!-- 표시 모드 -->
                <div v-if="editingTxnId !== txnKey(txn)" class="log-entry">
                  <span class="log-entry-info">
                    <span class="pill" :class="txn.type === '사용' ? 'danger' : ''">{{ txn.type }}</span>
                    <span class="inventory-txn-amount">{{ txn.type === '사용' ? '−' : '+' }}{{ txn.amount }}</span>
                    <span class="item-meta">{{ txn.volume }} · {{ txn.expiryDate || localeStore.t('inventory.noExpiry') }}</span>
                    <span class="item-meta">{{ formatTxnDate(txn.date) }}</span>
                    <span v-if="txn.note" class="muted">{{ txn.note }}</span>
                  </span>
                  <span v-if="farmMembersStore.canWrite('inventory')" class="log-entry-actions">
                    <button class="ghost icon-btn" type="button" :title="localeStore.t('common.edit')" :aria-label="localeStore.t('common.edit')" @click="startEditTxn(txn)">✎</button>
                    <button class="danger icon-btn" type="button" :title="localeStore.t('common.delete')" :aria-label="localeStore.t('common.delete')" @click="deleteTxn(item, txn)">✕</button>
                  </span>
                </div>

                <!-- 편집 모드 -->
                <form v-else class="stack-form" @submit.prevent="saveEditTxn(item)">
                  <div class="inline-filters">
                    <button type="button" :class="{ ghost: editTxnForm.type !== '입고' }" @click="editTxnForm.type = '입고'">{{ localeStore.t('inventory.stockIn') }}</button>
                    <button type="button" :class="{ ghost: editTxnForm.type !== '사용' }" @click="editTxnForm.type = '사용'">{{ localeStore.t('inventory.stockOut') }}</button>
                  </div>
                  <div class="row-actions">
                    <input v-model="editTxnForm.volume" type="text" style="flex: 1;" :placeholder="localeStore.t('inventory.volume')" />
                    <input v-model="editTxnForm.expiryDate" type="date" style="flex: 1;" />
                    <input v-model="editTxnForm.amount" type="number" min="0" step="any" style="width: 5.5rem;" />
                  </div>
                  <input v-model="editTxnForm.note" type="text" :placeholder="localeStore.t('inventory.txnNote')" />
                  <div class="row-actions">
                    <button type="submit">{{ localeStore.t('common.change') }}</button>
                    <button class="ghost" type="button" @click="cancelEditTxn">{{ localeStore.t('common.cancel') }}</button>
                  </div>
                </form>
              </li>
              <li v-if="!item.txns?.length" class="muted">{{ localeStore.t('inventory.noHistory') }}</li>
            </ul>
          </div>
          <div :id="`inv-form-slot-${item.id}`" class="mobile-form-slot"></div>
        </li>
        <li v-if="!displayedItems.length" class="muted">{{ localeStore.t('inventory.noItems') }}</li>
      </ul>
    </article>

    <Teleport v-if="showForm && formOpen" :to="formTarget" :disabled="!isMobile">
    <article v-if="showForm && formOpen" class="card">
      <h3>{{ editingId ? localeStore.t('inventory.editItem') : localeStore.t('inventory.addItem') }}</h3>
      <form class="stack-form" @submit.prevent="saveItem">
        <label>{{ localeStore.t('inventory.name') }}
          <input v-model="form.name" required type="text" :placeholder="localeStore.t('inventory.namePlaceholder')" />
        </label>
        <label>{{ localeStore.t('inventory.notes') }}
          <textarea v-model="form.notes" rows="3" />
        </label>
        <div class="row-actions">
          <button type="submit">{{ editingId ? localeStore.t('common.change') : localeStore.t('common.add') }}</button>
          <button v-if="editingId" class="ghost" type="button" @click="clearForm">{{ localeStore.t('common.cancel') }}</button>
        </div>
      </form>
      <p class="muted text-sm">{{ localeStore.t('inventory.inOut') }}로 규격·유효기간별 재고를 등록·관리합니다.</p>
    </article>
    </Teleport>
  </div>
</template>
