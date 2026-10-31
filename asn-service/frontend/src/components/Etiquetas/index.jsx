import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Box, Alert, Button } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { getEtiquetasTheme } from './EtiquetasTheme'
import { getFinalXmlString } from '../../labelXml'
import LabelPagedViewer from '../../LabelPagedViewer'

import EtiquetasToolbar from './EtiquetasToolbar'
import ProductList from './ProductList'
import EtiquetasGrid from './EtiquetasGrid'
import TemplateSelector from './TemplateSelector'
import ProdutoManualDialog from './ProdutoManualDialog'
import GeracaoLoteDialog from './GeracaoLoteDialog'
import CamposFaltantesPanel from './CamposFaltantesPanel'
import NotaAsnDocumento from './NotaAsnDocumento'

const XML_ASN_KWS = ['xml-asn', 'xmlasn', 'desadv', 'asn', '856', '004']

/**
 * Ids para ConteudoArquivo / parse XML-ASN.
 * Preferência: IdMetaArquivoReferenciado (API SwPaaS) → IdMeta da mensagem → vínculos.
 */
const extractMetaIds = (row) => {
  const ids = []
  const push = (v) => {
    const n = Number(v)
    if (Number.isFinite(n) && n > 0 && !ids.includes(n)) ids.push(n)
  }

  // ConteudoArquivo usa tipicamente IdMetaArquivoReferenciado
  push(row?.IdMetaArquivoReferenciado)

  const nome = `${row?.NomeMensagemEDI || ''} ${row?.NomePadraoEDI || ''} ${row?.tipo || ''}`.toLowerCase()
  const isXmlAsnMsg = XML_ASN_KWS.some(k => nome.includes(k))
  if (isXmlAsnMsg) push(row?.IdMeta)
  else push(row?.IdMeta)

  ;(row?.MetaVinculos || []).forEach(v => push(v.IdMetaRelacionado || v.IdMeta))
  return ids
}

/**
 * EtiquetasTab Orchestrator
 *
 * Fluxo XML-ASN (mensagem EDI): parse máximo + mapa de campos faltantes + fill manual / Gerar Lote UC.
 * Fluxo procNFe permanece no AvisoEmbarqueTab — não é alterado aqui.
 */
export default function EtiquetasTab({ row, mode = 'light', customColors = {}, avisoItem }) {
  const theme = useMemo(() => getEtiquetasTheme(mode, customColors), [mode, customColors])
  const fileInputRef = useRef(null)

  const [items, setItems] = useState(() => {
    if (avisoItem) {
      return [{
        occ:            avisoItem.occ || '1',
        produtoLocal:   avisoItem.produto_local || avisoItem.produto_externo || '',
        produtoCliente: avisoItem.produto_externo || '',
        qtdFaturada:    avisoItem.qtd_nfe || avisoItem.quantidade || '0',
        _manual:        Boolean(avisoItem._manual),
      }]
    }
    return []
  })

  const [selectedItemOcc, setSelOcc] = useState(() => avisoItem?.occ || null)
  const [expedicao, setExpedicao] = useState({
    doca: '', fabrica: '', clienteCodigo: '',
    numDocto: row?.NumeroDocto || '',
  })

  const [etiquetas, setEtiquetas] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState(null)

  const [xmlRaw, setXmlRaw] = useState(null)
  const [xmlLoading, setXmlLoading] = useState(false)
  const [xmlError, setXmlError] = useState(null)
  const [parseResumo, setParseResumo] = useState(null)
  const [missingOpen, setMissingOpen] = useState(true)
  const [highlightField, setHighlightField] = useState(null)

  const [tplOpen, setTplOpen] = useState(false)
  const [loteOpen, setLoteOpen] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState(null)

  const [produtoDialogOpen, setProdutoDialogOpen] = useState(false)
  const [editingProduto, setEditingProduto] = useState(null)
  const [cabecalho, setCabecalho] = useState(null)
  // documento = visão NF (estilo procNFe); etiquetas = workspace UC do item
  const [viewMode, setViewMode] = useState(() => (avisoItem ? 'etiquetas' : 'documento'))

  const chaveAcesso = row?.XML_ChaveDocumentoFiscal || row?.IdMeta?.toString() || ''
  const aliasEmitente = row?.AliasEntidadeEmissora || ''
  const aliasDestinatario = row?.AliasEntidadeDeDestino || row?.AliasEntidadeOwner || ''
  const metaIds = useMemo(() => extractMetaIds(row), [row])
  // ref estável para evitar ciclo applyParsed ↔ refreshMissingMap
  const refreshMissingMapRef = useRef(async () => {})

  const applyParsed = useCallback((parsed, { mergeSaved = true } = {}) => {
    if (!parsed) return
    setXmlRaw(parsed.xmlRaw || null)
    setParseResumo(parsed.resumo || null)
    setCabecalho(parsed.cabecalho || null)

    const exp = parsed.expedicao || {}
    setExpedicao({
      doca: exp.doca || '',
      fabrica: exp.fabrica || '',
      clienteCodigo: exp.clienteCodigo || '',
      numDocto: exp.numDocto || row?.NumeroDocto || '',
      localEntrega: exp.localEntrega || '',
      pesoBruto: exp.pesoBruto || '',
      pesoLiquido: exp.pesoLiquido || '',
      totalVolumes: exp.totalVolumes || '',
      dtHrEmbarque: exp.dtHrEmbarque || '',
    })

    const parsedItems = (parsed.items || []).map(it => ({
      occ: it.occ,
      produtoLocal: it.produtoLocal || '',
      produtoCliente: it.produtoCliente || '',
      qtdFaturada: it.qtdFaturada || '0',
      unidade: it.unidade || 'PC',
      numPedido: it.numPedido || '',
      cfop: it.cfop || '',
      descricao: it.descricao || '',
      valorUnitario: it.valorUnitario || '',
      valorTotal: it.valorTotal || '',
      totalDefaultUcsPorUm: it.totalDefaultUcsPorUm || '',
      source: 'xml-asn',
    }))

    if (parsedItems.length > 0) {
      setItems(parsedItems)
      // Na visão documento não pré-seleciona; na etiquetas (avisoItem) mantém
      if (avisoItem) setSelOcc(prev => prev || parsedItems[0].occ)
      else if (!avisoItem) setViewMode('documento')
    }

    const fromXml = (parsed.etiquetas || []).map(e => ({
      ...e,
      selected: e.selected !== false,
    }))

    setEtiquetas(prev => {
      // Persistência local tem prioridade; reavalia gaps no mapa
      if (mergeSaved && prev.length > 0) {
        Promise.resolve().then(() => refreshMissingMapRef.current(prev))
        return prev
      }
      return fromXml
    })

    if (parsed.resumo?.precisaGerarLoteUc || parsed.resumo?.precisaPreencherManual || fromXml.length === 0) {
      setMissingOpen(true)
    }
  }, [row?.NumeroDocto, avisoItem])

  useEffect(() => {
    if (!chaveAcesso) return
    setLoading(true)
    fetch(`/api/labels/nfes/${chaveAcesso}`)
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.etiquetas) && d.etiquetas.length > 0) {
          setEtiquetas(d.etiquetas)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [chaveAcesso])

  const loadXmlAsn = useCallback(async () => {
    if (!metaIds.length || xmlRaw || xmlLoading) return
    setXmlLoading(true)
    setXmlError(null)
    try {
      const res = await fetch('/api/labels/xml-asn/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta_ids: metaIds }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.detail || `HTTP ${res.status}`)
      }
      const parsed = await res.json()
      applyParsed(parsed)
    } catch (err) {
      setXmlError(err.message)
    } finally {
      setXmlLoading(false)
    }
  }, [metaIds, xmlRaw, xmlLoading, applyParsed])

  useEffect(() => {
    if (metaIds.length > 0 && !xmlRaw && !xmlLoading) loadXmlAsn()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const refreshMissingMap = useCallback(async (list) => {
    try {
      const res = await fetch('/api/labels/xml-asn/map-missing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ etiquetas: list }),
      })
      if (!res.ok) return
      const data = await res.json()
      setParseResumo(prev => ({
        ...(prev || {}),
        camposFaltantesAgregados: data.camposFaltantesAgregados || [],
        etiquetasIncompletas: data.etiquetasIncompletas || 0,
        etiquetasCompletas: data.etiquetasCompletas || 0,
        precisaPreencherManual: (data.etiquetasIncompletas || 0) > 0,
        totalEtiquetas: list.length,
        itensSemEtiqueta: prev?.itensSemEtiqueta || [],
        precisaGerarLoteUc: (prev?.itensSemEtiqueta || []).length > 0 && list.length === 0,
      }))
      setEtiquetas(data.etiquetas || list)
    } catch {
      /* mapa é auxiliar — não bloqueia edição */
    }
  }, [])

  refreshMissingMapRef.current = refreshMissingMap

  const saveToDb = useCallback(async (toSave) => {
    if (!chaveAcesso) return
    setSaving(true)
    setSaveMsg(null)
    try {
      await fetch(`/api/labels/nfes/${chaveAcesso}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ etiquetas: toSave ?? etiquetas }),
      })
      setSaveMsg({ type: 'success', text: `${(toSave ?? etiquetas).length} etiqueta(s) salvas!` })
    } catch (err) {
      setSaveMsg({ type: 'error', text: err.message })
    } finally {
      setSaving(false)
    }
  }, [chaveAcesso, etiquetas])

  const handleUploadXmlAsn = async (file) => {
    if (!file) return
    setXmlLoading(true)
    setXmlError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/labels/xml-asn/parse-upload', { method: 'POST', body: fd })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.detail || `HTTP ${res.status}`)
      }
      const parsed = await res.json()
      applyParsed(parsed, { mergeSaved: false })
      setSaveMsg({ type: 'success', text: `XML-ASN carregado: ${file.name}` })
    } catch (err) {
      setXmlError(err.message)
    } finally {
      setXmlLoading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleAddManual = () => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '/')
    const occ = selectedItemOcc || '1'
    const numDocto = expedicao.numDocto || row?.NumeroDocto || ''
    setEtiquetas(prev => {
      const next = [...prev, {
        id: Math.random().toString(36).slice(2, 9),
        itemOcc: occ, selected: true,
        numeroUM: '', numeroUC: '',
        quantidadePecasUC: '0', codigoEmbalagemUC: '',
        codigoEmbalagemUM: '', localUtilizacao: '',
        doca: expedicao.doca || '', ran: '', lote: '',
        dataFabricacao: today, dataDe: '', crossDock: '',
        numeroDocumento: numDocto,
        source: 'manual',
      }]
      refreshMissingMap(next)
      return next
    })
  }

  const handleOpenNovoProduto = () => { setEditingProduto(null); setProdutoDialogOpen(true) }
  const handleOpenEditarProduto = (item, e) => { e.stopPropagation(); setEditingProduto(item); setProdutoDialogOpen(true) }

  const handleSaveProduto = (data) => {
    setItems(prev => {
      const exists = prev.find(i => i.occ === data.occ)
      if (exists) {
        return prev.map(i => i.occ === data.occ ? { ...i, ...data } : i)
      }
      setSelOcc(data.occ)
      return [...prev, data]
    })
    if (data.doca) {
      setExpedicao(prev => ({ ...prev, doca: data.doca || prev.doca }))
    }
  }

  const handleDeleteProduto = (occ, e) => {
    e.stopPropagation()
    setItems(prev => prev.filter(i => i.occ !== occ))
    if (selectedItemOcc === occ) {
      setItems(prev => {
        const remaining = prev.filter(i => i.occ !== occ)
        setSelOcc(remaining[0]?.occ || null)
        return remaining
      })
    }
  }

  const handleGeradas = useCallback((novas) => {
    setEtiquetas(prev => {
      const updated = [...prev, ...novas]
      saveToDb(updated)
      refreshMissingMap(updated)
      return updated
    })
  }, [saveToDb, refreshMissingMap])

  const handleDelete = (id) => {
    setEtiquetas(prev => {
      const next = prev.filter(e => e.id !== id)
      refreshMissingMap(next)
      return next
    })
  }
  const handleToggleSelected = (id, val) => setEtiquetas(prev => prev.map(e => e.id === id ? { ...e, selected: val } : e))
  const handleUpdateEtiqueta = useCallback((rowRef, values) => {
    const id = rowRef.original?.id ?? rowRef.id
    setEtiquetas(prev => {
      const next = prev.map(e => e.id === id ? { ...e, ...values } : e)
      // debounce leve via microtask — reavalia mapa após edição celular
      Promise.resolve().then(() => refreshMissingMap(next))
      return next
    })
  }, [refreshMissingMap])

  const currentItem = items.find(i => i.occ === selectedItemOcc)
  const currentEtiquetas = etiquetas.filter(e => e.itemOcc === (selectedItemOcc || e.itemOcc))
  const allSelectedCount = currentEtiquetas.filter(e => e.selected !== false).length

  const currentXmlData = useMemo(() => {
    const toRender = currentEtiquetas.filter(e => e.selected !== false)
    return toRender.length > 0 ? getFinalXmlString(toRender, xmlRaw) : null
  }, [currentEtiquetas, xmlRaw])

  const volByItem = useMemo(() => {
    const r = {}
    etiquetas.forEach(e => {
      r[e.itemOcc] = (r[e.itemOcc] || 0) + parseFloat(e.quantidadePecasUC || 0)
    })
    return r
  }, [etiquetas])

  const currentVol = volByItem[selectedItemOcc] ?? (items.length === 0 ? etiquetas.reduce((a, e) => a + parseFloat(e.quantidadePecasUC || 0), 0) : 0)
  const allowedVol = parseFloat(currentItem?.qtdFaturada) || 0
  const volExcedido = allowedVol > 0 && currentVol > allowedVol
  const volCompleto = allowedVol > 0 && currentVol === allowedVol

  const handleViewer = () => {
    if (!selectedTemplate) { setTplOpen(true); return }
    setViewerOpen(true)
  }

  const handlePrint = () => {
    if (!selectedTemplate) { setTplOpen(true); return }
    setPrintOpen(true)
  }

  const handleFocusMissingField = (fieldKey) => {
    setHighlightField(fieldKey)
    setViewMode('etiquetas')
    // Preferir item que tenha gap nesse campo
    const target = etiquetas.find(e =>
      (e.camposFaltantes || []).some(m => m.key === fieldKey)
    )
    if (target?.itemOcc) setSelOcc(target.itemOcc)
  }

  const handleSelectItemFromDoc = (item) => {
    if (!item?.occ) return
    setSelOcc(item.occ)
    setViewMode('etiquetas')
    setMissingOpen(true)
  }

  const handleRetryParse = () => {
    setXmlRaw(null)
    setXmlError(null)
    // loadXmlAsn só roda se xmlRaw for null — força no próximo tick
    Promise.resolve().then(() => {
      if (!metaIds.length) return
      setXmlLoading(true)
      fetch('/api/labels/xml-asn/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta_ids: metaIds }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const errBody = await res.json().catch(() => ({}))
            throw new Error(errBody.detail || `HTTP ${res.status}`)
          }
          return res.json()
        })
        .then((parsed) => applyParsed(parsed, { mergeSaved: false }))
        .catch((err) => setXmlError(err.message))
        .finally(() => setXmlLoading(false))
    })
  }

  const showDocumento = viewMode === 'documento' && !avisoItem

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".edi,.xml,application/xml,text/xml"
        style={{ display: 'none' }}
        onChange={(e) => handleUploadXmlAsn(e.target.files?.[0])}
      />

      <EtiquetasToolbar
        theme={theme}
        xmlLoading={xmlLoading}
        xmlRaw={xmlRaw}
        xmlError={xmlError}
        itemsCount={items.length}
        metaIds={metaIds}
        aliasEmitente={aliasEmitente}
        aliasDestinatario={aliasDestinatario}
        selectedTemplate={selectedTemplate}
        allSelectedCount={allSelectedCount}
        saving={saving}
        etiquetasCount={etiquetas.length}
        parseResumo={parseResumo}
        onOpenTemplateSelector={() => setTplOpen(true)}
        onViewer={handleViewer}
        onPrint={handlePrint}
        onSave={() => saveToDb()}
        onUploadClick={() => fileInputRef.current?.click()}
        onShowMissing={() => setMissingOpen(v => !v)}
        onShowDocumento={!avisoItem ? () => setViewMode('documento') : undefined}
        viewMode={viewMode}
      />

      {saveMsg && (
        <Alert severity={saveMsg.type} onClose={() => setSaveMsg(null)}
          sx={{ fontSize: 11, py: 0.3, mx: 2, mt: 1 }}>
          {saveMsg.text}
        </Alert>
      )}

      {showDocumento ? (
        <NotaAsnDocumento
          theme={theme}
          cabecalho={cabecalho}
          expedicao={expedicao}
          items={items}
          etiquetas={etiquetas}
          xmlLoading={xmlLoading}
          xmlError={xmlError}
          onSelectItem={handleSelectItemFromDoc}
          onRetry={handleRetryParse}
          aliasEmitente={aliasEmitente}
          aliasDestinatario={aliasDestinatario}
        />
      ) : (
        <>
          {!avisoItem && (
            <Box sx={{ px: 2, pt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button
                size="small"
                startIcon={<ArrowBackIcon sx={{ fontSize: 14 }} />}
                onClick={() => setViewMode('documento')}
                sx={{ textTransform: 'none', fontSize: 11, color: theme.textMuted }}
              >
                Voltar ao documento
              </Button>
              {currentItem && (
                <Alert severity="info" sx={{ fontSize: 11, py: 0, flex: 1 }}>
                  Etiquetas do item <strong>{currentItem.produtoCliente || currentItem.produtoLocal || currentItem.occ}</strong>
                  {' '}— qtd {currentItem.qtdFaturada}
                </Alert>
              )}
            </Box>
          )}

          <CamposFaltantesPanel
            theme={theme}
            resumo={parseResumo}
            open={missingOpen}
            onToggle={() => setMissingOpen(v => !v)}
            onGerarLote={() => setLoteOpen(true)}
            onFocusField={handleFocusMissingField}
          />

          <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <ProductList
              theme={theme}
              items={items}
              selectedItemOcc={selectedItemOcc}
              xmlRaw={xmlRaw}
              xmlLoading={xmlLoading}
              volByItem={volByItem}
              etiquetas={etiquetas}
              onSelect={setSelOcc}
              onAddManual={handleOpenNovoProduto}
              onEdit={handleOpenEditarProduto}
              onDelete={handleDeleteProduto}
            />

            <EtiquetasGrid
              theme={theme}
              currentItem={currentItem}
              itemsCount={items.length}
              xmlRaw={xmlRaw}
              metaIds={metaIds}
              currentEtiquetas={currentEtiquetas}
              loading={loading}
              allowedVol={allowedVol}
              currentVol={currentVol}
              volExcedido={volExcedido}
              volCompleto={volCompleto}
              highlightField={highlightField}
              onAddManual={handleAddManual}
              onLoteOpen={() => setLoteOpen(true)}
              handleDelete={handleDelete}
              handleToggleSelected={handleToggleSelected}
              handleUpdateEtiqueta={handleUpdateEtiqueta}
            />
          </Box>
        </>
      )}

      <TemplateSelector
        open={tplOpen}
        onClose={() => setTplOpen(false)}
        onSelect={setSelectedTemplate}
        idEmitente={row?.IdEntidadeEmissora}
        idDestinatario={row?.IdEntidadeDeDestino || row?.IdEntidadeOwner}
        padrao={row?.NomePadraoEDI}
        mensagem={row?.NomeMensagemEDI}
        theme={theme}
      />

      <GeracaoLoteDialog
        open={loteOpen}
        onClose={() => setLoteOpen(false)}
        onGenerate={handleGeradas}
        item={currentItem || null}
        expedicao={expedicao}
        initialNumDocto={expedicao.numDocto || row?.NumeroDocto || ''}
        theme={theme}
      />

      <ProdutoManualDialog
        open={produtoDialogOpen}
        onClose={() => setProdutoDialogOpen(false)}
        onSave={handleSaveProduto}
        editingItem={editingProduto}
        nextOcc={items.length + 1}
        theme={theme}
      />

      <LabelPagedViewer
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        etiquetas={currentEtiquetas.filter(e => e.selected !== false)}
        xmlRaw={xmlRaw}
        templateName={selectedTemplate?.url || selectedTemplate}
        templateLabel={selectedTemplate?.nome}
        isDark={mode === 'dark'}
      />

      <LabelPagedViewer
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        etiquetas={currentEtiquetas.filter(e => e.selected !== false)}
        xmlRaw={xmlRaw}
        templateName={selectedTemplate?.url || selectedTemplate}
        templateLabel={selectedTemplate?.nome}
        isDark={mode === 'dark'}
        autoPrint
      />
    </Box>
  )
}
