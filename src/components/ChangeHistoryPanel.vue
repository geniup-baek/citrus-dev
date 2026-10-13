<script setup>
import { computed, ref } from 'vue'
import { useFarmStore } from '../stores/farmStore'
import { useTreatmentStore } from '../stores/treatmentStore'
import { useRecommendSettingsStore } from '../stores/recommendSettingsStore'
import { useAppPolicyStore } from '../stores/appPolicyStore'
import { useFarmMembersStore } from '../stores/farmMembersStore'
import { confirm } from '../composables/useConfirm'
import MobileFilterBar from './MobileFilterBar.vue'
import OverflowMenu from './OverflowMenu.vue'

const store = useFarmStore()
const treatStore = useTreatmentStore()
const recSettingsStore = useRecommendSettingsStore()
const policyStore = useAppPolicyStore()
const farmMembersStore = useFarmMembersStore()
// 이력 읽기만 받은 구성원은 되돌리기·삭제를 쓸 수 없다.
const canEditHistory = computed(() => farmMembersStore.canUse('changeLog', 'write'))

const historyEntityFilter = ref('전체')

const historyEntities = computed(() => {
  const seen = new Set()
  for (const entry of store.state.changeLog || []) {
    // '전체'는 아래 "전체 보기" 필터 버튼용으로 예약된 이름이다. 과거에 백업 복원
    // 로그가 entity 값으로 '전체'를 그대로 써서(현재는 '백업/복원'으로 고침) 기존
    // 데이터에는 여전히 남아있을 수 있으므로, 실제 로그 값 목록에서는 걸러낸다 —
    // 안 그러면 '전체' 버튼이 두 개로 보인다.
    if (entry.entity !== '전체') seen.add(entry.entity)
  }
  return ['전체', ...seen]
})

// 모바일 필터시트(MobileFilterBar)에 표시할 "적용된 필터" 요약 — 기존 ref 를 그대로 읽고 쓴다.
const historyActiveFilters = computed(() => [
  historyEntityFilter.value !== '전체' && {
    key: 'entity', label: historyEntityFilter.value, clear: () => { historyEntityFilter.value = '전체' },
  },
].filter(Boolean))

function historyClearAllFilters() {
  historyEntityFilter.value = '전체'
}

const filteredChangeLog = computed(() => {
  const list = Array.isArray(store.state.changeLog) ? store.state.changeLog : []
  return historyEntityFilter.value === '전체'
    ? list
    : list.filter((entry) => entry.entity === historyEntityFilter.value)
})

const historyActionLabels = {
  add: '추가',
  update: '수정',
  delete: '삭제',
  'stock-in': '입고',
  'stock-out': '사용',
}

function historyActionLabel(action) {
  return historyActionLabels[action] || action
}

function historyActionClass(action) {
  return `history-badge-${action}`
}

function formatHistoryAt(iso) {
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

const showChangeLogDeleteButton = computed(() =>
  policyStore.policy.enableChangeLogDeleteFeature && recSettingsStore.settings.showChangeLogDeleteButtons,
)

// 수정은 그때 바뀐 필드를, 삭제는 저장해둔 스냅샷을 되돌릴 수 있을 때만 버튼을 보여준다.
function canRevertEntry(entry) {
  if (entry.action === 'update') return !!(entry.refId && entry.fields)
  if (entry.action === 'delete') return !!entry.snapshot
  return false
}

const revertingId = ref('')
const revertMessage = ref('')

// 방제이력은 farmStore가 아니라 treatmentStore 소속이라 entity로 분기해서 되돌린다.
async function revertHistoryEntry(entry) {
  const ok = await confirm({
    message: '이 변경을 되돌립니다. 되돌리는 것도 새 변경 이력으로 남습니다. 계속할까요?',
    confirmLabel: '되돌리기',
  })
  if (!ok) return
  revertingId.value = entry.id
  revertMessage.value = ''
  try {
    const result = entry.entity === '방제이력'
      ? await treatStore.revertTreatmentLogEntry(entry)
      : await store.revertChangeLogEntry(entry.id)
    revertMessage.value = result.ok ? '되돌렸습니다.' : (result.reason || '되돌리지 못했습니다.')
  } finally {
    revertingId.value = ''
  }
}

async function removeChangeLogEntry(id) {
  const ok = await confirm({ message: '이 변경 이력 항목을 삭제합니다. 되돌릴 수 없습니다.' })
  if (!ok) return
  await store.removeChangeLogEntry(id)
}

async function clearAllChangeLog() {
  const total = store.state.changeLog?.length ?? 0
  if (!total) return
  const ok = await confirm({
    title: '변경 이력 삭제 확인',
    message: `변경 이력 ${total}건을 모두 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`,
    confirmLabel: '전체 삭제',
  })
  if (!ok) return
  await store.clearChangeLog()
}
</script>

<template>
  <div class="sub-card">
    <div class="settings-group-head">
      <h3>변경 이력</h3>
      <div class="row-actions">
        <span class="pill">{{ filteredChangeLog.length }}건</span>
        <OverflowMenu v-if="canEditHistory && showChangeLogDeleteButton && store.state.changeLog?.length" title="더보기">
          <button class="danger compact-btn" type="button" @click="clearAllChangeLog">전체 삭제</button>
        </OverflowMenu>
      </div>
    </div>
    <p class="muted settings-group-hint">
      재배동·시설장비·묘목·작업·문제·재고·사용법·방제이력의 추가·수정·삭제 및 입출고 기록입니다. 최근 300건까지 보관됩니다.
      수정·삭제 기록 중 되돌릴 정보가 남아있는 항목은 "되돌리기"로 이전 상태로 복원할 수 있습니다.
    </p>
    <p v-if="revertMessage" class="muted text-sm">{{ revertMessage }}</p>

    <MobileFilterBar :active="historyActiveFilters" :on-reset-all="historyClearAllFilters" title="필터">
      <button
        v-for="entity in historyEntities"
        :key="entity"
        type="button"
        :class="{ ghost: historyEntityFilter !== entity }"
        @click="historyEntityFilter = entity"
      >{{ entity }}</button>
    </MobileFilterBar>

    <ul v-if="filteredChangeLog.length" class="list clean compact history-list">
      <li v-for="entry in filteredChangeLog" :key="entry.id" class="list-item">
        <div class="history-item">
          <span class="pill">{{ entry.entity }}</span>
          <span class="history-badge" :class="historyActionClass(entry.action)">{{ historyActionLabel(entry.action) }}</span>
          <span class="history-name">{{ entry.name }}</span>
          <span class="muted history-meta">
            {{ formatHistoryAt(entry.at) }}<template v-if="entry.actor"> · {{ entry.actor }}</template>
          </span>
          <button
            v-if="canEditHistory && canRevertEntry(entry)"
            class="ghost compact-btn"
            type="button"
            :disabled="revertingId === entry.id"
            title="이 변경을 되돌리기"
            @click="revertHistoryEntry(entry)"
          >{{ revertingId === entry.id ? '되돌리는 중...' : '되돌리기' }}</button>
          <button
            v-if="canEditHistory && showChangeLogDeleteButton"
            class="ghost compact-btn history-delete-btn"
            type="button"
            title="이 항목 삭제"
            @click="removeChangeLogEntry(entry.id)"
          >삭제</button>
        </div>
        <p v-if="entry.detail" class="muted history-detail">{{ entry.detail }}</p>
      </li>
    </ul>
    <p v-else class="muted text-sm">아직 기록된 변경 이력이 없습니다.</p>
  </div>
</template>
