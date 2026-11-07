import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {pointsRoute} from '../worker/points.js'
import {contributionAssignmentDeltaSql} from '../worker/contribution.js'

const manifest=readFileSync(new URL('../scripts/check_migrations.py',import.meta.url),'utf8')
const names=[...manifest.slice(manifest.indexOf('MIGRATIONS=['),manifest.indexOf(']\nfiles='))
  .matchAll(/"(\d{4}_[^"]+\.sql)"/g)].map(x=>x[1])
const now=()=>new Date().toISOString()
function fixture(){
 const db=new DatabaseSync(':memory:')
 db.exec('PRAGMA foreign_keys=ON')
 for(const filename of names)db.exec(readFileSync(new URL('../migrations/'+filename,import.meta.url),'utf8'))
 db.exec(`INSERT INTO households(id,display_name) VALUES('h','Family');
  INSERT INTO users(id,login_name,password_salt,password_verifier)
   VALUES('alice','alice','salt','proof'),('bob','bob','salt','proof');
  INSERT INTO household_members(household_id,user_id,role)
   VALUES('h','alice','owner'),('h','bob','member');`)
 const store={prepare(sql){const q=db.prepare(sql);let params=[];return{
  bind(...values){params=values;return this},
  async first(){return q.get(...params)||null},
  async all(){return {results:q.all(...params)}},
  async run(){return {meta:{changes:Number(q.run(...params).changes)}}}
 }}}
 const score=async()=>{const response=await pointsRoute(new Request('https://homeflow.invalid/api/points'),store,
   {household_id:'h',user_id:'alice'});assert.equal(response.status,200);return response.json()}
 const members=async()=>{const r=await score();return Object.fromEntries(r.members.map(m=>[m.userId,m]))}
 return {db,score,members}
}
function addTask(db,id,creator,first=null,second=null,visibility='household',bonus=0){
 db.prepare(`INSERT INTO tasks
 (id,household_id,creator_user_id,assignee_user_id,second_assignee_user_id,
  visibility,title,bonus_points) VALUES(?1,'h',?2,?3,?4,?5,?1,?6)`)
  .run(id,creator,first,second,visibility,bonus)
}
function complete(db,id,who){
 db.prepare('UPDATE tasks SET completed_at=?1,completed_by=?2 WHERE id=?3')
  .run(now(),who,id)
}
function reopen(db,id){
 db.prepare('UPDATE tasks SET completed_at=NULL,completed_by=NULL WHERE id=?1').run(id)
}
test('contribution counts weekly household bonuses but not lottery or redemptions',async()=>{
 const {db,members}=fixture()
 try{
  for(let i=0;i<10;i++){addTask(db,'work-'+i,'alice');complete(db,'work-'+i,'alice')}
  const before=await members()
  assert.ok(before.alice.sharedPoints>=130,'10 completions and weekly challenge are contributors')
  assert.equal(before.alice.monthPoints,before.alice.sharedPoints)
  db.prepare(`INSERT INTO household_lottery_draws
    (id,household_id,user_id,client_request_id,month_on,prize_kind,cost_points,prize_points,created_at)
    VALUES('draw','h','alice','draw-key',?1,'fifty',5,50,?2)`)
    .run(new Date(Date.now()+9*3600000).toISOString().slice(0,7),now())
  const after=await members()
  assert.equal(after.alice.sharedPoints,before.alice.sharedPoints)
  assert.equal(after.alice.monthPoints,before.alice.monthPoints)
  assert.equal(after.alice.availablePoints,before.alice.availablePoints+45)
  addTask(db,'private-1','alice',null,null,'private')
  complete(db,'private-1','alice')
  assert.equal((await members()).alice.sharedPoints,before.alice.sharedPoints)
 }finally{db.close()}
})
test('paid assignment moves contribution on completion, undo reverses it; pending reserves only the wallet',async()=>{
 const {db,members}=fixture()
 try{
  addTask(db,'seed','alice');complete(db,'seed','alice')
  addTask(db,'bob-seed','bob');complete(db,'bob-seed','bob')
  const baseline=await members()
  addTask(db,'assigned','alice','bob',null,'household',8)
  const pending=await members()
  assert.equal(pending.alice.sharedPoints,baseline.alice.sharedPoints)
  assert.equal(pending.alice.availablePoints,baseline.alice.availablePoints-8)
  complete(db,'assigned','bob')
  const completed=await members()
  assert.equal(completed.alice.sharedPoints,baseline.alice.sharedPoints-8)
  assert.equal(completed.bob.sharedPoints,baseline.bob.sharedPoints+13,'base 5 + bounty 8')
  assert.equal(completed.bob.monthPoints,completed.bob.sharedPoints)
  reopen(db,'assigned')
  const undone=await members()
  assert.equal(undone.alice.sharedPoints,baseline.alice.sharedPoints)
  assert.equal(undone.bob.sharedPoints,baseline.bob.sharedPoints)
  assert.equal(undone.alice.availablePoints,baseline.alice.availablePoints-8)
 }finally{db.close()}
})
test('two named assignees share base and funded bounty; total household contribution never mints gift points',async()=>{
 const {db,members}=fixture()
 try{
  addTask(db,'seed','alice');complete(db,'seed','alice')
  addTask(db,'bob-seed','bob');complete(db,'bob-seed','bob')
  const baseline=await members()
  addTask(db,'team','alice','alice','bob','household',8)
  complete(db,'team','bob')
  const after=await members()
  assert.equal(after.alice.sharedPoints-baseline.alice.sharedPoints,2.5-4,'creator pays 8 and receives 4 bounty plus 2.5 base')
  assert.equal(after.bob.sharedPoints-baseline.bob.sharedPoints,2.5+4)
  assert.equal(after.alice.sharedPoints+after.bob.sharedPoints-
    baseline.alice.sharedPoints-baseline.bob.sharedPoints,5)
  reopen(db,'team')
  const undone=await members()
  assert.equal(undone.alice.sharedPoints,baseline.alice.sharedPoints)
  assert.equal(undone.bob.sharedPoints,baseline.bob.sharedPoints)
 }finally{db.close()}
})
test('assignment transfer SQL supports month window as well as lifetime',()=>{
 const sql=contributionAssignmentDeltaSql('?1','?2','?3','?4')
 assert.match(sql,/t\.completed_at>=\?3/)
 assert.match(sql,/m\.completed_at>=\?3/)
 assert.match(sql,/t\.completed_by IN/)
})
