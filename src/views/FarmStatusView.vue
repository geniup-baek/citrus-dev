<script setup>
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { useLocaleStore } from '../stores/localeStore'
import { useFarmMembersStore } from '../stores/farmMembersStore'
import FacilitiesPanel from '../components/FacilitiesPanel.vue'
import AncillaryPanel from '../components/AncillaryPanel.vue'
import SeedlingsPanel from '../components/SeedlingsPanel.vue'
import InventoryPanel from '../components/InventoryPanel.vue'
import UsageGuidePanel from '../components/UsageGuidePanel.vue'

const localeStore = useLocaleStore()
const route = useRoute()
const farmMembersStore = useFarmMembersStore()

// 탭 키 -> 권한 도메인 키(대부분 같지만 ancillary만 ancillaries로 다르다).
const TAB_DOMAINS = {
  facilities: 'facilities', ancillary: 'ancillaries', seedlings: 'seedlings',
  inventory: 'inventory', usageGuides: 'usageGuides',
}
const TAB_KEYS = Object.keys(TAB_DOMAINS)
const readableTabs = () => TAB_KEYS.filter((key) => farmMembersStore.canRead(TAB_DOMAINS[key]))

const initialTab = TAB_KEYS.includes(route.query.tab) ? route.query.tab : 'facilities'
const activeTab = ref(farmMembersStore.canRead(TAB_DOMAINS[initialTab]) ? initialTab : (readableTabs()[0] || initialTab))

// 재배동 목록에서 '묘목 보기'를 선택하면 묘목 탭으로 이동해 해당 재배동으로 필터링한다.
// 묘목 읽기 권한이 없으면 그 버튼 자체가 안 뜨지만(FacilitiesPanel.vue), 여기서도
// 한 번 더 막아 둔다 — 탭 버튼(위 tab-bar)의 canRead 게이팅과 항상 같은 결론이어야 한다.
const pendingGreenhouseId = ref('')
function viewSeedlingsFor(greenhouseId) {
  if (!farmMembersStore.canRead('seedlings')) return
  pendingGreenhouseId.value = greenhouseId
  activeTab.value = 'seedlings'
}
</script>

<template>
  <div class="card farm-status-view">
    <div class="view-header">
      <h2>{{ localeStore.t('nav.farmStatus') }}</h2>
      <p class="subtitle">재배동·시설장비·묘목·비료 재고를 한 곳에서 관리합니다.</p>
    </div>

    <div class="tab-bar">
      <button v-if="farmMembersStore.canRead('facilities')" class="tab-btn" :class="{ active: activeTab === 'facilities' }" @click="activeTab = 'facilities'">{{ localeStore.t('nav.facilities') }}</button>
      <button v-if="farmMembersStore.canRead('ancillaries')" class="tab-btn" :class="{ active: activeTab === 'ancillary' }" @click="activeTab = 'ancillary'">{{ localeStore.t('nav.ancillary') }}</button>
      <button v-if="farmMembersStore.canRead('seedlings')" class="tab-btn" :class="{ active: activeTab === 'seedlings' }" @click="activeTab = 'seedlings'">{{ localeStore.t('nav.seedlings') }}</button>
      <button v-if="farmMembersStore.canRead('inventory')" class="tab-btn" :class="{ active: activeTab === 'inventory' }" @click="activeTab = 'inventory'">{{ localeStore.t('nav.inventory') }}</button>
      <button v-if="farmMembersStore.canRead('usageGuides')" class="tab-btn" :class="{ active: activeTab === 'usageGuides' }" @click="activeTab = 'usageGuides'">{{ localeStore.t('nav.usageGuides') }}</button>
    </div>

    <FacilitiesPanel v-if="activeTab === 'facilities'" @view-seedlings="viewSeedlingsFor" />
    <AncillaryPanel v-if="activeTab === 'ancillary'" />
    <SeedlingsPanel v-if="activeTab === 'seedlings'" :initial-greenhouse-id="pendingGreenhouseId" />
    <InventoryPanel v-if="activeTab === 'inventory'" />
    <UsageGuidePanel v-if="activeTab === 'usageGuides'" />
  </div>
</template>

<style scoped>
.farm-status-view .view-header { margin-bottom: 1rem; }
.farm-status-view .subtitle { margin: 0.2rem 0 0; font-size: 0.8rem; color: var(--muted); }
</style>
