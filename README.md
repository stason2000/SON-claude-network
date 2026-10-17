# SON Router

명령을 받으면 작업 종류(kind)와 난이도(tier)를 판정해 **모델 + 추론강도**를 고르고, 구독 계정의 공식 CLI로 실행해 결과를 돌려준다.

## 요구사항
- Python 3.9+ (외부 패키지 없음)
- `claude` CLI 로그인 (Claude 구독)
- `codex` CLI 로그인 (ChatGPT 구독) — 선택. 없으면 자동으로 claude로 대체
- FreeLLMAPI — 선택. `config.json`에서 `enabled: true` + 환경변수 `FREELLMAPI_BASE_URL`, `FREELLMAPI_API_KEY`

## 사용
```bash
python3 router/route.py "명령"                 # 선택 + 실행
python3 router/route.py --dry-run "명령"       # 어떤 모델/강도로 갈지만 확인
python3 router/route.py --tier expert "명령"   # 강제 지정
echo "긴 명령" | python3 router/route.py
```
결과는 stdout, 선택 내역은 stderr 마지막 줄, 누적 사용 로그는 `~/.son-router/usage.jsonl`.

## 선택 방식
1. 민감정보 키워드가 있으면 무료 제공자(FreeLLMAPI)로 보내지 않는다.
2. kind 판정: code / write / analysis / qa (키워드 기반)
3. tier 판정: trivial~expert. 지금은 길이·단계 수·난이도 키워드 휴리스틱. `jev_classify()`가 Jev 연결 지점(**미구현**).
4. `router/config.json`의 표로 모델·강도 결정. kind별 덮어쓰기 가능(코드 hard 이상 → codex).
5. 실패/미설치 시 claude로 대체, 그래도 실패하면 한 단계 위 tier로 1회 재시도.

## 구독 사용 시 주의
- 절약 대상은 **돈이 아니라 구독 사용 한도**다. 쉬운 일을 haiku/low로 보내 한도를 아끼는 구조.
- 구독 로그인 토큰을 CLI 밖의 프록시·서드파티 도구에 넣어 쓰지 말 것(약관 위반 및 계정 차단 위험). 이 프로젝트는 공식 CLI만 호출한다.
- 모델명(`haiku/sonnet/opus`, codex 모델)은 본인 계정에 맞게 `config.json`에서 수정.

## 테스트
```bash
python3 -m unittest discover -s tests -v
```
