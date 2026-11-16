import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {webcrypto,createHmac} from 'node:crypto'
import {crossMemberConsentSubmissionRoute} from '../worker/cross-member-consent-submission.js'
if(!globalThis.crypto)globalThis.crypto=webcrypto
const secret='d'.repeat(64),origin='https://homeflow.example.test'
const body=()=>({household_id:'primary',requester_user_id:'member',
 recipient_user_id:'owner',resource_id:'a'.repeat(32),
 payload_sha256:'b'.repeat(64),source_account_version:1,recipient_account_version:2})
function fixture(){
 const sql=new DatabaseSync(':memory:')
 sql.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE households(id TEXT PRIMARY KEY);
 CREATE TABLE users(id TEXT PRIMARY KEY,disabled_at INTEGER);
 CREATE TABLE household_members(household_id TEXT,user_id TEXT,role TEXT,
   PRIMARY KEY(household_id,user_id));
 INSERT INTO households VALUES('primary');
 INSERT INTO users VALUES('owner',NULL),('member',NULL);
 INSERT INTO household_members VALUES('primary','owner','owner'),('primary','member','member');`)
 sql.exec(readFileSync(new URL('../migrations/0058_cross_member_transfer_consents.sql',import.meta.url),'utf8'))
 const DB={prepare(query){return{bind(...a){return{
  first:async()=>sql.prepare(query).get(...a)||null,
  all:async()=>({results:sql.prepare(query).all(...a)}),
  run:async()=>({meta:{changes:sql.prepare(query).run(...a).changes}})
 }}}}}
 const env={APP_ENV:'production',APPROVALS_ENABLED:'true',DB,
  CROSS_MEMBER_TRANSFER_CONSENTS_ENABLED:'true',CROSS_MEMBER_TRANSFER_PROOF_ENABLED:'true',
  CROSS_MEMBER_TRANSFER_PROOF_SECRET:secret}
 async function submit(input=body(),{badSignature=false,originHeader=false,
  wrongClient=false,additionalCookie=false}={}){
  const raw=JSON.stringify(input),ts=String(Date.now())
  const sig=createHmac('sha256',Buffer.from(secret,'hex'))
   .update('kakeibo-cross-member:consent-submit\n'+ts+'\n'+raw).digest('hex')
  const response=await crossMemberConsentSubmissionRoute(new Request(origin+'/api/internal/cross-member/consent-submit',{
   method:'POST',headers:{'content-type':'application/json',
   'x-approval-client':wrongClient?'browser':'kakeibo-cross-member',
   'x-approval-timestamp':ts,'x-approval-signature':badSignature?'0'.repeat(64):sig,
   ...(originHeader?{origin}:{ }),
   ...(additionalCookie?{cookie:'hf_session=bad'}:{})},body:raw}),env)
  return {status:response.status,data:await response.json()}
 }
 return {sql,env,submit,close:()=>sql.close()}
}
test('signed Kakeibo source intent produces exactly one separately reviewed HomeFlow consent',async()=>{
 const f=fixture()
 try{
  const first=await f.submit()
  assert.equal(first.status,201,JSON.stringify(first))
  assert.equal(first.data.consent.status,'awaiting_recipient')
  assert.equal(first.data.consent.source_user_id,'member')
  assert.equal(first.data.consent.recipient_user_id,'owner')
  assert.equal(first.data.consent.execution_permitted,false)
  assert.equal(first.data.ledger_applied,false)
  assert.equal((await f.submit()).data.replayed,true)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_cross_member_transfer_consents').get().n,1)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_cross_member_transfer_events').get().n,1)
 }finally{f.close()}
})
test('invalid signature, browser origin/cookie and wrong member roles fail closed',async()=>{
 const f=fixture()
 try{
  for(const opts of [{badSignature:true},{originHeader:true},{additionalCookie:true},{wrongClient:true}])
   assert.equal((await f.submit(body(),opts)).status,403)
  assert.equal((await f.submit({...body(),requester_user_id:'owner'})).status,403)
  assert.equal((await f.submit({...body(),recipient_user_id:'member'})).status,400)
  f.sql.prepare("UPDATE users SET disabled_at=1 WHERE id='owner'").run()
  assert.equal((await f.submit()).status,403)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_cross_member_transfer_consents').get().n,0)
 }finally{f.close()}
})
test('immutability prevents different encrypted bank payload from hijacking an existing consent',async()=>{
 const f=fixture()
 try{
  assert.equal((await f.submit()).status,201)
  const different=await f.submit({...body(),payload_sha256:'c'.repeat(64)})
  assert.equal(different.status,409)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM household_cross_member_transfer_consents').get().n,1)
 }finally{f.close()}
})
