<script setup>
import { onMounted, reactive } from 'vue'
import { useUserAdminStore } from '../stores/userAdminStore'
import { useAuthStore } from '../stores/authStore'
import { confirm } from '../composables/useConfirm'

const userAdminStore = useUserAdminStore()
const authStore = useAuthStore()

onMounted(() => { userAdminStore.refreshUsers() })

const expanded = reactive({}) // uid -> boolean

function displayNameFor(user) {
  return user.displayName || user.email || user.uid
}

function isSelf(user) {
  return user.uid === authStore.user?.uid
}

function permissionSummary(permissions) {
  const values = Object.values(permissions || {})
  return `읽기 ${values.filter((p) => p?.read).length} · 쓰기 ${values.filter((p) => p?.write).length}`
}

async function run(action) {
  try {
    await action()
  } catch (e) {
    alert(e.message || '처리하지 못했습니다.')
  }
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
  await run(() => userAdminStore.setSuperAdmin(user.uid, grant))
}

async function toggleDisabled(user) {
  const disable = !user.disabled
  const ok = await confirm({
    title: disable ? '계정 비활성화' : '계정 활성화',
    message: disable
      ? `"${displayNameFor(user)}" 계정을 비활성화할까요? 로그인은 되지만 농장·공통 데이터에 접근할 수 없게 됩니다. 언제든 다시 활성화할 수 있습니다.`
      : `"${displayNameFor(user)}" 계정을 다시 활성화할까요?`,
    confirmLabel: disable ? '비활성화' : '활성화',
  })
  if (!ok) return
  await run(() => userAdminStore.setDisabled(user.uid, disable))
}

async function sendReset(user) {
  const ok = await confirm({
    title: '비밀번호 재설정 메일',
    message: `${user.email} 로 비밀번호 재설정 메일을 보낼까요? 비밀번호를 직접 바꾸는 게 아니라, 본인이 메일의 링크로 새 비밀번호를 정하게 됩니다.`,
    confirmLabel: '보내기',
  })
  if (!ok) return
  await run(async () => {
    await userAdminStore.sendPasswordReset(user.email)
    alert('재설정 메일을 보냈습니다.')
  })
}

async function removeAccount(user) {
  const ok = await confirm({
    title: '계정 삭제',
    message: `"${displayNameFor(user)}" 계정의 모든 농장 소속을 제거하고 영구 비활성화합니다. 이 앱에서는 Firebase 인증 계정 자체를 지울 수 없어서, 인증 계정까지 완전히 없애려면 Firebase 콘솔 → Authentication에서 따로 삭제해야 합니다.`,
    confirmLabel: '삭제',
  })
  if (!ok) return
  await run(() => userAdminStore.removeAccount(user.uid))
}
async function removeProfile(user) {
  const ok = await confirm({
    title: '목록에서 제거',
    message: `"${displayNameFor(user)}" 계정을 사용자 목록에서 제거할까요? Firebase 콘솔 → Authentication에서 이 계정을 이미 삭제한 경우에만 사용하세요. 인증 계정이 남아 있으면 그 사람이 다시 로그인할 때 비활성화 표시 없이 목록에 되살아납니다.`,
    confirmLabel: '제거',
  })
  if (!ok) return
  await run(() => userAdminStore.removeProfile(user.uid))
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
      프로필 문서가 만들어진 계정만 보입니다). 본인 계정은 여기서 바꿀 수 없고, 슈퍼관리자 권한
      최초 부여는 Firebase 콘솔에서만 할 수 있습니다.
    </p>

    <p v-if="userAdminStore.loading" class="muted">불러오는 중...</p>
    <p v-else-if="userAdminStore.error" class="muted">{{ userAdminStore.error }}</p>
    <p v-else-if="!userAdminStore.users.length" class="muted">아직 로그인한 계정이 없습니다.</p>

    <ul v-else class="list clean">
      <li v-for="user in userAdminStore.users" :key="user.uid" class="list-item settings-item user-item">
        <span class="settings-item-name user-name">
          {{ displayNameFor(user) }}
          <span v-if="user.email && user.displayName" class="muted text-sm"> · {{ user.email }}</span>
          <span v-if="user.role === 'super_admin'" class="pill">슈퍼관리자</span>
          <span v-if="user.disabled" class="pill pill-danger">비활성</span>
          <span v-if="isSelf(user)" class="pill">나</span>
        </span>

        <div v-if="!isSelf(user)" class="row-actions user-actions">
          <button class="ghost compact-btn" type="button" @click="toggleSuperAdmin(user)">
            {{ user.role === 'super_admin' ? '권한 회수' : '권한 부여' }}
          </button>
          <button
            class="ghost compact-btn"
            type="button"
            :disabled="user.role === 'super_admin' && !user.disabled"
            :title="user.role === 'super_admin' && !user.disabled ? '슈퍼관리자는 먼저 권한을 회수해야 비활성화할 수 있습니다' : ''"
            @click="toggleDisabled(user)"
          >{{ user.disabled ? '활성화' : '비활성화' }}</button>
          <button class="ghost compact-btn" type="button" :disabled="!user.email" @click="sendReset(user)">재설정 메일</button>
          <button
            class="danger compact-btn"
            type="button"
            :disabled="user.role === 'super_admin'"
            :title="user.role === 'super_admin' ? '슈퍼관리자는 먼저 권한을 회수해야 삭제할 수 있습니다' : ''"
            @click="removeAccount(user)"
          >삭제</button>
          <button
            v-if="user.disabled && user.role !== 'super_admin'"
            class="danger compact-btn"
            type="button"
            title="Firebase 인증 계정을 이미 삭제한 경우, 이 목록에서도 완전히 제거합니다"
            @click="removeProfile(user)"
          >목록에서 제거</button>
        </div>
        <span v-else class="muted text-sm user-actions">본인 계정은 여기서 바꿀 수 없습니다(콘솔에서만).</span>

        <button class="ghost compact-btn user-toggle" type="button" @click="expanded[user.uid] = !expanded[user.uid]">
          {{ expanded[user.uid] ? '농장 접기' : '농장 보기' }}
          ({{ userAdminStore.ownedFarmsOf(user.uid).length }}소유 · {{ userAdminStore.membershipsOf(user.uid).length }}소속)
        </button>

        <div v-if="expanded[user.uid]" class="user-farms">
          <p class="muted text-sm user-farms-title">소유한 농장</p>
          <ul v-if="userAdminStore.ownedFarmsOf(user.uid).length" class="list clean compact">
            <li v-for="farm in userAdminStore.ownedFarmsOf(user.uid)" :key="farm.id" class="text-sm">
              {{ farm.name }}<span v-if="farm.deletedAt" class="muted"> (삭제됨)</span>
            </li>
          </ul>
          <p v-else class="muted text-sm">없음</p>

          <p class="muted text-sm user-farms-title">소속된 농장 (구성원)</p>
          <ul v-if="userAdminStore.membershipsOf(user.uid).length" class="list clean compact">
            <li v-for="m in userAdminStore.membershipsOf(user.uid)" :key="m.farmId" class="text-sm">
              {{ m.farm?.name || m.farmId }}<span v-if="m.farm?.deletedAt" class="muted"> (삭제됨)</span>
              <span class="muted"> · {{ permissionSummary(m.permissions) }}</span>
            </li>
          </ul>
          <p v-else class="muted text-sm">없음</p>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.user-item {
  flex-direction: column;
  align-items: stretch;
  gap: 0.5rem;
}
.user-name {
  flex-basis: 100%;
}
.user-actions {
  flex-wrap: wrap;
}
.user-toggle {
  align-self: flex-start;
}
.user-farms {
  padding: 0.5rem 0.75rem;
  border-left: 2px solid var(--line);
}
.user-farms-title {
  margin: 0.25rem 0 0.15rem;
  font-weight: 600;
}
.pill-danger {
  background: var(--danger, #b3261e);
  color: #fff;
}
</style>
