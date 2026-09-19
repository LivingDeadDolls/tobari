param(
  [string]$Mode = 'normal',
  [string]$Repository
)
# A simple script parameter block preserves CLI flags such as --db verbatim.
# Advanced parameter binding would interpret --db as PowerShell's Debug switch.
$ServerArgs = @($args)
$ErrorActionPreference = 'Stop'
try {
  if ($Mode -notin @('normal', 'dev')) { throw 'Invalid startup mode.' }
  # Inspect the original UNC path before any drive mapping or Windows Node lookup.
  if ($Repository -match '^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(\\.*)?$') {
    $distribution = $Matches[1]
    $linuxPath = $Matches[2].Replace('\', '/').TrimEnd('/')
    Write-Host "Tobari: WSL distribution $distribution, using Linux Node.js"
    & wsl.exe --distribution $distribution --cd $linuxPath -- bash -il scripts/start-wsl.sh $Mode @ServerArgs
    exit $LASTEXITCODE
  }
  Set-Location -LiteralPath $Repository
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22.13 or newer is required on Windows. WSL repositories use Linux Node.js instead.' }
  & node -e 'const v=process.versions.node.split(String.fromCharCode(46)).map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=13)?0:1)'
  if ($LASTEXITCODE -ne 0) { throw 'Node.js 22.13 or newer is required on Windows.' }
  if ($Mode -eq 'dev') {
    & node --disable-warning=ExperimentalWarning scripts/dev-server.mjs @ServerArgs
  } else {
    & node --disable-warning=ExperimentalWarning src/server.mjs @ServerArgs
  }
  exit $LASTEXITCODE
} catch {
  Write-Host "Tobari ERROR: $($_.Exception.Message)"
  exit 1
}
