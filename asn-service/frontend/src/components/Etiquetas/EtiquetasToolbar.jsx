import { Box, Chip, Button, CircularProgress, Tooltip } from '@mui/material'
import LabelIcon from '@mui/icons-material/Label'
import VisibilityIcon from '@mui/icons-material/Visibility'
import PrintIcon from '@mui/icons-material/Print'
import SaveIcon from '@mui/icons-material/Save'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import DescriptionIcon from '@mui/icons-material/Description'

export default function EtiquetasToolbar({
  theme,
  xmlLoading,
  xmlRaw,
  xmlError,
  itemsCount,
  metaIds,
  aliasEmitente,
  aliasDestinatario,
  selectedTemplate,
  allSelectedCount,
  saving,
  etiquetasCount,
  parseResumo,
  onOpenTemplateSelector,
  onViewer,
  onPrint,
  onSave,
  onUploadClick,
  onShowMissing,
  onShowDocumento,
  viewMode,
}) {
  const gaps =
    (parseResumo?.gapsCriticos || 0) +
    (parseResumo?.gapsImportantes || 0) +
    (parseResumo?.itensSemEtiqueta?.length || 0)

  return (
    <Box sx={{
      display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center',
      px: 2, py: 1,
      borderBottom: `1px solid ${theme.borderLight}`,
      bgcolor: theme.bgBase,
    }}>
      {xmlLoading && (
        <Chip icon={<CircularProgress size={10} sx={{ ml: '6px !important' }} />}
          label="Carregando XML-ASN..." size="small"
          sx={{ fontSize: 10, bgcolor: theme.infoBg, color: theme.info }} />
      )}
      {xmlRaw && !xmlError && (
        <Chip label={`✓ XML-ASN — ${itemsCount} produto(s)`} size="small"
          sx={{ fontSize: 10, bgcolor: theme.successBg, color: theme.success }} />
      )}
      {!xmlRaw && !xmlLoading && metaIds.length === 0 && (
        <Chip label="Sem XML-ASN — entrada manual ou upload" size="small"
          sx={{ fontSize: 10, bgcolor: theme.warningBg, color: theme.warning, border: `1px solid ${theme.warning}44` }} />
      )}
      {xmlError && (
        <Chip label="XML-ASN indisponível — modo manual" size="small"
          sx={{ fontSize: 10, bgcolor: theme.dangerBg, color: theme.danger }} />
      )}
      {gaps > 0 && (
        <Chip
          icon={<WarningAmberIcon sx={{ fontSize: '14px !important' }} />}
          label={`${gaps} gap(s) UC/campos`}
          size="small"
          onClick={onShowMissing}
          sx={{ fontSize: 10, cursor: 'pointer', bgcolor: theme.warningBg, color: theme.warning, fontWeight: 700 }}
        />
      )}
      {aliasEmitente && (
        <Chip label={`Emit: ${aliasEmitente}`} size="small"
          sx={{ fontSize: 10, bgcolor: theme.successBg, color: theme.success, fontWeight: 600 }} />
      )}
      {aliasDestinatario && (
        <Chip label={`Dest: ${aliasDestinatario}`} size="small"
          sx={{ fontSize: 10, bgcolor: theme.bgSurface, color: theme.textMuted }} />
      )}

      <Box sx={{ flex: 1 }} />

      {onShowDocumento && (
        <Tooltip title="Visão do documento (estilo NF)" arrow>
          <Button size="small" variant={viewMode === 'documento' ? 'contained' : 'outlined'}
            startIcon={<DescriptionIcon fontSize="small" />}
            onClick={onShowDocumento}
            sx={{
              textTransform: 'none', fontSize: 11, py: 0.4,
              bgcolor: viewMode === 'documento' ? theme.primary : 'transparent',
              borderColor: viewMode === 'documento' ? theme.primary : theme.borderInput,
              color: viewMode === 'documento' ? '#fff' : theme.textMuted,
              '&:hover': { borderColor: theme.primary, color: viewMode === 'documento' ? '#fff' : theme.primary },
            }}>
            Documento
          </Button>
        </Tooltip>
      )}

      <Tooltip title="Carregar mensagem XML-ASN (.edi / .xml)" arrow>
        <Button size="small" variant="outlined"
          startIcon={<UploadFileIcon fontSize="small" />}
          onClick={onUploadClick}
          sx={{
            textTransform: 'none', fontSize: 11, py: 0.4,
            borderColor: theme.borderInput, color: theme.textMuted,
            '&:hover': { borderColor: theme.primary, color: theme.primary },
          }}>
          XML-ASN
        </Button>
      </Tooltip>

      <Button size="small"
        variant={selectedTemplate ? 'contained' : 'outlined'}
        startIcon={<LabelIcon fontSize="small" />}
        onClick={onOpenTemplateSelector}
        sx={{
          textTransform: 'none', fontSize: 11, py: 0.4,
          bgcolor: selectedTemplate ? theme.primary : 'transparent',
          borderColor: selectedTemplate ? theme.primary : theme.borderInput,
          color: selectedTemplate ? '#fff' : theme.textMuted,
          '&:hover': { bgcolor: selectedTemplate ? theme.primaryDark : undefined, borderColor: theme.primary, color: theme.primary },
        }}>
        {selectedTemplate ? selectedTemplate.nome || selectedTemplate : 'Modelo'}
      </Button>

      <Button size="small" variant="outlined"
        startIcon={<VisibilityIcon fontSize="small" />}
        disabled={!selectedTemplate || allSelectedCount === 0}
        onClick={onViewer}
        sx={{
          textTransform: 'none', fontSize: 11, py: 0.4,
          borderColor: theme.borderInput, color: theme.textMuted,
          '&:hover': { borderColor: theme.primary, color: theme.primary },
          '&.Mui-disabled': { opacity: 0.4 },
        }}>
        Visualizar ({allSelectedCount})
      </Button>

      <Button size="small" variant="outlined"
        startIcon={<PrintIcon fontSize="small" />}
        disabled={!selectedTemplate || allSelectedCount === 0}
        onClick={onPrint}
        sx={{
          textTransform: 'none', fontSize: 11, py: 0.4,
          borderColor: theme.borderInput, color: theme.textMuted,
          '&:hover': { borderColor: theme.info, color: theme.info },
          '&.Mui-disabled': { opacity: 0.4 },
        }}>
        Imprimir
      </Button>

      <Button size="small" variant="contained"
        startIcon={saving ? <CircularProgress size={12} /> : <SaveIcon fontSize="small" />}
        disabled={saving || etiquetasCount === 0}
        onClick={onSave}
        sx={{
          textTransform: 'none', fontSize: 11, py: 0.4,
          bgcolor: theme.primary, '&:hover': { bgcolor: theme.primaryDark },
        }}>
        Salvar
      </Button>
    </Box>
  )
}
