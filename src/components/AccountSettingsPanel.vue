<script setup>
import { ref } from 'vue'
import { useAuthStore } from '../stores/authStore'

const authStore = useAuthStore()

const currentPassword = ref('')
const newPassword = ref('')
const newPasswordConfirm = ref('')
const message = ref('')
const submitting = ref(false)

async function submit() {
  message.value = ''
  if (newPassword.value.length < 6) {
    message.value = '새 비밀번호는 6자 이상이어야 합니다.'
    return
  }
  if (newPassword.value !== newPasswordConfirm.value) {
    message.value = '새 비밀번호가 서로 다릅니다.'
    return
  }
  submitting.value = true
  const ok = await authStore.changePassword(currentPassword.value, newPassword.value)
  submitting.value = false
  if (ok) {
    message.value = '비밀번호를 변경했습니다.'
    currentPassword.value = ''
    newPassword.value = ''
    newPasswordConfirm.value = ''
  } else {
    message.value = authStore.error || '변경하지 못했습니다.'
  }
}
</script>

<template>
  <div class="sub-card">
    <div class="settings-group-head">
      <h3>계정</h3>
    </div>
    <p class="muted settings-group-hint">{{ authStore.user?.email }}로 로그인되어 있습니다.</p>

    <form class="stack-form" @submit.prevent="submit">
      <label>현재 비밀번호
        <input v-model="currentPassword" type="password" autocomplete="current-password" required />
      </label>
      <label>새 비밀번호
        <input v-model="newPassword" type="password" autocomplete="new-password" required />
      </label>
      <label>새 비밀번호 확인
        <input v-model="newPasswordConfirm" type="password" autocomplete="new-password" required />
      </label>
      <p v-if="message" class="muted">{{ message }}</p>
      <div class="row-actions">
        <button type="submit" :disabled="submitting">{{ submitting ? '변경 중...' : '비밀번호 변경' }}</button>
      </div>
    </form>
  </div>
</template>
