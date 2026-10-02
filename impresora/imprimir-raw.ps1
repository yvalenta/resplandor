<#
  Resplandor - imprime un archivo de bytes RAW (ESC/POS) en una impresora de Windows.

  Uso (lo llama imprimir-windows.mjs; no hace falta correrlo a mano):
      powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File imprimir-raw.ps1 `
          -Impresora "POS-80" -Archivo "C:\Users\caja\AppData\Local\Temp\resplandor-ab12.bin"

  Como funciona: abre la impresora por su nombre en Windows (OpenPrinter), abre un documento de tipo RAW
  (StartDocPrinter), escribe los bytes tal cual (WritePrinter) y cierra. Con RAW el spooler NO convierte
  nada: los bytes ESC/POS le llegan a la termica como salieron del agente. No usa modulos de PowerShell ni
  programas de terceros; solo winspool.drv, que es parte de Windows.

  SEGURIDAD - este archivo es fijo y nunca se arma con datos:
    * El nombre de la impresora y la ruta del archivo llegan SOLO como parametros ($Impresora, $Archivo).
    * Se usan unicamente como VALORES: Test-Path -LiteralPath, ReadAllBytes y el argumento de
      [ResplandorRaw]::Enviar(). Nunca dentro de un texto con comillas dobles, nunca en Invoke-Expression,
      nunca en -Command, nunca dentro del codigo C#.
    * El codigo C# va en un here-string de comillas SIMPLES (@' ... '@): PowerShell no expande nada dentro.
    * El archivo es ASCII puro (PowerShell 5.1 lee los .ps1 sin BOM como ANSI): sin tildes en los textos.
  scripts/pruebas/impresora-windows.test.mjs vigila estas reglas.

  Salida: codigo 0 = enviado al spooler. Distinto de 0 = no se envio; el motivo sale por el error estandar:
      2 = falta el archivo o esta vacio
      3 = Windows rechazo la operacion (el texto lleva "Win32:<codigo>")
#>
param(
    [Parameter(Mandatory = $true)] [ValidateNotNullOrEmpty()] [string] $Impresora,
    [Parameter(Mandatory = $true)] [ValidateNotNullOrEmpty()] [string] $Archivo
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

$codigoCSharp = @'
using System;
using System.Runtime.InteropServices;

public static class ResplandorRaw
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DocInfo
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true)]
    static extern bool OpenPrinter(string nombre, out IntPtr impresora, IntPtr predeterminados);

    [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true)]
    static extern bool ClosePrinter(IntPtr impresora);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true)]
    static extern int StartDocPrinter(IntPtr impresora, int nivel, [In, MarshalAs(UnmanagedType.LPStruct)] DocInfo documento);

    [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true)]
    static extern bool EndDocPrinter(IntPtr impresora);

    [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true)]
    static extern bool StartPagePrinter(IntPtr impresora);

    [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true)]
    static extern bool EndPagePrinter(IntPtr impresora);

    [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true)]
    static extern bool WritePrinter(IntPtr impresora, IntPtr bytes, int cuantos, out int escritos);

    static Exception Fallo(string paso)
    {
        return new InvalidOperationException(paso + " (Win32:" + Marshal.GetLastWin32Error() + ")");
    }

    public static void Enviar(string nombreImpresora, byte[] datos, string nombreDocumento)
    {
        IntPtr h;
        if (!OpenPrinter(nombreImpresora, out h, IntPtr.Zero))
        {
            throw Fallo("No se pudo abrir la impresora");
        }
        try
        {
            DocInfo documento = new DocInfo();
            documento.pDocName = nombreDocumento;
            documento.pOutputFile = null;
            documento.pDataType = "RAW";
            if (StartDocPrinter(h, 1, documento) == 0)
            {
                throw Fallo("No se pudo iniciar el documento RAW");
            }
            try
            {
                if (!StartPagePrinter(h))
                {
                    throw Fallo("No se pudo iniciar la pagina");
                }
                try
                {
                    IntPtr memoria = Marshal.AllocCoTaskMem(datos.Length);
                    try
                    {
                        Marshal.Copy(datos, 0, memoria, datos.Length);
                        int escritos;
                        if (!WritePrinter(h, memoria, datos.Length, out escritos))
                        {
                            throw Fallo("No se pudieron escribir los datos");
                        }
                        if (escritos != datos.Length)
                        {
                            throw new InvalidOperationException("Windows recibio " + escritos + " de " + datos.Length + " bytes");
                        }
                    }
                    finally
                    {
                        Marshal.FreeCoTaskMem(memoria);
                    }
                }
                finally
                {
                    EndPagePrinter(h);
                }
            }
            finally
            {
                EndDocPrinter(h);
            }
        }
        finally
        {
            ClosePrinter(h);
        }
    }
}
'@

try {
    if (-not (Test-Path -LiteralPath $Archivo -PathType Leaf)) {
        [Console]::Error.WriteLine('No existe el archivo a imprimir.')
        exit 2
    }
    $datos = [System.IO.File]::ReadAllBytes($Archivo)
    if ($datos.Length -eq 0) {
        [Console]::Error.WriteLine('El archivo a imprimir esta vacio.')
        exit 2
    }
    Add-Type -TypeDefinition $codigoCSharp
    [ResplandorRaw]::Enviar($Impresora, $datos, 'Resplandor')
    exit 0
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 3
}
