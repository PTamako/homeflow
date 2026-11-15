// Real two-app isolated SQLite: no bank API, no production D1, no preview environment.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {webcrypto} from 'node:crypto'
import {bankTransferApprovalSubmissionRoute} from '../worker/bank-transfer-approval-submission.js'
import {approvalVerificationRoute} from '../worker/approval-verification.js'
import {approvalExecutionRoute} from '../worker/approval-execution.js'
import {approvalRoute} from '../worker/approvals.js'
import {familyCrossMemberBankTransfers} from '../.contract-kakeibo/functions/api/family-finance/cross-member-bank-transfers.js'
import {crossMemberTransferConsentsRoute} from '../worker/cross-member-transfer-consents.js'
import {crossMemberConsentProofRoute} from '../worker/cross-member-consent-proof.js'
import {approvedBankTransferRoute} from '../.contract-kakeibo/functions/api/internal/bank-transfers/[[path]].js'
if(!globalThis.crypto)globalThis.crypto=webcrypto
const hh='primary',owner='11111111-1111-4111-8111-111111111111'
const member='22222222-2222-4222-8222-222222222222'
const src='b'.repeat(32),dst='c'.repeat(32),host='https://homeflow.example.test'
const keys={approval:'1'.repeat(64),pending:'2'.repeat(64),
 submission:'3'.repeat(64),execution:'4'.repeat(64),proof:'5'.repeat(64),consent:'6'.repeat(64)}
const stmt=(db,q,...p)=>db.prepare(q).run(...p)
const get=(db,q,...p)=>db.prepare(q).get(...p)
const count=(db,table)=>get(db,'SELECT COUNT(*) n FROM '+table).n
function memory(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON')
 const db={prepare(q){return {bind(...a){return {
  first:async()=>sql.prepare(q).get(...a)||null,
  all:async()=>({results:sql.prepare(q).all(...a)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...a).changes}}),
  sync:()=>({meta:{changes:sql.prepare(q).run(...a).changes}})
 }}}},async batch(commands){
  sql.exec('BEGIN IMMEDIATE')
  try{const results=commands.map(x=>x.sync());sql.exec('COMMIT');return results}
  catch(e){sql.exec('ROLLBACK');throw e}
 }}
 return {sql,db}
}
function homeSchema(sql){
 const manifest=readFileSync(new URL('../scripts/check_migrations.py',import.meta.url),'utf8')
 const names=manifest.match(/MIGRATIONS=\[([\s\S]*?)\]/)[1].match(/"[^"]+\.sql"/g)
  .map(s=>s.slice(1,-1))
 for(const name of names)sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'))
 stmt(sql,'INSERT INTO households(id,display_name) VALUES(?,?)',hh,'Family')
 for(const [user,role] of [[owner,'owner'],[member,'member']]){
  stmt(sql,'INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES(?,?,?,?)',
   user,user,'s','v')
  stmt(sql,'INSERT INTO household_members(household_id,user_id,role) VALUES(?,?,?)',hh,user,role)
 }
}
function financeSchema(sql){
 for(const name of ['0001_support_tables.sql','0002_versioned_migration_tracking.sql',
  '0022_homeflow_identity_foundation.sql','0023_family_financial_account_identities.sql',
  '0025_family_financial_resource_owners.sql','0027_family_legacy_entry_link_audit.sql'])
  sql.exec(readFileSync(new URL('../.contract-kakeibo/migrations/'+name,import.meta.url),'utf8'))
 sql.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,amount INTEGER,'+
  'category TEXT,merchant TEXT,note TEXT,raw TEXT,type TEXT,transfer_target TEXT,'+
  'transfer_applied INTEGER,transfer_date TEXT,client_request_id TEXT UNIQUE,'+
  'payment_source TEXT,family_account_id TEXT,family_transfer_target_account_id TEXT);')
 sql.exec(readFileSync(new URL('../.contract-kakeibo/migrations/0006_sbi_portfolio_linkage.sql',import.meta.url),'utf8'))
 for(const name of [
  '0031_family_card_purchase_execution.sql','0032_family_card_settlement_foundation.sql',
  '0033_member_prepaid_actions.sql','0034_family_points_foundation.sql',
  '0035_points_prepaid_atomic.sql','0036_points_card_offset.sql',
  '0037_points_transfer_exchange.sql','0038_points_earn_expiry_reversals.sql',
  '0039_points_legacy_provenance.sql','0040_points_sbi_lots.sql',
  '0041_points_transfer_atomic_refund.sql','0042_points_prepaid_refund.sql',
  '0043_points_card_offset_refund.sql','0044_sbi_cash_purchases.sql',
  '0045_sbi_cash_reversals.sql','0046_sbi_legacy_holding_review.sql',
  '0047_sbi_point_full_refund.sql','0048_posted_bank_transfers.sql',
  '0049_cross_member_bank_transfers.sql','0050_cross_bank_statement_usage_guards.sql'])
  sql.exec(readFileSync(new URL('../.contract-kakeibo/migrations/'+name,import.meta.url),'utf8'))
 for(const [user,role] of [[owner,'owner'],[member,'member']])
  stmt(sql,'INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)',
   user,hh,role,role,'active',Date.now())
 for(const [account,opening,accountOwner] of [[src,3000,member],[dst,500,owner]])
  stmt(sql,'INSERT INTO family_financial_accounts '+
   '(account_id,household_id,owner_user_id,label,account_kind,origin,opening_balance,'+
   'created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,?,?,?,?)',
   account,hh,accountOwner,account,'bank','member_created',opening,accountOwner,accountOwner)
}
async function fixture(){
 const h=memory(),k=memory();homeSchema(h.sql);financeSchema(k.sql)
 const home={APP_ENV:'production',DB:h.db,
  APPROVALS_ENABLED:'true',APPROVAL_EXECUTION_ENABLED:'true',
  APPROVAL_VERIFICATION_ENABLED:'true',APPROVAL_VERIFICATION_SECRET:keys.approval,
  BANK_TRANSFER_APPROVAL_SUBMISSION_ENABLED:'true',BANK_TRANSFER_SUBMISSION_SECRET:keys.submission,
  BANK_TRANSFER_APPROVAL_EXECUTION_ENABLED:'true',
  BANK_TRANSFER_EXECUTION_SECRET:keys.execution,
  BANK_TRANSFER_APPROVAL_PROOF_SECRET:keys.proof,
  CROSS_MEMBER_TRANSFER_CONSENTS_ENABLED:'true',CROSS_MEMBER_TRANSFER_PROOF_ENABLED:'true',
  CROSS_MEMBER_TRANSFER_PROOF_SECRET:keys.consent}
 const finance={APP_ENV:'production',DB:k.db,KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_BANK_TRANSFER_ENABLED:'true',KAKEIBO_CROSS_MEMBER_BANK_ENABLED:'true',
  KAKEIBO_CROSS_MEMBER_PROOF_SECRET:keys.consent,KAKEIBO_FAMILY_PENDING_KEY:keys.pending,
  KAKEIBO_BANK_TRANSFER_SUBMISSION_SECRET:keys.submission,
  KAKEIBO_BANK_TRANSFER_EXECUTION_SECRET:keys.execution,
  KAKEIBO_BANK_TRANSFER_PROOF_SECRET:keys.proof,HOMEFLOW_OAUTH_ORIGIN:host}
 const calls={submission:0,proof:0,execute:0,receipt:0}
 finance.HOMEFLOW_IDENTITY_SERVICE={async fetch(req){
  if(new URL(req.url).pathname.endsWith('/bank-transfer-submit')){
   calls.submission++;return bankTransferApprovalSubmissionRoute(req,home)
  }
  if(new URL(req.url).pathname.endsWith('/cross-member/consent-proof'))
   return crossMemberConsentProofRoute(req,home)
  calls.proof++;return approvalVerificationRoute(req,home)
 }}
 home.KAKEIBO_BANK_TRANSFER_EXECUTION_SERVICE={async fetch(req){
  const mode=new URL(req.url).pathname.split('/').at(-1)
  calls[mode]++;return approvedBankTransferRoute(req,finance,[mode])
 }}
 const form={expected_user_id:member,idempotency_key:'real-cross-member-posted-bank-20261115',
  recipient_user_id:owner,source_account_id:src,source_version:1,
  target_account_id:dst,target_version:1,debit_date:'2026-11-13',
  amount_jpy:1500,source_bank_reference:'source-cross-bank-posted-20261113',
  bank_debit_posted:true}
 const recipientForm={expected_user_id:owner,credit_date:'2026-11-14',
  amount_jpy:1500,target_bank_reference:'recipient-cross-bank-posted-20261114',bank_credit_posted:true}
 const u=new URL('https://kakeibo.example.test/api/family-finance/cross-member-bank-transfers')
 const memberSession={user_id:member,household_id:hh,role:'member'}
 const ownerSession={user_id:owner,household_id:hh,role:'owner'}
 const source=async(parts,body,actor=memberSession)=>{
  const req=new Request(u,{method:'POST',headers:{origin:u.origin,'content-type':'application/json'},
   body:JSON.stringify(body)})
  const res=await familyCrossMemberBankTransfers(req,finance,u,actor,parts)
  return {status:res.status,data:await res.json()}
 }
 const consentAction=async(path,body,actor)=>{
  const req=new Request(host+path,{method:'POST',headers:{origin:host,'content-type':'application/json'},
   body:JSON.stringify(body)})
  const res=await crossMemberTransferConsentsRoute(req,home,path,actor)
  return {status:res.status,data:await res.json()}
 }
 const request=async()=>{
  const p=await source(['cross-member-bank-transfers'],form)
  assert.equal(p.status,201,JSON.stringify(p))
  const id=p.data.prepared.request_id
  assert.equal(count(k.sql,'entries'),0)
  const root='/api/finance-cross-member/consents'
  const created=await consentAction(root,{expected_user_id:member,
   recipient_user_id:owner,resource_id:id,payload_sha256:p.data.prepared.payload_sha256,
   source_account_version:1,recipient_account_version:1,source_confirmed:true,
   idempotency_key:'real-cross-bank-consent-20261115'},memberSession)
  assert.equal(created.status,201,JSON.stringify(created))
  const consentId=created.data.consent.consent_id
  const received=await source(['cross-member-bank-transfers',id,'recipient'],
   recipientForm,ownerSession)
  assert.equal(received.status,201,JSON.stringify(received))
  const accepted=await consentAction(root+'/'+consentId+'/recipient',
   {expected_user_id:owner,expected_version:1,decision:'accept'},ownerSession)
  assert.equal(accepted.status,200,JSON.stringify(accepted))
  const authorized=await consentAction(root+'/'+consentId+'/authorize',
   {expected_user_id:owner,expected_version:2},ownerSession)
  assert.equal(authorized.status,200,JSON.stringify(authorized))
  const sub=await source(['cross-member-bank-transfers',id,'submit'],
   {expected_user_id:member,consent_id:consentId})
  assert.equal(sub.status,200,JSON.stringify(sub))
  return {approval_id:sub.data.approval_id,consent_id:consentId,resource_id:id}
 }
 const review=async approval=>{
  const path='/api/approvals/'+approval+'/review'
  return approvalRoute(new Request(host+path,{method:'POST',
   headers:{origin:host,'content-type':'application/json'},
   body:JSON.stringify({decision:'approve'})}),home,path,
   {user_id:owner,household_id:hh,role:'owner'})
 }
 const execute=async approval=>{
  const path='/api/approvals/'+approval+'/execute'
  const res=await approvalExecutionRoute(new Request(host+path,{method:'POST',
   headers:{origin:host,'content-type':'application/json'},body:'{}'}),
   home,path,{user_id:owner,household_id:hh,role:'owner'})
  return {status:res.status,data:await res.json()}
 }
 return {h,k,home,finance,calls,form,source,request,review,execute,
  close(){h.sql.close();k.sql.close()}}
}
test('four stages: two real HomeFlow SSO actors + consent + owner approval + Kakeibo immutable double entry',async()=>{
 const f=await fixture();try{
  const r=await f.request()
  assert.equal(count(f.k.sql,'entries'),0)
  assert.equal(get(f.h.sql,'SELECT status FROM household_cross_member_transfer_consents WHERE consent_id=?',
   r.consent_id).status,'owner_authorized')
  assert.equal(get(f.h.sql,'SELECT status FROM household_approval_requests WHERE request_id=?',
   r.approval_id).status,'pending')
  assert.equal((await f.review(r.approval_id)).status,200)
  const done=await f.execute(r.approval_id)
  assert.equal(done.status,200,JSON.stringify(done))
  assert.equal(done.data.applied,true)
  assert.equal(get(f.h.sql,'SELECT status FROM household_approval_requests WHERE request_id=?',
   r.approval_id).status,'applied')
  assert.equal(count(f.k.sql,'entries'),1)
  assert.equal(count(f.k.sql,'family_cross_bank_journal'),1)
  assert.equal(count(f.k.sql,'family_cross_bank_actor_audit'),1)
  assert.equal(count(f.k.sql,'family_cross_bank_recipient_evidence'),1)
  const e=get(f.k.sql,'SELECT * FROM entries')
  assert.equal(e.type,'transfer');assert.equal(e.amount,1500)
  assert.equal(e.family_account_id,src);assert.equal(e.family_transfer_target_account_id,dst)
  const journal=get(f.k.sql,'SELECT * FROM family_cross_bank_journal')
  assert.equal(journal.requester_user_id,member)
  assert.equal(journal.recipient_user_id,owner)
  assert.equal(journal.consent_id,r.consent_id)
  const again=await f.execute(r.approval_id)
  assert.equal(again.status,200,JSON.stringify(again))
  assert.equal(count(f.k.sql,'entries'),1)
 }finally{f.close()}
})
test('signed Kakeibo commit succeeds but HomeFlow receipt lost: same ID recovers, no second journal',async()=>{
 const f=await fixture();try{
  const r=await f.request()
  assert.equal((await f.review(r.approval_id)).status,200)
  const direct=f.home.KAKEIBO_BANK_TRANSFER_EXECUTION_SERVICE
  let lost=true
  f.home.KAKEIBO_BANK_TRANSFER_EXECUTION_SERVICE={async fetch(req){
   const result=await direct.fetch(req)
   if(lost){lost=false;throw Error('CROSS_BANK_TARGET_RECEIPT_LOST')}
   return result
  }}
  const unknown=await f.execute(r.approval_id)
  assert.notEqual(unknown.status,200)
  assert.equal(count(f.k.sql,'family_cross_bank_journal'),1)
  const restored=await f.execute(r.approval_id)
  assert.equal(restored.status,200,JSON.stringify(restored))
  assert.equal(get(f.h.sql,'SELECT status FROM household_approval_requests WHERE request_id=?',
   r.approval_id).status,'applied')
  assert.equal(count(f.k.sql,'entries'),1)
  assert.equal(count(f.k.sql,'family_cross_bank_journal'),1)
 }finally{f.close()}
})
test('revoked independent consent / stale second account / audit failure refuse HomeFlow applied',async()=>{
 for(const kind of ['revoke','account','audit']){
  const f=await fixture();try{
   const r=await f.request()
   assert.equal((await f.review(r.approval_id)).status,200)
   if(kind==='revoke'){
    const route='/api/finance-cross-member/consents/'+r.consent_id+'/revoke'
    const res=await crossMemberTransferConsentsRoute(new Request(host+route,{method:'POST',
     headers:{origin:host,'content-type':'application/json'},
     body:JSON.stringify({expected_user_id:member,expected_version:3})}),
     f.home,route,{user_id:member,household_id:hh,role:'member'})
    assert.equal(res.status,200)
   }
   if(kind==='account')stmt(f.k.sql,'UPDATE family_financial_accounts SET version=version+1 WHERE account_id=?',dst)
   if(kind==='audit')f.k.sql.exec("CREATE TRIGGER deny_cross_audit BEFORE INSERT ON family_cross_bank_actor_audit BEGIN SELECT RAISE(ABORT,'AUDIT_FAILED'); END;")
   const done=await f.execute(r.approval_id)
   assert.notEqual(done.status,200,kind)
   assert.equal(count(f.k.sql,'entries'),0)
   assert.equal(count(f.k.sql,'family_cross_bank_journal'),0)
   assert.notEqual(get(f.h.sql,'SELECT status FROM household_approval_requests WHERE request_id=?',
    r.approval_id).status,'applied')
  }finally{f.close()}
 }
})
