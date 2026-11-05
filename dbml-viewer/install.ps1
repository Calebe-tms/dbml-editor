# Associa arquivos .dbml ao DBML Editor (somente para o seu usuário, sem admin).
# Rode de dentro da pasta final (a associação aponta para esta pasta).
# Para desfazer: .\install.ps1 -Uninstall
param([switch]$Uninstall)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe  = Join-Path $here 'DbmlViewer.exe'
$base = 'HKCU:\Software\Classes'

if ($Uninstall) {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "$base\.dbml", "$base\DBMLViewer.File", "$base\Applications\DbmlViewer.exe"
    Remove-Item -Force -ErrorAction SilentlyContinue $exe
    Write-Host 'Associação removida.'
} else {
    # 1) compila o launcher .exe (o Windows não aceita wscript.exe como programa padrão)
    $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
    & $csc /nologo /target:winexe "/out:$exe" (Join-Path $here 'DbmlViewer.cs')
    if (-not (Test-Path $exe)) { Write-Error 'Falha ao compilar DbmlViewer.exe'; exit 1 }

    $cmd = '"{0}" "%1"' -f $exe
    # 2) registra o aplicativo (aparece na lista "Abrir com" com o botão Sempre)
    New-Item -Force -Path "$base\Applications\DbmlViewer.exe\shell\open\command" | Out-Null
    Set-ItemProperty -Path "$base\Applications\DbmlViewer.exe" -Name 'FriendlyAppName' -Value 'DBML Editor'
    Set-ItemProperty -Path "$base\Applications\DbmlViewer.exe\shell\open\command" -Name '(default)' -Value $cmd
    New-Item -Force -Path "$base\Applications\DbmlViewer.exe\SupportedTypes" | Out-Null
    Set-ItemProperty -Path "$base\Applications\DbmlViewer.exe\SupportedTypes" -Name '.dbml' -Value ''
    # 3) registra o tipo de arquivo
    New-Item -Force -Path "$base\.dbml" | Out-Null
    Set-ItemProperty -Path "$base\.dbml" -Name '(default)' -Value 'DBMLViewer.File'
    New-Item -Force -Path "$base\.dbml\OpenWithProgids" | Out-Null
    New-ItemProperty -Force -Path "$base\.dbml\OpenWithProgids" -Name 'DBMLViewer.File' -Value '' -PropertyType String | Out-Null
    New-Item -Force -Path "$base\DBMLViewer.File" | Out-Null
    Set-ItemProperty -Path "$base\DBMLViewer.File" -Name '(default)' -Value 'Arquivo DBML'
    New-Item -Force -Path "$base\DBMLViewer.File\shell\open\command" | Out-Null
    Set-ItemProperty -Path "$base\DBMLViewer.File\shell\open\command" -Name '(default)' -Value $cmd
    New-Item -Force -Path "$base\DBMLViewer.File\DefaultIcon" | Out-Null
    Set-ItemProperty -Path "$base\DBMLViewer.File\DefaultIcon" -Name '(default)' -Value "$env:SystemRoot\System32\imageres.dll,-5313"
    Write-Host "Pronto! Arquivos .dbml agora abrem no DBML Editor ($here)."
}
Add-Type -Namespace Win32 -Name Shell -MemberDefinition '[System.Runtime.InteropServices.DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, uint f, IntPtr a, IntPtr b);'
[Win32.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
if (-not $Uninstall) { Write-Host 'Na primeira vez, o Windows pergunta qual app usar: escolha "DBML Editor" e clique em Sempre.' }
