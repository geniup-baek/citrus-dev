import { cleanPreHarvestDays, cleanMaxApplications, formatFishToxic } from './pesticide.js'

function matchesPest(pesticide, term) {
  if (!term) return true
  const t = term.trim()
  return pesticide.targetPests.some(p => {
    const base = p.replace(/\(.*?\)/g, '').trim()
    return base.includes(t) || t.includes(base)
  })
}

// ── MOA group extraction ────────────────────────────────────────────────────
// 살균제: Korean-letter prefix ("다2" → "다", "카" → "카")
// 살충제/살비제: numeric prefix ("4a" → "4", "28" → "28")
// 제초제: uppercase letter ("A" → "A")
function moaGroup(code) {
  const c = code.trim()
  if (c === '미분류') return '__미분류__'
  const kor = c.match(/^([가-힣]+)/)
  if (kor) return kor[1]
  const num = c.match(/^(\d+)/)
  if (num) return num[1]
  const alpha = c.match(/^([A-Z]+)/)
  if (alpha) return alpha[1]
  return c
}

export function getMoaGroups(moa) {
  if (!moa) return []
  return moa.split('+').map(c => moaGroup(c.trim())).filter(Boolean)
}

export function hasMoaConflict(moa1, moa2) {
  const g1 = getMoaGroups(moa1)
  const g2 = getMoaGroups(moa2)
  return g1.some(g => g !== '__미분류__' && g2.includes(g))
}

// ── MOA color coding ────────────────────────────────────────────────────────
const KOR_COLORS = {
  '가': '#8b5cf6', '나': '#22c55e', '다': '#f97316',
  '라': '#06b6d4', '마': '#ec4899', '바': '#f59e0b',
  '사': '#84cc16', '아': '#14b8a6', '자': '#6366f1',
  '차': '#64748b', '카': '#78716c', '타': '#a78bfa',
}
function numColor(n) {
  const v = parseInt(n, 10)
  if (v <= 3) return '#ef4444'
  if (v <= 7) return '#f97316'
  if (v <= 12) return '#22c55e'
  if (v <= 19) return '#3b82f6'
  if (v <= 28) return '#8b5cf6'
  return '#64748b'
}

export function moaColor(moa) {
  if (!moa) return '#9ca3af'
  const first = moa.split('+')[0].trim()
  if (first === '미분류') return '#9ca3af'
  const kor = first.match(/^([가-힣]+)/)
  if (kor) return KOR_COLORS[kor[1]] ?? '#9ca3af'
  const num = first.match(/^(\d+)/)
  if (num) return numColor(num[1])
  return '#9ca3af'
}

// ── Recent conflict check ───────────────────────────────────────────────────
function daysBetween(dateStr1, dateStr2) {
  return Math.abs(new Date(dateStr1) - new Date(dateStr2)) / 86400000
}

function conflictingHistory(pesticide, treatments, conflictDays, today) {
  return treatments.filter(t =>
    t.moa &&
    daysBetween(t.date, today) <= conflictDays &&
    hasMoaConflict(pesticide.moa, t.moa),
  )
}

function yearUses(pesticide, treatments, year) {
  return treatments.filter(t =>
    t.brandName === pesticide.brandName && t.date?.startsWith(year),
  )
}

// 올해 마지막 사용일(YYYY-MM-DD). 사용 이력이 없으면 ''.
function lastUseDateOf(uses) {
  return uses.reduce((latest, t) => (t.date > latest ? t.date : latest), '').slice(0, 10)
}

// 농약 정보에 등록된 최대 사용 횟수가 있으면(설정으로 우선 적용 지정 시) 그 값을, 없으면 설정값을 사용한다.
function resolveMaxApplicationsLimit(pesticide, { maxApplicationsPerYear, preferPesticideMaxApplications }) {
  const pesticideLimit = Number(cleanMaxApplications(pesticide.maxApplications))
  const usePesticideLimit = preferPesticideMaxApplications && Number.isFinite(pesticideLimit) && pesticideLimit > 0
  return {
    limit: usePesticideLimit ? pesticideLimit : maxApplicationsPerYear,
    limitLabel: usePesticideLimit ? '농약별 등록정보' : '설정',
  }
}

// 수확 전 안전기간(PHI) 위반 여부. harvestDate가 없거나 preHarvestDays가 숫자가 아니면(생육단계 표현 등) 검사하지 않는다.
function checkPhi(pesticide, treatmentDate, harvestDate) {
  if (!harvestDate) return null
  const required = Number(cleanPreHarvestDays(pesticide.preHarvestDays))
  if (!Number.isFinite(required) || required <= 0) return null
  const daysUntilHarvest = Math.round(daysBetween(treatmentDate, harvestDate))
  if (daysUntilHarvest >= required) return null
  return { required, daysUntilHarvest }
}

function moaConflictReason(p, treatments, moaConflictDays, today) {
  const conflicts = conflictingHistory(p, treatments, moaConflictDays, today)
  if (conflicts.length === 0) return null
  const latest = conflicts.reduce((a, b) => (a.date > b.date ? a : b))
  const days = Math.round(daysBetween(latest.date, today))
  const groups = getMoaGroups(p.moa).filter(g => getMoaGroups(latest.moa).includes(g))
  return `${moaConflictDays}일 이내 작용기작 겹침 (${groups.join('/')} · ${latest.date} 사용 · ${days}일 전)`
}

// 농약 1건에 대해 방제이력·수확전안전기간·독성등급 등 모든 제약을 평가한다.
function evaluatePesticide(p, { treatments, today, harvestDate, settings, year }) {
  const { moaConflictDays, enforceMaxApplications, excludeToxicGrades = [], excludeFishToxicGrades = [] } = settings
  const reasons = []

  const moaReason = moaConflictReason(p, treatments, moaConflictDays, today)
  if (moaReason) reasons.push(moaReason)

  const uses = yearUses(p, treatments, year)
  const useCount = uses.length
  const lastUseDate = lastUseDateOf(uses)
  const { limit, limitLabel } = resolveMaxApplicationsLimit(p, settings)
  if (enforceMaxApplications && limit > 0 && useCount >= limit) {
    reasons.push(`올해 ${useCount}회 사용 (${limitLabel} 최대 ${limit}회)`)
  }

  const phi = checkPhi(p, today, harvestDate)
  if (phi) {
    reasons.push(`수확 ${phi.required}일 전까지 사용 가능 (수확예정일까지 ${phi.daysUntilHarvest}일 · ${phi.required - phi.daysUntilHarvest}일 부족)`)
  }

  if (p.toxicName && excludeToxicGrades.includes(p.toxicName)) {
    reasons.push(`제외 대상 독성등급 (${p.toxicName})`)
  }

  if (p.fishToxic && excludeFishToxicGrades.includes(p.fishToxic)) {
    reasons.push(`제외 대상 어독성등급 (${formatFishToxic(p.fishToxic)})`)
  }

  return { reasons, useCount, lastUseDate, appliedLimit: enforceMaxApplications ? limit : null }
}

// ── Recommendation engine ───────────────────────────────────────────────────
export function getRecommendations({ targetPest, treatments, settings, today, harvestDate = '', pesticides = [] }) {
  const matched = pesticides.filter(p => matchesPest(p, targetPest))
  const year = today.slice(0, 4)

  const recommended = []
  const excluded = []

  for (const p of matched) {
    const { reasons, useCount, lastUseDate, appliedLimit } = evaluatePesticide(p, { treatments, today, harvestDate, settings, year })
    if (reasons.length > 0) {
      excluded.push({ ...p, reasons, useCount, lastUseDate, appliedLimit })
    } else {
      recommended.push({ ...p, useCount, lastUseDate, appliedLimit })
    }
  }

  return { recommended, excluded, totalMatched: matched.length }
}
