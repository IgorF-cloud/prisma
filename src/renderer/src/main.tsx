import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ViewerOverlay from './overlay/ViewerOverlay'

// A janela da SOBREPOSIÇÃO de viewers (src/main/overlay.ts) carrega
// ESTE MESMO bundle, só que com `#overlay` na URL — o Chromium já o tem
// em cache, então a segunda janela custa pouco e o build continua com
// um ponto de entrada só.
//
// A escolha é feita AQUI, e não com um early-return dentro do App: lá
// ela viria antes dos hooks, o que quebra a regra de ordem do React (o
// lint reclama, e com razão). Aqui são duas árvores distintas, cada uma
// com os próprios hooks.
//
// A overlay não entra em <StrictMode>: o duplo-render dele em dev faria
// o ResizeObserver dela medir e reportar altura duas vezes a cada
// mudança, redimensionando a janela à toa.
const isOverlayWindow = window.location.hash === '#overlay'

// O `body` e o `#root` do app têm fundo opaco, `min-height: 100vh` e
// centralização (ver base.css/main.css). Na janela da sobreposição isso
// pintaria um retângulo escuro cobrindo a tela inteira e anularia o
// `transparent: true` dela. A classe abaixo neutraliza os três — ver
// `body.overlay-window` no main.css.
if (isOverlayWindow) {
  document.body.classList.add('overlay-window')
}

createRoot(document.getElementById('root')!).render(
  isOverlayWindow ? (
    <ViewerOverlay />
  ) : (
    <StrictMode>
      <App />
    </StrictMode>
  )
)
