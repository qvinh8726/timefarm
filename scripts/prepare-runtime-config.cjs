const fs = require('node:fs')
const path = require('node:path')

const url = process.env.TIMEFARM_SUPABASE_URL || process.env.WORKLY_SUPABASE_URL || ''
const anonKey = process.env.TIMEFARM_SUPABASE_ANON_KEY || process.env.WORKLY_SUPABASE_ANON_KEY || ''
const redirectUrl = process.env.TIMEFARM_OAUTH_REDIRECT_URL || process.env.WORKLY_OAUTH_REDIRECT_URL || 'timefarm://auth/callback'

if (!url || !anonKey) {
  console.error('Missing TIMEFARM_SUPABASE_URL or TIMEFARM_SUPABASE_ANON_KEY in this terminal.')
  process.exit(1)
}

const outputPath = path.join(__dirname, '..', 'electron', 'timefarm.config.json')
fs.writeFileSync(outputPath, `${JSON.stringify({ supabaseUrl: url, supabaseAnonKey: anonKey, oauthRedirectUrl: redirectUrl }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
console.log('Prepared bundled TimeFarm cloud configuration.')
