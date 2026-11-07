import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {completionRecipientIds} from '../worker/webpush.js'
import {tasksRoute} from '../worker/tasks.js'
import {lifeRoute} from '../worker/life.js'
import {financeRoute} from '../worker/finance.js'
import {jstToday} from '../worker/routine-periods.js'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const A='11111111-1111-4111-8111-111111111111'
const B='22222222-2222-4222-8222-222222222222'
const C='33333333-3333-4333-8333-333333333333'
const ID='44444444-4444-4444-8444-444444444444'
const session={household_id:'home',user_id:B,role:'member'}
const req=(path,method,body)=>new Request('https://homeflow.invalid'+path,
 {method,headers:{'content-type':'application/json'},body:JSON.stringify(body)})
test('unassigned family tasks notify all other members exactly once',()=>{
 assert.deepEqual(completionRecipientIds([A,B,C,B],{
  visibility:'household',actorId:B,creatorId:A,assigneeId:null
 }),[A,C])
})
test('assigned family tasks notify the dispatcher; private and self cases do not',()=>{
 assert.deepEqual(completionRecipientIds([A,B,C],{
  visibility:'household',actorId:B,creatorId:A,assigneeId:B
 }),[A])
 assert.deepEqual(completionRecipientIds([A,B,C],{
  visibility:'household',actorId:A,creatorId:A,assigneeId:B
 }),[])
 assert.deepEqual(completionRecipientIds([A,B,C],{
  visibility:'private',actorId:B,creatorId:A,assigneeId:null
 }),[])
})
test('one-time tasks produce completion feedback on a committed state transition only',async()=>{
 const task={id:ID,title:'照顾豆沙',creator_user_id:A,assignee_user_id:B,
  visibility:'household',completed_at:null,subject_profile_id:null,health_record_type:null}
 let changes=1
 const events=[]
 const db={prepare(){return {bind(){return {
  first:async()=>task,run:async()=>({meta:{changes}})
 }}}}}
 const path='/api/tasks/'+ID
 const done=await tasksRoute(req(path,'PATCH',{completed:true}),db,path,session,e=>events.push(e))
 assert.equal(done.status,200)
 assert.equal(events.length,1)
 assert.equal(events[0].creatorId,A)
 assert.equal(events[0].assigneeId,B)
 changes=0
 const replay=await tasksRoute(req(path,'PATCH',{completed:true}),db,path,session,e=>events.push(e))
 assert.equal((await replay.json()).unchanged,true)
 assert.equal(events.length,1)
})
test('routine completion triggers feedback only for a newly committed occurrence',async()=>{
 const date=jstToday(),events=[]
 const rule={id:ID,title:'豆沙梳毛',created_by:A,assigned_to:B,
  visibility:'household',repeat_type:'daily',repeat_config:'{}',
  anchor_date:date,enabled:1,deleted_at:null}
 let changes=1
 const db={
  prepare(sql){return {bind(){return {first:async()=>sql.includes('routine_marks')?null:rule}}}},
  batch:async()=>[{meta:{changes}}]
 }
 const path='/api/routines/'+ID+'/mark'
 const make=()=>req(path,'POST',{status:'completed',date})
 const first=await lifeRoute(make(),db,path,session,e=>events.push(e))
 assert.equal(first.status,200)
 assert.equal(events.length,1)
 assert.equal(events[0].kind,'routine')
 assert.equal(events[0].periodOn,date)
 changes=0
 await lifeRoute(make(),db,path,session,e=>events.push(e))
 assert.equal(events.length,1)
})
test('verified shopping receipt generates completion feedback only once',async()=>{
 const events=[],path='/api/finance/shopping/'+ID+'/link'
 const item={id:ID,title:'猫砂',created_by:A,assigned_to:B,
  visibility:'household',ledger_entry_id:null,completed_at:null}
 let changes=1
 const db={prepare(){return {bind(){return {first:async()=>item}}}},
  batch:async()=>[{meta:{changes:1}},{meta:{changes}}]}
 const env={APP_ENV:'production',DB:db,
  KAKEBO_LEDGER_API_URL:'https://kakeibo-f17.pages.dev/api/homeflow-ledger',
  KAKEBO_LEDGER_SERVICE:{fetch:async()=>Response.json({entries:[{id:123,type:'expense'}]})}}
 const owner={...session,role:'owner'}
 const send=()=>req(path,'POST',{entryId:123})
 assert.equal((await financeRoute(send(),env,path,owner,e=>events.push(e))).status,200)
 assert.equal(events.length,1)
 assert.equal(events[0].kind,'shopping')
 changes=0
 await financeRoute(send(),env,path,owner,e=>events.push(e))
 assert.equal(events.length,1)
})
test('feedback is best-effort and completed push opens historical plan',()=>{
 const index=read('worker/index.js'),web=read('worker/webpush.js')
 const app=read('src/App.vue'),sw=read('public/sw.js')
 assert.match(index,/ctx\.waitUntil\(sendCompletionFeedback\(env,session,event\)/)
 for(const kind of ['tasksRoute','financeRoute'])
  assert.match(index,new RegExp('return '+kind+'\\\\([^\\\\n]*onComplete\\\\)'))
 assert.match(index,/return lifeRoute\\([^\\n]*onComplete,\\{onAssigned\\}\\)/)
 assert.match(web,/recordInInbox:true/)
 assert.match(web,/dedupeKey:scheduled\?\.dedupeKey\|\|completionKey/)
 assert.match(web,/unreadOnCompletion:true/)
 assert.match(web,/u\.disabled_at IS NULL/)
 assert.match(web,/taskDone:'1'/)
 assert.match(app,/kind==='shopping'\|\|kind==='wish'/)
 assert.match(sw,/completed:target\.searchParams\.get\('taskDone'\)==='1'/)
 assert.match(read('src/components/TodayNotifications.vue'),/item\.message\.startsWith\('已完成 · '\)/)
})

test('completion banners have high Apple Web Push urgency and unique tags',()=>{
 const web=read('worker/webpush.js')
 assert.match(web,/tag:'homeflow-done-'\+event\.kind\+'-'\+event\.id\+'-'\+event\.completedAt\.replace/)
 assert.match(web,/priority:'important',recordInInbox:true/)
 assert.match(web,/Urgency:data\.priority==='important'\?'high':'normal'/)
 const setting=read('src/components/PushPanel.vue')
 assert.match(setting,/Notification\.permission/)
 assert.match(setting,/permission==='granted'&&!!subscription/)
 assert.match(setting,/设置 → 通知 → HomeFlow/)
})
