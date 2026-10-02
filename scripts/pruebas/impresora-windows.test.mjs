// La impresión en Windows del agente (impresora/imprimir-windows.mjs + imprimir-raw.ps1).
//
// No hay Windows aquí, así que lo que se puede probar de verdad es lo que importa para la SEGURIDAD y el
// contrato: que el nombre de la impresora y la ruta del .bin viajan como argumentos de un `spawn` sin shell
// y que el script PowerShell es un archivo FIJO que solo los usa como valores — nunca interpolados en código
// (ni en C#, ni en un -Command, ni en Invoke-Expression). Lo que no se puede probar aquí (que winspool acepte
// los bytes) está revisado línea a línea en el commit y se prueba en el PC de la caja con `--prueba`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  imprimirRaw, listarImpresoras, interpretarListado, formatearImpresoras, argumentosImpresion, rutaPowerShell,
  validarNombreImpresora, simularImpresion, SCRIPT_RAW, ErrorImpresion,
} from '../../impresora/imprimir-windows.mjs';
import { bytesATexto } from '../../impresora/ticket/vista-texto.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PS1 = fs.readFileSync(SCRIPT_RAW, 'utf8');
const hashPs1 = () => createHash('sha256').update(fs.readFileSync(SCRIPT_RAW)).digest('hex');
const BYTES = Buffer.from([0x1b, 0x40, 0x1b, 0x74, 0x02, 0x43, 0x61, 0x66, 0x82, 0x0a, 0x1d, 0x56, 0x42, 0x00]);

// ───────────────────────── 1. el script .ps1 ─────────────────────────

// Partes del script: el bloque de ayuda, el here-string de C# y el código PowerShell que queda.
function partesPs1(texto) {
  const ayuda = texto.match(/^<#[\s\S]*?^#>/m)?.[0] ?? '';
  const aqui = texto.match(/@'\r?\n([\s\S]*?)\r?\n'@/);
  const csharp = aqui?.[1] ?? '';
  const codigo = texto.replace(ayuda, '').replace(aqui?.[0] ?? '', '');
  return { ayuda, csharp, codigo };
}
const { csharp: CSHARP, codigo: CODIGO } = partesPs1(PS1);

test('imprimir-raw.ps1: ASCII puro (PowerShell 5.1 lee los .ps1 sin BOM como ANSI: una tilde se corrompería)', () => {
  const malos = [...PS1].map((c, i) => [c, i]).filter(([c]) => c.charCodeAt(0) > 0x7e || (c.charCodeAt(0) < 0x20 && !'\r\n\t'.includes(c)));
  assert.deepEqual(malos.slice(0, 3), []);
});

test('imprimir-raw.ps1: el nombre de la impresora y el archivo son parámetros obligatorios de texto, y nada más', () => {
  assert.match(CODIGO, /param\(\s*\[Parameter\(Mandatory = \$true\)\]\s*\[ValidateNotNullOrEmpty\(\)\]\s*\[string\]\s*\$Impresora,\s*\[Parameter\(Mandatory = \$true\)\]\s*\[ValidateNotNullOrEmpty\(\)\]\s*\[string\]\s*\$Archivo\s*\)/);
  assert.match(CODIGO, /Set-StrictMode -Version 2/);
  assert.match(CODIGO, /\$ErrorActionPreference = 'Stop'/);
  const parametros = [...CODIGO.matchAll(/^\s*\[Parameter[^\n]*\$(\w+)/gm)].map((m) => m[1]);
  assert.deepEqual(parametros, ['Impresora', 'Archivo']);
});

test('imprimir-raw.ps1: $Impresora y $Archivo solo se usan como VALORES (lista blanca de usos, línea por línea)', () => {
  const usos = CODIGO.split(/\r?\n/).filter((l) => /\$(Impresora|Archivo)\b/.test(l) && !/\[Parameter\(/.test(l));
  const permitidos = [
    /^\s*if \(-not \(Test-Path -LiteralPath \$Archivo -PathType Leaf\)\) \{$/,
    /^\s*\$datos = \[System\.IO\.File\]::ReadAllBytes\(\$Archivo\)$/,
    /^\s*\[ResplandorRaw\]::Enviar\(\$Impresora, \$datos, 'Resplandor'\)$/,
  ];
  assert.equal(usos.length, 3, 'hay exactamente tres usos: comprobar, leer y enviar');
  for (const l of usos) assert.ok(permitidos.some((re) => re.test(l)), `uso no permitido: ${l.trim()}`);
  // Y ninguno dentro de un texto entre comillas dobles ni de una expansión $( ):
  assert.doesNotMatch(CODIGO, /"[^"\n]*\$(Impresora|Archivo)/);
  assert.doesNotMatch(CODIGO, /\$\(\s*\$(Impresora|Archivo)/);
});

test('imprimir-raw.ps1: ninguna construcción que ejecute texto, abra otro proceso o salga a la red', () => {
  const prohibidos = [
    /Invoke-Expression/i, /\biex\b/i, /Invoke-Command/i, /Start-Process/i, /\bcmd(\.exe)?\b/i, /-Command\b/i, /-EncodedCommand/i,
    /\[scriptblock\]/i, /ScriptBlock/i, /Set-ExecutionPolicy/i, /Invoke-WebRequest|Invoke-RestMethod|WebClient|DownloadString|DownloadFile/i,
    /^\s*&\s/m, /Out-File|Set-Content|Add-Content/i, /Remove-Item/i, /\.Invoke\(/,
  ];
  for (const re of prohibidos) assert.doesNotMatch(CODIGO, re, `el script no debe usar ${re}`);
  assert.doesNotMatch(CSHARP, /Process\.Start|System\.Diagnostics|WebClient|HttpClient|File\.(Write|Delete)|Assembly\.Load/);
});

test('imprimir-raw.ps1: el C# va en un here-string de comillas SIMPLES (sin expansión) y no lleva ningún $', () => {
  assert.match(PS1, /\$codigoCSharp = @'\r?\n/);
  assert.ok(CSHARP.length > 500, 'no se encontró el código C#');
  assert.doesNotMatch(CSHARP, /\$/, 'PowerShell no expande nada dentro de @\'…\'@, pero tampoco hay por qué dejar un $');
  assert.match(CODIGO, /Add-Type -TypeDefinition \$codigoCSharp\r?$/m, 'se compila el texto fijo, no uno armado');
  assert.equal((PS1.match(/= @'\r?\n/g) ?? []).length, 1, 'un solo here-string');
  assert.doesNotMatch(PS1, /@"/, 'ningún here-string de comillas dobles (ese sí expande variables)');
});

test('imprimir-raw.ps1: C# del compilador de Windows PowerShell 5.1 (C# 5) y las llamadas de winspool de un trabajo RAW', () => {
  assert.doesNotMatch(CSHARP, /\$"|\?\.|nameof\(|=>|\bvar\b.*\bout var\b/, 'sin características de C# 6+');
  assert.equal((CSHARP.match(/\{/g) ?? []).length, (CSHARP.match(/\}/g) ?? []).length, 'llaves balanceadas');
  assert.equal((CSHARP.match(/\(/g) ?? []).length, (CSHARP.match(/\)/g) ?? []).length, 'paréntesis balanceados');
  for (const f of ['OpenPrinterW', 'StartDocPrinterW', 'StartPagePrinter', 'WritePrinter', 'EndPagePrinter', 'EndDocPrinter', 'ClosePrinter']) {
    assert.match(CSHARP, new RegExp(`EntryPoint = "${f}"`), f);
  }
  assert.match(CSHARP, /DllImport\("winspool\.drv"/);
  assert.match(CSHARP, /pDataType = "RAW"/, 'el tipo de datos del documento es RAW: el spooler no convierte nada');
  assert.match(CSHARP, /Marshal\.GetLastWin32Error\(\)/);
  assert.match(CSHARP, /SetLastError = true/);
  // Cada recurso se libera en un finally: ClosePrinter, EndDocPrinter, EndPagePrinter, FreeCoTaskMem.
  for (const f of ['ClosePrinter(h)', 'EndDocPrinter(h)', 'EndPagePrinter(h)', 'Marshal.FreeCoTaskMem(memoria)']) {
    assert.match(CSHARP, new RegExp(`finally\\s*\\{\\s*${f.replace(/[()]/g, '\\$&')}`), `${f} dentro de un finally`);
  }
  assert.match(CSHARP, /escritos != datos\.Length/, 'se comprueba que Windows recibió todos los bytes');
});

test('imprimir-raw.ps1: códigos de salida documentados (0 enviado, 2 archivo, 3 Windows) y errores por stderr', () => {
  assert.match(CODIGO, /exit 0/);
  assert.match(CODIGO, /exit 2/);
  assert.match(CODIGO, /catch \{\s*\[Console\]::Error\.WriteLine\(\$_\.Exception\.Message\)\s*exit 3\s*\}/);
});

test('imprimir-raw.ps1: el contrato del encabezado es el que usa el .mjs', () => {
  const args = argumentosImpresion({ impresora: 'POS-80', archivo: 'C:\\t\\a.bin' });
  assert.deepEqual(args, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_RAW, '-Impresora', 'POS-80', '-Archivo', 'C:\\t\\a.bin']);
  assert.ok(path.isAbsolute(SCRIPT_RAW) && SCRIPT_RAW.endsWith('imprimir-raw.ps1'));
  assert.ok(fs.existsSync(path.join(RAIZ, 'impresora', 'imprimir-raw.ps1')));
});

// ───────────────────────── 2. el spawn: argumentos, sin shell ─────────────────────────

// Un `spawn` de mentira. `guion(args)` decide qué hace el «proceso»: devuelve {codigo, salida, errores, error, colgar}.
function falsoSpawn(guion = () => ({ codigo: 0 })) {
  const llamadas = [];
  const spawn = (cmd, args, opciones) => {
    const hijo = new EventEmitter();
    hijo.stdout = new EventEmitter();
    hijo.stderr = new EventEmitter();
    hijo.matado = false;
    hijo.kill = () => { hijo.matado = true; };
    const llamada = { cmd, args, opciones, hijo, archivoExistia: null, bytes: null };
    const iArchivo = args.indexOf('-Archivo');
    if (iArchivo >= 0 && fs.existsSync(args[iArchivo + 1])) {
      llamada.archivoExistia = true;
      llamada.bytes = fs.readFileSync(args[iArchivo + 1]);
    }
    llamadas.push(llamada);
    const r = guion(args) ?? {};
    setImmediate(() => {
      if (r.colgar) return;
      if (r.error) { hijo.emit('error', r.error); return; }
      if (r.salida) hijo.stdout.emit('data', Buffer.from(r.salida));
      if (r.errores) hijo.stderr.emit('data', Buffer.from(r.errores));
      hijo.emit('close', r.codigo ?? 0);
    });
    return hijo;
  };
  return { spawn, llamadas };
}

const tmpPropio = () => fs.mkdtempSync(path.join(os.tmpdir(), 'resplandor-prueba-'));

test('spawn sin shell, con el script fijo y los argumentos como elementos aparte (nombres con metacaracteres incluidos)', async () => {
  const antes = hashPs1();
  const nombres = ['POS-80', 'POS 80 (copia 1)', 'Épson TM-T20 ñandú', 'x & calc', "x'; Remove-Item C:\\ -Recurse; '", '$(calc)', '`calc`', 'a|b>c', '%USERPROFILE%', '\\\\SERVIDOR\\Caja'];
  for (const nombre of nombres) {
    const tmp = tmpPropio();
    const { spawn, llamadas } = falsoSpawn();
    const r = await imprimirRaw({ bytes: BYTES, impresora: nombre, plataforma: 'win32', spawn, tmp, env: { SystemRoot: 'C:\\Windows' } });
    assert.deepEqual(r, { simulado: false });
    assert.equal(llamadas.length, 1);
    const { cmd, args, opciones } = llamadas[0];
    assert.equal(cmd, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.equal(opciones.shell, false, 'nunca a través de un shell');
    assert.equal(opciones.windowsHide, true);
    assert.deepEqual(args.slice(0, 6), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_RAW]);
    assert.equal(args.length, 10);
    assert.equal(args[6], '-Impresora');
    assert.equal(args[7], nombre, 'el nombre llega ENTERO y sin tocar, como un solo argumento');
    assert.equal(args[8], '-Archivo');
    assert.ok(!args.includes('-Command') && !args.includes('-EncodedCommand'), 'nada de -Command');
    assert.ok(args.every((a) => typeof a === 'string'));
    assert.equal(hashPs1(), antes, 'el script no se escribe ni se regenera con datos');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('el .bin va a un archivo temporal de nombre aleatorio con los bytes exactos, y se borra siempre', async () => {
  const tmp = tmpPropio();
  const { spawn, llamadas } = falsoSpawn();
  await imprimirRaw({ bytes: BYTES, impresora: 'POS-80', plataforma: 'win32', spawn, tmp });
  const archivo = llamadas[0].args[9];
  assert.equal(path.dirname(archivo), tmp);
  assert.match(path.basename(archivo), /^resplandor-[0-9a-f]{16}\.bin$/, 'el nombre no sale de ningún dato del trabajo');
  assert.equal(llamadas[0].archivoExistia, true);
  assert.deepEqual(llamadas[0].bytes, BYTES);
  assert.equal(fs.existsSync(archivo), false, 'borrado al terminar');

  const { spawn: spawnMalo } = falsoSpawn(() => ({ codigo: 3, errores: 'No se pudo abrir la impresora (Win32:1801)' }));
  await assert.rejects(imprimirRaw({ bytes: BYTES, impresora: 'POS-80', plataforma: 'win32', spawn: spawnMalo, tmp }), ErrorImpresion);
  assert.deepEqual(fs.readdirSync(tmp), [], 'tampoco queda nada si falla');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('nombres de impresora que podrían leerse como otro parámetro o romper el argumento se rechazan antes de lanzar nada', async () => {
  for (const mal of ['', '   ', '-Archivo', ' -Impresora', '"; calc; "', 'a"b', 'uno\ndos', 'a\x00b', 'x'.repeat(201), null, undefined, 42]) {
    const { spawn, llamadas } = falsoSpawn();
    await assert.rejects(imprimirRaw({ bytes: BYTES, impresora: mal, plataforma: 'win32', spawn, tmp: tmpPropio() }), (e) => e instanceof ErrorImpresion && /nombre de la impresora/.test(e.message), JSON.stringify(mal));
    assert.equal(llamadas.length, 0, `no se lanzó PowerShell con ${JSON.stringify(mal)}`);
    assert.notEqual(validarNombreImpresora(mal), null);
  }
  for (const bien of ['POS-80', 'EPSON TM-T20II Receipt', 'Generic / Text Only', 'Épson ñ']) assert.equal(validarNombreImpresora(bien), null, bien);
});

test('los códigos de Windows se traducen a qué hacer, en español', async () => {
  const caso = async (errores, codigo = 3) => {
    const { spawn } = falsoSpawn(() => ({ codigo, errores }));
    return imprimirRaw({ bytes: BYTES, impresora: 'POS-80', plataforma: 'win32', spawn, tmp: tmpPropio() }).catch((e) => e);
  };
  const noExiste = await caso('Exception calling "Enviar" with "3" argument(s): "No se pudo abrir la impresora (Win32:1801)"');
  assert.ok(noExiste instanceof ErrorImpresion);
  assert.match(noExiste.message, /no conoce una impresora con ese nombre.*--impresoras.*config\.json/s);
  assert.equal(noExiste.codigo, 3);
  assert.match((await caso('No se pudo iniciar el documento RAW (Win32:1804)')).message, /no acepta datos RAW.*Generic \/ Text Only/s);
  assert.match((await caso('No se pudo abrir la impresora (Win32:5)')).message, /negó el acceso/);
  assert.match((await caso('File imprimir-raw.ps1 cannot be loaded. The file is not digitally signed. ExecutionPolicy', 1)).message, /política de ejecución/);
  assert.match((await caso('No existe el archivo a imprimir.', 2)).message, /No existe el archivo/);
  assert.match((await caso('', 9)).message, /código 9/);
});

test('PowerShell ausente, que no responde (se mata) o que no se puede lanzar: mensajes claros', async () => {
  const ausente = falsoSpawn(() => ({ error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) }));
  await assert.rejects(imprimirRaw({ bytes: BYTES, impresora: 'POS-80', plataforma: 'win32', spawn: ausente.spawn, tmp: tmpPropio() }), /No encuentro PowerShell/);

  const colgado = falsoSpawn(() => ({ colgar: true }));
  await assert.rejects(imprimirRaw({ bytes: BYTES, impresora: 'POS-80', plataforma: 'win32', spawn: colgado.spawn, tmp: tmpPropio(), tiempoMs: 30 }), /no respondió en 0 s|no respondió/);
  assert.equal(colgado.llamadas[0].hijo.matado, true, 'el proceso colgado se mata');

  const revienta = () => { throw new Error('EPERM'); };
  await assert.rejects(imprimirRaw({ bytes: BYTES, impresora: 'POS-80', plataforma: 'win32', spawn: revienta, tmp: tmpPropio() }), /No se pudo lanzar PowerShell: EPERM/);
});

test('fuera de Windows se niega con un mensaje claro (sin --simular el agente no finge imprimir)', async () => {
  for (const plataforma of ['darwin', 'linux']) {
    const { spawn, llamadas } = falsoSpawn();
    await assert.rejects(imprimirRaw({ bytes: BYTES, impresora: 'POS-80', plataforma, spawn }), /solo en Windows.*--simular/s);
    assert.equal(llamadas.length, 0);
  }
});

test('--simular escribe el .bin idéntico y su vista de texto, sin lanzar ningún proceso', async () => {
  const carpeta = path.join(tmpPropio(), 'salida');
  const { spawn, llamadas } = falsoSpawn();
  const r = await imprimirRaw({ bytes: BYTES, impresora: '', simular: true, carpetaSalida: carpeta, columnas: 32, plataforma: 'darwin', spawn });
  assert.equal(r.simulado, true);
  assert.equal(llamadas.length, 0);
  assert.deepEqual(fs.readFileSync(r.ruta), BYTES);
  assert.equal(fs.readFileSync(r.ruta.replace(/\.bin$/, '.txt'), 'utf8'), bytesATexto(BYTES, { columnas: 32 }));
  assert.match(fs.readFileSync(r.ruta.replace(/\.bin$/, '.txt'), 'utf8'), /Café/);
  const otra = await simularImpresion({ bytes: BYTES, carpetaSalida: carpeta });
  assert.notEqual(otra.ruta, r.ruta, 'dos impresiones, dos archivos');
});

// ───────────────────────── 3. --impresoras ─────────────────────────

test('--impresoras: un -Command FIJO (sin datos del usuario) y se entiende una lista, un solo objeto y el BOM', async () => {
  const lista = JSON.stringify([{ Name: 'POS-80', DriverName: 'Generic / Text Only', PortName: 'USB001', Default: false }, { Name: 'Microsoft Print to PDF', DriverName: 'Microsoft Print To PDF', PortName: 'PORTPROMPT:', Default: true }]);
  const { spawn, llamadas } = falsoSpawn(() => ({ salida: '\uFEFF' + lista }));
  const r = await listarImpresoras({ plataforma: 'win32', spawn, env: { SystemRoot: 'C:\\Windows' } });
  assert.deepEqual(r, [
    { nombre: 'POS-80', driver: 'Generic / Text Only', puerto: 'USB001', predeterminada: false },
    { nombre: 'Microsoft Print to PDF', driver: 'Microsoft Print To PDF', puerto: 'PORTPROMPT:', predeterminada: true },
  ]);
  const { args, opciones } = llamadas[0];
  assert.equal(opciones.shell, false);
  assert.equal(args[args.indexOf('-Command') + 1], args.at(-1), 'el texto del comando es el último argumento');
  assert.match(args.at(-1), /^\[Console\]::OutputEncoding = \[System\.Text\.Encoding\]::UTF8; Get-CimInstance -ClassName Win32_Printer \| Select-Object Name, DriverName, PortName, Default \| ConvertTo-Json -Compress$/);
  assert.deepEqual(interpretarListado(JSON.stringify({ Name: 'Única', DriverName: 'd', PortName: 'p', Default: true })), [{ nombre: 'Única', driver: 'd', puerto: 'p', predeterminada: true }]);
  assert.deepEqual(interpretarListado(''), []);
  assert.throws(() => interpretarListado('no es json'), /No entendí la lista/);
  await assert.rejects(listarImpresoras({ plataforma: 'linux', spawn }), /no es Windows/);
});

test('formatearImpresoras da el nombre exacto para copiar, el driver y el puerto', () => {
  const t = formatearImpresoras([{ nombre: 'POS-80', driver: 'Generic / Text Only', puerto: 'USB001', predeterminada: true }]);
  assert.match(t, /copia el NOMBRE exacto en config\.json → "impresora"/);
  assert.match(t, /Nombre:  POS-80   \(predeterminada\)/);
  assert.match(t, /Driver:  Generic \/ Text Only/);
  assert.match(t, /Puerto:  USB001/);
  assert.match(formatearImpresoras([]), /ninguna impresora instalada/);
});

test('rutaPowerShell usa SystemRoot (o windir, o C:\\Windows) y la ruta completa de Windows PowerShell 5.1', () => {
  assert.equal(rutaPowerShell({ SystemRoot: 'D:\\WINNT' }), 'D:\\WINNT\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(rutaPowerShell({ windir: 'E:\\W' }), 'E:\\W\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(rutaPowerShell({}), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
});

// ───────────────────────── 4. lo que Yonatan corre con doble clic ─────────────────────────

const CARPETA = path.join(RAIZ, 'impresora');
const leerCarpeta = (f) => fs.readFileSync(path.join(CARPETA, f));

test('iniciar.cmd: CRLF de punta a punta (un .cmd con LF suelto falla en los goto), ASCII, y no reintenta si el config está mal', () => {
  const crudo = leerCarpeta('iniciar.cmd');
  assert.equal(crudo.includes(Buffer.from('\r\n')), true);
  assert.equal(crudo.toString('latin1').replace(/\r\n/g, '').includes('\n'), false, 'ningún salto de línea sin su \\r');
  assert.equal([...crudo].some((b) => b > 0x7e), false, 'ASCII: la consola de Windows lee mal las tildes de un .cmd');
  const cmd = crudo.toString('latin1');
  assert.match(cmd, /chcp 65001 >nul/);
  assert.match(cmd, /cd \/d "%~dp0"/, 'se ejecuta desde su carpeta aunque lo abra un acceso directo');
  assert.match(cmd, /where node >nul 2>nul\r\nif errorlevel 1 \(/, 'avisa si falta Node en vez de cerrarse');
  assert.match(cmd, /node agente\.mjs %\*/);
  const salida2 = cmd.indexOf('if "%CODIGO%"=="2"');
  assert.ok(salida2 > 0 && salida2 < cmd.indexOf('goto inicio'), 'el código 2 (config mal) sale ANTES del goto que reintenta');
  assert.match(cmd, /if "%CODIGO%"=="0" exit \/b 0/);
  assert.match(cmd, /timeout \/t 10 \/nobreak/);
  assert.match(fs.readFileSync(path.join(CARPETA, '.gitattributes'), 'utf8'), /^\*\.cmd -text$/m, 'Git no le cambia los saltos de línea');
});

test('instalar.ps1: ASCII, pregunta antes de cada cosa y solo toca lo que dice (acceso directo de inicio, config.json, ahorro de energía)', () => {
  const crudo = leerCarpeta('instalar.ps1');
  assert.equal([...crudo].some((b) => b > 0x7e || (b < 0x20 && ![9, 10, 13].includes(b))), false);
  const ps = crudo.toString('utf8');
  const { codigo } = partesPs1(ps);
  for (const re of [/Invoke-WebRequest|Invoke-RestMethod|WebClient|DownloadString|DownloadFile|\bcurl\b|\bwget\b/i, /Invoke-Expression|\biex\b/i, /Set-ExecutionPolicy/i,
    /New-ItemProperty|Set-ItemProperty|HKLM|HKCU|reg\s+add/i, /netsh|New-NetFirewallRule|Set-NetFirewall/i, /Set-Service|sc\.exe|schtasks|Register-ScheduledTask/i, /-Verb\s+RunAs/i]) {
    assert.doesNotMatch(codigo, re, `instalar.ps1 no debe usar ${re}`);
  }
  assert.equal((codigo.match(/Preguntar '/g) ?? []).length, 3, 'config, arranque y energía se preguntan');
  assert.match(codigo, /param\(\[switch\] \$Quitar\)/);
  assert.match(codigo, /Remove-Item -LiteralPath \$acceso\b/, 'quitar borra solo el acceso directo');
  assert.equal((codigo.match(/Remove-Item/g) ?? []).length, 1);
  assert.match(codigo, /\$mayor -lt 22/, 'exige Node 22');
  assert.match(codigo, /powercfg \/change standby-timeout-ac 0/);
  assert.match(codigo, /powercfg \/change hibernate-timeout-ac 0/);
  assert.match(codigo, /GetFolderPath\('Startup'\)/, 'la carpeta shell:startup, no una ruta a mano');
  assert.match(codigo, /\$lnk\.TargetPath = \(Join-Path \$carpeta 'iniciar\.cmd'\)/);
});

test('el README cubre todas las claves del config de ejemplo y los mensajes que de verdad salen del agente', () => {
  const readme = leerCarpeta('README-impresora.md').toString('utf8');
  const ejemplo = JSON.parse(leerCarpeta('config.ejemplo.json').toString('utf8'));
  for (const clave of Object.keys(ejemplo).filter((k) => !k.startsWith('_'))) assert.ok(readme.includes(clave), `el README no menciona «${clave}»`);
  const fuentes = ['agente.mjs', 'cola.mjs', 'cliente-supabase.mjs', 'imprimir-windows.mjs', 'config.mjs'].map((f) => leerCarpeta(f).toString('utf8')).join('\n');
  for (const frase of ['No puedo arrancar: hay que arreglar config.json', 'La base no reconoce este token', 'La base no tiene la función', 'Windows no conoce una impresora con ese nombre', 'Caducó: llevaba', 'rechazó la clave publicable', 'Señal en tiempo real conectada']) {
    assert.ok(fuentes.includes(frase), `el código ya no dice «${frase}»`);
  }
  for (const frase of ['No puedo arrancar: hay que arreglar config.json', 'La base no reconoce este token', 'La base no tiene la función impresora_tomar', 'Windows no conoce una impresora con ese nombre', 'Caducó: llevaba N min', 'Supabase rechazó la clave publicable', 'Señal en tiempo real conectada']) {
    assert.ok(readme.includes(frase), `el README no explica «${frase}»`);
  }
  for (const opcion of ['--impresoras', '--prueba', '--simular', '--vista-previa', 'iniciar.cmd', 'instalar.ps1', 'shell:startup', 'Suspensión selectiva de USB']) assert.ok(readme.includes(opcion), opcion);
  assert.match(readme, /Frente a la propuesta con Tailscale/);
});

test('la carpeta del agente no trae secretos ni dependencias: sin node_modules, sin config.json, sin tokens ni claves reales', () => {
  const todos = [];
  const recorrer = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) recorrer(p); else todos.push(p); } };
  recorrer(CARPETA);
  const nombres = todos.map((p) => path.relative(CARPETA, p).split(path.sep).join('/'));
  assert.ok(!nombres.some((n) => n.startsWith('node_modules/') || n === 'package.json'), 'sin npm: se copia la carpeta y se corre');
  assert.ok(!nombres.includes('config.json'), 'config.json (con el token) no va al repo');
  for (const p of todos) {
    if (!/\.(mjs|md|json|ps1|cmd)$/.test(p) && !p.endsWith('.gitignore') && !p.endsWith('.gitattributes')) continue;
    const t = fs.readFileSync(p, 'utf8');
    assert.doesNotMatch(t, /sb_secret_[A-Za-z0-9]{10}|sb_publishable_[A-Za-z0-9]{20}|eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20}|lccgehvyymladqvumcez/, `${path.relative(RAIZ, p)} lleva una clave o el proyecto real`);
    assert.doesNotMatch(t, /\balert\(|\bconfirm\(|cdn\.|unpkg|jsdelivr/, `${path.relative(RAIZ, p)}`);
  }
  for (const p of todos.filter((f) => f.endsWith('.mjs'))) {
    const imports = [...fs.readFileSync(p, 'utf8').matchAll(/^\s*import\s[^'"\n]*from\s+'([^']+)'|^\s*import\s+'([^']+)'/gm)].map((m) => m[1] ?? m[2]);
    for (const i of imports) assert.ok(i.startsWith('node:') || i.startsWith('./') || i.startsWith('../'), `${path.relative(RAIZ, p)} importa «${i}»: el agente no usa paquetes de npm`);
  }
});
