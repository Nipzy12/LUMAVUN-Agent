$port = 8000
$conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if ($conns) {
    foreach ($conn in $conns) {
        try {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction Stop
            Write-Host "Stopped PID $($conn.OwningProcess) on port $port"
        } catch {
            Write-Host "Could not stop PID $($conn.OwningProcess): $_"
        }
    }
} else {
    Write-Host "Nothing listening on port $port"
}
