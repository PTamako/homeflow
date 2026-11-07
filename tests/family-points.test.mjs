import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {pointLevel,pointsRoute,tokyoMonthWindow,tokyoWeekWindow,longestStreak} from '../worker/points.js'

const migration=readFileSync(new URL('../migrations/0033_completion_points.sql',import.meta.url),'utf8')
const rewardsMigration=readFileSync(new URL('../migrations/0034_rewards_shop.sql',import.meta.url),'utf8')
const householdRewardsMigration=readFileSync(new URL('../migrations/0035_household_rewards_only.sql',import.meta.url),'utf8')
const scoringMigration=readFileSync(new URL('../migrations/0036_plan_scoring.sql',import.meta.url),'utf8')
function fixture(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE households (id TEXT PRIMARY KEY);
  CREATE TABLE users (id TEXT PRIMARY KEY,login_name TEXT NOT NULL);
  CREATE TABLE household_members (household_id TEXT NOT NULL,user_id TEXT NOT NULL);
  CREATE TABLE family_profiles (household_id TEXT,member_user_id TEXT,display_name TEXT,archived_at TEXT,created_at TEXT,type TEXT NOT NULL DEFAULT 'person',id TEXT);
  CREATE TABLE tasks (id TEXT PRIMARY KEY,household_id TEXT NOT NULL,creator_user_id TEXT,
    completed_at TEXT,completed_by TEXT,visibility TEXT NOT NULL,deleted_at TEXT,subject_profile_id TEXT);
  CREATE TABLE shopping_items(id TEXT PRIMARY KEY,household_id TEXT NOT NULL,visibility TEXT NOT NULL,
    completed_at TEXT,completed_by TEXT,deleted_at TEXT);
  CREATE TABLE routines (id TEXT PRIMARY KEY,household_id TEXT NOT NULL,created_by TEXT,
    visibility TEXT NOT NULL,deleted_at TEXT,subject_profile_id TEXT);
  CREATE TABLE routine_marks (routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    occurrence_on TEXT NOT NULL,completed_at TEXT,completed_by TEXT,skipped_at TEXT,
    PRIMARY KEY(routine_id,occurrence_on));
  INSERT INTO households(id) VALUES ('family'),('other');
  INSERT INTO users(id,login_name) VALUES ('alice','alice'),('bob','bob'),('other','other');
  INSERT INTO household_members VALUES ('family','alice'),('family','bob'),('other','other');
  INSERT INTO family_profiles(household_id,member_user_id,display_name,archived_at,created_at) VALUES ('family','alice','小白',NULL,'2026-11-01');
  INSERT INTO family_profiles(household_id,member_user_id,display_name,archived_at,created_at) VALUES ('family','bob','鸡毛',NULL,'2026-11-01');
  INSERT INTO tasks(id,household_id,creator_user_id,completed_at,completed_by,visibility,deleted_at) VALUES('old','family','alice','2026-11-01T00:00:00Z','alice','household',NULL);
  INSERT INTO routines(id,household_id,created_by,visibility,deleted_at) VALUES('routine-1','family','alice','household',NULL);
  INSERT INTO routine_marks VALUES('routine-1','2026-11-01','2026-11-01T00:00:00Z','alice',NULL);
 `)
 const db={prepare(sql){
  const q=sqlite.prepare(sql);let args=[]
  return {bind(...x){args=x;return this},
   async first(){return q.get(...args)||null},
   async all(){return {results:q.all(...args)}},
   async run(){const result=q.run(...args);return {meta:{changes:Number(result.changes)}}}}
 }}
 return {db,sqlite}
}
const rows=sqlite=>sqlite.prepare('SELECT kind,source_id,occurrence_on,earner_user_id,visibility,points FROM completion_points ORDER BY source_id,occurrence_on').all()
const alice={household_id:'family',user_id:'alice',role:'owner'}
const bob={household_id:'family',user_id:'bob',role:'member'}
const get=async(db,person)=>{const response=await pointsRoute(new Request('https://homeflow.invalid/api/points'),db,person)
 assert.equal(response.status,200);return response.json()}

test('migration never awards points retroactively and has 10 immutable triggers',()=>{
 const {sqlite}=fixture()
 try{
  sqlite.exec(migration)
  sqlite.exec(rewardsMigration)
  sqlite.exec(householdRewardsMigration)
  sqlite.exec(scoringMigration)
  assert.deepEqual(rows(sqlite),[])
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'points_%'").get().n,17)
 }finally{sqlite.close()}
})

test('who finishes gets all 10 points, and retry, reopen, skip and change of completer are safe',()=>{
 const {sqlite}=fixture()
 try{
  sqlite.exec(migration)
  sqlite.exec(rewardsMigration)
  sqlite.exec(householdRewardsMigration)
  sqlite.exec(scoringMigration)
  sqlite.exec("INSERT INTO tasks(id,household_id,creator_user_id,completed_at,completed_by,visibility,deleted_at) VALUES('task-1','family','alice',NULL,NULL,'household',NULL)")
  sqlite.exec("UPDATE tasks SET completed_at='2026-11-07T03:00:00Z',completed_by='bob' WHERE id='task-1'")
  assert.equal(rows(sqlite).length,1)
  assert.equal(rows(sqlite)[0].earner_user_id,'bob')
  sqlite.exec("UPDATE tasks SET completed_at='2026-11-07T03:00:00Z',completed_by='bob' WHERE id='task-1'")
  assert.equal(rows(sqlite).length,1,'duplicate completion does not award twice')
  sqlite.exec("UPDATE tasks SET completed_at=NULL,completed_by=NULL WHERE id='task-1'")
  assert.equal(rows(sqlite).length,0,'undo removes points')
  sqlite.exec("UPDATE tasks SET completed_at='2026-11-07T03:01:00Z',completed_by='alice' WHERE id='task-1'")
  assert.equal(rows(sqlite)[0].earner_user_id,'alice','the new actual completer earns on re-completion')
  sqlite.exec("UPDATE tasks SET visibility='private' WHERE id='task-1'")
  assert.equal(rows(sqlite)[0].visibility,'private')
  sqlite.exec("DELETE FROM tasks WHERE id='task-1'")
  assert.equal(rows(sqlite).length,0,'permanent delete removes orphan points')
 }finally{sqlite.close()}
})

test('routine adds ten points for each distinct occurrence; skip is zero and undo revokes only that period',()=>{
 const {sqlite}=fixture()
 try{
  sqlite.exec(migration)
  sqlite.exec(rewardsMigration)
  sqlite.exec(householdRewardsMigration)
  sqlite.exec(scoringMigration)
  sqlite.exec("INSERT INTO routine_marks VALUES('routine-1','2026-11-07',NULL,NULL,'2026-11-07T01:00:00Z')")
  assert.deepEqual(rows(sqlite),[])
  sqlite.exec("INSERT INTO routine_marks VALUES('routine-1','2026-11-08','2026-11-08T03:00:00Z','bob',NULL)")
  sqlite.exec("INSERT INTO routine_marks VALUES('routine-1','2026-11-09',NULL,NULL,NULL)")
  sqlite.exec("UPDATE routine_marks SET completed_at='2026-11-09T03:00:00Z',completed_by='alice' WHERE occurrence_on='2026-11-09'")
  assert.equal(rows(sqlite).length,2,'two different recurrence instances both count')
  assert.deepEqual(rows(sqlite).map(x=>x.earner_user_id),['bob','alice'])
  sqlite.exec("UPDATE routine_marks SET completed_at='2026-11-09T03:01:00Z' WHERE occurrence_on='2026-11-09'")
  assert.equal(rows(sqlite).length,2,'same occurrence never earns again')
  sqlite.exec("UPDATE routine_marks SET completed_at=NULL,completed_by=NULL,skipped_at='2026-11-09T03:05:00Z' WHERE occurrence_on='2026-11-09'")
  assert.equal(rows(sqlite).length,1,'skip after completion revokes just that period')
  sqlite.exec("UPDATE routines SET visibility='private' WHERE id='routine-1'")
  assert.equal(rows(sqlite)[0].visibility,'private')
  sqlite.exec("DELETE FROM routines WHERE id='routine-1'")
  assert.equal(rows(sqlite).length,0,'hard delete cleans scores and mark records')
 }finally{sqlite.close()}
})

test('new plan scoring is 2/5/10, reserved bonus transfers only on actual completion',async()=>{
 const {sqlite,db}=fixture()
 try{
  sqlite.exec(migration);sqlite.exec(rewardsMigration);sqlite.exec(householdRewardsMigration);sqlite.exec(scoringMigration)
  const task=sqlite.prepare("INSERT INTO tasks(id,household_id,creator_user_id,completed_at,completed_by,visibility,deleted_at,subject_profile_id) VALUES(?1,'family','alice',NULL,NULL,'household',NULL,NULL)")
  task.run('open')
  sqlite.exec("UPDATE tasks SET completed_at='2026-11-07T03:00:00Z',completed_by='alice' WHERE id='open'")
  assert.equal((await get(db,alice)).earnedPoints,10,'unassigned one-off earns ten')
  task.run('self')
  sqlite.exec("UPDATE tasks SET assignee_user_id='alice',completed_at='2026-11-07T03:00:00Z',completed_by='alice' WHERE id='self'")
  assert.equal((await get(db,alice)).earnedPoints,15,'self assigned earns five')
  sqlite.exec("INSERT INTO routine_marks VALUES('routine-1','2026-11-10','2026-11-10T03:00:00Z','alice',NULL)")
  assert.equal((await get(db,alice)).earnedPoints,20,'routine occurrence earns five')
  sqlite.exec("INSERT INTO shopping_items(id,household_id,visibility) VALUES('shop','family','household')")
  sqlite.exec("UPDATE shopping_items SET completed_at='2026-11-07T03:00:00Z',completed_by='alice' WHERE id='shop'")
  assert.equal((await get(db,alice)).earnedPoints,22,'verified shopping is two')
  sqlite.exec("UPDATE shopping_items SET completed_at=NULL,completed_by=NULL WHERE id='shop'")
  assert.equal((await get(db,alice)).earnedPoints,20,'unlink last receipt revokes shopping points')
  task.run('reward')
  sqlite.exec("UPDATE tasks SET assignee_user_id='bob',bonus_points=10 WHERE id='reward'")
  assert.equal((await get(db,alice)).availablePoints,10,'ten creator points held while task is pending')
  sqlite.exec("UPDATE tasks SET completed_at='2026-11-07T03:00:00Z',completed_by='bob' WHERE id='reward'")
  assert.equal((await get(db,bob)).earnedPoints,5,'assignee gets base five')
  assert.equal((await get(db,bob)).availablePoints,15,'assignee also receives ten from creator')
  assert.equal((await get(db,alice)).availablePoints,10,'transfer does not mint extra points')
  sqlite.exec("UPDATE tasks SET completed_at=NULL,completed_by=NULL WHERE id='reward'")
  assert.equal((await get(db,bob)).availablePoints,0,'undo revokes both base and transferred points')
  assert.equal((await get(db,alice)).availablePoints,10,'creator pledge remains reserved until cancellation')
  sqlite.exec("UPDATE tasks SET deleted_at='2026-11-07T03:00:00Z' WHERE id='reward'")
  assert.equal((await get(db,alice)).availablePoints,20,'deleted task releases reserved bonus')
 }finally{sqlite.close()}
})

test('pet guardian badge needs ten linked pet-care completions and relocks on undo',async()=>{
 const {sqlite,db}=fixture()
 try{
  sqlite.exec(migration)
  sqlite.exec(rewardsMigration)
  sqlite.exec(householdRewardsMigration)
  sqlite.exec(scoringMigration)
  sqlite.exec("INSERT INTO family_profiles(id,household_id,type,display_name,created_at) VALUES('pet-1','family','pet','豆沙','2026-11-07')")
  const insert=sqlite.prepare("INSERT INTO tasks(id,household_id,creator_user_id,completed_at,completed_by,visibility,deleted_at,subject_profile_id) VALUES(?1,'family','alice',NULL,NULL,'household',NULL,'pet-1')")
  const complete=sqlite.prepare("UPDATE tasks SET completed_at='2026-11-07T03:00:00Z',completed_by='alice' WHERE id=?1")
  for(let i=1;i<=9;i++){
   insert.run('care-'+i)
   complete.run('care-'+i)
  }
  assert.equal((await get(db,alice)).badges.find(x=>x.id==='pet').unlocked,false,'9 pet care completions must not unlock')
  insert.run('care-10')
  complete.run('care-10')
  assert.equal((await get(db,alice)).badges.find(x=>x.id==='pet').unlocked,true,'10 pet care completions unlock')
  assert.equal((await get(db,bob)).badges.find(x=>x.id==='pet').unlocked,false,'the badge belongs to the actual completer')
  sqlite.exec("UPDATE tasks SET completed_at=NULL,completed_by=NULL WHERE id='care-10'")
  assert.equal((await get(db,alice)).badges.find(x=>x.id==='pet').unlocked,false,'undoing one completion revokes the badge')
 }finally{sqlite.close()}
})

test('leaderboard never reveals another member\'s private completions or another household',async()=>{
 const {sqlite,db}=fixture()
 try{
  sqlite.exec(migration)
  sqlite.exec(rewardsMigration)
  sqlite.exec(householdRewardsMigration)
  sqlite.exec(scoringMigration)
  sqlite.exec("INSERT INTO tasks(id,household_id,creator_user_id,completed_at,completed_by,visibility,deleted_at) VALUES('shared','family','alice',NULL,NULL,'household',NULL)")
  sqlite.exec("UPDATE tasks SET completed_at='2026-11-07T03:00:00Z',completed_by='bob' WHERE id='shared'")
  sqlite.exec("INSERT INTO tasks(id,household_id,creator_user_id,completed_at,completed_by,visibility,deleted_at) VALUES('private','family','bob',NULL,NULL,'private',NULL)")
  sqlite.exec("UPDATE tasks SET completed_at='2026-11-07T03:00:00Z',completed_by='bob' WHERE id='private'")
  const a=await get(db,alice),b=await get(db,bob)
  assert.equal(a.members.length,2)
  assert.equal(a.members.find(x=>x.userId==='bob').sharedPoints,10)
  assert.equal(a.members.find(x=>x.userId==='alice').sharedPoints,0)
  assert.equal(a.ownPrivatePoints,0)
  assert.equal(b.ownPrivatePoints,10)
  assert.equal(b.members.find(x=>x.userId==='bob').sharedPoints,10)
  assert.equal(b.members.find(x=>x.userId==='bob').routinePoints,0)
  assert.equal((await get(db,{household_id:'other',user_id:'other'})).members.length,1)
  assert.equal((await get(db,{household_id:'other',user_id:'other'})).members[0].sharedPoints,0)
 }finally{sqlite.close()}
})

test('level bands, monthly JST date boundaries and route allow read-only access',async()=>{
 assert.deepEqual(pointLevel(0),{level:1,title:'成长新手',progress:0,nextLevelIn:100})
 assert.equal(pointLevel(100).level,2)
 assert.equal(pointLevel(299).nextLevelIn,1)
 assert.equal(pointLevel(600).title,'家庭达人')
 const w=tokyoMonthWindow(Date.parse('2026-10-31T15:00:00Z'))
 assert.deepEqual(w,{month:'2026-11',begin:'2026-10-31T15:00:00.000Z',end:'2026-11-30T15:00:00.000Z'})
 const {sqlite,db}=fixture()
 try{
  sqlite.exec(migration)
  sqlite.exec(rewardsMigration)
  sqlite.exec(householdRewardsMigration)
  sqlite.exec(scoringMigration)
  const response=await pointsRoute(new Request('https://homeflow.invalid/api/points',{method:'POST'}),db,alice)
  assert.equal(response.status,405)
 }finally{sqlite.close()}
})

test('Family tab mounts a compact points panel and the server owns all awarding',()=>{
 const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 const index=readFileSync(new URL('../worker/index.js',import.meta.url),'utf8')
 const board=readFileSync(new URL('../src/components/HouseholdPoints.vue',import.meta.url),'utf8')
 assert.match(app,/<HouseholdPoints :active="tab==='family'"/)
 assert.match(index,/if\(path==='\/api\/points'\)return pointsRoute/)
 assert.match(board,/私人任务不进入共享榜/)
 assert.match(board,/周期任务每期都计分/)
 assert.match(migration,/NEW\.completed_by/)
 assert.doesNotMatch(migration,/NEW\.created_by.*points/)
})

test('family overview keeps store hidden by default and reveals it only on explicit tap',()=>{
 const source=readFileSync(new URL('../src/components/HouseholdPoints.vue',import.meta.url),'utf8')
 assert.match(source,/const expanded=ref\(false\)/)
 assert.match(source,/<button v-if="!expanded"[^>]+class="points-entry"/)
 assert.match(source,/@click="openDetails"/)
 assert.match(source,/<div v-if="expanded" id="points-expanded"/)
 assert.match(source,/@click="closeDetails"/)
 assert.match(source,/expanded\.value=false/)
 assert.match(source,/shop\.value=null/)
 assert.match(source,/if\(!expanded\.value\)[\s\S]*fetchJSON\('\/points'\)/)
 assert.match(source,/<template v-if="view==='shop'">/)
 assert.match(source,/\.reward-row\{display:grid;grid-template-columns:/)
 assert.match(source,/\.reward-buy\{grid-column:3;grid-row:1;/)
 assert.match(source,/\.reward-actions\{grid-column:2\/-1;grid-row:2;display:flex;/)
 assert.doesNotMatch(source,/\.reward-actions\{display:grid;/)
})

test('point rules are hidden behind an accessible title help popover on mobile',()=>{
 const source=readFileSync(new URL('../src/components/HouseholdPoints.vue',import.meta.url),'utf8')
 assert.match(source,/<h2 id="points-title">家庭成长积分<\/h2>/)
 assert.match(source,/class="points-rule-help" aria-label="查看积分规则"/)
 assert.match(source,/:aria-expanded="ruleHelpOpen"/)
 assert.match(source,/@click="ruleHelpOpen=!ruleHelpOpen"/)
 assert.match(source,/v-if="ruleHelpOpen" id="points-rule-popover" role="tooltip"/)
 assert.match(source,/普通待办和周期任务每期都计分；同一期不重复，跳过无分，撤销扣回。/)
 assert.doesNotMatch(source,/<p class="points-hint">普通待办和周期任务每期都计分/)
 assert.match(source,/document\.addEventListener\('pointerdown',dismissRulesOutside\)/)
 assert.match(source,/document\.removeEventListener\('pointerdown',dismissRulesOutside\)/)
 assert.match(source,/if\(event\.key==='Escape'\)\s*\{[\s\S]*ruleHelpOpen\.value=false[\s\S]*experienceHelpOpen\.value=false/)
 assert.match(source,/\.points-rule-popover\{position:absolute;/)
 assert.match(source,/\.points-rule-popover[\s\S]*z-index:20;/)
})

test('growth experience explanation is title help, not a persistent block',()=>{
 const source=readFileSync(new URL('../src/components/HouseholdPoints.vue',import.meta.url),'utf8')
 assert.match(source,/<small>我的成长经验<\/small>/)
 assert.match(source,/aria-label="查看成长经验规则"/)
 assert.match(source,/:aria-expanded="experienceHelpOpen"/)
 assert.match(source,/v-if="experienceHelpOpen" id="experience-rule-popover" role="tooltip"/)
 assert.match(source,/成长经验包含任务积分与挑战奖励，不会因兑换而减少；撤销任务会收回对应积分和未满足条件的奖励。/)
 assert.doesNotMatch(source,/<p class="points-hint">成长经验包含任务积分与挑战奖励/)
 assert.match(source,/const experienceHelpOpen=ref\(false\)/)
 assert.match(source,/experienceHelpOpen\.value=false/)
 assert.match(source,/if\(experienceHelpOpen\.value&&!experienceAnchor\.value\?\.contains/)
 assert.match(source,/\.xp-label\{position:relative;/)
})
