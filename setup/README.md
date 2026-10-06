# 설치 도구 (Windows)

1. `all-skills-package.zip`을 노트북에 저장
2. PowerShell에서: `powershell -ExecutionPolicy Bypass -File install-windows.ps1 -Zip C:\경로\all-skills-package.zip`
   - 에이전트 부서 변경: `-Departments engineering,design` / 생략: `-SkipAgents`, `-SkipWatch`
3. Claude Code를 새로 시작
4. watch-skill 시험: `watch-skill watch "https://youtu.be/L9wC5CQHnFQ"`
5. BTC 선물 시세(읽기 전용): `python btc_futures_quote.py`

주의: 스크립트와 시세 스크립트는 클라우드에서 문법만 확인했고 실행 시험은 못 했습니다(네트워크 차단, Windows 아님).
API 키는 이 저장소에 절대 올리지 마세요.
