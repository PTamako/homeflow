import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {notificationsRoute,jstNotificationDay} from '../worker/notifications.js'

const day=jstNotificationDay()
const member='11111111-1111-4111-8111-111111111111'
const uid=n=>'22222222-2222-4222-8222-'+String(n).padStart(12,'0')
const request=(query='')=>new Request('https://homeflow.invalid/api/notifications/today'+query)

test('Kakeibo alert and bill confirmation rows remain first through server-side cursor pages',async()=>{
 const sqlite=new DatabaseSync(':memory:')
 try{
  sqlite.exec(`CREATE TABLE users (id TEXT PRIMARY KEY,login_name TEXT);
    CREATE TABLE notification_inbox (
      id TEXT PRIMARY KEY, household_id TEXT, local_day TEXT,
      recipient_user_id TEXT, sender_user_id TEXT, kind TEXT, source_id TEXT,
      dedupe_key TEXT, title TEXT, message TEXT, delivery_status TEXT,
      sent_devices INTEGER,failed_devices INTEGER, created_at TEXT,
      read_at TEXT,last_completion_key TEXT);
    INSERT INTO users VALUES ('${member}','owner');`)
  const insert=sqlite.prepare(`INSERT INTO notification_inbox
    (id,household_id,local_day,recipient_user_id,kind,dedupe_key,title,message,
     delivery_status,sent_devices,failed_devices,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
  const keys=[
   'scheduled:system:prepaid-low-balance-member-hash-1',
   'scheduled:system:kakeibo:fixed:plan-1:2026-11-21',
   'scheduled:system:prepaid-high-balance-member-hash-2',
   'scheduled:system:kakeibo:variable:plan-2:2026-11',
   'scheduled:system:kakeibo:fixed:plan-3:2026-11-21',
   'scheduled:system:prepaid-low-balance-member-hash-3',
   'scheduled:system:kakeibo:variable:plan-4:2026-11'
  ]
  keys.forEach((key,index)=>insert.run(uid(index+1),'home',day,member,'system',key,
    '财务事项 '+index,'请确认','app_only',0,0,
    '2026-11-20 '+String(index+1).padStart(2,'0')+':00:00'))
  for(let i=0;i<4;i++)insert.run(uid(i+8),'home',day,member,'task',
    'scheduled:task:normal-'+i,'普通提醒 '+i,'普通内容','app_only',0,0,
    '2026-11-20 '+String(i+8).padStart(2,'0')+':00:00')
  const sqlLog=[]
  const db={prepare(sql){sqlLog.push(sql);return {bind(...args){this.args=args;return this},
   async all(){return {results:sqlite.prepare(sql).all(...this.args)}}}},
   async batch(stmts){return Promise.all(stmts.map(x=>x.all()))}}
  const session={household_id:'home',user_id:member}
  const all=[]
  let cursor=null,firstCursor=''
  for(let page=0;page<4;page++){
   const res=await notificationsRoute(request('?view=received'+
      (cursor?'&before='+encodeURIComponent(cursor):'')),db,
      '/api/notifications/today',session)
   assert.equal(res.status,200)
   const body=await res.json()
   if(page===0)firstCursor=body.nextCursor
   all.push(...body.items)
   cursor=body.nextCursor
   if(!cursor)break
  }
  assert.match(firstCursor,/^0\\|/)
  assert.equal(all.length,11)
  assert.equal(new Set(all.map(n=>n.id)).size,11)
  assert.deepEqual(all.slice(0,7).map(n=>n.kind),Array(7).fill('system'))
  assert.deepEqual(all.slice(7).map(n=>n.kind),Array(4).fill('task'))
  assert.equal(cursor,null)
  assert.match(sqlLog[0],/CASE WHEN n.kind='system'/)
  assert.match(sqlLog[0],/ORDER BY .* ASC,n.created_at DESC,n.id DESC LIMIT 6/s)
 }finally{sqlite.close()}
})

test('Kakeibo card highlights remove verbose self-completion footnote without changing sender text',()=>{
 const ui=readFileSync(new URL('../src/components/TodayNotifications.vue',import.meta.url),'utf8')
 assert.match(ui,/notice-item--ledger-alert/)
 assert.match(ui,/notice-ledger-badge/)
 assert.match(ui,/scheduled:system:kakeibo:/)
 assert.match(ui,/来自：'\+memberDisplayName\(item.senderUserId\)/)
 assert.doesNotMatch(ui,/本人完成已同步（不另发推送）/)
 assert.doesNotMatch(ui,/本人完成仅应用内同步/)
})
