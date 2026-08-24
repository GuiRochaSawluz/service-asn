# Integracao de Satelites com ASN Unified Service

## Objetivo
Padronizar a integracao dos satelites com o microsservico unificado ASN + Stimulsoft, sem expor token m2m no frontend e usando apenas token temporario para aprovar requests.

## Regra de seguranca
- O token m2m nunca vai para browser/iframe.
- O backend do satelite troca o m2m por token temporario no ASN.
- O frontend dentro do iframe usa handshake para gravar cookie HttpOnly.
- As rotas de API do ASN aceitam somente token temporario valido quando REQUIRE_TEMP_TOKEN=true.

## Fluxo fim a fim
1. Backend do satelite recebe ou possui o token m2m do Umbrella.
2. Backend do satelite chama POST /api/auth/token/exchange no ASN.
3. ASN valida o m2m no Umbrella e retorna access_token temporario.
4. Backend do satelite monta a URL do iframe com o token temporario.
5. Frontend do ASN no iframe chama POST /api/auth/session para criar cookie HttpOnly.
6. Frontend remove token da URL.
7. Frontend valida sessao em GET /api/auth/session/validate.
8. Requests posteriores para /api/* sao aprovados somente com token temporario (cookie ou Bearer).

## Endpoints de integracao

### 1) Troca m2m -> token temporario
Metodo: POST
Rota: /api/auth/token/exchange

Headers aceitos:
- Authorization: Bearer <m2m_token>

Body alternativo:
- m2m_token: string (opcional se enviado no Authorization)
- ttl_seconds: int (opcional)
- scope: string (opcional, default satellite:access)

Exemplo de body:
{
  "m2m_token": "<m2m>",
  "ttl_seconds": 300,
  "scope": "satellite:access"
}

Resposta 200:
{
  "access_token": "<temp_jwt>",
  "token_type": "bearer",
  "expires_in": 300
}

### 2) Handshake da sessao no iframe
Metodo: POST
Rota: /api/auth/session

Body:
{
  "token": "<temp_jwt>"
}

Resposta 200:
{
  "authenticated": true,
  "expires_in": 300,
  "scope": "satellite:access"
}

Efeito:
- Cria cookie HttpOnly sat_tmp_auth.

### 3) Validacao da sessao
Metodo: GET
Rota: /api/auth/session/validate

Resposta 200:
{
  "authenticated": true,
  "client_id": "<client_id>",
  "scope": "satellite:access",
  "exp": 1750000000,
  "email": "usuario@sawluz.com.br",
  "is_sawluz": true
}

### 3.1) Contexto do usuario Umbrella
Metodo: GET
Rota: /api/me

Uso:
- O frontend usa /api/auth/session/validate + /api/me para validar sessao e perfil do usuario.
- As telas /ops e /admin/migrations so sao liberadas para e-mails @sawluz.com.br.

### 4) Rotas protegidas
Quando REQUIRE_TEMP_TOKEN=true:
- Todas as rotas /api/* exigem token temporario valido.
- Excecoes publicas:
  - /api/auth/token/exchange
  - /api/auth/session
  - /api/auth/session/validate

### 5) Administracao de migracoes (Alembic)
Metodo: GET
Rota: /api/admin/migrations/status

Metodo: POST
Rota: /api/admin/migrations/upgrade

Body:
{
  "revision": "head"
}

Cabecalho opcional adicional:
- x-admin-token: <MIGRATIONS_ADMIN_TOKEN>

Observacao:
- Essas rotas ja exigem token temporario valido.
- Se MIGRATIONS_ADMIN_TOKEN estiver configurado, exigem tambem x-admin-token.
- Exigem tambem usuario Umbrella com e-mail @sawluz.com.br.

Tela frontend:
- /admin/migrations

## Parametros esperados na URL do iframe
Minimos comuns:
- token: token temporario retornado por /api/auth/token/exchange
- idMeta: identificador de negocio para fluxo ASN

Exemplo:
/ ?idMeta=101515846&token=<temp_jwt>

Observacao:
- O frontend remove token da URL apos handshake.

## Exemplo de integracao no backend do satelite
1. Solicitar token temporario:
- POST /api/auth/token/exchange
- Authorization Bearer <m2m_token>

2. Montar URL do iframe:
- https://host-do-asn/?idMeta=<id_meta>&token=<temp_jwt>

## Variaveis de ambiente para Umbrella/AWS (runtime)
Todas estas variaveis sao de runtime. Nao depende de build para token/autenticacao.

Obrigatorias para autenticacao:
- UMBRELLA_API_URL
  - Exemplo: https://hub-api.suaempresa.com
  - Uso: validacao do m2m no endpoint external-satellite/me.
- SATELLITE_CLIENT_ID
  - Uso: cabecalho X-Client-Id na validacao m2m.
- SATELLITE_SECRET_KEY
  - Uso: cabecalho X-Satellite-Hash na validacao m2m.
- TEMP_TOKEN_SECRET
  - Uso: assinatura e validacao do token temporario.
  - Recomendacao: segredo forte e rotacionado.

Obrigatoria para banco (AWS MySQL):
- DATABASE_URL
  - Exemplo: mysql+pymysql://usuario:senha@host:3306/nome_banco
  - Uso: conexao principal do backend ASN.

Obrigatorias para operacao SwPaaS (ASN):
- VITE_SWPAAS_USERNAME
- VITE_SWPAAS_PASSWORD

Recomendadas:
- REQUIRE_TEMP_TOKEN
  - true em producao.
  - Se false, API nao bloqueia por token temporario.
- TEMP_TOKEN_TTL_SECONDS
  - Default: 300.
  - Define tempo maximo do token temporario.
- DB_AUTO_INIT
  - Recomendado em producao: false.
  - Quando true, backend tenta criar schema base no startup.
- MIGRATIONS_ADMIN_TOKEN
  - Token adicional para operacoes de migracao via UI/API admin.

Opcionais com default:
- TEMP_TOKEN_ALGORITHM
  - Default: HS256
  - Estado atual: somente HS256 suportado.
- UMBRELLA_TIMEOUT_SECONDS
  - Default: 5
  - Timeout da chamada de validacao m2m.
- STIMULSOFT_BASE_URL
  - Default: http://127.0.0.1:5055
  - URL interna do servico de impressao.
- ASN_PORT
  - Default: 8003
  - Porta do backend ASN quando executado diretamente.
- SWPAAS_ENV
  - Default: hml
  - hml ou prd para endpoint base SwPaaS.
- SWPAAS_UPLOAD_OWNER
  - Default no codigo.
- SWPAAS_UPLOAD_ID_CONTEXTO
  - Default no codigo.
- SWPAAS_UPLOAD_HASH_INSTANCIA
  - Default no codigo.
- SATELLITE_JWT_SECRET
  - Fallback apenas se TEMP_TOKEN_SECRET nao estiver definido.

Variavel de runtime do Stimulsoft no container unificado:
- ASPNETCORE_URLS
  - Default no Docker: http://127.0.0.1:5055

## Checklist de publicacao
1. Subir imagem docker unificada no ECR da AWS (imagem final do satelite).
2. Configurar variaveis de runtime no Umbrella/AWS.
3. Rodar migracao inicial no banco alvo (UI /admin/migrations ou API admin).
4. Garantir REQUIRE_TEMP_TOKEN=true em producao.
5. Integrar backend do satelite ao endpoint /api/auth/token/exchange.
6. Passar somente token temporario no iframe.
7. Validar acesso em /api/auth/session/validate.
8. Validar /api/me e confirmar e-mail @sawluz.com.br para /ops e /admin/migrations.

## Imagens base em ECR
- O Dockerfile usa ECR Public por padrao para Node e .NET.
- Se sua empresa exigir ECR privado, sobrescreva as imagens base com build args:
  - NODE_BUILD_IMAGE
  - DOTNET_SDK_IMAGE
  - DOTNET_ASPNET_IMAGE

## Erros comuns
- 401 Token temporario obrigatorio:
  - token temporario nao enviado, expirado ou invalido.
- 401 Token m2m invalido no Umbrella:
  - m2m incorreto ou SATELLITE_CLIENT_ID/SATELLITE_SECRET_KEY divergentes.
- 500 TEMP_TOKEN_SECRET nao configurado:
  - variavel obrigatoria ausente no runtime.
