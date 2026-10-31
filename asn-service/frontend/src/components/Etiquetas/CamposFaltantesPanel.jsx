import { Box, Typography, Chip, Button, Collapse, Alert } from '@mui/material'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import EditNoteIcon from '@mui/icons-material/EditNote'

const severityColor = (theme, sev) => {
  if (sev === 'critical') return { bg: theme.dangerBg, color: theme.danger, border: `${theme.danger}44` }
  if (sev === 'important') return { bg: theme.warningBg, color: theme.warning, border: `${theme.warning}44` }
  return { bg: theme.infoBg, color: theme.info, border: `${theme.info}44` }
}

/**
 * Exibe o mapa de campos de etiqueta não preenchidos a partir do XML-ASN
 * e orienta o usuário a completar manualmente ou gerar lote UC.
 */
export default function CamposFaltantesPanel({
  theme,
  resumo,
  open,
  onToggle,
  onGerarLote,
  onFocusField,
}) {
  if (!resumo) return null

  const agregados = resumo.camposFaltantesAgregados || []
  const semEtq = resumo.itensSemEtiqueta || []
  const show =
    resumo.precisaGerarLoteUc ||
    resumo.precisaPreencherManual ||
    agregados.length > 0 ||
    (resumo.etiquetasIncompletas || 0) > 0

  if (!show) return null

  return (
    <Box sx={{ mx: 2, mt: 1 }}>
      <Box
        onClick={onToggle}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer',
          px: 1.2, py: 0.7, borderRadius: 1,
          border: `1px solid ${theme.warning}44`,
          bgcolor: theme.warningBg,
        }}
      >
        <WarningAmberIcon sx={{ fontSize: 16, color: theme.warning }} />
        <Typography sx={{ fontSize: 12, fontWeight: 700, color: theme.warning, flex: 1 }}>
          Campos de etiqueta a completar
          {resumo.etiquetasIncompletas > 0 && ` — ${resumo.etiquetasIncompletas} etiqueta(s) incompleta(s)`}
          {semEtq.length > 0 && ` — ${semEtq.length} item(ns) sem UC`}
        </Typography>
        <Chip
          size="small"
          label={open ? 'Ocultar' : 'Ver mapa'}
          sx={{ fontSize: 10, height: 22, bgcolor: theme.bgSurface }}
        />
      </Box>

      <Collapse in={open}>
        <Box sx={{
          mt: 0.8, p: 1.2, borderRadius: 1,
          border: `1px solid ${theme.borderLight}`,
          bgcolor: theme.bgSurface,
          display: 'flex', flexDirection: 'column', gap: 1,
        }}>
          {semEtq.length > 0 && (
            <Alert
              severity="info"
              icon={<AutoFixHighIcon fontSize="small" />}
              sx={{ fontSize: 11, py: 0.3 }}
              action={
                onGerarLote ? (
                  <Button size="small" color="inherit" onClick={onGerarLote}
                    sx={{ textTransform: 'none', fontSize: 11 }}>
                    Gerar Lote UC
                  </Button>
                ) : null
              }
            >
              Itens sem <strong>SubsetETIQUETAS</strong> no XML-ASN (occ: {semEtq.slice(0, 12).join(', ')}
              {semEtq.length > 12 ? '…' : ''}). Use <strong>Gerar Lote</strong> para criar UCs
              (mesmo conceito da geração a partir de procNFe).
            </Alert>
          )}

          {agregados.length > 0 && (
            <>
              <Typography sx={{ fontSize: 11, color: theme.textMuted, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <EditNoteIcon sx={{ fontSize: 14 }} />
                Campos vazios capturados do XML — clique para focar no grid (preenchimento manual):
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
                {agregados.map((c) => {
                  const colors = severityColor(theme, c.severity)
                  return (
                    <Chip
                      key={c.key}
                      size="small"
                      clickable={Boolean(onFocusField)}
                      onClick={() => onFocusField?.(c.key)}
                      label={`${c.label} (${c.count})`}
                      sx={{
                        fontSize: 10, fontWeight: 600,
                        bgcolor: colors.bg, color: colors.color,
                        border: `1px solid ${colors.border}`,
                      }}
                    />
                  )
                })}
              </Box>
            </>
          )}

          <Typography sx={{ fontSize: 10, color: theme.textDisabled }}>
            Crítico = UC/UM/Qtd · Importante = embalagem/NF · Opcional = doca/RAN/lote/data
          </Typography>
        </Box>
      </Collapse>
    </Box>
  )
}
