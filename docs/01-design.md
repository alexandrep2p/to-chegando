# Tô Chegando — Design do Produto

> Status: rascunho para aprovação · 2026-11-09
> Telas: [canvas no Claude Design](https://claude.ai/artifact/QpF3qQaNF3XjS3xZvjNjhh)

## 1. Visão

App web para celular em que um **motorista** mostra, ao vivo, que está chegando. Ele cria uma viagem, manda o link para as pessoas que vai buscar, escolhe a ordem das paradas e sai. Todo mundo vê o carro andando no mapa, a rota e **quanto tempo falta para a sua vez**.

Exemplo: Alexandre compartilha com Larissa e com a mãe. As duas abrem o link e marcam onde vão esperar. Alexandre põe Larissa como 1ª parada e a mãe como 2ª. O app traça a rota e mostra "4 min" para Larissa e "11 min" para a mãe, atualizando enquanto ele dirige.

Sem cadastro, sem instalar nada: é um link.

## 2. Papéis

| Papel | O que faz |
|---|---|
| **Motorista** | Cria a viagem, compartilha o link, ordena as paradas, define um destino final opcional, inicia o trajeto e envia a própria localização ao vivo. Marca "cheguei" em cada parada e encerra a viagem. |
| **Passageiro** | Entra pelo link com um apelido, compartilha a localização para marcar o **ponto de encontro**, ajusta o pino se quiser e acompanha o motorista no mapa. |
| **Espectador** | Entra pelo link e escolhe "Só quero acompanhar": vê o mapa, mas não vira parada nem envia localização. |

Todos na viagem veem todos: o motorista, as paradas e a ordem.

Uma viagem tem 1 motorista e quantas pessoas ele quiser: não há limite de participantes.

## 3. Fluxo

```
MOTORISTA                                   PASSAGEIRO
Início ─► Convidar ─► Montar paradas ─► A caminho ─► Fim
             ▲              ▲               │
             │              │               ▼
          Entrar ─► Ajustar ponto ─► Acompanhando ─► Fim
```

### 3.1 Início (tela 1)
O motorista digita o nome e toca em **Criar viagem**. O app pede permissão de localização e gera um link curto (`/v/K7M2QX`).

### 3.2 Convidar (tela 2)
Mostra o link, QR code, **Compartilhar** (menu nativo do celular, cai no WhatsApp) e **Copiar link**. Abaixo, a lista de quem já entrou, com o estado de cada um: "Ajustando o ponto…" ou "Ponto confirmado · 2,1 km de você". O motorista segue para **Montar paradas** quando quiser, e quem entrar depois ainda pode ser incluído.

### 3.3 Entrar pelo link (tela 5)
Quem abre o link vê quem está convidando, digita o apelido e lê, antes do pedido do navegador, para que serve a localização. Dois caminhos: **Entrar e marcar meu ponto** ou **Só quero acompanhar**.

### 3.4 Ajustar ponto de encontro (tela 6)
O mapa abre no GPS do passageiro, com o círculo de precisão. Ele move o mapa até o pino ficar onde vai esperar. GPS dentro de casa erra dezenas de metros, então o ajuste importa. Dois modos:

- **Ponto fixo** (padrão): o motorista vai até o pino, mesmo que o passageiro ande.
- **Seguir meu GPS**: o ponto acompanha o celular do passageiro.

O passageiro pode voltar a esta tela a qualquer momento por **Ajustar meu ponto**.

### 3.5 Montar paradas (tela 3)
Lista das pessoas com ponto confirmado, em ordem. O motorista arrasta para reordenar. Cada linha mostra o endereço aproximado e o tempo até chegar lá. No fim da lista, **destino final opcional** (busca de endereço ou toque no mapa). Rodapé com tempo e distância totais. **Sugerir melhor ordem** reordena pelo trajeto mais curto. **Começar trajeto** inicia.

Pessoas sem ponto confirmado aparecem abaixo, desabilitadas.

### 3.6 A caminho — motorista (tela 4)
Mapa em tela cheia: posição do carro, rastro já percorrido (apagado), rota à frente (azul), paradas numeradas. No rodapé, a **próxima parada** em destaque com tempo, distância e hora de chegada, e as paradas seguintes resumidas. Botão **Cheguei na Larissa**.

Chegada: uma parada é concluída de três formas:

- o carro chega a **20 m** do ponto;
- o carro se aproximou do ponto (entrou a menos de 50 m) e depois **se afastou mais de 50 m** dele, caso de quem parou um pouco antes ou passou direto;
- o motorista toca em **Cheguei**.

Nos três casos a pessoa daquela parada é avisada (ver 3.7). Concluída a parada, a seguinte vira a próxima. Depois da última, a viagem termina.

No menu (⋯): reordenar paradas, compartilhar o link de novo, remover alguém, encerrar viagem.

### 3.7 Acompanhando — passageiro (tela 7)
O mesmo mapa, do ponto de vista de quem espera. Em destaque: **"Alexandre chega em 11 min"** e a hora prevista. Abaixo, a fila: "Antes passa na Larissa · 4 min", "Você · 11 min", "Depois: Cantina do Bairro". Quando o motorista está a menos de 2 minutos, o destaque muda para **"Tá chegando!"**.

**Aviso de chegada (tela 9):** quando a parada da pessoa é concluída, por proximidade ou pelo botão do motorista, o celular dela **vibra, toca um som** e a tela inteira muda para **"Alexandre chegou!"**, até ela tocar em "Tô indo". Os demais só veem a fila avançar.

O aviso depende de o Tô Chegando estar aberto na tela de quem espera: com a tela bloqueada o navegador não vibra nem toca. Por isso a tela de acompanhamento também mantém a tela ligada. Vibração não existe no iPhone (limitação do Safari); lá o aviso é som e tela.

### 3.8 Sem sinal (tela 8)
Se o servidor fica 30 s sem receber a posição do motorista, os outros veem o aviso "Sem sinal do Alexandre há 2 min", o carro fica cinza na última posição conhecida e os tempos passam a ser mostrados como aproximados ("~11 min"). Quando o sinal volta, tudo retorna ao normal sozinho.

### 3.9 Fim
O motorista encerra, ou a última parada é concluída. Todos veem "Viagem encerrada". Localizações e rastro são apagados do servidor.

## 4. Localização ao vivo: o que o navegador permite

Um site só recebe a localização enquanto está **aberto e visível**. Com a tela bloqueada ou em outro app, o envio para. O design assume isso:

- **Tela ligada**: enquanto o motorista compartilha, o app impede a tela de apagar sozinha (Wake Lock). O selo "Ao vivo" confirma que a posição está saindo.
- **Retomada automática**: o app guarda a sessão no celular. Ao voltar para o Tô Chegando (desbloqueou a tela, voltou de outro app, reabriu a aba ou o link), ele reconhece a viagem aberta, reconecta e volta a enviar a posição na hora, sem perguntar nada.
- **Transparência**: no intervalo, os outros veem a tela 8 em vez de um carro parado sem explicação.

O motorista usa o próprio Tô Chegando como mapa durante o trajeto (sem instruções por voz).

## 5. Privacidade

- A localização só é vista por quem tem o link da viagem.
- O link é um código aleatório de 6 caracteres; o motorista pode remover qualquer pessoa.
- Nada é gravado em banco. Ao encerrar a viagem, posições e rastro somem do servidor. Viagens esquecidas expiram sozinhas.

## 6. Linguagem visual

- **Mapa é o protagonista**: telas de trajeto são mapa em tela cheia com uma folha inferior.
- **Cores**: tinta `#14213D`, fundo `#F6F7F4`, azul `#2F5BEA` (motorista, rota, ação principal), laranja `#F26B1D` (paradas). Azul e laranja se distinguem também para daltônicos. Cinza para "sem sinal".
- **Tipografia**: Space Grotesk nos títulos e números de tempo, Inter no texto.
- **Tempo em destaque**: o número de minutos é sempre o maior elemento da folha.
- **Toque**: alvos de no mínimo 44 px, pensados para celular no suporte do carro.
- **Tom**: português informal e direto ("Tô chegando", "Alexandre vai passar aí").

## 7. Fora do escopo da v1

- Rastreio com tela bloqueada (exigiria app nativo).
- Navegação curva a curva com voz.
- Contas, contatos e histórico de viagens.
- Notificações push.
- Mais de um motorista por viagem.
