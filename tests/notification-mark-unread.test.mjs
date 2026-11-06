import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {jstNotificationDay,notificationsRoute} from '../worker/notifications.js'

const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const session={household_id:'family-a',user_id:'recipient-a'}
const day=jstNotificationDay()
const yesterday=new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10)

function setup(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec(`CREATE TABLE notification_inbox (
   id TEXT PRIMARY KEY, household_id TEXT NOT NULL,
   recipient_user_id TEXT NOT NULL, local_day TEXT NOT NULL, read_at TEXT)`)
 const put=sqlite.prepare(`INSERT INTO notification_inbox
  (id,household_id,recipient_user_id,local_day,read_at) VALUES (?,?,?,?,?)`)
 put.run(id(1),'family-a','recipient-a',day,null)
 put.run(id(2),'family-a','recipient-a',day,'2026-11-06 00:00:01')
 put.run(id(3),'family-a','recipient-b',day,null)
 put.run(id(4),'family-b','recipient-a',day,null)
 put.run(id(5),'family-a','recipient-a',yesterday,'2026-11-05 00:00:01')
 const db={prepare(sql){
    const statement=sqlite.prepare(sql)
    let args=[]
    return {bind(...values){args=values;return this},
      async run(){return {meta:{changes:statement.run(...args).changes}}},
      async first(){return statement.get(...args)||null}}
 }}
 const send=async(n,verb,account=session)=>{
  const path='/api/notifications/'+id(n)+'/'+verb
  const result=await notificationsRoute(new Request('https://homeflow.invalid'+path,{
   method:'POST'}),db,path,account)
  return {status:result.status,body:await result.json()}
 }
 return {sqlite,send}
}

test('read ↔ unread transitions change only the recipient row and return exact badge counts',async()=>{
 const {sqlite,send}=setup()
 try{
  let res=await send(1,'read')
  assert.equal(res.status,200)
  assert.equal(res.body.read,true)
  assert.equal(res.body.unreadCount,0)

  res=await send(2,'unread')
  assert.equal(res.status,200)
  assert.equal(res.body.read,false)
  assert.equal(res.body.unreadCount,1)
  assert.equal(sqlite.prepare('SELECT read_at FROM notification_inbox WHERE id=?').get(id(2)).read_at,null)

  res=await send(2,'read')
  assert.equal(res.status,200)
  assert.equal(res.body.unreadCount,0)
  assert.ok(sqlite.prepare('SELECT read_at FROM notification_inbox WHERE id=?').get(id(2)).read_at)

  res=await send(1,'unread')
  assert.equal(res.status,200)
  assert.equal(res.body.unreadCount,1)
 }finally{sqlite.close()}
})

test('marking unread cannot alter another recipient, another household, or yesterday',async()=>{
 const {sqlite,send}=setup()
 try{
  const before=sqlite.prepare('SELECT id,read_at FROM notification_inbox ORDER BY id').all()
  for(const n of [3,4,5]){
   const res=await send(n,'unread')
   assert.equal(res.status,404)
  }
  const after=sqlite.prepare('SELECT id,read_at FROM notification_inbox ORDER BY id').all()
  assert.deepEqual(after,before)
  const other=await send(2,'unread',{...session,user_id:'recipient-b'})
  assert.equal(other.status,404)
 }finally{sqlite.close()}
})

test('Today UI exposes exactly one read/unread action and updates PWA badge state',()=>{
 const ui=readFileSync(new URL('../src/components/TodayNotifications.vue',import.meta.url),'utf8')
 assert.match(ui,/view==='received'&&!item.readAt/)
 assert.match(ui,/view==='received'&&item.readAt/)
 assert.match(ui,/@click="markRead\(item\)">标记已读/)
 assert.match(ui,/@click="markUnread\(item\)">标记未读/)
 assert.match(ui,/markAsRead\?'read':'unread'/)
 assert.match(ui,/emit\('unreadChange',unread.value\)/)
 const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 assert.match(app,/@unread-change="setUnreadNotificationCount"/)
 assert.match(app,/badge\.setAppBadge\?\.\(count\)/)
 assert.match(app,/badge\.clearAppBadge\?\.\(\)/)
})
