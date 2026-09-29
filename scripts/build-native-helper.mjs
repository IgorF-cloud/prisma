// Compila native/PrismaWindows.cs pra resources/prisma-windows.exe
// (2026-09-25). Roda no build, antes do electron-builder empacotar —
// `resources/**` já entra no pacote via `asarUnpack` (electron-builder.yml).
//
// Usa o csc do .NET Framework, que existe em toda instalação do Windows
// desde o 8 — nada pra instalar na máquina de build. Não é o .NET
// moderno de propósito: o Framework está SEMPRE presente na máquina do
// usuário também, então o .exe de 9 KB roda sem runtime nenhum junto.
//
// NUNCA derruba o build. Se não der pra compilar, avisa alto e sai com
// 0: o app funciona sem o helper, caindo no caminho de PowerShell (ver
// windowEnumeration.ts). Um build sem o helper é um app mais lento, não
// um app quebrado — e travar a esteira por causa disso seria pior.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fonte = join(raiz, 'native', 'PrismaWindows.cs')
const destino = join(raiz, 'resources', 'prisma-windows.exe')

function aviso(mensagem) {
  console.warn(`\n  [helper nativo] ${mensagem}`)
  console.warn('  [helper nativo] O app vai usar o caminho de PowerShell (mais lento, mas funciona).\n')
}

if (process.platform !== 'win32') {
  aviso(`Build em ${process.platform}; o helper só existe pro Windows.`)
  process.exit(0)
}

// O csc do Framework mora num caminho versionado. Pega a maior versão
// disponível em vez de fixar "v4.0.30319" — o número muda entre
// instalações do Windows.
function acharCsc() {
  const base = join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64')
  if (!existsSync(base)) return null
  const versoes = readdirSync(base)
    .filter((nome) => /^v\d/.test(nome))
    .filter((nome) => existsSync(join(base, nome, 'csc.exe')))
    .sort()
  const escolhida = versoes[versoes.length - 1]
  return escolhida ? join(base, escolhida, 'csc.exe') : null
}

const csc = acharCsc()
if (!csc) {
  aviso('Não achei o csc.exe do .NET Framework.')
  process.exit(0)
}

if (!existsSync(fonte)) {
  aviso(`Fonte não encontrada: ${fonte}`)
  process.exit(0)
}

mkdirSync(dirname(destino), { recursive: true })

try {
  execFileSync(
    csc,
    [
      '/nologo',
      '/target:exe',
      // Sem console: o helper é spawnado pelo app e nunca deve piscar uma
      // janela preta na cara de quem abre a grade de fontes.
      '/platform:anycpu',
      '/optimize+',
      `/out:${destino}`,
      fonte
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8' }
  )
} catch (erro) {
  const saida = [erro.stdout, erro.stderr].filter(Boolean).join('\n').trim()
  aviso(`Falha ao compilar:\n${saida || erro.message}`)
  process.exit(0)
}

if (!existsSync(destino)) {
  aviso('O csc terminou sem erro mas o .exe não apareceu.')
  process.exit(0)
}

const kb = (statSync(destino).size / 1024).toFixed(1)
console.log(`  [helper nativo] resources/prisma-windows.exe compilado (${kb} KB)`)
