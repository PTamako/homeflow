// Single-run four-app production key generation. Confidential output stays in
// GitHub's ephemeral runner only; never commit, upload artifacts, print, or log.
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {REQUIRED_WORKERS,REQUIRED_PAGES} from './release-g8-binding-preflight.mjs';

const SECRET_GROUPS=Object.freeze({
 H:'homeflow',B:'kakeibo-homeflow-bridge',S:'it-study-platform',
 D:'jp-document-assistant',P:'kakeibo'
});
// Each row receives exactly ONE cryptographically random hex-encoded 256-bit key.
// These peer contracts must agree; do not generate per-app independent HMAC keys.
export const CONTRACT_PAIRS=[
 ['H.APPROVAL_VERIFICATION_SECRET','B.KAKEIBO_APPROVAL_VERIFICATION_SECRET','P.KAKEIBO_APPROVAL_VERIFICATION_SECRET'],
 ['H.SHARED_ENTRY_EXECUTION_SECRET','B.KAKEIBO_SHARED_MUTATION_EXECUTION_SECRET'],
 ['H.SHARED_ENTRY_APPROVAL_PROOF_SECRET','B.KAKEIBO_SHARED_MUTATION_PROOF_SECRET'],
 ['H.BANK_TRANSFER_EXECUTION_SECRET','B.KAKEIBO_BANK_TRANSFER_EXECUTION_SECRET'],
 ['H.BANK_TRANSFER_APPROVAL_PROOF_SECRET','B.KAKEIBO_BANK_TRANSFER_PROOF_SECRET'],
 ['H.CARD_EXECUTION_SECRET','B.KAKEIBO_CARD_EXECUTION_SECRET'],
 ['H.CARD_APPROVAL_PROOF_SECRET','B.KAKEIBO_CARD_PROOF_SECRET'],
 ['H.CARD_SETTLEMENT_EXECUTION_SECRET','B.KAKEIBO_CARD_SETTLEMENT_EXECUTION_SECRET'],
 ['H.CARD_SETTLEMENT_APPROVAL_PROOF_SECRET','B.KAKEIBO_CARD_SETTLEMENT_PROOF_SECRET'],
 ['H.POINTS_EXECUTION_SECRET','B.KAKEIBO_POINTS_EXECUTION_SECRET'],
 ['H.POINTS_APPROVAL_PROOF_SECRET','B.KAKEIBO_POINTS_PROOF_SECRET'],
 ['H.PREPAID_EXECUTION_SECRET','B.KAKEIBO_PREPAID_EXECUTION_SECRET'],
 ['H.PREPAID_APPROVAL_PROOF_SECRET','B.KAKEIBO_PREPAID_PROOF_SECRET'],
 ['H.SBI_CASH_EXECUTION_SECRET','B.KAKEIBO_SBI_CASH_EXECUTION_SECRET'],
 ['H.SBI_CASH_APPROVAL_PROOF_SECRET','B.KAKEIBO_SBI_CASH_PROOF_SECRET'],
 ['H.DOCUMENT_EXECUTION_SECRET','D.HOMEFLOW_DOCUMENT_EXECUTION_SECRET'],
 ['H.DOCUMENT_APPROVAL_VERIFICATION_SECRET','D.DOCUMENT_APPROVAL_VERIFICATION_SECRET'],
 ['H.DOCUMENT_STUDY_EXECUTION_SECRET','D.HOMEFLOW_STUDY_EXECUTION_SECRET'],
 ['H.STUDY_APPROVAL_VERIFICATION_SECRET','S.DOCUMENT_STUDY_PROOF_SECRET'],
 ['H.BANK_TRANSFER_SUBMISSION_SECRET','P.KAKEIBO_BANK_TRANSFER_SUBMISSION_SECRET'],
 ['H.CARD_SUBMISSION_SECRET','P.KAKEIBO_CARD_SUBMISSION_SECRET'],
 ['H.CARD_SETTLEMENT_SUBMISSION_SECRET','P.KAKEIBO_CARD_SETTLEMENT_SUBMISSION_SECRET'],
 ['H.POINTS_SUBMISSION_SECRET','P.KAKEIBO_POINTS_SUBMISSION_SECRET'],
 ['H.PREPAID_SUBMISSION_SECRET','P.KAKEIBO_PREPAID_SUBMISSION_SECRET'],
 ['H.SBI_CASH_SUBMISSION_SECRET','P.KAKEIBO_SBI_CASH_SUBMISSION_SECRET'],
 ['H.DOCUMENT_APPROVAL_SUBMISSION_SECRET','D.DOCUMENT_APPROVAL_SUBMISSION_SECRET'],
 ['H.CROSS_MEMBER_TRANSFER_PROOF_SECRET','P.KAKEIBO_CROSS_MEMBER_PROOF_SECRET'],
 ['H.SHARED_ENTRY_SUBMISSION_SECRET','P.KAKEIBO_SHARED_MUTATION_SUBMISSION_SECRET'],
 ['H.RECURRING_FINANCE_POLICY_SUBMISSION_SECRET','P.KAKEIBO_RECURRING_POLICY_SUBMISSION_SECRET'],
 ['H.RECURRING_FINANCE_RESERVATION_SECRET','P.KAKEIBO_RECURRING_RESERVATION_SECRET'],
 ['H.RECURRING_FINANCE_EXECUTION_PROOF_SECRET','P.KAKEIBO_RECURRING_EXECUTION_PROOF_SECRET'],
 ['H.RECURRING_FINANCE_EXECUTION_RECORD_SECRET','P.KAKEIBO_RECURRING_EXECUTION_RECORD_SECRET'],
 ['H.RECURRING_FINANCE_KAKEIBO_RECEIPT_SECRET','B.KAKEIBO_RECURRING_RECEIPT_SECRET'],
 ['D.DOCUMENT_FINANCE_TARGET_SECRET','B.KAKEIBO_DOCUMENT_FINANCE_SECRET'],
 ['D.DOCUMENT_STUDY_TARGET_SECRET','S.DOCUMENT_STUDY_EXECUTION_SECRET'],
 ['D.STUDY_DOCUMENT_SOURCE_SECRET','S.DOCUMENT_STUDY_SOURCE_SECRET'],
 ['P.KAKEIBO_FAMILY_PENDING_KEY','B.KAKEIBO_FAMILY_PENDING_KEY'],
 ['S.STUDY_SSO_ENCRYPTION_KEY'],
 ['D.HOMEFLOW_SSO_ENCRYPTION_KEY'],
 ['D.DOCUMENT_INTENT_ENCRYPTION_KEY']
];
// Existing data uses these independently held keys. Never rotate them.
const PRESERVE=new Set(['D.SESSION_HMAC_KEY','P.KAKEIBO_SSO_ENCRYPTION_KEY']);
export function buildReleaseSecrets(rand=()=>randomBytes(32).toString('hex')){
 const out=Object.fromEntries(Object.keys(SECRET_GROUPS).map(k=>[k,{}]));
 for(const row of CONTRACT_PAIRS){
  const v=rand();
  if(!/^[a-f0-9]{64}$/.test(v))throw Error('CRYPTOGRAPHIC_KEY_INVALID');
  for(const encoded of row){
   const parts=encoded.split('.');
   const [group,name]=parts;
   if(!SECRET_GROUPS[group]||!name||Object.hasOwn(out[group],name))
    throw Error('INVALID_KEY_GROUP_OR_DUPLICATE');
   out[group][name]=v;
  }
 }
 const unmapped=[];
 for(const [group,req] of [
   ['H',REQUIRED_WORKERS.homeflow],
   ['B',REQUIRED_WORKERS['kakeibo-homeflow-bridge']],
   ['S',REQUIRED_WORKERS['it-study-platform']],
   ['D',REQUIRED_WORKERS['jp-document-assistant']],
   ['P',{names:REQUIRED_PAGES.kakeibo.env}]
 ]){
  for(const name of req.names.filter(x=>/_SECRET$|_KEY$/.test(x))){
   if(!Object.hasOwn(out[group],name)&&!PRESERVE.has(group+'.'+name))
    unmapped.push(group+'.'+name);
  }
 }
 if(unmapped.length)throw Error('UNMAPPED_REQUIRED_KEYS:'+unmapped.join(','));
 return out;
}
async function main(){
 // Only invoked on an ephemeral GitHub Actions runner during a reviewed release.
 if(!process.env.RUNNER_TEMP||!process.env.GITHUB_ACTIONS)
  throw Error('EPHEMERAL_ACTIONS_RUNNER_REQUIRED');
 const root=join(process.env.RUNNER_TEMP,'four-app-release-keys');
 await mkdir(root,{recursive:true,mode:0o700});
 const keys=buildReleaseSecrets();
 for(const group of ['H','B','D','S']){
  await writeFile(join(root,group+'.json'),JSON.stringify(keys[group]),{mode:0o600,flag:'wx'});
 }
 await writeFile(join(root,'P.json'),JSON.stringify(keys.P),{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({key_groups:CONTRACT_PAIRS.length,
  worker_secret_counts:Object.fromEntries(['H','B','D','S'].map(x=>[x,Object.keys(keys[x]).length])),
  pages_new_secret_count:Object.keys(keys.P).length,
  keys_exposed:false,existing_keys_preserved:true}));
}
if(import.meta.url===new URL('file://'+process.argv[1]).href){
 main().catch(e=>{console.error('RELEASE_SECRET_PLAN_FAILED:'+e.message);process.exitCode=1});
}
