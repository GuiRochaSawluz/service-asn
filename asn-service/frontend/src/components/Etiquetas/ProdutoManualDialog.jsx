import { useState, useEffect } from 'react'
import { Box, Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Divider } from '@mui/material'
import SaveIcon from '@mui/icons-material/Save'
import { fieldSx, dialogPaperSx } from './EtiquetasTheme'

/**
 * Permite ao usuário criar ou editar um item de produto quando não há XML-ASN.
 * @param editingItem  - Se fornecido, o modal abre com os dados pré-preenchidos (modo edição).
 * @param nextOcc      - Número sequencial de OCC para novo registro.
 */
export default function ProdutoManualDialog({ open, onClose, onSave, editingItem, nextOcc, theme }) {
  const defaultDate = new Date().toISOString().slice(0, 10).replace(/-/g, '/')
  const isEditing   = Boolean(editingItem)

  const [produtoLocal,       setProdutoLocal]      = useState('')
  const [produtoCliente,     setProdutoCliente]    = useState('')
  const [qtdFaturada,        setQtdFaturada]       = useState('')
  const [lote,               setLote]              = useState('')
  const [doca,               setDoca]              = useState('')
  const [localUtilizacao,    setLocalUtil]         = useState('')
  const [dataFabricacao,     setDataFab]           = useState(defaultDate)
  const [ran,                setRan]               = useState('')
  const [errors,             setErrors]            = useState({})

  useEffect(() => {
    if (open && isEditing) {
      setProdutoLocal(editingItem.produtoLocal || '')
      setProdutoCliente(editingItem.produtoCliente || '')
      setQtdFaturada(editingItem.qtdFaturada || '')
      setLote(editingItem.lote || '')
      setDoca(editingItem.doca || '')
      setLocalUtil(editingItem.localUtilizacao || '')
      setDataFab(editingItem.dataFabricacao || defaultDate)
      setRan(editingItem.ran || '')
    } else if (open && !isEditing) {
      setProdutoLocal('')
      setProdutoCliente('')
      setQtdFaturada('')
      setLote('')
      setDoca('')
      setLocalUtil('')
      setDataFab(defaultDate)
      setRan('')
      setErrors({})
    }
  }, [open, isEditing, editingItem])

  const validate = () => {
    const e = {}
    if (!produtoLocal.trim())    e.produtoLocal    = 'Campo obrigatório'
    if (!produtoCliente.trim())  e.produtoCliente  = 'Campo obrigatório'
    if (!qtdFaturada || parseFloat(qtdFaturada) <= 0) e.qtdFaturada = 'Informe uma quantidade válida'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSave = () => {
    if (!validate()) return
    onSave({
      occ:             editingItem?.occ || String(nextOcc),
      produtoLocal:    produtoLocal.trim(),
      produtoCliente:  produtoCliente.trim(),
      qtdFaturada:     qtdFaturada,
      lote,
      doca,
      localUtilizacao,
      dataFabricacao: dataFabricacao || '',
      ran,
      _manual: true,
    })
    onClose()
  }

  const fSx = fieldSx(theme);
  const errSx = (field) => errors[field]
    ? { ...fSx, '& .MuiOutlinedInput-root fieldset': { borderColor: `${theme.danger} !important` } }
    : fSx

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: dialogPaperSx(theme) }}>
      <DialogTitle sx={{ fontWeight: 700, fontSize: 15, color: theme.textMain, pb: 0 }}>
        {isEditing ? 'Editar Produto' : 'Novo Produto (Manual)'}
        <Typography component="span" sx={{ fontSize: 11, fontWeight: 400, color: theme.textDisabled, ml: 1.5 }}>
          {isEditing ? `OCC ${editingItem.occ}` : `OCC ${nextOcc}`}
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: 2 }}>
        <Typography sx={{ fontSize: 10, fontWeight: 700, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', mb: 1.5 }}>
          Identificação do Produto *
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          <TextField
            size="small" label="Produto (cód. interno) *"
            value={produtoLocal} onChange={e => setProdutoLocal(e.target.value)}
            sx={errSx('produtoLocal')} error={Boolean(errors.produtoLocal)} helperText={errors.produtoLocal}
          />
          <TextField
            size="small" label="Produto Cliente (cód. cliente) *"
            value={produtoCliente} onChange={e => setProdutoCliente(e.target.value)}
            sx={errSx('produtoCliente')} error={Boolean(errors.produtoCliente)} helperText={errors.produtoCliente}
          />
          <TextField
            size="small" label="Quantidade Total Autorizada (peças) *"
            type="number" value={qtdFaturada} onChange={e => setQtdFaturada(e.target.value)}
            sx={errSx('qtdFaturada')} error={Boolean(errors.qtdFaturada)} helperText={errors.qtdFaturada}
          />
        </Box>

        <Divider sx={{ my: 2, borderColor: theme.borderLight }} />
        <Typography sx={{ fontSize: 10, fontWeight: 700, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', mb: 1.5 }}>
          Dados de Expedição
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          <TextField size="small" label="Lote" value={lote} onChange={e => setLote(e.target.value)} sx={fSx} />
          <TextField size="small" label="Doca" value={doca} onChange={e => setDoca(e.target.value)} sx={fSx} />
          <TextField size="small" label="Local Utilização" value={localUtilizacao} onChange={e => setLocalUtil(e.target.value)} sx={fSx} />
          <TextField size="small" label="RAN (Call Delivery)" value={ran} onChange={e => setRan(e.target.value)} sx={fSx} />
          <TextField size="small" label="Data Fabricação" value={dataFabricacao} onChange={e => setDataFab(e.target.value)} sx={fSx} placeholder="YYYY/MM/DD" />
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none', fontSize: 13, color: theme.textMuted }}>
          Cancelar
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          startIcon={<SaveIcon />}
          sx={{ textTransform: 'none', fontSize: 13, bgcolor: theme.primary, '&:hover': { bgcolor: theme.primaryDark } }}
        >
          {isEditing ? 'Salvar Alterações' : 'Cadastrar Produto'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
