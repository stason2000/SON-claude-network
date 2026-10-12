# AI OFFICE

개인 1명이 쓰는 AI 자율 업무 시스템. 현재 **1단계(기본 대시보드와 작업 상태 관리 기반)** 까지 구현되어 있습니다.

> **중요:** 1단계에는 AI 연결이 없습니다. 작업을 등록·관리할 수는 있지만 AI가 실행하지는 않습니다.
> 거래소 API 연결, 주문 실행 등 자동매매 기능은 구현되어 있지 않습니다.

## 요구 사항

- Node.js **22.13 이상** (내장 SQLite `node:sqlite` 사용 — 별도 DB 설치·네이티브 빌드 불필요)
- Windows / macOS / Linux

## 실행

```bash
npm install
npm run dev        # 개발: 화면 http://localhost:5173 (API 서버 4100 자동 실행)
```

운영 방식(빌드 후 서버 하나로 실행):

```bash
npm run build
npm start          # http://localhost:4100
```

기타:

```bash
npm test           # 테스트 (vitest)
npm run typecheck  # 타입 검사 (웹 + 서버 + 테스트)
```

`node:sqlite` 는 Node 22에서 "experimental" 경고를 한 줄 출력합니다. 정상입니다.

## 설정

`.env.example` 을 `.env` 로 복사해 사용합니다. (`.env` 는 git에 올라가지 않습니다)
기본값은 `127.0.0.1:4100`, 데이터는 `./data/ai-office.db` 입니다.

## 구조

```
src/shared/   서버·웹 공통 타입, 작업 상태 머신 (taskStateMachine.ts)
src/server/   Fastify API, SQLite(node:sqlite), 마이그레이션, 저장소(repo/), 라우트(routes/)
src/web/      React + Vite 대시보드 (pages/, components/)
tests/        상태 머신·API 테스트
scripts/      개발용 실행기 (dev.mjs)
```

## 작업 상태 규칙

`대기 → 계획 수립 → 승인 대기 → 실행 → 결과 검증 → 완료` (어느 단계에서든 실패/취소 가능)

- **완료는 반드시 '결과 검증'을 거쳐야 합니다.** AI가 끝났다고 주장하는 것과 검증된 결과를 구분하기 위함입니다.
- **실행은 반드시 '승인 대기'를 거쳐야 합니다.**
- 실패한 작업은 최대 시도 횟수(기본 3회)까지만 재시도할 수 있습니다. (무한 반복 방지)

## 보안 메모

- 서버는 기본적으로 `127.0.0.1` 에만 바인딩됩니다. 로그인 기능이 없으므로 `HOST=0.0.0.0` 등으로 외부에 열지 마세요.
- Host 헤더 검사(DNS rebinding 방어)와 쓰기 요청의 Origin 검사(CSRF 방어)가 적용되어 있습니다.
- API 키는 2단계부터 서버의 `.env` 에만 저장하며 브라우저로 전달하지 않습니다. 1단계에는 비밀 키가 없습니다.

## 백업

서버를 멈춘 뒤 `data/` 폴더를 복사하세요.

## 로드맵

1. 기본 프로젝트 구축 ✅
2. AI 연결 (제공자 1개 → 사용량·비용 기록)
3. 실제 업무 실행 (계획·파일 작업·코드 개발·테스트·검증)
4. 장시간 자율 실행 (백그라운드·복구·예약·승인·알림)
5. 부서 고도화·추가 모델
