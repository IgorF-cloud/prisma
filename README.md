<p align="center">
  <img src="resources/icon.png" width="96" alt="Prisma" />
</p>

<h1 align="center">Prisma</h1>

<p align="center">
  App desktop para transmitir a tela, um jogo ou a webcam para um grupo de amigos, com baixa latência e no seu próprio servidor.
</p>

<p align="center">
  <img alt="Plataforma" src="https://img.shields.io/badge/plataforma-Windows%2010%2F11%20x64-0078D6" />
  <img alt="Electron" src="https://img.shields.io/badge/Electron-39-47848F" />
  <img alt="LiveKit" src="https://img.shields.io/badge/WebRTC-LiveKit-FF6352" />
</p>

---

O Prisma é o cliente Windows (Electron + React) de um sistema de lives
privadas. Ele precisa do servidor **[prisma_server](https://github.com/IgorF-cloud/prisma_server)**,
que cuida de contas, salas, amigos e chat e roda o LiveKit (o servidor
WebRTC) via Docker. Este repositório é só o app. Para usar com o seu
próprio servidor, suba o `prisma_server` primeiro e depois aponte o app
para ele (veja [Apontando para o seu servidor](#apontando-para-o-seu-servidor)).

> A interface é em português do Brasil, e o app é **só para Windows**: a
> captura usa APIs do Windows (Desktop Duplication, Media Foundation, WASAPI).

## Sumário

- [Recursos](#recursos)
- [Como funciona](#como-funciona)
- [Requisitos](#requisitos)
- [Rodando em desenvolvimento](#rodando-em-desenvolvimento)
- [Apontando para o seu servidor](#apontando-para-o-seu-servidor)
- [Gerando o instalador](#gerando-o-instalador)
- [Atualizações automáticas](#atualizações-automáticas)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Scripts](#scripts)
- [Licença](#licença)

## Recursos

- **Transmissão de tela, janela ou jogo** em até 60 fps, com H.264 por GPU e áudio do sistema.
- **Webcam**, sozinha ou junto com a tela na mesma sala.
- **Várias lives ao mesmo tempo**, com uma em destaque. Também dá pra assistir pelo navegador (Prisma Web, servido pelo `prisma_server`).
- **Detecção de jogos**: mostra o jogo que está sendo transmitido, com a arte da biblioteca da Steam.
- **Amigos e presença**: pedidos de amizade, quem está online e quem está ao vivo, lives privadas só para amigos.
- **Alertas de live nova** e **chat** em cada sala.
- **Contas**: cadastro, login, perfil com avatar (inclusive GIF) e recuperação de senha por e-mail.
- **Atualização automática**: o app baixa e instala versões novas publicadas no servidor.

## Como funciona

```
                       ┌──────────────────────────── prisma_server (Docker) ────────────────────────────┐
                       │                                                                                 │
 ┌─────────────┐ HTTPS │  ┌───────┐    ┌──────────────┐    ┌──────────┐                                   │
 │             ├───────┼─►│ nginx ├───►│ API Node.js  ├───►│ Postgres │   contas, amigos, versões         │
 │             │  WSS  │  └───────┘    │ (Express)    │    └──────────┘                                   │
 │  Prisma     │       │               └──────┬───────┘                                                   │
 │  (este app) │       │                      │ cria salas, tokens e ingresses                            │
 │             │       │                      ▼                                                           │
 │             │  WS   │               ┌──────────────┐    ┌──────────────────┐                           │
 │  assistir ──┼───────┼──────────────►│   LiveKit    │◄───┤ LiveKit Ingress  │◄── WHIP ─┐                │
 │             │ WebRTC│               │   (SFU)      │    └──────────────────┘          │                │
 │  transmitir │       │               └──────────────┘                                  │                │
 └──────┬──────┘       └─────────────────────────────────────────────────────────────────┼────────────────┘
        │                                                                                │
        └── GStreamer (gst-launch) ── captura d3d11 + H.264 (mfh264enc) + áudio WASAPI ──┘
```

- **Processo main** (`src/main/`): fala com a API do servidor (login, salas,
  amigos, chat), detecta jogos, enumera janelas e telas e controla o
  GStreamer.
- **Transmitir**: o servidor cria um *ingress* WHIP no LiveKit. O app
  inicia um pipeline `gst-launch-1.0` que captura a tela pela Desktop
  Duplication API (`d3d11screencapturesrc`), codifica em H.264 na GPU
  (`mfh264enc`), captura o áudio (`wasapi2src`) e publica por WHIP
  (`whipsink`). A captura acontece fora do Chromium, por isso o FPS e a
  latência ficam bem melhores do que com `getDisplayMedia`.
- **Assistir**: o renderer (React) entra na sala com o `livekit-client` e
  recebe a mídia por WebRTC direto do LiveKit. Essa conexão não passa pelo nginx.
- **Helper nativo** (`native/PrismaWindows.cs`): um `.exe` pequeno, compilado
  no build com o `csc` do .NET Framework, que lista janelas e ícones bem mais
  rápido que o PowerShell. Se não der pra compilar, o app usa o caminho por
  PowerShell.

## Requisitos

| Para                     | Precisa                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Rodar em desenvolvimento | Windows 10/11 x64, [Node.js](https://nodejs.org) 20+, [GStreamer](https://gstreamer.freedesktop.org/download/) 1.24+ (MSVC x86_64, runtime) |
| Gerar o instalador       | Tudo acima + [Inno Setup 6](https://jrsoftware.org/isinfo.php) e, para assinar, o `signtool.exe` do Windows SDK                           |
| Usar de verdade          | Um [prisma_server](https://github.com/IgorF-cloud/prisma_server) no ar                                                                   |

## Rodando em desenvolvimento

```bash
git clone https://github.com/IgorF-cloud/prisma.git
cd prisma
npm install

# aponte para o seu servidor (veja a próxima seção)
cp .env.example .env

npm run dev
```

**GStreamer em dev:** o app procura o `gst-launch-1.0.exe` nesta ordem:

1. `installer/gstreamer/bin/` (a cópia enxuta que vai junto no instalador, veja [Gerando o instalador](#gerando-o-instalador));
2. a instalação oficial em `C:\Program Files\gstreamer\1.0\msvc_x86_64\`;
3. o `PATH`.

Instalar o pacote oficial do GStreamer (runtime, MSVC 64-bit, instalação
completa) é o jeito mais simples de começar.

## Apontando para o seu servidor

O app procura o endereço do servidor nesta ordem (vence o primeiro que existir):

| Ordem | Onde                                                       | Quando usar                                                    |
| ----- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| 1     | Variáveis `API_BASE_URL` / `LIVEKIT_WS_URL` no `.env`      | Desenvolvimento (`npm run dev`). O instalador nunca leva o `.env`. |
| 2     | `config.json` ao lado do `Prisma.exe`                      | Apontar uma build já instalada para outro servidor sem recompilar. |
| 3     | Constantes em [`src/main/config.ts`](src/main/config.ts)   | **O padrão das builds publicadas.** Troque aqui para a sua build.   |

Para a sua própria distribuição, edite as duas constantes em `src/main/config.ts`:

```ts
const PRODUCTION_API_BASE_URL = 'https://seu-dominio.com'      // API, atrás do nginx
const PRODUCTION_LIVEKIT_WS_URL = 'ws://seu-dominio.com:5880'  // LiveKit, direto
```

Ou, sem recompilar, crie um `config.json` na pasta de instalação (ao lado do `Prisma.exe`):

```json
{
  "apiBaseUrl": "https://seu-dominio.com",
  "livekitWsUrl": "ws://seu-dominio.com:5880"
}
```

> Se for distribuir o app com outro nome ou para outro servidor, troque
> também o `appId` no [`electron-builder.yml`](electron-builder.yml) e o
> `AppId` (GUID) no [`installer/prisma.iss`](installer/prisma.iss). Assim a
> sua build não se mistura com o Prisma oficial no Windows.

## Gerando o instalador

As releases oficiais usam o **Inno Setup** (`installer/prisma.iss`), e não o
NSIS do electron-builder, porque o instalador leva junto uma cópia enxuta
do GStreamer (~35 MB em vez dos 500+ MB do pacote completo).

```bash
# 1. Build do app, sem instalador (gera dist/win-unpacked/)
npm run build:unpack

# 2. Monta installer/gstreamer/ com só o necessário (precisa do GStreamer
#    oficial instalado e do dumpbin.exe do Visual Studio)
powershell -File installer/collect-gstreamer.ps1

# 3. Compila o instalador -> installer/output/Prisma-Setup.exe
"C:/Program Files (x86)/Inno Setup 6/ISCC.exe" installer/prisma.iss
```

**Assinatura de código.** O `prisma.iss` instala o certificado público de
code-signing (`installer/certs/PrismaCodeSign.cer`), que **não está no
repositório**: cada distribuição usa o próprio. Você tem duas opções:

- gerar o seu certificado (self-signed ou de uma CA), colocar o `.cer` em
  `installer/certs/` e assinar o `dist/win-unpacked/Prisma.exe` (antes do
  passo 3) e o `Prisma-Setup.exe` (depois) com o `signtool sign /fd SHA256 ...`;
- ou remover do `prisma.iss` a linha do `.cer` e o procedimento
  `InstallCodeSigningCert`. O instalador funciona sem assinatura, mas o
  Windows SmartScreen vai avisar quem instalar.

A versão fica em dois lugares: `version` no `package.json` e `AppVersion`
no `prisma.iss`.

## Atualizações automáticas

Ao abrir, o app consulta `GET /version` no servidor. Se houver versão mais
nova, ele baixa o instalador do próprio servidor, confere o SHA-256 e
instala. Para publicar uma versão, envie o `Prisma-Setup.exe` pela aba de
versões do **painel de administração** do `prisma_server`, que calcula o
hash e publica. O script [`publish-version.ps1`](publish-version.ps1) faz
o mesmo pela linha de comando.

O servidor também guarda uma **versão mínima**: clientes abaixo dela são
obrigados a atualizar antes de entrar.

## Estrutura do projeto

```
prisma/
├── build/                 ícones e entitlements usados pelo electron-builder
├── installer/             script do Inno Setup, coletor do GStreamer, artes do wizard
├── native/                helper nativo em C# (enumeração de janelas)
├── resources/             ícone do app (e o helper compilado, gerado no build)
├── scripts/               scripts de build (compilação do helper nativo)
└── src/
    ├── main/              processo principal: API, salas, GStreamer, jogos, janelas, update
    ├── preload/           ponte segura entre main e renderer (contextBridge)
    └── renderer/          interface em React
        └── src/
            ├── screens/       login, cadastro, tela principal
            ├── components/    componentes da interface
            └── lib/           hooks e lógica do renderer (salas, lives, amigos)
```

## Scripts

| Comando                | O que faz                                                         |
| ---------------------- | ----------------------------------------------------------------- |
| `npm run dev`          | Abre o app em modo desenvolvimento, com hot reload no renderer    |
| `npm run typecheck`    | Checagem de tipos do main e do renderer                           |
| `npm run lint`         | ESLint                                                            |
| `npm run build`        | Typecheck + helper nativo + build do electron-vite (em `out/`)    |
| `npm run build:unpack` | Build + app empacotado sem instalador (em `dist/win-unpacked/`)   |
| `npm run build:win`    | Build + instalador NSIS do electron-builder (não leva GStreamer)  |

## Licença

Distribuído sob a licença [MIT](LICENSE): você pode usar, modificar e redistribuir, inclusive comercialmente, desde que mantenha o aviso de copyright.
