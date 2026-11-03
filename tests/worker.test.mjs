import assert from 'node:assert/strict'
import test from 'node:test'
import worker from '../worker/index.js'
const request = (path, method = 'GET') => new Request('https://homeflow.example' + path, { method })
function environment(name = 'preview', database = 'homeflow-preview') {
  return {
    APP_ENV: name,
    DB: { prepare() { return { first: async () => ({ database_name: database }) } } },
    ASSETS: { fetch: () => new Response('PRIVATE_DATA_SHOULD_NOT_APPEAR') },
  }
}
test('health requires correct D1 identity', async () => {
  const res = await worker.fetch(request('/api/health'), environment())
  assert.equal(res.status, 200)
  assert.equal((await res.json()).database, 'ready')
})
test('preview bound to production fails closed', async () => {
  const res = await worker.fetch(request('/api/health'), environment('preview','homeflow'))
  assert.equal(res.status, 503)
  assert.equal((await res.json()).error, 'database_identity_mismatch')
})
test('unrecognized environment fails closed', async () => {
  const res = await worker.fetch(request('/api/health'), environment('staging'))
  assert.equal(res.status, 503)
})
test('missing migrations fail closed', async () => {
  const e = environment()
  e.DB.prepare = () => ({ first: async () => { throw Error('no such table') } })
  const res = await worker.fetch(request('/api/health'), e)
  assert.equal((await res.json()).error, 'database_migration_required')
})
test('all private API methods deny requests before asset fallback', async () => {
  for (const method of ['GET','POST','PUT','DELETE']) {
    const res = await worker.fetch(request('/api/households', method), environment())
    assert.equal(res.status, 401)
    assert.notEqual(await res.text(), 'PRIVATE_DATA_SHOULD_NOT_APPEAR')
  }
})
test('health is read-only', async () => {
  const res = await worker.fetch(request('/api/health', 'POST'), environment())
  assert.equal(res.status, 405)
})
