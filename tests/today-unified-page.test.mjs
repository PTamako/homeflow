import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {todayPageRoute,compareTodayRows} from '../worker/today-page.js'
import {bumpHouseholdRevision} from '../worker/sync.js'

const date='2026-11-06'
const owner={household_id:'family',user_id:'owner',role:'owner'}
const guest={household_id:'family',user_id:'guest',role:'member'}
const migrations=['0001_core.sql','0002_stage1_family_tasks.sql','0003_life_projects.sql',
 '0004_push_notifications.sql','0005_interval_policies.sql','0006_pet_health.sql',
 '0007_offline_tasks.sql','0008_shopping_ledger.sql','0009_finance_target_settings.sql',
 '0009_routine_pet_care.sql','0010_task_pet_care.sql','0011_unified_plan_hub.sql',
 '0012_savings_goal_cadence.sql','0013_plan_completion_marks.sql','0014_shopping_multi_expense.sql',
 '0015_reminder_snoozes.sql','0016_reminder_preferences.sql','0017_shopping_partial_quantity.sql',
 '0018_shopping_created_index.sql','0019_reminder_item_quiet_retry.sql',
 '0020_goal_period_settlements.sql','0021_account_recovery.sql',
 '0022_recycle_plans.sql','0023_today_dismissals.sql','0024_shopping_assignee.sql',
 '0025_daily_notification_inbox.sql','0026_shopping_any_receipt_complete.sql',
 '0027_wish_reminder_settings.sql','0028_explicit_today_actions.sql',
 '0029_household_revisions.sql']
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
function fixture(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec('PRAGMA foreign_keys=OFF')
 for(const file of migrations)
   sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'))
 const db={
  prepare(sql){
   const stmt=sqlite.prepare(sql)
   let params=[]
   return {
    bind(...values){params=values;return this},
    async first(){return stmt.get(...params)||null},
    async all(){return {results:stmt.all(...params)}},
    async run(){const r=stmt.run(...params);return {meta:{changes:Number(r.changes)}}}
   }
  },
  async batch(statements){return Promise.all(statements.map(s=>s.all()))}
 }
 return {db,sqlite}
}
function fill(sqlite){
 const tasks=sqlite.prepare('INSERT INTO tasks(id,household_id,creator_user_id,visibility,title,due_on,completed_at) VALUES(?,?,?,?,?,?,?)')
 for(let i=1;i<=260;i++)tasks.run(id(i),'family','owner','household','任务'+i,date,null)
 const privateId=id(270)
 tasks.run(privateId,'family','owner','private','不共享任务',date,null)
 tasks.run(id(271),'family','owner','household','已经完成',date,'2026-11-06T03:00:00.000Z')
 const routines=sqlite.prepare('INSERT INTO routines(id,household_id,created_by,visibility,title,repeat_type,anchor_date) VALUES(?,?,?,?,?,?,?)')
 for(let i=1;i<=255;i++)routines.run(id(i),'family','owner','household','定期'+i,'daily',date)
 const shopping=sqlite.prepare('INSERT INTO shopping_items(id,household_id,created_by,visibility,title,due_on) VALUES(?,?,?,?,?,?)')
 for(let i=1;i<=110;i++)shopping.run(id(i),'family','owner','household','购物'+i,date)
 const wishes=sqlite.prepare('INSERT INTO wishes(id,household_id,created_by,visibility,title,wish_type,target_on) VALUES(?,?,?,?,?,?,?)')
 for(let i=1;i<=110;i++)wishes.run(id(i),'family','owner','household','心愿'+i,'purchase',date)
 sqlite.prepare('INSERT INTO goals(id,household_id,created_by,visibility,title,target_on,target_amount,reserved_amount,goal_mode) VALUES(?,?,?,?,?,?,?,?,?)')
   .run(id(1),'family','owner','household','一次储值',date,1000,0,'once')
 sqlite.prepare('INSERT INTO trips(id,household_id,created_by,visibility,title,start_on,status) VALUES(?,?,?,?,?,?,?)')
   .run(id(1),'family','owner','household','周末旅行',date,'planning')
}
async function page(db,session,params={}){
 const query=new URLSearchParams({date,limit:'5',...params})
 const response=await todayPageRoute(
   new Request('https://homeflow.invalid/api/today/page?'+query),db,session)
 return {status:response.status,...await response.json()}
}

test('all six source types share one deterministic five-item server cursor',async()=>{
 const {db,sqlite}=fixture()
 try{
  fill(sqlite)
  const first=await page(db,owner)
  assert.equal(first.status,200)
  assert.equal(first.items.length,5)
  assert.equal(first.total,739,'260 tasks, 1 private, 1 completed, 255 routines, 110 shopping, 110 wishes, goal, trip')
  assert.equal(first.completed,1)
  assert.ok(first.nextCursor)
  assert.deepEqual(new Set(first.categories),
   new Set(['task','routine','shopping','wish','goal','trip']))
  assert.equal(new Set(first.entryKeys).size,first.total)
  for(let i=1;i<first.items.length;i++)
   assert.ok(compareTodayRows(first.items[i-1],first.items[i])<=0)
  const second=await page(db,owner,{cursor:first.nextCursor})
  assert.equal(second.items.length,5)
  assert.equal(second.entryKeys,undefined,'later pages must not resend entire reminder set')
  assert.equal(new Set([...first.items,...second.items].map(x=>x.key)).size,10)
  assert.ok(compareTodayRows(first.items.at(-1),second.items[0])<0)
 }finally{sqlite.close()}
})

test('source limits 250/100/50 never hide later task, routine, shopping or wish rows',async()=>{
 const {db,sqlite}=fixture()
 try{
  fill(sqlite)
  for(const [category,kind,late,total] of [
   ['task','task',id(260),262],
   ['routine','routine',id(255),255],
   ['shopping','shopping',id(110),110],
   ['wish','wish',id(110),110]]){
    const cursor=[date,category,0,0,date,
      kind==='task'?'task:'+id(category==='task'?255:1):
      kind==='routine'?'routine:'+id(250)+':'+date:
      'plan:'+kind+':'+id(105)].join('|')
    const result=await page(db,owner,{category,cursor})
    assert.equal(result.status,200,category)
    assert.equal(result.total,total,category)
    assert.ok(result.items.some(row=>row.key.includes(late)),category+' contains later IDs')
    assert.ok(result.items.every(row=>row.kind===kind))
    assert.equal(new Set(result.items.map(row=>row.key)).size,result.items.length)
  }
 }finally{sqlite.close()}
})

test('privacy, invalid cursors and completed sort keys are enforced at the server',async()=>{
 const {db,sqlite}=fixture()
 try{
  fill(sqlite)
  const owned=await page(db,owner,{category:'task'})
  const shared=await page(db,guest,{category:'task'})
  assert.equal(owned.total,262)
  assert.equal(shared.total,261)
  assert.ok(owned.entryKeys.includes('task:'+id(270)))
  assert.ok(!shared.entryKeys.includes('task:'+id(270)))
  const done=await page(db,owner,{category:'task',cursor:[date,'task',0,0,date,'task:'+id(999)].join('|')})
  assert.equal(done.items[0].done,true)
  assert.equal(done.items[0].task.completedAt,'2026-11-06T03:00:00.000Z')
  const wrongDate=await page(db,owner,{cursor:['2026-11-07','all',0,0,date,'task:'+id(1)].join('|')})
  assert.equal(wrongDate.status,400)
  const wrongCategory=await page(db,owner,{category:'wish',cursor:[date,'task',0,0,date,'task:'+id(1)].join('|')})
  assert.equal(wrongCategory.status,400)
  const wrongLimit=await page(db,owner,{limit:'100'})
  assert.equal(wrongLimit.status,400)
 }finally{sqlite.close()}
})

test('the full six-source Today feed traverses every page without duplicates or missing records',async()=>{
 const {db,sqlite}=fixture()
 try{
  fill(sqlite)
  let cursor=null,all=[],count=0
  while(true){
   const response=await page(db,owner,cursor?{cursor}:{})
   assert.equal(response.status,200)
   assert.equal(response.total,739)
   assert.ok(response.items.length>0&&response.items.length<=5)
   all.push(...response.items)
   count++
   assert.ok(count<=150,'cursor must terminate')
   if(!response.nextCursor)break
   cursor=response.nextCursor
  }
  assert.equal(all.length,739)
  assert.equal(new Set(all.map(x=>x.key)).size,739)
  for(let i=1;i<all.length;i++)assert.ok(compareTodayRows(all[i-1],all[i])<0)
 }finally{sqlite.close()}
})
 
test('a household edit invalidates an old cursor rather than mixing two snapshots',async()=>{
 const {db,sqlite}=fixture()
 try{
  fill(sqlite)
  const first=await page(db,owner)
  const revision=first.revision
  sqlite.prepare('UPDATE tasks SET due_on=? WHERE id=?').run('2026-11-07',id(260))
  await bumpHouseholdRevision(db,owner)
  const old=await page(db,owner,{cursor:first.nextCursor})
  assert.equal(old.status,409)
  assert.equal(old.error,'stale_cursor')
  const fresh=await page(db,owner)
  assert.equal(fresh.revision,revision+1)
  assert.equal(fresh.total,first.total-1)
  assert.equal(new Set(fresh.entryKeys).size,fresh.total)
  assert.ok(fresh.nextCursor)
 }finally{sqlite.close()}
})
