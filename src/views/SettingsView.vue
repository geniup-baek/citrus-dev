<script setup>
import { computed, ref } from 'vue'
import { useLocaleStore } from '../stores/localeStore'
import { useFarmsStore } from '../stores/farmsStore'
import { useFarmMembersStore } from '../stores/farmMembersStore'
import { useAuthStore } from '../stores/authStore'
import FarmManagementPanel from '../components/FarmManagementPanel.vue'
import CategorySettingsPanel from '../components/CategorySettingsPanel.vue'
import BehaviorSettingsPanel from '../components/BehaviorSettingsPanel.vue'
import StorageBackupPanel from '../components/StorageBackupPanel.vue'
import ChangeHistoryPanel from '../components/ChangeHistoryPanel.vue'
import FarmMembersPanel from '../components/FarmMembersPanel.vue'
import UserManagementPanel from '../components/UserManagementPanel.vue'
import AccountSettingsPanel from '../components/AccountSettingsPanel.vue'

const localeStore = useLocaleStore()
const farmsStore = useFarmsStore()
const farmMembersStore = useFarmMembersStore()
const authStore = useAuthStore()

// 구성원 관리는 농장 모드에서, 그 농장의 소유자이거나 슈퍼관리자일 때만 볼 수 있다.
const canManageMembers = computed(() =>
  !farmsStore.isAdminMode && (farmMembersStore.isOwnerOfActiveFarm || authStore.isSuperAdmin))

// 동작·저장백업·변경 이력 탭은 시스템 관리 모드(슈퍼관리자)이거나, 농장 모드에서 소유자·권한을 받은
// 구성원일 때만 보인다(farmMembersStore.canUse). 농장/사용자/분류·항목은 시스템 관리 모드 전용.
const showBehavior = computed(() => farmsStore.isAdminMode || farmMembersStore.canUse('behavior'))
const showStorage = computed(() => farmsStore.isAdminMode || farmMembersStore.canUse('backup'))
const showHistory = computed(() => !farmsStore.isAdminMode && farmMembersStore.canUse('changeLog'))
const firstTab = () => {
  if (farmsStore.isAdminMode) return 'categories'
  if (showStorage.value) return 'storage'
  if (showHistory.value) return 'history'
  if (showBehavior.value) return 'behavior'
  return 'account'
}
const activeTab = ref(firstTab())
</script>

<template>
  <section class="page-grid">
    <div class="card">
      <h2>{{ localeStore.t('settings.title') }}</h2>

      <div class="tab-bar">
        <template v-if="farmsStore.isAdminMode">
          <button class="tab-btn" :class="{ active: activeTab === 'farm' }" type="button" @click="activeTab = 'farm'">농장</button>
          <button class="tab-btn" :class="{ active: activeTab === 'users' }" type="button" @click="activeTab = 'users'">사용자</button>
          <button class="tab-btn" :class="{ active: activeTab === 'categories' }" type="button" @click="activeTab = 'categories'">분류·항목</button>
        </template>
        <button v-if="canManageMembers" class="tab-btn" :class="{ active: activeTab === 'members' }" type="button" @click="activeTab = 'members'">구성원</button>
        <button v-if="authStore.isLoggedIn" class="tab-btn" :class="{ active: activeTab === 'account' }" type="button" @click="activeTab = 'account'">계정</button>
        <button v-if="showBehavior" class="tab-btn" :class="{ active: activeTab === 'behavior' }" type="button" @click="activeTab = 'behavior'">동작</button>
        <button v-if="showStorage" class="tab-btn" :class="{ active: activeTab === 'storage' }" type="button" @click="activeTab = 'storage'">저장·백업</button>
        <button v-if="showHistory" class="tab-btn" :class="{ active: activeTab === 'history' }" type="button" @click="activeTab = 'history'">변경 이력</button>
      </div>

      <template v-if="farmsStore.isAdminMode && activeTab === 'farm'"><FarmManagementPanel /></template>
      <template v-if="farmsStore.isAdminMode && activeTab === 'users'"><UserManagementPanel /></template>
      <template v-if="farmsStore.isAdminMode && activeTab === 'categories'"><CategorySettingsPanel /></template>
      <template v-if="canManageMembers && activeTab === 'members'"><FarmMembersPanel /></template>
      <template v-if="authStore.isLoggedIn && activeTab === 'account'"><AccountSettingsPanel /></template>
      <template v-if="showBehavior && activeTab === 'behavior'"><BehaviorSettingsPanel /></template>
      <template v-if="showStorage && activeTab === 'storage'"><StorageBackupPanel /></template>
      <template v-if="showHistory && activeTab === 'history'"><ChangeHistoryPanel /></template>
    </div>
  </section>
</template>
