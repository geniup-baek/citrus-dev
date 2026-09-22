<script setup>
import { onMounted } from 'vue'
import { useUserAdminStore } from '../stores/userAdminStore'
import { useAuthStore } from '../stores/authStore'
import { confirm } from '../composables/useConfirm'

const userAdminStore = useUserAdminStore()
const authStore = useAuthStore()

onMounted(() => { userAdminStore.refreshUsers() })

function displayNameFor(user) {
  return user.displayName || user.email || user.uid
}

async function toggleSuperAdmin(user) {
  const grant = user.role !== 'super_admin'
  const ok = await confirm({
    title: grant ? '슈퍼관리자 권한 부여' : '슈퍼관리자 권한 회수',
    message: grant
      ? `"${displayNameFor(user)}" 계정에 슈퍼관리자 권한을 부여할까요? 모든 농장을 관리할 수 있게 됩니다.`
      : `"${displayNameFor(user)}" 계정의 슈퍼관리자 권한을 회수할까요?`,
    confirmLabel: grant ? '부여' : '회수',
  })
  if (!ok) return
  try {
    await userAdminStore.setSuperAdmin(user.uid, grant)
  } catch (e) {
    alert(e.message || '처리하지 못했습니다.')
  }
}
</script>

<template>
  <div class="sub-card">
    <div class="settings-group-head">
      <h3>사용자 관리</h3>
      <span class="pill">{{ userAdminStore.users.length }}명</span>
    </div>
    <p class="muted settings-group-hint">
      이 앱에 한 번이라도 로그인한 계정 목록입니다(Firebase Auth 계정 전체가 아니라, 로그인해서
      프로필 문서가 만들어진 계정만 보입니다). 슈퍼관리자 권한은 여기서 다른 계정에만 부여·회수할
      수 있고, 본인 권한은 Firebase 콘솔에서만 바꿀 수 있습니다.
    </p>

    <p v-if="userAdminStore.loading" class="muted">불러오는 중...</p>
    <p v-else-if="userAdminStore.error" class="muted">{{ userAdminStore.error }}</p>
    <p v-else-if="!userAdminStore.users.length" class="muted">아직 로그인한 계정이 없습니다.</p>

    <ul v-else class="list clean">
      <li v-for="user in userAdminStore.users" :key="user.uid" class="list-item settings-item">
        <span class="settings-item-name">
          {{ displayNameFor(user) }}
          <span v-if="user.email && user.displayName" class="muted text-sm"> · {{ user.email }}</span>
          <span v-if="user.role === 'super_admin'" class="pill">슈퍼관리자</span>
          <span v-if="user.uid === authStore.user?.uid" class="pill">나</span>
        </span>
        <div class="row-actions settings-item-actions">
          <button
            v-if="user.uid !== authStore.user?.uid"
            class="ghost compact-btn"
            type="button"
            @click="toggleSuperAdmin(user)"
          >{{ user.role === 'super_admin' ? '권한 회수' : '권한 부여' }}</button>
          <span v-else class="muted text-sm">콘솔에서만 변경 가능</span>
        </div>
      </li>
    </ul>
  </div>
</template>
