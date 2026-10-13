# syntax=docker/dockerfile:1.7
# ASN Service (Enzo): frontend Vite + API FastAPI atrás do Nginx na porta 80.
# Stimulsoft fica fora desta imagem. Aponte STIMULSOFT_BASE_URL para o serviço de etiquetas.
#
# Contexto: Enzo/Shared-microservices-enzo
#   docker build -f Dockerfile -t asn-service:latest .

ARG NODE_BUILD_IMAGE=public.ecr.aws/docker/library/node:22-alpine
ARG PYTHON_IMAGE=public.ecr.aws/docker/library/python:3.12-slim-bookworm

FROM ${NODE_BUILD_IMAGE} AS frontend-build
WORKDIR /src/asn-service/frontend
COPY asn-service/frontend/package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund --legacy-peer-deps || npm install --no-audit --no-fund --legacy-peer-deps; else npm install --no-audit --no-fund --legacy-peer-deps; fi
COPY asn-service/frontend ./
# Vazio: o browser chama /api no mesmo host e o Nginx encaminha para o FastAPI.
ARG VITE_ASN_API_URL=
ENV VITE_ASN_API_URL=${VITE_ASN_API_URL}
RUN npm run build

FROM ${PYTHON_IMAGE} AS runtime
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ASN_PORT=8003 \
    PATH="/opt/venv/bin:${PATH}"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        nginx \
        supervisor \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default \
    && mkdir -p /var/log/supervisor /tmp

COPY asn-service/backend/requirements.txt /app/asn-backend/requirements.txt
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir -r /app/asn-backend/requirements.txt

COPY asn-service/backend /app/asn-backend
COPY --from=frontend-build /src/asn-service/frontend/dist /usr/share/nginx/html
COPY asn-service/deploy/nginx.unified.conf /etc/nginx/conf.d/default.conf
COPY asn-service/deploy/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=25s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1/health', timeout=2).read()"

CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
