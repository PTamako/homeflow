import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {householdWalletSql} from '../worker/points-wallet.js'

const manifest=readFileSync(new URL('../scripts/check_migrations.py',import.meta.url),'utf8')
const block=manifest.slice(manifest.indexOf('MIGRATIONS=['),manifest.indexOf(']\nfiles='))
const migrations=[...block.matchAll(/"(\d{4}_[^"]+\.sql)"/g)].map(match=>match[1])
const latest='0048_oneoff_five_points.sql'
const migrationSql=readFileSync(new URL('../migrations/'+latest,import.meta.url),'utf8')
const createFixture=()=>{
 const db=new DatabaseSync(':memory:')
 db.exec('PRAGMA foreign_keys=ON')
 for(const name of migrations.slice(0,-1))
  db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'))
 db.exec(`
  INSERT INTO households(id,display_name) VALUES('home','Home');
  INSERT INTO users(id,login_name,password_salt,password_verifier)
    VALUES('owner','owner','salt','verifier'),('member','member','salt','verifier');
  INSERT INTO household_members(household_id,user_id,role)
    VALUES('home','owner','owner'),('home','member','member');
 `)
 return db
}
const pointRows=(db,id)=>db.prepare(`SELECT c.points AS original,
  COALESCE(a.delta,0) AS adjustment,
  c.points+COALESCE(a.delta,0) AS total
  FROM completion_points c LEFT JOIN completion_point_adjustments a
  ON a.household_id=c.household_id AND a.kind=c.kind
  AND a.source_id=c.source_id AND a.occurrence_on=c.occurrence_on
  WHERE c.source_id=?`).all(id)

test('migration preserves all pre-existing unassigned +10 awards, while new tasks default to +5',()=>{
 const db=createFixture()
 try{
  const old='old-unassigned',recent='new-unassigned',assigned='new-assigned'
  const add=(id,assignee=null,bonus=0)=>{
   db.prepare(`INSERT INTO tasks(id,household_id,creator_user_id,visibility,title,assignee_user_id,bonus_points)
     VALUES(?, 'home','owner','household',?, ?, ?)`).run(id,id,assignee,bonus)
  }
  const done=(id,who)=>db.prepare(`UPDATE tasks SET completed_at='2026-11-09T03:00:00Z',completed_by=?
    WHERE id=?`).run(who,id)
  add(old)
  done(old,'owner')
  assert.deepEqual(pointRows(db,old),[{original:10,adjustment:0,total:10}])
  db.exec(migrationSql)
  assert.deepEqual(pointRows(db,old),[{original:10,adjustment:0,total:10}],
    'an additive scoring migration must not backfill old earnings')
  add(recent)
  done(recent,'owner')
  assert.deepEqual(pointRows(db,recent),[{original:10,adjustment:-5,total:5}])
  add(assigned,'member',4)
  done(assigned,'member')
  assert.deepEqual(pointRows(db,assigned),[{original:10,adjustment:-5,total:5}])
  const memberWallet=db.prepare('SELECT '+householdWalletSql("'home'","'member'")+' AS points').get()
  assert.equal(memberWallet.points,9,'assigned member gets 5 base plus 4 separately funded bonus')
  const ownerWallet=db.prepare('SELECT '+householdWalletSql("'home'","'owner'")+' AS points').get()
  assert.equal(ownerWallet.points,11,'owner keeps original 10 and new 5, less 4 bonus')
  db.prepare('UPDATE tasks SET completed_at=NULL,completed_by=NULL WHERE id=?').run(recent)
  assert.equal(pointRows(db,recent).length,0,'undo removes the completed award and adjustment together')
  done(recent,'owner')
  assert.deepEqual(pointRows(db,recent),[{original:10,adjustment:-5,total:5}])
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{db.close()}
})

test('routine and joint task distribution remains five points after migration',()=>{
 const db=createFixture()
 try{
  db.exec(migrationSql)
  db.prepare(`INSERT INTO tasks(id,household_id,creator_user_id,visibility,title,
    assignee_user_id,second_assignee_user_id,bonus_points)
    VALUES('joint','home','owner','household','共同完成','owner','member',0)`).run()
  db.prepare("UPDATE tasks SET completed_at='2026-11-09T03:00:00Z',completed_by='owner' WHERE id='joint'").run()
  assert.deepEqual(pointRows(db,'joint'),[{original:10,adjustment:-5,total:5}])
  const splits=db.prepare("SELECT user_id,SUM(points) amount FROM dual_completion_splits WHERE source_id='joint' GROUP BY user_id ORDER BY user_id").all()
  assert.deepEqual(splits,[{user_id:'member',amount:2.5},{user_id:'owner',amount:-2.5}])
  db.prepare(`INSERT INTO routines(id,household_id,created_by,visibility,title,repeat_type,anchor_date)
    VALUES('daily','home','owner','household','整理房间','daily','2026-11-09')`).run()
  db.prepare(`INSERT INTO routine_marks(routine_id,occurrence_on,completed_at,completed_by)
    VALUES('daily','2026-11-09','2026-11-09T03:00:00Z','member')`).run()
  assert.deepEqual(pointRows(db,'daily'),[{original:10,adjustment:-5,total:5}])
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{db.close()}
})
