# syntax=docker/dockerfile:1
# =============================================================================
# Cooperativa — ambiente de demonstração
#
# A aplicação da pasta tem duas partes, e a imagem roda as duas juntas:
#   server/  → API Flask + painel de testes          (porta 4747)
#   mobile/  → app Expo/React Native                 (bundle web na porta 8085)
#
# O painel em http://localhost:4747/panel abre as duas janelas mobile em
# http://localhost:8085 — por isso a porta 8085 é publicada junto com a 4747.
# =============================================================================

# ─── Etapa 1: build da versão web do app mobile ──────────────────────────────
FROM node:20-bookworm-slim AS web

ENV CI=1 \
    EXPO_NO_TELEMETRY=1 \
    NODE_OPTIONS=--max-old-space-size=4096

WORKDIR /app/mobile

# Camada de dependências: só refaz o npm ci quando package.json/lock mudam.
# --legacy-peer-deps: o lockfile é consistente, mas o npm 10 do node:20 tenta
# instalar @types/react@19 apenas por metadata de peer. Tipos não entram no bundle.
COPY mobile/package.json mobile/package-lock.json ./
RUN npm ci --no-audit --no-fund --legacy-peer-deps

# Fontes da demo. node_modules, .expo e dist locais ficam fora pelo .dockerignore,
# para o bundle ser sempre gerado a partir do lockfile dentro do container.
COPY mobile/ ./

# Export estático (SPA) — o mesmo app que o Metro serve na porta 8085.
RUN EXPO_PUBLIC_DEV_SERVER_URL=http://localhost:4747 npx expo export --platform web --output-dir dist

# ─── Etapa 2: runtime Flask + bundle web ─────────────────────────────────────
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEV_SERVER_PORT=4747 \
    DEMO_WEB_PORT=8085

WORKDIR /app

# Usuário sem privilégios: a demo só precisa escrever em /app/server e /app/.runtime.
RUN groupadd --system cooperativa \
    && useradd --system --gid cooperativa --home-dir /app --shell /usr/sbin/nologin coop

COPY server/requirements.txt server/
RUN pip install --no-cache-dir -r server/requirements.txt

COPY server/ server/
COPY docker/ docker/
COPY --from=web /app/mobile/dist web/
COPY --from=web /app/mobile/node_modules/leaflet/dist mobile/node_modules/leaflet/dist

RUN chmod +x docker/entrypoint.sh \
    && mkdir -p .runtime \
    && chown -R coop:cooperativa /app

USER coop

EXPOSE 4747 8085

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os,sys,urllib.request; port=os.environ.get('DEV_SERVER_PORT','4747'); sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+port+'/health', timeout=3).getcode()==200 else 1)"

ENTRYPOINT ["/app/docker/entrypoint.sh"]
