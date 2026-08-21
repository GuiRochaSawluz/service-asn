import { Box, Typography } from '@mui/material'
import AddBoxIcon from '@mui/icons-material/AddBox'
import ProductRow from './ProductRow'

export default function ProductList({ 
  theme, 
  items, 
  selectedItemOcc, 
  xmlRaw, 
  xmlLoading, 
  volByItem, 
  etiquetas, 
  onSelect, 
  onAddManual, 
  onEdit, 
  onDelete 
}) {
  return (
    <Box sx={{
      width: 220, flexShrink: 0,
      borderRight: `1px solid ${theme.borderLight}`,
      bgcolor: theme.bgSidebar,
      overflowY: 'auto',
      display: 'flex', flexDirection: 'column',
    }}>
      <Typography sx={{
        px: 1.5, py: 1, fontSize: 10, fontWeight: 700,
        color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px',
        borderBottom: `1px solid ${theme.borderDark}`,
      }}>
        Produtos
      </Typography>

      {!xmlRaw && !xmlLoading && (
        <Box
          onClick={onAddManual}
          sx={{
            px: 1.5, py: 0.9, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0.7,
            borderBottom: `1px solid ${theme.borderDark}`,
            color: theme.primary, fontSize: 11, fontWeight: 700,
            '&:hover': { bgcolor: theme.primaryLight },
            transition: 'background 0.12s',
          }}
        >
          <AddBoxIcon sx={{ fontSize: 16 }} />
          + Produto
        </Box>
      )}

      {items.length === 0 && !xmlLoading && (
        <Box sx={{ px: 1.5, py: 2, textAlign: 'center', opacity: 0.5 }}>
          <Typography sx={{ fontSize: 11, color: theme.textMuted }}>
            Nenhum produto.
          </Typography>
          <Typography sx={{ fontSize: 10, color: theme.textDisabled, mt: 0.3 }}>
            Clique em "+ Produto" para cadastrar.
          </Typography>
        </Box>
      )}

      {items.map(item => (
        <ProductRow
          key={item.occ}
          item={item}
          theme={theme}
          isSelected={selectedItemOcc === item.occ}
          etqCount={etiquetas.filter(e => e.itemOcc === item.occ).length}
          vol={volByItem[item.occ] || 0}
          total={parseFloat(item.qtdFaturada) || 0}
          onSelect={onSelect}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </Box>
  )
}
