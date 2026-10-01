<#
  Resplandor - instalador OPCIONAL del agente de la impresora de la caja (Windows).

  Como usarlo: click derecho en este archivo > "Ejecutar con PowerShell".
  (Si Windows lo bloquea: powershell -ExecutionPolicy Bypass -File instalar.ps1)

  Hace, preguntando antes de cada cosa:
    1. Comprueba que hay Node 22 o mas nuevo.
    2. Crea config.json a partir de config.ejemplo.json (y lo abre en el Bloc de notas) si todavia no existe.
    3. Pone un acceso directo a iniciar.cmd en la carpeta de inicio de Windows (shell:startup), minimizado.
    4. Pide que el PC no se suspenda cuando esta enchufado (la termica USB no responde si el PC duerme).

  Para quitar el arranque con Windows:  instalar.ps1 -Quitar   (borra solo el acceso directo; config.json queda).

  No descarga nada, no abre puertos y no toca nada fuera de lo que dice arriba.
  ASCII a proposito: PowerShell 5.1 lee mal las tildes de un .ps1 sin BOM.
#>
param([switch] $Quitar)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

$carpeta = $PSScriptRoot
$acceso = Join-Path ([Environment]::GetFolderPath('Startup')) 'Resplandor - impresora de la caja.lnk'

function Preguntar([string] $texto) {
    $r = Read-Host ($texto + ' [S/n]')
    return ($r -eq '' -or $r -match '^[sSyY]')
}

if ($Quitar) {
    if (Test-Path -LiteralPath $acceso) {
        Remove-Item -LiteralPath $acceso
        Write-Host 'Listo: el agente ya no arranca con Windows. config.json y el resto quedan donde estaban.'
    } else {
        Write-Host 'No habia acceso directo de arranque; no hay nada que quitar.'
    }
    exit 0
}

Write-Host ''
Write-Host 'Resplandor - impresora de la caja'
Write-Host ('Carpeta: ' + $carpeta)
Write-Host ''

# 1. Node
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host 'Falta Node.js. Instala la version 22 LTS desde https://nodejs.org y vuelve a correr este archivo.'
    Read-Host 'Enter para salir'
    exit 1
}
$version = (& node --version).Trim()
$mayor = [int](($version -replace '^v', '').Split('.')[0])
if ($mayor -lt 22) {
    Write-Host ('Este PC tiene Node ' + $version + ' y hace falta la 22 o mas nueva. Instala Node 22 LTS desde https://nodejs.org y vuelve a correr este archivo.')
    Read-Host 'Enter para salir'
    exit 1
}
Write-Host ('1. Node ' + $version + ': bien.')

# 2. config.json
$config = Join-Path $carpeta 'config.json'
if (Test-Path -LiteralPath $config) {
    Write-Host '2. config.json ya existe: no lo toco.'
} elseif (Preguntar '2. Crear config.json (se abre en el Bloc de notas para que pegues el token y el nombre de la impresora)?') {
    Copy-Item -LiteralPath (Join-Path $carpeta 'config.ejemplo.json') -Destination $config
    Start-Process notepad.exe -ArgumentList ('"' + $config + '"')
    Write-Host '   Llena los cuatro primeros valores, guarda y cierra el Bloc de notas.'
    Read-Host '   Cuando termines, Enter'
}

# 3. Arranque con Windows
if (Preguntar '3. Que el agente arranque solo al entrar a Windows (acceso directo en shell:startup)?') {
    $ws = New-Object -ComObject WScript.Shell
    $lnk = $ws.CreateShortcut($acceso)
    $lnk.TargetPath = (Join-Path $carpeta 'iniciar.cmd')
    $lnk.WorkingDirectory = $carpeta
    $lnk.WindowStyle = 7
    $lnk.Description = 'Resplandor - impresora de la caja'
    $lnk.Save()
    Write-Host ('   Acceso directo creado en: ' + $acceso)
}

# 4. Energia
if (Preguntar '4. Que el PC no se suspenda ni hiberne cuando esta enchufado?') {
    try {
        & powercfg /change standby-timeout-ac 0
        if ($LASTEXITCODE -ne 0) { throw 'powercfg no pudo' }
        & powercfg /change hibernate-timeout-ac 0
        if ($LASTEXITCODE -ne 0) { throw 'powercfg no pudo' }
        Write-Host '   Listo. Falta, a mano: Opciones de energia > Configuracion avanzada > USB > Suspension selectiva de USB: Deshabilitada.'
    } catch {
        Write-Host '   No pude cambiarlo (puede pedir permisos de administrador). Hazlo en Configuracion > Sistema > Inicio/apagado y suspension.'
    }
}

Write-Host ''
Write-Host 'Siguiente: abre una ventana de comandos en esta carpeta y corre:'
Write-Host '   node agente.mjs --impresoras     (para ver el nombre de la termica)'
Write-Host '   node agente.mjs --prueba         (para imprimir la pagina de prueba)'
Write-Host 'y despues haz doble clic en iniciar.cmd. Los pasos completos estan en README-impresora.md.'
Write-Host ''
Read-Host 'Enter para cerrar'
