<script setup>
import { ref } from 'vue'
import { useFarmsStore } from '../stores/farmsStore'
import { useAuthStore } from '../stores/authStore'

const farmsStore = useFarmsStore()
const authStore = useAuthStore()

// 이 화면은 로그인된 상태에서만 뜬다(App.vue가 로그인 여부를 먼저 가른다). 농장은
// 클릭하면 바로 들어간다 — 공개 농장이 없어지면서 농장 PIN도 같이 없앴다(관리자
// 모드 진입 PIN만 남는다, 아래).
function handleFarmClick(farm) {
  farmsStore.selectFarm(farm.id)
}

// 시스템 관리 PIN은 화면에서 설정하지 않는다 — 개발 머신의 .env.local(VITE_ADMIN_PIN)
// 또는 배포 시 GitHub Actions secret으로만 지정한다. 비어 있으면 PIN 없이 바로 진입한다.
const ADMIN_PIN = import.meta.env.VITE_ADMIN_PIN || ''
// PIN은 실제 인증이 아니라 실수로 관리 모드에 들어가는 것을 막는 가벼운 2차 확인이다
// (진짜 인증은 슈퍼관리자 로그인 — 아래 handleAdminClick).
const showAdminPinPrompt = ref(false)
const pinInput = ref('')
const pinError = ref('')

function resetPinPrompt() {
  showAdminPinPrompt.value = false
  pinInput.value = ''
  pinError.value = ''
}

const PIN_MAX_LENGTH = 6

function onPinInput() {
  pinError.value = ''
  if (pinInput.value === ADMIN_PIN) {
    farmsStore.enterAdminMode()
    return
  }
  if (pinInput.value.length >= PIN_MAX_LENGTH) {
    pinError.value = 'PIN이 올바르지 않습니다.'
    pinInput.value = ''
  }
}

const adminAccessError = ref('')

function handleAdminClick() {
  adminAccessError.value = ''
  // 시스템 관리는 전체 농장(다른 사람 소유 포함)을 다루므로 슈퍼관리자 로그인이
  // 먼저 필요하다 — PIN은 그 위에 얹는 2차 확인일 뿐, PIN만으로는 못 들어간다.
  if (!authStore.isSuperAdmin) {
    adminAccessError.value = '시스템 관리는 슈퍼관리자 계정으로 로그인해야 들어갈 수 있습니다.'
    return
  }
  if (!ADMIN_PIN) {
    farmsStore.enterAdminMode()
    return
  }
  showAdminPinPrompt.value = true
  pinInput.value = ''
  pinError.value = ''
}

async function handleLogout() {
  await authStore.signOutUser()
}

</script>

<template>
  <div class="farm-gate">
    <div class="card farm-gate-card">
      <template v-if="showAdminPinPrompt">
        <h2>시스템 관리</h2>
        <p class="muted">PIN이 설정되어 있습니다. PIN을 입력하세요.</p>
        <div class="stack-form">
          <label>PIN
            <input
              v-model="pinInput"
              type="password"
              inputmode="numeric"
              :maxlength="PIN_MAX_LENGTH"
              autofocus
              placeholder="PIN 입력"
              @input="onPinInput"
            />
          </label>
          <p v-if="pinError" class="settings-error">{{ pinError }}</p>
          <div class="row-actions">
            <button class="ghost" type="button" @click="resetPinPrompt">취소</button>
          </div>
        </div>
      </template>

      <template v-else>
        <h2>{{ farmsStore.noFarmAccess ? '농장이 없습니다' : '농장 선택' }}</h2>
        <p v-if="farmsStore.farms.length" class="muted">작업할 농장을 선택하세요. 농장마다 재배동·작업·재고·방제이력이 독립적으로 관리됩니다.</p>

        <ul v-if="farmsStore.farms.length" class="list clean farm-select-grid">
          <li
            v-for="farm in farmsStore.farms"
            :key="farm.id"
            class="list-item card-like farm-select-item"
            @click="handleFarmClick(farm)"
          >
            <span class="farm-logo" :class="{ 'farm-logo-empty': !farm.logo }">
              <img v-if="farm.logo" :src="farm.logo" alt="" />
              <span v-else>{{ farm.name?.[0] ?? '?' }}</span>
            </span>
            <span class="item-title">{{ farm.name }}</span>
            <span v-if="farm.ownerUid && farm.ownerUid === authStore.user?.uid" class="pill">농장주</span>
          </li>
        </ul>
        <p v-else class="muted">
          이 계정({{ authStore.user?.email }})으로 접근할 수 있는 농장이 없습니다. 슈퍼관리자나
          농장주에게 이 이메일로 농장 소유주 지정 또는 초대를 요청하세요.
        </p>

        <div class="row-actions farm-auth-entry">
          <span class="muted text-sm">로그인됨: {{ authStore.user?.email }}</span>
          <button class="ghost compact-btn" type="button" @click="handleLogout">로그아웃</button>
        </div>

        <div v-if="authStore.isSuperAdmin" class="farm-admin-entry">
          <button class="ghost" type="button" @click="handleAdminClick">시스템 관리</button>
          <p class="muted text-sm">농장 등록·관리, 병해충·농약 공통 정보 갱신, 분류·항목 설정, 전체 농장 백업/복원을 관리합니다.</p>
          <p v-if="adminAccessError" class="settings-error">{{ adminAccessError }}</p>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.farm-select-grid {
  margin: 1rem 0;
  gap: 0.5rem;
}
.farm-select-item {
  display: flex;
  cursor: pointer;
  align-items: center;
  gap: 0.75rem;
}
.farm-select-item:hover {
  background: var(--surface-strong);
}
.farm-admin-entry {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--line);
}
.farm-auth-entry {
  margin-top: 1rem;
  align-items: center;
}
</style>
