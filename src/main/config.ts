import { config as loadEnv } from 'dotenv'
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { app } from 'electron'

// .env fica na raiz do projeto (do lado do package.json) — só existe em
// dev, pra testar local (o instalador NUNCA empacota .env, ver
// electron-builder.yml).
loadEnv({ path: join(app.getAppPath(), '.env') })

// ---------------------------------------------------------------------
// Endereços de produção — COMPILADOS no app (2026-09-10)
//
// Até aqui, quem fornecia isso em produção era um `config.json` que o
// instalador gravava do lado do .exe. Ele existia por um motivo que
// deixou de valer: o servidor era alcançado por IP, IP muda, e ninguém
// quer reinstalar o app por causa disso — o arquivo era a válvula de
// escape.
//
// Com o domínio (prisma-site.com.br, 2026-09-10) essa indireção passou
// pro lugar certo: quem absorve troca de IP agora é o DNS, que é
// literalmente pra isso que ele serve. Um arquivo de config por máquina
// virou só uma cópia a mais pra ficar desatualizada.
//
// E ela FICAVA. O `Flags: onlyifdoesntexist` do Inno preservava o
// arquivo numa atualização (de propósito, pra não apagar edição manual),
// o que significa que toda instalação existente carregava o endereço
// antigo pra sempre — nem o auto-update corrigia. Compilado no app, o
// endereço passa a viajar junto com a atualização, como qualquer outro
// código.
const PRODUCTION_API_BASE_URL = 'https://prisma-site.com.br'

// O LiveKit NÃO passa pelo nginx (decisão de 2026-09-10): proxiar
// sinalização de WebRTC acrescenta um ponto de falha no caminho de
// entrar numa sala, e o que se ganharia é esconder metadado — a mídia
// já é criptografada por DTLS-SRTP de qualquer jeito.
//
// Mas o endereço usa o DOMÍNIO mesmo assim, com a porta explícita: isso
// não é proxy, é só DNS. Resolve o problema de IP fixo sem colocar nada
// no meio do caminho.
//
// ⚠️ Vira `wss://` no dia em que o painel web (item 4) precisar assistir
// uma live pelo navegador: uma página em https:// não consegue abrir um
// ws://, o navegador bloqueia como conteúdo misto. Aí sim vale proxiar.
const PRODUCTION_LIVEKIT_WS_URL = 'ws://prisma-site.com.br:5880'

// Escape hatch — NÃO é mais instalado com o app.
//
// O `config.json` deixou de ser gravado pelo instalador (ver
// installer/prisma.iss), mas a LEITURA continua aqui de propósito: é o
// que permite apontar uma build EMPACOTADA pra outro servidor (uma VM
// de teste, um servidor local) sem recompilar — basta criar o arquivo à
// mão do lado do .exe. Em dev o .env acima já cobre isso; isto cobre o
// pacote pronto.
//
// Como nada mais cria esse arquivo, ele não tem como ficar
// desatualizado sozinho: se existir, é porque alguém quis.
interface FileConfig {
  apiBaseUrl?: string
  livekitWsUrl?: string
}

function loadFileConfig(): FileConfig {
  if (!app.isPackaged) return {}

  const configPath = join(dirname(process.execPath), 'config.json')
  try {
    if (!existsSync(configPath)) return {}
    console.log(`config.json encontrado em ${configPath} — sobrepondo os endereços compilados`)
    return JSON.parse(readFileSync(configPath, 'utf-8')) as FileConfig
  } catch (err) {
    console.error('Erro ao ler config.json:', err)
    return {}
  }
}

const fileConfig = loadFileConfig()

// Ordem: variável de ambiente (dev) > config.json (escape hatch, raro) >
// o endereço compilado (o caminho normal em produção). Note que o
// fallback pra localhost saiu junto: ele nunca deveria ter valido, e
// quando valia só transformava "config faltando" num erro de conexão
// difícil de ler.
export const API_BASE_URL =
  process.env.API_BASE_URL ?? fileConfig.apiBaseUrl ?? PRODUCTION_API_BASE_URL

export const LIVEKIT_WS_URL =
  process.env.LIVEKIT_WS_URL ?? fileConfig.livekitWsUrl ?? PRODUCTION_LIVEKIT_WS_URL

// ---------------------------------------------------------------------
// Quem está falando (2026-09-21)
//
// Vai em TODA chamada à API, no header `X-Prisma-Client`. O servidor
// grava plataforma e versão a cada entrada no app (`/login` e `/me`) e
// mostra no painel de administração — é o que responde "esse bug é da
// versão velha?" sem precisar perguntar pra pessoa.
//
// `windows` é escrito à mão, e não derivado de `process.platform`: o
// nome identifica o APP (o cliente Electron), não o sistema onde ele
// roda. O dia em que isto rodar num Mac, continua sendo o mesmo cliente
// — e é ele que o painel precisa distinguir do app Android.
//
// No header, e não no corpo do `/login`: os DOIS caminhos de entrada
// precisam mandar isso, e um deles é o `GET /me` do "manter conectado",
// que não tem corpo.
//
// `app.getVersion()` no escopo do módulo funciona antes do `ready` (é
// leitura do package.json / metadado do exe) — o `getAppPath()` do
// `loadEnv` lá em cima é da mesma família.
export const CLIENT_HEADER = 'X-Prisma-Client'
export const CLIENT_HEADER_VALUE = `windows/${app.getVersion()}`
