import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {notificationsRoute,jstNotificationDay} from '../worker/notifications.js'

const day=jstNotificationDay()
const yesterday=new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10)
const uid='recipient-a',family='family-a'
const session={household_id:family,user_id:uid}
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const path='/api/notifications/today/read-all'

function setup(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec(`CREATE TABLE notification_inbox (
  id TEXT PRIMARY KEY, household_id TEXT NOT NULL, recipient_user_id TEXT NOT NULL,
  local_day TEXT NOT NULL, read_at TEXT)`)
 const put=sqlite.prepare('INSERT INTO notification_inbox VALUES (?,?,?,?,?)')
 for(let n=1;n<=8;n++)put.run(id(n),family,uid,day,null)
 put.run(id(9),family,uid,day,'2026-11-08 01:23:45')
 put.run(id(10),family,'recipient-b',day,null)
 put.run(id(11),'family-b',uid,day,null)
 put.run(id(12),family,uid,yesterday,null)
 const db={prepare(sql){
  const stmt=sqlite.prepare(sql)
  let values=[]
  return {bind(...args){values=args;return this},
   async run(){return {meta:{changes:stmt.run(...values).changes}}},
   async first(){return stmt.get(...values)||null}}
 }}
 const submit=async(method='POST',account=session)=>{
  const result=await notificationsRoute(new Request('https://homeflow.invalid'+path,{method}),db,path,account)
  return {status:result.status,body:await result.json()}
 }
 return {sqlite,submit}
}

test('read-all marks every received unread notification, not only the five visible items',async()=>{
 const {sqlite,submit}=setup()
 try{
  const response=await submit()
  assert.equal(response.status,200)
  assert.deepEqual(response.body,{ok:true,markedCount:8,unreadCount:0})
  assert.equal(sqlite.prepare(`SELECT COUNT(*) AS count FROM notification_inbox
    WHERE household_id=? AND recipient_user_id=? AND local_day=? AND read_at IS NULL`)
    .get(family,uid,day).count,0)
  assert.equal(sqlite.prepare('SELECT read_at FROM notification_inbox WHERE id=?').get(id(9)).read_at,
    '2026-11-08 01:23:45')
  assert.equal((await submit()).body.markedCount,0)
 }finally{sqlite.close()}
})

test('read-all never changes another member, other household, or another day',async()=>{
 const {sqlite,submit}=setup()
 try{
  assert.equal((await submit()).status,200)
  for(const n of [10,11,12])
   assert.equal(sqlite.prepare('SELECT read_at FROM notification_inbox WHERE id=?').get(id(n)).read_at,null)
  const other=await submit('POST',{...session,user_id:'recipient-b'})
  assert.equal(other.body.markedCount,1)
  assert.equal(sqlite.prepare('SELECT read_at FROM notification_inbox WHERE id=?').get(id(11)).read_at,null)
 }finally{sqlite.close()}
})

test('read-all rejects GET and does not modify notifications',async()=>{
 const {sqlite,submit}=setup()
 try{
  const response=await submit('GET')
  assert.equal(response.status,405)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM notification_inbox WHERE read_at IS NULL').get().count,11)
 }finally{sqlite.close()}
})

test('Today inbox shows compact bulk action for received only and syncs badge from server',()=>{
 const ui=readFileSync(new URL('../src/components/TodayNotifications.vue',import.meta.url),'utf8')
 assert.match(ui,/view==='received'&&unread>0/)
 assert.match(ui,/@click="markAllRead"/)
 assert.match(ui,/\/api\/notifications\/today\/read-all/)
 assert.match(ui,/row.recipientUserId===account&&!row.readAt/)
 assert.match(ui,/unread.value=data.unreadCount/)
 assert.match(ui,/emit\('unreadChange',unread.value\)/)
 assert.match(ui,/\.notice-tabs \.notice-read-all\{margin-left:auto/)
})
