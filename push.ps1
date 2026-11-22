param([switch]$Watch)
Set-Location $PSScriptRoot

function Push-Now {
    git add -A
    $changes = git status --porcelain
    if ($changes) {
        $msg = "auto: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
        git commit -m $msg
        git push -u origin main
        Write-Host "[push] $msg" -ForegroundColor Green
    } else {
        Write-Host "[push] нет изменений" -ForegroundColor DarkGray
    }
}

Push-Now
if ($Watch) {
    Write-Host "[watch] авто-коммит каждые 60 с. Ctrl+C чтобы остановить." -ForegroundColor Cyan
    while ($true) { Start-Sleep -Seconds 60; Push-Now }
}