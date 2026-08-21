import { Brand } from '../../theme'

/**
 * Hook ou helper para gerar as cores das Etiquetas baseado no modo (dark/light)
 * e permitindo sobrescrever cores para se adequar a outros sistemas (como GateVirtual).
 */
export function getEtiquetasTheme(mode = 'light', overrides = {}) {
  const isDark = mode === 'dark';

  const defaults = {
    primary: Brand.green,
    primaryDark: Brand.greenDark,
    primaryLight: `${Brand.green}22`,
    primaryBg: isDark ? `${Brand.green}11` : `${Brand.green}09`,
    
    bgBase: isDark ? '#111418' : '#fafafa',
    bgSurface: isDark ? '#141414' : '#fff',
    bgSidebar: isDark ? '#0e1012' : '#fafafa',
    bgHover: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
    
    borderLight: isDark ? '#2a2d35' : '#e0e0e0',
    borderDark: isDark ? '#1e2125' : '#f0f0f0',
    borderInput: isDark ? '#333' : '#ccc',
    borderFocus: Brand.green,
    
    textMain: isDark ? '#e0e0e0' : '#111',
    textSecondary: isDark ? '#d0d0d0' : '#333',
    textMuted: isDark ? '#888' : '#aaa',
    textDisabled: isDark ? '#666' : '#bbb',
    
    danger: '#f44336',
    dangerBg: 'rgba(244,67,54,0.1)',
    warning: '#ff9800',
    warningBg: 'rgba(255,152,0,0.1)',
    info: '#2196f3',
    infoBg: 'rgba(33,150,243,0.1)',
    success: '#4caf50',
    successBg: 'rgba(76,175,80,0.1)',
  };

  return { ...defaults, ...overrides };
}

export const editInputSx = (theme) => ({
  '& .MuiInputBase-input': {
    fontSize: 11,
    color: theme.textMain,
    py: '2px',
    px: '4px',
  },
  '& .MuiInput-underline:before': { borderBottom: `1px solid ${theme.primary}55` },
  '& .MuiInput-underline:after':  { borderBottom: `2px solid ${theme.primary}` },
});

export const fieldSx = (theme) => ({
  '& .MuiOutlinedInput-root': {
    color: theme.textMain, fontSize: 13,
    '& fieldset': { borderColor: theme.borderInput },
    '&:hover fieldset': { borderColor: theme.borderFocus },
    '&.Mui-focused fieldset': { borderColor: theme.borderFocus },
  },
  '& .MuiInputLabel-root': { color: theme.textMuted, fontSize: 13 },
  '& .MuiInputLabel-root.Mui-focused': { color: theme.borderFocus },
});

export const dialogPaperSx = (theme) => ({
  bgcolor: theme.bgSurface,
  border: `1px solid ${theme.borderLight}`,
  borderRadius: 2
});
