/**
 * Slug do Umbrella só existe na URL em runtime (ex.: /asn-hml/...).
 * Chamadas absolutas (/api, /health) precisam permanecer dentro desse prefixo,
 * senão o ALB entrega o pedido ao Hub e a resposta volta HTML.
 */

const IGNORED_SLUGS = new Set([
  'index.html',
  'favicon.ico',
  'static',
  'assets',
  'ops',
  'admin',
  'health',
  'docs',
  'api',
  'openapi.json',
])

const API_ROOTS = /^\/(api|health)(\/|$)/

export function getSlugPrefix(pathname = window.location.pathname) {
  const clean = String(pathname || '').replace(/\/index\.html\/?$/, '/')
  const parts = clean.split('/').filter(Boolean)
  if (parts.length === 0) return ''
  const first = parts[0].toLowerCase()
  if (IGNORED_SLUGS.has(first) || first.includes('.')) return ''
  return `/${parts[0]}`
}

/** Path da SPA sem o slug do satélite. /asn-hml/ops → /ops */
export function getAppPathname(pathname = window.location.pathname) {
  const clean = String(pathname || '').replace(/\/index\.html\/?$/, '/') || '/'
  const slug = getSlugPrefix(clean)
  if (!slug) return clean.startsWith('/') ? clean : `/${clean}`
  const rest = clean.slice(slug.length)
  if (!rest || rest === '/') return '/'
  return rest.startsWith('/') ? rest : `/${rest}`
}

function applySlugPrefix(path) {
  if (!path || typeof path !== 'string') return path
  if (/^\/[^/]+\/(api|health)(\/|$)/.test(path)) return path
  if (!API_ROOTS.test(path)) return path
  const slug = getSlugPrefix()
  if (!slug) return path
  return `${slug}${path}`
}

export function installSlugAwareFetch() {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return
  if (window.__asnSlugAwareFetch) return

  const originalFetch = window.fetch.bind(window)

  window.fetch = (input, init) => {
    try {
      if (typeof input === 'string' && input.startsWith('/')) {
        return originalFetch(applySlugPrefix(input), init)
      }
      if (typeof input === 'string') {
        const abs = new URL(input, window.location.origin)
        if (abs.origin === window.location.origin) {
          const nextPath = applySlugPrefix(abs.pathname)
          if (nextPath !== abs.pathname) {
            abs.pathname = nextPath
            return originalFetch(abs.toString(), init)
          }
        }
      }
    } catch {
      // segue o fetch original
    }
    return originalFetch(input, init)
  }

  window.__asnSlugAwareFetch = true
}
