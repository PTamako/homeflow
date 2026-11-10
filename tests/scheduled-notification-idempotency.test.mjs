import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {ensureScheduledNotification,saveNotification} from '../worker/notifications.js'

test('hourly cron never rewrites an existing notification or clears read/completion',async()=>{
 const sqlite=new DatabaseSync(':memory:')
 try{
  sqlite.exec(`CREATE TABLE notification_inbox (
   id TEXT PRIMARY KEY,household_id TEXT,recipient_user_id TEXT,sender_user_id TEXT,
   kind TEXT,source_id TEXT,title TEXT,message TEXT,delivery_status TEXT,
   sent_devices INTEGER DEFAULT 0,failed_devices INTEGER DEFAULT 0,
   local_day TEXT,read_at TEXT,last_completion_key TEXT,dedupe_key TEXT,
   created_at TEXT DEFAULT CURRENT_TIMESTAMP,
   UNIQUE(recipient_user_id,local_day,dedupe_key))`)
  const db={prepare(sql){const statement=sqlite.prepare(sql)
    return {bind(...args){return {run:async()=>({meta:{changes:statement.run(...args).changes}})}}}
  }}
  const base={id:'aaa',householdId:'home',recipientId:'person-a',kind:'routine',
   sourceId:'routine-1',localDay:'2026-11-10',title:'今天洗碗',
   message:'今天处理',dedupeKey:'scheduled:routine-1',deliveryReason:'quiet'}
  assert.equal(await ensureScheduledNotification(db,base),true)
  assert.equal(await ensureScheduledNotification(db,base),false)
  await saveNotification(db,{...base,id:'completion-id',title:'今天洗碗 · 已完成',
   message:'已完成 · 家人',mergeCompletion:true,
   completionKey:'complete:2026-11-10T09:00',unreadOnCompletion:true,
   sentDevices:1,failedDevices:0})
  sqlite.prepare('UPDATE notification_inbox SET read_at=?').run('2026-11-10 09:10:00')
  assert.equal(await ensureScheduledNotification(db,base),false)
  const result=sqlite.prepare('SELECT title,message,read_at,last_completion_key,delivery_status FROM notification_inbox').get()
  assert.equal(result.title,'今天洗碗 · 已完成')
  assert.equal(result.message,'已完成 · 家人')
  assert.equal(result.read_at,'2026-11-10 09:10:00')
  assert.equal(result.delivery_status,'sent')
  assert.equal(result.last_completion_key,'complete:2026-11-10T09:00')
  const second={...base,id:'bbb',recipientId:'person-b'}
  assert.equal(await ensureScheduledNotification(db,second),true)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM notification_inbox').get().count,2)
 }finally{sqlite.close()}
})
