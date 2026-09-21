<script setup>
import { onBeforeUnmount, onMounted, watch } from 'vue'
import AppHeader from './components/AppHeader.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import FarmSelectScreen from './components/FarmSelectScreen.vue'
import { useFarmStore } from './stores/farmStore'
import { useLocaleStore } from './stores/localeStore'
import { useTreatmentStore } from './stores/treatmentStore'
import { useAvailablePesticideStore } from './stores/availablePesticideStore'
import { useRecommendSettingsStore } from './stores/recommendSettingsStore'
import { useFarmsStore } from './stores/farmsStore'
import { useFarmMembersStore } from './stores/farmMembersStore'
import { useAppPolicyStore } from './stores/appPolicyStore'
import { useAuthStore } from './stores/authStore'
import { useTaskNotifier } from './composables/useTaskNotifier'

const store = useFarmStore()
const localeStore = useLocaleStore()
const treatStore = useTreatmentStore()
const apStore = useAvailablePesticideStore()
const recSettingsStore = useRecommendSettingsStore()
const farmsStore = useFarmsStore()
const farmMembersStore = useFarmMembersStore()
const policyStore = useAppPolicyStore()
const authStore = useAuthStore()

onMounted(() => {
  farmsStore.init()
  // 전 기기 공통 정책은 농장 선택과 무관하므로 관리 모드에서도 바로 동기화한다.
  policyStore.init()
  // 분류·항목(appSettings)도 모든 농장이 공유하므로 관리 모드에서도 실시간 데이터를 읽어야 한다.
  store.initAppSettings()
  // 로그인 상태도 농장 선택과 무관하게 앱 시작 시 한 번 구독한다.
  authStore.init()
})

// 활성 농장이 (비동기로) 정해지는 시점에 딱 한 번 농장별 데이터 스토어를 초기화한다.
// 농장 전환은 앱 새로고침으로 처리하므로 세션 중 activeFarm.id가 다시 바뀌는 일은 없다.
watch(
  () => farmsStore.activeFarm?.id,
  (farmId) => {
    if (!farmId) return
    // farmMembersStore를 먼저 초기화해야 한다 — 아래 스토어들이 도메인별 구독
    // 여부를 결정할 때 farmMembersStore.canRead()/ready()를 참조한다.
    farmMembersStore.init(farmId, farmsStore.activeFarm)
    store.init(farmId)
    treatStore.init(farmId)
    apStore.init(farmId)
    recSettingsStore.init(farmId)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  store.cleanup()
})

useTaskNotifier(store)
</script>

<template>
  <div class="app-shell">
    <p v-if="farmsStore.loading" class="muted farm-gate-loading">불러오는 중...</p>

    <div v-else-if="farmsStore.accessError" class="farm-gate">
      <div class="card farm-gate-card">
        <h2>접근 권한이 바뀌었습니다</h2>
        <p class="muted">
          로그인 상태가 바뀌었거나 농장 접근 권한이 바뀌어 데이터를 계속 불러올 수 없습니다.
          새로고침하면 최신 상태로 다시 시작합니다.
        </p>
        <button type="button" @click="() => window.location.reload()">새로고침</button>
      </div>
    </div>

    <FarmSelectScreen v-else-if="farmsStore.needsFarmCreate || farmsStore.needsFarmSelect" />

    <template v-else>
      <AppHeader />

      <p v-if="!store.firebaseEnabled" class="sync-banner">
        {{ localeStore.t('app.syncDisabled') }}
      </p>

      <main class="content">
        <RouterView />
      </main>

      <ConfirmDialog />
    </template>
  </div>
</template>
