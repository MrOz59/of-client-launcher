param([string]$Core, [string]$Config, [string]$Lease, [int]$LauncherPid, [int]$RpcPort)
$ErrorActionPreference = 'Stop'
$child = $null
try {
  if (!(Test-Path -LiteralPath $Lease)) { exit 0 }
  $launcher = Get-Process -Id $LauncherPid
  $started = $launcher.StartTime
  $child = Start-Process -FilePath $Core -ArgumentList @('--disable-env-parsing', '--rpc-portal', "127.0.0.1:$RpcPort", '--rpc-portal-whitelist', '127.0.0.1/32', '--config-file', ('"' + $Config + '"')) -WorkingDirectory (Split-Path $Core) -WindowStyle Hidden -PassThru
  while ((Test-Path -LiteralPath $Lease) -and !$child.HasExited) {
    $parent = Get-Process -Id $LauncherPid -ErrorAction SilentlyContinue
    if (!$parent -or $parent.StartTime -ne $started) { break }
    Start-Sleep -Seconds 1
    $child.Refresh()
  }
} finally {
  if ($child -and !$child.HasExited) {
    Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue
    $child.WaitForExit()
  }
  Remove-Item -LiteralPath $Config, $Lease -Force -ErrorAction SilentlyContinue
}
