# Windows 설치 스크립트: all-skills-package.zip -> ~/.claude (스킬/에이전트) + watch-skill
# 사용: powershell -ExecutionPolicy Bypass -File install-windows.ps1 -Zip C:\경로\all-skills-package.zip
param(
  [string]$Zip,
  [string[]]$Departments = @("finance","product","research","marketing"),  # 설치할 에이전트 부서
  [switch]$SkipWatch,       # watch-skill 설치 생략
  [switch]$SkipAgents       # 에이전트 설치 생략
)
$ErrorActionPreference = "Stop"
# -Zip 생략 시: 이 스크립트 옆 폴더 또는 다운로드 폴더에서 자동으로 찾음
if (-not $Zip) {
  $Zip = @($PSScriptRoot, (Join-Path $env:USERPROFILE "Downloads")) |
    ForEach-Object { Join-Path $_ "all-skills-package.zip" } | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $Zip) { throw "all-skills-package.zip을 찾지 못했습니다. 이 파일과 같은 폴더나 다운로드 폴더에 넣어 주세요." }
}
Write-Host "사용할 zip: $Zip"
$claude = Join-Path $env:USERPROFILE ".claude"
$work   = Join-Path $env:TEMP "skills-pkg-$(Get-Random)"
New-Item -ItemType Directory -Force $work, "$claude\skills", "$claude\agents" | Out-Null

# 1) 압축 풀기 (바깥 zip -> 안쪽 zip 4개)
Expand-Archive -LiteralPath $Zip -DestinationPath $work -Force
Get-ChildItem $work -Filter *.zip | ForEach-Object {
  Expand-Archive -LiteralPath $_.FullName -DestinationPath (Join-Path $work $_.BaseName) -Force
}

# 2) 스킬 복사: SKILL.md가 있는 폴더만, 이미 있으면 덮어쓰지 않음
$skillRoots = @("anthropic-skills\anthropic-skills", "stock-crypto-skills\crypto-skills", "stock-crypto-skills\stock-skills")
foreach ($r in $skillRoots) {
  Get-ChildItem (Join-Path $work $r) -Directory | Where-Object { Test-Path "$($_.FullName)\SKILL.md" } | ForEach-Object {
    $dest = Join-Path "$claude\skills" $_.Name
    if (Test-Path $dest) { Write-Host "건너뜀(이미 있음): $($_.Name)" }
    else { Copy-Item $_.FullName $dest -Recurse; Write-Host "스킬 설치: $($_.Name)" }
  }
}

# 3) 에이전트 복사: 지정한 부서만
if (-not $SkipAgents) {
  foreach ($d in $Departments) {
    $src = Join-Path $work "agency-agents\agency-agents\agents\$d"
    if (Test-Path $src) { Copy-Item "$src\*.md" "$claude\agents" -Force; Write-Host "에이전트 설치: $d" }
    else { Write-Warning "부서 없음: $d" }
  }
}

# 4) watch-skill (Python 3.11+ 필요). 'watch-skill setup'은 실행하지 않음(다른 AI 설정을 건드림)
if (-not $SkipWatch) {
  $ws = Join-Path $work "watch-skill\watch-skill"
  python --version
  python -m pip install "$ws[standard]"
  watch-skill doctor
}
Write-Host "`n완료. Claude Code를 새로 시작하세요. 임시 폴더: $work"
