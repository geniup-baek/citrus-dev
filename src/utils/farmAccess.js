// firestore.rules 의 canAccessFarm/isPublicFarm/isOwner/isSuperAdmin 과 반드시 같은 논리를
// 유지해야 한다 — 여긴 "목록에 보일지"를 판단하는 클라이언트 쪽 판단일 뿐이고, 실제 접근
// 통제는 규칙이 한다. 규칙을 바꾸면 이 파일도 같이 바꿔야 한다.
export function isPublicFarm(farm) {
  const ownerUid = farm?.ownerUid ?? null
  const visibility = farm?.visibility ?? 'private'
  return ownerUid == null || visibility === 'public'
}

export function canAccessFarm(farm, { uid = null, isSuperAdmin = false } = {}) {
  if (!farm) return false
  if (isPublicFarm(farm)) return true
  if (isSuperAdmin) return true
  return !!uid && farm.ownerUid === uid
}
