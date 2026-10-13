// firestore.rules 의 canAccessFarm/isOwner/isSuperAdmin 과 반드시 같은 논리를 유지해야
// 한다 — 여긴 "목록에 보일지"를 판단하는 클라이언트 쪽 판단일 뿐이고, 실제 접근 통제는
// 규칙이 한다. 규칙을 바꾸면 이 파일도 같이 바꿔야 한다.
//
// ⚠ 딱 한 곳은 의도적으로 규칙과 다르다: 규칙의 canAccessFarm은 "농장 문서 자체가
// 없으면"(정리 중인 상태) 접근을 허용하지만, 여기 canAccessFarm(farm, ...)에 farm이
// null/undefined로 들어오는 건 그 상황이 아니라 거의 항상 "아직 데이터 로딩 중"이다
// — 그때 true를 반환하면 로딩 중 잠깐 "접근 가능"처럼 잘못 보이는 화면 깜빡임이
// 생긴다. 그래서 여기는 false로 안전한 쪽을 택한다(어차피 이 함수가 실제 접근을
// 막는 게 아니라 UI 표시만 판단하므로, 서버 쪽 정리 시나리오와는 무관하다).
//
// 공개 농장 개념이 없어서(모든 농장은 소유자가 있음), farms/{farmId}는 소유자·
// 구성원·슈퍼관리자만 애초에 읽을 수 있다(firestore.rules) — 그래서 ownerUid를
// 그대로 farm 문서에 두고 uid만 비교하면 된다(예전처럼 서브문서로 숨길 필요 없음).
export function canAccessFarm(farm, { uid = null, isSuperAdmin = false } = {}) {
  if (!farm) return false
  if (isSuperAdmin) return true
  return !!uid && farm.ownerUid === uid
}

// 농장종사자 기능별 권한. 도메인 키는 src/utils/farmDataSchema.js의 DOMAIN_KEYS와
// 같다. changeLog 데이터 자체는 별도 토글 없이 구성원이면 항상 읽고 쓸 수 있다(규칙 기준).
export const PERMISSION_DOMAINS = [
  'facilities', 'ancillaries', 'seedlings', 'tasks', 'issues', 'inventory', 'usageGuides', 'treatments',
  // 설정 화면의 기능 권한 — 데이터 문서가 아니라 화면(탭)·버튼 단위의 UI 권한이다(firestore.rules는
  // 이 키들을 보지 않는다). 변경 이력은 다른 도메인을 수정할 때마다 자동으로 기록이 쌓여서
  // (logChange) 서버에서 읽기를 막으면 이력이 덮어써질 위험이 있어 화면에서만 가린다.
  'changeLog', 'behavior', 'backup',
]

// 설정 화면의 관리 기능(데이터 도메인과 구분해서 권한 화면에 따로 묶어 보여 준다).
export const ADMIN_FEATURES = ['changeLog', 'behavior', 'backup']
export const DATA_DOMAINS = PERMISSION_DOMAINS.filter((d) => !ADMIN_FEATURES.includes(d))

// availablePesticide/recommendSettings 문서는 별도 토글 없이 treatments 권한을 따른다.
export function domainKeyFor(docId) {
  return docId === 'availablePesticide' || docId === 'recommendSettings' ? 'treatments' : docId
}

export function memberPermission(member, domain, mode) {
  return member?.permissions?.[domainKeyFor(domain)]?.[mode] === true
}

// docId가 'changeLog'면 구성원이기만 하면 항상 허용 — firestore.rules의
// canReadFarmDomain/canWriteFarmDomain과 반드시 같은 논리를 유지해야 한다.
export function canReadFarmDomain(farm, docId, { uid = null, isSuperAdmin = false, member = null } = {}) {
  if (canAccessFarm(farm, { uid, isSuperAdmin })) return true
  if (!member) return false
  if (docId === 'changeLog') return true
  return memberPermission(member, docId, 'read') || memberPermission(member, docId, 'write')
}

export function canWriteFarmDomain(farm, docId, { uid = null, isSuperAdmin = false, member = null } = {}) {
  if (canAccessFarm(farm, { uid, isSuperAdmin })) return true
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

// 설정 화면 기능(변경 이력·동작·저장백업) 사용 권한 — 화면 단위 UI 판단. 소유자·슈퍼관리자는 항상 허용.
export function canUseFeature(farm, key, mode, { uid = null, isSuperAdmin = false, member = null } = {}) {
  if (canAccessFarm(farm, { uid, isSuperAdmin })) return true
  if (mode === 'write') return memberPermission(member, key, 'write')
  return memberPermission(member, key, 'read') || memberPermission(member, key, 'write')
}
