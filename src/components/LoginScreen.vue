<script setup>
import { ref } from 'vue'
import { useAuthStore } from '../stores/authStore'

const authStore = useAuthStore()

// 로그인해야만 앱을 쓸 수 있다 — 로그인 안 된 상태에서 뜨는 유일한 화면.
const authMode = ref('login') // 'login' | 'signup'
const authEmail = ref('')
const authPassword = ref('')
const authDisplayName = ref('')
const authSubmitting = ref(false)
const authMessage = ref('')

function switchMode(mode) {
  authMode.value = mode
  authMessage.value = ''
  authStore.error = ''
}

async function submitAuth() {
  if (authSubmitting.value) return
  authMessage.value = ''
  authSubmitting.value = true
  const ok = authMode.value === 'signup'
    ? await authStore.signUp(authEmail.value.trim(), authPassword.value, authDisplayName.value.trim())
    : await authStore.signIn(authEmail.value.trim(), authPassword.value)
  authSubmitting.value = false
  if (ok) {
    authEmail.value = ''
    authPassword.value = ''
    authDisplayName.value = ''
  }
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
      <h2>{{ authMode === 'signup' ? '회원가입' : '로그인' }}</h2>
      <p class="muted">로그인해야 농장을 사용할 수 있습니다.</p>
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
        </div>
        <div class="row-actions">
          <template v-if="authMode === 'signup'">
            <button class="ghost compact-btn" type="button" @click="switchMode('login')">이미 계정이 있어요</button>
          </template>
          <template v-else>
            <button class="ghost compact-btn" type="button" @click="switchMode('signup')">회원가입</button>
            <button class="ghost compact-btn" type="button" @click="handleForgotPassword">비밀번호를 잊으셨나요?</button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
