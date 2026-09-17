<script setup>
// 계절 작업 템플릿 목록 — TasksView.vue 우측 패널의 "계절 작업" 탭.
// annualTaskTemplates(앱 고정 데이터)를 계절별로 나눠 보여주고 "만들기"를 누르면 작업으로
// 추가한다. 부모의 작업 목록/캘린더/상세 선택 상태와는 무관해 별도 컴포넌트로 뗄 수 있었다
// — 단, 추가 후 "왼쪽 보드를 연간 필터로 전환"하는 것만 부모 소관이라 이벤트로 알린다.
import { ref, computed } from 'vue'
import { useFarmStore } from '../stores/farmStore'
import { useLocaleStore } from '../stores/localeStore'
import { useFarmMembersStore } from '../stores/farmMembersStore'

const store = useFarmStore()
const localeStore = useLocaleStore()
const farmMembersStore = useFarmMembersStore()
const emit = defineEmits(['created'])

const SEASONS = [
  { key: 'winter',   label: localeStore.t('tasks.seasonWinter'),   months: [12, 1, 2] },
  { key: 'spring',   label: localeStore.t('tasks.seasonSpring'),   months: [3, 4, 5] },
  { key: 'earlySum', label: localeStore.t('tasks.seasonEarlySum'), months: [6, 7] },
  { key: 'sumFall',  label: localeStore.t('tasks.seasonSumFall'),  months: [8, 9, 10, 11] },
]

const templatesBySeason = computed(() =>
  SEASONS.map((s) => ({
    ...s,
    templates: (store.state.annualTaskTemplates || [])
      .filter((t) => s.months.includes(t.recommendedMonth))
      .sort((a, b) => {
        const order = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
        return order.indexOf(a.recommendedMonth) - order.indexOf(b.recommendedMonth)
      }),
  })),
)

const templateResult = ref('')

async function createFromTemplate(tpl) {
  await store.createTaskFromTemplate(tpl.id)
  templateResult.value = `'${tpl.title}' 작업이 추가됐습니다. 왼쪽 보드의 '연간' 필터에서 확인하세요.`
  emit('created', tpl)
}
</script>

<template>
  <p class="muted text-sm" style="margin-bottom: 0.75rem;">{{ localeStore.t('tasks.templateDesc') }}</p>

  <div v-for="season in templatesBySeason" :key="season.key" class="season-group">
    <p v-if="season.templates.length" class="season-label">{{ season.label }}</p>
    <ul v-if="season.templates.length" class="list clean">
      <li v-for="tpl in season.templates" :key="tpl.id" class="list-item card-like">
        <div>
          <div class="row-actions" style="gap: 0.35rem; margin-bottom: 0.2rem;">
            <p class="item-title" style="font-size: 0.92rem; margin: 0;">{{ tpl.title }}</p>
            <span class="pill text-xs" style="padding: 0.1rem 0.5rem;">{{ tpl.category }}</span>
          </div>
          <p class="item-meta text-sm">{{ tpl.recommendedMonth }}월 · {{ tpl.notes }}</p>
        </div>
        <button v-if="farmMembersStore.canWrite('tasks')" class="ghost" type="button" style="white-space: nowrap; flex-shrink: 0;" @click="createFromTemplate(tpl)">
          {{ localeStore.t('tasks.create') }}
        </button>
      </li>
    </ul>
  </div>

  <p v-if="templateResult" class="muted text-sm" style="margin-top: 0.5rem;">{{ templateResult }}</p>
</template>
