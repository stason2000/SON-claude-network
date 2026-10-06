# 노트북 원샷 설치 (Windows). 이 파일 전체를 복사 -> PowerShell에 붙여넣기 -> Enter.
# 저장소가 없어도 동작한다. 미리보기: 먼저 $env:DRY_RUN='1' 입력 후 붙여넣기. OmniRoute는 기본 설치(약 3GB). 건너뛰려면 $env:WITHOUT_OMNIROUTE='1'
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
  # OmniRoute는 Node 22.22.2 이상(23 제외) 또는 24~26 필요
  function NodeOk { if (-not (Have 'node')) { return $false }; $v = [version]((node -v) -replace '^v',''); (($v.Major -eq 22 -and $v -ge [version]'22.22.2') -or ($v.Major -ge 24 -and $v.Major -lt 27)) }
  $omni = ($env:WITHOUT_OMNIROUTE -ne '1')
  if ($omni -and -not (NodeOk)) {
    try { Run "$wg OpenJS.NodeJS.LTS" } catch { Write-Host 'Node 설치/업그레이드 경고(이미 최신일 수 있음)' }
    RefreshPath
    if (-not (NodeOk)) { Write-Host 'Node 버전이 낮아 OmniRoute를 건너뜁니다. Node LTS 설치 후 npm install -g omniroute 를 직접 실행하세요.'; $omni = $false }
  }

  $py = if (Have 'py') { 'py' } else { 'python' }
  Run "$py -m pip install --user -U yt-dlp whisper-ctranslate2 requests"

  # pip --user 설치 폴더를 PATH에 영구 등록 (없으면 yt-dlp 명령을 못 찾는다)
  if (-not $dry) {
    $scripts = (& $py -c "import sysconfig;print(sysconfig.get_path('scripts','nt_user'))").Trim()
    $user = [Environment]::GetEnvironmentVariable('Path','User')
    if ($user -notlike "*$scripts*") { [Environment]::SetEnvironmentVariable('Path', "$user;$scripts", 'User') }
    RefreshPath
  }

  if ($omni) { Run 'npm install -g omniroute' }

  Write-Host ''
  Write-Host '설치 확인:'
  foreach ($c in 'yt-dlp','whisper-ctranslate2','ffmpeg') { if (Have $c) { Write-Host "  OK $c" } else { Write-Host "  -- $c (새 PowerShell 창을 열어 다시 확인)" } }
  Write-Host ''
  Write-Host "OmniRoute 실행(이 PC에서만 접속되게): `$env:OMNIROUTE_SERVER_HOST='127.0.0.1'; omniroute   -> http://localhost:20128 에서 초기 비밀번호 CHANGEME를 바로 변경"
  Write-Host '끝. API 키가 필요한 기능은 .env에 직접 입력하세요. 키는 채팅에 붙여넣지 마세요.'
}
