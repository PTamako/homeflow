// Read-only Stage F Cloudflare G8 existence preflight. NEVER sets flags,
// writes secrets or modifies D1/Workers/Pages. Names/types only, no values.
// Passing this partial inventory does NOT pass G8 (requires final values,
// migration, security, cost and rollback checks independently).
import {fileURLToPath} from 'node:url';

export const REQUIRED_WORKERS={
 homeflow:{
  names:['APP_ENV','DB','MEDIA','OAUTH_ENABLED','OAUTH_CLIENT_REDIRECTS',
   'APPROVALS_ENABLED','APPROVAL_EXECUTION_ENABLED','APPROVAL_VERIFICATION_ENABLED',
   'APPROVAL_VERIFICATION_SECRET','SHARED_ENTRY_APPROVAL_EXECUTION_ENABLED',
   'SHARED_ENTRY_EXECUTION_SECRET','SHARED_ENTRY_APPROVAL_PROOF_SECRET',
   'BANK_TRANSFER_APPROVAL_EXECUTION_ENABLED','BANK_TRANSFER_EXECUTION_SECRET',
   'BANK_TRANSFER_APPROVAL_PROOF_SECRET','CARD_APPROVAL_EXECUTION_ENABLED',
   'CARD_EXECUTION_SECRET','CARD_APPROVAL_PROOF_SECRET',
   'CARD_SETTLEMENT_APPROVAL_EXECUTION_ENABLED','CARD_SETTLEMENT_EXECUTION_SECRET',
   'CARD_SETTLEMENT_APPROVAL_PROOF_SECRET','POINTS_APPROVAL_EXECUTION_ENABLED',
   'POINTS_EXECUTION_SECRET','POINTS_APPROVAL_PROOF_SECRET',
   'PREPAID_APPROVAL_EXECUTION_ENABLED','PREPAID_EXECUTION_SECRET',
   'PREPAID_APPROVAL_PROOF_SECRET','SBI_CASH_APPROVAL_EXECUTION_ENABLED',
   'SBI_CASH_EXECUTION_SECRET','SBI_CASH_APPROVAL_PROOF_SECRET',
   'DOCUMENT_EXECUTION_ENABLED','DOCUMENT_EXECUTION_SECRET',
   'DOCUMENT_APPROVAL_VERIFICATION_SECRET','DOCUMENT_STUDY_EXECUTION_ENABLED',
   'DOCUMENT_STUDY_EXECUTION_SECRET','STUDY_APPROVAL_VERIFICATION_SECRET',
   'DOCUMENT_TASK_EXECUTION_ENABLED','KAKEIBO_EXECUTION_SERVICE',
   'KAKEIBO_SHARED_ENTRY_EXECUTION_SERVICE','KAKEIBO_BANK_TRANSFER_EXECUTION_SERVICE',
   'KAKEIBO_CARD_EXECUTION_SERVICE','KAKEIBO_CARD_SETTLEMENT_EXECUTION_SERVICE',
   'KAKEIBO_POINTS_EXECUTION_SERVICE','KAKEIBO_PREPAID_EXECUTION_SERVICE',
   'KAKEIBO_SBI_CASH_EXECUTION_SERVICE','DOCUMENT_EXECUTION_SERVICE',
   'DOCUMENT_STUDY_EXECUTION_SERVICE'],
  services:['KAKEIBO_EXECUTION_SERVICE','KAKEIBO_SHARED_ENTRY_EXECUTION_SERVICE',
   'KAKEIBO_BANK_TRANSFER_EXECUTION_SERVICE','KAKEIBO_CARD_EXECUTION_SERVICE',
   'KAKEIBO_CARD_SETTLEMENT_EXECUTION_SERVICE','KAKEIBO_POINTS_EXECUTION_SERVICE',
   'KAKEIBO_PREPAID_EXECUTION_SERVICE','KAKEIBO_SBI_CASH_EXECUTION_SERVICE',
   'DOCUMENT_EXECUTION_SERVICE','DOCUMENT_STUDY_EXECUTION_SERVICE']
 },
 'it-study-platform':{
  names:['APP_ENV','DB','HOMEFLOW_OAUTH_ORIGIN','HOMEFLOW_STUDY_SERVICE',
   'HOMEFLOW_STUDY_SSO_ENABLED','STUDY_PUBLIC_ORIGIN',
   'STUDY_SSO_ENCRYPTION_KEY','DOCUMENT_STUDY_EXECUTION_SECRET',
   'DOCUMENT_STUDY_HOMEFLOW_SERVICE','DOCUMENT_STUDY_PROOF_SECRET',
   'DOCUMENT_STUDY_SOURCE_SECRET','DOCUMENT_STUDY_SOURCE_SERVICE',
   'DOCUMENT_STUDY_EXECUTION_ENABLED'],
  services:['HOMEFLOW_STUDY_SERVICE','DOCUMENT_STUDY_HOMEFLOW_SERVICE',
   'DOCUMENT_STUDY_SOURCE_SERVICE']
 },
 'jp-document-assistant':{
  names:['DB','DOCUMENTS','HOMEFLOW_SSO_ENABLED','HOMEFLOW_SSO_ENCRYPTION_KEY',
   'HOMEFLOW_OAUTH_ORIGIN','DA_PUBLIC_ORIGIN','SESSION_HMAC_KEY',
   'HOMEFLOW_BRIDGE_SERVICE','DOCUMENT_INTENT_ENCRYPTION_KEY',
   'DOCUMENT_APPROVAL_VERIFICATION_SECRET','DOCUMENT_FINANCE_TARGET_SECRET',
   'DOCUMENT_EXECUTION_ENABLED','HOMEFLOW_DOCUMENT_EXECUTION_SECRET',
   'KAKEIBO_DOCUMENT_FINANCE_SERVICE'],
  services:['HOMEFLOW_BRIDGE_SERVICE','KAKEIBO_DOCUMENT_FINANCE_SERVICE']
 }
};
export const REQUIRED_PAGES={
 kakeibo:{
  env:['KAKEIBO_HOMEFLOW_SSO_ENABLED','HOMEFLOW_OAUTH_ORIGIN',
   'KAKEIBO_FAMILY_FINANCE_ENABLED','KAKEIBO_FAMILY_PENDING_KEY',
   'KAKEIBO_APPROVAL_SUBMISSION_ENABLED','KAKEIBO_APPROVAL_PROOF_ENABLED',
   'KAKEIBO_APPROVAL_VERIFICATION_SECRET','KAKEIBO_SHARED_ENTRY_ENABLED',
   'KAKEIBO_SHARED_MUTATION_APPROVAL_ENABLED','KAKEIBO_SHARED_MUTATION_SUBMISSION_SECRET',
   'KAKEIBO_BANK_TRANSFER_ENABLED','KAKEIBO_BANK_TRANSFER_SUBMISSION_SECRET',
   'KAKEIBO_CROSS_MEMBER_BANK_ENABLED','KAKEIBO_CROSS_MEMBER_PROOF_SECRET',
   'KAKEIBO_CARD_PURCHASES_ENABLED','KAKEIBO_CARD_SUBMISSION_SECRET',
   'KAKEIBO_CARD_SETTLEMENTS_ENABLED','KAKEIBO_CARD_SETTLEMENT_SUBMISSION_SECRET',
   'KAKEIBO_PREPAID_ACTIONS_ENABLED','KAKEIBO_PREPAID_SUBMISSION_SECRET',
   'KAKEIBO_POINTS_ACTIONS_ENABLED','KAKEIBO_POINTS_SUBMISSION_SECRET',
   'KAKEIBO_SBI_CASH_ENABLED','KAKEIBO_SBI_CASH_SUBMISSION_SECRET',
   'KAKEIBO_RECURRING_FINANCE_PLANS_ENABLED',
   'KAKEIBO_RECURRING_POLICY_SUBMISSION_ENABLED',
   'KAKEIBO_RECURRING_POLICY_SUBMISSION_SECRET',
   'KAKEIBO_LEGACY_SHARED_ADOPTION_ENABLED',
   'KAKEIBO_LEGACY_SHARED_ADOPTION_PREFLIGHT_ENABLED',
   'KAKEIBO_LEGACY_SHARED_RECEIPT_COPY_ENABLED',
   'KAKEIBO_LEGACY_SHARED_SOURCE_REFCOUNT_ENABLED',
   'KAKEIBO_LEGACY_SHARED_RECEIPT_REPAIR_ENABLED',
   'KAKEIBO_LEGACY_R2_WRITES_FROZEN'],
  d1:['DB'],r2:['RECEIPTS_R2'],services:['HOMEFLOW_IDENTITY_SERVICE']
 }
};
const normalized=(items)=>Array.isArray(items)?items:[];
const sorted=arr=>[...new Set(arr)].sort();
export function checkG8Bindings(snapshot){
 const missing=[];
 for(const [name,requirements] of Object.entries(REQUIRED_WORKERS)){
  const worker=snapshot.workers?.[name];
  if(!worker){missing.push('worker:'+name+':unavailable');continue}
  const byName=new Map(normalized(worker.bindings).map(b=>[b.name,b.type]));
  for(const key of requirements.names)if(!byName.has(key))
   missing.push('worker:'+name+':missing:'+key);
  for(const key of requirements.services)
   if(byName.has(key)&&!['service','service_binding'].includes(byName.get(key)))
    missing.push('worker:'+name+':invalid_service_type:'+key);
 }
 for(const [name,requirements] of Object.entries(REQUIRED_PAGES)){
  const pages=snapshot.pages?.[name];
  if(!pages){missing.push('pages:'+name+':unavailable');continue}
  const config=pages.production||{};
  const groups=[['env',config.env_vars],['d1',config.d1_databases],
   ['r2',config.r2_buckets],['services',config.services||config.service_bindings]];
  for(const [category,items] of groups){
   for(const needed of requirements[category]){
    if(!Object.hasOwn(items||{},needed))
     missing.push('pages:'+name+':missing:'+category+':'+needed);
   }
  }
 }
 return {ok:missing.length===0,verified:'binding-name-and-type-presence-only',
  missing:sorted(missing),cannot_certify:[
   'secret_values','feature_flags_enabled','oauth_redirect_allowlist',
   'actual_d1_migration','production_backup_and_restore','financial_reconciliation',
   'two_iphone_pwa_acceptance','rollback_drill','full_release_gates']};
}
export async function collectG8Bindings({accountId,token,fetcher=fetch}){
 if(!accountId||!token)throw Error('Cloudflare credentials required in local environment');
 const get=async path=>{
  const response=await fetcher('https://api.cloudflare.com/client/v4'+path,{
   method:'GET',headers:{Authorization:'Bearer '+token}});
  if(!response.ok)throw Error('Cloudflare read failed: '+response.status);
  const data=await response.json();
  if(!data?.success)throw Error('Cloudflare returned unsuccessful response');
  return data.result;
 };
 const root='/accounts/'+encodeURIComponent(accountId),snap={workers:{},pages:{}};
 for(const name of Object.keys(REQUIRED_WORKERS)){
  const item=await get(root+'/workers/scripts/'+encodeURIComponent(name)+'/settings');
  snap.workers[name]={bindings:normalized(item?.bindings).map(x=>({name:x.name,type:x.type}))};
 }
 for(const name of Object.keys(REQUIRED_PAGES)){
  const project=await get(root+'/pages/projects/'+encodeURIComponent(name));
  const prod=project?.deployment_configs?.production;
  if(!prod)throw Error('Production Pages config unavailable: '+name);
  snap.pages[name]={production:{
   env_vars:Object.fromEntries(Object.keys(prod.env_vars||{}).map(k=>[k,true])),
   d1_databases:Object.fromEntries(Object.keys(prod.d1_databases||{}).map(k=>[k,true])),
   r2_buckets:Object.fromEntries(Object.keys(prod.r2_buckets||{}).map(k=>[k,true])),
   services:Object.fromEntries(Object.keys(prod.services||prod.service_bindings||{}).map(k=>[k,true]))
  }};
 }
 return snap;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const accountId=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
 if(!accountId||!token){
  console.error('Missing Cloudflare credentials. No requests performed.');
  process.exitCode=2;
 }else{
  try{
   const snapshot=await collectG8Bindings({accountId,token});
   const result=checkG8Bindings(snapshot);
   console.log(JSON.stringify(result,null,2));
   if(!result.ok)process.exitCode=1;
  }catch(e){
   console.error('G8 read-only preflight failed: '+String(e.message||e));
   process.exitCode=2;
  }
 }
}
