/**
 * AvisoEmbarqueTab.jsx
 * --------------------
 * Aba "Aviso de Embarque" no DetailsModal para documentos ProcNFe.
 *
 * Novo fluxo (digitação de NF-e):
 * ─ Cabeçalho : Nº NF + Chave (auto), Fábrica, Doca, Local de Entrega (digitação)
 * ─ Produtos  : carrega itens do XML original da NF-e (produto local, qtd, chave)
 *               cada item vira uma linha onde o usuário digita o produto externo
 * ─ Etiquetas : botão por produto (não global) → abre EtiquetasTab contextualizado
 *
 * Lógica de geração RND 004 / DESADV / 856 permanece inalterada.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Box, Typography, Button, TextField, Chip, Alert, CircularProgress,
  Divider, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import DownloadIcon from '@mui/icons-material/Download'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import SearchIcon from '@mui/icons-material/Search'
import LocalShippingIcon from '@mui/icons-material/LocalShipping'
import LabelIcon from '@mui/icons-material/Label'
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos'
import RefreshIcon from '@mui/icons-material/Refresh'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import { Brand } from './theme'
import { useEmulation } from './EmulationContext'
import { sanitizeS3Text } from './utils_s3'
import { swpaas } from './swpaasService'
import EtiquetasTab from './EtiquetasTab'
import { useI18n, LOCALE_MAP } from './I18nContext'

// ── Helpers ────────────────────────────────────────────────────────────────────
const fieldSx = (isDark) => ({
  '& .MuiOutlinedInput-root': {
    color: isDark ? '#e8e8e8' : undefined, fontSize: 13,
    '& fieldset': { borderColor: isDark ? '#2a2d35' : '#e2e8f0' },
    '&:hover fieldset': { borderColor: Brand.green },
    '&.Mui-focused fieldset': { borderColor: Brand.green },
  },
  '& .MuiInputLabel-root': { color: isDark ? '#666' : undefined, fontSize: 13 },
  '& .MuiInputLabel-root.Mui-focused': { color: Brand.green },
})

const sectionLabel = (text, isDark) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
    <Box sx={{ width: 3, height: 14, borderRadius: 2, bgcolor: Brand.green }} />
    <Typography sx={{
      fontSize: 10, fontWeight: 800, letterSpacing: '0.8px',
      textTransform: 'uppercase', color: isDark ? Brand.greenBright : Brand.greenDark,
    }}>
      {text}
    </Typography>
  </Box>
)

// ── Célula de documento fiscal ──────────────────────────────────────────────────
// required: mostra badge de preenchimento; highlight: borda esquerda âmbar pulsante
function DC({ label, value, mono, edit, span, isDark, bc, required, highlight }) {
  const { t } = useI18n('avisoEmbarque')
  const isEmpty = required && !value && !edit
  return (
    <Box sx={{
      px: 0.8, py: 0.5, borderRight: `1px solid ${bc}`,
      gridColumn: span ? `span ${span}` : undefined,
      minWidth: 0,
      borderLeft: highlight ? `3px solid ${isDark ? '#f59e0b' : '#d97706'}` : '3px solid transparent',
      bgcolor: highlight
        ? (isDark ? 'rgba(245,158,11,0.07)' : 'rgba(217,119,6,0.05)')
        : undefined,
      transition: 'background 0.2s',
      // Subtle pulse animation on required+empty fields
      ...(highlight && isEmpty && {
        animation: 'asnPulse 2.4s ease-in-out infinite',
      }),
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.3 }}>
        <Typography sx={{ fontSize: 7, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', color: isDark ? '#555' : '#888', lineHeight: 1.2 }}>{label}</Typography>
        {required && (
          <Box component="span" sx={{ fontSize: 6, fontWeight: 900, color: isDark ? '#f59e0b' : '#d97706', letterSpacing: '0.3px', textTransform: 'uppercase' }}>{t.fillTag}</Box>
        )}
      </Box>
      {edit || <Typography sx={{ fontSize: 12, fontWeight: 600, fontFamily: mono ? 'monospace' : 'Inter, sans-serif', color: isDark ? '#e0e0e0' : '#111', lineHeight: 1.3, wordBreak: 'break-word', minHeight: 18 }}>{value || ' '}</Typography>}
    </Box>
  )
}

// TextField sem bordas visuais para uso dentro das células DC (campo editável inline)
const inlineSx = (isDark, highlighted) => ({
  '& .MuiInput-root': { fontSize: 12, fontWeight: 600, color: isDark ? '#e0e0e0' : '#111' },
  '& .MuiInput-underline:before': {
    borderBottom: highlighted
      ? `2px dashed ${isDark ? '#f59e0b' : '#d97706'}`
      : `1px dashed ${isDark ? '#3a4a5a' : '#ccc'}`,
  },
  '& .MuiInput-underline:hover:before': { borderBottom: `2px solid ${Brand.green} !important` },
  '& .MuiInput-underline:after': { borderBottom: `2px solid ${Brand.green}` },
  width: '100%',
})


function MapeamentoPickerDialog({ open, onClose, onSelect, isDark, apiBaseUrl = '' }) {
  const { t, tc } = useI18n('avisoEmbarque')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch(`${apiBaseUrl}/api/mapeamentos`)
      .then(r => r.json())
      .then(d => setItems(d.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [open, apiBaseUrl])

  const filtered = items.filter(i =>
    !q || i.nome.toLowerCase().includes(q.toLowerCase()) ||
    i.dll_filename.toLowerCase().includes(q.toLowerCase())
  )

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: { bgcolor: isDark ? '#13161e' : '#fff', border: `1px solid ${isDark ? '#2a2d35' : '#e0e0e0'}`, borderRadius: 2 } }}>
      <DialogTitle sx={{ fontWeight: 700, fontSize: 15, color: isDark ? '#fff' : '#111', pb: 1 }}>
        {t.selectEdiMapping}
      </DialogTitle>
      <DialogContent>
        <TextField fullWidth size="small" placeholder={t.searchPlaceholder} value={q}
          onChange={e => setQ(e.target.value)}
          sx={{ mb: 2, ...fieldSx(isDark) }}
          InputProps={{ startAdornment: <SearchIcon sx={{ fontSize: 16, mr: 0.5, color: isDark ? '#555' : '#aaa' }} /> }}
        />
        {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={24} sx={{ color: Brand.green }} />
        </Box>}
        {!loading && filtered.map(item => (
          <Box key={item.id} onClick={() => { onSelect(item); onClose() }} sx={{
            p: 1.5, mb: 1, borderRadius: 1.5, cursor: 'pointer',
            border: `1px solid ${isDark ? '#2a2d35' : '#e0e0e0'}`,
            bgcolor: isDark ? '#0d1117' : '#fafafa',
            '&:hover': { borderColor: Brand.green, bgcolor: isDark ? '#0d1f14' : '#f0fbf4' },
            transition: 'all 0.15s',
          }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: isDark ? '#e0e0e0' : '#111' }}>{item.nome}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.3 }}>
              <Typography sx={{ fontSize: 11, color: isDark ? '#555' : '#aaa', fontFamily: 'monospace' }}>{item.dll_filename}</Typography>
              {item.tem_crossid && <Chip label="CrossID" size="small" sx={{ fontSize: 9, height: 16, bgcolor: Brand.green + '22', color: Brand.green }} />}
              {item.mensagem_edi && <Chip label={item.mensagem_edi} size="small" sx={{ fontSize: 9, height: 16, bgcolor: isDark ? '#1e2330' : '#f1f5f9', color: isDark ? '#a0aab5' : '#64748b' }} />}
              {item.versao_edi && <Chip label={`v${item.versao_edi}`} size="small" sx={{ fontSize: 9, height: 16 }} />}
            </Box>
          </Box>
        ))}
        {!loading && filtered.length === 0 && (
          <Typography sx={{ fontSize: 12, color: isDark ? '#555' : '#aaa', textAlign: 'center', py: 3 }}>
            {items.length === 0
              ? t.noMappingRegistered
              : t.noSearchResults}
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none', fontSize: 13 }}>{tc.cancel}</Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Dialog de Etiquetas por produto ────────────────────────────────────────────
function EtiquetasProdutoDialog({ open, onClose, row, item, isDark }) {
  const { t, tc } = useI18n('avisoEmbarque')
  if (!open) return null
  // Cria um row sintético enriquecido com os dados do item local p/ alimentar EtiquetasTab
  const syntheticRow = {
    ...row,
    // Sobrescreve apenas o que é necessário para o contexto do produto
    _avisoItem: item,
  }
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth
      PaperProps={{ sx: { height: '90vh', bgcolor: isDark ? '#141414' : '#fff', border: `1px solid ${isDark ? '#2a2d35' : '#e0e0e0'}` } }}>
      <DialogTitle sx={{
        fontWeight: 700, fontSize: 14, color: isDark ? '#fff' : '#111', pb: 1,
        borderBottom: `1px solid ${isDark ? '#2a2d35' : '#e0e0e0'}`,
        display: 'flex', alignItems: 'center', gap: 1,
      }}>
        <LabelIcon sx={{ color: Brand.green, fontSize: 18 }} />
        {t.labelsTitle} — {item?.produto_local || t.product} / {item?.produto_externo || '—'}
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={onClose} sx={{ textTransform: 'none', color: isDark ? '#aaa' : '#666', fontSize: 12 }}>
          {tc.close}
        </Button>
      </DialogTitle>
      <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <EtiquetasTab row={syntheticRow} mode={isDark ? 'dark' : 'light'} avisoItem={item} />
      </DialogContent>
    </Dialog>
  )
}

// ── Modal de edição de produto (Progressive Disclosure) ───────────────────────
function ProdutoEditModal({ open, onClose, item, onSave, isDark, onOpenEtiquetas }) {
  const { t, tc } = useI18n('avisoEmbarque')
  const [draft, setDraft] = useState(() => {
    const d = item ? { ...item } : {}
    if (d && !d.call_deliveries) {
      if (d.call_delivery) {
        d.call_deliveries = [{ call_delivery: d.call_delivery, quantidade: d.quantidade || '' }]
      } else {
        d.call_deliveries = []
      }
    }
    return d
  })

  useEffect(() => { 
    if (item) {
      const d = { ...item }
      if (!d.call_deliveries) {
        if (d.call_delivery) {
          d.call_deliveries = [{ call_delivery: d.call_delivery, quantidade: d.quantidade || '' }]
        } else {
          d.call_deliveries = []
        }
      }
      setDraft(d)
    }
  }, [item])

  if (!open || !item) return null

  const fsx = {
    '& .MuiOutlinedInput-root': {
      color: isDark ? '#e8e8e8' : undefined, fontSize: 13,
      '& fieldset': { borderColor: isDark ? '#2a2d35' : '#e2e8f0' },
      '&:hover fieldset': { borderColor: Brand.green },
      '&.Mui-focused fieldset': { borderColor: Brand.green },
    },
    '& .MuiInputLabel-root': { color: isDark ? '#666' : undefined, fontSize: 13 },
    '& .MuiInputLabel-root.Mui-focused': { color: Brand.green },
  }
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  const addCD = () => setDraft(d => ({ ...d, call_deliveries: [...(d.call_deliveries || []), { call_delivery: '', quantidade: '' }] }))
  const removeCD = (idx) => setDraft(d => ({ ...d, call_deliveries: d.call_deliveries.filter((_, i) => i !== idx) }))
  const updateCD = (idx, field, val) => setDraft(d => {
    const next = [...(d.call_deliveries || [])]
    next[idx] = { ...next[idx], [field]: val }
    return { ...d, call_deliveries: next }
  })

  const isReady = draft.produto_externo?.trim() && draft.quantidade?.trim()

  const ReadField = ({ label, value }) => (
    <Box>
      <Typography sx={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: isDark ? '#444' : '#aaa', mb: 0.2 }}>{label}</Typography>
      <Typography sx={{ fontSize: 12, fontWeight: 600, color: isDark ? '#bbb' : '#555', fontFamily: 'monospace' }}>{value || '—'}</Typography>
    </Box>
  )

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth
      PaperProps={{ sx: { bgcolor: isDark ? '#0f1117' : '#fff', border: `1px solid ${isDark ? '#2a2d35' : '#e0e0e0'}`, borderRadius: 2 } }}>
      <DialogTitle sx={{ fontWeight: 700, fontSize: 14, color: isDark ? '#fff' : '#111', pb: 1, borderBottom: `2px solid ${Brand.green}`, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 3, height: 14, bgcolor: isReady ? Brand.green : '#f59e0b', borderRadius: 1 }} />
            <Typography sx={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.6px', color: isReady ? Brand.green : '#f59e0b' }}>
              {isReady ? t.itemComplete : t.itemPending}
            </Typography>
          </Box>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: isDark ? '#e0e0e0' : '#111', fontFamily: 'monospace', mt: 0.3 }}>
            {item.produto_local} — {item.descricao || t.product}
          </Typography>
        </Box>
        {isReady && (
          <Button size="small" startIcon={<LabelIcon sx={{ fontSize: 14 }} />}
            onClick={() => onOpenEtiquetas(draft)}
            sx={{ textTransform: 'none', fontSize: 11, bgcolor: Brand.green, color: '#fff', '&:hover': { bgcolor: Brand.greenDark }, flexShrink: 0 }}>
            {t.labels}
          </Button>
        )}
      </DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        {/* Dados da NF (somente leitura) */}
        <Typography sx={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.8px', color: isDark ? '#444' : '#aaa', mb: 1 }}>
          {t.nfeReadOnly}
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1.5, mb: 2.5, p: 1.5, borderRadius: 1.5, bgcolor: isDark ? '#080b10' : '#f8f9fa', border: `1px solid ${isDark ? '#1e2330' : '#e9ecef'}` }}>
          <ReadField label={t.ncmSh} value={item.ncm} />
          <ReadField label={t.qtyNfe} value={item.qtd_nfe} />
          <ReadField label={t.unitValue} value={item.valor_unitario ? `R$ ${parseFloat(item.valor_unitario).toFixed(2)}` : null} />
          <ReadField label={t.totalValue} value={item.valor_total ? `R$ ${parseFloat(item.valor_total).toFixed(2)}` : null} />
          <ReadField label={t.bcIcms} value={item.base_icms} />
          <ReadField label={t.aliqIcms} value={item.aliquota_icms ? `${item.aliquota_icms}%` : null} />
          <ReadField label={t.vIcms} value={item.valor_icms} />
          <ReadField label={t.cfopNf} value={item.nfe_cfop} />
        </Box>
        {/* Campos editáveis */}
        <Typography sx={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.8px', color: isDark ? Brand.greenBright : Brand.greenDark, mb: 1 }}>
          {t.shipmentData}
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 1.5, mb: 1.5 }}>
          <TextField size="small" label={t.externalProduct} value={draft.produto_externo || ''}
            onChange={e => set('produto_externo', e.target.value)} sx={fsx}
            error={!draft.produto_externo} helperText={!draft.produto_externo ? t.required : ''}
            FormHelperTextProps={{ sx: { fontSize: 10, color: '#f59e0b' } }} />
          <TextField size="small" label={t.qtyShipment} type="number" value={draft.quantidade || ''}
            onChange={e => set('quantidade', e.target.value)} sx={fsx}
            error={!draft.quantidade}
            helperText={item.qtd_nfe && draft.quantidade && parseFloat(draft.quantidade) > parseFloat(item.qtd_nfe) ? t.exceedsNf.replace('{n}', item.qtd_nfe) : ''}
            FormHelperTextProps={{ sx: { fontSize: 10, color: '#f59e0b' } }} />
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1.5, mb: 1.5 }}>
          <TextField size="small" label={t.orderNumber} value={draft.num_pedido || ''}
            onChange={e => set('num_pedido', e.target.value)} sx={fsx} placeholder="Ex: 818920" />
          <TextField size="small" label={t.occSeq} value={draft.occ || ''}
            onChange={e => set('occ', e.target.value)} sx={fsx} />
        </Box>

        <Box sx={{ mb: 1.5 }}>
          <TextField size="small" fullWidth label="Tipo de Fornecimento" value={draft.tipo_fornecimento || ''}
            onChange={e => set('tipo_fornecimento', e.target.value)} sx={fsx}
            error={!draft.tipo_fornecimento}
            helperText={!draft.tipo_fornecimento ? t.required : ''}
            FormHelperTextProps={{ sx: { fontSize: 10, color: '#f59e0b' } }}
            placeholder="Ex: ?" />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography sx={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.8px', color: isDark ? Brand.greenBright : Brand.greenDark }}>
            {t.callDeliveriesMultiple}
          </Typography>
          <Button size="small" onClick={addCD} sx={{ fontSize: 10, textTransform: 'none', color: Brand.green }}>
            {t.addCallDelivery}
          </Button>
        </Box>
        <Box sx={{ mb: 1.5, p: 1, border: `1px solid ${isDark ? '#2a2d35' : '#e0e0e0'}`, borderRadius: 1.5, bgcolor: isDark ? '#080b10' : '#fafafa' }}>
          {(!draft.call_deliveries || draft.call_deliveries.length === 0) && (
            <Typography sx={{ fontSize: 11, color: isDark ? '#666' : '#aaa', textAlign: 'center', py: 1 }}>
              {t.noCallDelivery}
            </Typography>
          )}
          {draft.call_deliveries?.map((cd, i) => (
            <Box key={i} sx={{ display: 'flex', gap: 1, mb: i < draft.call_deliveries.length - 1 ? 1 : 0, alignItems: 'center' }}>
              <TextField size="small" label={t.callDeliveryLabel.replace('{n}', i + 1)} value={cd.call_delivery}
                onChange={e => updateCD(i, 'call_delivery', e.target.value)} sx={{ ...fsx, flex: 2 }} placeholder="Ex: CD-001234" />
              <TextField size="small" label={t.quantity} type="number" value={cd.quantidade}
                onChange={e => updateCD(i, 'quantidade', e.target.value)} sx={{ ...fsx, flex: 1 }} />
              <Button size="small" color="error" onClick={() => removeCD(i)} sx={{ minWidth: 0, p: 1 }}>
                ✕
              </Button>
            </Box>
          ))}
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1.5 }}>
          <TextField size="small" label={t.batch} value={draft.lote || ''}
            onChange={e => set('lote', e.target.value)} sx={fsx} />
          <TextField size="small" label={t.cfopShipment} value={draft.cfop || ''}
            onChange={e => set('cfop', e.target.value)} sx={fsx} placeholder="Ex: 5101" />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none', fontSize: 13, color: isDark ? '#666' : '#aaa' }}>{tc.cancel}</Button>
        <Button variant="contained" onClick={() => { onSave(draft); onClose() }}
          sx={{ textTransform: 'none', fontWeight: 700, fontSize: 13, bgcolor: Brand.green, '&:hover': { bgcolor: Brand.greenDark } }}>
          {t.saveItem}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function ProdutoRow({ item, idx, onClick, isDark }) {
  const { t } = useI18n('avisoEmbarque')
  const hasExterno  = item.produto_externo?.trim()
  const isReady     = hasExterno && item.quantidade?.trim()
  const callDelivs  = item.call_deliveries?.length ? item.call_deliveries : (item.call_delivery ? [{call_delivery: item.call_delivery, quantidade: item.quantidade}] : [])
  const isEven      = idx % 2 === 0
  const isPending   = !isReady

  return (
    <Box onClick={onClick} sx={{
      display: 'grid', gridTemplateColumns: '32px 1.6fr 1fr 0.7fr 0.7fr 1fr 0.6fr 28px',
      alignItems: 'center', px: 0.8, py: 0.75,
      // Pending rows: amber left border + warm background
      borderLeft: isPending
        ? `4px solid ${isDark ? '#f59e0b' : '#d97706'}`
        : `4px solid ${Brand.green}`,
      bgcolor: isPending
        ? (isDark
            ? (isEven ? 'rgba(245,158,11,0.07)' : 'rgba(245,158,11,0.04)')
            : (isEven ? 'rgba(217,119,6,0.05)' : 'rgba(217,119,6,0.03)'))
        : (isDark
            ? (isEven ? '#0d1117' : '#0a0f14')
            : (isEven ? '#fff' : '#f9fdfb')),
      borderBottom: `1px solid ${isDark ? '#1a2020' : '#e8f5e9'}`,
      cursor: 'pointer',
      transition: 'background 0.15s, border-left-color 0.2s',
      '&:hover': {
        bgcolor: isPending
          ? (isDark ? 'rgba(245,158,11,0.16)' : 'rgba(217,119,6,0.12)')
          : (isDark ? '#0f2318' : '#e8fdf0'),
      },
      // Pulse animation only on pending rows
      ...(isPending && {
        animation: 'prodPulse 3s ease-in-out infinite',
      }),
    }}>
      {/* Seq — circle: green=done, amber=pending */}
      <Box sx={{
        width: 22, height: 22, borderRadius: '50%',
        bgcolor: isReady ? Brand.green : (isDark ? '#3a2800' : '#fef3c7'),
        border: `2px solid ${isReady ? Brand.green : (isDark ? '#f59e0b' : '#d97706')}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Typography sx={{ fontSize: 8, fontWeight: 800, color: isReady ? '#fff' : (isDark ? '#f59e0b' : '#d97706') }}>
          {isReady ? '✓' : String(idx + 1).padStart(2, '0')}
        </Typography>
      </Box>

      {/* Prod Local + Descrição */}
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 10, fontWeight: 700, color: isDark ? '#d0d0d0' : '#222', fontFamily: 'monospace', lineHeight: 1.2 }}>{item.produto_local || '—'}</Typography>
        <Typography sx={{ fontSize: 8.5, color: isDark ? '#555' : '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.descricao}</Typography>
      </Box>

      {/* Prod Externo — badge PREENCHER se vazio */}
      <Box sx={{ minWidth: 0 }}>
        {hasExterno ? (
          <Typography sx={{ fontSize: 10, fontWeight: 600, fontFamily: 'monospace', color: Brand.green, lineHeight: 1.2 }}>
            {item.produto_externo}
          </Typography>
        ) : (
          <Box sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.5,
            px: 0.8, py: 0.25, borderRadius: 0.75,
            bgcolor: isDark ? 'rgba(245,158,11,0.18)' : 'rgba(217,119,6,0.12)',
            border: `1px solid ${isDark ? '#f59e0b66' : '#d9770666'}`,
          }}>
            <Typography sx={{ fontSize: 8, fontWeight: 900, color: isDark ? '#f59e0b' : '#d97706', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
              {t.fillIn}
            </Typography>
          </Box>
        )}
      </Box>

      {/* Qtd NF */}
      <Typography sx={{ fontSize: 10, fontFamily: 'monospace', color: isDark ? '#666' : '#aaa', textAlign: 'right' }}>{item.qtd_nfe || '—'}</Typography>

      {/* Qtd Exp */}
      <Typography sx={{ fontSize: 10, fontWeight: 700, fontFamily: 'monospace', color: isDark ? '#d0d0d0' : '#333', textAlign: 'right' }}>{item.quantidade || '—'}</Typography>

      {/* Pedido + Call Delivery */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.2 }}>
        {item.num_pedido && <Typography sx={{ fontSize: 8, fontFamily: 'monospace', color: isDark ? '#555' : '#aaa' }}>PED: {item.num_pedido}</Typography>}
        {callDelivs.map((cd, i) => cd.call_delivery && (
          <Box key={i} sx={{ display: 'inline-flex', alignItems: 'center', bgcolor: isDark ? '#1a2a3a' : '#e3f2fd', borderRadius: 0.5, px: 0.5, py: 0.1, mt: 0.2 }}>
            <Typography sx={{ fontSize: 8, fontWeight: 700, color: '#1976d2', fontFamily: 'monospace' }}>CD: {cd.call_delivery} ({cd.quantidade})</Typography>
          </Box>
        ))}
        {!item.num_pedido && callDelivs.length === 0 && <Typography sx={{ fontSize: 8, color: isDark ? '#2a2d35' : '#ddd' }}>—</Typography>}
      </Box>

      {/* CFOP */}
      <Typography sx={{ fontSize: 9, fontFamily: 'monospace', color: isDark ? '#555' : '#aaa', textAlign: 'center' }}>{item.cfop || '—'}</Typography>

      {/* Seta / clique */}
      <ArrowForwardIosIcon sx={{
        fontSize: 10,
        color: isPending ? (isDark ? '#f59e0b' : '#d97706') : Brand.green,
        justifySelf: 'end',
      }} />
    </Box>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────────────
/**
 * AvisoEmbarqueTab — tela de digitação do ASN (Aviso de Embarque EDI).
 *
 * Props:
 *   row          {object}   - Registro do intercâmbio (obrigatório)
 *   mode         {string}   - 'dark' | 'light'
 *   apiBaseUrl   {string}   - Base URL da API (default: '' = mesmo domínio)
 *   onGenerated  {function} - Callback chamado com o resultado do /gerar (opcional)
 */
export default function AvisoEmbarqueTab({ row, mode, apiBaseUrl = '', onGenerated }) {
  const isDark = mode === 'dark'
  const { t, tc, lang } = useI18n('avisoEmbarque')
  const locale = LOCALE_MAP[lang] || 'pt-BR'
  const { isMasterUser } = useEmulation()
  const fsx = fieldSx(isDark)

  // ── Cabeçalho ─────────────────────────────────────────────────────────────
  const [fabrica, setFabrica]           = useState('')
  const [doca, setDoca]                 = useState('')
  const [localEntrega, setLocalEntrega] = useState('')
  const [callDelivery, setCallDelivery] = useState('')
  const [codCliente, setCodCliente]     = useState('')

  // ── Produtos carregados do XML ─────────────────────────────────────────────
  const [itens, setItens] = useState([])
  const [xmlLoading, setXmlLoading]   = useState(false)
  const [xmlError, setXmlError]       = useState(null)
  const [xmlLoaded, setXmlLoaded]     = useState(false)
  // Dados informativos extraídos do cabeçalho da NF-e
  const [nfeInfo, setNfeInfo] = useState(null)
  const [swpaasEnv, setSwpaasEnv] = useState(null)

  // Detect SwPaaS environment on mount
  useEffect(() => {
    let cancelled = false
    swpaas.getSwpaasEnv().then(env => { if (!cancelled) setSwpaasEnv(env) })
    return () => { cancelled = true }
  }, [])

  // ── Estado persistido ──────────────────────────────────────────────────────
  const [avisoId, setAvisoId]   = useState(null)
  const [saved, setSaved]       = useState(false)
  const saveTimer               = useRef(null)

  // Modal de edição por produto
  const [modalItem, setModalItem] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)

  // ── Geração ───────────────────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false)
  const [genResult, setGenResult]   = useState(null)
  const [genError, setGenError]     = useState(null)

  // ── Etiquetas por produto ──────────────────────────────────────────────────
  const [etqDialog, setEtqDialog]     = useState(false)
  const [etqItem, setEtqItem]         = useState(null)

  // Essencial OK: ao menos 1 item com produto_externo + quantidade
  const essencialOk = itens.some(i => i.produto_externo?.trim() && i.quantidade?.trim())
  const hasCodCliente = !!codCliente?.trim()
  const hasNfFromXml = !!nfeInfo?.nNF?.trim() && !!nfeInfo?.chaveNfe?.trim()
  const allItensTipoFornecimento = itens.length > 0 && itens.every(i => i.tipo_fornecimento?.trim())
  const canGenerate = essencialOk && hasCodCliente && hasNfFromXml && allItensTipoFornecimento

  // ── 1. Carregar aviso salvo + XML da NF-e ─────────────────────────────────
  // Carrega aviso do banco
  useEffect(() => {
    if (!row?.IdMeta) return
    fetch(`${apiBaseUrl}/api/avisos-embarque?id_meta=${encodeURIComponent(row.IdMeta)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.id) {
          setAvisoId(d.id)
          try {
            const savedItens = JSON.parse(d.itens_json) || []
            if (savedItens.length > 0) setItens(savedItens)
          } catch (_) {}
          setFabrica(d.fabrica || '')
          setDoca(d.doca || '')
          setLocalEntrega(d.local_entrega || '')
          setCallDelivery(d.call_delivery || '')
          setCodCliente(d.cod_cliente || '')
          if (d.rnd004_path) setGenResult({ path: d.rnd004_path, rnd004_length: d.rnd004_length })
        }
      })
      .catch(() => {})
  }, [row?.IdMeta])

  // ── 2. Carregar XML da NF-e via backend ASN (SwPaaS ConteudoArquivo/{IdMetaRef}/edi) ─
  const loadNfeXml = useCallback(async () => {
    const idMetaRef = row?.IdMetaArquivoReferenciado
    const idMeta    = row?.IdMeta

    if (!idMetaRef && !idMeta) {
      setXmlError(t.insufficientData)
      return
    }
    setXmlLoading(true)
    setXmlError(null)
    try {
      // O ASN Service não tem S3 → usa sempre SwPaaS via backend.
      // IdMetaArquivoReferenciado + tipo=edi é a chamada correta:
      //   GET /Intercambios/ConteudoArquivo/{IdMetaArquivoReferenciado}/edi
      const params = new URLSearchParams({ preview: 'true' })
      if (idMetaRef) params.set('id_meta_ref', String(idMetaRef))
      if (idMeta)    params.set('id_meta',     String(idMeta))

      const res = await fetch(`${apiBaseUrl}/api/intercambios/s3-download?${params}`)
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b?.detail || b?.mensagem || `Erro ${res.status}`)
      }
      const text = await res.text()

      // ── Parse XML NF-e ──────────────────────────────────────────────────────
      // IMPORTANTE: O XML da NF-e usa namespace padrão "http://www.portalfiscal.inf.br/nfe"
      // em TODOS os elementos. getElementsByTagName() pode falhar nesse contexto;
      // usamos getElementsByTagNameNS() com o namespace explícito como estratégia primária.
      const NFE_NS = 'http://www.portalfiscal.inf.br/nfe'

      const doc = new DOMParser().parseFromString(text, 'application/xml')

      // Checa se o DOMParser retornou um erro (parseerror é o root quando falha)
      const parseErr = doc.querySelector('parseerror') || doc.getElementsByTagName('parseerror')[0]
      if (parseErr) {
        throw new Error(`Erro ao interpretar o XML: ${parseErr.textContent?.slice(0, 120) || 'formato inválido'}`)
      }

      // Helper: busca por namespace NF-e, depois '*', depois sem namespace (3 tentativas)
      const getEl = (parent, tag) => {
        let els = parent.getElementsByTagNameNS(NFE_NS, tag)
        if (!els.length) els = parent.getElementsByTagNameNS('*', tag)
        if (!els.length) els = parent.getElementsByTagName(tag)
        return Array.from(els)
      }
      const getVal = (parent, tag) => getEl(parent, tag)[0]?.textContent?.trim() || ''

      // Estratégia 1: elements <det> (estrutura padrão procNFe 4.00)
      const dets = getEl(doc, 'det')
      let parsed = []

      if (dets.length > 0) {
        parsed = dets.map((det, i) => {
          const prod = getEl(det, 'prod')[0]
          const scope = prod || det
          const cProd = getVal(scope, 'cProd')
          const xProd = getVal(scope, 'xProd')
          const qCom  = getVal(scope, 'qCom')
          const vUnCom = getVal(scope, 'vUnCom')
          const vProd = getVal(scope, 'vProd')
          const ncm = getVal(scope, 'NCM')
          const cfop = getVal(scope, 'CFOP')
          const xPed = getVal(scope, 'xPed')
          
          const icms = getEl(det, 'ICMS')[0]
          const vBC = getVal(icms || det, 'vBC')
          const pICMS = getVal(icms || det, 'pICMS')
          const vICMS = getVal(icms || det, 'vICMS')

          // nItem pode estar como atributo com ou sem namespace
          const nItem = det.getAttribute('nItem') || det.getAttributeNS(null, 'nItem') || String(i + 1)
          return {
            id: `nfe_${nItem}_${cProd || i}`,
            occ: nItem,
            produto_local: cProd,
            descricao: xProd,
            qtd_nfe: qCom,
            produto_externo: '',
            quantidade: qCom,
            lote: '',
            cfop: cfop,
            ncm: ncm,
            num_pedido: xPed,
            valor_unitario: vUnCom,
            valor_total: vProd,
            base_icms: vBC,
            aliquota_icms: pICMS,
            valor_icms: vICMS,
            tipo_fornecimento: '',
          }
        })
      }

      // Estratégia 2: fallback — busca direto em <prod> (caso estrutura diferente)
      if (parsed.length === 0) {
        const prods = getEl(doc, 'prod')
        parsed = prods.map((prod, i) => {
          const cProd = getVal(prod, 'cProd')
          const xProd = getVal(prod, 'xProd')
          const qCom  = getVal(prod, 'qCom')
          const vUnCom = getVal(prod, 'vUnCom')
          const vProd = getVal(prod, 'vProd')
          const ncm = getVal(prod, 'NCM')
          const cfop = getVal(prod, 'CFOP')
          const xPed = getVal(prod, 'xPed')
          return {
            id: `nfe_prod_${i}_${cProd || i}`,
            occ: String(i + 1),
            produto_local: cProd,
            descricao: xProd,
            qtd_nfe: qCom,
            produto_externo: '',
            quantidade: qCom,
            lote: '',
            cfop: cfop,
            ncm: ncm,
            num_pedido: xPed,
            valor_unitario: vUnCom,
            valor_total: vProd,
            tipo_fornecimento: '',
          }
        })
      }

      // Estratégia 3: regex fallback (último recurso, para XMLs malformados ou parciais)
      if (parsed.length === 0) {
        const detMatches = [...text.matchAll(/<det[^>]*nItem="(\d+)"[^>]*>[\s\S]*?<cProd>(.*?)<\/cProd>[\s\S]*?<xProd>(.*?)<\/xProd>[\s\S]*?<qCom>([\d.]+)<\/qCom>[\s\S]*?<\/det>/g)]
        parsed = detMatches.map((m, i) => ({
          id: `nfe_regex_${m[1]}_${m[2] || i}`,
          occ: m[1],
          produto_local: m[2]?.trim() || '',
          descricao: m[3]?.trim() || '',
          qtd_nfe: m[4]?.trim() || '0',
          produto_externo: '',
          quantidade: m[4]?.trim() || '0',
          lote: '',
          cfop: '',
          tipo_fornecimento: '',
        }))
      }

      if (parsed.length === 0) {
        // Diagnóstico: mostra quantos elementos foram encontrados para debug
        const allTags = [...new Set([...text.matchAll(/<(\w+)/g)].map(m => m[1]))].slice(0, 20)
        setXmlError(
          t.noProductFound.replace('{tags}', allTags.join(', '))
        )
        setXmlLoaded(true)
        return
      }

      // ── Extrair dados informativos do cabeçalho da NF-e ────────────────────
      const emit    = getEl(doc, 'emit')[0]
      const dest    = getEl(doc, 'dest')[0]
      const ide     = getEl(doc, 'ide')[0]
      const total   = getEl(doc, 'total')[0]
      const transp  = getEl(doc, 'transp')[0]
      const vol     = getEl(transp || doc, 'vol')[0]
      const total_vNF = getVal(total || doc, 'vNF') || getVal(total || doc, 'vNFTot')
      const total_vBC = getVal(total || doc, 'vBC')
      const total_vICMS = getVal(total || doc, 'vICMS')
      const pesoB = getVal(vol || doc, 'pesoB')
      const pesoL = getVal(vol || doc, 'pesoL')
      const cfop_header = parsed[0]?.cfop || getVal(ide || doc, 'natOp')
      const infNFeNode = getEl(doc, 'infNFe')[0]
      const infNFeId = infNFeNode?.getAttribute('Id') || ''
      const chaveById = infNFeId.startsWith('NFe') ? infNFeId.slice(3) : infNFeId
      const chaveByProt = getVal(doc, 'chNFe')
      const chaveNfe = (chaveById || chaveByProt || '').trim()

      setNfeInfo({
        emitente:      getVal(emit || doc, 'xNome'),
        emitenteCnpj:  getVal(emit || doc, 'CNPJ'),
        emitEndereco:  [getVal(emit || doc, 'xLgr'), getVal(emit || doc, 'nro'), getVal(emit || doc, 'xMun')].filter(Boolean).join(', '),
        destinatario:  getVal(dest || doc, 'xNome'),
        destCnpj:      getVal(dest || doc, 'CNPJ'),
        natOp:         getVal(ide  || doc, 'natOp'),
        nNF:           getVal(ide  || doc, 'nNF'),
        chaveNfe,
        serie:         getVal(ide  || doc, 'serie'),
        dhEmi:         getVal(ide  || doc, 'dhEmi'),
        vNF:           total_vNF,
        transportadora: getVal(transp || doc, 'xNome'),
        modFrete:      getVal(transp || doc, 'modFrete'),
      })

      // Injeta os totais de imposto da NF em todos os items para que o backend receba
      parsed = parsed.map(p => ({
        ...p,
        nfe_vNF: total_vNF,
        nfe_vBC: total_vBC,
        nfe_vICMS: total_vICMS,
        nfe_pesoB: pesoB,
        nfe_pesoL: pesoL,
        nfe_cfop: cfop_header
      }))

      // Mescla com dados salvos no banco (preserva produto_externo e lote editados)
      setItens(prev => {
        if (prev.length === 0) return parsed
        return parsed.map(p => {
          const savedItem = prev.find(s => s.occ === p.occ || s.produto_local === p.produto_local)
          return savedItem
            ? {
              ...p,
              produto_externo: savedItem.produto_externo || '',
              lote: savedItem.lote || '',
              cfop: savedItem.cfop || p.cfop,
              num_pedido: savedItem.num_pedido || p.num_pedido,
              tipo_fornecimento: savedItem.tipo_fornecimento || '',
            }
            : p
        })
      })
      setXmlLoaded(true)
    } catch (err) {
      setXmlError(sanitizeS3Text(err.message, isMasterUser) || t.xmlLoadFailed)
      setXmlLoaded(true)
    } finally {
      setXmlLoading(false)
    }
  }, [row, isMasterUser, swpaasEnv])

  // Auto-load ao montar (se não houver itens salvos ou se nunca carregou)
  useEffect(() => {
    if (!xmlLoaded && !xmlLoading && row?.IdMeta) {
      // Pequeno delay para deixar aviso salvo carregar primeiro
      const t = setTimeout(() => loadNfeXml(), 400)
      return () => clearTimeout(t)
    }
  }, [row?.IdMeta]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-save ──────────────────────────────────────────────────────────────
  const buildPayload = useCallback(() => ({
    id_meta:            row?.IdMeta ? String(row.IdMeta) : '',
    chave_nfe:          nfeInfo?.chaveNfe ? String(nfeInfo.chaveNfe) : '',
    num_nf:             nfeInfo?.nNF ? String(nfeInfo.nNF) : '',
    fabrica,
    doca,
    local_entrega:      localEntrega,
    call_delivery:      callDelivery,
    cod_cliente:        codCliente || '',
    emitente_nome:      nfeInfo?.emitente || '',
    emitente_cnpj:      nfeInfo?.emitenteCnpj || '',
    emitente_endereco:  nfeInfo?.emitEndereco || '',
    destinatario_nome:  nfeInfo?.destinatario || '',
    destinatario_cnpj:  nfeInfo?.destCnpj || '',
    data_emissao_nfe:   nfeInfo?.dhEmi ? nfeInfo.dhEmi.slice(0, 10).replace(/-/g, '/') : '',
    serie_nfe:          nfeInfo?.serie || '1',
    nat_operacao:       nfeInfo?.natOp || '',
    itens_json:         JSON.stringify(itens),
  }), [row, fabrica, doca, localEntrega, callDelivery, codCliente, nfeInfo, itens])

  const doSave = useCallback(async (payload) => {
    try {
      if (avisoId) {
        await fetch(`/api/avisos-embarque/${avisoId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        setSaved(true)
      } else {
        const res = await fetch('/api/avisos-embarque', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const d = await res.json()
        if (d.id) { setAvisoId(d.id); setSaved(true) }
      }
    } catch (_) {}
  }, [avisoId])

  const scheduleAutoSave = useCallback((payload) => {
    setSaved(false)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => doSave(payload), 1200)
  }, [doSave])

  // Atualizar item (via modal save)
  const updateItem = (updatedItem) => {
    const next = itens.map(it => it.id === updatedItem.id ? { ...it, ...updatedItem } : it)
    setItens(next)
    scheduleAutoSave({ ...buildPayload(), itens_json: JSON.stringify(next) })
  }

  // Cabeçalho com auto-save
  const handleHeader = (setter) => (val) => {
    setter(val)
    setTimeout(() => scheduleAutoSave(buildPayload()), 0)
  }

  // Abrir modal
  const openModal = (item) => { setModalItem(item); setModalOpen(true) }

  // Etiquetas por produto
  const openEtiquetas = (item) => { setEtqItem(item); setEtqDialog(true) }

  // ── Geração ASN ─────────────────────────────────────────────────────────────
  const handleGerar = async () => {
    setGenerating(true); setGenError(null); setGenResult(null)

    try {
      // Cancela qualquer auto-save pendente para evitar race condition
      clearTimeout(saveTimer.current)

      // Garante que o aviso está salvo e temos um ID inteiro válido
      let id = typeof avisoId === 'number' && avisoId > 0 ? avisoId : null

      const payload = buildPayload()

      if (id) {
        // Já existe — faz PUT para garantir dados atualizados
        const putRes = await fetch(`/api/avisos-embarque/${id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        console.log('[AvisoEmbarque] PUT aviso', id, '→', putRes.status)
        if (!putRes.ok) {
          const err = await putRes.json().catch(() => ({}))
          let msg = err.detail || putRes.status
          if (Array.isArray(msg)) msg = msg.map(e => `${e.loc.join('.')}: ${e.msg}`).join(', ')
          throw new Error(`Falha ao atualizar aviso: ${msg}`)
        }
      } else {
        // Não existe ainda — cria
        const postRes = await fetch('/api/avisos-embarque', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const postData = await postRes.json()
        console.log('[AvisoEmbarque] POST aviso →', postData)

        if (!postRes.ok) {
          let msg = postData?.detail || postRes.status
          if (Array.isArray(msg)) msg = msg.map(e => `${e.loc?.join('.')}: ${e.msg}`).join(', ')
          throw new Error(`Falha ao criar aviso: ${typeof msg === 'object' ? JSON.stringify(msg) : msg}`)
        }

        id = typeof postData.id === 'number' ? postData.id : parseInt(postData.id, 10)
        if (!id || isNaN(id) || id <= 0) {
          throw new Error(`Backend retornou um ID inválido: "${postData.id}". Verifique o banco de dados.`)
        }
        setAvisoId(id)
      }

      // Agora id é garantidamente um inteiro positivo
      const gerarBody = {}
      console.log('[AvisoEmbarque] POST /gerar →', { avisoId: id })
      console.log('[AvisoEmbarque] Itens:', itens)

      const res = await fetch(`/api/avisos-embarque/${id}/gerar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gerarBody),
      })
      const d = await res.json()
      console.log('[AvisoEmbarque] Resposta gerar (HTTP', res.status, '):', d)

      if (!res.ok) {
        const raw = d?.detail
        const msg = typeof raw === 'string'
          ? raw
          : Array.isArray(raw)
            ? raw.map(e => `${(e.loc || []).join('.')}: ${e.msg}`).join(' | ')
            : raw ? JSON.stringify(raw) : `Erro HTTP ${res.status}`
        console.error('[AvisoEmbarque] Erro DLL:', msg, d)
        throw new Error(msg)
      }

      setSaved(true)
      setGenResult(d)
      onGenerated?.(d)
    } catch (err) {
      console.error('[AvisoEmbarque] Exceção em handleGerar:', err)
      setGenError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  // Download
  const handleDownload = async () => {
    if (!avisoId) return
    const res = await fetch(`${apiBaseUrl}/api/avisos-embarque/${avisoId}/download-rnd004`)
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `RND004_${row?.NumeroDocto || avisoId}.txt`
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(url)
  }

  const bc = isDark ? '#2a2d35' : '#bbb'   // border color fiscal
  const docBg = isDark ? '#0d1117' : '#fff'
  const outerBg = isDark ? '#080b10' : '#e8e8e8'
  const destinatarioNome = (nfeInfo?.destinatario || '').trim() || t.recipientCnpj
  const gerarAsnLabel = (t.generateAsnFor || 'Gerar ASN para {destinatario}')
    .replace('{destinatario}', destinatarioNome)

  // isx with highlight=true for editable header fields
  const isx = inlineSx(isDark)          // read-only style (no highlight)
  const isxHL = inlineSx(isDark, true)  // highlighted editable style

  // Progress: count filled header fields + items with produto_externo
  const headerFields = [fabrica, doca, localEntrega, codCliente]
  const filledHeader = headerFields.filter(f => f?.trim()).length
  const filledItems  = itens.filter(i => i.produto_externo?.trim() && i.quantidade?.trim()).length
  const totalRequired = 4 + itens.length   // 4 header + 1 per item
  const totalFilled   = filledHeader + filledItems
  const progressPct   = totalRequired > 0 ? Math.round((totalFilled / totalRequired) * 100) : 0

  // Salvar indicador no topo
  const SaveChip = () => saved ? (
    <Chip label={t.saved} size="small" icon={<CheckCircleIcon sx={{ fontSize: 11 }} />}
      sx={{ fontSize: 9, height: 18, bgcolor: Brand.green + '22', color: Brand.green }} />
  ) : null

  return (
    <Box sx={{ bgcolor: outerBg, minHeight: '100%', p: { xs: 1, md: 2 }, overflow: 'auto',
      // Keyframe: subtle amber pulse for empty required fields
      '@keyframes asnPulse': {
        '0%, 100%': { backgroundColor: 'inherit' },
        '50%': { backgroundColor: isDark ? 'rgba(245,158,11,0.14)' : 'rgba(217,119,6,0.1)' },
      },
    }}>

      {/* ── BARRA DE PROGRESSO DE PREENCHIMENTO ─────────────────────────── */}
      <Box sx={{
        mb: 1.5, p: 1.2, borderRadius: 1.5,
        bgcolor: isDark ? '#0d1420' : '#f0f4ff',
        border: `1px solid ${isDark ? '#1e2a3a' : '#d0d8f0'}`,
        display: 'flex', alignItems: 'center', gap: 2,
      }}>
        <Box sx={{ flex: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography sx={{ fontSize: 10, fontWeight: 700, color: isDark ? '#a0aab5' : '#5c6b7a' }}>
              {t.progressTitle}
            </Typography>
            <Typography sx={{
              fontSize: 10, fontWeight: 800,
              color: progressPct === 100 ? Brand.green : (progressPct > 50 ? '#f59e0b' : '#ef4444'),
            }}>
              {t.fieldsOf.replace('{filled}', totalFilled).replace('{total}', totalRequired).replace('{pct}', progressPct)}
            </Typography>
          </Box>
          <Box sx={{ height: 6, borderRadius: 3, bgcolor: isDark ? '#1e2330' : '#dde4f5', overflow: 'hidden' }}>
            <Box sx={{
              height: '100%', borderRadius: 3,
              width: `${progressPct}%`,
              bgcolor: progressPct === 100 ? Brand.green : (progressPct > 50 ? '#f59e0b' : '#ef4444'),
              transition: 'width 0.4s ease, background-color 0.3s ease',
            }} />
          </Box>
        </Box>
        {progressPct === 100
          ? <Chip label={t.complete} size="small" sx={{ fontSize: 9, height: 18, bgcolor: Brand.green + '22', color: Brand.green, fontWeight: 700 }} />
          : <Chip label={t.fillHighlighted} size="small" sx={{ fontSize: 9, height: 18, bgcolor: isDark ? 'rgba(245,158,11,0.12)' : 'rgba(217,119,6,0.08)', color: isDark ? '#f59e0b' : '#d97706', border: `1px solid ${isDark ? '#f59e0b44' : '#d9770644'}` }} />
        }
      </Box>

      {/* ── DOCUMENTO DANFE ─────────────────────────────────────────────── */}
      <Box sx={{
        maxWidth: '100%', mx: 'auto',
        bgcolor: docBg, border: `2px solid ${bc}`,
        boxShadow: isDark ? '0 8px 32px #000a' : '0 4px 24px #0002',
        fontFamily: 'Inter, Arial, sans-serif',
      }}>

        {/* ── CANHOTO ─────────────────────────────────────────────────────── */}
        <Box sx={{ borderBottom: `2px dashed ${bc}`, px: 1.5, py: 0.8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: isDark ? '#0a1a0f' : '#f0fff4' }}>
          <Typography sx={{ fontSize: 8, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', color: isDark ? Brand.greenBright : Brand.greenDark }}>
            {t.shipmentNoticeReceipt}
          </Typography>
          <Box sx={{ display: 'flex', gap: 3 }}>
            <Typography sx={{ fontSize: 8, color: isDark ? '#555' : '#888' }}>{t.nfeNumber} <b>{nfeInfo?.nNF || '—'}</b></Typography>
            <Typography sx={{ fontSize: 8, color: isDark ? '#555' : '#888' }}>{t.series} <b>{nfeInfo?.serie || '—'}</b></Typography>
            <Typography sx={{ fontSize: 8, color: isDark ? '#555' : '#888' }}>{t.shipmentDate}</Typography>
            <SaveChip />
          </Box>
        </Box>

        {/* ── BLOCO 1: IDENTIFICAÇÃO ──────────────────────────────────────── */}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 140px 1fr', borderBottom: `1px solid ${bc}` }}>
          {/* Emitente */}
          <Box sx={{ p: 1, borderRight: `1px solid ${bc}` }}>
            <Typography sx={{ fontSize: 7, fontWeight: 800, textTransform: 'uppercase', color: isDark ? '#555' : '#888', mb: 0.5 }}>{t.issuerIdentification}</Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 800, color: isDark ? '#e8e8e8' : '#111' }}>{nfeInfo?.emitente || '—'}</Typography>
            <Typography sx={{ fontSize: 9, fontFamily: 'monospace', color: isDark ? '#666' : '#888', mt: 0.3 }}>CNPJ: {nfeInfo?.emitenteCnpj || '—'}</Typography>
            {nfeInfo?.emitEndereco && <Typography sx={{ fontSize: 8, color: isDark ? '#555' : '#aaa' }}>{nfeInfo.emitEndereco}</Typography>}
          </Box>
          {/* Título central */}
          <Box sx={{ p: 1, borderRight: `1px solid ${bc}`, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', bgcolor: isDark ? '#0a1a0f' : '#f0fff4' }}>
            <Typography sx={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.8px', color: isDark ? Brand.greenBright : Brand.greenDark, lineHeight: 1.2 }}>{t.shipmentNotice}</Typography>
            <Typography sx={{ fontSize: 7, color: isDark ? '#555' : '#999', mb: 1 }}>{t.ediAuxDoc}</Typography>
            <Box sx={{ border: `1px solid ${bc}`, px: 1, py: 0.5, width: '100%' }}>
              <Typography sx={{ fontSize: 7, color: isDark ? '#555' : '#888' }}>NF-e Nº</Typography>
              <Typography sx={{ fontSize: 16, fontWeight: 900, fontFamily: 'monospace', color: isDark ? '#fff' : '#000', lineHeight: 1.1 }}>{nfeInfo?.nNF || '—'}</Typography>
              <Typography sx={{ fontSize: 7, color: isDark ? '#555' : '#888' }}>SÉRIE {nfeInfo?.serie || '1'}</Typography>
            </Box>
          </Box>
          {/* Chave de acesso */}
          <Box sx={{ p: 1 }}>
            <Typography sx={{ fontSize: 7, fontWeight: 800, textTransform: 'uppercase', color: isDark ? '#555' : '#888', mb: 0.5 }}>{t.nfeAccessKey}</Typography>
            <Typography sx={{ fontSize: 9, fontFamily: 'monospace', color: isDark ? '#a0aab5' : '#333', wordBreak: 'break-all', letterSpacing: '0.3px' }}>
              {nfeInfo?.chaveNfe || '—'}
            </Typography>
            <Box sx={{ mt: 0.8 }}>
              <Typography sx={{ fontSize: 7, fontWeight: 800, textTransform: 'uppercase', color: isDark ? '#555' : '#888', mb: 0.3 }}>{t.issueDate}</Typography>
              <Typography sx={{ fontSize: 11, fontWeight: 600, color: isDark ? '#d0d0d0' : '#333' }}>
                {nfeInfo?.dhEmi ? new Date(nfeInfo.dhEmi).toLocaleDateString(locale) : '—'}
              </Typography>
            </Box>
          </Box>
        </Box>

        {/* ── BLOCO 2: DESTINATÁRIO ───────────────────────────────────────── */}
        <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', borderBottom: `1px solid ${bc}` }}>
          <DC label={t.recipientSender} value={nfeInfo?.destinatario} isDark={isDark} bc={bc} />
          <DC label={t.recipientCnpj} value={nfeInfo?.destCnpj} mono isDark={isDark} bc={bc} />
          <DC label={t.ediClientCode} isDark={isDark} bc="transparent"
            required highlight
            edit={<TextField variant="standard" size="small" value={codCliente} placeholder="CNPJ / Código EDI"
              onChange={e => handleHeader(setCodCliente)(e.target.value)} sx={codCliente ? isx : isxHL} />} />
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', borderBottom: `1px solid ${bc}` }}>
          <DC label={t.operationNature} value={nfeInfo?.natOp} isDark={isDark} bc={bc} />
          <DC label={t.carrier} value={nfeInfo?.transportadora} isDark={isDark} bc={bc} />
          <DC label={t.freightMode} value={nfeInfo?.modFrete} isDark={isDark} bc={bc} />
          <DC label={t.totalNfeValue} mono isDark={isDark} bc="transparent"
            value={nfeInfo?.vNF ? `R$ ${parseFloat(nfeInfo.vNF).toLocaleString(locale, { minimumFractionDigits: 2 })}` : '—'} />
        </Box>

        {/* ── BLOCO 3: EXPEDIÇÃO (campos editáveis) ──────────────────────── */}
        <Box sx={{
          borderBottom: `1px solid ${bc}`,
          bgcolor: isDark ? '#0a140e' : '#fffbeb',
          borderLeft: `4px solid ${isDark ? '#f59e0b' : '#d97706'}`,
        }}>
          <Box sx={{ px: 0.8, pt: 0.8, pb: 0.3, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 3, height: 14, borderRadius: 2, bgcolor: isDark ? '#f59e0b' : '#d97706' }} />
            <Typography sx={{ fontSize: 8, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.8px', color: isDark ? '#f59e0b' : '#d97706' }}>
              {t.shipmentDataFill}
            </Typography>
            <Box sx={{
              ml: 1, px: 1, py: 0.2, borderRadius: 1,
              bgcolor: isDark ? 'rgba(245,158,11,0.15)' : 'rgba(217,119,6,0.1)',
              border: `1px solid ${isDark ? '#f59e0b55' : '#d9770655'}`,
            }}>
              <Typography sx={{ fontSize: 8, fontWeight: 700, color: isDark ? '#f59e0b' : '#d97706' }}>
                {t.filledOf4.replace('{n}', filledHeader)}
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', borderTop: `1px dashed ${isDark ? '#2a2010' : '#f0d080'}` }}>
            <DC label={t.factoryPlant} isDark={isDark} bc={bc}
              required={!fabrica} highlight={!fabrica}
              edit={<TextField variant="standard" size="small" value={fabrica} placeholder="Ex: Planta SP"
                onChange={e => handleHeader(setFabrica)(e.target.value)} sx={fabrica ? isx : isxHL} />} />
            <DC label={t.dock} isDark={isDark} bc={bc}
              required={!doca} highlight={!doca}
              edit={<TextField variant="standard" size="small" value={doca} placeholder="Ex: Doca 03"
                onChange={e => handleHeader(setDoca)(e.target.value)} sx={doca ? isx : isxHL} />} />
            <DC label={t.deliveryLocation} isDark={isDark} bc={bc}
              required={!localEntrega} highlight={!localEntrega}
              edit={<TextField variant="standard" size="small" value={localEntrega} placeholder="Ex: Almox. B"
                onChange={e => handleHeader(setLocalEntrega)(e.target.value)} sx={localEntrega ? isx : isxHL} />} />
            <DC label={t.noticeIdStatus} isDark={isDark} bc="transparent"
              value={avisoId ? `#${avisoId} — ${saved ? t.savedStatus : t.pendingStatus}` : t.newStatus} mono />
          </Box>
        </Box>

        {/* ── BLOCO 4: PRODUTOS ───────────────────────────────────────────── */}
        <Box sx={{ borderBottom: `1px solid ${bc}` }}>
        {/* Header da seção */}
        <Box sx={{
          borderLeft: `4px solid ${!essencialOk && itens.length > 0 ? (isDark ? '#f59e0b' : '#d97706') : Brand.green}`,
          bgcolor: !essencialOk && itens.length > 0
            ? (isDark ? '#130f00' : '#fffbeb')
            : (isDark ? '#0a120f' : '#f0fff4'),
          borderBottom: `1px solid ${bc}`,
        }}>
          {/* Título */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 0.8, py: 0.6 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 3, height: 14, borderRadius: 2,
                bgcolor: !essencialOk && itens.length > 0 ? (isDark ? '#f59e0b' : '#d97706') : Brand.green }} />
              <Typography sx={{ fontSize: 8, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px',
                color: !essencialOk && itens.length > 0
                  ? (isDark ? '#f59e0b' : '#d97706')
                  : (isDark ? Brand.greenBright : Brand.greenDark),
              }}>
                {t.productsServices.replace('{count}', itens.length).replace('{unit}', itens.length === 1 ? t.item : t.items)}
              </Typography>
              {/* Contador de itens pendentes */}
              {itens.length > 0 && (
                <Box sx={{
                  px: 1, py: 0.2, borderRadius: 1,
                  bgcolor: !essencialOk
                    ? (isDark ? 'rgba(245,158,11,0.18)' : 'rgba(217,119,6,0.12)')
                    : (isDark ? Brand.green + '22' : Brand.green + '15'),
                  border: `1px solid ${ !essencialOk ? (isDark ? '#f59e0b55' : '#d9770655') : Brand.green + '44'}`,
                }}>
                  <Typography sx={{ fontSize: 8, fontWeight: 800,
                    color: !essencialOk ? (isDark ? '#f59e0b' : '#d97706') : Brand.green }}>
                    {t.filledCount.replace('{filled}', itens.filter(i => i.produto_externo?.trim()).length).replace('{total}', itens.length)}
                  </Typography>
                </Box>
              )}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button size="small" startIcon={xmlLoading ? <CircularProgress size={10} /> : <RefreshIcon sx={{ fontSize: 12 }} />}
                onClick={loadNfeXml} disabled={xmlLoading}
                sx={{ textTransform: 'none', fontSize: 9, color: Brand.green, py: 0.2, minWidth: 0, '&:hover': { bgcolor: Brand.green + '11' } }}>
                {xmlLoading ? t.loadingXml : t.reloadXml}
              </Button>
            </Box>
          </Box>

          {/* Banner de alerta quando há itens pendentes */}
          {!essencialOk && itens.length > 0 && !xmlLoading && (
            <Box sx={{
              mx: 0.8, mb: 0.8, px: 1.2, py: 0.8, borderRadius: 1,
              bgcolor: isDark ? 'rgba(245,158,11,0.12)' : 'rgba(217,119,6,0.08)',
              border: `1px solid ${isDark ? '#f59e0b55' : '#d9770655'}`,
              display: 'flex', alignItems: 'center', gap: 1,
            }}>
              <Typography sx={{ fontSize: 11, flexShrink: 0 }}>⚠️</Typography>
              <Box>
                <Typography sx={{ fontSize: 10, fontWeight: 800, color: isDark ? '#f59e0b' : '#d97706' }}>
                  {t.actionRequired}
                </Typography>
                <Typography sx={{ fontSize: 9, color: isDark ? '#a07020' : '#b45309', mt: 0.2 }}>
                  {t.externalProductRequired}
                </Typography>
              </Box>
            </Box>
          )}

          {(!hasCodCliente || !hasNfFromXml || !allItensTipoFornecimento) && itens.length > 0 && !xmlLoading && (
            <Box sx={{
              mx: 0.8, mb: 0.8, px: 1.2, py: 0.8, borderRadius: 1,
              bgcolor: isDark ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.08)',
              border: `1px solid ${isDark ? '#ef444455' : '#ef444455'}`,
            }}>
              <Typography sx={{ fontSize: 10, fontWeight: 800, color: '#ef4444' }}>
                Verifique os obrigatórios: Número/Chave da NF-e lidos do XML, Código do Cliente e Tipo de Fornecimento em todos os itens.
              </Typography>
            </Box>
          )}
        </Box>

          {/* Erro */}
          {xmlError && !xmlLoading && (
            <Alert severity="warning" icon={<ErrorOutlineIcon />}
              action={<Button size="small" onClick={loadNfeXml} sx={{ textTransform: 'none', fontSize: 10 }}>{tc.retry}</Button>}
              sx={{ m: 0, borderRadius: 0, fontSize: 11 }}>{xmlError}</Alert>
          )}

          {/* Loading */}
          {xmlLoading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 3, justifyContent: 'center' }}>
              <CircularProgress size={16} sx={{ color: Brand.green }} />
              <Typography sx={{ fontSize: 11, color: isDark ? '#888' : '#666' }}>{t.loadingProducts}</Typography>
            </Box>
          )}

          {/* Cabeçalho colunas */}
          {itens.length > 0 && !xmlLoading && (
            <Box sx={{ display: 'grid', gridTemplateColumns: '32px 1.6fr 1fr 0.7fr 0.7fr 1fr 0.6fr 28px', bgcolor: isDark ? '#0d1f12' : '#e8f5e9', borderBottom: `1px solid ${bc}`, px: 0.8 }}>
              {[
                { h: t.colSeq,                     align: 'left',   amber: false },
                { h: t.colLocalProduct,              align: 'left',   amber: false },
                { h: t.colExternalProduct,           align: 'left',   amber: true  },
                { h: t.colQtyNf,                     align: 'right',  amber: false },
                { h: t.colQtyExp,                    align: 'right',  amber: false },
                { h: t.colOrderCall,                 align: 'left',   amber: false },
                { h: t.colCfop,                      align: 'center', amber: false },
                { h: '',                             align: 'left',   amber: false },
              ].map(({ h, align, amber }, i) => (
                <Typography key={i} sx={{
                  fontSize: 7, fontWeight: 800, textTransform: 'uppercase', py: 0.5, letterSpacing: '0.4px',
                  textAlign: align,
                  color: amber
                    ? (isDark ? '#f59e0b' : '#d97706')
                    : (isDark ? Brand.greenBright : Brand.greenDark),
                }}>{h}</Typography>
              ))}
            </Box>
          )}


          {/* Linhas de produto */}
          <Box sx={{
            '@keyframes prodPulse': {
              '0%, 100%': { opacity: 1 },
              '50%': { opacity: 0.75 },
            },
          }}>
            {itens.map((item, idx) => (
              <ProdutoRow key={item.id} item={item} idx={idx} onClick={() => openModal(item)} isDark={isDark} />
            ))}
          </Box>

          {/* Vazio */}
          {!xmlLoading && !xmlError && itens.length === 0 && xmlLoaded && (
            <Box sx={{ py: 4, textAlign: 'center' }}>
              <Typography sx={{ fontSize: 11, color: isDark ? '#555' : '#aaa' }}>{t.noProductInXml}</Typography>
              <Button size="small" variant="outlined" onClick={loadNfeXml} sx={{ mt: 1, textTransform: 'none', fontSize: 11, borderColor: Brand.green, color: Brand.green }}>{t.reloadXml}</Button>
            </Box>
          )}

          {/* Dica */}
          {itens.length > 0 && (
            <Box sx={{ px: 0.8, py: 0.4, borderTop: `1px dashed ${bc}`, bgcolor: isDark ? '#080b10' : '#fafafa' }}>
              <Typography sx={{ fontSize: 7, color: isDark ? '#3a4a5a' : '#bbb', fontStyle: 'italic' }}>{t.tipClickRow}</Typography>
            </Box>
          )}
        </Box>

        {/* ── BLOCO 5: TOTAIS FISCAIS ─────────────────────────────────────── */}
        {nfeInfo?.vNF && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', borderBottom: `1px solid ${bc}` }}>
            {[
              { label: t.baseCalcIcms, value: '—' },
              { label: t.valueIcms, value: '—' },
              { label: t.valueIpi, value: '—' },
              { label: t.productsValue, value: nfeInfo?.vNF ? `R$ ${parseFloat(nfeInfo.vNF).toLocaleString(locale, { minimumFractionDigits: 2 })}` : '—' },
              { label: t.totalNfeValue, value: nfeInfo?.vNF ? `R$ ${parseFloat(nfeInfo.vNF).toLocaleString(locale, { minimumFractionDigits: 2 })}` : '—' },
            ].map((f, i) => (
              <DC key={i} label={f.label} value={f.value} mono isDark={isDark} bc={i < 4 ? bc : 'transparent'} />
            ))}
          </Box>
        )}

        {/* ── BLOCO 6: GERAÇÃO ASN ───────────────────────────────────────── */}
        <Box sx={{ p: 1.5, bgcolor: isDark ? '#0a1a0f' : '#f0fff4' }}>
          <Typography sx={{ fontSize: 8, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.8px', color: isDark ? Brand.greenBright : Brand.greenDark, mb: 1 }}>
            {t.ediFileGeneration}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontSize: 11, color: isDark ? '#a0aab5' : '#475569' }}>
                XML-ASN sera gerado e enviado automaticamente via API de upload SWPaaS.
              </Typography>
            </Box>

            <SaveChip />

            <Button variant="contained" size="large"
              startIcon={generating ? <CircularProgress size={18} color="inherit" /> : <LocalShippingIcon />}
              onClick={handleGerar} disabled={generating || !canGenerate}
              sx={{
                textTransform: 'none', fontWeight: 800, fontSize: 13,
                bgcolor: Brand.green, '&:hover': { bgcolor: Brand.greenDark },
                boxShadow: `0 4px 16px ${Brand.green}55`, px: 3, borderRadius: 1,
                '&:disabled': { bgcolor: isDark ? '#2a2d35' : '#e0e0e0', color: isDark ? '#555' : '#aaa', boxShadow: 'none' },
              }}>
              {generating ? t.generating : gerarAsnLabel}
            </Button>
          </Box>

          {/* Erros */}
          {genError && <Alert severity="error" sx={{ mt: 1.5, fontSize: 11, borderRadius: 1 }}>{genError}</Alert>}

          {/* Resultado */}
          {genResult && (
            <Box sx={{ mt: 1.5, p: 1.5, border: `1px solid ${Brand.green}55`, bgcolor: isDark ? 'rgba(0,208,132,0.05)' : '#f0fdf4', borderRadius: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <CheckCircleIcon sx={{ color: Brand.green, fontSize: 18 }} />
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: isDark ? Brand.greenBright : Brand.greenDark }}>{t.rndSuccess}</Typography>
                {genResult.rnd004_length && <Chip label={`${genResult.rnd004_length} bytes`} size="small" sx={{ fontSize: 9, bgcolor: Brand.green + '22', color: Brand.green }} />}
                <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={handleDownload}
                  sx={{ ml: 'auto', textTransform: 'none', fontSize: 11, borderColor: Brand.green, color: Brand.green }}>
                  {t.downloadRnd004}
                </Button>
              </Box>
              {genResult.path && (
                <Typography sx={{ fontSize: 9, color: isDark ? '#555' : '#aaa', mt: 0.8, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  📁 {genResult.path}
                </Typography>
              )}
            </Box>
          )}
        </Box>
      </Box>

      {/* ── Dialogs ──────────────────────────────────────────────────────── */}
      <ProdutoEditModal open={modalOpen} onClose={() => { setModalOpen(false); setModalItem(null) }}
        item={modalItem} onSave={updateItem} isDark={isDark}
        onOpenEtiquetas={(item) => { setModalOpen(false); openEtiquetas(item) }} />

      <EtiquetasProdutoDialog open={etqDialog} onClose={() => { setEtqDialog(false); setEtqItem(null) }}
        row={row} item={etqItem} isDark={isDark} />
    </Box>
  )
}
