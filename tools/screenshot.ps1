# ==========================================================================
# Снимает скриншот страницы headless Chrome в изолированном профиле.
# Использование:
#   powershell -ExecutionPolicy Bypass -File tools\screenshot.ps1 `
#       -Url "file:///C:/path/index.html?seed=1&demo=2.5" `
#       -Out "screenshots\shot.png" -Budget 12000 -W 1360 -H 1000
# ==========================================================================
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Budget = 12000,
  [int]$W = 1360,
  [int]$H = 1000
)

$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$prof = Join-Path $env:TEMP ("mcc_headless_" + [Guid]::NewGuid().ToString("N"))
$outAbs = (Resolve-Path (Split-Path $Out)).Path + "\" + (Split-Path $Out -Leaf)

& $chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars --no-first-run --no-default-browser-check `
  --user-data-dir=$prof --window-size="$W,$H" --virtual-time-budget=$Budget `
  --screenshot=$outAbs $Url

Remove-Item -LiteralPath $prof -Recurse -Force -ErrorAction SilentlyContinue
for ($i = 0; $i -lt 100; $i++) {
  if (Test-Path -LiteralPath $outAbs) { break }
  Start-Sleep -Milliseconds 150
}
if (Test-Path -LiteralPath $outAbs) {
  Write-Output ("OK: " + $outAbs + " (" + (Get-Item -LiteralPath $outAbs).Length + " bytes)")
} else {
  Write-Output ("FAILED: " + $outAbs)
  exit 1
}
