import {documentAssistantBridge} from './document-assistant-bridge.js'
import {authRoute} from './auth.js'
import {familyRoute} from './family.js'
import {tasksRoute} from './tasks.js'
import {lifeRoute} from './life.js'
import {todayPlansRoute} from './plan-today.js'
import {todayActionRoute} from './today-actions.js'
import {todayPageRoute} from './today-page.js'
import {syncStateRoute,bumpHouseholdRevision,bumpMemberRevision,personalMutation,mutationChangesState} from './sync.js'
import {planSummaryRoute} from './plan-summary.js'
import {searchRoute} from './search.js'
import {tripsRoute} from './trips.js'
import {mediaRoute,runMediaCleanup} from './media.js'
import {remindersRoute} from './reminders.js'
import {backupRoute} from './backup.js'
import {pushRoute,runPushSchedule,sendCompletionFeedback} from './webpush.js'
import {petsRoute} from './pets.js'
import {financeRoute} from './finance.js'
import {goalPeriodsRoute,runGoalSettlementSchedule} from './goal-settlements.js'
import {goalPeriodArchiveRoute} from './goal-period-archive.js'
import {portableRoute} from './portable.js'
import {recycleRoute} from './recycle.js'
import {json,sameOrigin,sessionFor,verifiedDatabase} from './security.js'
import {notificationsRoute,purgeOldNotifications} from './notifications.js'
import {pointsRoute} from './points.js'
import {pointsHistoryRoute} from './points-history.js'
import {rewardsRoute,expireOldRewardPools} from './rewards.js'
import {lotteryRoute} from './lottery.js'
import {sendLotteryDrawNotification} from './webpush.js'
import {scheduledRunPhase} from './schedule-policy.js'

async function routeRequest(request,env,ctx,state){
    const url=new URL(request.url),path=url.pathname
    if(path==='/api/health'){
      if(request.method!=='GET')return json({error:'method_not_allowed'},405)
      if(!await verifiedDatabase(env))return json({ok:false,error:'environment_or_database_not_ready'},503)
      return json({ok:true,app:'homeflow',environment:env.APP_ENV,database:'ready'})
    }
    if(path==='/api' || path.startsWith('/api/')){
      // Always check the physical database identity before accessing any private records.
      if(!await verifiedDatabase(env))return json({error:'environment_or_database_not_ready'},503)
      if(path==='/api/bridge/document-assistant')return documentAssistantBridge(request,env)
      try{
        const anonymousPaths=['/api/auth/bootstrap','/api/auth/bootstrap-status','/api/auth/login','/api/auth/login-challenge','/api/auth/join','/api/auth/recover']
        const session=anonymousPaths.includes(path)?null:await sessionFor(request,env.DB)
        state.session=session
        const requiresLogin=!path.startsWith('/api/auth/')
        if(requiresLogin&&!session)return json({error:'not_authenticated'},401)
        if(!['GET','HEAD','OPTIONS'].includes(request.method)&&!sameOrigin(request))
          return json({error:'origin_forbidden'},403)
        // Completion push is best-effort and cannot invalidate a committed task.
        const onComplete=typeof ctx?.waitUntil==='function'
          ? event=>ctx.waitUntil(sendCompletionFeedback(env,session,event)
              .catch(()=>console.warn('homeflow_completion_feedback_failed')))
          : null
        if(path.startsWith('/api/auth/'))return authRoute(request,env,path,session)
        if(path.startsWith('/api/pets/'))return petsRoute(request,env.DB,path,session)
        if(path==='/api/family'||path.startsWith('/api/family/'))
          return familyRoute(request,env.DB,path,session)
        if(path.startsWith('/api/notifications/'))return notificationsRoute(request,env.DB,path,session)
        if(path==='/api/push/config'||path==='/api/push/subscriptions'||path==='/api/push/send-now'||path==='/api/push/send-task'||path==='/api/push/send-family')return pushRoute(request,env,path,session)
        if(path==='/api/reminders'||path==='/api/reminders/snooze'||path==='/api/reminders/preferences'||path==='/api/reminders/item')return remindersRoute(request,env.DB,session)
        if(path==='/api/export')return backupRoute(request,env.DB,session)
        if(path==='/api/recycle'||path==='/api/recycle/restore'||path==='/api/recycle/empty')return recycleRoute(request,env.DB,path,session,env)
        if(path==='/api/portable'||path.startsWith('/api/portable/'))return portableRoute(request,env.DB,path,session)
        if(path==='/api/finance'||path.startsWith('/api/finance/'))return financeRoute(request,env,path,session,onComplete)
        if(path==='/api/tasks'||path.startsWith('/api/tasks/'))
          return tasksRoute(request,env.DB,path,session,onComplete)
        if(path==='/api/search')return searchRoute(request,env.DB,session)
        if(path==='/api/sync/state')return syncStateRoute(request,env.DB,session)
        if(path==='/api/points')return pointsRoute(request,env.DB,session)
        if(path==='/api/points/history')return pointsHistoryRoute(request,env.DB,session)
        if(path==='/api/lottery'||path==='/api/lottery/draw'||path==='/api/lottery/coupons'||path==='/api/lottery/coupons/redeem-wish'){
          const onDraw=draw=>{
            const job=sendLotteryDrawNotification(env,session,draw)
              // A replay only resends an already-recorded event. Advance
              // revisions for genuinely new inbox entries, never for retries.
              .then(result=>result.newInboxRows>0?bumpHouseholdRevision(env.DB,session):null)
              .catch(()=>console.warn('homeflow_lottery_push_failed'))
            if(typeof ctx?.waitUntil==='function')ctx.waitUntil(job)
            else void job
          }
          return lotteryRoute(request,env.DB,path,session,onDraw)
        }
        if(path==='/api/rewards'||path.startsWith('/api/rewards/'))return rewardsRoute(request,env.DB,path,session)
        if(path==='/api/today/page')return todayPageRoute(request,env.DB,session)
        if(path==='/api/plans/today-action'||path==='/api/plans/action-history')
          return todayActionRoute(request,env.DB,path,session)
        if(path==='/api/plans/summary')return planSummaryRoute(request,env.DB,session)
        if(path==='/api/plans/today'||path==='/api/plans/complete')
           return todayPlansRoute(request,env.DB,session,path,env)
        if(path==='/api/trips'||path.startsWith('/api/trips/')||/^\/api\/wishes\/[0-9a-f-]{36}\/start-trip$/.test(path))
          return tripsRoute(request,env.DB,path,session)
        if(path==='/api/media'||path.startsWith('/api/media/'))
          return mediaRoute(request,env,path,session)
        if(path==='/api/goals/period-archive')
          return goalPeriodArchiveRoute(request,env.DB,session)
        if(/^\/api\/goals\/[0-9a-f-]{36}\/periods(?:\/settle)?$/i.test(path))
          return goalPeriodsRoute(request,env,path,session)
        if(/^\/api\/(anniversaries|routines|wishes|goals|shopping|memories)(\/|$)/.test(path)){
          const onAssigned=typeof ctx?.waitUntil==='function'
            ? event=>ctx.waitUntil(pushRoute(new Request('https://homeflow.invalid/api/push/send-task',{
                method:'POST',headers:{'content-type':'application/json'},
                body:JSON.stringify({...event,message:'本期已指派给你，请按时处理'})
              }),env,'/api/push/send-task',session)
              .catch(()=>console.warn('homeflow_routine_assignment_push_failed')))
            : null
          return lifeRoute(request,env.DB,path,session,onComplete,{onAssigned})
        }
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
}

export default {
  async fetch(request,env,ctx){
    const state={session:null}
    const response=await routeRequest(request,env,ctx,state)
    // Include changes to every authenticated feature (not just Today): family,
    // plan, shopping, routines, history, reminders and member notification state.
    // Read-only requests and any rejected mutation never advance the version.
    if(state.session&&response.ok&&!['GET','HEAD','OPTIONS'].includes(request.method)){
      try{
        const path=new URL(request.url).pathname
        // Response bodies here are tiny JSON acknowledgements. Inspect the
        // outcome rather than treating HTTP 200 from a replay as a mutation.
        const outcome=response.headers.get('content-type')?.includes('application/json')
          ?await response.clone().json().catch(()=>null):null
        if(mutationChangesState(path,outcome)){
          if(personalMutation(path))
            await bumpMemberRevision(env.DB,state.session)
          else await bumpHouseholdRevision(env.DB,state.session)
        }
      }catch{console.warn('homeflow_sync_revision_failed')}
    }
    return response
  },
  async scheduled(controller,env,ctx){
    // A single hourly Cron covers every member's own quiet-hour end.
    // No reminders are generated before 06:00 JST; from 07:00 onward only
    // unsent deliveries are retried. Settlements and cleanup remain once/day.
    const phase=scheduledRunPhase(controller)
    if(phase==='skip'||!await verifiedDatabase(env))return
    ctx.waitUntil((async()=>{
      const catchUp=phase==='catchup'
      const jobNames=catchUp?['quiet-hour-catch-up']:['push','savings','annual-points-expiry']
      const jobs=await Promise.allSettled(catchUp?
        [runPushSchedule(env)]:
        [runPushSchedule(env),runGoalSettlementSchedule(env),expireOldRewardPools(env.DB)])
      // These automated writes bypass fetch(); only touched households advance.
      const changed=new Set(jobs.flatMap(job=>job.status==='fulfilled'?
        (job.value?.changedHouseholds||[]):[]))
      for(const household_id of changed){
        try{await bumpHouseholdRevision(env.DB,{household_id})}
        catch{console.warn('homeflow_scheduled_sync_failed')}
      }
      // Purge expired inbox rows on the existing 06:00 JST cron; tasks/plans are never deleted.
      if(!catchUp)try{await purgeOldNotifications(env.DB)}catch{console.warn('homeflow_notification_purge_failed')}
      // Daily recovery for R2 deletes that failed after a user removed photos.
      if(!catchUp)try{await runMediaCleanup(env)}catch{console.warn('homeflow_r2_cleanup_failed')}
      // Aggregate-only diagnostics: never log titles, account IDs, or ledger transactions.
      const summary=jobs.map((job,index)=>job.status==='fulfilled'?
        {job:jobNames[index],...Object.fromEntries(Object.entries(job.value||{}).filter(([key])=>key!=='changedHouseholds'))}:
        {job:jobNames[index],failed:1,reason:'unexpected'})
      console.info('homeflow_daily_jobs',JSON.stringify(summary))
    })())
  }
}
