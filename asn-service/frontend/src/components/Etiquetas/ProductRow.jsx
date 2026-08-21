import { Box, Typography, IconButton, Tooltip, Chip } from '@mui/material'
import PackageIcon from '@mui/icons-material/Inventory2'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'

export default function ProductRow({ item, theme, isSelected, etqCount, vol, total, onSelect, onEdit, onDelete }) {
  const isManual   = Boolean(item._manual)
  const statusColor = vol === 0 ? theme.textMuted
    : vol === total ? theme.success
    : vol > total ? theme.danger
    : theme.warning

  return (
    <Box
      onClick={() => onSelect(item.occ)}
      sx={{
        px: 1.5, py: 1.2, cursor: 'pointer', position: 'relative',
        borderLeft: `3px solid ${isSelected ? theme.primary : 'transparent'}`,
        bgcolor: isSelected ? theme.primaryBg : 'transparent',
        borderBottom: `1px solid ${theme.borderDark}`,
        '&:hover': { bgcolor: theme.bgHover },
        '&:hover .item-actions': { opacity: 1 },
        transition: 'all 0.12s',
      }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mb: 0.4 }}>
        <PackageIcon sx={{ fontSize: 13, color: theme.textDisabled }} />
        <Typography sx={{ fontSize: 11, fontWeight: 700, color: theme.textSecondary, flex: 1 }} noWrap>
          {item.produtoCliente || item.produtoLocal || `Item ${item.occ}`}
        </Typography>
        {isManual && (
          <Box className="item-actions" sx={{ display: 'flex', gap: 0.3, opacity: 0, transition: 'opacity 0.15s' }}>
            <Tooltip title="Editar produto" arrow>
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); onEdit(item, e); }}
                sx={{ p: 0.2, color: theme.info, '&:hover': { bgcolor: theme.infoBg } }}>
                <EditIcon sx={{ fontSize: 13 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Remover produto" arrow>
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); onDelete(item.occ, e); }}
                sx={{ p: 0.2, color: theme.danger, '&:hover': { bgcolor: theme.dangerBg } }}>
                <DeleteIcon sx={{ fontSize: 13 }} />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          <Typography sx={{ fontSize: 10, color: theme.textMuted }}>
            {etqCount} etq.
          </Typography>
          {isManual && (
            <Chip label="manual" size="small" sx={{
              height: 13, fontSize: 9, fontWeight: 700, borderRadius: 0.5,
              bgcolor: theme.infoBg, color: theme.info,
              '& .MuiChip-label': { px: '4px' },
            }} />
          )}
        </Box>
        <Typography sx={{ fontSize: 10, fontWeight: 700, color: statusColor }}>
          {vol.toFixed(0)}/{total.toFixed(0)}
        </Typography>
      </Box>
    </Box>
  )
}
