import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {householdRevision,syncStateRoute,bumpHouseholdRevision} from '../worker/sync.js'
import {todayPageRoute} from '../worker/today-page.js'

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
 '0029_household_revisions.sql']
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
