#!/usr/bin/env bash
# 노트북 원샷 설치 (Mac/Linux). 저장소 루트에서: bash scripts/setup-local.sh
# DRY_RUN=1  -> 실행하지 않고 명령만 출력
# OmniRoute(무료 AI 게이트웨이)는 기본 설치. 건너뛰려면 WITHOUT_OMNIROUTE=1 (설치 용량 약 3GB, docs/LOCAL-SETUP.md 주의사항 참고)
set -euo pipefail
run() { if [ "${DRY_RUN:-0}" = 1 ]; then echo "+ $*"; else "$@"; fi; }
have() { command -v "$1" >/dev/null 2>&1; }
need() { have "$1" || { echo "필요: $1 — $2"; exit 1; }; }

need git "https://git-scm.com"
need python3 "https://www.python.org"
need node "https://nodejs.org (LTS)"

if ! have ffmpeg; then
  if have brew; then run brew install ffmpeg
  elif have apt-get; then run sudo apt-get install -y ffmpeg
  else echo "ffmpeg를 직접 설치하세요: https://ffmpeg.org"; fi
fi

# 시스템 파이썬 보호(PEP 668) 때문에 pipx 우선, 없으면 가상환경
VENV="$HOME/.venvs/video"
if have pipx; then
  run pipx install yt-dlp
  run pipx install whisper-ctranslate2
else
  run python3 -m venv "$VENV"
  run "$VENV/bin/pip" install -U yt-dlp whisper-ctranslate2 requests
  export PATH="$VENV/bin:$PATH"
  echo "새 터미널에서도 쓰려면 ~/.zshrc 또는 ~/.bashrc 에 추가: export PATH=\"$VENV/bin:\$PATH\""
fi

[ "${WITHOUT_OMNIROUTE:-0}" = 1 ] || run npm install -g omniroute

[ -f .env ] || run cp .env.example .env
echo "설치 확인:"; for c in yt-dlp whisper-ctranslate2 ffmpeg; do have "$c" && echo "  OK $c" || echo "  -- $c (새 터미널을 열거나 PATH 확인)"; done
echo "OmniRoute 실행(이 PC에서만 접속되게): OMNIROUTE_SERVER_HOST=127.0.0.1 omniroute   -> http://localhost:20128 에서 초기 비밀번호 CHANGEME를 바로 변경"
echo "API 키가 필요한 부분만 .env에 직접 입력하세요. 키는 채팅에 붙여넣지 마세요."
