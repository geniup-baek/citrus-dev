<script setup>
// 체크리스트 템플릿 관리 + 템플릿에서 작업 추가 — TasksView.vue 우측 패널의
// "체크리스트 템플릿" 서브탭(단일 작업/반복 규칙과 같은 레벨).
// 목록(checklistTemplates)·폼 상태·CRUD가 전부 이 안에서 끝나고 부모 화면의
// 선택/상세 상태와는 무관해(TaskSchedulerPanel과 같은 이유) 별도 컴포넌트로 뗄 수 있었다.
import { reactive, ref, computed } from 'vue'
import { format } from 'date-fns'
import { useFarmStore } from '../stores/farmStore'
import { useLocaleStore } from '../stores/localeStore'
import { useFarmMembersStore } from '../stores/farmMembersStore'
import { confirm } from '../composables/useConfirm'
import { uuid } from '../utils/uuid.js'

const store = useFarmStore()
const localeStore = useLocaleStore()
const farmMembersStore = useFarmMembersStore()

const taskCategories = computed(() => store.state.appSettings?.taskCategories ?? ['기타'])
const templates = computed(() => store.state.checklistTemplates || [])

// ── 템플릿에서 작업 추가 ─────────────────────────────────────────────────────
const selectedTemplateId = ref('')
const createDueDate = ref(format(new Date(), 'yyyy-MM-dd'))
const createResult = ref('')

async function createFromTemplate() {
  if (!selectedTemplateId.value || !createDueDate.value) return
  const tpl = templates.value.find((t) => t.id === selectedTemplateId.value)
  await store.createTaskFromChecklistTemplate(selectedTemplateId.value, createDueDate.value)
  createResult.value = tpl ? `'${tpl.title}' 작업이 추가됐습니다.` : ''
}

// ── 템플릿 관리(추가/편집/삭제) ───────────────────────────────────────────────
const templateForm = reactive({
  id: '',
  title: '',
  category: '',
  priority: '보통',
  notes: '',
  checklist: [], // [{ id, text }] — 편집 중에는 그냥 이 배열의 text를 직접 v-model로 바꾼다.
})
const templateEditingId = ref('')
const showTemplateForm = ref(false)
const newItemText = ref('')

function clearTemplateForm() {
  templateForm.id = ''
  templateForm.title = ''
  templateForm.category = taskCategories.value[0] ?? ''
  templateForm.priority = '보통'
  templateForm.notes = ''
  templateForm.checklist = []
  templateEditingId.value = ''
  newItemText.value = ''
}

function openNewTemplateForm() {
  clearTemplateForm()
  showTemplateForm.value = true
}

function editTemplate(tpl) {
  templateForm.id = tpl.id
  templateForm.title = tpl.title
  templateForm.category = tpl.category
  templateForm.priority = tpl.priority || '보통'
  templateForm.notes = tpl.notes || ''
  templateForm.checklist = (tpl.checklist || []).map((item) => ({ ...item }))
  templateEditingId.value = tpl.id
  showTemplateForm.value = true
}

function cancelTemplateForm() {
  clearTemplateForm()
  showTemplateForm.value = false
}

function addTemplateItem() {
  if (!newItemText.value.trim()) return
  templateForm.checklist.push({ id: uuid(), text: newItemText.value.trim() })
  newItemText.value = ''
}

function removeTemplateItem(id) {
  templateForm.checklist = templateForm.checklist.filter((item) => item.id !== id)
}

// 저장 전 폼 안에서만 다루는 순서라 되돌리기 대상도 아니고 저장할 때 그 순서 그대로
// 배열에 담겨 나가므로, 실제 작업의 체크리스트(reorderChecklistItems)처럼 스토어 액션이나
// 변경 이력이 따로 필요 없다 — 여기서 배열만 바꾸면 된다.
function moveTemplateItem(i, dir) {
  const j = i + dir
  if (j < 0 || j >= templateForm.checklist.length) return
  const arr = [...templateForm.checklist]
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
  templateForm.checklist = arr
}

async function saveTemplate() {
  if (!templateForm.title.trim() || !templateForm.checklist.length) return
  await store.upsertChecklistTemplate({
    id: templateForm.id,
    title: templateForm.title,
    category: templateForm.category,
    priority: templateForm.priority,
    notes: templateForm.notes,
    checklist: templateForm.checklist,
  })
  cancelTemplateForm()
}

async function confirmDeleteTemplate(tpl) {
  const ok = await confirm({ message: localeStore.t('confirm.checklistTemplate', { title: tpl.title }) })
  if (!ok) return
  await store.removeChecklistTemplate(tpl.id)
  if (templateEditingId.value === tpl.id) cancelTemplateForm()
  if (selectedTemplateId.value === tpl.id) selectedTemplateId.value = ''
}

// ── 파일로 내보내기/불러오기(다른 농장과 공유) — UsageGuidePanel과 같은 패턴 ────────
const importInput = ref(null)
const importMessage = ref('')
const importError = ref('')

function exportTemplate(tpl) {
  importMessage.value = ''
  importError.value = ''
  let payload
  try {
    payload = store.exportChecklistTemplate(tpl.id)
  } catch (e) {
    console.error('[TaskChecklistTemplatePanel] 템플릿 내보내기 실패', e)
    alert('템플릿을 내보내지 못했습니다.')
    return
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `체크리스트템플릿-${tpl.title || '제목없음'}.json`
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
    if (!store.isValidChecklistTemplateFile(payload)) {
      importError.value = '올바른 체크리스트 템플릿 파일이 아닙니다.'
      return
    }
    const title = await store.importChecklistTemplate(payload)
    importMessage.value = `'${title}' 템플릿을 불러왔습니다.`
  } catch (e) {
    console.error('[TaskChecklistTemplatePanel] 템플릿 불러오기 실패', e)
    importError.value = '올바른 체크리스트 템플릿 파일이 아닙니다.'
  }
}

clearTemplateForm()
</script>

<template>
  <p class="muted text-sm" style="margin-bottom: 0.75rem;">{{ localeStore.t('tasks.checklistTemplateDesc') }}</p>

  <!-- ① 템플릿에서 작업 추가 -->
  <form class="stack-form" style="margin-bottom: 1.25rem;" @submit.prevent="createFromTemplate">
    <label>{{ localeStore.t('tasks.checklistTemplateSelect') }}
      <select v-model="selectedTemplateId" required :disabled="!templates.length">
        <option value="" disabled>{{ localeStore.t('tasks.checklistTemplateSelectPlaceholder') }}</option>
        <option v-for="tpl in templates" :key="tpl.id" :value="tpl.id">
          {{ tpl.title }} ({{ localeStore.t('tasks.checklistTemplateItemCount', { count: tpl.checklist?.length ?? 0 }) }})
        </option>
      </select>
    </label>
    <label>{{ localeStore.t('tasks.dueDate') }}
      <input v-model="createDueDate" required type="date" />
    </label>
    <div v-if="farmMembersStore.canWrite('tasks')" class="row-actions">
      <button type="submit" :disabled="!templates.length">{{ localeStore.t('tasks.create') }}</button>
    </div>
  </form>
  <p v-if="!templates.length" class="muted text-sm" style="margin-bottom: 1.25rem;">{{ localeStore.t('tasks.checklistTemplateNone') }}</p>
  <p v-if="createResult" class="muted text-sm" style="margin-bottom: 1.25rem;">{{ createResult }}</p>

  <!-- ② 템플릿 목록 -->
  <div class="row-actions align-start" style="margin-bottom: 0.5rem;">
    <h3 class="section-title" style="margin: 0;">{{ localeStore.t('tasks.checklistTemplateList') }}</h3>
    <div v-if="farmMembersStore.canWrite('tasks')" class="row-actions">
      <button class="ghost compact-btn" type="button" @click="triggerImport">{{ localeStore.t('tasks.checklistTemplateImport') }}</button>
      <input ref="importInput" accept="application/json,.json" type="file" style="display: none;" @change="handleImportFile" />
      <button v-if="!showTemplateForm" class="ghost compact-btn" type="button" @click="openNewTemplateForm">{{ localeStore.t('tasks.checklistTemplateNew') }}</button>
    </div>
  </div>
  <p v-if="importMessage" class="muted text-sm">{{ importMessage }}</p>
  <p v-if="importError" class="error-msg">{{ importError }}</p>
  <ul class="list clean compact" style="margin-bottom: 1rem;">
    <li v-for="tpl in templates" :key="tpl.id" class="list-item card-like">
      <div>
        <p class="item-title" style="font-size: 0.9rem;">{{ tpl.title }}</p>
        <p class="item-meta">
          {{ tpl.category }} · {{ tpl.priority }} · {{ localeStore.t('tasks.checklistTemplateItemCount', { count: tpl.checklist?.length ?? 0 }) }}
        </p>
        <p v-if="tpl.notes" class="muted text-sm">{{ tpl.notes }}</p>
      </div>
      <div class="row-actions">
        <button class="ghost" type="button" @click="exportTemplate(tpl)">{{ localeStore.t('tasks.checklistTemplateExport') }}</button>
        <template v-if="farmMembersStore.canWrite('tasks')">
          <button class="ghost" type="button" @click="editTemplate(tpl)">{{ localeStore.t('common.edit') }}</button>
          <button class="danger" type="button" @click="confirmDeleteTemplate(tpl)">{{ localeStore.t('common.delete') }}</button>
        </template>
      </div>
    </li>
    <li v-if="!templates.length" class="muted text-sm">{{ localeStore.t('tasks.checklistTemplateEmptyList') }}</li>
  </ul>

  <!-- ③ 템플릿 추가/편집 폼 -->
  <template v-if="showTemplateForm">
    <h3 class="section-title">{{ templateEditingId ? localeStore.t('tasks.checklistTemplateEdit') : localeStore.t('tasks.checklistTemplateNew') }}</h3>
    <form class="stack-form" @submit.prevent="saveTemplate">
      <label>{{ localeStore.t('tasks.taskName') }}
        <input v-model="templateForm.title" required type="text" :placeholder="localeStore.t('tasks.checklistTemplateNamePlaceholder')" />
      </label>
      <label>{{ localeStore.t('tasks.category') }}
        <select v-model="templateForm.category">
          <option v-for="c in taskCategories" :key="c" :value="c">{{ c }}</option>
        </select>
      </label>
      <label>{{ localeStore.t('tasks.priority') }}
        <select v-model="templateForm.priority">
          <option value="높음">{{ localeStore.t('tasks.priorityHigh') }}</option>
          <option value="보통">{{ localeStore.t('tasks.priorityNormal') }}</option>
          <option value="낮음">{{ localeStore.t('tasks.priorityLow') }}</option>
        </select>
      </label>
      <label>{{ localeStore.t('tasks.taskNotes') }}
        <textarea v-model="templateForm.notes" rows="2" />
      </label>

      <div>
        <p class="muted text-sm" style="margin-bottom: 0.35rem;">{{ localeStore.t('tasks.checklist') }}</p>
        <ul class="list clean checklist" style="margin-bottom: 0.5rem;">
          <li v-for="(item, ti) in templateForm.checklist" :key="item.id" class="checklist-item">
            <input v-model="item.text" type="text" style="flex: 1;" />
            <button class="ghost icon-btn" type="button" :disabled="ti === 0" :title="localeStore.t('common.moveUp')" :aria-label="localeStore.t('common.moveUp')" @click="moveTemplateItem(ti, -1)">↑</button>
            <button class="ghost icon-btn" type="button" :disabled="ti === templateForm.checklist.length - 1" :title="localeStore.t('common.moveDown')" :aria-label="localeStore.t('common.moveDown')" @click="moveTemplateItem(ti, 1)">↓</button>
            <button class="danger icon-btn" type="button" :title="localeStore.t('common.delete')" :aria-label="localeStore.t('common.delete')" @click="removeTemplateItem(item.id)">✕</button>
          </li>
          <li v-if="!templateForm.checklist.length" class="muted text-sm">{{ localeStore.t('tasks.checklistTemplateItemsEmpty') }}</li>
        </ul>
        <div class="row-actions">
          <input
            v-model="newItemText"
            type="text"
            style="flex: 1;"
            :placeholder="localeStore.t('tasks.checklistTemplateItemPlaceholder')"
            @keydown.enter.prevent="addTemplateItem"
          />
          <button class="ghost" type="button" @click="addTemplateItem">{{ localeStore.t('tasks.checklistTemplateItemAdd') }}</button>
        </div>
      </div>

      <div class="row-actions">
        <button type="submit" :disabled="!templateForm.checklist.length">{{ templateEditingId ? localeStore.t('common.change') : localeStore.t('common.add') }}</button>
        <button class="ghost" type="button" @click="cancelTemplateForm">{{ localeStore.t('common.cancel') }}</button>
      </div>
    </form>
  </template>
</template>
