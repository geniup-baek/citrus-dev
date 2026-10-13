<script setup>
import { ref } from 'vue'
import { useAuthStore } from '../stores/authStore'

const authStore = useAuthStore()
const message = ref('')
const busy = ref(false)

async function resend() {
  message.value = ''
  busy.value = true
  const ok = await authStore.resendVerification()
  busy.value = false
  if (ok) message.value = '인증 메일을 다시 보냈습니다. 스팸함도 확인해 주세요.'
}

async function check() {
  message.value = ''
  busy.value = true
  await authStore.refreshVerification()
  busy.value = false
}
</script>

<template>
  <div class="farm-gate">
    <div class="card farm-gate-card">
      <h2>이메일 인증이 필요합니다</h2>
      <p class="muted">
        {{ authStore.user?.email }} 로 인증 메일을 보냈습니다. 메일의 링크를 누른 뒤 아래
        "인증 완료"를 눌러 주세요. 인증된 이메일로만 초대받은 농장이 연결됩니다.
      </p>
      <p v-if="authStore.error" class="settings-error">{{ authStore.error }}</p>
      <p v-if="message" class="muted text-sm">{{ message }}</p>
      <div class="row-actions">
        <button type="button" :disabled="busy" @click="check">인증 완료</button>
        <button class="ghost" type="button" :disabled="busy" @click="resend">인증 메일 다시 보내기</button>
        <button class="ghost" type="button" @click="authStore.signOutUser">로그아웃</button>
      </div>
    </div>
  </div>
</template>
