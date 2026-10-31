/**
 * App.jsx — ASN Service Frontend
 *
 * Uso:
 *   http://localhost:5175/                          → pede IdMeta
 *   http://localhost:5175/?idMeta=101515846         → abre direto o AvisoEmbarqueTab
 *
 * O componente AvisoEmbarqueTab é o mesmo do monolito.
 * A apiBaseUrl aponta para o backend ASN (:8002) via proxy Vite.
 */
import { useState, useEffect, Suspense, lazy, useCallback } from 'react'
import {
  ThemeProvider, CssBaseline, Box, Typography, TextField, Button,
  CircularProgress, Alert,
} from '@mui/material'
import LocalShippingIcon from '@mui/icons-material/LocalShipping'
import SearchIcon from '@mui/icons-material/Search'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart'
import StorageIcon from '@mui/icons-material/Storage'

import { I18nProvider } from './I18nContext'
import { EmulationProvider } from './EmulationContext'
import { getTheme, applyUIPreferencesToDOM } from './theme'
import { useUmbrellaColors } from './useUmbrellaColors'
import { getAppPathname } from './satellitePath'

const AvisoEmbarqueTab = lazy(() => import('./AvisoEmbarqueTab'))
const EtiquetasTab = lazy(() => import('./EtiquetasTab'))

// Proxy Vite encaminha /api/* → :8002 — não precisamos de URL absoluta em dev
const API_BASE = import.meta.env.VITE_ASN_API_URL || ''

function getTokenFromUrl() {
  const p = new URLSearchParams(window.location.search)
  return p.get('token') || p.get('access_token') || p.get('sat_token') || ''
}

function cleanupTokenFromUrl() {
  const url = new URL(window.location.href)
  url.searchParams.delete('token')
  url.searchParams.delete('access_token')
  url.searchParams.delete('sat_token')
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`)
}

function isEmbedded() {
  return window.parent && window.parent !== window
}

function announceUmbrellaReady() {
  if (!isEmbedded()) return
  window.parent.postMessage({ type: 'UMBRELLA_READY' }, '*')
}

function waitForUmbrellaToken(timeoutMs = 12000) {
  return new Promise((resolve) => {
    if (!isEmbedded()) {
      resolve('')
      return
    }

    let settled = false
    const finish = (token) => {
      if (settled) return
      settled = true
      window.removeEventListener('message', onMessage)
      clearTimeout(refreshTimer)
      clearTimeout(hardTimer)
      resolve(token || '')
    }

    const onMessage = (event) => {
      const data = event?.data
      if (!data || data.type !== 'UMBRELLA_TOKEN_REFRESH' || !data.token) return
      try {
        window.parent?.postMessage({ type: 'UMBRELLA_TOKEN_ACK', version: 1 }, event.origin || '*')
      } catch {
        /* o pai segue sem o ACK */
      }
      finish(String(data.token))
    }

    window.addEventListener('message', onMessage)
    announceUmbrellaReady()

    const refreshTimer = setTimeout(() => {
      if (!settled) {
        window.parent.postMessage({ type: 'UMBRELLA_REQUEST_TOKEN_REFRESH' }, '*')
      }
    }, 1200)

    const hardTimer = setTimeout(() => finish(''), timeoutMs)
  })
}

async function exchangeHubToken(hubToken) {
  const res = await fetch(`${API_BASE}/api/auth/token/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ m2m_token: hubToken }),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(detail || 'Falha ao trocar o token do Umbrella')
  }
  const data = await res.json()
  if (!data?.access_token) {
    throw new Error('Umbrella nao devolveu access_token para o ASN')
  }
  return data.access_token
}

async function openAsnSession(token) {
  const res = await fetch(`${API_BASE}/api/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ token }),
  })
  if (res.ok) return { ok: true, detail: '' }
  const detail = await res.text()
  return { ok: false, detail: detail || `HTTP ${res.status}` }
}

/** view=etiquetas → aba Etiqueta (XML-ASN); default → Aviso de Embarque (procNFe) */
function getViewFromUrl() {
  const p = new URLSearchParams(window.location.search)
  const raw = (p.get('view') || p.get('tab') || '').toLowerCase()
  if (raw === 'etiquetas' || raw === 'etiqueta' || raw === 'labels') return 'etiquetas'
  return 'aviso'
}

// ── Lê todos os parâmetros de contexto da query string
// O monolito / SW2 passa esses campos no iframe src
function getRowFromUrl() {
  const p = new URLSearchParams(window.location.search)
  const idMeta    = p.get('idMeta')    || p.get('id_meta')    || ''
  const idMetaRef = p.get('idMetaRef') || p.get('id_meta_ref') || ''
  const pathNuvem = p.get('pathNuvem') || p.get('path_nuvem') || ''
  const nomeMsg   = p.get('nomeMensagem') || p.get('NomeMensagemEDI') || ''
  const nomePadrao = p.get('nomePadrao') || p.get('NomePadraoEDI') || ''
  const view = getViewFromUrl()
  return {
    IdMeta:                    idMeta,
    IdMetaArquivoReferenciado: idMetaRef || null,
    PathArquivoNuvem:          pathNuvem || null,
    AliasEntidadeEmissora:     p.get('aliasEmissora') || '',
    AliasEntidadeOwner:        p.get('aliasOwner')    || '',
    AliasEntidadeDeDestino:    p.get('aliasDestino')  || '',
    DtHrIntercambio:           p.get('dthr')          || '',
    NumeroDocto:               p.get('numeroDocto')   || '',
    XML_ChaveDocumentoFiscal:  p.get('chaveNfe')      || '',
    NomeMensagemEDI:           nomeMsg || (view === 'etiquetas' ? 'XML-ASN' : ''),
    NomePadraoEDI:             nomePadrao || '',
    tipo:                      view === 'etiquetas' ? 'xml-asn' : '',
  }
}

// ── Tela de entrada mínima (quando não há idMeta na URL) ──────────────────────
function EntryScreen({ onOpen }) {
  const [idMeta, setIdMeta] = useState('')
  const [health, setHealth] = useState(null)

  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then(r => r.json())
      .then(d => setHealth(d))
      .catch(() => setHealth({ status: 'error' }))
  }, [])

  const handleOpen = () => {
    const val = idMeta.trim()
    if (!val) return
    onOpen(val)
  }

  return (
    <Box sx={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      bgcolor: '#0d1117', gap: 2.5, p: 4,
    }}>
      {/* Cabeçalho */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
        <Box sx={{
          width: 40, height: 40, borderRadius: 1.5,
          bgcolor: 'primary.main', opacity: 0.12, border: `1.5px solid`,
          borderColor: 'primary.main',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <LocalShippingIcon sx={{ color: 'primary.main', fontSize: 22 }} />
        </Box>
        <Box>
          <Typography sx={{ fontSize: 18, fontWeight: 800, color: '#e0e0e0', lineHeight: 1.1 }}>
            ASN Service
          </Typography>
          <Typography sx={{ fontSize: 10, color: '#444', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
            Etiqueta · Aviso de Embarque
          </Typography>
        </Box>
      </Box>

      {/* Status backend */}
      {health && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
          <Box sx={{
            width: 7, height: 7, borderRadius: '50%',
            bgcolor: health.status === 'ok' ? 'primary.main' : '#ef4444',
          }} />
          <Typography sx={{ fontSize: 10, color: health.status === 'ok' ? 'primary.main' : '#ef4444', fontWeight: 600 }}>
            {health.status === 'ok'
              ? `Backend online — porta ${health.port} · SwPaaS ${health.swpaas_env?.toUpperCase()}`
              : 'Backend offline — verifique a porta 8003'}
          </Typography>
        </Box>
      )}

      {/* Formulário de entrada */}
      <Box sx={{
        width: '100%', maxWidth: 480,
        bgcolor: '#111317', border: '1px solid #1e2330',
        borderRadius: 2, p: 3,
      }}>
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#888', mb: 1.5 }}>
          Informe o IdMeta do intercâmbio NF-e
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            fullWidth autoFocus
            size="small"
            placeholder="Ex: 101515846"
            value={idMeta}
            onChange={e => setIdMeta(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleOpen()}
            sx={{
              '& .MuiOutlinedInput-root': {
                color: '#e0e0e0', fontSize: 13,
                '& fieldset': { borderColor: '#2a2d35' },
                '&:hover fieldset': { borderColor: 'primary.main' },
                '&.Mui-focused fieldset': { borderColor: 'primary.main' },
              },
            }}
            InputProps={{
              startAdornment: <SearchIcon sx={{ fontSize: 15, mr: 0.5, color: '#444' }} />,
            }}
          />
          <Button
            variant="contained"
            onClick={handleOpen}
            disabled={!idMeta.trim()}
            endIcon={<ArrowForwardIcon sx={{ fontSize: 14 }} />}
            sx={{
              bgcolor: 'primary.main', textTransform: 'none', fontWeight: 700, fontSize: 12,
              '&:hover': { bgcolor: 'primary.dark' },
              '&:disabled': { bgcolor: '#1e2330', color: '#555' },
              px: 2, whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            Abrir
          </Button>
        </Box>
      </Box>
    </Box>
  )
}

function OpsScreen() {
  const [health, setHealth] = useState(null)
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')

  const loadOps = useCallback(async () => {
    setError('')
    try {
      const [healthRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/api/system/health`),
        fetch(`${API_BASE}/api/system/stats`),
      ])

      if (!healthRes.ok || !statsRes.ok) {
        const detail = !healthRes.ok ? await healthRes.text() : await statsRes.text()
        throw new Error(detail || 'Falha ao consultar health/stats')
      }

      const [healthData, statsData] = await Promise.all([healthRes.json(), statsRes.json()])
      setHealth(healthData)
      setStats(statsData)
    } catch (e) {
      setError(String(e?.message || e))
    }
  }, [])

  useEffect(() => {
    loadOps()
    const id = window.setInterval(loadOps, 15000)
    return () => window.clearInterval(id)
  }, [loadOps])

  const serviceItems = [
    { name: 'ASN API', data: health?.services?.asn },
    { name: 'Report', data: health?.services?.report },
    { name: 'Stimulsoft', data: health?.services?.stimulsoft },
  ]

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', p: { xs: 2, md: 4 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <MonitorHeartIcon color="primary" />
        <Typography sx={{ fontSize: 20, fontWeight: 800 }}>Unified Ops</Typography>
        <Box sx={{ flex: 1 }} />
        <Button variant="outlined" onClick={loadOps} sx={{ textTransform: 'none' }}>
          Atualizar
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
        {serviceItems.map((item) => (
          <Box
            key={item.name}
            sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2 }}
          >
            <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.6 }}>{item.name}</Typography>
            <Typography sx={{ fontSize: 18, fontWeight: 700, color: item.data?.status === 'ok' ? 'success.main' : 'warning.main' }}>
              {(item.data?.status || 'unknown').toUpperCase()}
            </Typography>
            {item.data?.base_url && (
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.8 }}>
                {item.data.base_url}
              </Typography>
            )}
          </Box>
        ))}
      </Box>

      <Box sx={{ mt: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2 }}>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1 }}>Estatisticas</Typography>
        <Typography sx={{ fontSize: 14 }}>Uptime: {stats?.uptime_seconds ?? '-'}s</Typography>
        <Typography sx={{ fontSize: 14 }}>Avisos: {stats?.database?.avisos_embarque ?? '-'}</Typography>
        <Typography sx={{ fontSize: 14 }}>NFe Labels: {stats?.database?.nfe_labels ?? '-'}</Typography>
        <Typography sx={{ fontSize: 14, mt: 1 }}>Requests ASN: {stats?.requests?.asn_api ?? '-'}</Typography>
        <Typography sx={{ fontSize: 14 }}>Requests Stimulsoft: {stats?.requests?.stimulsoft ?? '-'}</Typography>
      </Box>
    </Box>
  )
}

function UnauthorizedScreen({ message }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3, bgcolor: 'background.default' }}>
      <Box sx={{ maxWidth: 560, width: '100%', border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 3 }}>
        <Typography sx={{ fontSize: 20, fontWeight: 800, mb: 1 }}>Acesso nao autorizado</Typography>
        <Typography sx={{ fontSize: 14, color: 'text.secondary', mb: 2 }}>
          Este microsservico exige token temporario derivado do m2m via handshake no backend do satelite.
        </Typography>
        <Alert severity="error">{message || 'Sessao invalida ou expirada.'}</Alert>
      </Box>
    </Box>
  )
}

function MigrationsAdminScreen() {
  const [adminToken, setAdminToken] = useState('')
  const [revision, setRevision] = useState('head')
  const [loading, setLoading] = useState(false)
  const [statusData, setStatusData] = useState(null)
  const [upgradeData, setUpgradeData] = useState(null)
  const [error, setError] = useState('')

  const buildHeaders = useCallback(() => {
    const headers = { 'Content-Type': 'application/json' }
    if (adminToken.trim()) headers['x-admin-token'] = adminToken.trim()
    return headers
  }, [adminToken])

  const loadStatus = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/api/admin/migrations/status`, {
        method: 'GET',
        credentials: 'include',
        headers: buildHeaders(),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.detail || JSON.stringify(body) || `HTTP ${res.status}`)
      setStatusData(body)
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [buildHeaders])

  const runUpgrade = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/api/admin/migrations/upgrade`, {
        method: 'POST',
        credentials: 'include',
        headers: buildHeaders(),
        body: JSON.stringify({ revision: revision.trim() || 'head' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.stderr || body?.detail || JSON.stringify(body) || `HTTP ${res.status}`)
      setUpgradeData(body)
      await loadStatus()
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [buildHeaders, loadStatus, revision])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', p: { xs: 2, md: 4 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <StorageIcon color="primary" />
        <Typography sx={{ fontSize: 20, fontWeight: 800 }}>Admin - Migracoes</Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr auto' }, gap: 1.2, mb: 2 }}>
        <TextField
          label="x-admin-token (opcional)"
          value={adminToken}
          onChange={(e) => setAdminToken(e.target.value)}
          size="small"
          fullWidth
        />
        <TextField
          label="Revision"
          value={revision}
          onChange={(e) => setRevision(e.target.value)}
          size="small"
          fullWidth
        />
        <Button variant="contained" onClick={runUpgrade} disabled={loading} sx={{ textTransform: 'none' }}>
          Upgrade
        </Button>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <Button variant="outlined" onClick={loadStatus} disabled={loading} sx={{ textTransform: 'none' }}>
          Atualizar status
        </Button>
      </Box>

      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2, mb: 2 }}>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1 }}>Status Alembic</Typography>
        <Box component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>
{statusData ? JSON.stringify(statusData, null, 2) : 'Sem dados'}
        </Box>
      </Box>

      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2 }}>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 1 }}>Resultado do upgrade</Typography>
        <Box component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>
{upgradeData ? JSON.stringify(upgradeData, null, 2) : 'Nenhum upgrade executado nesta sessao'}
        </Box>
      </Box>
    </Box>
  )
}

// ── Tela ASN (Aviso procNFe OU Etiquetas XML-ASN) ────────────────────────────
function AsnScreen({ row, onBack, mode }) {
  // Detecta se está rodando dentro de um iframe (ex: embutido no DetailsModal / SW2)
  const isEmbedded = window.self !== window.top
  const idMeta = row?.IdMeta || ''
  const view = getViewFromUrl()
  const isEtiquetas = view === 'etiquetas'

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default', overflow: 'hidden' }}>
      {/* Barra superior — escondida quando embutido em iframe */}
      {!isEmbedded && (
        <Box sx={{
          px: 1.5, py: 0.6,
          borderBottom: '1px solid #1a1d24',
          display: 'flex', alignItems: 'center', gap: 1,
          bgcolor: '#080b10', flexShrink: 0,
        }}>
          <LocalShippingIcon sx={{ color: 'primary.main', fontSize: 14 }} />
          <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#555', letterSpacing: '0.4px', textTransform: 'uppercase' }}>
            ASN Service · {isEtiquetas ? 'Etiquetas' : 'Aviso de Embarque'}
          </Typography>
          <Typography sx={{ fontSize: 10, color: '#2a2d35', mx: 0.3 }}>·</Typography>
          <Typography sx={{ fontSize: 10, color: '#333', fontFamily: 'monospace' }}>
            IdMeta: {idMeta}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button size="small" onClick={onBack}
            sx={{ textTransform: 'none', fontSize: 10, color: '#333', minWidth: 0, py: 0.2, px: 1,
              '&:hover': { color: '#666' } }}>
            ← nova busca
          </Button>
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <Suspense fallback={
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <CircularProgress color="primary" />
          </Box>
        }>
          {isEtiquetas ? (
            <EtiquetasTab row={row} mode={mode} />
          ) : (
            <AvisoEmbarqueTab
              row={row}
              mode={mode}
              apiBaseUrl={API_BASE}
            />
          )}
        </Suspense>
      </Box>
    </Box>
  )
}

// ── App Root ──────────────────────────────────────────────────────────────
export default function App() {
  // Prioridade: query string (vem do iframe do monolito) → state interno
  const [currentRow, setCurrentRow] = useState(() => getRowFromUrl())
  const [authReady, setAuthReady] = useState(false)
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [isSawluzUser, setIsSawluzUser] = useState(false)
  const [authError, setAuthError] = useState('')

  // ── Cores do Umbrella (swpaas/GateVirtual) ───────────────────────────
  // Resolvidas via query string (?primaria=, ?secundaria=, ?theme=)
  // e/ou postMessage do parent window (UMBRELLA_THEME)
  const { primary, secondary, theme: urlTheme, customColors } = useUmbrellaColors()

  // Modo visual: usa o theme recebido pela URL/postMessage ou 'dark' como fallback
  const mode = (urlTheme === 'light' || urlTheme === 'dark') ? urlTheme : 'dark'

  // Tema MUI dinâmico: reflete as cores do umbrella
  const muiTheme = getTheme(mode, customColors)

  // Aplica CSS vars derivadas ao DOM (grade, scrollbar, botões, etc.)
  // Mesma abordagem do GateVirtual/ThemeProvider.tsx → applyFullPaletteToDOM
  useEffect(() => {
    const defaultPrefs = {
      gridMode: 'striped-primary',
      gridDensity: 'default',
      areaOverrides: { buttonStyle: 'filled' },
    }
    applyUIPreferencesToDOM(defaultPrefs, primary, secondary, mode === 'dark')
  }, [primary, secondary, mode])

  // Reage a mudanças na URL (ex: navegação manual ou pushState)
  useEffect(() => {
    const handlePop = () => setCurrentRow(getRowFromUrl())
    window.addEventListener('popstate', handlePop)
    return () => window.removeEventListener('popstate', handlePop)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function boot() {
      announceUmbrellaReady()
      try {
        let token = getTokenFromUrl()
        if (!token && isEmbedded()) {
          token = await waitForUmbrellaToken()
        }

        let sessionOpened = false
        if (token) {
          let opened = await openAsnSession(token)
          if (!opened.ok) {
            const access = await exchangeHubToken(token)
            opened = await openAsnSession(access)
          }
          sessionOpened = opened.ok
          if (!opened.ok) {
            console.warn('Sessão ASN não aberta.', opened.detail)
          }
          cleanupTokenFromUrl()
        }

        if (sessionOpened) {
          const res = await fetch(`${API_BASE}/api/auth/session/validate`, { credentials: 'include' })
          if (res.ok) {
            const session = await res.json()
            if (!cancelled) setIsSawluzUser(!!session?.is_sawluz)
          }
        }
      } catch (err) {
        console.warn('Handshake do Umbrella ignorado.', err?.message || err)
      }

      if (!cancelled) {
        setIsAuthorized(true)
        setAuthReady(true)
      }
    }

    boot()
    return () => { cancelled = true }
  }, [])

  // Usado pela EntryScreen (busca manual por idMeta sem idMetaRef)
  const handleOpen = (idMeta) => {
    const url = new URL(window.location)
    url.searchParams.set('idMeta', idMeta)
    window.history.pushState({}, '', url)
    setCurrentRow(getRowFromUrl())
  }

  const handleBack = () => {
    const url = new URL(window.location)
    url.searchParams.delete('idMeta')
    url.searchParams.delete('idMetaRef')
    url.searchParams.delete('pathNuvem')
    window.history.pushState({}, '', url)
    setCurrentRow(getRowFromUrl())
  }

  const appPath = getAppPathname()
  const isOpsRoute = appPath === '/ops' || appPath.startsWith('/ops/')
  const isAdminMigrationsRoute = appPath === '/admin/migrations' || appPath.startsWith('/admin/migrations/')
  const needsSawluzAccess = isOpsRoute || isAdminMigrationsRoute

  if (!authReady) {
    return (
      <ThemeProvider theme={muiTheme}>
        <CssBaseline />
        <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'background.default' }}>
          <CircularProgress color="primary" />
        </Box>
      </ThemeProvider>
    )
  }

  if (!isAuthorized) {
    return (
      <ThemeProvider theme={muiTheme}>
        <CssBaseline />
        <UnauthorizedScreen message={authError} />
      </ThemeProvider>
    )
  }

  if (needsSawluzAccess && !isSawluzUser) {
    return (
      <ThemeProvider theme={muiTheme}>
        <CssBaseline />
        <UnauthorizedScreen message="Acesso restrito a usuarios @sawluz.com.br para esta tela." />
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <I18nProvider>
        <EmulationProvider>
          {isOpsRoute ? (
            <OpsScreen />
          ) : isAdminMigrationsRoute ? (
            <MigrationsAdminScreen />
          ) : currentRow?.IdMeta ? (
            <AsnScreen row={currentRow} onBack={handleBack} mode={mode} />
          ) : (
            <EntryScreen onOpen={handleOpen} />
          )}
        </EmulationProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
