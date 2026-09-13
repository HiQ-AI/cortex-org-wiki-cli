param(
  [string[]]$Agent = @(),
  [string]$Scope = 'project',
  [string]$Project,
  [switch]$CliOnly,
  [switch]$SkillOnly,
  [switch]$ReplaceSkill,
  [string]$InstallDir = $(if ($env:CORTEX_ORG_WIKI_INSTALL) { $env:CORTEX_ORG_WIKI_INSTALL } else { "$env:LOCALAPPDATA\Programs\cortex-org-wiki" }),
  [string]$BaseUrl = $(if ($env:CORTEX_ORG_WIKI_DOWNLOAD_BASE) { $env:CORTEX_ORG_WIKI_DOWNLOAD_BASE } else { 'https://download.hiq.earth/cli/cortex-org-wiki/latest' })
)
# Output is exactly one JSON result line; progress and the JSON failure line go to stderr.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Say([string]$Text) { [Console]::Error.WriteLine($Text) }
function Fail([string]$Kind, [string]$Code, [string]$Message) {
  [Console]::Error.WriteLine((ConvertTo-Json -Compress -InputObject ([ordered]@{ ok = $false; kind = $Kind; code = $Code; message = $Message })))
  # throw, not exit: exit would also close a session that runs this through [scriptblock]::Create.
  throw $Message
}
$consoleEncoding = [Console]::OutputEncoding
$temporary = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid())
try {
  # The CLI writes UTF-8; read and re-emit it as UTF-8 regardless of the console code page.
  [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
  $agents = @($Agent | ForEach-Object { $_ -split ',' })
  if ($CliOnly -and $SkillOnly) { Fail validation invalid_argument '-CliOnly 和 -SkillOnly 不能同时使用' }
  if (-not $CliOnly) {
    if ($agents.Count -eq 0) { Fail validation invalid_argument '请指定 -Agent codex|claude-code，多个宿主用逗号分隔（Cortex 市场技能由 Host 安装）' }
    foreach ($name in $agents) { if ($name -notin 'codex', 'claude-code') { Fail validation invalid_argument "不支持的 agent: $name（可选 codex、claude-code）" } }
  }
  if ($Scope -notin 'project', 'user') { Fail validation invalid_argument 'Scope 必须是 project 或 user' }
  if ($Scope -eq 'user' -and $Project) { Fail validation invalid_argument '-Project 仅用于项目范围' }
  if (-not [Environment]::Is64BitOperatingSystem) { Fail config unsupported_platform '需要 64 位 Windows' }
  $archive = 'cortex-org-wiki-windows-x64.zip'
  New-Item -ItemType Directory -Path $temporary | Out-Null
  Say "下载 $BaseUrl/$archive"
  try {
    Invoke-WebRequest "$BaseUrl/$archive" -OutFile (Join-Path $temporary $archive) -UseBasicParsing
    Invoke-WebRequest "$BaseUrl/checksums.txt" -OutFile (Join-Path $temporary 'checksums.txt') -UseBasicParsing
  } catch { Fail transport download_failed "下载失败：$BaseUrl（$($_.Exception.Message)）" }
  $entry = @(Get-Content (Join-Path $temporary 'checksums.txt') | Where-Object { $_ -match "^[a-fA-F0-9]{64}\s+(\./)?$([regex]::Escape($archive))$" })
  if ($entry.Count -ne 1) { Fail upstream checksum_missing 'checksum 缺少或重复当前平台产物' }
  $expected = ($entry[0] -split '\s+')[0].ToLower()
  $actual = (Get-FileHash (Join-Path $temporary $archive) -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $expected) { Fail upstream checksum_mismatch 'checksum 不匹配，未安装' }
  try { Expand-Archive (Join-Path $temporary $archive) -DestinationPath $temporary } catch { Fail upstream archive_invalid "无法解压 $archive" }
  $cli = Join-Path $temporary 'cortex-org-wiki.exe'
  $cliJson = 'null'
  # The CLI goes into place first: a skill that cannot be written must not block the CLI upgrade.
  if (-not $SkillOnly) {
    try { $target = Join-Path (New-Item -ItemType Directory -Path $InstallDir -Force).FullName 'cortex-org-wiki.exe' } catch { Fail config install_failed "无法创建 CLI 目录：$InstallDir" }
    $previous = $null
    if (Test-Path -LiteralPath $target -PathType Leaf) {
      try { $current = (& $target version) -join ''; if ($LASTEXITCODE -eq 0) { $previous = $current } } catch { }
    }
    try { Move-Item -LiteralPath $cli -Destination $target -Force } catch { Fail config install_failed "无法写入 CLI：$target" }
    $version = (& $target version) -join ''
    if ($LASTEXITCODE -ne 0) { Fail unknown cli_unusable "已安装的 CLI 无法运行：$target" }
    Say "CLI 已安装: $target ($version)"
    $cliJson = ConvertTo-Json -Compress -InputObject ([ordered]@{ path = $target; version = $version; previous_version = $previous })
    $cli = $target
  }
  $skills = '"skills":[]'
  if (-not $CliOnly) {
    $skillArgs = @('skill', 'setup', '--scope', $Scope, '--json')
    foreach ($name in $agents) { $skillArgs += @('--agent', $name) }
    if ($Project) { $skillArgs += @('--project', $Project) }
    if ($ReplaceSkill) { $skillArgs += '--replace' }
    Say "安装 skill: $($agents -join ',') ($Scope)"
    $ErrorActionPreference = 'Continue'
    $output = @(& $cli @skillArgs 2>&1)
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($exitCode -ne 0) {
      # The CLI already printed a JSON failure; only its flag name differs for installer users.
      $failure = @($output | Where-Object { $_ -is [Management.Automation.ErrorRecord] } | ForEach-Object { "$_" }) -join "`n"
      [Console]::Error.WriteLine($failure.Replace(' --replace ', ' -ReplaceSkill '))
      throw "skill 安装失败（退出码 $exitCode）"
    }
    $result = @($output | Where-Object { $_ -isnot [Management.Automation.ErrorRecord] }) -join ''
    $prefix = '{"ok":true,"tool":"skill setup","data":{'
    if (-not ($result.StartsWith($prefix + '"skills":[', [StringComparison]::Ordinal) -and $result.EndsWith(']}}', [StringComparison]::Ordinal))) {
      Fail unknown unexpected_output 'skill setup 输出无法识别；请确认下载的 CLI 与安装脚本来自同一版本'
    }
    $skills = $result.Substring($prefix.Length, $result.Length - $prefix.Length - 2)
  }
  Write-Output ('{"ok":true,"tool":"install","data":{"cli":' + $cliJson + ',' + $skills + '}}')
} finally {
  [Console]::OutputEncoding = $consoleEncoding
  Remove-Item $temporary -Recurse -Force -ErrorAction SilentlyContinue
}
