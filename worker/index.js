import {authRoute} from './auth.js'
import {familyRoute} from './family.js'
import {tasksRoute} from './tasks.js'
import {json,sameOrigin,sessionFor,verifiedDatabase} from './security.js'

export default {
  async fetch(request,env){
    const url=new URL(request.url)
    const path=url.pathname
    if(path==='/api/health'){
      if(request.method!=='GET')return json({error:'method_not_allowed'},405)
      if(!await verifiedDatabase(env))return json({ok:false,error:'environment_or_database_not_ready'},503)
      return json({ok:true,app:'homeflow',environment:env.APP_ENV,database:'ready'})
    }
    if(path==='/api' || path.startsWith('/api/')){
      // The bound DB must be the right environment; no accidental cross-env reads.
      if(!await verifiedDatabase(env))return json({error:'environment_or_database_not_ready'},503)
      try {
        // Session lookup remains the only authorization mechanism for private data.
        // Avoid a D1 session lookup for anonymous bootstrap/login.
        const anon=['/api/auth/bootstrap','/api/auth/bootstrap-status','/api/auth/login','/api/auth/join']
        const session=anon.includes(path) ? null : await sessionFor(request,env.DB)
        const requiresLogin=!(path.startsWith('/api/auth/'))
        if(requiresLogin && !session)return json({error:'not_authenticated'},401)
        if(!['GET','HEAD','OPTIONS'].includes(request.method)&&!sameOrigin(request))
          return json({error:'origin_forbidden'},403)
        if(path.startsWith('/api/auth/'))return authRoute(request,env,path,session)
        if(path==='/api/family'||path.startsWith('/api/family/'))
          return familyRoute(request,env.DB,path,session)
        if(path==='/api/tasks'||path.startsWith('/api/tasks/'))
          return tasksRoute(request,env.DB,path,session)
        return json({error:'not_found'},404)
      }catch {
        return json({error:'server_error'},500)
      }
    }
    if(env.ASSETS && ['GET','HEAD'].includes(request.method))
      return env.ASSETS.fetch(request)
    if(request.method!=='GET')return json({error:'method_not_allowed'},405)
    return new Response('<!doctype html><html><head><meta charset="utf-8"><title>HomeFlow</title></head><body><h1>HomeFlow</h1><p>部署静态资源后可使用。</p></body></html>',
      {headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}})
  }
}
