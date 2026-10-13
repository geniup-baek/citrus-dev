<script setup>
import { ref, computed, watch } from 'vue'
import { useTreatmentStore } from '../stores/treatmentStore.js'
import { useRecommendSettingsStore } from '../stores/recommendSettingsStore.js'
import { useAvailablePesticideStore } from '../stores/availablePesticideStore.js'
import { getRecommendations, moaColor } from '../services/recommend.js'
import { formatPreHarvest, formatFishToxic, formatFishToxicBadge } from '../services/pesticide.js'
import { usePesticideInventoryStock } from '../composables/usePesticideInventoryStock.js'
import { categoryClass, toxicClass, fishToxicClass } from '../utils/pesticideBadgeClass.js'
import { today } from '../utils/dataExport.js'
import { LS_PREFIX } from '../utils/storagePrefix.js'

const emit = defineEmits(['show-stock'])

const treatStore    = useTreatmentStore()
const settingsStore = useRecommendSettingsStore()
const apStore       = useAvailablePesticideStore()
const { inventoryPesticides, inventoryStockMap, stockLotLabel, hasStock } = usePesticideInventoryStock()

// 마지막 사용일 + 방제 예정일 기준 경과일: "(2026-10-12 · 17일 전)". 경과일이 음수(예정일이 사용일보다 앞)면 일수는 뺀다.
function lastUseText(p) {
  if (!p.lastUseDate) return ''
  const days = Math.round((new Date(recDate.value || today()) - new Date(p.lastUseDate)) / 86400000)
  return ` (${p.lastUseDate}${days >= 0 ? ` · ${days}일 전` : ''})`
}

// 재고 줄을 누르면 해당 농약재고 품목으로 이동한다(같은 이름의 품목이 있어야 재고가 보이므로 항상 찾는다).
function openStock(brandName) {
  const item = inventoryPesticides.value.find((i) => i.name === brandName)
  if (item) emit('show-stock', item.id)
}

const recPest        = ref('')
const recDate        = ref(today())
const recHarvestDate = ref('')
const recResult      = ref(null)

const recPests = computed(() => {
  const set = new Set()
  for (const p of apStore.availableList) {
    for (const pest of p.targetPests) {
      set.add(pest.replace(/\(.*?\)/g, '').trim())
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ko'))
})

const recConstraintHint = computed(() => {
  const s = settingsStore.settings
  const parts = [`${s.moaConflictDays}일 이내 작용기작 중복 제외`]
  if (s.enforceMaxApplications) {
    parts.push(
      s.preferPesticideMaxApplications
        ? `연간 최대 사용 횟수 제한(농약별 등록정보 우선, 기본 ${s.maxApplicationsPerYear}회)`
        : `연간 최대 ${s.maxApplicationsPerYear}회 사용 제한`,
    )
  }
  if (recHarvestDate.value) parts.push('수확 전 안전기간(PHI) 확인')
  if (s.excludeToxicGrades.length) parts.push(`독성등급 제외(${s.excludeToxicGrades.join('/')})`)
  if (s.excludeFishToxicGrades.length) parts.push(`어독성 제외(${s.excludeFishToxicGrades.map(formatFishToxic).join('/')})`)
  parts.push('방제 예정일 기준')
  return parts.join(' · ')
})

function runRecommend() {
  if (!recPest.value.trim()) { recResult.value = null; return }
  recResult.value = getRecommendations({
    targetPest:  recPest.value.trim(),
    treatments:  treatStore.treatments,
    settings:    settingsStore.settings,
    today:       recDate.value || today(),
    harvestDate: recHarvestDate.value || '',
    pesticides:  apStore.availableList,
  })
}

// 이력이 바뀌면 추천 결과도 갱신
watch(() => treatStore.treatments.length, () => {
  if (recResult.value) runRecommend()
})

// ── 정렬 ────────────────────────────────────────────────────────────────────
// 정렬 기준과 "재고 있는 농약 먼저"는 이 기기에 기억해 둔다(농장 데이터가 아니라 보기 설정).
const LS_SORT = `${LS_PREFIX}:rec-sort`
const LS_STOCK_FIRST = `${LS_PREFIX}:rec-stock-first`
const SORT_OPTIONS = [
  { key: 'expiry', label: '재고 유효기간 임박 순' },
  { key: 'name', label: '이름순' },
  { key: 'useCount', label: '올해 사용 횟수 적은 순' },
  { key: 'lastUse', label: '마지막 사용일 오래된 순' },
  { key: 'toxic', label: '독성 낮은 순' },
  { key: 'phi', label: '수확 전 안전기간 짧은 순' },
]
function readLs(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}
const sortKey = ref(SORT_OPTIONS.some((o) => o.key === readLs(LS_SORT, '')) ? readLs(LS_SORT, '') : 'expiry')
const stockFirst = ref(readLs(LS_STOCK_FIRST, '1') !== '0')
watch([sortKey, stockFirst], () => {
  try {
    localStorage.setItem(LS_SORT, sortKey.value)
    localStorage.setItem(LS_STOCK_FIRST, stockFirst.value ? '1' : '0')
  } catch { /* 저장 못 해도 이번 화면에서는 적용된다 */ }
})

const TOXIC_RANK = { 저독성: 0, 보통독성: 1, 고독성: 2, 맹독성: 3 }
// 값이 없는 항목(독성 미등록·안전기간 미등록·유효기간 없음 등)은 항상 맨 뒤로 보낸다.
const NONE = Number.POSITIVE_INFINITY
function sortValue(p) {
  switch (sortKey.value) {
    case 'useCount': return p.useCount ?? 0
    case 'lastUse': return p.lastUseDate ? new Date(p.lastUseDate).getTime() : -NONE // 한 번도 안 쓴 건 맨 앞
    case 'toxic': return TOXIC_RANK[p.toxicName] ?? NONE
    case 'phi': { const n = parseInt(String(p.preHarvestDays ?? ''), 10); return Number.isFinite(n) ? n : NONE }
    case 'expiry': {
      const dates = (inventoryStockMap.value[p.brandName] ?? []).map((l) => l.expiry).filter(Boolean).sort()
      return dates.length ? new Date(dates[0]).getTime() : NONE
    }
    default: return 0
  }
}
function sortList(list) {
  const indexed = list.map((p, i) => ({ p, i }))
  indexed.sort((x, y) => {
    if (stockFirst.value) {
      const d = hasStock(y.p.brandName) - hasStock(x.p.brandName)
      if (d) return d
    }
    if (sortKey.value === 'name') {
      const d = x.p.brandName.localeCompare(y.p.brandName, 'ko')
      if (d) return d
    } else {
      const vx = sortValue(x.p), vy = sortValue(y.p)
      if (vx !== vy) return vx < vy ? -1 : 1
    }
    return x.i - y.i // 같으면 원래 순서 유지
  })
  return indexed.map((e) => e.p)
}

const sortedRecommended = computed(() => (recResult.value ? sortList(recResult.value.recommended) : []))
const sortedExcluded = computed(() => (recResult.value ? sortList(recResult.value.excluded) : []))
</script>

<template>
  <div class="rec-search">
    <input
      v-model="recPest"
      list="rec-pest-list"
      placeholder="방제 대상 입력 (예: 귤굴나방, 잿빛곰팡이병)"
      @keyup.enter="runRecommend"
      autocomplete="off"
    />
    <datalist id="rec-pest-list">
      <option v-for="p in recPests" :key="p" :value="p" />
    </datalist>
    <label class="rec-date-label">방제 예정일
      <input type="date" v-model="recDate" class="rec-date-input" @change="runRecommend" />
    </label>
    <label class="rec-date-label">수확 예정일 <span class="muted">(선택)</span>
      <input type="date" v-model="recHarvestDate" class="rec-date-input" @change="runRecommend" />
    </label>
    <button type="button" @click="runRecommend">추천 조회</button>
  </div>

  <div v-if="recResult" class="rec-sort">
    <label class="rec-date-label">정렬
      <select v-model="sortKey" class="rec-sort-select">
        <option v-for="o in SORT_OPTIONS" :key="o.key" :value="o.key">{{ o.label }}</option>
      </select>
    </label>
    <label class="rec-stock-first">
      <input v-model="stockFirst" type="checkbox" /> 재고 있는 농약 먼저
    </label>
  </div>

  <div v-if="apStore.availableList.length === 0" class="empty-msg">
    가용농약 목록이 없습니다.<br>
    <span class="hint">'가용농약' 탭에서 구입가능농약을 입력하고 목록을 작성해주세요.</span>
  </div>
  <div v-else-if="!recResult" class="empty-msg">
    방제 대상을 입력하고 추천 조회를 눌러주세요.<br>
    <span class="hint">설정의 제약사항이 반영됩니다 ({{ recConstraintHint }}).</span>
  </div>

  <template v-else>
    <div v-if="recResult.totalMatched === 0" class="empty-msg">
      '{{ recPest }}'에 등록된 농약이 없습니다. 다른 이름으로 검색해 보세요.
    </div>
    <template v-else>
      <!-- 추천 가능 -->
      <div class="rec-section">
        <h3 class="rec-section-title ok">
          추천 가능
          <span class="rec-count">{{ recResult.recommended.length }}건</span>
        </h3>
        <div v-if="recResult.recommended.length === 0" class="empty-msg small">
          현재 제약사항을 모두 만족하는 농약이 없습니다.
        </div>
        <div v-else class="rec-list">
          <div v-for="p in sortedRecommended" :key="p.brandName" class="rec-card rec-ok">
            <div class="rec-top">
              <span class="rec-brand">{{ p.brandName }}</span>
              <span class="cat-badge" :class="categoryClass(p.category)">{{ p.category }}</span>
              <span class="moa-badge" :style="{ background: moaColor(p.moa) }">{{ p.moa }}</span>
              <span v-if="p.toxicName" class="toxic-badge" :class="toxicClass(p.toxicName)">{{ p.toxicName }}</span>
              <span v-if="p.fishToxic" class="toxic-badge" :class="fishToxicClass(p.fishToxic)">{{ formatFishToxicBadge(p.fishToxic) }}</span>
            </div>
            <div class="rec-pests">{{ p.targetPests.join(', ') }}</div>
            <div v-if="p.preHarvestDays" class="ap-safety">{{ formatPreHarvest(p.preHarvestDays) }}</div>
            <div v-if="p.useCount > 0" class="rec-usecount">올해 {{ p.useCount }}회 사용{{ p.appliedLimit ? ` (최대 ${p.appliedLimit}회)` : '' }}{{ lastUseText(p) }}</div>
            <div
              v-if="inventoryStockMap[p.brandName]?.length"
              class="ap-stock-row ap-stock-link"
              role="button"
              tabindex="0"
              title="농약재고에서 보기"
              @click="openStock(p.brandName)"
              @keydown.enter.prevent="openStock(p.brandName)"
            >
              재고
              <span v-for="lot in inventoryStockMap[p.brandName]" :key="`${lot.vol}-${lot.expiry}`" class="ap-stock-lot">{{ stockLotLabel(lot) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 제약으로 제외 -->
      <div v-if="recResult.excluded.length > 0" class="rec-section">
        <h3 class="rec-section-title ng">
          제약으로 제외
          <span class="rec-count">{{ recResult.excluded.length }}건</span>
        </h3>
        <div class="rec-list">
          <div v-for="p in sortedExcluded" :key="p.brandName" class="rec-card rec-ng">
            <div class="rec-top">
              <span class="rec-brand">{{ p.brandName }}</span>
              <span class="cat-badge" :class="categoryClass(p.category)">{{ p.category }}</span>
              <span class="moa-badge moa-faded" :style="{ background: moaColor(p.moa) }">{{ p.moa }}</span>
              <span v-if="p.toxicName" class="toxic-badge" :class="toxicClass(p.toxicName)">{{ p.toxicName }}</span>
              <span v-if="p.fishToxic" class="toxic-badge" :class="fishToxicClass(p.fishToxic)">{{ formatFishToxicBadge(p.fishToxic) }}</span>
            </div>
            <ul class="rec-reasons">
              <li v-for="(r, i) in p.reasons" :key="i">{{ r }}</li>
            </ul>
            <div
              v-if="inventoryStockMap[p.brandName]?.length"
              class="ap-stock-row ap-stock-link"
              role="button"
              tabindex="0"
              title="농약재고에서 보기"
              @click="openStock(p.brandName)"
              @keydown.enter.prevent="openStock(p.brandName)"
            >
              재고
              <span v-for="lot in inventoryStockMap[p.brandName]" :key="`${lot.vol}-${lot.expiry}`" class="ap-stock-lot">{{ stockLotLabel(lot) }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </template>
</template>

<style scoped>
.ap-stock-link { cursor: pointer; }
.ap-stock-link:hover .ap-stock-lot,
.ap-stock-link:focus-visible .ap-stock-lot { text-decoration: underline; }
.ap-stock-link:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 4px; }
.rec-search { display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap; align-items: flex-end; }
.rec-search > input { flex: 1; min-width: 180px; }
.rec-date-label { font-size: 0.78rem; color: var(--muted); display: flex; flex-direction: column; gap: 0.2rem; }
.rec-date-input { flex: none; width: auto; }
.rec-sort { display: flex; gap: 1rem; align-items: flex-end; flex-wrap: wrap; margin-bottom: 0.9rem; }
.rec-sort-select { width: auto; max-width: 100%; }
.rec-stock-first { display: flex; align-items: center; gap: 0.35rem; font-size: 0.85rem; font-weight: normal; padding-bottom: 0.45rem; }

.rec-section { margin-bottom: 1.25rem; }
.rec-section-title {
  font-size: 0.9rem;
  font-weight: 700;
  margin: 0 0 0.6rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.rec-section-title.ok { color: #166534; }
.rec-section-title.ng { color: #9a3412; }
.rec-count { font-size: 0.78rem; font-weight: 400; color: var(--muted); }

.rec-list { display: flex; flex-direction: column; gap: 0.5rem; }
.rec-card {
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  padding: 0.65rem 0.9rem;
}
.rec-ok { background: var(--tone-green-bg); border-color: var(--tone-green-border); }
.rec-ng { background: var(--tone-red-bg); border-color: var(--tone-red-border); opacity: 0.85; }

.rec-top { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.3rem; }
.rec-brand { font-weight: 600; font-size: 0.88rem; }
.rec-pests { font-size: 0.78rem; color: var(--muted); }
.rec-usecount { font-size: 0.75rem; color: var(--muted); margin-top: 0.1rem; }
.rec-reasons { margin: 0.25rem 0 0; padding-left: 1.2rem; font-size: 0.8rem; color: #9a3412; }
.rec-reasons li { margin-bottom: 0.15rem; }

.ap-safety { font-size: 0.78rem; color: var(--muted); }
.ap-stock-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.2rem;
  font-size: 0.75rem;
  color: var(--muted);
  flex-wrap: wrap;
}
.ap-stock-lot {
  background: var(--tone-green-bg);
  color: var(--tone-green-text);
  border: 1px solid var(--tone-green-border);
  border-radius: 999px;
  padding: 0.08rem 0.5rem;
  font-size: 0.72rem;
  font-weight: 600;
}

.empty-msg.small { padding: 0.75rem; text-align: left; }
.hint { font-size: 0.8rem; }
</style>
