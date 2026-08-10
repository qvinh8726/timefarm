const assert = require('node:assert/strict')
const test = require('node:test')
const { LocalAccountPrincipalError, cloudSyncEligibility, resolveLocalAccountPrincipal } = require('./local-account-policy.cjs')

const account = (authUserId) => ({ id: 'local-account', ...(authUserId ? { authUserId } : {}) })

test('unclaimed local data remains local and does not consult cloud authentication', async () => {
  let statusCalls = 0
  const result = await resolveLocalAccountPrincipal({
    account: account(),
    authService: { getStatus: async () => { statusCalls += 1; return { authenticated: true, user: { id: 'cloud-user' } } } },
  })
  assert.equal(result.state, 'not_claimed')
  assert.equal(result.linked, false)
  assert.equal(statusCalls, 0)
  assert.deepEqual(cloudSyncEligibility(account()), { eligible: false, state: 'not_claimed' })
})

test('linked data accepts its same cached owner while offline but marks it ineligible for network sync', async () => {
  const result = await resolveLocalAccountPrincipal({
    account: account('cloud-user'),
    authService: { getStatus: async () => ({ authenticated: true, offline: true, user: { id: 'cloud-user' } }) },
  })
  assert.equal(result.state, 'owned_offline')
  assert.equal(result.linked, true)
  assert.equal(result.offline, true)
  assert.deepEqual(cloudSyncEligibility(account('cloud-user')), { eligible: true, state: 'eligible' })
})

test('linked data rejects missing or mismatched owners', async () => {
  await assert.rejects(
    () => resolveLocalAccountPrincipal({ account: account('cloud-user'), authService: { getStatus: async () => ({ authenticated: false, user: null }) } }),
    (error) => error instanceof LocalAccountPrincipalError && error.code === 'LOCAL_ACCOUNT_OWNER_MISMATCH',
  )
  await assert.rejects(
    () => resolveLocalAccountPrincipal({ account: account('cloud-user'), authService: { getStatus: async () => ({ authenticated: true, user: { id: 'different-user' } }) } }),
    (error) => error instanceof LocalAccountPrincipalError && error.code === 'LOCAL_ACCOUNT_OWNER_MISMATCH',
  )
})
