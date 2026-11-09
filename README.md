# Tô Chegando

App web para celular em que um **motorista** mostra, ao vivo, que está chegando. Ele cria uma viagem, manda o link para quem vai buscar, escolhe a ordem das paradas e sai. Todo mundo vê o carro no mapa, a rota e quanto tempo falta para a sua vez. Ao chegar, o celular de quem espera vibra e toca.

- Design do produto: [docs/01-design.md](docs/01-design.md)
- Especificação técnica: [docs/02-specs.md](docs/02-specs.md)
- Tasks: [docs/03-tasks.md](docs/03-tasks.md)

## Stack

- **Servidor**: Node 22+, Express 5, Socket.IO 4.8. Estado em memória, sem banco.
- **Cliente**: Angular 22 (standalone, signals, zoneless), Leaflet + MapLibre GL.
- **Mapa**: [OpenFreeMap](https://openfreemap.org) (estilo Positron). Gratuito, sem chave de API.
- **Rotas e endereços**: servidores públicos do OSRM e do Nominatim (OpenStreetMap), chamados pelo servidor.
- **shared/**: tipos, constantes e geometria usados pelos dois lados.

## Rodando

```bash
npm install
```

```bash
npm run dev
```

Sobe o servidor em `http://localhost:3000` e o Angular em `http://localhost:4200`, com proxy para o Socket.IO. Abra `http://localhost:4200`.

Para rodar como em produção (um processo só, na porta 3000):

```bash
npm run build
```

```bash
npm start
```

## Testando sem sair de casa

Dois parâmetros na URL da página inicial, que não aparecem na interface e valem até fechar a aba:

| Parâmetro | O que faz |
|---|---|
| `?sim=1` ou `?sim=lat,lng` | Troca o GPS por uma posição simulada. Em trajeto, o carro percorre a rota sozinho. |
| `&simspeed=150` | Velocidade do carro simulado em km/h (padrão 40). |
| `&bots=3` | Cria a viagem já com N passageiros de mentira (até 8), espalhados em volta do motorista, com ponto confirmado. |

O jeito mais rápido de ver tudo funcionando:

```
http://localhost:3000/?sim=1&bots=3&simspeed=150
```

Crie a viagem, espere os bots entrarem, monte as paradas e comece o trajeto.

### Testar com pessoas de verdade no mesmo computador

A sessão fica no `localStorage`, que é por endereço: duas abas em `localhost` são a mesma pessoa. Para cada participante, use um endereço diferente (`localhost:3000`, `127.0.0.1:3000`, `[::1]:3000`), uma janela anônima ou outro navegador. Cada um pode ter seu próprio `?sim=lat,lng`.

### Testar no celular

A localização só funciona em HTTPS (ou em `localhost`). Pela rede local, o celular abre o site mas o navegador recusa o GPS. Use o deploy no Render, ou um túnel HTTPS.

## Testes

```bash
npm test
```

Testes unitários (Vitest) das regras da viagem: paradas, chegada, rastro, ETA, retomada e o filtro que impede que a sessão de alguém vaze para os outros.

```bash
npm run simulate
```

Viagem completa com 3 clientes Socket.IO reais, sem rede externa: entrada, paradas, trajeto, chegadas, queda e retomada, reinício do servidor.

## Variáveis de ambiente

Todas opcionais.

| Variável | Padrão | Para quê |
|---|---|---|
| `PORT` | `3000` | Porta do servidor |
| `OSRM_URL` | `https://router.project-osrm.org` | Servidor de rotas |
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org` | Servidor de endereços |
| `USER_AGENT` | `to-chegando/0.1` | Identificação exigida por esses serviços |
| `ROUTING` | — | `offline`: sem chamadas externas (rotas em linha reta, sem endereços) |

## Deploy no Render (gratuito)

O [render.yaml](render.yaml) já descreve o serviço. No painel do Render, use **New → Blueprint**, escolha este repositório e confirme. Cada push na `main` faz um novo deploy.

No plano gratuito, o serviço dorme após 15 minutos sem uso, e a primeira visita depois disso leva cerca de 1 minuto. Durante uma viagem ele não dorme. Se o servidor reiniciar no meio de uma viagem, o celular do motorista a recria com o mesmo link ao reconectar.

Rode **uma única instância**: o estado fica em memória.

## Limitações do navegador

- Com a tela bloqueada ou em outro app, o envio da localização para. O app mantém a tela ligada e retoma sozinho ao voltar.
- O aviso de chegada (vibração e som) só dispara com o app aberto. O iPhone não vibra.
- Sem navegação por voz: o motorista usa o próprio mapa do app.

## Estrutura

```
shared/src/          tipos, constantes, geometria (haversine, polyline)
server/src/trips/    regras da viagem (Trip), view, ETA, armazenamento + testes
server/src/routing/  OSRM, Nominatim e estimativa em linha reta
server/src/          eventos Socket.IO (handlers), bootstrap
server/scripts/      simulação de viagem
client/src/app/core/ socket, store (signals), sessão, GPS, tela ligada e alerta
client/src/app/      pages (início, viagem), views (uma por tela), shared (mapa, ícones)
```
