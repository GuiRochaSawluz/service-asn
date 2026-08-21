import { useMemo } from 'react'
import { Box, Typography, Button, Chip, Tooltip, IconButton } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import LabelIcon from '@mui/icons-material/Label'
import DeleteIcon from '@mui/icons-material/Delete'
import { MaterialReactTable, useMaterialReactTable } from 'material-react-table'
import { editInputSx } from './EtiquetasTheme'

const fmtDate = (d) => {
  if (!d) return ''
  if (typeof d === 'string' && d.includes('T')) return new Date(d).toLocaleDateString('pt-BR')
  return d
}

const buildLabelColumns = (theme) => [
  {
    id: 'sel', header: '', size: 36, enableEditing: false,
    Cell: ({ row: r, table }) => (
      <input type="checkbox" checked={r.original.selected !== false}
        onChange={e => table.options.meta?.toggleSelected(r.original.id, e.target.checked)}
        style={{ accentColor: theme.primary, cursor: 'pointer' }} />
    ),
  },
  {
    accessorKey: 'numeroUM', header: 'UM (Pallet)', size: 130, enableEditing: true,
    muiTableBodyCellProps: { sx: { fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: theme.primary } },
    muiEditTextFieldProps: { variant: 'standard', sx: editInputSx(theme) },
  },
  {
    accessorKey: 'numeroUC', header: 'UC (Caixa)', size: 130, enableEditing: true,
    muiTableBodyCellProps: { sx: { fontFamily: 'monospace', fontSize: 11 } },
    muiEditTextFieldProps: { variant: 'standard', sx: editInputSx(theme) },
  },
  {
    accessorKey: 'quantidadePecasUC', header: 'Qtd Peças', size: 80, enableEditing: true,
    Cell: ({ cell }) => Number(cell.getValue() || 0).toFixed(0),
    muiEditTextFieldProps: { variant: 'standard', type: 'number', sx: editInputSx(theme) },
  },
  {
    accessorKey: 'ran', header: 'RAN', size: 110, enableEditing: true,
    muiTableBodyCellProps: { sx: { fontWeight: 600 } },
    muiEditTextFieldProps: { variant: 'standard', sx: editInputSx(theme) },
  },
  {
    accessorKey: 'localUtilizacao', header: 'Local Uso', size: 110, enableEditing: true,
    muiEditTextFieldProps: { variant: 'standard', sx: editInputSx(theme) },
  },
  {
    accessorKey: 'doca', header: 'Doca', size: 80, enableEditing: true,
    muiEditTextFieldProps: { variant: 'standard', sx: editInputSx(theme) },
  },
  {
    accessorKey: 'codigoEmbalagemUC', header: 'Emb. UC', size: 90, enableEditing: true,
    muiEditTextFieldProps: { variant: 'standard', sx: editInputSx(theme) },
  },
  {
    accessorKey: 'lote', header: 'Lote', size: 90, enableEditing: true,
    muiEditTextFieldProps: { variant: 'standard', sx: editInputSx(theme) },
  },
  {
    accessorKey: 'dataFabricacao', header: 'Dt. Fab.', size: 100, enableEditing: true,
    Cell: ({ cell }) => fmtDate(cell.getValue()),
    muiEditTextFieldProps: { variant: 'standard', placeholder: 'YYYY/MM/DD', sx: editInputSx(theme) },
  },
  {
    accessorKey: 'numeroDocumento', header: 'No. Docto', size: 100, enableEditing: true,
    muiEditTextFieldProps: { variant: 'standard', sx: editInputSx(theme) },
  },
]

export default function EtiquetasGrid({
  theme,
  currentItem,
  itemsCount,
  xmlRaw,
  metaIds,
  currentEtiquetas,
  loading,
  allowedVol,
  currentVol,
  volExcedido,
  volCompleto,
  onAddManual,
  onLoteOpen,
  handleDelete,
  handleToggleSelected,
  handleUpdateEtiqueta
}) {
  const columns = useMemo(() => [
    ...buildLabelColumns(theme),
    {
      id: 'actions', header: '', size: 48, enableEditing: false,
      Cell: ({ row: r }) => (
        <Tooltip title="Remover" arrow>
          <IconButton size="small" onClick={() => handleDelete(r.original.id)}
            sx={{ color: theme.danger, '&:hover': { bgcolor: theme.dangerBg } }}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ),
    },
  ], [theme, handleDelete])

  const table = useMaterialReactTable({
    columns,
    data: currentEtiquetas,
    enableEditing: true,
    editDisplayMode: 'cell',
    onEditingRowSave: ({ row, values, table: t }) => {
      handleUpdateEtiqueta(row, values)
      t.setEditingRow(null)
    },
    muiEditTextFieldProps: ({ row, column }) => ({
      onBlur: (event) => {
        const field = column.id
        const value = event.target.value
        if (field && field !== 'sel' && field !== 'actions') {
          handleUpdateEtiqueta(row, { [field]: value })
        }
      },
    }),
    enablePagination: false,
    enableBottomToolbar: false,
    enableTopToolbar: false,
    enableColumnActions: false,
    enableSorting: false,
    enableFilters: false,
    muiTableContainerProps: { sx: { maxHeight: 300 } },
    muiTablePaperProps: {
      elevation: 0,
      sx: {
        border: `1px solid ${theme.borderLight}`,
        borderRadius: 1,
        bgcolor: theme.bgSurface,
      }
    },
    muiTableHeadCellProps: {
      sx: {
        bgcolor: theme.bgBase,
        color: theme.primaryDark,
        fontWeight: 700, fontSize: 10, textTransform: 'uppercase',
        letterSpacing: '0.4px', py: 0.8,
      }
    },
    muiTableBodyCellProps: {
      sx: { fontSize: 12, color: theme.textSecondary, py: 0.5 }
    },
    muiTableBodyRowProps: {
      sx: { '&:hover td': { bgcolor: theme.bgHover } }
    },
    meta: { toggleSelected: handleToggleSelected },
    state: { isLoading: loading },
  })

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Sub-toolbar do produto */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 0.8,
        borderBottom: `1px solid ${theme.borderLight}`,
        bgcolor: theme.bgBase,
      }}>
        <Typography sx={{ fontSize: 12, fontWeight: 700, color: theme.textSecondary }}>
          {currentItem
            ? (currentItem.produtoCliente || currentItem.produtoLocal || `Item ${currentItem.occ}`)
            : itemsCount === 0 ? 'Item Manual' : 'Selecione um produto'}
        </Typography>
        {currentItem && (
          <Chip label={`Qtd: ${currentItem.qtdFaturada}`} size="small"
            sx={{ fontSize: 10, bgcolor: theme.bgSurface, fontWeight: 600 }} />
        )}
        <Box sx={{ flex: 1 }} />

        <Button size="small" variant="outlined"
          startIcon={<AddIcon fontSize="small" />}
          onClick={onAddManual}
          sx={{
            textTransform: 'none', fontSize: 11, py: 0.3,
            borderColor: theme.borderInput, color: theme.textMuted,
            '&:hover': { borderColor: theme.primary, color: theme.primary },
          }}>
          + Manual
        </Button>

        <Button size="small" variant="contained"
          startIcon={<AutoFixHighIcon fontSize="small" />}
          onClick={onLoteOpen}
          sx={{
            textTransform: 'none', fontSize: 11, py: 0.3,
            bgcolor: '#1565c0', '&:hover': { bgcolor: '#0d47a1' },
          }}>
          Gerar Lote
        </Button>

        <Chip
          label={`${currentEtiquetas.length} etiqueta${currentEtiquetas.length !== 1 ? 's' : ''}`}
          size="small"
          sx={{ fontSize: 10, fontWeight: 700, bgcolor: theme.bgSidebar }} />
      </Box>

      {/* Grid de etiquetas */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {allowedVol > 0 && currentEtiquetas.length > 0 && (
          <Chip
            size="small"
            icon={<span style={{ fontSize: 13, marginLeft: 6 }}>
              {volExcedido ? '⚠️' : volCompleto ? '✓' : '◑'}
            </span>}
            label={
              volExcedido
                ? `${currentVol.toFixed(0)} / ${allowedVol.toFixed(0)} pç — excesso +${(currentVol - allowedVol).toFixed(0)}`
                : volCompleto
                ? `${currentVol.toFixed(0)} pç — volume completo`
                : `${currentVol.toFixed(0)} / ${allowedVol.toFixed(0)} pç — faltam ${(allowedVol - currentVol).toFixed(0)}`
            }
            sx={{
              fontSize: 11, fontWeight: 600, alignSelf: 'flex-start',
              bgcolor: volExcedido ? theme.dangerBg : volCompleto ? theme.successBg : theme.infoBg,
              color:   volExcedido ? theme.danger : volCompleto ? theme.success : theme.info,
              border: `1px solid ${volExcedido ? `${theme.danger}44` : volCompleto ? `${theme.success}44` : `${theme.info}44`}`,
            }}
          />
        )}

        {currentEtiquetas.length === 0 ? (
          <Box sx={{
            py: 5, textAlign: 'center',
            border: `1px dashed ${theme.borderLight}`,
            borderRadius: 1, flex: 1, display: 'flex',
            flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 1.5,
          }}>
            <LabelIcon sx={{ fontSize: 32, color: theme.borderInput }} />
            <Typography sx={{ fontSize: 13, fontWeight: 600, color: theme.textMuted }}>
              Nenhuma etiqueta
            </Typography>
            <Typography sx={{ fontSize: 12, color: theme.textDisabled, maxWidth: 280, textAlign: 'center' }}>
              {!currentItem && !xmlRaw
                ? 'Cadastre um produto na coluna esquerda antes de gerar etiquetas'
                : metaIds.length > 0
                ? 'Use "Gerar Lote" para criar etiquetas automaticamente com base na quantidade do XML-ASN'
                : 'Use "+ Manual" para adicionar etiquetas individualmente ou "Gerar Lote" para criar em série'}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
              <Button size="small" variant="outlined" startIcon={<AddIcon fontSize="small" />}
                onClick={onAddManual}
                disabled={!currentItem && !xmlRaw}
                sx={{ textTransform: 'none', fontSize: 11, borderColor: theme.borderInput,
                  color: theme.textMuted, '&:hover': { borderColor: theme.primary, color: theme.primary },
                  '&.Mui-disabled': { opacity: 0.35 } }}>
                + Manual
              </Button>
              <Button size="small" variant="contained" startIcon={<AutoFixHighIcon fontSize="small" />}
                onClick={onLoteOpen}
                disabled={!currentItem && !xmlRaw}
                sx={{ textTransform: 'none', fontSize: 11, bgcolor: '#1565c0', '&:hover': { bgcolor: '#0d47a1' },
                  '&.Mui-disabled': { opacity: 0.35 } }}>
                Gerar Lote
              </Button>
            </Box>
          </Box>
        ) : (
          <MaterialReactTable table={table} />
        )}
      </Box>
    </Box>
  )
}
