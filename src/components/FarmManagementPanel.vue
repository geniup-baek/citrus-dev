<script setup>
import { ref } from 'vue'
import { useFarmsStore } from '../stores/farmsStore'
import { useAuthStore } from '../stores/authStore'
import { deliverInviteMail, emailAutoSendEnabled } from '../services/inviteMail'
import { compressImageFile } from '../utils/imageProcessing'
import { confirm } from '../composables/useConfirm'

const farmsStore = useFarmsStore()
const authStore = useAuthStore()

const editingFarmId = ref(null)
const farmEditName = ref('')
const farmEditOwnerEmail = ref('')
const mailMessage = ref('')

function startEditFarm(farm) {
  editingFarmId.value = farm.id
  farmEditName.value = farm.name
  farmEditOwnerEmail.value = farm.ownerEmail || ''
}

function cancelEditFarm() {
  editingFarmId.value = null
}

async function saveFarmName(farm) {
  if (!farmEditName.value.trim()) return
  try {
    await farmsStore.renameFarm(farm.id, farmEditName.value)
    const nextEmail = farmEditOwnerEmail.value.trim().toLowerCase()
    if (nextEmail && nextEmail !== (farm.ownerEmail || '')) {
      const ok = await confirm({
        title: '소유주 변경',
        message: `"${farm.name}" 농장의 소유주를 ${nextEmail} 로 바꿀까요? 현재 소유주는 즉시 접근 권한을 잃고, 새 소유주가 그 이메일로 가입·로그인하면 농장이 연결됩니다.`,
        confirmLabel: '변경',
      })
      if (!ok) return
      await farmsStore.updateFarmOwner(farm.id, nextEmail)
    }
    editingFarmId.value = null
  } catch (e) {
    alert(e.message || '저장하지 못했습니다.')
  }
}

// 소유주에게 앱 설치·회원가입 안내메일을 보낸다(자동 발송 설정이 없으면 메일 앱이 열린다).
async function sendOwnerMail(farm) {
  mailMessage.value = ''
  try {
    const method = await deliverInviteMail({
      email: farm.ownerEmail,
      role: 'owner',
      farmName: farm.name,
      inviterName: authStore.user?.displayName || '',
    })
    mailMessage.value = method === 'emailjs'
      ? `${farm.ownerEmail} 로 안내메일을 보냈습니다.`
      : '메일 앱이 열렸습니다. 내용을 확인하고 보내기를 눌러 주세요.'
  } catch (e) {
    alert(e.message || '메일을 보내지 못했습니다.')
  }
}

async function handleFarmLogoChange(id, event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const compressed = await compressImageFile(file, { maxWidth: 400, maxHeight: 400, quality: 0.85 })
  await farmsStore.updateFarmLogo(id, compressed.dataUrl)
}

async function confirmDeleteFarm(farm) {
  const ok = await confirm({
    message: `"${farm.name}" 농장을 목록에서 삭제할까요? 데이터는 지워지지 않고 '삭제된 농장'에 보관되며, 언제든 복원하거나 완전 삭제할 수 있습니다.`,
  })
  if (!ok) return
  await farmsStore.deleteFarm(farm.id)
}

async function restoreFarm(farm) {
  await farmsStore.restoreFarm(farm.id)
}

async function confirmPermanentlyDeleteFarm(farm) {
  const ok = await confirm({
    message: `"${farm.name}" 농장의 데이터를 완전히 삭제할까요? 재배동·작업·재고·방제이력을 포함한 모든 데이터가 영구히 사라지며 되돌릴 수 없습니다.`,
  })
  if (!ok) return
  await farmsStore.permanentlyDeleteFarm(farm.id)
}

const showNewFarmForm = ref(false)
const newFarmName = ref('')
const newFarmLogo = ref('')
const newFarmOwnerEmail = ref('')

async function handleNewFarmLogoChange(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const compressed = await compressImageFile(file, { maxWidth: 400, maxHeight: 400, quality: 0.85 })
  newFarmLogo.value = compressed.dataUrl
}

function removeNewFarmLogo() {
  newFarmLogo.value = ''
}

function cancelNewFarm() {
  showNewFarmForm.value = false
  newFarmName.value = ''
  newFarmLogo.value = ''
  newFarmOwnerEmail.value = ''
}

async function submitNewFarm() {
  const trimmed = newFarmName.value.trim()
  const ownerEmail = newFarmOwnerEmail.value.trim().toLowerCase()
  if (!trimmed || !ownerEmail) return
  try {
    const id = await farmsStore.createFarm({ name: trimmed, logo: newFarmLogo.value, ownerEmail })
    cancelNewFarm()
    const ok = await confirm({
      title: '안내메일',
      message: `"${trimmed}" 농장을 만들었습니다. ${ownerEmail} 로 앱 설치·회원가입 안내메일을 보낼까요?`,
      confirmLabel: '보내기',
    })
    if (ok && id) await sendOwnerMail({ id, name: trimmed, ownerEmail })
  } catch (e) {
    alert(e.message || '농장을 만들지 못했습니다.')
  }
}
</script>

<template>
  <div class="sub-card">
    <div class="settings-group-head">
      <h3>농장 관리</h3>
      <span class="pill">{{ farmsStore.farms.length }}개</span>
    </div>
    <p class="muted settings-group-hint">
      농장마다 재배동·시설장비·묘목·작업·문제·재고·방제이력·가용농약이 독립적으로 관리됩니다.
      병해충·농약 정보와 분류·항목 설정은 모든 농장이 공유합니다. 농장은 슈퍼관리자가
      만들고 소유주를 이메일로 지정합니다(가입 전 이메일도 가능). 소유주가 그 이메일로 가입·로그인하면
      농장이 연결되며, 소유주는 같은 방식으로 농장종사자를 초대합니다.
    </p>

    <ul class="list clean">
      <li
        v-for="farm in farmsStore.farms"
        :key="farm.id"
        class="list-item settings-item farm-manage-item"
        :class="{ 'settings-item-editing': editingFarmId === farm.id }"
      >
        <template v-if="editingFarmId === farm.id">
          <input v-model="farmEditName" class="settings-edit-input" type="text" placeholder="농장 이름" @keydown.enter.prevent="saveFarmName(farm)" @keydown.escape.prevent="cancelEditFarm" />
          <input
            v-model="farmEditOwnerEmail"
            class="settings-edit-input"
            type="email"
            placeholder="소유주 이메일"
            style="max-width: 16rem;"
            @keydown.enter.prevent="saveFarmName(farm)"
            @keydown.escape.prevent="cancelEditFarm"
          />
          <p class="muted text-sm" style="flex-basis: 100%; margin: 0;">
            소유주를 바꾸면 새 이메일로 가입·로그인한 사람에게 농장이 연결됩니다(그 전까지 현재 소유주는 접근할 수 없음).
          </p>
          <label class="ghost compact-btn">
            로고 변경
            <input accept="image/*" type="file" hidden @change="(e) => handleFarmLogoChange(farm.id, e)" />
          </label>
          <div class="row-actions">
            <button type="button" :disabled="!farmEditName.trim()" @click="saveFarmName(farm)">저장</button>
            <button class="ghost" type="button" @click="cancelEditFarm">취소</button>
          </div>
        </template>
        <template v-else>
          <span class="farm-logo-mini" :class="{ 'farm-logo-mini-empty': !farm.logo }">
            <img v-if="farm.logo" :src="farm.logo" alt="" />
            <span v-else>{{ farm.name?.[0] ?? '?' }}</span>
          </span>
          <span class="settings-item-name">
            {{ farm.name }}
            <span v-if="farmsStore.activeFarm?.id === farm.id" class="pill">사용 중</span>
            <span v-if="farm.ownerUid && farm.ownerUid === authStore.user?.uid" class="pill">내 농장</span>
            <span v-else-if="!farm.ownerUid" class="pill" title="소유주가 아직 가입·로그인하지 않았습니다">가입 대기</span>
          </span>
          <span v-if="farm.ownerEmail" class="muted text-sm farm-owner-email">{{ farm.ownerEmail }}</span>
          <div class="row-actions settings-item-actions">
            <button
              v-if="farm.ownerEmail"
              class="ghost compact-btn"
              type="button"
              @click="sendOwnerMail(farm)"
            >안내메일</button>
            <button class="ghost icon-btn" type="button" title="수정" aria-label="수정" @click="startEditFarm(farm)">✎</button>
            <button
              class="danger icon-btn"
              type="button"
              title="삭제"
              aria-label="삭제"
              :disabled="farmsStore.activeFarm?.id === farm.id || farmsStore.farms.length <= 1"
              @click="confirmDeleteFarm(farm)"
            >✕</button>
          </div>
        </template>
      </li>
    </ul>

    <template v-if="showNewFarmForm">
      <form class="stack-form" style="margin-top: 0.75rem;" @submit.prevent="submitNewFarm">
        <label>농장 이름
          <input v-model="newFarmName" type="text" required placeholder="예: 서귀포 농장" />
        </label>
        <label>소유주 이메일
          <input v-model="newFarmOwnerEmail" type="email" required autocomplete="off" placeholder="owner@example.com" />
        </label>
        <p class="muted text-sm" style="margin: 0;">
          가입 전 이메일도 됩니다. 이 이메일로만 소유주 가입이 허용되고, 가입·로그인하면 농장이 연결됩니다.
          <template v-if="!emailAutoSendEnabled">(안내메일은 메일 앱으로 열립니다 — 자동 발송은 EmailJS 설정 시.)</template>
        </p>
        <label>로고 (선택)
          <input accept="image/*" type="file" @change="handleNewFarmLogoChange" />
        </label>
        <div v-if="newFarmLogo" class="farm-logo-preview">
          <img :src="newFarmLogo" alt="" />
          <button type="button" class="ghost" @click="removeNewFarmLogo">제거</button>
        </div>
        <div class="row-actions">
          <button type="submit" :disabled="!newFarmName.trim() || !newFarmOwnerEmail.trim()">추가</button>
          <button class="ghost" type="button" @click="cancelNewFarm">취소</button>
        </div>
      </form>
    </template>
    <button v-else type="button" style="margin-top: 0.5rem;" @click="showNewFarmForm = true">새 농장 추가</button>

    <p v-if="mailMessage" class="muted text-sm">{{ mailMessage }}</p>

    <p style="margin-top: 0.75rem;">
      <button class="ghost" type="button" @click="farmsStore.exitToSelector">관리 모드 종료 (농장 선택 화면으로)</button>
    </p>
  </div>

  <div v-if="farmsStore.deletedFarms.length" class="sub-card" style="margin-top: 1rem;">
    <div class="settings-group-head">
      <h3>삭제된 농장</h3>
      <span class="pill">{{ farmsStore.deletedFarms.length }}개</span>
    </div>
    <p class="muted settings-group-hint">
      목록에서 삭제된 농장입니다. 데이터는 그대로 남아 있어 복원하면 바로 다시 사용할 수 있습니다.
      "완전 삭제"를 누르면 해당 농장의 모든 데이터가 되돌릴 수 없이 사라집니다.
    </p>

    <ul class="list clean">
      <li v-for="farm in farmsStore.deletedFarms" :key="farm.id" class="list-item settings-item farm-manage-item">
        <span class="farm-logo-mini" :class="{ 'farm-logo-mini-empty': !farm.logo }">
          <img v-if="farm.logo" :src="farm.logo" alt="" />
          <span v-else>{{ farm.name?.[0] ?? '?' }}</span>
        </span>
        <span class="settings-item-name">{{ farm.name }}</span>
        <div class="row-actions settings-item-actions">
          <button class="ghost compact-btn" type="button" @click="restoreFarm(farm)">복원</button>
          <button class="danger compact-btn" type="button" @click="confirmPermanentlyDeleteFarm(farm)">완전 삭제</button>
        </div>
      </li>
    </ul>
  </div>
</template>
