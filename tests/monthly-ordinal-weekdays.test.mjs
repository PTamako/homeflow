import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {dueOn,validateRule} from '../worker/recurrence.js'
import {nextRoutineDue,previousRoutineDue,currentRoutinePeriod,nextEarlyPeriod,
  isClosedRoutinePeriod,historyCandidates,routineVersions} from '../worker/routine-periods.js'
import {lifeRoute} from '../worker/life.js'
import {remindersRoute} from '../worker/reminders.js'

const id='11111111-1111-4111-8111-111111111111'
const session={household_id:'house',user_id:'user',role:'owner'}
const config={weekday:2,weeks:[2,4]}
const routine=(c=config,start='2026-11-01')=>({
 id,title:'扔不可燃垃圾',anchor_date:start,repeat_type:'monthly',
 repeat_config:JSON.stringify(c),enabled:1,visibility:'household',created_by:'user'
})
const post=(path,body,method='POST')=>new Request('https://homeflow.invalid'+path,{
 method,headers:{'content-type':'application/json'},body:JSON.stringify(body)
})
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('second and fourth Tuesday alone: 2026 Nov/Dec and 2027 Jan',()=>{
 const r=routine()
 for(const due of ['2026-11-10','2026-11-24','2026-12-08',
   '2026-12-22','2027-01-12','2027-01-26'])
   assert.equal(dueOn(r,due),true,due)
 for(const absent of ['2026-11-03','2026-11-17','2026-12-01','2026-12-15',
   '2026-12-29','2027-01-05','2027-01-19'])
   assert.equal(dueOn(r,absent),false,absent)
 assert.equal(dueOn(routine(config,'2026-11-11'),'2026-11-10'),false,
   'the first due before the start date must not materialize')
})

test('dates and recurring periods remain stable across months and completion',()=>{
 const r=routine()
 assert.equal(nextRoutineDue(r,'2026-11-06'),'2026-11-10')
 assert.equal(nextEarlyPeriod(r,'2026-11-06'),'2026-11-10')
 assert.equal(currentRoutinePeriod(r,'2026-11-09'),null)
 assert.equal(currentRoutinePeriod(r,'2026-11-10'),'2026-11-10')
 assert.equal(nextRoutineDue(r,'2026-11-11'),'2026-11-24')
 assert.equal(nextRoutineDue(r,'2026-11-25'),'2026-12-08')
 assert.equal(previousRoutineDue(r,'2026-12-01'),'2026-11-24')
 assert.equal(isClosedRoutinePeriod(r,'2026-11-10','2026-11-24'),true)
 assert.equal(isClosedRoutinePeriod(r,'2026-11-24','2026-11-24'),false)
 assert.deepEqual(historyCandidates(r,'2027-01-30',6),[
   '2027-01-26','2027-01-12','2026-12-22','2026-12-08','2026-11-24','2026-11-10'])
})

test('fifth week is optional and never substituted by the fourth',()=>{
 const r=routine({weekday:2,weeks:[5]})
 assert.equal(dueOn(r,'2026-11-24'),false)
 assert.equal(nextRoutineDue(r,'2026-11-06'),'2026-12-29')
 assert.equal(nextRoutineDue(r,'2026-12-30'),'2027-03-30')
 assert.equal(previousRoutineDue(r,'2027-03-10'),'2026-12-29')
 assert.equal(dueOn(r,'2027-03-30'),true)
})

test('ordinal inputs reject empty, duplicate, out-of-range and partial rules',()=>{
 const valid=repeatConfig=>validateRule({repeatType:'monthly',repeatConfig})
 assert.equal(valid(config),true)
 for(const candidate of [{weekday:2,weeks:[]},{weekday:2,weeks:[2,2]},
   {weekday:7,weeks:[2]},{weekday:2,weeks:[6]},{weekday:2,weeks:[0]},
   {weekday:2,weeks:['2']},{weeks:[2,4]},{weekday:2},{weekday:2,weeks:null}])
    assert.equal(valid(candidate),false,JSON.stringify(candidate))
 assert.equal(valid({day:31}),true,'fixed-date monthly plans must keep working')
})

test('API accepts one monthly plan with two weekly ordinals and rejects malformed input',async()=>{
 const writes=[]
 const db={prepare(sql){return {bind(...args){return {
   run:async()=>{writes.push({sql,args});return {meta:{changes:1}}}
 }}}}}
 const body={title:'扔不可燃垃圾',repeatType:'monthly_weekday',
   repeatConfig:{weekday:2,weeks:[2,4]},anchorDate:'2026-11-06',
   visibility:'household',remindEnabled:true}
 const url='/api/routines'
 const response=await lifeRoute(post(url,body),db,url,session)
 assert.equal(response.status,201)
 assert.equal(writes.length,1)
 assert.equal(writes[0].args[5],'monthly')
 assert.deepEqual(JSON.parse(writes[0].args[6]),config)
 // Exactly the pre-existing repeat_type CHECK constraint is used.
 const sqlite=new DatabaseSync(':memory:')
 try{
  sqlite.exec("CREATE TABLE routines(repeat_type TEXT CHECK(repeat_type IN ('daily','weekly','monthly','interval')),repeat_config TEXT)")
  sqlite.prepare('INSERT INTO routines(repeat_type,repeat_config) VALUES (?,?)')
    .run(writes[0].args[5],writes[0].args[6])
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM routines').get().n,1)
 }finally{sqlite.close()}
 for(const candidate of [{weekday:2,weeks:[]},{weekday:2,weeks:[2,2]},
   {weekday:9,weeks:[2]}]){
  const bad=await lifeRoute(post(url,{...body,repeatConfig:candidate}),db,url,session)
  assert.equal(bad.status,400)
 }
 assert.equal(writes.length,1,'invalid requests never write to D1')
})

test('editing an existing monthly plan records the old rule in revision history',async()=>{
 const old={...routine({day:10},'2026-01-01'),updated_at:'2026-11-05 00:00:00',
  subject_profile_id:null,health_record_type:null,deleted_at:null}
 const updates=[]
 const db={prepare(sql){return {bind(...args){return {
   first:async()=>old,run:async()=>{updates.push({sql,args});return {meta:{changes:1}}}
 }}}}}
 const path='/api/routines/'+id
 const changed=await lifeRoute(post(path,{
   title:'扔不可燃垃圾',repeatType:'monthly_weekday',
   repeatConfig:config,anchorDate:'2026-01-01',
   visibility:'household',remindEnabled:true,expectedUpdatedAt:old.updated_at
 },'PATCH'),db,path,session)
 assert.equal(changed.status,200)
 assert.equal(updates.length,1)
 assert.equal(updates[0].args[2],'monthly')
 const next=JSON.parse(updates[0].args[3])
 assert.deepEqual({weekday:next.weekday,weeks:next.weeks},config)
 assert.equal(next._history.length,1)
 assert.equal(next._history[0].repeatType,'monthly')
 assert.deepEqual(next._history[0].repeatConfig,{day:10})
 const versions=routineVersions({...old,repeat_config:JSON.stringify(next)})
 assert.equal(versions.length,2)
 assert.equal(dueOn(versions[0],'2026-10-10'),true)
 assert.equal(dueOn(versions[1],'2026-11-10'),true)
})

function reminderFixture(rule,marked=[]){
 return {async batch(statements){
   assert.equal(statements.length,11)
   return [
     {results:[]},{results:[rule]},
     {results:marked.map(x=>({routine_id:rule.id,occurrence_on:x,completed_at:'2026-11-10 03:00:00',skipped_at:null}))},
     ...Array.from({length:6},()=>({results:[]})),
     {results:[{advance_days:1,quiet_start_hour:null,quiet_end_hour:null}]},
     {results:[]}
   ]
 }}
}
test('reminders respect only second and fourth Tuesday and lead time',async()=>{
 const r=routine()
 for(const [day,expected,lead] of [
  ['2026-11-09',true,1],['2026-11-10',true,0],
  ['2026-11-16',false,0],['2026-11-17',false,0],
  ['2026-11-23',true,1],['2026-11-24',true,0],
  ['2026-12-07',true,1],['2026-12-08',true,0]
 ]){
  const result=await remindersRoute(new Request('https://homeflow.invalid/api/reminders?date='+day),
    reminderFixture(r),session)
  assert.equal(result.status,200)
  const events=(await result.json()).items.filter(x=>x.kind==='routine')
  assert.equal(events.length,expected?1:0,day)
  if(expected){
    assert.equal(events[0].daysBefore||0,lead)
    assert.equal(events[0].title,'扔不可燃垃圾')
  }
 }
 const done=await remindersRoute(new Request('https://homeflow.invalid/api/reminders?date=2026-11-10'),
   reminderFixture(r,['2026-11-10']),session)
 assert.equal((await done.json()).items.filter(x=>x.kind==='routine').length,0)
})

test('UI supports create, edit and displays a monthly weekday label',()=>{
 const creation=read('src/components/PlanCreator.vue')
 const editor=read('src/components/LifeItemEditor.vue')
 const plan=read('src/components/LifePanel.vue')
 for(const source of [creation,editor]){
  assert.match(source,/monthly_weekday/)
  assert.match(source,/ordinalWeeks/)
  assert.match(source,/v-model="form.ordinalWeeks"/)
  assert.match(source,/:value="n"/)
  assert.match(source,/form.weekday/)
 }
 assert.match(plan,/Array.isArray\(config.weeks\)/)
 assert.match(plan,/每月第 /)
})
