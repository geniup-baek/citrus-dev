<script setup>
// 반복 작업 규칙 관리 — TasksView.vue 우측 패널의 "반복 규칙" 서브탭.
// 목록(scheduleRules)·폼 상태·CRUD가 전부 이 안에서 끝나고 부모 화면의 선택/상세 상태와는
// 얽히지 않아(작업 목록·캘린더·상세 패널과 무관) 별도 컴포넌트로 뗄 수 있었다.
import { reactive, ref, computed } from 'vue'
import { format } from 'date-fns'
import { useFarmStore } from '../stores/farmStore'
import { useLocaleStore } from '../stores/localeStore'
import { useFarmMembersStore } from '../stores/farmMembersStore'
import { confirm } from '../composables/useConfirm'

const store = useFarmStore()
const localeStore = useLocaleStore()
const farmMembersStore = useFarmMembersStore()

const taskCategories = computed(() => store.state.appSettings?.taskCategories ?? ['기타'])
const scheduleRules = computed(() => store.state.scheduleRules)

const weekdayOptions = computed(() => [
  { label: localeStore.t('tasks.monday'), value: 1 },
  { label: localeStore.t('tasks.tuesday'), value: 2 },
  { label: localeStore.t('tasks.wednesday'), value: 3 },
  { label: localeStore.t('tasks.thursday'), value: 4 },
  { label: localeStore.t('tasks.friday'), value: 5 },
  { label: localeStore.t('tasks.saturday'), value: 6 },
  { label: localeStore.t('tasks.sunday'), value: 7 },
])

const FREQUENCY_UNIT = { 매일: '일', 매주: '주', 매월: '개월' }

const schedulerForm = reactive({
  id: '',
  title: '',
  category: '',
  frequency: '매주',
  interval: 1,
  dayOfWeek: 1,
  dayOfMonth: 1,
  startDate: '',
  endDate: '',
  enabled: true,
})
const schedulerEditingId = ref('')

const intervalUnit = computed(() => FREQUENCY_UNIT[schedulerForm.frequency] || '일')

function weekdayLabel(value) {
  return weekdayOptions.value.find((d) => d.value === value)?.label || value
}

// 주기가 1이면 "매일/매주/매월" 그대로, 2 이상이면 "N일마다" 식으로 표시한다.
function frequencyLabel(rule) {
  const unit = FREQUENCY_UNIT[rule.frequency] || ''
  const interval = Math.max(1, Number(rule.interval) || 1)
  return interval > 1 ? `${interval}${unit}마다` : rule.frequency
}

function clearSchedulerForm() {
  schedulerForm.id = ''
  schedulerForm.title = ''
  schedulerForm.category = taskCategories.value[0] ?? ''
  schedulerForm.frequency = '매주'
  schedulerForm.interval = 1
  schedulerForm.dayOfWeek = 1
  schedulerForm.dayOfMonth = 1
  schedulerForm.startDate = format(new Date(), 'yyyy-MM-dd')
  schedulerForm.endDate = ''
  schedulerForm.enabled = true
  schedulerEditingId.value = ''
}

function editSchedulerRule(rule) {
  schedulerForm.id = rule.id
  schedulerForm.title = rule.title
  schedulerForm.category = rule.category
  schedulerForm.frequency = rule.frequency
  schedulerForm.interval = rule.interval
  schedulerForm.dayOfWeek = rule.dayOfWeek
  schedulerForm.dayOfMonth = rule.dayOfMonth
  schedulerForm.startDate = rule.startDate
  schedulerForm.endDate = rule.endDate || ''
  schedulerForm.enabled = rule.enabled !== false
  schedulerEditingId.value = rule.id
}

async function saveScheduleRule() {
  await store.upsertScheduleRule({
    id: schedulerForm.id,
    title: schedulerForm.title,
    category: schedulerForm.category,
    frequency: schedulerForm.frequency,
    interval: Number(schedulerForm.interval),
    dayOfWeek: Number(schedulerForm.dayOfWeek),
    dayOfMonth: Number(schedulerForm.dayOfMonth),
    startDate: schedulerForm.startDate,
    endDate: schedulerForm.endDate,
    enabled: schedulerForm.enabled,
  })
  clearSchedulerForm()
  await store.runTaskScheduler({
    daysAhead: store.state.scheduleSettings?.generationDays ?? 21,
    duplicatePolicy: store.state.scheduleSettings?.duplicatePolicy ?? 'rule-and-date',
    persist: true,
  })
}

async function confirmDeleteScheduleRule(rule) {
  const ok = await confirm({ message: localeStore.t('confirm.scheduleRule', { title: rule.title }) })
  if (ok) await removeScheduleRule(rule.id)
}

async function removeScheduleRule(id) {
  await store.removeScheduleRule(id)
  if (schedulerEditingId.value === id) clearSchedulerForm()
  await store.runTaskScheduler({
    daysAhead: store.state.scheduleSettings?.generationDays ?? 21,
    duplicatePolicy: store.state.scheduleSettings?.duplicatePolicy ?? 'rule-and-date',
    persist: true,
  })
}

clearSchedulerForm()
</script>

<template>
  <p class="muted text-sm" style="margin-bottom: 0.75rem;">{{ localeStore.t('tasks.ruleDesc') }}</p>

  <!-- 등록된 규칙 목록 -->
  <ul class="list clean compact" style="margin-bottom: 1rem;">
    <li v-for="rule in scheduleRules" :key="rule.id" class="list-item card-like">
      <div>
        <p class="item-title" style="font-size: 0.9rem;">
          <span v-if="!rule.enabled" class="pill text-xs" style="margin-right: 0.3rem;">{{ localeStore.t('tasks.ruleDisabled') }}</span>
          {{ rule.title }}
        </p>
        <p class="item-meta">
          {{ rule.category }} · {{ frequencyLabel(rule) }}
          <template v-if="rule.frequency === '매주'">({{ weekdayLabel(rule.dayOfWeek) }}요일)</template>
          <template v-if="rule.frequency === '매월'">(매월 {{ rule.dayOfMonth }}일)</template>
        </p>
        <p class="muted text-sm">{{ rule.startDate }} ~ {{ rule.endDate || localeStore.t('common.ongoing') }}</p>
      </div>
      <div v-if="farmMembersStore.canWrite('tasks')" class="row-actions">
        <button class="ghost" type="button" @click="editSchedulerRule(rule)">{{ localeStore.t('common.edit') }}</button>
        <button class="danger" type="button" @click="confirmDeleteScheduleRule(rule)">{{ localeStore.t('common.delete') }}</button>
      </div>
    </li>
    <li v-if="!scheduleRules.length" class="muted text-sm">{{ localeStore.t('tasks.noRules') }}</li>
  </ul>

  <!-- 규칙 추가/편집 폼 -->
  <template v-if="farmMembersStore.canWrite('tasks')">
  <h3 class="section-title">{{ schedulerEditingId ? localeStore.t('tasks.updateRule') : localeStore.t('tasks.saveRule') }}</h3>
  <form class="stack-form" @submit.prevent="saveScheduleRule">
    <label>{{ localeStore.t('tasks.ruleTitle') }}
      <input v-model="schedulerForm.title" required type="text" :placeholder="localeStore.t('tasks.ruleTitlePlaceholder')" />
    </label>
    <label>{{ localeStore.t('tasks.category') }}
      <select v-model="schedulerForm.category">
        <option v-for="c in taskCategories" :key="c" :value="c">{{ c }}</option>
      </select>
    </label>
    <div class="row-scheduler-grid">
      <label>{{ localeStore.t('tasks.frequency') }}
        <select v-model="schedulerForm.frequency">
          <option value="매일">{{ localeStore.t('tasks.frequencyDaily') }}</option>
          <option value="매주">{{ localeStore.t('tasks.frequencyWeekly') }}</option>
          <option value="매월">{{ localeStore.t('tasks.frequencyMonthly') }}</option>
        </select>
      </label>
      <label>{{ localeStore.t('tasks.interval') }} ({{ intervalUnit }})
        <input v-model="schedulerForm.interval" min="1" type="number" />
      </label>
      <label v-if="schedulerForm.frequency === '매주'">{{ localeStore.t('tasks.weekday') }}
        <select v-model="schedulerForm.dayOfWeek">
          <option v-for="d in weekdayOptions" :key="d.value" :value="d.value">{{ d.label }}요일</option>
        </select>
      </label>
      <label v-if="schedulerForm.frequency === '매월'">{{ localeStore.t('tasks.dayOfMonth') }}
        <input v-model="schedulerForm.dayOfMonth" min="1" max="31" type="number" />
      </label>
    </div>
    <div class="row-scheduler-grid">
      <label>{{ localeStore.t('tasks.startDate') }}
        <input v-model="schedulerForm.startDate" required type="date" />
      </label>
      <label>{{ localeStore.t('tasks.endDateOptional') }}
        <input v-model="schedulerForm.endDate" type="date" />
      </label>
    </div>
    <label class="inline-checkbox">
      <input v-model="schedulerForm.enabled" type="checkbox" />
      {{ localeStore.t('tasks.enableRule') }}
    </label>
    <div class="row-actions">
      <button type="submit">{{ schedulerEditingId ? localeStore.t('common.change') : localeStore.t('common.add') }}</button>
      <button v-if="schedulerEditingId" class="ghost" type="button" @click="clearSchedulerForm">{{ localeStore.t('common.cancel') }}</button>
    </div>
  </form>
  </template>
</template>
