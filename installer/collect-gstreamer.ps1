# Monta installer\gstreamer\ com o MINIMO do GStreamer que o Prisma usa.
#
# ---------------------------------------------------------------------
# POR QUE ISTO EXISTE
#
# Ate 2026-09-18 o instalador BAIXAVA o GStreamer completo de
# gstreamer.freedesktop.org: 528 MB de download e 2,1 GB em disco, pra
# usar 12 elementos. Alem do exagero, era a parte mais fragil da
# instalacao: meio gigabyte vindo da Europa no meio do processo, e
# qualquer oscilacao de rede entregava um arquivo truncado — o hash nao
# batia e a instalacao morria ali (aconteceu com um usuario real em
# 2026-09-17).
#
# Empacotando so o necessario, o download some e sobram ~35 MB.
#
# ---------------------------------------------------------------------
# COMO O CONJUNTO E DECIDIDO
#
# Duas fontes, e a segunda e a que nao se descobre lendo codigo:
#
#   1. FECHO DE IMPORTS. A partir dos plugins que fornecem os elementos
#      do pipeline, segue as dependencias com `dumpbin /dependents`,
#      recursivamente, ficando so no que vem do proprio GStreamer.
#
#   2. ELEMENTOS CRIADOS POR NOME EM TEMPO DE EXECUCAO. Import table NAO
#      captura isso. O `whipsink` monta um `webrtcbin` dentro dele, que
#      por sua vez instancia rtpbin, ICE, DTLS, SRTP e SCTP — nenhum
#      deles aparece como dependencia de ninguem. Estao na lista
#      RUNTIME_PLUGINS abaixo, na mao, e e por isso que ela existe.
#
# ⚠️ Elemento novo no pipeline (gstreamerCapture.ts) = conferir se o
# plugin dele entra aqui. Sem isso a transmissao quebra SO na maquina de
# quem instalou, nunca na de quem desenvolve — que ainda tem o GStreamer
# completo instalado.
#
# Uso:  powershell -ExecutionPolicy Bypass -File installer\collect-gstreamer.ps1

$ErrorActionPreference = 'Stop'

# --- Onde esta o GStreamer completo -------------------------------------

# O @( ) por fora importa (2026-10-20): com UM candidato so, o
# Where-Object devolve a string sozinha, e `$candidatos[0]` vira o
# primeiro CARACTERE dela ("C") — o script apagava installer\gstreamer e
# nao copiava nada.
$candidatos = @(@(
    $env:GSTREAMER_1_0_ROOT_MSVC_X86_64,
    'C:\Program Files\gstreamer\1.0\msvc_x86_64',
    'D:\Program Files\gstreamer\1.0\msvc_x86_64'
) | Where-Object { $_ -and (Test-Path (Join-Path $_ 'bin')) })

if ($candidatos.Count -eq 0) {
    throw "GStreamer nao encontrado. Instale o gstreamer-1.0-msvc-x86_64 (a versao do GstreamerVersion em prisma.iss) e rode de novo."
}
$origem = $candidatos[0]

# --- dumpbin (vem com o Visual Studio) ----------------------------------

$dumpbin = Get-ChildItem 'C:\Program Files*\Microsoft Visual Studio\*\*\VC\Tools\MSVC\*\bin\Hostx64\x64\dumpbin.exe' -ErrorAction SilentlyContinue |
           Sort-Object FullName | Select-Object -Last 1
if (-not $dumpbin) { throw "dumpbin.exe nao encontrado (vem com o Visual Studio / Build Tools)." }

$destino = Join-Path $PSScriptRoot 'gstreamer'
$binOrigem  = Join-Path $origem 'bin'
$plugOrigem = Join-Path $origem 'lib\gstreamer-1.0'

Write-Host ""
Write-Host "  origem  : $origem"
Write-Host "  dumpbin : $($dumpbin.FullName)"
Write-Host ""

# --- O que o pipeline usa -----------------------------------------------

# Um plugin por elemento do pipeline (ver buildArgs em gstreamerCapture.ts).
$PIPELINE_PLUGINS = @(
    'gstd3d11.dll'            # d3d11screencapturesrc, d3d11convert
    'gstmediafoundation.dll'  # mfh264enc
    'gstvideoparsersbad.dll'  # h264parse
    'gstrtp.dll'              # rtph264pay, rtpopuspay
    'gstcoreelements.dll'     # queue
    'gstwasapi2.dll'          # wasapi2src
    'gstaudioconvert.dll'     # audioconvert
    'gstaudioresample.dll'    # audioresample
    'gstopus.dll'             # opusenc
    'gstwebrtchttp.dll'       # whipsink
    # Webcam (2026-10-20): o mfvideosrc vem no gstmediafoundation, acima.
    # Este e o jpegdec, pra webcam USB que so entrega 1080p30 em MJPEG.
    # A conversao dele pro encoder e o d3d11upload/d3d11convert (gstd3d11).
    'gstjpeg.dll'             # jpegdec
)

# ⚠️ NAO APARECEM EM IMPORT TABLE NENHUMA. O whipsink cria um webrtcbin
# por nome, e o webrtcbin instancia esta turma toda. Sem eles o pipeline
# monta e morre na hora de negociar.
$RUNTIME_PLUGINS = @(
    'gstwebrtc.dll'       # webrtcbin
    'gstrtpmanager.dll'   # rtpbin, rtpjitterbuffer, rtpfunnel
    'gstnice.dll'         # ICE (libnice)
    'gstdtls.dll'         # DTLS  -> puxa o OpenSSL
    'gstsrtp.dll'         # SRTP
    'gstsctp.dll'         # data channel do webrtcbin
)

# Margem de seguranca: barato e evita uma classe de falha chata. O
# typefind e pedido pelo nucleo em varios caminhos de negociacao.
$MARGEM_PLUGINS = @(
    'gsttypefindfunctions.dll'
)

$plugins = $PIPELINE_PLUGINS + $RUNTIME_PLUGINS + $MARGEM_PLUGINS

# --- Fecho transitivo de imports ----------------------------------------

$visitados = New-Object 'System.Collections.Generic.HashSet[string]'
$paraCopiar = New-Object 'System.Collections.Generic.List[object]'
$fila = New-Object 'System.Collections.Generic.Queue[object]'

function Enfileirar($caminho, $subpasta) {
    if (Test-Path $caminho) { $fila.Enqueue([pscustomobject]@{ Path = $caminho; Sub = $subpasta }) }
}

foreach ($p in $plugins) { Enfileirar (Join-Path $plugOrigem $p) 'lib\gstreamer-1.0' }

# O app executa o gst-launch como PROCESSO; ele vai junto, com as
# dependencias dele. O plugin-scanner e o ajudante que o GStreamer chama
# pra indexar plugins.
Enfileirar (Join-Path $binOrigem 'gst-launch-1.0.exe') 'bin'
Enfileirar (Join-Path $origem 'libexec\gstreamer-1.0\gst-plugin-scanner.exe') 'libexec\gstreamer-1.0'

# Modulos do GIO: carregados POR CAMINHO, nunca por import.
foreach ($m in @('gioopenssl.dll', 'giolibproxy.dll')) {
    Enfileirar (Join-Path $origem "lib\gio\modules\$m") 'lib\gio\modules'
}

while ($fila.Count -gt 0) {
    $item = $fila.Dequeue()
    $nome = Split-Path $item.Path -Leaf
    if (-not $visitados.Add($nome.ToLower())) { continue }

    $paraCopiar.Add($item)

    $saida = & $dumpbin.FullName /nologo /dependents $item.Path 2>$null
    foreach ($linha in $saida) {
        if ($linha -match '^\s{4}([A-Za-z0-9_.+-]+\.dll)\s*$') {
            $dep = $Matches[1]
            # Só o que vem do GStreamer — DLL do Windows fica de fora.
            $caminhoDep = Join-Path $binOrigem $dep
            if (Test-Path $caminhoDep) { Enfileirar $caminhoDep 'bin' }
        }
    }
}

# --- Copia --------------------------------------------------------------

if (Test-Path $destino) { Remove-Item $destino -Recurse -Force }

$total = 0
foreach ($item in $paraCopiar) {
    $pasta = Join-Path $destino $item.Sub
    New-Item -ItemType Directory -Force -Path $pasta | Out-Null
    Copy-Item $item.Path -Destination $pasta -Force
    $total += (Get-Item $item.Path).Length
}

# Quantos por pasta, pro resumo.
$porPasta = $paraCopiar | Group-Object Sub | Sort-Object Name

Write-Host "  Conjunto montado em installer\gstreamer" -ForegroundColor Green
Write-Host "  ---------------------------------------------------------"
foreach ($g in $porPasta) {
    "  {0,-26} {1,3} arquivo(s)" -f $g.Name, $g.Count | Write-Host
}
Write-Host "  ---------------------------------------------------------"
"  TOTAL {0} arquivos, {1:N1} MB" -f $paraCopiar.Count, ($total / 1MB) | Write-Host
Write-Host ""
Write-Host "  Conferir se nao falta nada: rodar uma transmissao numa maquina" -ForegroundColor Yellow
Write-Host "  SEM o GStreamer instalado. E o unico teste que prova o conjunto." -ForegroundColor Yellow
Write-Host ""
