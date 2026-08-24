# syntax=docker/dockerfile:1.7

ARG NODE_BUILD_IMAGE=public.ecr.aws/docker/library/node:20-alpine
ARG DOTNET_SDK_IMAGE=mcr.microsoft.com/dotnet/sdk:8.0
ARG DOTNET_ASPNET_IMAGE=mcr.microsoft.com/dotnet/aspnet:8.0-bookworm-slim

FROM ${NODE_BUILD_IMAGE} AS frontend-build
WORKDIR /src/asn-service/frontend
COPY asn-service/frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY asn-service/frontend ./
ARG VITE_ASN_API_URL=
ARG VITE_STIMULSOFT_SERVICE_URL=/api/stimulsoft
ENV VITE_ASN_API_URL=${VITE_ASN_API_URL}
ENV VITE_STIMULSOFT_SERVICE_URL=${VITE_STIMULSOFT_SERVICE_URL}
RUN npm run build

FROM ${DOTNET_SDK_IMAGE} AS stimulsoft-build
WORKDIR /src/stimulsoft-service
COPY stimulsoft-service/StimulusoftService.csproj ./
RUN dotnet restore
COPY stimulsoft-service ./
RUN dotnet publish -c Release -o /out

FROM ${DOTNET_ASPNET_IMAGE} AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        nginx \
        supervisor \
    && rm -rf /var/lib/apt/lists/*

COPY asn-service/backend /app/asn-backend
RUN pip3 install --no-cache-dir -r /app/asn-backend/requirements.txt

COPY --from=stimulsoft-build /out /app/stimulsoft
COPY --from=frontend-build /src/asn-service/frontend/dist /usr/share/nginx/html

COPY asn-service/deploy/nginx.unified.conf /etc/nginx/conf.d/default.conf
COPY asn-service/deploy/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

ENV ASN_PORT=8003
ENV STIMULSOFT_BASE_URL=http://127.0.0.1:5055
ENV ASPNETCORE_URLS=http://127.0.0.1:5055

EXPOSE 80

CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
