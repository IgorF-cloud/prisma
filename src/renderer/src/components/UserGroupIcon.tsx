import { createLucideIcon } from 'lucide-react'

// O `user-group` do lucide (https://lucide.dev/icons/user-group), escolhido
// pelo usuário pro botão de Membros (2026-10-21). Ele só existe a partir
// do lucide-react 1.49, e o app está na 1.35 — então o desenho vem copiado
// daqui, pela mesma fábrica que o lucide usa pros dele. Quando o
// lucide-react do app subir, troca por `import { UserGroup }` e apaga
// este arquivo (o Prisma Web já usa o oficial).
const UserGroupIcon = createLucideIcon('user-group', [
  ['path', { d: 'M17 21v-1a2 2 0 00-2-2H9a2 2 0 00-2 2v1', key: '13eq7e' }],
  ['path', { d: 'M19 10h1a2 2 0 012 2v1', key: '172ugw' }],
  ['path', { d: 'M5 10H4a2 2 0 00-2 2v1', key: '1yb089' }],
  ['circle', { cx: '12', cy: '11', r: '3', key: 'itu57m' }],
  ['circle', { cx: '18', cy: '4', r: '2', key: 'bubz31' }],
  ['circle', { cx: '6', cy: '4', r: '2', key: 'lisof6' }]
])

export default UserGroupIcon
