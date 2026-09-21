# Deriva os arquivos de marca do Prisma das artes que o usuário desenha.
# Rodar com:
#
#   powershell -File build\make-art.ps1
#
# ENTRADA — o usuário larga as artes aqui, e o script NUNCA escreve nelas:
#   resources\icon.png   o tile do app, QUADRADO (hoje 192x192). Já vem com
#                        a margem embutida pelo designer (a arte ocupa ~82%
#                        do quadrado), por isso o script só redimensiona:
#                        recortar/recentralizar estragaria o espaçamento.
#   resources\iconName.png  o lettering "PRISM" + o símbolo, branco sobre
#                        transparente (hoje 251x54). Só serve em fundo
#                        escuro; um tema claro precisaria de outra variante.
#
#   A pasta installer\assets\ inteira é DESENHADA À MÃO e não passa por
#   aqui — nem o banner, nem a imagem pequena. O script só confere as
#   dimensões das duas e avisa se estiverem fora do que o Inno espera.
#
#   (O installer_small.png já foi gerado a partir do tile, até 2026-09-08.
#   Saiu do gerador porque o usuário quer a margem transparente própria
#   dele em volta do tile, que a cópia direta do resources\icon.png —
#   full-bleed — não tem.)
#
# SAÍDA (gerada; não editar à mão, editar a fonte e rodar de novo):
#   build\icon.ico                        16/24/32/48/64/128 em DIB + 256 PNG
#   build\icon.png                        256x256
#   build\icon.icns                       10 entradas, 16 a 1024 (só macOS)
#   src\renderer\src\assets\logo.png      cópia do tile — usado dentro do app
#   src\renderer\src\assets\iconName.png  cópia do lettering — titlebar e
#                                         telas de login/cadastro
#
# resources\icon.png não precisa ser gerado nem copiado: o processo main o
# importa direto (`../../resources/icon.png?asset`, ver src\main\index.ts).
#
# Usa System.Drawing (.NET) porque o projeto não tem sharp/ImageMagick e não
# valia puxar uma dependência só pra isso.

Add-Type -AssemblyName System.Drawing

# Raiz do projeto = a pasta acima desta (build\).
$root = Split-Path -Parent $PSScriptRoot
$iconSrc = Join-Path $root 'resources\icon.png'
$nameSrc = Join-Path $root 'resources\iconName.png'

# Carrega via MemoryStream, e não FromFile, pra não deixar handle aberto.
function Read-Img([string]$path) {
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $ms = New-Object System.IO.MemoryStream(,$bytes)
  return [System.Drawing.Bitmap]::FromStream($ms)
}

function Resize-Img([System.Drawing.Image]$img, [int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bmp.SetResolution(96, 96)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.DrawImage($img, 0, 0, [float]$size, [float]$size)
  $g.Dispose()
  return $bmp
}

# O `,` antes do valor de retorno é obrigatório: sem ele o PowerShell
# desmonta o byte[] no pipeline e quem chama recebe um Object[], que o
# BinaryWriter.Write() não aceita como buffer.
function Get-PngBytes([System.Drawing.Bitmap]$bmp) {
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  return ,$ms.ToArray()
}

# XOR (BGRA, linhas de baixo pra cima) + máscara AND 1bpp zerada, precedidos
# do BITMAPINFOHEADER — o formato "clássico" de entrada de .ico. Só o 256 vai
# em PNG (é o que todo gerador faz); os menores em DIB, que qualquer coisa lê.
function Get-DibBytes([System.Drawing.Bitmap]$bmp) {
  $w = $bmp.Width; $h = $bmp.Height
  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = $data.Stride
  $all = New-Object byte[] ($stride * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $all, 0, $all.Length)
  $bmp.UnlockBits($data)

  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($ms)
  $bw.Write([int]40)        # biSize
  $bw.Write([int]$w)        # biWidth
  $bw.Write([int]($h * 2))  # biHeight (XOR + AND)
  $bw.Write([int16]1)       # biPlanes
  $bw.Write([int16]32)      # biBitCount
  $bw.Write([int]0)         # biCompression = BI_RGB
  $bw.Write([int]0)         # biSizeImage
  $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0)

  for ($y = $h - 1; $y -ge 0; $y--) { $bw.Write($all, $y * $stride, $w * 4) }

  # Máscara toda zerada: com 32bpp quem manda é o canal alfa do XOR.
  $maskStride = [int]([Math]::Floor(($w + 31) / 32) * 4)
  $maskRow = New-Object byte[] $maskStride
  for ($y = 0; $y -lt $h; $y++) { $bw.Write($maskRow, 0, $maskStride) }

  $bw.Flush()
  return ,$ms.ToArray()
}

$icon = Read-Img $iconSrc
Write-Output ("tile: {0}x{1}" -f $icon.Width, $icon.Height)
if ($icon.Width -ne $icon.Height) {
  Write-Warning ("resources\icon.png NAO e quadrado ({0}x{1}) — vai sair distorcido." -f $icon.Width, $icon.Height)
}
if ($icon.Width -lt 256) {
  Write-Warning ("resources\icon.png tem so {0}px; o .ico precisa de uma entrada 256 e o excesso e ampliado (fica levemente macio). Uma arte de 512 ou 1024 resolveria." -f $icon.Width)
}

# --- cópias diretas -----------------------------------------------------
Copy-Item $iconSrc (Join-Path $root 'src\renderer\src\assets\logo.png') -Force
Copy-Item $nameSrc (Join-Path $root 'src\renderer\src\assets\iconName.png') -Force
Write-Output 'copias (logo.png, iconName.png): OK'

# --- .png de 256 --------------------------------------------------------
$out256 = Resize-Img $icon 256
[System.IO.File]::WriteAllBytes((Join-Path $root 'build\icon.png'), (Get-PngBytes $out256))
Write-Output 'build\icon.png: OK'

# --- .ico ---------------------------------------------------------------
$entries = @()
foreach ($s in @(16, 24, 32, 48, 64, 128)) {
  $b = Resize-Img $icon $s
  $entries += [pscustomobject]@{ Size = $s; Data = (Get-DibBytes $b) }
  $b.Dispose()
}
$entries += [pscustomobject]@{ Size = 256; Data = (Get-PngBytes $out256) }

$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([int16]0); $bw.Write([int16]1); $bw.Write([int16]$entries.Count)
$offset = 6 + (16 * $entries.Count)
foreach ($e in $entries) {
  # 256 se escreve como 0 no ICONDIRENTRY (o campo tem 1 byte só).
  $dim = if ($e.Size -ge 256) { 0 } else { $e.Size }
  $bw.Write([byte]$dim); $bw.Write([byte]$dim)
  $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([int16]1); $bw.Write([int16]32)
  $bw.Write([int]$e.Data.Length)
  $bw.Write([int]$offset)
  $offset += $e.Data.Length
}
foreach ($e in $entries) { $bw.Write([byte[]]$e.Data) }
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $root 'build\icon.ico'), $ms.ToArray())
Write-Output ("build\icon.ico: {0} entradas, {1} bytes" -f $entries.Count, $ms.Length)

# --- .icns (só importa se um dia sair build pra macOS) ------------------
function Write-Be([System.IO.BinaryWriter]$w, [int]$v) {
  $b = [System.BitConverter]::GetBytes($v); [Array]::Reverse($b); $w.Write($b)
}
# Tamanhos repetidos de propósito: ic13/ic08 e ic14/ic09 são o mesmo número
# de pixels servindo de @2x de um tamanho menor.
$icnsTypes = @(
  @('icp4', 16), @('icp5', 32), @('ic11', 32), @('ic12', 64),
  @('ic07', 128), @('ic13', 256), @('ic08', 256), @('ic14', 512), @('ic09', 512), @('ic10', 1024)
)
$body = New-Object System.IO.MemoryStream
$bwb = New-Object System.IO.BinaryWriter($body)
foreach ($t in $icnsTypes) {
  $bm = Resize-Img $icon $t[1]
  $png = Get-PngBytes $bm
  $bm.Dispose()
  $bwb.Write([System.Text.Encoding]::ASCII.GetBytes($t[0]))
  Write-Be $bwb ($png.Length + 8)
  $bwb.Write([byte[]]$png)
}
$bwb.Flush()
$bodyBytes = $body.ToArray()
$icns = New-Object System.IO.MemoryStream
$bwi = New-Object System.IO.BinaryWriter($icns)
$bwi.Write([System.Text.Encoding]::ASCII.GetBytes('icns'))
Write-Be $bwi ($bodyBytes.Length + 8)
$bwi.Write([byte[]]$bodyBytes)
$bwi.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $root 'build\icon.icns'), $icns.ToArray())
Write-Output ("build\icon.icns: {0} bytes" -f $icns.Length)

$out256.Dispose(); $icon.Dispose()

# --- conferência das artes do wizard (não são geradas, só validadas) ----
# As duas são desenhadas à mão. O script não escreve nelas; só avisa se as
# dimensões forem esticar a arte, porque o Inno redimensiona sem preservar
# proporção nenhuma e o estrago passa despercebido até alguém abrir o
# instalador.
$bannerPath = Join-Path $root 'installer\assets\installer_banner.png'
if (Test-Path $bannerPath) {
  # 164:314 é o tamanho base do Inno pra imagem grande (ver
  # WizClassicImage.bmp na pasta do Inno Setup).
  $bn = Read-Img $bannerPath
  $want = [int][Math]::Round($bn.Height * 164.0 / 314.0)
  if ([Math]::Abs($bn.Width - $want) -le 2) {
    Write-Output ("banner (desenhado a mao): {0}x{1} — proporcao 164:314 OK" -f $bn.Width, $bn.Height)
  } else {
    Write-Warning ("banner {0}x{1} fora da proporcao 164:314 — pra essa altura o certo seria {2}px de largura. O Inno vai esticar." -f $bn.Width, $bn.Height, $want)
  }
  $bn.Dispose()
} else {
  Write-Warning 'installer\assets\installer_banner.png nao existe.'
}

$smallPath = Join-Path $root 'installer\assets\installer_small.png'
if (Test-Path $smallPath) {
  # A área da imagem pequena é quadrada (58x58 no Inno atual; era 55x55
  # até a 6.6.0). A margem transparente em volta do tile é intencional,
  # pedido do usuário — é o que dá respiro no canto do wizard.
  $sm = Read-Img $smallPath
  if ($sm.Width -eq $sm.Height) {
    Write-Output ("small (desenhado a mao): {0}x{1} — quadrado OK" -f $sm.Width, $sm.Height)
  } else {
    Write-Warning ("small {0}x{1} nao e quadrado — a area do Inno e 58x58, entao a arte vai sair espremida." -f $sm.Width, $sm.Height)
  }
  $sm.Dispose()
} else {
  Write-Warning 'installer\assets\installer_small.png nao existe.'
}

Write-Output 'FIM'
