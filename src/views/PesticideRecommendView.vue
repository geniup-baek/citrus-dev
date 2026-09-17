<script setup>
import { ref } from 'vue'
import { useFarmMembersStore } from '../stores/farmMembersStore'
import PesticideInventoryPanel from '../components/PesticideInventoryPanel.vue'
import TreatmentHistoryPanel from '../components/TreatmentHistoryPanel.vue'
import AvailablePesticidePanel from '../components/AvailablePesticidePanel.vue'
import RecommendSettingsPanel from '../components/RecommendSettingsPanel.vue'
import PesticideRecommendationPanel from '../components/PesticideRecommendationPanel.vue'

const farmMembersStore = useFarmMembersStore()

// 탭 키 -> 권한 도메인 키. avail/settings(가용농약·추천설정 문서)는 별도 토글 없이
// treatments 권한을 따른다(farmAccess.js의 domainKeyFor와 동일한 매핑).
const TAB_DOMAINS = {
  peststock: 'inventory', history: 'treatments', avail: 'treatments',
  settings: 'treatments', recommend: 'treatments',
}
const TAB_KEYS = Object.keys(TAB_DOMAINS)

// 탭 순서와 맞춰 농약재고를 기본으로 연다. 각 탭은 서로 다른 스토어(treatStore/apStore/
// settingsStore)를 쓰는 독립된 기능이라 컴포넌트로 나눴다 — FarmStatusView.vue/
// ResourcesView.vue와 같은 얇은 탭 껍데기 패턴.
const firstReadableTab = TAB_KEYS.find((key) => farmMembersStore.canRead(TAB_DOMAINS[key]))
const activeTab = ref(farmMembersStore.canRead('inventory') ? 'peststock' : (firstReadableTab || 'peststock'))
</script>

<template>
  <div class="card recommend-view">
    <div class="view-header">
      <h2>방제 관리</h2>
      <p class="subtitle">방제 이력 기록부터 농약재고·가용농약 관리, 작용기작 중복 방지 추천까지 한 곳에서 관리합니다.</p>
    </div>

    <div class="tab-bar">
      <button v-if="farmMembersStore.canRead('inventory')" class="tab-btn" :class="{ active: activeTab === 'peststock' }" @click="activeTab = 'peststock'">농약재고</button>
      <button v-if="farmMembersStore.canRead('treatments')" class="tab-btn" :class="{ active: activeTab === 'history' }"   @click="activeTab = 'history'">방제 이력</button>
      <button v-if="farmMembersStore.canRead('treatments')" class="tab-btn" :class="{ active: activeTab === 'avail' }"     @click="activeTab = 'avail'">가용농약</button>
      <button v-if="farmMembersStore.canRead('treatments')" class="tab-btn" :class="{ active: activeTab === 'settings' }"  @click="activeTab = 'settings'">추천 설정</button>
      <button v-if="farmMembersStore.canRead('treatments')" class="tab-btn" :class="{ active: activeTab === 'recommend' }" @click="activeTab = 'recommend'">농약 추천</button>
    </div>

    <PesticideInventoryPanel v-if="activeTab === 'peststock'" />
    <section v-if="activeTab === 'history'"><TreatmentHistoryPanel /></section>
    <section v-if="activeTab === 'recommend'"><PesticideRecommendationPanel /></section>
    <AvailablePesticidePanel v-if="activeTab === 'avail'" />
    <section v-if="activeTab === 'settings'"><RecommendSettingsPanel /></section>
  </div>
</template>

<style scoped>
.view-header { margin-bottom: 1.25rem; }
.subtitle { margin: 0.2rem 0 0; font-size: 0.8rem; color: var(--muted); }
</style>
