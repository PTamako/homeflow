import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {validated} from '../worker/tasks.js'

const root=new URL('../',import.meta.url)
const manifest=readFileSync(new URL('scripts/check_migrations.py',root),'utf8')
const list=manifest.slice(manifest.indexOf('MIGRATIONS=['),manifest.indexOf(']\nfiles='))
const migrations=[...list.matchAll(/"(\d{4}_[^"]+\.sql)"/g)].map(m=>m[1])
const last='0064_reminder_only_no_points.sql'
function fixture(){
 const db=new DatabaseSync(':memory:')
 db.exec('PRAGMA foreign_keys=ON')
 for(const name of migrations){
   if(name===last)break
   db.exec(readFileSync(new URL('migrations/'+name,root),'utf8'))
 }
 db.exec(`
   INSERT INTO households(id,display_name) VALUES('home','Home');
   INSERT INTO users(id,login_name,password_salt,password_verifier)
    VALUES('owner','owner','salt','verifier'),('member','member','salt','verifier');
   INSERT INTO household_members(household_id,user_id,role)
    VALUES('home','owner','owner'),('home','member','member');
 `)
 return db
}
function count(db,kind,id){
 return db.prepare("SELECT COUNT(*) AS count FROM completion_points WHERE kind=? AND source_id=?")
   .get(kind,id).count
}
function effective(db,id){
 return db.prepare(`SELECT COALESCE(SUM(c.points+a.delta),0) AS points
 FROM completion_points c
 LEFT JOIN completion_point_adjustments a
 ON c.household_id=a.household_id AND c.kind=a.kind
 AND c.source_id=a.source_id AND c.occurrence_on=a.occurrence_on
 WHERE c.source_id=?`).get(id).points
}
test('migration preserves history and reminder-only completion never grants points or achievements',()=>{
 const db=fixture()
 try{
   db.prepare("INSERT INTO tasks(id,household_id,creator_user_id,visibility,title) VALUES('old','home','owner','household','Old')").run()
   db.prepare("UPDATE tasks SET completed_at='2026-11-17T00:00:00Z',completed_by='owner' WHERE id='old'").run()
   assert.equal(effective(db,'old'),5)
   db.exec(readFileSync(new URL('migrations/'+last,root),'utf8'))
   assert.equal(effective(db,'old'),5,'historic points remain unchanged')
   assert.equal(db.prepare("SELECT reminder_only AS mode FROM tasks WHERE id='old'").get().mode,0)
   db.prepare(`INSERT INTO tasks(id,household_id,creator_user_id,visibility,title,reminder_only)
    VALUES('silent','home','owner','household','Only remind',1)`).run()
   db.prepare("UPDATE tasks SET completed_at='2026-11-17T04:00:00Z',completed_by='owner' WHERE id='silent'").run()
   assert.equal(count(db,'task','silent'),0)
   assert.equal(db.prepare("SELECT COUNT(*) AS c FROM monthly_achievement_awards WHERE user_id='owner'").get().c,1,
    'old completion already earned an achievement; reminder-only must not create another')
   db.prepare("UPDATE tasks SET completed_at=NULL,completed_by=NULL WHERE id='silent'").run()
   db.prepare("UPDATE tasks SET completed_at='2026-11-17T05:00:00Z',completed_by='owner' WHERE id='silent'").run()
   assert.equal(count(db,'task','silent'),0,'reopen and re-complete must remain zero')
   db.prepare(`INSERT INTO tasks(id,household_id,creator_user_id,visibility,title)
    VALUES('normal','home','owner','household','Normal')`).run()
   db.prepare("UPDATE tasks SET completed_at='2026-11-17T06:00:00Z',completed_by='owner' WHERE id='normal'").run()
   assert.equal(effective(db,'normal'),5)
   db.prepare(`INSERT INTO routines(id,household_id,created_by,visibility,title,repeat_type,anchor_date,reminder_only)
    VALUES('daily-only','home','owner','household','Daily reminder','daily','2026-11-17',1)`).run()
   db.prepare(`INSERT INTO routine_marks(routine_id,occurrence_on,completed_at,completed_by)
    VALUES('daily-only','2026-11-17','2026-11-17T07:00:00Z','owner')`).run()
   assert.equal(count(db,'routine','daily-only'),0)
   db.prepare(`INSERT INTO routines(id,household_id,created_by,visibility,title,repeat_type,anchor_date)
    VALUES('daily-normal','home','owner','household','Daily task','daily','2026-11-17')`).run()
   db.prepare(`INSERT INTO routine_marks(routine_id,occurrence_on,completed_at,completed_by)
    VALUES('daily-normal','2026-11-17','2026-11-17T08:00:00Z','owner')`).run()
   assert.equal(effective(db,'daily-normal'),5)
   db.prepare("UPDATE routines SET reminder_only=1 WHERE id='daily-normal'").run()
   assert.equal(effective(db,'daily-normal'),5,'old routine period remains rewarded')
   db.prepare(`INSERT INTO routine_marks(routine_id,occurrence_on,completed_at,completed_by)
    VALUES('daily-normal','2026-11-18','2026-11-18T08:00:00Z','owner')`).run()
   assert.equal(count(db,'routine','daily-normal'),1,'subsequent reminder-only period adds no reward')
   assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{db.close()}
})
test('server input rejects financed bonuses for reminder-only tasks, including spouse assignment',()=>{
 const session={user_id:'owner'}
 const base={title:'Reminder',visibility:'household',assigneeUserId:'member',bonusPoints:0,reminderOnly:true}
 assert.ok(validated(base,session))
 assert.equal(validated({...base,bonusPoints:1},session),null)
 assert.equal(validated({...base,reminderOnly:false},session),null)
 assert.ok(validated({...base,reminderOnly:false,bonusPoints:5},session))
})
test('both creation and editing show only text, without icon or bonus for reminder-only tasks',()=>{
 const files=[
 'src/components/OneTimeTaskFields.vue','src/components/PlanCreator.vue',
 'src/components/LifeItemEditor.vue','src/components/LifePanel.vue']
 for(const file of files){
  const source=readFileSync(new URL(file,root),'utf8')
  assert.match(source,/仅提醒/,file)
  assert.match(source,/reminderOnly|onceReminderOnly/,file)
  assert.doesNotMatch(source,/>🔔/,file)
 }
})
