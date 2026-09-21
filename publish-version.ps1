# Passo 9 do RELEASE.md — publicar a versão nova no servidor do Prisma.
#
# Existe porque o comando que estava no RELEASE.md era bash puro
# ($(...), aspas simples no JSON, jq) e não roda no PowerShell, que é
# onde as releases são feitas nesta máquina.
#
# Sem argumentos ele já faz a coisa certa: lê a versão do package.json e
# calcula o SHA-256 do instalador que está em installer\output. Os dois
# podem ser passados na mão se precisar republicar algo antigo.
#
#   .\publish-version.ps1
#   .\publish-version.ps1 -Version 1.0.2
#   .\publish-version.ps1 -Version 1.0.2 -Sha256 39d43e...
#
# A senha é pedida na hora, com Read-Host -AsSecureString: não fica no
# histórico do terminal nem num arquivo.

[CmdletBinding()]
param(
  [string]$Version,
  [string]$Sha256,
  [string]$User,
  # Só muda quem trocar de domínio. A porta 5000 não é publicada pelo
  # compose desde o item 15 do ROADMAP — a API só atende por aqui.
  [string]$ApiBaseUrl = 'https://prisma-site.com.br'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$installer = Join-Path $root 'installer\output\Prisma-Setup.exe'

if (-not $Version) {
  $pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
  $Version = $pkg.version
  Write-Host "versão (do package.json): $Version"
}

if (-not $Sha256) {
  if (-not (Test-Path $installer)) {
    throw "Não achei $installer — compile e assine o instalador antes (passos 6 e 7)."
  }
  # Minúsculo porque é assim que o app compara o hash do arquivo baixado.
  $Sha256 = (Get-FileHash $installer -Algorithm SHA256).Hash.ToLower()
  Write-Host "sha256 (do instalador): $Sha256"

  # O hash tem que ser do arquivo JÁ ASSINADO: assinar reescreve os bytes.
  # Um instalador sem assinatura aqui quase certamente significa que o
  # passo 7 foi esquecido, e o hash publicado seria de um arquivo que não
  # é o que está no ar.
  $sig = Get-AuthenticodeSignature $installer
  if ($sig.Status -ne 'Valid') {
    throw "O instalador não está assinado ($($sig.Status)). Faça o passo 7 antes — assinar muda os bytes e o hash."
  }
}

if (-not $User) { $User = Read-Host 'Usuário do app' }
$secure = Read-Host "Senha de $User" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

function Show-ApiError($err) {
  # No PowerShell 5.1 o corpo da resposta de um 4xx não vem no $_ — tem
  # que ser lido do stream, senão a mensagem do servidor ("Usuário não
  # encontrado", "sha256 deve ser hexadecimal...") se perde e sobra só
  # "(400) Bad Request".
  try {
    $reader = New-Object IO.StreamReader($err.Exception.Response.GetResponseStream())
    $body = $reader.ReadToEnd()
    if ($body) { Write-Host "resposta do servidor: $body" -ForegroundColor Yellow }
  } catch {
    # Sem resposta nenhuma (servidor fora do ar, DNS, TLS) — a mensagem
    # da própria exceção já diz mais do que qualquer coisa que eu possa
    # inventar aqui.
  }
}

Write-Host "`nlogin em $ApiBaseUrl ..."
try {
  $login = Invoke-RestMethod -Method Post -Uri "$ApiBaseUrl/login" `
    -ContentType 'application/json' `
    -Body (@{ name = $User; password = $password } | ConvertTo-Json)
} catch {
  Show-ApiError $_
  throw
}

Write-Host "publicando a versão $Version ..."
try {
  $result = Invoke-RestMethod -Method Put -Uri "$ApiBaseUrl/version" `
    -ContentType 'application/json' `
    -Headers @{ Authorization = "Bearer $($login.token)" } `
    -Body (@{ version = $Version; sha256 = $Sha256 } | ConvertTo-Json)
} catch {
  Show-ApiError $_
  throw
}

Write-Host "`npublicado:" -ForegroundColor Green
$result | Format-List

# Confere pelo caminho PÚBLICO, que é o mesmo que o app e o site usam —
# é ele, e não a resposta acima, que prova que o que foi gravado chega
# até quem vai baixar.
Write-Host 'conferindo /version/public ...'
Invoke-RestMethod -Uri "$ApiBaseUrl/version/public" | Format-List
