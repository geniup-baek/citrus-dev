<script setup>
import { ref } from 'vue'
import { useFarmsStore } from '../stores/farmsStore'
import { useAuthStore } from '../stores/authStore'

const farmsStore = useFarmsStore()
const authStore = useAuthStore()

// 시스템 관리 PIN은 화면에서 설정하지 않는다 — 개발 머신의 .env.local(VITE_ADMIN_PIN)
// 또는 배포 시 GitHub Actions secret으로만 지정한다. 비어 있으면 PIN 없이 바로 진입한다.
const ADMIN_PIN = import.meta.env.VITE_ADMIN_PIN || ''

// PIN은 실제 인증이 아니라 실수로 다른 농장/관리 모드에 들어가는 것을 막는 가벼운
// 확인 절차다(이 앱은 로그인 없이 모두가 같은 Firestore를 공유한다).
const pinPromptType = ref(null) // null | 'farm' | 'admin'
const pinPromptFarm = ref(null) // pinPromptType === 'farm'일 때만 사용
const pinInput = ref('')
const pinError = ref('')

function resetPinPrompt() {
  pinPromptType.value = null
  pinPromptFarm.value = null
  pinInput.value = ''
  pinError.value = ''
}

function handleFarmClick(farm) {
  if (!farm.pin) {
    farmsStore.selectFarm(farm.id)
    return
  }
  pinPromptType.value = 'farm'
  pinPromptFarm.value = farm
  pinInput.value = ''
  pinError.value = ''
}

function handleAdminClick() {
  if (!ADMIN_PIN) {
    farmsStore.enterAdminMode()
    return
  }
  pinPromptType.value = 'admin'
  pinPromptFarm.value = null
  pinInput.value = ''
  pinError.value = ''
}

const PIN_MAX_LENGTH = 6

function onPinInput() {
  pinError.value = ''
  const expected = pinPromptType.value === 'admin' ? ADMIN_PIN : pinPromptFarm.value?.pin
  if (pinInput.value === expected) {
    if (pinPromptType.value === 'admin') farmsStore.enterAdminMode()
    else farmsStore.selectFarm(pinPromptFarm.value.id)
    return
  }
  if (pinInput.value.length >= PIN_MAX_LENGTH) {
    pinError.value = 'PIN이 올바르지 않습니다.'
    pinInput.value = ''
  }
}

// ── 로그인/가입 ────────────────────────────────────────────────────────────
// 지금은 로그인이 있어도 농장 접근 방식(위 PIN 기반)을 전혀 바꾸지 않는다.
// 로그인은 이후 단계(농장 소유권·권한)를 위한 신원을 미리 만들어 두는 부가
// 기능일 뿐이라, 로그인 여부와 무관하게 농장 목록/시스템 관리는 그대로 쓸 수 있다.
const authMode = ref(null) // null | 'login' | 'signup'
const authEmail = ref('')
const authPassword = ref('')
const authDisplayName = ref('')
const authSubmitting = ref(false)
const authMessage = ref('')

function openAuthForm(mode) {
  authMode.value = mode
  authEmail.value = ''
  authPassword.value = ''
  authDisplayName.value = ''
  authMessage.value = ''
  authStore.error = ''
}

function closeAuthForm() {
  authMode.value = null
}

async function submitAuth() {
  if (authSubmitting.value) return
  authMessage.value = ''
  authSubmitting.value = true
  const ok = authMode.value === 'signup'
    ? await authStore.signUp(authEmail.value.trim(), authPassword.value, authDisplayName.value.trim())
    : await authStore.signIn(authEmail.value.trim(), authPassword.value)
  authSubmitting.value = false
  if (ok) authMode.value = null
}

async function handleLogout() {
  await authStore.signOutUser()
}

async function handleForgotPassword() {
  authMessage.value = ''
  const email = authEmail.value.trim()
  if (!email) {
    authStore.error = '먼저 이메일을 입력해 주세요.'
    return
  }
  const ok = await authStore.resetPassword(email)
  if (ok) authMessage.value = '비밀번호 재설정 메일을 보냈습니다.'
}
</script>

<template>
  <div class="farm-gate">
    <div class="card farm-gate-card">
      <template v-if="pinPromptType">
        <h2>{{ pinPromptType === 'admin' ? '시스템 관리' : pinPromptFarm.name }}</h2>
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

      <template v-else-if="authMode">
        <h2>{{ authMode === 'signup' ? '회원가입' : '로그인' }}</h2>
        <p class="muted">
          {{ authMode === 'signup'
            ? '가입해도 지금 당장 농장 접근 권한이 바뀌지는 않습니다.'
            : '이메일과 비밀번호로 로그인하세요.' }}
        </p>
        <div class="stack-form">
          <label>이메일
            <input v-model="authEmail" type="email" autocomplete="email" autofocus placeholder="you@example.com" />
          </label>
          <label v-if="authMode === 'signup'">표시 이름
            <input v-model="authDisplayName" type="text" autocomplete="name" placeholder="예: 홍길동" />
          </label>
          <label>비밀번호
            <input
              v-model="authPassword"
              type="password"
              :autocomplete="authMode === 'signup' ? 'new-password' : 'current-password'"
              placeholder="6자 이상"
              @keydown.enter.prevent="submitAuth"
            />
          </label>
          <p v-if="authStore.error" class="settings-error">{{ authStore.error }}</p>
          <p v-if="authMessage" class="muted text-sm">{{ authMessage }}</p>
          <div class="row-actions">
            <button type="button" :disabled="authSubmitting" @click="submitAuth">
              {{ authSubmitting ? '처리 중...' : (authMode === 'signup' ? '가입' : '로그인') }}
            </button>
            <button class="ghost" type="button" @click="closeAuthForm">취소</button>
          </div>
          <div class="row-actions">
            <template v-if="authMode === 'signup'">
              <button class="ghost compact-btn" type="button" @click="authMode = 'login'">이미 계정이 있어요</button>
            </template>
            <template v-else>
              <button class="ghost compact-btn" type="button" @click="authMode = 'signup'">회원가입</button>
              <button class="ghost compact-btn" type="button" @click="handleForgotPassword">비밀번호를 잊으셨나요?</button>
            </template>
          </div>
        </div>
      </template>

      <template v-else>
        <h2>농장 선택</h2>
        <p class="muted">작업할 농장을 선택하세요. 농장마다 재배동·작업·재고·방제이력이 독립적으로 관리됩니다.</p>

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
            <span class="item-title">
              {{ farm.name }}
              <span v-if="farm.pin" title="PIN이 설정된 농장">🔒</span>
            </span>
          </li>
        </ul>
        <p v-else class="muted">등록된 농장이 없습니다. 시스템 관리에서 먼저 농장을 등록해 주세요.</p>

        <div class="row-actions farm-auth-entry">
          <template v-if="authStore.isLoggedIn">
            <span class="muted text-sm">로그인됨: {{ authStore.user.email }}</span>
            <button class="ghost compact-btn" type="button" @click="handleLogout">로그아웃</button>
          </template>
          <button v-else class="ghost compact-btn" type="button" @click="openAuthForm('login')">로그인</button>
        </div>

        <div class="farm-admin-entry">
          <button class="ghost" type="button" @click="handleAdminClick">시스템 관리</button>
          <p class="muted text-sm">농장 등록·관리, 병해충·농약 공통 정보 갱신, 분류·항목 설정, 전체 농장 백업/복원을 관리합니다.</p>
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
