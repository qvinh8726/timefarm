const path = require('node:path')
const { fileURLToPath } = require('node:url')

function parseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try { return new URL(value) } catch { return null }
}

function hasCredentials(url) {
  return Boolean(url.username || url.password)
}

function isLoopbackHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

/**
 * Return an origin only when it is a transport we intentionally support for
 * opening the system browser.  Production auth must use HTTPS; HTTP remains
 * available solely for a locally hosted development Supabase instance.
 */
function normaliseExternalOrigin(value) {
  const parsed = value instanceof URL ? value : parseUrl(value)
  if (!parsed || hasCredentials(parsed)) return null
  if (parsed.protocol === 'https:') return parsed.origin
  if (parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname)) return parsed.origin
  return null
}

function getAllowedExternalOrigins(configuration = {}) {
  const candidates = Array.isArray(configuration)
    ? configuration
    : [configuration.supabaseUrl, configuration.url, configuration.TIMEFARM_SUPABASE_URL, configuration.WORKLY_SUPABASE_URL, configuration.VITE_SUPABASE_URL]
  return new Set(candidates.map(normaliseExternalOrigin).filter(Boolean))
}

/**
 * Normalise a browser URL only if it belongs to a configured auth origin.
 * Keeping this origin-level allowlist in the main process prevents a renderer
 * (or malformed auth response) from using shell.openExternal as a generic
 * protocol launcher.
 */
function normaliseAllowedExternalUrl(value, allowedOrigins) {
  const parsed = parseUrl(value)
  if (!parsed || hasCredentials(parsed)) return null
  const origin = normaliseExternalOrigin(parsed)
  if (!origin || !allowedOrigins?.has(origin)) return null
  return parsed.toString()
}

function isPathWithin(rootDirectory, candidatePath) {
  if (typeof rootDirectory !== 'string' || typeof candidatePath !== 'string') return false
  const root = path.resolve(rootDirectory)
  const candidate = path.resolve(candidatePath)
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

/**
 * The renderer is a local Vite origin in development and a packaged file tree
 * in production.  Use parsed origins/paths rather than string prefixes so
 * lookalike hosts and sibling directories cannot pass the navigation check.
 */
function isAllowedAppNavigation(value, { isDev, devServerUrl, distDirectory } = {}) {
  const parsed = parseUrl(value)
  if (!parsed || hasCredentials(parsed)) return false

  if (isDev) {
    const devServer = parseUrl(devServerUrl)
    return Boolean(devServer && parsed.origin === devServer.origin && parsed.protocol === devServer.protocol)
  }

  if (parsed.protocol !== 'file:' || !distDirectory) return false
  try { return isPathWithin(distDirectory, fileURLToPath(parsed)) } catch { return false }
}

function normaliseOAuthCallbackUrl(value) {
  const parsed = parseUrl(value)
  if (!parsed || hasCredentials(parsed)) return null
  if (parsed.protocol !== 'timefarm:' || parsed.hostname !== 'auth' || parsed.port || parsed.pathname !== '/callback') return null
  return parsed.toString()
}

function findOAuthCallbackUrl(argumentsList) {
  if (!Array.isArray(argumentsList)) return null
  for (const argument of argumentsList) {
    const callback = normaliseOAuthCallbackUrl(argument)
    if (callback) return callback
  }
  return null
}

function isAllowedOverlayNavigation(value, overlayUrl) {
  return typeof value === 'string' && typeof overlayUrl === 'string' && value === overlayUrl
}

module.exports = {
  findOAuthCallbackUrl,
  getAllowedExternalOrigins,
  isAllowedAppNavigation,
  isAllowedOverlayNavigation,
  normaliseAllowedExternalUrl,
  normaliseExternalOrigin,
  normaliseOAuthCallbackUrl,
}
