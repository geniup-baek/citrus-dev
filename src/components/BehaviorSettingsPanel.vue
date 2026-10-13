<script setup>
import { computed } from 'vue'
import { useFarmStore } from '../stores/farmStore'
import { useRecommendSettingsStore } from '../stores/recommendSettingsStore'
import { useFarmsStore } from '../stores/farmsStore'
import { useAppPolicyStore } from '../stores/appPolicyStore'
import { useFarmMembersStore } from '../stores/farmMembersStore'
import { confirm } from '../composables/useConfirm'
import BinaryToggleCard from './BinaryToggleCard.vue'

const store = useFarmStore()
const recSettingsStore = useRecommendSettingsStore()
const farmsStore = useFarmsStore()
const policyStore = useAppPolicyStore()
const farmMembersStore = useFarmMembersStore()

// 농장 모드에서 동작 설정 쓰기 권한이 없으면(읽기만 받은 구성원) 보기만 가능하다.
const canEdit = computed(() => farmsStore.isAdminMode || farmMembersStore.canUse('behavior', 'write'))

// ── 재배 품종(농장별) ────────────────────────────────────────────────────────
async function toggleGrownVariety(variety) {
  const list = recSettingsStore.settings.grownVarieties
  const idx = list.indexOf(variety)
  if (idx < 0) {
    list.push(variety)
    return
  }
  const usedCount = store.state.seedlings.filter((s) => s.variety === variety).length
  if (usedCount > 0) {
    const ok = await confirm({
      title: '재배 품종 제외',
      message: `"${variety}"(으)로 등록된 묘목이 ${usedCount}그루 있습니다. 재배 품종에서 제외해도 기존 묘목 데이터는 그대로 남지만, 지식 페이지·묘목 추가 목록에서는 더 이상 보이지 않습니다. 계속할까요?`,
      confirmLabel: '제외',
    })
    if (!ok) return
  }
  list.splice(idx, 1)
}
</script>

<template>
  <fieldset class="perm-fieldset" :disabled="!canEdit">
  <p v-if="!canEdit" class="muted text-sm">동작 설정을 바꿀 권한이 없어 보기만 가능합니다.</p>
  <!-- 시스템 관리 모드: 기기/앱 전역 공통 동작 -->
  <template v-if="farmsStore.isAdminMode">
    <BinaryToggleCard
      title="공공데이터 상세정보 가져오기"
      hint="농약검색 페이지의 &quot;상세정보 전체 가져오기&quot; 실행 방식을 설정합니다."
      v-model="recSettingsStore.settings.skipCachedPesticideDetails"
      left-label="이미 가져온 항목 건너뛰기" :left-value="true"
      right-label="전체 새로 가져오기" :right-value="false"
    >
      "전체 새로 가져오기"는 매번 API를 다시 다 호출하므로 시간이 오래 걸립니다. 데이터 구조가 바뀌었거나 잘못 저장된 캐시를 고쳐야 할 때만 선택하세요.
      이 설정은 <strong>이 기기에만 적용</strong>됩니다.
    </BinaryToggleCard>

    <BinaryToggleCard
      title="PDF 출력"
      hint="비료·농약재고 현황의 &quot;PDF 출력&quot; 버튼 동작 방식을 설정합니다."
      v-model="policyStore.policy.autoOpenPrintDialog"
      left-label="보고서만 열기" :left-value="false"
      right-label="인쇄 대화상자 자동으로 열기" :right-value="true"
    >
      "보고서만 열기"는 보고서 화면만 새 창으로 열고 인쇄 대화상자는 자동으로 띄우지 않습니다(필요할 때 직접 Ctrl+P). "인쇄 대화상자 자동으로 열기"는 새 창을 열자마자 바로 인쇄 대화상자를 띄웁니다.
    </BinaryToggleCard>

    <BinaryToggleCard
      title="농약 직접등록 권한"
      hint="자료 > 농약의 &quot;직접 추가&quot;(공공데이터에 없는 농약 등록)를 누가 쓸 수 있게 할지 설정합니다."
      v-model="policyStore.policy.allowManualPesticideForAll"
      left-label="시스템 관리 모드만" :left-value="false"
      right-label="누구나" :right-value="true"
    >
      직접등록한 농약은 모든 농장이 함께 쓰는 자료입니다. "시스템 관리 모드만"으로 두면 농장 모드에서는 추가·수정·삭제 버튼이 보이지 않습니다(등록된 농약 검색·연결은 그대로 됩니다).
    </BinaryToggleCard>

    <BinaryToggleCard
      title="초기화 기능"
      hint="방제이력·농약재고·가용농약·재배동·시설장비·묘목·비료재고·작업·문제의 &quot;초기화&quot; 기능을 사용할지 설정합니다."
      v-model="policyStore.policy.enableResetFeature"
      left-label="사용 안 함" :left-value="false"
      right-label="사용" :right-value="true"
    >
      "초기화"는 해당 목록을 통째로 삭제하며 되돌릴 수 없습니다. "사용 안 함"이면 농장 설정의 "초기화 버튼 표시" 항목도 감춰지고 초기화 버튼은 어느 농장에서도 나타나지 않습니다.
    </BinaryToggleCard>

    <BinaryToggleCard
      title="변경 이력 삭제 기능"
      hint="&quot;변경 이력&quot; 탭에서 개별 항목 또는 전체 이력을 삭제하는 기능을 사용할지 설정합니다."
      v-model="policyStore.policy.enableChangeLogDeleteFeature"
      left-label="사용 안 함" :left-value="false"
      right-label="사용" :right-value="true"
    >
      삭제한 변경 이력은 되돌릴 수 없습니다. "사용 안 함"이면 농장 설정의 "삭제 버튼 표시" 항목도 감춰지고 삭제 버튼은 어느 농장에서도 나타나지 않습니다.
    </BinaryToggleCard>
  </template>

  <!-- 농장 모드: 이 농장에만 적용되는 정책 -->
  <template v-else>
    <BinaryToggleCard
      title="방제이력 전체 재연결"
      hint="방제이력 탭의 &quot;전체 재연결&quot; 실행 방식을 설정합니다. (현재 농장에만 적용됩니다)"
      v-model="recSettingsStore.settings.overwriteLinkedTreatments"
      left-label="미연결만 연결" :left-value="false"
      right-label="이미 연결된 이력도 덮어쓰기" :right-value="true"
    >
      "미연결만 연결"은 아직 연결 안 된 이력만 연결합니다. "이미 연결된 이력도 덮어쓰기"는 이미 연결된 이력도 최신 정보로 다시 덮어씁니다.
    </BinaryToggleCard>

    <BinaryToggleCard
      title="붙여넣기 일괄추가 방식"
      hint="방제이력·농약재고·가용농약의 &quot;붙여넣기 일괄추가&quot; 실행 방식을 설정합니다. (현재 농장에만 적용됩니다)"
      v-model="recSettingsStore.settings.bulkImportMode"
      left-label="기존 목록에 추가" left-value="append"
      right-label="전체 새로 작성" right-value="replace"
    >
      "기존 목록에 추가"는 붙여넣은 항목만 더합니다. "전체 새로 작성"은 붙여넣기 전 기존 목록(방제이력·농약재고는 전체 삭제, 가용농약은 구입가능농약 텍스트 전체)을 지우고 붙여넣은 내용으로 다시 만듭니다 — 되돌릴 수 없으니 주의하세요.
    </BinaryToggleCard>

    <div class="sub-card">
      <div class="settings-group-head">
        <h3>재배 품종</h3>
      </div>
      <p class="muted settings-group-hint">
        이 농장에서 실제로 재배하는 묘목 품종을 선택합니다. (현재 농장에만 적용됩니다)
      </p>
      <div class="inline-filters">
        <button
          v-for="v in (store.state.appSettings?.seedlingVarieties ?? [])"
          :key="v"
          type="button"
          :class="{ ghost: !recSettingsStore.settings.grownVarieties.includes(v) }"
          @click="toggleGrownVariety(v)"
        >{{ v }}</button>
      </div>
      <p class="muted text-sm" style="margin-top: 0.5rem;">
        선택한 품종만 지식 페이지의 "품종 특성"과 묘목 추가 시 품종 목록에 표시됩니다. 아무것도 선택하지 않으면 전체 품종이 제한 없이 표시됩니다. 이미 등록된 묘목의 품종을 제외해도 그 묘목 데이터는 그대로 남습니다.
      </p>
    </div>

    <!-- 초기화 기능은 시스템 관리 모드에서 켜 둔 경우에만 농장별로 표시 여부를 고를 수 있다. -->
    <BinaryToggleCard
      v-if="policyStore.policy.enableResetFeature"
      title="초기화 버튼 표시"
      hint="방제이력·농약재고·가용농약·재배동·시설장비·묘목·비료재고·작업·문제 편집모드에 &quot;초기화&quot; 버튼을 표시할지 설정합니다. (현재 농장에만 적용됩니다)"
      v-model="recSettingsStore.settings.showResetButtons"
      left-label="표시 안 함" :left-value="false"
      right-label="표시" :right-value="true"
    >
      "초기화"는 이 농장의 해당 목록을 통째로 삭제하며 되돌릴 수 없습니다. 평소에는 "표시 안 함"으로 두고, 데이터를 새로 만들어야 할 때만 잠시 켜세요.
    </BinaryToggleCard>

    <!-- 변경 이력 삭제 기능도 시스템 관리 모드에서 켜 둔 경우에만 농장별로 표시 여부를 고를 수 있다. -->
    <BinaryToggleCard
      v-if="policyStore.policy.enableChangeLogDeleteFeature"
      title="변경 이력 삭제 버튼 표시"
      hint="&quot;변경 이력&quot; 탭에 개별/전체 삭제 버튼을 표시할지 설정합니다. (현재 농장에만 적용됩니다)"
      v-model="recSettingsStore.settings.showChangeLogDeleteButtons"
      left-label="표시 안 함" :left-value="false"
      right-label="표시" :right-value="true"
    >
      삭제한 변경 이력은 되돌릴 수 없습니다. 평소에는 "표시 안 함"으로 두고, 이력을 정리해야 할 때만 잠시 켜세요.
    </BinaryToggleCard>
  </template>
  </fieldset>
</template>
<style scoped>
.perm-fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
</style>
