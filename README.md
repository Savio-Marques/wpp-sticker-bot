# wpp-sticker-bot

Bot enxuto de criação de figurinhas para WhatsApp usando **Baileys v7**, **Sharp** e **FFmpeg**, preparado para rodar em container Docker **ARM64** (Oracle Always Free VPS).

## Recursos

- Converte **imagens**, **GIFs** e **vídeos** em figurinhas WebP `512×512` (corte quadrado centralizado).
- Cria **figurinhas com som** (`!figsom` / `!ss`) a partir de vídeos com áudio ou imagem respondendo a um áudio/nota de voz.
- Vídeos e GIFs são cortados automaticamente nos primeiros `MAX_VIDEO_SECONDS` (padrão `7s`) com compressão adaptativa para respeitar o limite de **500 KB** do WhatsApp.
- Injeta metadados EXIF fixos (`STICKER_PACK` e `STICKER_AUTHOR`) via `node-webpmux`.
- Seguro para rodar no **número pessoal** (`fromMe: true` com proteção anti-loop e `markOnlineOnConnect: false`).
- Whitelist de grupos e usuários persistida em `DATA_DIR/whitelist.json` e gerenciada pelo próprio WhatsApp.

## Comandos

- `!fig` ou `!s` (na legenda da mídia ou respondendo uma mídia): cria a figurinha.
- `!figsom` ou `!ss`: cria figurinha **com som** (em um vídeo com áudio, ou enviando imagem com `!figsom` respondendo a um áudio).
- `!help`: mostra os comandos disponíveis.
- `!allow` (somente dono): libera o chat/grupo atual. Use `!allow 5511999999999` para liberar um número específico.
- `!deny` (somente dono): remove o chat/grupo atual ou o número informado da whitelist.
- `!list` (somente dono): lista chats e usuários autorizados.

## Desenvolvimento Local

```bash
cp .env.example .env
npm install
npm run dev
```

Comandos úteis:

```bash
npm run typecheck
npm test
npm run build
```

## Variáveis de Ambiente

Veja [`.env.example`](.env.example).

| Variável | Descrição | Padrão |
| --- | --- | --- |
| `PHONE_NUMBER` | Número para Pairing Code (somente dígitos) | — |
| `OWNER_JID` | JID do dono (fallback além de `fromMe`) | — |
| `STICKER_PACK` | Nome do pacote na figurinha | `Sticker Bot` |
| `STICKER_AUTHOR` | Autor da figurinha | `WhatsApp Bot` |
| `MAX_VIDEO_SECONDS` | Duração máxima de vídeos/GIFs | `7` |
| `MAX_AUDIO_SECONDS` | Duração máxima do áudio (Imagem + Áudio) | `10` |
| `MAX_INPUT_MB` | Tamanho máximo da mídia de entrada (MB) | `25` |
| `MAX_CONCURRENT_JOBS` | Conversões simultâneas | `2` |
| `MAX_QUEUE_SIZE` | Máximo de itens aguardando na fila | `20` |
| `USER_COOLDOWN_MS` | Cooldown por usuário não-dono (ms) | `5000` |
| `DATA_DIR` | Diretório persistente (`auth` e `whitelist.json`) | `./data` (`/data` no Docker) |
| `HEALTH_PORT` | Porta HTTP para `GET /health` | `8080` |

## Deploy na Oracle VPS (CI/CD)

1. Configure os secrets no repositório GitHub:
   - `DOCKERHUB_USERNAME`
   - `DOCKERHUB_TOKEN`
   - `VPS_HOST`
   - `VPS_USER`
   - `VPS_SSH_KEY`
2. Na VPS, crie `~/wpp-sticker-bot/.env` baseado em `.env.example` (com `DATA_DIR=/data`).
3. Após o primeiro deploy pelo GitHub Actions, acompanhe os logs para parear o WhatsApp:
   ```bash
   cd ~/wpp-sticker-bot
   docker-compose logs -f
   ```
4. No celular: **WhatsApp → Aparelhos conectados → Conectar aparelho → Conectar com número de telefone** e digite o Pairing Code exibido nos logs.
