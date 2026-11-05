// Launcher mínimo (sem janela) usado como programa padrão dos .dbml.
// Compilado pelo install.ps1 com o csc.exe que já vem no Windows.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        if (args.Length == 0) return;
        string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string script = Path.Combine(dir, "open-dbml.ps1");
        var psi = new ProcessStartInfo("powershell.exe",
            "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script + "\" -Path \"" + args[0] + "\"");
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        Process.Start(psi);
    }
}
