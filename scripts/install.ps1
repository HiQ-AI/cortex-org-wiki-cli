param(
  [ValidateSet('codex', 'claude-code')][string]$Agent,
  [ValidateSet('project', 'user')][string]$Scope = 'project',
  [string]$Project,
  [switch]$CliOnly,
  [switch]$SkillOnly,
  [switch]$ReplaceSkill,
  [string]$InstallDir = $(if ($env:CORTEX_ORG_WIKI_INSTALL) { $env:CORTEX_ORG_WIKI_INSTALL } else { "$env:LOCALAPPDATA\Programs\cortex-org-wiki" }),
  [string]$BaseUrl = $(if ($env:CORTEX_ORG_WIKI_DOWNLOAD_BASE) { $env:CORTEX_ORG_WIKI_DOWNLOAD_BASE } else { 'https://download.hiq.earth/cli/cortex-org-wiki/latest' })
)
$ErrorActionPreference = 'Stop'
if ($CliOnly -and $SkillOnly) { throw 'CliOnly 和 SkillOnly 不能同时使用' }
if (-not $CliOnly -and -not $Agent) { throw '请指定 -Agent codex|claude-code（Cortex 市场技能由 Host 安装）' }
if ($Scope -eq 'user' -and $Project) { throw '-Project 仅用于项目范围' }
if (-not [Environment]::Is64BitOperatingSystem) { throw '需要 64 位 Windows' }
$archive = 'cortex-org-wiki-windows-x64.zip'
$temporary = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid())
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
  Invoke-WebRequest "$BaseUrl/$archive" -OutFile "$temporary\$archive" -UseBasicParsing
  Invoke-WebRequest "$BaseUrl/checksums.txt" -OutFile "$temporary\checksums.txt" -UseBasicParsing
  $entry = @(Get-Content "$temporary\checksums.txt" | Where-Object { $_ -match "^[a-fA-F0-9]{64}\s+(\./)?$([regex]::Escape($archive))$" })
  if ($entry.Count -ne 1) { throw 'checksum 缺少或重复当前平台产物' }
  $expected = ($entry[0] -split '\s+')[0].ToLower()
  $actual = (Get-FileHash "$temporary\$archive" -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $expected) { throw 'checksum 不匹配，未安装' }
  Expand-Archive "$temporary\$archive" -DestinationPath $temporary
  $binary = "$temporary\cortex-org-wiki.exe"
  if (-not $CliOnly) {
    $skillArgs = @('skill', 'setup', '--agent', $Agent, '--scope', $Scope, '--json')
    if ($Project) { $skillArgs += @('--project', $Project) }
    if ($ReplaceSkill) { $skillArgs += '--replace' }
    & $binary @skillArgs
    if ($LASTEXITCODE -ne 0) { throw "skill 安装失败: $LASTEXITCODE" }
  }
  if (-not $SkillOnly) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Move-Item $binary "$InstallDir\cortex-org-wiki.exe" -Force
    Write-Host "CLI 已安装: $InstallDir\cortex-org-wiki.exe"
  }
} finally { Remove-Item $temporary -Recurse -Force -ErrorAction SilentlyContinue }
