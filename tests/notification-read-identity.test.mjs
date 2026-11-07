import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {notificationsRoute,jstNotificationDay} from '../worker/notifications.js'

const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const day=jstNotificationDay()
const session={household_id:'home',user_id:'member-1'}
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

function setup(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec(`CREATE TABLE notification_inbox (
   id TEXT PRIMARY KEY, household_id TEXT NOT NULL,
   recipient_user_id TEXT NOT NULL, local_day TEXT NOT NULL,
   read_at TEXT, last_completion_key TEXT)`)
 const insert=sqlite.prepare(`INSERT INTO notification_inbox
   (id,household_id,recipient_user_id,local_day,read_at,last_completion_key)
   VALUES (?,?,?,?,?,?)`)
 insert.run(id(1),'home','member-1',day,null,null)
 insert.run(id(2),'home','member-1',day,null,null)
 insert.run(id(3),'home','member-2',day,null,null)
 const db={prepare(sql){
  const stmt=sqlite.prepare(sql);let args=[]
  return {bind(...values){args=values;return this},
   async run(){return {meta:{changes:stmt.run(...args).changes}}},
   async first(){return stmt.get(...args)||null}}
 }}
 const submit=async(n,operation,expectedCompletionKey,account=session)=>{
  const url='/api/notifications/'+id(n)+'/'+operation
  const request=new Request('https://homeflow.invalid'+url,{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({expectedCompletionKey})})
  const response=await notificationsRoute(request,db,url,account)
  return {status:response.status,body:await response.json()}
 }
 return {sqlite,submit}
}

test('tapping notice A changes A only, never adjacent B',async()=>{
 const {sqlite,submit}=setup()
 try{
  let result=await submit(1,'read',null)
  assert.equal(result.status,200)
  assert.equal(result.body.notificationId,id(1))
  assert.equal(result.body.unreadCount,1)
  assert.ok(sqlite.prepare('SELECT read_at FROM notification_inbox WHERE id=?').get(id(1)).read_at)
  assert.equal(sqlite.prepare('SELECT read_at FROM notification_inbox WHERE id=?').get(id(2)).read_at,null)
  result=await submit(2,'read',null)
  assert.equal(result.status,200)
  assert.equal(result.body.notificationId,id(2))
  assert.equal(result.body.unreadCount,0)
  result=await submit(1,'unread',null)
  assert.equal(result.status,200)
  assert.equal(result.body.unreadCount,1)
  assert.equal(sqlite.prepare('SELECT read_at FROM notification_inbox WHERE id=?').get(id(1)).read_at,null)
  assert.ok(sqlite.prepare('SELECT read_at FROM notification_inbox WHERE id=?').get(id(2)).read_at)
 }finally{sqlite.close()}
})

test('stale morning reminder cannot read newer completion that reused the same inbox ID',async()=>{
 const {sqlite,submit}=setup()
 try{
  assert.equal((await submit(1,'read',null)).status,200)
  const completionKey='complete:routine:'+id(4)+':2026-11-07T10:22:33Z'
  sqlite.prepare('UPDATE notification_inbox SET read_at=NULL,last_completion_key=? WHERE id=?')
   .run(completionKey,id(1))
  let result=await submit(1,'read',null)
  assert.equal(result.status,409)
  assert.equal(result.body.error,'notification_changed')
  assert.equal(sqlite.prepare('SELECT read_at FROM notification_inbox WHERE id=?').get(id(1)).read_at,null)
  result=await submit(1,'read',completionKey)
  assert.equal(result.status,200)
  assert.equal(result.body.notificationId,id(1))
  assert.ok(sqlite.prepare('SELECT read_at FROM notification_inbox WHERE id=?').get(id(1)).read_at)
  result=await submit(1,'unread',null)
  assert.equal(result.status,409)
  assert.ok(sqlite.prepare('SELECT read_at FROM notification_inbox WHERE id=?').get(id(1)).read_at)
 }finally{sqlite.close()}
})

test('guarded read is still restricted to the active recipient and household',async()=>{
 const {sqlite,submit}=setup()
 try{
  assert.equal((await submit(3,'read',null)).status,409)
  assert.equal((await submit(1,'read',null,{...session,household_id:'other'})).status,409)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM notification_inbox WHERE read_at IS NOT NULL').get().count,0)
 }finally{sqlite.close()}
})

test('inbox UI binds touch and API updates to the exact ID plus completion revision',()=>{
 const ui=read('src/components/TodayNotifications.vue')
 const api=read('worker/notifications.js')
 assert.match(ui,/:key="item.id"/)
 assert.match(ui,/@pointerdown="pressedReadId=item.id"/)
 assert.match(ui,/touchedId!==item.id/)
 assert.match(ui,/JSON.stringify\(\{expectedCompletionKey:revision\}\)/)
 assert.match(ui,/data.notificationId!==id/)
 assert.match(ui,/row.id===id/)
 assert.match(ui,/row.lastCompletionKey===revision/)
 assert.match(ui,/generation\+\+/)
 assert.match(api,/n.last_completion_key AS lastCompletionKey/)
 assert.match(api,/COALESCE\(last_completion_key,''\)=\?5/)
})

test('push deep links distinguish morning reminder from updated completion',()=>{
 const web=read('worker/webpush.js'),sw=read('public/sw.js')
 const app=read('src/App.vue'),ui=read('src/components/TodayNotifications.vue')
 assert.match(web,/notificationVersion=scheduled/)
 assert.match(web,/notificationVersion:completionKey/)
 assert.match(sw,/notificationVersion:target.searchParams.get\('notificationVersion'\)/)
 assert.match(app,/const notificationVersion=url.searchParams.get\('notificationVersion'\)/)
 assert.match(app,/expectedCompletionKey=version==='scheduled'\?null/)
 assert.match(app,/:focus-notification-version="notificationToOpenVersion"/)
 assert.match(ui,/version==='scheduled'\?\!\(focused\?\.lastCompletionKey\)/)
})
