# 새 채팅용 프롬프트

저장소 `stason2000/SON-claude-network`의 브랜치 `claude/funny-babbage-p7mmch`에서 이어서 작업해줘. 먼저 `README.md`, `router/route.py`, `router/config.json`, `tests/test_route.py`를 읽고 시작해.

## 목표
GPT, Claude, FreeLLMAPI, Jev(jev.ai)를 이용해서 **나만의 개인비서 Windows exe**를 만든다. 혼자 쓴다.

## 요구사항
1. 사용 대상: GPT, Claude, FreeLLMAPI, Jev.
2. GPT와 Claude는 월정액 구독 중이다. **이 이상 돈이 나가면 안 된다.** 유료 API 키 방식은 쓰지 않는다. 구독은 공식 CLI(`claude -p`, `codex exec`)를 호출해서 쓴다. 구독 로그인 토큰을 CLI 밖으로 빼서 쓰는 것은 금지(약관 위반, 계정 차단 위험).
3. 내가 명령을 내리면 작업 종류와 난이도를 분류해서, 알맞은 AI와 모델과 추론강도를 골라 일을 시키고 결과를 보여준다.
4. 토큰(구독 한도)을 낭비하지 않으면서 결과물은 최상이어야 한다. 쉬운 일은 싼 모델과 낮은 강도로, 어려운 일만 비싼 모델과 높은 강도로 보낸다.

## 이미 만들어진 것 (검증된 범위)
- `router/route.py`: kind 판정(code/write/analysis/qa), 휴리스틱 tier 판정(trivial~expert), `config.json` 표로 모델·강도 선택, 실패 시 claude로 대체 후 한 단계 위 tier로 재시도, 사용 로그(`~/.son-router/usage.jsonl`).
- 단위 테스트 6개 통과. `claude` CLI 실제 호출 성공(Linux).
- **검증 안 됨**: `codex` CLI 경로(해당 환경에 codex 없었음), Windows 동작 전부, FreeLLMAPI 호출.
- **미구현**: `jev_classify()`는 빈 자리. Jev의 `/v1/systemone` 요청 형식을 확인하지 못해서 추측 호출을 하지 않았다. 공식 문서(docs.typesafe.ai)를 확인한 뒤 구현할 것. Jev는 API 키가 필요할 수 있고, 가격과 키 발급은 별도 확인이 필요하다. 추가 비용이 생기면 안 되므로 **무료 한도 안에서만 쓰고, 불가능하면 휴리스틱으로 대체한다.**

## 해야 할 일 (우선순위 순)
1. Windows 호환 수정: `claude`가 `.cmd`로 설치되는 경우 `subprocess` 호출이 실패할 수 있다. `shutil.which`로 전체 경로를 찾아 호출하도록 고친다. `codex`도 동일.
2. tkinter 창 화면: 입력창, 실행 버튼, 결과 영역, 선택된 모델·강도 표시, tier 강제 선택, 실행 중 취소. 외부 패키지 없이 표준 라이브러리만 사용.
3. `config.json`은 exe 밖(exe 옆 파일)에 둬서 모델명 변경에 재빌드가 필요 없게 한다.
4. exe 빌드: PyInstaller는 Windows에서만 Windows exe를 만들 수 있으므로 **GitHub Actions의 windows 러너**에서 빌드하고 산출물을 받을 수 있게 한다.
5. Jev 연동: 문서 확인 후 구현. 키가 없거나 한도를 넘으면 휴리스틱으로 자동 대체.
6. FreeLLMAPI: 기본 꺼짐 유지. 민감정보(주민번호, 비밀번호, 계약서 등)는 절대 무료 제공자로 보내지 않는다.
7. 한도 보호: 하루 호출 수와 opus/high 호출 수를 세어서, 설정한 상한을 넘기면 경고하고 한 단계 낮은 모델을 제안한다.

## 작업 규칙
- 결론부터 말하고, 확인한 사실과 추정을 구분해서 보고한다.
- 검증하지 못한 것은 검증했다고 하지 않는다. 특히 Windows와 codex 동작.
- 새 기능을 늘리기보다 라우팅 정확도와 한도 절약을 우선한다.
- 위 브랜치에 커밋하고 푸시한다. PR은 내가 요청할 때만 만든다.
- 다 끝나면 내가 Windows에서 해야 할 확인 절차를 단계별로 알려준다.
