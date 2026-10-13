import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db, firebaseEnabled } from './firebase.js'
import { LS_PREFIX } from '../utils/storagePrefix.js'

export const CACHE_PREFIX = `${LS_PREFIX}:`
const PREFIX = CACHE_PREFIX
const SHARED_COLLECTION = 'sharedCache'

// 로컬(개발 서버 프록시)에서만 성공하는 OpenAPI 전체 조회 결과를 Firestore에 올려,
// 배포된 환경(GitHub Pages 등, 직접 API 호출 불가)과 공유한다.
export async function pushSharedCache(key, data) {
  if (!firebaseEnabled || !db) return
  try {
    await setDoc(doc(db, SHARED_COLLECTION, key), {
      data,
      fetchedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.warn(`[cache] 공유 캐시 업로드 실패: ${key}`, e)
  }
}

// Firestore에 공유된 캐시를 로컬로 가져온다. 로컬 캐시가 없거나 더 오래된 경우에만 덮어쓴다.
export async function pullSharedCache(key) {
  if (!firebaseEnabled || !db) return
  try {
    const snap = await getDoc(doc(db, SHARED_COLLECTION, key))
    if (!snap.exists()) return
    const remote = snap.data()
    const local = loadCache(key)
    if (local?.fetchedAt && local.fetchedAt >= remote.fetchedAt) return
    localStorage.setItem(PREFIX + key, JSON.stringify({ data: remote.data, fetchedAt: remote.fetchedAt }))
  } catch (e) {
    console.warn(`[cache] 공유 캐시 조회 실패: ${key}`, e)
  }
}

export function saveCache(key, data) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({
      data,
      fetchedAt: new Date().toISOString(),
    }))
  } catch {}
}

export function loadCache(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    return JSON.parse(raw) // { data, fetchedAt }
  } catch {
    return null
  }
}

// fn 성공 시 캐시 저장(+ Firestore 공유), 실패 시 로컬 캐시에서 복원
// 로컬 캐시도 없으면(배포 환경 첫 방문 등) Firestore 공유 캐시를 당겨와 재시도한다.
// 반환: { result, fromCache, fetchedAt, cacheError }
// 그래도 없으면 원래 에러를 그대로 throw
export async function withCache(key, fn) {
  try {
    const result = await fn()
    const fetchedAt = new Date().toISOString()
    saveCache(key, result)
    pushSharedCache(key, result)
    return { result, fromCache: false, fetchedAt, cacheError: null }
  } catch (e) {
    let cached = loadCache(key)
    if (!cached) {
      await pullSharedCache(key)
      cached = loadCache(key)
    }
    if (cached) {
      return {
        result: cached.data,
        fromCache: true,
        fetchedAt: cached.fetchedAt,
        cacheError: e.message,
      }
    }
    throw e
  }
}

export function formatFetchedAt(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 로컬 실행 환경에서 가져와 Firestore에 공유해둔 OpenAPI 전건 캐시를, 직접 API 호출이 불가한
// 배포 환경(GitHub Pages 등)에서도 쓸 수 있도록 동기화한다. pesticide:manual은 사용자가 직접
// 등록한 농약 목록, pesticide:detail-index는 상세정보 중 목록에 없는 값(독성·주성분)만 뽑아
// 압축한 색인 — 둘 다 같은 방식으로 기기 간 공유한다. sharedCache는 로그인해야 읽을 수
// 있어서, 앱 시작 시가 아니라 로그인이 확인된 뒤(App.vue)에 한 번 호출한다.
let sharedCachesPulled = false
export function pullAllSharedCaches() {
  if (sharedCachesPulled) return
  sharedCachesPulled = true
  ;['pesticide:all', 'pesticide:manual', 'pesticide:detail-index', 'pest:diseases:all', 'pest:pathogens:all', 'pest:insects:all', 'pest:prediction']
    .forEach((key) => pullSharedCache(key))
}
