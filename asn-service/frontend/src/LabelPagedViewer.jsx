/**
 * LabelPagedViewer.jsx
 * Viewer de etiquetas estilo GateVirtual:
 *  - Todas as etiquetas → StiLabelViewer (1 PDF com N páginas)
 *  - StiLabelViewer gera thumbnails JPEG progressivos por página
 *  - Sidebar clicável de miniaturas (igual ao GateVirtual)
 *  - Toolbar: template | Imprimir | Baixar PDF | Fechar
 */
import { useState, useMemo, useEffect } from 'react'
import {
  Box, Typography, Button, IconButton, Dialog, CircularProgress,
} from '@mui/material'
import PrintIcon from '@mui/icons-material/Print'
import CloseIcon from '@mui/icons-material/Close'
import LabelIcon from '@mui/icons-material/Label'
import { Brand } from './theme'
import StiLabelViewer from './StiLabelViewer'
import { getFinalXmlString } from './labelXml'
import { useI18n } from './I18nContext'

export default function LabelPagedViewer({
  open, onClose, etiquetas, xmlRaw, templateName, templateLabel, isDark, autoPrint,
}) {
  const [printing, setPrinting] = useState(false)
  const { t } = useI18n('labelViewer')

  // Se autoPrint, dispara impressão ao abrir
  useEffect(() => {
    if (open && autoPrint) setPrinting(true)
  }, [open, autoPrint])

  // XML de TODAS as etiquetas selecionadas — 1 PDF com N páginas (igual ao GateVirtual)
  const allXml = useMemo(() => {
    if (!etiquetas || etiquetas.length === 0) return null
    return getFinalXmlString(etiquetas, xmlRaw)
  }, [etiquetas, xmlRaw])

  // XML para impressão silenciosa de todas as etiquetas
  const printXml = useMemo(() => {
    if (!printing || !etiquetas || etiquetas.length === 0) return null
    return getFinalXmlString(etiquetas, xmlRaw)
  }, [printing, etiquetas, xmlRaw])

  const total  = etiquetas?.length ?? 0
  const border = isDark ? '#252d3a' : '#dde1e6'
  const bg     = isDark ? '#0d1117' : '#f1f3f5'
  const panelBg = isDark ? '#0f1318' : '#fafafa'

  if (!open || total === 0) return null

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullWidth
      PaperProps={{
        sx: {
          width: '96vw', height: '92vh', maxWidth: '96vw',
          bgcolor: bg,
          display: 'flex', flexDirection: 'column',
          borderRadius: 2, overflow: 'hidden',
          border: `1px solid ${border}`,
          boxShadow: isDark
            ? '0 24px 64px rgba(0,0,0,0.7)'
            : '0 16px 48px rgba(0,0,0,0.18)',
        },
      }}
    >
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1.5,
        px: 2.5, py: 1,
        flexShrink: 0,
        borderBottom: `1px solid ${border}`,
        bgcolor: panelBg,
      }}>
        {/* Template name */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: Brand.green, animation: 'pulse 2s infinite', '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.4 } } }} />
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: isDark ? '#c0c8d5' : '#333', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {t.viewTitle}
          </Typography>
          <Box sx={{
            fontSize: 11, fontFamily: 'monospace', color: isDark ? '#555' : '#999',
            border: `1px solid ${isDark ? '#333' : '#ddd'}`,
            px: 1, py: 0.2, borderRadius: 1, bgcolor: isDark ? 'rgba(0,0,0,0.3)' : '#f5f5f5',
          }}>
            {templateLabel || templateName}
          </Box>
          <Typography sx={{ fontSize: 11, color: isDark ? '#555' : '#aaa', fontWeight: 500 }}>
            {total} {total === 1 ? t.labelSingular : t.labelPlural}
          </Typography>
        </Box>

        <Box sx={{ flex: 1 }} />

        {/* Impressão em progresso */}
        {printing && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, px: 1.5, py: 0.4, border: `1px solid ${Brand.green}44`, borderRadius: 1, bgcolor: isDark ? 'rgba(0,166,81,0.08)' : 'rgba(0,166,81,0.06)' }}>
            <CircularProgress size={11} sx={{ color: Brand.green }} />
            <Typography sx={{ fontSize: 11, color: Brand.green, fontWeight: 600 }}>
              {t.sendingToPrint}
            </Typography>
          </Box>
        )}

        {/* Imprimir */}
        <Button
          size="small"
          variant="contained"
          startIcon={<PrintIcon sx={{ fontSize: '14px !important' }} />}
          onClick={() => setPrinting(true)}
          disabled={total === 0 || printing}
          sx={{
            fontSize: 11, textTransform: 'none', py: 0.5,
            bgcolor: Brand.green, '&:hover': { bgcolor: Brand.greenDark },
            '&.Mui-disabled': { opacity: 0.45 },
          }}
        >
          {t.print} ({total})
        </Button>

        <IconButton size="small" onClick={onClose}
          sx={{ color: isDark ? '#8a95a3' : '#888', '&:hover': { color: '#f44336', bgcolor: 'rgba(244,67,54,0.08)' } }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* ── Body: StiLabelViewer com todas as etiquetas ─────────────────────── */}
      <Box sx={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {allXml && templateName ? (
          <StiLabelViewer
            key={`${templateName}-${total}`}
            xmlData={allXml}
            templateName={templateName}
            mode="VIEWER"
            onClose={onClose}
            mode_theme={isDark ? 'dark' : 'light'}
            showSidebar={true}
            showInterfaceExport={false}
            isEtiqueta={true}
          />
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2 }}>
            <CircularProgress size={28} sx={{ color: Brand.green }} />
            <Typography sx={{ fontSize: 12, color: isDark ? '#555' : '#aaa' }}>
              {t.preparingLabels}
            </Typography>
          </Box>
        )}
      </Box>

      {/* ── Impressão silenciosa ─────────────────────────────────────────────── */}
      {printing && printXml && (
        <Box sx={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          <StiLabelViewer
            xmlData={printXml}
            templateName={templateName}
            mode="PRINT"
            onClose={() => setPrinting(false)}
            mode_theme={isDark ? 'dark' : 'light'}
            showSidebar={false}
            showInterfaceExport={false}
            isEtiqueta={true}
          />
        </Box>
      )}
    </Dialog>
  )
}
