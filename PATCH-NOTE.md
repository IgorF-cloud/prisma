# Patch notes

Rascunho das notas de versão, acumulado **enquanto a versão é escrita** —
o passo que faltava entre "mudei alguma coisa" e o
`src/renderer/src/lib/releaseNotes.ts`, que é o que o app mostra na
janela de **Notas da atualização**.

Existe porque aquele arquivo é o último passo antes de gerar o
instalador (ver `RELEASE.md`), e escrever tudo de uma vez, no fim, é como
se esquece metade do que mudou.

## Como usar

- **Texto pra quem usa o app, não pra quem programa.** O que a pessoa vai
  notar, uma linha cada. Nome de arquivo, de rota e de função ficam no
  `ROADMAP.md`.
- Toda mudança entra como 🧪 **teste pendente**. Vira ✅ **OK** depois que
  o usuário testar na prática — e só item ✅ pode ir pra uma versão
  publicada.
- As seções são as mesmas três do `releaseNotes.ts` (**Novidades**,
  **Melhorias**, **Correções**), de propósito: na hora de publicar, o
  bloco daqui é copiado pra lá quase como está.
- Versão publicada continua aqui, marcada como tal — é o histórico de
  quando cada item foi testado de verdade.

## Sobre a numeração (2026-10-17)

Os três dígitos são publicados. **Mudança grande** sobe o segundo
(1.4.x → **1.5.0**); **atualização menor** sobe o terceiro (1.4.0 →
**1.4.1**). Toda versão publicada ganha a sua seção aqui e a sua nota no
`releaseNotes.ts`, qualquer que seja o dígito.

Substituiu a regra de 2026-09-29, em que só X.Y ia pro ar e o terceiro
dígito era build de teste, sem nota. A primeira versão publicada no
formato novo é a **1.4.1**.

---

## Próxima versão — em andamento

### Melhorias

- 🧪 Nas Notas da atualização, as atualizações de uma versão aparecem
  como uma fileira de cartões no topo, com a quantidade de atualizações.
  Clicar num cartão leva direto ao que mudou nela, logo abaixo das
  novidades do lançamento da versão.

---

## 1.5.1 — gerada em 2026-10-19

> Atualização da 1.5.0, gerada a pedido do usuário. Notas no app, em
> `src/renderer/src/lib/releaseNotes.ts`.

### Correções

- 🧪 O avatar em GIF agora fica animado de verdade. Na 1.5.0, o GIF
  enviado era salvo como foto parada (no app e no Prisma Web).

---

## 1.5.0 — gerada em 2026-10-19

> Gerada a pedido do usuário em 2026-10-19, com os itens abaixo ainda
> 🧪. Notas no app, em `src/renderer/src/lib/releaseNotes.ts`.
>
> ⭐ **Destaque da versão: agora dá para usar um GIF como avatar!**
> Envie um GIF animado pela janela de Perfil e ele aparece se mexendo em
> todo lugar do Prisma — no app e no Prisma Web.
>
> (Pedido do usuário, 2026-10-19: a novidade do GIF é anunciada AQUI, e
> não num card dentro do Perfil. Na hora de publicar, ela vira o
> `summary` da versão no `releaseNotes.ts` e o primeiro item de
> Novidades.)

### Novidades

- 🧪 ⭐ Seu avatar agora pode ser um **GIF animado** — envie um pela
  janela de Perfil e ele aparece se mexendo em todo lugar do Prisma, no
  app e no Prisma Web.
- 🧪 Nova janela de **Perfil**: clique no seu avatar e em "Ver perfil"
  para ver e editar sua foto e seu nome, com tudo explicado.
- 🧪 Agora dá para **trocar a senha** pelo próprio app, direto na janela
  de Perfil: enviamos um código para o seu e-mail, você confirma e
  escolhe a senha nova — sem precisar sair da conta.

### Melhorias

- 🧪 As miniaturas das janelas e das telas na hora de escolher o que
  transmitir ficaram mais nítidas.
- 🧪 A lista de janelas não trava mais a rolagem quando se atualiza
  sozinha.
- 🧪 Quem assiste agora também ouve o som de entrada ao entrar numa
  live, e o de saída ao sair dela.

### Correções

- 🧪 Entrar no app com uma live já no ar não toca mais o som de "live
  nova". O som continua tocando quando alguém entra ao vivo depois.
- 🧪 A lista de jogos reconhecidos voltou a ser atualizada ao abrir o
  app (falhava antes do login). Ela agora é baixada em segundo plano
  durante o carregamento, sem a tela de "Atualizando dependências".
- 🧪 A tela principal já abre com a lista de lives atualizada, logo
  depois do login.
- 🧪 Janelas que não estão abertas de verdade não aparecem mais na
  lista de janelas.
- 🧪 Depois que quem transmite atualizava a live (trocando a fonte, a
  resolução ou o FPS), quem estava assistindo podia ficar sem ouvir o
  som. Corrigido.

---

## 1.4.1 — ✅ gerada em 2026-10-17

> Liberada pelo usuário pra publicar em 2026-10-17. Notas no app, em `src/renderer/src/lib/releaseNotes.ts`.

### Correções

- ✅ Transmitindo a tela inteira, a live podia congelar a cada segundo
  para quem estava assistindo. Corrigido.
- ✅ As opções de FPS voltaram a ser 30 e 60 em qualquer monitor (em
  monitores de 144 Hz apareciam 24 e 48).

---

## 1.4.0 — ✅ publicada em 2026-10-16

> Testada pelo usuário em 2026-10-16. Notas no app, em `src/renderer/src/lib/releaseNotes.ts`.
>
> O início instantâneo da live e o dialog novo de escolher a fonte
> entraram nesta mesma versão, antes de ela subir (pedido do usuário),
> descritos de forma genérica nos dois itens sobre iniciar a live.

### Melhorias

- ✅ Lives mais estáveis: revisamos todo o caminho da transmissão, de
  quem transmite até quem assiste, para reduzir travamentos e engasgos —
  inclusive com várias lives no ar ao mesmo tempo.
- ✅ Menos atraso entre o que acontece na sua tela e o que os
  espectadores veem, deixando a live mais próxima do tempo real.
- ✅ O FPS da transmissão agora acompanha o ritmo do jogo e do seu
  monitor, para uma imagem mais lisa e sem tremidas.
- ✅ Mudamos a forma de iniciar uma live: ficou mais simples e muito mais
  rápido entrar no ar.
- ✅ A tela de escolher o que transmitir ganhou um layout e um design
  novos.
- ✅ A lista de janelas e telas abre mais rápido e se atualiza sozinha —
  abriu um jogo ou um programa, ele já aparece para ser escolhido.
- ✅ O som da live ficou mais resistente a oscilações de internet, com
  menos cortes para quem está assistindo.
- ✅ As estatísticas da live agora abrem com um clique e ficam visíveis
  enquanto você precisar, com mais informações sobre a qualidade da
  transmissão.
- ✅ Demos um trato no visual do aplicativo: telas, ícones, botões e
  detalhes de acabamento ficaram mais bonitos e mais consistentes entre
  si.
- ✅ Melhorias gerais de desempenho e estabilidade, para o app responder
  mais rápido no dia a dia.

### Correções

- ✅ A lista de transmissão não mostra mais janelas duplicadas nem
  janelas internas do Windows que não deveriam estar lá.
- ✅ Corrigidos pequenos detalhes de visual que apareciam fora do padrão
  em algumas telas.

---

## 1.3.0 — ✅ publicada em 2026-10-01

> Testada pela build 1.2.1. Notas no app, em `src/renderer/src/lib/releaseNotes.ts`.

### Novidades

- ✅ **Esqueceu a senha?** Agora dá pra recuperar sozinho: na tela de
  login, clique em "Esqueci minha senha" e um código de 6 dígitos chega
  no e-mail da conta. Ele vale por 15 minutos. Ao trocar a senha, todos
  os aparelhos conectados naquela conta são desconectados — inclusive o
  de quem tivesse entrado nela sem você saber.
- ✅ Agora dá pra assistir às lives pelo **navegador**, em
  **prisma-site.com.br/app** — no computador ou no celular, sem instalar
  nada. É o mesmo Prisma, com as mesmas lives, o mesmo chat e a mesma
  lista de usuários; só não dá pra transmitir por lá.

### Correções

- ✅ Ao parar a sua transmissão com gente assistindo, o app não toca mais
  o som de "alguém saiu" antes do som de live encerrada. Esse som voltou
  a significar só o que ele diz: alguém escolheu sair da sua live.
- ✅ Ao parar a sua transmissão, a sala some de vez. Ela não volta mais
  pra lista alguns segundos depois, sem host, pra só então desaparecer.
- ✅ Quem estava assistindo é desconectado na hora em que a live acaba,
  em vez de ficar preso numa sala que não existe mais.
- ✅ Transmissões que ficavam "penduradas" na lista, sem ninguém
  transmitindo nelas, são removidas sozinhas.
- ✅ Uma live não aparece mais na lista sem foto e sem nome ("Live de
  ???"), ganhando essas informações dois ou três segundos depois. Ela só
  entra na lista quando a transmissão está de fato no ar — e aí já
  aparece completa.
- ✅ O tempo de duração da live passa a contar de quando a transmissão
  entra no ar, e não de quando você clica em iniciar. Antes ele já
  começava alguns segundos adiantado.
- ✅ Uma transmissão **privada** continua privada ao trocar a fonte no
  meio dela. Em algumas trocas ela voltava pública, e passava a aparecer
  na lista de todo mundo sem nenhum aviso.
- ✅ Trocar a fonte no meio da live também não reinicia mais o tempo de
  duração dela.
- ✅ O botão do chat em destaque (mensagem nova) não perde mais o destaque
  quando o cursor passa por cima dele.
- ✅ Assistindo a várias lives num monitor EM PÉ, elas não são mais
  cortadas em cima e embaixo: a partir de agora as lives encolhem juntas
  até caberem todas na área de exibição.

### Melhorias

- ✅ Só quem iniciou uma transmissão pode encerrá-la.
- ✅ Na lista de usuários, cada pessoa tem um menu próprio: passe o mouse
  sobre ela e clique na setinha. É de lá que saem "Fixar/Desfixar" e
  "Convidar para a live", que antes eram dois botões soltos.
- ✅ Ficou mais fácil identificar cada um na lista: quem você fixou se
  destaca no tile, e quem já está assistindo a sua live aparece marcado.
  Quando não dá pra convidar alguém, o menu diz o motivo.
- ✅ Convidar ficou mais simples: a opção é sempre a mesma e pode ser
  clicada quantas vezes você quiser. A regra continua — enquanto a pessoa
  não responder, um novo clique não manda outro convite nem mexe no tempo
  que ela tem pra responder.
- ✅ As informações da sua transmissão foram reunidas no rodapé: quem está
  assistindo agora fica ali, ao lado dos dados da live, e enquanto ela
  sobe o rodapé avisa que está iniciando. O selo da sua live virou "LIVE"
  em vermelho — o verde continua marcando as lives dos outros.
- ✅ Detalhes de leitura: nomes compridos de jogo ou de janela deslizam em
  vez de terminar em reticências, e a aba do chat de uma sala acende em
  laranja quando chega mensagem nova.
- ✅ Transmitindo uma JANELA, o jogo ou programa já vai junto desde o
  primeiro instante. Transmitindo um MONITOR inteiro, aparece primeiro o
  nome da tela e, alguns segundos depois, o jogo que for detectado.
- ✅ O volume com que você assiste fica guardado: mexeu no volume (ou
  deixou no mudo), a próxima live que você entrar já começa assim.
  Assistindo a várias ao mesmo tempo, mudar o volume de uma continua sem
  mexer no volume das outras.
- ✅ Os botões de controle da sua live, no rodapé, agora dizem para que
  servem: parando o mouse em cima aparece "Preview", "Definições" ou
  "Parar transmissão".
- ✅ O áudio da sua transmissão vai com o dobro de qualidade e sempre em
  estéreo. Antes ele saía abafado, e em algumas máquinas chegava mono pra
  quem assistia.

---

## 1.2.0 — ✅ publicada em 2026-09-25

Notas já no app, em `src/renderer/src/lib/releaseNotes.ts`. Esta versão é
anterior a este arquivo e está aqui só como marco.
