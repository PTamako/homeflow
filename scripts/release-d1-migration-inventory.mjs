// G1/G9: exact source-controlled migration inventory and read-only remote D1
// schema-marker drift guard. No database changes, exports, secret values or
// financial rows. Production migration GO requires backup/restore/rollback etc.
// Cloudflare D1 query endpoint uses HTTP POST even for immutable SELECT only.
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const BASELINE_OBSERVED_AT='2026-11-15T14:16:50.434Z';
export const MIGRATION_PLANS=[
  {
    "repo": "homeflow",
    "db": "homeflow",
    "table": "d1_migrations",
    "column": "name",
    "baseline_count": 54,
    "baseline_sha256": "3a8aee4d57654c964f8317c23e4110e9cfe0ea69f3f26483f177115294740d0b",
    "base_version": 52,
    "files": [
      "0053_oauth_code_exchange.sql",
      "0054_household_approval_core.sql",
      "0055_household_approval_execution_lease.sql",
      "0056_document_task_apply.sql",
      "0057_household_batch_reviews.sql",
      "0058_cross_member_transfer_consents.sql",
      "0059_recurring_financial_authorizations.sql",
      "0060_recurring_execution_receipts.sql"
    ]
  },
  {
    "repo": "kakebo_jp",
    "db": "kakebo",
    "table": "schema_migrations",
    "column": "version",
    "baseline_count": 16,
    "baseline_sha256": "f30117ea8ae1885c18ca61f6c82872f4ca9fecc33f72c029c59af2d33f0581b0",
    "base_version": 19,
    "files": [
      "0020_recurring_multi_schedule.sql",
      "0021_sbi_transfer_purpose.sql",
      "0022_homeflow_identity_foundation.sql",
      "0023_family_financial_account_identities.sql",
      "0024_family_finance_pending_actions.sql",
      "0025_family_financial_resource_owners.sql",
      "0026_family_finance_execution.sql",
      "0027_family_legacy_entry_link_audit.sql",
      "0028_family_legacy_transfer_ids.sql",
      "0029_family_legacy_identity_guards.sql",
      "0030_document_finance_execution.sql",
      "0031_family_card_purchase_execution.sql",
      "0032_family_card_settlement_foundation.sql",
      "0033_member_prepaid_actions.sql",
      "0034_family_points_foundation.sql",
      "0035_points_prepaid_atomic.sql",
      "0036_points_card_offset.sql",
      "0037_points_transfer_exchange.sql",
      "0038_points_earn_expiry_reversals.sql",
      "0039_points_legacy_provenance.sql",
      "0040_points_sbi_lots.sql",
      "0041_points_transfer_atomic_refund.sql",
      "0042_points_prepaid_refund.sql",
      "0043_points_card_offset_refund.sql",
      "0044_sbi_cash_purchases.sql",
      "0045_sbi_cash_reversals.sql",
      "0046_sbi_legacy_holding_review.sql",
      "0047_sbi_point_full_refund.sql",
      "0048_posted_bank_transfers.sql",
      "0049_cross_member_bank_transfers.sql",
      "0050_cross_bank_statement_usage_guards.sql",
      "0051_shared_entry_lifecycle.sql",
      "0052_shared_mutation_approved_execution.sql",
      "0053_member_recurring_finance_plans.sql",
      "0054_recurring_finance_ledger_execution.sql",
      "0055_legacy_shared_entry_adoption.sql",
      "0056_legacy_shared_receipt_copy.sql",
      "0057_legacy_shared_receipt_claim.sql",
      "0058_adopted_shared_mutation_approval.sql",
      "0059_legacy_shared_receipt_repair.sql"
    ]
  },
  {
    "repo": "it-study-platform",
    "db": "it-study-platform",
    "table": "d1_migrations",
    "column": "name",
    "baseline_count": 174,
    "baseline_sha256": "30b91221e030a97b19499010a125f1a541303cc3ed3e18a85f565e0a956af0df",
    "base_version": 176,
    "files": [
      "0180_homeflow_identity_isolation.sql",
      "0181_homeflow_user_vocabulary.sql",
      "0182_homeflow_user_daily_tasks.sql",
      "0183_homeflow_language_progress.sql",
      "0184_homeflow_exam_progress.sql",
      "0185_homeflow_mock_exam_submissions.sql",
      "0186_homeflow_mock_receipt_adoption.sql",
      "0187_homeflow_grammar_answers.sql",
      "0188_homeflow_listening_answers.sql",
      "0189_homeflow_daily_word_reviews.sql",
      "0190_homeflow_personal_sentence_cards.sql",
      "0191_homeflow_document_study_receipts.sql",
      "0192_homeflow_document_study_approver_audit.sql"
    ]
  },
  {
    "repo": "jp-document-assistant",
    "db": "jp-document-assistant",
    "table": "d1_migrations",
    "column": "name",
    "baseline_count": 19,
    "baseline_sha256": "62ebb0ec892ee64d29f58e498ccf0fccf94a811a62e0a3ae1f85deec3f0503ea",
    "base_version": 19,
    "files": [
      "0020_homeflow_identity_links.sql",
      "0021_homeflow_sso_pending.sql",
      "0022_homeflow_session_proofs.sql",
      "0023_document_member_sync_intents.sql",
      "0024_document_execution_reservation.sql",
      "0025_document_task_execution_reservation.sql",
      "0026_document_study_execution_reservation.sql"
    ]
  }
];
const digest=rows=>createHash('sha256').update(rows.join('\n')).digest('hex');
export function verifyMigrationInventory(snapshot){
 const results=[],errors=[];
 for(const plan of MIGRATION_PLANS){
  const rows=snapshot?.[plan.db]?.rows;
  const writeMeta=snapshot?.[plan.db]?.changed_db===false&&
   snapshot?.[plan.db]?.rows_written===0;
  if(!Array.isArray(rows)||rows.some(x=>typeof x!=='string')||!writeMeta){
   errors.push(plan.db+':READ_ONLY_PROOF_OR_ROWS_MISSING');continue;
  }
  const unique=[...new Set(rows)];
  if(unique.length!==rows.length){errors.push(plan.db+':DUPLICATE_MARKERS');continue;}
  const sha256=digest([...rows].sort());
  if(rows.length!==plan.baseline_count||sha256!==plan.baseline_sha256)
   errors.push(plan.db+':PRODUCTION_MIGRATION_BASELINE_DRIFT');
  const fileIds=plan.files.map(x=>Number(x.slice(0,4)));
  if(new Set(fileIds).size!==fileIds.length||
    fileIds.some(n=>n<=plan.base_version||!Number.isSafeInteger(n)))
   errors.push(plan.db+':LOCAL_MIGRATION_ORDER_INVALID');
  results.push({database:plan.db,recorded_baseline_count:plan.baseline_count,
   actual_marker_count:rows.length,baseline_digest_matches:sha256===plan.baseline_sha256,
   pending_migration_files:plan.files.length,
   files:plan.files,changed_db:false});
 }
 return {ok:errors.length===0,read_only:true,
  eligible_for_isolated_migration_rehearsal:errors.length===0,
  production_migration_authorized:false,
  checked_baseline_at:BASELINE_OBSERVED_AT,errors,results,
  missing_release_evidence:['fresh_full_d1_r2_backup','independent_restore',
   'schema_and_data_pre_post_invariants','all_g3_g6_contracts',
   'production_binding_preflight','manual_release_signoff','tested_rollback']};
}
export async function collectMigrationInventory({accountId,token,fetcher=fetch}){
 if(!accountId||!token)throw Error('Cloudflare credentials required');
 const prefix='https://api.cloudflare.com/client/v4/accounts/'+
   encodeURIComponent(accountId);
 const call=async(path,options)=>{
  const response=await fetcher(prefix+path,{
   ...options,headers:{Authorization:'Bearer '+token,...(options.headers||{})}});
  if(!response?.ok)throw Error('CLOUDFLARE_READ_FAILED_'+response?.status);
  const body=await response.json();
  if(body?.success!==true)throw Error('CLOUDFLARE_UNSUCCESSFUL_RESPONSE');
  return body;
 };
 const listed=await call('/d1/database?per_page=1000',{method:'GET'});
 if(!Array.isArray(listed.result))throw Error('D1_DATABASE_LIST_UNAVAILABLE');
 const snapshot={};
 for(const plan of MIGRATION_PLANS){
  const matches=listed.result.filter(x=>x.name===plan.db);
  if(matches.length!==1||!/^[-0-9a-f]{36}$/i.test(matches[0]?.uuid||''))
   throw Error('D1_NAME_MISSING_OR_AMBIGUOUS:'+plan.db);
  const sql='SELECT '+plan.column+' AS name FROM '+plan.table+' ORDER BY name';
  const queried=await call('/d1/database/'+encodeURIComponent(matches[0].uuid)+'/query',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({sql})});
  const result=queried.result;
  if(!Array.isArray(result)||result.length!==1||result[0]?.success!==true||
   !Array.isArray(result[0]?.results))throw Error('D1_MARKERS_QUERY_FAILED:'+plan.db);
  // Strict metadata: a SELECT cannot change production state.
  if(result[0].meta?.changed_db!==false||result[0].meta?.rows_written!==0)
   throw Error('D1_QUERY_CHANGED_DATABASE:'+plan.db);
  snapshot[plan.db]={rows:result[0].results.map(x=>x.name),
   changed_db:false,rows_written:0};
 }
 return snapshot;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const accountId=process.env.CLOUDFLARE_ACCOUNT_ID;
 const token=process.env.CLOUDFLARE_API_TOKEN;
 if(!accountId||!token){
  console.error('Read-only Cloudflare credentials missing; no requests made');
  process.exitCode=2;
 }else{
  try{
   const snapshot=await collectMigrationInventory({accountId,token});
   const report=verifyMigrationInventory(snapshot);
   // Only marker digests, counts, filenames, errors. Never output API token
   // or user financial rows. This is NOT a backup or production GO.
   console.log(JSON.stringify(report,null,2));
   if(!report.ok)process.exitCode=1;
  }catch(e){
   console.error('Read-only inventory preflight error: '+String(e.message||e));
   process.exitCode=2;
  }
 }
}
