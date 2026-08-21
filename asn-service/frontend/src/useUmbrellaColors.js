/**
 * useUmbrellaColors.js
 * ─────────────────────
 * Hook que resolve as cores ativas do Umbrella para o ASN Service.
 *
 * Fontes (ordem de prioridade, da mais alta para a mais baixa):
 *  1. Query string: ?primaria=%2300A651&secundaria=%2300D084&theme=dark
 *     (passadas pelo monolito swpaas/GateVirtual ao montar o iframe)
 *  2. postMessage do parent window com type='UMBRELLA_THEME'
 *     (para atualizações em tempo real sem recarregar o iframe)
 *  3. Fallback: Brand.green padrão (standalone, sem monolito)
 *
 * Retorna:
 *  { primary, secondary, theme, customColors }
 *
 * customColors é o shape { primaria, secundaria } compatível com
 * getTheme(mode, customColors) do theme.js.
 */
import { useState, useEffect } from 'react'
import { Brand } from './theme'

const PRIMARY_KEYS = ['primaria', 'corPrimaria', 'primary', 'primaryColor', 'cor_primaria']
const SECONDARY_KEYS = ['secundaria', 'corSecundaria', 'secondary', 'secondaryColor', 'cor_secundaria']
const THEME_KEYS = ['theme', 'mode_theme', 'modeTheme']

function readFirstParam(params, keys) {
  for (const key of keys) {
    const val = params.get(key)
    if (val != null && String(val).trim() !== '') return val
  }
  return null
}

function normalizeHex(value) {
  if (!value) return null

  let v = String(value).trim()
  if (!v) return null

  if (v.toLowerCase().startsWith('0x')) v = v.slice(2)
  if (!v.startsWith('#')) v = `#${v}`

  // Aceita apenas hex curto/normal para evitar cores inválidas no tema.
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : null
}

function normalizeTheme(value) {
  if (!value) return null
  const v = String(value).trim().toLowerCase()

  if (v === 'dark' || v === 'escuro') return 'dark'
  if (v === 'light' || v === 'claro') return 'light'
  return null
}

function readColorFromObject(obj, keys) {
  if (!obj || typeof obj !== 'object') return null
  for (const key of keys) {
    const val = obj[key]
    if (val != null && String(val).trim() !== '') return val
  }
  return null
}

/**
 * Lê os parâmetros de cor da query string.
 * Suporta tanto hex com '#' (encoded como %23) quanto sem.
 */
function parseColorsFromUrl() {
  const p = new URLSearchParams(window.location.search)
  const rawPrimaria = readFirstParam(p, PRIMARY_KEYS)
  const rawSecundaria = readFirstParam(p, SECONDARY_KEYS)
  const rawTheme = readFirstParam(p, THEME_KEYS)

  return {
    primaria: normalizeHex(rawPrimaria),
    secundaria: normalizeHex(rawSecundaria),
    theme: normalizeTheme(rawTheme),
  }
}

export function useUmbrellaColors() {
  const [colors, setColors] = useState(() => parseColorsFromUrl())

  // Escuta postMessage do parent window (monolito pode enviar UMBRELLA_THEME)
  // Isso permite atualizar o tema em tempo real sem recarregar o iframe
  useEffect(() => {
    const handler = (event) => {
      const data = event?.data || {}
      const type = data.type

      // Aceita mensagens de qualquer origin (o monolito pode ser de domínio diferente)
      if (type === 'UMBRELLA_THEME') {
        const primaria = normalizeHex(readColorFromObject(data, PRIMARY_KEYS))
        const secundaria = normalizeHex(readColorFromObject(data, SECONDARY_KEYS))
        const theme = normalizeTheme(readColorFromObject(data, THEME_KEYS))

        setColors(prev => ({
          primaria: primaria || prev.primaria,
          secundaria: secundaria || prev.secundaria,
          theme: theme || prev.theme,
        }))
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // Re-lê a URL se ela mudar (popstate)
  useEffect(() => {
    const handler = () => setColors(parseColorsFromUrl())
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])

  // Retorna customColors no shape esperado pelo getTheme()
  const customColors = (colors.primaria || colors.secundaria)
    ? { primaria: colors.primaria, secundaria: colors.secundaria }
    : null

  const primary   = colors.primaria   || Brand.green
  const secondary = colors.secundaria || Brand.greenBright
  const theme     = colors.theme      || null

  return { primary, secondary, theme, customColors }
}
