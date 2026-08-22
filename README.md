# SNU Archive

SNU Archive는 서울대학교 강의 통계량과 난이도 투표를 모아 보는 웹서비스입니다. 강의 목록은 최근 3년 강의 JSON에서 강의명, 교수, 학과를 추출해 만들고, 같은 강의명과 같은 교수의 강의는 연도/학기와 관계없이 하나의 강의로 묶습니다.

## 주요 기능

- Google OAuth 로그인: `@snu.ac.kr` 계정만 이용할 수 있습니다.
- 강의 검색: 강의명, 교수명, 학과로 검색합니다. 검색 전 목록은 즐겨찾기, 투표 진행중, 최근 제보 순으로 먼저 보여줍니다.
- 통계량 아카이브: Q1, Q2, Q3, Q4, 평균, 만점, 비고를 저장하고 보여줍니다. Q0는 입력하거나 표시하지 않습니다.
- 직접 제보: 시험 형태, 연도/학기, 통계량, 선택 닉네임을 입력하면 바로 등록됩니다. 비어 있는 값은 저장하지 않고, 닉네임이 비어 있으면 `(익명)`으로 처리합니다.
- 간편 제보: 이미지/PDF 파일을 올리면 관리자 확인 큐에 들어갑니다. 관리자는 파일 뷰어로 바로 확인하고 통계량으로 반영할 수 있습니다.
- 난이도 투표: 한 강의의 한 시험 형태별로 진행중인 투표는 하나만 열립니다. 투표는 7일간 열리고, 결과는 같은 강의와 같은 시험 형태에 누적됩니다.
- 투표권 제한: 중간/기말 시험 기간 단위로 계정당 10회까지 투표할 수 있습니다. 진행중인 같은 투표에는 다시 투표해 값을 바꿀 수 있습니다.
- 즐겨찾기: 자주 보는 강의를 검색 전 목록 상단에 고정할 수 있습니다.
- 관리자 페이지: 간편 제보, 최근 통계량, 활동 로그를 탭으로 관리합니다. 제보와 통계량은 10개씩, 로그는 50개씩 불러옵니다. 로그는 JSON으로 내보내거나 비울 수 있습니다.

## 기술 구성

- Frontend: 정적 HTML/CSS/JavaScript (`public/`)
- API: Vercel Serverless Functions 호환 Node.js 핸들러 (`api/`)
- Local DB: Firebase 미설정 시 `.local-data/db.json`에 저장됩니다.
- Production DB/Storage: Firebase Firestore + private Cloud Storage 버킷 (`firebase-admin` SDK로 서버에서만 접근)
- Course build script: 원본 학기 JSON을 `public/courses.json`으로 변환합니다.

## 로컬 실행

Node.js 20 이상이 필요합니다.

```powershell
copy .env.example .env
npm run build:courses
npm run dev
```

실행 후 브라우저에서 `http://localhost:3000`을 엽니다.

원본 강의 JSON을 수정하지 않았다면 `npm run build:courses`는 다시 실행하지 않아도 됩니다. 원본 JSON을 바꾼 뒤에는 이 명령을 실행하고 생성된 `public/courses.json`도 함께 커밋하세요.

## 환경변수

`.env.example`을 복사해 `.env`를 만들고 값을 채웁니다. `.env`는 `.gitignore`에 포함되어 있으므로 저장소에 올리지 않습니다.

```text
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret

FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-firebase-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_STORAGE_BUCKET=your-firebase-project-id.appspot.com

ADMIN_EMAILS=admin@snu.ac.kr,coshaman@snu.ac.kr
AUTH_SESSION_SECRET=change-this-random-session-secret
EMAIL_HASH_SECRET=change-this-random-secret
ALLOW_DEMO_AUTH=false
APP_ORIGIN=http://localhost:3000
```

`GOOGLE_CLIENT_SECRET`, `FIREBASE_PRIVATE_KEY`, `AUTH_SESSION_SECRET`, `EMAIL_HASH_SECRET`는 서버에서만 사용해야 합니다. 브라우저 코드나 README에 실제 값을 적지 마세요.

`FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY`는 Firebase 서비스 계정 JSON의 `project_id`/`client_email`/`private_key` 값을 그대로 옮기면 됩니다. Vercel 환경변수 입력창에 `private_key` 값을 붙여넣을 때 줄바꿈이 `\n` 문자열로 남아 있어도 서버 코드가 자동으로 변환하니 그대로 붙여넣으면 됩니다.

## Google OAuth 설정

Google Cloud Console에서 OAuth 클라이언트를 만든 뒤 다음 값을 설정합니다.

- OAuth 앱 이름: `SNU Archive`
- 승인된 리디렉션 URI:

```text
http://localhost:3000/api/auth/google/callback
https://your-domain.example/api/auth/google/callback
```

Vercel 배포 환경에서는 `APP_ORIGIN`을 실제 서비스 주소로 설정해야 callback URL이 올바르게 만들어집니다.

## Firebase 설정

운영 배포에서는 Firebase 프로젝트를 만들고 다음을 준비합니다.

1. [Firebase Console](https://console.firebase.google.com)에서 프로젝트 생성
2. **Firestore Database** 사용 설정 (Native mode)
3. **Storage** 사용 설정 (간편 제보 파일 저장용 기본 버킷)
4. **프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성**으로 서비스 계정 JSON 다운로드 → `FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY` 값으로 사용
5. 저장소 루트의 보안 규칙/인덱스 배포:

```powershell
npm install -g firebase-tools
firebase login
firebase use --add
firebase deploy --only firestore:rules,firestore:indexes,storage:rules
```

앱은 다음 Firestore 컬렉션을 사용합니다.

- `stat_reports`: 직접 제보와 승인된 통계량
- `quick_reports`: 간편 제보 큐
- `course_favorites`: 사용자별 즐겨찾기 (문서 ID: `{이메일해시}_{course_key}`)
- `difficulty_polls`: 난이도 투표 개설 정보
- `difficulty_votes`: 난이도 투표 응답 (문서 ID: `{poll_id}_{이메일해시}`)
- `course_comments`: 한줄 후기
- `activity_logs`: 로그인, 제보, 투표, 관리자 작업 로그
- `user_profiles`: 단과대학/입학년도 통계 (문서 ID: 이메일 해시)

간편 제보 파일은 Storage 버킷의 `quick-reports/` 하위에 저장되고, 서버가 매번 만료 1시간짜리 서명된 URL로만 접근합니다. `firestore.rules`/`storage.rules`는 모든 직접 접근을 차단하며, 서버는 `firebase-admin` SDK(서비스 계정)로만 접근해 규칙을 우회합니다.

Firebase를 설정하지 않은 로컬 실행에서는 `.local-data/`에 테스트 데이터가 저장됩니다. 이 폴더는 커밋하지 않습니다.

## Vercel 배포

1. 이 저장소를 GitHub에 올립니다.
2. Vercel에서 GitHub 저장소를 Import합니다.
3. Project Settings > Environment Variables에 `.env.example`의 값을 등록합니다.
4. 도메인을 Vercel 프로젝트에 연결합니다.
5. Google OAuth의 승인된 리디렉션 URI에 운영 callback URL을 추가합니다.

별도 빌드 명령은 필요 없습니다. Vercel은 `public/`의 정적 파일과 `api/`의 Serverless Functions를 배포합니다.

## 검증 명령

```powershell
npm run validate
npm run smoke
```

`validate`는 강의 목록과 정적 파일의 기본 구성을 확인하고, `smoke`는 주요 API와 정적 파일 응답을 간단히 점검합니다.

## 운영 메모

- 관리자 계정은 `ADMIN_EMAILS`에 쉼표로 구분해 등록합니다.
- 모든 사용자 행동 로그에는 이메일 주소, Google 계정 이름, 행동, 메타데이터가 저장됩니다.
- 간편 제보 파일은 3MB 이하의 이미지 또는 PDF만 받습니다.
- 통계량은 강의명과 교수 기준으로 묶이지만, 각 제보에는 연도와 학기가 함께 저장됩니다.
- 난이도 투표는 과거 학기 대상으로 새로 열 수 없고, 현재 학기의 시험 형태별 투표 결과만 활성 투표로 받습니다.
