import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {scheduledDeliveryTotals} from '../worker/webpush.js'
import {existingScheduledDedupeKeys} from '../worker/notifications.js'

// A real SQLite fixture verifies cross-hour retries without using Web Push.
function fixture(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec(`CREATE TABLE push_subscriptions(
   endpoint_hash TEXT PRIMARY KEY,household_id TEXT,user_id TEXT);
 CREATE TABLE notification_deliveries(
   endpoint_hash TEXT,notification_key TEXT,sent_on TEXT,status TEXT,
   PRIMARY KEY(endpoint_hash,notification_key,sent_on));
 CREATE TABLE notification_inbox(
   id TEXT PRIMARY KEY,household_id TEXT,recipient_user_id TEXT,
   local_day TEXT,dedupe_key TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`)
 const db={prepare(sql){
  const statement=sqlite.prepare(sql)
  return {bind(...args){return {
   first:async()=>statement.get(...args)||null,
   all:async()=>({results:statement.all(...args)})
  }}}
 }}
 return {sqlite,db}
}

test('retrying failed second device next hour counts both successful devices',async()=>{
 const {sqlite,db}=fixture()
 try{
  const day='2026-11-10',key='routine:abc:2026-11-10:0'
  sqlite.exec(`INSERT INTO push_subscriptions VALUES
    ('phone','home','alice'),('tablet','home','alice'),
    ('other-family','other','eve'),('other-member','home','bob');
   INSERT INTO notification_deliveries VALUES
    ('phone','routine:abc:2026-11-10:0','2026-11-10','sent'),
    ('tablet','routine:abc:2026-11-10:0','2026-11-10','failed'),
    ('other-family','routine:abc:2026-11-10:0','2026-11-10','sent'),
    ('other-member','routine:abc:2026-11-10:0','2026-11-10','sent'),
    ('phone','routine:abc:2026-11-10:0','2026-11-09','sent');`)
  const query={householdId:'home',recipientId:'alice',key,day}
  assert.deepEqual(await scheduledDeliveryTotals(db,query),{sent:1,failed:1})
  sqlite.prepare("UPDATE notification_deliveries SET status='sent' WHERE endpoint_hash='tablet' AND sent_on=?").run(day)
  assert.deepEqual(await scheduledDeliveryTotals(db,query),{sent:2,failed:0})
  assert.deepEqual(await scheduledDeliveryTotals(db,{...query,recipientId:'eve'}),{sent:0,failed:0},
    'a user cannot count another household\'s device')
 }finally{sqlite.close()}
})

test('catch-up reads existing scheduled keys for one member and date only',async()=>{
 const {sqlite,db}=fixture()
 try{
  sqlite.exec(`INSERT INTO notification_inbox(id,household_id,recipient_user_id,local_day,dedupe_key) VALUES
   ('a','home','alice','2026-11-10','scheduled:task:1'),
   ('b','home','alice','2026-11-10','scheduled:routine:2'),
   ('c','home','alice','2026-11-10','manual:task:3'),
   ('d','home','alice','2026-11-09','scheduled:task:old'),
   ('e','home','bob','2026-11-10','scheduled:task:bob'),
   ('f','other','alice','2026-11-10','scheduled:task:other');`)
  const keys=await existingScheduledDedupeKeys(db,'home','alice','2026-11-10')
  assert.deepEqual([...keys].sort(),['scheduled:routine:2','scheduled:task:1'])
  assert.equal(keys.has('scheduled:task:old'),false)
  assert.equal(keys.has('manual:task:3'),false)
 }finally{sqlite.close()}
})
