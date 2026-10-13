// 농장 안내메일(앱 설치 방법 + 회원가입 방법) 작성·발송.
//
// 이 앱엔 백엔드(Cloud Functions)가 없어서(Spark 무료 요금제) 메일을 직접 보낼 서버가 없다.
// 그래서 발송은 두 갈래다:
//   1) EmailJS(브라우저에서 REST로 호출하는 메일 발송 서비스, 무료 월 200통)가 설정돼 있으면
//      그걸로 자동 발송한다 — 환경변수 VITE_EMAILJS_SERVICE_ID / TEMPLATE_ID / PUBLIC_KEY.
//      템플릿 변수: to_email, subject, message (EmailJS 템플릿에서 받는 사람 = {{to_email}},
//      제목 = {{subject}}, 본문 = {{message}}로 지정).
//   2) 설정이 없으면 mailto: 링크로 사용자의 메일 앱을 열어 준다(본문이 채워진 상태, 보내기만
//      누르면 된다).
const SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID || ''
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID || ''
const PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY || ''

export const emailAutoSendEnabled = !!(SERVICE_ID && TEMPLATE_ID && PUBLIC_KEY)

function appUrl() {
  return `${window.location.origin}${window.location.pathname}`
}

// role: 'owner'(농장 소유주) | 'worker'(농장종사자)
export function composeInviteMail({ email, role, farmName, inviterName }) {
  const url = appUrl()
  const roleText = role === 'owner' ? '농장 소유주' : '농장종사자'
  const subject = `[${farmName}] ${roleText}로 초대되었습니다 — 감귤농장 앱 안내`
  const by = inviterName ? `${inviterName}님이 ` : ''
  const lines = [
    `안녕하세요.`,
    ``,
    `${by}"${farmName}" 농장의 ${roleText}로 ${email} 주소를 등록했습니다.`,
    `아래 순서대로 앱을 설치하고 가입하면 바로 농장 화면이 열립니다.`,
    ``,
    `■ 1. 앱 열기`,
    url,
    ``,
    `■ 2. 홈 화면에 설치(선택, 권장)`,
    `- 안드로이드(크롬): 위 주소를 열고 오른쪽 위 메뉴(⋮) → "홈 화면에 추가" 또는 "앱 설치".`,
    `- 아이폰(사파리): 위 주소를 열고 아래 공유 버튼(□↑) → "홈 화면에 추가".`,
    ``,
    `■ 3. 회원가입`,
    `- 앱 첫 화면에서 "회원가입"을 누릅니다.`,
    `- 이메일은 반드시 이 메일을 받은 주소(${email})로 입력해야 가입할 수 있습니다.`,
    `- 표시 이름과 비밀번호(6자 이상)를 정하고 가입합니다.`,
    `- 가입 직후 인증 메일이 발송됩니다. 메일의 링크를 눌러 이메일 인증을 마친 뒤, 앱에서 "인증 완료"를 누르면 농장 화면이 열립니다.`,
    ``,
    `이미 가입한 계정이라면 같은 이메일로 로그인만 하면 됩니다.`,
    `본인이 요청하지 않았다면 이 메일은 무시해도 됩니다.`,
  ]
  return { subject, body: lines.join('\n') }
}

// 반환: { method: 'emailjs' } (발송 완료) 또는 { method: 'mailto', url } (호출자가 열어 줌).
export async function sendInviteMail(params) {
  const { subject, body } = composeInviteMail(params)
  if (emailAutoSendEnabled) {
    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: SERVICE_ID,
        template_id: TEMPLATE_ID,
        user_id: PUBLIC_KEY,
        template_params: { to_email: params.email, subject, message: body },
      }),
    })
    if (!res.ok) throw new Error(`메일 발송에 실패했습니다(${res.status}). EmailJS 설정을 확인하세요.`)
    return { method: 'emailjs' }
  }
  const url = `mailto:${encodeURIComponent(params.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  return { method: 'mailto', url }
}

// 결과를 사용자에게 바로 적용: mailto면 메일 앱을 연다. 호출자는 반환값으로 안내 문구를 만든다.
export async function deliverInviteMail(params) {
  const result = await sendInviteMail(params)
  if (result.method === 'mailto') window.location.href = result.url
  return result.method
}
