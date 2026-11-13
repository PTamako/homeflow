import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {loadScheduledRecipients} from '../worker/webpush.js'

function fixture(){
  const sqlite=new DatabaseSync(':memory:')
  sqlite.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,disabled_at TEXT);
    CREATE TABLE household_members(household_id TEXT,user_id TEXT,PRIMARY KEY(household_id,user_id));
    CREATE TABLE push_subscriptions(endpoint_hash TEXT PRIMARY KEY,endpoint TEXT,
      p256dh TEXT,auth_secret TEXT,user_id TEXT,household_id TEXT);
    CREATE INDEX idx_push_subs_user ON push_subscriptions(user_id);`)
  const users=sqlite.prepare('INSERT INTO users(id,disabled_at) VALUES(?,?)')
  const members=sqlite.prepare('INSERT INTO household_members(household_id,user_id) VALUES(?,?)')
  const subs=sqlite.prepare(`INSERT INTO push_subscriptions
    (endpoint_hash,endpoint,p256dh,auth_secret,user_id,household_id)
    VALUES(?,?,?,?,?,?)`)
  for(let i=0;i<205;i++){
    const id='u'+String(i).padStart(4,'0'),house=i<203?'a-home':'b-home'
    users.run(id,i===204?'disabled':null)
    members.run(house,id)
    subs.run('ep'+String(i).padStart(4,'0'),'https://push.example/'+i,'key','secret',id,house)
  }
  // Two endpoints belonging to the same user test the compound keyset cursor.
  subs.run('ep9999','https://push.example/more','key','secret','u0199','a-home')
  let reads=0
  const db={prepare(sql){const q=sqlite.prepare(sql);return {
    bind(...args){return {all:async()=>{reads++;return {results:q.all(...args)}}}}
  }}}
  return {sqlite,db,reads:()=>reads}
}

test('hourly schedule reads all recipients and devices beyond the old 200-row cap',async()=>{
 const f=fixture()
 try{
  const {members,subscriptions}=await loadScheduledRecipients(f.db,true)
  assert.equal(members.length,204,'disabled members must stay excluded')
  assert.equal(subscriptions.length,206)
  assert.equal(new Set(subscriptions.map(row=>row.endpoint_hash)).size,206)
  assert.equal(members.at(-1).household_id,'b-home')
  assert.ok(f.reads()>=4,'both tables require more than one page')
 }finally{f.sqlite.close()}
})

test('schedule still creates application notices when VAPID is not configured',async()=>{
 const f=fixture()
 try{
  const {members,subscriptions}=await loadScheduledRecipients(f.db,false)
  assert.equal(members.length,204)
  assert.deepEqual(subscriptions,[])
 }finally{f.sqlite.close()}
})
