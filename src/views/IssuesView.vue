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

// 초기화 버튼 — 시스템 관리 모드에서 기능을 "사용"으로 켜고, 이 농장에서 "표시"로 켠 경우에만 노출한다.
const showResetButton = computed(() =>
  policyStore.policy.enableResetFeature && recSettingsStore.settings.showResetButtons,
)
const { lightboxPhoto, openLightbox, closeLightbox } = useLightbox()
const { filesToPreviews } = useFilesToPreviews('issues.compressedReport')

const { isMobile } = useIsMobile()
const formOpen = ref(false) // 폼(추가/편집) 표시 여부 — 토글로 닫으면 추가 폼도 숨긴다
// 편집 대상이 목록에 있을 때만 그 항목 슬롯으로, 아니면 상단 호스트로(텔레포트 대상 null 방지)
const formTarget = computed(() =>
  editingId.value && store.state.issues.some((i) => i.id === editingId.value)
    ? `#issue-form-slot-${editingId.value}`
    : '#issue-form-top',
)

const issueForm = reactive({
  title: '',
  greenhouseId: '',
  occurredAt: '',
  status: '조사중',
  symptoms: '',
})

const photoFiles = ref([])
const photoPreviews = ref([])
const compressionReport = ref('')
const recommendationQuery = ref('')

// 해결 기록 인라인 패널
const expandedId = ref('')
const showAddLog = ref(false)
const stepNote = ref('')

// 해결 기록 사진
const stepPhotoPreviews = ref([])
const stepCompressionReport = ref('')

// 해결 로그 편집
const editingStepId = ref('')
const editStepNote = ref('')
const editStepPhotos = ref([])
const editStepNewPreviews = ref([])
const editStepCompressionReport = ref('')

const editingIssue = computed(() =>
  store.state.issues.find((issue) => issue.id === editingId.value),
)

const recommendations = computed(() => {
  const derivedQuery = recommendationQuery.value.trim() || issueForm.symptoms.trim()
  const queryPhotos = photoPreviews.value.map((photo) => ({
    name: photo.name,
    contentType: photo.contentType,
    width: photo.width,
    height: photo.height,
    size: photo.size,
  }))
  if (!derivedQuery && !queryPhotos.length) return []
  return store.suggestSimilarIssues({ query: derivedQuery, photos: queryPhotos })
})

function greenhouseName(greenhouseId) {
  return (
    store.state.facilities.find((facility) => facility.id === greenhouseId)?.name ||
    localeStore.t('common.unknown')
  )
}


const ISSUE_STATUS_ORDER = ['조사중', '대응중', '해결']

async function cycleIssueStatus(issue) {
  const idx = ISSUE_STATUS_ORDER.indexOf(issue.status)
  const next = ISSUE_STATUS_ORDER[(idx + 1) % ISSUE_STATUS_ORDER.length]
  await store.upsertIssue({ ...issue, status: next })
}

async function handlePhotoChange(event) {
  const files = Array.from(event.target.files || [])
  photoFiles.value = files.slice(0, 5)
  const { previews, report } = await filesToPreviews(photoFiles.value)
  photoPreviews.value = previews
  compressionReport.value = report
}

function removePreviewPhoto(id) {
  photoPreviews.value = photoPreviews.value.filter((p) => p.id !== id)
}

async function removeExistingPhoto(photoId) {
  if (!editingIssue.value) return
  const ok = await confirm({ message: '첨부된 사진을 삭제합니다. 되돌릴 수 없습니다.' })
  if (!ok) return
  await store.upsertIssue({
    ...editingIssue.value,
    photos: editingIssue.value.photos.filter((p) => p.id !== photoId),
  })
}

function clearForm() {
  issueForm.title = ''
  issueForm.greenhouseId = store.state.facilities[0]?.id || ''
  issueForm.occurredAt = new Date().toISOString().slice(0, 10)
  issueForm.status = '조사중'
  issueForm.symptoms = ''
  photoFiles.value = []
  photoPreviews.value = []
  compressionReport.value = ''
  editingId.value = ''
  cancelEditStep()
}

function editIssue(issue) {
  // 이미 이 문제 편집 중이면 그대로 둔다(재클릭해도 닫지 않음)
  if (editingId.value === issue.id) return
  expandedId.value = '' // 조치 패널과 상호 배타
  formOpen.value = true
  editingId.value = issue.id
  issueForm.title = issue.title
  issueForm.greenhouseId = issue.greenhouseId
  issueForm.occurredAt = issue.occurredAt
  issueForm.status = issue.status
  issueForm.symptoms = issue.symptoms
  photoFiles.value = []
  photoPreviews.value = []
  compressionReport.value = ''
  cancelEditStep()
  scrollToItem(`issue-form-slot-${issue.id}`)
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
  formOpen.value = false
}


async function confirmDeleteIssue(issue) {
  const steps = (issue.resolutionSteps || []).length
  const ok = await confirm({ message: localeStore.t('confirm.issue', { title: issue.title, steps }) })
  if (ok) await store.removeIssue(issue.id)
}

// 문제 전체 삭제 — 관리모드 동작 설정에서 "초기화 버튼: 표시"일 때만 노출된다.
async function resetAllIssues() {
  const n = store.state.issues.length
  if (!n) return
  const ok = await confirm({
    title: localeStore.t('confirm.resetTitle'),
    message: localeStore.t('confirm.resetIssues', { n }),
    confirmLabel: localeStore.t('common.reset'),
  })
  if (!ok) return
  await store.resetIssues()
  expandedId.value = ''
  closeForm()
}

async function saveIssue() {
  let newPhotos
  try {
    newPhotos = await store.savePhotos(photoPreviews.value)
  } catch (e) {
    console.error('[IssuesView] 사진 업로드 실패', e)
    alert(localeStore.t('common.photoUploadFailed'))
    return
  }

  const existingPhotos = editingIssue.value?.photos || []
  const existingSteps = editingIssue.value?.resolutionSteps || []

  await store.upsertIssue({
    id: editingId.value || undefined,
    title: issueForm.title,
    greenhouseId: issueForm.greenhouseId,
    occurredAt: issueForm.occurredAt,
    status: issueForm.status,
    symptoms: issueForm.symptoms,
    resolutionSteps: existingSteps,
    photos: [...existingPhotos, ...newPhotos],
  })

  clearForm()
}

function toggleLogPanel(issue) {
  if (expandedId.value === issue.id) {
    expandedId.value = ''
  } else {
    if (editingId.value) clearForm() // 편집 폼과 상호 배타
    formOpen.value = false
    expandedId.value = issue.id
    showAddLog.value = false
    stepNote.value = ''
    stepPhotoPreviews.value = []
    stepCompressionReport.value = ''
    cancelEditStep()
  }
}

function openAddLog() {
  showAddLog.value = true
}

function cancelAddLog() {
  showAddLog.value = false
  stepNote.value = ''
  stepPhotoPreviews.value = []
  stepCompressionReport.value = ''
}

async function handleStepPhotoChange(event) {
  const files = Array.from(event.target.files || []).slice(0, 5)
  const { previews, report } = await filesToPreviews(files)
  stepPhotoPreviews.value = previews
  stepCompressionReport.value = report
}

function removeStepPreviewPhoto(id) {
  stepPhotoPreviews.value = stepPhotoPreviews.value.filter((p) => p.id !== id)
}

async function recordStep(issue) {
  if (!stepNote.value.trim()) return
  let photos
  try {
    photos = await store.savePhotos(stepPhotoPreviews.value)
  } catch (e) {
    console.error('[IssuesView] 사진 업로드 실패', e)
    alert(localeStore.t('common.photoUploadFailed'))
    return
  }
  await store.addIssueResolutionStep(issue.id, stepNote.value, photos)
  showAddLog.value = false
  stepNote.value = ''
  stepPhotoPreviews.value = []
  stepCompressionReport.value = ''
}

function stepKey(step) {
  return step.id || step.date
}

function startEditStep(step) {
  editingStepId.value = stepKey(step)
  editStepNote.value = step.note
  editStepPhotos.value = [...(step.photos || [])]
  editStepNewPreviews.value = []
  editStepCompressionReport.value = ''
}

function cancelEditStep() {
  editingStepId.value = ''
  editStepNote.value = ''
  editStepPhotos.value = []
  editStepNewPreviews.value = []
  editStepCompressionReport.value = ''
}

function removeEditStepExistingPhoto(id) {
  editStepPhotos.value = editStepPhotos.value.filter((p) => p.id !== id)
}

async function handleEditStepPhotoChange(event) {
  const files = Array.from(event.target.files || []).slice(0, 5)
  const { previews, report } = await filesToPreviews(files)
  editStepNewPreviews.value = previews
  editStepCompressionReport.value = report
}

function removeEditStepNewPhoto(id) {
  editStepNewPreviews.value = editStepNewPreviews.value.filter((p) => p.id !== id)
}

async function saveEditStep(issue) {
  if (!editingStepId.value || !editStepNote.value.trim()) return
  let uploaded
  try {
    uploaded = await store.savePhotos(editStepNewPreviews.value)
  } catch (e) {
    console.error('[IssuesView] 사진 업로드 실패', e)
    alert(localeStore.t('common.photoUploadFailed'))
    return
  }
  const photos = [...editStepPhotos.value, ...uploaded]
  await store.updateIssueResolutionStep(issue.id, editingStepId.value, {
    note: editStepNote.value,
    photos,
  })
  cancelEditStep()
}

async function deleteStep(issue, step) {
  const ok = await confirm({ message: '이 해결 단계를 삭제합니다. 되돌릴 수 없습니다.' })
  if (!ok) return
  await store.removeIssueResolutionStep(issue.id, stepKey(step))
  if (editingStepId.value === stepKey(step)) cancelEditStep()
}

function formatStepDate(dateStr) {
  try {
    return new Date(dateStr).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return dateStr
  }
}

clearForm()
</script>

<template>
  <div v-if="lightboxPhoto" class="lightbox-overlay" @click="closeLightbox">
    <img :src="store.photoSrc(lightboxPhoto)" :alt="localeStore.t('issues.issueEvidence')" />
  </div>

  <section :class="['page-grid', showForm && formOpen ? 'two-columns' : '']">
    <article class="card">
      <div class="row-actions align-start">
        <h2>{{ localeStore.t('issues.issueHistory') }}</h2>
        <!-- 버튼은 한 묶음으로 감싼다 — align-start(space-between) 아래서 낱개로 두면 가운데로 흩어진다. -->
        <div class="row-actions">
          <button
            v-if="showForm && showResetButton && store.state.issues.length > 0"
            class="danger"
            type="button"
            @click="resetAllIssues"
          >{{ localeStore.t('common.reset') }}</button>
          <button v-if="!showForm && farmMembersStore.canWrite('issues')" @click="showForm = true; formOpen = true">{{ localeStore.t('common.edit') }}</button>
          <button v-else-if="showForm" class="ghost" @click="closeForm">{{ localeStore.t('common.exitEdit') }}</button>
        </div>
      </div>
      <div class="sort-filter-bar">
        <span class="summary-chip">{{ localeStore.t('common.totalCount', { n: store.state.issues.length }) }}</span>
      </div>
      <div id="issue-form-top" class="mobile-form-slot"></div>
      <ul class="list clean">
        <li v-for="issue in store.state.issues" :key="issue.id" class="list-item card-like">
          <div>
            <p class="item-title">{{ issue.title }}</p>
            <p class="item-meta">{{ greenhouseName(issue.greenhouseId) }} · {{ issue.occurredAt }}</p>
            <p class="muted">{{ issue.symptoms }}</p>
            <div v-if="issue.photos?.length" class="photo-grid compact-grid">
              <figure v-for="photo in issue.photos" :key="photo.id" class="photo-card">
                <button type="button" class="photo-card-btn" @click="openLightbox(photo)">
                  <img :src="store.photoSrc(photo)" :alt="localeStore.t('issues.issueEvidence')" />
                </button>
              </figure>
            </div>
          </div>
          <div class="row-actions">
            <button class="pill" :class="{ danger: issue.status !== '해결' }" :title="localeStore.t('tasks.statusChange')" @click="cycleIssueStatus(issue)">{{ issue.status }}</button>
            <button :class="{ ghost: expandedId !== issue.id }" type="button" @click="toggleLogPanel(issue)">{{ localeStore.t('issues.resolution') }} {{ expandedId === issue.id ? '▲' : '▼' }}</button>
            <template v-if="showForm && farmMembersStore.canWrite('issues')">
              <button :class="{ ghost: editingId !== issue.id }" @click="editIssue(issue)">{{ localeStore.t('common.edit') }}</button>
              <button class="danger" @click="confirmDeleteIssue(issue)">{{ localeStore.t('common.delete') }}</button>
            </template>
          </div>

          <!-- 해결 기록 인라인 패널 -->
          <div v-if="expandedId === issue.id" class="log-panel">
            <div class="row-actions align-start log-history-label">
              <p class="muted" style="margin: 0;">{{ localeStore.t('issues.steps') }}</p>
              <button v-if="!showAddLog && farmMembersStore.canWrite('issues')" class="ghost compact-btn" type="button" @click="openAddLog">{{ localeStore.t('issues.addStepTrigger') }}</button>
            </div>

            <form v-if="showAddLog" class="log-panel-form" @submit.prevent="recordStep(issue)">
              <input v-model="stepNote" type="text" :placeholder="localeStore.t('issues.newResolutionStep')" />
              <label class="step-photo-label">{{ localeStore.t('issues.attachPhotos') }}
                <input accept="image/*" multiple type="file" @change="handleStepPhotoChange" />
              </label>
              <p v-if="stepCompressionReport" class="muted text-sm">{{ stepCompressionReport }}</p>
              <div v-if="stepPhotoPreviews.length" class="photo-grid">
                <figure v-for="photo in stepPhotoPreviews" :key="photo.id" class="photo-card">
                  <button type="button" class="photo-card-btn" @click="openLightbox(photo)">
                    <img :src="store.photoSrc(photo)" :alt="localeStore.t('issues.issueEvidence')" />
                  </button>
                  <button type="button" class="danger photo-card-delete" @click="removeStepPreviewPhoto(photo.id)">{{ localeStore.t('common.delete') }}</button>
                </figure>
              </div>
              <div class="row-actions">
                <button type="submit">{{ localeStore.t('issues.addStep') }}</button>
                <button class="ghost" type="button" @click="cancelAddLog">{{ localeStore.t('common.cancel') }}</button>
              </div>
            </form>

            <ul class="list clean compact">
              <li v-for="step in issue.resolutionSteps" :key="stepKey(step)" class="list-item">
                <template v-if="editingStepId !== stepKey(step)">
                  <div class="log-entry">
                    <span class="log-entry-info">
                      <span class="item-meta">{{ formatStepDate(step.date) }}</span>
                      <span>{{ step.note }}</span>
                    </span>
                    <span v-if="farmMembersStore.canWrite('issues')" class="log-entry-actions">
                      <button class="ghost icon-btn" type="button" :title="localeStore.t('common.edit')" :aria-label="localeStore.t('common.edit')" @click="startEditStep(step)">✎</button>
                      <button class="danger icon-btn" type="button" :title="localeStore.t('common.delete')" :aria-label="localeStore.t('common.delete')" @click="deleteStep(issue, step)">✕</button>
                    </span>
                  </div>
                  <div v-if="step.photos?.length" class="photo-grid compact-grid">
                    <figure v-for="photo in step.photos" :key="photo.id" class="photo-card">
                      <button type="button" class="photo-card-btn" @click="openLightbox(photo)">
                        <img :src="store.photoSrc(photo)" :alt="localeStore.t('issues.issueEvidence')" />
                      </button>
                    </figure>
                  </div>
                </template>
                <template v-else>
                  <p class="item-meta">{{ formatStepDate(step.date) }}</p>
                  <form class="stack-form" @submit.prevent="saveEditStep(issue)">
                    <textarea v-model="editStepNote" required rows="3" />

                    <template v-if="editStepPhotos.length">
                      <p class="muted text-sm">{{ localeStore.t('issues.existingPhotos') }}</p>
                      <div class="photo-grid">
                        <figure v-for="photo in editStepPhotos" :key="photo.id" class="photo-card">
                          <button type="button" class="photo-card-btn" @click="openLightbox(photo)">
                            <img :src="store.photoSrc(photo)" :alt="localeStore.t('issues.issueEvidence')" />
                          </button>
                          <button type="button" class="danger photo-card-delete" @click="removeEditStepExistingPhoto(photo.id)">{{ localeStore.t('common.delete') }}</button>
                        </figure>
                      </div>
                    </template>

                    <label class="step-photo-label">{{ localeStore.t('issues.attachPhotos') }}
                      <input accept="image/*" multiple type="file" @change="handleEditStepPhotoChange" />
                    </label>
                    <p v-if="editStepCompressionReport" class="muted text-sm">{{ editStepCompressionReport }}</p>
                    <div v-if="editStepNewPreviews.length" class="photo-grid">
                      <figure v-for="photo in editStepNewPreviews" :key="photo.id" class="photo-card">
                        <button type="button" class="photo-card-btn" @click="openLightbox(photo)">
                          <img :src="store.photoSrc(photo)" :alt="localeStore.t('issues.issueEvidence')" />
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
              <li v-if="!issue.resolutionSteps?.length" class="muted">{{ localeStore.t('issues.noSteps') }}</li>
            </ul>
          </div>
          <div :id="`issue-form-slot-${issue.id}`" class="mobile-form-slot"></div>
        </li>
      </ul>
    </article>

    <Teleport v-if="showForm && formOpen" :to="formTarget" :disabled="!isMobile">
    <article v-if="showForm && formOpen" class="card">
      <h2>{{ editingId ? localeStore.t('issues.editTitle') : localeStore.t('issues.recordIssue') }}</h2>
      <form class="stack-form" @submit.prevent="saveIssue">
        <label>
          {{ localeStore.t('issues.issueTitle') }}
          <input v-model="issueForm.title" required type="text" :placeholder="localeStore.t('issues.issueTitlePlaceholder')" />
        </label>
        <label>
          {{ localeStore.t('issues.greenhouse') }}
          <select v-model="issueForm.greenhouseId" required>
            <option v-for="facility in store.state.facilities" :key="facility.id" :value="facility.id">
              {{ facility.name }}
            </option>
          </select>
        </label>
        <label>
          {{ localeStore.t('issues.dateObserved') }}
          <input v-model="issueForm.occurredAt" required type="date" />
        </label>
        <label>
          {{ localeStore.t('issues.status') }}
          <select v-model="issueForm.status">
            <option value="조사중">{{ localeStore.t('issues.statusInvestigating') }}</option>
            <option value="대응중">{{ localeStore.t('issues.statusMitigating') }}</option>
            <option value="해결">{{ localeStore.t('issues.statusResolved') }}</option>
          </select>
        </label>
        <label>
          {{ localeStore.t('issues.symptoms') }}
          <textarea v-model="issueForm.symptoms" required rows="4" />
        </label>

        <template v-if="editingIssue?.photos?.length">
          <p class="muted">{{ localeStore.t('issues.existingPhotos') }}</p>
          <div class="photo-grid">
            <figure v-for="photo in editingIssue.photos" :key="photo.id" class="photo-card">
              <button type="button" class="photo-card-btn" @click="openLightbox(photo)">
                <img :src="store.photoSrc(photo)" :alt="localeStore.t('issues.issueEvidence')" />
              </button>
              <button type="button" class="danger photo-card-delete" @click="removeExistingPhoto(photo.id)">{{ localeStore.t('common.delete') }}</button>
            </figure>
          </div>
        </template>

        <label>
          {{ localeStore.t('issues.attachPhotos') }}
          <input accept="image/*" multiple type="file" @change="handlePhotoChange" />
        </label>
        <p class="muted">{{ localeStore.t('issues.photoLimit') }}</p>
        <p v-if="compressionReport" class="muted">{{ compressionReport }}</p>
        <div v-if="photoPreviews.length" class="photo-grid">
          <figure v-for="photo in photoPreviews" :key="photo.id" class="photo-card">
            <button type="button" class="photo-card-btn" @click="openLightbox(photo)">
              <img :src="store.photoSrc(photo)" :alt="localeStore.t('issues.issueEvidence')" />
            </button>
            <button type="button" class="danger photo-card-delete" @click="removePreviewPhoto(photo.id)">{{ localeStore.t('common.delete') }}</button>
          </figure>
        </div>

        <div class="row-actions">
          <button type="submit">{{ editingId ? localeStore.t('common.change') : localeStore.t('common.add') }}</button>
          <button v-if="editingId" class="ghost" type="button" @click="clearForm">{{ localeStore.t('common.cancel') }}</button>
        </div>
      </form>

      <h3 class="section-title">{{ localeStore.t('issues.findSimilar') }}</h3>
      <label>
        {{ localeStore.t('issues.searchText') }}
        <textarea v-model="recommendationQuery" rows="3" :placeholder="localeStore.t('issues.searchPlaceholder')" />
      </label>
      <ul class="list clean compact">
        <li v-for="entry in recommendations" :key="entry.issue.id" class="list-item">
          <p class="item-title">{{ localeStore.t('issues.scoreLabel', { title: entry.issue.title, score: entry.score.toFixed(2) }) }}</p>
          <p class="item-meta">{{ entry.issue.symptoms }}</p>
          <p class="muted">{{ localeStore.t('issues.textPhotoScore', { text: entry.textScore.toFixed(2), photo: entry.photoScore.toFixed(2) }) }}</p>
          <p class="muted">
            {{ localeStore.t('issues.steps') }}: {{ (entry.issue.resolutionSteps || []).map((step) => step.note).join(' | ') || localeStore.t('issues.noSteps') }}
          </p>
        </li>
      </ul>
    </article>
    </Teleport>
  </section>
</template>
