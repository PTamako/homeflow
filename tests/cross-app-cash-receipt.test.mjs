import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {pathToFileURL} from 'node:url'
import {resolve} from 'node:path'
import {approvalRoute} from '../worker/approvals.js'
import {approvalVerificationRoute} from '../worker/approval-verification.js'
import {approvalExecutionRoute} from '../worker/approval-execution.js'

// Deliberately requires the reviewed exact target checkout: no production
// services, credentials or remote databases are contacted by this test.
const targetRoot=process.env.KAKEBO_CONTRACT_ROOT
const owner={household_id:'primary',user_id:'owner',role:'owner'}
const member={household_id:'primary',user_id:'member',role:'member'}
const wrap=sql=>({prepare(statement){
 const bound=(values=[])=>({
  first:async()=>sql.prepare(statement).get(...values)||null,
  all:async()=>({results:sql.prepare(statement).all(...values)}),
  run:async()=>({meta:{changes:Number(sql.prepare(statement).run(...values).changes)}}),
  runSync:()=>({meta:{changes:Number(sql.prepare(statement).run(...values).changes)}})
 })
 return {...bound(),bind:(...values)=>bound(values)}
},async batch(statements){
 sql.exec('BEGIN');try{const result=statements.map(s=>s.runSync());sql.exec('COMMIT');return result}
 catch(e){sql.exec('ROLLBACK');throw e}
}})
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')
const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)))

test('actual HomeFlow and Kakeibo handlers reconcile a lost cash receipt after expiry',
 {skip:!targetRoot},async()=>{
 const root=resolve(targetRoot)
 const {approvedActionRoute}=await import(pathToFileURL(resolve(root,'functions/api/internal/approved-actions/[[path]].js')).href)
 const hfSql=new DatabaseSync(':memory:'),kbSql=new DatabaseSync(':memory:')
 try{
  hfSql.exec(`PRAGMA foreign_keys=ON;
   CREATE TABLE households(id TEXT PRIMARY KEY);
   CREATE TABLE users(id TEXT PRIMARY KEY,disabled_at INTEGER);
   CREATE TABLE household_members(household_id TEXT NOT NULL REFERENCES households(id),
    user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL,PRIMARY KEY(household_id,user_id));
   INSERT INTO households VALUES('primary'); INSERT INTO users VALUES('owner',NULL),('member',NULL);
   INSERT INTO household_members VALUES('primary','owner','owner'),('primary','member','member');`)
  for(const p of ['0054_household_approval_core.sql','0055_household_approval_execution_lease.sql'])
   hfSql.exec(readFileSync(new URL('../migrations/'+p,import.meta.url),'utf8'))
  kbSql.exec(`PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,description TEXT);
   CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,type TEXT,merchant TEXT,amount INTEGER,
    category TEXT,note TEXT,payment_source TEXT,transfer_target TEXT,transfer_applied INTEGER,
    transfer_date TEXT,client_request_id TEXT,raw TEXT NOT NULL DEFAULT '');`)
  for(const p of ['0022_homeflow_identity_foundation.sql','0023_family_financial_account_identities.sql',
   '0024_family_finance_pending_actions.sql','0026_family_finance_execution.sql'])
   kbSql.exec(readFileSync(resolve(root,'migrations',p),'utf8'))
  const now=Date.now(),proposal='b'.repeat(32),account='a'.repeat(32)
  kbSql.prepare(`INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,linked_at)
   VALUES('member','primary','member','Member',?)`).run(now)
  kbSql.prepare(`INSERT INTO family_financial_accounts(account_id,household_id,owner_user_id,label,
   account_kind,origin,created_by_user_id,updated_by_user_id)
   VALUES(?,'primary','member','Cash','cash','member_created','member','member')`).run(account)
  const payload=JSON.stringify({account_id:account,amount_jpy:1520,category:'食費',
   date:'2026-11-13',merchant:'店',note:'',type:'expense'})
  const enc=new TextEncoder(),digest=hex(await crypto.subtle.digest('SHA-256',enc.encode(payload)))
  const pendingKey='f'.repeat(64),secret='c'.repeat(64),iv=crypto.getRandomValues(new Uint8Array(12))
  const key=await crypto.subtle.importKey('raw',Uint8Array.from(pendingKey.match(/../g),x=>parseInt(x,16)),
   'AES-GCM',false,['encrypt'])
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,
   additionalData:enc.encode('kakeibo-finance:'+proposal)},key,enc.encode(payload))
  const hf={DB:wrap(hfSql),APP_ENV:'production',APPROVALS_ENABLED:'true',
   APPROVAL_EXECUTION_ENABLED:'true',APPROVAL_VERIFICATION_ENABLED:'true',APPROVAL_VERIFICATION_SECRET:secret}
  const kb={DB:wrap(kbSql),APP_ENV:'production',KAKEIBO_FAMILY_EXECUTION_ENABLED:'true',
   KAKEIBO_FAMILY_FINANCE_ENABLED:'true',KAKEIBO_APPROVAL_PROOF_ENABLED:'true',
   KAKEIBO_APPROVAL_VERIFICATION_SECRET:secret,KAKEIBO_FAMILY_PENDING_KEY:pendingKey,
   HOMEFLOW_OAUTH_ORIGIN:'https://homeflow.example.test'}
  kb.HOMEFLOW_IDENTITY_SERVICE={fetch:req=>approvalVerificationRoute(req,hf)}
  let lost=true,executeCalls=0,receiptCalls=0
  hf.KAKEIBO_EXECUTION_SERVICE={async fetch(req){
   const parts=new URL(req.url).pathname.split('/').slice(-1)
   if(parts[0]==='execute')executeCalls++;else if(parts[0]==='receipt')receiptCalls++
   const res=await approvedActionRoute(req,kb,parts)
   if(lost&&parts[0]==='execute'){assert.equal(res.status,200);lost=false;throw Error('lost committed response')}
   return res
  }}
  const call=async(principal,path,body)=>approvalRoute(new Request('https://homeflow.example.test'+path,{
   method:'POST',headers:{origin:'https://homeflow.example.test','content-type':'application/json'},body:JSON.stringify(body)
  }),hf,path,principal)
  const created=await call(member,'/api/approvals',{source_app:'kakebo',target_app:'kakebo',
   operation:'finance.entry.create',resource_type:'finance_entry',resource_id:proposal,
   payload_sha256:digest,idempotency_key:'kakeibo:finance:'+proposal})
  assert.equal(created.status,201,await created.clone().text())
  const approval=(await created.json()).request.request_id
  const reviewed=await call(owner,'/api/approvals/'+approval+'/review',{decision:'approve'})
  assert.equal(reviewed.status,200,await reviewed.clone().text())
  kbSql.prepare(`INSERT INTO family_finance_pending_actions(request_id,household_id,requester_user_id,
   account_id,idempotency_hash,payload_sha256,payload_cipher,payload_iv,state,homeflow_approval_id,
   created_at,expires_at,submitted_at) VALUES(?,'primary','member',?,?,?,?,?,'submitted',?,?,?,?)`)
   .run(proposal,account,'e'.repeat(64),digest,b64(encrypted),b64(iv),approval,now,now+3600000,now)
  const execute=()=>approvalExecutionRoute(new Request('https://homeflow.example.test/api/approvals/'+approval+'/execute',{
   method:'POST',headers:{origin:'https://homeflow.example.test','content-type':'application/json'},body:'{}'
  }),hf,'/api/approvals/'+approval+'/execute',owner)
  assert.equal((await execute()).status,503)
  assert.equal(kbSql.prepare('SELECT COUNT(*) n FROM entries').get().n,1)
  assert.equal(kbSql.prepare('SELECT COUNT(*) n FROM family_finance_applied_actions').get().n,1)
  assert.equal(hfSql.prepare('SELECT status FROM household_approval_requests').get().status,'failed_retryable')
  hfSql.prepare('UPDATE household_approval_requests SET expires_at=created_at+1 WHERE request_id=?').run(approval)
  await new Promise(r=>setTimeout(r,5))
  const recovered=await execute()
  assert.equal(recovered.status,200,await recovered.clone().text())
  assert.equal((await recovered.json()).applied,true)
  assert.equal(hfSql.prepare('SELECT status FROM household_approval_requests').get().status,'applied')
  assert.equal(kbSql.prepare('SELECT COUNT(*) n FROM entries').get().n,1)
  assert.equal(kbSql.prepare('SELECT COUNT(*) n FROM family_finance_events WHERE action=\'finance_entry_applied\'').get().n,1)
  assert.equal(executeCalls,1);assert.equal(receiptCalls,1)
 }finally{hfSql.close();kbSql.close()}
})
