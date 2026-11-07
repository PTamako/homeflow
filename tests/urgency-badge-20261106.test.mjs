import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {listFilters,listPage} from '../worker/list-pagination.js'
import {tripsRoute} from '../worker/trips.js'
import {notificationsRoute} from '../worker/notifications.js'
import {additionalReminders} from '../src/today-presentation.mjs'

const repoFile=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const session={household_id:'family',user_id:'alice'}
function fixture(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec(`CREATE TABLE shopping_items(
   id TEXT PRIMARY KEY, household_id TEXT, created_by TEXT,visibility TEXT,
   deleted_at TEXT,created_at TEXT,due_on TEXT,completed_at TEXT);
 CREATE TABLE wishes(
   id TEXT PRIMARY KEY, household_id TEXT, created_by TEXT,visibility TEXT,
   deleted_at TEXT,created_at TEXT,target_on TEXT,status TEXT);
 CREATE TABLE trips(
   id TEXT PRIMARY KEY, household_id TEXT,created_by TEXT,visibility TEXT,
   deleted_at TEXT,created_at TEXT,start_on TEXT,end_on TEXT,
   title TEXT,destination TEXT,budget_amount INTEGER,currency TEXT,status TEXT,
   wish_id TEXT,import_source_key TEXT,updated_at TEXT,participant_user_ids TEXT NOT NULL DEFAULT '[]');
 CREATE TABLE goals(
   id TEXT PRIMARY KEY,household_id TEXT,created_by TEXT,visibility TEXT,
   deleted_at TEXT,created_at TEXT,start_on TEXT,target_on TEXT,
   reserved_amount INTEGER,target_amount INTEGER,goal_mode TEXT);
 CREATE TABLE plan_completion_marks(household_id TEXT,plan_type TEXT,plan_id TEXT,period_key TEXT);`)
 const db={prepare(sql){const stmt=sqlite.prepare(sql);let args=[]
   return {bind(...v){args=v;return this},async all(){return {results:stmt.all(...args)}},
     async first(){return stmt.get(...args)||null}}
 }}
 return {sqlite,db}
}
test('shopping order uses nearest deadline across pages and keeps undated items last',async()=>{
 const {sqlite,db}=fixture()
 try{
  const put=sqlite.prepare(`INSERT INTO shopping_items
    (id,household_id,created_by,visibility,created_at,due_on)
    VALUES (?,'family','alice','household','2026-01-01',?)`)
  const dates=['2027-02-01','2026-11-06',null,'2026-11-05','2026-12-02',
    '2026-11-07','2026-11-08','2026-11-09']
  dates.forEach((d,i)=>put.run(id(i+1),d))
  let cursor='',pages=[]
  for(let p=0;p<4;p++){
    const url='https://example.invalid/api/shopping?scope=active&limit=5'+
      (cursor?'&cursor='+encodeURIComponent(cursor):'')
    const page=await listPage(db,'shopping_items',session,listFilters(url))
    pages.push(...page.items)
    cursor=page.nextCursor||''
    if(!cursor)break
  }
  assert.deepEqual(pages.map(x=>x.due_on),
    ['2026-11-05','2026-11-06','2026-11-07','2026-11-08',
     '2026-11-09','2026-12-02','2027-02-01',null])
  assert.equal(new Set(pages.map(x=>x.id)).size,8)
 }finally{sqlite.close()}
})
test('active wishes sort by target date, not insertion date',async()=>{
 const {sqlite,db}=fixture()
 try{
  const insert=sqlite.prepare(`INSERT INTO wishes(id,household_id,created_by,visibility,
    created_at,target_on,status) VALUES (?,'family','alice','household',?,?,'wished')`)
  insert.run(id(1),'2026-11-05','2027-01-01')
  insert.run(id(2),'2026-01-01','2026-11-06')
  insert.run(id(3),'2026-11-06',null)
  const url='https://example.invalid/api/wishes?scope=active&limit=5'
  const page=await listPage(db,'wishes',session,listFilters(url))
  assert.deepEqual(page.items.map(x=>x.id),[id(2),id(1),id(3)])
 }finally{sqlite.close()}
})
test('trips active use upcoming departure, completed history uses recent end',async()=>{
 const {sqlite,db}=fixture()
 try{
  const put=sqlite.prepare(`INSERT INTO trips
   (id,household_id,created_by,visibility,created_at,start_on,end_on,
    title,status,updated_at)
   VALUES (?,'family','alice','household',?,?,?,?,?,?)`)
  put.run(id(1),'2026-11-05','2027-05-10','2027-05-20','A','planning','2026-11-05')
  put.run(id(2),'2026-01-01','2026-11-08','2026-11-11','B','planning','2026-01-01')
  put.run(id(3),'2026-11-05','2026-10-01','2026-10-03','C','completed','2026-11-05')
  put.run(id(4),'2026-11-05','2026-09-01','2026-09-03','D','completed','2026-11-05')
  const active=await tripsRoute(new Request('https://example.invalid/api/trips?scope=active&limit=5'),
    db,'/api/trips',session)
  assert.equal(active.status,200)
  assert.deepEqual((await active.json()).items.map(x=>x.id),[id(2),id(1)])
  const history=await tripsRoute(new Request('https://example.invalid/api/trips?scope=history&limit=5'),
    db,'/api/trips',session)
  assert.deepEqual((await history.json()).items.map(x=>x.id),[id(3),id(4)])
 }finally{sqlite.close()}
})
test('reminder previews across kinds always follow nearest deadline',()=>{
 const input=[{id:'t',kind:'trip',dueOn:'2026-11-12'},
 {id:'s',kind:'shopping',dueOn:'2026-11-07'},
 {id:'a',kind:'anniversary',dueOn:'2026-11-06'}]
 assert.deepEqual(additionalReminders(input,[]).map(x=>x.id),['a','s','t'])
 assert.deepEqual(input.map(x=>x.id),['t','s','a'])
})
test('badge endpoint counts only signed-in recipient today, in one indexed D1 read',async()=>{
 const log=[]
 const db={prepare(sql){const call={sql,args:[]};return {
   bind(...args){call.args=args;return this},
   async first(){log.push(call);return {count:3}}
 }}}
 const response=await notificationsRoute(new Request('https://example.invalid/api/notifications/badge'),
  db,'/api/notifications/badge',session)
 assert.equal(response.status,200)
 assert.equal((await response.json()).unreadCount,3)
 assert.equal(log.length,1)
 assert.match(log[0].sql,/recipient_user_id=\?2/)
 assert.match(log[0].sql,/read_at IS NULL/)
 assert.deepEqual(log[0].args.slice(0,2),['family','alice'])
})
test('iOS worker fetches exact badge count; foreground sync and unread clearing are wired',()=>{
 const sw=repoFile('public/sw.js'),app=repoFile('src/App.vue')
 const push=repoFile('worker/webpush.js'),panel=repoFile('src/components/PushPanel.vue')
 assert.match(sw,/fetch\('\/api\/notifications\/badge'/)
 assert.match(sw,/self\.navigator\.setAppBadge\?\.\(count\)/)
 assert.match(sw,/self\.navigator\.clearAppBadge\?\.\(\)/)
 assert.match(app,/const result=await api\('\/notifications\/badge'\)/)
 assert.match(app,/badge\.setAppBadge\?\.\(count\)/)
 assert.match(app,/badge\.clearAppBadge\?\.\(\)/)
 assert.match(app,/homeflow-badge-refresh/)
 assert.match(panel,/homeflow-badge-refresh/)
 assert.match(push,/tag:'homeflow-family-'\+notificationId/)
 assert.match(push,/tag:'homeflow-task-'\+body\.kind\+'-'\+item\.id\+'-'\+notificationId/)
 const save=push.indexOf('Ensure background iOS Push')
 const delivery=push.indexOf('for(const sub of subscriptions)',save)
 assert.ok(save>0&&delivery>save,'save inbox before pushing to installed devices')
})
