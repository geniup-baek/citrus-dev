<script setup>
import { ref } from 'vue'
import { useRecommendSettingsStore } from '../stores/recommendSettingsStore.js'
import { useFarmMembersStore } from '../stores/farmMembersStore.js'
import { TOXIC_GRADES, FISH_TOXIC_GRADES, FISH_TOXIC_INFO, formatFishToxic } from '../services/pesticide.js'

const settingsStore = useRecommendSettingsStore()
const farmMembersStore = useFarmMembersStore()
const showFishToxicInfo = ref(false)
</script>

<template>
  <div v-if="farmMembersStore.canWrite('treatments')" class="settings-card">
    <div class="setting-row">
      <div class="setting-label">
        <span>작용기작 중복 제한 기간</span>
        <span class="setting-hint">같은 작용기작을 이 기간 내 재사용 시 제외</span>
      </div>
      <div class="setting-control days-control">
        <button class="ghost days-btn days-btn-wide" type="button" @click="settingsStore.settings.moaConflictDays = Math.max(14, settingsStore.settings.moaConflictDays - 10)">−10</button>
        <button class="ghost days-btn" type="button" @click="settingsStore.settings.moaConflictDays = Math.max(14, settingsStore.settings.moaConflictDays - 1)">−</button>
        <span class="days-value">{{ settingsStore.settings.moaConflictDays }}일</span>
        <button class="ghost days-btn" type="button" @click="settingsStore.settings.moaConflictDays = Math.min(180, settingsStore.settings.moaConflictDays + 1)">+</button>
        <button class="ghost days-btn days-btn-wide" type="button" @click="settingsStore.settings.moaConflictDays = Math.min(180, settingsStore.settings.moaConflictDays + 10)">+10</button>
      </div>
    </div>

    <div class="setting-row">
      <div class="setting-label">
        <span>연간 최대 사용 횟수 제한</span>
        <span class="setting-hint">동일 농약이 설정 횟수 이상 사용된 경우 제외</span>
      </div>
      <label class="toggle" aria-label="연간 최대 사용 횟수 제한">
        <input type="checkbox" v-model="settingsStore.settings.enforceMaxApplications" />
        <span class="toggle-slider"></span>
      </label>
    </div>

    <div v-if="settingsStore.settings.enforceMaxApplications" class="setting-row setting-sub">
      <div class="setting-label">
        <span>최대 허용 횟수 (기본값)</span>
        <span class="setting-hint">농약별 등록정보가 없을 때 적용되는 값</span>
      </div>
      <div class="setting-control days-control">
        <button class="ghost days-btn" type="button" @click="settingsStore.settings.maxApplicationsPerYear = Math.max(1, settingsStore.settings.maxApplicationsPerYear - 1)">−</button>
        <span class="days-value">{{ settingsStore.settings.maxApplicationsPerYear }}회/년</span>
        <button class="ghost days-btn" type="button" @click="settingsStore.settings.maxApplicationsPerYear = Math.min(10, settingsStore.settings.maxApplicationsPerYear + 1)">+</button>
      </div>
    </div>

    <div v-if="settingsStore.settings.enforceMaxApplications" class="setting-row setting-sub">
      <div class="setting-label">
        <span>농약별 등록정보 우선 적용</span>
        <span class="setting-hint">농약정보에 최대 사용 횟수가 등록되어 있으면 위 기본값 대신 그 값을 사용</span>
      </div>
      <label class="toggle" aria-label="농약별 등록정보 우선 적용">
        <input type="checkbox" v-model="settingsStore.settings.preferPesticideMaxApplications" />
        <span class="toggle-slider"></span>
      </label>
    </div>

    <div class="setting-row">
      <div class="setting-label">
        <span>제외할 독성 등급</span>
        <span class="setting-hint">체크한 등급의 농약은 추천에서 자동 제외 (상세정보를 가져와야 등급이 채워집니다)</span>
      </div>
      <div class="toxic-grade-checks">
        <label v-for="g in TOXIC_GRADES" :key="g" class="toxic-grade-check">
          <input type="checkbox" :value="g" v-model="settingsStore.settings.excludeToxicGrades" />
          {{ g }}
        </label>
      </div>
    </div>

    <div class="setting-row">
      <div class="setting-label">
        <span>
          제외할 어독성 등급
          <button
            type="button"
            class="info-icon-btn"
            :aria-label="showFishToxicInfo ? '어독성 등급 설명 닫기' : '어독성 등급 설명 보기'"
            @click="showFishToxicInfo = !showFishToxicInfo"
          >ⓘ</button>
        </span>
        <span class="setting-hint">체크한 등급의 농약은 추천에서 자동 제외 (상세정보를 가져와야 등급이 채워집니다)</span>
      </div>
      <div class="toxic-grade-checks">
        <label v-for="g in FISH_TOXIC_GRADES" :key="g" class="toxic-grade-check">
          <input type="checkbox" :value="g" v-model="settingsStore.settings.excludeFishToxicGrades" />
          {{ formatFishToxic(g) }}
        </label>
      </div>
    </div>

    <div v-if="showFishToxicInfo" class="fish-toxic-info">
      <div v-for="g in FISH_TOXIC_GRADES" :key="g" class="fish-toxic-info-row">
        <p class="fish-toxic-info-title">{{ FISH_TOXIC_INFO[g].label }}</p>
        <p class="fish-toxic-info-lc50">{{ FISH_TOXIC_INFO[g].lc50 }}</p>
        <p class="muted">{{ FISH_TOXIC_INFO[g].desc }}</p>
        <p class="muted">{{ FISH_TOXIC_INFO[g].guidance }}</p>
      </div>
    </div>

    <div class="setting-reset">
      <button class="ghost" type="button" @click="settingsStore.reset()">기본값으로 초기화</button>
    </div>
  </div>
  <p v-else class="muted">이 설정을 변경할 권한이 없습니다.</p>

  <div class="settings-note">
    <p>수확 전 안전기간(PHI)은 '농약 추천' 탭에서 수확 예정일을 입력하면 자동으로 반영됩니다.</p>
  </div>
</template>

<style scoped>
.settings-card {
  background: var(--bg-soft);
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  padding: 1rem 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0;
}
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--line);
}
.setting-row:last-child { border-bottom: none; }
.setting-sub { padding-left: 1.1rem; background: var(--surface); }
.setting-label { display: flex; flex-direction: column; gap: 0.15rem; }
.setting-label span:first-child { font-size: 0.88rem; font-weight: 500; }
.setting-hint { font-size: 0.75rem; color: var(--muted); }
.setting-control { flex-shrink: 0; }
.setting-reset { margin-top: 0.75rem; }

.days-control { display: flex; align-items: center; gap: 0.4rem; }
.days-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; }
.days-btn-wide { width: auto; padding: 0 0.55rem; font-size: 0.82rem; }
.days-value { font-size: 0.88rem; font-weight: 600; min-width: 52px; text-align: center; }

.toggle { position: relative; display: inline-block; width: 40px; height: 22px; cursor: pointer; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle-slider {
  position: absolute; inset: 0;
  background: var(--line); border-radius: 22px;
  transition: background 0.2s;
}
.toggle-slider::before {
  content: '';
  position: absolute;
  width: 16px; height: 16px;
  left: 3px; top: 3px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.2s;
}
.toggle input:checked + .toggle-slider { background: var(--primary); }
.toggle input:checked + .toggle-slider::before { transform: translateX(18px); }

.toxic-grade-checks { display: flex; flex-wrap: wrap; gap: 0.6rem; }
.toxic-grade-check { display: flex; align-items: center; gap: 0.3rem; font-size: 0.85rem; cursor: pointer; }

.info-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; margin-left: 0.3rem;
  padding: 0; border-radius: 50%;
  background: var(--surface-strong); color: var(--muted);
  font-size: 0.75rem; line-height: 1; cursor: pointer; vertical-align: middle;
}
.info-icon-btn:hover { background: var(--primary); color: var(--primary-ink); }

/* 모바일 터치 타깃 확대 — style.css 의 전역 ≤900px 블록이 닿지 않는
   컴포넌트 전용(scoped) 클래스라 여기서 따로 키운다. */
@media (max-width: 900px) {
  .days-btn { width: 2.5rem; height: 2.5rem; font-size: 1.25rem; }
  .days-btn-wide { width: auto; min-width: 3.25rem; padding: 0 0.7rem; }
  .toggle { width: 52px; height: 30px; }
  .toggle-slider::before { width: 24px; height: 24px; }
  .toggle input:checked + .toggle-slider::before { transform: translateX(22px); }
  .info-icon-btn { width: 1.75rem; height: 1.75rem; }

  /* 라벨(가로 폭 제한 없음) + 커진 컨트롤(days-control 등 버튼 여러 개)을 한 줄에
     욱여넣으면, 라벨 쪽 flex item 이 기본값(min-width:auto)이라 줄바꿈 대신
     "글자 하나당 한 줄"로 짜부라진다 — 라벨을 위, 컨트롤을 아래로 쌓아 피한다. */
  .setting-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.6rem;
  }
  .setting-control {
    align-self: stretch;
  }
  .days-control {
    justify-content: center;
  }
  /* toxic-grade-checks 는 setting-control 클래스가 없어(체크박스만 있는 특수
     케이스) 위 규칙이 안 닿는다 — 컬럼 모드에서도 카드 폭을 그대로 쓰도록 */
  .toxic-grade-checks {
    width: 100%;
  }
}

.fish-toxic-info {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.6rem;
  margin: -0.25rem 0 0.75rem;
  padding: 0.75rem;
  background: var(--surface);
  border-radius: var(--radius-panel);
}
.fish-toxic-info-row p { margin: 0.1rem 0; font-size: 0.78rem; }
.fish-toxic-info-title { font-weight: 700; font-size: 0.85rem !important; }
.fish-toxic-info-lc50 { color: var(--primary); font-weight: 600; }

.settings-note {
  margin-top: 0.75rem;
  font-size: 0.78rem;
  color: var(--muted);
  padding: 0.5rem 0.75rem;
  border-left: 2px solid var(--line);
}
.settings-note p { margin: 0; }
</style>
