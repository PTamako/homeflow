import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {pointLevel,pointsRoute,tokyoMonthWindow} from '../worker/points.js'

const migration=readFileSync(new URL('../migrations/0033_completion_points.sql',import.meta.url),'utf8')
function fixture(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE households (id TEXT PRIMARY KEY);
  CREATE TABLE users (id TEXT PRIMARY KEY,login_name TEXT NOT NULL);
  CREATE TABLE household_members (household_id TEXT NOT NULL,user_id TEXT NOT NULL);
  CREATE TABLE family_profiles (household_id TEXT,member_user_id TEXT,display_name TEXT,archived_at TEXT,created_at TEXT);
  CREATE TABLE tasks (id TEXT PRIMARY KEY,household_id TEXT NOT NULL,creator_user_id TEXT,
    completed_at TEXT,completed_by TEXT,visibility TEXT NOT NULL,deleted_at TEXT);
  CREATE TABLE routines (id TEXT PRIMARY KEY,household_id TEXT NOT NULL,created_by TEXT,
    visibility TEXT NOT NULL,deleted_at TEXT);
  CREATE TABLE routine_marks (routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    occurrence_on TEXT NOT NULL,completed_at TEXT,completed_by TEXT,skipped_at TEXT,
    PRIMARY KEY(routine_id,occurrence_on));
  INSERT INTO households(id) VALUES ('family'),('other');
  INSERT INTO users(id,login_name) VALUES ('alice','alice'),('bob','bob'),('other','other');
  INSERT INTO household_members VALUES ('family','alice'),('family','bob'),('other','other');
  INSERT INTO family_profiles VALUES ('family','alice','小白',NULL,'2026-11-01');
  INSERT INTO family_profiles VALUES ('family','bob','鸡毛',NULL,'2026-11-01');
  INSERT INTO tasks VALUES('old','family','alice','2026-11-01T00:00:00Z','alice','household',NULL);
  INSERT INTO routines VALUES('routine-1','family','alice','household',NULL);
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
  assert.deepEqual(rows(sqlite),[])
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'points_%'").get().n,10)
 }finally{sqlite.close()}
})

test('who finishes gets all 10 points, and retry, reopen, skip and change of completer are safe',()=>{
 const {sqlite}=fixture()
 try{
  sqlite.exec(migration)
  sqlite.exec("INSERT INTO tasks VALUES('task-1','family','alice',NULL,NULL,'household',NULL)")
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

test('leaderboard never reveals another member\'s private completions or another household',async()=>{
 const {sqlite,db}=fixture()
 try{
  sqlite.exec(migration)
  sqlite.exec("INSERT INTO tasks VALUES('shared','family','alice',NULL,NULL,'household',NULL)")
  sqlite.exec("UPDATE tasks SET completed_at='2026-11-07T03:00:00Z',completed_by='bob' WHERE id='shared'")
  sqlite.exec("INSERT INTO tasks VALUES('private','family','bob',NULL,NULL,'private',NULL)")
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
 assert.match(board,/私人积分仅自己可见/)
 assert.match(board,/周期任务均计分/)
 assert.match(migration,/NEW\.completed_by/)
 assert.doesNotMatch(migration,/NEW\.created_by.*points/)
})
