import { useState, useEffect } from 'react'
import { Box, Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress, Alert } from '@mui/material'
import LabelIcon from '@mui/icons-material/Label'
import { dialogPaperSx } from './EtiquetasTheme'

function normalizeTemplate(item, index) {
  const versions = Array.isArray(item?.versions) ? item.versions : []
  const currentVersion = versions.find(v => v?.isCurrent) || versions[0] || {}

  const versionId = item?.version_id ?? item?.versionId ?? currentVersion?.id ?? item?.id ?? null
  const fileName = item?.mrt_filename ?? item?.template_filename ?? item?.file_name ?? item?.fileName ?? currentVersion?.fileName ?? ''
  const displayName = (item?.nome ?? item?.name ?? fileName) || 'Modelo sem nome'
  const source = versionId ? `/api/swpaas/mrt-file/${String(versionId)}` : fileName

  return {
    key: String(versionId ?? fileName ?? `template-${index}`),
    source: source || '',
    fileName,
    displayName,
    aliasEmitente: item?.alias_emitente ?? item?.ownerName ?? '',
    aliasDestinatario: item?.alias_destinatario ?? item?.tenantName ?? '',
  }
}

export default function TemplateSelector({ open, onClose, onSelect, idEmitente, idDestinatario, padrao, mensagem, theme }) {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (idDestinatario)    params.set('tenantId', idDestinatario)
    if (idEmitente)        params.set('ownerId', idEmitente)
    if (padrao)            params.set('padrao', padrao)
    if (mensagem)          params.set('mensagem', mensagem)
    params.set('tipo', 'etiqueta')
    fetch(`/api/swpaas/report-labels?${params}`)
      .then(async r => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(data?.detail || `Erro ao carregar modelos (HTTP ${r.status})`)
        return data
      })
      .then(d => {
        const items = Array.isArray(d?.items) ? d.items : []
        setTemplates(items.map(normalizeTemplate))
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [open, idEmitente, idDestinatario, padrao, mensagem])

  const sx = {
    p: 2, borderRadius: 1, cursor: 'pointer',
    border: `1px solid ${theme.borderLight}`,
    bgcolor: theme.bgSurface,
    display: 'flex', alignItems: 'center', gap: 1.5,
    '&:hover': { borderColor: theme.primary, bgcolor: theme.primaryBg },
    transition: 'all 0.15s',
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: dialogPaperSx(theme) }}>
      <DialogTitle sx={{ fontWeight: 700, fontSize: 15, color: theme.textMain }}>
        Selecionar Modelo de Etiqueta
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2, fontSize: 12 }}>{error}</Alert>}
        {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={24} sx={{ color: theme.primary }} /></Box>}
        {!loading && templates.length === 0 && (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 13, color: theme.textMuted }}>
              Nenhum modelo cadastrado para este parceiro.
            </Typography>
            <Typography sx={{ fontSize: 12, color: theme.textDisabled, mt: 0.5 }}>
              Configure em Administração → Associação Etiquetas
            </Typography>
          </Box>
        )}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
          {templates.map(t => (
            <Box
              key={t.key}
              onClick={() => {
                if (!t.source) return
                onSelect({ url: t.source, nome: t.displayName })
                onClose()
              }}
              sx={{ ...sx, opacity: t.source ? 1 : 0.6, cursor: t.source ? 'pointer' : 'not-allowed' }}
            >
              <LabelIcon sx={{ color: theme.primary, fontSize: 20 }} />
              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: theme.textMain }}>
                  {t.displayName}
                </Typography>
                {t.fileName && (
                  <Typography sx={{ fontSize: 11, color: theme.textDisabled }}>
                    {t.fileName}
                  </Typography>
                )}
                {(t.aliasEmitente || t.aliasDestinatario) && (
                  <Typography sx={{ fontSize: 11, color: theme.textMuted }}>
                    {t.aliasEmitente} → {t.aliasDestinatario}
                  </Typography>
                )}
                {!t.source && (
                  <Typography sx={{ fontSize: 11, color: '#d32f2f' }}>
                    Modelo sem versão publicada.
                  </Typography>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none', fontSize: 13, color: theme.textMuted }}>Cancelar</Button>
      </DialogActions>
    </Dialog>
  )
}
