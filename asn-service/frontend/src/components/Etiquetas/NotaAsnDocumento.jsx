import { Box, Typography, Button, Chip, CircularProgress, Alert } from '@mui/material'
import LabelIcon from '@mui/icons-material/Label'
import Inventory2Icon from '@mui/icons-material/Inventory2'

function Cell({ label, value, mono, theme, border = true }) {
  return (
    <Box sx={{
      p: 1,
      borderRight: border ? `1px solid ${theme.borderLight}` : 'none',
      minWidth: 0,
    }}>
      <Typography sx={{
        fontSize: 7, fontWeight: 800, textTransform: 'uppercase',
        letterSpacing: '0.4px', color: theme.textMuted, mb: 0.35,
      }}>
        {label}
      </Typography>
      <Typography sx={{
        fontSize: mono ? 10 : 12, fontWeight: 700,
        fontFamily: mono ? 'monospace' : 'inherit',
        color: theme.textMain, wordBreak: 'break-word', lineHeight: 1.25,
      }}>
        {value || '—'}
      </Typography>
    </Box>
  )
}

function money(v) {
  const n = parseFloat(v)
  if (!Number.isFinite(n)) return null
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/**
 * Visão estilo NF / Aviso (procNFe) para mensagem XML-ASN.
 * Clique no item → abre workspace de etiquetas daquele produto.
 */
export default function NotaAsnDocumento({
  theme,
  cabecalho,
  expedicao,
  items,
  etiquetas,
  xmlLoading,
  xmlError,
  onSelectItem,
  onRetry,
  aliasEmitente,
  aliasDestinatario,
}) {
  const emit = cabecalho?.emitente || {}
  const dest = cabecalho?.destinatario || {}
  const valores = cabecalho?.valores || {}
  const etqByOcc = {}
  ;(etiquetas || []).forEach(e => {
    etqByOcc[e.itemOcc] = (etqByOcc[e.itemOcc] || 0) + 1
  })

  const emitNome = emit.razaoSocial || emit.nome || aliasEmitente || cabecalho?.parceiroLocal || '—'
  const destNome = dest.razaoSocial || dest.nome || aliasDestinatario || cabecalho?.parceiroExterno || '—'

  return (
    <Box sx={{
      flex: 1, overflow: 'auto', p: 1.5,
      bgcolor: theme.bgBase,
    }}>
      <Box sx={{
        maxWidth: 980, mx: 'auto',
        border: `1px solid ${theme.borderLight}`,
        borderRadius: 1.5,
        bgcolor: theme.bgSurface,
        overflow: 'hidden',
      }}>
        {/* Faixa título */}
        <Box sx={{
          px: 1.5, py: 1,
          display: 'flex', alignItems: 'center', gap: 1,
          borderBottom: `2px solid ${theme.primary}`,
          bgcolor: theme.bgBase,
        }}>
          <Inventory2Icon sx={{ fontSize: 18, color: theme.primary }} />
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 800, color: theme.textMain, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              Documento XML-ASN
            </Typography>
            <Typography sx={{ fontSize: 10, color: theme.textMuted }}>
              Visualize os dados e clique no item para gerar / completar etiquetas (UC)
            </Typography>
          </Box>
          <Chip
            size="small"
            label={`${items?.length || 0} item(ns)`}
            sx={{ fontSize: 10, fontWeight: 700, bgcolor: theme.primaryLight || theme.infoBg, color: theme.primary }}
          />
        </Box>

        {/* Identificação NF */}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 150px 1fr', borderBottom: `1px solid ${theme.borderLight}` }}>
          <Box sx={{ p: 1.2, borderRight: `1px solid ${theme.borderLight}` }}>
            <Typography sx={{ fontSize: 7, fontWeight: 800, textTransform: 'uppercase', color: theme.textMuted, mb: 0.5 }}>
              Emitente / Transmissor
            </Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 800, color: theme.textMain }}>{emitNome}</Typography>
            <Typography sx={{ fontSize: 9, fontFamily: 'monospace', color: theme.textMuted, mt: 0.3 }}>
              CNPJ/ID: {emit.idEdi || emit.codigo || '—'}
            </Typography>
            {emit.endereco ? (
              <Typography sx={{ fontSize: 8, color: theme.textDisabled, mt: 0.2 }}>{emit.endereco}</Typography>
            ) : null}
          </Box>

          <Box sx={{
            p: 1, borderRight: `1px solid ${theme.borderLight}`,
            textAlign: 'center', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            bgcolor: theme.successBg || theme.bgBase,
          }}>
            <Typography sx={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', color: theme.primary, lineHeight: 1.2 }}>
              Aviso / ASN
            </Typography>
            <Typography sx={{ fontSize: 7, color: theme.textMuted, mb: 0.8 }}>doc. auxiliar EDI</Typography>
            <Box sx={{ border: `1px solid ${theme.borderLight}`, px: 1, py: 0.5, width: '100%', borderRadius: 0.5 }}>
              <Typography sx={{ fontSize: 7, color: theme.textMuted }}>NF Nº</Typography>
              <Typography sx={{ fontSize: 18, fontWeight: 900, fontFamily: 'monospace', color: theme.textMain, lineHeight: 1.1 }}>
                {cabecalho?.numNf || expedicao?.numDocto || '—'}
              </Typography>
              <Typography sx={{ fontSize: 7, color: theme.textMuted }}>
                SÉRIE {cabecalho?.serie || '1'}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ p: 1.2 }}>
            <Typography sx={{ fontSize: 7, fontWeight: 800, textTransform: 'uppercase', color: theme.textMuted, mb: 0.5 }}>
              Chave NF-e
            </Typography>
            <Typography sx={{ fontSize: 9, fontFamily: 'monospace', color: theme.textSecondary, wordBreak: 'break-all' }}>
              {cabecalho?.chaveNfe || '—'}
            </Typography>
            <Box sx={{ mt: 0.8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
              <Box>
                <Typography sx={{ fontSize: 7, fontWeight: 800, textTransform: 'uppercase', color: theme.textMuted }}>Emissão</Typography>
                <Typography sx={{ fontSize: 11, fontWeight: 600 }}>{cabecalho?.dataEmissao || '—'}</Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: 7, fontWeight: 800, textTransform: 'uppercase', color: theme.textMuted }}>CFOP</Typography>
                <Typography sx={{ fontSize: 11, fontWeight: 600, fontFamily: 'monospace' }}>{cabecalho?.cfop || '—'}</Typography>
              </Box>
            </Box>
          </Box>
        </Box>

        {/* Destinatário + expedição */}
        <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', borderBottom: `1px solid ${theme.borderLight}` }}>
          <Cell theme={theme} label="Destinatário / Receptor" value={destNome} />
          <Cell theme={theme} label="CNPJ / Código" value={dest.idEdi || dest.codigo || cabecalho?.clienteCodigo} mono />
          <Cell theme={theme} label="Cód. Cliente EDI" value={cabecalho?.clienteCodigo} mono border={false} />
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', borderBottom: `1px solid ${theme.borderLight}` }}>
          <Cell theme={theme} label="Natureza" value={cabecalho?.naturezaOperacao || '—'} />
          <Cell theme={theme} label="Fábrica / Local" value={[expedicao?.fabrica, expedicao?.localEntrega].filter(Boolean).join(' · ') || '—'} />
          <Cell theme={theme} label="Doca" value={expedicao?.doca} />
          <Cell theme={theme} label="Valor total" value={money(valores.valorTotal) || '—'} mono border={false} />
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', borderBottom: `1px solid ${theme.borderLight}`, bgcolor: theme.bgBase }}>
          <Cell theme={theme} label="Peso bruto" value={expedicao?.pesoBruto ? `${expedicao.pesoBruto} kg` : '—'} mono />
          <Cell theme={theme} label="Peso líquido" value={expedicao?.pesoLiquido ? `${expedicao.pesoLiquido} kg` : '—'} mono />
          <Cell theme={theme} label="Volumes" value={expedicao?.totalVolumes} mono />
          <Cell theme={theme} label="Embarque" value={expedicao?.dtHrEmbarque} mono border={false} />
        </Box>

        {/* Produtos */}
        <Box sx={{
          px: 1, py: 0.8,
          borderBottom: `1px solid ${theme.borderLight}`,
          bgcolor: theme.successBg || theme.bgBase,
          display: 'flex', alignItems: 'center', gap: 1,
        }}>
          <Box sx={{ width: 3, height: 14, borderRadius: 1, bgcolor: theme.primary }} />
          <Typography sx={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px', color: theme.primary }}>
            Produtos / Serviços — clique na linha para etiquetas
          </Typography>
        </Box>

        {xmlLoading && (
          <Box sx={{ py: 5, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={22} sx={{ color: theme.primary }} />
            <Typography sx={{ fontSize: 12, color: theme.textMuted }}>Carregando XML-ASN…</Typography>
          </Box>
        )}

        {xmlError && !xmlLoading && (
          <Alert severity="warning" sx={{ m: 1.5, fontSize: 12 }}
            action={onRetry ? <Button size="small" onClick={onRetry} sx={{ textTransform: 'none' }}>Tentar de novo</Button> : null}>
            {xmlError}
          </Alert>
        )}

        {!xmlLoading && items?.length > 0 && (
          <>
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: '36px 1.4fr 1.2fr 0.7fr 0.9fr 0.7fr 90px',
              px: 1, py: 0.5,
              bgcolor: theme.bgBase,
              borderBottom: `1px solid ${theme.borderLight}`,
            }}>
              {['#', 'Produto local', 'Produto cliente', 'Qtd', 'Pedido', 'CFOP', ''].map((h) => (
                <Typography key={h || 'act'} sx={{
                  fontSize: 7, fontWeight: 800, textTransform: 'uppercase',
                  color: theme.primary, letterSpacing: '0.3px',
                }}>
                  {h}
                </Typography>
              ))}
            </Box>

            {items.map((item, idx) => {
              const etqCount = etqByOcc[item.occ] || 0
              const semEtq = etqCount === 0
              return (
                <Box
                  key={item.occ}
                  onClick={() => onSelectItem?.(item)}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '36px 1.4fr 1.2fr 0.7fr 0.9fr 0.7fr 90px',
                    alignItems: 'center',
                    px: 1, py: 0.9,
                    cursor: 'pointer',
                    borderLeft: `4px solid ${semEtq ? theme.warning : theme.success}`,
                    borderBottom: `1px solid ${theme.borderLight}`,
                    bgcolor: idx % 2 === 0 ? theme.bgSurface : theme.bgBase,
                    transition: 'background 0.12s',
                    '&:hover': { bgcolor: theme.bgHover },
                  }}
                >
                  <Box sx={{
                    width: 22, height: 22, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    bgcolor: semEtq ? theme.warningBg : theme.successBg,
                    border: `1.5px solid ${semEtq ? theme.warning : theme.success}`,
                  }}>
                    <Typography sx={{ fontSize: 8, fontWeight: 800, color: semEtq ? theme.warning : theme.success }}>
                      {String(idx + 1).padStart(2, '0')}
                    </Typography>
                  </Box>
                  <Box sx={{ minWidth: 0, pr: 0.5 }}>
                    <Typography sx={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', color: theme.textMain }} noWrap>
                      {item.produtoLocal || '—'}
                    </Typography>
                    {item.descricao ? (
                      <Typography sx={{ fontSize: 8, color: theme.textMuted }} noWrap>{item.descricao}</Typography>
                    ) : null}
                  </Box>
                  <Typography sx={{ fontSize: 10, fontFamily: 'monospace', color: theme.primary, fontWeight: 600 }} noWrap>
                    {item.produtoCliente || '—'}
                  </Typography>
                  <Typography sx={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700 }}>
                    {parseFloat(item.qtdFaturada || 0).toFixed(0)} {item.unidade || 'PC'}
                  </Typography>
                  <Typography sx={{ fontSize: 9, fontFamily: 'monospace', color: theme.textMuted }} noWrap>
                    {item.numPedido || '—'}
                  </Typography>
                  <Typography sx={{ fontSize: 10, fontFamily: 'monospace', textAlign: 'center' }}>
                    {item.cfop || cabecalho?.cfop || '—'}
                  </Typography>
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<LabelIcon sx={{ fontSize: 12 }} />}
                    onClick={(e) => { e.stopPropagation(); onSelectItem?.(item) }}
                    sx={{
                      textTransform: 'none', fontSize: 10, py: 0.2, px: 0.8,
                      bgcolor: theme.primary, '&:hover': { bgcolor: theme.primaryDark },
                      minWidth: 0, whiteSpace: 'nowrap',
                    }}
                  >
                    {etqCount > 0 ? `${etqCount} etq` : 'Etiquetas'}
                  </Button>
                </Box>
              )
            })}
          </>
        )}

        {!xmlLoading && !xmlError && (!items || items.length === 0) && (
          <Box sx={{ py: 5, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 12, color: theme.textMuted }}>Nenhum item no XML-ASN.</Typography>
          </Box>
        )}

        {/* Totais */}
        {(valores.valorTotal || valores.valorIcms) && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderTop: `1px solid ${theme.borderLight}` }}>
            <Cell theme={theme} label="Base ICMS" value={money(valores.baseIcms) || '—'} mono />
            <Cell theme={theme} label="Valor ICMS" value={money(valores.valorIcms) || '—'} mono />
            <Cell theme={theme} label="Valor IPI" value={money(valores.valorIpi) || '—'} mono />
            <Cell theme={theme} label="Total NF" value={money(valores.valorTotal) || '—'} mono border={false} />
          </Box>
        )}

        <Box sx={{ px: 1.2, py: 0.6, bgcolor: theme.bgBase, borderTop: `1px dashed ${theme.borderLight}` }}>
          <Typography sx={{ fontSize: 8, color: theme.textDisabled, fontStyle: 'italic' }}>
            Dica: o fluxo é o mesmo do Aviso (procNFe) — selecione o item e complete UC/UM na tela de etiquetas.
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}
