import { useState, useEffect } from 'react'
import { Box, Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Divider, Alert, CircularProgress } from '@mui/material'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import { fieldSx, dialogPaperSx } from './EtiquetasTheme'

export default function GeracaoLoteDialog({ open, onClose, onGenerate, item, expedicao, initialNumDocto, theme }) {
  const defaultDate = new Date().toISOString().slice(0, 10).replace(/-/g, '/')

  const [qtdPorCaixa, setQtdPorCaixa]       = useState('')
  const [modoAgrupamento, setModoAgrupamento] = useState('agrupar')
  const [maxCaixasPorPallet, setMaxCaixasPallet] = useState('')
  const [prefixUM, setPrefixUM]              = useState('')
  const [prefixUC, setPrefixUC]              = useState('')
  const [ran, setRan]                      = useState('')
  const [embalagem, setEmbalagem]          = useState('')
  const [doca, setDoca]                    = useState('')
  const [localUtilizacao, setLocalUtil]    = useState('')
  const [lote, setLote]                    = useState('')
  const [dataFab, setDataFab]              = useState(defaultDate)
  const [numDocto, setNumDocto]            = useState(initialNumDocto || '')
  const [loading, setLoading]              = useState(false)
  const [error, setError]                  = useState(null)

  useEffect(() => {
    if (expedicao?.doca)   setDoca(expedicao.doca)
    if (expedicao?.numDocto) setNumDocto(expedicao.numDocto)
    else if (initialNumDocto) setNumDocto(initialNumDocto)
  }, [expedicao, initialNumDocto])

  const totalQtd   = parseFloat(item?.qtdFaturada) || 0
  const perCaixa   = parseFloat(qtdPorCaixa)       || 0
  const fullBoxes  = perCaixa > 0 ? Math.floor(totalQtd / perCaixa) : 0
  const remainder  = perCaixa > 0 ? totalQtd % perCaixa             : 0
  const totalBoxes = fullBoxes + (remainder > 0 ? 1 : 0)

  const clienteCodigo = expedicao?.clienteCodigo || 'GENERICO'

  const handleGenerate = async () => {
    if (!perCaixa || perCaixa <= 0) { setError('Informe a quantidade por caixa'); return }
    if (!qtdPorCaixa)               { setError('Quantidade por caixa é obrigatória'); return }
    if (totalBoxes > 500)           { setError('Limite de 500 caixas por vez'); return }

    setLoading(true)
    setError(null)
    try {
      const ucRes = await fetch('/api/labels/sequence/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente_codigo: clienteCodigo,
          sequence_type: 'UC',
          count: totalBoxes,
          prefix: prefixUC,
        }),
      }).then(r => r.json())
      const seqsUC = ucRes.sequences || []

      let seqsUM = []
      if (modoAgrupamento === 'agrupar') {
        const maxCaixas = parseInt(maxCaixasPorPallet) || 500
        const numPallets = Math.ceil(totalBoxes / maxCaixas)
        
        const umRes = await fetch('/api/labels/sequence/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cliente_codigo: clienteCodigo,
            sequence_type: 'UM',
            count: numPallets,
            prefix: prefixUM,
          }),
        }).then(r => r.json())
        const seqsUMGeradas = umRes.sequences || []
        
        for (let i = 0; i < totalBoxes; i++) {
          const palletIndex = Math.floor(i / maxCaixas)
          seqsUM.push(seqsUMGeradas[palletIndex] || '')
        }
      } else if (modoAgrupamento === 'uc_igual_um') {
        seqsUM = [...seqsUC]
      } else {
        const umRes = await fetch('/api/labels/sequence/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cliente_codigo: clienteCodigo,
            sequence_type: 'UM',
            count: totalBoxes,
            prefix: prefixUM,
          }),
        }).then(r => r.json())
        seqsUM = umRes.sequences || []
      }

      const itemOcc = item?.occ || '1'
      const novas = Array.from({ length: totalBoxes }, (_, i) => {
        const isLast  = i === totalBoxes - 1
        const qtdEsta = isLast && remainder > 0 ? remainder : perCaixa
        return {
          id:               Math.random().toString(36).slice(2, 9),
          itemOcc,
          selected:         true,
          numeroUM:         seqsUM[i] || '',
          numeroUC:         seqsUC[i] || '',
          quantidadePecasUC: String(qtdEsta),
          codigoEmbalagemUC: embalagem,
          codigoEmbalagemUM: '',
          localUtilizacao,
          doca:             doca || expedicao?.doca || '',
          ran,
          lote,
          dataFabricacao:   dataFab,
          dataDe:           '',
          crossDock:        '',
          numeroDocumento:  numDocto,
        }
      })

      onGenerate(novas)
      onClose()
    } catch (err) {
      setError(err.message || 'Erro ao gerar etiquetas')
    } finally {
      setLoading(false)
    }
  }

  const fSx = fieldSx(theme)

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth
      PaperProps={{ sx: dialogPaperSx(theme) }}>
      <DialogTitle sx={{ fontWeight: 700, fontSize: 15, color: theme.textMain, pb: 0 }}>
        Automação de Lote
        {item && (
          <Typography component="span" sx={{ fontSize: 12, fontWeight: 400, color: theme.textMuted, ml: 1.5 }}>
            {item.produtoCliente || item.produtoLocal || `Item ${item.occ}`}
            {item.qtdFaturada ? ` — ${item.qtdFaturada} peças` : ''}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        {error && <Alert severity="error" sx={{ mb: 2, fontSize: 12, mt: 1 }}>{error}</Alert>}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField
              size="small" label="Qtd de Peças por Caixa (UC) *"
              type="number" value={qtdPorCaixa}
              onChange={e => setQtdPorCaixa(e.target.value)}
              sx={fSx}
              helperText={totalBoxes > 0
                ? `→ ${totalBoxes} caixa${totalBoxes !== 1 ? 's' : ''}${remainder > 0 ? ` (última com ${remainder.toFixed(0)} peças)` : ''}`
                : ' '}
              FormHelperTextProps={{ sx: { color: theme.primary, fontWeight: 600, fontSize: 11 } }}
            />
            <TextField
              select
              size="small"
              label="Modo de Agrupamento UM/UC"
              value={modoAgrupamento}
              onChange={e => setModoAgrupamento(e.target.value)}
              sx={fSx}
              SelectProps={{ native: true }}
            >
              <option value="agrupar">Agrupar em Pallets (UM agrupa UCs)</option>
              <option value="uc_igual_um">Caixa Única (UC = UM) — Tratamento unificado</option>
              <option value="individual">1 Pallet por Caixa (UM Individual)</option>
            </TextField>
          </Box>

          {modoAgrupamento === 'agrupar' && (
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, pl: 0 }}>
              <Box />
              <TextField
                size="small" label="Qtd Máxima de Caixas/UC no Pallet *"
                type="number" value={maxCaixasPorPallet}
                onChange={e => setMaxCaixasPallet(e.target.value)}
                sx={fSx}
                placeholder="Exemplo: 30"
                helperText="Se as caixas totais excederem este valor, divide-se o lote em mais pallets."
                FormHelperTextProps={{ sx: { color: theme.textMuted, fontSize: 10, lineHeight: 1.2 } }}
              />
            </Box>
          )}
        </Box>

        <Divider sx={{ my: 1.5, borderColor: theme.borderLight }} />
        <Typography sx={{ fontSize: 11, fontWeight: 700, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', mb: 1.5 }}>
          Dados copiados para todas as etiquetas
        </Typography>

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          <TextField size="small" label="RAN (Call Delivery)" value={ran} onChange={e => setRan(e.target.value)} sx={fSx} />
          <TextField size="small" label="Cód. Embalagem UC" value={embalagem} onChange={e => setEmbalagem(e.target.value)} sx={fSx} placeholder="Ex: KLT6147" />
          <TextField size="small" label="Doca" value={doca} onChange={e => setDoca(e.target.value)} sx={fSx} placeholder={expedicao?.doca || ''} />
          <TextField size="small" label="Local Utilização" value={localUtilizacao} onChange={e => setLocalUtil(e.target.value)} sx={fSx} />
          <TextField size="small" label="Data Fabricação" value={dataFab} onChange={e => setDataFab(e.target.value)} sx={fSx} placeholder="YYYY/MM/DD" />
          <TextField size="small" label="Lote" value={lote} onChange={e => setLote(e.target.value)} sx={fSx} />
          <TextField size="small" label="No. Documento (NF)" value={numDocto} onChange={e => setNumDocto(e.target.value)} sx={fSx} />
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
            <TextField size="small" label="Prefixo UM" value={prefixUM} onChange={e => setPrefixUM(e.target.value)} sx={fSx} />
            <TextField size="small" label="Prefixo UC" value={prefixUC} onChange={e => setPrefixUC(e.target.value)} sx={fSx} />
          </Box>
        </Box>

        {totalBoxes > 0 && (() => {
          const totalVol  = parseFloat(item?.qtdFaturada) || 0
          const newVol    = (fullBoxes * perCaixa) + (remainder > 0 ? remainder : 0)
          const willExceed = totalVol > 0 && newVol > totalVol
          return (
            <>
              <Alert severity={willExceed ? 'warning' : 'info'} sx={{ mt: 2, fontSize: 12, py: 0.5 }}>
                Serão geradas <strong>{totalBoxes} etiquetas/caixas</strong>
                {' '}com <strong>{perCaixa.toFixed(0)} peças</strong> cada
                {remainder > 0 ? ` (última com ${remainder.toFixed(0)} peças)` : ''}
                {' '}— <strong>{newVol.toFixed(0)} peças no total</strong>
                {totalVol > 0 && <>{' '}de <strong>{totalVol.toFixed(0)}</strong> autorizadas</>}
              </Alert>
              {willExceed && (
                <Alert severity="error" sx={{ mt: 1, fontSize: 12, py: 0.4 }}>
                  ⚠️ <strong>Volume excede o autorizado!</strong> O lote gerará{' '}
                  <strong>{newVol.toFixed(0)}</strong> peças, mas o item tem apenas{' '}
                  <strong>{totalVol.toFixed(0)}</strong> peças autorizadas.
                </Alert>
              )}
            </>
          )
        })()}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none', fontSize: 13, color: theme.textMuted }}>
          Cancelar
        </Button>
        <Button
          onClick={handleGenerate}
          variant="contained"
          disabled={loading || totalBoxes < 1}
          startIcon={loading ? <CircularProgress size={14} /> : <AutoFixHighIcon />}
          sx={{ textTransform: 'none', fontSize: 13, bgcolor: theme.primary, '&:hover': { bgcolor: theme.primaryDark } }}
        >
          {loading ? 'Gerando...' : `Gerar ${totalBoxes > 0 ? totalBoxes : ''} Etiquetas`}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
