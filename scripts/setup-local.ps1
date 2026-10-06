# 노트북 원샷 설치 (Windows). 저장소 루트에서 PowerShell로: .\scripts\setup-local.ps1
# -DryRun : 실행하지 않고 명령만 출력   -WithOmniroute : 무료 AI 게이트웨이도 설치 (docs\LOCAL-SETUP.md 주의사항 먼저)
param([switch]$DryRun, [switch]$WithOmniroute)
$ErrorActionPreference = 'Stop'
function Run($cmd) { if ($DryRun) { Write-Host "+ $cmd" } else { Invoke-Expression $cmd; if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) { throw "실패: $cmd" } } }
function Have($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }

foreach ($t in @(@('git','https://git-scm.com'), @('node','https://nodejs.org (LTS)'), @('py','https://www.python.org (py launcher 포함)'))) {
  if (-not (Have $t[0])) { Write-Host "필요: $($t[0]) — $($t[1])"; exit 1 }
}

if (-not (Have 'ffmpeg')) { Run 'winget install -e --id Gyan.FFmpeg' }
Run 'py -m pip install --user -U yt-dlp whisper-ctranslate2'
if ($WithOmniroute) { Run 'npm install -g omniroute' }
if (-not (Test-Path .env)) { Run 'Copy-Item .env.example .env' }

Write-Host '설치 확인 (새 PowerShell 창에서 다시 확인해야 할 수 있음):'
foreach ($c in 'yt-dlp','whisper-ctranslate2','ffmpeg') { if (Have $c) { Write-Host "  OK $c" } else { Write-Host "  -- $c (새 창을 열거나 PATH 확인)" } }
Write-Host 'API 키가 필요한 부분만 .env에 직접 입력하세요. 키는 채팅에 붙여넣지 마세요.'
