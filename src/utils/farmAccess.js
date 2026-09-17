// firestore.rules 의 canAccessFarm/isPublicFarm/isOwner/isSuperAdmin 과 반드시 같은 논리를
// 유지해야 한다 — 여긴 "목록에 보일지"를 판단하는 클라이언트 쪽 판단일 뿐이고, 실제 접근
// 통제는 규칙이 한다. 규칙을 바꾸면 이 파일도 같이 바꿔야 한다.
//
// ⚠ 딱 한 곳은 의도적으로 규칙과 다르다: 규칙의 canAccessFarm은 "농장 문서 자체가
// 없으면"(정리 중인 상태) 접근을 허용하지만, 여기 canAccessFarm(farm, ...)에 farm이
// null/undefined로 들어오는 건 그 상황이 아니라 거의 항상 "아직 데이터 로딩 중"이다
// — 그때 true를 반환하면 로딩 중 잠깐 "접근 가능"처럼 잘못 보이는 화면 깜빡임이
// 생긴다. 그래서 여기는 false로 안전한 쪽을 택한다(어차피 이 함수가 실제 접근을
// 막는 게 아니라 UI 표시만 판단하므로, 서버 쪽 정리 시나리오와는 무관하다).
//
// ⚠ ownerUid(실제 Firebase UID)는 farm 문서에 없다 — farms 컬렉션은 농장 선택
// 화면 때문에 read가 완전히 열려 있어서, 거기 있는 필드는 로그인 안 한 사람도
// 그대로 읽어 간다(firestore.rules의 farms/{farmId} 주석 참고). 실제 UID는
// farms/{farmId}/private/owner 서브문서로 분리했고, 그 문서는 소유자 본인·
// 슈퍼관리자만 읽을 수 있다. 그래서 "이 농장이 내 것인지"는 서버 쪽 소유권
// 판단과 별도로, 로그인 시점에 검증해 둔 ownedFarmIds 목록(farmMembersStore.js의
// myOwnedFarmIds, memberFarmIds/myFarmIds와 같은 패턴)으로 판단한다.
export function isPublicFarm(farm) {
  return (farm?.visibility ?? 'private') === 'public'
}

export function canAccessFarm(farm, { isSuperAdmin = false, ownedFarmIds = [] } = {}) {
  if (!farm) return false
  if (isPublicFarm(farm)) return true
  if (isSuperAdmin) return true
  return ownedFarmIds.includes(farm.id)
}

// 농장종사자 기능별 권한. 도메인 키는 src/utils/farmDataSchema.js의 DOMAIN_KEYS와
// 같다(changeLog 제외 — changeLog는 별도 토글 없이 구성원이면 항상 읽고 쓸 수 있다).
export const PERMISSION_DOMAINS = [
  'facilities', 'ancillaries', 'seedlings', 'tasks', 'issues', 'inventory', 'usageGuides', 'treatments',
]

// availablePesticide/recommendSettings 문서는 별도 토글 없이 treatments 권한을 따른다.
export function domainKeyFor(docId) {
  return docId === 'availablePesticide' || docId === 'recommendSettings' ? 'treatments' : docId
}

export function memberPermission(member, domain, mode) {
  return member?.permissions?.[domainKeyFor(domain)]?.[mode] === true
}

// docId가 'changeLog'면 구성원이기만 하면 항상 허용 — firestore.rules의
// canReadFarmDomain/canWriteFarmDomain과 반드시 같은 논리를 유지해야 한다.
export function canReadFarmDomain(farm, docId, { isSuperAdmin = false, ownedFarmIds = [], member = null } = {}) {
  if (canAccessFarm(farm, { isSuperAdmin, ownedFarmIds })) return true
  if (!member) return false
  if (docId === 'changeLog') return true
  return memberPermission(member, docId, 'read') || memberPermission(member, docId, 'write')
}

export function canWriteFarmDomain(farm, docId, { isSuperAdmin = false, ownedFarmIds = [], member = null } = {}) {
  if (canAccessFarm(farm, { isSuperAdmin, ownedFarmIds })) return true
  if (!member) return false
  if (docId === 'changeLog') return true
  return memberPermission(member, docId, 'write')
}

// 각 라우트가 다루는 도메인 목록 — router/index.js(라우트 가드)와 AppHeader.vue(내비 숨김)가
// 같이 참조한다. 목록에 없는 라우트(대시보드·자료·설정)는 도메인 권한과 무관하게 항상 허용.
export const ROUTE_DOMAINS = {
  '/farm-status': ['facilities', 'ancillaries', 'seedlings', 'inventory', 'usageGuides'],
  '/tasks': ['tasks'],
  '/issues': ['issues'],
  '/pesticide-recommend': ['inventory', 'treatments'],
}
