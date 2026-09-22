<script setup>
import { ref, watch } from 'vue'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../services/firebase'
import { useFarmsStore } from '../stores/farmsStore'
import { useAuthStore } from '../stores/authStore'
import { compressImageFile } from '../utils/imageProcessing'
import { confirm } from '../composables/useConfirm'

const farmsStore = useFarmsStore()
const authStore = useAuthStore()

// farms/{id} 문서엔 이제 ownerUid가 없다(전역 노출 방지, firestore.rules 참고) —
// 이 화면은 슈퍼관리자 전용이라 private/owner 서브문서를 직접 읽어도 된다(규칙상
// 슈퍼관리자는 항상 읽기 허용). 농장별로 1회씩 조회해 캐시한다.
const farmOwnerUids = ref({}) // farmId -> ownerUid | null
async function loadFarmOwner(farmId) {
  try {
    const snap = await getDoc(doc(db, 'farms', farmId, 'private', 'owner'))
    farmOwnerUids.value = { ...farmOwnerUids.value, [farmId]: snap.exists() ? (snap.data()?.ownerUid ?? null) : null }
  } catch {
    farmOwnerUids.value = { ...farmOwnerUids.value, [farmId]: null }
  }
}
watch(
  () => farmsStore.farms.map((f) => f.id),
  (ids) => {
    for (const id of ids) if (!(id in farmOwnerUids.value)) loadFarmOwner(id)
  },
  { immediate: true },
)

const editingFarmId = ref(null)
const farmEditName = ref('')
const farmEditPin = ref('')
const farmEditOwnerUid = ref('')

function startEditFarm(farm) {
  editingFarmId.value = farm.id
  farmEditName.value = farm.name
  farmEditPin.value = farm.pin || ''
  farmEditOwnerUid.value = farmOwnerUids.value[farm.id] || ''
}

function cancelEditFarm() {
  editingFarmId.value = null
}

async function saveFarmName(id, originalOwnerUid) {
  if (!farmEditName.value.trim()) return
  await farmsStore.renameFarm(id, farmEditName.value)
  await farmsStore.updateFarmPin(id, farmEditPin.value)
  const nextOwnerUid = farmEditOwnerUid.value.trim()
  if (nextOwnerUid !== (originalOwnerUid || '')) {
    await farmsStore.updateFarmOwner(id, nextOwnerUid)
    await loadFarmOwner(id)
  }
  editingFarmId.value = null
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
const newFarmPin = ref('')

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
  newFarmPin.value = ''
}

async function submitNewFarm() {
  const trimmed = newFarmName.value.trim()
  if (!trimmed) return
  await farmsStore.createFarm({ name: trimmed, logo: newFarmLogo.value, pin: newFarmPin.value })
  cancelNewFarm()
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
      병해충·농약 정보와 분류·항목 설정은 모든 농장이 공유합니다.
    </p>

    <ul class="list clean">
      <li
        v-for="farm in farmsStore.farms"
        :key="farm.id"
        class="list-item settings-item farm-manage-item"
        :class="{ 'settings-item-editing': editingFarmId === farm.id }"
      >
        <template v-if="editingFarmId === farm.id">
          <input v-model="farmEditName" class="settings-edit-input" type="text" placeholder="농장 이름" @keydown.enter.prevent="saveFarmName(farm.id, farmOwnerUids[farm.id])" @keydown.escape.prevent="cancelEditFarm" />
          <input v-model="farmEditPin" class="settings-edit-input" type="text" inputmode="numeric" placeholder="PIN (선택, 비우면 해제)" style="max-width: 11rem;" @keydown.enter.prevent="saveFarmName(farm.id, farmOwnerUids[farm.id])" @keydown.escape.prevent="cancelEditFarm" />
          <input v-model="farmEditOwnerUid" class="settings-edit-input" type="text" placeholder="소유자 계정 ID (비우면 공개 농장)" style="max-width: 16rem;" @keydown.enter.prevent="saveFarmName(farm.id, farmOwnerUids[farm.id])" @keydown.escape.prevent="cancelEditFarm" />
          <p class="muted text-sm" style="flex-basis: 100%; margin: 0;">계정 ID는 Firebase 콘솔 → Authentication에서 이메일로 찾을 수 있습니다(이메일이 아니라 ID를 입력해야 합니다).</p>
          <label class="ghost compact-btn">
            로고 변경
            <input accept="image/*" type="file" hidden @change="(e) => handleFarmLogoChange(farm.id, e)" />
          </label>
          <div class="row-actions">
            <button type="button" :disabled="!farmEditName.trim()" @click="saveFarmName(farm.id, farmOwnerUids[farm.id])">저장</button>
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
            <span v-if="farm.pin" class="pill" title="PIN이 설정된 농장">🔒 PIN</span>
            <span v-if="farmOwnerUids[farm.id] && farmOwnerUids[farm.id] === authStore.user?.uid" class="pill">내 농장</span>
            <span v-else-if="farmOwnerUids[farm.id]" class="pill" title="다른 사용자가 소유자로 지정된 농장">소유됨</span>
          </span>
          <div class="row-actions settings-item-actions">
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
        <label>로고 (선택)
          <input accept="image/*" type="file" @change="handleNewFarmLogoChange" />
        </label>
        <div v-if="newFarmLogo" class="farm-logo-preview">
          <img :src="newFarmLogo" alt="" />
          <button type="button" class="ghost" @click="removeNewFarmLogo">제거</button>
        </div>
        <label>PIN (선택)
          <input v-model="newFarmPin" type="text" inputmode="numeric" placeholder="설정하면 농장 선택 시 PIN 입력이 필요합니다" />
        </label>
        <div class="row-actions">
          <button type="submit" :disabled="!newFarmName.trim()">추가</button>
          <button class="ghost" type="button" @click="cancelNewFarm">취소</button>
        </div>
      </form>
    </template>
    <button v-else type="button" style="margin-top: 0.5rem;" @click="showNewFarmForm = true">새 농장 추가</button>

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
