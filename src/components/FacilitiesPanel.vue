<script setup>
import { computed, nextTick, reactive, ref } from 'vue'
import { useFarmStore } from '../stores/farmStore'
import { useLocaleStore } from '../stores/localeStore'
import { useRecommendSettingsStore } from '../stores/recommendSettingsStore'
import { useAppPolicyStore } from '../stores/appPolicyStore'
import { useFarmMembersStore } from '../stores/farmMembersStore'
import { confirm } from '../composables/useConfirm'
import { useIsMobile } from '../composables/useIsMobile'
import { useLightbox } from '../composables/useLightbox'
import { useFilesToPreviews } from '../composables/usePhotoPreviews'

const emit = defineEmits(['view-seedlings'])

const store = useFarmStore()
const localeStore = useLocaleStore()
const recSettingsStore = useRecommendSettingsStore()
const policyStore = useAppPolicyStore()
const farmMembersStore = useFarmMembersStore()
const editingId = ref('')
const showForm = ref(false)

// 초기화 버튼 — 시스템 관리 모드에서 기능을 "사용"으로 켜고, 이 농장에서 "표시"로 켠 경우에만 노출한다.
const showResetButton = computed(() =>
  policyStore.policy.enableResetFeature && recSettingsStore.settings.showResetButtons,
)

const { isMobile } = useIsMobile()
// 편집 대상이 목록에 있을 때만 그 항목 슬롯으로, 아니면 항상 존재하는 상단 호스트로(텔레포트 대상 null 방지)
const formTarget = computed(() =>
  editingId.value && store.state.facilities.some((f) => f.id === editingId.value)
    ? `#fac-form-slot-${editingId.value}`
    : '#fac-form-top',
)

const form = reactive({
  id: '',
  name: '',
  notes: '',
})

// 사진
const formPhotos = ref([]) // 편집 중 유지되는 기존 사진
const photoPreviews = ref([]) // 새로 추가한 미리보기
const compressionReport = ref('')
const { lightboxPhoto, openLightbox, closeLightbox } = useLightbox()
const { filesToPreviews } = useFilesToPreviews('facilities.compressedReport')

function seedlingsByFacility(facilityId) {
  return store.state.seedlings.filter((s) => s.greenhouseId === facilityId)
}

function varietyTotalsByFacility(facilityId) {
  const totals = new Map()
  for (const s of seedlingsByFacility(facilityId)) {
    const variety = s.variety || ''
    totals.set(variety, (totals.get(variety) || 0) + 1)
  }
  return [...totals.entries()].map(([variety, count]) => ({ variety, count }))
}

function moved(arr, i, dir) {
  const j = i + dir
  if (j < 0 || j >= arr.length) return arr
  const res = [...arr]
  const tmp = res[i]
  res[i] = res[j]
  res[j] = tmp
  return res
}

function moveFacility(i, dir) {
  store.reorderFacilities(moved(store.state.facilities, i, dir))
}

async function confirmDeleteFacility(facility) {
  const seedlings = store.state.seedlings.filter((s) => s.greenhouseId === facility.id).length
  const issues = store.state.issues.filter((i) => i.greenhouseId === facility.id).length
  const ok = await confirm({
    message: localeStore.t('confirm.facility', { name: facility.name, seedlings, issues }),
  })
  if (ok) await store.removeFacility(facility.id)
}

// 재배동 전체 삭제 — 관리모드 동작 설정에서 "초기화 버튼: 표시"일 때만 노출된다.
async function resetAllFacilities() {
  const n = store.state.facilities.length
  if (!n) return
  const ids = new Set(store.state.facilities.map((f) => f.id))
  const ok = await confirm({
    title: localeStore.t('confirm.resetTitle'),
    message: localeStore.t('confirm.resetFacilities', {
      n,
      seedlings: store.state.seedlings.filter((s) => ids.has(s.greenhouseId)).length,
      issues: store.state.issues.filter((i) => ids.has(i.greenhouseId)).length,
    }),
    confirmLabel: localeStore.t('common.reset'),
  })
  if (!ok) return
  await store.resetFacilities()
  closeForm()
}

// ── 사진 헬퍼 ────────────────────────────────────────────────────────────────
async function handlePhotoChange(event) {
  const files = Array.from(event.target.files || []).slice(0, 5)
  const { previews, report } = await filesToPreviews(files)
  photoPreviews.value = previews
  compressionReport.value = report
}

function removePreviewPhoto(id) {
  photoPreviews.value = photoPreviews.value.filter((p) => p.id !== id)
}

function removeExistingPhoto(id) {
  formPhotos.value = formPhotos.value.filter((p) => p.id !== id)
}

function clearForm() {
  form.id = ''
  form.name = ''
  form.notes = ''
  formPhotos.value = []
  photoPreviews.value = []
  compressionReport.value = ''
  editingId.value = ''
}

function openAdd() {
  clearForm()
  showForm.value = true
}

function editFacility(facility) {
  form.id = facility.id
  form.name = facility.name
  form.notes = facility.notes
  formPhotos.value = [...(facility.photos || [])]
  photoPreviews.value = []
  compressionReport.value = ''
  editingId.value = facility.id
  showForm.value = true
  scrollToItem(`fac-form-slot-${facility.id}`)
}

// 모바일에서 편집 시 해당 항목(과 아래 폼)이 보이도록 스크롤
function scrollToItem(slotId) {
  if (!isMobile.value) return
  nextTick(() => {
    const el = document.getElementById(slotId)
    ;(el?.closest('li') ?? el)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

function closeForm() {
  clearForm()
  showForm.value = false
}

async function saveFacility() {
  let uploaded
  try {
    uploaded = await store.savePhotos(photoPreviews.value)
  } catch (e) {
    console.error('[FacilitiesPanel] 사진 업로드 실패', e)
    alert(localeStore.t('common.photoUploadFailed'))
    return
  }
  await store.upsertFacility({
    id: form.id,
    name: form.name,
    notes: form.notes,
    photos: [...formPhotos.value, ...uploaded],
  })
  clearForm()
}
</script>

<template>
  <div v-if="lightboxPhoto" class="lightbox-overlay" @click="closeLightbox">
    <img :src="store.photoSrc(lightboxPhoto)" :alt="localeStore.t('facilities.facilityPhoto')" />
  </div>

  <div :class="['page-grid', showForm ? 'two-columns' : '']">
    <article>
      <div class="pip-header">
        <div class="pip-actions">
          <button v-if="!showForm && farmMembersStore.canWrite('facilities')" @click="openAdd">{{ localeStore.t('common.edit') }}</button>
          <template v-else-if="showForm">
            <button
              v-if="showResetButton && store.state.facilities.length > 0"
              class="danger"
              type="button"
              @click="resetAllFacilities"
            >{{ localeStore.t('common.reset') }}</button>
            <button class="ghost" @click="closeForm">{{ localeStore.t('common.exitEdit') }}</button>
          </template>
        </div>
      </div>
      <div class="sort-filter-bar">
        <span class="summary-chip">{{ localeStore.t('common.totalCount', { n: store.state.facilities.length }) }}</span>
      </div>
      <div id="fac-form-top" class="mobile-form-slot"></div>
      <ul class="list clean">
        <li v-for="(facility, i) in store.state.facilities" :key="facility.id" class="list-item card-like">
          <div>
            <p class="item-title">{{ facility.name }}</p>
            <p v-for="t in varietyTotalsByFacility(facility.id)" :key="t.variety" class="muted">
              {{ t.variety }} {{ t.count }}{{ localeStore.t('facilities.treeUnit') }}
            </p>
            <p v-if="!seedlingsByFacility(facility.id).length" class="muted">묘목 없음</p>
            <p class="muted">{{ facility.notes }}</p>
            <div v-if="facility.photos?.length" class="photo-grid compact-grid">
              <figure v-for="photo in facility.photos" :key="photo.id" class="photo-card">
                <button type="button" class="photo-card-btn" @click="openLightbox(photo)">
                  <img :src="store.photoSrc(photo)" :alt="localeStore.t('facilities.facilityPhoto')" />
                </button>
              </figure>
            </div>
          </div>
          <div class="row-actions">
            <button class="ghost" type="button" @click="emit('view-seedlings', facility.id)">{{ localeStore.t('facilities.viewSeedlings') }}</button>
            <template v-if="showForm">
              <button class="ghost" :disabled="i === 0" @click="moveFacility(i, -1)">{{ localeStore.t('common.moveUp') }}</button>
              <button class="ghost" :disabled="i === store.state.facilities.length - 1" @click="moveFacility(i, 1)">{{ localeStore.t('common.moveDown') }}</button>
              <button v-if="farmMembersStore.canWrite('facilities')" :class="{ ghost: editingId !== facility.id }" @click="editFacility(facility)">{{ localeStore.t('common.edit') }}</button>
              <button v-if="farmMembersStore.canWrite('facilities')" class="danger" @click="confirmDeleteFacility(facility)">{{ localeStore.t('common.delete') }}</button>
            </template>
          </div>
          <div :id="`fac-form-slot-${facility.id}`" class="mobile-form-slot"></div>
        </li>
      </ul>
    </article>

    <Teleport v-if="showForm" :to="formTarget" :disabled="!isMobile">
    <article v-if="showForm" class="card">
      <h3>{{ editingId ? localeStore.t('facilities.editTitle') : localeStore.t('facilities.addTitle') }}</h3>
      <form class="stack-form" @submit.prevent="saveFacility">
        <label>
          {{ localeStore.t('facilities.name') }}
          <input v-model="form.name" required type="text" :placeholder="localeStore.t('facilities.name')" />
        </label>
        <label>
          {{ localeStore.t('facilities.notes') }}
          <textarea v-model="form.notes" rows="3" :placeholder="localeStore.t('facilities.notesPlaceholder')" />
        </label>

        <template v-if="formPhotos.length">
          <p class="muted">{{ localeStore.t('facilities.existingPhotos') }}</p>
          <div class="photo-grid">
            <figure v-for="photo in formPhotos" :key="photo.id" class="photo-card">
              <button type="button" class="photo-card-btn" @click="openLightbox(photo)">
                <img :src="store.photoSrc(photo)" :alt="localeStore.t('facilities.facilityPhoto')" />
              </button>
              <button type="button" class="danger photo-card-delete" @click="removeExistingPhoto(photo.id)">{{ localeStore.t('common.delete') }}</button>
            </figure>
          </div>
        </template>

        <label>
          {{ localeStore.t('facilities.attachPhotos') }}
          <input accept="image/*" multiple type="file" @change="handlePhotoChange" />
        </label>
        <p class="muted">{{ localeStore.t('facilities.photoLimit') }}</p>
        <p v-if="compressionReport" class="muted">{{ compressionReport }}</p>
        <div v-if="photoPreviews.length" class="photo-grid">
          <figure v-for="photo in photoPreviews" :key="photo.id" class="photo-card">
            <button type="button" class="photo-card-btn" @click="openLightbox(photo)">
              <img :src="store.photoSrc(photo)" :alt="localeStore.t('facilities.facilityPhoto')" />
            </button>
            <button type="button" class="danger photo-card-delete" @click="removePreviewPhoto(photo.id)">{{ localeStore.t('common.delete') }}</button>
          </figure>
        </div>

        <div class="row-actions">
          <button type="submit">{{ editingId ? localeStore.t('common.change') : localeStore.t('common.add') }}</button>
          <button v-if="editingId" class="ghost" type="button" @click="clearForm">{{ localeStore.t('common.cancel') }}</button>
        </div>
      </form>
    </article>
    </Teleport>
  </div>
</template>
