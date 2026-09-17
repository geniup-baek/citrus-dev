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

const store = useFarmStore()
const localeStore = useLocaleStore()
const recSettingsStore = useRecommendSettingsStore()
const policyStore = useAppPolicyStore()
const farmMembersStore = useFarmMembersStore()

const editingId = ref('')
const showForm = ref(false)

// 파일로 내보내기/불러오기 (다른 농장과 공유)
const importInput = ref(null)
const importMessage = ref('')
const importError = ref('')

// 초기화 버튼 — 시스템 관리 모드에서 기능을 "사용"으로 켜고, 이 농장에서 "표시"로 켠 경우에만 노출한다.
const showResetButton = computed(() =>
  policyStore.policy.enableResetFeature && recSettingsStore.settings.showResetButtons,
)

const { isMobile } = useIsMobile()
// 편집 대상이 목록에 있을 때만 그 항목 슬롯으로, 아니면 항상 존재하는 상단 호스트로(텔레포트 대상 null 방지)
const formTarget = computed(() =>
  editingId.value && store.state.usageGuides.some((g) => g.id === editingId.value)
    ? `#guide-form-slot-${editingId.value}`
    : '#guide-form-top',
)

const form = reactive({
  id: '',
  title: '',
  description: '',
})

const { lightboxPhoto, openLightbox, closeLightbox } = useLightbox()
const { filesToPreviews } = useFilesToPreviews('usageGuides.compressedReport')

// 작업 단계 인라인 패널 (편집 모드와 무관하게 항상 열람 가능 — 문제 탭의 "조치" 패턴과 동일).
// 패널을 펼치면 기본은 표시 모드이고, "편집" 버튼을 눌러야 단계 추가·수정·삭제·순서 변경이 가능해진다.
const expandedId = ref('')
const stepEditMode = ref(false)
const showAddStep = ref(false)
const stepText = ref('')
const stepPhotoPreviews = ref([])
const stepCompressionReport = ref('')

const editingStepId = ref('')
const editStepText = ref('')
const editStepPhotos = ref([])
const editStepNewPreviews = ref([])
const editStepCompressionReport = ref('')

function moved(arr, i, dir) {
  const j = i + dir
  if (j < 0 || j >= arr.length) return arr
  const res = [...arr]
  const tmp = res[i]
  res[i] = res[j]
  res[j] = tmp
  return res
}

function moveGuide(i, dir) {
  store.reorderUsageGuides(moved(store.state.usageGuides, i, dir))
}

function moveStep(guide, i, dir) {
  store.reorderUsageGuideSteps(guide.id, moved(guide.steps, i, dir))
}

async function confirmDeleteGuide(guide) {
  const ok = await confirm({
    message: `'${guide.title}' 사용법을 삭제할까요? 등록된 단계 ${guide.steps?.length || 0}개도 함께 삭제됩니다.`,
  })
  if (ok) {
    if (expandedId.value === guide.id) expandedId.value = ''
    await store.removeUsageGuide(guide.id)
  }
}

// 사용법 전체 삭제 — 관리모드 동작 설정에서 "초기화 버튼: 표시"일 때만 노출된다.
async function resetAllGuides() {
  const n = store.state.usageGuides.length
  if (!n) return
  const ok = await confirm({
    title: localeStore.t('confirm.resetTitle'),
    message: `사용법 ${n}건을 모두 삭제할까요?`,
    confirmLabel: localeStore.t('common.reset'),
  })
  if (!ok) return
  await store.resetUsageGuides()
  expandedId.value = ''
  closeForm()
}

// ── 파일로 내보내기/불러오기 ─────────────────────────────────────────────────
// 사진 본문까지 포함한 자기완결적 JSON 파일을 내려받는다 — 다른 농장에서 "불러오기"로
// 그대로 추가할 수 있다.
async function exportGuide(guide) {
  importMessage.value = ''
  importError.value = ''
  let payload
  try {
    payload = await store.exportUsageGuide(guide.id)
  } catch (e) {
    console.error('[UsageGuidePanel] 사용법 내보내기 실패', e)
    alert('사용법을 내보내지 못했습니다.')
    return
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `사용법-${guide.title || '제목없음'}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function triggerImport() {
  importMessage.value = ''
  importError.value = ''
  importInput.value?.click()
}

async function handleImportFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return

  importMessage.value = ''
  importError.value = ''
  try {
    const payload = JSON.parse(await file.text())
    if (!store.isValidUsageGuideFile(payload)) {
      importError.value = '올바른 사용법 파일이 아닙니다.'
      return
    }
    const title = await store.importUsageGuide(payload)
    importMessage.value = `'${title}' 사용법을 불러왔습니다.`
  } catch (e) {
    console.error('[UsageGuidePanel] 사용법 불러오기 실패', e)
    importError.value = '올바른 사용법 파일이 아닙니다.'
  }
}

// ── 사용법(가이드) 폼 ────────────────────────────────────────────────────────
function clearForm() {
  form.id = ''
  form.title = ''
  form.description = ''
  editingId.value = ''
}

function openAdd() {
  clearForm()
  showForm.value = true
}

function editGuide(guide) {
  form.id = guide.id
  form.title = guide.title
  form.description = guide.description || ''
  editingId.value = guide.id
  showForm.value = true
  scrollToItem(`guide-form-slot-${guide.id}`)
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

async function saveGuide() {
  // steps 키는 새 항목일 때만 담는다 — 편집 시 이 키를 payload에 아예 넣지 않아야
  // store의 { ...기존, ...payload } 병합에서 기존 단계가 undefined로 덮여쓰이지 않는다.
  const payload = { id: form.id, title: form.title, description: form.description }
  if (!form.id) payload.steps = []
  await store.upsertUsageGuide(payload)
  clearForm()
}

// ── 작업 단계 패널 ───────────────────────────────────────────────────────────
function toggleStepPanel(guide) {
  if (expandedId.value === guide.id) {
    expandedId.value = ''
  } else {
    expandedId.value = guide.id
    stepEditMode.value = false // 펼칠 때는 항상 표시 모드로 시작
    showAddStep.value = false
    stepText.value = ''
    stepPhotoPreviews.value = []
    stepCompressionReport.value = ''
    cancelEditStep()
  }
}

function exitStepEditMode() {
  stepEditMode.value = false
  cancelAddStep()
  cancelEditStep()
}

function openAddStep() {
  showAddStep.value = true
}

function cancelAddStep() {
  showAddStep.value = false
  stepText.value = ''
  stepPhotoPreviews.value = []
  stepCompressionReport.value = ''
}

// 파일 입력을 열 때마다(모바일에서는 한 번에 카메라로 한 장씩 찍는 경우가 많다)
// 이전 선택을 지우지 않고 이어 붙인다 — 최대 5장까지.
async function handleStepPhotoChange(event) {
  const files = Array.from(event.target.files || [])
  event.target.value = ''
  const room = 5 - stepPhotoPreviews.value.length
  if (room <= 0) return
  const { previews, report } = await filesToPreviews(files.slice(0, room))
  stepPhotoPreviews.value = [...stepPhotoPreviews.value, ...previews]
  stepCompressionReport.value = report
}

function removeStepPreviewPhoto(id) {
  stepPhotoPreviews.value = stepPhotoPreviews.value.filter((p) => p.id !== id)
}

async function recordStep(guide) {
  if (!stepText.value.trim()) return
  let photos
  try {
    photos = await store.savePhotos(stepPhotoPreviews.value)
  } catch (e) {
    console.error('[UsageGuidePanel] 사진 업로드 실패', e)
    alert(localeStore.t('common.photoUploadFailed'))
    return
  }
  await store.addUsageGuideStep(guide.id, stepText.value, photos)
  cancelAddStep()
}

function startEditStep(step) {
  editingStepId.value = step.id
  editStepText.value = step.text
  editStepPhotos.value = [...(step.photos || [])]
  editStepNewPreviews.value = []
  editStepCompressionReport.value = ''
}

function cancelEditStep() {
  editingStepId.value = ''
  editStepText.value = ''
  editStepPhotos.value = []
  editStepNewPreviews.value = []
  editStepCompressionReport.value = ''
}

function removeEditStepExistingPhoto(id) {
  editStepPhotos.value = editStepPhotos.value.filter((p) => p.id !== id)
}

async function handleEditStepPhotoChange(event) {
  const files = Array.from(event.target.files || [])
  event.target.value = ''
  const room = 5 - (editStepPhotos.value.length + editStepNewPreviews.value.length)
  if (room <= 0) return
  const { previews, report } = await filesToPreviews(files.slice(0, room))
  editStepNewPreviews.value = [...editStepNewPreviews.value, ...previews]
  editStepCompressionReport.value = report
}

function removeEditStepNewPhoto(id) {
  editStepNewPreviews.value = editStepNewPreviews.value.filter((p) => p.id !== id)
}

async function saveEditStep(guide) {
  if (!editingStepId.value || !editStepText.value.trim()) return
  let uploaded
  try {
    uploaded = await store.savePhotos(editStepNewPreviews.value)
  } catch (e) {
    console.error('[UsageGuidePanel] 사진 업로드 실패', e)
    alert(localeStore.t('common.photoUploadFailed'))
    return
  }
  const photos = [...editStepPhotos.value, ...uploaded]
  await store.updateUsageGuideStep(guide.id, editingStepId.value, {
    text: editStepText.value,
    photos,
  })
  cancelEditStep()
}

async function deleteStep(guide, step) {
  const ok = await confirm({ message: '이 단계를 삭제합니다. 되돌릴 수 없습니다.' })
  if (!ok) return
  await store.removeUsageGuideStep(guide.id, step.id)
  if (editingStepId.value === step.id) cancelEditStep()
}
</script>

<template>
  <div v-if="lightboxPhoto" class="lightbox-overlay" @click="closeLightbox">
    <img :src="store.photoSrc(lightboxPhoto)" :alt="localeStore.t('usageGuides.stepPhoto')" />
  </div>

  <div :class="['page-grid', showForm ? 'two-columns' : '']">
    <article>
      <div class="pip-header">
        <div class="pip-actions">
          <button
            v-if="showForm && showResetButton && store.state.usageGuides.length > 0"
            class="danger"
            type="button"
            @click="resetAllGuides"
          >{{ localeStore.t('common.reset') }}</button>
          <button v-if="farmMembersStore.canWrite('usageGuides')" class="ghost" type="button" @click="triggerImport">{{ localeStore.t('usageGuides.importFile') }}</button>
          <input ref="importInput" accept="application/json,.json" type="file" style="display: none;" @change="handleImportFile" />
          <button v-if="!showForm && farmMembersStore.canWrite('usageGuides')" @click="openAdd">{{ localeStore.t('common.edit') }}</button>
          <button v-else-if="showForm" class="ghost" @click="closeForm">{{ localeStore.t('common.exitEdit') }}</button>
        </div>
      </div>
      <p v-if="importMessage" class="muted text-sm">{{ importMessage }}</p>
      <p v-if="importError" class="error-msg">{{ importError }}</p>
      <div class="sort-filter-bar">
        <span class="summary-chip">{{ localeStore.t('common.totalCount', { n: store.state.usageGuides.length }) }}</span>
      </div>
      <div id="guide-form-top" class="mobile-form-slot"></div>

      <ul class="list clean">
        <li v-for="(guide, i) in store.state.usageGuides" :key="guide.id" class="list-item card-like">
          <div>
            <p class="item-title">{{ guide.title }}</p>
            <p v-if="guide.description" class="muted">{{ guide.description }}</p>
            <p class="item-meta">{{ localeStore.t('usageGuides.steps') }} {{ guide.steps?.length || 0 }}</p>
          </div>
          <div class="row-actions">
            <button :class="{ ghost: expandedId !== guide.id }" type="button" @click="toggleStepPanel(guide)">{{ localeStore.t('usageGuides.steps') }} {{ expandedId === guide.id ? '▲' : '▼' }}</button>
            <template v-if="showForm">
              <button class="ghost" type="button" @click="exportGuide(guide)">{{ localeStore.t('usageGuides.exportFile') }}</button>
              <template v-if="farmMembersStore.canWrite('usageGuides')">
                <button class="ghost" :disabled="i === 0" @click="moveGuide(i, -1)">{{ localeStore.t('common.moveUp') }}</button>
                <button class="ghost" :disabled="i === store.state.usageGuides.length - 1" @click="moveGuide(i, 1)">{{ localeStore.t('common.moveDown') }}</button>
                <button :class="{ ghost: editingId !== guide.id }" @click="editGuide(guide)">{{ localeStore.t('common.edit') }}</button>
                <button class="danger" @click="confirmDeleteGuide(guide)">{{ localeStore.t('common.delete') }}</button>
              </template>
            </template>
          </div>

          <!-- 작업 단계 인라인 패널: 기본은 표시 모드, "편집" 버튼을 눌러야 추가·수정·삭제·순서 변경이 가능하다 -->
          <div v-if="expandedId === guide.id" class="log-panel">
            <div class="row-actions align-start log-history-label">
              <p class="muted" style="margin: 0;">{{ localeStore.t('usageGuides.steps') }}</p>
              <span v-if="farmMembersStore.canWrite('usageGuides')" class="row-actions">
                <button v-if="stepEditMode && !showAddStep" class="ghost compact-btn" type="button" @click="openAddStep">{{ localeStore.t('usageGuides.addStepTrigger') }}</button>
                <button v-if="!stepEditMode" class="ghost compact-btn" type="button" @click="stepEditMode = true">{{ localeStore.t('common.edit') }}</button>
                <button v-else class="ghost compact-btn" type="button" @click="exitStepEditMode">{{ localeStore.t('common.exitEdit') }}</button>
              </span>
            </div>

            <form v-if="showAddStep" class="log-panel-form" @submit.prevent="recordStep(guide)">
              <textarea v-model="stepText" required rows="2" :placeholder="localeStore.t('usageGuides.stepPlaceholder')" />
              <label class="step-photo-label">{{ localeStore.t('usageGuides.attachPhotos') }}
                <input accept="image/*" multiple type="file" @change="handleStepPhotoChange" />
              </label>
              <p class="muted text-sm">{{ localeStore.t('usageGuides.photoLimit') }}</p>
              <p v-if="stepCompressionReport" class="muted text-sm">{{ stepCompressionReport }}</p>
              <div v-if="stepPhotoPreviews.length" class="photo-grid">
                <figure v-for="photo in stepPhotoPreviews" :key="photo.id" class="photo-card">
                  <button type="button" class="photo-card-btn" @click="openLightbox(photo)">
                    <img :src="store.photoSrc(photo)" :alt="localeStore.t('usageGuides.stepPhoto')" />
                  </button>
                  <button type="button" class="danger photo-card-delete" @click="removeStepPreviewPhoto(photo.id)">{{ localeStore.t('common.delete') }}</button>
                </figure>
              </div>
              <div class="row-actions">
                <button type="submit">{{ localeStore.t('usageGuides.addStep') }}</button>
                <button class="ghost" type="button" @click="cancelAddStep">{{ localeStore.t('common.cancel') }}</button>
              </div>
            </form>

            <ol class="list clean compact numbered-steps">
              <li v-for="(step, si) in guide.steps" :key="step.id" class="list-item">
                <template v-if="editingStepId !== step.id">
                  <div class="log-entry">
                    <span class="log-entry-info">
                      <span class="item-meta">{{ si + 1 }}단계</span>
                      <span>{{ step.text }}</span>
                    </span>
                    <span v-if="stepEditMode" class="log-entry-actions">
                      <button class="ghost icon-btn" type="button" :disabled="si === 0" :title="localeStore.t('common.moveUp')" :aria-label="localeStore.t('common.moveUp')" @click="moveStep(guide, si, -1)">↑</button>
                      <button class="ghost icon-btn" type="button" :disabled="si === guide.steps.length - 1" :title="localeStore.t('common.moveDown')" :aria-label="localeStore.t('common.moveDown')" @click="moveStep(guide, si, 1)">↓</button>
                      <button class="ghost icon-btn" type="button" :title="localeStore.t('common.edit')" :aria-label="localeStore.t('common.edit')" @click="startEditStep(step)">✎</button>
                      <button class="danger icon-btn" type="button" :title="localeStore.t('common.delete')" :aria-label="localeStore.t('common.delete')" @click="deleteStep(guide, step)">✕</button>
                    </span>
                  </div>
                  <div v-if="step.photos?.length" class="photo-grid compact-grid">
                    <figure v-for="photo in step.photos" :key="photo.id" class="photo-card">
                      <button type="button" class="photo-card-btn" @click="openLightbox(photo)">
                        <img :src="store.photoSrc(photo)" :alt="localeStore.t('usageGuides.stepPhoto')" />
                      </button>
                    </figure>
                  </div>
                </template>
                <template v-else>
                  <p class="item-meta">{{ si + 1 }}단계</p>
                  <form class="stack-form" @submit.prevent="saveEditStep(guide)">
                    <textarea v-model="editStepText" required rows="2" />

                    <template v-if="editStepPhotos.length">
                      <p class="muted text-sm">{{ localeStore.t('usageGuides.existingPhotos') }}</p>
                      <div class="photo-grid">
                        <figure v-for="photo in editStepPhotos" :key="photo.id" class="photo-card">
                          <button type="button" class="photo-card-btn" @click="openLightbox(photo)">
                            <img :src="store.photoSrc(photo)" :alt="localeStore.t('usageGuides.stepPhoto')" />
                          </button>
                          <button type="button" class="danger photo-card-delete" @click="removeEditStepExistingPhoto(photo.id)">{{ localeStore.t('common.delete') }}</button>
                        </figure>
                      </div>
                    </template>

                    <label class="step-photo-label">{{ localeStore.t('usageGuides.attachPhotos') }}
                      <input accept="image/*" multiple type="file" @change="handleEditStepPhotoChange" />
                    </label>
                    <p v-if="editStepCompressionReport" class="muted text-sm">{{ editStepCompressionReport }}</p>
                    <div v-if="editStepNewPreviews.length" class="photo-grid">
                      <figure v-for="photo in editStepNewPreviews" :key="photo.id" class="photo-card">
                        <button type="button" class="photo-card-btn" @click="openLightbox(photo)">
                          <img :src="store.photoSrc(photo)" :alt="localeStore.t('usageGuides.stepPhoto')" />
                        </button>
                        <button type="button" class="danger photo-card-delete" @click="removeEditStepNewPhoto(photo.id)">{{ localeStore.t('common.delete') }}</button>
                      </figure>
                    </div>

                    <div class="row-actions">
                      <button type="submit">{{ localeStore.t('common.change') }}</button>
                      <button class="ghost" type="button" @click="cancelEditStep">{{ localeStore.t('common.cancel') }}</button>
                    </div>
                  </form>
                </template>
              </li>
              <li v-if="!guide.steps?.length" class="muted">{{ localeStore.t('usageGuides.noSteps') }}</li>
            </ol>
          </div>
          <div :id="`guide-form-slot-${guide.id}`" class="mobile-form-slot"></div>
        </li>
        <li v-if="!store.state.usageGuides.length" class="muted">{{ localeStore.t('usageGuides.noGuides') }}</li>
      </ul>
    </article>

    <Teleport v-if="showForm" :to="formTarget" :disabled="!isMobile">
    <article v-if="showForm" class="card">
      <h3>{{ editingId ? localeStore.t('usageGuides.editTitle') : localeStore.t('usageGuides.addTitle') }}</h3>
      <form class="stack-form" @submit.prevent="saveGuide">
        <label>
          {{ localeStore.t('usageGuides.guideTitle') }}
          <input v-model="form.title" required type="text" :placeholder="localeStore.t('usageGuides.guideTitlePlaceholder')" />
        </label>
        <label>
          {{ localeStore.t('usageGuides.description') }}
          <textarea v-model="form.description" rows="3" :placeholder="localeStore.t('usageGuides.descriptionPlaceholder')" />
        </label>

        <div class="row-actions">
          <button type="submit">{{ editingId ? localeStore.t('common.change') : localeStore.t('common.add') }}</button>
          <button v-if="editingId" class="ghost" type="button" @click="clearForm">{{ localeStore.t('common.cancel') }}</button>
        </div>
      </form>
    </article>
    </Teleport>
  </div>
</template>

<style scoped>
.numbered-steps { list-style: none; margin: 0; padding: 0; }
</style>
