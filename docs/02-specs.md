# Tô Chegando — Especificação Técnica

> Status: rascunho para aprovação · 2026-11-09 · Produto: [01-design.md](01-design.md)

## 1. Stack

Mesma base do Mentira!, para reaproveitar o que já funciona no Render.

| Camada | Escolha |
|---|---|
| Servidor | Node 24, Express 5, Socket.IO 4.8, TypeScript. Estado em memória, sem banco. |
| Cliente | Angular 22 (standalone, signals, zoneless) + Angular Material 22 (CDK drag-drop para reordenar). PWA instalável (manifest). |
| Mapa | Leaflet 1.9 com tiles raster do OpenStreetMap. Sem chave de API. |
| Rotas e ETA | OSRM (servidor público `router.project-osrm.org`), chamado **pelo servidor**. |
| Endereços | Nominatim (OpenStreetMap), chamado **pelo servidor**: geocodificação reversa e busca. |
| Monorepo | npm workspaces: `shared/`, `server/`, `client/`. |
| Testes | Vitest (servidor) + script de simulação com clientes Socket.IO reais. |
| Deploy | Render, plano gratuito, um único web service (`render.yaml`). |

Os serviços públicos de OSRM e Nominatim são gratuitos, sem garantia de disponibilidade e com limite de uso (Nominatim: 1 requisição/s, com `User-Agent` identificando o app). Para uso pessoal bastam. As URLs ficam em variáveis de ambiente (`OSRM_URL`, `NOMINATIM_URL`) para trocar de provedor sem mexer no código.

## 2. Estrutura do repositório

```
shared/src/
  types.ts         tipos do domínio e do protocolo
  constants.ts     limites e intervalos
  geo.ts           haversine, distância ponto-rota, decodificação de polyline
server/src/
  index.ts         bootstrap: Express + Socket.IO + estáticos
  trips/
    Trip.ts        regras puras da viagem (sem I/O)
    view.ts        Trip -> TripView (o que cada cliente recebe)
    TripStore.ts   Map<code, Trip> + expiração
    eta.ts         decide quando recalcular e distribui ETAs
  routing/
    osrm.ts        cliente OSRM (rota, otimização de ordem)
    nominatim.ts   reverso + busca, fila de 1 req/s, cache
  handlers.ts      eventos Socket.IO
server/scripts/
  simulate.ts      viagem completa com 3 clientes
client/src/app/
  core/            socket, store (signals), sessão, geolocalização, wake lock
  pages/           home, trip (decide a tela pelo estado)
  views/           invite, stops, driving, join, pin, tracking, ended
  shared/          mapa (wrapper Leaflet), folha inferior, pinos, formatadores
docs/
render.yaml
```

## 3. Modelo de domínio (servidor)

```ts
type LatLng = { lat: number; lng: number };

type Fix = LatLng & {
  accuracy: number;        // metros
  heading: number | null;  // graus
  speed: number | null;    // m/s
  at: number;              // epoch ms (relógio do servidor ao receber)
};

type Role = 'driver' | 'passenger' | 'viewer';

type Member = {
  id: string;              // público
  sessionId: string;       // secreto, só o dono conhece
  name: string;
  role: Role;
  connected: boolean;
  lastFix: Fix | null;
  pickup: Pickup | null;   // só passageiro
};

type Pickup = {
  point: LatLng;
  mode: 'fixed' | 'follow';
  address: string | null;  // via Nominatim
  confirmed: boolean;
};

type Stop = {
  id: string;
  kind: 'member' | 'destination';
  memberId: string | null;
  point: LatLng;
  label: string;           // nome da pessoa ou do destino
  address: string | null;
  status: 'pending' | 'arrived';
  approached: boolean;     // interno: já esteve a ≤ 50 m (não vai na view)
  arrivedAt: number | null;
  arrivedBy: 'auto' | 'manual' | null;
  etaSeconds: number | null;   // a partir de route.computedAt
};

type Route = {
  geometry: string;        // polyline codificada (precisão 5)
  legs: { seconds: number; meters: number }[];  // um por parada pendente
  computedAt: number;
  from: LatLng;            // posição do motorista usada no cálculo
};

type Trip = {
  code: string;            // 6 chars de 23456789ABCDEFGHJKMNPQRSTUVWXYZ
  phase: 'lobby' | 'driving' | 'ended';
  createdAt: number;
  driverId: string;
  members: Map<string, Member>;
  stops: Stop[];           // ordem = ordem de visita; destino sempre por último
  route: Route | null;
  trail: LatLng[];         // rastro do motorista, só em 'driving'
};
```

## 4. Estados da viagem

```
lobby ──start──► driving ──última parada concluída / end──► ended
  └──────────────────────end─────────────────────────────────┘
```

- **lobby**: pessoas entram, marcam ponto; motorista ordena paradas e define destino. A rota já é calculada aqui (prévia na tela "Montar paradas").
- **driving**: posição do motorista ao vivo, rastro, ETAs, chegadas. Ainda é possível entrar, reordenar paradas pendentes, adicionar/remover paradas.
- **ended**: estado final. A viagem é apagada da memória 10 min depois (tempo para todos verem "Viagem encerrada").

Expiração: viagem em `lobby` ou `driving` sem nenhuma mensagem do motorista por 2 h é encerrada. Limite absoluto de 12 h.

## 5. Localização

### 5.1 Cliente
- `navigator.geolocation.watchPosition` com `enableHighAccuracy: true`, `maximumAge: 0`, `timeout: 15000`.
- Motorista em `driving`: envia a cada nova leitura, no máximo 1 a cada 2 s, e só se moveu ≥ 5 m ou passaram 10 s (batimento).
- Motorista em `lobby` e passageiros: no máximo 1 a cada 10 s.
- Leituras com `accuracy > 100 m` são enviadas, mas marcadas; o servidor não as usa para detectar chegada nem para o rastro.
- Wake Lock (`navigator.wakeLock.request('screen')`) ativo enquanto o motorista está em `driving`. Readquirido a cada `visibilitychange` para visível. Se a API não existir, o app mostra um aviso para manter a tela ligada.
- Exige HTTPS (o Render já fornece). Em desenvolvimento, `localhost` funciona; no celular pela rede local é preciso túnel HTTPS.

### 5.2 Servidor
- Guarda só a última posição de cada membro e o rastro do motorista (ponto novo a cada ≥ 15 m, máximo 2000 pontos).
- **Sem sinal**: membro com `lastFix.at` mais antigo que 30 s é enviado como `stale: true`. Um timer por viagem reavalia a cada 10 s e emite atualização quando o estado muda.
- **Chegada automática**, avaliada a cada posição do motorista contra a próxima parada pendente (só leituras com `accuracy ≤ 50 m`; `d` = distância até o ponto):
  - `d ≤ ARRIVE_RADIUS_M` (20 m) → chegou;
  - `d ≤ APPROACH_RADIUS_M` (50 m) → marca `stop.approached = true`;
  - `stop.approached` e `d > DEPART_RADIUS_M` (50 m) → chegou (aproximou e se afastou).
  - Se o ponto da parada mudar (pino ajustado ou modo `follow`), `approached` volta a `false`.
- **Chegada manual**: `stop:arrive`. Vale para qualquer parada pendente, não só a próxima.
- Nos dois casos: `status: 'arrived'`, `arrivedBy: 'auto' | 'manual'`, e o servidor emite `stop:arrived` (§8.3).
- **Ponto "seguir GPS"**: a parada acompanha o `lastFix` do passageiro; só dispara recálculo se andou ≥ 50 m desde a última rota.

## 6. Rota e ETA

- Uma chamada OSRM por recálculo: `GET /route/v1/driving/{motorista};{parada1};{parada2};…?overview=full&geometries=polyline`. Cada `leg` vira o trecho até uma parada; `etaSeconds` da parada N é a soma dos `legs` 1..N.
- **Quando recalcular** (em `eta.ts`):
  - paradas mudaram (ordem, inclusão, remoção, ponto movido, chegada);
  - motorista saiu da rota (distância ponto-polyline > 60 m);
  - passaram 60 s desde o último cálculo e o motorista se moveu;
  - nunca mais de 1 chamada a cada 5 s por viagem (as pendentes são fundidas).
- **Entre recálculos**: o cliente faz a contagem regressiva: `eta = etaSeconds − (agora − computedAt)`, nunca abaixo de 0. Com o motorista `stale`, o cliente congela o valor e mostra `~`.
- **Sugerir melhor ordem**: OSRM `/trip/v1/driving/…?source=first&roundtrip=false` (com `destination=last` quando há destino final). O resultado só reordena as paradas pendentes do tipo `member`.
- **Falha do OSRM**: mantém a última rota. Sem rota nenhuma, o servidor estima por linha reta a 25 km/h e marca `route.approximate = true`; o cliente desenha linha tracejada e mostra `~`.

## 7. Endereços (Nominatim)

- `reverse`: ao confirmar um ponto de encontro ou destino, para o rótulo ("Av. Brasil, 845"). Assíncrono: a parada aparece sem endereço e é atualizada quando a resposta chega.
- `search`: busca do destino final, com viés para a região do motorista (`viewbox`). Disparada com debounce de 600 ms e mínimo de 3 caracteres.
- Fila global de 1 requisição/s, cache em memória (reverso arredondado a 5 casas decimais; busca por texto), `User-Agent: to-chegando/<versão>`.

## 8. Protocolo Socket.IO

### 8.1 Estratégia
Dois canais, para não reenviar a rota inteira a cada posição:

- `trip:state` — o `TripView` completo. Emitido em toda mudança estrutural (membros, paradas, fase, rota, sem sinal).
- `trip:pos` — `{ memberId, fix }`. Emitido a cada posição recebida. Leve e frequente.

### 8.2 Cliente → Servidor (todos com ack `{ ok: true, … } | { ok: false, error }`)

| Evento | Payload | Quem | Efeito |
|---|---|---|---|
| `trip:create` | `{ name }` | — | Cria viagem. Ack: `{ code, memberId, sessionId }`. |
| `trip:join` | `{ code, name, role }` | — | Entra como `passenger` ou `viewer`. Ack: `{ memberId, sessionId }`. |
| `trip:resume` | `{ code, sessionId, snapshot? }` | — | Reassocia o socket ao membro. Ver §9. |
| `pos:update` | `{ lat, lng, accuracy, heading, speed }` | todos | Atualiza `lastFix`. |
| `pickup:set` | `{ point, mode, confirmed }` | passageiro | Define/ajusta o ponto de encontro. |
| `stops:set` | `{ stopIds: string[] }` | motorista | Define quais paradas pendentes entram e em que ordem. |
| `stops:optimize` | — | motorista | Reordena pelo trajeto mais curto. |
| `destination:set` | `{ point, label } \| null` | motorista | Define ou remove o destino final. |
| `geo:search` | `{ query, near }` | motorista | Ack: até 5 resultados `{ label, point }`. |
| `trip:start` | — | motorista | `lobby → driving`. Exige ao menos 1 parada. |
| `stop:arrive` | `{ stopId }` | motorista | Marca chegada manualmente. |
| `member:remove` | `{ memberId }` | motorista | Remove a pessoa e a parada dela. |
| `trip:leave` | — | passageiro/espectador | Sai da viagem. |
| `trip:end` | — | motorista | Encerra. |

### 8.3 Servidor → Cliente

| Evento | Payload |
|---|---|
| `trip:state` | `TripView` |
| `trip:pos` | `{ memberId, fix }` |
| `trip:removed` | — (você foi removido) |
| `stop:arrived` | `{ stopId, memberId, by: 'auto' \| 'manual', at }` — para todos na viagem |

### 8.3.1 Aviso de chegada

Ao receber `stop:arrived` com `memberId` igual ao próprio, o cliente do passageiro:

1. vibra: `navigator.vibrate([400, 150, 400, 150, 800])` (Android; o Safari do iPhone não tem a API, e a chamada é ignorada);
2. toca um som curto de chegada, gerado com Web Audio (sem arquivo de áudio);
3. mostra a tela "Chegou!" (tela 9) até o toque em "Tô indo".

Detalhes:

- **Desbloqueio de áudio**: navegadores só tocam som depois de um gesto do usuário. O `AudioContext` é criado e retomado no toque de "Entrar e marcar meu ponto" / "Só quero acompanhar", e de novo em qualquer toque após uma retomada de sessão.
- **Tela ligada**: a view `tracking` também pede Wake Lock, para o aviso não se perder com a tela apagada.
- **Aviso perdido**: se o passageiro estava com o app em segundo plano, ao voltar o `trip:state` mostra a parada dele como `arrived`; se `arrivedAt` tem menos de 10 min e o aviso ainda não foi dispensado (`localStorage`), a tela "Chegou!" aparece com som e vibração nesse momento.
- Os outros membros recebem o mesmo evento e mostram só um snackbar ("Alexandre chegou na Larissa").
- Sem push na v1: nada chega com o navegador fechado.

### 8.4 TripView

```ts
type TripView = {
  code: string;
  phase: 'lobby' | 'driving' | 'ended';
  you: { memberId: string; role: Role };
  driver: MemberView;
  members: MemberView[];          // sem o motorista
  stops: StopView[];              // ordem de visita
  route: { geometry: string; computedAt: number; approximate: boolean } | null;
  trail: string;                  // polyline codificada
  serverNow: number;              // para corrigir diferença de relógio
};

type MemberView = {
  id: string; name: string; role: Role;
  connected: boolean; stale: boolean;
  fix: Fix | null;
  pickup: { point: LatLng; mode: 'fixed' | 'follow'; address: string | null; confirmed: boolean } | null;
};

type StopView = Omit<Stop, 'approached'>;
```

`sessionId` nunca aparece em nenhuma view. Há um teste dedicado a isso.

### 8.5 Códigos de erro

`TRIP_NOT_FOUND`, `TRIP_ENDED`, `NOT_DRIVER`, `NOT_IN_TRIP`, `INVALID_NAME`, `INVALID_POINT`, `NO_STOPS`, `RATE_LIMITED`, `ROUTING_UNAVAILABLE`.

## 9. Sessão e retomada

Requisito: se o motorista bloquear a tela ou for para outro app, ao voltar o app identifica a sessão aberta e volta a atualizar a localização para os outros.

- **Onde fica a sessão**: `localStorage`, chave `tc:trip:<code>` → `{ memberId, sessionId, role, name }`, e `tc:last` → `code` da viagem ativa. Usa `localStorage` (e não `sessionStorage`) porque o sistema pode matar a aba em segundo plano.
- **Gatilhos de retomada**: carga da página, `visibilitychange` para visível, `pageshow`, `online` e o `connect` do Socket.IO. Em qualquer um deles o cliente:
  1. reconecta o socket se estiver desconectado;
  2. envia `trip:resume`;
  3. reinicia o `watchPosition` (alguns navegadores o suspendem em segundo plano) e envia a posição assim que chegar a primeira leitura;
  4. readquire o Wake Lock.
- **Home**: se existe `tc:last` com viagem não encerrada, o app redireciona direto para `/v/<code>`.
- **Servidor**: desconexão não remove ninguém; marca `connected: false`. O membro só sai por `trip:leave`, `member:remove` ou fim da viagem.
- **Servidor reiniciou** (deploy ou hibernação do plano gratuito): o estado em memória se perde. Para a viagem sobreviver, o motorista guarda em `localStorage` um **snapshot** (`code`, nomes, paradas, destino, fase) atualizado a cada `trip:state`. Se `trip:resume` responder `TRIP_NOT_FOUND` e o cliente for o motorista, ele reenvia `trip:resume` com `snapshot`, e o servidor recria a viagem com o mesmo código. Os passageiros, ao reconectar, caem no fluxo normal de `trip:resume`: o servidor aceita o `sessionId` deles porque veio no snapshot.
  - O snapshot contém os `sessionId` dos membros apenas como hash (SHA-256); o servidor compara hashes.
  - Só é aceito snapshot cujo `code` não exista no servidor e com `createdAt` de no máximo 12 h.

## 10. Validações e limites (`constants.ts`)

| Constante | Valor |
|---|---|
| `NAME_MIN` / `NAME_MAX` | 1 / 20 caracteres |
| `CODE_LENGTH` | 6 |
| `POS_MIN_INTERVAL_MS` | 1500 (servidor descarta acima disso) |
| `STALE_AFTER_MS` | 30 000 |
| `ARRIVE_RADIUS_M` | 20 |
| `APPROACH_RADIUS_M` / `DEPART_RADIUS_M` | 50 / 50 |
| `OFF_ROUTE_M` | 60 |
| `REROUTE_MIN_INTERVAL_MS` | 5000 |
| `REROUTE_MAX_AGE_MS` | 60 000 |
| `TRAIL_MIN_STEP_M` / `TRAIL_MAX_POINTS` | 15 / 2000 |
| `TRIP_IDLE_TTL_MS` / `TRIP_MAX_TTL_MS` | 2 h / 12 h |
| `ENDED_TTL_MS` | 10 min |

Não há limite de membros nem de paradas por viagem. Único efeito prático: o OSRM público aceita cerca de 100 pontos por rota; acima disso o servidor cai na estimativa em linha reta (§6).

Coordenadas: `lat` em [−90, 90], `lng` em [−180, 180], números finitos. Texto de busca: até 100 caracteres.

## 11. Cliente Angular

### 11.1 Rotas

| Rota | Tela |
|---|---|
| `/` | Início (criar viagem) ou redirecionamento para a viagem ativa |
| `/v/:code` | Viagem: o componente escolhe a view pelo papel e pela fase |

### 11.2 Qual view aparece em `/v/:code`

| Situação | View |
|---|---|
| Sem sessão para o código | `join` (tela 5) |
| Passageiro sem ponto confirmado | `pin` (tela 6) |
| Motorista, `lobby`, sem ter avançado | `invite` (tela 2) |
| Motorista, `lobby`, montando | `stops` (tela 3) |
| Motorista, `driving` | `driving` (tela 4) |
| Passageiro ou espectador, `lobby`/`driving` | `tracking` (telas 7 e 8) |
| Passageiro com aviso de chegada não dispensado | `arrived` (tela 9), por cima de `tracking` |
| `ended` | `ended` |

### 11.3 Estado
`TripStore` com signals: `view` (último `TripView`), `positions` (mapa `memberId → Fix`, atualizado por `trip:pos` sem recriar a view), `clock` (tique de 1 s para as contagens regressivas). ETAs exibidos são `computed`.

### 11.4 Mapa
Um componente `tc-map` encapsula o Leaflet: recebe marcadores, rota e rastro por inputs e não expõe a API do Leaflet. O marcador do motorista é animado entre posições (interpolação linear de 1 s) para não "pular". Modo de câmera: `follow` (segue o motorista, padrão para ele), `fit` (enquadra motorista + minha parada, padrão para o passageiro) e `free` (após o usuário arrastar; o botão de centralizar volta ao padrão).

### 11.5 Tema
Tokens do design (§6 de 01-design.md) como custom properties CSS. Material só fornece comportamento (drag-drop, bottom sheet, snackbar); o visual é próprio. Somente tema claro na v1.

### 11.6 PWA
`manifest.webmanifest` (nome, ícones, `display: standalone`, cor do tema) para "Adicionar à tela inicial". Sem service worker na v1: o app não funciona offline e não há o que cachear de útil.

## 12. Servidor HTTP

- `GET /health` → `200 ok` (health check do Render).
- Estáticos do build do Angular, com fallback para `index.html` em `/v/*`.
- Socket.IO na mesma porta (`PORT`, padrão 3000).

## 13. Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor (3000) + Angular (4200) com proxy para o Socket.IO |
| `npm test` | Vitest: regras da viagem, ETA, view, retomada |
| `npm run simulate` | Viagem completa com 3 clientes Socket.IO e OSRM simulado |
| `npm run build` / `npm start` | Build de produção / sobe o servidor servindo o cliente |

Modo de teste sem sair de casa: `/v/:code?sim=1` faz o motorista percorrer a rota calculada a 40 km/h em vez de usar o GPS. Não aparece na interface.

## 14. Deploy (Render)

`render.yaml` igual ao do Mentira!: web service Node, plano `free`, `buildCommand: npm ci --include=dev && npm run build`, `startCommand: npm start`, `healthCheckPath: /health`, uma única instância.

O plano gratuito hiberna após 15 min sem tráfego; a primeira visita leva cerca de 1 min. Durante uma viagem ativa as mensagens mantêm o serviço acordado. Se hibernar no meio (todos com a tela bloqueada), a retomada por snapshot (§9) recupera a viagem.

## 15. Critérios de aceite da v1

1. Motorista cria viagem no celular e compartilha o link pelo menu nativo.
2. Duas pessoas entram pelo link em outros aparelhos, ajustam o pino e confirmam; o motorista as vê na lista em tempo real.
3. Motorista ordena as duas paradas, adiciona um destino final e vê rota e ETA de cada uma antes de sair.
4. Em trajeto, os passageiros veem o carro se mover, o rastro, a rota e a própria contagem regressiva; o ETA se ajusta quando o motorista sai da rota.
5. A parada é concluída sozinha ao chegar a 20 m do ponto, ou ao se aproximar (≤ 50 m) e depois se afastar mais de 50 m; a próxima assume. O botão "Cheguei" faz o mesmo.
5a. Em qualquer forma de chegada, o celular de quem espera vibra (Android), toca um som e mostra "Chegou!", desde que o app esteja aberto.
6. Motorista bloqueia a tela por 1 min: os passageiros veem "Sem sinal". Ao desbloquear, a posição volta a atualizar em até 5 s, sem nenhuma ação.
7. Motorista fecha a aba e reabre o site: cai direto na viagem em andamento.
8. Reiniciar o servidor durante uma viagem: ao reconectar, motorista e passageiros voltam à mesma viagem.
9. Nenhum `sessionId` aparece em qualquer mensagem enviada a outro cliente.
10. Encerrada a viagem, o código deixa de funcionar e não resta posição no servidor.
