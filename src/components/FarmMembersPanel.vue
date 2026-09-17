<script setup>
import { reactive, ref } from 'vue'
import { useFarmMembersStore } from '../stores/farmMembersStore'
import { PERMISSION_DOMAINS } from '../utils/farmAccess'
import { confirm } from '../composables/useConfirm'

const farmMembersStore = useFarmMembersStore()

const DOMAIN_LABELS = {
  facilities: '재배동',
  ancillaries: '부대시설',
  seedlings: '묘목',
  tasks: '작업',
  issues: '문제',
  inventory: '재고',
  usageGuides: '사용법 자료',
  treatments: '방제/농약',
}

function clonePermissions(permissions) {
  const base = farmMembersStore.emptyPermissions()
  for (const domain of PERMISSION_DOMAINS) {
    if (permissions?.[domain]) Object.assign(base[domain], permissions[domain])
  }
  return base
}

function setAll(permissions, mode, value) {
  for (const domain of PERMISSION_DOMAINS) permissions[domain][mode] = value
}

// ── 기존 구성원 권한 수정 ────────────────────────────────────────────────────
async function toggleMemberPermission(member, domain, mode) {
  const next = clonePermissions(member.permissions)
  next[domain][mode] = !next[domain][mode]
  await farmMembersStore.updateMemberPermissions(member.uid, next)
}

async function setMemberAll(member, mode, value) {
  const next = clonePermissions(member.permissions)
  setAll(next, mode, value)
  await farmMembersStore.updateMemberPermissions(member.uid, next)
}

async function confirmRemoveMember(member) {
  const ok = await confirm({
    message: `"${member.displayName || member.email || member.uid}" 님을 이 농장에서 내보낼까요? 그 사람의 권한이 즉시 사라집니다.`,
  })
  if (!ok) return
  await farmMembersStore.removeMember(member.uid)
}

// ── 초대 코드 발급 ──────────────────────────────────────────────────────────
const showInviteForm = ref(false)
const invitePermissions = reactive(farmMembersStore.emptyPermissions())
const issuedCode = ref('')
const copyMessage = ref('')

function openInviteForm() {
  showInviteForm.value = true
  issuedCode.value = ''
  Object.assign(invitePermissions, farmMembersStore.emptyPermissions())
}

async function submitInvite() {
  issuedCode.value = await farmMembersStore.createInviteCode(JSON.parse(JSON.stringify(invitePermissions)))
}

async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code)
    copyMessage.value = '복사했습니다.'
  } catch {
    copyMessage.value = '복사에 실패했습니다. 직접 선택해 복사해 주세요.'
  }
  setTimeout(() => { copyMessage.value = '' }, 2000)
}

async function confirmRevokeCode(code) {
  const ok = await confirm({ message: '이 초대 코드를 폐기할까요? 아직 참여하지 않은 사람은 더 이상 이 코드로 참여할 수 없습니다.' })
  if (!ok) return
  await farmMembersStore.revokeInviteCode(code)
}
</script>

<template>
  <div class="sub-card">
    <div class="settings-group-head">
      <h3>구성원</h3>
      <span class="pill">{{ farmMembersStore.members.length }}명</span>
    </div>
    <p class="muted settings-group-hint">
      농장종사자를 초대하고, 기능별로 읽기/쓰기 권한을 나눠 줄 수 있습니다.
    </p>

    <ul v-if="farmMembersStore.members.length" class="list clean">
      <li v-for="member in farmMembersStore.members" :key="member.uid" class="list-item settings-item member-item">
        <div class="member-item-head">
          <span class="settings-item-name">{{ member.displayName || member.email || member.uid }}</span>
          <div class="row-actions">
            <button class="ghost compact-btn" type="button" @click="setMemberAll(member, 'read', true)">전체 읽기</button>
            <button class="ghost compact-btn" type="button" @click="setMemberAll(member, 'write', true)">전체 쓰기</button>
            <button class="danger icon-btn" type="button" title="내보내기" aria-label="내보내기" @click="confirmRemoveMember(member)">✕</button>
          </div>
        </div>
        <ul class="list clean compact permission-grid">
          <li v-for="domain in PERMISSION_DOMAINS" :key="domain" class="permission-row">
            <span class="permission-label">{{ DOMAIN_LABELS[domain] }}</span>
            <label class="permission-check">
              <input type="checkbox" :checked="member.permissions?.[domain]?.read" @change="toggleMemberPermission(member, domain, 'read')" /> 읽기
            </label>
            <label class="permission-check">
              <input type="checkbox" :checked="member.permissions?.[domain]?.write" @change="toggleMemberPermission(member, domain, 'write')" /> 쓰기
            </label>
          </li>
        </ul>
      </li>
    </ul>
    <p v-else class="muted">아직 초대한 구성원이 없습니다.</p>

    <template v-if="showInviteForm">
      <div class="stack-form" style="margin-top: 0.75rem;">
        <p class="muted text-sm">부여할 권한을 고른 뒤 발급하세요. 발급된 코드를 카톡 등으로 전달하면, 받은 사람이 농장 선택 화면에서 그 코드를 입력해 이 권한 그대로 합류합니다.</p>
        <ul class="list clean compact permission-grid">
          <li v-for="domain in PERMISSION_DOMAINS" :key="domain" class="permission-row">
            <span class="permission-label">{{ DOMAIN_LABELS[domain] }}</span>
            <label class="permission-check">
              <input type="checkbox" v-model="invitePermissions[domain].read" /> 읽기
            </label>
            <label class="permission-check">
              <input type="checkbox" v-model="invitePermissions[domain].write" /> 쓰기
            </label>
          </li>
        </ul>
        <div class="row-actions">
          <button class="ghost compact-btn" type="button" @click="setAll(invitePermissions, 'read', true)">전체 읽기</button>
          <button class="ghost compact-btn" type="button" @click="setAll(invitePermissions, 'write', true)">전체 쓰기</button>
        </div>
        <div class="row-actions">
          <button type="button" @click="submitInvite">코드 발급</button>
          <button class="ghost" type="button" @click="showInviteForm = false">닫기</button>
        </div>
        <p v-if="issuedCode" class="muted">
          발급된 코드: <strong>{{ issuedCode }}</strong>
          <button class="ghost compact-btn" type="button" @click="copyCode(issuedCode)">복사</button>
          {{ copyMessage }}
        </p>
      </div>
    </template>
    <button v-else type="button" style="margin-top: 0.5rem;" @click="openInviteForm">농장종사자 초대</button>

    <div v-if="farmMembersStore.inviteCodeRefs.length" style="margin-top: 1rem;">
      <p class="muted text-sm">발급된 초대 코드</p>
      <ul class="list clean compact">
        <li v-for="ref_ in farmMembersStore.inviteCodeRefs" :key="ref_.code" class="list-item settings-item">
          <span class="settings-item-name">{{ ref_.code }}</span>
          <div class="row-actions">
            <button class="ghost compact-btn" type="button" @click="copyCode(ref_.code)">복사</button>
            <button class="danger compact-btn" type="button" @click="confirmRevokeCode(ref_.code)">폐기</button>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.member-item {
  flex-direction: column;
  align-items: stretch;
  gap: 0.5rem;
}
.member-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.permission-grid {
  gap: 0.25rem;
}
.permission-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.permission-label {
  min-width: 6rem;
  font-weight: 600;
}
.permission-check {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-weight: normal;
}
</style>
