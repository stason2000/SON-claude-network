# 노트북 원샷 설치 (Windows). 이 파일 전체를 복사 -> PowerShell에 붙여넣기 -> Enter.
# 저장소가 없어도 동작한다. 미리보기: 먼저 $env:DRY_RUN='1' 입력 후 붙여넣기. OmniRoute 포함: $env:WITH_OMNIROUTE='1'
& {
  $ErrorActionPreference = 'Stop'
  $dry = ($env:DRY_RUN -eq '1')
  function Run($c) { if ($dry) { Write-Host "+ $c" } else { Invoke-Expression $c; if ($LASTEXITCODE) { throw "실패(코드 $LASTEXITCODE): $c" } } }
  function Have($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
  function RefreshPath { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }
  $wg = 'winget install -e --silent --accept-source-agreements --accept-package-agreements --id'

  if (-not $dry -and -not (Have 'winget')) { throw 'winget이 없습니다. Microsoft Store에서 "앱 설치 관리자"를 업데이트한 뒤 다시 실행하세요.' }

  if (-not (Have 'py') -and -not (Have 'python')) { Run "$wg Python.Python.3.12"; RefreshPath }
  if (-not (Have 'ffmpeg')) { Run "$wg Gyan.FFmpeg"; RefreshPath }
  if ($env:WITH_OMNIROUTE -eq '1' -and -not (Have 'npm')) { Run "$wg OpenJS.NodeJS.LTS"; RefreshPath }

  $py = if (Have 'py') { 'py' } else { 'python' }
  Run "$py -m pip install --user -U yt-dlp whisper-ctranslate2"

  # pip --user 설치 폴더를 PATH에 영구 등록 (없으면 yt-dlp 명령을 못 찾는다)
  if (-not $dry) {
    $scripts = (& $py -c "import sysconfig;print(sysconfig.get_path('scripts','nt_user'))").Trim()
    $user = [Environment]::GetEnvironmentVariable('Path','User')
    if ($user -notlike "*$scripts*") { [Environment]::SetEnvironmentVariable('Path', "$user;$scripts", 'User') }
    RefreshPath
  }

  if ($env:WITH_OMNIROUTE -eq '1') { Run 'npm install -g omniroute' }

  Write-Host ''
  Write-Host '설치 확인:'
  foreach ($c in 'yt-dlp','whisper-ctranslate2','ffmpeg') { if (Have $c) { Write-Host "  OK $c" } else { Write-Host "  -- $c (새 PowerShell 창을 열어 다시 확인)" } }
  Write-Host ''
  Write-Host '끝. API 키가 필요한 기능은 .env에 직접 입력하세요. 키는 채팅에 붙여넣지 마세요.'
}
