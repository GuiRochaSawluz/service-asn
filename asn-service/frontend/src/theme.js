/**
 * SWPaaS / Sawluz brand MUI theme generator.
 * Strictly following brand identity: Green (#00A651) and neutrals. NO blue.
 *
 * Key fix: MRT v2 overrides MUI theme with internal `sx` and inline styles.
 * The only reliable override is CSS injected via MuiCssBaseline with !important,
 * targeting the real rendered DOM selectors.
 */
import { createTheme, alpha } from '@mui/material/styles'

// ── Brand Colors ───────────────────────────────────────────────────────────────
export const Brand = {
  green:       '#00A651',
  greenBright: '#00D084',
  greenDark:   '#007A3B',
  red:         '#F44336',
  amber:       '#FFB300',
}

// ── Palette definitions per mode ──────────────────────────────────────────────
export const palettes = {
  dark: {
    bg:       '#0A0A0A',
    surface:  '#141414',
    card:     '#181818',
    cardAlt:  '#1F1F1F',
    border:   '#2A2A2A',
    hover:    '#2C3A2C',   // green-tinted hover
    input:    '#111111',
    text:     '#F0F0F0',
    textSub:  '#9E9E9E',
  },
  light: {
    bg:       '#F1F3F5',
    surface:  '#FFFFFF',
    card:     '#FFFFFF',
    cardAlt:  '#F5F7F5',
    border:   '#DEE2E6',
    hover:    '#EEF5EE',
    input:    '#FFFFFF',
    text:     '#1A1C1E',
    textSub:  '#495057',
  },
}

export const getTheme = (mode = 'dark', customColors = null) => {
  const p = palettes[mode]
  const isDark = mode === 'dark'

  const activeBrand = {
    ...Brand,
    green: customColors?.primaria || Brand.green,
    greenBright: customColors?.secundaria || Brand.greenBright,
    greenDark: customColors?.primaria || Brand.greenDark,
  }

  // Mutate the global Brand object so all components importing it directly
  // get the dynamic colors applied immediately.
  Brand.green = activeBrand.green;
  Brand.greenBright = activeBrand.greenBright;
  Brand.greenDark = activeBrand.greenDark;

  return createTheme({
    palette: {
      mode,
      primary:    { main: activeBrand.green, light: activeBrand.greenBright, dark: activeBrand.greenDark, contrastText: '#fff' },
      secondary:  { main: activeBrand.greenBright, contrastText: '#fff' },
      background: { default: p.bg, paper: p.card },
      divider:    p.border,
      text: {
        primary:   p.text,
        secondary: p.textSub,
        disabled:  isDark ? '#555555' : '#ADB5BD',
      },
      error:   { main: Brand.red },
      warning: { main: Brand.amber },
      success: { main: activeBrand.green },
      action: {
        hover:    isDark ? alpha(activeBrand.green, 0.12) : alpha(activeBrand.greenDark, 0.08),
        selected: isDark ? alpha(activeBrand.green, 0.20) : alpha(activeBrand.greenDark, 0.12),
      },
    },

    typography: {
      fontFamily: "'Inter', 'Roboto', sans-serif",
      fontSize: 13,
      button: { textTransform: 'none', fontWeight: 600 },
    },

    shape: { borderRadius: 4 },

    components: {
      // ── Global CSS — targets MRT's real rendered DOM selectors ─────────────
      MuiCssBaseline: {
        styleOverrides: `
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

          body {
            font-family: 'Inter', 'Roboto', sans-serif;
            overflow: hidden;
            background: ${p.bg};
            color: ${p.text};
            -webkit-font-smoothing: antialiased;
          }

          /* ── Scrollbar ── */
          ::-webkit-scrollbar { width: 6px; height: 6px; }
          ::-webkit-scrollbar-track  { background: ${p.bg}; }
          ::-webkit-scrollbar-thumb  { background: ${p.border}; border-radius: 3px; }
          ::-webkit-scrollbar-thumb:hover { background: ${activeBrand.green}; }

          @keyframes spin { to { transform: rotate(360deg); } }

          /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
             MRT DARK MODE NUCLEAR OVERRIDE
             MRT v2 injects its own sx on Paper, TableContainer, etc.
             These CSS rules use specificity + !important to win.
          ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

          /* Paper / Card wrappers that MRT owns */
          .MuiPaper-root {
            background-color: ${p.card} !important;
            background-image: none !important;
            color: ${p.text} !important;
          }

          /* Table container (white background culprit) */
          .MuiTableContainer-root {
            background-color: ${p.card} !important;
          }

          /* Body rows - Zebra striping (overridable by customization CSS vars) */
          .MuiTableBody-root .MuiTableRow-root:nth-of-type(odd) {
            background-color: var(--grid-stripe-odd, ${p.card}) !important;
          }
          .MuiTableBody-root .MuiTableRow-root:nth-of-type(even) {
            background-color: var(--grid-stripe-even, ${p.cardAlt}) !important;
          }
          .MuiTableBody-root .MuiTableRow-root:hover {
            background-color: var(--grid-hover, ${p.hover}) !important;
          }
          /* Selected row highlight */
          .MuiTableBody-root .MuiTableRow-root.Mui-selected {
            background-color: ${isDark ? alpha(activeBrand.green, 0.18) : alpha(activeBrand.greenDark, 0.1)} !important;
          }
          .MuiTableBody-root .MuiTableRow-root.Mui-selected:hover {
            background-color: ${isDark ? alpha(activeBrand.green, 0.25) : alpha(activeBrand.greenDark, 0.15)} !important;
          }

          /* Body cells — the main legibility fix */
          .MuiTableBody-root .MuiTableCell-root {
            color: ${p.text} !important;
            background-color: transparent !important;
            border-bottom-color: var(--grid-border, ${p.border}) !important;
            font-size: var(--grid-cell-text, 12.5px) !important;
            padding: var(--grid-cell-py, 7px) 12px !important;
          }

          /* Filter row text inputs */
          .MuiTableCell-root .MuiInputBase-input {
            color: ${p.text} !important;
            font-size: 12px !important;
          }
          .MuiTableCell-root .MuiInputBase-root {
            background: ${p.input} !important;
          }

          /* Toolbar areas */
          .MuiToolbar-root {
            background-color: ${p.surface} !important;
            color: ${p.text} !important;
          }

          /* Select / Pagination text */
          .MuiSelect-select, .MuiTablePagination-displayedRows,
          .MuiTablePagination-selectLabel, .MuiMenuItem-root {
            color: ${p.text} !important;
          }
          .MuiMenu-paper, .MuiPopover-paper {
            background-color: ${p.surface} !important;
            color: ${p.text} !important;
          }

          /* Column header ── Corporate Gray (SWPaaS legacy style) ── */
          .MuiTableHead-root .MuiTableCell-root,
          .MuiTableHead-root .MuiTableCell-head {
            background-color: var(--grid-header-bg, ${isDark ? '#232323' : '#E4E6E8'}) !important;
            color: ${isDark ? '#D0D0D0' : '#2D2D2D'} !important;
            font-weight: 700 !important;
            font-size: 11px !important;
            text-transform: uppercase !important;
            letter-spacing: 0.6px !important;
            border-bottom: 2px solid ${activeBrand.green} !important;
            border-right: 1px solid ${isDark ? '#3A3A3A' : '#C8CACC'} !important;
          }

          /* MRT drag handle + sort icons in header */
          .MuiTableHead-root .MuiTableCell-root svg,
          .MuiTableHead-root .MuiTableCell-root button {
            color: ${isDark ? 'rgba(200,200,200,0.9)' : 'rgba(60,60,60,0.8)'} !important;
          }
          .MuiTableHead-root .MuiTableCell-root button:hover {
            color: ${isDark ? '#FFFFFF' : '#000000'} !important;
            background: ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'} !important;
          }

          /* Filter row below header */
          .MuiTableHead-root .MuiTableCell-root .MuiInputBase-input {
            color: ${isDark ? '#E0E0E0' : '#1A1C1E'} !important;
            font-size: 11.5px !important;
          }
          .MuiTableHead-root .MuiTableCell-root .MuiInputBase-root {
            background: ${isDark ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.9)'} !important;
          }
          .MuiTableHead-root .MuiTableCell-root fieldset {
            border-color: ${isDark ? 'rgba(255,255,255,0.15)' : '#BBBBBB'} !important;
          }

          /* Checkbox color in selection column */
          .MuiCheckbox-root { color: ${isDark ? '#555' : '#BDBDBD'} !important; }
          .MuiCheckbox-root.Mui-checked,
          .MuiCheckbox-root.MuiCheckbox-indeterminate { color: ${activeBrand.green} !important; }

        `,
      },

      // ── Paper — dark surface + no gradient overlay ─────────────────────────
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            ...(isDark && {
              backgroundColor: p.card,
              color: p.text,
            }),
          },
        },
      },

      // ── Menu / Popover — the column-visibility panel and any dropdowns ──────
      MuiMenu: {
        styleOverrides: {
          paper: {
            backgroundColor: isDark ? '#171d22' : '#fff',
            color: p.text,
            border: `1px solid ${p.border}`,
            boxShadow: isDark
              ? '0 8px 32px rgba(0,0,0,0.6)'
              : '0 4px 20px rgba(0,0,0,0.12)',
          },
          list: {
            color: p.text,
            padding: '4px 0',
          },
        },
      },
      MuiPopover: {
        styleOverrides: {
          paper: {
            backgroundColor: isDark ? '#171d22' : '#fff',
            color: p.text,
            border: `1px solid ${p.border}`,
            boxShadow: isDark
              ? '0 8px 32px rgba(0,0,0,0.6)'
              : '0 4px 20px rgba(0,0,0,0.12)',
          },
        },
      },

      // ── List items inside popovers (column name labels) ────────────────────
      MuiListItemText: {
        styleOverrides: {
          primary: {
            color: p.text,
            fontSize: 12.5,
            fontWeight: 500,
          },
          secondary: { color: p.textSub },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            color: p.text,
            '&:hover': {
              backgroundColor: isDark
                ? alpha(activeBrand.green, 0.1)
                : alpha(activeBrand.green, 0.06),
            },
          },
        },
      },

      // ── Switch in column picker — green when checked ────────────────────────
      MuiSwitch: {
        styleOverrides: {
          track: {
            backgroundColor: isDark ? '#444' : '#bdbdbd',
            opacity: 1,
          },
          thumb: {
            backgroundColor: isDark ? '#999' : '#fff',
          },
          switchBase: {
            '&.Mui-checked': {
              color: activeBrand.green,
              '& + .MuiSwitch-track': {
                backgroundColor: activeBrand.green,
                opacity: 0.5,
              },
            },
          },
        },
      },

      // ── MenuItem (pagination & filter dropdowns) ───────────────────────────
      MuiMenuItem: {
        styleOverrides: {
          root: {
            color: p.text,
            fontSize: 13,
            '&:hover': {
              backgroundColor: isDark
                ? alpha(activeBrand.green, 0.1)
                : alpha(activeBrand.green, 0.06),
            },
            '&.Mui-selected': {
              backgroundColor: isDark
                ? alpha(activeBrand.green, 0.18)
                : alpha(activeBrand.green, 0.1),
              color: isDark ? activeBrand.greenBright : activeBrand.greenDark,
            },
          },
        },
      },

      MuiTextField: {
        styleOverrides: {
          root: {
            '& .MuiInputBase-root': { background: p.input, fontSize: 12 },
            '& .MuiOutlinedInput-root': {
              '& fieldset': { borderColor: p.border },
              '&:hover fieldset': { borderColor: activeBrand.green },
              '&.Mui-focused fieldset': { borderColor: activeBrand.green },
            },
          },
        },
      },

      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 700, fontSize: 11, borderRadius: 4 },
          colorPrimary: {
            background: alpha(activeBrand.green, 0.15),
            color: isDark ? activeBrand.greenBright : activeBrand.greenDark,
            border: `1px solid ${alpha(activeBrand.green, 0.35)}`,
          },
        },
      },

      MuiIconButton: {
        styleOverrides: {
          root: {
            color: isDark ? '#A0A0A0' : '#495057',
            '&:hover': { color: activeBrand.greenBright, background: alpha(activeBrand.green, 0.1) },
          },
        },
      },

      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            background: isDark ? '#2A2A2A' : '#1A1C1E',
            color: '#FFF',
            fontSize: 12,
            border: `1px solid ${p.border}`,
          },
        },
      },
    },
  })
}

// ── Color Conversion Utilities (ported from GateVirtual colors.ts) ────────────

function hexToHslValues(hex) {
  hex = hex.replace(/^#/, '')
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
  if (hex.length !== 6) return null

  const r = parseInt(hex.substring(0, 2), 16) / 255
  const g = parseInt(hex.substring(2, 4), 16) / 255
  const b = parseInt(hex.substring(4, 6), 16) / 255

  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      case b: h = (r - g) / d + 4; break
    }
    h /= 6
  }
  return { h: h * 360, s: s * 100, l: l * 100 }
}

function getContrastColor(hex) {
  hex = hex.replace(/^#/, '')
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5 ? '#000000' : '#ffffff'
}

function clamp(val, min, max) { return Math.min(max, Math.max(min, val)) }

function hslToHex(h, s, l) {
  s /= 100; l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

function makeHsl(h, s, l) { return `hsl(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%)` }
function makeHsla(h, s, l, a) { return `hsla(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%, ${a})` }

function normalizeHex6(hex) {
  hex = hex.replace(/^#/, '')
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
  return `#${hex.substring(0, 6)}`
}

// ── Derived Palette Generator ──────────────────────────────────────────────────

/**
 * Generates ~40+ CSS custom properties from primary + secondary hex.
 * Ported from GateVirtual colors.ts generateDerivedPalette().
 *
 * @param {string} primaryHex
 * @param {string} secondaryHex
 * @param {boolean} isDark
 * @returns {Record<string, string>}
 */
export function generateDerivedPalette(primaryHex, secondaryHex, isDark) {
  const p = hexToHslValues(primaryHex)
  const s = hexToHslValues(secondaryHex)
  if (!p || !s) return {}

  const pHex6 = normalizeHex6(primaryHex)
  const sHex6 = normalizeHex6(secondaryHex)
  const pal = {}
  const bH = p.h, bS = Math.min(p.s, 55)

  // ── Grid Stripes ─────────────────────────────────────────
  pal['--grid-stripe-even'] = isDark
    ? `${pHex6}14` : makeHsla(p.h, bS * 0.75, 94, 1)
  pal['--grid-stripe-odd'] = isDark
    ? `${pHex6}26` : makeHsla(p.h, bS * 0.80, 88, 1)

  const sS = Math.min(s.s, 55)
  pal['--grid-stripe-secondary-even'] = isDark
    ? `${sHex6}14` : makeHsla(s.h, sS * 0.75, 94, 1)
  pal['--grid-stripe-secondary-odd'] = isDark
    ? `${sHex6}26` : makeHsla(s.h, sS * 0.80, 88, 1)

  pal['--grid-header-bg'] = isDark
    ? hslToHex(bH, bS * 0.65, 13) : hslToHex(bH, bS * 0.70, 90)
  pal['--grid-hover'] = isDark
    ? makeHsla(p.h, bS * 0.60, 22, 0.7) : makeHsla(p.h, bS * 0.65, 90, 1)
  pal['--grid-border'] = isDark
    ? hslToHex(bH, bS * 0.55, 20) : hslToHex(bH, bS * 0.55, 80)

  // ── Sidebar ──────────────────────────────────────────────
  pal['--sidebar-bg'] = isDark
    ? hslToHex(bH, bS * 0.70, 8) : hslToHex(bH, bS * 0.50, 97)
  pal['--sidebar-border'] = isDark
    ? hslToHex(bH, bS * 0.60, 15) : hslToHex(bH, bS * 0.55, 85)
  pal['--sidebar-hover'] = isDark
    ? hslToHex(bH, bS * 0.65, 13) : hslToHex(bH, bS * 0.65, 92)
  pal['--sidebar-active-bg'] = isDark
    ? makeHsla(p.h, Math.min(p.s, 75), 22, 0.75) : makeHsl(p.h, Math.min(p.s, 60), 88)

  // ── Header ───────────────────────────────────────────────
  pal['--header-bg'] = isDark
    ? makeHsla(bH, bS * 0.70, 8, 0.94) : makeHsla(bH, bS * 0.50, 97, 0.90)

  // ── Scrollbar ────────────────────────────────────────────
  pal['--scrollbar-track'] = isDark
    ? hslToHex(bH, bS * 0.55, 8) : hslToHex(bH, bS * 0.60, 92)
  pal['--scrollbar-thumb'] = isDark
    ? hslToHex(bH, bS * 0.55, 22) : hslToHex(bH, bS * 0.50, 68)
  pal['--scrollbar-thumb-hover'] = primaryHex

  // ── Button Variants ──────────────────────────────────────
  pal['--btn-primary-bg'] = makeHsl(p.h, p.s, isDark ? 50 : 48)
  pal['--btn-primary-hover'] = makeHsl(p.h, p.s, isDark ? 55 : 42)
  pal['--btn-primary-text'] = getContrastColor(hslToHex(p.h, p.s, isDark ? 50 : 48))
  pal['--btn-soft-bg'] = makeHsla(p.h, Math.min(p.s, 70), isDark ? 18 : 92, isDark ? 0.55 : 1)
  pal['--btn-soft-text'] = makeHsl(p.h, Math.min(p.s, 80), isDark ? 68 : 38)
  pal['--btn-outline-border'] = makeHsla(p.h, Math.min(p.s, 60), isDark ? 42 : 52, 0.6)
  pal['--btn-outline-text'] = makeHsl(p.h, Math.min(p.s, 80), isDark ? 68 : 38)

  // ── Brand Glow ───────────────────────────────────────────
  pal['--brand-glow'] = `0 4px 14px ${makeHsla(p.h, p.s, p.l, 0.25)}`

  // ── Spinner ──────────────────────────────────────────────
  pal['--spinner-color'] = makeHsl(p.h, p.s, isDark ? 55 : 45)

  return pal
}

// ── Grid Density DOM Application ───────────────────────────────────────────────

const DENSITY_MAP = {
  compact:     { py: '0.5rem',  text: '12px' },
  default:     { py: '1rem',    text: '13px' },
  comfortable: { py: '1.25rem', text: '14px' },
}

function applyGridDensityToDOM(density) {
  const d = DENSITY_MAP[density] || DENSITY_MAP.default
  document.documentElement.style.setProperty('--grid-cell-py', d.py)
  document.documentElement.style.setProperty('--grid-cell-text', d.text)
}

// ── Button Style DOM Application ───────────────────────────────────────────────

function applyButtonStyleToDOM(style, primaryHex, isDark) {
  const root = document.documentElement
  root.setAttribute('data-btn-style', style || 'filled')

  const p = hexToHslValues(primaryHex)
  if (!p) return

  switch (style) {
    case 'outline':
      root.style.setProperty('--btn-bg', 'transparent')
      root.style.setProperty('--btn-color', makeHsl(p.h, Math.min(p.s, 80), isDark ? 68 : 38))
      root.style.setProperty('--btn-border', makeHsla(p.h, Math.min(p.s, 60), isDark ? 42 : 52, 0.6))
      root.style.setProperty('--btn-hover-bg', makeHsla(p.h, Math.min(p.s, 60), isDark ? 20 : 92, isDark ? 0.3 : 1))
      break
    case 'soft':
      root.style.setProperty('--btn-bg', makeHsla(p.h, Math.min(p.s, 70), isDark ? 18 : 92, isDark ? 0.55 : 1))
      root.style.setProperty('--btn-color', makeHsl(p.h, Math.min(p.s, 80), isDark ? 68 : 38))
      root.style.setProperty('--btn-border', 'transparent')
      root.style.setProperty('--btn-hover-bg', makeHsla(p.h, Math.min(p.s, 70), isDark ? 24 : 88, isDark ? 0.65 : 1))
      break
    default: // filled
      root.style.setProperty('--btn-bg', makeHsl(p.h, p.s, isDark ? 50 : 48))
      root.style.setProperty('--btn-color', getContrastColor(hslToHex(p.h, p.s, isDark ? 50 : 48)))
      root.style.setProperty('--btn-border', 'transparent')
      root.style.setProperty('--btn-hover-bg', makeHsl(p.h, p.s, isDark ? 55 : 42))
      break
  }
}

// ── Master DOM Application ─────────────────────────────────────────────────────

/**
 * Applies ALL UI preferences to the DOM as CSS custom properties + data attributes.
 * Call this whenever preferences or colors change.
 *
 * @param {import('./useUIPreferences').UIPreferences} prefs
 * @param {string} primaryHex - Active primary color
 * @param {string} secondaryHex - Active secondary color
 * @param {boolean} isDark
 */
export function applyUIPreferencesToDOM(prefs, primaryHex, secondaryHex, isDark) {
  if (!prefs || !primaryHex) return
  const root = document.documentElement

  // 1. Generate and apply derived palette (sets both primary + secondary stripe vars)
  const palette = generateDerivedPalette(primaryHex, secondaryHex, isDark)
  for (const [prop, value] of Object.entries(palette)) {
    root.style.setProperty(prop, value)
  }

  // 2. Grid mode — swap stripe vars based on selected mode
  const gridMode = prefs.gridMode || 'striped-primary'
  root.setAttribute('data-grid-mode', gridMode)

  if (gridMode === 'striped-secondary') {
    // Swap: make the main stripe vars point to secondary colors
    root.style.setProperty('--grid-stripe-even', palette['--grid-stripe-secondary-even'] || 'transparent')
    root.style.setProperty('--grid-stripe-odd', palette['--grid-stripe-secondary-odd'] || 'transparent')
  } else if (gridMode === 'solid' || gridMode === 'bordered') {
    // No stripes — clear to transparent so MUI fallbacks also show transparent
    root.style.setProperty('--grid-stripe-even', 'transparent')
    root.style.setProperty('--grid-stripe-odd', 'transparent')
  }
  // striped-primary: uses the default --grid-stripe-even/odd from generateDerivedPalette (already set)

  // 3. Grid density
  applyGridDensityToDOM(prefs.gridDensity || 'default')

  // 4. Button style
  const btnStyle = prefs.areaOverrides?.buttonStyle || 'filled'
  applyButtonStyleToDOM(btnStyle, primaryHex, isDark)

  // 5. Area overrides
  if (prefs.areaOverrides?.sidebarBg) {
    root.style.setProperty('--sidebar-bg-override', prefs.areaOverrides.sidebarBg)
  } else {
    root.style.removeProperty('--sidebar-bg-override')
  }

  if (prefs.areaOverrides?.headerBg) {
    const opacity = (prefs.areaOverrides.headerOpacity ?? 88) / 100
    root.style.setProperty('--header-bg-override', prefs.areaOverrides.headerBg)
    root.style.setProperty('--header-bg-opacity', String(opacity))
  } else {
    root.style.removeProperty('--header-bg-override')
    root.style.removeProperty('--header-bg-opacity')
  }

  if (prefs.areaOverrides?.gridHeaderBg) {
    root.style.setProperty('--grid-header-bg', prefs.areaOverrides.gridHeaderBg)
  }
}
