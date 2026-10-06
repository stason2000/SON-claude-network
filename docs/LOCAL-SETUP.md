# 노트북(로컬)에서 해야 하는 설정

## 한 번에 설치 (권장)
저장소를 받은 폴더에서 한 줄만 실행한다. 클라우드의 클로드는 노트북을 조종할 수 없다.
```
Mac/Linux:  bash scripts/setup-local.sh          # 먼저 DRY_RUN=1 bash scripts/setup-local.sh 로 미리보기 가능
Windows  :  .\scripts\setup-local.ps1            # 먼저 -DryRun 으로 미리보기 가능
```
설치 대상: ffmpeg, yt-dlp, whisper-ctranslate2, `.env`(이름만 있는 템플릿 복사). OmniRoute는 `WITH_OMNIROUTE=1`(Windows는 `-WithOmniroute`)을 붙일 때만 설치.
API 키는 `.env`에 직접 입력한다. 채팅에 붙여넣지 않는다.
검증 상태: Linux에서 실제 실행 확인(yt-dlp, whisper-ctranslate2 설치·실행). Mac/Windows(.ps1)는 이 환경에서 시험하지 못했다.

아래는 수동으로 할 때의 설명이다.

클라우드 세션은 YouTube/Instagram에 접속할 수 없고, 내 PC의 프로그램을 설치·실행할 수도 없다. 아래는 **내 노트북 터미널**에서 직접 실행한다.
(확인됨: 클라우드 컨테이너에서 youtube.com / instagram.com 접속 차단. 환경 설정의 Network access에 도메인을 허용하면 클라우드에서도 가능하지만, 로컬이 더 단순하다.)

## 1. 영상 링크 읽기 (`video-link` 스킬용)
```
pip install -U yt-dlp whisper-ctranslate2      # ffmpeg도 필요: Windows `winget install ffmpeg`, Mac `brew install ffmpeg`
```
이후 대화창에 링크만 붙여넣으면 스킬이 자동 발동한다. 자막이 없는 Reels는 음성 인식(whisper)으로 처리하며 CPU에서는 느리다.

## 2. 무료 AI 라우팅: OmniRoute (선택, 위험 이해 후)
출처: github.com/diegosouzapw/OmniRoute (MIT). 아래는 저장소 문서에서 확인한 내용이며 **내가 직접 실행해 검증하지는 않았다.**
```
npm install -g omniroute
omniroute            # 대시보드 + 게이트웨이 (기본 포트 20128)
omniroute launch     # Claude Code를 게이트웨이에 연결해 실행 (ANTHROPIC_BASE_URL / AUTH_TOKEN 자동 설정)
```
**반드시 지킬 것**
- 무료 API 키 방식(Groq, Gemini, Mistral 등)만 연결한다. **Claude/ChatGPT 구독 계정 OAuth는 연결하지 않는다.** 문서에 클라이언트 위장(TLS 지문 등) 기능이 있고 README에 약관 위험 제공자 13곳이 "avoid"로 표시되어 있다. 계정 정지 위험이 있다.
- 무료 풀은 입력이 제3자 서버로 간다. API 키, 거래 전략 핵심 로직, 개인정보는 무료 모델로 보내지 않는다.
- 로컬(127.0.0.1)에서만 열고 대시보드 비밀번호를 설정한다. 인터넷에 노출하지 않는다.
- 무료 모델은 코드 품질이 낮을 수 있다. 보일러플레이트·요약은 무료, 설계와 어려운 버그는 강한 모델로 나눈다.

## 3. 자동매매 (`trading-guard` 규칙 적용)
- 코인: freqtrade(오픈소스) `dry_run: true`로 시작 → 거래소 testnet → 소액 실거래. 직접 봇을 새로 만들지 않는다.
- 주식/해외선물: 증권사 모의투자 API(예: 한국투자증권 KIS Open API 모의투자)로 먼저.
- API 키 권한은 **조회+거래만, 출금 금지, IP 제한**. 키는 `.env`에만 두고 커밋하지 않는다.
- 클로드는 전략 작성·백테스트·코드 점검까지만 한다. 주문 루프에 LLM을 넣지 않는다.
