import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {householdRevision,syncStateRoute,bumpHouseholdRevision,bumpMemberRevision,personalMutation} from '../worker/sync.js'
import {todayPageRoute} from '../worker/today-page.js'
import {backupRoute} from '../worker/backup.js'
import worker from '../worker/index.js'
import {sha256} from '../worker/security.js'

const owner={household_id:'shared',user_id:'alice',role:'owner'}
const member={household_id:'shared',user_id:'bob',role:'member'}
const other={household_id:'different',user_id:'eve',role:'owner'}
function dbFixture(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec('PRAGMA foreign_keys=OFF')
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
 '0029_household_revisions.sql','0030_member_revisions.sql']
 for(const m of migrations)sqlite.exec(readFileSync(new URL('../migrations/'+m,import.meta.url),'utf8'))
 const db={
  prepare(sql){const stmt=sqlite.prepare(sql);let args=[]
   return {bind(...params){args=params;return this},async first(){return stmt.get(...args)||null},
    async all(){return {results:stmt.all(...args)}},
    async run(){const r=stmt.run(...args);return {meta:{changes:Number(r.changes)}}}}
  },
  async batch(stmts){return Promise.all(stmts.map(s=>s.all()))}
 }
 return {db,sqlite}
}
async function rev(db,user){
 const r=await syncStateRoute(new Request('https://example.invalid/api/sync/state'),db,user)
 assert.equal(r.status,200)
 return (await r.json()).revision
}
test('one indexed revision is shared by family but isolated between households',async()=>{
 const {db,sqlite}=dbFixture()
 try{
  assert.equal(await rev(db,owner),0)
  assert.equal(await rev(db,member),0)
  await bumpHouseholdRevision(db,owner)
  assert.equal(await rev(db,owner),1)
  assert.equal(await rev(db,member),1)
  assert.equal(await rev(db,other),0)
  await bumpHouseholdRevision(db,member)
  assert.equal(await rev(db,owner),2)
  assert.equal(await rev(db,other),0)
  const response=await syncStateRoute(new Request('https://example.invalid/api/sync/state',{method:'POST'}),db,owner)
  assert.equal(response.status,405)
  assert.equal(await householdRevision(db,'shared'),2)
 }finally{sqlite.close()}
})
test('a shared edit invalidates the cached Today snapshot for both accounts',async()=>{
 const {db,sqlite}=dbFixture()
 try{
  const date='2026-11-06',id='00000000-0000-4000-8000-000000000001'
  sqlite.prepare('INSERT INTO tasks(id,household_id,creator_user_id,visibility,title,due_on) VALUES(?,?,?,?,?,?)')
   .run(id,'shared','alice','household','准备晚饭',date)
  const page=async user=>{
   const response=await todayPageRoute(new Request('https://example.invalid/api/today/page?date='+date),db,user)
   assert.equal(response.status,200)
   return response.json()
  }
  assert.equal((await page(member)).items[0].title,'准备晚饭')
  sqlite.prepare('UPDATE tasks SET title=? WHERE id=?').run('准备好晚饭',id)
  // Before version bump the warmed snapshot intentionally remains unchanged.
  assert.equal((await page(member)).items[0].title,'准备晚饭')
  await bumpHouseholdRevision(db,owner)
  assert.equal((await page(member)).items[0].title,'准备好晚饭')
 }finally{sqlite.close()}
})
test('PWA refreshes when returning on the same day and when another family member edits',()=>{
 const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 const panel=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
 const worker=readFileSync(new URL('../worker/index.js',import.meta.url),'utf8')
 assert.match(app,/SHARED_SYNC_MS=25000/)
 assert.match(app,/window\.addEventListener\('focus',onForeground\)/)
 assert.match(app,/window\.setInterval\(syncTick,SHARED_SYNC_MS\)/)
 assert.match(app,/if\(tab\.value==='today'\)\{\s*void loadTodayPage\(true\)/)
 assert.match(app,/sharedRefreshCounter\.value\+\+/)
 assert.match(panel,/props\.syncRevision/)
 assert.match(worker,/response\.ok&&!?\['GET','HEAD','OPTIONS'\]/)
})

test('actual authenticated Worker writes by either family account advance the other account sync revision',async()=>{
 const {db,sqlite}=dbFixture()
 const origin='https://homeflow.example'
 const aliceToken='a'.repeat(64),bobToken='b'.repeat(64)
 const cookie=token=>'__Host-hf_session='+token
 const env={APP_ENV:'preview',DB:db}
 const request=(path,token,method='GET',body)=>new Request(origin+path,{
  method,headers:{cookie:cookie(token),...(method==='GET'?{}:{origin,
   'content-type':'application/json'})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 })
 const invoke=async(path,token,method='GET',body)=>{
  const response=await worker.fetch(request(path,token,method,body),env)
  return {status:response.status,body:await response.json()}
 }
 try{
  sqlite.exec("INSERT INTO environment_identity(key,database_name) VALUES('current','homeflow-preview')")
  sqlite.exec("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)")
  sqlite.exec("INSERT INTO d1_migrations(name) VALUES('0028_explicit_today_actions.sql')")
  sqlite.exec("INSERT INTO d1_migrations(name) VALUES('0029_household_revisions.sql')")
  sqlite.exec("INSERT INTO d1_migrations(name) VALUES('0030_member_revisions.sql')")
  sqlite.exec("INSERT INTO households(id,display_name) VALUES('shared','Home')")
  for(const name of ['alice','bob']){
   sqlite.prepare('INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES(?,?,?,?)')
     .run(name,name,'salt','verifier')
   sqlite.prepare('INSERT INTO household_members(household_id,user_id,role) VALUES(?,?,?)')
     .run('shared',name,name==='alice'?'owner':'member')
  }
  for(const [name,token] of [['alice',aliceToken],['bob',bobToken]]){
   const hash=await sha256(token)
   sqlite.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
     .run(hash,name,Date.now()+3600000)
  }
  assert.equal((await invoke('/api/sync/state',aliceToken)).body.revision,0)
  assert.equal((await invoke('/api/sync/state',bobToken)).body.revision,0)
  const created=await invoke('/api/tasks',aliceToken,'POST',{
   title:'家里买牛奶',visibility:'household',dueOn:'2026-11-06'
  })
  assert.equal(created.status,201,JSON.stringify(created))
  assert.equal((await invoke('/api/sync/state',bobToken)).body.revision,1)
  const visible=await invoke('/api/today/page?date=2026-11-06',bobToken)
  assert.equal(visible.status,200)
  assert.ok(visible.body.items.some(item=>item.title==='家里买牛奶'))
  const rejected=await invoke('/api/tasks',aliceToken,'POST',{
   title:'',visibility:'household',dueOn:'2026-11-06'
  })
  assert.equal(rejected.status,400)
  assert.equal((await invoke('/api/sync/state',bobToken)).body.revision,1,
   'a rejected mutation must not invalidate remote clients')
  const privateTask=await invoke('/api/tasks',bobToken,'POST',{
   title:'私人安排',visibility:'private',dueOn:'2026-11-06'
  })
  assert.equal(privateTask.status,201)
  assert.equal((await invoke('/api/sync/state',aliceToken)).body.revision,2)
  const alicePage=await invoke('/api/today/page?date=2026-11-06',aliceToken)
  assert.equal(alicePage.status,200)
  assert.ok(alicePage.body.items.some(item=>item.title==='家里买牛奶'))
  assert.ok(!alicePage.body.items.some(item=>item.title==='私人安排'))
 }finally{sqlite.close()}
})

test('successful 06:00 system notifications advance only affected household revisions',async()=>{
 const {db,sqlite}=dbFixture()
 try{
  const date=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
  sqlite.exec("INSERT INTO environment_identity(key,database_name) VALUES('current','homeflow-preview')")
  sqlite.exec("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)")
  sqlite.exec("INSERT INTO d1_migrations(name) VALUES('0028_explicit_today_actions.sql')")
  sqlite.exec("INSERT INTO d1_migrations(name) VALUES('0029_household_revisions.sql')")
  sqlite.exec("INSERT INTO d1_migrations(name) VALUES('0030_member_revisions.sql')")
  sqlite.exec("INSERT INTO households(id,display_name) VALUES('shared','Home'),('other','Unchanged')")
  sqlite.exec("INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES('alice','alice','salt','verifier')")
  sqlite.exec("INSERT INTO household_members(household_id,user_id,role) VALUES('shared','alice','owner')")
  sqlite.prepare('INSERT INTO tasks(id,household_id,creator_user_id,visibility,title,due_on) VALUES(?,?,?,?,?,?)')
    .run('00000000-0000-4000-8000-000000000001','shared','alice','household','重要任务',date)
  const waiters=[]
  await worker.scheduled({}, {APP_ENV:'preview',DB:db}, {waitUntil(p){waiters.push(p)}})
  await Promise.all(waiters)
  const sent=sqlite.prepare('SELECT COUNT(*) n FROM notification_inbox').get().n
  assert.ok(sent>0,'scheduled reminder creates an in-app notice')
  assert.equal(await rev(db,owner),1,'changed household is invalidated')
  assert.equal(await rev(db,other),0,'unaffected household is not invalidated')
 }finally{sqlite.close()}
})
test('legacy JSON backup reports overflow instead of silently truncating source data',async()=>{
 const {db,sqlite}=dbFixture()
 try{
  const insert=sqlite.prepare('INSERT INTO tasks(id,household_id,creator_user_id,visibility,title,due_on) VALUES(?,?,?,?,?,?)')
  for(let i=0;i<1001;i++)
   insert.run('00000000-0000-4000-8000-'+String(i).padStart(12,'0'),
      'shared','alice','household','任务'+i,'2026-11-06')
  const response=await backupRoute(new Request('https://homeflow.invalid/api/export'),db,owner)
  assert.equal(response.status,413)
  const body=await response.json()
  assert.equal(body.error,'export_pagination_required')
  assert.ok(body.datasets.includes('tasks'))
 }finally{sqlite.close()}
})
test('the remote revision is confirmed only after visible page and plans succeed',()=>{
 const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
 const acknowledge=app.lastIndexOf('syncRevision.value=version',app.indexOf('function onOnline()'))
 const page=app.indexOf('await loadTodayPage(true)',app.indexOf('async function checkRemoteChanges'))
 const panel=app.indexOf('await panel.refreshForSync()',app.indexOf('async function checkRemoteChanges'))
 assert.ok(page>=0&&panel>page&&acknowledge>panel,'no early acknowledgment')
 assert.match(life,/defineExpose\(\{refreshForSync:\(\)=>fetchMode\(\)\}\)/)
 assert.match(app,/stale_cursor/)
})
 
test('personal notification and reminder changes never advance the other member household revision',async()=>{
 const {db,sqlite}=dbFixture()
 try{
  assert.equal((await syncStateRoute(new Request('https://example.invalid/api/sync/state'),db,owner)).status,200)
  await bumpMemberRevision(db,owner)
  const alice=await (await syncStateRoute(new Request('https://example.invalid/api/sync/state'),db,owner)).json()
  const bob=await (await syncStateRoute(new Request('https://example.invalid/api/sync/state'),db,member)).json()
  assert.deepEqual(alice,{revision:0,personalRevision:1})
  assert.deepEqual(bob,{revision:0,personalRevision:0})
  await bumpMemberRevision(db,member)
  assert.deepEqual(await (await syncStateRoute(new Request('https://example.invalid/api/sync/state'),db,member)).json(),
    {revision:0,personalRevision:1})
  await bumpHouseholdRevision(db,owner)
  assert.equal(await rev(db,member),1)
  for(const path of ['/api/notifications/00000000-0000-4000-8000-000000000001/read',
    '/api/notifications/00000000-0000-4000-8000-000000000001/unread',
    '/api/reminders/snooze','/api/reminders/preferences','/api/reminders/item','/api/push/subscriptions'])
    assert.equal(personalMutation(path),true,path)
  for(const path of ['/api/tasks','/api/tasks/00000000-0000-4000-8000-000000000001',
    '/api/plans/today-action','/api/push/send-task','/api/push/send-family'])
    assert.equal(personalMutation(path),false,path)
 }finally{sqlite.close()}
})
test('client detects member-only changes without reloading the partner plan list',()=>{
 const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 const idx=app.indexOf('async function checkRemoteChanges(){')
 const segment=app.slice(idx,app.indexOf('function onOnline(){',idx))
 assert.match(segment,/const sharedDirty=/)
 assert.match(segment,/const personalDirty=/)
 assert.match(segment,/if\(sharedDirty\)\{/)
 assert.match(segment,/if\(personalDirty\)\{/)
 assert.match(segment,/await api\('\/notifications\/badge'\)/)
 assert.match(segment,/syncPersonalRevision\.value=personalVersion/)
 assert.match(app,/<ManagePage :key="user\.id\+':'\+manageRevisionCounter"/)
})
