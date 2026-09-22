import {
  collection, doc, getDoc, getDocs, setDoc,
} from 'firebase/firestore'
import { db } from './firebase.js'
import { DOMAIN_KEYS, domainFields } from '../utils/farmDataSchema.js'
import { canAccessFarm } from '../utils/farmAccess.js'
import { useAuthStore } from '../stores/authStore.js'

// 시스템 관리는 슈퍼관리자 로그인 상태에서만 들어올 수 있으므로(FarmSelectScreen.vue
// handleAdminClick) 이 필터는 대부분 그냥 다 통과한다 — 그래도 접근 권한 판단은
// firestore.rules와 항상 같은 곳(farmAccess.js)에서 하도록 남겨둔다.
function accessibleFarmDoc(farmDoc) {
  const authStore = useAuthStore()
  return canAccessFarm({ id: farmDoc.id, ...farmDoc.data() }, {
    uid: authStore.user?.uid,
    isSuperAdmin: authStore.isSuperAdmin,
  })
}

const BACKUP_TYPE = 'citrus-admin-backup'
const CHANGE_LOG_LIMIT = 300 // farmStore.js의 값과 맞춘다

// sharedCache 중 사용자가 만든 데이터라 다시 만들 수 없는 것들.
// (pesticide:all·detail-index·병해충 캐시 등은 공공데이터에서 다시 받으면 되므로 백업에 넣지 않는다)
const SHARED_CACHE_DOCS = [
  'pesticide:manual', // 공공데이터에 없어 직접 등록한 농약
  'app:policy',       // 전 기기 공통 정책(농약 직접등록 권한 등)
]

// 시스템 관리 모드 전용 백업: 공통 설정(appSettings) + 공용 데이터 + 등록된 모든 농장의 데이터.
// 농장 모드 백업(farmStore.exportBackup 등)과 달리 사진 본문은 포함하지 않는다(용량이 커질 수 있어
// 필요 시 각 농장에서 개별적으로 백업/복원하도록 안내한다).
export async function exportAllFarmsBackup() {
  const appSettingsSnap = await getDoc(doc(db, 'shared', 'appSettings'))
  const sharedCacheSnaps = await Promise.all(
    SHARED_CACHE_DOCS.map((key) => getDoc(doc(db, 'sharedCache', key))),
  )
  const sharedCache = {}
  SHARED_CACHE_DOCS.forEach((key, i) => {
    if (sharedCacheSnaps[i].exists()) sharedCache[key] = sharedCacheSnaps[i].data()
  })

  const farmsSnap = await getDocs(collection(db, 'farms'))

  const farms = {}
  const skipped = []
  const failed = []
  for (const farmDoc of farmsSnap.docs) {
    const farmId = farmDoc.id
    if (!accessibleFarmDoc(farmDoc)) {
      skipped.push(farmDoc.data()?.name ?? farmId)
      continue
    }
    try {
      // 농장별 데이터는 이제 facilities/tasks/issues/... 문서로 나뉘어 있다(src/utils/farmDataSchema.js의
      // DOMAIN_SYNC 참고). 백업 파일 형식은 그대로 유지하기 위해 여기서 한 번 합쳐 예전과 같은
      // "farmData 문서 하나" 모양(모든 필드가 한 객체에 들어있는 형태)으로 만든다
      // — 복원(restoreAllFarmsBackup)에서 다시 문서별로 나눠 쓴다.
      const [domainSnaps, apSnap, recSnap, treatSnap] = await Promise.all([
        Promise.all(DOMAIN_KEYS.map((key) => getDoc(doc(db, 'farms', farmId, 'data', key)))),
        getDoc(doc(db, 'farms', farmId, 'data', 'availablePesticide')),
        getDoc(doc(db, 'farms', farmId, 'data', 'recommendSettings')),
        getDoc(doc(db, 'farms', farmId, 'data', 'treatments')),
      ])
      const farmData = {}
      let hasAnyDomainDoc = false
      domainSnaps.forEach((snap) => {
        if (snap.exists()) {
          hasAnyDomainDoc = true
          Object.assign(farmData, snap.data())
        }
      })
      farms[farmId] = {
        meta: farmDoc.data(),
        farmData: hasAnyDomainDoc ? farmData : null,
        availablePesticide: apSnap.exists() ? apSnap.data() : null,
        recommendSettings: recSnap.exists() ? recSnap.data() : null,
        treatments: Array.isArray(treatSnap.data()?.treatments) ? treatSnap.data().treatments : [],
      }
    } catch (e) {
      console.warn('[adminBackup] 농장 백업 실패', farmId, e)
      failed.push(farmDoc.data()?.name ?? farmId)
    }
  }

  return {
    type: BACKUP_TYPE,
    version: 2, // 2부터 sharedCache 포함
    exportedAt: new Date().toISOString(),
    data: {
      appSettings: appSettingsSnap.exists() ? appSettingsSnap.data() : {},
      sharedCache,
      farms,
    },
    // 다운로드되는 백업 파일 JSON에도 그대로 포함된다(호출한 쪽이 payload 전체를
    // JSON.stringify해서 저장함). 다만 복원(restoreAllFarmsBackup)은 이 두 필드를
    // 읽지 않고 data만 사용하므로, 복원 동작에는 영향이 없다.
    skippedFarmNames: skipped,
    failedFarmNames: failed,
  }
}

export function isValidAllFarmsBackup(payload) {
  return !!(payload && payload.type === BACKUP_TYPE && payload.data && typeof payload.data === 'object')
}

export function allFarmsBackupSummary(payload) {
  const farmEntries = Object.entries(payload?.data?.farms ?? {})
  return {
    farmCount: farmEntries.length,
    farms: farmEntries.map(([id, f]) => ({
      id,
      name: f?.meta?.name ?? id,
      treatments: Array.isArray(f?.treatments) ? f.treatments.length : 0,
    })),
    hasAppSettings: !!(payload?.data?.appSettings && Object.keys(payload.data.appSettings).length),
    manualPesticides: (payload?.data?.sharedCache?.['pesticide:manual']?.data ?? []).length,
  }
}

// 백업에 있는 농장을 그대로 덮어쓰고(+없는 필드는 유지), 백업에 없던 농장은 건드리지 않는다.
export async function restoreAllFarmsBackup(payload) {
  if (!isValidAllFarmsBackup(payload)) {
    throw new Error('invalid-admin-backup')
  }

  const { appSettings, sharedCache, farms } = payload.data

  if (appSettings && typeof appSettings === 'object') {
    await setDoc(doc(db, 'shared', 'appSettings'), appSettings, { merge: true })
  }

  // 구버전(version 1) 백업에는 sharedCache가 없다 — 그때는 이 단계를 건너뛴다.
  // 백업에 담기로 한 문서만 복원한다(알 수 없는 키가 섞여 들어오는 것을 막는다).
  for (const key of SHARED_CACHE_DOCS) {
    const value = sharedCache?.[key]
    if (value && typeof value === 'object') {
      await setDoc(doc(db, 'sharedCache', key), value, { merge: true })
    }
  }

  // 농장 하나가 거부(권한 없음)되거나 실패해도 나머지 농장 복원은 계속한다 — 예전엔
  // 한 곳에서 멈추면 그 뒤 농장은 조용히 복원 안 된 채로 남았다.
  const failed = []
  for (const [farmId, farmPayload] of Object.entries(farms || {})) {
    try {
      if (farmPayload.meta) {
        await setDoc(doc(db, 'farms', farmId), farmPayload.meta, { merge: true })
      }
      if (farmPayload.farmData) {
        // farmPayload.farmData는 예전 단일 문서와 같은 모양의 평면 객체다(내보낼 때 문서별로
        // 나뉜 데이터를 합쳐서 만든 것 — exportAllFarmsBackup 참고). 여기서 다시 문서별로
        // 나눠 쓴다. 변경 이력(changeLog)은 백업 시점 스냅샷으로 통째로 덮어쓰면 그 사이에
        // 쌓인 기록이 사라지므로, 쓰기 전에 현재 값과 id 기준으로 합쳐서 보존한다.
        const farmDataToWrite = { ...farmPayload.farmData }
        const incomingLog = Array.isArray(farmDataToWrite.changeLog) ? farmDataToWrite.changeLog : []
        if (incomingLog.length > 0) {
          const currentSnap = await getDoc(doc(db, 'farms', farmId, 'data', 'changeLog'))
          const currentLog = Array.isArray(currentSnap.data()?.changeLog) ? currentSnap.data().changeLog : []
          const seenIds = new Set()
          farmDataToWrite.changeLog = [...incomingLog, ...currentLog]
            .filter((entry) => {
              if (!entry?.id || seenIds.has(entry.id)) return false
              seenIds.add(entry.id)
              return true
            })
            .sort((a, b) => (b.at || '').localeCompare(a.at || ''))
            .slice(0, CHANGE_LOG_LIMIT)
        }

        const now = new Date().toISOString()
        await Promise.all(
          DOMAIN_KEYS.map((key) => {
            const fields = domainFields(key)
            const docPayload = {}
            let hasField = false
            fields.forEach((field) => {
              if (farmDataToWrite[field] !== undefined) {
                docPayload[field] = farmDataToWrite[field]
                hasField = true
              }
            })
            if (!hasField) return null // 백업에 이 문서에 해당하는 필드가 하나도 없으면(구버전 백업 등) 건드리지 않는다.
            docPayload.updatedAt = now
            return setDoc(doc(db, 'farms', farmId, 'data', key), docPayload, { merge: true })
          }).filter(Boolean),
        )
      }
      if (farmPayload.availablePesticide) {
        await setDoc(doc(db, 'farms', farmId, 'data', 'availablePesticide'), farmPayload.availablePesticide, { merge: true })
      }
      if (farmPayload.recommendSettings) {
        await setDoc(doc(db, 'farms', farmId, 'data', 'recommendSettings'), farmPayload.recommendSettings, { merge: true })
      }
      if (Array.isArray(farmPayload.treatments)) {
        // 다른 도메인 문서와 같은 방식(배열 하나)으로 저장되므로 통째로 한 번에 쓴다 —
        // 레코드별 문서였을 때 필요했던 대량 배치 삭제·재생성(및 그 때문에 쓰던 firestore/lite)이
        // 더는 필요 없다.
        await setDoc(
          doc(db, 'farms', farmId, 'data', 'treatments'),
          { treatments: farmPayload.treatments, updatedAt: new Date().toISOString() },
          { merge: true },
        )
      }
    } catch (e) {
      console.warn('[adminBackup] 농장 복원 실패', farmId, e)
      failed.push(farmPayload?.meta?.name ?? farmId)
    }
  }

  return { failedFarmNames: failed }
}
