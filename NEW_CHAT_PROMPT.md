저장소 stason2000/SON-claude-network 의 브랜치 claude/funny-babbage-p7mmch 에서 이어서 작업해줘. 먼저 README.md, router/route.py, router/config.json, tests/test_route.py 를 읽고 시작해.

[목표]
GPT, Claude, FreeLLMAPI, Jev(jev.ai)를 이용해서 나만의 개인비서 Windows exe를 만든다. 혼자 쓴다.

[요구사항]
1. 사용 대상: GPT, Claude, FreeLLMAPI, Jev.
2. GPT와 Claude는 월정액 구독 중이다. 이 이상 돈이 나가면 안 된다. 유료 API 키 방식은 쓰지 않고, 공식 CLI(claude -p, codex exec)를 호출해서 쓴다. 구독 로그인 토큰을 CLI 밖으로 빼서 쓰는 것은 금지다(약관 위반, 계정 차단 위험).
3. 명령을 내리면 작업 종류와 난이도를 분류해서, 알맞은 AI와 모델과 추론강도를 골라 일을 시키고 결과를 보여준다.
4. 구독 한도를 낭비하지 않으면서 결과물은 최상이어야 한다. 쉬운 일은 싼 모델과 낮은 강도로, 어려운 일만 비싼 모델과 높은 강도로 보낸다.

[이미 만들어진 것]
- router/route.py: 작업 종류(kind) 판정, 휴리스틱 난이도(tier) 판정, config.json 표 기반 모델·강도 선택, 실패 시 대체와 재시도, 사용 로그.
- 단위 테스트 6개 통과, claude CLI 실제 호출 성공(Linux).
- 검증 안 된 것: codex 경로, Windows 동작 전부, FreeLLMAPI 호출.
- 미구현: jev_classify()는 빈 자리다. Jev의 /v1/systemone 요청 형식을 확인하지 못해서 추측 호출을 하지 않았다. 공식 문서(docs.typesafe.ai)를 확인한 뒤 구현할 것. 추가 비용이 생기면 안 되므로 무료 한도 안에서만 쓰고, 불가능하면 휴리스틱으로 대체한다.

[해야 할 일 - 반드시 이 순서로, 앞 단계가 확인되기 전에는 다음으로 넘어가지 말 것]
1단계: Windows 호환 수정. claude, codex가 .cmd로 설치되는 경우를 shutil.which로 처리. 끝나면 내가 Windows에서 확인할 절차를 알려준다.
2단계: 내가 1~2주 쓰면서 로그를 보고 라우팅 규칙을 조정한다. 이 단계에서는 새 기능을 추가하지 않는다.
3단계: Jev 연동. 문서 확인 후 구현, 키가 없거나 한도를 넘으면 휴리스틱으로 자동 대체.
4단계: tkinter 창 화면. python app.py 로 실행되는 상태까지.
5단계: 마지막에만 exe 빌드. GitHub Actions의 windows 러너에서 PyInstaller 사용. config.json은 exe 옆 파일로 분리.
공통: FreeLLMAPI는 기본 꺼짐, 민감정보는 무료 제공자로 보내지 않음, 하루 호출 수와 opus/high 호출 수 상한 경고.

[작업 규칙]
- 결론부터 말하고, 확인한 사실과 추정을 구분해서 보고한다.
- 검증하지 못한 것은 검증했다고 하지 않는다. 특히 Windows와 codex 동작.
- 새 기능보다 라우팅 정확도와 한도 절약을 우선한다.
- 위 브랜치에 커밋하고 푸시한다. PR은 내가 요청할 때만 만든다.
- 각 단계가 끝나면 내가 Windows에서 해야 할 확인 절차를 단계별로 알려준다.
