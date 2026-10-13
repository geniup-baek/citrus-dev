<script setup>
import { reactive, ref } from 'vue'
import { useFarmMembersStore } from '../stores/farmMembersStore'
import { useFarmsStore } from '../stores/farmsStore'
import { useAuthStore } from '../stores/authStore'
import { deliverInviteMail, emailAutoSendEnabled } from '../services/inviteMail'
import { ADMIN_FEATURES, DATA_DOMAINS, PERMISSION_DOMAINS } from '../utils/farmAccess'
import { confirm } from '../composables/useConfirm'

const farmMembersStore = useFarmMembersStore()
const farmsStore = useFarmsStore()
const authStore = useAuthStore()

const DOMAIN_LABELS = {
  facilities: '재배동',
  ancillaries: '부대시설',
  seedlings: '묘목',
  tasks: '작업',
  issues: '문제',
  inventory: '재고',
  usageGuides: '사용법 자료',
  treatments: '방제/농약',
  changeLog: '변경 이력',
  behavior: '동작 설정',
  backup: '저장·백업',
}

function clonePermissions(permissions) {
  const base = farmMembersStore.emptyPermissions()
  for (const domain of PERMISSION_DOMAINS) {
    if (permissions?.[domain]) Object.assign(base[domain], permissions[domain])
  }
  return base
}

// 쓰기 권한은 읽기를 포함한다(규칙·화면 모두 쓰기만 있어도 읽을 수 있음) — 그래서 쓰기를 켜면
// 읽기도 같이 켜고, 읽기를 끄면 쓰기도 같이 끈다. 화면에 "쓰기만 켜짐" 같은 모순된 상태가 안 생긴다.
function setPerm(permissions, domain, mode, value) {
  permissions[domain][mode] = value
  if (mode === 'write' && value) permissions[domain].read = true
  if (mode === 'read' && !value) permissions[domain].write = false
}

// "전체 읽기/쓰기"는 데이터 기능만 대상이다 — 설정·관리 기능(변경 이력·동작·저장백업)은 실수로
// 한꺼번에 열리지 않도록 항상 개별로 체크해야 한다.
function setAll(permissions, mode, value) {
  for (const domain of DATA_DOMAINS) setPerm(permissions, domain, mode, value)
}

// 이미 "쓰기만" 저장된 예전 데이터도 읽기가 켜진 것으로 보여 준다(실제로도 읽을 수 있음).
function isChecked(permissions, domain, mode) {
  const p = permissions?.[domain]
  return mode === 'read' ? !!(p?.read || p?.write) : !!p?.write
}

// ── 기존 구성원 권한 수정 ────────────────────────────────────────────────────
async function toggleMemberPermission(member, domain, mode) {
  const next = clonePermissions(member.permissions)
  setPerm(next, domain, mode, !isChecked(next, domain, mode))
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

// ── 이메일로 농장종사자 초대 ────────────────────────────────────────────────
const showInviteForm = ref(false)
const inviteEmail = ref('')
const invitePermissions = reactive(farmMembersStore.emptyPermissions())
const inviteBusy = ref(false)
const inviteMessage = ref('')
const inviteError = ref('')

function openInviteForm() {
  showInviteForm.value = true
  inviteEmail.value = ''
  inviteMessage.value = ''
  inviteError.value = ''
  Object.assign(invitePermissions, farmMembersStore.emptyPermissions())
}

function mailParams(email) {
  return {
    email,
    role: 'worker',
    farmName: farmsStore.activeFarm?.name || '',
    inviterName: authStore.user?.displayName || authStore.user?.email || '',
  }
}

function mailNotice(method, email) {
  return method === 'emailjs'
    ? `${email} 로 안내메일을 보냈습니다.`
    : '메일 앱이 열렸습니다. 내용을 확인하고 보내기를 눌러 주세요.'
}

async function submitInvite() {
  if (inviteBusy.value) return
  inviteError.value = ''
  inviteMessage.value = ''
  inviteBusy.value = true
  try {
    const email = await farmMembersStore.inviteWorker(inviteEmail.value, JSON.parse(JSON.stringify(invitePermissions)))
    const method = await deliverInviteMail(mailParams(email))
    inviteMessage.value = mailNotice(method, email)
    inviteEmail.value = ''
  } catch (e) {
    inviteError.value = e.message || '초대하지 못했습니다.'
  } finally {
    inviteBusy.value = false
  }
}

async function resendMail(invitation) {
  try {
    const method = await deliverInviteMail(mailParams(invitation.email))
    inviteMessage.value = mailNotice(method, invitation.email)
  } catch (e) {
    inviteError.value = e.message || '메일을 보내지 못했습니다.'
  }
}

async function confirmRevokeInvitation(invitation) {
  const ok = await confirm({ message: `${invitation.email} 님의 초대를 취소할까요? 아직 가입·참여하지 않았다면 더 이상 참여할 수 없습니다.` })
  if (!ok) return
  await farmMembersStore.revokeInvitation(invitation)
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
          <span class="settings-item-name">
            {{ member.displayName || member.email || member.uid }}
            <span v-if="member.email && member.displayName" class="muted text-sm"> · {{ member.email }}</span>
          </span>
          <div class="row-actions">
            <button class="ghost compact-btn" type="button" @click="setMemberAll(member, 'read', true)">전체 읽기</button>
            <button class="ghost compact-btn" type="button" @click="setMemberAll(member, 'write', true)">전체 쓰기</button>
            <button class="danger icon-btn" type="button" title="내보내기" aria-label="내보내기" @click="confirmRemoveMember(member)">✕</button>
          </div>
        </div>
        <ul class="list clean compact permission-grid">
          <li v-for="domain in DATA_DOMAINS" :key="domain" class="permission-row">
            <span class="permission-label">{{ DOMAIN_LABELS[domain] }}</span>
            <label class="permission-check">
              <input type="checkbox" :checked="isChecked(member.permissions, domain, 'read')" @change="toggleMemberPermission(member, domain, 'read')" /> 읽기
            </label>
            <label class="permission-check">
              <input type="checkbox" :checked="isChecked(member.permissions, domain, 'write')" @change="toggleMemberPermission(member, domain, 'write')" /> 쓰기
            </label>
          </li>
          <li class="permission-section">설정·관리 기능</li>
          <li v-for="domain in ADMIN_FEATURES" :key="domain" class="permission-row permission-row-admin">
            <span class="permission-label">{{ DOMAIN_LABELS[domain] }}</span>
            <label class="permission-check">
              <input type="checkbox" :checked="isChecked(member.permissions, domain, 'read')" @change="toggleMemberPermission(member, domain, 'read')" /> 읽기
            </label>
            <label class="permission-check">
              <input type="checkbox" :checked="isChecked(member.permissions, domain, 'write')" @change="toggleMemberPermission(member, domain, 'write')" /> 쓰기
            </label>
          </li>
        </ul>
      </li>
    </ul>
    <p v-else class="muted">아직 초대한 구성원이 없습니다.</p>

    <template v-if="showInviteForm">
      <div class="stack-form" style="margin-top: 0.75rem;">
        <p class="muted text-sm">
          초대할 사람의 이메일과 부여할 권한을 정하세요. 안내메일(앱 설치·회원가입 방법)이 발송되고,
          그 이메일로 가입·로그인하면 이 권한 그대로 농장에 합류합니다.
          <template v-if="!emailAutoSendEnabled">(자동 발송이 설정되지 않아 메일 앱이 열립니다.)</template>
        </p>
        <label>이메일
          <input v-model="inviteEmail" type="email" autocomplete="off" placeholder="worker@example.com" />
        </label>
        <ul class="list clean compact permission-grid">
          <li v-for="domain in DATA_DOMAINS" :key="domain" class="permission-row">
            <span class="permission-label">{{ DOMAIN_LABELS[domain] }}</span>
            <label class="permission-check">
              <input type="checkbox" :checked="isChecked(invitePermissions, domain, 'read')" @change="setPerm(invitePermissions, domain, 'read', $event.target.checked)" /> 읽기
            </label>
            <label class="permission-check">
              <input type="checkbox" :checked="isChecked(invitePermissions, domain, 'write')" @change="setPerm(invitePermissions, domain, 'write', $event.target.checked)" /> 쓰기
            </label>
          </li>
          <li class="permission-section">설정·관리 기능</li>
          <li v-for="domain in ADMIN_FEATURES" :key="domain" class="permission-row permission-row-admin">
            <span class="permission-label">{{ DOMAIN_LABELS[domain] }}</span>
            <label class="permission-check">
              <input type="checkbox" :checked="isChecked(invitePermissions, domain, 'read')" @change="setPerm(invitePermissions, domain, 'read', $event.target.checked)" /> 읽기
            </label>
            <label class="permission-check">
              <input type="checkbox" :checked="isChecked(invitePermissions, domain, 'write')" @change="setPerm(invitePermissions, domain, 'write', $event.target.checked)" /> 쓰기
            </label>
          </li>
        </ul>
        <div class="row-actions">
          <button class="ghost compact-btn" type="button" @click="setAll(invitePermissions, 'read', true)">전체 읽기</button>
          <button class="ghost compact-btn" type="button" @click="setAll(invitePermissions, 'write', true)">전체 쓰기</button>
        </div>
        <div class="row-actions">
          <button type="button" :disabled="inviteBusy || !inviteEmail.trim()" @click="submitInvite">
            {{ inviteBusy ? '처리 중...' : '초대하고 안내메일 보내기' }}
          </button>
          <button class="ghost" type="button" @click="showInviteForm = false">닫기</button>
        </div>
        <p v-if="inviteError" class="settings-error">{{ inviteError }}</p>
        <p v-if="inviteMessage" class="muted text-sm">{{ inviteMessage }}</p>
      </div>
    </template>
    <button v-else type="button" style="margin-top: 0.5rem;" @click="openInviteForm">농장종사자 초대</button>

    <div v-if="farmMembersStore.invitations.length" style="margin-top: 1rem;">
      <p class="muted text-sm">초대 대기 (아직 가입·참여하지 않음)</p>
      <ul class="list clean compact">
        <li v-for="inv in farmMembersStore.invitations" :key="inv.id" class="list-item settings-item">
          <span class="settings-item-name">{{ inv.email }}</span>
          <div class="row-actions">
            <button class="ghost compact-btn" type="button" @click="resendMail(inv)">안내메일 다시 보내기</button>
            <button class="danger compact-btn" type="button" @click="confirmRevokeInvitation(inv)">취소</button>
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
/* 이름 옆에 이메일까지 붙으면(구성원은 이름이 겹칠 수 있어 병행 표시) 좁은 화면에서
   .settings-item-name(전역 규칙: min-width: 0 + word-break: break-all)이 글자
   하나씩 쪼개질 만큼 찌그러들 수 있다 — 이름 줄을 항상 자기 줄로 밀어내 버튼 줄과
   분리한다. */
.member-item-head .settings-item-name {
  flex-basis: 100%;
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
.permission-section {
  margin-top: 0.6rem;
  padding-top: 0.5rem;
  border-top: 1px dashed var(--line);
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--muted);
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
