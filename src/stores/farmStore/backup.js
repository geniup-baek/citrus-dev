// 농장별 백업 내보내기/복원.
// 사용자가 변경할 수 있는 모든 데이터를 백업한다.
// (annualTaskTemplates = 앱 고정 템플릿, notifications = 시스템 추적값이므로 제외)
import { doc, getDoc } from 'firebase/firestore'
import { doc as liteDoc, writeBatch as liteWriteBatch } from 'firebase/firestore/lite'
import { db, dbLite, firebaseEnabled } from '../../services/firebase'
import { CHANGE_LOG_LIMIT } from './changeLog.js'
import {
  normalizeAppSettings,
  normalizeFarmData,
  normalizeInventoryItem,
  normalizeIssue,
  normalizeRule,
  normalizeScheduleSettings,
  normalizeUsageGuide,
} from '../../utils/farmDataSchema.js'

const BACKUP_TYPE = 'citrus-farm-backup'
const BACKUP_ARRAY_KEYS = ['facilities', 'ancillaries', 'seedlings', 'tasks', 'scheduleRules', 'issues', 'inventory', 'usageGuides', 'checklistTemplates']
const BACKUP_OBJECT_KEYS = ['appSettings', 'scheduleSettings']
const BACKUP_KEYS = [...BACKUP_ARRAY_KEYS, ...BACKUP_OBJECT_KEYS]

// APP_SETTINGS_LS_KEY/scheduleAppSettingsWrite는 appSettings 저장 관련 핵심 배관이라
// farmStore.js(오케스트레이터)가 그대로 갖고 있고, 여기서는 인자로 받는다.
export function createBackupActions(ctx) {
  const {
    state, persist, logChange,
    photoCache, currentReferencedPhotoIds, migrateInlinePhotos,
    appSettingsLsKey, scheduleAppSettingsWrite, getFarmId,
  } = ctx

  function exportBackup() {
    const data = {}
    BACKUP_ARRAY_KEYS.forEach((key) => {
      data[key] = Array.isArray(state.value[key]) ? state.value[key] : []
    })
    BACKUP_OBJECT_KEYS.forEach((key) => {
      data[key] = state.value[key] && typeof state.value[key] === 'object' ? state.value[key] : {}
    })
    // 변경 이력은 다른 항목과 달리 복원 시 통째로 덮어쓰지 않고 현재 이력과 합쳐서 보존한다(아래 restoreBackup 참고).
    data.changeLog = Array.isArray(state.value.changeLog) ? state.value.changeLog : []

    return {
      type: BACKUP_TYPE,
      version: 2,
      exportedAt: new Date().toISOString(),
      data,
    }
  }

  // 실제 백업 파일용: 참조된 사진 본문(base64)을 함께 담아 자기완결적 백업을 만든다.
  // (사진은 photos 컬렉션에 분산 저장되므로 메타데이터만으로는 다른 환경에서 이미지가 복원되지 않음)
  async function exportBackupWithPhotos() {
    const payload = exportBackup()
    payload.version = 3

    const photos = {}
    for (const id of currentReferencedPhotoIds()) {
      let dataUrl = photoCache.value[id]
      if (dataUrl === undefined && firebaseEnabled && db) {
        try {
          const snap = await getDoc(doc(db, 'photos', id))
          dataUrl = snap.exists() ? snap.data().dataUrl : undefined
        } catch (e) {
          console.warn('[farmStore] 백업용 사진 로드 실패', id, e)
        }
      }
      if (dataUrl) photos[id] = { dataUrl }
    }
    payload.data.photos = photos
    return payload
  }

  function isValidBackup(payload) {
    return (
      payload &&
      payload.type === BACKUP_TYPE &&
      payload.data &&
      typeof payload.data === 'object' &&
      BACKUP_KEYS.some((key) => payload.data[key] !== undefined)
    )
  }

  function backupSummary(payload) {
    const summary = {}
    BACKUP_ARRAY_KEYS.forEach((key) => {
      summary[key] = Array.isArray(payload?.data?.[key]) ? payload.data[key].length : 0
    })
    summary.settings = BACKUP_OBJECT_KEYS.some(
      (key) => payload?.data?.[key] && typeof payload.data[key] === 'object',
    )
    summary.photos =
      payload?.data?.photos && typeof payload.data.photos === 'object'
        ? Object.keys(payload.data.photos).length
        : 0
    summary.changeLog = Array.isArray(payload?.data?.changeLog) ? payload.data.changeLog.length : 0
    return summary
  }

  async function restoreBackup(payload) {
    if (!isValidBackup(payload)) {
      throw new Error('invalid-backup')
    }

    // 백업에 포함된 키만 현재 상태 위에 덮어쓴 뒤 정규화한다.
    // (백업에 없는 키는 현재 값 유지 → 구버전 백업도 안전하게 복원)
    const merged = { ...state.value }
    BACKUP_KEYS.forEach((key) => {
      if (payload.data[key] !== undefined) {
        merged[key] = payload.data[key]
      }
    })

    const { appSettings: mergedAppSettings, ...farmPart } = merged
    const normalized = normalizeFarmData(farmPart)
    normalized.scheduleRules = normalized.scheduleRules.map((rule) => normalizeRule(rule))
    normalized.scheduleSettings = normalizeScheduleSettings(normalized.scheduleSettings)
    normalized.issues = normalized.issues.map((issue) => normalizeIssue(issue))
    normalized.inventory = normalized.inventory.map((item) => normalizeInventoryItem(item))
    normalized.usageGuides = normalized.usageGuides.map((guide) => normalizeUsageGuide(guide))

    // 변경 이력은 백업 시점 스냅샷으로 덮어쓰면 그 사이에 쌓인 최근 기록이 사라진다.
    // 그래서 다른 항목처럼 통째로 교체하지 않고, id 기준으로 중복 없이 합쳐서 보존한다.
    const incomingLog = Array.isArray(payload.data.changeLog) ? payload.data.changeLog : []
    if (incomingLog.length > 0) {
      const seenIds = new Set()
      normalized.changeLog = [...incomingLog, ...state.value.changeLog]
        .filter((entry) => {
          if (!entry?.id || seenIds.has(entry.id)) return false
          seenIds.add(entry.id)
          return true
        })
        .sort((a, b) => (b.at || '').localeCompare(a.at || ''))
        .slice(0, CHANGE_LOG_LIMIT)
    } else {
      normalized.changeLog = state.value.changeLog
    }

    state.value = { ...normalized, appSettings: normalizeAppSettings(mergedAppSettings) }

    try { localStorage.setItem(appSettingsLsKey, JSON.stringify(state.value.appSettings)) } catch {}
    scheduleAppSettingsWrite()

    // entity 이름을 '전체'로 쓰면 변경이력 화면의 "전체 보기" 필터 버튼과 이름이 겹쳐
    // 버튼이 두 개로 보이는 문제가 있었다(ChangeHistoryPanel.vue 의 historyEntities 가
    // 실제 로그에 쓰인 entity 값도 필터 버튼으로 나열하기 때문) — 구분되는 이름을 쓴다.
    logChange('백업/복원', `백업 복원${payload.exportedAt ? ` (백업일: ${String(payload.exportedAt).slice(0, 10)})` : ''}`, 'update')

    // 백업 복원은 거의 모든 항목을 통째로 덮어쓰므로 어느 문서가 실제로 바뀌었는지 가리지 않고
    // 전체 문서를 다시 쓴다(persist('all') 아래 migrateInlinePhotos 뒤에서 한 번만 호출).
    // 신버전(v3) 백업: 사진 본문(base64) 복원
    const photosMap = payload.data?.photos
    if (photosMap && typeof photosMap === 'object') {
      if (firebaseEnabled && dbLite) {
        // 클라우드: photos 컬렉션에 기록 + 캐시.
        // writeBatch(일반 db)조차도 실시간 리스너용 영속 Write 스트림을 같이 쓰기 때문에,
        // 대량 복원에서는 배치로 건수를 줄여도 그 스트림 자체의 "대기 가능한 쓰기 수" 한도에
        // 걸려 "Write stream exhausted maximum allowed queued writes" 오류가 났다(실측: 1500장
        // ×40KB 재현됨). firestore/lite는 스트림이 아니라 매 커밋마다 일반 HTTP 요청으로
        // 끝나므로 그 한도 자체가 적용되지 않는다 — 대량 일괄 쓰기는 lite 인스턴스를 쓴다.
        const photoEntries = Object.entries(photosMap).filter(([, photo]) => photo?.dataUrl)
        const MAX_BATCH_OPS = 20
        const MAX_BATCH_BYTES = 3 * 1024 * 1024 // Firestore 배치 요청 전체 한도(~10MiB)에 크게 여유를 둔다
        let idx = 0
        while (idx < photoEntries.length) {
          const batch = liteWriteBatch(dbLite)
          const batchEntries = []
          let bytes = 0
          while (idx < photoEntries.length && batchEntries.length < MAX_BATCH_OPS) {
            const [id, photo] = photoEntries[idx]
            const size = photo.dataUrl.length
            if (batchEntries.length > 0 && bytes + size > MAX_BATCH_BYTES) break
            batch.set(liteDoc(dbLite, 'photos', id), {
              dataUrl: photo.dataUrl,
              contentType: photo.contentType || 'image/jpeg',
              createdAt: photo.createdAt || new Date().toISOString(),
              // 백업 파일 속 원래 농장이 아니라 지금 복원하는(현재) 농장으로 귀속시킨다.
              farmId: getFarmId(),
            })
            batchEntries.push([id, photo])
            bytes += size
            idx++
          }
          try {
            await batch.commit()
            for (const [id, photo] of batchEntries) {
              photoCache.value = { ...photoCache.value, [id]: photo.dataUrl }
            }
          } catch (e) {
            console.warn('[farmStore] 백업 사진 복원 실패(배치)', batchEntries.map(([id]) => id), e)
          }
        }
      } else {
        // 로컬 전용 모드: 사진을 배열에 다시 인라인해 localStorage에 보존
        const inject = (arr) => {
          if (!Array.isArray(arr)) return
          for (const p of arr) {
            const m = photosMap[p?.id]
            if (m?.dataUrl && !p.dataUrl) p.dataUrl = m.dataUrl
          }
        }
        state.value.facilities?.forEach((f) => inject(f.photos))
        state.value.ancillaries?.forEach((a) => inject(a.photos))
        state.value.seedlings?.forEach((s) => s.growthLogs?.forEach((l) => inject(l.photos)))
        state.value.tasks?.forEach((t) => t.logs?.forEach((l) => inject(l.photos)))
        state.value.issues?.forEach((i) => {
          inject(i.photos)
          i.resolutionSteps?.forEach((st) => inject(st.photos))
        })
      }
    }

    // 구버전 백업(사진이 배열에 인라인으로 박힌 경우)은 먼저 photos 컬렉션으로 이전해
    // 거대한 인라인 상태가 localStorage/Firestore 한도에 걸리는 일을 막는다.
    await migrateInlinePhotos()
    await persist('all')
    return backupSummary(payload)
  }

  return { exportBackup, exportBackupWithPhotos, isValidBackup, backupSummary, restoreBackup }
}
