# ASN Service — Etiqueta + Aviso de Embarque

Microsserviço dedicado à geração de **Avisos de Embarque (DESADV/856/RND004)** e impressão de **etiquetas ODETTE/VDA** via Stimulsoft + SwPaaS.

## Portas

| Serviço | Porta | URL |
|---------|-------|-----|
| Backend (FastAPI) | **8002** | http://localhost:8002 |
| Frontend (Vite) | **5175** | http://localhost:5175 |
| Swagger UI | 8002 | http://localhost:8002/docs |

## Inicialização rápida

```bat
D:\tools\asn-service\start_asn.bat
```

## Estrutura

```
asn-service/
├── start_asn.bat          ← Script de inicialização
├── backend/
│   ├── main.py            ← FastAPI (porta 8002)
│   ├── db.py              ← SQLite: asn.db (isolado)
│   ├── models.py          ← Schemas Pydantic
│   ├── swpaas_client.py   ← Cliente autenticado SwPaaS
│   │                         GET /Admin/GetMapeamentos/{...}
│   │                         GET /ReportLabels
│   ├── asn_generator.py   ← Gerador XML-ASN em memória (Python puro)
│   ├── .env               ← Credenciais SwPaaS
│   └── requirements.txt
└── frontend/
    ├── vite.config.js     ← Proxy /api/* → :8002
    ├── src/
    │   ├── App.jsx        ← Home + AsnPage
    │   ├── AvisoEmbarqueTab.jsx  (copiado do monolito)
    │   ├── EtiquetasTab.jsx      (copiado)
    │   ├── StiLabelViewer.jsx    (copiado)
    │   └── EmulationContext.jsx  (stub standalone)
    └── .env
```

## Configuração

Edite `backend/.env`:

```env
SWPAAS_ENV=hml          # ou prd
VITE_SWPAAS_USERNAME=   # credencial SwPaaS
VITE_SWPAAS_PASSWORD=   # credencial SwPaaS
```

### Fallback SQLite + sincronização automática

Quando `DATABASE_URL` aponta para MySQL, o backend pode entrar em modo fallback local
se houver falha de conexão ou timeout.

Variáveis relevantes:

```env
DB_ENABLE_SQLITE_FALLBACK=true
DB_AUTO_INIT=true
DB_CONNECT_TIMEOUT_SECONDS=3
DB_READ_TIMEOUT_SECONDS=5
DB_WRITE_TIMEOUT_SECONDS=5
DB_RECOVERY_CHECK_SECONDS=10
DB_SYNC_BATCH_SIZE=200
DB_SYNC_LOCK_NAME=asn_fallback_sync_lock
CONTAINER_INSTANCE_ID=asn-pod-01
FALLBACK_DB_PATH=backend/asn_fallback.db
```

Comportamento:

- Em falha no MySQL, o serviço usa SQLite local com o schema necessário.
- Escritas em fallback entram em uma fila local (`sync_outbox`).
- Quando o MySQL volta, ocorre replay automático dos eventos para o banco primário.
- Em ambiente com vários containers (NodeBalancer), o replay usa lock distribuído no MySQL
    e deduplicação por evento no banco primário.

Observação importante para multi-container:

- `POST /api/labels/sequence/generate` retorna `503` durante fallback.
- Isso evita colisão de sequenciais entre containers isolados enquanto o banco primário está fora.

## Endpoints principais

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/health` | Health check |
| GET | `/api/system/health` | Health consolidado ASN + Stimulsoft |
| GET | `/api/system/stats` | Estatísticas de operação |
| POST | `/api/auth/token/exchange` | Troca token m2m por token temporário |
| GET | `/api/avisos-embarque?id_meta=X` | Busca aviso salvo |
| POST | `/api/avisos-embarque` | Cria aviso |
| PUT | `/api/avisos-embarque/{id}` | Auto-save do formulário |
| POST | `/api/avisos-embarque/{id}/gerar` | Gera XML-ASN em memória |
| GET | `/api/avisos-embarque/{id}/download-rnd004` | Download XML-ASN |
| GET | `/api/mapeamentos` | Mapeamentos via SwPaaS API |
| GET | `/api/swpaas/report-labels` | Templates .mrt disponíveis |
| POST | `/api/swpaas/logos` | Logotipos das entidades |

## Dashboard de health e estatísticas

- Rota única de observabilidade: `/ops`
- Exemplo local: `http://localhost:5175/ops`

O dashboard consulta:

- `GET /api/system/health`
- `GET /api/system/stats`

Se `REQUIRE_TEMP_TOKEN=true`, as duas rotas exigem `Authorization: Bearer <token_temporario>`.

## Unificação ASN + Stimulsoft

O frontend agora pode consumir o Stimulsoft pelo mesmo backend ASN via proxy:

- Prefixo: `/api/stimulsoft/*`
- Exemplo: `/api/stimulsoft/api/print/viewer-content/init`

## Deploy unificado em container único (porta 80)

Arquivos prontos para deploy unificado:

- `../Dockerfile` (na raiz do repositório)
- `deploy/nginx.unified.conf`
- `deploy/supervisord.conf`
- `../docs/publicacao-deploy-unificado.md`

Esse pacote sobe:

- Nginx na porta `80`
- FastAPI ASN em `127.0.0.1:8003`
- Stimulsoft .NET em `127.0.0.1:5055`

## Documentação para satélites

- Guia de integração (endpoints, fluxo iframe, token temporário):
    - `../docs/publicacao-integracao-satelites-umbrella-runtime.md`
- Lista de variáveis de runtime para Umbrella/AWS:
    - `../docs/publicacao-runtime-env-umbrella.example`

## Administração de migrações (Alembic)

- Tela admin: `/admin/migrations`
- Endpoints admin:
    - `GET /api/admin/migrations/status`
    - `POST /api/admin/migrations/upgrade`

Para usar MySQL em AWS, configure `DATABASE_URL` no runtime.

Controle de acesso:

- A tela `/ops` e `/admin/migrations` exigem autenticação via sessão Umbrella (`/api/auth/session/validate` + `/api/me`).
- Apenas usuários com e-mail `@sawluz.com.br` podem acessar essas telas e endpoints associados.

## Iframe: tema e cores (Umbrella/monolito)

Ao embutir o frontend no iframe, passe as cores na query string.

### Parâmetros aceitos

- Primária: `primaria`, `corPrimaria`, `primary`, `primaryColor`, `cor_primaria`
- Secundária: `secundaria`, `corSecundaria`, `secondary`, `secondaryColor`, `cor_secundaria`
- Tema: `theme`, `mode_theme`, `modeTheme` (`dark|light`, também aceita `escuro|claro`)

### Exemplo recomendado

```txt
http://localhost:5175/?idMeta=101515846&primaria=%2300A651&secundaria=%2300D084&theme=dark
```

### Regras importantes

- Use HEX de 3 ou 6 dígitos.
- Pode enviar com `#` (encode `%23`) ou sem `#`.
- Valores inválidos são ignorados e o app usa o fallback padrão (`Brand.green`).
- O app também aceita atualização dinâmica via `postMessage` com `type: 'UMBRELLA_THEME'`.

### Exemplo de `postMessage`

```js
iframe.contentWindow.postMessage({
    type: 'UMBRELLA_THEME',
    primaria: '#00A651',
    secundaria: '#00D084',
    theme: 'dark',
}, '*')
```

## Fluxo de mapeamentos

Sem DLLs locais. Os mapeamentos são obtidos via:

```
GET https://swapihml.sawluz.net/Admin/GetMapeamentos/{Sentido}/{NomeEntidade}/{Padrao}/{Mensagem}/{Versao}
```

O XML-ASN é gerado **em memória** pelo `asn_generator.py` com os dados do formulário.
