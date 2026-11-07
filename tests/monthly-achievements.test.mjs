import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {pointsRoute,tokyoMonthWindow} from '../worker/points.js'

const manifest=readFileSync(new URL('../scripts/check_migrations.py',import.meta.url),'utf8')
const names=[...manifest.slice(manifest.indexOf('MIGRATIONS=['),manifest.indexOf(']\nfiles='))
  .matchAll(/"(\d{4}_[^"]+\.sql)"/g)].map(x=>x[1])
const jstDate=(day)=>new Date(day+'T12:00:00+09:00').toISOString()
function fixture(){
 const db=new DatabaseSync(':memory:')
 db.exec('PRAGMA foreign_keys=ON')
 for(const name of names)db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'))
 db.exec(`INSERT INTO households(id,display_name) VALUES('h','Family');
 INSERT INTO users(id,login_name,password_salt,password_verifier)
 VALUES('alice','alice','salt','verifier'),('bob','bob','salt','verifier');
 INSERT INTO household_members(household_id,user_id,role)
 VALUES('h','alice','owner'),('h','bob','member');`)
 const store={prepare(sql){const q=db.prepare(sql);let values=[];return{
  bind(...x){values=x;return this},
  async first(){return q.get(...values)||null},
  async all(){return {results:q.all(...values)}},
  async run(){return {meta:{changes:Number(q.run(...values).changes)}}}
 }}}
 return {db,store}
}
function insert(db,{who='alice',kind='task',id,day,visibility='household'}){
 db.prepare(`INSERT OR IGNORE INTO completion_points
 (household_id,kind,source_id,occurrence_on,earner_user_id,visibility,points,earned_at)
 VALUES('h',?1,?2,'',?3,?4,10,?5)`)
  .run(kind,id,who,visibility,jstDate(day))
}
function awards(db,who='alice'){
 return db.prepare('SELECT month_on,badge_id,points FROM monthly_achievement_awards WHERE user_id=? ORDER BY month_on,badge_id').all(who)
}
async function score(store,who='alice'){
 const response=await pointsRoute(new Request('https://homeflow.invalid/api/points'),store,
  {household_id:'h',user_id:who})
 assert.equal(response.status,200)
 return response.json()
}
test('monthly achievement awards are graded, month-keyed and idempotent',async()=>{
 const {db,store}=fixture()
 try{
  const month=tokyoMonthWindow().month
  const lastDate=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7))-2,15))
    .toISOString().slice(0,10)
  for(let i=0;i<20;i++){
   const day=lastDate.slice(0,7)+'-'+String(1+Math.floor(i/4)*7).padStart(2,'0')
   insert(db,{id:'prior-'+i,day})
  }
  assert.equal(awards(db).filter(x=>x.month_on===lastDate.slice(0,7)).reduce((sum,x)=>sum+x.points,0),40,
    'prior-month first/master/challenge badges are independent of this month')
  const day=month+'-03'
  insert(db,{id:'current-0',day})
  let current=await score(store)
  assert.equal(current.month,month)
  assert.equal(current.badges.find(x=>x.id==='first').unlocked,true)
  assert.equal(current.badges.find(x=>x.id==='master').unlocked,false,
    'previous month completions do not carry into a new month')
  assert.equal(current.badges.find(x=>x.id==='first').rewardPoints,5)
  assert.equal(current.members[0].monthPoints,15)
  assert.equal(current.achievementBonusPoints,45)
  insert(db,{id:'current-0',day})
  assert.equal(awards(db).filter(x=>x.month_on===month&&x.badge_id==='first').length,1,
    'a duplicate completion never grants a second badge')
  db.prepare("DELETE FROM completion_points WHERE source_id='current-0'").run()
  current=await score(store)
  assert.equal(current.badges.find(x=>x.id==='first').unlocked,false,
    'undo re-locks only the active-month badge')
  assert.equal(current.achievementBonusPoints,40,'only revoked month reward is deducted')
  assert.equal(awards(db).filter(x=>x.month_on===lastDate.slice(0,7)).length,2)
 }finally{db.close()}
})
test('private completions earn XP, not monthly household awards, and weekly challenge is additionally rewarded',async()=>{
 const {db,store}=fixture()
 try{
  const month=tokyoMonthWindow().month,day=month+'-03'
  for(let i=0;i<12;i++)insert(db,{id:'private-'+i,day,visibility:'private'})
  assert.equal(awards(db).length,0)
  assert.equal((await score(store)).availablePoints,0)
  for(let i=0;i<10;i++)insert(db,{id:'shared-'+i,day})
  let data=await score(store)
  assert.equal(data.weeklyBonusPoints,30)
  assert.equal(data.achievementBonusPoints,25,'first 5 plus weekly-win 20')
  assert.equal(data.availablePoints,155,'100 base +30 weekly +25 monthly')
  db.prepare("DELETE FROM completion_points WHERE source_id='shared-0'").run()
  data=await score(store)
  assert.equal(data.weeklyBonusPoints,0)
  assert.equal(data.achievementBonusPoints,5,'weekly badge is revoked below threshold')
  assert.equal(data.availablePoints,95)
  assert.equal((await score(store,'bob')).achievementBonusPoints,0)
 }finally{db.close()}
})
