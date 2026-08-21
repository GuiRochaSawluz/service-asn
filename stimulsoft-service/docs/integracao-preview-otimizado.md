# Integracao do preview otimizado

## Objetivo
Migrar o consumo de preview para reduzir latencia, payload e custo de render.

## Novo fluxo recomendado
1. Buscar metadados de paginas.
2. Buscar miniaturas uma unica vez.
3. Navegar carregando somente a pagina principal selecionada como binario.

## Endpoints novos

### Viewer PDF server-driven (sem re-render por thumbnail)
- POST /api/print/viewer-content/init
- GET /api/print/viewer-content/{sessionId}/component

Fluxo:
1. Inicializar sessao com o endpoint init.
2. Abrir componentUrl retornado na resposta.
3. O componente carrega o PDF uma vez e, no clique da thumbnail, altera somente o fragmento #page no iframe.

Exemplo de resposta do init:
```json
{
  "sessionId": "f0d30f4a1f244f4f9ecf8f6fdb9fd1cd",
  "totalPages": 8,
  "format": "jpeg",
  "thumbDpi": 55,
  "pdfUrl": "/api/print/viewer-content/f0d30f4a1f244f4f9ecf8f6fdb9fd1cd/pdf",
  "pdfPageUrlTemplate": "/api/print/viewer-content/f0d30f4a1f244f4f9ecf8f6fdb9fd1cd/pdf#page={page}",
  "componentUrl": "/api/print/viewer-content/f0d30f4a1f244f4f9ecf8f6fdb9fd1cd/component",
  "pageUrlTemplate": "/api/print/viewer-content/f0d30f4a1f244f4f9ecf8f6fdb9fd1cd/page/{page}",
  "thumbnails": []
}
```

### Metadados
- POST /api/print/preview-metadata
- POST /api/print/preview-metadata-content

Request (arquivo):
```json
{
  "templateName": "Relatorio.mrt",
  "data": "<DATASET/>",
  "isEtiqueta": false
}
```

Response:
```json
{
  "totalPages": 8
}
```

### Miniaturas (cacheavel no frontend)
- POST /api/print/preview-thumbnails
- POST /api/print/preview-thumbnails-content

Request (arquivo):
```json
{
  "templateName": "Relatorio.mrt",
  "data": "<DATASET/>",
  "isEtiqueta": false,
  "thumbDpi": 55,
  "format": "jpeg"
}
```

Response:
```json
{
  "totalPages": 8,
  "format": "jpeg",
  "thumbnails": [
    {
      "page": 1,
      "format": "jpeg",
      "base64": "...",
      "sizeBytes": 12433,
      "isSelected": false
    }
  ]
}
```

### Pagina principal (binario)
- POST /api/print/preview-page
- POST /api/print/preview-page-content

Request (arquivo):
```json
{
  "templateName": "Relatorio.mrt",
  "data": "<DATASET/>",
  "page": 1,
  "isEtiqueta": false,
  "mainDpi": 180,
  "format": "jpeg"
}
```

Response:
- Content-Type: image/jpeg ou image/png
- Body: bytes da imagem

## Sequencia de implementacao no frontend
1. Chamar preview-metadata para obter totalPages.
2. Chamar preview-thumbnails uma vez e guardar em cache local da tela.
3. Inicializar page atual com 1.
4. Chamar preview-page para carregar a imagem principal.
5. Ao clicar na miniatura, alterar page atual e chamar apenas preview-page.

## Recomendacoes de performance
1. Reaproveitar miniaturas em memoria enquanto a tela estiver aberta.
2. Usar cache HTTP/CDN se houver proxy reverso.
3. Evitar recomputar miniaturas ao mudar apenas a pagina selecionada.
4. Manter format=jpeg para menor payload quando transparencia nao for necessaria.

## Compatibilidade
Os endpoints antigos de preview continuam existentes:
- /api/print/preview
- /api/print/preview-content

Use os novos endpoints para navegacao com maior desempenho.
