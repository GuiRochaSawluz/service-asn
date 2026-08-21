import { createContext, useContext } from 'react'
import { translations } from './i18n'

const I18nContext = createContext({ lang: 'pt' })

export function I18nProvider({ lang = 'pt', children }) {
  return <I18nContext.Provider value={{ lang }}>{children}</I18nContext.Provider>
}

export function useI18n(section) {
  const { lang } = useContext(I18nContext)
  const t = translations[lang]?.[section] || translations.pt[section] || {}
  const tc = translations[lang]?.common || translations.pt.common
  return { t, tc, lang }
}

export const LOCALE_MAP = { pt: 'pt-BR', en: 'en-US', es: 'es-ES', fr: 'fr-FR', de: 'de-DE' }
