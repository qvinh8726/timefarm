const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')
const {
  findOAuthCallbackUrl,
  getAllowedExternalOrigins,
  isAllowedAppNavigation,
  isAllowedOverlayNavigation,
  normaliseAllowedExternalUrl,
  normaliseOAuthCallbackUrl,
} = require('./navigation-security.cjs')

test('only permits exact local renderer origins and packaged files in the dist tree', () => {
  assert.equal(isAllowedAppNavigation('http://127.0.0.1:5173/projects?tab=active', {
    isDev: true,
    devServerUrl: 'http://127.0.0.1:5173',
  }), true)
  assert.equal(isAllowedAppNavigation('http://127.0.0.1:5173.evil.example/', {
    isDev: true,
    devServerUrl: 'http://127.0.0.1:5173',
  }), false)
  assert.equal(isAllowedAppNavigation('http://attacker@127.0.0.1:5173/', {
    isDev: true,
    devServerUrl: 'http://127.0.0.1:5173',
  }), false)

  const distDirectory = path.join(os.tmpdir(), 'workly-navigation-dist')
  assert.equal(isAllowedAppNavigation(pathToFileURL(path.join(distDirectory, 'assets', 'app.js')).toString(), {
    isDev: false,
    distDirectory,
  }), true)
  assert.equal(isAllowedAppNavigation(pathToFileURL(path.join(distDirectory, '..', 'outside.html')).toString(), {
    isDev: false,
    distDirectory,
  }), false)
})

test('only opens browser URLs from an explicitly configured Supabase origin', () => {
  const allowedOrigins = getAllowedExternalOrigins({
    WORKLY_SUPABASE_URL: 'https://project.supabase.co',
    VITE_SUPABASE_URL: 'http://localhost:54321',
  })

  assert.deepEqual([...allowedOrigins].sort(), ['http://localhost:54321', 'https://project.supabase.co'])
  assert.equal(normaliseAllowedExternalUrl('https://project.supabase.co/auth/v1/authorize?provider=google', allowedOrigins), 'https://project.supabase.co/auth/v1/authorize?provider=google')
  assert.equal(normaliseAllowedExternalUrl('http://localhost:54321/auth/v1/authorize', allowedOrigins), 'http://localhost:54321/auth/v1/authorize')
  assert.equal(normaliseAllowedExternalUrl('https://project.supabase.co.evil.example/auth/v1/authorize', allowedOrigins), null)
  assert.equal(normaliseAllowedExternalUrl('https://user:password@project.supabase.co/auth/v1/authorize', allowedOrigins), null)
  assert.equal(normaliseAllowedExternalUrl('file:///C:/Windows/System32/calc.exe', allowedOrigins), null)
})

test('recognises only the exact TimeFarm OAuth callback from command-line arguments', () => {
  assert.equal(normaliseOAuthCallbackUrl('timefarm://auth/callback?code=abc&timefarm_state=expected'), 'timefarm://auth/callback?code=abc&timefarm_state=expected')
  assert.equal(normaliseOAuthCallbackUrl('timefarm://auth.evil.example/callback?code=abc'), null)
  assert.equal(normaliseOAuthCallbackUrl('timefarm://auth/other?code=abc'), null)
  assert.equal(normaliseOAuthCallbackUrl('timefarm://auth:443/callback?code=abc'), null)
  assert.equal(findOAuthCallbackUrl(['electron.exe', '--inspect', 'timefarm://auth/callback?code=abc&timefarm_state=expected']), 'timefarm://auth/callback?code=abc&timefarm_state=expected')
  assert.equal(findOAuthCallbackUrl(['electron.exe', 'https://example.com/timefarm://auth/callback']), null)
})

test('overlay navigation must remain on its exact generated data URL', () => {
  const overlayUrl = 'data:text/html;charset=utf-8,%3Ch1%3ETwitter%3C%2Fh1%3E'
  assert.equal(isAllowedOverlayNavigation(overlayUrl, overlayUrl), true)
  assert.equal(isAllowedOverlayNavigation('data:text/html,<script>location="https://evil.example"</script>', overlayUrl), false)
  assert.equal(isAllowedOverlayNavigation('https://evil.example/', overlayUrl), false)
})
