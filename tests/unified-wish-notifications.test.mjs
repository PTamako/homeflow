import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {wishReminders} from '../worker/wish-reminders.js'
import {remindersRoute,reminderDeliveryKey} from '../worker/reminders.js'
import {lifeRoute} from '../worker/life.js'
const ID='11111111-1111-4111-8111-111111111111'
const session={household_id:'household-a',user_id:'alice',role:'owner'}
const wish={id:ID,title:'购买新钱包',status:'wished',target_on:'2026-11-10',
  remind_enabled:1,remind_advance_days:0}
const req=(url,method='GET',body)=>new Request('https://homeflow.invalid'+url,
 {method,...(body===undefined?{}:{headers:{'content-type':'application/json'},
 body:JSON.stringify(body)})})
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('wish notifications default silent and require scheduled target and explicit opt-in',()=>{
 assert.equal(wishReminders([{...wish,remind_enabled:0}],'2026-11-10').length,0)
 assert.equal(wishReminders([{...wish,target_on:null}],'2026-11-10').length,0)
 assert.equal(wishReminders([{...wish,status:'completed'}],'2026-11-10').length,0)
 assert.equal(wishReminders([{...wish,status:'cancelled'}],'2026-11-10').length,0)
 assert.equal(wishReminders([wish],'2026-11-10').length,1)
 assert.equal(wishReminders([wish],'2026-11-11').length,0)
})

test('wish dates 0, 1, 3 and 7 all send once, never daily overdue',()=>{
 for(const [lead,date] of [[0,'2026-11-10'],[1,'2026-11-09'],
   [3,'2026-11-07'],[7,'2026-11-03']]){
  const item=wishReminders([{...wish,remind_advance_days:lead}],date)
  assert.equal(item.length,1)
  assert.equal(item[0].kind,'wish')
  assert.equal(item[0].daysBefore,lead)
  assert.equal(item[0].dueOn,'2026-11-10')
  assert.equal(item[0].id,ID)
  assert.equal(wishReminders([{...wish,remind_advance_days:lead}],'2026-11-11').length,0)
 }
})

function dbFixture(delivered=[]){
 const queries=[]
 const db={prepare(sql){
   const q={sql,args:[],bind(...args){this.args=args;return this},
     async all(){queries.push(this);return {results:sql.includes('FROM wishes')?[{...wish,remind_advance_days:1}]:[]}},
     async run(){queries.push(this);return {meta:{changes:1}}},
     async first(){queries.push(this);return null}}
   return q
 },async batch(operations){
   queries.push(...operations)
   if(operations.length===2)return [{results:[]},{results:[]}]
   const data=Array.from({length:operations.length},()=>({results:[]}))
   if(operations.length===12)data[11]={results:delivered.map(dedupe_key=>({dedupe_key}))}
   return data
 }}
 return {db,queries}
}
test('pending and cron include wishes, but ordinary reminder settings do not query them',async()=>{
 const f=dbFixture(),base='/api/reminders?date=2026-11-09'
 const ordinary=await remindersRoute(req(base),f.db,session)
 assert.equal((await ordinary.json()).items.length,0)
 assert.equal(f.queries.some(x=>x.sql.includes('FROM wishes')),false)
 const scheduler=await remindersRoute(req(base+'&goals=1'),f.db,session)
 const rows=(await scheduler.json()).items
 assert.equal(rows.length,1)
 assert.equal(rows[0].kind,'wish')
 const lookup=f.queries.find(x=>x.sql.includes('FROM wishes'))
 assert.deepEqual(lookup.args,['household-a','alice','2026-11-09','2026-11-16'])
 assert.match(lookup.sql,/remind_enabled=1/)
 assert.match(lookup.sql,/status NOT IN/)
 assert.match(lookup.sql,/visibility='household' OR created_by=\?2/)
 assert.match(lookup.sql,/LIMIT 100/)
})
test('scheduled logical key de-dupes wish after 06:00 without marking the wish done',async()=>{
 const notice=wishReminders([{...wish,remind_advance_days:1}],'2026-11-09')[0]
 const f=dbFixture(['scheduled:'+reminderDeliveryKey(notice)])
 const pending=await remindersRoute(req('/api/reminders?date=2026-11-09&pending=1'),f.db,session)
 assert.equal((await pending.json()).items.length,0)
 assert.equal(reminderDeliveryKey(notice),'wish:'+ID+':2026-11-10:1')
})
test('wish creation accepts opt-in and persists default off with stored lead',async()=>{
 const q=[]
 const db={prepare(sql){return {bind(...args){q.push({sql,args});return {
   async run(){return {meta:{changes:1}}}
 }}}}}
 const payload={title:'小心愿',visibility:'private',wishType:'purchase',
   estimatedAmount:0,currency:'JPY',targetOn:'2026-11-10',remindEnabled:true,remindAdvanceDays:3}
 const result=await lifeRoute(req('/api/wishes','POST',payload),db,'/api/wishes',session)
 assert.equal(result.status,201)
 const creation=q.find(x=>x.sql.startsWith('INSERT INTO wishes'))
 assert.match(creation.sql,/remind_enabled,remind_advance_days/)
 assert.deepEqual(creation.args.slice(-2),[1,3])
 const defaultInput={...payload,remindEnabled:false,remindAdvanceDays:0}
 const silent=await lifeRoute(req('/api/wishes','POST',defaultInput),db,'/api/wishes',session)
 assert.equal(silent.status,201)
 assert.deepEqual(q.at(-1).args.slice(-2),[0,0])
 const bad=await lifeRoute(req('/api/wishes','POST',{...payload,targetOn:null}),db,'/api/wishes',session)
 assert.equal(bad.status,400)
})
test('UI supports create/edit, incoming navigation, pending action, existing goal verification',()=>{
 const create=read('src/components/PlanCreator.vue'),edit=read('src/components/LifeItemEditor.vue')
 const inbox=read('src/components/TodayNotifications.vue'),pending=read('src/components/ImportantReminders.vue')
 const push=read('worker/webpush.js'),complete=read('worker/plan-today.js')
 const migration=read('migrations/0027_wish_reminder_settings.sql')
 assert.match(create,/wishRemindEnabled:false,wishRemindAdvanceDays:0/)
 assert.match(create,/remindEnabled:!!form.targetOn&&form.wishRemindEnabled/)
 assert.match(edit,/remindEnabled:!!form.targetOn&&form.wishRemindEnabled/)
 assert.match(inbox,/function wishTarget/)
 assert.match(inbox,/emit\('openPlan','wish',wish.id,'',false\)/)
 assert.match(inbox,/查看心愿/)
 assert.match(pending,/item.kind==='goal'\|\|item.kind==='wish'/)
 assert.match(pending,/plan:wish:/)
 assert.match(push,/&goals=1/)
 assert.match(push,/event.message\|\|/)
 assert.match(complete,/verifiedGoalProgress/)
 assert.match(migration,/DEFAULT 0/)
})
