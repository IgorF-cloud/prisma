; Instalador do "Prisma" — instala o app (saída "--dir" do
; electron-builder) JUNTO com o GStreamer mínimo que ele usa
; (installer\gstreamer -> {app}\gstreamer).
;
; O GStreamer é dependência OBRIGATÓRIA da captura de tela (não existe
; modo CPU/software de fallback, ver MEMORIA.md). Até a 1.0.7 ele era
; BAIXADO durante a instalação; desde 2026-09-18 vai dentro do pacote —
; o porquê está no bloco grande logo abaixo dos #define.
;
; NÃO grava mais um config.json (2026-09-10): os endereços de produção
; passaram a ser compilados no app (ver src/main/config.ts). Com um
; domínio no lugar do IP, quem absorve mudança de endereço é o DNS — e
; o arquivo, que o `onlyifdoesntexist` preservava numa atualização,
; virava um endereço antigo que nem o auto-update corrigia.
;
; Herdado do instalador do taon-desktop
; (D:\MY PROJECTS\Electron\taon\installer\taon.iss), que por sua vez veio do
; app Flutter (D:\MY PROJECTS\taon\installer\taon.iss) — a lógica de
; GStreamer e de confiança do certificado de code-signing é praticamente
; idêntica nos três (mesma dependência, mesmo problema de SmartScreen); o
; que muda no Prisma é a identidade: AppId, nome, ícones, certificado
; próprio e o nome do .exe de saída.
;
; Pré-requisito pra compilar: `npm run build:unpack` já ter rodado (o
; instalador empacota dist\win-unpacked\*).
;
; Compilar: "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\prisma.iss
; O instalador final sai em installer\output\Prisma-Setup.exe.

#define AppVersion "1.6.0"

; A versão do GStreamer que está EMPACOTADA em installer\gstreamer.
; Informativa: nada aqui baixa mais nada. Serve pra saber, olhando este
; arquivo, qual versão a pasta carrega — quem a monta é o
; collect-gstreamer.ps1, a partir de uma instalação oficial dessa versão.
#define GstreamerVersion "1.28.8"

; ---------------------------------------------------------------------
; O GSTREAMER VAI EMPACOTADO (2026-09-18)
;
; Até a 1.0.7 este instalador BAIXAVA o pacote oficial completo: 528 MB
; de download e 2,1 GB em disco, pra usar 12 elementos. Além do exagero,
; era a parte mais frágil da instalação — meio gigabyte vindo da Europa
; no meio do processo, e qualquer oscilação de rede entregava um arquivo
; truncado, cujo hash não batia. A instalação morria ali, com uma
; mensagem que soava como "este download é suspeito". Aconteceu com um
; usuário real em 2026-09-17.
;
; Agora vão só os 35 MB que o app usa, na pasta {app}\gstreamer. Ver
; installer\collect-gstreamer.ps1 (como o conjunto é montado) e
; MEMORIA.md (o raciocínio inteiro, e como desfazer).
;
; ⚠️ COMO VOLTAR ATRÁS: este arquivo tem a versão antiga no histórico do
; git. Do lado do APP não precisa fazer nada — `gstreamerCapture.ts`
; procura o embarcado, depois o instalado no sistema, depois o PATH;
; sem o embarcado, ele usa o que o instalador antigo baixou.
; ---------------------------------------------------------------------

; QUAL GStreamer do sistema o instalador remove antes de instalar o app.
; O alvo são as máquinas que vêm das versões que baixavam: 2,1 GB parados
; em Program Files que nada mais usa.
;
;   "ours"  só o que o PRÓPRIO PRISMA instalou — identificado pela marca
;           GstreamerInstalledByUs, que as versões antigas gravavam em
;           HKLM\SOFTWARE\Prisma ao terminar o download.
;   "any"   qualquer instalação do GStreamer MSVC x86_64 que exista.
;
; "ours" é o padrão (decisão do usuário, 2026-09-18), e a razão é a
; assimetria dos erros: não removendo, sobra disco ocupado e nada quebra
; — a versão nova usa o GStreamer da própria pasta de qualquer jeito.
; Removendo o que não era nosso, alguém que use o GStreamer para outra
; coisa perde o pacote em silêncio, e não tem como saber que foi o
; Prisma. Um dos lados custa espaço; o outro custa confiança.
#define UninstallGstreamerScope "ours"

[Setup]
; GUID NOVO de propósito (gerado em 2026-09-08, no clone) — o Prisma é um
; produto DIFERENTE do TaOnPlay (tanto do Electron quanto do Flutter). GUIDs
; diferentes = o Windows não tenta tratar um como "upgrade in place" do
; outro, então as duas instalações podem coexistir na mesma máquina, cada
; uma na sua pasta, com o seu próprio desinstalador — que é justamente o que
; a gente quer enquanto os dois apps existirem em paralelo.
;
; Gerado uma vez só — NÃO regenerar em builds futuros, senão o Windows para
; de reconhecer atualizações do Prisma como "a mesma instalação" (cada
; atualização viraria uma instalação nova, duplicando entradas em
; Programas e Recursos).
AppId={{D7AAA973-92B7-4FD1-8523-400728168D65}
AppName=Prisma
AppVersion={#AppVersion}
AppPublisher=Prisma
AppComments=Compartilhe sua tela com amigos, no seu próprio servidor.
AppCopyright=Copyright (C) 2026 Prisma
DefaultDirName={autopf}\Prisma
DefaultGroupName=Prisma
UninstallDisplayIcon={app}\Prisma.exe
OutputDir=output
; Nome fixo (sem a versão) de propósito — é o mesmo arquivo que o app vai
; baixar via auto-atualização (ver a tabela app_version no prisma_server);
; ao publicar uma versão nova, só troca o .exe dentro de downloads/ com
; esse nome, sem precisar mexer em nenhum outro arquivo (só o SHA-256
; muda a cada build).
OutputBaseFilename=Prisma-Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=admin
; "dynamic" (pedido do usuário, 2026-09-03): o wizard detecta o tema do
; Windows (claro/escuro) na hora que o instalador abre e se adapta —
; suportado desde o Inno Setup 6.6.0 (a instalação nesta máquina foi
; atualizada pra uma versão mais nova especificamente pra isso).
;
; ATENÇÃO (descoberto no teste de 2026-09-08): no modo escuro o "dynamic"
; NÃO usa só outras cores — ele "automatically replaces icons, wizard
; images, and colors" (whatsnew.htm do Inno, entrada da 6.6.0). Quer
; dizer: WizardImageFile/WizardSmallImageFile valem só no tema CLARO, e
; no escuro o Inno joga as artes EMBUTIDAS dele por cima, a não ser que
; existam as variantes *DynamicDark abaixo. Foi exatamente isso que
; aconteceu no primeiro instalador do Prisma — arte certa compilada,
; wizard mostrando o visual padrão do Inno. Se um dia essas duas linhas
; sumirem, o bug volta e é silencioso (compila sem aviso nenhum).
WizardStyle=modern dynamic
SetupIconFile=..\build\icon.ico
; As duas imagens do wizard deixaram de ser .bmp em 2026-09-08, junto com
; a troca da arte do TaOnPlay pela do Prisma. Eram .bmp porque o
; instalador do app Flutter usava Inno 6.2.2, que não decodificava PNG em
; tempo de execução; a versão instalada aqui já lê PNG, inclusive com
; transparência. JPEG o Inno NÃO lê em nenhuma versão — a arte do banner
; nasce .jpg e é convertida (ver build\make-art.ps1, que gera as duas).
;
; Imagem grande (painel da esquerda, tela de boas-vindas). O tamanho base
; do Inno pra ela é 164x314 (ver WizClassicImage.bmp na pasta do Inno
; Setup); o arquivo é 480x919, a MESMA proporção, e o Inno reduz sozinho
; conforme o DPI (escala até 250%, ou seja 410x785). O que importa é
; manter a proporção — outro aspecto estica e distorce a arte.
WizardImageFile=assets\installer_banner.png
WizardImageFileDynamicDark=assets\installer_banner.png
; Imagem pequena (canto superior direito das demais páginas): o ícone do
; Prisma, transparente. A transparência é o que faz essa arte funcionar
; nos DOIS temas — o .bmp antigo tinha fundo branco chapado, que viraria
; um quadrado branco no modo escuro. Base do Inno é 58x58 (era 55x55 até
; a 6.6.0); o arquivo é 512x512 e o Inno reduz.
WizardSmallImageFile=assets\installer_small.png
WizardSmallImageFileDynamicDark=assets\installer_small.png
; As duas linhas DynamicDark acima apontam pro MESMO arquivo do tema
; claro de propósito: o banner é escuro e a logo é transparente, então as
; duas artes já funcionam nos dois temas. Não custa tamanho — "the
; compiler now stores identical regular and DynamicDark wizard images
; only once" (whatsnew.htm, 6.6.1). Só valeria separar se um dia a marca
; ganhar uma versão específica pra fundo claro.
DisableWelcomePage=no
InfoBeforeFile=info_before.txt

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
Source: "..\dist\win-unpacked\*"; DestDir: "{app}"; Excludes: "*.rar,*.zip"; Flags: recursesubdirs createallsubdirs ignoreversion
; O GStreamer, em PASTA PRÓPRIA (2026-09-18, pedido do usuário) — nada de
; DLL dele solta junto com as do app. A estrutura de dentro
; (bin\, lib\gstreamer-1.0\, lib\gio\modules\, libexec\) é preservada, e
; é a mesma de installer\gstreamer: o `gstreamerCapture.ts` monta os
; caminhos das variáveis de ambiente contando com ela.
Source: "gstreamer\*"; DestDir: "{app}\gstreamer"; Flags: recursesubdirs createallsubdirs ignoreversion
; Certificado público de code-signing (ver InstallCodeSigningCert em
; [Code]) — "dontcopy" porque não faz parte do app instalado, só precisa
; existir temporariamente durante a instalação pra ser registrado como
; confiável no Windows.
Source: "certs\PrismaCodeSign.cer"; DestDir: "{tmp}"; Flags: dontcopy
; O config.json saiu daqui em 2026-09-10 — os endereços agora são
; compilados no app (src/main/config.ts). O app ainda LÊ um config.json
; se encontrar um do lado do .exe, mas só como escape hatch manual (pra
; apontar uma build empacotada pra outro servidor sem recompilar); nada
; mais o cria, então ele não tem como ficar velho sozinho.
;
; A limpeza do arquivo antigo está no [InstallDelete] logo abaixo — sem
; ela, máquinas vindas de uma versão anterior continuariam com o
; endereço velho, que VENCE do compilado na ordem de prioridade do
; config.ts.

[InstallDelete]
; Apaga o config.json de instalações anteriores (2026-09-10). Sem isto,
; quem já tinha o app instalado ficaria preso no endereço antigo
; (http://<IP-antigo>:5000) PARA SEMPRE: o arquivo vence do endereço
; compilado, e o auto-update — que roda este mesmo instalador — não o
; removeria. Com esta linha, a primeira atualização já corrige a máquina
; sozinha.
;
; Efeito colateral aceito: se alguém tiver criado um config.json à mão
; como escape hatch (ver src/main/config.ts), ele some na próxima
; atualização e precisa ser recriado. É o comportamento certo pra uma
; sobreposição de emergência/teste — ela não deveria sobreviver
; silenciosamente a uma atualização.
Type: files; Name: "{app}\config.json"

[Tasks]
; Pergunta em vez de criar direto — tela própria do Inno Setup pra isso
; (aparece entre "Selecionar Pasta" e "Pronto pra Instalar"), com o texto
; já traduzido pelo arquivo de idioma (compiler:Languages\BrazilianPortuguese.isl).
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Icons]
Name: "{group}\Prisma"; Filename: "{app}\Prisma.exe"
Name: "{group}\Desinstalar Prisma"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Prisma"; Filename: "{app}\Prisma.exe"; Tasks: desktopicon

[Run]
; Sem "skipifsilent" de propósito: o fluxo de auto-atualização do app
; (a implementar, mesmo espírito do lib/core/update_service.dart do app
; Flutter) chama este instalador com /SILENT e depende de reabrir o app
; sozinho ao terminar — com skipifsilent essa entrada seria pulada
; justamente nesse caso. Em instalação manual (não-silenciosa) o
; comportamento não muda: continua sendo a checkbox "Executar" na tela final.
Filename: "{app}\Prisma.exe"; Description: "Executar Prisma"; Flags: nowait postinstall

[Code]
const
  // Se o GStreamer sair de versão, atualizar aqui E na constante
  // GstreamerVersion no topo do arquivo. Nome da pasta em minúsculas só
  // pra bater com o padrão que o próprio instalador oficial usa quando
  // ninguém força um /DIR (Windows não diferencia caixa em paths, então
  // isso é só estética/consistência).
  GstreamerBinSubdir = '\gstreamer\1.0\msvc_x86_64';

  // Chave só nossa pra marcar "foi o Prisma que instalou o GStreamer nesta
  // máquina" — usada pelo desinstalador pra decidir se remove o GStreamer
  // junto ou deixa quieto (se já estava instalado antes do Prisma, não é
  // nosso pra remover).
  //
  // Chave PRÓPRIA (não SOFTWARE\TaOnPlay) de propósito: se o TaOnPlay
  // estiver instalado na mesma máquina, os dois apps precisam de marcas
  // separadas — senão desinstalar um levaria o GStreamer embora enquanto o
  // outro ainda depende dele, ou apagaria a marca do vizinho.
  PrismaRegKey = 'SOFTWARE\Prisma';

// A página de download do GStreamer SAIU em 2026-09-18, junto com o
// `InitializeWizard` que só existia pra criá-la: não se baixa mais nada,
// o GStreamer vem na pasta {app}\gstreamer.

// --- Confiança do certificado de code-signing ------------------------------
//
// Prisma.exe e este instalador são assinados com o MESMO certificado
// (PrismaCodeSign, self-signed, próprio do Prisma — não é o do TaOnPlay e
// não vem de uma autoridade pública). Sem registrar ele como confiável, o
// Windows Defender SmartScreen bloqueia toda atualização automática futura
// (dispara o instalador via elevação, e o SmartScreen intercepta nesse
// caminho igual intercepta um duplo-clique manual). Registrar aqui, uma
// vez, na instalação/atualização, resolve pra sempre nesta máquina — só
// precisa disso de novo se o certificado for trocado no futuro.
procedure InstallCodeSigningCert;
var
  CertPath: string;
  ResultCode: Integer;
begin
  ExtractTemporaryFile('PrismaCodeSign.cer');
  CertPath := ExpandConstant('{tmp}\PrismaCodeSign.cer');

  // -f sobrescreve se já existir — idempotente, então reinstalar ou
  // atualizar de novo não duplica nem falha. Precisa ser Local Machine
  // (não -user) pra valer também quando o instalador silencioso roda via
  // outra sessão/elevação — o instalador já é admin (PrivilegesRequired),
  // então sobra permissão pra isso.
  Exec('certutil.exe', '-addstore -f "Root" "' + CertPath + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec('certutil.exe', '-addstore -f "TrustedPublisher" "' + CertPath + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    InstallCodeSigningCert;
end;

// --- Utilitários de PATH (HKLM\...\Environment) ---------------------------
//
// Só o REMOVE é usado desde 2026-09-18, pra limpar a entrada órfã que as
// versões anteriores deixavam apontando pro GStreamer do sistema.
//
// O `EnvAddPath` ficou sem chamador e continua aqui de propósito: é o
// par do outro, e some junto se um dia a limpeza deixar de ser
// necessária. O instalador não escreve mais no PATH — quem monta o
// ambiente do gst-launch é o próprio app, no `spawn`.

procedure EnvAddPath(Path: string);
var
  Paths: string;
begin
  if not RegQueryStringValue(HKEY_LOCAL_MACHINE,
      'SYSTEM\CurrentControlSet\Control\Session Manager\Environment', 'Path', Paths)
  then
    Paths := '';

  // Já está no PATH? não duplica.
  if Pos(';' + Uppercase(Path) + ';', ';' + Uppercase(Paths) + ';') > 0 then
    exit;

  if (Paths <> '') and (Paths[Length(Paths)] <> ';') then
    Paths := Paths + ';';
  Paths := Paths + Path;

  RegWriteExpandStringValue(HKEY_LOCAL_MACHINE,
    'SYSTEM\CurrentControlSet\Control\Session Manager\Environment', 'Path', Paths);
end;

procedure EnvRemovePath(Path: string);
var
  Paths, Item, NewPaths: string;
  P: Integer;
begin
  if not RegQueryStringValue(HKEY_LOCAL_MACHINE,
      'SYSTEM\CurrentControlSet\Control\Session Manager\Environment', 'Path', Paths)
  then
    exit;

  // Reconstrói o Path removendo só o segmento que bate (case-insensitive)
  // com Path, mantendo todo o resto intacto.
  NewPaths := '';
  while Paths <> '' do
  begin
    P := Pos(';', Paths);
    if P = 0 then
    begin
      Item := Paths;
      Paths := '';
    end
    else
    begin
      Item := Copy(Paths, 1, P - 1);
      Paths := Copy(Paths, P + 1, Length(Paths));
    end;

    if (Item <> '') and (Uppercase(Item) <> Uppercase(Path)) then
    begin
      if NewPaths <> '' then
        NewPaths := NewPaths + ';';
      NewPaths := NewPaths + Item;
    end;
  end;

  RegWriteExpandStringValue(HKEY_LOCAL_MACHINE,
    'SYSTEM\CurrentControlSet\Control\Session Manager\Environment', 'Path', NewPaths);
end;

function SendMessageTimeoutW(hWnd: Longint; Msg: Longint; wParam: Longint;
  lParam: string; fuFlags: Longint; uTimeout: Longint; var lpdwResult: Longint): Longint;
  external 'SendMessageTimeoutW@user32.dll stdcall';

procedure RefreshEnvironment;
var
  Dummy: Longint;
begin
  // Avisa processos existentes (Explorer etc.) que o Environment mudou —
  // WM_SETTINGCHANGE (0x1A) pra HWND_BROADCAST (0xFFFF), SMTO_ABORTIFHUNG
  // (0x2). A maioria dos apps abertos DEPOIS disso já vê o PATH novo sem
  // precisar reiniciar a máquina. Processos já abertos que leram o PATH
  // pra memória antes disso (ex.: uma IDE já aberta) só veem a mudança
  // depois de reiniciados — daí o NeedRestart() abaixo.
  SendMessageTimeoutW($FFFF, $001A, 0, 'Environment', 2, 5000, Dummy);
end;

// --- Desinstala o GStreamer que exista na máquina --------------------------
//
// Invertido em 2026-09-18: este bloco BAIXAVA e instalava o GStreamer;
// agora ele desinstala. O app traz o próprio, em {app}\gstreamer, então
// uma instalação do pacote completo na máquina não é mais usada por
// ninguém — são 2,1 GB parados, e é a máquina de quem veio de uma versão
// anterior do Prisma que fica com eles.
//
// Por padrão mexe SÓ no que o próprio Prisma instalou — ver
// UninstallGstreamerScope no topo do arquivo. Quem instalou o GStreamer
// por conta própria continua com ele, e isso não atrapalha em nada: o
// app prefere o da pasta dele.

// Tira as aspas que o registro guarda em volta do caminho do
// desinstalador (o Inno grava UninstallString como "C:\...\unins000.exe").
function Unquote(S: string): string;
begin
  Result := Trim(S);
  if (Length(Result) >= 2) and (Result[1] = '"') and (Result[Length(Result)] = '"') then
    Result := Copy(Result, 2, Length(Result) - 2);
end;

// Acha UMA instalação do GStreamer MSVC x86_64 no registro. Devolve o
// desinstalador e onde ele mora.
//
// Confere que o arquivo existe de verdade, e não só a chave: o
// instalador oficial do GStreamer reusa o mesmo AppId em toda versão,
// então a entrada costuma sobreviver a uma remoção manual e apontar pra
// uma pasta que não existe mais.
function FindGstreamerInstall(var Uninstaller: string; var InstallLocation: string): Boolean;
var
  Names: TArrayOfString;
  I: Integer;
  DisplayName, SubKey, Cmd: string;
begin
  Result := False;
  Uninstaller := '';
  InstallLocation := '';

  if not RegGetSubkeyNames(HKEY_LOCAL_MACHINE,
      'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', Names) then
    exit;

  for I := 0 to GetArrayLength(Names) - 1 do
  begin
    SubKey := 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\' + Names[I];
    if not RegQueryStringValue(HKEY_LOCAL_MACHINE, SubKey, 'DisplayName', DisplayName) then
      continue;
    if (Pos('GStreamer', DisplayName) = 0) or (Pos('MSVC x86_64', DisplayName) = 0) then
      continue;

    RegQueryStringValue(HKEY_LOCAL_MACHINE, SubKey, 'InstallLocation', InstallLocation);

    // QuietUninstallString primeiro: quando existe, já vem com os
    // parâmetros de silêncio que AQUELE desinstalador entende.
    if RegQueryStringValue(HKEY_LOCAL_MACHINE, SubKey, 'QuietUninstallString', Cmd) and (Cmd <> '') then
      Uninstaller := Cmd
    else if RegQueryStringValue(HKEY_LOCAL_MACHINE, SubKey, 'UninstallString', Cmd) then
      Uninstaller := Cmd;

    if Unquote(Uninstaller) = '' then
      continue;
    if not FileExists(Unquote(Uninstaller)) then
      continue;

    Result := True;
    exit;
  end;
end;

// Remove o GStreamer do sistema, em silêncio. Nunca falha a instalação do
// app: se não der, o pior caso é o disco continuar ocupado — o Prisma usa
// o embarcado de qualquer jeito.
procedure RemoveSystemGstreamer;
var
  Uninstaller, InstallLocation, Exe, BinDir: string;
  InstalledByUs: Cardinal;
  ResultCode, Tentativas: Integer;
  Page: TOutputProgressWizardPage;
begin
  if '{#UninstallGstreamerScope}' <> 'any' then
  begin
    // Modo "ours" (o padrão): sem a marca, não é nosso — sai sem tocar em
    // nada. Quem instalou o GStreamer por conta própria fica com ele.
    if not RegQueryDWordValue(HKEY_LOCAL_MACHINE, PrismaRegKey, 'GstreamerInstalledByUs', InstalledByUs) then
      exit;
    if InstalledByUs <> 1 then
      exit;
  end;

  // A página só aparece se houver o que remover — mas a LIMPEZA do fim
  // roda de qualquer jeito. Chegando aqui, já se sabe que esta máquina é
  // território nosso (tem a marca, ou o modo é "any"), e a entrada de
  // PATH e as marcas do registro precisam sumir mesmo que o GStreamer já
  // tenha sido removido à mão antes — senão fica uma entrada de PATH
  // apontando pra uma pasta que não existe, pra sempre.
  if FindGstreamerInstall(Uninstaller, InstallLocation) then
    begin
    Page := CreateOutputProgressPage('Liberando espaço',
      'Removendo a instalação antiga do GStreamer — o Prisma agora traz a própria.');
    Page.Show;
    try
      // Até 3 instalações: o pacote do GStreamer aparece em mais de uma
      // entrada em algumas máquinas (runtime e development), e cada uma tem
      // o seu desinstalador. O teto evita laço infinito se uma entrada
      // insistir em não sumir.
      Tentativas := 0;
      while (Tentativas < 3) and FindGstreamerInstall(Uninstaller, InstallLocation) do
      begin
        Tentativas := Tentativas + 1;
        Exe := Unquote(Uninstaller);
        Page.SetText('Removendo ' + Exe + '...', '');

        // O desinstalador do GStreamer é Inno Setup (o arquivo se chama
        // unins000.exe), então entende estes parâmetros. Se um dia mudar de
        // tecnologia, isto vira um no-op silencioso — e o único efeito é o
        // disco continuar ocupado.
        if not Exec(Exe, '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART', '',
            SW_HIDE, ewWaitUntilTerminated, ResultCode) then
          break;

        // Tira do PATH a pasta bin que ficou órfã. Sem isso sobra uma
        // entrada apontando pra lugar nenhum, que atrapalha quem for
        // depurar a máquina depois.
        if InstallLocation <> '' then
        begin
          BinDir := RemoveBackslashUnlessRoot(InstallLocation) + '\bin';
          EnvRemovePath(BinDir);
        end;
      end;
    finally
      Page.Hide;
    end;
  end;

  // A marca das versões antigas perde o sentido: não há mais GStreamer
  // nosso instalado fora do app.
  if RegQueryStringValue(HKEY_LOCAL_MACHINE, PrismaRegKey, 'GstreamerBinDir', BinDir) then
    EnvRemovePath(BinDir);
  RegDeleteValue(HKEY_LOCAL_MACHINE, PrismaRegKey, 'GstreamerBinDir');
  RegDeleteValue(HKEY_LOCAL_MACHINE, PrismaRegKey, 'GstreamerInstalledByUs');
  RefreshEnvironment;
end;


function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  // Roda ANTES de copiar qualquer arquivo do app: limpar primeiro é o que
  // libera o disco pra instalação que vem em seguida, que é o ponto.
  RemoveSystemGstreamer();

  // Nunca aborta. Até a 1.0.7 esta função devolvia o erro de
  // `InstallGstreamer` e podia parar a instalação inteira — fazia sentido
  // quando o GStreamer precisava ser baixado, e era justamente aí que a
  // instalação morria. Agora ele vem dentro do pacote: não há mais nada
  // que possa dar errado aqui a ponto de impedir o app de ser instalado.
  Result := '';
end;

function NeedRestart(): Boolean;
begin
  // Nunca mais. A necessidade de reiniciar vinha de MEXER NO PATH do
  // sistema: processos já abertos (uma IDE, por exemplo) só enxergam o
  // PATH novo depois de reiniciados.
  //
  // O instalador não escreve mais nada no PATH — e não precisa: o app
  // passa o ambiente inteiro (PATH, GST_PLUGIN_SYSTEM_PATH,
  // GST_PLUGIN_SCANNER, GST_REGISTRY, GIO_MODULE_DIR) ao processo do
  // gst-launch que ele mesmo cria (ver gstreamerCapture.ts). Escrever no
  // PATH do sistema só poluiria, e ainda poderia sombrear outro GStreamer
  // que a pessoa tenha.
  Result := False;
end;

// --- Desinstalação do app --------------------------------------------------
//
// A pergunta "deseja desinstalar o GStreamer também?" SAIU em 2026-09-18,
// junto com a lógica que a seguia. Ela existia porque o app instalava o
// GStreamer no sistema; agora ele o carrega dentro de {app}\gstreamer, e
// desinstalar o Prisma leva a pasta junto, como qualquer outro arquivo
// dele. Não há mais nada de nosso fora da pasta do app pra limpar.

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep <> usUninstall then
    exit;

  // Só a chave de registro, que hoje não guarda mais nada útil — as
  // marcas GstreamerBinDir/GstreamerInstalledByUs das versões antigas já
  // são apagadas na INSTALAÇÃO (ver RemoveSystemGstreamer). Apagar aqui
  // também cobre quem desinstalar sem nunca ter passado por uma versão
  // nova.
  RegDeleteKeyIncludingSubkeys(HKEY_LOCAL_MACHINE, PrismaRegKey);
end;
