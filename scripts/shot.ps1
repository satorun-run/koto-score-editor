# out/ のSVGをEdgeで画像（PNG）にする。確認用。
# 使い方: powershell -File scripts/shot.ps1 [-Height 420] [-Filter "rokudan*"]
param(
  [int]$Height = 420,
  [string]$Filter = "*"
)

$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$out = Join-Path $PSScriptRoot "..\out"
Get-ChildItem $out -Filter "$Filter.svg" | ForEach-Object {
  $png = [IO.Path]::ChangeExtension($_.FullName, ".png")
  $url = "file:///" + ($_.FullName -replace '\\', '/')
  $argList = @("--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
    "--window-size=700,$Height", "--screenshot=`"$png`"", "`"$url`"")
  Start-Process -FilePath $edge -ArgumentList $argList -Wait -WindowStyle Hidden
  Write-Output $_.Name
}
