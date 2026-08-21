/**
 * labelXml.js
 * Utilitários compartilhados de geração de XML flat DataSet para o Stimulsoft.
 * Extraído de EtiquetasTab.jsx para ser reutilizado em LabelPagedViewer.
 */

/** Escapa caracteres especiais XML */
export const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Extrai campos-folha de um nó DOM (filhos sem filhos = dados) */
export const leafFields = (node) => {
  if (!node) return {}
  const out = {}
  Array.from(node.children).forEach(c => {
    if (c.children.length === 0) out[c.tagName] = c.textContent || ''
  })
  return out
}

export const serFields = (f) =>
  Object.entries(f).map(([k, v]) => `<${k}>${esc(v)}</${k}>`).join('')

/**
 * Gera o XML flat DataSet esperado pelo Stimulsoft.
 * Cada etiqueta da lista `selected` → 1 linha na tabela ARQUIVOEDI_..._Tb_ASNItemEtiqueta.
 * Para thumb/nav, passe um array de 1 elemento para gerar o XML de uma etiqueta individual.
 *
 * @param {object[]} etiquetas - Lista de etiquetas. Apenas as com `selected !== false` são incluídas.
 * @param {string|null} xmlRaw - XML-ASN bruto para enriquecimento (opcional).
 */
export const getFinalXmlString = (etiquetas, xmlRaw) => {
  const selected = etiquetas.filter(e => e.selected !== false)
  if (selected.length === 0) return ''

  let cabFields = {}
  let expFields = {}
  const itemFieldsByOcc = {}

  if (xmlRaw) {
    try {
      const doc = new DOMParser().parseFromString(xmlRaw, 'application/xml')
      cabFields = leafFields(doc.getElementsByTagName('Tb_ASNCabecalho')[0] ?? null)
      expFields = leafFields(doc.getElementsByTagName('Expedicao')[0] ?? null)
      Array.from(doc.getElementsByTagName('Tb_ASNItem')).forEach(n => {
        const occ = n.getElementsByTagName('DbItOcc')[0]?.textContent || ''
        if (occ) itemFieldsByOcc[occ] = leafFields(n)
      })
    } catch { /* ignora erros de parse */ }
  }

  const tARQUIVOEDI = `<ARQUIVOEDI><ASN_SET>0</ASN_SET></ARQUIVOEDI>`
  const tASN_SET    = `<ARQUIVOEDI_ASN_SET><ASN_SUBSET>0</ASN_SUBSET><relationId>0</relationId></ARQUIVOEDI_ASN_SET>`
  const tASN_SUBSET = `<ARQUIVOEDI_ASN_SET_ASN_SUBSET><ASNoccs>0</ASNoccs><Tb_HeaderEDI>0</Tb_HeaderEDI><relationId>0</relationId></ARQUIVOEDI_ASN_SET_ASN_SUBSET>`
  const tASNoccs    = `<ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs><Tb_ASNCabecalho>0</Tb_ASNCabecalho><relationId>0</relationId></ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs>`

  const tCabecalho =
    `<ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs_Tb_ASNCabecalho>` +
    serFields(cabFields) +
    `<Expedicao>0</Expedicao><SubsetITENS>0</SubsetITENS><relationId>0</relationId>` +
    `</ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs_Tb_ASNCabecalho>`

  const tExpedicao =
    `<ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs_Tb_ASNCabecalho_Expedicao>` +
    serFields(expFields) +
    `<relationId>0</relationId>` +
    `</ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs_Tb_ASNCabecalho_Expedicao>`

  const tSubsetITENS = selected.map((_, i) =>
    `<ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs_Tb_ASNCabecalho_SubsetITENS>` +
    `<Tb_ASNItem>${i}</Tb_ASNItem><relationId>0</relationId>` +
    `</ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs_Tb_ASNCabecalho_SubsetITENS>`
  ).join('')

  const tItem = selected.map((e, i) => {
    const itemF = itemFieldsByOcc[e.itemOcc] || {}
    const merged = {
      DbItOcc: e.itemOcc || String(i + 1),
      DbItProdutoLocal:   itemF.DbItProdutoLocal   || '',
      DbItProdutoCliente: itemF.DbItProdutoCliente || '',
      DbItQtdFaturada:    itemF.DbItQtdFaturada    || '0',
      ...itemF,
    }
    return `<ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs_Tb_ASNCabecalho_SubsetITENS_Tb_ASNItem>` +
      serFields(merged) +
      `<SubsetETIQUETAS>${i}</SubsetETIQUETAS><relationId>${i}</relationId>` +
      `</ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs_Tb_ASNCabecalho_SubsetITENS_Tb_ASNItem>`
  }).join('')

  const tSubsetETIQUETAS = selected.map((_, i) =>
    `<ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs_Tb_ASNCabecalho_SubsetITENS_Tb_ASNItem_SubsetETIQUETAS>` +
    `<DbTotalEtiquetas>1</DbTotalEtiquetas>` +
    `<Tb_ASNItemEtiqueta>${i}</Tb_ASNItemEtiqueta><relationId>${i}</relationId>` +
    `</ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs_Tb_ASNCabecalho_SubsetITENS_Tb_ASNItem_SubsetETIQUETAS>`
  ).join('')

  const tEtiqueta = selected.map((e, i) =>
    `<ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs_Tb_ASNCabecalho_SubsetITENS_Tb_ASNItem_SubsetETIQUETAS_Tb_ASNItemEtiqueta>` +
    `<DbEtqOcc>${i + 1}</DbEtqOcc>` +
    `<DbEtqNroSequencial>${i + 1}</DbEtqNroSequencial>` +
    `<DbEtqNroEtiquetaUnidadeMovimentacao>${esc(e.numeroUM)}</DbEtqNroEtiquetaUnidadeMovimentacao>` +
    `<DbEtqNroEtiquetaUnidadeCondicionamento>${esc(e.numeroUC)}</DbEtqNroEtiquetaUnidadeCondicionamento>` +
    `<DbEtqQuantidadeDePecasNaUC>${esc(String(e.quantidadePecasUC ?? ''))}</DbEtqQuantidadeDePecasNaUC>` +
    `<DbEtqCallDelivery>${esc(e.ran)}</DbEtqCallDelivery>` +
    `<DbEtqCodigoEmbalagemUC>${esc(e.codigoEmbalagemUC)}</DbEtqCodigoEmbalagemUC>` +
    `<DbEtqDoca>${esc(e.doca)}</DbEtqDoca>` +
    `<DbEtqPontoDeUso>${esc(e.localUtilizacao)}</DbEtqPontoDeUso>` +
    `<DbEtqDtFabricacao>${esc(e.dataFabricacao)}</DbEtqDtFabricacao>` +
    `<DbEtqLoteFabricacao>${esc(e.lote)}</DbEtqLoteFabricacao>` +
    `<DbEtqTextoLivre>${esc(e.numeroDocumento)}</DbEtqTextoLivre>` +
    `<relationId>${i}</relationId>` +
    `</ARQUIVOEDI_ASN_SET_ASN_SUBSET_ASNoccs_Tb_ASNCabecalho_SubsetITENS_Tb_ASNItem_SubsetETIQUETAS_Tb_ASNItemEtiqueta>`
  ).join('')

  return `<?xml version="1.0" encoding="utf-8"?><DATASET>` +
    tARQUIVOEDI + tASN_SET + tASN_SUBSET + tASNoccs +
    tCabecalho + tExpedicao +
    tSubsetITENS + tItem +
    tSubsetETIQUETAS + tEtiqueta +
    `</DATASET>`
}
