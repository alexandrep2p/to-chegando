# Tô Chegando — Tasks

> Status: rascunho para aprovação · 2026-11-09 · Specs: [02-specs.md](02-specs.md)

## Fase 0 — Fundação

- [ ] `git init`, `.gitignore`, monorepo npm workspaces (`shared`, `server`, `client`)
- [ ] `shared`: tipos, constantes, `geo.ts` (haversine, ponto-polyline, polyline encode/decode) com testes
- [ ] Servidor Express + Socket.IO com `/health` e estáticos
- [ ] Cliente Angular 22 zoneless, tokens do tema, fontes, proxy de dev
- [ ] `render.yaml` e README

## Fase 1 — Viagem no servidor (com testes)

- [ ] `Trip`: criar, entrar, sair, remover, papéis (sem limite de pessoas)
- [ ] Ponto de encontro (`fixed` / `follow`) e paradas (ordem, destino final)
- [ ] `view.ts` + teste de que `sessionId` nunca vaza
- [ ] `TripStore`: códigos, expiração, viagem encerrada
- [ ] Posições: limite de frequência, rastro, sem sinal, chegada (20 m, aproximou-e-afastou, manual) e evento `stop:arrived`
- [ ] Handlers Socket.IO de todos os eventos da spec §8

## Fase 2 — Rota, ETA e endereços

- [ ] Cliente OSRM (`route`, `trip`) com timeout e fallback em linha reta
- [ ] `eta.ts`: regras de recálculo e fusão de pedidos
- [ ] Nominatim: reverso + busca, fila de 1 req/s, cache
- [ ] Testes com OSRM e Nominatim simulados

## Fase 3 — Cliente

- [ ] `core`: socket, `TripStore` (signals), sessão em `localStorage`, serviço de geolocalização, Wake Lock
- [ ] `tc-map`: wrapper do Leaflet (marcadores, rota, rastro, modos de câmera, animação do motorista)
- [ ] Telas do motorista: início, convidar (QR + compartilhar), montar paradas (arrastar), a caminho
- [ ] Telas do passageiro: entrar, ajustar ponto, acompanhando, sem sinal
- [ ] Aviso de chegada: vibração, som (Web Audio), tela "Chegou!", aviso perdido ao voltar ao app
- [ ] Tela de viagem encerrada e estados de erro (link inválido, permissão negada)

## Fase 4 — Retomada e robustez

- [ ] Retomada por `visibilitychange` / `pageshow` / `online` / reconexão
- [ ] Redirecionamento da home para a viagem ativa
- [ ] Snapshot do motorista e recriação da viagem após reinício do servidor
- [ ] Modo `?sim=1` (motorista percorre a rota sem GPS)
- [ ] `npm run simulate`: viagem completa com 3 clientes, incluindo queda e retomada

## Fase 5 — Acabamento e deploy

- [ ] Manifest PWA e ícones
- [ ] Verificação no navegador em largura de celular, tela por tela, contra o design
- [ ] Repositório no GitHub e deploy no Render (Blueprint)
- [ ] Teste real: dois celulares, um trajeto curto
