// HomeFlow Stage 0: only health and static assets are public.
// All personal APIs fail closed until the full identity layer is deployed.
const headers = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
}
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers })
const expectedDatabase = environment =>
  environment === 'production' ? 'homeflow' : environment === 'preview' ? 'homeflow-preview' : null

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname
    if (path === '/api/health') {
      if (request.method !== 'GET') return reply({ error: 'method_not_allowed' }, 405)
      const expected = expectedDatabase(env.APP_ENV)
      if (!expected || !env.DB || typeof env.DB.prepare !== 'function') {
        return reply({ ok: false, error: 'environment_not_ready' }, 503)
      }
      try {
        const identity = await env.DB.prepare(
          "SELECT database_name FROM environment_identity WHERE key = 'current' LIMIT 1"
        ).first()
        if (identity?.database_name !== expected) {
          return reply({ ok: false, error: 'database_identity_mismatch' }, 503)
        }
      } catch {
        return reply({ ok: false, error: 'database_migration_required' }, 503)
      }
      return reply({ ok: true, app: 'homeflow', environment: env.APP_ENV, database: 'ready' })
    }
    // Private API routes never fall through to public assets.
    if (path === '/api' || path.startsWith('/api/')) {
      return reply({ error: 'authentication_not_configured' }, 401)
    }
    if (env.ASSETS && (request.method === 'GET' || request.method === 'HEAD')) {
      return env.ASSETS.fetch(request)
    }
    if (request.method !== 'GET') return reply({ error: 'method_not_allowed' }, 405)
    return new Response(
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>HomeFlow</title><body><h1>HomeFlow</h1><p>API 已初始化，前端资源待 GitHub 部署。</p></body></html>',
      { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }
    )
  },
}
