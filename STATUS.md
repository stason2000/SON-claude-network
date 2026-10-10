# 진행 상황 (STATUS)

이 파일은 작업이 끊겼을 때 다음 사람(또는 다른 AI)이 바로 이어가기 위한 기록입니다.
기준 코드: munder-difflin v0.4.6 (MIT). 원본 요구사항은 사용자의 "AI 오피스 앱" 프롬프트 1~12번.

## 작업 환경 메모
- 개발 실행: `npm install` 후 `npm run dev`. 클라우드(리눅스)에서는 `xvfb-run` + `electron-vite dev --noSandbox --remoteDebuggingPort 9222`.
- 윈도우 실측/설치 파일 확인은 사용자 PC에서만 가능.
- `src/main/index.ts`의 `backgroundThrottling: false`는 에이전트 하트비트 때문에 **일부러** 꺼 둔 것. 바꾸지 말 것.
- 공개 소스(v0.4.6)에는 스크린샷의 Halloween 장식, TRY PRO/Classic 버튼, temps 탭, folder 버튼이 없음 (v0.5.5 설치본에만 있는 것으로 추정).

## 1번 가볍게 만들기 — 완료 (리눅스 가상화면 기준)
고친 것: Pixi 30fps 제한, 해상도 2배 고정 해제(화면 배율 따름), IDE 지연 로딩, 터미널 기록 10만→1만 줄.
| 측정(대기 1분 중앙값) | 원본 | 수정 후 |
|---|---|---|
| 앱 전체 PSS | 491MB | 438MB (-11%) |
| 앱 단독 메모리 | 313MB | 284MB (-9%) |
| GPU 프로세스 CPU | 247% | 181% (소프트웨어 렌더링 환경이라 과장됨) |
- 마이클의 Claude Code 프로세스(189→260MB)는 앱 코드와 무관한 별도 프로그램이라 비교에서 제외.
- 해상도 낮춤으로 말풍선 글씨가 약간 부드러워짐(100% 배율 기준). 거슬리면 OfficeFloor.tsx의 resolution을 되돌릴 것.

## 11번 저장 폴더 정하기 — 완료(코드), 화면 확인은 미실시
- 원본에 이미 있던 것: 첫 실행 "집 폴더" 단계(직접 입력 + 찾아보기, 기본 `~/HarnessAgents`), 설정에서 폴더 변경(옮기기/새로 시작 선택).
- 추가한 것: `inspectHarnessHome`(읽기 전용 검사), 파일이 든 폴더면 "기존 작업 공간 불러오기 / 다른 폴더 고르기" 선택, 권한·용량(200MB)·읽기전용·파일경로 오류를 쉬운 말로 안내.
- 시험: 빈 폴더/기존 작업 공간/다른 파일 든 폴더/새 경로/파일 아래 경로는 확인. 쓰기 불가 폴더는 root 환경이라 확인 불가(윈도우에서 확인 필요).
- 한국어 문구는 5번에서 `onboarding.home.*`, `onboarding.homeErr.*` 키를 번역 파일에 추가.

## 5번 한국어 — 완료 (화면 확인함)
- `i18n/locales/ko.json`(1,179문구, 용어표 적용) + `extra.*.json`(코드에 직접 적혀 있던 영어 127문구) 추가, 기본 언어를 한국어로 변경(설정에서 영어 등으로 전환 가능). 번역은 병렬 하위 에이전트가 작성했고 키 구조/변수 일치는 스크립트로 검증.
- 상태 문구(awaiting, idle, running the floor 등)는 `i18n/actionText.ts`에서 한 곳으로 번역. 목록에 없는 문구(도구 이름·파일명)는 원문 그대로.
- 문구 수정: `ko.json` / `extra.ko.json` 한 곳만 고치면 됨.
- 남은 영어 가능성: 터미널 안의 Claude Code 출력(앱 UI 아님), 일부 드문 화면. 아침에 화면을 훑어 보고 남은 것은 알려 주세요.

## 4번 AI 캐릭터 + 눈 — 완료 (화면 확인함)
- `scene/office/aiMascotArt.ts`: 제공업체 13종(Claude, Codex, Gemini, Grok, Kimi, Antigravity, Qwen, OpenCode, Crush, Pi, Copilot, Cursor, 기타) 대표 모양을 직접 그림(로고 모방 아님). 에이전트의 제공업체에 따라 자동 선택(`visualCharacter`).
- 눈 상태: 대기=둥근 눈, 일하는 중=가늘게 뜬 눈+깜빡임, 읽는 중=좌우로 봄, 막힘=크게 놀란 눈.
- 기존 사람 캐릭터 코드는 그대로 남아 있음(되돌리려면 `visualCharacter` 사용처를 `agent.character`로).

## 다음 순서
3번(화면 맞추기, folder 버튼) → 9번(윈도우 exe 빌드 시험)
오늘 밤 범위 밖(설계 판단 필요): 7번 API 키 암호화, 10번 구글 동기화, 6·8·12번.
