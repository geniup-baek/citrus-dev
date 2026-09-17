# 유지보수 가이드

이 문서는 이 프로젝트를 처음 맡아 유지보수하게 될 사람을 위한 문서입니다. 설치·배포 방법은 [README.md](README.md)를 참고하세요. 이 문서는 "어떻게 실행하는가"가 아니라 **"왜 이렇게 만들어져 있는가", "무엇을 조심해야 하는가"**를 다룹니다.

---

## 1. 이 앱은 무엇인가

감귤 농장 운영을 위한 협업 도구(PWA)입니다. 로그인이 없고, 같은 농장을 보는 사람은 모두 같은 Firestore 데이터를 실시간으로 공유합니다. 주요 기능:

- 재배동·시설장비·묘목 관리
- 작업(할 일) 계획과 반복 일정, 진행 기록
- 문제(병해충 등) 발생·해결 기록, 유사 사례 추천
- 비료·농약 재고(입출고 이력 기반)
- 방제이력, 농약 추천(공공데이터 기반), 가용농약 관리
- 병해충·농약 지식 자료(용어집, 사용법 안내 등)
- 변경 이력(감사 로그) — 누가 언제 무엇을 바꿨는지
- 백업/복원, PWA 오프라인 지원

**농장은 여러 개 등록될 수 있고, 농장마다 데이터가 완전히 분리**됩니다. 병해충·농약 공공데이터와 분류·항목 설정만 모든 농장이 공유합니다.

---

## 2. 인증·소유권 모델 (가장 중요한 전제)

이 앱을 유지보수하기 전에 반드시 이해해야 하는 구조적 전제입니다. Firebase Auth(이메일/비밀번호)와 농장 소유권 강제가 도입되어 있지만, **일부 컬렉션은 여전히 의도적으로 전체 공개**입니다 — 어디까지 막혀 있고 어디는 아직 아닌지 구분해서 이해해야 합니다.

- **`farms/{farmId}`와 그 하위(`data/*`, `treatments/*`)는 소유권 + 구성원 권한으로 막혀 있습니다.** `ownerUid`가 없거나(`null`) `visibility`가 `'public'`인 농장은 누구나 읽고 쓸 수 있고, `ownerUid`가 있는 농장은 그 소유자·슈퍼관리자(`users/{uid}.role == 'super_admin'`)·그리고 그 농장의 `members/{uid}` 문서에 도메인별(재배동·작업·문제·재고 등) 권한이 있는 구성원만 접근할 수 있습니다. 규칙 로직은 `firestore.rules`에, 클라이언트 쪽 같은 판단은 `src/utils/farmAccess.js`(`canReadFarmDomain`/`canWriteFarmDomain`)에 있고 **둘은 반드시 같은 논리를 유지해야 합니다.**
- **농장종사자 초대는 최상위 `inviteCodes/{code}` 문서로 이뤄집니다.** 농장주가 권한을 골라 코드를 발급하면(`src/stores/farmMembersStore.js`), 그 코드를 받은 사람이 농장 선택 화면에서 입력해 `farms/{farmId}/members/{uid}`를 그 권한 그대로 생성합니다. 코드는 농장 PIN과 같은 수준의 신뢰 모델(강한 암호화 대상 아님, 엄밀한 1회용 아님)이고, 이메일을 직접 보내는 기능은 없습니다(백엔드가 없어서 카톡 등으로 직접 전달). 구성원이 자기 농장 목록에서 그 농장을 보려면 `users/{uid}.memberFarmIds`(합류할 때 자기 자신이 적어 넣음)를 로그인 시 한 번 확인해 farmsStore의 접근 가능 목록에 합칩니다.
- **`photos/*`(전역 사진 저장소)와 레거시 전역 컬렉션(`shared/farmData`, `shared/availablePesticide`, 최상위 `treatments/*`)은 여전히 `allow read, write: if true`입니다.** 사진 문서엔 어느 농장 것인지 식별할 필드가 전혀 없어(농장별로 나누려면 데이터 마이그레이션이 필요) 이번 라운드에서 일부러 손대지 않았습니다 — 알고 있는, 아직 남은 구멍입니다.
- **농장/시스템관리 PIN은 인증이 아니라 2차 확인일 뿐입니다.** `src/components/FarmSelectScreen.vue`의 PIN 입력은 실수로 다른 농장·관리 모드에 들어가는 걸 막는 가벼운 절차입니다. 시스템 관리(PIN) 자체도 이제 **슈퍼관리자 로그인**이 선행 조건입니다(`handleAdminClick`) — PIN만으로는 더 이상 들어갈 수 없습니다.
- **소유자 없는 농장은 앞으로도 계속 소유자 없이 남을 수 있습니다.** 일괄 마이그레이션(백필)을 하지 않기로 결정했습니다 — 로그인한 사용자가 농장 목록에서 자신을 소유자로 지정하는 "소유권 주장"만 규칙에서 허용해 뒀고(`farms/{farmId}` update 규칙), 그 위에 얹을 UI는 아직 없습니다.
- **변경 이력(감사 로그)의 "누가"는 아직 로그인 기반이 아닙니다.** 기기별로 로컬에 저장하는 자율 입력 이름(`citrus:actor-name`, localStorage만, Firestore 동기화 안 함)입니다. 신뢰할 수 있는 신원 증명이 아니라 "참고용" 표시입니다.

---

## 3. 기술 스택

- Vue 3 (`<script setup>`) + Vue Router(해시 히스토리) + Pinia
- Firebase Firestore (실시간 동기화), Firebase Hosting은 사용하지 않고 **GitHub Pages**에 배포(`.github/workflows/deploy.yml`, main 브랜치 push 시 자동)
- `vite-plugin-pwa` (오프라인 캐싱 + 설치 가능한 PWA)
- 외부 공공데이터: 농약안전정보시스템(PIS, `src/services/pesticide.js`), 국가농작물병해충관리시스템(NCPMS, `src/services/ncpms.js`) — 개발 모드에서만 Vite 프록시로 직접 호출 가능, **운영 빌드에서는 호출 불가**(아래 8장 참고)
- 테스트 프레임워크·린터 설정 없음 (package.json에 별도 스크립트 없음)

실행:

```bash
npm install
npm run dev      # 로컬 개발 서버
npm run build    # 운영 빌드 (dist/)
npm run preview  # 빌드 결과 미리보기
```

---

## 4. 앱 진입 흐름

1. `main.js`: Vue 앱 생성 → Pinia/Router 장착 → mount → **마운트 후** 공공데이터 공유 캐시(`sharedCache/*`) 7종을 Firestore에서 당겨옴 → PWA 서비스워커 등록.
2. `App.vue` `onMounted`: `farmsStore.init()`, `appPolicyStore.init()`, `farmStore.initAppSettings()`를 동시에 실행(이 셋은 농장과 무관하게 항상 필요).
3. `farmsStore.activeFarm.id`가 정해지는 순간(`watch`, `immediate: true`) — **농장 전환/관리모드 전환은 항상 전체 페이지 새로고침(`window.location.reload()`)으로 처리**하므로 이 watch는 실질적으로 "앱 시작 시 1회"만 의미 있게 동작합니다 — 다음 순서로 농장별 스토어를 초기화합니다:
   `farmStore.init(farmId)` → `treatmentStore.init(farmId)` → `availablePesticideStore.init(farmId)` → `recommendSettingsStore.init(farmId)`
4. 화면 분기: 로딩 중 → 마이그레이션 오류 → `FarmSelectScreen`(농장이 없거나 아직 선택 안 함) → 일반 앱 화면.

시스템 관리 모드에서는 농장별 스토어가 초기화되지 않으므로, 라우터 가드(`src/router/index.js`)가 관리 모드에서 `/resources`, `/settings` 외의 경로 접근을 막고 `/resources`로 돌려보냅니다.

---

## 5. 스토어 지도

| 스토어 | 범위 | Firestore 경로 | 역할 |
|---|---|---|---|
| `farmsStore.js` | 전역(농장 목록) | `farms/{farmId}`, 마이그레이션 플래그 `shared/appMeta` | 농장 생성/이름변경/로고/PIN/삭제(소프트)/복원, 관리모드 전환. **농장 "데이터"는 다루지 않음**. 농장 문서의 `ownerUid`(생성자가 로그인 상태였으면 그 uid, 아니면 `null`)/`visibility`(`'private'`\|`'public'`)는 이제 규칙(`firestore.rules`)에서 실제로 접근을 제한한다 — 접근 가능한 농장 목록은 소유권(`farmAccess.canAccessFarm`) **또는** 구성원 자격(`farmMembersStore.myFarmIds`)이 있으면 포함됨 |
| `farmMembersStore.js` | 농장 1개(구성원 목록) + 전역(내가 속한 농장) | `inviteCodes/{code}`, `farms/{farmId}/members/{uid}`, `farms/{farmId}/inviteCodeRefs/{code}`, `users/{uid}.memberFarmIds` | 농장종사자 초대 코드 발급/폐기, 구성원별 도메인 권한(`canRead`/`canWrite`) 관리. 소유자·슈퍼관리자는 구성원 전체 목록을 구독하고, 일반 구성원은 자기 권한 문서만 구독함 |
| `farmStore.js` | 농장 1개 | `farms/{farmId}/data/{facilities,ancillaries,seedlings,tasks,issues,inventory,usageGuides,changeLog}` (도메인별 문서 8개, 6.1 참고) | 재배동·시설장비·묘목·작업·문제·재고·사용법·**변경이력(changeLog)**. 앱에서 가장 크고 중심적인 스토어. `farmStore.js` 자체는 배관(초기화·저장·구독)만 하고, 실제 CRUD는 `src/stores/farmStore/*.js`로 도메인별로 나뉘어 있음(6.1 참고) |
| `treatmentStore.js` | 농장 1개 | `farms/{farmId}/treatments/{id}` | 방제이력(방제 스프레이 기록). 문서 하나가 아니라 **레코드별 컬렉션**이라 다른 스토어와 저장 방식이 다름 |
| `availablePesticideStore.js` | 농장 1개 | `farms/{farmId}/data/availablePesticide` | "가용농약" = 구입가능 텍스트 입력 + 재고 데이터를 합쳐서 만든 실사용 가능 농약 목록 |
| `recommendSettingsStore.js` | 농장 1개(정책) + 기기 로컬(취향) | `farms/{farmId}/data/recommendSettings` | 농약 추천 정책(MOA 충돌일수, 연간 최대 사용횟수 등), 재배 품종, **"초기화 버튼 표시"/"변경이력 삭제 버튼 표시" 같은 농장별 기능 노출 여부** |
| `appPolicyStore.js` | 전역(모든 농장·모든 기기) | `sharedCache/app:policy` | 농장과 무관한 전역 정책 — **"초기화 기능"/"변경이력 삭제 기능" 자체를 켤지 끌지**, 농약 직접등록 허용 범위, PDF 자동 인쇄 등 |
| `localeStore.js` | — | — | 사실상 다국어가 아니라 **한국어 메시지 상수 모듈**(`i18n/messages.js`)에 대한 `t(path, params)` 래퍼. 다른 언어 파일 없음 |

`farmStore.state`(단수)와 `farmsStore.farms`(복수)는 이름이 비슷해서 혼동하기 쉽습니다 — **`farmStore`는 "지금 선택된 농장의 데이터", `farmsStore`는 "농장이라는 개체 자체의 목록"**입니다.

---

## 6. 핵심 관례 (새 기능을 추가하기 전에 알아야 할 패턴)

### 6.1 `farmStore.js`는 배관만, CRUD는 `src/stores/farmStore/*.js`

`farmStore.js`(약 300줄)는 `state`/`actorName` 정의, 초기화(`init`)·저장(`persist`)·구독(`onSnapshot`) 배관, 그리고 아래 도메인 모듈들을 만들어 엮는 일만 합니다. 실제 엔티티별 로직은 `src/stores/farmStore/` 폴더에 있습니다:

| 파일 | 내용 |
|---|---|
| `changeLog.js` | `logChange()` 본체(state 필요) |
| `revert.js` | 변경 이력 되돌리기 dispatch + 이력 삭제 |
| `photos.js` | 사진 분산 저장(캐시·업로드·GC) |
| `facilities.js` / `ancillaries.js` / `seedlings.js` / `tasks.js` / `issues.js` / `usageGuides.js` / `inventory.js` | 엔티티별 CRUD(+하위 기록) + 그 항목의 "전체 초기화" |
| `scheduler.js` | 반복 작업 규칙 + 자동 생성 |
| `backup.js` | 농장별 백업 내보내기/복원 |

이 폴더의 파일은 전부 `state`(및 `persist`/`logChange` 등)를 받는 **팩토리 함수**라 `farmStore.js`(그리고 서로)만 가져다 씁니다. 반대로 **state 없이 순수 함수만 있는** `normalize`/`changeLogUtils`는 `src/utils/farmDataSchema.js`·`src/utils/changeLogUtils.js`에 있습니다 — farmStore 바깥(`farmsStore.js`의 농장 완전 삭제, `services/adminBackup.js`의 관리자 백업, `treatmentStore.js`의 방제이력)에서도 같은 정규화·diff 로직이 필요해서, "state를 참조하는지"를 기준으로 이 폴더 안/밖을 나눴습니다 — 새 순수 함수를 farmStore 바깥에서도 써야 한다면 `farmStore/` 안에 새로 만들지 말고 `src/utils/`에 두세요.

각 도메인 파일은 `createXActions(ctx)` 형태의 **팩토리 함수**를 export합니다. `ctx`는 `farmStore.js`가 만들어 넘기는 공유 객체로 `{ state, persist, logChange, facilityNameById, photoCache, savePhotos, ... }`를 담고 있습니다. 되돌리기(`revert.js`)는 모든 도메인 모듈이 만들어진 **뒤**에 그 모듈들의 upsert/update 함수를 참조(registry)로 받아 조립됩니다 — 이 순서를 지켜야 순환 참조 없이 되돌리기가 어떤 엔티티든 처리할 수 있습니다.

모든 변경 함수는 이 모양을 따릅니다:

```js
async function upsertFacility(payload) {
  const index = state.value.facilities.findIndex((item) => item.id === payload.id)
  if (index >= 0) {
    // 수정
  } else {
    // 추가 (uuid()로 id 생성 — src/utils/uuid.js, crypto.randomUUID 폴백 포함)
  }
  await persist('facilities')
}
```

**농장 데이터는 Firestore 문서 하나가 아니라 도메인별 문서 8개로 나뉘어 저장됩니다**(`farms/{farmId}/data/{facilities,ancillaries,seedlings,tasks,issues,inventory,usageGuides,changeLog}` — 목록은 `src/utils/farmDataSchema.js`의 `DOMAIN_SYNC`가 유일한 근거입니다). 예전엔 `farmData` 문서 하나에 전부 있었지만, 항목 하나만 고쳐도 전체(다른 모든 항목 + 계속 자라는 changeLog)를 통째로 다시 쓰던 구조를 걷어냈습니다 — Firestore 1MiB 한도 여유 확보, `undefined` 값 하나가 문서 전체 저장을 막던 사고의 파급 범위 축소, 실시간 구독이 실제로 바뀐 문서에만 반응하도록 하기 위함입니다.

`persist(domainKeys)`가 하는 일: `updatedAt` 갱신 → `localStorage`에는 (지금도) 농장 데이터 전체를 한 번에 즉시 저장 → `domainKeys`로 지정한 문서(들) + **changeLog 문서는 항상 자동 포함**해 Firestore에 **문서별로 독립적으로 500ms 디바운스** 쓰기 예약 → 참조 없는 사진 정리(`gcOrphanPhotos`). `domainKeys`는 문자열 하나(`'facilities'`), 배열(`['facilities', 'seedlings', 'issues']` — 재배동 삭제처럼 연쇄로 여러 문서가 바뀔 때), 또는 생략(changeLog만) / `'all'`(문서 8개 전부, 백업 복원처럼 뭐가 바뀌었는지 가리기 번거로울 때)을 받습니다. **새 변경 함수를 추가할 때는 반드시 마지막에 그 도메인 키로 `persist(...)`를 호출**해야 합니다 — 빠뜨리면 로컬 상태만 바뀌고 다른 기기/새로고침에는 반영되지 않고, 엉뚱한 키를 넘기면 그 항목이 아예 다른 문서에 안 써집니다.

⚠️ **주의 (실제로 겪은 문제):** `persist(...)`은 비동기이지만 500ms 디바운스 후에야 실제 Firestore 쓰기가 일어납니다. 자동화 테스트나 스크립트에서 값을 바꾼 뒤 곧바로 브라우저를 닫거나 새로고침하면, 로컬에서는 반영된 것처럼 보여도 **Firestore에는 아직 쓰이지 않아** 다음 로드 때 이전 값으로 되돌아간 것처럼 보일 수 있습니다. 검증할 때는 마지막 변경 후 최소 1~2초 이상 기다린 뒤 새로고침해서 확인하세요.

⚠️ **기존(단일 `farmData` 문서) 농장의 마이그레이션**: `farmStore.js`의 `ensureFarmDocumentsExist(farmId)`가 `init()` 맨 앞에서 한 번 실행됩니다. `facilities` 문서가 이미 있으면(=이미 옮겨진 농장) 아무 것도 안 하고, 없으면 구버전 `farmData` 문서를 읽어 도메인별로 나눠 새 문서 8개를 씁니다. 완전 신규 농장(구버전 문서도 없음)은 기본값으로 채웁니다. **구버전 `farmData` 문서는 안전을 위해 지우지 않고 그대로 남겨둡니다**(`farmsStore.js`의 기존 단일→다중 농장 마이그레이션과 같은 관례). `annualTaskTemplates`는 앱에 고정된 상수라서 이 마이그레이션에서도, 어떤 문서에도 저장하지 않습니다(정규화 시 항상 최신 상수로 덮어씀 — 예전엔 매번 그대로 다시 저장되던 죽은 데이터였습니다).

### 6.2 변경 이력(감사 로그) — `changeLog`

`farmStore.state.changeLog`는 `{ id, at, entity, name, action, actor, detail, refId?, fields? }` 형태 항목의 배열이며, **최근 300건(`CHANGE_LOG_LIMIT`)까지만 보관**됩니다(Firestore 문서 1MiB 한도 보호용). 기록은 `logChange(entity, name, action, detail, mergeInfo)` 함수 하나를 통해서만 이루어집니다.

- `action`은 `'add' | 'update' | 'delete' | 'stock-in' | 'stock-out'` 중 하나입니다.
- `detail`은 `"필드: 이전값 → 새값, ..."` 형태의 사람이 읽을 수 있는 요약이며, `diffFields()` + `formatFieldDiff()`로 만듭니다.
- **60초 병합 규칙**: 같은 항목(같은 `entity` + `refId`)을 60초 안에 다시 수정하면 새 줄을 추가하지 않고 기존 줄을 갱신합니다(예: 작업 상태를 예정→진행중→완료로 연달아 클릭해도 "상태: 예정 → 완료" 한 줄만 남음). 값이 원래대로 되돌아오면(순변화 없음) 그 기록 자체를 지웁니다. 이 로직이 `logChange` 내부에 있습니다.
- **새 엔티티(예: 새로운 목록 타입)를 추가하면서 changeLog에도 기록하고 싶다면** 다음을 해야 합니다:
  1. 해당 `upsertX`/`removeX`의 수정 분기에서 `diffFields(before, after, { 필드키: '표시이름', ... })`로 `fields`를 만들고, `logChange(entity, name, 'update', formatFieldDiff(fields), { refId: payload.id, fields })` 호출.
  2. 추가/삭제 분기에서는 `logChange(entity, name, 'add'|'delete')`만 호출(병합 대상이 아니므로 `mergeInfo` 불필요).
  3. 대량 처리(예: 일괄 추가, 자동 생성)는 **항목마다 로그를 남기지 말고 요약 1건**으로 남기세요(`addSeedlingsBatch`, `runTaskScheduler`의 패턴 참고) — 안 그러면 300건 캡이 순식간에 채워집니다.
- 변경 이력 자체를 지우는 `removeChangeLogEntry`/`clearChangeLog`는 **새 로그를 남기지 않습니다**(정리 행위가 다시 이력을 쌓으면 의미가 없어서 의도적으로 그렇게 만들었습니다).
- UI는 `SettingsView.vue`의 "변경 이력" 탭(`activeTab === 'history'`, 농장 모드에서만 노출)에 있습니다.

### 6.3 백업/복원

- 농장별 백업(`farmStore.exportBackup/restoreBackup`)은 화이트리스트(`BACKUP_ARRAY_KEYS`/`BACKUP_OBJECT_KEYS`) 기반이라, **새 필드를 추가해도 자동으로 백업되지 않습니다** — 백업에 포함시키려면 그 목록에 추가해야 합니다.
- `changeLog`는 예외적으로 다른 항목처럼 통째로 덮어쓰지 않고, **id 기준으로 현재 값과 합쳐서(merge) 보존**합니다(오래된 백업을 복원해도 그 사이의 최근 이력이 사라지지 않도록). 복원 자체도 changeLog에 "백업 복원" 한 줄을 남깁니다.
- `treatments`(방제이력)와 `availablePesticide`는 `farmStore` 밖의 별도 스토어 데이터라, `SettingsView.vue`의 `exportBackup()`/`confirmRestore()`에서 **수동으로 합쳐서/나눠서** 처리합니다. 새로운 농장 범위 스토어를 추가한다면 이 두 함수도 같이 고쳐야 합니다.
- 관리자 전체 백업(`services/adminBackup.js`)은 개별 스토어를 거치지 않고 Firestore 문서를 직접 읽고 씁니다. 농장 데이터는 이제 문서 8개로 나뉘어 있지만(6.1 참고), **백업 파일 형식은 예전과 동일하게 유지**합니다 — 내보낼 때 8개 문서를 하나로 합쳐서(`farmData` 필드 하나에 모든 필드가 든 평면 객체) 담고, 복원할 때 `src/utils/farmDataSchema.js`의 `domainFields()`로 다시 문서별로 나눠 씁니다. 그래서 구버전 관리자 백업 파일도 그대로 복원됩니다. `changeLog`는 복원 시 오래된 스냅샷이 최근 이력을 지우지 않도록 여기서도 별도로 merge 처리를 해줍니다(`restoreAllFarmsBackup` 안의 `changeLog` 병합 코드 참고).

### 6.4 기능 게이팅 2단계 패턴 ("초기화", "변경이력 삭제"가 쓰는 방식)

되돌릴 수 없는 파괴적 기능(초기화, 변경이력 삭제)은 항상 이 2단계 스위치로 노출합니다:

1. **`appPolicyStore.policy.XxxFeature`** (전역, 시스템 관리 모드에서만 설정) — 기능 자체를 켤지/끌지. 꺼져 있으면 아래 2번 설정 자체가 화면에서 사라짐.
2. **`recommendSettingsStore.settings.showXxxButtons`** (농장별) — 1번이 켜져 있을 때만 설정 가능하며, 이 농장에서 실제로 버튼을 보여줄지 결정.
3. 실제 버튼은 `computed(() => policyStore.policy.XxxFeature && recSettingsStore.settings.showXxxButtons)` 조건으로 노출합니다(`FacilitiesPanel.vue`의 `showResetButton`, `SettingsView.vue`의 `showChangeLogDeleteButton` 참고).

새로운 위험한 기능을 추가할 때는 이 패턴을 그대로 따르는 것을 권장합니다 — 기본값은 항상 `false`(사용 안 함/표시 안 함)로 둡니다.

### 6.5 공공데이터 캐싱 (PIS/NCPMS)

- `services/pesticide.js`(PIS, 농약 정보)와 `services/ncpms.js`(NCPMS, 병해충 정보)는 개발 중에는 Vite dev 프록시(`/agri-api`, `/ncpms-api`)로 실제 API를 호출하지만, **운영 빌드(GitHub Pages)에서는 이 프록시가 없어서 직접 호출이 불가능**합니다.
- 그래서 "누군가의 로컬 개발 환경 또는 관리자가 한 번 API를 호출해서 캐시를 만들고, 그 캐시를 Firestore `sharedCache/{key}`에 올려두면, 운영 환경의 모든 사용자는 그 캐시만 읽는다"는 구조입니다(`services/cache.js`의 `withCache`/`pushSharedCache`/`pullSharedCache`).
- 이 캐시들은 **만료되지 않습니다.** 공공데이터가 갱신됐는데 캐시가 오래됐다면, 개발 환경에서 설정(동작 탭)의 "공공데이터 상세정보 전체 가져오기"를 실행해 캐시를 새로 만들고 공유해야 합니다.
- `VITE_AGRI_API_KEY`가 없으면 `pesticide.js`는 **12개짜리 목업 데이터**로 동작합니다(개발 편의용, 실제 키 발급 후 제거 예정이라는 주석이 있음 — 아직 제거되지 않았다면 확인해볼 것).

### 6.6 탭이 여러 개인 화면 = 얇은 껍데기 + 패널 컴포넌트

`FarmStatusView.vue`/`ResourcesView.vue`가 먼저 쓰던 패턴을 `PesticideRecommendView.vue`·`SettingsView.vue`·`TasksView.vue`도 따르도록 정리했습니다: 뷰 파일은 `activeTab` ref와 탭 버튼, `<TabPanel v-if="activeTab === 'x'" />` 나열만 하고, 탭 하나의 실제 상태·로직·마크업은 `src/components/`의 별도 패널 컴포넌트가 갖습니다.

- **탭들이 서로 다른 스토어를 쓰거나(예: 방제이력=treatStore, 가용농약=apStore, 재고=farmStore) 별개의 화면 상태만 공유한다면** 탭마다 패널 컴포넌트를 하나씩 만드세요(`TreatmentHistoryPanel.vue`/`AvailablePesticidePanel.vue`/`RecommendSettingsPanel.vue`/`PesticideRecommendationPanel.vue`, `FarmManagementPanel.vue`/`CategorySettingsPanel.vue`/`BehaviorSettingsPanel.vue`/`StorageBackupPanel.vue`/`ChangeHistoryPanel.vue`가 이 경우입니다).
- **탭들이 하나의 선택/패널 상태(예: 목록에서 항목을 고르면 오른쪽 패널이 그 항목 상세로 바뀌는 구조)를 깊이 공유한다면 억지로 쪼개지 마세요.** `TasksView.vue`가 이 경우였습니다 — 목록·캘린더·상세편집이 `rightPanel`/`selectedTaskId`/`formTarget`을 공유해서 그대로 하나로 남겨두고, 그 상태와 무관한 조각들(`TaskSchedulerPanel.vue`=반복 규칙 관리, `TaskTemplatePanel.vue`=계절 작업 템플릿, `TaskChecklistTemplatePanel.vue`=사용자가 만든 체크리스트 템플릿 관리+선택 생성 — "작업 추가" 탭 안에서 단일 작업/반복 규칙과 같은 레벨의 서브탭)만 따로 뗐습니다. 억지로 쪼개면 부모-자식 간 prop/emit 배선만 늘고 오히려 읽기 어려워집니다 — 쪼갤지 말지는 "탭마다 다른 스토어/독립 상태인가" 기준으로 판단하세요.
- 여러 화면이 똑같이 반복하던 자잘한 패턴은 컴포넌트/컴포저블로 뽑아 재사용합니다. 새 화면을 만들 때 아래를 먼저 확인하세요:
  - 사진 첨부(압축→미리보기): `composables/usePhotoPreviews.js`의 `useFilesToPreviews(reportKey)`
  - 사진 확대보기(라이트박스): `composables/useLightbox.js`의 `useLightbox()`
  - 공유 캐시 상태 배너("N일 기준 데이터" + 새로고침 버튼): `components/CacheStatusBanner.vue`
  - 농약 상표명 검색 결과 드롭다운: `components/PesticideLinkResults.vue`(배지는 `#badges` 슬롯으로 호출부가 채움)
  - "제목+설명+둘 중 하나 선택" 형태 설정 카드: `components/BinaryToggleCard.vue`
  - 재고 농약 로트별 수량 계산: `composables/usePesticideInventoryStock.js`
  - 분류/독성/어독성 값 → 배지 CSS 클래스: `utils/pesticideBadgeClass.js`
  - 모바일에서 필터바를 "필터 ▾" 바텀시트로 접기: `components/MobileFilterBar.vue`
  - 모바일에서 부차 액션 버튼들을 "⋯" 바텀시트로 접기: `components/OverflowMenu.vue`
  - 바텀시트 직접 구현이 필요할 때(위 두 컴포넌트가 안 맞는 특수한 경우): `components/BottomSheet.vue` — `<Teleport to="body">` + 스크롤 잠금 + `composables/useSheetBack.js`(뒤로가기로 닫기)까지 포함되어 있다

### 6.7 반응형 기준폭 — 이 3개만 쓴다

새 미디어 쿼리를 만들기 전에 먼저 확인하세요. 전부 desktop-first(`max-width`)이고, 데스크톱(≥1081px)에는 아무 규칙도 적용되지 않습니다.

| 기준폭 | 용도 |
|---|---|
| `1080px` | 레이아웃 접힘 — `.page-grid.two-columns`/`.split-card`/`.settings-groups` 2열→1열, `.stats-grid` 4→2 |
| `900px` | "모바일" 경계 — 터치 타깃 확대, 필터/탭 행 가로 스크롤, 헤더 sticky. `composables/useIsMobile.js`의 `MOBILE_MEDIA_QUERY`와 **반드시 같은 값**이어야 합니다(다르면 폼 Teleport 시점과 CSS 모바일 전환 시점이 어긋납니다) |
| `760px` | 좁은 폰 추가 압축 — shell padding, 통계 1열, 캘린더 셀 축소 |

`src/style.css` 파일 끝의 `@media (max-width: 900px)` 블록이 모바일 전용 규칙의 본체입니다. 새 패널을 추가할 때 툴바/필터바가 `.sort-filter-bar`/`.summary-strip`/`.type-filter`/`.inline-filters`/`.tab-bar` 같은 기존 클래스를 쓰면 이 블록의 터치 확대·가로 스크롤이 자동으로 적용됩니다.

**scoped 스타일의 함정**: 컴포넌트의 `<style scoped>`가 같은 클래스명을 전역 `style.css`보다 먼저 정의하고 있으면(예: `AppHeader.vue`의 `.header-top-row`), scoped 쪽이 항상 이깁니다(specificity 0,2,0 > 0,1,0). 그 클래스의 모바일 override는 전역이 아니라 **그 컴포넌트의 scoped 블록 안에** 넣어야 실제로 적용됩니다.

---

## 7. 알고 있어야 할 제약/한계

- **`.app-shell`/`.content`에 `transform`·`filter`·`backdrop-filter`·`contain`을 추가하지 마세요.** `.app-shell`의 진입 애니메이션(`rise-in`)이 0.45초간 `transform`을 걸기 때문에, 그 사이 이 요소 안에 있는 `position: fixed` 자식(`ConfirmDialog`, 사진 라이트박스)이 뷰포트가 아니라 `.app-shell` 기준으로 배치되는 잠재 버그가 있습니다. 모바일 sticky 헤더 구현 시 이 애니메이션을 `@media (max-width: 900px)`에서 끄고, 새 오버레이(바텀시트 등)는 항상 `<Teleport to="body">`로 렌더하세요.

- **Firestore 문서 1MiB 한도.** `changeLog`(300건 캡), 농약 상세정보 인덱스(`t/f/n/c` 같은 한 글자 키로 압축) 등 여러 곳에서 이 한도를 피하려는 설계가 보입니다. 새 필드를 대량으로 문서 안에 추가할 때는 이 한도를 항상 의식하세요.
- **사진은 `farmData` 문서 안에 들어있지 않습니다.** 전역 `photos/{photoId}` 컬렉션에 base64로 별도 저장되고, `src/stores/farmStore/photos.js`의 `gcOrphanPhotos()`/`collectInlinePhotos()`가 참조 없는 사진을 정리합니다. 사진을 참조하는 새 필드를 추가한다면 이 GC 로직도 그 필드를 인식하게 고쳐야 누수가 안 생깁니다.
- **`localeStore`는 실제로는 다국어가 아닙니다.** 언젠가 진짜 다국어 지원이 필요해지면 지금의 "메시지 트리 + 문자열 치환" 구조를 다시 설계해야 합니다.
- **NCPMS 예측 API(`getPrediction`)에 운영 도메인이 하드코딩**되어 있습니다(`https://citrus-collab-2026.web.app`). GitHub Pages 배포 주소나 커스텀 도메인이 바뀌면 이 부분이 깨집니다.
- **테스트 코드가 없습니다.** 이 세션에서 새 기능을 검증할 때는 Playwright로 즉석 스크립트를 작성해 브라우저를 띄워 직접 클릭해보는 방식으로 확인했습니다(`package.json`에 등록된 정식 테스트 스위트는 아님). 회귀 테스트를 자동화하고 싶다면 이 부분부터 갖추는 것을 고려해보세요.
- **작업(Task) 제목이 겹칠 수 있습니다.** 반복 작업(스케줄 규칙으로 자동 생성)은 같은 제목에 날짜만 다른 여러 인스턴스로 존재합니다. 특정 작업을 찾아 조작할 때 제목만으로 찾으면 잘못된 인스턴스를 건드릴 수 있으니 `id`나 `dueDate`까지 같이 확인하세요.
- **농장 전환은 항상 전체 새로고침입니다.** SPA 안에서 상태만 바꿔서 농장을 전환하지 않습니다(`farmsStore.selectFarm`/`enterAdminMode`/`exitToSelector`가 모두 `window.location.reload()`를 호출). 의도된 설계이니 "왜 새로고침이 일어나지?" 하고 버그로 오해하지 마세요.

---

## 8. 자주 마주칠 만한 상황

| 상황 | 원인/확인할 곳 |
|---|---|
| 방금 바꾼 값이 새로고침하면 사라짐 | Firestore 쓰기 디바운스(500ms)가 끝나기 전에 새로고침했을 가능성. 잠시 기다려보고 다시 확인 |
| 시스템 관리 모드 진입이 안 됨 | `.env.local`의 `VITE_ADMIN_PIN` 확인. 값이 없으면 PIN 없이 바로 진입, 있으면 정확히 그 값 입력 |
| 새 기능을 만들었는데 백업 파일에 안 들어있음 | `src/stores/farmStore/backup.js`의 `BACKUP_ARRAY_KEYS`/`BACKUP_OBJECT_KEYS`(또는 `SettingsView.vue`의 `datasetLabels`/`extendedSummary`)에 추가했는지 확인 |
| 농약/병해충 검색 결과가 이상하게 옛날 데이터 | `sharedCache/*` 캐시가 오래됨. 개발 환경에서 전체 가져오기를 다시 실행해 캐시 갱신 필요 |
| 변경 이력에 이상하게 많은 항목이 한 번에 쌓임 | 일괄 처리(대량 추가/자동 생성) 코드에서 항목별로 `logChange`를 부르고 있는지 확인 — 요약 1건으로 바꿔야 함 |
| "초기화"/"변경이력 삭제" 버튼이 안 보임 | 설정 > 동작 탭에서 시스템 관리 모드 스위치(전역)와 농장 모드 스위치(농장별)가 **둘 다** 켜져 있는지 확인(6.4 참고) |

---

## 9. 새 데이터 종류(엔티티)를 추가할 때 체크리스트

1. `src/data/defaults.js`에 기본값 추가(필요하다면).
2. `src/utils/farmDataSchema.js`의 `DOMAIN_SYNC`에서 그 필드가 속한 도메인 키의 정규화 함수에 필드 추가(구버전 데이터 호환을 위해 `Array.isArray` 가드 필수) — `createDefaultFarmData()`/`normalizeFarmData()`는 `DOMAIN_SYNC`를 합쳐서 만들어지므로 따로 손댈 필요 없습니다.
3. 완전히 새로운 엔티티라면 `src/stores/farmStore/` 아래 새 파일(`createXActions(ctx)` 팩토리)을 만들고, 기존 항목의 하위 기능이라면 그 항목의 파일에 함수를 추가합니다. `upsertX`/`removeX` 함수는 6.1 패턴대로 작성하고 마지막에 `ctx.persist('그 도메인 키')`를 호출합니다. 완전히 새로운 엔티티라면 그 데이터를 어느 문서에 넣을지도 정해야 합니다 — 기존 도메인 중 하나(예: 작업과 밀접하면 `tasks` 문서)에 얹거나, `farmDataSchema.js`의 `DOMAIN_SYNC`에 새 키를 추가해 자기만의 문서를 만듭니다.
4. 새 파일을 만들었다면 `farmStore.js`에서 `createXActions(ctx)`를 호출해 조립하고, 반환 객체(`return { ... }`)에 그 함수들을 펼쳐(`...xActions`) 넣어야 컴포넌트에서 `store.upsertX(...)`로 쓸 수 있습니다.
5. 변경 이력에 남기고 싶다면 6.2 패턴대로 `diffFields`+`logChange` 연결(둘 다 `import`로 가져다 씀 — `diffFields`는 `changeLogUtils.js`, `logChange`는 `ctx.logChange`). 되돌리기까지 지원하려면 `farmStore.js`에서 `createRevertActions`에 넘기는 registry에 그 upsert/update 함수도 추가해야 합니다.
6. 백업 대상에 넣고 싶다면 6.3 패턴대로 `backup.js`의 `BACKUP_ARRAY_KEYS` 등에 추가.
7. UI 패널 작성 — 기존 패널(`FacilitiesPanel.vue` 등)의 목록/편집폼/사진첨부 구조를 참고하면 스타일이 일관됩니다.
8. 파괴적 기능(초기화 등)이 필요하다면 6.4의 2단계 게이팅 패턴을 그대로 사용.
9. 새 스토어를 만들었다면 `App.vue`의 초기화 순서(4장)에 추가하고, `farmsStore.js`의 `permanentlyDeleteFarm`(농장 완전 삭제 시 이 데이터도 지워야 함)도 확인.

---

## 10. 파일 맵

```
src/
├── main.js                 앱 부트스트랩, 공유 캐시 pull, PWA 등록
├── App.vue                 스토어 초기화 순서, 화면 분기(로딩/농장선택/앱)
├── router/index.js         라우트 정의, 관리모드 접근 가드
├── stores/
│   ├── farmsStore.js       농장 목록/생성/PIN/삭제, 관리모드 전환
│   ├── farmStore.js        ★ 배관(초기화·저장·구독)만 — 실제 CRUD는 farmStore/ 폴더
│   ├── farmStore/          농장 데이터 CRUD를 도메인별로 나눈 파일들(6.1 참고, 전부 state 필요)
│   │   ├── changeLog.js, revert.js, photos.js
│   │   └── facilities.js, ancillaries.js, seedlings.js, tasks.js, issues.js,
│   │       usageGuides.js, inventory.js, scheduler.js, backup.js
│   ├── treatmentStore.js   방제이력(컬렉션 기반, farmData와 별도 저장)
│   ├── availablePesticideStore.js  가용농약(구입가능목록+재고 병합)
│   ├── recommendSettingsStore.js   농장별 정책/취향, 기능 노출 스위치
│   ├── appPolicyStore.js   전역 정책, 파괴적 기능 on/off 스위치
│   └── localeStore.js      메시지 상수 조회(사실상 한국어 전용)
├── services/
│   ├── firebase.js         firebaseEnabled 판단, 로컬 전용 모드 스위치
│   ├── pesticide.js        PIS(농약안전정보) API 래퍼 + 캐시 + 목업
│   ├── ncpms.js             NCPMS(병해충관리) API 래퍼 + 캐시
│   ├── cache.js             localStorage+Firestore 공유 캐시 공통 로직
│   ├── recommend.js         농약 추천 알고리즘(순수 함수)
│   └── adminBackup.js       관리자 전체 백업/복원(도메인별 문서 8개 ↔ 백업 파일의 평면 farmData, 6.3 참고)
├── components/              농장별 데이터 편집 패널들(재배동/묘목/재고/사용법 등) +
│                            큰 뷰를 탭별로 쪼갠 하위 패널들(TreatmentHistoryPanel 등, 6.6 참고) +
│                            여러 화면이 같이 쓰는 작은 조각(CacheStatusBanner, PesticideLinkResults,
│                            BinaryToggleCard 등)
├── views/                   라우트별 화면(대시보드/농장현황/작업/문제/방제추천/설정) — 탭이 여러 개인
│                            화면은 대부분 "탭 껍데기 + components/의 패널 컴포넌트" 형태(6.6 참고)
├── composables/             useConfirm, useIsMobile, useTaskNotifier, usePhotoPreviews(사진 압축
│                            미리보기), useLightbox(사진 확대보기), usePesticideInventoryStock
│                            (재고 농약 로트 계산) 등 재사용 로직
├── utils/                   farmDataSchema(농장 데이터 기본값·정규화·Firestore 문서 분할 지도),
│                            changeLogUtils(diff·서식), pesticideBadgeClass(분류·독성 배지 CSS 클래스),
│                            uuid, dataExport(CSV/인쇄 + today()), imageProcessing(사진 압축)
├── data/defaults.js         초기 시드 데이터, 기본 분류·항목 값
└── i18n/messages.js         화면에 쓰이는 한국어 문자열 전체

firestore.rules             ⚠️ 모든 경로 완전 개방(인증 없음)
.env.local                  Firebase 설정, PIS/NCPMS API 키, 관리자 PIN(모두 클라이언트에 노출됨)
```
