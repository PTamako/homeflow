import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {webcrypto,createHmac} from 'node:crypto';
import {crossMemberTransferConsentsRoute} from '../worker/cross-member-transfer-consents.js';
import {crossMemberConsentProofRoute} from '../worker/cross-member-consent-proof.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const source={household_id:'primary',user_id:'member',role:'member'};
const recipient={household_id:'primary',user_id:'owner',role:'owner'};
const forgedOwner={...source,role:'owner'};
const otherHousehold={household_id:'second',user_id:'stranger',role:'owner'};
const requestBody={
 expected_user_id:'member',recipient_user_id:'owner',
 resource_id:'b'.repeat(32),payload_sha256:'c'.repeat(64),
 source_account_version:1,recipient_account_version:2,
 source_confirmed:true,idempotency_key:'cross-member-bank-20261115-test-001'
};
const count=(sql,table)=>sql.prepare('SELECT COUNT(*) n FROM '+table).get().n;
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE households(id TEXT PRIMARY KEY);
 CREATE TABLE users(id TEXT PRIMARY KEY,disabled_at INTEGER);
 CREATE TABLE household_members(
  household_id TEXT NOT NULL REFERENCES households(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('owner','member')),
  PRIMARY KEY(household_id,user_id)
 );
 INSERT INTO households VALUES('primary'),('second');
 INSERT INTO users VALUES('owner',NULL),('member',NULL),('stranger',NULL),('alt',NULL);
 INSERT INTO household_members VALUES('primary','owner','owner'),
 ('primary','member','member'),('second','stranger','owner'),('second','alt','member');
 `);
 sql.exec(readFileSync(new URL('../migrations/0058_cross_member_transfer_consents.sql',import.meta.url),'utf8'));
 const db={prepare(q){return {bind(...args){return {
  first:async()=>sql.prepare(q).get(...args)||null,
  all:async()=>({results:sql.prepare(q).all(...args)}),
  run:async()=>({meta:{changes:Number(sql.prepare(q).run(...args).changes)}})
 }}}}};
 const env={APP_ENV:'production',DB:db,APPROVALS_ENABLED:'true',
  CROSS_MEMBER_TRANSFER_CONSENTS_ENABLED:'true'};
 async function call(user,path,body,method='POST',origin='https://homeflow.example.test'){
  const req=new Request('https://homeflow.example.test'+path,{method,
   headers:method==='POST'?{'content-type':'application/json',origin}:{},
   ...(method==='POST'?{body:JSON.stringify(body)}:{})});
  const res=await crossMemberTransferConsentsRoute(req,env,path,user);
  return {status:res.status,data:await res.json()};
 }
 const root='/api/finance-cross-member/consents';
 const create=(principal=source,body=requestBody)=>call(principal,root,body);
 return {sql,env,db,call,root,create,close:()=>sql.close()};
}
test('real SQLite requires sender, recipient and admin to make three separate audited decisions; never posts funds',async()=>{
 const f=fixture();try{
  const made=await f.create();
  assert.equal(made.status,201,JSON.stringify(made));
  const id=made.data.consent.consent_id;
  assert.equal(made.data.consent.status,'awaiting_recipient');
  assert.equal(made.data.consent.execution_permitted,false);
  assert.equal(made.data.consent.ledger_applied,false);
  assert.equal(count(f.sql,'household_cross_member_transfer_events'),1);
  const premature=await f.call(recipient,f.root+'/'+id+'/authorize',
   {expected_user_id:'owner',expected_version:1});
  assert.equal(premature.status,409);
  assert.equal(count(f.sql,'household_cross_member_transfer_events'),1);
  const wrongActor=await f.call(source,f.root+'/'+id+'/recipient',
   {expected_user_id:'member',expected_version:1,decision:'accept'});
  assert.equal(wrongActor.status,403);
  const accept=await f.call(recipient,f.root+'/'+id+'/recipient',
   {expected_user_id:'owner',expected_version:1,decision:'accept'});
  assert.equal(accept.status,200,JSON.stringify(accept));
  assert.equal(accept.data.consent.status,'recipient_accepted');
  assert.equal(accept.data.consent.version,2);
  assert.equal(accept.data.consent.execution_permitted,false);
  assert.equal(count(f.sql,'household_cross_member_transfer_events'),2);
  const stale=await f.call(recipient,f.root+'/'+id+'/authorize',
   {expected_user_id:'owner',expected_version:1});
  assert.equal(stale.status,409);
  const unauthorized=await f.call(forgedOwner,f.root+'/'+id+'/authorize',
   {expected_user_id:'member',expected_version:2});
  assert.equal(unauthorized.status,403);
  const authorize=await f.call(recipient,f.root+'/'+id+'/authorize',
   {expected_user_id:'owner',expected_version:2});
  assert.equal(authorize.status,200,JSON.stringify(authorize));
  assert.equal(authorize.data.consent.status,'owner_authorized');
  assert.equal(authorize.data.consent.execution_permitted,false);
  assert.equal(authorize.data.consent.ledger_applied,false);
  assert.equal(count(f.sql,'household_cross_member_transfer_events'),3);
  assert.deepEqual(f.sql.prepare('SELECT action,actor_user_id FROM household_cross_member_transfer_events '+
   'ORDER BY new_version').all().map(x=>({...x})),[
    {action:'source_consented',actor_user_id:'member'},
    {action:'recipient_accepted',actor_user_id:'owner'},
    {action:'owner_authorized',actor_user_id:'owner'}
   ]);
  const query=await f.call(source,f.root+'/'+id,null,'GET');
  assert.equal(query.status,200);assert.equal(query.data.consent.execution_permitted,false);
  const noReadAudit=count(f.sql,'household_cross_member_transfer_events');
  await f.call(source,f.root,null,'GET');
  assert.equal(count(f.sql,'household_cross_member_transfer_events'),noReadAudit);
  assert.throws(()=>f.sql.prepare("UPDATE household_cross_member_transfer_consents SET payload_sha256='d'").run(),
   /CROSS_TRANSFER_TERMS_IMMUTABLE|CROSS_TRANSFER_CONSENT_STATE_OR_ACTOR_INVALID|CHECK constraint failed/);
  assert.throws(()=>f.sql.prepare('DELETE FROM household_cross_member_transfer_events').run(),
   /CROSS_TRANSFER_EVENT_IMMUTABLE/);
 }finally{f.close()}
});
test('owner as source to member as recipient needs independent member consent and separate owner authorization',async()=>{
 const f=fixture();try{
  const body={...requestBody,expected_user_id:'owner',recipient_user_id:'member'};
  const made=await f.create(recipient,body);
  assert.equal(made.status,201);
  const id=made.data.consent.consent_id;
  assert.equal((await f.call(recipient,f.root+'/'+id+'/authorize',
   {expected_user_id:'owner',expected_version:1})).status,409);
  const accepted=await f.call(source,f.root+'/'+id+'/recipient',
   {expected_user_id:'member',expected_version:1,decision:'accept'});
  assert.equal(accepted.status,200);
  assert.equal((await f.call(recipient,f.root+'/'+id+'/authorize',
   {expected_user_id:'owner',expected_version:2})).status,200);
  const revoked=await f.call(source,f.root+'/'+id+'/revoke',
   {expected_user_id:'member',expected_version:3});
  assert.equal(revoked.status,200);
  assert.equal(revoked.data.consent.status,'revoked');
  assert.equal(revoked.data.consent.execution_permitted,false);
  assert.equal(count(f.sql,'household_cross_member_transfer_events'),4);
  assert.equal((await f.call(recipient,f.root+'/'+id+'/authorize',
   {expected_user_id:'owner',expected_version:4})).status,409);
 }finally{f.close()}
});
test('rejected/cancelled, disabled member, foreign household, forged identity or CSRF cannot authorize',async()=>{
 const f=fixture();try{
  const badOrigin=await f.call(source,f.root,requestBody,'POST','https://attacker.example');
  assert.equal(badOrigin.status,403);
  const forgedRequest=await f.create(source,{...requestBody,expected_user_id:'owner'});
  assert.equal(forgedRequest.status,403);
  const foreign=await f.create(source,{...requestBody,recipient_user_id:'stranger'});
  assert.equal(foreign.status,403);
  const made=await f.create();assert.equal(made.status,201);
  const id=made.data.consent.consent_id;
  assert.equal((await f.call(otherHousehold,f.root+'/'+id,null,'GET')).status,404);
  const rejected=await f.call(recipient,f.root+'/'+id+'/recipient',
   {expected_user_id:'owner',expected_version:1,decision:'reject'});
  assert.equal(rejected.status,200);
  assert.equal(rejected.data.consent.status,'recipient_rejected');
  assert.equal((await f.call(recipient,f.root+'/'+id+'/authorize',
   {expected_user_id:'owner',expected_version:2})).status,409);
  const fresh=await f.create(source,{...requestBody,resource_id:'d'.repeat(32),
   idempotency_key:'cross-member-bank-20261115-test-002'});
  assert.equal(fresh.status,201);
  f.sql.prepare('UPDATE users SET disabled_at=1 WHERE id=?').run('owner');
  const revoked=await f.call(recipient,f.root+'/'+fresh.data.consent.consent_id+'/recipient',
   {expected_user_id:'owner',expected_version:1,decision:'accept'});
  assert.notEqual(revoked.status,200);
  assert.equal(count(f.sql,'household_cross_member_transfer_events'),3);
  const invalidSource=await f.create(source,{...requestBody,resource_id:'e'.repeat(32),
   idempotency_key:'cross-member-bank-20261115-test-003'});
  assert.equal(invalidSource.status,403);
 }finally{f.close()}
});
test('duplicate source retries return exact immutable intent; changed payload or another member cannot replay',async()=>{
 const f=fixture();try{
  const made=await f.create();
  assert.equal(made.status,201);
  const replay=await f.create();
  assert.equal(replay.status,200);
  assert.equal(replay.data.replayed,true);
  assert.equal(replay.data.consent.consent_id,made.data.consent.consent_id);
  const changed=await f.create(source,{...requestBody,payload_sha256:'d'.repeat(64)});
  assert.equal(changed.status,409);
  const another=await f.create(recipient,{...requestBody,expected_user_id:'owner',
   recipient_user_id:'member',resource_id:'b'.repeat(32)});
  assert.equal(another.status,409);
  assert.equal(count(f.sql,'household_cross_member_transfer_consents'),1);
  assert.equal(count(f.sql,'household_cross_member_transfer_events'),1);
 }finally{f.close()}
});
test('audit fault rolls back consent transition and owner may not bypass recipient approval',async()=>{
 const f=fixture();try{
  const made=await f.create();assert.equal(made.status,201);
  const id=made.data.consent.consent_id;
  f.sql.exec("CREATE TRIGGER deny_cross_member_audit BEFORE INSERT ON household_cross_member_transfer_events "+
   "WHEN NEW.action='recipient_accepted' BEGIN SELECT RAISE(ABORT,'CROSS_MEMBER_AUDIT_FAILURE'); END;");
  const failed=await f.call(recipient,f.root+'/'+id+'/recipient',
   {expected_user_id:'owner',expected_version:1,decision:'accept'});
  assert.equal(failed.status,409);
  assert.equal(f.sql.prepare('SELECT status FROM household_cross_member_transfer_consents').get().status,
   'awaiting_recipient');
  assert.equal(count(f.sql,'household_cross_member_transfer_events'),1);
  const forged=f.sql.prepare("UPDATE household_cross_member_transfer_consents SET status='owner_authorized',"+
   "last_actor_user_id='owner',version=2,updated_at=? WHERE consent_id=?");
  assert.throws(()=>forged.run(Date.now(),id),/CROSS_TRANSFER_CONSENT_STATE_OR_ACTOR_INVALID|CHECK constraint failed/);
  assert.equal(count(f.sql,'household_cross_member_transfer_events'),1);
 }finally{f.close()}
});


test('signed backend-only read proof requires all 3 independent decisions and live identities; never grants ledger execution',async()=>{
 const f=fixture();try{
  f.env.CROSS_MEMBER_TRANSFER_PROOF_ENABLED='true';
  f.env.CROSS_MEMBER_TRANSFER_PROOF_SECRET='a'.repeat(64);
  const made=await f.create();assert.equal(made.status,201);
  const id=made.data.consent.consent_id;
  const input={
   consent_id:id,resource_id:requestBody.resource_id,household_id:'primary',
   source_user_id:'member',recipient_user_id:'owner',
   payload_sha256:requestBody.payload_sha256,
   source_account_version:1,recipient_account_version:2
  };
  async function proof(body=input,{badSignature=false,withOrigin=false,withCookie=false}={}){
   const raw=JSON.stringify(body),stamp=String(Date.now());
   const signature=createHmac('sha256',Buffer.from(f.env.CROSS_MEMBER_TRANSFER_PROOF_SECRET,'hex'))
    .update('kakeibo-cross-member:consent-proof\n'+stamp+'\n'+raw).digest('hex');
   const headers={'content-type':'application/json',
    'x-approval-client':'kakeibo-cross-member',
    'x-approval-timestamp':stamp,
    'x-approval-signature':badSignature?'f'.repeat(64):signature};
   if(withOrigin)headers.origin='https://homeflow.example.test';
   if(withCookie)headers.cookie='__Host-hf_session=fake';
   const response=await crossMemberConsentProofRoute(new Request(
    'https://homeflow.example.test/api/internal/cross-member/consent-proof',
    {method:'POST',headers,body:raw}),f.env);
   return {status:response.status,data:await response.json()};
  }
  assert.equal((await proof()).status,409);
  assert.equal((await proof(input,{badSignature:true})).status,403);
  assert.equal((await proof(input,{withOrigin:true})).status,403);
  assert.equal((await proof(input,{withCookie:true})).status,403);
  assert.equal((await f.call(recipient,f.root+'/'+id+'/recipient',
   {expected_user_id:'owner',expected_version:1,decision:'accept'})).status,200);
  assert.equal((await proof()).status,409);
  assert.equal((await f.call(recipient,f.root+'/'+id+'/authorize',
   {expected_user_id:'owner',expected_version:2})).status,200);
  const confirmed=await proof();
  assert.equal(confirmed.status,200,JSON.stringify(confirmed));
  assert.equal(confirmed.data.consent_verified,true);
  assert.equal(confirmed.data.ledger_applied,false);
  assert.equal(confirmed.data.bank_statements_verified,false);
  assert.equal(confirmed.data.target_ledger_authorized,false);
  assert.equal(confirmed.data.consent_version,3);
  assert.equal((await proof({...input,payload_sha256:'b'.repeat(64)})).status,409);
  assert.equal((await proof({...input,recipient_account_version:3})).status,409);
  assert.equal((await proof({...input,source_user_id:'owner'})).status,400);
  assert.equal((await proof({...input,household_id:'second'})).status,409);
  assert.equal(count(f.sql,'household_cross_member_transfer_events'),3);
  assert.equal((await f.call(source,f.root+'/'+id+'/revoke',
   {expected_user_id:'member',expected_version:3})).status,200);
  assert.equal((await proof()).status,409);
  assert.equal(count(f.sql,'household_cross_member_transfer_events'),4);
 }finally{f.close()}
});
test('signed cross-member proof rejects inactive recipient even after full authorization',async()=>{
 const f=fixture();try{
  f.env.CROSS_MEMBER_TRANSFER_PROOF_ENABLED='true';
  f.env.CROSS_MEMBER_TRANSFER_PROOF_SECRET='b'.repeat(64);
  const made=await f.create();const id=made.data.consent.consent_id;
  assert.equal((await f.call(recipient,f.root+'/'+id+'/recipient',
   {expected_user_id:'owner',expected_version:1,decision:'accept'})).status,200);
  assert.equal((await f.call(recipient,f.root+'/'+id+'/authorize',
   {expected_user_id:'owner',expected_version:2})).status,200);
  f.sql.prepare('UPDATE users SET disabled_at=1 WHERE id=?').run('owner');
  const body={consent_id:id,resource_id:requestBody.resource_id,household_id:'primary',
   source_user_id:'member',recipient_user_id:'owner',payload_sha256:requestBody.payload_sha256,
   source_account_version:1,recipient_account_version:2};
  const raw=JSON.stringify(body),stamp=String(Date.now());
  const mac=createHmac('sha256',Buffer.from(f.env.CROSS_MEMBER_TRANSFER_PROOF_SECRET,'hex'))
   .update('kakeibo-cross-member:consent-proof\n'+stamp+'\n'+raw).digest('hex');
  const result=await crossMemberConsentProofRoute(new Request(
   'https://homeflow.example.test/api/internal/cross-member/consent-proof',
   {method:'POST',headers:{'content-type':'application/json',
    'x-approval-client':'kakeibo-cross-member','x-approval-timestamp':stamp,
    'x-approval-signature':mac},body:raw}),f.env);
  assert.equal(result.status,409);
  assert.equal((await result.json()).consent_verified,false);
  assert.equal(count(f.sql,'household_cross_member_transfer_events'),3);
 }finally{f.close()}
});
