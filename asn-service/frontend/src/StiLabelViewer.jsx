/**
 * StiLabelViewer.jsx
 * Viewer PDF custom com pdf.js + integracao otimizada com microservico Stimulsoft.
 */
import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import {
  Box,
  CircularProgress,
  Typography,
  IconButton,
  Button,
  TextField,
  Tooltip,
  Select,
  MenuItem,
} from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import GetAppIcon from '@mui/icons-material/GetApp'
import CloseIcon from '@mui/icons-material/Close'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import FullscreenIcon from '@mui/icons-material/Fullscreen'
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit'
import SearchIcon from '@mui/icons-material/Search'
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore'
import NavigateNextIcon from '@mui/icons-material/NavigateNext'
import ZoomInIcon from '@mui/icons-material/ZoomIn'
import ZoomOutIcon from '@mui/icons-material/ZoomOut'
import LocalPrintshopIcon from '@mui/icons-material/LocalPrintshop'
import SaveIcon from '@mui/icons-material/Save'
import { getDocument, GlobalWorkerOptions, Util } from 'pdfjs-dist'
import { Brand } from './theme'
import { getSlugPrefix } from './satellitePath'
import { useI18n } from './I18nContext'
import { alpha } from '@mui/material/styles'

// Com base "./" o pdf.js resolveria o worker a partir de assets/, onde o arquivo não existe.
GlobalWorkerOptions.workerSrc = `${window.location.origin}${getSlugPrefix()}/pdf.worker.min.mjs`

const STIMULSOFT_SERVICE_URL =
  import.meta.env.VITE_STIMULSOFT_SERVICE_URL ?? '/api/stimulsoft'

const ZOOM_PRESETS = [0.75, 1, 1.25, 1.5, 2]

const _mrtCache = new Map()

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function fetchMrtContent(templateName) {
  if (typeof templateName !== 'string' || !templateName.trim()) {
    throw new Error('Modelo de etiqueta invalido. Selecione um template com versao publicada.')
  }

  const normalizedTemplate = templateName.trim()
  if (_mrtCache.has(normalizedTemplate)) return _mrtCache.get(normalizedTemplate)

  const templateUrl = normalizedTemplate.startsWith('/')
    ? normalizedTemplate
    : `/api/labels/mrt/${encodeURIComponent(normalizedTemplate)}`

  const res = await fetch(templateUrl)
  if (!res.ok) throw new Error(`Template nao encontrado: ${res.status} (${normalizedTemplate})`)
  const text = await res.text()
  _mrtCache.set(normalizedTemplate, text)
  return text
}

async function renderPdf(mrtContent, data) {
  const res = await fetch('/api/labels/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ mrtContent, data }),
  })
  if (!res.ok) {
    const text = await res.text()
    let detail = text
    try {
      const payload = JSON.parse(text)
      if (payload?.detail) detail = String(payload.detail)
    } catch {
      detail = text
    }
    throw new Error(detail || `Erro ao renderizar PDF (HTTP ${res.status})`)
  }
  return res.arrayBuffer()
}

async function deleteViewerSession(sessionId) {
  if (!sessionId) return
  try {
    const res = await fetch(`${STIMULSOFT_SERVICE_URL}/api/print/viewer-content/${sessionId}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 404) {
      console.warn(`[StiLabelViewer] sessao ${sessionId} nao removida (HTTP ${res.status})`)
    }
  } catch {
    // sem impacto funcional para o usuario
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeSearchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function createSearchMatcher(rawTerm) {
  const normalized = normalizeSearchText(rawTerm).trim()
  if (!normalized) return null

  const likeTerm = normalized.includes('%') ? normalized : `%${normalized}%`
  let regexSource = ''
  for (const ch of likeTerm) {
    regexSource += ch === '%' ? '.*' : escapeRegExp(ch)
  }

  const likeRegex = new RegExp(`^${regexSource}$`, 'i')
  const hasWildcard = likeTerm.includes('%')
  const plain = likeTerm.replace(/%/g, '').trim()
  const plainRegex = plain ? new RegExp(escapeRegExp(plain), 'gi') : null

  return {
    test(value) {
      return likeRegex.test(normalizeSearchText(value))
    },
    count(value) {
      const normalizedValue = normalizeSearchText(value)
      if (hasWildcard || !plainRegex) {
        return likeRegex.test(normalizedValue) ? 1 : 0
      }
      const matches = normalizedValue.match(plainRegex)
      return matches?.length || 0
    },
  }
}

function drawSearchHighlights(context, textItems, viewport, matcher) {
  if (!matcher || !Array.isArray(textItems) || textItems.length === 0) return

  context.save()
  context.fillStyle = 'rgba(255, 208, 0, 0.38)'

  for (const item of textItems) {
    if (!item || typeof item.str !== 'string') continue
    if (!matcher.test(item.str)) continue

    const transformed = Util.transform(viewport.transform, item.transform)
    const x = transformed[4]
    const y = transformed[5]
    const fontHeight = Math.max(8, Math.hypot(transformed[2], transformed[3]))
    const width = Math.max(6, item.width * viewport.scale)
    const height = Math.max(10, fontHeight * 1.15)

    context.fillRect(x, y - height + 2, width, height)
  }

  context.restore()
}

export default function StiLabelViewer({
  xmlData,
  templateName,
  mode = 'VIEWER',
  onClose,
  onExport,
  showInterfaceExport = false,
  mode_theme = 'dark',
  showSidebar = true,
  isEtiqueta = false,
}) {
  const isDark = mode_theme === 'dark'
  const { t, tc } = useI18n('stiViewer')

  const [loading, setLoading] = useState(true)
  const [loadingMsg, setLoadingMsg] = useState(t.loadingTemplate)
  const [errorMsg, setErrorMsg] = useState(null)
  const [thumbnails, setThumbnails] = useState([])
  const [activePage, setActivePage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const [pdfDoc, setPdfDoc] = useState(null)
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null)
  const [pageImages, setPageImages] = useState([])
  const [zoom, setZoom] = useState(1)
  const [renderingPages, setRenderingPages] = useState(false)
  const [pageInput, setPageInput] = useState('1')

  const [searchTerm, setSearchTerm] = useState('')
  const [searchHits, setSearchHits] = useState([])
  const [searchIndex, setSearchIndex] = useState(-1)
  const [textIndex, setTextIndex] = useState([])
  const searchMatcher = useMemo(() => createSearchMatcher(searchTerm), [searchTerm])

  const blobUrlRef = useRef(null)
  const thumbUrlsRef = useRef([])
  const sessionIdRef = useRef(null)
  const deletedSessionIdsRef = useRef(new Set())
  const pdfBlobUrlRef = useRef(null)
  const pageImageUrlsRef = useRef([])
  const canvasRefs = useRef([])
  const renderTasksRef = useRef(new Map())
  const renderPassRef = useRef(0)
  const pageRefs = useRef([])
  const thumbItemRefs = useRef([])
  const scrollRef = useRef(null)
  const viewerPaneRef = useRef(null)
  const onCloseRef = useRef(onClose)

  const [basePageSize, setBasePageSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const safeDeleteViewerSession = useCallback((sessionId) => {
    if (!sessionId) return
    if (deletedSessionIdsRef.current.has(sessionId)) return
    deletedSessionIdsRef.current.add(sessionId)
    deleteViewerSession(sessionId)
  }, [])

  useEffect(() => {
    return () => {
      renderTasksRef.current.forEach((task) => {
        try { task?.cancel?.() } catch {}
      })
      renderTasksRef.current.clear()
      if (sessionIdRef.current) {
        safeDeleteViewerSession(sessionIdRef.current)
      }
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
      if (pdfBlobUrlRef.current) URL.revokeObjectURL(pdfBlobUrlRef.current)
      pageImageUrlsRef.current.forEach((u) => {
        if (u?.startsWith('blob:')) URL.revokeObjectURL(u)
      })
      pageImageUrlsRef.current = []
      thumbUrlsRef.current.forEach((u) => {
        if (u?.startsWith('blob:')) URL.revokeObjectURL(u)
      })
    }
  }, [safeDeleteViewerSession])

  const goToPage = useCallback((page, behavior = 'smooth') => {
    if (page < 1 || (pageCount > 0 && page > pageCount)) return
    setActivePage(page)
    setPageInput(String(page))
    const node = pageRefs.current[page - 1]
    if (node) {
      node.scrollIntoView({ behavior, block: 'start' })
    }
  }, [pageCount])

  const applyFitWidth = useCallback(() => {
    if (!basePageSize.width || !viewerPaneRef.current) return
    const width = viewerPaneRef.current.clientWidth - 32
    const nextZoom = Math.max(0.5, Math.min(3, width / basePageSize.width))
    setZoom(nextZoom)
  }, [basePageSize.width])

  const applyFitPage = useCallback(() => {
    if (!basePageSize.width || !basePageSize.height || !viewerPaneRef.current) return
    const width = viewerPaneRef.current.clientWidth - 32
    const height = viewerPaneRef.current.clientHeight - 32
    const byWidth = width / basePageSize.width
    const byHeight = height / basePageSize.height
    const nextZoom = Math.max(0.5, Math.min(3, Math.min(byWidth, byHeight)))
    setZoom(nextZoom)
  }, [basePageSize.height, basePageSize.width])

  const exportPdf = useCallback(async () => {
    const safeName = templateName?.split('/').pop()?.replace('.mrt', '.pdf') ?? 'relatorio.pdf'
    setExporting(true)
    try {
      if (!pdfBlobUrl) throw new Error('PDF da etiqueta ainda nao foi gerado.')
      const res = await fetch(pdfBlobUrl)
      if (!res.ok) throw new Error(`Falha ao obter PDF (HTTP ${res.status})`)
      triggerDownload(await res.blob(), safeName)
    } catch (e) {
      console.error('[StiLabelViewer] export error:', e)
      setErrorMsg(e?.message || String(e))
    } finally {
      setExporting(false)
    }
  }, [pdfBlobUrl, templateName])

  const printPdf = useCallback(() => {
    try {
      if (!pdfBlobUrl) throw new Error('PDF da etiqueta ainda nao foi gerado.')
      const win = window.open(pdfBlobUrl, '_blank')
      if (win) {
        win.onload = () => {
          win.focus()
          win.print()
        }
      }
    } catch (e) {
      console.error('[StiLabelViewer] print error:', e)
      setErrorMsg(e?.message || String(e))
    }
  }, [pdfBlobUrl])

  useEffect(() => {
    if (!templateName || !xmlData) return
    let cancelled = false

    const run = async () => {
      try {
        setLoading(true)
        setErrorMsg(null)
        setThumbnails([])
        thumbUrlsRef.current = []
        setActivePage(1)
        setPageInput('1')
        setPageCount(0)
        setPdfDoc(null)
        setPageImages([])
        setBasePageSize({ width: 0, height: 0 })
        setTextIndex([])
        setSearchHits([])
        setSearchIndex(-1)
        if (sessionIdRef.current) {
          safeDeleteViewerSession(sessionIdRef.current)
          sessionIdRef.current = null
        }
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current)
          blobUrlRef.current = null
        }
        if (pdfBlobUrlRef.current) {
          URL.revokeObjectURL(pdfBlobUrlRef.current)
          pdfBlobUrlRef.current = null
          setPdfBlobUrl(null)
        }
        pageImageUrlsRef.current.forEach((u) => {
          if (u?.startsWith('blob:')) URL.revokeObjectURL(u)
        })
        pageImageUrlsRef.current = []

        setLoadingMsg(t.loadingTemplateAndData)
        const mrtContent = await fetchMrtContent(templateName)
        if (cancelled) return

        const data = xmlData || '<DATASET/>'

        setLoadingMsg(t.sendingToPrint)
        const pdfBuffer = await renderPdf(mrtContent, data)
        if (cancelled) return

        const pdfBlob = new Blob([pdfBuffer], { type: 'application/pdf' })

        if (mode === 'PRINT') {
          const blobUrl = URL.createObjectURL(pdfBlob)
          blobUrlRef.current = blobUrl

          const win = window.open(blobUrl, '_blank')
          if (win) {
            win.onload = () => {
              win.focus()
              win.print()
            }
          } else {
            const safeName = templateName.split('/').pop()?.replace('.mrt', '.pdf') ?? 'relatorio.pdf'
            triggerDownload(pdfBlob, safeName)
          }
          setLoading(false)
          setTimeout(() => onCloseRef.current?.(), 1200)
          return
        }

        const localPdfUrl = URL.createObjectURL(pdfBlob)
        pdfBlobUrlRef.current = localPdfUrl
        setPdfBlobUrl(localPdfUrl)

        const loadingTask = getDocument({ data: new Uint8Array(pdfBuffer) })
        const doc = await loadingTask.promise
        if (cancelled) {
          await doc.destroy()
          return
        }

        setPdfDoc(doc)
        setPageCount(doc.numPages)

        const firstPage = await doc.getPage(1)
        const firstViewport = firstPage.getViewport({ scale: 1 })
        setBasePageSize({ width: firstViewport.width, height: firstViewport.height })
        setLoading(false)

        const thumbs = []
        for (let page = 1; page <= doc.numPages; page += 1) {
          if (cancelled) return
          const pdfPage = await doc.getPage(page)
          const viewport = pdfPage.getViewport({ scale: 0.22 })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          const context = canvas.getContext('2d')
          if (!context) continue
          await pdfPage.render({ canvasContext: context, viewport }).promise
          thumbs.push(canvas.toDataURL('image/jpeg', 0.72))
          if (!cancelled) {
            const next = [...thumbs]
            thumbUrlsRef.current = next
            setThumbnails(next)
          }
        }
      } catch (e) {
        if (cancelled) return
        console.error('[StiLabelViewer] error:', e)
        setLoading(false)
        setErrorMsg(e?.message || String(e))
      }
    }

    run()
    return () => { cancelled = true }
  }, [xmlData, templateName, mode, isEtiqueta, safeDeleteViewerSession, t.loadingTemplateAndData, t.sendingToPrint])

  useEffect(() => {
    if (!pdfDoc || pageCount <= 0) return
    let cancelled = false

    const buildTextIndex = async () => {
      const values = []
      for (let page = 1; page <= pageCount; page += 1) {
        if (cancelled) return
        const pdfPage = await pdfDoc.getPage(page)
        const textContent = await pdfPage.getTextContent()
        const content = textContent.items
          .map((item) => (typeof item.str === 'string' ? item.str : ''))
          .join(' ')
          .toLowerCase()
        values.push({ content, items: textContent.items })
      }
      if (!cancelled) setTextIndex(values)
    }

    buildTextIndex()
    return () => { cancelled = true }
  }, [pdfDoc, pageCount, isEtiqueta])

  useEffect(() => {
    if (!pdfDoc || pageCount <= 0) return
    let cancelled = false

    const renderAllPages = async () => {
      const passId = renderPassRef.current + 1
      renderPassRef.current = passId
      setRenderingPages(true)
      for (let page = 1; page <= pageCount; page += 1) {
        if (cancelled || renderPassRef.current !== passId) return
        const canvas = canvasRefs.current[page - 1]
        if (!canvas) continue

        const previousTask = renderTasksRef.current.get(page)
        if (previousTask) {
          previousTask.cancel()
          try {
            await previousTask.promise
          } catch (e) {
            if (e?.name !== 'RenderingCancelledException') throw e
          } finally {
            if (renderTasksRef.current.get(page) === previousTask) {
              renderTasksRef.current.delete(page)
            }
          }
        }

        const pdfPage = await pdfDoc.getPage(page)
        if (cancelled || renderPassRef.current !== passId) return
        const viewport = pdfPage.getViewport({ scale: zoom })
        const ratio = window.devicePixelRatio || 1
        const context = canvas.getContext('2d')
        if (!context) continue

        canvas.width = Math.floor(viewport.width * ratio)
        canvas.height = Math.floor(viewport.height * ratio)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`

        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        const renderTask = pdfPage.render({ canvasContext: context, viewport })
        renderTasksRef.current.set(page, renderTask)

        try {
          await renderTask.promise
        } catch (e) {
          if (e?.name === 'RenderingCancelledException') continue
          throw e
        } finally {
          if (renderTasksRef.current.get(page) === renderTask) {
            renderTasksRef.current.delete(page)
          }
        }

        if (cancelled || renderPassRef.current !== passId) return

        const pageTextItems = textIndex[page - 1]?.items || []
        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        drawSearchHighlights(context, pageTextItems, viewport, searchMatcher)
      }
      if (!cancelled && renderPassRef.current === passId) setRenderingPages(false)
    }

    renderAllPages().catch((e) => {
      if (!cancelled) {
        console.error('[StiLabelViewer] render pages error:', e)
        setErrorMsg(e?.message || String(e))
        setRenderingPages(false)
      }
    })

    return () => {
      cancelled = true
      renderTasksRef.current.forEach((task) => {
        try { task?.cancel?.() } catch {}
      })
    }
  }, [pageCount, pdfDoc, searchMatcher, textIndex, zoom, isEtiqueta])

  useEffect(() => {
    if (!scrollRef.current || pageCount <= 0) return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        let best = null
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          if (!best || entry.intersectionRatio > best.intersectionRatio) best = entry
        }
        if (!best) return
        const page = Number(best.target.getAttribute('data-page'))
        if (!Number.isFinite(page)) return
        setActivePage((prev) => {
          if (prev !== page) {
            setPageInput(String(page))
          }
          return page
        })
      },
      {
        root: scrollRef.current,
        threshold: [0.35, 0.6, 0.8],
      }
    )

    pageRefs.current.forEach((node) => {
      if (node) observer.observe(node)
    })

    return () => observer.disconnect()
  }, [pageCount])

  useEffect(() => {
    const activeThumb = thumbItemRefs.current[activePage - 1]
    if (activeThumb) {
      activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [activePage])

  const runSearch = useCallback(() => {
    if (!searchMatcher || textIndex.length === 0) {
      setSearchHits([])
      setSearchIndex(-1)
      return
    }
    const hits = []
    textIndex.forEach((entry, idx) => {
      const items = entry?.items || []
      const count = items.reduce((sum, item) => sum + searchMatcher.count(item?.str || ''), 0)
      if (count > 0) hits.push({ page: idx + 1, count })
    })

    setSearchHits(hits)
    if (hits.length > 0) {
      setSearchIndex(0)
      goToPage(hits[0].page)
    } else {
      setSearchIndex(-1)
    }
  }, [goToPage, searchMatcher, textIndex])

  const nextSearchHit = useCallback(() => {
    if (searchHits.length === 0) return
    const next = (searchIndex + 1) % searchHits.length
    setSearchIndex(next)
    goToPage(searchHits[next].page)
  }, [goToPage, searchHits, searchIndex])

  const prevSearchHit = useCallback(() => {
    if (searchHits.length === 0) return
    const prev = (searchIndex - 1 + searchHits.length) % searchHits.length
    setSearchIndex(prev)
    goToPage(searchHits[prev].page)
  }, [goToPage, searchHits, searchIndex])

  const totalSearchMatches = useMemo(
    () => searchHits.reduce((sum, item) => sum + item.count, 0),
    [searchHits]
  )

  const bg = isDark ? '#0d1117' : '#f1f3f5'
  const border = isDark ? '#252d3a' : '#dde1e6'
  const textMuted = isDark ? '#777' : '#666'
  const toolbarButtonColor = isDark ? '#d3dae4' : '#3f4854'
  const toolbarOutlinedButtonSx = {
    textTransform: 'none',
    fontSize: 11,
    color: toolbarButtonColor,
    borderColor: border,
    '&:hover': {
      borderColor: Brand.green,
      color: Brand.green,
      bgcolor: alpha(Brand.green, 0.08),
    },
  }

  if (mode === 'PRINT') {
    return (
      <Box sx={{ p: 3, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        {loading && !errorMsg && (
          <>
            <CircularProgress size={24} sx={{ color: Brand.green }} />
            <Typography sx={{ fontSize: 12, color: isDark ? '#888' : '#666' }}>{loadingMsg}</Typography>
          </>
        )}
        {errorMsg && (
          <>
            <WarningAmberIcon sx={{ color: '#f44336', fontSize: 32 }} />
            <Typography sx={{ fontSize: 12, color: '#f44336', maxWidth: 300, textAlign: 'center' }}>{errorMsg}</Typography>
            {onClose && (
              <Button size="small" onClick={onClose} sx={{ textTransform: 'none', fontSize: 12 }}>{tc.close}</Button>
            )}
          </>
        )}
        {!loading && !errorMsg && (
          <Typography sx={{ fontSize: 13, color: isDark ? '#aaa' : '#666' }}>{t.printSent}</Typography>
        )}
      </Box>
    )
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: isFullscreen ? '100vh' : '100%',
        width: isFullscreen ? '100vw' : '100%',
        minHeight: 0,
        bgcolor: bg,
        position: isFullscreen ? 'fixed' : 'relative',
        top: isFullscreen ? 0 : 'auto',
        left: isFullscreen ? 0 : 'auto',
        zIndex: isFullscreen ? 9999 : 'auto',
        overflow: 'hidden',
      }}
    >
      {!loading && !errorMsg && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1,
            py: 1,
            borderBottom: `1px solid ${border}`,
            bgcolor: isDark ? '#0f1318' : '#fafafa',
            flexWrap: 'wrap',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Tooltip title={t.prevPage || 'Pagina anterior'}>
              <span>
                <IconButton size="small" onClick={() => goToPage(activePage - 1)} disabled={activePage <= 1}>
                  <NavigateBeforeIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>

            <TextField
              size="small"
              value={pageInput ?? ''}
              onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={() => goToPage(Number(pageInput || activePage), 'auto')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  goToPage(Number(pageInput || activePage), 'smooth')
                }
              }}
              sx={{ width: 72 }}
            />
            <Typography sx={{ fontSize: 12, color: textMuted }}>/ {pageCount || '-'}</Typography>

            <Tooltip title={t.nextPage || 'Proxima pagina'}>
              <span>
                <IconButton size="small" onClick={() => goToPage(activePage + 1)} disabled={activePage >= pageCount}>
                  <NavigateNextIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Tooltip title={t.zoomOut || 'Reduzir zoom'}>
              <span>
                <IconButton size="small" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))}>
                  <ZoomOutIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>

            <Select
              size="small"
              value={Number.isFinite(zoom) ? zoom : 1}
              onChange={(e) => setZoom(Number(e.target.value))}
              sx={{ minWidth: 104, fontSize: 12 }}
            >
              {ZOOM_PRESETS.map((z) => (
                <MenuItem key={z} value={z}>{Math.round(z * 100)}%</MenuItem>
              ))}
            </Select>

            <Tooltip title={t.zoomIn || 'Aumentar zoom'}>
              <span>
                <IconButton size="small" onClick={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))}>
                  <ZoomInIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>

            <Button size="small" variant="outlined" onClick={applyFitWidth} sx={toolbarOutlinedButtonSx}>
              {t.fitWidth || 'Ajustar largura'}
            </Button>
            <Button size="small" variant="outlined" onClick={applyFitPage} sx={toolbarOutlinedButtonSx}>
              {t.fitPage || 'Ajustar pagina'}
            </Button>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: { xs: 0, md: 1 } }}>
            <TextField
              size="small"
              placeholder={t.search || 'Pesquisar'}
              value={searchTerm ?? ''}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runSearch()
              }}
              sx={{ minWidth: 170 }}
              InputProps={{
                startAdornment: <SearchIcon sx={{ fontSize: 16, color: textMuted, mr: 0.5 }} />,
              }}
            />
            <Button size="small" variant="outlined" onClick={runSearch} sx={toolbarOutlinedButtonSx}>
              {t.search || 'Buscar'}
            </Button>
            <Tooltip title={t.prevResult || 'Resultado anterior'}>
              <span>
                <IconButton size="small" onClick={prevSearchHit} disabled={searchHits.length === 0}>
                  <NavigateBeforeIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t.nextResult || 'Proximo resultado'}>
              <span>
                <IconButton size="small" onClick={nextSearchHit} disabled={searchHits.length === 0}>
                  <NavigateNextIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Typography sx={{ fontSize: 11, color: textMuted }}>
              {searchHits.length > 0
                ? `${searchIndex + 1}/${searchHits.length} (${totalSearchMatches})`
                : (searchTerm ? (t.noResults || 'Sem resultados') : '')}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 'auto' }}>
            <Button
              size="small"
              variant="outlined"
              onClick={printPdf}
              startIcon={<LocalPrintshopIcon fontSize="small" />}
              sx={toolbarOutlinedButtonSx}
            >
              {t.print || 'Imprimir'}
            </Button>

            <Button
              size="small"
              variant="outlined"
              data-no-btn-style="true"
              disabled={exporting}
              onClick={exportPdf}
              startIcon={exporting ? <CircularProgress size={12} /> : <SaveIcon fontSize="small" />}
              sx={{
                textTransform: 'none',
                fontSize: 11,
                borderColor: '#F59C00',
                color: '#F59C00',
                '&:hover': { borderColor: '#e08e00', bgcolor: 'rgba(245,156,0,0.06)' },
              }}
            >
              {t.save || 'Salvar'}
            </Button>

            {showInterfaceExport && onExport && (
              <Button
                size="small"
                variant="contained"
                data-no-btn-style="true"
                onClick={onExport}
                startIcon={<GetAppIcon fontSize="small" />}
                sx={{
                  textTransform: 'none',
                  fontSize: 11,
                  fontWeight: 700,
                  bgcolor: '#f59e0b',
                  color: '#1f1300',
                  '&:hover': { bgcolor: '#d97706' },
                  borderRadius: 1.5,
                }}
              >
                {t.export || 'Exportar'}
              </Button>
            )}

            <Button
              size="small"
              variant="outlined"
              data-no-btn-style="true"
              onClick={() => setIsFullscreen(!isFullscreen)}
              startIcon={isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
              sx={{
                textTransform: 'none',
                fontSize: 12,
                borderColor: border,
                color: isDark ? '#d3dae4' : '#3f4854',
                '&:hover': { borderColor: Brand.green, color: Brand.green },
              }}
            >
              {isFullscreen ? (t.restore || 'Restaurar') : (t.expand || 'Expandir')}
            </Button>

            {onClose && (
              <IconButton
                size="small"
                onClick={onClose}
                sx={{ color: isDark ? '#8a95a3' : '#888', '&:hover': { color: '#f44336', bgcolor: 'rgba(244,67,54,0.08)' } }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            )}
          </Box>
        </Box>
      )}

      {loading && !errorMsg && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 20,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2.5,
            bgcolor: isDark ? '#0d1117' : '#f1f3f5',
          }}
        >
          <CircularProgress size={36} sx={{ color: Brand.green }} />
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
            <Typography
              sx={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: isDark ? '#8a95a3' : '#666',
              }}
            >
              {loadingMsg}
            </Typography>
            <Typography sx={{ fontSize: 11, color: textMuted }}>{t.mayTakeSeconds}</Typography>
          </Box>
        </Box>
      )}

      {errorMsg && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 20,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            p: 4,
            bgcolor: isDark ? '#0d1117' : '#f1f3f5',
          }}
        >
          <WarningAmberIcon sx={{ color: '#f44336', fontSize: 44 }} />
          <Typography sx={{ fontSize: 14, fontWeight: 700, color: '#f44336' }}>{t.errorTitle}</Typography>
          <Box
            component="pre"
            sx={{
              fontSize: 11,
              color: isDark ? '#8a95a3' : '#555',
              bgcolor: isDark ? '#141820' : '#fff',
              border: `1px solid ${border}`,
              borderRadius: 1,
              p: 2,
              maxWidth: 540,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {errorMsg}
          </Box>
          {onClose && (
            <Button
              size="small"
              onClick={onClose}
              variant="outlined"
              sx={{ textTransform: 'none', fontSize: 13, borderColor: border, color: isDark ? '#ccc' : '#555' }}
            >
              {tc.close}
            </Button>
          )}
        </Box>
      )}

      {(thumbnails.length > 0 || pageCount > 0 || pdfDoc || pageImages.length > 0) && (
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
          {showSidebar && pageCount >= 1 && (
            <Box
              sx={{
                width: 160,
                flexShrink: 0,
                bgcolor: isDark ? '#0b0e14' : '#f4f4f6',
                borderRight: `1px solid ${border}`,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                py: 1.5,
                px: 1,
                '&::-webkit-scrollbar': { width: 4 },
                '&::-webkit-scrollbar-thumb': { bgcolor: isDark ? '#2a3040' : '#d0d5dd', borderRadius: 2 },
                '&::-webkit-scrollbar-thumb:hover': { bgcolor: Brand.green },
              }}
            >
              <Typography
                sx={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: textMuted,
                  px: 0.5,
                  mb: 0.5,
                }}
              >
                {t.pages}
              </Typography>

              {pageCount > 0 && thumbnails.length < pageCount &&
                Array.from({ length: pageCount }).map((_, i) => {
                  const thumb = thumbnails[i]
                  return thumb ? null : (
                    <Box
                      key={`skel-${i + 1}`}
                      sx={{
                        width: '100%',
                        aspectRatio: '3/4',
                        bgcolor: isDark ? '#1a2030' : '#e8eaed',
                        borderRadius: 1,
                        border: `1px solid ${border}`,
                        position: 'relative',
                        overflow: 'hidden',
                        '&::after': {
                          content: '""',
                          position: 'absolute',
                          inset: 0,
                          background: isDark
                            ? 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)'
                            : 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.6) 50%, transparent 100%)',
                          animation: 'shimmer 1.6s infinite',
                          backgroundSize: '200% 100%',
                        },
                        '@keyframes shimmer': {
                          '0%': { backgroundPosition: '-200% 0' },
                          '100%': { backgroundPosition: '200% 0' },
                        },
                      }}
                    />
                  )
                })}

              {thumbnails.map((thumbUrl, i) => {
                const page = i + 1
                const isActive = activePage === page
                return (
                  <Box
                    key={page}
                    ref={(el) => { thumbItemRefs.current[i] = el }}
                    onClick={() => goToPage(page)}
                    sx={{
                      width: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 0.75,
                      p: 0.75,
                      borderRadius: 1,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      transform: isActive ? 'scale(1.02)' : 'scale(1)',
                      outline: isActive ? `2px solid ${Brand.green}` : '2px solid transparent',
                      outlineOffset: 1,
                      bgcolor: isActive
                        ? (isDark ? 'rgba(0,166,81,0.1)' : 'rgba(0,166,81,0.06)')
                        : 'transparent',
                      '&:hover': {
                        bgcolor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
                        outline: isActive ? `2px solid ${Brand.green}` : `2px solid ${isDark ? '#3a4558' : '#c8cdd5'}`,
                      },
                    }}
                  >
                    <Box
                      component="img"
                      src={thumbUrl}
                      alt={`${t.page} ${page}`}
                      draggable={false}
                      sx={{ width: '100%', borderRadius: 0.5, boxShadow: '0 2px 6px rgba(0,0,0,0.25)' }}
                    />
                    <Typography sx={{ fontSize: 9, fontWeight: 700, color: isActive ? Brand.green : textMuted }}>
                      {page}
                    </Typography>
                  </Box>
                )
              })}
            </Box>
          )}

          <Box ref={viewerPaneRef} sx={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
            {renderingPages && (
              <Box
                sx={{
                  position: 'absolute',
                  top: 8,
                  right: 12,
                  zIndex: 2,
                  px: 1,
                  py: 0.5,
                  borderRadius: 1,
                  bgcolor: isDark ? 'rgba(20,24,32,0.8)' : 'rgba(255,255,255,0.85)',
                  border: `1px solid ${border}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                }}
              >
                <CircularProgress size={14} sx={{ color: Brand.green }} />
                <Typography sx={{ fontSize: 11, color: textMuted }}>{t.renderingLabels || 'Renderizando...'}</Typography>
              </Box>
            )}

            <Box
              ref={scrollRef}
              sx={{
                height: '100%',
                overflowY: 'auto',
                px: 2,
                py: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                alignItems: 'center',
                '&::-webkit-scrollbar': { width: 8 },
                '&::-webkit-scrollbar-thumb': { bgcolor: isDark ? '#2a3040' : '#d0d5dd', borderRadius: 2 },
              }}
            >
              {Array.from({ length: pageCount }).map((_, idx) => {
                const page = idx + 1
                const hit = searchHits.find((h) => h.page === page)
                const isSearchTarget = searchIndex >= 0 && searchHits[searchIndex]?.page === page
                return (
                  <Box
                    key={`pdf-page-${page}`}
                    data-page={page}
                    ref={(el) => { pageRefs.current[idx] = el }}
                    sx={{
                      width: 'fit-content',
                      border: `1px solid ${isSearchTarget ? Brand.green : border}`,
                      borderRadius: 1,
                      background: '#fff',
                      p: 1,
                      boxShadow: isSearchTarget ? '0 0 0 2px rgba(0,166,81,0.15)' : '0 4px 14px rgba(0,0,0,0.15)',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <canvas ref={(el) => { canvasRefs.current[idx] = el }} />
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.75 }}>
                      <Typography sx={{ fontSize: 10, color: '#6b7280' }}>{t.page || 'Pagina'} {page}</Typography>
                      {hit ? (
                        <Typography sx={{ fontSize: 10, color: Brand.green, fontWeight: 700 }}>
                          {hit.count} {t.matches || 'ocorrencias'}
                        </Typography>
                      ) : null}
                    </Box>
                  </Box>
                )
              })}
            </Box>
          </Box>
        </Box>
      )}

      {!loading && !errorMsg && pageCount === 0 && (
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography sx={{ fontSize: 12, color: textMuted }}>{t.noPages || 'Nenhuma pagina para exibir.'}</Typography>
        </Box>
      )}
    </Box>
  )
}
