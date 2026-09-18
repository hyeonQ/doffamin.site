# Contact form (Turnstile + Pages Function)

`Contact us` 폼은 더 이상 Google Apps Script URL로 직접 전송하지 않습니다.

```
브라우저 ── POST /api/contact ──▶ Pages Function (functions/api/contact.js)
                                   ├─ same-origin / honeypot / 필드 검증
                                   ├─ Turnstile siteverify
                                   └─ CONTACT_FORWARD_URL(Apps Script /exec)로 name/email/message 전달
                                                          └─ MailApp.sendEmail → 수신함
```

Apps Script URL은 저장소에 없고 Pages 시크릿(`CONTACT_FORWARD_URL`)으로만 존재합니다.

## 1. Turnstile 위젯 만들기

Cloudflare 대시보드 → **Turnstile** → **Add widget**

- Hostnames: `doffamin.site`, `www.doffamin.site` (미리보기에서도 쓰려면 `doffamin-site.pages.dev` 추가)
- Widget mode: **Managed**
- 생성 후 **Site key**와 **Secret key**를 복사합니다.

## 2. Apps Script 새로 배포하기 (필수)

예전 `/exec` URL은 공개 저장소 히스토리와 봇 목록에 남아 있어서, 그 URL로 직접 POST하면 Turnstile을 우회합니다.
새 배포 URL을 발급받고 예전 배포는 보관처리하세요.

1. https://script.google.com 에서 문의 폼 스크립트 열기
2. **배포 → 배포 관리** → 기존 배포 **보관처리(Archive)**
3. **배포 → 새 배포** → 유형 *웹 앱*, 실행 사용자 *나*, 액세스 권한 *모든 사용자* → 배포
4. 새 **웹 앱 URL**(`…/exec`)을 복사 → 3단계의 `CONTACT_FORWARD_URL`에 사용

### (권장) doPost에서 공유 토큰 검사

URL이 다시 새어 나가도 직접 제출을 막을 수 있습니다. 스크립트 속성에 `CONTACT_FORWARD_TOKEN`을 저장하고
(**프로젝트 설정 → 스크립트 속성**), `doPost` 맨 앞에 아래를 추가합니다. Pages 시크릿 `CONTACT_FORWARD_TOKEN`에도 같은 값을 넣습니다.

```js
function doPost(e) {
  var expected = PropertiesService.getScriptProperties().getProperty('CONTACT_FORWARD_TOKEN');
  var provided = e.parameter.token;
  delete e.parameter.token;
  delete e.parameters.token; // 시트/메일에 token 컬럼이 생기지 않도록
  if (expected && provided !== expected) {
    return ContentService.createTextOutput(JSON.stringify({ result: 'error', error: 'forbidden' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  // ...기존 코드 (record_data / MailApp.sendEmail)...
}
```

## 3. Pages 변수/시크릿 설정

Workers & Pages → `doffamin-site` → **Settings → Variables and Secrets** (Production; 미리보기도 쓰면 Preview에도)

| 이름 | 종류 | 값 |
| --- | --- | --- |
| `TURNSTILE_SITE_KEY` | Plaintext (빌드 시 주입) | Turnstile Site key |
| `TURNSTILE_SECRET_KEY` | Secret | Turnstile Secret key |
| `CONTACT_FORWARD_URL` | Secret | 새 Apps Script 웹 앱 URL (`…/exec`) |
| `CONTACT_FORWARD_TOKEN` | Secret (선택) | doPost와 공유하는 임의 문자열 |

시크릿은 wrangler로도 넣을 수 있습니다.

```bash
npx wrangler@4 pages secret put TURNSTILE_SECRET_KEY --project-name doffamin-site
npx wrangler@4 pages secret put CONTACT_FORWARD_URL --project-name doffamin-site
```

`TURNSTILE_SITE_KEY`는 빌드 시 `scripts/build.mjs`가 `__TURNSTILE_SITE_KEY__` 자리에 넣습니다.
Cloudflare 빌드(`CF_PAGES=1`)에서 이 값이 없으면 빌드가 실패하도록 되어 있습니다 — 보호 없이 배포되는 일을 막기 위해서입니다.
변수를 추가한 뒤 **Retry deployment** 하세요.

## 4. 로컬에서 확인

```bash
cp .dev.vars.example .dev.vars   # 테스트 키가 들어 있음
npm run dev                       # http://localhost:8788
npm test                          # Function 단위 테스트
```

`.dev.vars`의 `CONTACT_FORWARD_URL`을 실제 Apps Script URL로 바꾸면 로컬에서도 메일이 발송됩니다.

## 응답 코드

| 상태 | `error` | 의미 |
| --- | --- | --- |
| 200 | – | 전달 완료 (honeypot에 걸린 봇에게도 200을 돌려줍니다) |
| 400 | `invalid_fields`, `turnstile_missing`, `bad_request` | 입력 문제 |
| 403 | `bad_origin`, `turnstile_failed`, `turnstile_*_mismatch` | 차단 |
| 500 | `not_configured` | 시크릿 미설정 |
| 502 | `siteverify_unavailable`, `forward_failed` | 업스트림 실패 |

추가로 대시보드 **Security → WAF → Rate limiting rules**에서 `/api/contact` POST를 IP당 분당 5회 정도로 제한해 두면 좋습니다.
