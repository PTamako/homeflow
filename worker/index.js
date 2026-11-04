import {authRoute} from './auth.js'
import {familyRoute} from './family.js'
import {tasksRoute} from './tasks.js'
import {lifeRoute} from './life.js'
import {todayPlansRoute} from './plan-today.js'
import {tripsRoute} from './trips.js'
import {mediaRoute} from './media.js'
import {remindersRoute} from './reminders.js'
import {backupRoute} from './backup.js'
import {pushRoute,runPushSchedule} from './webpush.js'
import {petsRoute} from './pets.js'
import {financeRoute} from './finance.js'
import {portableRoute} from './portable.js'
import {json,sameOrigin,sessionFor,verifiedDatabase} from './security.js'

export default {
  async fetch(request,env){
    const url=new URL(request.url),path=url.pathname
    if(path==='/api/health'){
      if(request.method!=='GET')return json({error:'method_not_allowed'},405)
      if(!await verifiedDatabase(env))return json({ok:false,error:'environment_or_database_not_ready'},503)
      return json({ok:true,app:'homeflow',environment:env.APP_ENV,database:'ready'})
    }
    if(path==='/api' || path.startsWith('/api/')){
      // Always check the physical database identity before accessing any private records.
      if(!await verifiedDatabase(env))return json({error:'environment_or_database_not_ready'},503)
      try{
        const anonymousPaths=['/api/auth/bootstrap','/api/auth/bootstrap-status','/api/auth/login','/api/auth/login-challenge','/api/auth/join']
        const session=anonymousPaths.includes(path)?null:await sessionFor(request,env.DB)
        const requiresLogin=!path.startsWith('/api/auth/')
        if(requiresLogin&&!session)return json({error:'not_authenticated'},401)
        if(!['GET','HEAD','OPTIONS'].includes(request.method)&&!sameOrigin(request))
          return json({error:'origin_forbidden'},403)
        if(path.startsWith('/api/auth/'))return authRoute(request,env,path,session)
        if(path.startsWith('/api/pets/'))return petsRoute(request,env.DB,path,session)
        if(path==='/api/family'||path.startsWith('/api/family/'))
          return familyRoute(request,env.DB,path,session)
        if(path==='/api/push/config'||path==='/api/push/subscriptions')return pushRoute(request,env,path,session)
        if(path==='/api/reminders')return remindersRoute(request,env.DB,session)
        if(path==='/api/export')return backupRoute(request,env.DB,session)
        if(path==='/api/portable'||path.startsWith('/api/portable/'))return portableRoute(request,env.DB,path,session)
        if(path==='/api/finance'||path.startsWith('/api/finance/'))return financeRoute(request,env,path,session)
        if(path==='/api/tasks'||path.startsWith('/api/tasks/'))
          return tasksRoute(request,env.DB,path,session)
        if(path==='/api/plans/today'||path==='/api/plans/complete')
           return todayPlansRoute(request,env.DB,session,path,env)
        if(path==='/api/trips'||path.startsWith('/api/trips/')||/^\/api\/wishes\/[0-9a-f-]{36}\/start-trip$/.test(path))
          return tripsRoute(request,env.DB,path,session)
        if(path==='/api/media'||path.startsWith('/api/media/'))
          return mediaRoute(request,env,path,session)
        if(/^\/api\/(anniversaries|routines|wishes|goals|shopping|memories)(\/|$)/.test(path))
          return lifeRoute(request,env.DB,path,session)
        return json({error:'not_found'},404)
      }catch{
        return json({error:'server_error'},500)
      }
    }
    if(env.ASSETS && ['GET','HEAD'].includes(request.method))
      return env.ASSETS.fetch(request)
    if(request.method!=='GET')return json({error:'method_not_allowed'},405)
    return new Response('<!doctype html><html><meta charset="utf-8"><title>HomeFlow</title><body>HomeFlow API</body></html>',
      {headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}})
  },
  async scheduled(controller,env,ctx){
    if(!await verifiedDatabase(env))return
    ctx.waitUntil(runPushSchedule(env).catch(()=>{}))
  }
}
