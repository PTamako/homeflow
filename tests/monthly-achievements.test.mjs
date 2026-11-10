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
 return db.prepare('SELECT month_on,badge_id,points FROM monthly_achievement_credits WHERE user_id=? ORDER BY month_on,badge_id').all(who)
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
  for(let i=0;i<20;i++){ // below the new 30-task master threshold
   const day=lastDate.slice(0,7)+'-'+String(1+Math.floor(i/4)*7).padStart(2,'0')
   insert(db,{id:'prior-'+i,day})
  }
  assert.equal(awards(db).filter(x=>x.month_on===lastDate.slice(0,7)).reduce((sum,x)=>sum+x.points,0),5,
    'prior-month first/master/challenge badges are independent of this month')
  const day=month+'-03'
  insert(db,{id:'current-0',day})
  let current=await score(store)
  assert.equal(current.month,month)
  assert.equal(current.badges.find(x=>x.id==='first').unlocked,true)
  assert.equal(current.badges.find(x=>x.id==='master').unlocked,false,
    'previous month completions do not carry into a new month')
  assert.equal(current.badges.find(x=>x.id==='first').rewardPoints,5)
  assert.equal(current.members[0].monthPoints,10)
  assert.equal(current.achievementBonusPoints,10)
  insert(db,{id:'current-0',day})
  assert.equal(awards(db).filter(x=>x.month_on===month&&x.badge_id==='first').length,1,
    'a duplicate completion never grants a second badge')
  db.prepare("DELETE FROM completion_points WHERE source_id='current-0'").run()
  current=await score(store)
  assert.equal(current.badges.find(x=>x.id==='first').unlocked,false,
    'undo re-locks only the active-month badge')
  assert.equal(current.achievementBonusPoints,5,'only revoked month reward is deducted')
  assert.equal(awards(db).filter(x=>x.month_on===lastDate.slice(0,7)).length,1)
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
  assert.equal(data.achievementBonusPoints,20,'first 5 plus weekly-win 15')
  assert.equal(data.availablePoints,100,'50 base +30 weekly +20 monthly')
  db.prepare("DELETE FROM completion_points WHERE source_id='shared-0'").run()
  data=await score(store)
  assert.equal(data.weeklyBonusPoints,0)
  assert.equal(data.achievementBonusPoints,5,'weekly badge is revoked below threshold')
  assert.equal(data.availablePoints,50)
  assert.equal((await score(store,'bob')).achievementBonusPoints,0)
 }finally{db.close()}
})

test('fourteen consecutive JST days unlock streak bonus; removing a day re-locks it',async()=>{
 const {db,store}=fixture()
 try{
  const month=tokyoMonthWindow().month
  for(let day=1;day<=14;day++)insert(db,{
    id:'streak-'+day,day:month+'-'+String(day).padStart(2,'0')
  })
  let data=await score(store)
  assert.equal(data.badges.find(x=>x.id==='streak').unlocked,true)
  assert.equal(data.badges.find(x=>x.id==='streak').progress,14)
  assert.equal(data.achievementBonusPoints,30,'first 5 plus fourteen-day streak 25')
  db.prepare("DELETE FROM completion_points WHERE source_id='streak-4'").run()
  data=await score(store)
  assert.equal(data.badges.find(x=>x.id==='streak').unlocked,false)
  assert.equal(data.achievementBonusPoints,5)
 }finally{db.close()}
})

test('pet guardian grants 25 points only after fifteen household pet-care completions',async()=>{
 const {db,store}=fixture()
 try{
  const month=tokyoMonthWindow().month
  db.prepare("INSERT INTO family_profiles(id,household_id,type,display_name) VALUES('pet','h','pet','豆沙')").run()
  const addTask=db.prepare(`INSERT INTO tasks
   (id,household_id,creator_user_id,subject_profile_id,visibility,title)
   VALUES(?1,'h','alice','pet','household',?2)`)
  for(let i=0;i<15;i++){
   addTask.run('pet-task-'+i,'护理 '+i)
   insert(db,{id:'pet-task-'+i,day:month+'-03'})
   if(i===13){
     const before=await score(store)
     assert.equal(before.badges.find(x=>x.id==='pet').unlocked,false)
     assert.equal(before.badges.find(x=>x.id==='pet').progress,14)
   }
  }
  let data=await score(store)
  assert.equal(data.badges.find(x=>x.id==='pet').unlocked,true)
  assert.equal(data.badges.find(x=>x.id==='pet').rewardPoints,25)
  assert.equal(data.achievementBonusPoints,45,'first 5 + challenge 15 + pet 25')
  db.prepare("DELETE FROM completion_points WHERE source_id='pet-task-14'").run()
  data=await score(store)
  assert.equal(data.badges.find(x=>x.id==='pet').unlocked,false)
  assert.equal(data.achievementBonusPoints,20,'undo revokes pet badge while retaining weekly challenge')
 }finally{db.close()}
})

test('six earned legacy badges pay exactly 100 effective points, without rewriting history',async()=>{
 const {db,store}=fixture()
 try{
  const stamp='2026-10-10T00:00:00.000Z'
  const rows=[['first',5,5],['routines',15,10],['challenge',20,15],
   ['master',35,20],['pet',45,25],['streak',60,25]]
  const insert=db.prepare(`INSERT INTO monthly_achievement_awards
   (household_id,user_id,month_on,badge_id,points,awarded_at)
   VALUES('h','alice','2026-10',?1,?2,?3)`)
  for(const [badge,oldAmount] of rows)insert.run(badge,oldAmount,stamp)
  const raw=db.prepare(`SELECT SUM(points) AS total FROM monthly_achievement_awards`).get()
  assert.equal(raw.total,180,'original immutable badge history is preserved')
  const credits=db.prepare(`SELECT badge_id,points FROM monthly_achievement_credits ORDER BY badge_id`).all()
  assert.equal(credits.reduce((sum,row)=>sum+row.points,0),100)
  for(const [badge,,newAmount] of rows)
    assert.equal(credits.find(row=>row.badge_id===badge).points,newAmount)
  const scored=await score(store)
  assert.equal(scored.achievementBonusPoints,100)
  assert.equal(scored.availablePoints,100)
  assert.equal(scored.experience,100)
  assert.equal(credits.length,6,'no duplicated award rows after migration')
 }finally{db.close()}
})


test('household master requires 30 shared task completions; undo immediately revokes it',async()=>{
 const {db,store}=fixture()
 try{
  const month=tokyoMonthWindow().month
  for(let i=0;i<29;i++)insert(db,{id:'master-'+i,day:month+'-02'})
  let result=await score(store)
  let badge=result.badges.find(b=>b.id==='master')
  assert.equal(badge.target,30)
  assert.equal(badge.progress,29)
  assert.equal(badge.unlocked,false)
  insert(db,{id:'master-29',day:month+'-02'})
  result=await score(store)
  badge=result.badges.find(b=>b.id==='master')
  assert.equal(badge.progress,30)
  assert.equal(badge.unlocked,true)
  assert.equal(badge.rewardPoints,20)
  db.prepare("DELETE FROM completion_points WHERE source_id='master-29'").run()
  assert.equal((await score(store)).badges.find(b=>b.id==='master').unlocked,false)
 }finally{db.close()}
})

test('migration rechecks only this month and preserves old monthly awards history',async()=>{
 const legacyNames=names.filter(n=>n!=='0052_achievement_thresholds.sql')
 const db=new DatabaseSync(':memory:')
 try{
  db.exec('PRAGMA foreign_keys=ON')
  for(const file of legacyNames)
   db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'))
  db.exec(`INSERT INTO households(id,display_name) VALUES('h','Family');
   INSERT INTO users(id,login_name,password_salt,password_verifier)
   VALUES('alice','alice','salt','verifier');
   INSERT INTO household_members(household_id,user_id,role) VALUES('h','alice','owner');`)
  const month=tokyoMonthWindow().month
  for(let i=0;i<20;i++)insert(db,{id:'old-master-'+i,day:month+'-02'})
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM monthly_achievement_awards WHERE badge_id='master' AND month_on=?").get(month).n,1)
  db.prepare(`INSERT INTO monthly_achievement_awards
    (household_id,user_id,month_on,badge_id,points,awarded_at)
    VALUES('h','alice','2026-01','streak',60,'2026-01-14T00:00:00Z')`).run()
  const oldCount=db.prepare("SELECT COUNT(*) AS n FROM monthly_achievement_awards WHERE month_on='2026-01'").get().n
  db.exec(readFileSync(new URL('../migrations/0052_achievement_thresholds.sql',import.meta.url),'utf8'))
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM monthly_achievement_awards WHERE badge_id='master' AND month_on=?").get(month).n,0)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM monthly_achievement_awards WHERE month_on='2026-01'").get().n,oldCount)
  for(let i=20;i<30;i++)insert(db,{id:'new-master-'+i,day:month+'-02'})
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM monthly_achievement_awards WHERE badge_id='master' AND month_on=?").get(month).n,1)
  db.prepare("DELETE FROM completion_points WHERE source_id='new-master-29'").run()
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM monthly_achievement_awards WHERE badge_id='master' AND month_on=?").get(month).n,0)
 }finally{db.close()}
})
