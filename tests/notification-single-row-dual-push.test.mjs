import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {findScheduledNotification,saveNotification} from '../worker/notifications.js'

const A='11111111-1111-4111-8111-111111111111'
const B='22222222-2222-4222-8222-222222222222'
const TASK='33333333-3333-4333-8333-333333333333'
const REMINDER='44444444-4444-4444-8444-444444444444'
const COMPLETION='55555555-5555-4555-8555-555555555555'
const day='2026-11-06'

function setup(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec(`CREATE TABLE notification_inbox (
  id TEXT PRIMARY KEY,household_id TEXT NOT NULL,sender_user_id TEXT,
  recipient_user_id TEXT NOT NULL,kind TEXT NOT NULL,source_id TEXT,
  title TEXT NOT NULL,message TEXT NOT NULL,delivery_status TEXT NOT NULL,
  sent_devices INTEGER NOT NULL DEFAULT 0,failed_devices INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,local_day TEXT NOT NULL,
  read_at TEXT,dedupe_key TEXT,
  UNIQUE(recipient_user_id,local_day,dedupe_key))`)
 const db={prepare(sql){
  const statement=sqlite.prepare(sql)
  return {bind(...args){
   return {run:async()=>({meta:{changes:statement.run(...args).changes}}),
    first:async()=>statement.get(...args)||null}
  }}
 }}
 return {sqlite,db}
}

test('two distinct Push events occupy one daily inbox record without changing read/unread',async()=>{
 const {sqlite,db}=setup()
 try{
  const key='scheduled:routine:'+TASK+':'+day+':0'
  const base={householdId:'house',recipientId:B,kind:'routine',
    sourceId:TASK,localDay:day,dedupeKey:key}
  await saveNotification(db,{...base,id:REMINDER,senderId:null,title:'喂咕噜酱',
    message:'今天的定期事项',sentDevices:1,failedDevices:0})
  sqlite.prepare('UPDATE notification_inbox SET read_at=? WHERE id=?')
    .run('2026-11-06 00:10:00',REMINDER)
  const original=await findScheduledNotification(db,{
    householdId:'house',recipientId:B,kind:'routine',sourceId:TASK,
    periodOn:day,localDay:day})
  assert.equal(original.id,REMINDER)
  assert.equal(original.dedupeKey,key)
  // Completion has a fresh delivery/push identity, but reuses reminder's
  // inbox dedupe key. The original deep link remains valid.
  await saveNotification(db,{...base,id:COMPLETION,senderId:A,
    title:'喂咕噜酱 · 已完成',message:'已完成 · 鸡毛大王 · '+day,
    sentDevices:1,failedDevices:0,mergeCompletion:true})
  const rows=sqlite.prepare('SELECT * FROM notification_inbox').all()
  assert.equal(rows.length,1)
  assert.equal(rows[0].id,REMINDER)
  assert.equal(rows[0].title,'喂咕噜酱 · 已完成')
  assert.equal(rows[0].message,'已完成 · 鸡毛大王 · '+day)
  assert.equal(rows[0].sender_user_id,A)
  assert.equal(rows[0].read_at,'2026-11-06 00:10:00')
  // Cron replay must never revert completion or mark the message read.
  await saveNotification(db,{...base,id:REMINDER,senderId:null,
    title:'喂咕噜酱',message:'今天的定期事项',
    sentDevices:1,failedDevices:0})
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS c FROM notification_inbox').get().c,1)
  assert.equal(sqlite.prepare('SELECT message FROM notification_inbox').get().message,
    '已完成 · 鸡毛大王 · '+day)
 }finally{sqlite.close()}
})

test('a different routine occurrence or household is not merged',async()=>{
 const {sqlite,db}=setup()
 try{
  await saveNotification(db,{id:REMINDER,householdId:'house',recipientId:B,
    kind:'routine',sourceId:TASK,title:'每周清洁',message:'提前提醒',
    localDay:day,dedupeKey:'scheduled:routine:'+TASK+':2026-11-07:1',
    sentDevices:0,failedDevices:0})
  const scope={householdId:'house',recipientId:B,kind:'routine',sourceId:TASK,
    localDay:day}
  assert.equal(await findScheduledNotification(db,{...scope,periodOn:day}),null)
  assert.equal(await findScheduledNotification(db,{...scope,recipientId:A,
    periodOn:'2026-11-07'}),null)
  assert.ok(await findScheduledNotification(db,{...scope,periodOn:'2026-11-07'}))
 }finally{sqlite.close()}
})

test('the 06:00 reminder and completion still create separate device Push events',()=>{
 const webpush=readFileSync(new URL('../worker/webpush.js',import.meta.url),'utf8')
 assert.match(webpush,/export async function runPushSchedule/)
 assert.match(webpush,/export async function sendCompletionFeedback/)
 assert.match(webpush,/tag:'homeflow-done-'\+event\.kind/)
 assert.match(webpush,/const notificationId=scheduled\?\.id\|\|receiptId/)
 assert.match(webpush,/recordInInbox:true/)
 assert.match(webpush,/mergeCompletion:!!scheduled/)
})
