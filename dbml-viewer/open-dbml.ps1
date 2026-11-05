param(
    [Parameter(Mandatory = $true)][string]$Path,
    [switch]$NoBrowser   # não abre o navegador; só imprime a URL (usado em testes)
)
# ---- configuração ----
$Browser   = 'auto'    # 'auto' (Chrome, senão Edge), 'chrome', 'edge' ou 'default'
$AppWindow = $true     # $true = janela limpa (sem barra de endereço); $false = aba normal
# ----------------------
# Mini servidor local: serve o editor e grava o .dbml (e o layout) em disco.
# Escuta só em 127.0.0.1, com token aleatório na URL, e encerra sozinho quando a janela fecha.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
try {
    $full = (Resolve-Path -LiteralPath $Path).Path
    $utf8 = New-Object Text.UTF8Encoding $false
    $md5  = [Security.Cryptography.MD5]::Create()
    $hash = ([BitConverter]::ToString($md5.ComputeHash($utf8.GetBytes($full.ToLowerInvariant()))) -replace '-', '').Substring(0, 12).ToLower()
    $data = Join-Path $env:APPDATA 'dbml-viewer'
    New-Item -ItemType Directory -Force -Path $data | Out-Null
    $layoutFile = Join-Path $data "layout-$hash.json"
    $prefsFile  = Join-Path $data 'prefs.json'

    $tl = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0); $tl.Start()
    $port = $tl.LocalEndpoint.Port; $tl.Stop()
    $token = [Guid]::NewGuid().ToString('N')
    $listener = New-Object Net.HttpListener
    $listener.Prefixes.Add("http://127.0.0.1:$port/")
    $listener.Start()
    $url = "http://127.0.0.1:$port/$token/"

    function Find-Exe($names, $regNames) {
        foreach ($r in $regNames) {
            foreach ($root in 'HKCU', 'HKLM') {
                $v = (Get-ItemProperty -ErrorAction SilentlyContinue "${root}:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$r")
                if ($v -and $v.'(default)' -and (Test-Path $v.'(default)')) { return $v.'(default)' }
            }
        }
        foreach ($n in $names) { if (Test-Path $n) { return $n } }
        return $null
    }
    if ($NoBrowser) { Write-Output $url }
    else {
        $chrome = Find-Exe @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") @('chrome.exe')
        $edge   = Find-Exe @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") @('msedge.exe')
        $exe = switch ($Browser) { 'chrome' { $chrome } 'edge' { $edge } 'default' { $null } default { if ($chrome) { $chrome } else { $edge } } }
        if ($exe) { if ($AppWindow) { Start-Process -FilePath $exe -ArgumentList "--app=$url" } else { Start-Process -FilePath $exe -ArgumentList $url } }
        else { Start-Process $url }
    }

    $mime = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'application/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8' }
    function Send($ctx, [int]$status, [byte[]]$bytes, [string]$type) {
        $r = $ctx.Response; $r.StatusCode = $status; $r.ContentType = $type
        $r.Headers.Add('Cache-Control', 'no-store')
        $r.ContentLength64 = $bytes.Length
        if ($bytes.Length) { $r.OutputStream.Write($bytes, 0, $bytes.Length) }
        $r.OutputStream.Close()
    }
    function SendText($ctx, [int]$status, [string]$text, [string]$type) { Send $ctx $status ($utf8.GetBytes($text)) $type }
    function Mtime($p) { if (Test-Path -LiteralPath $p) { ([DateTimeOffset](Get-Item -LiteralPath $p).LastWriteTimeUtc).ToUnixTimeMilliseconds() } else { 0 } }
    function ReadBody($ctx) { $sr = New-Object IO.StreamReader($ctx.Request.InputStream, $utf8); try { $sr.ReadToEnd() } finally { $sr.Dispose() } }

    $json = 'application/json; charset=utf-8'
    $task = $listener.GetContextAsync()
    $last = Get-Date; $byeAt = $null
    while ($true) {
        if (-not $task.AsyncWaitHandle.WaitOne(500)) {
            if ($byeAt -and (Get-Date) -gt $byeAt) { break }
            if (((Get-Date) - $last).TotalMinutes -gt 10) { break }
            continue
        }
        $ctx = $task.GetAwaiter().GetResult(); $task = $listener.GetContextAsync()
        $last = Get-Date; $byeAt = $null
        try {
            $req = $ctx.Request
            $segs = $req.Url.AbsolutePath.TrimStart('/').Split('/', 2)
            if ($req.Url.Host -ne '127.0.0.1' -or $segs[0] -ne $token) { SendText $ctx 404 'not found' 'text/plain'; continue }
            $rest = if ($segs.Count -gt 1) { $segs[1] } else { '' }
            $m = $req.HttpMethod
            switch -Regex ($rest) {
                '^$' { Send $ctx 200 ([IO.File]::ReadAllBytes((Join-Path $here 'viewer.html'))) $mime['.html']; break }
                '^session\.js$' {
                    $o = @{ name = [IO.Path]::GetFileName($full); path = $full; api = $true } | ConvertTo-Json -Compress
                    SendText $ctx 200 "window.__DBML__ = $o;" $mime['.js']; break
                }
                '^js/[\w\.-]+\.js$' {
                    $f = Join-Path $here $rest
                    if (Test-Path -LiteralPath $f) { Send $ctx 200 ([IO.File]::ReadAllBytes($f)) $mime['.js'] } else { SendText $ctx 404 'not found' 'text/plain' }
                    break
                }
                '^file$' {
                    if ($m -eq 'PUT') {
                        [IO.File]::WriteAllText($full, (ReadBody $ctx), $utf8)
                        SendText $ctx 200 ('{"mtime":' + (Mtime $full) + '}') $json
                    } else {
                        $ctx.Response.Headers.Add('X-Mtime', [string](Mtime $full))
                        Send $ctx 200 ([IO.File]::ReadAllBytes($full)) 'text/plain; charset=utf-8'
                    }
                    break
                }
                '^ping$' { SendText $ctx 200 ('{"mtime":' + (Mtime $full) + '}') $json; break }
                '^bye$'  { SendText $ctx 200 '{}' $json; $byeAt = (Get-Date).AddSeconds(8); break }
                '^(layout|prefs)$' {
                    $f = if ($rest -eq 'layout') { $layoutFile } else { $prefsFile }
                    if ($m -eq 'PUT') { [IO.File]::WriteAllText($f, (ReadBody $ctx), $utf8); SendText $ctx 200 '{}' $json }
                    elseif (Test-Path -LiteralPath $f) { Send $ctx 200 ([IO.File]::ReadAllBytes($f)) $json }
                    else { SendText $ctx 200 'null' $json }
                    break
                }
                default { SendText $ctx 404 'not found' 'text/plain' }
            }
        }
        catch { try { $ctx.Response.Abort() } catch { } }
    }
    $listener.Stop()
}
catch {
    Add-Type -AssemblyName System.Windows.Forms
    [void][Windows.Forms.MessageBox]::Show("Não foi possível abrir o arquivo DBML:`n`n$($_.Exception.Message)", 'DBML Editor', 'OK', 'Error')
}
