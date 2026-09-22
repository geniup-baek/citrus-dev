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

// 농장 모드에서는 저장·백업 탭만 사용할 수 있다(농장/분류·항목/동작은 시스템 관리 모드 전용).
const activeTab = ref(farmsStore.isAdminMode ? 'categories' : 'storage')
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
        <button class="tab-btn" :class="{ active: activeTab === 'behavior' }" type="button" @click="activeTab = 'behavior'">동작</button>
        <button class="tab-btn" :class="{ active: activeTab === 'storage' }" type="button" @click="activeTab = 'storage'">저장·백업</button>
        <button v-if="!farmsStore.isAdminMode" class="tab-btn" :class="{ active: activeTab === 'history' }" type="button" @click="activeTab = 'history'">변경 이력</button>
      </div>

      <template v-if="farmsStore.isAdminMode && activeTab === 'farm'"><FarmManagementPanel /></template>
      <template v-if="farmsStore.isAdminMode && activeTab === 'users'"><UserManagementPanel /></template>
      <template v-if="farmsStore.isAdminMode && activeTab === 'categories'"><CategorySettingsPanel /></template>
      <template v-if="canManageMembers && activeTab === 'members'"><FarmMembersPanel /></template>
      <template v-if="authStore.isLoggedIn && activeTab === 'account'"><AccountSettingsPanel /></template>
      <template v-if="activeTab === 'behavior'"><BehaviorSettingsPanel /></template>
      <template v-if="activeTab === 'storage'"><StorageBackupPanel /></template>
      <template v-if="!farmsStore.isAdminMode && activeTab === 'history'"><ChangeHistoryPanel /></template>
    </div>
  </section>
</template>
