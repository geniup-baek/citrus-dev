<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useFarmStore } from '../stores/farmStore'
import { useLocaleStore } from '../stores/localeStore'
import { useRecommendSettingsStore } from '../stores/recommendSettingsStore'
import { useAppPolicyStore } from '../stores/appPolicyStore'
import { useFarmMembersStore } from '../stores/farmMembersStore'
import { confirm } from '../composables/useConfirm'
import { useIsMobile } from '../composables/useIsMobile'
import { useLightbox } from '../composables/useLightbox'
import { useFilesToPreviews } from '../composables/usePhotoPreviews'

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
  editingId.value && store.state.ancillaries.some((a) => a.id === editingId.value)
    ? `#anc-form-slot-${editingId.value}`
    : '#anc-form-top',
)

const facilityTypeOptions = computed(() => store.state.appSettings?.ancillaryTypes ?? ['창고', '숙소', '사무실', '기타'])
const equipmentTypeOptions = computed(() => store.state.appSettings?.equipmentTypes ?? ['방제기', '트랙터', '기타'])
// 구분에 따라 유형 옵션을 전환
const typeOptions = computed(() => (form.category === '장비' ? equipmentTypeOptions.value : facilityTypeOptions.value))

const form = reactive({
  id: '',
  name: '',
  category: '시설',
  type: '',
  notes: '',
})

// 사진
const formPhotos = ref([])
const photoPreviews = ref([])
const compressionReport = ref('')
const { lightboxPhoto, openLightbox, closeLightbox } = useLightbox()
const { filesToPreviews } = useFilesToPreviews('ancillary.compressedReport')

function moved(arr, i, dir) {
  const j = i + dir
  if (j < 0 || j >= arr.length) return arr
  const res = [...arr]
  const tmp = res[i]
  res[i] = res[j]
  res[j] = tmp
  return res
}

function moveAncillary(i, dir) {
  store.reorderAncillaries(moved(store.state.ancillaries, i, dir))
}

async function confirmDeleteAncillary(item) {
  const ok = await confirm({ message: localeStore.t('confirm.ancillary', { name: item.name }) })
  if (ok) await store.removeAncillary(item.id)
}

// 시설·장비 전체 삭제 — 관리모드 동작 설정에서 "초기화 버튼: 표시"일 때만 노출된다.
async function resetAllAncillaries() {
  const n = store.state.ancillaries.length
  if (!n) return
  const ok = await confirm({
    title: localeStore.t('confirm.resetTitle'),
    message: localeStore.t('confirm.resetAncillaries', { n }),
    confirmLabel: localeStore.t('common.reset'),
  })
  if (!ok) return
  await store.resetAncillaries()
  closeForm()
}

// 구분 변경 시 현재 유형이 새 옵션에 없으면 첫 항목으로 재설정
watch(
  () => form.category,
  () => {
    if (!typeOptions.value.includes(form.type)) {
      form.type = typeOptions.value[0] ?? ''
    }
  },
)

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
  form.category = '시설'
  form.type = typeOptions.value[0] ?? ''
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

function editAncillary(item) {
  form.id = item.id
  form.name = item.name
  form.category = item.category === '장비' ? '장비' : '시설'
  form.type = item.type
  form.notes = item.notes
  formPhotos.value = [...(item.photos || [])]
  photoPreviews.value = []
  compressionReport.value = ''
  editingId.value = item.id
  showForm.value = true
  scrollToItem(`anc-form-slot-${item.id}`)
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

async function saveAncillary() {
  let uploaded
  try {
    uploaded = await store.savePhotos(photoPreviews.value)
  } catch (e) {
    console.error('[AncillaryPanel] 사진 업로드 실패', e)
    alert(localeStore.t('common.photoUploadFailed'))
    return
  }
  await store.upsertAncillary({
    id: form.id,
    name: form.name,
    category: form.category,
    type: form.type,
    notes: form.notes,
    photos: [...formPhotos.value, ...uploaded],
  })
  clearForm()
}
</script>

<template>
  <div v-if="lightboxPhoto" class="lightbox-overlay" @click="closeLightbox">
    <img :src="store.photoSrc(lightboxPhoto)" :alt="localeStore.t('ancillary.itemPhoto')" />
  </div>

  <div :class="['page-grid', showForm ? 'two-columns' : '']">
    <article>
      <div class="pip-header">
        <div class="pip-actions">
          <button v-if="!showForm && farmMembersStore.canWrite('ancillaries')" @click="openAdd">{{ localeStore.t('common.edit') }}</button>
          <template v-else-if="showForm">
            <button
              v-if="showResetButton && store.state.ancillaries.length > 0"
              class="danger"
              type="button"
              @click="resetAllAncillaries"
            >{{ localeStore.t('common.reset') }}</button>
            <button class="ghost" @click="closeForm">{{ localeStore.t('common.exitEdit') }}</button>
          </template>
        </div>
      </div>
      <div class="sort-filter-bar">
        <span class="summary-chip">{{ localeStore.t('common.totalCount', { n: store.state.ancillaries.length }) }}</span>
      </div>
      <div id="anc-form-top" class="mobile-form-slot"></div>
      <ul class="list clean">
        <li v-for="(item, i) in store.state.ancillaries" :key="item.id" class="list-item card-like">
          <div>
            <div class="task-card-top">
              <p class="item-title">{{ item.name }}</p>
              <span class="pill">{{ item.category === '장비' ? localeStore.t('ancillary.categoryEquipment') : localeStore.t('ancillary.categoryFacility') }}</span>
            </div>
            <p class="item-meta">{{ item.type }}</p>
            <p class="muted">{{ item.notes }}</p>
            <div v-if="item.photos?.length" class="photo-grid compact-grid">
              <figure v-for="photo in item.photos" :key="photo.id" class="photo-card">
                <button type="button" class="photo-card-btn" @click="openLightbox(photo)">
                  <img :src="store.photoSrc(photo)" :alt="localeStore.t('ancillary.itemPhoto')" />
                </button>
              </figure>
            </div>
          </div>
          <div v-if="showForm" class="row-actions">
            <button class="ghost" :disabled="i === 0" @click="moveAncillary(i, -1)">{{ localeStore.t('common.moveUp') }}</button>
            <button class="ghost" :disabled="i === store.state.ancillaries.length - 1" @click="moveAncillary(i, 1)">{{ localeStore.t('common.moveDown') }}</button>
            <button v-if="farmMembersStore.canWrite('ancillaries')" :class="{ ghost: editingId !== item.id }" @click="editAncillary(item)">{{ localeStore.t('common.edit') }}</button>
            <button v-if="farmMembersStore.canWrite('ancillaries')" class="danger" @click="confirmDeleteAncillary(item)">{{ localeStore.t('common.delete') }}</button>
          </div>
          <div :id="`anc-form-slot-${item.id}`" class="mobile-form-slot"></div>
        </li>
      </ul>
    </article>

    <Teleport v-if="showForm" :to="formTarget" :disabled="!isMobile">
    <article v-if="showForm" class="card">
      <h3>{{ editingId ? localeStore.t('ancillary.editTitle') : localeStore.t('ancillary.addTitle') }}</h3>
      <form class="stack-form" @submit.prevent="saveAncillary">
        <label>
          {{ localeStore.t('ancillary.category') }}
          <select v-model="form.category">
            <option value="시설">{{ localeStore.t('ancillary.categoryFacility') }}</option>
            <option value="장비">{{ localeStore.t('ancillary.categoryEquipment') }}</option>
          </select>
        </label>
        <label>
          {{ localeStore.t('ancillary.name') }}
          <input v-model="form.name" required type="text" :placeholder="localeStore.t('ancillary.name')" />
        </label>
        <label>
          {{ localeStore.t('ancillary.type') }}
          <select v-model="form.type">
            <option v-for="t in typeOptions" :key="t" :value="t">{{ t }}</option>
          </select>
        </label>
        <label>
          {{ localeStore.t('ancillary.notes') }}
          <textarea v-model="form.notes" rows="3" :placeholder="localeStore.t('ancillary.notesPlaceholder')" />
        </label>

        <template v-if="formPhotos.length">
          <p class="muted">{{ localeStore.t('ancillary.existingPhotos') }}</p>
          <div class="photo-grid">
            <figure v-for="photo in formPhotos" :key="photo.id" class="photo-card">
              <button type="button" class="photo-card-btn" @click="openLightbox(photo)">
                <img :src="store.photoSrc(photo)" :alt="localeStore.t('ancillary.itemPhoto')" />
              </button>
              <button type="button" class="danger photo-card-delete" @click="removeExistingPhoto(photo.id)">{{ localeStore.t('common.delete') }}</button>
            </figure>
          </div>
        </template>

        <label>
          {{ localeStore.t('ancillary.attachPhotos') }}
          <input accept="image/*" multiple type="file" @change="handlePhotoChange" />
        </label>
        <p class="muted">{{ localeStore.t('ancillary.photoLimit') }}</p>
        <p v-if="compressionReport" class="muted">{{ compressionReport }}</p>
        <div v-if="photoPreviews.length" class="photo-grid">
          <figure v-for="photo in photoPreviews" :key="photo.id" class="photo-card">
            <button type="button" class="photo-card-btn" @click="openLightbox(photo)">
              <img :src="store.photoSrc(photo)" :alt="localeStore.t('ancillary.itemPhoto')" />
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
