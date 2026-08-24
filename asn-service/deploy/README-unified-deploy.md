# Deploy Unificado ASN + Stimulsoft (Umbrella/AWS)

Este pacote sobe os dois servicos no mesmo container, com Nginx na porta 80:

- ASN FastAPI em 127.0.0.1:8003
- Stimulsoft .NET em 127.0.0.1:5055
- Frontend React servido pelo Nginx em /

## Build da imagem

Use a raiz deste repositório como contexto para incluir os dois projetos:

```powershell
docker build -f Dockerfile -t asn-unified:latest .
```

### Base images via Amazon ECR

O Dockerfile ja usa ECR Public por padrao para imagens base:

- public.ecr.aws/docker/library/node:20-alpine
- public.ecr.aws/dotnet/sdk:8.0
- public.ecr.aws/dotnet/aspnet:8.0-bookworm-slim

Se quiser usar imagens espelhadas no seu ECR privado, passe build args:

```powershell
docker build -f Dockerfile -t asn-unified:latest . `
  --build-arg NODE_BUILD_IMAGE=<aws_account_id>.dkr.ecr.<region>.amazonaws.com/base/node:20-alpine `
  --build-arg DOTNET_SDK_IMAGE=<aws_account_id>.dkr.ecr.<region>.amazonaws.com/base/dotnet-sdk:8.0 `
  --build-arg DOTNET_ASPNET_IMAGE=<aws_account_id>.dkr.ecr.<region>.amazonaws.com/base/dotnet-aspnet:8.0-bookworm-slim
```

## Push da imagem final para ECR

```powershell
aws ecr get-login-password --region <region> |
docker login --username AWS --password-stdin <aws_account_id>.dkr.ecr.<region>.amazonaws.com

docker tag asn-unified:latest <aws_account_id>.dkr.ecr.<region>.amazonaws.com/asn-unified:latest
docker push <aws_account_id>.dkr.ecr.<region>.amazonaws.com/asn-unified:latest
```

## Run local

```powershell
docker run --rm -p 80:80 \
  -e UMBRELLA_API_URL=https://SEU-HUB-API \
  -e SATELLITE_CLIENT_ID=SEU_CLIENT_ID \
  -e SATELLITE_SECRET_KEY=SEU_SECRET \
  -e TEMP_TOKEN_SECRET=SEU_SEGREDO_TEMP \
  -e REQUIRE_TEMP_TOKEN=true \
  asn-unified:latest
```

## Rotas principais

- Frontend: `http://localhost/`
- Ops dashboard: `http://localhost/ops`
- Health infra: `http://localhost/health`
- Health consolidado API: `http://localhost/api/system/health`
- Stats API: `http://localhost/api/system/stats`
- Exchange m2m -> temporario: `POST /api/auth/token/exchange`
- ASN docs: `http://localhost/docs`

## Fluxo de token para satelites

1. Backend satelite envia token m2m para `POST /api/auth/token/exchange`.
2. O ASN valida no Umbrella (`/external-satellite/me`).
3. O ASN retorna `access_token` temporario.
4. Backend satelite usa `Bearer access_token` nas rotas protegidas.

Quando `REQUIRE_TEMP_TOKEN=false`, health/stats permanecem abertos para observabilidade local.
