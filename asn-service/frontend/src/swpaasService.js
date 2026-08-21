/**
 * swpaasService.js
 * Cliente SwPaaS que roteia TODAS as chamadas pelo proxy FastAPI local (/api/swpaas/*).
 * Isso elimina o bloqueio CORS do gateway.sawluz.net que não retorna
 * Access-Control-Allow-Origin para origens do browser.
 *
 * Fluxo:
 *   Browser → /api/swpaas/* → FastAPI (server-side) → gateway.sawluz.net
 *
 * O token de autenticação é gerenciado inteiramente no backend.
 * Este módulo não armazena nem expõe o accessToken.
 */

// ── Wrapper de fetch com tratamento de erro unificado ──────────────────────────
async function apiFetch(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.detail || `SwPaaS proxy: HTTP ${res.status} em ${path}`)
  }

  return res.json()
}

// ── Cenário 1: Logotipos ───────────────────────────────────────────────────────
/**
 * Busca logotipos de múltiplas entidades em lote.
 * @param {string[]} entityIds
 * @returns {Promise<Array<{ id: string, logo: string, nomeEntidade: string|null, razaoSocial: string|null }>>}
 */
async function getLogos(entityIds) {
  if (!Array.isArray(entityIds) || entityIds.length === 0) return []
  return apiFetch('/api/swpaas/logos', {
    method: 'POST',
    body: JSON.stringify(entityIds),
  })
}

// ── Cenário 2: Eventos ─────────────────────────────────────────────────────────
/**
 * Busca o histórico de eventos de um meta-arquivo.
 * @param {number} idMeta
 * @param {number} [skip=0]
 * @param {number} [take=50]
 * @param {number} [tipoEvento=0] - 0 = todos os tipos
 * @returns {Promise<Evento[]>}
 */
async function getEventos(idMeta, skip = 0, take = 50, tipoEvento = 0) {
  if (!idMeta) throw new Error('getEventos: idMeta é obrigatório.')
  return apiFetch(`/api/swpaas/eventos/${idMeta}/${skip}/${take}/${tipoEvento}`)
}

// ── Cenário 3A: Lista de Relatórios ───────────────────────────────────────────
/**
 * @param {{ page: number, pageSize: number, sortDescending: boolean, currentVersions: boolean }} params
 * @returns {Promise<ReportLabel[]>}
 */
async function getReportLabels({ page = 1, pageSize = 10, sortDescending = true, currentVersions = true, tenantId, ownerId } = {}) {
  const qs = new URLSearchParams({ page, pageSize, sortDescending, currentVersions })
  if (tenantId != null) qs.set('tenantId', tenantId)
  if (ownerId  != null) qs.set('ownerId', ownerId)
  const data = await apiFetch(`/api/swpaas/report-labels?${qs}`)
  return data.items ?? []
}

// ── Cenário 3B: Download de Versão ─────────────────────────────────────────────
/**
 * @param {string} versionId
 * @returns {Promise<ReportVersion>}
 */
async function getReportVersion(versionId) {
  if (!versionId) throw new Error('getReportVersion: versionId é obrigatório.')
  return apiFetch(`/api/swpaas/report-labels/version/${versionId}`)
}

/**
 * Decodifica base64 e dispara download do .mrt no browser.
 * @param {string} versionId
 */
async function downloadReportFile(versionId) {
  const version = await getReportVersion(versionId)
  if (!version.fileContentBase64) {
    throw new Error(`fileContentBase64 ausente para a versão ${versionId}.`)
  }
  const byteChars = atob(version.fileContentBase64)
  const byteArray = new Uint8Array([...byteChars].map(c => c.charCodeAt(0)))
  const blob = new Blob([byteArray], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = version.fileName || `relatorio_${versionId}.mrt`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// ── Cenário 4: Conteúdo de Arquivo (Homologação) ──────────────────────────────
/**
 * Busca o conteúdo de um arquivo via API ConteudoArquivo (ambiente HML).
 * @param {number} idMetaArquivoReferenciado
 * @param {'xml'|'edi'} tipo
 * @returns {Promise<string>} conteúdo do arquivo como texto
 */
async function getConteudoArquivo(idMetaArquivoReferenciado, tipo = 'xml') {
  if (!idMetaArquivoReferenciado) throw new Error('getConteudoArquivo: idMetaArquivoReferenciado é obrigatório.')
  const res = await fetch(`/api/swpaas/conteudo-arquivo/${idMetaArquivoReferenciado}/${tipo}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.detail || `SwPaaS ConteudoArquivo: HTTP ${res.status}`)
  }
  // A API pode retornar texto puro ou JSON
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('json')) {
    const data = await res.json()
    // Se o JSON tiver uma propriedade de conteúdo, retorna ela
    return typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  }
  return res.text()
}

// ── Ambiente SwPaaS ───────────────────────────────────────────────────────────
let _cachedEnv = null
/**
 * Retorna o ambiente SwPaaS ativo ('prd' ou 'hml').
 * @returns {Promise<string>}
 */
async function getSwpaasEnv() {
  if (_cachedEnv) return _cachedEnv
  try {
    const data = await apiFetch('/api/swpaas/env')
    _cachedEnv = data.env || 'prd'
  } catch {
    _cachedEnv = 'prd'
  }
  return _cachedEnv
}

// ── Cenário 5: Upload Manual de Arquivos ──────────────────────────────────────

/**
 * MD5 hash em JS puro (RFC 1321).
 * Necessário porque crypto.subtle não suporta MD5.
 * @param {ArrayBuffer} buffer
 * @returns {string} hex digest
 */
function md5(buffer) {
  const bytes = new Uint8Array(buffer)
  const S = [
    7,12,17,22, 7,12,17,22, 7,12,17,22, 7,12,17,22,
    5, 9,14,20, 5, 9,14,20, 5, 9,14,20, 5, 9,14,20,
    4,11,16,23, 4,11,16,23, 4,11,16,23, 4,11,16,23,
    6,10,15,21, 6,10,15,21, 6,10,15,21, 6,10,15,21,
  ]
  const K = Array.from({ length: 64 }, (_, i) =>
    (Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000)) >>> 0
  )

  let len = bytes.length
  let padded = new Uint8Array(((len + 8 >> 6) + 1) << 6)
  padded.set(bytes)
  padded[len] = 0x80
  let bits = len * 8
  let view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, bits >>> 0, true)
  view.setUint32(padded.length - 4, (bits / 0x100000000) >>> 0, true)

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476

  for (let off = 0; off < padded.length; off += 64) {
    let M = new Uint32Array(16)
    for (let j = 0; j < 16; j++) M[j] = view.getUint32(off + j * 4, true)
    let A = a0, B = b0, C = c0, D = d0
    for (let i = 0; i < 64; i++) {
      let F, g
      if (i < 16) { F = (B & C) | (~B & D); g = i }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16 }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16 }
      else { F = C ^ (B | ~D); g = (7 * i) % 16 }
      F = (F + A + K[i] + M[g]) >>> 0
      A = D; D = C; C = B
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0
    c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0
  }

  const hex = v => Array.from(new Uint8Array(new Uint32Array([v]).buffer))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  return hex(a0) + hex(b0) + hex(c0) + hex(d0)
}

/**
 * Upload manual de arquivo(s) para o SWPaaS.
 * Comprime em ZIP, converte para Base64, calcula MD5 e envia.
 *
 * @param {File} file - Arquivo selecionado pelo usuário
 * @param {(progress: { step: string, pct: number }) => void} [onProgress] - callback de progresso
 * @returns {Promise<{ ok: boolean, fileName: string }>}
 */
async function uploadArquivo(file, onProgress) {
  const OWNER = 'F6861634-E85D-4BB5-955E-30E5D627999E'
  const ID_CONTEXTO = '99F19C2B-4BC8-45FE-B8E1-7CBF08D19988'
  const HASH_INSTANCIA = '54a2195e92ab443aa68ece26d0977ec0831ef3c3a9e84403b08b9c9450489c08'

  onProgress?.({ step: 'Lendo arquivo…', pct: 10 })

  const arrayBuf = await file.arrayBuffer()
  const fileBytes = arrayBuf.byteLength

  // MD5 do conteúdo original
  onProgress?.({ step: 'Calculando MD5…', pct: 25 })
  const fileMd5 = md5(arrayBuf)

  // Comprime em GZip e converte para Base64 (backend .NET usa GZipStream)
  onProgress?.({ step: 'Comprimindo GZip…', pct: 40 })
  const cs = new CompressionStream('gzip')
  const writer = cs.writable.getWriter()
  writer.write(new Uint8Array(arrayBuf))
  writer.close()
  const gzipBuf = await new Response(cs.readable).arrayBuffer()

  onProgress?.({ step: 'Convertendo Base64…', pct: 55 })
  const gzipBytes = new Uint8Array(gzipBuf)
  let binary = ''
  const CHUNK = 8192
  for (let i = 0; i < gzipBytes.length; i += CHUNK) {
    binary += String.fromCharCode(...gzipBytes.subarray(i, i + CHUNK))
  }
  const fileBase64 = btoa(binary)

  // Path: browser não expõe o caminho real por segurança;
  // monta um caminho Windows plausível para a API
  const pathLocal = `C:\\Upload\\${file.name}`

  const payload = {
    owner: OWNER,
    idContexto: ID_CONTEXTO,
    pathArquivoLocal: pathLocal,
    dtHrArquivo: new Date().toISOString(),
    hashInstancia: HASH_INSTANCIA,
    bytes: fileBytes,
    arquivo: fileBase64,
    mD5: fileMd5,
  }

  // Debug: log payload (sem o base64) para DevTools
  console.log('[Upload Manual] Payload:', { ...payload, arquivo: `(${fileBase64.length} chars base64)` })

  onProgress?.({ step: 'Enviando…', pct: 80 })

  const res = await fetch('/api/swpaas/upload-arquivo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const detail = body?.detail
    const msg = typeof detail === 'object'
      ? (detail.upstream_body || detail.mensagem || JSON.stringify(detail))
      : (detail || `Upload falhou: HTTP ${res.status}`)
    throw new Error(msg)
  }

  onProgress?.({ step: 'Concluído!', pct: 100 })
  return { ok: true, fileName: file.name }
}

// ── Cenário 6: Usuário por e-mail (emulação) ─────────────────────────────────
/**
 * Busca dados de um usuário no SWPaaS legado pelo e-mail.
 * Retorna corporações visíveis, período de acesso e contexto.
 * @param {string} email
 * @returns {Promise<Object>} dados do usuário (shape: { corporacoes, contextos, dataOuPeriodoDeAcesso, ... })
 */
async function getUserByMail(email) {
  if (!email) throw new Error('getUserByMail: email é obrigatório.')
  return apiFetch(`/api/swpaas/user-by-mail/${encodeURIComponent(email)}`)
}

// ── Export ─────────────────────────────────────────────────────────────────────
export const swpaas = {
  getLogos,
  getEventos,
  getReportLabels,
  getReportVersion,
  downloadReportFile,
  getConteudoArquivo,
  getSwpaasEnv,
  uploadArquivo,
  getUserByMail,
}
