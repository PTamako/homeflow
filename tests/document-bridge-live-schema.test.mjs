import test from 'node:test'
import assert from 'node:assert/strict'
import {webcrypto} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {documentAssistantBridge} from '../worker/document-assistant-bridge.js'

if(!globalThis.crypto)globalThis.crypto=webcrypto
const secret='secure-local-fixture-secret-aaaaaaaaaaaaaaaaaaaaaaaa'
const user='family_actor_123',household='family-test-1'
const candidate='0123456789abcdef0123456789abcdef'
const key='jda:homeflow:'+candidate
const path='https://homeflow.invalid/api/bridge/document-assistant'
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8')

function fixture(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec('PRAGMA foreign_keys=ON')
 const manifest=read('scripts/check_migrations.py')
 const files=[...manifest.split('MIGRATIONS=[')[1].split(']')[0]
   .matchAll(/"(\d{4}_[^"]+\.sql)"/g)].map(m=>m[1])
 for(const file of files)sqlite.exec(read('migrations/'+file))
 assert.ok(files.includes('0052_achievement_thresholds.sql'))
 sqlite.prepare('INSERT INTO households(id,display_name) VALUES(?,?)').run(household,'Test House')
 const insertUser=sqlite.prepare('INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES(?,?,?,?)')
 insertUser.run(user,'alice','x','y')
 insertUser.run('other_member_456','bob','x','y')
 const join=sqlite.prepare('INSERT INTO household_members(household_id,user_id,role) VALUES(?,?,?)')
 join.run(household,user,'owner')
 join.run(household,'other_member_456','member')
 const db={
  prepare(sql){
   const query=sqlite.prepare(sql)
   let args=[]
   return {
    bind(...values){args=values;return this},
    async first(){return query.get(...args)||null},
    async all(){return {results:query.all(...args)}},
    async run(){return {meta:{changes:Number(query.run(...args).changes)}}}
   }
  },
  async batch(statements){
   sqlite.exec('BEGIN')
   try{
    const result=[]
    for(const statement of statements)result.push(await statement.run())
    sqlite.exec('COMMIT');return result
   }catch(e){sqlite.exec('ROLLBACK');throw e}
  }
 }
 return {sqlite,env:{DB:db,JPDA_BRIDGE_ENABLED:'true',JPDA_BRIDGE_SECRET:secret,
   JPDA_BRIDGE_ALLOWED_USERS:user}}
}
async function signed(operation='task',overrides={}){
 const payload={source:'jp-document-assistant',
  source_document_id:'private-document-1',source_candidate_id:candidate,
  actor_user_id:user,idempotency_key:key,
  payload:{operation,title:'确认缴费',dueOn:'2026-12-01',
   visibility:'household',assignee:user,remindEnabled:true,bonusPoints:0,...overrides}}
 const raw=JSON.stringify(payload),timestamp=String(Date.now())
 const secretKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
  {name:'HMAC',hash:'SHA-256'},false,['sign'])
 const signature=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',secretKey,
  new TextEncoder().encode(timestamp+'\n'+raw)))).map(v=>v.toString(16).padStart(2,'0')).join('')
 return new Request(path,{method:'POST',headers:{'Content-Type':'application/json',
  'X-DA-Timestamp':timestamp,'X-DA-Signature':signature,'Idempotency-Key':key},body:raw})
}
test('real HomeFlow schema accepts signed document task exactly once and preserves privacy',async()=>{
 const f=fixture()
 try{
  const first=await documentAssistantBridge(await signed(),f.env)
  const created=await first.json()
  assert.equal(first.status,200,JSON.stringify(created))
  assert.equal(created.ok,true)
  assert.equal(created.reused,false)
  const replay=await documentAssistantBridge(await signed(),f.env)
  const replayed=await replay.json()
  assert.equal(replay.status,200,JSON.stringify(replayed))
  assert.equal(replayed.reused,true)
  assert.equal(replayed.remote_id,created.remote_id)
  const records=f.sqlite.prepare('SELECT * FROM tasks').all()
  assert.equal(records.length,1,'retries cannot duplicate tasks or reward reservations')
  assert.equal(records[0].creator_user_id,user)
  assert.equal(records[0].household_id,household)
  assert.equal(records[0].title,'确认缴费')
  assert.equal(records[0].notes,'文书助手确认事项','full OCR content is not copied')
  assert.equal(records[0].visibility,'household')
  assert.equal(records[0].bonus_points,0)
  assert.equal(records[0].completed_at,null)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM completion_points').get().n,0)
 }finally{f.sqlite.close()}
})

test('signed read-only member selection is household scoped and inserts no tasks',async()=>{
 const f=fixture()
 try{
  const response=await documentAssistantBridge(await signed('members'),f.env)
  assert.equal(response.status,200)
  const data=await response.json()
  assert.equal(data.ok,true)
  assert.equal(data.members.length,2)
  assert.deepEqual(data.members.map(m=>m.id),[user,'other_member_456'])
  assert.ok(data.members.find(m=>m.self)?.id===user)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,0)
 }finally{f.sqlite.close()}
})

test('bridge never lets a document turn a private task into another person assignment',async()=>{
 const f=fixture()
 try{
  const reply=await documentAssistantBridge(await signed('task',{
   visibility:'private',assignee:'other_member_456'}),f.env)
  assert.equal(reply.status,403)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,0)
 }finally{f.sqlite.close()}
})
