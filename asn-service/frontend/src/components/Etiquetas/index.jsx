import { useState, useEffect, useCallback, useMemo } from 'react'
import { Box, Alert } from '@mui/material'
import { getEtiquetasTheme } from './EtiquetasTheme'
import { getFinalXmlString } from '../../labelXml'
import LabelPagedViewer from '../../LabelPagedViewer'

import EtiquetasToolbar from './EtiquetasToolbar'
import ProductList from './ProductList'
import EtiquetasGrid from './EtiquetasGrid'
import TemplateSelector from './TemplateSelector'
import ProdutoManualDialog from './ProdutoManualDialog'
import GeracaoLoteDialog from './GeracaoLoteDialog'

const extractMetaIds = (row) => (row?.MetaVinculos || []).map(v => v.IdMetaRelacionado).filter(Boolean)

/**
 * EtiquetasTab Orchestrator
 *
 * @param {object} row - Registro do intercâmbio (obrigatório)
 * @param {string} mode - 'dark' | 'light' (legacy support)
 * @param {object} customColors - Possibilidade de injetar cores para adaptar a outro sistema
 * @param {object} avisoItem - Pré-popula lista (legacy support)
 */
export default function EtiquetasTab({ row, mode = 'light', customColors = {}, avisoItem }) {
  const theme = useMemo(() => getEtiquetasTheme(mode, customColors), [mode, customColors])

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

  const [tplOpen, setTplOpen] = useState(false)
  const [loteOpen, setLoteOpen] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState(null)

  const [produtoDialogOpen, setProdutoDialogOpen] = useState(false)
  const [editingProduto, setEditingProduto] = useState(null)

  const chaveAcesso = row?.XML_ChaveDocumentoFiscal || row?.IdMeta?.toString() || ''
  const aliasEmitente = row?.AliasEntidadeEmissora || ''
  const aliasDestinatario = row?.AliasEntidadeDeDestino || row?.AliasEntidadeOwner || ''
  const metaIds = extractMetaIds(row)

  useEffect(() => {
    if (!chaveAcesso) return
    setLoading(true)
    fetch(`/api/labels/nfes/${chaveAcesso}`)
      .then(r => r.json())
      .then(d => setEtiquetas(d.etiquetas || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [chaveAcesso])

  const loadXmlAsn = useCallback(async () => {
    if (!metaIds.length || xmlRaw || xmlLoading) return
    setXmlLoading(true)
    setXmlError(null)
    try {
      const res = await fetch('/api/labels/xml-asn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta_ids: metaIds }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      setXmlRaw(text)

      const doc = new DOMParser().parseFromString(text, 'application/xml')
      const docaRaw    = doc.getElementsByTagName('DbDoca')[0]?.textContent || ''
      const fabRaw     = doc.getElementsByTagName('DbFabricaCliente')[0]?.textContent || ''
      const clieRaw    = doc.getElementsByTagName('DbSWEDI_ClienteCodigo')[0]?.textContent || ''
      const numDocRaw  = doc.getElementsByTagName('DbNumNFEmitente')[0]?.textContent ||
                         doc.getElementsByTagName('DbNumDocto')[0]?.textContent ||
                         doc.getElementsByTagName('DbNumeroPedidoEmitente')[0]?.textContent ||
                         row?.NumeroDocto || ''
      setExpedicao({ doca: docaRaw, fabrica: fabRaw, clienteCodigo: clieRaw, numDocto: numDocRaw })

      const xmlItems = Array.from(doc.getElementsByTagName('Tb_ASNItem'))
      const parsed = xmlItems.map(xItem => ({
        occ:             xItem.getElementsByTagName('DbItOcc')[0]?.textContent || '',
        produtoLocal:    xItem.getElementsByTagName('DbItProdutoLocal')[0]?.textContent || '',
        produtoCliente:  xItem.getElementsByTagName('DbItProdutoCliente')[0]?.textContent || '',
        qtdFaturada:     xItem.getElementsByTagName('DbItQtdFaturada')[0]?.textContent || '0',
      }))

      if (parsed.length > 0) {
        setItems(parsed)
        setSelOcc(prev => prev || parsed[0].occ)

        setEtiquetas(prev => {
          if (prev.length > 0) return prev
          const etqsXml = []
          xmlItems.forEach(xItem => {
            const occ = xItem.getElementsByTagName('DbItOcc')[0]?.textContent || ''
            Array.from(xItem.getElementsByTagName('Tb_ASNItemEtiqueta')).forEach(etq => {
              etqsXml.push({
                id:               Math.random().toString(36).slice(2, 9),
                itemOcc:          occ,
                selected:         true,
                numeroUM:         etq.getElementsByTagName('DbEtqNroEtiquetaUnidadeMovimentacao')[0]?.textContent || '',
                numeroUC:         etq.getElementsByTagName('DbEtqNroEtiquetaUnidadeCondicionamento')[0]?.textContent || '',
                codigoEmbalagemUC: etq.getElementsByTagName('DbEtqCodigoEmbalagemUC')[0]?.textContent || '',
                quantidadePecasUC: etq.getElementsByTagName('DbEtqQuantidadeDePecasNaUC')[0]?.textContent || '',
                localUtilizacao:  etq.getElementsByTagName('DbEtqPontoDeUso')[0]?.textContent || '',
                lote:             etq.getElementsByTagName('DbEtqLoteFabricacao')[0]?.textContent || '',
                numeroDocumento:  etq.getElementsByTagName('DbEtqTextoLivre')[0]?.textContent || '',
                dataFabricacao:   etq.getElementsByTagName('DbEtqDtFabricacao')[0]?.textContent || '',
                doca:             etq.getElementsByTagName('DbEtqDoca')[0]?.textContent || '',
                ran:              etq.getElementsByTagName('DbEtqCallDelivery')[0]?.textContent || '',
                codigoEmbalagemUM: '',
                dataDe: '', crossDock: '',
              })
            })
          })
          return etqsXml
        })
      }
    } catch (err) {
      setXmlError(err.message)
    } finally {
      setXmlLoading(false)
    }
  }, [metaIds, xmlRaw, xmlLoading, row?.NumeroDocto])

  useEffect(() => {
    if (metaIds.length > 0 && !xmlRaw && !xmlLoading) loadXmlAsn()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleAddManual = () => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '/')
    const occ = selectedItemOcc || '1'
    const numDocto = expedicao.numDocto || row?.NumeroDocto || ''
    setEtiquetas(prev => [...prev, {
      id: Math.random().toString(36).slice(2, 9),
      itemOcc: occ, selected: true,
      numeroUM: '', numeroUC: '',
      quantidadePecasUC: '0', codigoEmbalagemUC: '',
      codigoEmbalagemUM: '', localUtilizacao: '',
      doca: expedicao.doca || '', ran: '', lote: '',
      dataFabricacao: today, dataDe: '', crossDock: '',
      numeroDocumento: numDocto,
    }])
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
      return updated
    })
  }, [saveToDb])

  const handleDelete = (id) => setEtiquetas(prev => prev.filter(e => e.id !== id))
  const handleToggleSelected = (id, val) => setEtiquetas(prev => prev.map(e => e.id === id ? { ...e, selected: val } : e))
  const handleUpdateEtiqueta = useCallback((row, values) => {
    const id = row.original.id
    setEtiquetas(prev => prev.map(e => e.id === id ? { ...e, ...values } : e))
  }, [])

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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
        onOpenTemplateSelector={() => setTplOpen(true)}
        onViewer={handleViewer}
        onPrint={handlePrint}
        onSave={() => saveToDb()}
      />

      {saveMsg && (
        <Alert severity={saveMsg.type} onClose={() => setSaveMsg(null)}
          sx={{ fontSize: 11, py: 0.3, mx: 2, mt: 1 }}>
          {saveMsg.text}
        </Alert>
      )}

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
          onAddManual={handleAddManual}
          onLoteOpen={() => setLoteOpen(true)}
          handleDelete={handleDelete}
          handleToggleSelected={handleToggleSelected}
          handleUpdateEtiqueta={handleUpdateEtiqueta}
        />
      </Box>

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
